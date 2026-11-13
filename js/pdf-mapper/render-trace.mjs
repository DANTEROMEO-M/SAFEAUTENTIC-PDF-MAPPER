/* Lee un renderer del ClientPackage EJECUTÁNDOLO, no leyendo su texto.
 *
 * El renderer (render({ page, pdfDoc, data, pdfLib })) se corre contra un
 * PDF «grabador»: una página y un pdf-lib simulados que anotan cada
 * drawText/drawImage/drawRectangle con su posición, tamaño, fuente y color.
 * Los datos son marcadores únicos por ruta (record.nombre → «Zq3qZ …»), así
 * que en lo que se dibuja se reconoce qué dato va en cada lugar, con qué
 * texto fijo alrededor («A: {record.nombre}») y si se pasó a mayúsculas.
 *
 * Lo que el código calcula al dibujar se mide variando las condiciones entre
 * corridas (el renderer es determinista):
 *   · alineación: con anchos de texto distintos, la x de un texto a la
 *     izquierda no cambia, la de uno centrado se mueve la mitad del cambio
 *     de ancho y la de uno a la derecha, todo el cambio;
 *   · ancho de caja: el ancho a partir del cual el código empieza a reducir
 *     la letra o a partir la línea (búsqueda binaria por dato);
 *   · renglones e interlineado: con anchos enormes, cuántas líneas dibuja y
 *     a qué distancia;
 *   · caja de imagen: con una imagen muy ancha y otra muy alta, la unión de
 *     lo dibujado es la caja donde el código la acomoda.
 *
 * Nada de esto toca la red, Firebase ni el DOM: sólo el renderer y objetos
 * en memoria. Lo que no se reconoce se reporta (unsupported), no se inventa. */

const IMAGE_KEY = /(png|jpe?g|image|img|qr|logo|firma|signature|sello|seal|foto|photo)/i;
const WORDS = 8;                       // palabras por dato: deja ver el corte en renglones
const TINY = 1e-4, SMALL = 0.02, HUGE = 400;

const STANDARD = {
  Helvetica: ["Helvetica", false, false], HelveticaBold: ["Helvetica", true, false],
  HelveticaOblique: ["Helvetica", false, true], HelveticaBoldOblique: ["Helvetica", true, true],
  TimesRoman: ["TimesRoman", false, false], TimesRomanBold: ["TimesRoman", true, false],
  TimesRomanItalic: ["TimesRoman", false, true], TimesRomanBoldItalic: ["TimesRoman", true, true],
  Courier: ["Courier", false, false], CourierBold: ["Courier", true, false],
  CourierOblique: ["Courier", false, true], CourierBoldOblique: ["Courier", true, true]
};
export function fontStyleOf(name) {
  const hit = STANDARD[name];
  return hit ? { family: hit[0], bold: hit[1], italic: hit[2], standard: true } : { family: "Helvetica", bold: /bold/i.test(name || ""), italic: /italic|oblique/i.test(name || ""), standard: false };
}

const r2 = v => Math.round(v * 100) / 100;
const hex = c => "#" + [c.r, c.g, c.b].map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");
const MARK = /zq(\d+)qz/gi;

/* ---- Datos marcados ---------------------------------------------------
 * Cada ruta leída devuelve un objeto que se comporta como texto (métodos de
 * String, ${}, String(), clean()) y que a la vez admite propiedades
 * anidadas (data.pki.line1). Las rutas con nombre de imagen devuelven una
 * imagen simulada que embedImage acepta tal cual. */
function markedData(images) {
  const paths = [];                                   // id → ruta
  const idOf = path => { let i = paths.indexOf(path); if (i < 0) { paths.push(path); i = paths.length - 1; } return i; };
  const wordsFor = path => Array.from({ length: WORDS }, () => `Zq${idOf(path)}qZ`).join(" ");
  const node = path => {
    const str = wordsFor(path);
    const target = new String(str);
    return new Proxy(target, {
      get(t, prop) {
        if (prop === Symbol.toPrimitive) return () => str;
        if (prop === "toString" || prop === "valueOf") return () => str;
        if (prop === "length") return str.length;
        if (typeof prop === "symbol") return str[prop]?.bind?.(str);
        if (typeof String.prototype[prop] === "function") return (...args) => String.prototype[prop].apply(str, args);
        if (/^\d+$/.test(prop)) return str[prop];
        return child(path + "." + prop);
      }
    });
  };
  const child = path => IMAGE_KEY.test(path.split(".").pop()) ? images(path) : node(path);
  const root = new Proxy({}, {
    get(_, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop === "record" || prop === "data") return recordProxy;
      if (prop === "then") return undefined;          // no es una promesa
      return child("data." + prop);
    }
  });
  const recordProxy = new Proxy({}, {
    get(_, prop) {
      if (typeof prop === "symbol" || prop === "then") return undefined;
      return child("record." + prop);
    }
  });
  return { data: root, paths };
}

/* ---- PDF grabador ------------------------------------------------------ */
function recorder({ width, height, factorFor, imageShape }) {
  const ops = [], unsupported = new Set();
  /* Último texto CON dato que el código midió: un renglón sin marcador que
   * se dibuja después es un pedazo de ese dato (drawFit mide el candidato
   * completo y luego dibuja sólo lo que cupo). */
  let lastMarked = "";
  const fontObj = name => ({
    name,
    widthOfTextAtSize: (text, size) => { const t = String(text ?? ""); if (marksIn(t).length) lastMarked = t; return t.length * size * factorFor(t); },
    heightAtSize: size => size * 0.72,
    sizeAtHeight: h => h / 0.72,
    encodeText: t => t
  });
  const page = new Proxy({
    getSize: () => ({ width, height }),
    getWidth: () => width,
    getHeight: () => height,
    getMediaBox: () => ({ x: 0, y: 0, width, height }),
    getCropBox: () => ({ x: 0, y: 0, width, height }),
    getRotation: () => ({ angle: 0 }),
    drawText: (text, o = {}) => ops.push({ kind: "text", ctx: lastMarked, text: String(text ?? ""), x: +o.x || 0, y: +o.y || 0, size: +o.size || 24, font: o.font?.name || "Helvetica", color: o.color, opacity: o.opacity, rotate: o.rotate }),
    drawImage: (img, o = {}) => ops.push({ kind: "image", key: img?.__key || null, x: +o.x || 0, y: +o.y || 0, width: +o.width || img?.width || 0, height: +o.height || img?.height || 0, opacity: o.opacity }),
    drawRectangle: (o = {}) => ops.push({ kind: "rect", x: +o.x || 0, y: +o.y || 0, width: +o.width || 0, height: +o.height || 0, color: o.color, borderColor: o.borderColor, borderWidth: o.borderWidth, opacity: o.opacity })
  }, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop === "string" && /^draw/.test(prop)) return () => unsupported.add(prop);
      return () => undefined;
    }
  });
  const embedded = () => ({ width: 100, height: 100, __key: null, scale: () => ({ width: 100, height: 100 }) });
  const pdfDoc = new Proxy({
    embedFont: async name => fontObj(typeof name === "string" ? name : "custom"),
    embedStandardFont: name => fontObj(name),
    embedPng: async () => embedded(),
    embedJpg: async () => embedded(),
    getPages: () => [page],
    getPage: () => page,
    getPageCount: () => 1,
    registerFontkit: () => {}
  }, { get(t, prop) { return prop in t ? t[prop] : (prop === "then" ? undefined : () => undefined); } });
  const pdfLib = {
    rgb: (r, g, b) => ({ r, g, b }),
    cmyk: (c, m, y, k) => ({ r: (1 - c) * (1 - k), g: (1 - m) * (1 - k), b: (1 - y) * (1 - k) }),
    grayscale: g => ({ r: g, g, b: g }),
    degrees: d => d,
    StandardFonts: new Proxy({}, { get: (_, k) => (typeof k === "string" ? k : undefined) })
  };
  const images = path => {
    const [w, h] = imageShape(path);
    return { width: w, height: h, __key: path, scale: s => ({ width: w * s, height: h * s }), scaleToFit: (mw, mh) => { const k = Math.min(mw / w, mh / h); return { width: w * k, height: h * k }; } };
  };
  return { page, pdfDoc, pdfLib, ops, unsupported, images };
}

async function run(render, opts) {
  const rec = recorder(opts);
  const { data, paths } = markedData(rec.images);
  await render({ page: rec.page, pdfDoc: rec.pdfDoc, data, pdfLib: rec.pdfLib, context: {} });
  return { ops: rec.ops, unsupported: [...rec.unsupported], paths };
}

/* Ids de dato en un texto dibujado y su transformación de mayúsculas. */
function marksIn(text) {
  const out = [];
  for (const m of String(text).matchAll(MARK)) out.push({ id: +m[1], raw: m[0] });
  return out;
}
function caseOf(raw) { return raw[1] === "Q" ? "uppercase" : raw[0] === "z" ? "lowercase" : ""; }

/* Texto dibujado → plantilla («A: {record.nombre}»): cada racha de
 * marcadores del mismo dato es una sola variable. */
function templateOf(text, paths) {
  return String(text).replace(new RegExp(`(?:${MARK.source})(?:\\s*(?:${MARK.source}))*`, "gi"), m => {
    const id = +m.match(/(\d+)/)[1];
    return "{" + paths[id] + "}";
  });
}

/* ---- Corrida principal ------------------------------------------------- */
export async function traceRender(render, { width, height }) {
  const wide = () => [1000, 10], tall = () => [10, 1000];
  const base = { width, height, imageShape: wide };
  const r0 = await run(render, { ...base, factorFor: () => TINY });
  const r1 = await run(render, { ...base, factorFor: () => SMALL });
  const rTall = await run(render, { ...base, imageShape: tall, factorFor: () => TINY });
  const paths = r0.paths;
  const unsupported = new Set(r0.unsupported);

  /* Textos: agrupa por dato (o por texto fijo) en el orden en que se dibujan. */
  const texts = r0.ops.map((op, i) => ({ op, i })).filter(t => t.op.kind === "text");
  const texts1 = r1.ops.filter(o => o.kind === "text");
  const sameShape = texts1.length === texts.length;

  /* Ancho de caja por dato: el factor mínimo con el que el código ya reduce
   * la letra o parte el renglón. */
  const ids = [...new Set(texts.flatMap(t => marksIn(t.op.text).map(m => m.id)))];
  /* Renglones por dato. Un renglón sin marcador que no existe como texto
   * fijo en la corrida base es un pedazo de ese dato (el «A:» que quedó
   * solo al partir «A: <nombre>»): se cuenta con el dato que sigue. */
  const literalBase = r0.ops.filter(o => o.kind === "text" && !marksIn(o.text).length).map(o => o.text);
  const sig = ops => {
    const by = {}, free = [...literalBase];
    const textOps = ops.filter(o => o.kind === "text");
    textOps.forEach((o, k) => {
      const ids = new Set(marksIn(o.text).map(m => m.id));
      if (!ids.size) {
        const at = free.indexOf(o.text);
        if (at >= 0) { free.splice(at, 1); return; }
        const from = marksIn(o.ctx || "")[0];
        if (from) ids.add(from.id);
      }
      for (const id of ids) (by[id] ||= []).push(o);
    });
    return by;
  };
  const baseBy = sig(r0.ops);
  const reacts = (by, id) => {
    const a = baseBy[id] || [], b = by[id] || [];
    if (b.length !== a.length) return true;
    return b.some((o, k) => o.size < a[k].size - 1e-6 || o.text !== a[k].text);
  };
  const threshold = {};
  if (ids.length) {
    let lo = Object.fromEntries(ids.map(id => [id, TINY])), hi = Object.fromEntries(ids.map(id => [id, HUGE]));
    const hugeRun = await run(render, { ...base, factorFor: t => { const ms = marksIn(t); return ms.length ? HUGE : TINY; } });
    const hugeBy = sig(hugeRun.ops);
    const fits = ids.filter(id => reacts(hugeBy, id));
    for (let step = 0; step < 28 && fits.length; step++) {
      const mid = Object.fromEntries(fits.map(id => [id, Math.sqrt(lo[id] * hi[id])]));
      const probe = await run(render, { ...base, factorFor: t => { const ms = marksIn(t); return ms.length ? Math.max(...ms.map(m => mid[m.id] ?? TINY)) : TINY; } });
      const by = sig(probe.ops);
      for (const id of fits) { if (reacts(by, id)) hi[id] = mid[id]; else lo[id] = mid[id]; }
    }
    for (const id of fits) {
      /* Primera vez que reacciona: el ancho medido de lo que se comparó. */
      const probe = await run(render, { ...base, factorFor: t => { const ms = marksIn(t); return ms.length ? Math.max(...ms.map(m => (m.id === id ? hi[id] : TINY))) : TINY; } });
      const before = baseBy[id] || [], after = sig(probe.ops)[id] || [];
      const first = before[0];
      let measured = first.text;
      if (after.length > before.length && after[0]) {
        /* Se partió: lo comparado fue el primer renglón más la palabra que ya no cupo. */
        const next = (after[1]?.text || "").split(" ")[0];
        measured = after[0].text + " " + next;
      }
      const lines = hugeBy[id] || [];
      threshold[id] = {
        width: measured.length * first.size * hi[id],
        lines: Math.max(1, lines.length),
        lineHeight: lines.length > 1 ? r2(lines[0].y - lines[1].y) : null,
        /* Parte en renglones (o recorta lo que no cabe en sus renglones)
         * en vez de sólo reducir la letra. */
        wraps: lines.length > 1 || lines.reduce((n, o) => n + marksIn(o.text).length, 0) < before.reduce((n, o) => n + marksIn(o.text).length, 0)
      };
    }
  }

  const elements = [];
  const usedText = new Set();
  /* Casillas: un carácter por llamada, en la misma línea (drawCharacters). */
  for (let k = 0; k < texts.length; k++) {
    if (usedText.has(k)) continue;
    const t = texts[k].op;
    if (t.text.length === 1) {
      const seq = [k];
      while (k + seq.length < texts.length && texts[k + seq.length].op.text.length === 1 && Math.abs(texts[k + seq.length].op.y - t.y) < 0.01 && texts[k + seq.length].op.size === t.size) seq.push(k + seq.length);
      if (seq.length >= 3) {
        seq.forEach(j => usedText.add(j));
        /* Dos grupos seguidos en la misma línea (fecha de inicio y de fin)
         * se separan donde empieza el marcador de otro dato. */
        for (const part of splitCharacterRuns(seq.map(j => texts[j].op.text).join(""))) {
          const ops = seq.slice(part.from, part.to).map(j => texts[j].op);
          elements.push({ kind: "characters", path: part.id != null ? paths[part.id] : null, y: r2(t.y), size: t.size, font: t.font, color: t.color,
            centers: ops.map(o => r2(o.x + o.text.length * o.size * TINY / 2)), allowHyphen: false });
        }
      }
    }
  }
  /* Textos de un dato: los renglones del mismo dato se juntan en uno. */
  const seen = new Set();
  texts.forEach((t, k) => {
    if (usedText.has(k)) return;
    const op = t.op, ms = marksIn(op.text);
    const id = ms.length ? ms[0].id : null;
    if (id != null && seen.has(id) && baseBy[id]?.length > 1) return;   // otro renglón ya agrupado
    if (id != null) seen.add(id);
    const op1 = sameShape ? texts1[k] : null;
    const w0 = op.text.length * op.size * TINY, w1 = op1 ? op1.text.length * op1.size * SMALL : w0;
    const slope = op1 && Math.abs(w1 - w0) > 1e-6 ? (op1.x - op.x) / (w1 - w0) : 0;
    const align = slope < -0.75 ? "right" : slope < -0.25 ? "center" : "left";
    const anchor = op.x - slope * w0;                   // el punto de alineación (ancho 0)
    const th = id != null ? threshold[id] : null;
    elements.push({
      kind: "text", path: id != null ? paths[id] : null,
      template: id != null ? templateOf(op.text, paths) : null,
      literal: id == null ? op.text : null,
      textCase: ms.length ? caseOf(ms[0].raw) : "",
      x: anchor, y: r2(op.y), size: op.size, font: op.font, color: op.color, opacity: op.opacity, rotate: op.rotate,
      align, boxWidth: th?.width ?? null, maxLines: th?.lines ?? 1, lineHeight: th?.lineHeight ?? null, wraps: !!th?.wraps, fits: !!th
    });
  });

  /* Imágenes: unión de lo dibujado con imagen ancha y con imagen alta. */
  const imgs0 = r0.ops.filter(o => o.kind === "image"), imgsT = rTall.ops.filter(o => o.kind === "image");
  imgs0.forEach((a, k) => {
    const b = imgsT[k] && imgsT[k].key === a.key ? imgsT[k] : a;
    const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x + a.width, b.x + b.width), y1 = Math.max(a.y + a.height, b.y + b.height);
    const leftAligned = Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - x0) < 0.01 && a.width !== b.width;
    elements.push({ kind: "image", path: a.key, x: r2(x0), y: r2(y0), width: r2(x1 - x0), height: r2(y1 - y0), hAlign: leftAligned ? "left" : "center" });
  });
  r0.ops.filter(o => o.kind === "rect").forEach(o => elements.push({ kind: "rect", x: r2(o.x), y: r2(o.y), width: r2(o.width), height: r2(o.height),
    fill: o.color ? hex(o.color) : null, border: o.borderColor ? hex(o.borderColor) : null, borderWidth: o.borderWidth ?? (o.borderColor ? 1 : 0), opacity: o.opacity }));
  return { elements, paths, unsupported: [...unsupported] };
}

/* ---- Elementos → campos del editor -------------------------------------
 * style(font) lo pone el editor (setTextStyle): aquí sólo se dice familia,
 * negrita y cursiva. */
export function fieldsFromTrace(trace, { pageWidth }) {
  const fields = [], notes = [];
  const ids = new Set();
  const idFor = base => {
    let id = String(base || "campo").split(".").pop().replace(/\W+/g, "") || "campo";
    if (!/^[A-Za-z_]/.test(id)) id = "campo" + id;
    let n = 1, out = id;
    while (ids.has(out)) out = id + ++n;
    ids.add(out);
    return out;
  };
  const colorOf = (f, c, opacity) => {
    const h = c ? hex(c) : "#000000";
    if (h === "#000000" && (opacity == null || opacity >= 1)) f.color = "black";
    else f.colorHex = h;
  };
  const imgs = trace.elements.filter(e => e.kind === "image");
  const qrs = [];
  for (const e of imgs) {
    const leaf = String(e.path || "").split(".").pop();
    if (/qr/i.test(leaf)) {
      const f = { id: idFor("qr"), type: "qr", x: e.x, y: e.y, width: e.width, height: e.height, frame: { enabled: false, color: "black", width: 1 }, captionTop: null, captionBottom: null, dataKey: "qrImage" };
      fields.push(f); qrs.push(f);
    } else {
      const sig = /firma|signature/i.test(leaf);
      fields.push({ id: idFor(sig ? "firma" : leaf || "imagen"), type: "image", x: e.x, y: e.y, width: e.width, height: e.height, hAlign: e.hAlign, dataKey: e.path || "data.imagen" });
    }
  }
  const rects = trace.elements.filter(e => e.kind === "rect");
  const placeRects = () => { for (const r of rects) {
    const qr = qrs.find(q => r.x <= q.x + 0.01 && r.y <= q.y + 0.01 && r.x + r.width >= q.x + q.width - 0.01 && r.y + r.height >= q.y + q.height - 0.01 && r.x >= q.x - 20 && r.y >= q.y - 20);
    if (qr && r.border && !r.fill) {
      const pad = r2(Math.max(0, q0(qr.x - r.x)));
      qr.frame = { enabled: true, colorHex: r.border, width: r.borderWidth || 1, ...(pad ? { padding: pad } : {}) };
      if (r.border === "#000000") { delete qr.frame.colorHex; qr.frame.color = "black"; }
    } else if (qr && r.fill && !r.border) {
      qr.frame = { ...qr.frame, background: r.fill };
    } else {
      /* Relleno sin borde bajo un texto: el parche que tapa el ejemplo de
       * la plantilla. Va como "mask" de ese campo. */
      const host = r.fill && !r.border && fields.find(f => f.type === "text" && !f.mask && f.y >= r.y - 1 && f.y <= r.y + r.height + 1 &&
        (f.width ? Math.min(f.x + f.width, r.x + r.width) - Math.max(f.x, r.x) > 0 : f.x == null || (f.x >= r.x - 2 && f.x <= r.x + r.width)));
      if (host) host.mask = { x: r.x, y: r.y, width: r.width, height: r.height, colorHex: r.fill };
      else if (r.fill && !r.border) fields.push({ id: idFor("parche"), type: "text", literalText: "", x: r.x, y: r2(r.y + r.height / 2), size: 10, align: "left",
        mask: { x: r.x, y: r.y, width: r.width, height: r.height, colorHex: r.fill }, color: "black" });
      else notes.push(`Un rectángulo en (${r.x}, ${r.y}) de ${r.width}×${r.height} no se pudo representar en el editor`);
    }
  } };
  for (const e of trace.elements) {
    if (e.kind === "characters") {
      const f = { id: idFor(e.path || "casillas"), type: "characters", y: e.y, size: e.size, font: fontStyleOf(e.font), centers: e.centers, allowHyphen: false };
      if (e.path) f.dataKey = e.path; else f.needsReview = true;
      colorOf(f, e.color, e.opacity);
      fields.push(f);
      continue;
    }
    if (e.kind !== "text") continue;
    /* Texto fijo pegado a un QR: es su leyenda de arriba o de abajo. */
    if (e.literal != null) {
      const qr = qrs.find(q => Math.abs(e.x - (q.x + q.width / 2)) < 1.5 && e.align === "center" && (e.y >= q.y + q.height - 1 && e.y <= q.y + q.height + 25 || e.y <= q.y && e.y >= q.y - 25));
      if (qr) {
        const slot = e.y >= qr.y + qr.height - 1 ? "captionTop" : "captionBottom";
        if (!qr[slot]) {
          const cap = { text: e.literal, size: e.size, font: fontStyleOf(e.font), offsetY: r2(slot === "captionTop" ? e.y - (qr.y + qr.height) : e.y - qr.y) };
          colorOf(cap, e.color, e.opacity);
          qr[slot] = cap;
          continue;
        }
      }
    }
    const f = { id: idFor(e.path || e.literal?.trim().split(/\s+/)[0] || "texto"), type: "text", y: e.y, size: e.size, font: fontStyleOf(e.font) };
    if (e.path) {
      f.dataKey = e.path;
      if (e.template && e.template !== "{" + e.path + "}") f.textTemplate = e.template;
      if (e.textCase) f.textCase = e.textCase;
    } else f.literalText = e.literal;
    colorOf(f, e.color, e.opacity);
    if (e.boxWidth) {
      /* El código ajusta a una caja: ancla + ancho medido. */
      const w = e.boxWidth;
      f.width = r2(w);
      f.x = r2(e.align === "center" ? e.x - w / 2 : e.align === "right" ? e.x - w : e.x);
      f.align = e.align === "center" ? "boxCenter" : e.align === "right" ? "boxRight" : "left";
      if (e.wraps) Object.assign(f, { fit: true, maxLines: e.maxLines, ...(e.lineHeight ? { lineHeight: e.lineHeight } : {}) });
      else f.shrink = true;
    } else if (e.align === "center" && Math.abs(e.x - pageWidth / 2) < 1) {
      f.align = "pageCenter";
    } else if (e.align === "center" || e.align === "right") {
      /* Centrado en un punto sin caja: la caja más ancha que cabe en la página. */
      const half = Math.min(e.x, pageWidth - e.x);
      const w = e.align === "center" ? r2(half * 2) : r2(e.x);
      f.width = w;
      f.x = r2(e.align === "center" ? e.x - w / 2 : 0);
      f.align = e.align === "center" ? "boxCenter" : "boxRight";
    } else {
      f.x = r2(e.x); f.align = "left";
    }
    if (e.rotate) notes.push(`"${f.id}" está rotado en el código; el editor lo muestra sin rotar`);
    fields.push(f);
  }
  placeRects();
  for (const u of trace.unsupported) notes.push(`El código usa page.${u}, que el editor no representa`);
  return { fields, notes };
}
/* "ZQ12QZZQZQ13QZZQ" → [{id 12, 0–8}, {id 13, 8–16}]: cada grupo es el
 * principio de "ZQ<id>QZ" repetido. */
function splitCharacterRuns(joined) {
  const parts = [];
  let p = 0;
  while (p < joined.length) {
    const m = joined.slice(p).match(/^ZQ(\d+)QZ/i);
    if (!m) { parts.push({ id: null, from: p, to: joined.length }); break; }
    const unit = m[0].toUpperCase(), period = unit.length;
    let q = p;
    while (q < joined.length && joined[q].toUpperCase() === unit[(q - p) % period]) q++;
    /* Si el siguiente grupo empieza justo en un múltiplo del periodo, su
     * "ZQ1…" coincide unos caracteres con el patrón anterior: retroceder. */
    if (q < joined.length) {
      const b = p + Math.floor((q - p) / period) * period;
      if (b > p && /^ZQ\d+QZ|^ZQ\d*Q?$/i.test(joined.slice(b))) q = b;
    }
    parts.push({ id: +m[1], from: p, to: q });
    p = q;
  }
  return parts;
}
function q0(v) { return Math.abs(v) < 1e-6 ? 0 : v; }
