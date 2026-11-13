/* Elementos fijos de la plantilla — imágenes y gráficos que el cliente ya
 * trae en su PDF (un QR propio, un logo, un sello) — y su edición: quitarlos,
 * moverlos o cambiarlos de tamaño.
 *
 * La edición se hace sobre el contenido de la página, no tapando: el elemento
 * desaparece del archivo (o se dibuja en su nuevo lugar). El resultado es una
 * «plantilla limpia» que es la que se integra en config/client/templates/;
 * producción no necesita código extra.
 *
 * Módulo puro: trabaja con los bytes YA DESCOMPRIMIDOS del contenido de una
 * página y con la descripción de sus XObjects (nombre → { subtype, bbox,
 * matrix }). Coordenadas en el espacio de usuario de la página (puntos, "y"
 * hacia arriba).
 *
 * Una edición se identifica por el número de orden del elemento en la página
 * («p0-e3»): siempre se aplica sobre la plantilla ORIGINAL, así que el orden
 * es estable. */

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set("()<>[]{}/%".split("").map(c => c.charCodeAt(0)));
const isWs = b => WS.has(b);
const isDelim = b => DELIM.has(b);
const dec = new TextDecoder("latin1");

/* Operaciones del contenido: { op, operands, start, end } con los límites en
 * bytes de la operación completa (operandos + operador). Las imágenes en
 * línea (BI … ID <datos> EI) son una sola operación "BI". */
export function tokenize(bytes) {
  const ops = [];
  let i = 0, operands = [], opStart = -1;
  const n = bytes.length;
  const mark = () => { if (opStart < 0) opStart = i; };
  while (i < n) {
    const b = bytes[i];
    if (isWs(b)) { i++; continue; }
    if (b === 37) { while (i < n && bytes[i] !== 10 && bytes[i] !== 13) i++; continue; }          // % comentario
    mark();
    if (b === 40) {                                                                                 // ( cadena )
      let depth = 0, j = i;
      for (; j < n; j++) {
        if (bytes[j] === 92) { j++; continue; }
        if (bytes[j] === 40) depth++;
        else if (bytes[j] === 41 && --depth === 0) break;
      }
      operands.push({ type: "string", raw: dec.decode(bytes.subarray(i, j + 1)) }); i = j + 1; continue;
    }
    if (b === 60 && bytes[i + 1] === 60) { operands.push({ type: "dictStart" }); i += 2; continue; }
    if (b === 62 && bytes[i + 1] === 62) { operands.push({ type: "dictEnd" }); i += 2; continue; }
    if (b === 60) { let j = i + 1; while (j < n && bytes[j] !== 62) j++; operands.push({ type: "hex", raw: dec.decode(bytes.subarray(i, j + 1)) }); i = j + 1; continue; }
    if (b === 91) { operands.push({ type: "arrayStart" }); i++; continue; }
    if (b === 93) { operands.push({ type: "arrayEnd" }); i++; continue; }
    if (b === 47) {                                                                                 // /Nombre
      let j = i + 1; while (j < n && !isWs(bytes[j]) && !isDelim(bytes[j])) j++;
      operands.push({ type: "name", value: dec.decode(bytes.subarray(i + 1, j)) }); i = j; continue;
    }
    let j = i; while (j < n && !isWs(bytes[j]) && !isDelim(bytes[j])) j++;
    if (j === i) { i++; continue; }                                                                 // delimitador suelto
    const word = dec.decode(bytes.subarray(i, j));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) { operands.push({ type: "number", value: Number(word) }); i = j; continue; }
    if (word === "true" || word === "false" || word === "null") { operands.push({ type: "keyword", value: word }); i = j; continue; }
    if (word === "BI") {
      /* Imagen en línea: su diccionario va hasta ID; los datos binarios hasta
       * un EI rodeado de espacios. */
      let k = j;
      while (k < n - 1 && !(bytes[k] === 73 && bytes[k + 1] === 68 && isWs(bytes[k - 1]) && (k + 2 >= n || isWs(bytes[k + 2])))) k++;
      let e = k + 3;
      while (e < n - 1 && !(bytes[e] === 69 && bytes[e + 1] === 73 && isWs(bytes[e - 1]) && (e + 2 >= n || isWs(bytes[e + 2])))) e++;
      ops.push({ op: "BI", operands, start: opStart, end: Math.min(n, e + 2) });
      operands = []; opStart = -1; i = e + 2; continue;
    }
    ops.push({ op: word, operands, start: opStart, end: j });
    operands = []; opStart = -1; i = j;
  }
  return ops;
}

/* Matrices 2D de PDF [a b c d e f]: punto (x, y) → (ax + cy + e, bx + dy + f). */
export const multiply = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]
];
export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function boxOf(m, x0 = 0, y0 = 0, x1 = 1, y1 = 1) {
  const pts = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const r = v => Math.round(v * 100) / 100;
  return { x0: r(Math.min(...xs)), y0: r(Math.min(...ys)), x1: r(Math.max(...xs)), y1: r(Math.max(...ys)) };
}

/* Elementos dibujados en la página con su caja. xobjects: { Nombre: {
 * subtype: "Image" | "Form", bbox?: [x0,y0,x1,y1], matrix?: [6] } }.
 * Un Form ocupa su BBox transformado (suele ser un logo vectorial o una
 * imagen envuelta). Lo que no se dibuja en la página no aparece. */
export function findElements(ops, xobjects = {}, { page = 0 } = {}) {
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [], out = [];
  ops.forEach((o, opIndex) => {
    if (o.op === "q") stack.push(ctm);
    else if (o.op === "Q") ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (o.op === "cm" && o.operands.length >= 6) ctm = multiply(o.operands.slice(-6).map(x => x.value), ctm);
    else if (o.op === "Do") {
      const name = o.operands[o.operands.length - 1]?.value;
      const x = xobjects[name];
      if (!x) return;
      let box;
      if (x.subtype === "Form") {
        const m = x.matrix && x.matrix.length === 6 ? multiply(x.matrix, ctm) : ctm;
        const [bx0, by0, bx1, by1] = x.bbox || [0, 0, 1, 1];
        box = boxOf(m, bx0, by0, bx1, by1);
      } else box = boxOf(ctm);
      out.push({ id: `p${page}-e${out.length}`, page, kind: x.subtype === "Form" ? "form" : "image", name, opIndex, ctm, box,
        pixels: x.width ? { width: x.width, height: x.height } : null });
    } else if (o.op === "BI") {
      out.push({ id: `p${page}-e${out.length}`, page, kind: "inline", name: null, opIndex, ctm, box: boxOf(ctm) });
    }
  });
  return out;
}

const IDENTITY = [1, 0, 0, 1, 0, 0];
const TEXT_SHOW_OPS = new Set(["Tj", "TJ", "'", "\""]);
const TEXT_STATE_OPS = new Set(["Tf", "Tc", "Tw", "Tz", "TL", "Tr", "Ts", "Tm", "Td", "TD", "T*", "w", "g", "G", "rg", "RG", "gs"]);
const CP1252 = [0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178];

function decodePdfString(token) {
  let bytes;
  if (token.type === "hex") {
    const hex = token.raw.slice(1, -1).replace(/\s/g, "");
    const padded = hex.length % 2 ? `${hex}0` : hex;
    bytes = Uint8Array.from({ length: padded.length / 2 }, (_, i) => parseInt(padded.slice(i * 2, i * 2 + 2), 16));
  } else {
    const raw = token.raw.slice(1, -1);
    const values = [];
    for (let i = 0; i < raw.length; i++) {
      let code = raw.charCodeAt(i);
      if (code !== 92) { values.push(code); continue; }
      if (++i >= raw.length) break;
      const escaped = raw[i];
      if (/[0-7]/.test(escaped)) {
        let octal = escaped;
        while (octal.length < 3 && /[0-7]/.test(raw[i + 1] || "")) octal += raw[++i];
        values.push(parseInt(octal, 8) & 255);
      } else if (escaped === "\r" || escaped === "\n") {
        if (escaped === "\r" && raw[i + 1] === "\n") i++;
      } else values.push(({ n: 10, r: 13, t: 9, b: 8, f: 12 })[escaped] ?? escaped.charCodeAt(0));
    }
    bytes = Uint8Array.from(values);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let text = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) text += String.fromCharCode(bytes[i] * 256 + bytes[i + 1]);
    return text;
  }
  return Array.from(bytes, byte => byte >= 0x80 && byte <= 0x9f ? String.fromCharCode(CP1252[byte - 0x80]) : String.fromCharCode(byte)).join("");
}

function shownText(operands) {
  const strings = operands.filter(token => token.type === "string" || token.type === "hex");
  return strings.map(decodePdfString).join("");
}

function textObjectId(page, index) { return `p${page}-t${index}`; }

/* Texto seleccionable del contenido principal de página. Un objeto BT…ET con
 * un único operador de pintado conserva su id («p0-t3»). Uno con varios (Word
 * escribe un renglón o párrafo entero en un solo BT…ET) se parte en tramos:
 * cada tramo empieza en un operador de posición (Tm, Td, TD, T*, ' o ") y
 * sigue con los pintados que avanzan desde ahí («p0-t3.1»). Retirar un tramo
 * no mueve a los demás: la posición de cada tramo depende de la matriz de
 * renglón, no del avance del texto retirado. Eliminar sus operadores conserva
 * cualquier estado gráfico. */
export function findTextObjects(ops, { page = 0, offset = [0, 0] } = {}) {
  let ctm = [...IDENTITY], stack = [], object = null, nextId = 0, leading = 0, textRenderMode = 0;
  const objects = [];
  for (const op of ops) {
    if (op.op === "q") { stack.push(ctm); continue; }
    if (op.op === "Q") { ctm = stack.pop() || [...IDENTITY]; continue; }
    if (op.op === "cm" && op.operands.length >= 6) {
      ctm = multiply(op.operands.slice(-6).map(token => token.value), ctm);
      continue;
    }
    if (op.op === "BT") {
      if (object) object.safe = false;
      object = { id: textObjectId(page, nextId++), start: op.start, end: null, showStart: null, showEnd: null,
        text: "", showCount: 0, safe: textRenderMode < 4, x: null, y: null, shows: [], segments: [], positioned: true };
      object.textMatrix = [...IDENTITY];
      object.lineMatrix = [...IDENTITY];
      continue;
    }
    if (op.op === "ET") {
      if (object) {
        object.end = op.end;
        const { segments } = object;
        delete object.textMatrix;
        delete object.lineMatrix;
        delete object.segments;
        delete object.positioned;
        if (object.showCount > 1 && object.safe) {
          segments.forEach((segment, i) => objects.push({ id: `${object.id}.${i}`, start: object.start, end: object.end,
            showStart: segment.shows[0].start, showEnd: segment.shows[segment.shows.length - 1].end,
            text: segment.text, showCount: segment.shows.length, safe: true, x: segment.x, y: segment.y, shows: segment.shows }));
        } else {
          object.safe = object.safe && object.showCount === 1;
          objects.push(object);
        }
        object = null;
      }
      continue;
    }
    if (!object) continue;

    if (TEXT_SHOW_OPS.has(op.op)) {
      if (op.op === "'" || op.op === "\"") {
        object.lineMatrix = multiply([1, 0, 0, 1, 0, -leading], object.lineMatrix);
        object.textMatrix = [...object.lineMatrix];
      }
      object.showCount++;
      const show = { op: op.op, start: op.start, end: op.end };
      if (op.op === "\"") show.spacing = op.operands.filter(token => token.type === "number").slice(0, 2).map(token => token.value);
      const text = shownText(op.operands);
      const point = apply(multiply(ctm, object.textMatrix), 0, 0);
      const x = Math.round((point[0] - offset[0]) * 100) / 100, y = Math.round((point[1] - offset[1]) * 100) / 100;
      object.shows.push(show);
      if (object.showCount === 1) {
        object.showStart = op.start;
        object.showEnd = op.end;
        object.text = text;
        object.x = x;
        object.y = y;
      }
      if (object.positioned || op.op === "'" || op.op === "\"" || !object.segments.length) object.segments.push({ text, x, y, shows: [show] });
      else { const last = object.segments[object.segments.length - 1]; last.text += text; last.shows.push(show); }
      object.positioned = false;
    } else if (op.op === "Tm" && op.operands.length >= 6) {
      object.textMatrix = op.operands.slice(-6).map(token => token.value);
      object.lineMatrix = [...object.textMatrix];
      object.positioned = true;
    } else if (op.op === "Td" || op.op === "TD") {
      const [tx, ty] = op.operands.slice(-2).map(token => token.value);
      if (op.op === "TD") leading = -ty;
      const translate = [1, 0, 0, 1, tx, ty];
      object.lineMatrix = multiply(translate, object.lineMatrix);
      object.textMatrix = [...object.lineMatrix];
      object.positioned = true;
    } else if (op.op === "T*") {
      object.lineMatrix = multiply([1, 0, 0, 1, 0, -leading], object.lineMatrix);
      object.textMatrix = [...object.lineMatrix];
      object.positioned = true;
    } else if (op.op === "TL" && op.operands.length) {
      leading = op.operands[op.operands.length - 1].value;
    } else if (op.op === "Tr" && op.operands.length) {
      textRenderMode = op.operands[op.operands.length - 1].value;
      if (textRenderMode >= 4) object.safe = false;
    } else if (!TEXT_STATE_OPS.has(op.op) && op.op !== "q" && op.op !== "Q" && op.op !== "cm") {
      object.safe = false;
    }
  }
  return objects;
}

const normalizedText = value => String(value ?? "").replace(/\s+/g, " ").trim();

/* Prefiere una coincidencia exacta; si la fuente no permite leer los bytes,
 * usa el origen y el ancho medidos por pdf.js, y rechaza posiciones ambiguas. */
export function matchTextReplacement(objects, run, { tolerance = 2 } = {}) {
  const result = matchTextReplacements(objects, [run], { tolerance });
  if (result.ok) return { ok: true, id: result.ids[0] };
  const { ids: _ids, ...failure } = result;
  return failure;
}

export function matchTextReplacements(objects, runs, { tolerance = 2 } = {}) {
  const ids = [];
  for (const run of runs) {
    const text = normalizedText(run?.text);
    const positionTolerance = Math.max(tolerance, (run?.size || 0) * 0.2);
    const near = objects.filter(object => Number.isFinite(object.x) && Number.isFinite(object.y)
      && Math.abs(object.y - run.y) <= positionTolerance);
    const starts = near.filter(object => Math.abs(object.x - run.x) <= positionTolerance);
    const exact = starts.filter(object => object.safe && normalizedText(object.text) === text);
    if (exact.length === 1) { ids.push(exact[0].id); continue; }
    if (exact.length > 1 || starts.length !== 1) {
      return { ok: false, reason: starts.length > 1 || exact.length > 1 ? "ambiguous-text" : "text-not-isolated", ids: [] };
    }
    if (!Number.isFinite(run.width) || run.width <= 0) {
      return { ok: false, reason: "text-not-isolated", ids: [] };
    }

    /* pdf.js decodes embedded-font CMaps; the raw bytes in a content stream
     * often do not contain the Unicode string it displays. Match the unique
     * starting position, then include the same-line text operators inside the
     * selected run's measured bounds (for example, "Se " + "otorga"). */
    /* Un operador que empieza donde el renglón termina es el texto vecino
     * («…SOLIDARIO» | «con el obligado»): el tramo sólo toma lo que empieza
     * dentro del renglón. */
    const end = run.x + run.width - Math.max(0.5, (run.size || 0) * 0.15);
    const span = near.filter(object => object.x >= run.x - positionTolerance && object.x < end);
    if (span.some(object => !object.safe)) return { ok: false, reason: "text-not-isolated", ids: [] };
    const spanIds = span.map(object => object.id);
    if (!spanIds.includes(starts[0].id)) return { ok: false, reason: "text-not-isolated", ids: [] };
    ids.push(...spanIds);
  }
  const uniqueIds = [...new Set(ids)];
  return uniqueIds.length === ids.length
    ? { ok: true, ids: uniqueIds }
    : { ok: false, reason: "ambiguous-text", ids: [] };
}

/* Lo que queda en lugar de un operador de pintado: nada, salvo el salto de
 * renglón de ' y " (y el espaciado que " fija), del que dependen los tramos
 * siguientes del mismo objeto. */
function showRemainder(show) {
  if (show.op === "'") return " T* ";
  if (show.op === "\"" && show.spacing?.length === 2) return ` ${fmt(show.spacing[0])} Tw ${fmt(show.spacing[1])} Tc T* `;
  return " ";
}

export function applyTextRemovals(bytes, objects, ids) {
  const selected = new Set(ids);
  const shows = objects.filter(object => selected.has(object.id) && object.safe)
    .flatMap(object => object.shows?.length ? object.shows : [{ op: "Tj", start: object.showStart, end: object.showEnd }])
    .sort((a, b) => a.start - b.start);
  if (!shows.length) return bytes;
  const enc = new TextEncoder();
  const parts = [];
  let cursor = 0;
  for (const show of shows) {
    if (show.start == null || show.end == null || show.start < cursor || show.end < show.start) continue;
    parts.push(bytes.subarray(cursor, show.start), enc.encode(showRemainder(show)));
    cursor = show.end;
  }
  parts.push(bytes.subarray(cursor));
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

const fmt = v => (Math.abs(v) < 1e-9 ? "0" : String(Math.round(v * 1e6) / 1e6));

/* Matriz que, insertada con "cm" justo antes del elemento, lo lleva de su
 * caja original a la nueva: CTM' = M × CTM = CTM × P, con P la transformación
 * de la página que mapea una caja en la otra. */
export function placementMatrix(ctm, from, to) {
  const sx = (to.x1 - to.x0) / (from.x1 - from.x0), sy = (to.y1 - to.y0) / (from.y1 - from.y0);
  const P = [sx, 0, 0, sy, to.x0 - from.x0 * sx, to.y0 - from.y0 * sy];
  return multiply(multiply(ctm, P), invert(ctm));
}

/* Contenido nuevo con las ediciones aplicadas.
 *   edits: [{ id, action: "remove" | "place" | "removeText", box? }]
 *   (box: caja nueva; removeText elimina un objeto BT…ET seguro)
 * Quitar borra la operación que lo dibuja; mover/cambiar de tamaño la
 * envuelve en q … cm … Q. El resto del contenido no se toca, byte por byte. */
export function applyEdits(bytes, ops, elements, edits) {
  const byOp = new Map();
  for (const e of edits) {
    const el = elements.find(x => x.id === e.id);
    if (el) byOp.set(el.opIndex, { el, e });
  }
  if (!byOp.size) return bytes;
  const enc = new TextEncoder();
  const parts = [];
  let cursor = 0;
  for (const [opIndex, { el, e }] of [...byOp.entries()].sort((a, b) => a[0] - b[0])) {
    const o = ops[opIndex];
    parts.push(bytes.subarray(cursor, o.start));
    if (e.action === "place" && e.box) {
      const m = placementMatrix(el.ctm, el.box, e.box);
      parts.push(enc.encode(`q ${m.map(fmt).join(" ")} cm `), bytes.subarray(o.start, o.end), enc.encode(" Q"));
    } else parts.push(enc.encode(" "));
    cursor = o.end;
  }
  parts.push(bytes.subarray(cursor));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let k = 0; for (const p of parts) { out.set(p, k); k += p.length; }
  return out;
}

/* ¿Parece un código QR? Cuadrado y de tamaño de QR impreso (1.5–8 cm). */
export function looksLikeQr(el) {
  const w = el.box.x1 - el.box.x0, h = el.box.y1 - el.box.y0;
  return el.kind !== "form" && Math.abs(w - h) <= Math.max(w, h) * 0.06 && w >= 42 && w <= 230;
}

/* ¿Los píxeles de la caja parecen un QR? Casi todo es negro o blanco puro y
 * la mitad, más o menos, es negro. Un logo cuadrado (colores, degradados) no
 * pasa. raster = { gray, width, height, pageWidth } de la página ORIGINAL. */
export function qrLikeness(raster, pageHeight, box) {
  if (!raster?.gray) return null;
  const s = raster.width / raster.pageWidth;
  const x0 = Math.max(0, Math.round(box.x0 * s)), x1 = Math.min(raster.width - 1, Math.round(box.x1 * s));
  const y0 = Math.max(0, Math.round((pageHeight - box.y1) * s)), y1 = Math.min(raster.height - 1, Math.round((pageHeight - box.y0) * s));
  let dark = 0, light = 0, total = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const g = raster.gray[y * raster.width + x]; total++;
    if (g < 90) dark++; else if (g > 190) light++;
  }
  if (!total) return null;
  return (dark + light) / total > 0.88 && dark / total > 0.2 && dark / total < 0.75;
}

/* ---- Pegamento con pdf-lib (se inyecta: este módulo no lo importa) ---- */

/* Contenido descomprimido y XObjects de una página de un PDFDocument. */
export function readPageContent(lib, pdfDoc, index) {
  const { PDFName, PDFArray, PDFRawStream, decodePDFRawStream } = lib;
  const page = pdfDoc.getPages()[index];
  const contents = page.node.Contents();
  const streams = !contents ? [] : contents instanceof PDFArray ? contents.asArray().map(r => pdfDoc.context.lookup(r)) : [contents];
  const chunks = streams.map(s => (s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents()));
  const content = new Uint8Array(chunks.reduce((a, c) => a + c.length + 1, 0));
  let k = 0; for (const c of chunks) { content.set(c, k); k += c.length; content[k++] = 10; }
  const xobjects = {}, refs = {};
  const dict = page.node.Resources()?.lookup(PDFName.of("XObject"));
  if (dict) for (const [key, ref] of dict.entries()) {
    const d = pdfDoc.context.lookup(ref)?.dict; if (!d) continue;
    const nums = n => d.lookup(PDFName.of(n))?.asArray?.().map(v => v.asNumber());
    const name = key.asString().slice(1);
    xobjects[name] = { subtype: d.lookup(PDFName.of("Subtype"))?.asString().slice(1), bbox: nums("BBox"), matrix: nums("Matrix"),
      width: d.lookup(PDFName.of("Width"))?.asNumber?.(), height: d.lookup(PDFName.of("Height"))?.asNumber?.() };
    refs[name] = ref;
  }
  return { page, content, xobjects, refs, xobjectDict: dict };
}

/* Un PDF cifrado (los documentos que emite la plataforma lo están) se abre,
 * pero su contenido no se puede leer ni editar con pdf-lib: lo que se le
 * dibuje queda mezclado con el contenido cifrado y el visor no lo muestra.
 * Aquí no se descifra: eso lo decide el usuario al importar (pdf-decrypt.mjs),
 * con la contraseña de propietario o declarando que puede modificarlo. */
export const ENCRYPTED_TEMPLATE_MESSAGE = "Este PDF está cifrado (protegido contra cambios), como los documentos que emite la plataforma: su texto no se puede retirar ni tapar, y lo que se dibuje encima no se verá. Vuelve a importarlo y desbloquéalo (con la contraseña de propietario o declarando que puedes modificarlo), o usa el PDF original sin cifrar.";

export async function readTemplateElements(lib, bytes, index) {
  const pdfDoc = await lib.PDFDocument.load(bytes, { ignoreEncryption: true });
  if (pdfDoc.isEncrypted || index >= pdfDoc.getPageCount()) return [];
  const { content, xobjects } = readPageContent(lib, pdfDoc, index);
  return findElements(tokenize(content), xobjects, { page: index });
}

export async function matchTemplateText(lib, bytes, index, run) {
  const result = await matchTemplateTextRuns(lib, bytes, index, [run]);
  return result.ok ? { ok: true, id: result.ids[0] } : result;
}

export async function matchTemplateTextRuns(lib, bytes, index, runs) {
  const pdfDoc = await lib.PDFDocument.load(bytes, { ignoreEncryption: true });
  if (pdfDoc.isEncrypted) return { ok: false, reason: "encrypted", ids: [] };
  if (index >= pdfDoc.getPageCount()) return { ok: false, reason: "page-not-found", ids: [] };
  const { content, page } = readPageContent(lib, pdfDoc, index);
  const crop = page.getCropBox?.() || { x: 0, y: 0 };
  const objects = findTextObjects(tokenize(content), { page: index, offset: [crop.x || 0, crop.y || 0] });
  return matchTextReplacements(objects, runs);
}

/* Plantilla con las ediciones aplicadas, a partir de los bytes ORIGINALES.
 * Lo que se quitó y ya no dibuja nadie sale también del archivo (recursos y
 * objeto), para que el QR del cliente no siga escondido dentro. */
export async function cleanTemplate(lib, bytes, edits) {
  const { PDFName } = lib;
  /* Sin tocar fechas ni productor: el mismo mapa da siempre los mismos
   * bytes, y la huella SHA-256 de la plantilla no cambia entre exportaciones. */
  const pdfDoc = await lib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  if (pdfDoc.isEncrypted) throw new Error(ENCRYPTED_TEMPLATE_MESSAGE);
  const byPage = new Map();
  for (const e of edits) { const p = Number(/^p(\d+)-/.exec(e.id)?.[1] ?? 0); if (!byPage.has(p)) byPage.set(p, []); byPage.get(p).push(e); }
  for (const [index, pageEdits] of byPage) {
    if (index >= pdfDoc.getPageCount()) continue;
    const { page, content, xobjects, refs, xobjectDict } = readPageContent(lib, pdfDoc, index);
    const ops = tokenize(content), textObjects = findTextObjects(ops, { page: index });
    const textIds = pageEdits.filter(edit => edit.action === "removeText").map(edit => edit.id);
    const textClean = applyTextRemovals(content, textObjects, textIds);
    const cleanOps = tokenize(textClean), elements = findElements(cleanOps, xobjects, { page: index });
    const next = applyEdits(textClean, cleanOps, elements, pageEdits.filter(edit => edit.action !== "removeText"));
    page.node.set(PDFName.of("Contents"), pdfDoc.context.register(pdfDoc.context.flateStream(next)));
    const stillDrawn = new Set(tokenize(next).filter(o => o.op === "Do").map(o => o.operands[o.operands.length - 1]?.value));
    for (const e of pageEdits) {
      const el = elements.find(x => x.id === e.id);
      if (e.action !== "remove" || !el?.name || stillDrawn.has(el.name)) continue;
      const ref = refs[el.name];
      xobjectDict.delete(PDFName.of(el.name));
      const usedElsewhere = pdfDoc.getPages().some(p => {
        const d = p.node.Resources()?.lookup(PDFName.of("XObject"));
        return d && [...d.entries()].some(([, r]) => r === ref);
      });
      if (!usedElsewhere && ref) pdfDoc.context.delete(ref);
    }
  }
  return new Uint8Array(await pdfDoc.save({ useObjectStreams: false }));
}
