/* Quitar texto de la plantilla de verdad — sin tapar.
 *
 * Una constancia de cliente trae su texto de ejemplo («Nombre del
 * participante», el curso…) como instrucciones de dibujo de texto dentro del
 * contenido de la página. Para reemplazarlo sin dejar un parche de color, se
 * eliminan del contenido exactamente las letras que caen en la zona del
 * campo. El resto de la página no se toca: el fondo, los gráficos y el texto
 * fijo siguen idénticos, y la generación escribe encima como siempre.
 *
 * Cómo se localiza cada letra: se recorre el contenido con su estado gráfico
 * (CTM, q/Q, cm) y de texto (Tm, Tf, Tc, Tw, Tz, TL, Ts) y se avanza letra
 * por letra con los anchos reales de la fuente (/Widths o /W). Una letra se
 * quita si su centro cae en alguna zona.
 *
 * Cómo se quita sin mover lo demás: la instrucción que la dibuja se reescribe
 * como un TJ en el que cada letra quitada se vuelve un desplazamiento del
 * mismo ancho. Lo que sigue en la línea (una etiqueta, otra palabra) queda en
 * su lugar exacto. Si la instrucción queda sin letras, es sólo un
 * desplazamiento.
 *
 * Módulo puro: trabaja con el contenido YA DESCOMPRIMIDO de una página y con
 * una tabla de métricas por fuente. El pegamento con pdf-lib (leer las
 * fuentes, el gancho para la plantilla limpia) va al final y recibe la
 * librería inyectada, como template-elements.mjs.
 *
 * Coordenadas: espacio de usuario de la página (puntos, «y» hacia arriba). */

import { tokenize, multiply } from "./template-elements.mjs";

const IDENTITY = [1, 0, 0, 1, 0, 0];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const fmt = v => (Math.abs(v) < 1e-9 ? "0" : String(Math.round(v * 1000) / 1000));

/* ---- Cadenas del contenido → bytes ---- */

const ESCAPES = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
/* «(…)» con escapes (\n, \ddd, continuación de línea) o «<…>» hexadecimal. */
export function stringBytes(operand) {
  if (!operand) return new Uint8Array(0);
  const raw = operand.raw || "";
  if (operand.type === "hex") {
    let hex = raw.slice(1, -1).replace(/[^0-9a-fA-F]/g, "");
    if (hex.length % 2) hex += "0";
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  const body = raw.slice(1, -1), out = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== "\\") { out.push(body.charCodeAt(i) & 255); continue; }
    const nx = body[++i];
    if (nx === undefined) break;
    if (nx in ESCAPES) { out.push(ESCAPES[nx]); continue; }
    if (nx === "\r") { if (body[i + 1] === "\n") i++; continue; }      // continuación de línea
    if (nx === "\n") continue;
    if (/[0-7]/.test(nx)) {
      let oct = nx;
      while (oct.length < 3 && /[0-7]/.test(body[i + 1] || "")) oct += body[++i];
      out.push(parseInt(oct, 8) & 255); continue;
    }
    out.push(nx.charCodeAt(0) & 255);                                    // escape desconocido: se ignora la barra
  }
  return Uint8Array.from(out);
}

const hexOf = bytes => "<" + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("") + ">";

/* ---- Métricas de fuente ----
 * fonts[nombre] = { bytes: 1 | 2, width(code) → milésimas de em,
 *   ascent, descent (milésimas), approx: bool (anchos supuestos) }. */
const fallbackFont = { bytes: 1, width: () => 500, ascent: 800, descent: -200, approx: true };

/* Letras dibujadas por una instrucción de texto. */
function codesOf(bytes, font) {
  const out = [];
  const step = font.bytes === 2 ? 2 : 1;
  for (let i = 0; i + step <= bytes.length; i += step) {
    const code = step === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i];
    out.push({ code, raw: bytes.subarray(i, i + step) });
  }
  return out;
}

/* Recorre el contenido y devuelve cada instrucción que dibuja texto, con sus
 * letras ubicadas. shows: [{ opIndex, op, font, size, tc, tw, th, aw?, ac?,
 *   parts: [{ type: "num", n } | { type: "str", glyphs: [{ code, raw, w,
 *   center: [x, y], box, removable }] }] }] */
export function textShows(ops, fonts = {}) {
  let gs = { ctm: IDENTITY, font: null, size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0 };
  const stack = [];
  let tm = IDENTITY, tlm = IDENTITY;
  const shows = [];
  const num = o => (o?.type === "number" ? o.value : 0);
  const nums = os => os.filter(o => o.type === "number").map(o => o.value);
  const moveLine = (tx, ty) => { tlm = multiply([1, 0, 0, 1, tx, ty], tlm); tm = tlm; };

  const show = (opIndex, op, parts, extra = {}) => {
    const fontName = gs.font, font = fonts[fontName] || fallbackFont;
    const size = gs.size, th = gs.th;
    const out = [];
    for (const p of parts) {
      if (p.type === "number") {
        const tx = -(p.value / 1000) * size * th;
        tm = multiply([1, 0, 0, 1, tx, 0], tm);
        out.push({ type: "num", n: p.value });
        continue;
      }
      const glyphs = [];
      for (const { code, raw } of codesOf(stringBytes(p), font)) {
        const w = font.width(code) || 0;
        const trm = multiply(multiply([size * th, 0, 0, size, 0, gs.rise], tm), gs.ctm);
        const ems = [0, font.descent / 1000, w / 1000, font.ascent / 1000];
        const pts = [apply(trm, ems[0], ems[1]), apply(trm, ems[2], ems[1]), apply(trm, ems[0], ems[3]), apply(trm, ems[2], ems[3])];
        const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
        glyphs.push({
          code, raw, w,
          center: apply(trm, w / 2000, 0.3),
          box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
        });
        const space = font.bytes === 1 && code === 32 ? gs.tw : 0;
        const tx = ((w / 1000) * size + gs.tc + space) * th;
        tm = multiply([1, 0, 0, 1, tx, 0], tm);
      }
      out.push({ type: "str", glyphs });
    }
    shows.push({ opIndex, op, font: fontName, size, tc: gs.tc, tw: gs.tw, th, approx: !!font.approx || !fonts[fontName], parts: out, ...extra });
  };

  ops.forEach((o, opIndex) => {
    const a = o.operands;
    switch (o.op) {
      case "q": stack.push({ ...gs }); break;
      case "Q": gs = stack.pop() || gs; break;
      case "cm": { const m = nums(a).slice(-6); if (m.length === 6) gs.ctm = multiply(m, gs.ctm); break; }
      case "BT": tm = tlm = IDENTITY; break;
      case "Tf": gs.font = a.find(x => x.type === "name")?.value ?? gs.font; gs.size = num(a[a.length - 1]); break;
      case "Tc": gs.tc = num(a[0]); break;
      case "Tw": gs.tw = num(a[0]); break;
      case "Tz": gs.th = num(a[0]) / 100; break;
      case "TL": gs.tl = num(a[0]); break;
      case "Ts": gs.rise = num(a[0]); break;
      case "Td": moveLine(num(a[0]), num(a[1])); break;
      case "TD": gs.tl = -num(a[1]); moveLine(num(a[0]), num(a[1])); break;
      case "Tm": { const m = nums(a).slice(-6); if (m.length === 6) tm = tlm = m; break; }
      case "T*": moveLine(0, -gs.tl); break;
      case "Tj": show(opIndex, "Tj", a.filter(x => x.type === "string" || x.type === "hex")); break;
      case "'": moveLine(0, -gs.tl); show(opIndex, "'", a.filter(x => x.type === "string" || x.type === "hex")); break;
      case "\"": {
        const [aw, ac] = nums(a);
        gs.tw = aw ?? gs.tw; gs.tc = ac ?? gs.tc;
        moveLine(0, -gs.tl);
        show(opIndex, "\"", a.filter(x => x.type === "string" || x.type === "hex"), { aw, ac });
        break;
      }
      case "TJ": show(opIndex, "TJ", a.filter(x => x.type === "string" || x.type === "hex" || x.type === "number")); break;
      default: break;
    }
  });
  return shows;
}

const inBox = ([x, y], b, tol = 0.5) => x >= b.x0 - tol && x <= b.x1 + tol && y >= b.y0 - tol && y <= b.y1 + tol;

/* Qué instrucciones reescribir y cómo. boxes: [{ x0, y0, x1, y1, key? }].
 * Devuelve { edits: Map(opIndex → texto nuevo), perBox: [{ key, removed,
 * partial, approx }], skipped: [{ opIndex, reason }] }. */
export function planTextRemoval(shows, boxes) {
  const edits = new Map(), skipped = [];
  const perBox = boxes.map(b => ({ key: b.key ?? null, removed: 0, ops: 0, partial: 0, approx: false }));
  for (const s of shows) {
    const hits = new Set();
    let any = false;
    for (const p of s.parts) if (p.type === "str") for (const g of p.glyphs) {
      const i = boxes.findIndex(b => inBox(g.center, b));
      g.remove = i >= 0;
      if (g.remove) { any = true; hits.add(i); perBox[i].removed++; }
    }
    if (!any) continue;
    if (!s.size || !s.th) { skipped.push({ opIndex: s.opIndex, reason: "tamaño de fuente 0" }); continue; }
    /* Letras que quedan → hex; letras quitadas → desplazamiento del mismo
     * ancho (en milésimas de em; Tz se cancela). */
    const items = [];
    let chunk = [], kept = 0;
    const flush = () => { if (chunk.length) { items.push(hexOf(Uint8Array.from(chunk.flatMap(c => Array.from(c))))); chunk = []; } };
    const pushNum = n => {
      flush();
      const last = items[items.length - 1];
      if (typeof last === "number") items[items.length - 1] = last + n; else items.push(n);
    };
    for (const p of s.parts) {
      if (p.type === "num") { pushNum(p.n); continue; }
      for (const g of p.glyphs) {
        if (!g.remove) { chunk.push(g.raw); kept++; continue; }
        const space = g.raw.length === 1 && g.code === 32 ? s.tw : 0;
        pushNum(-(g.w + ((s.tc + space) * 1000) / s.size));
      }
    }
    flush();
    const body = "[" + items.map(x => (typeof x === "number" ? fmt(x) : x)).join(" ") + "] TJ";
    const prefix = s.op === "'" ? "T* " : s.op === "\"" ? `${fmt(s.aw ?? 0)} Tw ${fmt(s.ac ?? 0)} Tc T* ` : "";
    edits.set(s.opIndex, prefix + body);
    for (const i of hits) { perBox[i].ops++; if (kept) perBox[i].partial++; if (s.approx) perBox[i].approx = true; }
  }
  return { edits, perBox, skipped };
}

/* Contenido con las instrucciones reescritas; el resto, byte por byte. */
export function spliceOps(bytes, ops, edits) {
  if (!edits.size) return bytes;
  const enc = new TextEncoder(), parts = [];
  let cursor = 0;
  for (const [opIndex, text] of [...edits.entries()].sort((a, b) => a[0] - b[0])) {
    const o = ops[opIndex];
    parts.push(bytes.subarray(cursor, o.start), enc.encode(" " + text + " "));
    cursor = o.end;
  }
  parts.push(bytes.subarray(cursor));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let k = 0; for (const p of parts) { out.set(p, k); k += p.length; }
  return out;
}

/* Quita el texto de las zonas. Devuelve { content, report } con, por zona,
 * cuántas letras se quitaron, en cuántas instrucciones y si alguna se partió
 * (una etiqueta fija junto al dato). Una zona sin letras (texto en un grupo,
 * convertido en trazos o en imagen) queda en report.perBox con removed 0. */
export function removeTextInBoxes(content, fonts, boxes) {
  const ops = tokenize(content);
  const plan = planTextRemoval(textShows(ops, fonts), boxes);
  return { content: spliceOps(content, ops, plan.edits), report: { perBox: plan.perBox, skipped: plan.skipped } };
}

/* Verificación: cuántas letras siguen dibujándose en cada zona. */
export function glyphsInBoxes(content, fonts, boxes) {
  const counts = boxes.map(() => 0);
  for (const s of textShows(tokenize(content), fonts))
    for (const p of s.parts) if (p.type === "str") for (const g of p.glyphs) {
      const i = boxes.findIndex(b => inBox(g.center, b));
      if (i >= 0) counts[i]++;
    }
  return counts;
}

/* ---- Pegamento con pdf-lib (se inyecta: este módulo no lo importa) ---- */

/* Anchos y alto de cada fuente de la página. Type0 con Identity-H/V (2
 * bytes, /W y /DW); fuentes simples con /FirstChar y /Widths. Lo que no se
 * puede leer queda con anchos supuestos (approx). */
export function pageFonts(lib, pdfDoc, page) {
  const { PDFName } = lib;
  const out = {};
  const dict = page.node.Resources()?.lookup(PDFName.of("Font"));
  if (!dict) return out;
  const get = (d, k) => d?.lookup?.(PDFName.of(k));
  const numOf = v => (typeof v?.asNumber === "function" ? v.asNumber() : null);
  const nameOf = v => (typeof v?.asString === "function" ? v.asString().replace(/^\//, "") : null);
  const arr = v => (typeof v?.asArray === "function" ? v.asArray().map((_, i) => v.lookup(i)) : null);
  for (const [key, ref] of dict.entries()) {
    const name = key.asString().slice(1);
    try {
      const f = pdfDoc.context.lookup(ref);
      const subtype = nameOf(get(f, "Subtype"));
      let desc = get(f, "FontDescriptor");
      if (subtype === "Type0") {
        const enc = nameOf(get(f, "Encoding"));
        const cid = arr(get(f, "DescendantFonts"))?.[0];
        desc = get(cid, "FontDescriptor");
        const dw = numOf(get(cid, "DW")) ?? 1000;
        const widths = new Map();
        const w = arr(get(cid, "W")) || [];
        for (let i = 0; i < w.length;) {
          const first = numOf(w[i]);
          const next = w[i + 1];
          if (typeof next?.asArray === "function") {
            arr(next).forEach((v, j) => widths.set(first + j, numOf(v) ?? dw));
            i += 2;
          } else {
            const last = numOf(next), width = numOf(w[i + 2]) ?? dw;
            for (let c = first; c <= last; c++) widths.set(c, width);
            i += 3;
          }
        }
        out[name] = { bytes: 2, width: c => widths.get(c) ?? dw, approx: enc !== "Identity-H" && enc !== "Identity-V" };
      } else {
        const first = numOf(get(f, "FirstChar")) ?? 0;
        const list = arr(get(f, "Widths"));
        const missing = numOf(get(desc, "MissingWidth")) ?? 0;
        const fm = arr(get(f, "FontMatrix"))?.map(numOf);
        const scale = subtype === "Type3" && fm?.[0] ? fm[0] * 1000 : 1;
        const widths = list ? list.map(v => (numOf(v) ?? missing) * scale) : null;
        out[name] = widths
          ? { bytes: 1, width: c => (c >= first && c < first + widths.length ? widths[c - first] : missing * scale) }
          : { bytes: 1, width: () => 500, approx: true };
      }
      out[name].ascent = numOf(get(desc, "Ascent")) || 800;
      out[name].descent = numOf(get(desc, "Descent")) || -200;
    } catch {
      out[name] = { ...fallbackFont };
    }
  }
  return out;
}

/* Gancho para cleanTemplate: quita el texto de las zonas de cada página.
 *   erasures: [{ key, page, box: { x0, y0, x1, y1 } }] en coordenadas del
 *   editor (sin el origen de la página); aquí se suma el origen del CropBox.
 * report: objeto que se llena con el resultado por zona (key → { removed,
 * ops, partial, approx, remaining }). */
export function textRemovalTransform(lib, erasures, report = {}) {
  const byPage = new Map();
  for (const e of erasures) { if (!byPage.has(e.page)) byPage.set(e.page, []); byPage.get(e.page).push(e); }
  return {
    pages: [...byPage.keys()],
    transform(index, content, { pdfDoc, page }) {
      const list = byPage.get(index);
      if (!list?.length) return content;
      const crop = page.getCropBox?.() || { x: 0, y: 0 };
      const boxes = list.map(e => ({ key: e.key, x0: e.box.x0 + (crop.x || 0), y0: e.box.y0 + (crop.y || 0), x1: e.box.x1 + (crop.x || 0), y1: e.box.y1 + (crop.y || 0) }));
      const fonts = pageFonts(lib, pdfDoc, page);
      const { content: next, report: r } = removeTextInBoxes(content, fonts, boxes);
      const remaining = glyphsInBoxes(next, fonts, boxes);
      r.perBox.forEach((b, i) => { report[b.key] = { removed: b.removed, ops: b.ops, partial: b.partial, approx: b.approx, remaining: remaining[i] }; });
      return next;
    }
  };
}
