/* PDF Mapper — motor puro: documentos semilla, maquetación de texto,
 * métricas de fuente, preflight y export. Sin DOM ni estado de la interfaz:
 * pdf-mapper.html lo importa y lo usan las pruebas de _designlab tal cual.
 *
 * Las librerías del CDN (PDFLib, QRCode, fontkit) se leen de globalThis en el
 * momento de usarlas, igual que antes dentro del HTML.
 *
 * El lienzo y la vista previa real dibujan con la MISMA maquetación
 * (layoutTextField / layoutCharacters): cualquier cambio de posición de texto
 * va aquí, nunca en uno solo de los dos. */

import { isRemovedSourceText } from "./pdf-text.mjs";

/* ---------------------------------------------------------------------
 * 1. SEED — transcripción de los documentos reales (ver nota arriba).
 * ------------------------------------------------------------------- */
const SEED_DOCUMENTS = {
  constancia: {
    label: "Constancia CDMX", template: "plantilla_constancia.pdf", renderer: "constancia",
    page: { width: 792, height: 612 }, pageCount: 1,
    fonts: { bold: "TimesRomanBold", mono: "Courier" },
    sample: { record: { nombre: "Juan Pérez Ejemplo", empresa: "Empresa Ejemplo S.A. de C.V." }, pki: { line1: "SA-PKI-DEMO-0001", line2: "2026-09-10T00:00:00Z" } },
    fields: [
      { id: "nombre", type: "text", align: "pageCenter", y: 335, size: 16, fontKey: "bold", color: "black", dataKey: "record.nombre" },
      { id: "empresa", type: "text", align: "left", x: 239, y: 398, size: 16, fontKey: "bold", color: "black", dataKey: "record.empresa" },
      { id: "qr", type: "qr", x: 605, y: 349, width: 71, height: 69,
        captionTop: { text: "Escanea para", size: 6, fontKey: "bold", color: "gray", offsetY: 5 },
        captionBottom: { text: "Verificar autenticidad", size: 6, fontKey: "bold", color: "gray", offsetY: -10 },
        frame: { enabled: false, color: "black", width: 1 } },
      { id: "signature", type: "image", x: 380, y: 157, width: 107, height: 71, hAlign: "center", dataKey: "data.signaturePng" },
      { id: "pkiLine1", type: "text", align: "left", x: 20, y: 13, size: 5, fontKey: "mono", color: "whiteFaint90", dataKey: "pki.line1", group: "pki", groupLabel: "Sello PKI (2 líneas)" },
      { id: "pkiLine2", type: "text", align: "left", x: 20, y: 6, size: 5, fontKey: "mono", color: "whiteFaint80", dataKey: "pki.line2", group: "pki", groupLabel: "Sello PKI (2 líneas)" }
    ]
  },
  dc3: {
    label: "DC-3", template: "plantilla_dc3.pdf", renderer: "dc3",
    page: { width: 612, height: 792 }, pageCount: 1,
    fonts: { regular: "Helvetica", bold: "HelveticaBold" },
    sample: { record: { nombre: "Juan Pérez Ejemplo", curp: "PEJJ900101HDFRXN01", ocupacion: "Operador", puesto: "Técnico de mantenimiento",
      empresa: "Empresa Ejemplo S.A. de C.V.", rfc: "PEJJ900101AB1", rfcDisplay: "PEJ-900101-AB1", nombreCurso: "Protección Civil Básica", duracion: "8",
      fechaInicioDigits: "20260101", fechaFinDigits: "20260102", area: "6000 SEGURIDAD", agente: "Instructor Ejemplo",
      instructor: "Instructor Ejemplo", patron: "Patrón Ejemplo", representanteTrabajadores: "Representante Ejemplo" } },
    fields: [
      { id: "logo", type: "image", x: 32, y: 704, width: 116, height: 58, hAlign: "left", dataKey: "record.logoPng" },
      { id: "nombre", type: "text", fit: true, align: "left", x: 33, y: 595, width: 530, size: 11, fontKey: "bold", color: "black", dataKey: "record.nombre" },
      { id: "curp", type: "characters", y: 559, size: 8.8, fontKey: "bold", color: "black", allowHyphen: false,
        centers: Array.from({ length: 18 }, (_, i) => 39 + i * 14.25 - (i < 13 ? 1 : 0)), dataKey: "record.curp" },
      { id: "ocupacion", type: "text", fit: true, align: "boxCenter", x: 307, y: 561, width: 260, size: 8.8, fontKey: "regular", color: "black", dataKey: "record.ocupacion" },
      { id: "puesto", type: "text", fit: true, align: "left", x: 40, y: 533, width: 520, size: 11, fontKey: "bold", color: "black", dataKey: "record.puesto" },
      { id: "empresa", type: "text", fit: true, align: "left", x: 34, y: 479, width: 520, size: 11, fontKey: "bold", color: "black", dataKey: "record.empresa" },
      { id: "rfc", type: "characters", y: 443, size: 10, fontKey: "bold", color: "black", allowHyphen: true,
        centers: [48, 62, 76.5, 91.5, 106, 120, 134, 148.5, 163, 177, 191, 205.5, 223.5, 241], dataKey: "record.rfcDisplay" },
      { id: "nombreCurso", type: "text", fit: true, align: "left", x: 44, y: 389, width: 260, size: 12, fontKey: "bold", color: "black", dataKey: "record.nombreCurso" },
      { id: "duracion", type: "text", fit: true, align: "boxCenter", x: 43, y: 371, width: 130, size: 10, fontKey: "bold", color: "black", textTemplate: "{record.duracion} HORAS", dataKey: "record.duracion" },
      { id: "fechaInicio", type: "characters", y: 367, size: 9.5, fontKey: "bold", color: "black", group: "fechas", groupLabel: "Rango de fechas (inicio/fin)",
        centers: [255, 271, 286.5, 302, 320.5, 341.5, 362.5, 383.5], dataKey: "record.fechaInicioDigits" },
      { id: "fechaFin", type: "characters", y: 367, size: 9.5, fontKey: "bold", color: "black", group: "fechas", groupLabel: "Rango de fechas (inicio/fin)",
        centers: [425, 444.5, 464, 483.5, 503.5, 524.5, 545.5, 566.5], dataKey: "record.fechaFinDigits" },
      { id: "area", type: "text", fit: true, align: "left", x: 43, y: 340, width: 520, size: 10, fontKey: "bold", color: "black", dataKey: "record.area" },
      { id: "agente", type: "text", fit: true, align: "left", x: 43, y: 315, width: 520, size: 9.5, fontKey: "regular", color: "black", dataKey: "record.agente" },
      { id: "signature", type: "image", x: 62, y: 206, width: 135, height: 58, hAlign: "center", dataKey: "data.signaturePng" },
      { id: "instructor", type: "text", fit: true, align: "boxCenter", x: 56, y: 226, width: 150, size: 8.2, fontKey: "regular", color: "black", maxLines: 2, lineHeight: 8, dataKey: "record.instructor", group: "firmantes", groupLabel: "Bloque de firmantes (3 columnas)" },
      { id: "patron", type: "text", fit: true, align: "boxCenter", x: 218, y: 226, width: 150, size: 8.2, fontKey: "regular", color: "black", maxLines: 2, lineHeight: 8, dataKey: "record.patron", group: "firmantes", groupLabel: "Bloque de firmantes (3 columnas)" },
      { id: "representanteTrabajadores", type: "text", fit: true, align: "boxCenter", x: 386, y: 226, width: 150, size: 8.2, fontKey: "regular", color: "black", maxLines: 2, lineHeight: 8, dataKey: "record.representanteTrabajadores", group: "firmantes", groupLabel: "Bloque de firmantes (3 columnas)" }
    ]
  },
  carta: {
    label: "Carta de corresponsabilidad", template: "plantilla_carta.pdf", renderer: "carta",
    page: { width: 612, height: 792 }, pageCount: 1,
    fonts: { regular: "Helvetica", bold: "HelveticaBold" },
    sample: { record: { fecha: "5 de septiembre de 2026", razonSocial: "Empresa Ejemplo S.A. de C.V.", municipio: "Ciudad de México",
      nombreCliente: "Juan Pérez Ejemplo" } },
    fields: [
      { id: "fecha", type: "text", align: "left", x: 347, y: 692, size: 11, fontKey: "regular", color: "black", dataKey: "record.fecha" },
      { id: "razonSocialTop", type: "text", align: "pageCenter", y: 539, size: 11, fontKey: "bold", color: "black", dataKey: "record.razonSocial", group: "razonSocial", groupLabel: "Razón social (mismo valor, aparece 3 veces)" },
      { id: "municipio", type: "text", align: "pageCenter", y: 517, ySplitTop: 528, ySplitBottom: 515, size: 11, fontKey: "regular", color: "black", role: "carta.municipioAutoSplit", dataKey: "record.municipio" },
      { id: "razonSocialBottom", type: "text", align: "pageCenter", y: 303, size: 11, fontKey: "bold", color: "black", dataKey: "record.razonSocial", group: "razonSocial", groupLabel: "Razón social (mismo valor, aparece 3 veces)" },
      { id: "qr", type: "qr", x: 419, y: 400, width: 73, height: 75, frame: { enabled: false, color: "black", width: 1 } },
      { id: "firmanteNombre", type: "text", align: "left", role: "carta.firmanteCentrado", y: 65, size: 11, fontKey: "bold", color: "black", dataKey: "record.nombreCliente" },
      { id: "representanteLabel", type: "text", align: "left", x: 87, y: 51, size: 10, fontKey: "regular", color: "black", literalText: "Representante Legal" },
      { id: "razonSocialFooter", type: "text", align: "left", x: 87, y: 37, size: 10, fontKey: "regular", color: "black", dataKey: "record.razonSocial", group: "razonSocial", groupLabel: "Razón social (mismo valor, aparece 3 veces)" },
      { id: "signature", type: "image", x: 411, y: 88, width: 107, height: 71, hAlign: "center", dataKey: "data.signaturePng" }
    ]
  }
};
/* IDs originales de cada documento con exportador a medida — un campo nuevo
 * con un id fuera de esta lista no aparece en su export bespoke (ver preflight). */
const KNOWN_FIELD_IDS = Object.fromEntries(Object.entries(SEED_DOCUMENTS).map(([id, doc]) => [id, new Set(doc.fields.map(f => f.id))]));
/* Campos originales cuyo estilo (fuente/negrita/cursiva/color) queda fijo
 * aunque el export a medida ya resuelve estilo por campo: el sello PKI de
 * constancia es texto blanco semitransparente con opacidad fija por diseño. */
const STYLE_FIXED_BESPOKE_FIELDS = { constancia: new Set(["pkiLine1", "pkiLine2"]) };
/* Alineaciones que el export a medida SÍ sabe escribir para cada campo
 * original (ver EXPORT_BUILDERS): los drawFit de dc3 sólo centran en su caja
 * ("center: true"); los drawText simples con X fija calculan su X según la
 * alineación. Los campos ya centrados en la página sin X (nombre de
 * constancia, razón social de carta) y los que tienen "role" no aparecen:
 * no tienen una X a la cual volver. */
const DC3_FIT_ALIGN = ["left", "boxCenter"];
const PLAIN_TEXT_ALIGN = ["left", "pageCenter", "boxCenter", "boxRight"];
const BESPOKE_ALIGN_OPTIONS = {
  constancia: { empresa: PLAIN_TEXT_ALIGN },
  dc3: Object.fromEntries(["nombre", "ocupacion", "puesto", "empresa", "nombreCurso", "duracion", "area", "agente", "instructor", "patron", "representanteTrabajadores"].map(id => [id, DC3_FIT_ALIGN])),
  carta: { fecha: PLAIN_TEXT_ALIGN, representanteLabel: PLAIN_TEXT_ALIGN, razonSocialFooter: PLAIN_TEXT_ALIGN }
};


/* ---------------------------------------------------------------------
 * 3. RENDER ENGINE — reimplementación fiel de los helpers puros
 *    (mismo pdf-lib, sin importar client.documents.mjs).
 * ------------------------------------------------------------------- */
const COLORS = {
  black: () => PDFLib.rgb(0, 0, 0), gray: () => PDFLib.rgb(0.2, 0.2, 0.2),
  white: () => PDFLib.rgb(1, 1, 1), whiteFaint90: () => PDFLib.rgb(1, 1, 1), whiteFaint80: () => PDFLib.rgb(1, 1, 1)
};
/* Resuelve el color real de un campo (o de su frame/caption): un color
 * personalizado (#rrggbb, elegido con el selector de color del inspector)
 * tiene prioridad sobre los 5 colores con nombre. Espejo exacto de la función
 * "colorFor" embebida en el código exportado (buildFieldLoopSnippet) para que
 * la vista previa de la herramienta y el PDF final coincidan siempre. */
function fieldColorRgb(obj) {
  if (obj?.colorHex) {
    const hex = obj.colorHex.replace("#", "");
    return PDFLib.rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
  }
  return COLORS[obj?.color]?.() || COLORS.black();
}
const OPACITY = { whiteFaint90: 0.9, whiteFaint80: 0.8 };
function cleanText(v) { return String(v ?? "").replace(/\s+/g, " ").trim(); }
function wrapText(text, font, size, maxWidth) {
  const words = cleanText(text).split(" ").filter(Boolean);
  const lines = []; let current = "";
  for (const w of words) {
    const cand = current ? current + " " + w : w;
    if (current && font.widthOfTextAtSize(cand, size) > maxWidth) { lines.push(current); current = w; }
    else current = cand;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}
/* "cleanText" colapsa TODO el espacio en blanco (incluidos los saltos de
 * línea) porque así limpia también producción (su "clean()" real hace lo
 * mismo) — pero eso significa que escribir Enter en "Plantilla con
 * variables" no producía ningún salto real, todo el párrafo quedaba en una
 * sola tira de texto que luego se autoenvolvía sólo por ancho. Aquí se
 * respeta el "\n" como salto DURO: se corta el texto en párrafos primero, y
 * sólo DENTRO de cada párrafo se limpia y se autoenvuelve por ancho. */
function wrapTextWithBreaks(text, font, size, maxWidth) {
  return String(text ?? "").split("\n").flatMap(para => {
    const cleaned = cleanText(para);
    return cleaned ? wrapText(cleaned, font, size, maxWidth) : [""];
  });
}
/* Misma limpieza que aplica el helper real "drawCharacters" de producción:
 * mayúsculas, sin acentos, sólo A-Z0-9 (y guion si allowHyphen). Compartida
 * entre la maquetación, el aviso de preflight de longitud y el lienzo. */
function cleanCharactersValue(value, allowHyphen) {
  const pattern = allowHyphen ? /[^A-Z0-9-]/g : /[^A-Z0-9]/g;
  return String(value ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(pattern, "");
}

/* ---------------------------------------------------------------------
 * 3a. MAQUETACIÓN DE TEXTO — la ÚNICA fuente de verdad de dónde cae cada
 *    línea: la usan la vista previa real (pdf-lib) y el lienzo del editor
 *    (el texto que se ve sobre el documento), así que lo que se ve al editar
 *    es lo que sale en el PDF. Reproduce las reglas de producción: drawFit
 *    (envolver por ancho, reducir cada línea hasta 6 pt, centrar en la caja),
 *    centrado en la página y las fórmulas especiales de la carta. Las
 *    posiciones se calculan con las métricas reales de pdf-lib.
 * ------------------------------------------------------------------- */
/* Métricas: una letra que la fuente no puede escribir (WinAnsi) no debe
 * tumbar el editor — se mide aproximada; el preflight ya la reporta y la
 * vista previa real sigue fallando como fallaría el PDF. */
function safeWidth(font, text, size) {
  if (!font) return String(text ?? "").length * size * 0.55;
  try { return font.widthOfTextAtSize(String(text ?? ""), size); } catch { return String(text ?? "").length * size * 0.55; }
}
function wrapSafe(text, font, size, maxWidth) {
  if (font) { try { return wrapTextWithBreaks(text, font, size, maxWidth); } catch { /* sigue abajo */ } }
  return String(text ?? "").split("\n").map(cleanText);
}
/* Alto visual de una línea para la caja del editor (no afecta al PDF). */
const TEXT_ASCENT = 0.8, TEXT_DESCENT = 0.25;
/*
 * doc: la vista de la página del campo (pageView). Devuelve
 *   lines: [{ text, x, y, size }]  — en puntos PDF, "y" = línea base;
 *   fontName: fuente estándar ya resuelta (familia + negrita/cursiva);
 *   ignoresOpacity: drawFit de producción no reenvía la opacidad;
 *   box: { x0, x1, y0, y1 } — la caja de texto que muestra el editor.
 */
function layoutTextField(doc, field, data) {
  const font = metricFontFor(doc, field);
  const fontName = resolveStandardFontName(baseFontNameFor(doc, field.fontKey), !!field.bold, !!field.italic);
  const size = field.size || 11;
  const pageWidth = doc.page.width;
  const text = resolveText(field, data);
  const lh = field.lineHeight || size + 1;
  const width = (t, s) => safeWidth(font, t, s);
  const lines = [];
  const centered = (t, y) => { const c = cleanText(t); lines.push({ text: c, x: pageWidth / 2 - width(c, size) / 2, y, size }); };
  if (field.role === "carta.municipioAutoSplit") {
    if (width(text, size) <= pageWidth - 80) centered(text, field.y);
    else {
      const mid = Math.floor(text.length / 2);
      let cut = text.lastIndexOf(",", mid); if (cut === -1) cut = text.indexOf(",", mid); if (cut === -1) cut = mid;
      centered(text.slice(0, cut + 1).trim(), field.ySplitTop);
      centered(text.slice(cut + 1).trim(), field.ySplitBottom);
    }
  } else if (field.role === "carta.firmanteCentrado") {
    lines.push({ text, x: pageWidth * 0.45 / 2 - width(text, size) / 2 + 40, y: field.y, size });
  } else if (field.shrink && field.width > 0) {
    /* Una sola línea que reduce su fuente (hasta 6 pt) si no cabe en la caja:
     * nunca se parte ni pierde palabras. Mismo cálculo que el código exportado. */
    const c = cleanText(text);
    if (c) {
      let fs = size;
      /* Piso: 6 pt, o el 80 % de un texto que ya es más chico (el sello). */
      const floor = Math.min(6, size * 0.8);
      while (fs > floor && width(c, fs) > field.width) fs -= 0.4;
      const w = width(c, fs);
      lines.push({ text: c, x: field.align === "boxCenter" ? field.x + (field.width - w) / 2 : field.align === "boxRight" ? field.x + field.width - w : field.x, y: field.y, size: fs });
    }
  } else if (field.fit) {
    if (String(text ?? "").trim()) {
      wrapSafe(text, font, size, field.width).slice(0, field.maxLines || 1).forEach((line, i) => {
        if (!line) return;
        let fs = size;
        while (fs > 6 && width(line, fs) > field.width) fs -= 0.4;
        const w = width(line, fs);
        const x = field.align === "boxCenter" ? field.x + (field.width - w) / 2 : field.align === "boxRight" ? field.x + field.width - w : field.x;
        lines.push({ text: line, x, y: field.y - i * lh, size: fs });
      });
    }
  } else if (field.align === "pageCenter") {
    centered(text, field.y);
  } else if ((field.align === "boxCenter" || field.align === "boxRight") && field.width != null) {
    const c = cleanText(text), w = width(c, size);
    lines.push({ text: c, x: field.align === "boxCenter" ? field.x + (field.width - w) / 2 : field.x + field.width - w, y: field.y, size });
  } else {
    lines.push({ text: cleanText(text), x: field.x, y: field.y, size });
  }
  /* Caja: con ancho declarado, la caja es ese ancho (como un cuadro de texto
   * de Word); sin ancho, abraza el texto; vacía, un mínimo para poder tomarla. */
  const drawn = lines.filter(l => l.text);
  let x0, x1;
  if (field.width != null && field.x != null && !field.role && field.align !== "pageCenter") { x0 = field.x; x1 = field.x + field.width; }
  else if (drawn.length) { x0 = Math.min(...drawn.map(l => l.x)); x1 = Math.max(...drawn.map(l => l.x + width(l.text, l.size))); }
  else { const cx = field.align === "pageCenter" || field.role ? pageWidth / 2 : (field.x ?? 0) + 10; x0 = cx - 10; x1 = cx + 10; }
  const ys = lines.map(l => l.y).concat(field.y);
  const y1 = Math.max(...ys) + size * TEXT_ASCENT;
  const y0 = field.fit ? field.y - ((field.maxLines || 1) - 1) * lh - size * TEXT_DESCENT : Math.min(...ys) - size * TEXT_DESCENT;
  return { lines, fontName, font, ignoresOpacity: (!!field.fit || !!field.shrink) && !field.role, box: { x0, x1, y0, y1 } };
}
/* ---------------------------------------------------------------------
 * 3a-bis. MARCOS DEL QR — una sola definición de la forma del marco y de
 *    sus textos, compartida por el lienzo (SVG), la vista previa real y el
 *    código exportado. Estas dos funciones son AUTOCONTENIDAS a propósito:
 *    el export copia su código fuente tal cual (Function#toString), así que
 *    el PDF de producción dibuja exactamente lo mismo que se ve aquí.
 *
 *  frame: { enabled, style, color | colorHex, width (grosor), padding
 *           (separación QR↔marco), radius, background (#rrggbb detrás del
 *           QR), cornerLength (fracción del lado, estilo "corners") }
 *  estilos: square · rounded · double · dashed · dotted · corners · badge
 *  Un marco sin "style" es el cuadrado de siempre, pegado al QR.
 * ------------------------------------------------------------------- */
function qrFramePrimitives(box, frame, captions) {
  const rgbOf = (o, fallback) => {
    if (o && o.colorHex) { const h = String(o.colorHex).replace("#", ""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255); }
    return ({ black: [0, 0, 0], gray: [0.2, 0.2, 0.2], white: [1, 1, 1] })[o && o.color] || fallback;
  };
  const under = [], over = [];
  const f = frame || {};
  const style = f.enabled ? (f.style || "square") : "none";
  const t = Math.max(0.1, Number(f.width) || 1);
  const p = Math.max(0, Number(f.padding) || 0);
  const color = rgbOf(f, [0, 0, 0]);
  const X = box.x - p, Y = box.y - p, W = box.width + 2 * p, H = box.height + 2 * p;
  const radius = Math.max(0, Math.min(Number(f.radius ?? 6), W / 2, H / 2));
  const top = captions && captions.top, bottom = captions && captions.bottom;
  const cx = box.x + box.width / 2;
  const textOf = (c, slot, y, fallbackColor) => ({ t: "text", text: String(c.text), cx, y, size: Number(c.size) || 6, color: rgbOf(c, fallbackColor), font: { fontKey: c.fontKey, bold: c.bold, italic: c.italic, slot } });
  if (style === "badge") {
    /* Insignia: bloque de color con el QR sobre blanco y una banda inferior
     * con texto (el texto inferior; "ESCANÉAME" si está vacío). */
    const label = bottom && bottom.text ? bottom : { text: "ESCANÉAME", size: 7, color: "white", bold: true };
    const size = Number(label.size) || 7;
    const band = size * 2.4;
    const pad = Math.max(p, 3);
    const ix = box.x - pad, iy = box.y - pad, iw = box.width + 2 * pad, ih = box.height + 2 * pad;
    const border = Math.max(t, 2);
    under.push({ t: "rect", x: ix - border, y: iy - band, w: iw + 2 * border, h: ih + border + band, fill: color, r: radius });
    under.push({ t: "rect", x: ix, y: iy, w: iw, h: ih, fill: rgbOf({ colorHex: f.background || "#ffffff" }, [1, 1, 1]), r: Math.max(0, radius - border) });
    over.push(textOf(label, "bottom", iy - band / 2 - size * 0.35, [1, 1, 1]));
    if (top && top.text) over.push(textOf(top, "top", box.y + box.height + pad + border + (Number(top.offsetY ?? 8)), [0.2, 0.2, 0.2]));
    return { under, over };
  }
  if (f.background && style !== "none") under.push({ t: "rect", x: X, y: Y, w: W, h: H, fill: rgbOf({ colorHex: f.background }, [1, 1, 1]), r: style === "rounded" ? radius : 0 });
  if (style === "square" || style === "dashed" || style === "dotted") {
    over.push({ t: "rect", x: X, y: Y, w: W, h: H, stroke: color, lw: t, dash: style === "dashed" ? [t * 3, t * 2] : style === "dotted" ? [t, t * 1.6] : null });
  } else if (style === "rounded") {
    over.push({ t: "rect", x: X, y: Y, w: W, h: H, stroke: color, lw: t, r: radius });
  } else if (style === "double") {
    const d = t * 2.5;
    over.push({ t: "rect", x: X, y: Y, w: W, h: H, stroke: color, lw: t });
    over.push({ t: "rect", x: X - d, y: Y - d, w: W + 2 * d, h: H + 2 * d, stroke: color, lw: t });
  } else if (style === "corners") {
    const L = Math.max(t * 3, Math.min(W, H) * (Number(f.cornerLength) || 0.25));
    const seg = (x1, y1, x2, y2) => over.push({ t: "line", x1, y1, x2, y2, stroke: color, lw: t });
    seg(X, Y + H, X + L, Y + H); seg(X, Y + H, X, Y + H - L);
    seg(X + W, Y + H, X + W - L, Y + H); seg(X + W, Y + H, X + W, Y + H - L);
    seg(X, Y, X + L, Y); seg(X, Y, X, Y + L);
    seg(X + W, Y, X + W - L, Y); seg(X + W, Y, X + W, Y + L);
  }
  /* Textos arriba/abajo: la misma posición de siempre (relativa al QR, con
   * "offsetY"), más la separación del marco para no encimarse con él. */
  if (top && top.text) over.push(textOf(top, "top", box.y + box.height + p + Number(top.offsetY ?? 8), [0.2, 0.2, 0.2]));
  if (bottom && bottom.text) over.push(textOf(bottom, "bottom", box.y - p + Number(bottom.offsetY ?? -10), [0.2, 0.2, 0.2]));
  return { under, over };
}
/* Dibuja las primitivas con pdf-lib. fontFor(descriptor) devuelve la fuente
 * incrustada para un texto ({ fontKey, bold, italic, slot }). */
async function drawQrPrimitives(page, pdfLib, prims, fontFor) {
  const rgb = a => pdfLib.rgb(a[0], a[1], a[2]);
  for (const p of prims) {
    if (p.t === "rect") {
      const style = { color: p.fill ? rgb(p.fill) : undefined, borderColor: p.stroke ? rgb(p.stroke) : undefined, borderWidth: p.stroke ? p.lw : 0, borderDashArray: p.dash || undefined };
      if (p.r > 0) {
        const r = p.r, w = p.w, h = p.h;
        const path = `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
        page.drawSvgPath(path, { x: p.x, y: p.y + h, ...style });
      } else {
        page.drawRectangle({ x: p.x, y: p.y, width: p.w, height: p.h, ...style });
      }
    } else if (p.t === "line") {
      page.drawLine({ start: { x: p.x1, y: p.y1 }, end: { x: p.x2, y: p.y2 }, thickness: p.lw, color: rgb(p.stroke), lineCap: pdfLib.LineCapStyle ? pdfLib.LineCapStyle.Projecting : undefined });
    } else if (p.t === "text" && p.text) {
      const font = await fontFor(p.font);
      page.drawText(p.text, { x: p.cx - font.widthOfTextAtSize(p.text, p.size) / 2, y: p.y, size: p.size, font, color: rgb(p.color) });
    }
  }
}
/* ¿Hace falta el motor de marcos en el export a medida? No, mientras el
 * marco sea el cuadrado de siempre (color con nombre, sin separación ni
 * fondo) y los textos no usen color personalizado ni negrita propia: así el
 * export de constancia/carta sigue idéntico al código de producción. */
function qrNeedsFrameEngine(qr) {
  const f = qr.frame || {};
  const frameLegacy = !f.enabled || ((f.style || "square") === "square" && !f.padding && !f.colorHex && !f.background);
  const captionLegacy = c => !c || (!c.colorHex && c.bold === undefined);
  return !(frameLegacy && captionLegacy(qr.captionTop) && captionLegacy(qr.captionBottom));
}

/* Casillas: cada carácter centrado en su centro, sobre la línea base. */
function layoutCharacters(doc, field, data) {
  const font = metricFontFor(doc, field);
  const fontName = resolveStandardFontName(baseFontNameFor(doc, field.fontKey), !!field.bold, !!field.italic);
  const text = cleanCharactersValue(resolveText(field, data), field.allowHyphen).slice(0, field.centers.length);
  const lines = [];
  field.centers.forEach((c, i) => { const ch = text[i] || ""; if (ch) lines.push({ text: ch, x: c - safeWidth(font, ch, field.size) / 2, y: field.y, size: field.size }); });
  return { lines, fontName, font };
}
async function embedImageLocal(pdfDoc, value) {
  if (!value) return null;
  if (typeof value === "object" && typeof value.width === "number") return value;
  const comma = String(value).indexOf(",");
  if (comma < 0) return null;
  const bytes = Uint8Array.from(atob(String(value).slice(comma + 1)), c => c.charCodeAt(0));
  return String(value).startsWith("data:image/jpeg") || String(value).startsWith("data:image/jpg") ? pdfDoc.embedJpg(bytes) : pdfDoc.embedPng(bytes);
}
async function drawImageContainLocal(pdfDoc, page, value, { x, y, width, height, hAlign = "center" }) {
  const image = await embedImageLocal(pdfDoc, value);
  if (!image) return;
  const ratio = Math.min(width / image.width, height / image.height);
  const dw = image.width * ratio, dh = image.height * ratio;
  const dx = hAlign === "left" ? x : x + (width - dw) / 2;
  const dy = y + (height - dh) / 2;
  page.drawImage(image, { x: dx, y: dy, width: dw, height: dh });
}
/* El placeholder de imagen/firma es un PNG de relleno (no hay imagen real
 * todavía) que luego se ajusta a la caja con "contain" (mismo algoritmo que
 * drawSignature de producción: escala manteniendo proporción, sin deformar).
 * Antes el canvas SIEMPRE era 160×160 (cuadrado) — con "contain", una fuente
 * cuadrada sólo puede producir un resultado cuadrado sin importar qué tan
 * rectangular sea la caja del campo, así que una firma configurada como
 * rectángulo ancho se veía igual de cuadrada que una casilla 1:1. Ahora el
 * canvas del placeholder toma la proporción real de la caja (boxWidth/
 * boxHeight) para que el preview muestre la caja tal cual es. El QR se deja
 * cuadrado a propósito: un código QR real siempre lo es. */
function placeholderPng(kind, boxWidth, boxHeight) {
  const aspect = kind !== "qr" && boxWidth > 0 && boxHeight > 0 ? boxWidth / boxHeight : 1;
  const h = 160, w = Math.round(h * Math.max(0.2, Math.min(5, aspect)));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#eef2f5"; g.fillRect(0, 0, w, h);
  if (kind === "qr") {
    g.fillStyle = "#111";
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j * 3) % 5 < 2) g.fillRect(10 + i * 18, 10 + j * 18, 16, 16);
    g.fillStyle = "#fff"; g.fillRect(20, 20, 30, 30); g.fillRect(110, 20, 30, 30); g.fillRect(20, 110, 30, 30);
    g.strokeStyle = "#111"; g.lineWidth = 4; g.strokeRect(20, 20, 30, 30); g.strokeRect(110, 20, 30, 30); g.strokeRect(20, 110, 30, 30);
  } else {
    g.fillStyle = "#c7d3dc"; g.font = `bold ${Math.round(h * 0.14)}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(kind === "image" ? "IMG" : "FIRMA", w / 2, h / 2);
    g.strokeStyle = "#9db0bf"; g.lineWidth = 3; g.strokeRect(4, 4, w - 8, h - 8);
  }
  return c.toDataURL("image/png");
}
/* {record.campo} admite ruta con puntos, igual que "dataKey" — un {duracion}
 * plano (bug real encontrado en el seed de dc3) nunca resolvía porque el dato
 * vive en record.duracion, no en la raíz de "data". */
function resolveTemplate(template, data) {
  return String(template).replace(/\{([\w.]+)\}/g, (_, path) => {
    const value = path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), data);
    return value == null ? "" : String(value);
  });
}
function resolveText(field, data) {
  let raw;
  if (field.literalText != null) raw = field.literalText;
  else if (field.textTemplate) raw = resolveTemplate(field.textTemplate, data);
  else {
    const path = field.dataKey || "";
    raw = path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), data) ?? "";
  }
  let text = String(raw ?? "");
  if (field.textCase === "uppercase") text = text.toLocaleUpperCase("es-MX");
  else if (field.textCase === "lowercase") text = text.toLocaleLowerCase("es-MX");
  return `${field.prefix || ""}${text}${field.suffix || ""}`;
}

/* Negrita/cursiva: los 14 fonts estándar de PDF vienen en familias de 4
 * variantes cada una. "fontKey" sigue eligiendo la FAMILIA base (declarada en
 * doc.fonts, p. ej. "regular" -> Helvetica); bold/italic combinan con esa
 * familia para resolver la variante real a incrustar — igual lógica se repite
 * como texto en el código exportado (ver buildFieldLoopSnippet) porque ese
 * código corre después, ya pegado en client.documents.mjs, sin acceso a estas
 * funciones del editor. */
const FONT_FAMILIES = {
  Helvetica: { regular: "Helvetica", bold: "HelveticaBold", italic: "HelveticaOblique", boldItalic: "HelveticaBoldOblique" },
  TimesRoman: { regular: "TimesRoman", bold: "TimesRomanBold", italic: "TimesRomanItalic", boldItalic: "TimesRomanBoldItalic" },
  Courier: { regular: "Courier", bold: "CourierBold", italic: "CourierOblique", boldItalic: "CourierBoldOblique" }
};
function fontFamilyOf(standardName) {
  for (const fam of Object.keys(FONT_FAMILIES)) if (Object.values(FONT_FAMILIES[fam]).includes(standardName)) return fam;
  return "Helvetica";
}
/* Las casillas Negrita/Cursiva SUMAN énfasis, nunca lo quitan: si el fontKey
 * ya apunta a una variante negrita (p. ej. constancia declara fonts.bold =
 * "TimesRomanBold"), dejar ambas casillas sin marcar debe seguir dando negrita
 * — de lo contrario, cualquier campo nuevo con fontKey "bold" se exportaría
 * en regular en cuanto alguien tocara este resolver, sin ninguna señal visual
 * de que se perdió el énfasis que el propio nombre de fontKey prometía. */
function resolveStandardFontName(baseName, bold, italic) {
  const table = FONT_FAMILIES[fontFamilyOf(baseName)];
  const baseIsBold = baseName === table.bold || baseName === table.boldItalic;
  const baseIsItalic = baseName === table.italic || baseName === table.boldItalic;
  const effBold = baseIsBold || !!bold;
  const effItalic = baseIsItalic || !!italic;
  return table[effBold && effItalic ? "boldItalic" : effBold ? "bold" : effItalic ? "italic" : "regular"];
}
function baseFontNameFor(doc, fontKey) {
  return doc?.fonts?.[fontKey] || Object.values(doc?.fonts || {})[0] || "Helvetica";
}

/* ---------------------------------------------------------------------
 * 3b. MÉTRICAS DE FUENTE — un PDFDocument liviano, sólo para medir texto
 *    (widthOfTextAtSize), usado para dimensionar las cajas del editor con
 *    el ancho real en vez de una estimación aproximada. Se incrustan las 14
 *    variantes estándar de una sola vez, así que resolver bold/italic aquí
 *    es sólo una búsqueda, sin re-incrustar nada.
 * ------------------------------------------------------------------- */
let metricFontsCache = null;
async function ensureMetricFonts() {
  if (metricFontsCache) return metricFontsCache;
  const metricDoc = await PDFLib.PDFDocument.create();
  const fonts = {};
  for (const name of Object.values(PDFLib.StandardFonts)) {
    try { fonts[name] = await metricDoc.embedFont(name); } catch { /* variante no soportada, se ignora */ }
  }
  metricFontsCache = fonts;
  return fonts;
}
/* Fuentes del cliente (archivos .ttf/.otf subidos en el editor): por huella
 * SHA-256 → { bytes, fk (fontkit), metric (fuente pdf-lib para medir), css,
 * noSubset }. Un campo las usa con field.fontFile = clave de
 * doc.customFonts. Sin el archivo cargado, el campo cae a su fuente estándar
 * (fontKey), que sigue siendo su respaldo. */
const customFonts = {};
function customFontFor(doc, field) {
  const ref = field?.fontFile && doc?.customFonts?.[field.fontFile];
  return ref ? customFonts[ref.sha256] || null : null;
}
/* Caracteres que la fuente de un campo no puede escribir: en una estándar,
 * lo que WinAnsi no codifica; en una del cliente, lo que su archivo no trae. */
function missingChars(doc, field, text) {
  const custom = customFontFor(doc, field);
  if (!custom?.fk) return unencodableChars(text);
  const bad = new Set();
  for (const ch of String(text ?? "").replace(/\s/g, "")) if (!custom.fk.hasGlyphForCodePoint(ch.codePointAt(0))) bad.add(ch);
  return [...bad];
}
function metricFontFor(doc, field) {
  const custom = customFontFor(doc, field);
  if (custom?.metric) return custom.metric;
  const resolved = resolveStandardFontName(baseFontNameFor(doc, field?.fontKey), !!field?.bold, !!field?.italic);
  return metricFontsCache?.[resolved] || metricFontsCache?.Helvetica || null;
}
/* Las 14 fuentes estándar de PDF sólo escriben el repertorio WinAnsi: con
 * cualquier otro carácter (emoji, flechas, "≥", alfabetos no latinos) pdf-lib
 * lanza "WinAnsi cannot encode" — al generar la vista previa real y también
 * al MEDIR texto aquí, lo que antes podía tumbar el Inspector o el preflight
 * completos. Se pregunta a la propia fuente de pdf-lib (fuente de verdad),
 * carácter por carácter, en vez de mantener una lista aparte. */
function unencodableChars(text) {
  const probe = metricFontsCache?.Helvetica;
  if (!probe) return [];
  const bad = new Set();
  for (const ch of String(text ?? "").replace(/[\r\n\t]/g, "")) {
    if (bad.has(ch)) continue;
    try { probe.widthOfTextAtSize(ch, 10); } catch { bad.add(ch); }
  }
  return [...bad];
}
/* Un salto de línea no es un carácter que la fuente pueda medir (pdf-lib
 * lanza "WinAnsi cannot encode \n"): se mide como el espacio en que lo
 * convierte clean(). Antes, un texto con Enter tumbaba el Inspector y, con
 * él, el guardado del borrador. */
const singleLine = text => String(text ?? "").replace(/[\r\n\t]+/g, " ");
function measureText(doc, field, text) {
  const font = metricFontFor(doc, field);
  const t = singleLine(text);
  if (!font || missingChars(doc, field, t).length) return t.length * (field.size || 11) * 0.55;
  let size = field.size || 11;
  if (field.fit && field.width) {
    while (size > 6 && font.widthOfTextAtSize(t, size) > field.width) size -= 0.4;
  }
  return font.widthOfTextAtSize(t, size);
}
function fittedSize(doc, field, text) {
  const font = metricFontFor(doc, field);
  const t = singleLine(text);
  let size = field.size || 11;
  if (!font || !field.width || missingChars(doc, field, t).length) return size;
  while (size > 6 && font.widthOfTextAtSize(t, size) > field.width) size -= 0.4;
  return Math.round(size * 100) / 100;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Vista previa de "qué parámetros exactos recibiría pdf-lib" para el campo
 * seleccionado — transparencia para el usuario, no altera nada al mostrarse. */
/* Fuente de dónde sale el valor, con la MISMA precedencia que resolveText()
 * y el código exportado (literalText > textTemplate > dataKey) — para que
 * "Resueltos" diga la verdad sobre qué está determinando el texto. */
function valueSourceFor(field) {
  if (field.literalText != null) return { literalText: field.literalText };
  if (field.textTemplate) return { textTemplate: field.textTemplate };
  return { dataKey: field.dataKey };
}
/* Transparencia real de "qué parámetros exactos recibiría pdf-lib" — debe
 * reflejar EXACTAMENTE el método y los argumentos que arma el código
 * exportado (buildFieldLoopSnippet) o el export a medida (EXPORT_BUILDERS)
 * para este campo, no una aproximación. Antes: siempre decía "drawText"
 * incluso para campos con "fit" (que en realidad llaman a drawFit con
 * maxLines/lineHeight/center — datos que ni siquiera se mostraban), y el
 * nombre de fuente no reflejaba negrita/cursiva. */
function resolvedParamsFor(doc, field) {
  const sample = doc.sample || {};
  const fontName = field.fontKey ? resolveStandardFontName(baseFontNameFor(doc, field.fontKey), !!field.bold, !!field.italic) : undefined;
  const color = field.colorHex || field.color;
  const opacity = !field.colorHex && field.color ? OPACITY[field.color] : undefined;
  if (field.type === "qr" || field.type === "image") {
    if (field.type === "image") {
      /* drawSignature() de producción SIEMPRE centra la imagen — no acepta
       * hAlign. La ÚNICA excepción real es "logo" en dc3, cuyo export a
       * medida la dibuja a mano en la izquierda (ver EXPORT_BUILDERS.dc3);
       * para cualquier otro campo bespoke (las firmas) hAlign="left" no
       * cambiaría nada en el PDF real aunque el preview de esta herramienta
       * sí lo muestre desplazado. Los campos genéricos SÍ lo respetan (ver
       * buildFieldLoopSnippet), así que ahí "left" es real. */
      const isBespokeKnown = !!(EXPORT_BUILDERS[doc.renderer] && KNOWN_FIELD_IDS[doc.renderer]?.has(field.id));
      const isBespokeLogo = doc.renderer === "dc3" && field.id === "logo";
      const hAlignApplies = isBespokeLogo || !isBespokeKnown;
      return {
        method: isBespokeLogo ? "drawImage (a medida, respeta hAlign — ver EXPORT_BUILDERS.dc3)"
          : hAlignApplies ? "embedImage + drawImage (respeta hAlign)"
          : "drawSignature (SIEMPRE centrada — hAlign no tiene efecto en este campo)",
        ...valueSourceFor(field),
        x: field.x, y: field.y, width: field.width, height: field.height,
        hAlign: hAlignApplies ? (field.hAlign || "center") : "center (fijo)"
      };
    }
    return { method: "embedImage + drawImage (QR)", ...valueSourceFor(field), x: field.x, y: field.y, width: field.width, height: field.height, frame: field.frame };
  }
  if (field.type === "characters") {
    return {
      method: "drawCharacters (drawText por carácter)", ...valueSourceFor(field),
      centers: field.centers, y: field.y, size: field.size, font: fontName,
      maxChars: field.centers.length, allowHyphen: !!field.allowHyphen, color
    };
  }
  if (field.type === "checkbox") {
    const raw = field.literalChecked != null ? field.literalChecked : (field.dataKey || "").split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), sample);
    const checked = field.literalChecked != null ? !!raw : (!!raw && raw !== "false" && raw !== "0");
    return {
      method: "drawRectangle" + (checked ? " + drawText (marcada)" : " (vacía)"),
      dataKey: field.dataKey, literalChecked: field.literalChecked,
      x: field.x, y: field.y, size: field.size, borderWidth: 1,
      checked, checkedGlyph: field.checkedGlyph || "X", font: fontName, color
    };
  }
  const text = resolveText(field, sample);
  const size = field.fit ? fittedSize(doc, field, text) : (field.size || 11);
  const width = metricFontsCache ? measureText(doc, { ...field, fit: false, size }, text) : null;
  const textWidth = width != null ? Math.round(width * 100) / 100 : null;
  if (field.role) {
    return { method: `fórmula especial ("${field.role}") — ver "Vista previa real"`, ...valueSourceFor(field), text, y: field.y, size, font: fontName, color };
  }
  if (field.fit) {
    /* drawFit() de producción no reenvía "opacity" a drawText (ver
     * config/client/client.documents.mjs) — mostrarlo aquí sería mentir
     * sobre un parámetro que el PDF final simplemente ignoraría. "lines"
     * son las llamadas a drawText que resultan (la misma maquetación que la
     * vista previa real), con el tamaño ya reducido de cada línea. */
    const layout = layoutTextField(doc, field, sample);
    return {
      method: "drawFit", ...valueSourceFor(field),
      x: field.x, y: field.y, width: field.width, size: field.size, font: fontName, color,
      maxLines: field.maxLines || 1, lineHeight: field.lineHeight || field.size + 1,
      align: field.align || "left",
      lines: layout.lines.map(l => ({ text: l.text, x: Math.round(l.x * 100) / 100, y: Math.round(l.y * 100) / 100, size: Math.round(l.size * 100) / 100 }))
    };
  }
  let x = field.x;
  if (field.align === "pageCenter") x = width != null ? Math.round((doc.page.width / 2 - width / 2) * 100) / 100 : "(centrado, ver preview real)";
  else if (field.align === "boxCenter" && field.width != null && width != null) x = Math.round((field.x + (field.width - width) / 2) * 100) / 100;
  else if (field.align === "boxRight" && field.width != null && width != null) x = Math.round((field.x + field.width - width) * 100) / 100;
  return { method: "drawText", ...valueSourceFor(field), text, x, y: field.y, size, font: fontName, color, opacity, textWidth };
}



function cloneDoc(doc) { return JSON.parse(JSON.stringify(doc)); }

/* ---- Páginas ----
 * doc.page es el tamaño de la PRIMERA página (el contrato de siempre, el que
 * usan los documentos de una sola página); doc.pages lista el tamaño de cada
 * página cuando el PDF tiene más de una. Un campo vive en field.page (índice
 * desde 0; ausente = primera página). pageView(doc, i) es el documento visto
 * desde la página i: mismo objeto con el tamaño de esa página, para que toda
 * la geometría (conversión UI↔PDF, centrado en página, límites del
 * preflight) use la página correcta sin duplicar cálculos. */
function pageCountOf(doc) { return Math.max(1, doc.pageCount || doc.pages?.length || 1); }
function pageSizeOf(doc, index) { return (index > 0 && doc.pages?.[index]) || doc.page; }
function pageView(doc, index) { return index > 0 && doc.pages?.[index] ? { ...doc, page: { width: doc.pages[index].width, height: doc.pages[index].height } } : doc; }
function fieldPage(field) { return field.page || 0; }

/* ---------------------------------------------------------------------
 * 5. PREFLIGHT — validaciones puras.
 * ------------------------------------------------------------------- */
function fieldBBox(doc, field) {
  if (field.type === "qr" || field.type === "image") return { x: field.x, y: field.y, w: field.width, h: field.height };
  if (field.type === "checkbox") return { x: field.x, y: field.y, w: field.size, h: field.size };
  if (field.type === "characters") { const xs = field.centers; return { x: Math.min(...xs) - field.size, y: field.y, w: Math.max(...xs) - Math.min(...xs) + field.size * 2, h: field.size * 1.3 }; }
  const lines = field.maxLines || 1; const lh = field.lineHeight || field.size + 1;
  const h = field.size + lh * (lines - 1) + 3;
  const y = field.y - lh * (lines - 1);
  /* Los campos con "role" (p. ej. carta.municipioAutoSplit) tienen su propia
   * lógica de desbordamiento en tiempo real (auto-división en dos líneas) que
   * este cálculo genérico no reproduce — para ésos se mantiene la caja
   * "ilimitada" (w:99999, la misma sentinela que el overlap/fuera-de-página
   * ya ignoran) en vez de arriesgar falsos positivos contra un campo que en
   * producción nunca se desborda. Un "pageCenter" simple sin role (p. ej. el
   * "nombre" centrado de constancia) no tiene ese salvavidas: si el dato de
   * muestra es largo de verdad se saldría o se superpondría, así que aquí sí
   * se mide con el ancho real del texto resuelto — antes esto también se
   * saltaba con la sentinela, y una superposición real por dato de muestra
   * largo nunca se detectaba antes de exportar. */
  if (field.role) return { x: 0, y, w: 99999, h };
  if (field.align === "pageCenter") {
    const sampleText = resolveText(field, doc.sample || {});
    const approxWidth = metricFontsCache ? measureText(doc, field, sampleText) : sampleText.length * field.size * 0.55;
    return { x: doc.page.width / 2 - approxWidth / 2, y, w: approxWidth, h };
  }
  /* Un campo de texto simple (sin "fit" ni ancho declarado) no tiene una caja
   * fija: se mide con las mismas métricas de fuente que usa el editor, en vez
   * de una anchura fija arbitraria, para que el overlap detectado sea real. */
  const w = field.width != null ? field.width : (metricFontsCache ? measureText(doc, field, resolveText(field, doc.sample || {})) : 120);
  return { x: field.x ?? 0, y, w, h };
}
function intersects(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
/* QR de SafeAutentic: URL de verificación firmada (referencia + fecha + firma
 * ECDSA de 86 caracteres, ~160–180 bytes) → QR versión 8–9, hasta 53 módulos,
 * más el margen blanco de 1 módulo por lado que ya trae la imagen
 * (QRCode.toCanvas margin 1 en la constancia; lienzo de 280 px con borde de
 * 10 px en las cartas). */
const QR_MODULES = 55;
const QR_MIN_SIDE = 56.7;       // 2 cm → ≈0.37 mm por módulo
const PRINT_MARGIN = 14.17;     // 5 mm: franja que muchas impresoras no imprimen
const INK_DARK = 110;           // gris (0–255) por debajo del cual un píxel es tinta
const INK_TEXT_LIMIT = 0.07;    // tinta bajo un texto que ya es un choque visible
const mmOf = pt => Math.round(pt / 72 * 254) / 10;
/* Luminancia relativa y contraste (WCAG) entre dos colores [r, g, b] 0–1. */
function luminance(rgb) {
  const lin = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}
function contrastRatio(a, b) { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); }
function rgbOfStyle(obj, fallback) {
  if (obj?.colorHex) { const h = String(obj.colorHex).replace("#", ""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255); }
  return NAMED_COLOR_RGB[obj?.color] || fallback;
}
/* Lo que ocupa de verdad un QR: su caja más marco, insignia y textos, medidos
 * con el mismo motor que los dibuja (qrFramePrimitives). */
function qrExtent(doc, field) {
  const box = { x: field.x, y: field.y, width: field.width, height: field.height };
  const prims = qrFramePrimitives(box, field.frame, { top: field.captionTop, bottom: field.captionBottom });
  let x0 = box.x, y0 = box.y, x1 = box.x + box.width, y1 = box.y + box.height;
  const grow = (a, b, c, d) => { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); };
  for (const p of [...prims.under, ...prims.over]) {
    const h = (p.lw || 0) / 2;
    if (p.t === "rect") grow(p.x - h, p.y - h, p.x + p.w + h, p.y + p.h + h);
    else if (p.t === "line") grow(Math.min(p.x1, p.x2) - h, Math.min(p.y1, p.y2) - h, Math.max(p.x1, p.x2) + h, Math.max(p.y1, p.y2) + h);
    else if (p.t === "text" && p.text) {
      const w = safeWidth(metricFontFor(doc, p.font), p.text, p.size);
      grow(p.cx - w / 2, p.y - p.size * TEXT_DESCENT, p.cx + w / 2, p.y + p.size * TEXT_ASCENT);
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/* Tinta del formato impreso dentro de un rectángulo (puntos PDF, "y" hacia
 * arriba) de la página rasterizada. Los trazos horizontales más largos que
 * "ruleRun" píxeles son reglas (renglones para escribir, bordes de tabla) que
 * un dato pisa a propósito: no cuentan. Devuelve píxeles oscuros y totales,
 * para poder sumar varias líneas de un mismo campo. */
function inkCoverage(raster, page, rect, ruleRun = Infinity, masks = [], paperGray = 255) {
  const sx = raster.width / page.width, sy = raster.height / page.height;
  /* Los parches tapan el texto de ejemplo: sus píxeles no cuentan como tinta. */
  const hidden = masks.map(m => ({ x0: Math.floor(m.x * sx), x1: Math.ceil((m.x + m.width) * sx), y0: Math.floor((page.height - m.y - m.height) * sy), y1: Math.ceil((page.height - m.y) * sy) }));
  const isHidden = (x, y) => hidden.some(h => x >= h.x0 && x < h.x1 && y >= h.y0 && y < h.y1);
  const px0 = Math.max(0, Math.floor(rect.x0 * sx)), px1 = Math.min(raster.width, Math.ceil(rect.x1 * sx));
  const py0 = Math.max(0, Math.floor((page.height - rect.y1) * sy)), py1 = Math.min(raster.height, Math.ceil((page.height - rect.y0) * sy));
  if (px1 - px0 < 2 || py1 <= py0) return { dark: 0, total: 0 };
  let dark = 0;
  for (let y = py0; y < py1; y++) {
    let run = 0;
    for (let x = px0, i = y * raster.width + px0; x <= px1; x++, i++) {
      if (x < px1 && Math.abs(raster.gray[i] - paperGray) > 255 - INK_DARK && !(hidden.length && isHidden(x, y))) { run++; continue; }
      if (run < ruleRun) dark += run;
      run = 0;
    }
  }
  return { dark, total: (px1 - px0) * (py1 - py0) };
}
/* Severidad de cada hallazgo:
 *  error — el PDF saldría mal o fallaría (fuera de página, carácter que la
 *          fuente no escribe, geometría inválida, página inexistente);
 *  warn  — probablemente un defecto (texto recortado, casillas encimadas,
 *          campo sin dato, QR que no se leería, texto encima del formato);
 *  info  — puede ser intencional (superposiciones, falta un valor de muestra,
 *          cerca del borde).
 * Sólo error/warn detienen la exportación para confirmarla. "fix" (opcional)
 * describe un arreglo de un clic que la interfaz sabe aplicar.
 *
 * env.rasterFor(página) → { gray, width, height } | null: la página del
 * formato rasterizada en grises, para las revisiones de tinta. Sin ella (en
 * pruebas, o mientras se decodifica) esas revisiones se omiten. */
function runPreflight(doc, env = {}) {
  const warnings = preflightOnce(doc, env);
  /* De los demás juegos de datos, sólo lo que cambia con SUS valores,
   * marcado con el nombre del juego: un nombre largo que sólo existe en
   * «Textos largos» y desborda o se encima es justo lo que hay que ver antes
   * de exportar. Que a un juego le falte un valor de muestra sería ruido. */
  const seen = new Set(warnings.map(w => w.fieldId + "|" + w.message));
  for (const [name, data] of Object.entries(doc.datasets || {})) {
    for (const w of preflightOnce({ ...doc, sample: data || {} }, env)) {
      const key = w.fieldId + "|" + w.message;
      if (w.fix?.kind === "sample" || seen.has(key)) continue;
      seen.add(key);
      warnings.push({ ...w, dataset: name });
    }
  }
  return warnings;
}
function preflightOnce(doc, env) {
  const warnings = [];
  const add = (severity, type, field, message, fix) => warnings.push({ severity, type, fieldId: field.id, message, ...(fix ? { fix } : {}) });
  const pageCount = pageCountOf(doc);
  const sample = doc.sample || {};
  const valueAt = path => String(path || "").split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), sample);
  /* Geometría imposible antes que nada: sin ella no hay caja que medir. */
  const invalid = new Set();
  for (const f of doc.fields) {
    const bad = f.type === "characters" ? !f.centers?.length || f.centers.some(c => !Number.isFinite(c))
      : (f.type === "qr" || f.type === "image") ? !(f.width > 0 && f.height > 0)
      : !(f.size > 0) || (f.width != null && !(f.width > 0));
    if (bad || !Number.isFinite(f.y)) { invalid.add(f); add("error", "off-page", f, `"${f.id}" tiene medidas inválidas (tamaño, ancho o casillas en cero o vacíos)`); }
  }
  /* Cada caja se mide contra SU página (tamaño y centro pueden variar). El
   * QR, con su marco y sus textos: es lo que de verdad se imprime. */
  const boxes = doc.fields.filter(f => !invalid.has(f)).map(f => {
    const view = pageView(doc, fieldPage(f));
    return { field: f, box: f.type === "qr" ? qrExtent(view, f) : fieldBBox(view, f) };
  });
  for (const { field, box } of boxes) {
    if (fieldPage(field) >= pageCount) {
      add("error", "off-page", field, `"${field.id}" está en la página ${fieldPage(field) + 1}, pero el PDF sólo tiene ${pageCount}`,
        { kind: "toPage", value: pageCount - 1, label: `Mover a la página ${pageCount}` });
      continue;
    }
    const size = pageSizeOf(doc, fieldPage(field));
    const skipHorizontal = box.w > 9000;
    const outOfBounds = box.y < -1 || box.y + box.h > size.height + 1 || (!skipHorizontal && (box.x < -1 || box.x + box.w > size.width + 1));
    if (outOfBounds) {
      add("error", "off-page", field, `"${field.id}"${field.type === "qr" && field.frame?.enabled ? " (con su marco)" : ""} queda fuera de la página${pageCount > 1 ? " " + (fieldPage(field) + 1) : ""}`,
        offPageFix(doc, field, box, size));
    } else if (box.y < PRINT_MARGIN || box.y + box.h > size.height - PRINT_MARGIN || (!skipHorizontal && (box.x < PRINT_MARGIN || box.x + box.w > size.width - PRINT_MARGIN))) {
      add("info", "margin", field, `"${field.id}" queda a menos de 5 mm del borde: muchas impresoras no imprimen esa franja`);
    }
    if (field.mask) {
      const m = field.mask;
      if (!(m.width > 0 && m.height > 0) || m.x < -1 || m.y < -1 || m.x + m.width > size.width + 1 || m.y + m.height > size.height + 1) {
        add("warn", "off-page", field, `El parche que tapa el texto original de "${field.id}" queda fuera de la página o no tiene tamaño`);
      }
    }
    if (field.type === "characters" && field.centers.some((c, i) => i > 0 && c < field.centers[i - 1])) {
      add("warn", "geometry", field, `"${field.id}" tiene centros de caracteres fuera de orden`);
    }
    /* CURP/RFC en producción tienen longitud exacta (18 / 13-14 con guiones);
     * un valor de muestra más largo que "centers" no truncaría el dato real
     * (el dato ya viene con la longitud correcta desde el formulario), pero sí
     * avisa aquí de un desajuste real entre el campo y sus centros de caracter
     * antes de exportar — la misma limpieza que aplica layoutCharacters. */
    if (field.type === "characters") {
      const cleaned = cleanCharactersValue(resolveText(field, doc.sample || {}), field.allowHyphen);
      if (cleaned.length > field.centers.length) {
        add("warn", "geometry", field, `"${field.id}" tiene ${cleaned.length} caracteres válidos en su dato de muestra pero sólo ${field.centers.length} espacios — se recortaría a "${cleaned.slice(0, field.centers.length)}"`);
      }
      /* Cada carácter se centra en su casilla: si el más ancho del dato de
       * muestra mide más que la separación mínima entre centros, invade la
       * casilla vecina. */
      const font = metricFontFor(doc, field);
      if (font && cleaned && field.centers.length > 1) {
        const minGap = Math.min(...field.centers.slice(1).map((c, i) => c - field.centers[i]));
        const widest = Math.max(...[...cleaned.slice(0, field.centers.length)].map(ch => font.widthOfTextAtSize(ch, field.size)));
        if (minGap > 0 && widest > minGap * 0.95) {
          const fitSize = Math.floor(field.size * minGap * 0.9 / widest * 2) / 2;
          add("warn", "geometry", field, `"${field.id}": su carácter más ancho mide ${fmtNum(Math.round(widest * 10) / 10)} pt y la casilla más angosta ${fmtNum(Math.round(minGap * 10) / 10)} pt — los caracteres se encimarían. Reduce "Tamaño de fuente".`,
            fitSize >= 5 ? { kind: "size", value: fitSize, label: `Reducir a ${fmtNum(fitSize)} pt` } : null);
        }
      }
    }
    /* drawFit() de producción reduce la fuente hasta un piso de 6pt y, si aun
     * así el texto no cabe, lo dibuja igual desbordando la caja — y si el
     * párrafo envuelve a más líneas que "maxLines", las líneas de más se
     * pierden en silencio (nunca se dibujan). Este mapeador reproduce ese
     * mismo comportamiento a propósito (fidelidad con producción), pero antes
     * no había ninguna señal de que eso estuviera pasando con el dato de
     * muestra actual — el usuario sólo lo habría descubierto viendo el PDF
     * final ya en producción. */
    /* Textos que realmente se escriben con una fuente estándar: el valor del
     * campo (texto) y los textos fijos que lo acompañan (captions del QR,
     * glifo de la casilla). "characters" ya limpia a A-Z0-9/guion. */
    const writtenTexts = field.type === "text" ? [resolveText(field, doc.sample || {})]
      : field.type === "qr" ? [field.captionTop?.text, field.captionBottom?.text]
      : field.type === "checkbox" ? [field.checkedGlyph || "X"] : [];
    const custom = field.type === "text" ? customFontFor(doc, field) : null;
    const badChars = [...new Set(writtenTexts.flatMap(t => (field.type === "text" ? missingChars(doc, field, t) : unencodableChars(t))))];
    if (badChars.length && custom) {
      add("error", "encoding", field, `"${field.id}": la fuente ${doc.customFonts[field.fontFile].family} no trae ${badChars.map(c => "«" + c + "»").join(" ")} — se imprimiría un recuadro vacío. Usa otra fuente o cambia el texto.`);
    } else if (badChars.length) {
      add("error", "encoding", field, `"${field.id}" contiene carácter(es) que las fuentes estándar del PDF no pueden escribir: ${badChars.map(c => "«" + c + "»").join(" ")} — la vista previa real y el PDF final fallarían. Cámbialos en el texto o en "Datos de muestra".`);
    }
    if (field.fontFile && !doc.customFonts?.[field.fontFile]) {
      add("warn", "font", field, `"${field.id}" usa una fuente del cliente que ya no está en el documento — se dibujará con su fuente estándar`);
    }
    if (field.type === "text" && field.fit && field.width && !badChars.length) {
      const font = metricFontFor(doc, field);
      const text = resolveText(field, doc.sample || {});
      if (font && text.trim()) {
        const maxLines = field.maxLines || 1;
        const wrapped = wrapTextWithBreaks(text, font, field.size, field.width);
        if (wrapped.length > maxLines) {
          add("warn", "overflow", field, `"${field.id}" necesita ${wrapped.length} líneas para el texto de muestra pero "Máx. líneas" es ${maxLines} — el resto se recortaría en silencio: "${wrapped.slice(maxLines).join(" / ")}"`,
            { kind: "maxLines", value: wrapped.length, label: `Usar ${wrapped.length} líneas` });
        }
        const longest = wrapped.slice(0, maxLines).reduce((a, b) => (b.length > a.length ? b : a), "");
        if (longest) {
          let fs = field.size;
          while (fs > 6 && font.widthOfTextAtSize(longest, fs) > field.width) fs -= 0.4;
          if (fs <= 6 && font.widthOfTextAtSize(longest, fs) > field.width) {
            add("warn", "overflow", field, `"${field.id}" no cabe ni reduciendo la fuente al mínimo (6pt) con el texto de muestra actual — se dibujaría desbordando la caja. Acorta el texto o agranda "Ancho".`);
          }
        }
      }
    }
    /* Dato: un campo sin fuente de valor no imprime nada; uno cuya clave no
     * tiene valor de muestra se ve vacío en la vista previa. */
    if ((field.type === "text" || field.type === "characters") && field.literalText == null && !field.textTemplate && !field.dataKey) {
      add("warn", "binding", field, `"${field.id}" no tiene clave de datos, texto fijo ni plantilla: no imprimirá nada`);
    } else if ((field.type === "text" || field.type === "characters") && field.literalText == null && !field.textTemplate && valueAt(field.dataKey) == null) {
      add("info", "binding", field, `"${field.id}": su clave "${field.dataKey}" no tiene valor en los datos de muestra — la vista previa lo muestra vacío`,
        { kind: "sample", label: "Poner un ejemplo" });
    }
    if (field.type === "qr") preflightQr(field, add);
    if ((field.type === "text" || field.type === "characters") && field.size < 5) {
      add("warn", "geometry", field, `"${field.id}" usa ${fmtNum(field.size)} pt: muy pequeño para leerse impreso`,
        { kind: "size", value: 6, label: "Subir a 6 pt" });
    }
    /* Un texto que no ajusta su tamaño (sin "fit") y no cabe en la caja que
     * se le dio se sale de ella — con el dato de muestra de cada juego. */
    if (field.type === "text" && field.shrink && field.width > 0 && !badChars.length) {
      const font = metricFontFor(doc, field), text = cleanText(resolveText(field, sample));
      if (text) {
        let fs = field.size;
        const floor = Math.min(6, field.size * 0.8);
        while (fs > floor && safeWidth(font, text, fs) > field.width) fs -= 0.4;
        if (safeWidth(font, text, fs) > field.width + 0.5) {
          add("warn", "overflow", field, `"${field.id}" no cabe en su caja ni reduciendo la fuente a ${fmtNum(Math.round(floor * 10) / 10)} pt — agranda la caja o usa varias líneas`,
            field.size > 6 ? { kind: "twoLines", label: "Usar 2 líneas" } : null);
        } else if (fs < field.size * 0.5) {
          /* Cabe, pero a menos de la mitad de su tamaño ya no se lee bien impreso. */
          add("warn", "overflow", field, `"${field.id}" tendría que reducirse de ${fmtNum(field.size)} a ${fmtNum(Math.round(fs * 10) / 10)} pt para caber en una línea: difícil de leer impreso`,
            { kind: "twoLines", label: "Usar 2 líneas" });
        } else if (fs < field.size * 0.75) {
          add("info", "overflow", field, `"${field.id}" se reduce de ${fmtNum(field.size)} a ${fmtNum(Math.round(fs * 10) / 10)} pt para caber en una línea`);
        }
      }
    }
    if (field.type === "text" && !field.fit && !field.shrink && field.width > 0 && field.align !== "pageCenter" && !field.role && !badChars.length) {
      const font = metricFontFor(doc, field), text = cleanText(resolveText(field, sample));
      const w = text ? safeWidth(font, text, field.size) : 0;
      if (w > field.width + 0.5) {
        add("warn", "overflow", field, `"${field.id}" mide ${fmtNum(Math.round(w * 10) / 10)} pt con el texto de muestra y su caja ${fmtNum(field.width)} pt: se sale de la caja`,
          { kind: "fitWidth", x: field.x, width: field.width, align: field.align || "left", lines: 1, label: "Reducir el texto para que quepa" });
      }
    }
    /* Un dato encima de un texto de la plantilla que nadie tapó: los dos se
     * imprimirían uno sobre otro. env.pdfTextFor(página) = textos del PDF;
     * sólo para campos que dibuja el código genérico. */
    const templateText = field.type === "text" && !(EXPORT_BUILDERS[doc.renderer] && KNOWN_FIELD_IDS[doc.renderer]?.has(field.id)) ? env.pdfTextFor?.(fieldPage(field)) : null;
    let textClash = false;
    if (templateText?.length) {
      const lay = layoutTextField(pageView(doc, fieldPage(field)), field, sample);
      const masks = doc.fields.filter(o => o.mask && fieldPage(o) === fieldPage(field)).map(o => o.mask);
      const covered = b => masks.some(m => b.x0 >= m.x - 0.5 && b.x1 <= m.x + m.width + 0.5 && b.y0 >= m.y - 0.5 && b.y1 <= m.y + m.height + 0.5);
      const hits = templateText.filter(r => !covered(r.box) && !isRemovedSourceText(field, r) && lay.lines.some(l => {
        if (!l.text) return false;
        const x0 = l.x, x1 = l.x + safeWidth(lay.font, l.text, l.size), y0 = l.y - l.size * 0.2, y1 = l.y + l.size * 0.7;
        return Math.min(x1, r.box.x1) - Math.max(x0, r.box.x0) > 2 && Math.min(y1, r.box.y1) - Math.max(y0, r.box.y0) > Math.min(l.size, r.size) * 0.3;
      }));
      if (hits.length) {
        textClash = true;
        add("warn", "ink", field, `"${field.id}" se imprime encima de «${hits[0].text}»${hits.length > 1 ? ` y ${hits.length - 1} texto(s) más` : ""} de la plantilla — tápalo o mueve el campo`,
          { kind: "mask", boxes: hits.map(r => r.box), label: "Tapar el texto de la plantilla" });
      }
    }
    const raster = env.rasterFor?.(fieldPage(field));
    if (raster && !textClash) preflightInk(pageView(doc, fieldPage(field)), field, raster, add);
    if (field.type === "text" && field.textTemplate) {
      const tokens = [...String(field.textTemplate).matchAll(/\{([\w.]+)\}/g)].map(m => m[1]);
      const unresolved = tokens.filter(path => path.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), sample) == null);
      if (unresolved.length) {
        add("info", "geometry", field, `"${field.id}" tiene variable(s) sin dato de muestra: ${unresolved.map(t => "{" + t + "}").join(", ")} — agrégalas en "Datos de muestra" para ver el preview real`,
          { kind: "sample", label: "Poner ejemplos" });
      }
      const stray = String(field.textTemplate).replace(/\{[\w.]+\}/g, "");
      if (stray.includes("{") || stray.includes("}")) {
        add("warn", "geometry", field, `"${field.id}" tiene llaves { } sin cerrar o mal escritas en su plantilla`);
      }
    }
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    if (boxes[i].box.w > 9000 || boxes[j].box.w > 9000) continue;
    if (fieldPage(boxes[i].field) !== fieldPage(boxes[j].field)) continue; // en páginas distintas nunca se tocan
    if (intersects(boxes[i].box, boxes[j].box)) add("info", "overlap", boxes[i].field, `"${boxes[i].field.id}" se superpone con "${boxes[j].field.id}"`);
  }
  return warnings;
}
/* «Arreglar todo lo seguro»: los arreglos que no requieren criterio. Usar 2
 * líneas sólo si el párrafo resultante no choca con otro campo ni con texto
 * de la plantilla sin tapar; mover, cambiar colores o el QR, nunca. */
const SAFE_FIX_KINDS = new Set(["sample", "maxLines", "fitWidth", "size", "twoLines"]);
function twoLinesCollides(doc, f, runs = []) {
  const lh = Math.round(f.size * 1.15 * 100) / 100, y = f.y + lh / 2;
  const box = { x0: f.x, x1: f.x + (f.width || 0), y0: y - lh - f.size * 0.25, y1: y + f.size * 0.8 };
  const hit = b => b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0;
  for (const o of doc.fields) {
    if (o === f || fieldPage(o) !== fieldPage(f)) continue;
    const b = fieldBBox(pageView(doc, fieldPage(o)), o);
    if (b.w > 9000) continue;
    if (hit({ x0: b.x, x1: b.x + b.w, y0: b.y, y1: b.y + b.h })) return true;
  }
  const masks = doc.fields.filter(o => o.mask && fieldPage(o) === fieldPage(f)).map(o => o.mask);
  const covered = r => masks.some(m => r.box.x0 >= m.x - 0.5 && r.box.x1 <= m.x + m.width + 0.5 && r.box.y0 >= m.y - 0.5 && r.box.y1 <= m.y + m.height + 0.5);
  return runs.some(r => !covered(r) && !isRemovedSourceText(f, r) && hit(r.box));
}
function planSafeFixes(doc, warnings, runsFor = () => []) {
  const seen = new Set(), out = [];
  for (const w of warnings) {
    if (!w.fix || !SAFE_FIX_KINDS.has(w.fix.kind)) continue;
    const key = w.fieldId + "|" + w.fix.kind;
    if (seen.has(key)) continue;
    const f = doc.fields.find(x => x.id === w.fieldId);
    if (!f || (w.fix.kind === "twoLines" && twoLinesCollides(doc, f, runsFor(fieldPage(f)) || []))) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}
/* Arreglo para algo fuera de la página. Un texto que se sale por la derecha
 * es un dato demasiado largo: moverlo descuadraría los datos normales, así
 * que se ajusta al ancho disponible (reduce o envuelve, con las líneas que
 * pide el dato que lo provocó). Un campo original de constancia/dc3/carta no
 * lo ofrece: su export a medida no transmitiría el ajuste (queda como aviso
 * para la IA). Lo demás se mete en la página, si cabe. */
function offPageFix(doc, field, box, size) {
  /* Demasiado largo: sólo el ancho se sale (por la derecha o, centrado en la
   * página, por los dos lados). */
  const tooLong = box.y >= -1 && box.y + box.h <= size.height + 1 && box.x + box.w > size.width + 1 && (box.x >= -1 || field.align === "pageCenter");
  if (field.type === "text" && tooLong) {
    const bespoke = !!(EXPORT_BUILDERS[doc.renderer] && KNOWN_FIELD_IDS[doc.renderer]?.has(field.id));
    if (bespoke || field.role || field.fit || box.w > 9000) return null;
    const margin = Math.ceil(PRINT_MARGIN);
    const centered = field.align === "pageCenter";
    const x = centered ? margin : field.x;
    if (x == null || x > size.width - 3 * margin) return null;
    const width = Math.round((size.width - margin - x) * 100) / 100;
    const lines = Math.max(1, wrapSafe(resolveText(field, doc.sample || {}), metricFontFor(doc, field), field.size, width).length);
    return { kind: "fitWidth", x, width, lines, align: centered ? "boxCenter" : field.align || "left",
      label: lines > 1 ? `Ajustar al ancho (${lines} líneas)` : "Ajustar al ancho disponible" };
  }
  return box.h <= size.height && (box.w > 9000 || box.w <= size.width) ? { kind: "intoPage", label: "Meter en la página" } : null;
}
/* QR: que se lea (tamaño por módulo, cuadrado, margen claro) y que sus textos
 * se vean (contraste contra el papel o contra la banda de la insignia). */
function preflightQr(field, add) {
  const side = Math.min(field.width, field.height);
  if (side < QR_MIN_SIDE) {
    add("warn", "qr", field, `"${field.id}" mide ${fmtNum(mmOf(side) / 10)} cm: con la URL firmada de SafeAutentic (~53 módulos) cada módulo mediría ≈${fmtNum(Math.round(mmOf(side) / QR_MODULES * 100) / 100)} mm. Con menos de 2 cm muchos teléfonos no lo leen.`,
      { kind: "qrSize", value: QR_MIN_SIDE, label: "Agrandar a 2 cm" });
  }
  if (Math.abs(field.width - field.height) > Math.max(field.width, field.height) * 0.08) {
    add("warn", "qr", field, `"${field.id}" no es cuadrado (${fmtNum(field.width)} × ${fmtNum(field.height)} pt): el QR se dibujaría deformado`,
      { kind: "qrSquare", label: "Hacerlo cuadrado" });
  }
  const fr = field.frame || {};
  const badge = fr.enabled && fr.style === "badge";
  if (fr.enabled && fr.background && luminance(rgbOfStyle({ colorHex: fr.background }, [1, 1, 1])) < 0.3) {
    add("warn", "qr", field, `El fondo de "${field.id}" es oscuro: alrededor del QR debe quedar un margen claro para que los teléfonos lo detecten`,
      { kind: "qrBackground", label: "Fondo blanco" });
  }
  for (const [slot, where] of [["captionTop", "de arriba"], ["captionBottom", "de abajo"]]) {
    const c = field[slot];
    const onBand = badge && slot === "captionBottom";
    if (!c?.text && !onBand) continue;
    /* Sin texto propio, la insignia escribe «ESCANÉAME» en blanco. */
    const color = onBand && !c?.text ? [1, 1, 1] : rgbOfStyle(c, onBand ? [1, 1, 1] : NAMED_COLOR_RGB.gray);
    const behind = onBand ? rgbOfStyle(fr, [0, 0, 0]) : [1, 1, 1];
    if (contrastRatio(color, behind) >= 2.2) continue;
    add("warn", "qr", field, onBand ? `El texto de la insignia de "${field.id}" casi no contrasta con el color de la insignia` : `El texto ${where} de "${field.id}" casi no se ve sobre el papel blanco`,
      { kind: "captionColor", slot, value: onBand ? (luminance(behind) < 0.4 ? "#ffffff" : "#000000") : "#333333", label: "Corregir color" });
  }
}
/* Contra el formato impreso (página rasterizada): un texto encima de texto o
 * trazos del formato, un QR que tapa contenido o con trazos pegados. */
function preflightInk(view, field, raster, add) {
  const scale = raster.width / view.page.width;
  const masks = (view.fields || []).filter(o => o.mask && fieldPage(o) === fieldPage(field)).map(o => o.mask);
  if (field.type === "text" || field.type === "characters") {
    const lay = field.type === "text" ? layoutTextField(view, field, view.sample || {}) : layoutCharacters(view, field, view.sample || {});
    /* Un dato sobre un fondo de color (el sello azul de «AGOSTO») lleva su
     * máscara de ese color: ese fondo es su papel, no tinta del formato. */
    const own = field.mask?.colorHex ? rgbOfStyle(field.mask, [1, 1, 1]) : null;
    const paperGray = own ? Math.round(255 * (0.299 * own[0] + 0.587 * own[1] + 0.114 * own[2])) : 255;
    let dark = 0, total = 0;
    for (const l of lay.lines) {
      if (!l.text || !l.text.trim()) continue;
      /* Franja del cuerpo de la letra (sin ascendentes ni descendentes): ahí
       * un renglón o una regla bajo el texto no cuentan, un texto impreso sí. */
      const c = inkCoverage(raster, view.page, { x0: l.x, x1: l.x + safeWidth(lay.font, l.text, l.size), y0: l.y + l.size * 0.12, y1: l.y + l.size * 0.62 }, Math.max(6, l.size * 1.5 * scale), masks, paperGray);
      dark += c.dark; total += c.total;
    }
    if (total && dark / total > INK_TEXT_LIMIT) {
      add("warn", "ink", field, `"${field.id}" se imprime encima de texto o trazos del formato (≈${Math.round(dark / total * 100)} % de su área) — muévelo a un espacio libre`);
    }
  } else if (field.type === "qr") {
    const box = { x0: field.x, x1: field.x + field.width, y0: field.y, y1: field.y + field.height };
    const inside = inkCoverage(raster, view.page, box);
    if (inside.total && inside.dark / inside.total > 0.03) {
      add("warn", "ink", field, `"${field.id}" tapa contenido impreso del formato (texto o líneas) — muévelo a un espacio libre`);
    }
    /* Zona silenciosa: 2 módulos libres alrededor. Un fondo propio o la
     * insignia ya la cubren con su panel claro. */
    const fr = field.frame || {};
    if (fr.enabled && (fr.background || fr.style === "badge")) return;
    const m = 2 * Math.min(field.width, field.height) / QR_MODULES;
    const outer = inkCoverage(raster, view.page, { x0: box.x0 - m, x1: box.x1 + m, y0: box.y0 - m, y1: box.y1 + m });
    const ringDark = outer.dark - inside.dark, ringTotal = outer.total - inside.total;
    if (ringTotal > 0 && ringDark / ringTotal > 0.06) {
      add("warn", "ink", field, `Hay trazos del formato pegados a "${field.id}": deja ≈${fmtNum(mmOf(m))} mm libres alrededor para que los teléfonos lo detecten`);
    }
  }
}

/* ---------------------------------------------------------------------
 * 6. EXPORT — texto listo para copiar/pegar. Nunca escribe a disco.
 * ------------------------------------------------------------------- */
function fmtNum(n) { return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000); }
function fmtCenters(arr) { return "[" + arr.map(fmtNum).join(", ") + "]"; }

/* Estilo por campo en los export a medida: fuente (fontKey + negrita/cursiva),
 * color y alineación se resuelven POR CAMPO para que todo lo que el Inspector
 * deja editar llegue al texto exportado — antes varias de esas elecciones
 * cambiaban la vista previa pero el export seguía con fuentes/colores fijos, y
 * la IA que recibe ese texto nunca se enteraba del cambio. Para no ensuciar el
 * texto con renombres, cada fuente/color reutiliza la variable que el render
 * original ya declara (font/bold/mono, black/gray) y sólo se agrega una línea
 * nueva cuando un campo pide una variante que el render no tenía. */
const BESPOKE_BASE_FONTS = {
  constancia: { TimesRomanBold: "font", Courier: "mono" },
  dc3: { Helvetica: "font", HelveticaBold: "bold" },
  carta: { Helvetica: "font", HelveticaBold: "bold" }
};
const BESPOKE_BASE_COLORS = { constancia: ["black", "gray"], dc3: ["black"], carta: ["black"] };
const NAMED_COLOR_RGB = { black: [0, 0, 0], gray: [0.2, 0.2, 0.2], white: [1, 1, 1], whiteFaint90: [1, 1, 1], whiteFaint80: [1, 1, 1] };
function colorLiteral(obj) {
  if (obj?.colorHex) {
    const hex = obj.colorHex.replace("#", "");
    const ch = i => fmtNum(parseInt(hex.slice(i, i + 2), 16) / 255);
    return `pdfLib.rgb(${ch(0)}, ${ch(2)}, ${ch(4)})`;
  }
  const c = NAMED_COLOR_RGB[obj?.color] || NAMED_COLOR_RGB.black;
  return `pdfLib.rgb(${c.join(", ")})`;
}
function bespokeStyle(doc) {
  const baseFonts = BESPOKE_BASE_FONTS[doc.renderer] || {};
  const baseColors = BESPOKE_BASE_COLORS[doc.renderer] || [];
  const extra = {};
  const fontVar = field => {
    const std = resolveStandardFontName(baseFontNameFor(doc, field?.fontKey), !!field?.bold, !!field?.italic);
    if (baseFonts[std]) return baseFonts[std];
    extra[std] = "font" + std;
    return extra[std];
  };
  return {
    fontVar,
    /* "font" a secas (shorthand) cuando la variable ya se llama así — igual
     * que escribe el render original. */
    fontArg: field => { const v = fontVar(field); return v === "font" ? "font" : "font: " + v; },
    color: field => (!field?.colorHex && baseColors.includes(field?.color || "black")) ? (field?.color || "black") : colorLiteral(field),
    /* Llamar DESPUÉS de armar el cuerpo: sólo entonces se sabe qué variantes
     * extra pidió algún campo. */
    extraFontLines: () => Object.entries(extra).map(([std, v]) => `\n  const ${v} = await pdfDoc.embedFont(pdfLib.StandardFonts.${std});`).join("")
  };
}
/* X de un drawText simple según su alineación — misma fórmula que la vista
 * previa (renderDocumentPreview) y que el loop genérico exportado. */
function alignedXExpr(field, fontVar, textExpr, pageWidthExpr) {
  if (field.align === "pageCenter") return `${pageWidthExpr} / 2 - ${fontVar}.widthOfTextAtSize(${textExpr}, ${fmtNum(field.size)}) / 2`;
  if (field.align === "boxCenter" && field.width != null) return `${fmtNum(field.x)} + (${fmtNum(field.width)} - ${fontVar}.widthOfTextAtSize(${textExpr}, ${fmtNum(field.size)})) / 2`;
  if (field.align === "boxRight" && field.width != null) return `${fmtNum(field.x + field.width)} - ${fontVar}.widthOfTextAtSize(${textExpr}, ${fmtNum(field.size)})`;
  return fmtNum(field.x);
}
/* allowHyphen es editable en todo campo "characters": se emite sólo cuando
 * está activo, igual que el helper real (su default es false). */
function hyphenArg(field) { return field.allowHyphen ? ", allowHyphen: true" : ""; }
function centerArg(field) { return field.align === "boxCenter" ? ", center: true" : ""; }
/* Centros y tamaño fijos dentro de drawDateBoxes() de producción
 * (config/client/client.documents.mjs). */
const DATE_BOX_CENTERS = { start: [255, 271, 286.5, 302, 320.5, 341.5, 362.5, 383.5], end: [425, 444.5, 464, 483.5, 503.5, 524.5, 545.5, 566.5] };
const DATE_BOX_SIZE = 9.5;

const EXPORT_BUILDERS = {
  constancia(doc) {
    const f = id => doc.fields.find(x => x.id === id);
    const n = f("nombre"), e = f("empresa"), qr = f("qr"), sig = f("signature"), p1 = f("pkiLine1"), p2 = f("pkiLine2");
    const st = bespokeStyle(doc);
    const frameLine = qr.frame.enabled
      ? `  page.drawRectangle({ x: ${fmtNum(qr.x)}, y: ${fmtNum(qr.y)}, width: ${fmtNum(qr.width)}, height: ${fmtNum(qr.height)}, borderColor: ${colorExpr(qr.frame.color)}, borderWidth: ${fmtNum(qr.frame.width)} });\n`
      : "";
    /* "empresa" alineada distinto a la izquierda necesita su texto en una
     * constante para poder medirlo (su X depende del ancho real del texto). */
    const empresaExpr = `record.empresa || record.organizationName || ""`;
    const empresaAligned = e.align === "pageCenter" || ((e.align === "boxCenter" || e.align === "boxRight") && e.width != null);
    const body = `
  const black = pdfLib.rgb(0, 0, 0);
  const gray = pdfLib.rgb(0.2, 0.2, 0.2);
  const record = data.record || data;
  const name = record.nombre || record.participantName || "";
  page.drawText(name, { x: page.getSize().width / 2 - ${st.fontVar(n)}.widthOfTextAtSize(name, ${fmtNum(n.size)}) / 2, y: ${fmtNum(n.y)}, size: ${fmtNum(n.size)}, ${st.fontArg(n)}, color: ${st.color(n)} });
${empresaAligned
    ? `  const empresa = ${empresaExpr};
  page.drawText(empresa, { x: ${alignedXExpr(e, st.fontVar(e), "empresa", "page.getSize().width")}, y: ${fmtNum(e.y)}, size: ${fmtNum(e.size)}, ${st.fontArg(e)}, color: ${st.color(e)} });`
    : `  page.drawText(${empresaExpr}, { x: ${fmtNum(e.x)}, y: ${fmtNum(e.y)}, size: ${fmtNum(e.size)}, ${st.fontArg(e)}, color: ${st.color(e)} });`}

${qrNeedsFrameEngine(qr) ? bespokeQrBlock(doc, st, qr, "data.qrImage || data.qrPng || record.qrPng") : `  const qr = await embedImage(pdfDoc, data.qrImage || data.qrPng || record.qrPng);
  if (qr) {
    const top = ${JSON.stringify(qr.captionTop.text)};
    const bottom = ${JSON.stringify(qr.captionBottom.text)};
    page.drawText(top, { x: ${fmtNum(qr.x)} + ${fmtNum(qr.width)} / 2 - ${st.fontVar(qr.captionTop)}.widthOfTextAtSize(top, ${fmtNum(qr.captionTop.size)}) / 2, y: ${fmtNum(qr.y + qr.height + qr.captionTop.offsetY)}, size: ${fmtNum(qr.captionTop.size)}, ${st.fontArg(qr.captionTop)}, color: gray });
    page.drawImage(qr, { x: ${fmtNum(qr.x)}, y: ${fmtNum(qr.y)}, width: ${fmtNum(qr.width)}, height: ${fmtNum(qr.height)} });
${frameLine}    page.drawText(bottom, { x: ${fmtNum(qr.x)} + ${fmtNum(qr.width)} / 2 - ${st.fontVar(qr.captionBottom)}.widthOfTextAtSize(bottom, ${fmtNum(qr.captionBottom.size)}) / 2, y: ${fmtNum(qr.y + qr.captionBottom.offsetY)}, size: ${fmtNum(qr.captionBottom.size)}, ${st.fontArg(qr.captionBottom)}, color: gray });
  }`}
  await drawSignature(pdfDoc, page, data.signaturePng || record.signaturePng, { x: ${fmtNum(sig.x)}, y: ${fmtNum(sig.y)}, width: ${fmtNum(sig.width)}, height: ${fmtNum(sig.height)} });
  const pki = data.pki || {};
  page.drawText(pki.line1 || "", { x: ${fmtNum(p1.x)}, y: ${fmtNum(p1.y)}, size: ${fmtNum(p1.size)}, ${st.fontArg(p1)}, color: pdfLib.rgb(1, 1, 1), opacity: 0.9 });
  page.drawText(pki.line2 || "", { x: ${fmtNum(p2.x)}, y: ${fmtNum(p2.y)}, size: ${fmtNum(p2.size)}, ${st.fontArg(p2)}, color: pdfLib.rgb(1, 1, 1), opacity: 0.8 });${buildExtraFieldsAppendix(doc)}${qrNeedsFrameEngine(qr) ? "\n  " + qrEngineSource() : ""}
}`;
    return `async function renderConstancia({ page, pdfDoc, data, pdfLib }) {
  const font = await pdfDoc.embedFont(pdfLib.StandardFonts.TimesRomanBold);
  const mono = await pdfDoc.embedFont(pdfLib.StandardFonts.Courier);${st.extraFontLines()}` + body;
  },
  dc3(doc) {
    const f = id => doc.fields.find(x => x.id === id);
    const logo = f("logo"), nombre = f("nombre"), curp = f("curp"), ocup = f("ocupacion"), puesto = f("puesto"), emp = f("empresa"),
      rfc = f("rfc"), curso = f("nombreCurso"), dur = f("duracion"), fi = f("fechaInicio"), ff = f("fechaFin"), area = f("area"),
      agente = f("agente"), sig = f("signature"), inst = f("instructor"), pat = f("patron"), rep = f("representanteTrabajadores");
    const st = bespokeStyle(doc);
    /* Opciones comunes de un drawFit/drawCharacters: fuente y color por campo. */
    const fc = field => `${st.fontArg(field)}, color: ${st.color(field)}`;
    /* logo: se dibuja a mano (no con drawSignature), así que hAlign sí se
     * respeta — "center" desplaza X igual que drawImageContainLocal. */
    const logoX = logo.hAlign === "left" ? fmtNum(logo.x) : `${fmtNum(logo.x)} + (${fmtNum(logo.width)} - width) / 2`;
    /* Fechas: producción usa drawDateBoxes(), que trae sus centros y tamaño
     * fijos por dentro — pero aquí son editables (arrastrar o "Centros
     * (avanzado)") y antes esos cambios se perdían al exportar. Mientras
     * sigan iguales a los de drawDateBoxes se exporta la misma llamada de
     * producción; si cambian, la llamada equivalente con drawCharacters
     * (drawDateBoxes es exactamente drawCharacters(value, centros, { y, size,
     * font, color })) con los valores nuevos explícitos. */
    const dateLine = (field, valueExpr, end) => {
      const defaults = DATE_BOX_CENTERS[end ? "end" : "start"];
      const same = field.size === DATE_BOX_SIZE && !field.allowHyphen && field.centers.length === defaults.length && field.centers.every((c, i) => c === defaults[i]);
      return same
        ? `drawDateBoxes(page, ${valueExpr}, { y: ${fmtNum(field.y)}, ${fc(field)}${end ? ", end: true" : ""} });`
        : `drawCharacters(page, ${valueExpr}, ${fmtCenters(field.centers)}, { y: ${fmtNum(field.y)}, size: ${fmtNum(field.size)}, ${fc(field)}${hyphenArg(field)} });`;
    };
    const body = `
  const black = pdfLib.rgb(0, 0, 0);
  const record = data.record || data;
  const logo = await embedImage(pdfDoc, data.logoPng || record.logoPng);
  if (logo) {
    const ratio = Math.min(${fmtNum(logo.width)} / logo.width, ${fmtNum(logo.height)} / logo.height);
    const width = logo.width * ratio;
    const height = logo.height * ratio;
    page.drawImage(logo, { x: ${logoX}, y: ${fmtNum(logo.y)} + (${fmtNum(logo.height)} - height) / 2, width, height });
  }
  drawFit(page, record.nombre, { x: ${fmtNum(nombre.x)}, y: ${fmtNum(nombre.y)}, width: ${fmtNum(nombre.width)}, size: ${fmtNum(nombre.size)}, ${fc(nombre)}${centerArg(nombre)} });
  drawCharacters(page, record.curp, ${fmtCenters(curp.centers)}, { y: ${fmtNum(curp.y)}, size: ${fmtNum(curp.size)}, ${fc(curp)}${hyphenArg(curp)} });
  drawFit(page, record.ocupacion, { x: ${fmtNum(ocup.x)}, y: ${fmtNum(ocup.y)}, width: ${fmtNum(ocup.width)}, size: ${fmtNum(ocup.size)}, ${fc(ocup)}${centerArg(ocup)} });
  drawFit(page, record.puesto, { x: ${fmtNum(puesto.x)}, y: ${fmtNum(puesto.y)}, width: ${fmtNum(puesto.width)}, size: ${fmtNum(puesto.size)}, ${fc(puesto)}${centerArg(puesto)} });
  drawFit(page, record.empresa, { x: ${fmtNum(emp.x)}, y: ${fmtNum(emp.y)}, width: ${fmtNum(emp.width)}, size: ${fmtNum(emp.size)}, ${fc(emp)}${centerArg(emp)} });
  drawCharacters(page, record.rfcDisplay || formatRfc(record.rfc), ${fmtCenters(rfc.centers)}, { y: ${fmtNum(rfc.y)}, size: ${fmtNum(rfc.size)}, ${fc(rfc)}${hyphenArg(rfc)} });
  drawFit(page, record.nombreCurso, { x: ${fmtNum(curso.x)}, y: ${fmtNum(curso.y)}, width: ${fmtNum(curso.width)}, size: ${fmtNum(curso.size)}, ${fc(curso)}${centerArg(curso)} });
  drawFit(page, \`\${record.duracion || "8"} HORAS\`, { x: ${fmtNum(dur.x)}, y: ${fmtNum(dur.y)}, width: ${fmtNum(dur.width)}, size: ${fmtNum(dur.size)}, ${fc(dur)}${centerArg(dur)} });
  ${dateLine(fi, "record.fechaInicioDigits", false)}
  ${dateLine(ff, "record.fechaFinDigits", true)}
  drawFit(page, record.area, { x: ${fmtNum(area.x)}, y: ${fmtNum(area.y)}, width: ${fmtNum(area.width)}, size: ${fmtNum(area.size)}, ${fc(area)}${centerArg(area)} });
  drawFit(page, record.agente, { x: ${fmtNum(agente.x)}, y: ${fmtNum(agente.y)}, width: ${fmtNum(agente.width)}, size: ${fmtNum(agente.size)}, ${fc(agente)}${centerArg(agente)} });
  await drawSignature(pdfDoc, page, data.signaturePng || record.signaturePng, { x: ${fmtNum(sig.x)}, y: ${fmtNum(sig.y)}, width: ${fmtNum(sig.width)}, height: ${fmtNum(sig.height)} });
  drawFit(page, record.instructor, { x: ${fmtNum(inst.x)}, y: ${fmtNum(inst.y)}, width: ${fmtNum(inst.width)}, size: ${fmtNum(inst.size)}, ${fc(inst)}, maxLines: 2, lineHeight: 8${centerArg(inst)} });
  drawFit(page, record.patron, { x: ${fmtNum(pat.x)}, y: ${fmtNum(pat.y)}, width: ${fmtNum(pat.width)}, size: ${fmtNum(pat.size)}, ${fc(pat)}, maxLines: 2, lineHeight: 8${centerArg(pat)} });
  drawFit(page, record.representanteTrabajadores, { x: ${fmtNum(rep.x)}, y: ${fmtNum(rep.y)}, width: ${fmtNum(rep.width)}, size: ${fmtNum(rep.size)}, ${fc(rep)}, maxLines: 2, lineHeight: 8${centerArg(rep)} });
  const now = new Date();
  const profile = data.profile || {};
  pdfDoc.setTitle?.(\`DC-3 \${record.nombre || ""}\`);
  pdfDoc.setAuthor?.(profile.empresaEmisora || "SafeAutentic");
  pdfDoc.setSubject?.("Formato DC-3 generado desde SafeAutentic");
  pdfDoc.setProducer?.("SafeAutentic DC-3 Engine");
  pdfDoc.setCreationDate?.(now);
  pdfDoc.setModificationDate?.(now);${buildExtraFieldsAppendix(doc)}
}`;
    return `async function renderDc3({ page, pdfDoc, data, pdfLib }) {
  const font = await pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(pdfLib.StandardFonts.HelveticaBold);${st.extraFontLines()}` + body;
  },
  carta(doc) {
    const f = id => doc.fields.find(x => x.id === id);
    const fecha = f("fecha"), top = f("razonSocialTop"), muni = f("municipio"), bottom = f("razonSocialBottom"),
      qr = f("qr"), firmante = f("firmanteNombre"), label = f("representanteLabel"), footer = f("razonSocialFooter"), sig = f("signature");
    const st = bespokeStyle(doc);
    const extraLines = [];
    if (qr.frame.enabled) extraLines.push(`  if (qr) page.drawRectangle({ x: ${fmtNum(qr.x)}, y: ${fmtNum(qr.y)}, width: ${fmtNum(qr.width)}, height: ${fmtNum(qr.height)}, borderColor: ${colorExpr(qr.frame.color)}, borderWidth: ${fmtNum(qr.frame.width)} });`);
    if (qr.captionTop?.text) extraLines.push(`  if (qr) { const t = ${JSON.stringify(qr.captionTop.text)}; page.drawText(t, { x: ${fmtNum(qr.x)} + ${fmtNum(qr.width)} / 2 - ${st.fontVar(qr.captionTop)}.widthOfTextAtSize(t, ${fmtNum(qr.captionTop.size)}) / 2, y: ${fmtNum(qr.y + qr.height + qr.captionTop.offsetY)}, size: ${fmtNum(qr.captionTop.size)}, ${st.fontArg(qr.captionTop)}, color: ${colorExpr(qr.captionTop.color)} }); }`);
    if (qr.captionBottom?.text) extraLines.push(`  if (qr) { const t = ${JSON.stringify(qr.captionBottom.text)}; page.drawText(t, { x: ${fmtNum(qr.x)} + ${fmtNum(qr.width)} / 2 - ${st.fontVar(qr.captionBottom)}.widthOfTextAtSize(t, ${fmtNum(qr.captionBottom.size)}) / 2, y: ${fmtNum(qr.y + qr.captionBottom.offsetY)}, size: ${fmtNum(qr.captionBottom.size)}, ${st.fontArg(qr.captionBottom)}, color: ${colorExpr(qr.captionBottom.color)} }); }`);
    const frameLine = extraLines.length ? "\n" + extraLines.join("\n") : "";
    /* "centered" recibe fuente, tamaño y color opcionales: antes usaba siempre
     * el tamaño de razonSocialTop, así que cambiar el tamaño de municipio o de
     * razonSocialBottom en el Inspector no llegaba al export. Los argumentos
     * sólo se escriben cuando difieren del default, para que con los valores
     * originales las llamadas queden idénticas a las de producción. */
    let centeredExtended = false;
    const centeredCall = (textExpr, y, field) => {
      const v = st.fontVar(field), c = st.color(field);
      const needColor = c !== "black", needSize = needColor || field.size !== top.size;
      const args = [textExpr, fmtNum(y)];
      if (v !== "font" || needSize) args.push(v);
      if (needSize) { args.push(fmtNum(field.size)); centeredExtended = true; }
      if (needColor) args.push(c);
      return `centered(${args.join(", ")})`;
    };
    /* Las llamadas se arman ANTES que la definición de "centered" para saber
     * si alguna necesita tamaño/color propios; si ninguna, se exporta la misma
     * definición de producción. */
    const topCall = centeredCall("company", top.y, top);
    const muniCall = centeredCall("municipality", muni.y, muni);
    const muniSplitTopCall = centeredCall("municipality.slice(0, cut + 1).trim()", muni.ySplitTop, muni);
    const muniSplitBottomCall = centeredCall("municipality.slice(cut + 1).trim()", muni.ySplitBottom, muni);
    const bottomCall = centeredCall("company", bottom.y, bottom);
    const centeredDef = centeredExtended
      ? `const centered = (text, y, useFont = font, size = ${fmtNum(top.size)}, color = black) => page.drawText(text, { x: width / 2 - useFont.widthOfTextAtSize(text, size) / 2, y, size, font: useFont, color });`
      : `const centered = (text, y, useFont = font) => page.drawText(text, { x: width / 2 - useFont.widthOfTextAtSize(text, ${fmtNum(top.size)}) / 2, y, size: ${fmtNum(top.size)}, font: useFont, color: black });`;
    /* "fecha" alineada distinto a la izquierda necesita su texto en una
     * constante para poder medirlo. */
    const fechaAligned = fecha.align === "pageCenter" || ((fecha.align === "boxCenter" || fecha.align === "boxRight") && fecha.width != null);
    const fechaLine = fechaAligned
      ? `  const fecha = record.fecha || "";
  page.drawText(fecha, { x: ${alignedXExpr(fecha, st.fontVar(fecha), "fecha", "width")}, y: ${fmtNum(fecha.y)}, size: ${fmtNum(fecha.size)}, ${st.fontArg(fecha)}, color: ${st.color(fecha)} });`
      : `  page.drawText(record.fecha || "", { x: ${fmtNum(fecha.x)}, y: ${fmtNum(fecha.y)}, size: ${fmtNum(fecha.size)}, ${st.fontArg(fecha)}, color: ${st.color(fecha)} });`;
    const firmanteFont = st.fontVar(firmante);
    const body = `
  const black = pdfLib.rgb(0, 0, 0);
  const { width } = page.getSize();
  const record = data.record || data;
  const company = record.razonSocial || record.empresa || "";
  const municipality = record.municipio || "";
  ${centeredDef}
${fechaLine}
  ${topCall};
  if (${st.fontVar(muni)}.widthOfTextAtSize(municipality, ${fmtNum(muni.size)}) <= width - 80) ${muniCall};
  else {
    const middle = Math.floor(municipality.length / 2);
    let cut = municipality.lastIndexOf(",", middle);
    if (cut === -1) cut = municipality.indexOf(",", middle);
    if (cut === -1) cut = middle;
    ${muniSplitTopCall};
    ${muniSplitBottomCall};
  }
  ${bottomCall};
${qrNeedsFrameEngine(qr) ? bespokeQrBlock(doc, st, qr, "data.qrPng || record.qrPng") : `  const qr = await embedImage(pdfDoc, data.qrPng || record.qrPng);
  if (qr) page.drawImage(qr, { x: ${fmtNum(qr.x)}, y: ${fmtNum(qr.y)}, width: ${fmtNum(qr.width)}, height: ${fmtNum(qr.height)} });${frameLine}`}
  const name = record.nombreCliente || record.nombre || "";
  const leftColumnWidth = width * 0.45;
  page.drawText(name, { x: leftColumnWidth / 2 - ${firmanteFont}.widthOfTextAtSize(name, ${fmtNum(firmante.size)}) / 2 + 40, y: ${fmtNum(firmante.y)}, size: ${fmtNum(firmante.size)}, ${st.fontArg(firmante)}, color: ${st.color(firmante)} });
  page.drawText(${JSON.stringify(label.literalText)}, { x: ${alignedXExpr(label, st.fontVar(label), JSON.stringify(label.literalText), "width")}, y: ${fmtNum(label.y)}, size: ${fmtNum(label.size)}, ${st.fontArg(label)}, color: ${st.color(label)} });
  page.drawText(company, { x: ${alignedXExpr(footer, st.fontVar(footer), "company", "width")}, y: ${fmtNum(footer.y)}, size: ${fmtNum(footer.size)}, ${st.fontArg(footer)}, color: ${st.color(footer)} });
  await drawSignature(pdfDoc, page, data.signaturePng || record.signaturePng, { x: ${fmtNum(sig.x)}, y: ${fmtNum(sig.y)}, width: ${fmtNum(sig.width)}, height: ${fmtNum(sig.height)} });${buildExtraFieldsAppendix(doc)}${qrNeedsFrameEngine(qr) ? "\n  " + qrEngineSource() : ""}
}`;
    return `async function renderCarta({ page, pdfDoc, data, pdfLib }) {
  const font = await pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(pdfLib.StandardFonts.HelveticaBold);${st.extraFontLines()}` + body;
  }
};
function colorExpr(name) {
  /* Expresión literal (no un identificador como "black"/"gray") para que el
   * bloque exportado no dependa de que la función destino ya tenga esa
   * variable local declarada (p. ej. renderCarta no define "gray"). */
  if (name === "gray") return "pdfLib.rgb(0.2, 0.2, 0.2)";
  return "pdfLib.rgb(0, 0, 0)";
}

/* Metadatos del editor (fuente original, máscara desactivada o enlace al
 * objeto de texto retirado) no forman parte del renderer generado. */
function buildGenericFieldsLiteral(fields) {
  return "[\n" + fields.map(f => { const { source, maskOff, needsReview, textReplacement, textReplacements, replacementWarning, ...rest } = f; return "    " + JSON.stringify(rest); }).join(",\n") + "\n  ]";
}
/* Cuerpo del loop de dibujo genérico, compartido entre el export de un
 * documento nuevo (buildNewDocumentExport) y los campos extra que un usuario
 * agrega a un documento a medida (buildExtraFieldsAppendix) — antes eran dos
 * copias del mismo código; ahora un solo lugar para mantener el algoritmo.
 * "colorFor" resuelve el color real de CADA campo (o de su frame/caption) —
 * antes todo se exportaba en negro sin importar lo que mostrara el inspector:
 * el color elegido cambiaba la vista previa en pdf-mapper pero nunca llegaba
 * al código exportado. Soporta tanto los 5 colores con nombre como un color
 * personalizado (#rrggbb) elegido con el selector de color del inspector. */
/* Código fuente del motor de marcos del QR para el export: las MISMAS
 * funciones que usan el lienzo y la vista previa (no una copia a mano). */
/* Bloque del QR con el motor de marcos para un render a medida: las fuentes
 * de los textos se resuelven a las variables que ese render ya declara. */
function bespokeQrBlock(doc, st, qr, imageExpr) {
  const f = qr.frame || {};
  const bottomDesc = f.enabled && f.style === "badge" && !qr.captionBottom?.text ? { bold: true } : (qr.captionBottom || {});
  const box = { x: qr.x, y: qr.y, width: qr.width, height: qr.height };
  return `  const qr = await embedImage(pdfDoc, ${imageExpr});
  if (qr) {
    const qrPrims = qrFramePrimitives(${JSON.stringify(box)}, ${JSON.stringify(f)}, ${JSON.stringify({ top: qr.captionTop || null, bottom: qr.captionBottom || null })});
    const qrFont = async d => (d && d.slot === "top" ? ${st.fontVar(qr.captionTop || {})} : ${st.fontVar(bottomDesc)});
    await drawQrPrimitives(page, pdfLib, qrPrims.under, qrFont);
    page.drawImage(qr, { x: ${fmtNum(qr.x)}, y: ${fmtNum(qr.y)}, width: ${fmtNum(qr.width)}, height: ${fmtNum(qr.height)} });
    await drawQrPrimitives(page, pdfLib, qrPrims.over, qrFont);
  }`;
}
function qrEngineSource() {
  return `/* Motor de marcos del QR (PDF Mapper): forma del marco y textos. */
  ${qrFramePrimitives.toString()}
  ${drawQrPrimitives.toString()}`;
}
function buildFieldLoopSnippet(fieldsVar, fontForFn, pageWidthVar, withQrEngine = false, withMasks = false) {
  return `const namedColors = { black: [0, 0, 0], gray: [0.2, 0.2, 0.2], white: [1, 1, 1], whiteFaint90: [1, 1, 1], whiteFaint80: [1, 1, 1] };
  function colorFor(obj) {
    if (obj?.colorHex) {
      const hex = obj.colorHex.replace("#", "");
      return pdfLib.rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
    }
    const c = namedColors[obj?.color] || namedColors.black;
    return pdfLib.rgb(c[0], c[1], c[2]);
  }
  /* Cada campo en SU página (field.page, desde 0; ausente = primera). */
  const pdfPages = pdfDoc.getPages();
  ${withMasks ? `/* Parches que tapan el texto de ejemplo de la plantilla: antes que cualquier campo. */
  for (const field of ${fieldsVar}) {
    const maskPage = pdfPages[field.page || 0];
    if (field.mask && maskPage) maskPage.drawRectangle({ x: field.mask.x, y: field.mask.y, width: field.mask.width, height: field.mask.height, color: colorFor(field.mask) });
  }
  ` : ""}for (const field of ${fieldsVar}) {
    const page = pdfPages[field.page || 0];
    if (!page) continue;
    const ${pageWidthVar} = page.getSize().width;
    const font = await ${fontForFn}(field);
    let value;
    if (field.literalText != null) value = field.literalText;
    else if (field.textTemplate) {
      value = field.textTemplate.replace(/\\{([\\w.]+)\\}/g, (_, path) => {
        const resolved = path.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), data);
        return resolved == null ? "" : String(resolved);
      });
    } else value = (field.dataKey || "").split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), data) ?? "";
    value = String(value ?? "");
    if (field.textCase === "uppercase") value = value.toUpperCase();
    else if (field.textCase === "lowercase") value = value.toLowerCase();
    value = \`\${field.prefix || ""}\${value}\${field.suffix || ""}\`;
    if (field.type === "text") {
      const color = colorFor(field);
      if (field.shrink && field.width) {
        /* Una línea: reduce la fuente hasta 6 pt si no cabe, nunca la parte. */
        const line = clean(value);
        let fs = field.size;
        const floor = Math.min(6, field.size * 0.8);
        while (fs > floor && font.widthOfTextAtSize(line, fs) > field.width) fs -= 0.4;
        const lineWidth = font.widthOfTextAtSize(line, fs);
        const dx = field.align === "boxCenter" ? field.x + (field.width - lineWidth) / 2 : field.align === "boxRight" ? field.x + field.width - lineWidth : field.x;
        if (line) page.drawText(line, { x: dx, y: field.y, size: fs, font, color });
      } else if (field.fit) {
        /* drawFit() de producción llama a clean(), que colapsa "\\n" a un
         * espacio (mismo comportamiento que el "clean" real en
         * config/client/client.documents.mjs) — así que un salto de línea
         * escrito en "Plantilla con variables" nunca se respetaría pasando
         * por drawFit tal cual. Cuando el valor trae saltos explícitos se
         * reimplementa aquí el mismo wrap por ancho de drawFit pero
         * respetando cada "\\n" como corte duro; si no hay saltos, se sigue
         * usando drawFit tal cual (sin reinventar nada de más). drawFit
         * tampoco sabe alinear a la derecha: ese caso usa el mismo camino. */
        if (value.includes("\\n") || field.align === "boxRight") {
          const fitLines = [];
          for (const para of value.split("\\n")) {
            const paraClean = clean(para);
            if (paraClean) {
              const words = paraClean.split(" ").filter(Boolean);
              let current = "";
              for (const w of words) {
                const cand = current ? current + " " + w : w;
                if (current && font.widthOfTextAtSize(cand, field.size) > field.width) { fitLines.push(current); current = w; }
                else current = cand;
              }
              if (current) fitLines.push(current);
            } else fitLines.push("");
          }
          const fitLineHeight = field.lineHeight || field.size + 1;
          fitLines.slice(0, field.maxLines || 1).forEach((line, i) => {
            if (!line) return;
            let fs = field.size;
            while (fs > 6 && font.widthOfTextAtSize(line, fs) > field.width) fs -= 0.4;
            const lineWidth = font.widthOfTextAtSize(line, fs);
            const dx = field.align === "boxCenter" ? field.x + (field.width - lineWidth) / 2 : field.align === "boxRight" ? field.x + field.width - lineWidth : field.x;
            page.drawText(line, { x: dx, y: field.y - i * fitLineHeight, size: fs, font, color });
          });
        } else {
          drawFit(page, value, { x: field.x, y: field.y, width: field.width, size: field.size, font, color, maxLines: field.maxLines || 1, lineHeight: field.lineHeight || field.size + 1, center: field.align === "boxCenter" });
        }
      } else if (field.align === "pageCenter") {
        page.drawText(clean(value), { x: ${pageWidthVar} / 2 - font.widthOfTextAtSize(clean(value), field.size) / 2, y: field.y, size: field.size, font, color });
      } else if (field.align === "boxCenter" && field.width) {
        page.drawText(clean(value), { x: field.x + (field.width - font.widthOfTextAtSize(clean(value), field.size)) / 2, y: field.y, size: field.size, font, color });
      } else if (field.align === "boxRight" && field.width) {
        page.drawText(clean(value), { x: field.x + field.width - font.widthOfTextAtSize(clean(value), field.size), y: field.y, size: field.size, font, color });
      } else {
        page.drawText(clean(value), { x: field.x ?? 0, y: field.y, size: field.size, font, color });
      }
    } else if (field.type === "characters") {
      drawCharacters(page, value, field.centers, { y: field.y, size: field.size, font, color: colorFor(field), allowHyphen: !!field.allowHyphen });
    } else if (field.type === "checkbox") {
      const boxColor = colorFor(field);
      page.drawRectangle({ x: field.x, y: field.y, width: field.size, height: field.size, borderColor: boxColor, borderWidth: 1 });
      const checked = field.literalChecked != null ? !!field.literalChecked : (value && value !== "false" && value !== "0");
      if (checked) {
        const glyph = field.checkedGlyph || "X";
        const glyphSize = field.size * 0.8;
        page.drawText(glyph, { x: field.x + field.size / 2 - font.widthOfTextAtSize(glyph, glyphSize) / 2, y: field.y + field.size * 0.15, size: glyphSize, font, color: boxColor });
      }
    } else if (field.type === "image") {
      /* drawSignature (helper de producción) SIEMPRE centra la imagen — no
       * tiene opción de alineación. Para "izquierda" se dibuja a mano con la
       * misma fórmula que ya usa el logo de DC-3 en su propio render a
       * medida, en vez de usar drawSignature (que ignoraría hAlign). */
      if (field.hAlign === "left") {
        const img = await embedImage(pdfDoc, value);
        if (img) {
          const ratio = Math.min(field.width / img.width, field.height / img.height);
          const dw = img.width * ratio, dh = img.height * ratio;
          page.drawImage(img, { x: field.x, y: field.y + (field.height - dh) / 2, width: dw, height: dh });
        }
      } else {
        await drawSignature(pdfDoc, page, value, { x: field.x, y: field.y, width: field.width, height: field.height });
      }
    } else if (field.type === "qr") {
      const qr = await embedImage(pdfDoc, value);
      const qrPrims = qrFramePrimitives({ x: field.x, y: field.y, width: field.width, height: field.height }, field.frame, { top: field.captionTop, bottom: field.captionBottom });
      await drawQrPrimitives(page, pdfLib, qrPrims.under, ${fontForFn});
      if (qr) page.drawImage(qr, { x: field.x, y: field.y, width: field.width, height: field.height });
      await drawQrPrimitives(page, pdfLib, qrPrims.over, ${fontForFn});
    }
  }${withQrEngine ? "\n  " + qrEngineSource() : ""}`;
}
/* Negrita/cursiva en el código exportado: los mismos 14 fonts estándar de PDF
 * en familias de 4 variantes, resueltas en tiempo de ejecución a partir de
 * fontKey (familia base) + field.bold/field.italic — espejo de
 * resolveStandardFontName() del editor (ver sección 3b), reescrito como texto
 * porque este código corre después, ya pegado en client.documents.mjs. */
/* Fuentes del cliente en el código exportado: el archivo vive en
 * config/client/assets/fonts/ y se incrusta con fontkit (se carga del mismo
 * CDN que pdf-lib si la página no lo trae). */
const FONTKIT_URL = "https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js";
function usedCustomFonts(doc, fields = doc.fields) {
  const keys = [...new Set(fields.map(f => f.fontFile).filter(k => k && doc.customFonts?.[k]))];
  return Object.fromEntries(keys.map(k => [k, { url: "/config/client/assets/fonts/" + doc.customFonts[k].fileName, subset: !doc.customFonts[k].noSubset }]));
}
function buildCustomFontSnippet(filesVar, files) {
  return `const ${filesVar} = ${JSON.stringify(files)};
  async function loadFontkit() {
    if (globalThis.fontkit) return globalThis.fontkit;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = ${JSON.stringify(FONTKIT_URL)};
      script.onload = resolve;
      script.onerror = () => reject(new Error("No se pudo cargar fontkit para las fuentes del cliente"));
      document.head.appendChild(script);
    });
    return globalThis.fontkit;
  }`;
}
function buildFontResolverSnippet(namesVar, cacheVar, fnName, filesVar = null) {
  const custom = filesVar ? `
    if (fieldLike?.fontFile && ${filesVar}[fieldLike.fontFile]) {
      const file = ${filesVar}[fieldLike.fontFile], key = "custom:" + fieldLike.fontFile;
      if (!${cacheVar}[key]) {
        pdfDoc.registerFontkit(await loadFontkit());
        const res = await fetch(file.url);
        if (!res.ok) throw new Error("No se encontró la fuente " + file.url);
        ${cacheVar}[key] = await pdfDoc.embedFont(await res.arrayBuffer(), { subset: file.subset });
      }
      return ${cacheVar}[key];
    }` : "";
  return `const FONT_FAMILIES = { Helvetica: { regular: "Helvetica", bold: "HelveticaBold", italic: "HelveticaOblique", boldItalic: "HelveticaBoldOblique" }, TimesRoman: { regular: "TimesRoman", bold: "TimesRomanBold", italic: "TimesRomanItalic", boldItalic: "TimesRomanBoldItalic" }, Courier: { regular: "Courier", bold: "CourierBold", italic: "CourierOblique", boldItalic: "CourierBoldOblique" } };
  function fontFamilyOf(name) {
    for (const fam of Object.keys(FONT_FAMILIES)) if (Object.values(FONT_FAMILIES[fam]).includes(name)) return fam;
    return "Helvetica";
  }
  async function ${fnName}(fieldLike) {${custom}
    const base = ${namesVar}[fieldLike?.fontKey] || Object.values(${namesVar})[0] || "Helvetica";
    const table = FONT_FAMILIES[fontFamilyOf(base)];
    const baseIsBold = base === table.bold || base === table.boldItalic;
    const baseIsItalic = base === table.italic || base === table.boldItalic;
    const effBold = baseIsBold || !!fieldLike?.bold;
    const effItalic = baseIsItalic || !!fieldLike?.italic;
    const resolved = table[effBold && effItalic ? "boldItalic" : effBold ? "bold" : effItalic ? "italic" : "regular"];
    if (!${cacheVar}[resolved]) ${cacheVar}[resolved] = await pdfDoc.embedFont(pdfLib.StandardFonts[resolved]);
    return ${cacheVar}[resolved];
  }`;
}
/* Texto fijo que corrigió (o borró) un texto de la plantilla con la
 * herramienta P: va escrito en la plantilla exportada, junto con su máscara
 * si la tiene, así que el código exportado ya no lo dibuja. Un texto con
 * datos nunca: cambia en cada emisión. */
function isBakedText(f) {
  return f.type === "text" && typeof f.literalText === "string" && !f.textTemplate
    && !!(f.source || f.textReplacement || f.textReplacements?.length);
}
const drawnFields = fields => fields.filter(f => !isBakedText(f));
function buildNewDocumentExport(doc) {
  const fields = drawnFields(doc.fields);
  return `/* Documento nuevo generado por PDF Mapper — pégalo dentro de client.documents.mjs.
 * Asume que ya existen ahí los helpers: clean, embedImage, drawFit, drawCharacters,
 * drawSignature (u otros helpers de la misma familia). Sin bindings: cada "dataKey"
 * es una ruta libre dentro de "data" que el integrador conecta a mano. */
const ${camel(doc.id)}Fields = ${buildGenericFieldsLiteral(fields)};

async function render${cap(camel(doc.id))}({ page, pdfDoc, data, pdfLib }) {
  const fontsCache = {};
  const fontNames = ${JSON.stringify(doc.fonts)};${Object.keys(usedCustomFonts(doc)).length ? "\n  " + buildCustomFontSnippet("customFontFiles", usedCustomFonts(doc)) : ""}
  ${buildFontResolverSnippet("fontNames", "fontsCache", "fontFor", Object.keys(usedCustomFonts(doc)).length ? "customFontFiles" : null)}
  ${buildFieldLoopSnippet(camel(doc.id) + "Fields", "fontFor", "pageWidth", fields.some(f => f.type === "qr"), fields.some(f => f.mask))}
}

/* Y en el objeto clientDocuments: */
// ${JSON.stringify(doc.id)}: { label: ${JSON.stringify(doc.label)}, template: ${JSON.stringify("templates/" + doc.template)}, render: render${cap(camel(doc.id))} }`;
}
/* Un campo agregado en PDF Mapper a un documento A MEDIDA (constancia/dc3/carta)
 * no está entre los ids que su función de export original conoce (KNOWN_FIELD_IDS),
 * así que antes se perdía silenciosamente al exportar (sólo se avisaba en preflight).
 * Esto genera, para esos campos extra, el mismo bloque de dibujo genérico que usa
 * un documento nuevo, y se inserta al final de la función a medida correspondiente. */
function buildExtraFieldsAppendix(doc) {
  const known = KNOWN_FIELD_IDS[doc.renderer];
  const extra = known ? drawnFields(doc.fields).filter(f => !known.has(f.id)) : [];
  if (!extra.length) return "";
  return `
  // Campos nuevos agregados en PDF Mapper — no forman parte del render original de "${doc.label}".
  // Revisa esta sección antes de llevarla a producción.
  {
    const extraFields = ${buildGenericFieldsLiteral(extra)};
    const extraFontNames = ${JSON.stringify(doc.fonts)};
    const extraFontsCache = {};${Object.keys(usedCustomFonts(doc, extra)).length ? "\n    " + buildCustomFontSnippet("extraCustomFontFiles", usedCustomFonts(doc, extra)) : ""}
    ${buildFontResolverSnippet("extraFontNames", "extraFontsCache", "extraFontFor", Object.keys(usedCustomFonts(doc, extra)).length ? "extraCustomFontFiles" : null)}
    ${buildFieldLoopSnippet("extraFields", "extraFontFor", "extraPageWidth", extra.some(f => f.type === "qr"), extra.some(f => f.mask))}
  }`;
}
function camel(s) {
  const words = String(s).match(/[A-Za-z0-9]+/g) || [];
  const name = words.map((word, index) => index ? word[0].toUpperCase() + word.slice(1) : word[0].toLowerCase() + word.slice(1)).join("");
  return /^[A-Za-z_$]/.test(name) ? name : "_" + name;
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

export {
  SEED_DOCUMENTS, KNOWN_FIELD_IDS, STYLE_FIXED_BESPOKE_FIELDS, DC3_FIT_ALIGN, PLAIN_TEXT_ALIGN, BESPOKE_ALIGN_OPTIONS, COLORS, fieldColorRgb, OPACITY, cleanText, wrapText, wrapTextWithBreaks, cleanCharactersValue, safeWidth, wrapSafe, TEXT_ASCENT, layoutTextField, qrFramePrimitives, drawQrPrimitives, qrNeedsFrameEngine, layoutCharacters, embedImageLocal, drawImageContainLocal, placeholderPng, resolveTemplate, resolveText, FONT_FAMILIES, fontFamilyOf, resolveStandardFontName, baseFontNameFor, metricFontsCache, ensureMetricFonts, customFonts, customFontFor, missingChars, metricFontFor, unencodableChars, singleLine, measureText, fittedSize, escapeHtml, valueSourceFor, resolvedParamsFor, cloneDoc, pageCountOf, pageSizeOf, pageView, fieldPage, fieldBBox, intersects, QR_MODULES, QR_MIN_SIDE, PRINT_MARGIN, INK_DARK, INK_TEXT_LIMIT, mmOf, luminance, contrastRatio, rgbOfStyle, qrExtent, inkCoverage, runPreflight, preflightOnce, SAFE_FIX_KINDS, twoLinesCollides, planSafeFixes, offPageFix, preflightQr, preflightInk, fmtNum, fmtCenters, BESPOKE_BASE_FONTS, BESPOKE_BASE_COLORS, NAMED_COLOR_RGB, colorLiteral, bespokeStyle, alignedXExpr, hyphenArg, centerArg, DATE_BOX_CENTERS, DATE_BOX_SIZE, EXPORT_BUILDERS, colorExpr, buildGenericFieldsLiteral, bespokeQrBlock, qrEngineSource, buildFieldLoopSnippet, FONTKIT_URL, usedCustomFonts, buildCustomFontSnippet, buildFontResolverSnippet, buildNewDocumentExport, buildExtraFieldsAppendix, camel, cap, isBakedText
};
