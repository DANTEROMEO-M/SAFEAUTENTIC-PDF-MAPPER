/* Editor documental de clientes.html: el modelo de una redacción.
 *
 * Una redacción es un documento que el consultor escribe dentro del
 * expediente de un cliente, como en un procesador de textos. Es el núcleo del
 * editor de clientes.html y es independiente del generador documental del
 * Dashboard (emisión con QR y firma) y de PDF Mapper / Template Studio
 * (configuración interna de plantillas PDF): no importa nada de ellos. Sólo
 * reutiliza la gramática de datos común (`{{ruta}}`, document-data.mjs).
 *
 * Contrato `safeautentic.redaccion` v1, guardado en
 * `clientes/{clienteId}/redacciones/{id}` (el portal del cliente no lo lee):
 *   contenido = { page: { size, margin, font, fontSize }, blocks: Block[] }
 *   Block = { t: p|h1|h2|h3|li, list?: ul|ol (sólo li), align, indent 0..4,
 *             lh, runs: Run[] }
 *   Run   = { text, b?, i?, u?, size?, font?, missing? }
 * Se guarda como datos, nunca como HTML: `toHtml` escapa todo el texto y
 * `fromNodes` —el único camino de vuelta desde el DOM del editor o el
 * portapapeles— sólo reconoce el formato de su lista blanca. Un run con
 * `missing` es un dato que faltaba al insertarlo: se ve como «[RFC]» hasta
 * que alguien lo escriba.
 *
 * Una plantilla del editor es contenido editable con `{{ruta}}`; no es una
 * plantilla PDF mapeada. Tablas, importar Word, DOCX, PDF, Drive y edición
 * concurrente quedan fuera de v1.
 *
 * Módulo puro: sin DOM, red ni Firebase. */

import { DATA_BINDING_PATTERN, DATA_PATH_PATTERN, isBlankData, readDataPath } from "../shared/document-data.mjs";

export const REDACCION_SCHEMA = "safeautentic.redaccion";
export const REDACCION_VERSION = 1;
/* v2 = el contenido lleva un bloque de firmas. Un documento sin firmas se
   sigue guardando como v1, así lo lee cualquier versión del editor; uno con
   firmas, una versión anterior lo rechaza en vez de perderlas al guardar. */
export const REDACCION_VERSION_FIRMAS = 2;
/* v3 = el contenido lleva una tabla o una casilla. Mismo criterio: sólo un
   documento que las usa se guarda como v3. */
export const REDACCION_VERSION_TABLAS = 3;
export const REDACCION_VERSIONS = Object.freeze([REDACCION_VERSION, REDACCION_VERSION_FIRMAS, REDACCION_VERSION_TABLAS]);
export const REDACCION_ESTADOS = Object.freeze(["borrador", "final"]);

export const BLOCK_TYPES = Object.freeze(["p", "h1", "h2", "h3", "li"]);
/* Bloque de firmas: firmantes lado a lado, cada uno con su raya y sus
   renglones (nombre, cargo, empresa, registros). Es un bloque atómico en la
   hoja: se edita desde su panel, no escribiendo guiones bajos. */
export const SIGNATURE_BLOCK = "sig";
export const MAX_SIGNERS = 3;
export const MAX_SIGNER_LINES = 6;
/* Tabla: bloque atómico como las firmas (se edita desde su panel). Celdas
   con texto con formato; `cols` son anchos relativos de las columnas. */
export const TABLE_BLOCK = "tbl";
export const MAX_TABLE_ROWS = 200;
export const MAX_TABLE_COLS = 10;
/* Casilla «( )» / «(X)»: un fragmento atómico con `chk` verdadero o falso. */
export const CHECK_TEXT = Object.freeze({ false: "( )", true: "(X)" });
export const LIST_KINDS = Object.freeze(["ul", "ol"]);
export const ALIGNMENTS = Object.freeze(["left", "center", "right", "justify"]);
export const LINE_HEIGHTS = Object.freeze([1, 1.15, 1.5, 2]);
export const FONT_SIZES = Object.freeze([9, 10, 11, 12, 14, 16, 18, 20, 24]);
export const FONTS = Object.freeze({ sans: "Sans serif", serif: "Con serifa", mono: "Monoespaciada" });
/* En puntos (72 pt = 1 pulgada). Carta: 8.5 × 11 in. Oficio mexicano:
   8.5 × 13 in — no el Legal de EE. UU. (8.5 × 14 in, 612 × 1008 pt). */
export const PAGE_SIZES = Object.freeze({
  carta: Object.freeze({ label: "Carta", width: 612, height: 792 }),
  oficio: Object.freeze({ label: "Oficio", width: 612, height: 936 })
});
/* Márgenes en puntos (72 pt = 1 pulgada). */
export const MARGINS = Object.freeze({ normal: 72, estrecho: 36, amplio: 90 });
export const MAX_INDENT = 4;
export const INDENT_STEP_PT = 36;
export const DEFAULT_PAGE = Object.freeze({ size: "carta", margin: "normal", font: "sans", fontSize: 12 });
export const DEFAULT_LINE_HEIGHT = 1.15;
/* Un documento de Firestore admite 1 MiB: `bytes` deja margen para el resto
   de los campos de la redacción. */
export const LIMITS = Object.freeze({ blocks: 2000, runs: 400, chars: 150000, bytes: 600000, title: 200 });

export class RedaccionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RedaccionError";
    this.code = code;
    this.details = details;
  }
}

const fold = value => String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
/* Un dato de una línea: sin objetos, sin números inválidos, sin espacios
   repetidos. */
const oneLine = value => (value === null || value === undefined || typeof value === "object" || (typeof value === "number" && !Number.isFinite(value))
  ? "" : String(value).replace(/\s+/g, " ").trim());
const ms = v => (typeof v === "number" ? v : v?.toMillis?.() ?? (v?.seconds != null ? v.seconds * 1000 : null));
const nonNegativeInt = v => (Number.isInteger(v) && v >= 0 ? v : 0);
const clampInt = (v, min, max) => Math.min(max, Math.max(min, Math.round(Number(v)) || 0));

/* ── Texto ─────────────────────────────────────────────────────────────── */

/* Texto que se puede guardar: bien formado (Firestore exige UTF-8 válido), en
   NFC y sin caracteres de control salvo el salto de línea. Una tabulación es
   un espacio: v1 no tiene tabuladores. */
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F\uFFFE\uFFFF]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
function cleanText(value) {
  const raw = typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
  const wellFormed = typeof raw.toWellFormed === "function" ? raw.toWellFormed() : raw.replace(LONE_SURROGATE, "\uFFFD");
  return wellFormed.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(CONTROL, "");
}

/* ── Normalización ─────────────────────────────────────────────────────── */

export function normalizePage(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const fontSize = Number(src.fontSize);
  return {
    size: Object.hasOwn(PAGE_SIZES, src.size) ? src.size : DEFAULT_PAGE.size,
    margin: Object.hasOwn(MARGINS, src.margin) ? src.margin : DEFAULT_PAGE.margin,
    font: Object.hasOwn(FONTS, src.font) ? src.font : DEFAULT_PAGE.font,
    fontSize: FONT_SIZES.includes(fontSize) ? fontSize : DEFAULT_PAGE.fontSize
  };
}

/* Un run sólo guarda lo que difiere de la página: el tamaño y la fuente base
   no se repiten en cada fragmento. */
function normalizeRun(raw, page) {
  if (!raw || typeof raw !== "object") return null;
  const run = { text: cleanText(raw.text) };
  if (raw.b === true) run.b = true;
  if (raw.i === true) run.i = true;
  if (raw.u === true) run.u = true;
  const size = Number(raw.size);
  if (FONT_SIZES.includes(size) && size !== page.fontSize) run.size = size;
  if (typeof raw.font === "string" && Object.hasOwn(FONTS, raw.font) && raw.font !== page.font) run.font = raw.font;
  if (typeof raw.chk === "boolean") {
    run.chk = raw.chk;
    run.text = CHECK_TEXT[raw.chk];
  } else if (typeof raw.missing === "string" && DATA_PATH_PATTERN.test(raw.missing)) {
    run.missing = raw.missing;
    if (!run.text) run.text = placeholderFor(raw.missing);
  }
  return run;
}

const sameFormat = (a, b) => !a.missing && !b.missing && a.chk === undefined && b.chk === undefined && a.b === b.b && a.i === b.i && a.u === b.u && a.size === b.size && a.font === b.font;

/* Sin fragmentos vacíos y sin dos fragmentos seguidos con el mismo formato.
   Un dato faltante nunca se funde: se reemplaza completo. */
function mergeRuns(runs) {
  const out = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = out[out.length - 1];
    if (last && sameFormat(last, run)) last.text += run.text;
    else out.push({ ...run });
  }
  return out.length ? out : [{ text: "" }];
}

/* Un firmante: renglones de texto con formato ({ runs }; Firestore no admite
   arreglos dentro de arreglos). Al menos un renglón. */
function normalizeSigner(raw, page) {
  const lines = (Array.isArray(raw?.lines) ? raw.lines : []).slice(0, MAX_SIGNER_LINES)
    .map(line => ({ runs: mergeRuns((Array.isArray(line?.runs) ? line.runs : []).map(run => normalizeRun(run, page)).filter(Boolean)) }));
  return { lines: lines.length ? lines : [{ runs: [{ text: "" }] }] };
}
function normalizeSignatureBlock(src, page) {
  const signers = (Array.isArray(src.signers) ? src.signers : []).slice(0, MAX_SIGNERS).map(signer => normalizeSigner(signer, page));
  /* Sin texto propio: sus renglones viven en los firmantes. `runs` vacío
     mantiene el bloque compatible con las operaciones de texto (largo 0). */
  return { t: SIGNATURE_BLOCK, align: "left", indent: 0, lh: DEFAULT_LINE_HEIGHT, runs: [{ text: "" }], signers: signers.length ? signers : [normalizeSigner({}, page)] };
}
export const isSignatureBlock = block => block?.t === SIGNATURE_BLOCK;
export const isTableBlock = block => block?.t === TABLE_BLOCK;
/* Bloques que no se escriben en la hoja: se editan desde su panel. */
export const isAtomicBlock = block => isSignatureBlock(block) || isTableBlock(block);
/* Todos los fragmentos de un bloque, incluidos los renglones de sus firmantes
   y las celdas de sus tablas. */
export const blockRuns = block => (isSignatureBlock(block) ? block.signers.flatMap(signer => signer.lines.flatMap(line => line.runs))
  : isTableBlock(block) ? block.rows.flatMap(row => row.cells.flatMap(cell => cell.runs)) : block.runs);

/* Firestore no admite arreglos dentro de arreglos: filas y celdas son mapas. */
function normalizeTableBlock(src, page) {
  const rawRows = (Array.isArray(src.rows) ? src.rows : []).slice(0, MAX_TABLE_ROWS);
  const width = Math.min(MAX_TABLE_COLS, Math.max(1, ...rawRows.map(row => (Array.isArray(row?.cells) ? row.cells.length : 0))));
  const rows = (rawRows.length ? rawRows : [{}]).map(row => {
    const cells = (Array.isArray(row?.cells) ? row.cells : []).slice(0, width);
    while (cells.length < width) cells.push({});
    const out = { cells: cells.map(cell => ({ runs: mergeRuns((Array.isArray(cell?.runs) ? cell.runs : []).map(run => normalizeRun(run, page)).filter(Boolean)) })) };
    if (row?.h === true) out.h = true;
    return out;
  });
  const cols = Array.from({ length: width }, (_, i) => clampInt(Array.isArray(src.cols) ? src.cols[i] : 1, 1, 100) || 1);
  return { t: TABLE_BLOCK, align: "left", indent: 0, lh: DEFAULT_LINE_HEIGHT, runs: [{ text: "" }], cols, rows };
}

function normalizeBlock(raw, page) {
  const src = raw && typeof raw === "object" ? raw : {};
  if (src.t === SIGNATURE_BLOCK) return normalizeSignatureBlock(src, page);
  if (src.t === TABLE_BLOCK) return normalizeTableBlock(src, page);
  const t = BLOCK_TYPES.includes(src.t) ? src.t : "p";
  const block = { t };
  if (t === "li") block.list = LIST_KINDS.includes(src.list) ? src.list : "ul";
  block.align = ALIGNMENTS.includes(src.align) ? src.align : "left";
  block.indent = clampInt(src.indent, 0, MAX_INDENT);
  const lh = Number(src.lh);
  block.lh = LINE_HEIGHTS.includes(lh) ? lh : DEFAULT_LINE_HEIGHT;
  block.runs = mergeRuns((Array.isArray(src.runs) ? src.runs : []).map(run => normalizeRun(run, page)).filter(Boolean));
  return block;
}

export function emptyContent(page = DEFAULT_PAGE) {
  return normalizeContent({ page, blocks: [] });
}

/* Forma canónica de un contenido, venga de Firestore, de una plantilla o del
   editor. No recorta: un contenido demasiado grande se detecta con
   `limitIssues` y se rechaza al guardarlo, nunca se trunca en silencio. */
export function normalizeContent(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const page = normalizePage(src.page);
  const blocks = (Array.isArray(src.blocks) ? src.blocks : []).map(block => normalizeBlock(block, page));
  return { page, blocks: blocks.length ? blocks : [normalizeBlock({}, page)] };
}

export function contentStats(content) {
  const model = normalizeContent(content);
  let chars = 0, maxRuns = 0;
  for (const block of model.blocks) {
    maxRuns = Math.max(maxRuns, block.runs.length);
    for (const run of blockRuns(block)) chars += run.text.length;
  }
  const bytes = new TextEncoder().encode(JSON.stringify(model)).length;
  const ratio = Math.max(model.blocks.length / LIMITS.blocks, maxRuns / LIMITS.runs, chars / LIMITS.chars, bytes / LIMITS.bytes);
  return { blocks: model.blocks.length, maxRuns, chars, bytes, ratio };
}

export function limitIssues(content) {
  const stats = contentStats(content);
  return [
    stats.blocks > LIMITS.blocks && { code: "TOO_MANY_BLOCKS", value: stats.blocks, limit: LIMITS.blocks },
    stats.maxRuns > LIMITS.runs && { code: "TOO_MANY_RUNS", value: stats.maxRuns, limit: LIMITS.runs },
    stats.chars > LIMITS.chars && { code: "TOO_MUCH_TEXT", value: stats.chars, limit: LIMITS.chars },
    stats.bytes > LIMITS.bytes && { code: "TOO_LARGE", value: stats.bytes, limit: LIMITS.bytes }
  ].filter(Boolean);
}

/* ── Serialización a HTML ──────────────────────────────────────────────── */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ESCAPES[c]);
const LH_CLASS = new Map([[1, "100"], [1.15, "115"], [1.5, "150"], [2, "200"]]);
const LH_FROM_CLASS = new Map([...LH_CLASS].map(([lh, cls]) => [cls, lh]));

function runHtml(run, editable) {
  let html = escapeHtml(run.text).replace(/\n/g, "<br>");
  if (run.chk !== undefined) html = `<span class="rd-chk" data-chk="${run.chk ? 1 : 0}"${editable ? " contenteditable=\"false\" role=\"checkbox\" aria-checked=\"" + run.chk + "\" title=\"Marcar o desmarcar\"" : ""}>${html}</span>`;
  else if (run.missing) html = `<span class="rd-var" data-var="${escapeHtml(run.missing)}"${editable ? " contenteditable=\"false\"" : ""}>${html}</span>`;
  const cls = [run.size && `rd-s-${run.size}`, run.font && `rd-f-${run.font}`].filter(Boolean);
  if (cls.length) html = `<span class="${cls.join(" ")}">${html}</span>`;
  if (run.u) html = `<u>${html}</u>`;
  if (run.i) html = `<em>${html}</em>`;
  if (run.b) html = `<strong>${html}</strong>`;
  return html;
}

function blockHtml(block, editable) {
  const cls = [
    block.align !== "left" && `rd-a-${block.align}`,
    block.indent > 0 && `rd-i-${block.indent}`,
    block.lh !== DEFAULT_LINE_HEIGHT && `rd-lh-${LH_CLASS.get(block.lh)}`
  ].filter(Boolean);
  const text = block.runs.map(run => run.text).join("");
  /* Un bloque vacío necesita un <br> para tener altura; uno que termina en
     salto de línea, otro <br> para que ese último renglón se vea. */
  const inner = !text ? "<br>" : block.runs.map(run => runHtml(run, editable)).join("") + (text.endsWith("\n") ? "<br>" : "");
  return `<${block.t}${cls.length ? ` class="${cls.join(" ")}"` : ""}>${inner}</${block.t}>`;
}

/* Firmas: una columna por firmante, con espacio para firmar y la raya. En
   el editor el bloque es atómico y lleva su contenido en `data-rd-sig`
   (JSON escapado): así vuelve completo al modelo, renglones vacíos incluidos. */
function signatureHtml(block, editable) {
  const signers = block.signers.map(signer => {
    const lines = signer.lines.filter(line => line.runs.some(run => run.text)).map(line => `<p class="rd-sig-line">${line.runs.map(run => runHtml(run, false)).join("")}</p>`).join("");
    return `<div class="rd-signer"><div class="rd-sig-rule"></div>${lines}</div>`;
  }).join("");
  const data = editable ? ` contenteditable="false" data-rd-sig="${escapeHtml(JSON.stringify({ signers: block.signers }))}"` : "";
  return `<div class="rd-sig rd-sig-${block.signers.length}"${data}>${signers}</div>`;
}

/* Tabla: como las firmas, atómica en el editor con su contenido en
   `data-rd-tbl`. Anchos en porcentaje de las columnas. */
function tableHtml(block, editable) {
  const total = block.cols.reduce((n, w) => n + w, 0);
  const colgroup = `<colgroup>${block.cols.map(w => `<col style="width:${Math.round((w / total) * 1000) / 10}%">`).join("")}</colgroup>`;
  const rows = block.rows.map(row => `<tr>${row.cells.map(cell => {
    const tag = row.h ? "th" : "td";
    const text = cell.runs.map(run => run.text).join("");
    return `<${tag}>${text ? cell.runs.map(run => runHtml(run, false)).join("") : "<br>"}</${tag}>`;
  }).join("")}</tr>`).join("");
  const data = editable ? ` contenteditable="false" data-rd-tbl="${escapeHtml(JSON.stringify({ cols: block.cols, rows: block.rows }))}"` : "";
  return `<div class="rd-tbl"${data}><table>${colgroup}<tbody>${rows}</tbody></table></div>`;
}

/* HTML del contenido: sólo etiquetas y clases de la lista blanca; todo el
   texto va escapado. `editable` marca los datos faltantes como atómicos
   (se borran completos) dentro del editor. */
export function toHtml(content, { editable = false } = {}) {
  const model = normalizeContent(content);
  let html = "", open = null;
  for (const block of model.blocks) {
    const list = block.t === "li" ? block.list : null;
    if (open && open !== list) { html += `</${open}>`; open = null; }
    if (list && !open) { html += `<${list}>`; open = list; }
    html += isSignatureBlock(block) ? signatureHtml(block, editable) : isTableBlock(block) ? tableHtml(block, editable) : blockHtml(block, editable);
  }
  return open ? `${html}</${open}>` : html;
}

/* Clases de la hoja: tamaño, márgenes, fuente y tamaño base. */
export function pageClasses(page) {
  const p = normalizePage(page);
  return `rd-page rd-page-${p.size} rd-m-${p.margin} rd-font-${p.font} rd-size-${p.fontSize}`;
}

/* ── Serialización desde el DOM (editor y portapapeles) ────────────────── */

/* Nunca aportan texto: código, estilos, multimedia y controles. */
const SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED", "HEAD", "TITLE", "META", "LINK", "BASE",
  "SVG", "MATH", "IMG", "PICTURE", "VIDEO", "AUDIO", "CANVAS", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "HR", "COL", "COLGROUP", "XML"]);
/* Cada uno es un párrafo propio. Sin tablas en v1: cada celda se vuelve un
   párrafo, en orden, sin inventar separadores. */
const BLOCKS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE", "HEADER",
  "FOOTER", "ADDRESS", "ASIDE", "NAV", "MAIN", "FIGURE", "FIGCAPTION", "DD", "DT", "CENTER", "TD", "TH", "CAPTION"]);
/* Sólo agrupan: no son un párrafo. */
const CONTAINERS = new Set(["HTML", "BODY", "DL", "TABLE", "THEAD", "TBODY", "TFOOT", "TR"]);
/* Vacíos siguen siendo una línea en blanco; un <div> vacío pegado es ruido
   (el editor escribe su línea en blanco como <div><br></div>). */
const KEEP_EMPTY = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI"]);

const nodeNameOf = node => String(node?.nodeName || "").toUpperCase();
const attrOf = (node, name) => (typeof node?.getAttribute === "function" ? node.getAttribute(name) : null) ?? "";
const classesOf = node => attrOf(node, "class").split(/\s+/).filter(Boolean);
const styleOf = node => (node?.style && typeof node.style === "object" ? node.style : {});
const childrenOf = node => Array.from(node?.childNodes || []);
function textOf(node) {
  if (node?.nodeType === 3) return String(node.nodeValue ?? node.textContent ?? "");
  return childrenOf(node).map(textOf).join("");
}
const collapse = text => text.replace(/[ \t\n\r\f]+/g, " ");

/* Una longitud CSS en puntos. */
const UNIT_PT = { pt: 1, px: 0.75, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, em: 12, rem: 12, pc: 12 };
function toPt(value) {
  const match = /^(-?\d*\.?\d+)\s*(pt|px|in|cm|mm|em|rem|pc)?$/i.exec(String(value ?? "").trim());
  if (!match) return null;
  const n = Number(match[1]) * UNIT_PT[(match[2] || "px").toLowerCase()];
  return Number.isFinite(n) ? n : null;
}
const FONT_KEYWORDS = { "xx-small": 9, "x-small": 9, small: 10, medium: 12, large: 14, "x-large": 18, "xx-large": 24, "xxx-large": 24 };
const FONT_TAG_SIZES = { 1: 9, 2: 10, 3: 12, 4: 14, 5: 18, 6: 24, 7: 24 };
const nearestSize = pt => FONT_SIZES.reduce((best, size) => (Math.abs(size - pt) < Math.abs(best - pt) ? size : best), FONT_SIZES[0]);
/* Interlineado por umbrales, no por cercanía: Google Docs escribe 1.38 para su
   «1.15» y Word 1.08 para su sencillo. */
function snapLineHeight(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw || raw === "normal") return null;
  let n = null;
  if (/%$/.test(raw)) n = Number(raw.slice(0, -1)) / 100;
  else if (/^\d*\.?\d+$/.test(raw)) n = Number(raw);
  else { const pt = toPt(raw); if (pt != null) n = pt / DEFAULT_PAGE.fontSize; }
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1.08 ? 1 : n < 1.4 ? 1.15 : n < 1.75 ? 1.5 : 2;
}
function fontKind(family) {
  const f = String(family ?? "").toLowerCase();
  if (!f) return null;
  if (/mono|courier|consolas|menlo|monaco/.test(f)) return "mono";
  if (/sans/.test(f)) return "sans";
  if (/serif|times|georgia|garamond|cambria|palatino|book antiqua|baskerville/.test(f)) return "serif";
  return "sans";
}
function alignFrom(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "center" || v === "right" || v === "justify") return v;
  if (v === "end") return "right";
  if (v === "left" || v === "start") return "left";
  return null;
}
const classValue = (node, pattern) => { for (const cls of classesOf(node)) { const m = pattern.exec(cls); if (m) return m[1]; } return null; };

/* Formato de un elemento sobre el heredado. El estilo explícito manda sobre
   la etiqueta: Google Docs envuelve todo en <b style="font-weight:normal">. */
function inlineFormat(node, name, parent, page) {
  const f = { ...parent };
  const st = styleOf(node);
  if (name === "B" || name === "STRONG") f.b = true;
  if (name === "I" || name === "EM" || name === "CITE" || name === "DFN") f.i = true;
  if (name === "U" || name === "INS") f.u = true;
  const weight = String(st.fontWeight ?? "").toLowerCase();
  if (weight === "bold" || weight === "bolder" || Number(weight) >= 600) f.b = true;
  else if (weight === "normal" || weight === "lighter" || (Number(weight) > 0 && Number(weight) < 600)) delete f.b;
  const style = String(st.fontStyle ?? "").toLowerCase();
  if (style === "italic" || style === "oblique") f.i = true;
  else if (style === "normal") delete f.i;
  if (String(st.textDecorationLine || st.textDecoration || "").toLowerCase().includes("underline")) f.u = true;

  let pt = null;
  const sizeClass = classValue(node, /^rd-s-(\d+)$/);
  if (sizeClass) pt = Number(sizeClass);
  else if (st.fontSize) pt = FONT_KEYWORDS[String(st.fontSize).toLowerCase()] ?? toPt(st.fontSize);
  else if (name === "FONT" && attrOf(node, "size")) pt = FONT_TAG_SIZES[attrOf(node, "size")] ?? null;
  if (pt != null && pt > 0) {
    const size = nearestSize(pt);
    if (size === page.fontSize) delete f.size; else f.size = size;
  }
  const kind = classValue(node, /^rd-f-(sans|serif|mono)$/) || fontKind(st.fontFamily || (name === "FONT" ? attrOf(node, "face") : ""));
  if (kind) { if (kind === page.font) delete f.font; else f.font = kind; }
  return f;
}

/* Viñeta que Word pega como texto en un <span style="mso-list:Ignore">. */
const MSO_IGNORE = /mso-list:\s*ignore/i;
function msoMarker(node) {
  for (const child of childrenOf(node)) {
    if (child?.nodeType !== 1) continue;
    if (MSO_IGNORE.test(attrOf(child, "style"))) return textOf(child);
    const inner = msoMarker(child);
    if (inner != null) return inner;
  }
  return null;
}

function blockAttrs(node, name, ctx) {
  const st = styleOf(node);
  const parent = ctx.attrs;
  let t = "p", list;
  if (/^H[1-6]$/.test(name)) t = name === "H1" ? "h1" : name === "H2" ? "h2" : "h3";
  const ownIndentClass = classValue(node, /^rd-i-(\d)$/);
  let indent;
  const msoLevel = /mso-list:\s*l\d+\s+level(\d+)/i.exec(attrOf(node, "style"));
  if (name === "LI") {
    t = "li"; list = ctx.list || "ul";
    indent = Math.max(0, ctx.depth ?? 0) + (ownIndentClass ? Number(ownIndentClass) : 0);
  } else if (msoLevel) {
    t = "li";
    list = /^\s*[\dA-Za-z]{1,3}[.)]/.test(msoMarker(node) ?? "") ? "ol" : "ul";
    indent = Number(msoLevel[1]) - 1;
  } else {
    const margin = toPt(st.marginLeft) ?? toPt(st.paddingLeft);
    const own = ownIndentClass ? Number(ownIndentClass) : margin != null ? Math.round(margin / INDENT_STEP_PT) : 0;
    indent = parent.indent + own;
  }
  const align = alignFrom(classValue(node, /^rd-a-(center|right|justify)$/)) || alignFrom(st.textAlign) || alignFrom(attrOf(node, "align"))
    || (name === "CENTER" ? "center" : null) || parent.align;
  const lhClass = classValue(node, /^rd-lh-(\d+)$/);
  const lh = (lhClass && LH_FROM_CLASS.get(lhClass)) || snapLineHeight(st.lineHeight) || parent.lh;
  return { t, list, align, indent: clampInt(indent, 0, MAX_INDENT), lh };
}

/* Espacios como los pinta el navegador: sin repetidos, sin espacio al inicio
   de un renglón ni antes de un salto, sin el salto final (un <br> al cierre de
   un bloque no se ve). Un bloque de puros espacios duros —el <p>&nbsp;</p> de
   Word— es un párrafo vacío. */
function finishBlock(block, page) {
  const seq = [];
  for (const run of block.runs) {
    if (run.missing || run.chk !== undefined) seq.push({ run, atom: true });
    else for (const ch of run.text) seq.push({ run, ch });
  }
  const kept = [];
  for (const item of seq) {
    const last = kept[kept.length - 1];
    if (item.ch === " ") { if (last && last.ch !== " " && last.ch !== "\n") kept.push(item); }
    else if (item.ch === "\n") { if (last?.ch === " ") kept.pop(); kept.push(item); }
    else kept.push(item);
  }
  if (kept[kept.length - 1]?.ch === " ") kept.pop();
  if (kept[kept.length - 1]?.ch === "\n") kept.pop();
  const blank = kept.every(item => !item.atom && /^[\s\u00A0]$/.test(item.ch));
  const runs = [];
  if (!blank) for (const item of kept) {
    const last = runs[runs.length - 1];
    if (item.atom) runs.push({ ...item.run });
    else if (last && last.source === item.run) last.text += item.ch;
    else runs.push({ ...item.run, text: item.ch, source: item.run });
  }
  return normalizeBlock({ ...block, runs: runs.map(({ source, ...run }) => run) }, page);
}

/* Contenido desde un árbol tipo DOM: el del editor o el del portapapeles
   (Word, Google Docs, páginas web). Es el sanitizador del editor: todo lo que
   no está en la lista blanca se reduce a su texto o se descarta. El árbol se
   lee sólo por `nodeType`, `nodeName`, `nodeValue`, `childNodes`,
   `getAttribute` y `style`. */
export function fromNodes(root, { page } = {}) {
  const base = normalizePage(page);
  const out = [];
  let cur = null;
  const newBlock = attrs => ({ t: attrs.t, ...(attrs.t === "li" ? { list: attrs.list } : {}), align: attrs.align, indent: attrs.indent, lh: attrs.lh, runs: [] });
  const flush = keepEmpty => {
    if (cur && (cur.hasInline || keepEmpty)) out.push(finishBlock(cur.block, base));
    cur = null;
  };
  const ensure = ctx => (cur ||= { block: newBlock(ctx.attrs), hasInline: false, owner: ctx.owner });
  const walkChildren = (node, ctx) => { for (const child of childrenOf(node)) walk(child, ctx); };

  function walkBlock(node, name, ctx) {
    const attrs = blockAttrs(node, name, ctx);
    /* El <p> que Word y Docs meten dentro de un <li> es el mismo renglón. */
    if (ctx.inLi && cur && cur.owner === ctx.owner && !cur.hasInline && (name === "P" || name === "DIV")) {
      if (attrs.align !== ctx.attrs.align) cur.block.align = attrs.align;
      walkChildren(node, { ...ctx, inLi: false });
      return;
    }
    flush(false);
    if (ctx.owner) ctx.owner.hadBlockChild = true;
    const owner = { hadBlockChild: false };
    cur = { block: newBlock(attrs), hasInline: false, owner };
    /* Lo que siga a una lista anidada dentro de un <li> continúa bajo la viñeta. */
    const inner = attrs.t === "li" ? { t: "p", align: attrs.align, indent: Math.min(MAX_INDENT, attrs.indent + 1), lh: attrs.lh } : attrs;
    walkChildren(node, { ...ctx, attrs: inner, owner, inLi: attrs.t === "li" });
    /* Un párrafo sin contenido se conserva (es una línea en blanco); lo que
       queda de un contenedor después de sus párrafos, no. */
    flush(cur?.owner === owner && !owner.hadBlockChild && (KEEP_EMPTY.has(name) || attrs.t === "li"));
  }

  function walk(node, ctx) {
    if (node?.nodeType === 3) {
      const text = collapse(String(node.nodeValue ?? node.textContent ?? ""));
      if (!text) return;
      const blank = /^[ \u00A0]*$/.test(text);
      if (blank && !cur) return;
      ensure(ctx).block.runs.push({ ...ctx.fmt, text });
      if (!blank) cur.hasInline = true;
      return;
    }
    if (node?.nodeType !== 1) return;
    const name = nodeNameOf(node);
    if (SKIP.has(name) || MSO_IGNORE.test(attrOf(node, "style"))) return;
    /* El bloque de firmas del editor (o copiado de otro documento): su
       contenido viene en data-rd-sig y se normaliza como cualquier otro. */
    const sig = attrOf(node, "data-rd-sig");
    if (sig) {
      let data = null;
      try { data = JSON.parse(sig); } catch { data = null; }
      if (data && typeof data === "object") { flush(false); out.push({ t: SIGNATURE_BLOCK, signers: data.signers }); return; }
    }
    const tbl = attrOf(node, "data-rd-tbl");
    if (tbl) {
      let data = null;
      try { data = JSON.parse(tbl); } catch { data = null; }
      if (data && typeof data === "object") { flush(false); out.push({ t: TABLE_BLOCK, cols: data.cols, rows: data.rows }); return; }
    }
    /* Casilla del editor: atómica, conserva si está marcada. */
    const chk = attrOf(node, "data-chk");
    if (chk === "0" || chk === "1") {
      ensure(ctx).block.runs.push({ ...inlineFormat(node, name, ctx.fmt, base), text: "", chk: chk === "1" });
      cur.hasInline = true;
      return;
    }
    if (name === "BR") {
      /* Marca de fin de selección que Chrome/Safari agregan al copiar (p. ej.
         desde Google Docs): no es contenido. */
      if (classesOf(node).includes("Apple-interchange-newline")) return;
      ensure(ctx).block.runs.push({ ...ctx.fmt, text: "\n" });
      cur.hasInline = true;
      return;
    }
    const fmt = inlineFormat(node, name, ctx.fmt, base);
    const variable = attrOf(node, "data-var");
    if (variable && DATA_PATH_PATTERN.test(variable)) {
      ensure(ctx).block.runs.push({ ...fmt, text: collapse(textOf(node)).trim() || placeholderFor(variable), missing: variable });
      cur.hasInline = true;
      return;
    }
    if (name === "UL" || name === "OL") { walkChildren(node, { ...ctx, fmt, list: name.toLowerCase(), depth: ctx.depth + 1 }); return; }
    if (CONTAINERS.has(name)) { walkChildren(node, { ...ctx, fmt }); return; }
    if (BLOCKS.has(name) || /mso-list:\s*l\d+\s+level\d+/i.test(attrOf(node, "style"))) { walkBlock(node, name, { ...ctx, fmt }); return; }
    walkChildren(node, { ...ctx, fmt });
  }

  const rootAttrs = { t: "p", align: "left", indent: 0, lh: DEFAULT_LINE_HEIGHT };
  const rootOwner = { hadBlockChild: false };
  walkChildren(root, { attrs: rootAttrs, owner: rootOwner, fmt: {}, list: null, depth: -1, inLi: false });
  flush(false);
  return normalizeContent({ page: base, blocks: out });
}

/* ── Datos del cliente ─────────────────────────────────────────────────── */

/* Sólo campos que existen: `clientes/{id}` (en clientes.html, `c._raw`) y el
   perfil del workspace `consultores/{owner}`. Las rutas conservan el nombre
   real del campo; sólo la etiqueta es amigable. */
const CLIENT_FIELDS = Object.freeze([
  ["empresa", "Razón social / establecimiento"], ["encargado", "Responsable"], ["direccion", "Domicilio"],
  ["municipio", "Municipio"], ["rfc", "RFC"], ["giro", "Giro"], ["telefono", "Teléfono"], ["correo", "Correo"],
  ["numEmpleados", "Número de empleados"], ["aforoHabitual", "Aforo habitual"], ["tipoLicencia", "Tipo de licencia"]
]);
const CONSULTANT_FIELDS = Object.freeze([
  ["nombreConsultor", "Nombre del consultor"], ["empresaEmisora", "Empresa del consultor"], ["rfcEmisor", "RFC del consultor"],
  ["direccionEmisor", "Domicilio del consultor"], ["telefonoEmisor", "Teléfono del consultor"], ["correoEmisor", "Correo del consultor"],
  ["registroEdomex", "Registro CGPC Edo. Méx."], ["idRepc", "ID R.E.P.C."], ["registroStps", "Registro STPS"]
]);

export const EDITOR_VARIABLES = Object.freeze([
  ...CLIENT_FIELDS.map(([key, label]) => Object.freeze({ path: `cliente.${key}`, label, group: "Cliente" })),
  ...CONSULTANT_FIELDS.map(([key, label]) => Object.freeze({ path: `consultor.${key}`, label, group: "Consultor" })),
  Object.freeze({ path: "documento.nombre", label: "Nombre del documento", group: "Documento" }),
  Object.freeze({ path: "fecha.hoy", label: "Fecha de hoy", group: "Documento" }),
  /* Por partes, para cartas con «a [día] de [mes] de [año]». */
  Object.freeze({ path: "fecha.dia", label: "Día de hoy", group: "Documento" }),
  Object.freeze({ path: "fecha.mes", label: "Mes actual", group: "Documento" }),
  Object.freeze({ path: "fecha.anio", label: "Año actual", group: "Documento" })
]);
const VARIABLE_LABELS = new Map(EDITOR_VARIABLES.map(v => [v.path, v.label]));
/* Un dato fuera del catálogo nunca muestra su ruta interna. */
export const variableLabel = path => VARIABLE_LABELS.get(path) || "Dato";
export const placeholderFor = path => `[${variableLabel(path)}]`;

function longDate(now, timeZone) {
  const options = { day: "numeric", month: "long", year: "numeric" };
  try { return new Intl.DateTimeFormat("es-MX", { ...options, timeZone }).format(new Date(now)); }
  catch { return new Intl.DateTimeFormat("es-MX", options).format(new Date(now)); }
}

/* Los datos que el editor puede insertar. `documento`: el requisito del
   expediente del que se parte, si lo hay. */
export function editorData({ cliente = {}, perfil = {}, documento = null, now = Date.now(), timeZone = "America/Mexico_City" } = {}) {
  const consultor = Object.fromEntries(CONSULTANT_FIELDS.map(([key]) => [key, oneLine(perfil?.[key])]));
  /* El perfil guarda el correo de acceso en `email`; `correoEmisor` es el del
     emisor si lo capturó. */
  consultor.correoEmisor ||= oneLine(perfil?.email);
  return {
    cliente: Object.fromEntries(CLIENT_FIELDS.map(([key]) => [key, oneLine(cliente?.[key])])),
    consultor,
    documento: { nombre: oneLine(documento?.name ?? documento?.nombre) },
    fecha: { hoy: longDate(now, timeZone), ...dateParts(now, timeZone) }
  };
}
function dateParts(now, timeZone) {
  const part = (options) => {
    try { return new Intl.DateTimeFormat("es-MX", { ...options, timeZone }).format(new Date(now)); }
    catch { return new Intl.DateTimeFormat("es-MX", options).format(new Date(now)); }
  };
  return { dia: part({ day: "numeric" }), mes: part({ month: "long" }), anio: part({ year: "numeric" }) };
}

/* Catálogo para «Insertar dato»: cada dato con su valor y si falta. */
export function editorVariables(data = {}) {
  return EDITOR_VARIABLES.map(variable => {
    const value = readDataPath(data, variable.path);
    return { ...variable, value: isBlankData(value) ? "" : String(value), missing: isBlankData(value) };
  });
}

/* El fragmento que se inserta: el valor como texto normal (como en Word) o,
   si falta, un marcador visible que conserva la ruta. */
export function variableRun(path, data = {}, format = {}) {
  const value = readDataPath(data, path);
  const { text: _text, missing: _missing, ...fmt } = format;
  return isBlankData(value) ? { ...fmt, text: placeholderFor(path), missing: path } : { ...fmt, text: oneLine(value) };
}

function resolveRun(run, data) {
  const { text, ...fmt } = run;
  const out = [];
  let last = 0;
  for (const match of text.matchAll(DATA_BINDING_PATTERN)) {
    if (match.index > last) out.push({ ...fmt, text: text.slice(last, match.index) });
    out.push(variableRun(match[1], data, fmt));
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ ...fmt, text: text.slice(last) });
  return out.length ? out : [run];
}

/* ── Firmas ────────────────────────────────────────────────────────────── */

/* Un firmante a partir de sus renglones: el primero (el nombre) en
   negritas; del cuarto en adelante (registros), en letra de 9 pt. */
export function signerFrom(lines) {
  return {
    lines: (Array.isArray(lines) ? lines : []).slice(0, MAX_SIGNER_LINES).map((text, i) => ({
      runs: [{ text: String(text ?? ""), ...(i === 0 ? { b: true } : {}), ...(i >= 3 ? { size: 9 } : {}) }]
    }))
  };
}
export const signatureBlock = signers => ({ t: SIGNATURE_BLOCK, signers });
/* Los firmantes de siempre: quien responde por el establecimiento y el
   consultor, con los registros que tenga en su perfil. */
export const CLIENT_SIGNER = Object.freeze(["{{cliente.encargado}}", "Propietario / Representante legal", "{{cliente.empresa}}"]);
export const CONSULTANT_SIGNER = Object.freeze(["{{consultor.nombreConsultor}}", "Consultor", "{{consultor.empresaEmisora}}",
  "REG. CGPC EDO. MEX.: {{consultor.registroEdomex}}", "ID R.E.P.C.: {{consultor.idRepc}}"]);

/* Un renglón de registro («REG. …: [dato]») cuyo dato falta no se deja
   como pendiente: se quita. No todos los consultores tienen todos los
   registros, y una firma no debe imprimirse con «[ID R.E.P.C.]». */
const REGISTRY_LABEL = /^[^:\n]{1,40}:\s*$/;
function pruneRegistryLines(signer) {
  const lines = signer.lines.filter(line => {
    const missing = line.runs.filter(run => run.missing);
    if (!missing.length) return true;
    const rest = line.runs.filter(run => !run.missing).map(run => run.text).join("");
    return !(missing.length === 1 && line.runs[line.runs.length - 1].missing && REGISTRY_LABEL.test(rest));
  });
  return { lines: lines.length ? lines : signer.lines.slice(0, 1) };
}

/* Contenido de una plantilla con sus `{{ruta}}` resueltos al crear el
   documento. No queda ningún vínculo vivo: lo que el usuario edite después es
   texto suyo. */
export function applyTemplate(content, data = {}) {
  const model = normalizeContent(content);
  const resolve = runs => runs.flatMap(run => (run.missing || run.chk !== undefined ? [run] : resolveRun(run, data)));
  const blocks = model.blocks.map(block => (isSignatureBlock(block)
    ? { ...block, signers: block.signers.map(signer => pruneRegistryLines({ lines: signer.lines.map(line => ({ runs: resolve(line.runs) })) })) }
    : isTableBlock(block) ? { ...block, rows: block.rows.map(row => ({ ...row, cells: row.cells.map(cell => ({ runs: resolve(cell.runs) })) })) }
    : { ...block, runs: resolve(block.runs) }));
  return normalizeContent({ page: model.page, blocks });
}

/* Datos que siguen faltando en el documento, una vez cada uno. */
export function missingOf(content) {
  const seen = new Map();
  for (const block of normalizeContent(content).blocks) {
    for (const run of blockRuns(block)) if (run.missing && !seen.has(run.missing)) seen.set(run.missing, { path: run.missing, label: variableLabel(run.missing) });
  }
  return [...seen.values()];
}

/* Indicaciones entre corchetes que siguen en el texto («[Lugar]», «[Escribe
   aquí…]»): las estructuras y SafeAdvisor las dejan para quien redacta. No
   cuentan los datos faltantes (ya tienen su propio aviso). Cada una con su
   primera posición ({ b, o } como la selección del editor) y cuántas veces
   aparece. */
const BRACKET = /\[[^[\]\n\u0001]{1,160}\]/g;
export function bracketsOf(content) {
  const found = new Map();
  normalizeContent(content).blocks.forEach((block, b) => {
    /* Sobre el texto del bloque (una indicación puede cruzar formatos), con
       cada dato faltante tapado por un relleno del mismo largo. */
    const texts = isSignatureBlock(block) ? block.signers.flatMap(signer => signer.lines.map(line => line.runs))
      : isTableBlock(block) ? block.rows.flatMap(row => row.cells.map(cell => cell.runs)) : [block.runs];
    for (const runs of texts) {
      const text = runs.map(run => (run.missing ? "\u0001".repeat(run.text.length) : run.text)).join("");
      for (const match of text.matchAll(BRACKET)) {
        const key = match[0].replace(/\s+/g, " ");
        const seen = found.get(key);
        if (seen) seen.count++;
        /* En las firmas y tablas no hay cursor: se lleva al bloque. */
        else if (isAtomicBlock(block)) found.set(key, { text: key, start: { b, o: 0 }, end: { b, o: 0 }, count: 1 });
        else found.set(key, { text: key, start: { b, o: match.index }, end: { b, o: match.index + match[0].length }, count: 1 });
      }
    }
  });
  return [...found.values()];
}

/* Texto plano (búsqueda, extracto): listas con viñeta o número. */
export function plainText(content) {
  let n = 0;
  return normalizeContent(content).blocks.map(block => {
    if (isSignatureBlock(block)) { n = 0; return block.signers.map(signer => signer.lines.map(line => line.runs.map(run => run.text).join("")).filter(Boolean).join("\n")).join("\n\n"); }
    if (isTableBlock(block)) { n = 0; return block.rows.map(row => row.cells.map(cell => cell.runs.map(run => run.text).join("").replace(/\n/g, " ")).join("\t")).join("\n"); }
    const text = block.runs.map(run => run.text).join("").replace(/\u00A0/g, " ");
    if (block.t !== "li") { n = 0; return text; }
    const marker = block.list === "ol" ? `${++n}. ` : "• ";
    if (block.list !== "ol") n = 0;
    return marker + text;
  }).join("\n");
}

export function isBlankContent(content) {
  return normalizeContent(content).blocks.every(block => blockRuns(block).every(run => !run.missing && !run.text.replace(/\u00A0/g, " ").trim()));
}

/* ── Plantillas del editor ─────────────────────────────────────────────── */

/* Estructuras neutras de producto: los corchetes son instrucciones para quien
   redacta, no texto oficial. El texto legal de cada formato lo aporta el
   usuario (o una plantilla de su workspace, en una fase posterior). */
const para = (text, { t = "p", align = "left", b = false } = {}) => ({ t, align, runs: [{ text, ...(b ? { b: true } : {}) }] });
const SIGNATURE = [para("Atentamente,", { align: "center" }), signatureBlock([signerFrom(CONSULTANT_SIGNER)])];
const TEMPLATE_DEFS = [
  { id: "en-blanco", label: "Hoja en blanco", description: "Empieza desde cero.", blocks: [para("")] },
  {
    id: "carta", label: "Carta", description: "Lugar y fecha, destinatario, cuerpo y firma.",
    blocks: [
      para("[Lugar], a {{fecha.hoy}}.", { align: "right" }), para(""),
      para("{{cliente.encargado}}", { b: true }), para("{{cliente.empresa}}"), para("{{cliente.direccion}}"), para("Presente", { b: true }), para(""),
      para("[Escribe aquí el contenido de la carta.]", { align: "justify" }), para(""),
      ...SIGNATURE
    ]
  },
  {
    id: "carta-corresponsabilidad", label: "Carta de corresponsabilidad (estructura)",
    description: "Estructura sugerida con los datos del establecimiento; el texto de la declaración lo redactas tú.",
    blocks: [
      para("CARTA DE CORRESPONSABILIDAD", { t: "h2", align: "center" }), para(""),
      para("[Lugar], a {{fecha.hoy}}.", { align: "right" }), para(""),
      para("[Nombre y cargo de la autoridad de Protección Civil a la que se dirige]", { b: true }), para("Presente", { b: true }), para(""),
      para("Establecimiento: {{cliente.empresa}}"), para("Domicilio: {{cliente.direccion}}"), para("Responsable: {{cliente.encargado}}"), para(""),
      para("[Redacta aquí la declaración de corresponsabilidad y su alcance, conforme al formato que solicita la autoridad.]", { align: "justify" }), para(""),
      para("Atentamente,", { align: "center" }),
      signatureBlock([signerFrom(CLIENT_SIGNER), signerFrom(CONSULTANT_SIGNER)])
    ]
  },
  {
    id: "oficio", label: "Oficio", description: "Asunto, destinatario, cuerpo y firma.",
    blocks: [
      para("Asunto: [asunto]", { align: "right", b: true }), para("[Lugar], a {{fecha.hoy}}.", { align: "right" }), para(""),
      para("[Nombre y cargo del destinatario]", { b: true }), para("[Dependencia o empresa]"), para("Presente", { b: true }), para(""),
      para("[Escribe aquí el cuerpo del oficio.]", { align: "justify" }), para(""),
      ...SIGNATURE
    ]
  }
];
function deepFreeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
export const EDITOR_TEMPLATES = deepFreeze(TEMPLATE_DEFS.map(({ id, label, description, blocks }) => ({
  id, label, description, content: normalizeContent({ page: DEFAULT_PAGE, blocks })
})));
export const templateById = id => EDITOR_TEMPLATES.find(template => template.id === id) || null;

/* Plantilla sugerida por lo que dice el pendiente o el requisito. */
export function templateFor({ text = "", docName = "" } = {}) {
  const t = fold(`${docName} ${text}`);
  if (/corresponsabilidad/.test(t)) return "carta-corresponsabilidad";
  if (/\boficio\b|\bescrito\b/.test(t)) return "oficio";
  if (/\bcarta\b/.test(t)) return "carta";
  return null;
}

/* ── Desde un pendiente ────────────────────────────────────────────────── */

const DRAFT_VERB = /^(?:elaborar|redactar|preparar|hacer|emitir|generar|escribir|actualizar|realizar)\b/;
/* Documentos que se redactan. Fuera: planos (SafePlan), constancias y DC-3
   (emisión con QR del Dashboard), cotizaciones (su propio flujo). */
const WRITTEN_DOC = /\b(?:carta|oficio|escrito|documento|acta|informe|reporte|programa|pipc|plan|procedimiento|manual|minuta|contrato|responsiva|solicitud|aviso|dictamen|memoria|reglamento|politica|protocolo)s?\b/;
const TITLE_VERB = /^(?:elaborar|redactar|preparar|hacer|emitir|generar|escribir|actualizar|realizar)(?:\s+(?:(?:el|la|los|las|un|una)\s+)?|$)/i;

export function cleanTitle(value) {
  return oneLine(value).slice(0, LIMITS.title).trim() || "Documento sin título";
}

/* Título sugerido: el nombre del requisito o, si no hay, lo que dice el
   pendiente sin su verbo («Elaborar la carta…» → «Carta…»). */
export function titleFrom({ text = "", docName = "" } = {}) {
  const base = oneLine(docName) || oneLine(text).replace(/^[^\p{L}\p{N}]+/u, "").replace(TITLE_VERB, "").replace(/[.\s]+$/, "");
  return cleanTitle(base ? base.charAt(0).toLocaleUpperCase("es-MX") + base.slice(1) : "");
}

/* ¿Este pendiente se resuelve redactando un documento? Sólo si es tuyo, no
   está concluido y dice que hay que elaborar un documento escrito, o si está
   ligado a un requisito escrito que elaboras tú. `owner` y `linkedDoc.owner`
   los calcula quien llama (pend-workflow / doc-workflow). */
export function draftableFrom({ text = "", done = false, owner = "consultor", linkedDoc = null } = {}) {
  const none = { ok: false, reason: "", template: null, title: "" };
  if (done || owner === "cliente") return none;
  const t = fold(text).replace(/^[^a-z]+/, "");
  let reason = "";
  if (DRAFT_VERB.test(t) && WRITTEN_DOC.test(t)) reason = "texto";
  else if (linkedDoc?.owner === "consultor" && WRITTEN_DOC.test(fold(linkedDoc.name))) reason = "requisito";
  if (!reason) return none;
  const docName = reason === "requisito" ? linkedDoc.name : "";
  return { ok: true, reason, template: templateFor({ text, docName: linkedDoc?.name || "" }), title: titleFrom({ text, docName }) };
}

/* ── Registro en Firestore ─────────────────────────────────────────────── */

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const cleanBy = by => ({ uid: oneLine(by?.uid).slice(0, 128), name: oneLine(by?.name).slice(0, 160) });
const cleanTemplateId = id => (typeof id === "string" && TEMPLATE_ID.test(id) ? id : null);
function cleanOrigin(origin) {
  const out = {};
  if (ID.test(String(origin?.pendienteId ?? ""))) out.pendienteId = origin.pendienteId;
  if (ID.test(String(origin?.docId ?? ""))) out.docId = origin.docId;
  return out;
}
function assertWithinLimits(content) {
  const issues = limitIssues(content);
  if (issues.length) throw new RedaccionError("TOO_LARGE", "El documento es demasiado grande para guardarse. Divídelo en dos documentos.", { issues });
}

/* Versión del contrato que necesita un contenido. */
export function contentVersion(content) {
  const { blocks } = normalizeContent(content);
  if (blocks.some(block => isTableBlock(block) || blockRuns(block).some(run => run.chk !== undefined))) return REDACCION_VERSION_TABLAS;
  return blocks.some(isSignatureBlock) ? REDACCION_VERSION_FIRMAS : REDACCION_VERSION;
}

/* Documento nuevo, en borrador. Nace con la primera escritura o elección de
   plantilla, nunca sólo por abrir el editor. */
export function newRedaccionRecord({ clienteId, titulo, plantilla = null, contenido, origen = {}, by = {}, now = Date.now() } = {}) {
  if (!ID.test(String(clienteId ?? ""))) throw new RedaccionError("INVALID_CLIENT", "Falta el cliente del documento.");
  const content = normalizeContent(contenido);
  assertWithinLimits(content);
  const who = cleanBy(by);
  return {
    schema: REDACCION_SCHEMA, v: contentVersion(content), clienteId, titulo: cleanTitle(titulo), estado: "borrador",
    plantilla: cleanTemplateId(plantilla), contenido: content, origen: cleanOrigin(origen),
    rev: 1, version: 0, createdAt: now, createdBy: who, updatedAt: now, updatedBy: who
  };
}

/* Lectura de `clientes/{clienteId}/redacciones/{id}`. Un esquema, versión o
   estado desconocidos no se reinterpretan: se rechazan. */
export function readRedaccion(id, data = {}) {
  if (data?.schema !== REDACCION_SCHEMA || !REDACCION_VERSIONS.includes(data?.v) || !REDACCION_ESTADOS.includes(data?.estado)) {
    throw new RedaccionError("INCOMPATIBLE_REDACCION", "Este documento se guardó con una versión del editor que no se reconoce.", { id, schema: data?.schema, v: data?.v, estado: data?.estado });
  }
  return {
    id: String(id), clienteId: oneLine(data.clienteId), titulo: cleanTitle(data.titulo), estado: data.estado,
    plantilla: cleanTemplateId(data.plantilla), contenido: normalizeContent(data.contenido), origen: cleanOrigin(data.origen),
    rev: nonNegativeInt(data.rev), version: nonNegativeInt(data.version),
    createdAt: ms(data.createdAt), createdBy: cleanBy(data.createdBy), updatedAt: ms(data.updatedAt), updatedBy: cleanBy(data.updatedBy),
    finalizadoAt: ms(data.finalizadoAt), finalizadoBy: data.finalizadoBy ? cleanBy(data.finalizadoBy) : null
  };
}

/* Guardar un borrador: sólo lo que cambió, y `rev` sube en cada escritura. */
export function savePatch(redaccion, { titulo, contenido, by = {}, now = Date.now() } = {}) {
  if (redaccion?.estado !== "borrador") throw new RedaccionError("FINAL_READONLY", "Un documento finalizado no se edita: ábrelo de nuevo para crear otra versión.");
  const patch = { rev: nonNegativeInt(redaccion.rev) + 1, updatedAt: now, updatedBy: cleanBy(by) };
  if (titulo !== undefined) patch.titulo = cleanTitle(titulo);
  if (contenido !== undefined) {
    const content = normalizeContent(contenido);
    assertWithinLimits(content);
    patch.contenido = content;
    patch.v = contentVersion(content);
  }
  return patch;
}

/* Finalizar: el documento queda congelado y su contenido se copia a
   `versiones/{version}`. Los datos que aún faltan no lo impiden (la interfaz
   los muestra antes de confirmar); un documento vacío, sí. */
export function finalizeRedaccion(redaccion, { titulo, contenido, by = {}, now = Date.now() } = {}) {
  if (redaccion?.estado !== "borrador") throw new RedaccionError("INVALID_STATE", "El documento ya está finalizado.");
  const content = normalizeContent(contenido ?? redaccion.contenido);
  if (isBlankContent(content)) throw new RedaccionError("EMPTY_CONTENT", "No hay nada que finalizar: el documento está vacío.");
  assertWithinLimits(content);
  const who = cleanBy(by), version = nonNegativeInt(redaccion.version) + 1, title = cleanTitle(titulo ?? redaccion.titulo);
  return {
    patch: { titulo: title, estado: "final", contenido: content, v: contentVersion(content), version, rev: nonNegativeInt(redaccion.rev) + 1, finalizadoAt: now, finalizadoBy: who, updatedAt: now, updatedBy: who },
    snapshot: { version, titulo: title, contenido: content, at: now, by: who },
    missing: missingOf(content)
  };
}

/* Editar de nuevo un documento finalizado: vuelve a borrador; la versión
   congelada se conserva y la siguiente finalización crea otra. */
export function reopenPatch(redaccion, { by = {}, now = Date.now() } = {}) {
  if (redaccion?.estado !== "final") throw new RedaccionError("INVALID_STATE", "Sólo un documento finalizado se abre de nuevo.");
  return { estado: "borrador", rev: nonNegativeInt(redaccion.rev) + 1, updatedAt: now, updatedBy: cleanBy(by) };
}
