/* Editor documental de clientes.html: operaciones sobre el contenido.
 *
 * Cada comando visible del editor (formato, párrafo, listas, sangría,
 * insertar un dato, pegar, completar un dato pendiente) es una función pura:
 * recibe el contenido `safeautentic.redaccion` y una selección, y devuelve el
 * contenido nuevo —siempre normalizado por doc-editor.mjs— y la selección que
 * debe quedar. Así el HTML del editor siempre sale de `toHtml` y nunca queda
 * un formato a medias.
 *
 * Posición: `{ b, o }` = bloque y carácter dentro del texto del bloque (un
 * salto de línea cuenta uno; un dato pendiente cuenta su texto y nunca se
 * parte). Selección: `{ start, end }`.
 *
 * Módulo puro: sin DOM, red ni Firebase. */

import { normalizeContent, isAtomicBlock, isTableBlock, isSignatureBlock, FONT_SIZES, FONTS, ALIGNMENTS, LINE_HEIGHTS, MAX_INDENT } from "./doc-editor.mjs?v=20261101.1"; // mismo ?v= que clientes.html: una sola instancia del modelo

export const INLINE_TOGGLES = Object.freeze(["b", "i", "u"]);
const HEADINGS = new Set(["p", "h1", "h2", "h3"]);

const textOf = block => block.runs.map(run => run.text).join("");
const clone = content => normalizeContent(JSON.parse(JSON.stringify(content)));

/* Posición dentro del contenido y selección ordenada. */
export function clampPos(content, pos) {
  const blocks = content.blocks;
  const b = Math.min(Math.max(0, Math.trunc(Number(pos?.b)) || 0), blocks.length - 1);
  const o = Math.min(Math.max(0, Math.trunc(Number(pos?.o)) || 0), textOf(blocks[b]).length);
  return { b, o };
}
const before = (x, y) => x.b < y.b || (x.b === y.b && x.o < y.o);
export function orderSel(content, sel) {
  const a = clampPos(content, sel?.start), z = clampPos(content, sel?.end ?? sel?.start);
  return before(z, a) ? { start: z, end: a } : { start: a, end: z };
}
export const isCollapsed = sel => sel.start.b === sel.end.b && sel.start.o === sel.end.o;

/* Un dato pendiente (o una casilla) no se parte: un corte dentro de él se mueve a su borde
   más cercano. */
function snapOffset(block, offset) {
  let at = 0;
  for (const run of block.runs) {
    const end = at + run.text.length;
    if ((run.missing || run.chk !== undefined) && offset > at && offset < end) return offset - at < end - offset ? at : end;
    at = end;
  }
  return offset;
}

/* Parte los fragmentos de un bloque en `offset`: izquierda y derecha. */
function splitRuns(runs, offset) {
  const left = [], right = [];
  let at = 0;
  for (const run of runs) {
    const end = at + run.text.length;
    if (end <= offset) left.push({ ...run });
    else if (at >= offset) right.push({ ...run });
    else {
      left.push({ ...run, text: run.text.slice(0, offset - at) });
      right.push({ ...run, text: run.text.slice(offset - at) });
    }
    at = end;
  }
  return [left, right];
}

/* Fragmentos de un bloque dentro de [from, to): los aísla y los devuelve junto
   con los de antes y después. */
function isolate(block, from, to) {
  const [head, rest] = splitRuns(block.runs, snapOffset(block, from));
  const [mid, tail] = splitRuns(rest, snapOffset(block, to) - snapOffset(block, from));
  return { head, mid, tail };
}

function eachSelectedRange(content, sel, fn) {
  const { start, end } = sel;
  for (let b = start.b; b <= end.b; b++) {
    const block = content.blocks[b];
    const from = b === start.b ? start.o : 0;
    const to = b === end.b ? end.o : textOf(block).length;
    fn(block, b, from, to);
  }
}

/* ── Formato de texto ───────────────────────────────────────────────────── */

/* ¿El formato está aplicado a todo el texto seleccionado? Con la selección
   vacía, el del carácter anterior (lo que seguiría escribiendo). */
export function formatAt(content, selection) {
  const model = normalizeContent(content);
  const sel = orderSel(model, selection);
  const runs = [];
  if (isCollapsed(sel)) {
    const block = model.blocks[sel.start.b];
    let at = 0, found = null;
    for (const run of block.runs) {
      const end = at + run.text.length;
      if (sel.start.o > at && sel.start.o <= end) { found = run; break; }
      at = end;
    }
    runs.push(found || block.runs[0]);
  } else {
    eachSelectedRange(model, sel, (block, _b, from, to) => {
      if (from === to) return;
      runs.push(...isolate(block, from, to).mid.filter(run => run.text));
    });
  }
  if (!runs.length) runs.push({ text: "" });
  const common = key => (runs.every(run => run[key] === runs[0][key]) ? runs[0][key] ?? null : undefined);
  return {
    b: runs.every(run => run.b === true), i: runs.every(run => run.i === true), u: runs.every(run => run.u === true),
    /* `null` = el de la página; `undefined` = mezcla. */
    size: common("size"), font: common("font")
  };
}

/* Aplica (o quita) un formato al texto seleccionado. `key`: b, i, u (valor
   booleano), size (pt de FONT_SIZES o null) o font (clave de FONTS o null). */
export function setInlineFormat(content, selection, key, value) {
  const model = clone(content);
  const sel = orderSel(model, selection);
  if (isCollapsed(sel)) return { content: model, selection: sel };
  const valid = INLINE_TOGGLES.includes(key) || (key === "size" && (value === null || FONT_SIZES.includes(value))) || (key === "font" && (value === null || Object.hasOwn(FONTS, value)));
  if (!valid) throw new TypeError(`Formato no válido: ${key}`);
  eachSelectedRange(model, sel, (block, _b, from, to) => {
    if (from === to) return;
    const { head, mid, tail } = isolate(block, from, to);
    const changed = mid.map(run => {
      const next = { ...run };
      if (value === null || value === false) delete next[key]; else next[key] = value;
      return next;
    });
    block.runs = [...head, ...changed, ...tail];
  });
  return { content: normalizeContent(model), selection: sel };
}

/* Negrita/cursiva/subrayado como en un procesador: si todo lo seleccionado
   ya lo tiene, se quita; si no, se aplica a todo. */
export function toggleInline(content, selection, key) {
  if (!INLINE_TOGGLES.includes(key)) throw new TypeError(`Formato no válido: ${key}`);
  const active = formatAt(content, selection)[key];
  return setInlineFormat(content, selection, key, !active);
}

/* ── Párrafo ───────────────────────────────────────────────────────────── */

/* El formato de párrafo (estilo, lista, alineación, sangría) no toca un
   bloque de firmas: tiene su propio acomodo. */
function mapBlocks(content, selection, fn) {
  const model = clone(content);
  const sel = orderSel(model, selection);
  for (let b = sel.start.b; b <= sel.end.b; b++) if (!isAtomicBlock(model.blocks[b])) fn(model.blocks[b], b);
  return { content: normalizeContent(model), selection: sel };
}

/* Estado del párrafo donde empieza la selección (para la barra). */
export function blockAt(content, selection) {
  const model = normalizeContent(content);
  const sel = orderSel(model, selection);
  const blocks = model.blocks.slice(sel.start.b, sel.end.b + 1);
  const common = key => (blocks.every(block => block[key] === blocks[0][key]) ? blocks[0][key] : undefined);
  return { t: common("t"), list: blocks.every(block => block.t === "li") ? common("list") : undefined, align: common("align"), indent: blocks[0].indent, lh: common("lh") };
}

export function setAlign(content, selection, align) {
  if (!ALIGNMENTS.includes(align)) throw new TypeError(`Alineación no válida: ${align}`);
  return mapBlocks(content, selection, block => { block.align = align; });
}

export function setLineHeight(content, selection, lh) {
  if (!LINE_HEIGHTS.includes(lh)) throw new TypeError(`Interlineado no válido: ${lh}`);
  return mapBlocks(content, selection, block => { block.lh = lh; });
}

export function shiftIndent(content, selection, delta) {
  return mapBlocks(content, selection, block => { block.indent = Math.min(MAX_INDENT, Math.max(0, block.indent + Math.sign(delta))); });
}

/* Texto normal o título 1–3. Un elemento de lista que se vuelve título deja
   de ser lista. */
export function setBlockType(content, selection, t) {
  if (!HEADINGS.has(t)) throw new TypeError(`Estilo no válido: ${t}`);
  return mapBlocks(content, selection, block => { block.t = t; delete block.list; });
}

/* Viñetas o numeración: si todo lo seleccionado ya es esa lista, vuelve a ser
   párrafo; si no, todo se vuelve esa lista. */
export function toggleList(content, selection, kind) {
  if (kind !== "ul" && kind !== "ol") throw new TypeError(`Lista no válida: ${kind}`);
  const state = blockAt(content, selection);
  const off = state.t === "li" && state.list === kind;
  return mapBlocks(content, selection, block => {
    if (off) { block.t = "p"; delete block.list; }
    else { block.t = "li"; block.list = kind; }
  });
}

/* Retroceso con el cursor al inicio de un párrafo, como en Word y Docs: a
   un elemento de lista le quita la viñeta y a un párrafo con sangría se la
   reduce. Si no aplica devuelve null: el navegador une los párrafos. */
export function backspaceAtStart(content, selection) {
  const model = normalizeContent(content);
  const sel = orderSel(model, selection);
  if (!isCollapsed(sel) || sel.start.o !== 0) return null;
  const block = model.blocks[sel.start.b];
  if (isAtomicBlock(block)) return { content: model, selection: sel };
  /* Después de unas firmas, como después de una tabla en Word: el retroceso
     no las borra ni les pega el párrafo. Se quitan desde su panel. */
  if (sel.start.b > 0 && isAtomicBlock(model.blocks[sel.start.b - 1]) && !isAtomicBlock(block)) {
    if (block.t === "li" || block.indent > 0) return block.t === "li" ? toggleList(model, sel, block.list) : shiftIndent(model, sel, -1);
    return { content: model, selection: sel };
  }
  if (block.t === "li") return toggleList(model, sel, block.list);
  if (block.indent > 0) return shiftIndent(model, sel, -1);
  return null;
}

/* Pasos de deshacer como en un procesador: lo escrito, lo borrado y cada
   salto o unión de párrafos (`joins`) son pasos distintos. */
export function undoStep(inputType, { joins = false } = {}) {
  const type = String(inputType || "");
  if (type === "insertParagraph" || type === "insertLineBreak" || joins) return "break";
  if (type.startsWith("delete")) return "delete";
  if (type.startsWith("insert")) return "insert";
  return null;
}

/* ── Texto ─────────────────────────────────────────────────────────────── */

/* Borra lo seleccionado; el primer párrafo conserva su estilo. */
export function deleteRange(content, selection) {
  const model = clone(content);
  const sel = orderSel(model, selection);
  if (isCollapsed(sel)) return { content: model, selection: sel };
  let first = model.blocks[sel.start.b];
  const last = model.blocks[sel.end.b];
  /* Si lo borrado empieza en unas firmas, se van completas y el texto que
     sigue conserva el estilo de su propio párrafo. */
  if (isAtomicBlock(first)) {
    first = model.blocks[sel.start.b] = isAtomicBlock(last) ? { t: "p", runs: [] } : { ...last };
    sel.start = { b: sel.start.b, o: 0 };
  }
  const [head] = splitRuns(first.runs, snapOffset(first, sel.start.o));
  const [, tail] = isAtomicBlock(last) ? [[], []] : splitRuns(last.runs, snapOffset(last, sel.end.o));
  first.runs = [...head, ...tail];
  model.blocks.splice(sel.start.b + 1, sel.end.b - sel.start.b);
  const caret = { b: sel.start.b, o: head.reduce((n, run) => n + run.text.length, 0) };
  return { content: normalizeContent(model), selection: { start: caret, end: caret } };
}

/* Inserta fragmentos en la posición (reemplazando lo seleccionado). El cursor
   queda al final de lo insertado. */
export function insertRuns(content, selection, runs) {
  const cleared = deleteRange(content, selection);
  const model = cleared.content, pos = cleared.selection.start;
  /* En unas firmas no se escribe: el texto entra en un párrafo nuevo después. */
  if (isAtomicBlock(model.blocks[pos.b])) {
    model.blocks.splice(pos.b + 1, 0, { t: "p", runs: [] });
    pos.b += 1; pos.o = 0;
  }
  const block = model.blocks[pos.b];
  const at = snapOffset(block, pos.o);
  const [head, tail] = splitRuns(block.runs, at);
  const added = runs.filter(run => run && typeof run.text === "string");
  block.runs = [...head, ...added.map(run => ({ ...run })), ...tail];
  const caret = { b: pos.b, o: at + added.reduce((n, run) => n + run.text.length, 0) };
  return { content: normalizeContent(model), selection: { start: caret, end: caret } };
}

/* Pega bloques completos (del portapapeles, ya normalizados por fromNodes).
   El primero se une al párrafo donde está el cursor; el resto entra como
   párrafos propios y lo que seguía al cursor queda al final del último. */
export function insertBlocks(content, selection, blocks) {
  const pasted = normalizeContent({ page: content?.page, blocks }).blocks;
  if (pasted.length === 1 && !isAtomicBlock(pasted[0])) return insertRuns(content, selection, pasted[0].runs);
  const cleared = deleteRange(content, selection);
  const model = cleared.content, pos = cleared.selection.start;
  /* Con firmas de por medio (pegadas o donde está el cursor), los bloques
     entran completos después del párrafo actual: nada se funde con ellas. */
  if (pasted.some(isAtomicBlock) || isAtomicBlock(model.blocks[pos.b])) {
    const at = pos.b + 1;
    model.blocks.splice(at, 0, ...pasted);
    const caret = { b: at + pasted.length - 1, o: isAtomicBlock(pasted[pasted.length - 1]) ? 0 : textOf(pasted[pasted.length - 1]).length };
    return { content: normalizeContent(model), selection: { start: caret, end: caret } };
  }
  const current = model.blocks[pos.b];
  const [head, tail] = splitRuns(current.runs, snapOffset(current, pos.o));
  current.runs = [...head, ...pasted[0].runs];
  const middle = pasted.slice(1, -1);
  const last = { ...pasted[pasted.length - 1] };
  const lastLength = textOf(last).length;
  last.runs = [...last.runs, ...tail];
  model.blocks.splice(pos.b + 1, 0, ...middle, last);
  const caret = { b: pos.b + pasted.length - 1, o: lastLength };
  return { content: normalizeContent(model), selection: { start: caret, end: caret } };
}

/* Escribe el valor de un dato pendiente en todas sus apariciones, con el
   formato que tenía cada una. Un valor vacío no cambia nada. */
export function fillMissing(content, path, value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  const model = clone(content);
  let count = 0;
  const fill = runs => runs.map(run => {
    if (run.missing !== path) return run;
    count++;
    const { missing: _missing, ...rest } = run;
    return { ...rest, text };
  });
  if (text) for (const block of model.blocks) {
    if (isTableBlock(block)) block.rows.forEach(row => row.cells.forEach(cell => { cell.runs = fill(cell.runs); }));
    else if (isSignatureBlock(block)) block.signers.forEach(signer => signer.lines.forEach(line => { line.runs = fill(line.runs); }));
    else block.runs = fill(block.runs);
  }
  return { content: normalizeContent(model), count };
}
