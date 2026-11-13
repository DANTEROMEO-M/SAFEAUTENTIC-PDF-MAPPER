/* Editor documental de clientes.html: la hoja y su barra de herramientas.
 *
 * Presentación e interacción, nada más: no conoce Firebase ni el expediente.
 * Quien lo monta le da el contenido y los datos que se pueden insertar, y
 * recibe `onChange` cada vez que el documento cambia; guardar es asunto suyo.
 *
 * Escribir, borrar y Enter son nativos del navegador. Cada comando (formato,
 * párrafo, listas, pegar, insertar un dato, deshacer) pasa por el modelo:
 * DOM → fromNodes → operación pura → toHtml → DOM, con la selección
 * conservada. Así el HTML de la hoja siempre es el que produce el modelo.
 * Deshacer/rehacer es propio (instantáneas del modelo), porque el historial
 * del navegador no sabe de esos comandos.
 *
 * `destroy()` retira todos los listeners (un AbortController), el
 * ResizeObserver y los temporizadores. */

import { toHtml, fromNodes, normalizeContent, normalizePage, pageClasses, variableRun, missingOf, bracketsOf, applyTemplate, isSignatureBlock, isAtomicBlock, isTableBlock, MAX_TABLE_ROWS, MAX_TABLE_COLS, signerFrom, signatureBlock, CLIENT_SIGNER, CONSULTANT_SIGNER, MAX_SIGNERS, PAGE_SIZES, MARGINS, FONTS, FONT_SIZES, LINE_HEIGHTS } from "./doc-editor.mjs?v=20261101.1";
import { formatAt, toggleInline, setInlineFormat, setAlign, setLineHeight, shiftIndent, setBlockType, toggleList, insertRuns, insertBlocks, fillMissing, clampPos, isCollapsed, backspaceAtStart, undoStep } from "./doc-editor-ops.mjs?v=20261101.1";

const IS_MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || "");
const MOD = IS_MAC ? "⌘" : "Ctrl";
const FONT_FAMILY_LABEL = { sans: "Arial", serif: "Times New Roman", mono: "Courier New" };
const STYLE_OPTIONS = [["p", "Texto normal"], ["h1", "Título 1"], ["h2", "Título 2"], ["h3", "Título 3"]];
const MARGIN_LABEL = { normal: "Normales", estrecho: "Estrechos", amplio: "Amplios" };
const HISTORY_LIMIT = 200;
const TYPING_PAUSE = 600;

/* Iconos de 16 px con trazo, como los del resto de clientes.html. */
const svg = path => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const ICONS = {
  undo: svg('<path d="M5.5 4 2.5 7l3 3"/><path d="M2.5 7h7a4 4 0 0 1 0 8h-2"/>'),
  redo: svg('<path d="M10.5 4l3 3-3 3"/><path d="M13.5 7h-7a4 4 0 0 0 0 8h2"/>'),
  left: svg('<path d="M2.5 3.5h11M2.5 6.5h7M2.5 9.5h11M2.5 12.5h7"/>'),
  center: svg('<path d="M2.5 3.5h11M4.5 6.5h7M2.5 9.5h11M4.5 12.5h7"/>'),
  right: svg('<path d="M2.5 3.5h11M6.5 6.5h7M2.5 9.5h11M6.5 12.5h7"/>'),
  justify: svg('<path d="M2.5 3.5h11M2.5 6.5h11M2.5 9.5h11M2.5 12.5h11"/>'),
  ul: svg('<circle cx="3" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r=".9" fill="currentColor" stroke="none"/><path d="M6 4h7.5M6 8h7.5M6 12h7.5"/>'),
  ol: svg('<path d="M2.2 2.8h1v2.6M2 5.4h1.6M2 9.2c.2-.6 1.6-.6 1.6.2 0 .6-1.6 1.2-1.6 1.8h1.7"/><path d="M6.5 4h7M6.5 8h7M6.5 12h7"/>'),
  outdent: svg('<path d="M7 3.5h6.5M7 6.5h6.5M7 9.5h6.5M2.5 12.5h11"/><path d="M4.5 5 2.5 7l2 2"/>'),
  indent: svg('<path d="M7 3.5h6.5M7 6.5h6.5M7 9.5h6.5M2.5 12.5h11"/><path d="M2.5 5l2 2-2 2"/>'),
  data: svg('<path d="M8 3v10M3 8h10"/>'),
  page: svg('<path d="M4 1.8h5.2L12 4.6v9.6H4z"/><path d="M9 1.8v3h3"/>'),
  sig: svg('<path d="M2 11.5c1.6-2.6 3-4.2 3.9-4.2.8 0 .4 2.4 1.3 2.4.8 0 1.4-1.8 2.3-1.8.8 0 .9 1.3 2.2 1.3"/><path d="M2 14h12"/>'),
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  trash: svg('<path d="M2.8 4.2h10.4M6.2 4.2V2.8h3.6v1.4M4.2 4.2l.6 9h6.4l.6-9"/>'),
  plus: svg('<path d="M8 3.5v9M3.5 8h9"/>'),
  caret: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4 5 6.5 7.5 4"/></svg>'
};

/* ── Barra de herramientas (marcado estático: ningún dato del usuario) ── */

function toolbarHtml() {
  const btn = (cmd, label, icon, keys = "", extra = "") =>
    `<button type="button" class="ew-tool" data-ew-cmd="${cmd}" aria-label="${label}" title="${label}${keys ? ` (${keys})` : ""}" ${extra}>${icon}</button>`;
  const toggle = (cmd, label, text, keys) =>
    `<button type="button" class="ew-tool ew-tool-text" data-ew-cmd="${cmd}" aria-pressed="false" aria-label="${label}" title="${label} (${keys})">${text}</button>`;
  const select = (id, label, options) =>
    `<label class="ew-select" data-ew-field="${id}" title="${label}"><span class="sr-only">${label}</span><select data-ew-select="${id}" aria-label="${label}">${options}</select>${ICONS.caret}</label>`;
  const opts = pairs => pairs.map(([value, text]) => `<option value="${value}">${text}</option>`).join("");
  return `
  <div class="ew-group" role="group" aria-label="Historial">
    ${btn("undo", "Deshacer", ICONS.undo, `${MOD}+Z`, "disabled")}${btn("redo", "Rehacer", ICONS.redo, IS_MAC ? "⌘+⇧+Z" : "Ctrl+Y", "disabled")}
  </div>
  <div class="ew-group" role="group" aria-label="Estilo del párrafo">
    ${select("block", "Estilo del párrafo", opts(STYLE_OPTIONS))}
  </div>
  <div class="ew-group" role="group" aria-label="Texto">
    ${select("font", "Fuente", opts(Object.keys(FONTS).map(key => [key, FONT_FAMILY_LABEL[key]])))}
    ${select("size", "Tamaño de letra", opts(FONT_SIZES.map(size => [size, size])))}
    ${toggle("b", "Negrita", "<b>B</b>", `${MOD}+B`)}${toggle("i", "Cursiva", "<i>I</i>", `${MOD}+I`)}${toggle("u", "Subrayado", "<u>U</u>", `${MOD}+U`)}
  </div>
  <div class="ew-group" role="group" aria-label="Párrafo">
    ${["left", "center", "right", "justify"].map(a => btn(`align:${a}`, { left: "Alinear a la izquierda", center: "Centrar", right: "Alinear a la derecha", justify: "Justificar" }[a], ICONS[a], "", `aria-pressed="false"`)).join("")}
    <span class="ew-sep" aria-hidden="true"></span>
    ${btn("list:ul", "Viñetas", ICONS.ul, `${MOD}+⇧+8`, `aria-pressed="false"`)}${btn("list:ol", "Numeración", ICONS.ol, `${MOD}+⇧+7`, `aria-pressed="false"`)}
    <span class="ew-sep" aria-hidden="true"></span>
    ${btn("outdent", "Reducir sangría", ICONS.outdent, `${MOD}+[`)}${btn("indent", "Aumentar sangría", ICONS.indent, `${MOD}+]`)}
    ${select("lh", "Interlineado", opts(LINE_HEIGHTS.map(lh => [lh, lh === 1 ? "1.0" : lh === 1.15 ? "1.15" : lh === 1.5 ? "1.5" : "2.0"])))}
  </div>
  <div class="ew-group" role="group" aria-label="Insertar">
    <button type="button" class="ew-tool ew-tool-wide" data-ew-menu="data" aria-haspopup="menu" aria-expanded="false" aria-label="Insertar dato" title="Insertar un dato del cliente o del consultor">${ICONS.data}<span>Insertar dato</span>${ICONS.caret}</button>
    <button type="button" class="ew-tool ew-tool-wide" data-ew-cmd="sig" aria-haspopup="dialog" aria-expanded="false" aria-label="Firmas" title="Agregar o editar las firmas del documento">${ICONS.sig}<span>Firmas</span></button>  </div>
  <span class="ew-grow"></span>
  <div class="ew-group ew-group-end" role="group" aria-label="Página">
    <button type="button" class="ew-tool ew-tool-wide" data-ew-menu="page" aria-haspopup="menu" aria-expanded="false">${ICONS.page}<span data-ew-page-label></span>${ICONS.caret}</button>
  </div>`;
}

/* ── Posiciones: DOM ↔ { b, o } ─────────────────────────────────────── */

const isBlockList = el => el.tagName === "UL" || el.tagName === "OL";
function blockEls(root) {
  const out = [];
  for (const child of root.children) {
    if (isBlockList(child)) { for (const li of child.children) if (li.tagName === "LI") out.push(li); }
    else out.push(child);
  }
  return out;
}
const isChip = node => node?.nodeType === 1 && (node.classList.contains("rd-var") || node.classList.contains("rd-chk"));
/* Caracteres de un fragmento como los cuenta el modelo: texto + saltos. */
const charsOf = fragment => fragment.textContent.length + fragment.querySelectorAll("br").length;

function posFromPoint(root, blocks, node, offset) {
  if (node === root || (node.nodeType === 1 && isBlockList(node))) {
    const child = node.childNodes[offset] || null;
    const target = child ? (isBlockList(child) ? child.querySelector("li") : child) : null;
    const i = target ? blocks.indexOf(target) : -1;
    if (i >= 0) return { b: i, o: 0 };
    return { b: Math.max(0, blocks.length - 1), o: Infinity };
  }
  const el = node.nodeType === 1 ? node : node.parentElement;
  const block = blocks.find(candidate => candidate === el || candidate.contains(el));
  if (!block) return null;
  const range = document.createRange();
  range.setStart(block, 0);
  range.setEnd(node, offset);
  return { b: blocks.indexOf(block), o: charsOf(range.cloneContents()) };
}

/* Punto del DOM para un carácter del bloque. Un dato pendiente es atómico:
   el cursor nunca queda dentro. */
function pointIn(block, o) {
  if (block.hasAttribute?.("data-rd-sig") || block.hasAttribute?.("data-rd-tbl")) return { node: block.parentNode, offset: Array.prototype.indexOf.call(block.parentNode.childNodes, block) };
  let remaining = o;
  const visit = parent => {
    for (let i = 0; i < parent.childNodes.length; i++) {
      const child = parent.childNodes[i];
      if (child.nodeType === 3) {
        if (remaining <= child.length) return { node: child, offset: remaining };
        remaining -= child.length;
      } else if (child.nodeName === "BR") {
        if (remaining === 0) return { node: parent, offset: i };
        remaining -= 1;
      } else if (isChip(child)) {
        const length = child.textContent.length;
        if (remaining === 0) return { node: parent, offset: i };
        if (remaining <= length) return { node: parent, offset: i + 1 };
        remaining -= length;
      } else if (child.nodeType === 1) {
        const found = visit(child);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(block) || { node: block, offset: block.childNodes.length };
}

/* ── Editor ─────────────────────────────────────────────────────────── */

export function mountDocEditor(host, { content, variables = [], readOnly = false, onChange = () => {} } = {}) {
  const abort = new AbortController();
  const on = (target, type, fn, opts = {}) => target.addEventListener(type, fn, { ...opts, signal: abort.signal });
  let model = normalizeContent(content);
  let history = [], index = -1, typingTimer = 0, rafId = 0, pending = null, lastSel = null, destroyed = false, readonly = !!readOnly, lastKind = null;

  host.classList.add("ew");
  host.innerHTML = `<div class="ew-toolbar" role="toolbar" aria-label="Formato del documento">${toolbarHtml()}</div>
    <div class="ew-canvas"><div class="ew-zoom"><div class="ew-sheet" role="textbox" aria-multiline="true" aria-label="Documento" spellcheck="true"></div><div class="ew-guides" aria-hidden="true"></div></div></div>
    <div class="ew-menu" data-ew-popup="data" role="menu" hidden></div>
    <div class="ew-menu" data-ew-popup="page" role="menu" hidden></div>
    <div class="ew-menu ew-sig-panel" data-ew-popup="sig" role="dialog" aria-label="Firmas del documento" hidden></div>
    <div class="ew-menu ew-sig-panel ew-tbl-panel" data-ew-popup="tbl" role="dialog" aria-label="Tabla del documento" hidden></div>`;
  const toolbar = host.querySelector(".ew-toolbar"), canvas = host.querySelector(".ew-canvas"), zoomBox = host.querySelector(".ew-zoom");
  const sheet = host.querySelector(".ew-sheet"), guides = host.querySelector(".ew-guides");

  /* ── Render y selección ── */
  function render(next, selection = null) {
    model = normalizeContent(next);
    sheet.className = `ew-sheet ${pageClasses(model.page)}`;
    sheet.innerHTML = toHtml(model, { editable: true });
    const pageButton = host.querySelector('[data-ew-menu="page"]');
    pageButton.querySelector("[data-ew-page-label]").textContent = PAGE_SIZES[model.page.size].label;
    pageButton.title = `Hoja ${PAGE_SIZES[model.page.size].label.toLowerCase()} · márgenes ${MARGIN_LABEL[model.page.margin].toLowerCase()}`;
    pageButton.setAttribute("aria-label", `Tamaño y márgenes: ${pageButton.title}`);
    fitZoom();
    scheduleGuides();
    if (selection) writeSelection(selection);
  }
  /* Páginas: como en Word, cada página es una hoja aparte. Un bloque que no
     cabe en el alto útil (hoja menos márgenes) pasa completo a la siguiente,
     igual que en la impresión (los bloques no se parten; ver .ew-print). El
     empuje es un margin-top de presentación: fromNodes no lo lee, así que no
     llega al modelo. En el teléfono el texto fluye y no hay hojas. */
  const PAGE_GAP = 24;
  let guidesFrame = 0;
  function scheduleGuides() {
    if (!guidesFrame) guidesFrame = requestAnimationFrame(() => { guidesFrame = 0; if (!destroyed) paintGuides(); });
  }
  function paintGuides() {
    guides.replaceChildren();
    const blocks = blockEls(sheet);
    for (const el of blocks) el.style.removeProperty("margin-top");
    if (window.matchMedia("(max-width: 760px)").matches) { sheet.style.minHeight = ""; return; }
    const px = 96 / 72, size = PAGE_SIZES[model.page.size];
    const height = size.height * px, margin = MARGINS[model.page.margin] * px, step = height + PAGE_GAP;
    let page = 0;
    blocks.forEach((block, i) => {
      if (block.offsetTop + block.offsetHeight <= page * step + height - margin + 0.5) return;
      /* No cabe: pasa a la hoja siguiente (salvo que ya encabece una hoja
         y aun así no quepa; entonces se parte, como en la impresión). Las
         firmas se llevan su renglón previo («Atentamente,»): nunca quedan
         solas en una hoja. */
      const prev = blocks[i - 1];
      const el = block.hasAttribute("data-rd-sig") && prev?.textContent.trim() && prev.offsetTop > page * step + margin + 0.5 ? prev : block;
      if (el.offsetTop <= page * step + margin + 0.5) return;
      page++;
      const shift = page * step + margin - el.offsetTop;
      el.style.marginTop = `${parseFloat(getComputedStyle(el).marginTop) + shift}px`;
    });
    const last = blocks[blocks.length - 1];
    const bottom = last ? last.offsetTop + last.offsetHeight : 0;
    const pages = Math.max(page + 1, Math.ceil((bottom + margin) / step));
    const minHeight = `${pages * height + (pages - 1) * PAGE_GAP}px`;
    if (sheet.style.minHeight !== minHeight) sheet.style.minHeight = minHeight;
    guides.style.cssText = `left:${sheet.offsetLeft}px;top:${sheet.offsetTop}px;width:${sheet.offsetWidth}px`;
    for (let n = 1; n < pages; n++) {
      const gap = document.createElement("div");
      gap.className = "ew-page-gap";
      gap.style.top = `${n * step - PAGE_GAP}px`;
      gap.dataset.page = `Página ${n + 1} de ${pages}`;
      guides.append(gap);
    }
  }
  function readModel() {
    model = fromNodes(sheet, { page: model.page });
    return model;
  }
  function readSelection() {
    const s = document.getSelection();
    if (!s?.rangeCount) return null;
    const range = s.getRangeAt(0);
    if (!sheet.contains(range.startContainer) || !sheet.contains(range.endContainer)) return null;
    const blocks = blockEls(sheet);
    if (!blocks.length) return null;
    const start = posFromPoint(sheet, blocks, range.startContainer, range.startOffset);
    const end = posFromPoint(sheet, blocks, range.endContainer, range.endOffset);
    return start && end ? { start, end } : null;
  }
  function writeSelection(selection) {
    const blocks = blockEls(sheet);
    if (!blocks.length) return;
    const place = pos => {
      const p = clampPos(model, pos);
      return pointIn(blocks[Math.min(p.b, blocks.length - 1)], p.o);
    };
    const a = place(selection.start), z = place(selection.end);
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(z.node, z.offset);
    const s = document.getSelection();
    s.removeAllRanges();
    s.addRange(range);
    lastSel = selection;
  }
  /* La selección con la que trabaja un comando: la viva si está en la hoja;
     si el foco se fue a la barra o a un menú, la última que hubo. */
  const currentSel = () => readSelection() || lastSel || { start: { b: 0, o: 0 }, end: { b: 0, o: 0 } };

  /* ── Historial ── */
  function snapshot(selection = readSelection() || lastSel) {
    const json = JSON.stringify(model);
    if (history[index]?.json === json) { history[index].sel = selection; return; }
    history = history.slice(0, index + 1);
    history.push({ json, sel: selection });
    if (history.length > HISTORY_LIMIT) history.shift();
    index = history.length - 1;
    syncHistoryButtons();
  }
  function flushTyping() {
    if (!typingTimer) return;
    clearTimeout(typingTimer); typingTimer = 0;
    readModel(); snapshot();
  }
  function travel(step) {
    flushTyping();
    const target = index + step;
    if (target < 0 || target >= history.length || readonly) return;
    index = target;
    const entry = history[index];
    render(JSON.parse(entry.json), entry.sel);
    syncHistoryButtons();
    onChange({ source: "history" });
    scheduleState();
  }
  function syncHistoryButtons() {
    toolbar.querySelector('[data-ew-cmd="undo"]').disabled = readonly || index <= 0;
    toolbar.querySelector('[data-ew-cmd="redo"]').disabled = readonly || index >= history.length - 1;
  }

  /* Un comando: modelo actual → operación pura → hoja → selección. */
  function apply(op) {
    if (readonly) return;
    flushTyping();
    const selection = currentSel();
    const result = op(readModel(), selection);
    if (!result) return;
    render(result.content, result.selection || selection);
    snapshot(result.selection || selection);
    onChange({ source: "command" });
    scheduleState();
  }

  /* Formato con el cursor sin selección: se aplica a lo siguiente que se
     escriba, como en un procesador de textos. */
  function inline(key, value) {
    const selection = currentSel();
    const current = formatAt(readModel(), selection);
    if (isCollapsed(selection)) {
      const base = pending && pending.b === selection.start.b && pending.o === selection.start.o ? pending.fmt : {};
      const active = key in base ? base[key] : current[key];
      const next = ["b", "i", "u"].includes(key) ? !active : value;
      pending = { b: selection.start.b, o: selection.start.o, fmt: { ...base, [key]: next } };
      sheet.focus({ preventScroll: true });
      writeSelection(selection);
      scheduleState();
      return;
    }
    apply((m, sel) => (["b", "i", "u"].includes(key) ? toggleInline(m, sel, key) : setInlineFormat(m, sel, key, value)));
  }
  function typeWithPending(text) {
    const fmt = { ...pending.fmt };
    pending = null;
    apply((m, sel) => {
      const base = formatAt(m, sel);
      const run = { text };
      for (const key of ["b", "i", "u"]) if (key in fmt ? fmt[key] : base[key]) run[key] = true;
      const size = "size" in fmt ? fmt.size : base.size, font = "font" in fmt ? fmt.font : base.font;
      if (size) run.size = size;
      if (font) run.font = font;
      return insertRuns(m, sel, [run]);
    });
  }

  /* El formato de texto activo, sin estados mixtos. */
  const formatOnly = fmt => Object.fromEntries(["b", "i", "u", "size", "font"].filter(key => fmt[key]).map(key => [key, fmt[key]]));
  const COMMANDS = {
    undo: () => travel(-1), redo: () => travel(+1),
    b: () => inline("b"), i: () => inline("i"), u: () => inline("u"),
    indent: () => apply((m, s) => shiftIndent(m, s, +1)), outdent: () => apply((m, s) => shiftIndent(m, s, -1)),
    sig: () => signaturesCommand(),
    tbl: () => tableCommand(),
    chk: () => apply((m, s) => insertRuns(m, s, [{ ...formatOnly(formatAt(m, s)), text: "", chk: false }]))
  };
  function runCommand(name) {
    if (readonly) return;
    const [cmd, arg] = name.split(":");
    if (cmd === "align") apply((m, s) => setAlign(m, s, arg));
    else if (cmd === "list") apply((m, s) => toggleList(m, s, arg));
    else COMMANDS[cmd]?.();
    if (!["undo", "redo", "sig", "tbl"].includes(cmd)) sheet.focus({ preventScroll: true });
  }
  function runSelect(id, raw) {
    if (readonly) return;
    if (id === "block") apply((m, s) => setBlockType(m, s, raw));
    else if (id === "lh") apply((m, s) => setLineHeight(m, s, Number(raw)));
    else if (id === "size") inline("size", Number(raw) === model.page.fontSize ? null : Number(raw));
    else if (id === "font") inline("font", raw === model.page.font ? null : raw);
    sheet.focus({ preventScroll: true });
    if (lastSel) writeSelection(lastSel);
  }

  /* ── Estado de la barra ── */
  function scheduleState() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; if (!destroyed) syncToolbar(); });
  }
  function syncToolbar() {
    const s = readSelection();
    if (s) {
      if (pending && (pending.b !== s.start.b || pending.o !== s.start.o || !isCollapsed(s))) pending = null;
      lastSel = s;
    }
    /* Sin selección todavía (recién abierto), la referencia es el inicio. */
    const selection = s || lastSel || { start: { b: 0, o: 0 }, end: { b: 0, o: 0 } };
    /* Mientras se escribe, el modelo guardado va unas letras atrás. */
    const m = typingTimer ? readModel() : model;
    const fmt = formatAt(m, selection);
    const over = pending?.fmt || {};
    const on = key => (key in over ? !!over[key] : !!fmt[key]);
    for (const key of ["b", "i", "u"]) toolbar.querySelector(`[data-ew-cmd="${key}"]`).setAttribute("aria-pressed", String(on(key)));
    const blockIndex = clampPos(m, selection.start).b;
    const block = m.blocks[blockIndex];
    /* En las firmas no hay estilo ni alineación de párrafo que mostrar. */
    const sig = isAtomicBlock(block);
    for (const a of ["left", "center", "right", "justify"]) toolbar.querySelector(`[data-ew-cmd="align:${a}"]`).setAttribute("aria-pressed", String(!sig && block.align === a));
    for (const kind of ["ul", "ol"]) toolbar.querySelector(`[data-ew-cmd="list:${kind}"]`).setAttribute("aria-pressed", String(block.t === "li" && block.list === kind));
    toolbar.querySelector('[data-ew-cmd="outdent"]').disabled = readonly || block.indent === 0;
    toolbar.querySelector('[data-ew-cmd="indent"]').disabled = readonly || block.indent >= 4;
    const setSelect = (id, value, mixedLabel) => {
      const el = toolbar.querySelector(`[data-ew-select="${id}"]`);
      el.querySelector("option[data-mixed]")?.remove();
      if (value === undefined) {
        const option = new Option(mixedLabel, "", true, true);
        option.dataset.mixed = "1"; option.hidden = true;
        el.add(option, 0);
      } else el.value = String(value);
    };
    setSelect("block", sig ? undefined : block.t === "li" ? "p" : block.t, isTableBlock(block) ? "Tabla" : "Firmas");
    setSelect("lh", block.lh, "—");
    const size = "size" in over ? over.size : fmt.size;
    const font = "font" in over ? over.font : fmt.font;
    setSelect("size", size === undefined ? undefined : size ?? m.page.fontSize, "—");
    setSelect("font", font === undefined ? undefined : font ?? m.page.font, "Varias");
  }

  /* ── Zoom: la hoja cabe completa a lo ancho sin cambiar su tamaño real ── */
  function fitZoom() {
    const width = PAGE_SIZES[model.page.size].width * 96 / 72;
    const available = canvas.clientWidth - (canvas.clientWidth < 640 ? 24 : 64);
    zoomBox.style.setProperty("--ew-zoom", String(Math.min(1, Math.max(0.35, available / width))));
  }
  const resize = new ResizeObserver(() => { fitZoom(); scheduleGuides(); });
  resize.observe(canvas);

  /* ── Menús ── */
  let openMenu = null;
  function closeMenu({ focusButton = false } = {}) {
    if (!openMenu) return;
    const { popup, button, onClose } = openMenu;
    onClose?.();
    popup.hidden = true; popup.replaceChildren();
    button.setAttribute("aria-expanded", "false");
    openMenu = null;
    if (focusButton) button.focus();
  }
  function menuItem(label, detail, onPick, { missing = false, checked = null } = {}) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ew-menu-item" + (missing ? " is-missing" : "");
    item.setAttribute("role", checked === null ? "menuitem" : "menuitemradio");
    if (checked !== null) item.setAttribute("aria-checked", String(checked));
    const strong = document.createElement("span"); strong.className = "ew-menu-label"; strong.textContent = label;
    const small = document.createElement("span"); small.className = "ew-menu-detail"; small.textContent = detail;
    item.append(strong, small);
    on(item, "click", () => { closeMenu(); onPick(); });
    return item;
  }
  function menuHeading(text) {
    const h = document.createElement("div");
    h.className = "ew-menu-heading"; h.setAttribute("role", "presentation"); h.textContent = text;
    return h;
  }
  function openPopup(kind, button) {
    if (openMenu?.kind === kind) { closeMenu({ focusButton: true }); return; }
    closeMenu();
    const popup = host.querySelector(`[data-ew-popup="${kind}"]`);
    if (kind === "data") {
      /* Tabla y casilla viven en este menú: la barra no crece. */
      popup.append(menuHeading("Insertar"),
        menuItem("Tabla", "Filas y columnas; se edita desde su panel", () => { sheet.focus({ preventScroll: true }); if (lastSel) writeSelection(lastSel); tableCommand(); }),
        menuItem("Casilla ( )", "Se marca o desmarca con un clic", () => { sheet.focus({ preventScroll: true }); if (lastSel) writeSelection(lastSel); COMMANDS.chk(); }));
      let group = "";
      for (const v of variables) {
        if (v.group !== group) { group = v.group; popup.append(menuHeading(group)); }
        popup.append(menuItem(v.label, v.missing ? "Sin capturar · quedará pendiente" : v.value, () => insertVariable(v.path), { missing: v.missing }));
      }
    } else {
      popup.append(menuHeading("Tamaño de hoja"));
      for (const [key, size] of Object.entries(PAGE_SIZES)) {
        popup.append(menuItem(size.label, `${size.width / 72} × ${size.height / 72} in`, () => setPage({ size: key }), { checked: model.page.size === key }));
      }
      popup.append(menuHeading("Márgenes"));
      for (const [key, pt] of Object.entries(MARGINS)) {
        popup.append(menuItem(MARGIN_LABEL[key], `${Math.round((pt / 72) * 2.54 * 10) / 10} cm`, () => setPage({ margin: key }), { checked: model.page.margin === key }));
      }
    }
    const box = button.getBoundingClientRect(), hostBox = host.getBoundingClientRect();
    popup.hidden = false;
    const left = Math.min(box.left - hostBox.left, hostBox.width - popup.offsetWidth - 8);
    popup.style.left = `${Math.max(8, left)}px`;
    popup.style.top = `${box.bottom - hostBox.top + 6}px`;
    button.setAttribute("aria-expanded", "true");
    openMenu = { kind, popup, button };
    popup.querySelector("button")?.focus();
  }

  /* ── Firmas: bloque atómico, se edita en su panel ── */
  const sigButton = () => toolbar.querySelector('[data-ew-cmd="sig"]');
  /* Los datos que el editor conoce, en la forma que usa applyTemplate. */
  function templateData() {
    const data = {};
    for (const v of variables) {
      const [group, key] = v.path.split(".");
      (data[group] ||= {})[key] = v.missing ? "" : v.value;
    }
    return data;
  }
  const resolvedSigner = lines => applyTemplate({ page: model.page, blocks: [signatureBlock([signerFrom(lines)])] }, templateData()).blocks[0].signers[0];
  /* «Firmas» en la barra: edita las firmas que siguen al cursor (o las
     últimas); si el documento no tiene, agrega las de siempre después del
     párrafo actual y abre su panel. */
  function signaturesCommand() {
    if (readonly) return;
    if (openMenu?.kind === "sig") { closeMenu({ focusButton: true }); return; }
    const m = readModel();
    const at = clampPos(m, currentSel().start).b;
    let index = m.blocks.findIndex((block, i) => i >= at && isSignatureBlock(block));
    if (index < 0) index = m.blocks.map(isSignatureBlock).lastIndexOf(true);
    if (index >= 0) { openSignatures(index); return; }
    const block = { t: "sig", signers: [resolvedSigner(CLIENT_SIGNER), resolvedSigner(CONSULTANT_SIGNER)] };
    apply((current, sel) => {
      const b = clampPos(current, sel.start).b;
      const blocks = [...current.blocks];
      blocks.splice(b + 1, 0, block);
      return { content: { ...current, blocks }, selection: sel };
    });
    openSignatures(at + 1);
  }
  const LINE_FIELDS = [
    { label: "Nombre", placeholder: "Nombre de quien firma" },
    { label: "Cargo", placeholder: "Ej. Representante legal" },
    { label: "Empresa", placeholder: "Razón social o dependencia" },
    { label: "Registro", placeholder: "Ej. ID R.E.P.C.: …", extra: true },
    { label: "Registro", placeholder: "Ej. REG. CGPC EDO. MEX.: …", extra: true }
  ];
  const lineText = line => line.runs.map(run => run.text).join("");
  const draftLine = line => ({ runs: line.runs, text: lineText(line), value: line.runs.some(run => run.missing) ? "" : lineText(line) });
  /* El bloque de firmas como HTML de la hoja (para verlo en vivo o restaurarlo). */
  function signatureEl(block) {
    const box = document.createElement("div");
    box.innerHTML = toHtml(normalizeContent({ page: model.page, blocks: [block] }), { editable: true });
    return box.firstElementChild;
  }
  /* Panel lateral junto a la hoja: se edita por campos y la hoja muestra el
     resultado mientras se escribe. «Aplicar» lo conserva (un paso de
     deshacer); cerrar de cualquier otro modo deja las firmas como estaban. */
  function openSignatures(index) {
    if (readonly) return;
    if (openMenu?.kind === "sig" && openMenu.index === index) { openMenu.popup.querySelector("input")?.focus(); return; }
    const block = readModel().blocks[index];
    if (!isSignatureBlock(block)) return;
    closeMenu();
    const popup = host.querySelector('[data-ew-popup="sig"]');
    /* Borrador: cada renglón con su texto original y lo escrito. Un dato
       pendiente se muestra vacío, con su marcador de ejemplo. */
    const draft = block.signers.map(signer => signer.lines.map(draftLine));
    const extrasOpen = new Set(draft.flatMap((lines, i) => (lines.slice(3).some(line => line.value || line.runs.some(run => run.missing)) ? [i] : [])));
    let applied = false, frame = 0;
    const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
    const button = (label, cls, onClick, icon = "") => {
      const b = el("button", cls); b.type = "button";
      b.innerHTML = icon; if (label) b.append(label);
      on(b, "click", onClick);
      return b;
    };
    const fromPreset = lines => resolvedSigner(lines).lines.map(draftLine);
    /* Lo que no se tocó conserva su formato y sus datos pendientes; lo
       escrito toma el formato del renglón (el nombre en negritas, registros
       en letra pequeña). Un renglón vaciado se quita. */
    const draftBlock = () => ({ t: "sig", signers: draft.map(lines => {
      const out = [];
      lines.forEach((line, j) => {
        const value = line.value.replace(/\s+/g, " ").trim();
        const untouched = value === line.text || (!value && line.runs.some(run => run.missing));
        if (untouched && line.runs.length) { out.push({ runs: line.runs }); return; }
        if (!value) { if (j === 0) out.push({ runs: [{ text: "", b: true }] }); return; }
        const base = line.runs.find(run => !run.missing) || signerFrom(["", "", "", ""]).lines[Math.min(j, 3)].runs[0];
        const { text: _t, missing: _m, ...format } = base;
        out.push({ runs: [{ ...format, text: value }] });
      });
      return { lines: out };
    }) });
    /* La hoja refleja el borrador; el bloque en edición queda resaltado. */
    const current = () => blockEls(sheet)[index];
    function preview(next) {
      const target = current();
      if (!target) return;
      const node = signatureEl(next);
      node.classList.add("is-editing");
      target.replaceWith(node);
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (!applied) preview(draftBlock()); }); };
    function paint(focus = null) {
      popup.replaceChildren();
      const head = el("div", "ew-sig-head");
      const titles = el("div", "ew-sig-titles");
      const title = el("strong", "", "Firmas del documento"); title.id = "ew-sig-title";
      titles.append(title, el("span", "", draft.length === 1 ? "1 firmante · centrado" : `${draft.length} firmantes · lado a lado`));
      const close = button("", "ew-sig-close", () => closeMenu({ focusButton: true }), ICONS.close);
      close.setAttribute("aria-label", "Cerrar sin aplicar");
      head.append(titles, close);
      const body = el("div", "ew-sig-body");
      body.append(el("p", "ew-sig-hint", "La hoja muestra los cambios mientras escribes. La raya y las negritas del nombre se ponen solas."));
      draft.forEach((lines, i) => {
        const card = el("section", "ew-signer");
        card.setAttribute("aria-label", `Firmante ${i + 1}`);
        const top = el("div", "ew-signer-top");
        const badge = el("span", "ew-signer-n", String(i + 1));
        const name = el("span", "ew-signer-name", lines[0]?.value || "Firmante " + (i + 1));
        top.append(badge, name);
        if (draft.length > 1) {
          const remove = button("", "ew-signer-remove", () => {
            draft.splice(i, 1);
            const shifted = [...extrasOpen].filter(k => k !== i).map(k => (k > i ? k - 1 : k));
            extrasOpen.clear(); shifted.forEach(k => extrasOpen.add(k));
            schedule(); paint();
          }, ICONS.trash);
          remove.setAttribute("aria-label", `Quitar firmante ${i + 1}`); remove.title = "Quitar firmante";
          top.append(remove);
        }
        const presets = el("div", "ew-sig-presets");
        presets.append(el("span", "", "Llenar con"),
          button("Responsable del cliente", "ew-chip", () => { draft[i] = fromPreset(CLIENT_SIGNER); schedule(); paint({ signer: i }); }),
          button("Consultor", "ew-chip", () => { draft[i] = fromPreset(CONSULTANT_SIGNER); extrasOpen.add(i); schedule(); paint({ signer: i }); }));
        card.append(top, presets);
        const fields = el("div", "ew-sig-fields");
        LINE_FIELDS.forEach((spec, j) => {
          if (spec.extra && !extrasOpen.has(i)) return;
          const line = lines[j];
          const field = el("label", "ew-sig-field" + (spec.extra ? " is-extra" : ""));
          const input = el("input");
          input.type = "text"; input.maxLength = 160; input.autocomplete = "off";
          input.value = line?.value ?? "";
          input.dataset.signer = String(i); input.dataset.line = String(j);
          const missing = line?.runs.find(run => run.missing);
          input.placeholder = missing ? missing.text : spec.placeholder;
          on(input, "input", () => {
            if (!draft[i][j]) draft[i][j] = { runs: [], text: "", value: "" };
            draft[i][j].value = input.value;
            if (j === 0) name.textContent = input.value.trim() || "Firmante " + (i + 1);
            schedule();
          });
          on(input, "keydown", e => { if (e.key === "Enter") { e.preventDefault(); save(); } });
          const caption = el("span", "", spec.label);
          if (missing) caption.append(el("em", "", "falta en el perfil"));
          field.append(caption, input);
          fields.append(field);
        });
        card.append(fields);
        if (!extrasOpen.has(i)) card.append(button("Agregar registro", "ew-sig-more", () => { extrasOpen.add(i); paint({ signer: i, line: 3 }); }, ICONS.plus));
        body.append(card);
      });
      if (draft.length < MAX_SIGNERS) body.append(button("Agregar firmante", "ew-sig-add", () => { draft.push(fromPreset(["", "", ""])); schedule(); paint({ signer: draft.length - 1 }); }, ICONS.plus));
      const foot = el("div", "ew-sig-foot");
      foot.append(
        button("Quitar firmas", "ews-btn quiet is-danger", () => { applied = true; closeMenu({ focusButton: true }); apply(m => { const blocks = [...m.blocks]; blocks.splice(index, 1); return { content: { ...m, blocks } }; }); }),
        el("span", "ew-grow"),
        button("Cancelar", "ews-btn", () => closeMenu({ focusButton: true })),
        button("Aplicar", "ews-btn primary", save));
      popup.append(head, body, foot);
      const selector = focus ? `input[data-signer="${focus.signer}"][data-line="${focus.line ?? 0}"]` : "input";
      const input = popup.querySelector(selector);
      input?.focus({ preventScroll: true });
      /* Sólo se desplaza la lista del panel, nunca la página. */
      const card = focus && input?.closest(".ew-signer");
      if (card) body.scrollTop = Math.max(0, card.offsetTop - body.offsetTop - 8);
    }
    function save() {
      const next = draftBlock();
      applied = true;
      closeMenu({ focusButton: true });
      apply(m => { const blocks = [...m.blocks]; blocks[index] = next; return { content: { ...m, blocks } }; });
    }
    popup.hidden = false;
    popup.setAttribute("aria-labelledby", "ew-sig-title");
    host.classList.add("is-sig-open");
    paint();
    const trigger = sigButton();
    trigger.setAttribute("aria-expanded", "true");
    openMenu = { kind: "sig", index, popup, button: trigger, onClose() {
      cancelAnimationFrame(frame); frame = 0;
      host.classList.remove("is-sig-open");
      /* Sin «Aplicar», la hoja vuelve a las firmas originales. */
      if (!applied) preview(block);
      current()?.classList.remove("is-editing");
    } };
    preview(block);
    /* Al abrirse el panel la hoja se reacomoda: las firmas quedan centradas
       en lo que el panel deja ver (al lado, o arriba si es hoja inferior). */
    requestAnimationFrame(() => {
      const target = current();
      if (!target) return;
      const box = canvas.getBoundingClientRect(), panel = popup.getBoundingClientRect(), sig = target.getBoundingClientRect();
      const covered = panel.left < box.right - 1 ? Math.max(0, box.bottom - panel.top) : 0;
      const visible = box.height - covered;
      const top = sig.top - box.top + canvas.scrollTop;
      canvas.scrollTo({ top: Math.max(0, top - Math.max(16, (visible - sig.height) / 2)), behavior: "smooth" });
    });
  }

  /* ── Tablas: bloque atómico como las firmas; se edita celda por celda ── */
  /* El panel se abre desde «Insertar»: ese botón recibe el foco al cerrarlo. */
  const tblButton = () => toolbar.querySelector('[data-ew-menu="data"]');
  /* Texto de una celda → fragmentos: «( )» y «(X)» son casillas; lo demás
     toma el formato de `base`. */
  function cellRuns(value, base = {}) {
    const runs = [];
    let last = 0;
    for (const match of value.matchAll(/\(\s?([xX]?)\s?\)/g)) {
      if (match.index > last) runs.push({ ...base, text: value.slice(last, match.index) });
      runs.push({ ...base, text: "", chk: !!match[1] });
      last = match.index + match[0].length;
    }
    if (last < value.length) runs.push({ ...base, text: value.slice(last) });
    return runs.length ? runs : [{ ...base, text: "" }];
  }
  function tableCommand() {
    if (readonly) return;
    if (openMenu?.kind === "tbl") { closeMenu({ focusButton: true }); return; }
    const m = readModel();
    const at = clampPos(m, currentSel().start).b;
    if (isTableBlock(m.blocks[at])) { openTable(at); return; }
    const empty = () => ({ cells: [{ runs: [] }, { runs: [] }, { runs: [] }] });
    const block = { t: "tbl", cols: [1, 1, 1], rows: [{ h: true, cells: [{ runs: [{ text: "Columna 1" }] }, { runs: [{ text: "Columna 2" }] }, { runs: [{ text: "Columna 3" }] }] }, empty(), empty()] };
    apply((current, sel) => {
      const b = clampPos(current, sel.start).b;
      const blocks = [...current.blocks];
      blocks.splice(b + 1, 0, block, { t: "p", runs: [] });
      return { content: { ...current, blocks }, selection: sel };
    });
    openTable(at + 1);
  }
  function openTable(index) {
    if (readonly) return;
    const block = readModel().blocks[index];
    if (!isTableBlock(block)) return;
    closeMenu();
    const popup = host.querySelector('[data-ew-popup="tbl"]');
    const text = cell => cell.runs.map(run => run.text).join("");
    /* Borrador: cada celda con sus fragmentos y lo escrito. */
    const draft = { cols: [...block.cols], rows: block.rows.map(row => ({ h: !!row.h, cells: row.cells.map(cell => ({ runs: cell.runs, text: text(cell), value: text(cell) })) })) };
    let applied = false;
    const el = (tag, cls, txt) => { const node = document.createElement(tag); if (cls) node.className = cls; if (txt !== undefined) node.textContent = txt; return node; };
    const button = (label, cls, onClick, disabled = false) => { const b = el("button", cls, label); b.type = "button"; b.disabled = disabled; on(b, "click", onClick); return b; };
    const blankCell = () => ({ runs: [], text: "", value: "" });
    const draftBlock = () => ({ t: "tbl", cols: draft.cols, rows: draft.rows.map(row => ({ ...(row.h ? { h: true } : {}), cells: row.cells.map(cell => {
      if (cell.value === cell.text && cell.runs.length) return { runs: cell.runs };
      const base = cell.runs.find(run => !run.missing && run.chk === undefined) || {};
      const { text: _t, missing: _m, chk: _c, ...format } = base;
      return { runs: cellRuns(cell.value, format) };
    }) })) });
    const width = () => draft.cols.length;
    function paint() {
      popup.replaceChildren();
      const head = el("div", "ew-sig-head");
      const titles = el("div", "ew-sig-titles");
      const title = el("strong", "", "Tabla"); title.id = "ew-tbl-title";
      titles.append(title, el("span", "", `${draft.rows.length} filas × ${width()} columnas`));
      head.append(titles);
      const body = el("div", "ew-sig-body");
      body.append(el("p", "ew-sig-hint", "Escribe en cada celda. «( )» se vuelve una casilla que se marca con un clic en la hoja."));
      const grid = el("div", "ew-tbl-grid");
      grid.style.gridTemplateColumns = `repeat(${width()}, minmax(90px, 1fr))`;
      draft.rows.forEach((row, r) => row.cells.forEach((cell, c) => {
        const input = el("textarea", "ew-tbl-cell" + (row.h ? " is-head" : ""));
        input.rows = 2; input.value = cell.value; input.maxLength = 2000;
        input.setAttribute("aria-label", `Fila ${r + 1}, columna ${c + 1}`);
        input.dataset.r = String(r); input.dataset.c = String(c);
        on(input, "input", () => { cell.value = input.value; });
        grid.append(input);
      }));
      body.append(grid);
      const tools = el("div", "ew-sig-presets");
      tools.append(
        button("+ Fila", "ew-chip", () => { if (draft.rows.length < MAX_TABLE_ROWS) { draft.rows.push({ h: false, cells: draft.cols.map(blankCell) }); paint(); } }, draft.rows.length >= MAX_TABLE_ROWS),
        button("− Fila", "ew-chip", () => { draft.rows.pop(); paint(); }, draft.rows.length <= 1),
        button("+ Columna", "ew-chip", () => { draft.cols.push(1); draft.rows.forEach(row => row.cells.push(blankCell())); paint(); }, width() >= MAX_TABLE_COLS),
        button("− Columna", "ew-chip", () => { draft.cols.pop(); draft.rows.forEach(row => row.cells.pop()); paint(); }, width() <= 1),
        button(draft.rows[0].h ? "Primera fila: normal" : "Primera fila: encabezado", "ew-chip", () => { draft.rows[0].h = !draft.rows[0].h; paint(); }));
      body.append(tools);
      const foot = el("div", "ew-sig-foot");
      foot.append(
        button("Quitar tabla", "ews-btn quiet is-danger", () => { applied = true; closeMenu({ focusButton: true }); apply(m => { const blocks = [...m.blocks]; blocks.splice(index, 1); return { content: { ...m, blocks } }; }); }),
        el("span", "ew-grow"),
        button("Cancelar", "ews-btn", () => closeMenu({ focusButton: true })),
        button("Aplicar", "ews-btn primary", save));
      popup.append(head, body, foot);
      popup.querySelector("textarea")?.focus({ preventScroll: true });
    }
    function save() {
      const next = draftBlock();
      applied = true;
      closeMenu({ focusButton: true });
      apply(m => { const blocks = [...m.blocks]; blocks[index] = next; return { content: { ...m, blocks } }; });
    }
    popup.hidden = false;
    popup.setAttribute("aria-labelledby", "ew-tbl-title");
    host.classList.add("is-sig-open");
    blockEls(sheet)[index]?.classList.add("is-editing");
    paint();
    const trigger = tblButton();
    trigger.setAttribute("aria-expanded", "true");
    openMenu = { kind: "tbl", index, popup, button: trigger, onClose() {
      host.classList.remove("is-sig-open");
      if (!applied) blockEls(sheet)[index]?.classList.remove("is-editing");
    } };
  }
  /* Casilla: un clic la marca o la desmarca (un paso de deshacer). */
  function toggleCheck(node) {
    const blocks = blockEls(sheet);
    const block = blocks.find(candidate => candidate.contains(node));
    const b = blocks.indexOf(block);
    if (b < 0) return;
    const nth = [...block.querySelectorAll(".rd-chk")].indexOf(node);
    apply(m => {
      const next = normalizeContent(m);
      let k = -1;
      for (const run of next.blocks[b].runs) if (run.chk !== undefined && ++k === nth) { run.chk = !run.chk; run.text = ""; }
      return { content: next };
    });
  }

  /* ── API de datos ── */
  const dataOf = () => Object.fromEntries(variables.map(v => [v.path, v]));
  function insertVariable(path) {
    const v = dataOf()[path];
    if (!v) return;
    sheet.focus({ preventScroll: true });
    apply((m, sel) => {
      const fmt = formatAt(m, sel);
      const format = {};
      for (const key of ["b", "i", "u"]) if (fmt[key]) format[key] = true;
      if (fmt.size) format.size = fmt.size;
      if (fmt.font) format.font = fmt.font;
      const run = v.missing ? variableRun(path, {}, format) : { ...format, text: v.value };
      return insertRuns(m, sel, [run]);
    });
  }
  function setPage(patch) {
    sheet.focus({ preventScroll: true });
    apply(m => ({ content: { ...m, page: normalizePage({ ...m.page, ...patch }) } }));
  }

  /* ── Eventos de la hoja ── */
  on(sheet, "beforeinput", e => {
    if (readonly) return;
    const type = e.inputType;
    if (type === "historyUndo" || type === "historyRedo") { e.preventDefault(); travel(type === "historyUndo" ? -1 : +1); return; }
    if (type === "formatBold" || type === "formatItalic" || type === "formatUnderline") { e.preventDefault(); inline({ formatBold: "b", formatItalic: "i", formatUnderline: "u" }[type]); return; }
    /* Lo que el navegador formatearía por su cuenta (arrastrar, menús de
       formato del sistema) no entra: el formato pasa por la barra. */
    if (type === "insertFromDrop" || (type.startsWith("format") && type !== "formatSetInlineTextDirection")) { e.preventDefault(); return; }
    if (type === "insertText" && pending && e.data) {
      const s = readSelection();
      if (s && isCollapsed(s) && s.start.b === pending.b && s.start.o === pending.o) { e.preventDefault(); typeWithPending(e.data); return; }
    }
    const s = readSelection();
    if (type === "deleteContentForward" && s && isCollapsed(s) && isAtomicBlock(readModel().blocks[s.start.b + 1])
      && s.start.o === charsOf(blockEls(sheet)[s.start.b] || sheet)) { e.preventDefault(); return; }
    const atStart = !!s && isCollapsed(s) && s.start.o === 0;
    if (type === "deleteContentBackward" && atStart && backspaceAtStart(readModel(), s)) {
      e.preventDefault(); apply((m, sel) => backspaceAtStart(m, sel)); return;
    }
    /* Lo que escribe el navegador entra al historial por pasos (undoStep). */
    const joins = (type === "deleteContentBackward" && atStart) || (type === "deleteContentForward" && !!s && isCollapsed(s)
      && s.start.o === charsOf(blockEls(sheet)[s.start.b] || sheet));
    const kind = undoStep(type, { joins });
    if (kind && (kind === "break" || kind !== lastKind)) flushTyping();
    lastKind = kind === "break" ? null : kind;
  });
  on(sheet, "input", () => {
    if (readonly) return;
    /* Borrar todo puede dejar la hoja sin párrafos: se vuelve a poner uno. */
    if (!sheet.firstElementChild) { render({ page: model.page, blocks: [] }, { start: { b: 0, o: 0 }, end: { b: 0, o: 0 } }); }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { typingTimer = 0; readModel(); snapshot(); }, TYPING_PAUSE);
    onChange({ source: "typing" });
    scheduleState();
  });
  on(sheet, "paste", e => {
    e.preventDefault();
    if (readonly) return;
    const html = e.clipboardData?.getData("text/html") || "";
    const text = e.clipboardData?.getData("text/plain") || "";
    let blocks;
    if (html) blocks = fromNodes(new DOMParser().parseFromString(html, "text/html").body, { page: model.page }).blocks;
    else if (text) blocks = text.replace(/\r\n?/g, "\n").split("\n").map(line => ({ t: "p", runs: [{ text: line }] }));
    if (!blocks?.length) return;
    apply((m, sel) => insertBlocks(m, sel, blocks));
  });
  on(sheet, "drop", e => e.preventDefault());
  on(sheet, "click", e => {
    if (readonly) return;
    const chk = e.target.closest?.(".rd-chk");
    if (chk && !chk.closest("[data-rd-tbl]")) { toggleCheck(chk); return; }
    const tbl = e.target.closest?.("[data-rd-tbl]");
    if (tbl) { const index = blockEls(sheet).indexOf(tbl); if (index >= 0) openTable(index); return; }
    const sig = e.target.closest?.("[data-rd-sig]");
    if (!sig) return;
    const index = blockEls(sheet).indexOf(sig);
    if (index >= 0) openSignatures(index);
  });
  /* Atajos por tecla física (`code`): en un teclado en español Shift+7 es «/». */
  const SHORTCUTS = {
    plain: { KeyB: "b", KeyI: "i", KeyU: "u", KeyZ: "undo", KeyY: "redo", BracketRight: "indent", BracketLeft: "outdent" },
    shift: { Digit7: "list:ol", Digit8: "list:ul", KeyL: "align:left", KeyE: "align:center", KeyR: "align:right", KeyJ: "align:justify", KeyZ: "redo" }
  };
  on(sheet, "keydown", e => {
    if (readonly || !(IS_MAC ? e.metaKey : e.ctrlKey)) return;
    if (e.altKey) {
      const level = /^Digit([0-3])$/.exec(e.code)?.[1];
      if (level) { e.preventDefault(); runSelect("block", level === "0" ? "p" : `h${level}`); }
      return;
    }
    const name = SHORTCUTS[e.shiftKey ? "shift" : "plain"][e.code];
    if (name) { e.preventDefault(); runCommand(name); }
  });
  on(document, "selectionchange", scheduleState);
  on(sheet, "input", scheduleGuides);

  /* ── Eventos de la barra ── */
  /* Los botones no se llevan el foco: la selección de la hoja sigue viva. */
  on(toolbar, "mousedown", e => { if (e.target.closest("button")) e.preventDefault(); });
  on(toolbar, "click", e => {
    const button = e.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.ewMenu) { openPopup(button.dataset.ewMenu, button); return; }
    if (button.dataset.ewCmd) runCommand(button.dataset.ewCmd);
  });
  on(toolbar, "change", e => {
    const select = e.target.closest("[data-ew-select]");
    if (select && select.value) runSelect(select.dataset.ewSelect, select.value);
  });
  on(document, "pointerdown", e => { if (openMenu && !openMenu.popup.contains(e.target) && !openMenu.button.contains(e.target) && !(openMenu.kind === "sig" && e.target.closest?.("[data-rd-sig]")) && !(openMenu.kind === "tbl" && e.target.closest?.("[data-rd-tbl]"))) closeMenu(); });

  function setReadOnly(value) {
    readonly = !!value;
    sheet.contentEditable = readonly ? "false" : "true";
    sheet.setAttribute("aria-readonly", String(readonly));
    host.classList.toggle("is-readonly", readonly);
    toolbar.hidden = readonly;
    closeMenu();
    syncHistoryButtons();
  }

  if (!readonly) {
    try { document.execCommand("defaultParagraphSeparator", false, "p"); document.execCommand("styleWithCSS", false, false); } catch { /* navegador sin execCommand: Enter sigue funcionando */ }
  }
  render(model);
  setReadOnly(readonly);
  snapshot({ start: { b: 0, o: 0 }, end: { b: 0, o: 0 } });
  syncToolbar();

  return {
    /* Contenido actual, normalizado (lo que se guarda). */
    getContent() { flushTyping(); return readModel(); },
    missing() { return missingOf(readModel()); },
    /* Indicaciones entre corchetes que siguen en el texto. */
    brackets() { return bracketsOf(readModel()); },
    /* Esc: primero se cierra un menú abierto; devuelve si había uno. */
    dismiss() { if (!openMenu) return false; closeMenu({ focusButton: true }); return true; },
    focus() { sheet.focus({ preventScroll: true }); writeSelection(lastSel || { start: { b: 0, o: 0 }, end: { b: 0, o: 0 } }); },
    /* Selecciona un tramo del texto ({ start, end } del modelo) y lo trae a
       la vista: «Por completar» lleva a cada indicación entre corchetes. */
    select(selection) {
      if (destroyed || !selection?.start) return;
      sheet.focus({ preventScroll: true });
      writeSelection({ start: selection.start, end: selection.end || selection.start });
      const block = blockEls(sheet)[selection.start.b];
      block?.scrollIntoView({ block: "center", behavior: "smooth" });
      scheduleState();
    },
    setReadOnly,
    setVariables(next) { variables = Array.isArray(next) ? next : []; },
    insertVariable,
    /* Completa un dato pendiente en todo el documento; devuelve cuántas veces. */
    fillMissing(path, value) {
      let count = 0;
      apply((m, sel) => { const out = fillMissing(m, path, value); count = out.count; return out.count ? { content: out.content, selection: sel } : null; });
      return count;
    },
    destroy() {
      destroyed = true;
      abort.abort();
      resize.disconnect();
      clearTimeout(typingTimer);
      if (rafId) cancelAnimationFrame(rafId);
      host.classList.remove("ew", "is-readonly");
      host.replaceChildren();
    }
  };
}

/* Imprimir (o «Guardar como PDF» desde el diálogo del navegador): sólo la
   hoja, en un iframe propio, con el tamaño y los márgenes del documento.
   La página del navegador va sin margen (@page margin:0): así no queda
   espacio para los encabezados y pies que agrega el navegador (fecha, título,
   URL, «1/1»). Los márgenes del documento los ponen la hoja (izquierda y
   derecha) y una tabla cuyo encabezado y pie vacíos se repiten en cada página
   (arriba y abajo). */
const escapeAttr = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
export function printHtml(content, { title = "Documento", stylesheet = "" } = {}) {
  const model = normalizeContent(content);
  const size = PAGE_SIZES[model.page.size], margin = MARGINS[model.page.margin];
  return `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><title>${escapeAttr(title)}</title>`
    + `${stylesheet ? `<link rel="stylesheet" href="${escapeAttr(stylesheet)}">` : ""}`
    + `<style>@page{size:${size.width}pt ${size.height}pt;margin:0}.ew-print .rd-page{padding:0 ${margin}pt}.ew-print-flow td.ew-print-gap{height:${margin}pt}</style></head>`
    + `<body class="ew-print"><table class="ew-print-flow" role="presentation"><thead><tr><td class="ew-print-gap"></td></tr></thead>`
    + `<tfoot><tr><td class="ew-print-gap"></td></tr></tfoot><tbody><tr><td>`
    + `<div class="${pageClasses(model.page)}">${toHtml(model)}</div></td></tr></tbody></table></body></html>`;
}
export function printDocument(content, options = {}) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.className = "ew-print-frame";
  frame.srcdoc = printHtml(content, options);
  frame.addEventListener("load", async () => {
    const win = frame.contentWindow;
    win.addEventListener("afterprint", () => frame.remove(), { once: true });
    try { await win.document.fonts?.ready; } catch { /* sin API de fuentes: se imprime igual */ }
    win.focus();
    win.print();
    /* Si el navegador no avisa al terminar, el iframe igual se retira. */
    setTimeout(() => frame.isConnected && frame.remove(), 60000);
  }, { once: true });
  document.body.append(frame);
}
