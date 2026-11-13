/* Textos del PDF — lo que la plantilla del cliente YA trae escrito.
 *
 * Una constancia nueva casi siempre llega llena con un ejemplo («JUAN PÉREZ»,
 * «Curso de Primeros Auxilios», «12 de marzo de 2026»). Esos textos dicen
 * exactamente dónde va cada dato, con qué fuente y de qué tamaño. Este módulo
 * convierte el contenido de texto de pdf.js en «renglones» seleccionables y
 * en campos del mapeador, sin adivinar coordenadas a mano.
 *
 * Módulo puro: recibe los items ya leídos (pdf.js getTextContent + la fuente
 * de cada uno) y devuelve geometría en puntos PDF con origen ABAJO a la
 * izquierda — el mismo sistema que el resto de PDF Mapper ("y" = línea base).
 *
 * Contrato de un renglón (run):
 *   { id, page, text, x, y, width, size, family, bold, italic, fontName,
 *     box: { x0, x1, y0, y1 } }
 *   family ∈ "Helvetica" | "TimesRoman" | "Courier" (la estándar más cercana).
 */

export const TEXT_ASCENT = 0.8, TEXT_DESCENT = 0.25;
/* Margen que se deja libre en los bordes de la página al calcular cuánto
 * puede crecer un dato (las impresoras no imprimen los últimos ~5 mm). */
export const PAGE_MARGIN = 28;

const r2 = v => Math.round(v * 100) / 100;
const half = v => Math.round(v * 2) / 2;

/* Nombre real de la fuente incrustada ("ABCDEF+TimesNewRomanPS-BoldMT") →
 * familia estándar de PDF más parecida + negrita/cursiva. */
export function standardStyleOf(fontName = "", flags = {}) {
  const name = String(fontName).replace(/^[A-Z]{6}\+/, "");
  const family = /courier|mono|consol/i.test(name) ? "Courier"
    : /times|serif|roman|garamond|georgia|cambria|book|minion|palatino|baskerville|bodoni|century/i.test(name) && !/sans|gothic|grotesk/i.test(name) ? "TimesRoman"
    : flags.serif === true ? "TimesRoman" : "Helvetica";
  const bold = !!flags.bold || /bold|black|heavy|semibold|demibold|extrabold|[-,]bd\b|w[6-9]\b/i.test(name);
  const italic = !!flags.italic || /italic|oblique|[-,]it\b/i.test(name);
  return { family, bold, italic, fontName: name };
}

/* Item de pdf.js → item normalizado en puntos PDF del editor.
 *   item.transform = [a, b, c, d, e, f]; (e, f) es la línea base en el
 *   espacio de usuario. view = page.view ([x0, y0, x1, y1]): el editor mide
 *   desde la esquina inferior izquierda de la página visible.
 * Texto girado (b distinto de 0) no se puede mapear con drawText recto: se
 * marca para que la interfaz no lo ofrezca como campo. Texto inclinado (sólo
 * c distinto de 0) es una cursiva sintética — Word la usa cuando la fuente no
 * trae cursiva —: se mapea como cursiva, con el cuerpo vertical (d). */
export function normalizeItem(item, { page = 0, view = [0, 0], font = {} } = {}) {
  const [a, b, c, d, e, f] = item.transform || [1, 0, 0, 1, 0, 0];
  const rotated = Math.abs(b) > 0.01;
  const slanted = !rotated && Math.abs(c) > 0.01;
  const size = (!rotated ? Math.abs(d) : Math.hypot(c, d)) || Math.hypot(a, b) || item.height || 0;
  const style = standardStyleOf(font.name || item.fontName, font);
  return {
    str: String(item.str ?? ""),
    x: e - (view[0] || 0), y: f - (view[1] || 0),
    width: Math.abs(item.width || 0), size, rotated,
    page, ...style, italic: style.italic || slanted
  };
}

/* Lote: muchos PDFs de clientes son la misma constancia repetida, una página
 * por curso o por persona. Compara cada página con la primera, renglón por
 * renglón (misma posición): si casi todo coincide, es un lote, y los
 * renglones de la primera página que cambian son datos variables.
 * pagesRuns: renglones de cada página (groupTextRuns). */
export function compareBatchPages(pagesRuns) {
  const [first, ...rest] = pagesRuns;
  if (!first?.length || !rest.length) return { isBatch: false, varying: [] };
  const near = (p, q) => Math.abs(p.y - q.y) <= Math.max(2, p.size * 0.5) && Math.abs((p.x + p.width / 2) - (q.x + q.width / 2)) <= Math.max(40, p.width);
  const varying = new Map();
  let same = 0, total = 0;
  for (const runs of rest) {
    for (const r of first) {
      total++;
      const twin = runs.find(q => near(r, q) && Math.abs(q.size - r.size) <= r.size * 0.15);
      if (twin && twin.text === r.text) { same++; continue; }
      if (!varying.has(r.id)) varying.set(r.id, { id: r.id, text: r.text, values: [] });
      if (twin) varying.get(r.id).values.push(twin.text);
    }
  }
  const isBatch = total > 0 && same / total >= 0.8;
  return { isBatch, pages: pagesRuns.length, varying: isBatch ? [...varying.values()] : [] };
}

const sameStyle = (p, q) => p.family === q.family && p.bold === q.bold && p.italic === q.italic;
/* Sólo puntuación de cierre: no es un elemento propio aunque venga en otra
 * fuente o en negrita («(dato)» + «.» o «, »). */
const CLOSING_PUNCT = /^[.,;:!?)\]»”’%…]+\s*$/;

/* Items → renglones. Se unen los pedazos de un mismo renglón (pdf.js parte
 * el texto por palabras, por cambio de fuente o por kerning); se separan las
 * columnas (un hueco grande) y los cambios de estilo o tamaño, que en una
 * constancia casi siempre son elementos distintos («Otorga a:» y el nombre).
 * Excepciones: la puntuación de cierre pegada se queda con su renglón; las
 * versalitas de Word (letra inicial más grande, resto más chico, pegadas y
 * con el mismo estilo) son una sola palabra; y un «espacio» más ancho que dos
 * cuerpos es una tabulación entre columnas, no un espacio. */
export function groupTextRuns(items, { page = 0 } = {}) {
  const usable = items.filter(it => !it.rotated && it.size > 0 && it.str.length);
  const sorted = [...usable].sort((p, q) => (Math.abs(q.y - p.y) > Math.min(p.size, q.size) * 0.3 ? q.y - p.y : p.x - q.x));
  const runs = [];
  let cur = null;
  const close = () => {
    if (!cur) return;
    const text = cur.text.replace(/\s+/g, " ").trim();
    if (text) {
      /* Espacios del principio: corren la X real del primer carácter visible. */
      runs.push({ ...cur, text });
    }
    cur = null;
  };
  for (const it of sorted) {
    const blank = !it.str.trim();
    if (cur) {
      const sameLine = Math.abs(it.y - cur.y) <= Math.min(it.size, cur.size) * 0.3;
      const similarSize = Math.abs(it.size - cur.size) <= Math.max(it.size, cur.size) * 0.12;
      const gap = it.x - (cur.x + cur.width);
      const near = gap <= cur.size * 0.9 && gap >= -cur.size * 0.5;
      if (sameLine && blank && it.width > cur.size * 2) { close(); continue; }
      const touching = Math.abs(gap) <= Math.max(it.size, cur.size) * 0.08;
      const punct = !blank && CLOSING_PUNCT.test(it.str) && gap <= cur.size * 0.3;
      const smallCaps = touching && sameStyle(it, cur) && Math.min(it.size, cur.size) >= Math.max(it.size, cur.size) * 0.6;
      if (sameLine && near && (blank || (similarSize && sameStyle(it, cur)) || punct || smallCaps)) {
        const needsSpace = !blank && gap > cur.size * 0.12 && !/\s$/.test(cur.text) && !/^\s/.test(it.str);
        cur.text += (needsSpace ? " " : "") + it.str;
        cur.width = Math.max(cur.width, it.x + it.width - cur.x);
        if (smallCaps && !punct) cur.size = Math.max(cur.size, it.size);
        continue;
      }
      close();
    }
    if (blank) continue;
    /* Espacios iniciales dentro del item: se recorta y se ajusta la X con un
     * cuarto de cuerpo por espacio (la medida real no está disponible). */
    const lead = it.str.length - it.str.trimStart().length;
    cur = { page, text: it.str.trimStart(), x: it.x + lead * it.size * 0.25, y: it.y, width: Math.max(0, it.width - lead * it.size * 0.25), size: it.size,
      family: it.family, bold: it.bold, italic: it.italic, fontName: it.fontName };
  }
  close();
  return runs.map((run, i) => finishRun(run, `p${page}-${i}`));
}
function finishRun(run, id) {
  const size = r2(run.size);
  return { id, page: run.page, text: run.text, x: r2(run.x), y: r2(run.y), width: r2(run.width), size,
    family: run.family, bold: run.bold, italic: run.italic, fontName: run.fontName,
    box: { x0: r2(run.x), x1: r2(run.x + run.width), y0: r2(run.y - size * TEXT_DESCENT), y1: r2(run.y + size * TEXT_ASCENT) } };
}

/* Párrafo: renglones apilados con el mismo tamaño y estilo, separados por
 * un interlineado normal (0.9–1.9 cuerpos) y que se traslapan en horizontal.
 * Devuelve los renglones del párrafo de "run", de arriba abajo. */
export function paragraphOf(runs, run) {
  const same = r => r.page === run.page && Math.abs(r.size - run.size) <= run.size * 0.12 && sameStyle(r, run);
  const overlaps = (p, q) => p.box.x0 < q.box.x1 + p.size && q.box.x0 < p.box.x1 + p.size;
  const out = [run];
  const extend = dir => {
    let edge = run;
    for (;;) {
      const next = runs.filter(r => !out.includes(r) && same(r) && overlaps(r, edge))
        .map(r => ({ r, gap: dir * (edge.y - r.y) }))
        .filter(({ gap }) => gap >= edge.size * 0.9 && gap <= edge.size * 1.9)
        .sort((p, q) => p.gap - q.gap)[0];
      if (!next) return;
      out.push(next.r); edge = next.r;
    }
  };
  extend(1); extend(-1);
  return out.sort((p, q) => q.y - p.y);
}

/* Unión de las cajas de varios renglones, con holgura opcional. */
export function unionBox(runs, pad = 0) {
  return {
    x0: r2(Math.min(...runs.map(r => r.box.x0)) - pad), x1: r2(Math.max(...runs.map(r => r.box.x1)) + pad),
    y0: r2(Math.min(...runs.map(r => r.box.y0)) - pad), y1: r2(Math.max(...runs.map(r => r.box.y1)) + pad)
  };
}

/* Alineación con la que se escribió el texto en la plantilla: centrado en la
 * página, a la derecha de algo o a la izquierda. Sólo con un renglón no se
 * puede distinguir «izquierda» de «derecha»; varios renglones de un párrafo
 * sí lo dicen (el borde que coincide). */
export function inferAlignment(runs, pageWidth) {
  const tol = Math.max(2, pageWidth * 0.006);
  const centers = runs.map(r => r.x + r.width / 2);
  if (centers.every(c => Math.abs(c - pageWidth / 2) <= tol)) return "pageCenter";
  if (runs.length > 1) {
    const spread = list => Math.max(...list) - Math.min(...list);
    const lefts = runs.map(r => r.x), rights = runs.map(r => r.x + r.width);
    if (spread(lefts) <= tol) return "left";
    if (spread(centers) <= tol) return "boxCenter";
    if (spread(rights) <= tol) return "boxRight";
  }
  return "left";
}

/* Eje de centrado de la plantilla. Muchas constancias centran su texto en
 * una columna (no en la hoja: a un lado van logos o registros). Si otros
 * renglones comparten el centro de éste, ése es su eje. Un renglón con un
 * marcador de relleno («A: xxxxx») tiene un ancho que no significa nada: se
 * alinea al eje dominante de la página si está cerca. */
const SLOT_TEXT = /(?<![\p{L}\p{N}])\d*(?:[xX]{2,}|X|_{3,}|\.{4,})\d*(?![\p{L}\p{N}])/u;
const centerOf = r => r.x + r.width / 2;
export function centerAxis(lines, allRuns) {
  const c = lines.reduce((s, r) => s + centerOf(r), 0) / lines.length;
  const others = allRuns.filter(r => !lines.includes(r));
  const tol = r => Math.max(2.5, r.size * 0.15);
  const shared = others.filter(r => Math.abs(centerOf(r) - c) <= tol(r)).map(centerOf);
  if (shared.length >= 2) return { axis: median([c, ...shared]), why: "shared" };
  if (lines.some(r => SLOT_TEXT.test(r.text))) {
    /* Eje dominante: el centro que comparten más renglones (3 o más). */
    let best = null;
    for (const r of others) {
      const group = others.filter(q => Math.abs(centerOf(q) - centerOf(r)) <= 2.5).map(centerOf);
      if (group.length >= 3 && (!best || group.length > best.length)) best = group;
    }
    const axis = best && median(best);
    if (axis != null && Math.abs(axis - c) <= 40) return { axis, why: "placeholder" };
  }
  return null;
}
function median(list) { const v = [...list].sort((p, q) => p - q); return v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; }

/* Espacio libre en el renglón a la izquierda y a la derecha de una caja: lo
 * que el dato puede crecer antes de chocar con otro texto o con el margen.
 * Un texto de la plantilla cuenta como obstáculo si comparte la franja
 * vertical de la caja. */
export function freeSpan(runs, box, pageWidth, { ignore = [] } = {}) {
  let left = PAGE_MARGIN, right = pageWidth - PAGE_MARGIN;
  for (const r of runs) {
    if (ignore.includes(r)) continue;
    if (r.box.y1 <= box.y0 || r.box.y0 >= box.y1) continue;
    if (r.box.x1 <= box.x0) left = Math.max(left, r.box.x1 + 4);
    else if (r.box.x0 >= box.x1) right = Math.min(right, r.box.x0 - 4);
  }
  return { left: r2(Math.min(left, box.x0)), right: r2(Math.max(right, box.x1)) };
}

/* El espacio libre también termina en la tinta del fondo: adornos, marcos,
 * logos y líneas que comparten la franja del renglón. Recorre columnas desde
 * la caja hacia afuera y se detiene en la primera con tinta en más del 12 %
 * de la franja (dejando "gap" pt de aire). raster = { gray, width, height,
 * pageWidth } a cualquier escala. */
export function narrowByInk(raster, pageHeight, box, span, { gap = 6 } = {}) {
  if (!raster?.gray) return span;
  const s = raster.width / raster.pageWidth;
  const y0 = Math.max(0, Math.round((pageHeight - box.y1) * s)), y1 = Math.min(raster.height - 1, Math.round((pageHeight - box.y0) * s));
  if (y1 <= y0) return span;
  const blocked = x => {
    let n = 0;
    for (let y = y0; y <= y1; y++) if (raster.gray[y * raster.width + x] < 160) n++;
    return n / (y1 - y0 + 1) > 0.12;
  };
  let left = span.left, right = span.right;
  for (let x = Math.floor((box.x0 - gap) * s); x >= Math.max(0, Math.round(span.left * s)); x--) {
    if (blocked(x)) { left = Math.min(box.x0, x / s + gap); break; }
  }
  for (let x = Math.ceil((box.x1 + gap) * s); x <= Math.min(raster.width - 1, Math.round(span.right * s)); x++) {
    if (blocked(x)) { right = Math.max(box.x1, x / s - gap); break; }
  }
  return { left: r2(left), right: r2(right) };
}

/* Renglones seleccionados → propiedades de un campo de texto que dibuja su
 * dato EXACTAMENTE donde estaba el texto del ejemplo: misma línea base, mismo
 * tamaño, misma fuente y la alineación con que se escribió.
 *
 * Un dato variable (un nombre, un curso) puede ser más largo que el ejemplo:
 * la caja abarca el espacio libre del renglón y, en un renglón, el texto se
 * reduce solo si no cabe (shrink: nunca se parte ni pierde palabras). Centrado en la página, la caja es simétrica respecto al centro
 * para que el dato siga centrado. Varios renglones → un párrafo con el mismo
 * interlineado y, como mínimo, las líneas del ejemplo.
 *
 * opts.variable = false: texto fijo que se corrige (sin caja que crezca). */
/* Gráfico de la plantilla que enmarca un texto: un sello, un listón o una
 * placa con el texto centrado dentro («AGOSTO / 2026» en el sello). Es el más
 * chico que contiene la caja del texto y cuyo centro coincide con el de éste.
 * frames: cajas { x0, x1, y0, y1 } en puntos PDF. */
export function frameAround(box, frames = []) {
  const cx = (box.x0 + box.x1) / 2;
  const fits = frames.filter(f => f.x0 <= box.x0 + 0.5 && f.x1 >= box.x1 - 0.5 && f.y0 <= box.y0 + 0.5 && f.y1 >= box.y1 - 0.5
    && Math.abs((f.x0 + f.x1) / 2 - cx) <= Math.max(2, (f.x1 - f.x0) * 0.1));
  return fits.sort((p, q) => (p.x1 - p.x0) * (p.y1 - p.y0) - (q.x1 - q.x0) * (q.y1 - q.y0))[0] || null;
}

export function fieldGeometryFromRuns(runs, { pageWidth, allRuns = runs, variable = true, narrow = null, frames = [] } = {}) {
  const lines = [...runs].sort((p, q) => q.y - p.y);
  const first = lines[0];
  const size = half(lines.reduce((s, r) => s + r.size, 0) / lines.length);
  const align = inferAlignment(lines, pageWidth);
  const box = unionBox(lines);
  const geo = { size, y: first.y };
  if (lines.length > 1) {
    const gaps = lines.slice(1).map((r, i) => lines[i].y - r.y);
    geo.lineHeight = r2(gaps.reduce((s, g) => s + g, 0) / gaps.length);
    geo.maxLines = lines.length;
  }
  /* Dentro de un gráfico: el texto se centra en el gráfico y no sale de él;
   * un mes más largo que «AGOSTO» se reduce en vez de salirse del sello.
   * Vale igual para un dato que para un texto editado. */
  const frame = frameAround(box, frames);
  if (frame) {
    const center = (frame.x0 + frame.x1) / 2;
    const halfWidth = Math.max((box.x1 - box.x0) / 2, (frame.x1 - frame.x0) / 2 * 0.8);
    return { ...geo, align: "boxCenter", x: r2(center - halfWidth), width: r2(halfWidth * 2),
      ...(lines.length > 1 ? { fit: true, maxLines: geo.maxLines } : { shrink: true }) };
  }
  if (!variable) {
    if (align === "pageCenter") return { ...geo, align: "pageCenter" };
    if (lines.length > 1) return { ...geo, align, x: box.x0, width: r2(box.x1 - box.x0), fit: true };
    return { ...geo, align: "left", x: first.x };
  }
  let span = freeSpan(allRuns, box, pageWidth, { ignore: lines });
  if (narrow) span = narrow(box, span);
  const axis = centerAxis(lines, allRuns);
  const flow = lines.length > 1 ? { fit: true, maxLines: geo.maxLines } : { shrink: true };
  if (align === "pageCenter" || align === "boxCenter" || axis) {
    /* Centrado: en el eje de la plantilla si lo hay; en la hoja, su centro
     * exacto (no el de la medida de pdf.js, que suma fracciones de punto). */
    const center = axis && !(align === "pageCenter" && Math.abs(axis.axis - pageWidth / 2) <= 2.5) ? axis.axis
      : align === "pageCenter" ? pageWidth / 2 : (box.x0 + box.x1) / 2;
    const halfWidth = Math.max((box.x1 - box.x0) / 2, Math.min(center - span.left, span.right - center));
    return { ...geo, align: "boxCenter", x: r2(center - halfWidth), width: r2(halfWidth * 2), ...flow };
  }
  if (align === "boxRight") return { ...geo, align: "boxRight", x: span.left, width: r2(box.x1 - span.left), ...flow };
  return { ...geo, align: "left", x: box.x0, width: r2(Math.max(box.x1, span.right) - box.x0), ...flow };
}

/* Color de fondo bajo un texto, para taparlo sin que se note: la mediana de
 * los píxeles de un anillo alrededor de su caja (el papel), no la de la caja
 * (que tiene la tinta). raster = { rgba, width, height } de la página a
 * "scale" píxeles por punto. Sin raster, blanco. */
export function backgroundColorAround(raster, pageHeight, box, pad = 2) {
  if (!raster?.rgba) return "#ffffff";
  const s = raster.width / raster.pageWidth;
  const px = x => Math.round(x * s), py = y => Math.round((pageHeight - y) * s);
  const x0 = Math.max(0, px(box.x0 - pad)), x1 = Math.min(raster.width - 1, px(box.x1 + pad));
  const y0 = Math.max(0, py(box.y1 + pad)), y1 = Math.min(raster.height - 1, py(box.y0 - pad));
  const samples = [];
  const take = (x, y) => { const i = (y * raster.width + x) * 4; samples.push([raster.rgba[i], raster.rgba[i + 1], raster.rgba[i + 2]]); };
  for (let x = x0; x <= x1; x += 1) { take(x, y0); take(x, y1); }
  for (let y = y0; y <= y1; y += 1) { take(x0, y); take(x1, y); }
  if (!samples.length) return "#ffffff";
  const median = k => { const v = samples.map(c => c[k]).sort((p, q) => p - q); return v[v.length >> 1]; };
  return "#" + [0, 1, 2].map(k => median(k).toString(16).padStart(2, "0")).join("");
}

const hexRgb = hex => [1, 3, 5].map(i => parseInt(String(hex).slice(i, i + 2), 16));
const colorDistance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/* Color de la tinta del texto: la mediana de los píxeles claramente
 * distintos del fondo dentro de su caja. Con `paperHex` (el fondo real,
 * backgroundColorAround) también se lee texto claro sobre fondo oscuro
 * («AGOSTO» blanco en un sello azul); sin él, lo claramente oscuro.
 * null si no hay tinta legible. */
export function inkColorInside(raster, pageHeight, box, paperHex = null) {
  if (!raster?.rgba) return null;
  const s = raster.width / raster.pageWidth;
  const x0 = Math.max(0, Math.round(box.x0 * s)), x1 = Math.min(raster.width - 1, Math.round(box.x1 * s));
  const y0 = Math.max(0, Math.round((pageHeight - box.y1) * s)), y1 = Math.min(raster.height - 1, Math.round((pageHeight - box.y0) * s));
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const paper = paperHex ? hexRgb(paperHex) : null;
  const isInk = paper ? c => colorDistance(c, paper) > 120 : c => lum(...c) < 140;
  const ink = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * raster.width + x) * 4, c = [raster.rgba[i], raster.rgba[i + 1], raster.rgba[i + 2]];
    if (isInk(c)) ink.push(c);
  }
  if (ink.length < 4) return null;
  const median = k => { const v = ink.map(c => c[k]).sort((p, q) => p - q); return v[v.length >> 1]; };
  return "#" + [0, 1, 2].map(k => median(k).toString(16).padStart(2, "0")).join("");
}

/* Gráfico dibujado DENTRO de la imagen de la plantilla (un sello o un
 * listón que no es un objeto aparte): la mancha de color de fondo alrededor
 * del texto, medida en el raster desde los bordes del texto hasta que el
 * color cambia. Sólo cuenta un fondo que no es papel blanco: sobre la hoja,
 * el centrado lo deciden los demás textos. null si no hay. */
export function frameFromRaster(raster, pageHeight, box, paperHex, inkHex = null) {
  if (!raster?.rgba || !paperHex) return null;
  const paper = hexRgb(paperHex), ink = inkHex ? hexRgb(inkHex) : null;
  if (colorDistance(paper, [255, 255, 255]) < 60) return null;
  const s = raster.width / raster.pageWidth;
  const at = (x, y) => { const i = (y * raster.width + x) * 4; return [raster.rgba[i], raster.rgba[i + 1], raster.rgba[i + 2]]; };
  /* Fondo, letra o el suavizado entre ambos (un punto cerca del segmento
   * fondo–tinta): se recorre desde el centro del texto atravesando sus
   * letras, porque el ancho que da pdf.js puede pasarse del dibujo real. */
  const onSegment = c => {
    if (!ink) return false;
    const d = ink.map((v, k) => v - paper[k]), len2 = d.reduce((a, v) => a + v * v, 0) || 1;
    const t = Math.max(0, Math.min(1, d.reduce((a, v, k) => a + v * (c[k] - paper[k]), 0) / len2));
    return colorDistance(c, paper.map((v, k) => v + d[k] * t)) <= 40;
  };
  const inside = (x, y) => { const c = at(x, y); return colorDistance(c, paper) <= 60 || onSegment(c); };
  const row = Math.round((pageHeight - (box.y0 + box.y1) / 2) * s), col = Math.round((box.x0 + box.x1) / 2 * s);
  if (row < 0 || row >= raster.height || col < 0 || col >= raster.width || !inside(col, row)) return null;
  let left = col, right = col, top = row, bottom = row;
  while (left > 0 && inside(left - 1, row)) left--;
  while (right < raster.width - 1 && inside(right + 1, row)) right++;
  while (top > 0 && inside(col, top - 1)) top--;
  while (bottom < raster.height - 1 && inside(col, bottom + 1)) bottom++;
  const frame = { x0: r2(left / s), x1: r2((right + 1) / s), y0: r2(pageHeight - (bottom + 1) / s), y1: r2(pageHeight - top / s) };
  /* Un fondo de color que cubre media hoja es el diseño de la página, no
   * un marco del texto. */
  return frame.x1 - frame.x0 < raster.pageWidth * 0.5 ? frame : null;
}

/* Máscara de respaldo para texto que no pudo retirarse con seguridad.
 * Se dibuja antes de cualquier campo y cubre el antialias. */
export function maskFromRuns(runs, colorHex = "#ffffff", pad = 1.2) {
  const b = unionBox(runs, pad);
  return { x: b.x0, y: b.y0, width: r2(b.x1 - b.x0), height: r2(b.y1 - b.y0), colorHex };
}

export function isRemovedSourceText(field, run) {
  const source = field.source;
  if (!(field.textReplacement || field.textReplacements?.length) || !source?.text || !run?.box) return false;
  const normalize = value => String(value ?? "").replace(/\s+/g, " ").trim();
  const candidates = source.runs || [{ text: source.text, box: source.box }];
  return candidates.some(candidate => {
    if (normalize(run.text) !== normalize(candidate.text) || !candidate.box) return false;
    const overlapX = Math.max(0, Math.min(candidate.box.x1, run.box.x1) - Math.max(candidate.box.x0, run.box.x0));
    const overlapY = Math.max(0, Math.min(candidate.box.y1, run.box.y1) - Math.max(candidate.box.y0, run.box.y0));
    const area = Math.max(0, run.box.x1 - run.box.x0) * Math.max(0, run.box.y1 - run.box.y0);
    return area > 0 && overlapX * overlapY >= area * 0.8;
  });
}

export function setTextFieldBinding(field, path, template = null) {
  if (template) {
    field.textTemplate = template;
    delete field.dataKey;
  } else {
    field.dataKey = path;
    delete field.textTemplate;
  }
  delete field.literalText;
  return field;
}

/* ¿El texto de la plantilla ya está tapado o usado por algún campo? Sirve
 * para pintar de otro color lo que ya se mapeó y para el preflight. */
export function runCoverage(run, fields) {
  const inside = (m, b) => b.x0 >= m.x - 0.5 && b.x1 <= m.x + m.width + 0.5 && b.y0 >= m.y - 0.5 && b.y1 <= m.y + m.height + 0.5;
  for (const f of fields) {
    if ((f.page || 0) !== run.page) continue;
    if (isRemovedSourceText(f, run)) return { covered: true, fieldId: f.id };
    if (f.mask && inside(f.mask, run.box)) return { covered: true, fieldId: f.id };
  }
  return { covered: false, fieldId: null };
}
