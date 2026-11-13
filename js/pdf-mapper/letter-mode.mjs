/* PDF Mapper · «Carta con formato».
 *
 * Una carta escrita con el MISMO editor del expediente de clientes
 * (doc-editor-ui.mjs: párrafos, títulos, listas, sangría, interlineado,
 * negritas/cursivas/tamaños por fragmento, datos y bloque de firmas) y
 * dibujada con pdf-lib (doc-editor-pdf.mjs) sobre un membrete opcional.
 *
 * Los datos se guardan como `{{ruta}}`: el editor los muestra como «[Dato]»
 * y la vista previa los llena con datos de ejemplo. Panel autocontenido: no
 * toca el mapa de campos ni los documentos de plataforma; su borrador vive en
 * localStorage (`pdfMapperLetter.v1`). El export es el contenido
 * `safeautentic.redaccion` más la caja del cuerpo. */

import { mountDocEditor } from "../clientes/doc-editor-ui.mjs?v=20261101.1";
import { normalizeContent, applyTemplate, isSignatureBlock, isTableBlock, EDITOR_VARIABLES, REDACCION_SCHEMA, contentVersion, signerFrom, signatureBlock, CONSULTANT_SIGNER } from "../clientes/doc-editor.mjs?v=20261101.1";
import { renderRedaccionPdf, pageBox } from "../clientes/doc-editor-pdf.mjs";
import { DATA_BINDING_PATTERN } from "../shared/document-data.mjs";

const STORE = "pdfMapperLetter.v1";
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
export const LETTER_EXPORT_SCHEMA = "safeautentic.pdf-mapper.carta";

/* Un dato que el editor marca como faltante vuelve a ser `{{ruta}}`. */
export function templateContent(content) {
  const model = normalizeContent(content);
  const back = runs => runs.map(run => (run.missing ? (({ missing, ...fmt }) => ({ ...fmt, text: `{{${missing}}}` }))(run) : run));
  return mapRuns(model, back);
}

/* Aplica `fn` a los fragmentos de cada párrafo, firmante y celda. */
function mapRuns(model, fn) {
  return normalizeContent({
    page: model.page,
    blocks: model.blocks.map(block => (isSignatureBlock(block)
      ? { ...block, signers: block.signers.map(s => ({ lines: s.lines.map(l => ({ runs: fn(l.runs) })) })) }
      : isTableBlock(block) ? { ...block, rows: block.rows.map(row => ({ ...row, cells: row.cells.map(cell => ({ runs: fn(cell.runs) })) })) }
      : { ...block, runs: fn(block.runs) }))
  });
}

/* Lo contrario, para el editor: cada `{{ruta}}` se muestra como «[Dato]».
 * Sin applyTemplate: ése quita los renglones de registro sin dato, y en una
 * plantilla ningún dato está lleno todavía. */
export function editorContent(content) {
  const model = normalizeContent(content);
  const split = runs => runs.flatMap(run => {
    if (run.missing || run.chk !== undefined) return [run];
    const { text, ...fmt } = run, out = [];
    let last = 0;
    for (const match of text.matchAll(DATA_BINDING_PATTERN)) {
      if (match.index > last) out.push({ ...fmt, text: text.slice(last, match.index) });
      out.push({ ...fmt, text: "", missing: match[1] });
      last = match.index + match[0].length;
    }
    if (last < text.length) out.push({ ...fmt, text: text.slice(last) });
    return out.length ? out : [run];
  });
  return mapRuns(model, split);
}

/* Datos de ejemplo: cada dato muestra su nombre, para ver dónde cae. */
const SAMPLE_DATES = { "fecha.hoy": "31 de octubre de 2026", "fecha.dia": "31", "fecha.mes": "octubre", "fecha.anio": "2026" };
export function sampleData() {
  const data = {};
  for (const v of EDITOR_VARIABLES) {
    const [group, key] = v.path.split(".");
    (data[group] ||= {})[key] = SAMPLE_DATES[v.path] ?? v.label;
  }
  return data;
}

/* Caja del cuerpo: los márgenes de la hoja, salvo arriba/abajo si el
 * membrete ocupa más. */
export function bodyBoxes(page, { firstTop = null, nextTop = null, bottom = null } = {}) {
  const base = pageBox(page);
  const top = value => (Number.isFinite(value) && value > 0 ? base.height - value : base.top);
  const low = Number.isFinite(bottom) && bottom > 0 ? bottom : base.bottom;
  return { box: { ...base, top: top(firstTop), bottom: low }, nextBox: { ...base, top: top(nextTop ?? firstTop), bottom: low } };
}

export function letterExport(state) {
  const content = templateContent(state.content);
  return {
    schema: LETTER_EXPORT_SCHEMA, version: 1,
    redaccion: { schema: REDACCION_SCHEMA, version: contentVersion(content), contenido: content },
    cuerpo: { margenSuperiorPrimera: state.firstTop ?? null, margenSuperiorSiguientes: state.nextTop ?? null, margenInferior: state.bottom ?? null },
    membrete: state.letterhead ? { nombre: state.letterheadName || "membrete.pdf" } : null
  };
}

/* Word → PDF fijo para mapearlo como cualquier plantilla. El texto queda tal
 * como viene en el Word (sus «XXX», resaltados o ejemplos incluidos), para
 * vincularlo después con las herramientas del mapper. Lo dibuja el mismo
 * motor que la carta, así que imágenes, encabezados y cuadros de texto del
 * Word no pasan (lo dicen las notas). */
export async function wordToTemplatePdf({ pdfLib, buffer }) {
  const { importDocx, resolveImport } = await import("../clientes/docx-import.mjs");
  const { draft, findings, notes } = await importDocx(buffer);
  if (!draft.blocks.length) throw new Error("el Word no tiene texto que convertir");
  const content = resolveImport(draft, {});
  const { box, nextBox } = bodyBoxes(content.page);
  const report = {};
  const bytes = await renderRedaccionPdf({ pdfLib, content, box, nextBox, report });
  const unencodable = [...(report.unencodable || [])];
  if (unencodable.length) notes.push(`Caracteres que la fuente PDF no escribe (salen como «?»): ${unencodable.join(" ")}`);
  return { bytes, notes, findings: findings.length };
}

const STARTER = () => normalizeContent({
  page: { size: "carta", margin: "normal", font: "sans", fontSize: 12 },
  blocks: [
    { t: "p", align: "right", runs: [{ text: "{{fecha.hoy}}" }] },
    { t: "p", runs: [{ text: "" }] },
    { t: "p", runs: [{ text: "{{cliente.encargado}}", b: true }] },
    { t: "p", runs: [{ text: "{{cliente.empresa}}" }] },
    { t: "p", runs: [{ text: "P R E S E N T E", b: true }] },
    { t: "p", runs: [{ text: "" }] },
    { t: "p", align: "justify", runs: [{ text: "Escriba aquí el cuerpo de la carta." }] },
    { t: "p", runs: [{ text: "" }] },
    { t: "p", align: "center", runs: [{ text: "Atentamente", b: true }] },
    signatureBlock([signerFrom(CONSULTANT_SIGNER)])
  ]
});

function load() {
  try { return JSON.parse(localStorage.getItem(STORE) || "null"); } catch { return null; }
}
function save(state) {
  try { localStorage.setItem(STORE, JSON.stringify({ content: state.content, firstTop: state.firstTop, nextTop: state.nextTop, bottom: state.bottom })); } catch { /* sin almacenamiento: el borrador dura la sesión */ }
}

let stylesheet = null;
function ensureStyles() {
  if (stylesheet) return;
  stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "/css/doc-editor.css?v=20261101.1";
  document.head.append(stylesheet);
  const style = document.createElement("style");
  style.textContent = `
  .lm-overlay{position:fixed;inset:0;z-index:60;background:#000a;display:flex;align-items:stretch;justify-content:center;padding:2vh 2vw}
  .lm{position:relative;display:grid;grid-template-rows:auto auto 1fr;width:100%;max-width:1500px;background:var(--panel,#fff);color:var(--text,#111);border:1px solid var(--border,#ccc);border-radius:12px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.5)}
  .lm-head{display:flex;gap:8px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border,#ccc);flex-wrap:wrap}
  .lm-head h2{margin:0;font-size:16px;margin-right:auto;color:var(--text,#111)}
  .lm-opts{display:flex;gap:14px;align-items:end;padding:10px 16px;border-bottom:1px solid var(--border,#ccc);flex-wrap:wrap;font-size:12px;color:var(--text-dim,#555)}
  .lm-opts label{display:flex;flex-direction:column;gap:4px}
  .lm-opts input[type=number]{width:90px}
  .lm-body{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);min-height:0}
  /* .ews da los tokens y estilos del escritor de clientes (doc-editor.css). */
  .lm-editor{min-height:0;height:auto;overflow:auto;display:flex;flex-direction:column;border-right:1px solid var(--border,#ccc);background:#fff;color:#111}
  .lm-editor .ew{min-height:100%}
  .lm-preview{min-height:0;overflow:auto;padding:14px;display:flex;flex-direction:column;align-items:center;gap:8px;background:var(--bg,#eee);color:var(--text-dim,#555)}
  .lm-preview canvas{box-shadow:0 12px 32px rgba(0,0,0,.35);background:#fff;max-width:100%}
  .lm-status{font-size:12px;text-align:center;color:var(--text-dim,#555)}
  .lm-warn{margin:0;font-size:12px;color:var(--amber,#a15c00)}
  .lm-review{position:absolute;inset:0;z-index:5;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px}
  .lm-review-card{background:var(--panel,#fff);color:var(--text,#111);border:1px solid var(--border,#ccc);border-radius:12px;width:min(760px,100%);max-height:100%;display:flex;flex-direction:column;padding:18px;gap:10px;box-shadow:0 24px 60px rgba(0,0,0,.5)}
  .lm-review-card h3{margin:0;font-size:16px;color:var(--text,#111)}
  .lm-muted{margin:0;font-size:12.5px;line-height:1.5;color:var(--text-dim,#555)}
  .lm-review-list{overflow:auto;display:flex;flex-direction:column;gap:6px;min-height:0}
  .lm-review-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(180px,260px);gap:10px;align-items:center;padding:8px 10px;background:var(--panel-2,#f6f6f6);border:1px solid var(--border-soft,#ddd);border-radius:8px}
  .lm-review-row span{display:flex;flex-direction:column;gap:2px;min-width:0}
  .lm-review-row small{color:var(--text-faint,#777);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .lm-review-row b{font-size:13px;color:var(--text,#111);overflow-wrap:anywhere}
  .lm-review-foot{display:flex;justify-content:flex-end;gap:8px;padding-top:4px}
  @media (max-width:600px){.lm-review-row{grid-template-columns:1fr}}
  @media (max-width:900px){.lm-body{grid-template-columns:1fr}.lm-editor{border-right:0;border-bottom:1px solid var(--border,#ccc)}}`;
  document.head.append(style);
}

/* Abre el panel. getTemplateBytes(): bytes del PDF del documento actual (o
 * null) para usarlo de membrete. docxFile: un Word que se importa al abrir
 * (con la revisión de sus datos), como desde «Importar Word…». */
export function openLetterEditor({ pdfLib, pdfjsLib, getTemplateBytes = async () => null, toast = () => {}, docxFile = null }) {
  ensureStyles();
  const saved = load();
  const state = {
    content: saved?.content ? normalizeContent(saved.content) : STARTER(),
    firstTop: saved?.firstTop ?? null, nextTop: saved?.nextTop ?? null, bottom: saved?.bottom ?? null,
    letterhead: null, letterheadName: "", page: 0, bytes: null, pdf: null, seq: 0
  };
  const overlay = document.createElement("div");
  overlay.className = "lm-overlay";
  overlay.innerHTML = `
  <div class="lm" role="dialog" aria-modal="true" aria-labelledby="lmTitle">
    <div class="lm-head">
      <h2 id="lmTitle">Carta con formato</h2>
      <button class="btn ghost" data-lm="pdf" title="El PDF de la vista previa, con datos de ejemplo">Descargar PDF de prueba</button>
      <button class="btn ghost" data-lm="json" title="Contenido de la carta con sus datos {{…}} y la caja del cuerpo">Descargar carta (.json)</button>
      <button class="btn" data-lm="docx" title="Trae una carta de Word: identifica sus datos (resaltados, XXX, (instrucciones), campos de combinar), firmas, tablas y casillas para vincularlos">Importar Word…</button>
      <input type="file" data-lm="docxfile" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden>
      <button class="btn ghost" data-lm="loadjson">Cargar carta…</button>
      <input type="file" data-lm="jsonfile" accept="application/json,.json" hidden>
      <button class="btn primary" data-lm="close">Cerrar</button>
    </div>
    <div class="lm-opts">
      <label>Membrete
        <select data-lm="lhsource"><option value="">Sin membrete (hoja en blanco)</option><option value="current">PDF del documento actual</option><option value="file">Elegir PDF…</option></select>
      </label>
      <input type="file" data-lm="lhfile" accept="application/pdf,.pdf" hidden>
      <label title="Distancia desde el borde superior hasta donde empieza el texto en la primera hoja (pt). Vacío: el margen de la hoja.">Inicio del texto, 1.ª hoja (pt)<input type="number" min="0" max="700" step="1" data-lm="firstTop"></label>
      <label title="Lo mismo en las hojas siguientes. Vacío: igual que la primera.">Hojas siguientes (pt)<input type="number" min="0" max="700" step="1" data-lm="nextTop"></label>
      <label title="Espacio libre al pie (pt), por ejemplo para el pie del membrete. Vacío: el margen de la hoja.">Margen inferior (pt)<input type="number" min="0" max="400" step="1" data-lm="bottom"></label>
      <span class="lm-warn" data-lm="warn" role="status"></span>
    </div>
    <div class="lm-body">
      <div class="lm-editor ews"><div class="ew" data-lm="editor"></div></div>
      <div class="lm-preview">
        <div class="lm-status" data-lm="status" aria-live="polite">Generando…</div>
        <div><button class="btn ghost" data-lm="prev" aria-label="Página anterior">‹</button> <span data-lm="pages">1/1</span> <button class="btn ghost" data-lm="next" aria-label="Página siguiente">›</button></div>
        <canvas data-lm="canvas"></canvas>
      </div>
    </div>
  </div>`;
  const $ = key => overlay.querySelector(`[data-lm="${key}"]`);
  /* Los atajos del mapper escuchan en document: dentro del panel no aplican
   * (actuarían sobre la plantilla mientras se escribe la carta). */
  for (const type of ["keydown", "keyup", "keypress"]) overlay.addEventListener(type, e => e.stopPropagation());
  document.body.append(overlay);

  for (const key of ["firstTop", "nextTop", "bottom"]) $(key).value = state[key] ?? "";
  const variables = EDITOR_VARIABLES.map(v => ({ ...v, value: "", missing: true }));
  /* Los datos se muestran como «[Dato]» (faltantes) para conservar su ruta. */
  const mount = content => mountDocEditor($("editor"), { content: editorContent(content), variables, onChange: () => schedule() });
  let editor = mount(state.content);

  let timer = 0;
  function schedule(delay = 400) { clearTimeout(timer); timer = setTimeout(refresh, delay); }
  async function refresh() {
    const seq = ++state.seq;
    state.content = templateContent(editor.getContent());
    save(state);
    const preview = applyTemplate(state.content, sampleData());
    const { box, nextBox } = bodyBoxes(preview.page, state);
    const report = {};
    try {
      const bytes = await renderRedaccionPdf({ pdfLib, content: preview, background: state.letterhead, box, nextBox, report });
      if (seq !== state.seq) return;
      state.bytes = bytes;
      const previous = state.pdf;
      state.pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      previous?.destroy();
      state.page = Math.min(state.page, state.pdf.numPages - 1);
      $("warn").textContent = report.unencodable.length ? `Caracteres que la fuente PDF no escribe (salen como «?»): ${report.unencodable.join(" ")}` : "";
      $("status").textContent = `Vista previa con datos de ejemplo · ${state.pdf.numPages} hoja${state.pdf.numPages === 1 ? "" : "s"}`;
      await paint();
    } catch (err) {
      if (seq !== state.seq) return;
      $("status").textContent = "No se pudo generar: " + err.message;
    }
  }
  let task = null;
  async function paint() {
    if (!state.pdf) return;
    const page = await state.pdf.getPage(state.page + 1);
    const canvas = $("canvas"), ratio = window.devicePixelRatio || 1;
    const width = Math.max(260, overlay.querySelector(".lm-preview").clientWidth - 40);
    const scale = Math.min(1.4, width / page.view[2]);
    const viewport = page.getViewport({ scale: scale * ratio });
    task?.cancel();
    canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
    canvas.style.width = viewport.width / ratio + "px"; canvas.style.height = viewport.height / ratio + "px";
    task = page.render({ canvasContext: canvas.getContext("2d"), viewport });
    try { await task.promise; } catch { return; }
    $("pages").textContent = `${state.page + 1}/${state.pdf.numPages}`;
  }
  const download = (blob, name) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  $("prev").addEventListener("click", () => { if (state.page > 0) { state.page--; paint(); } });
  $("next").addEventListener("click", () => { if (state.pdf && state.page < state.pdf.numPages - 1) { state.page++; paint(); } });
  for (const key of ["firstTop", "nextTop", "bottom"]) $(key).addEventListener("input", e => {
    const value = e.target.value === "" ? null : Number(e.target.value);
    state[key] = Number.isFinite(value) ? value : null;
    schedule(250);
  });
  $("lhsource").addEventListener("change", async e => {
    if (e.target.value === "file") { $("lhfile").click(); return; }
    if (e.target.value === "current") {
      const bytes = await getTemplateBytes().catch(() => null);
      if (!bytes) { toast("El documento actual no tiene PDF para usar de membrete"); e.target.value = ""; state.letterhead = null; }
      else { state.letterhead = bytes.slice(); state.letterheadName = "plantilla-actual.pdf"; }
    } else state.letterhead = null;
    schedule(0);
  });
  $("lhfile").addEventListener("change", async e => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) { $("lhsource").value = state.letterhead ? "file" : ""; return; }
    state.letterhead = new Uint8Array(await file.arrayBuffer());
    state.letterheadName = file.name;
    schedule(0);
  });
  $("pdf").addEventListener("click", () => {
    if (!state.bytes) { toast("La vista previa todavía no está lista"); return; }
    download(new Blob([state.bytes], { type: "application/pdf" }), "carta-prueba.pdf");
  });
  $("json").addEventListener("click", () => {
    state.content = templateContent(editor.getContent());
    download(new Blob([JSON.stringify(letterExport(state), null, 2)], { type: "application/json" }), "carta.json");
  });
  $("loadjson").addEventListener("click", () => $("jsonfile").click());
  $("jsonfile").addEventListener("change", async e => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data?.schema !== LETTER_EXPORT_SCHEMA || !data.redaccion?.contenido) throw new Error("no es una carta exportada desde aquí");
      state.content = normalizeContent(data.redaccion.contenido);
      editor.destroy();
      editor = mount(state.content);
      state.firstTop = data.cuerpo?.margenSuperiorPrimera ?? null;
      state.nextTop = data.cuerpo?.margenSuperiorSiguientes ?? null;
      state.bottom = data.cuerpo?.margenInferior ?? null;
      for (const key of ["firstTop", "nextTop", "bottom"]) $(key).value = state[key] ?? "";
      schedule(0);
    } catch (err) { toast("No se pudo cargar: " + err.message); }
  });
  /* Word → hallazgos para vincular → contenido. */
  $("docx").addEventListener("click", () => $("docxfile").click());
  $("docxfile").addEventListener("change", e => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (file) importWordFile(file);
  });
  async function importWordFile(file) {
    try {
      const { importDocx, resolveImport, defaultChoices, IMPORT_TARGETS } = await import("../clientes/docx-import.mjs");
      const result = await importDocx(await file.arrayBuffer());
      reviewImport(result, { resolveImport, defaultChoices, IMPORT_TARGETS }, file.name);
    } catch (err) { toast("No se pudo leer el Word: " + err.message); }
  }
  function reviewImport({ draft, findings, notes }, { resolveImport, defaultChoices, IMPORT_TARGETS }, name) {
    const choices = defaultChoices(findings);
    const box = document.createElement("div");
    box.className = "lm-review";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Vincular los datos de la carta");
    const kindLabel = { dato: "Dato marcado", campo: "Campo de combinar", firma: "Firma" };
    const options = IMPORT_TARGETS.map(t => `<option value="${t.value}">${escapeHtml(t.label)}</option>`).join("");
    box.innerHTML = `<div class="lm-review-card">
      <h3>Datos encontrados en «${escapeHtml(name)}»</h3>
      <p class="lm-muted">Revisa a qué dato se vincula cada uno. Lo vinculado se llena solo con los datos del cliente; una indicación queda como «[…]» para completarla.</p>
      ${notes.map(n => `<p class="lm-warn">${escapeHtml(n)}</p>`).join("")}
      <div class="lm-review-list">${findings.length ? findings.map(f => `<label class="lm-review-row">
        <span><small>${kindLabel[f.kind] || "Dato"}${f.before ? ` · …${escapeHtml(f.before.slice(-40))}` : ""}</small><b>${escapeHtml(f.text.slice(0, 120))}</b></span>
        <select data-fid="${f.id}">${options}</select></label>`).join("") : `<p class="lm-muted">No se encontraron datos marcados: el texto se importa tal cual.</p>`}</div>
      <div class="lm-review-foot"><button class="btn ghost" data-r="cancel">Cancelar</button><button class="btn primary" data-r="ok">Importar carta</button></div>
    </div>`;
    for (const select of box.querySelectorAll("select[data-fid]")) {
      select.value = choices[select.dataset.fid];
      select.addEventListener("change", () => { choices[select.dataset.fid] = select.value; });
    }
    box.querySelector('[data-r="cancel"]').addEventListener("click", () => box.remove());
    box.querySelector('[data-r="ok"]').addEventListener("click", () => {
      state.content = resolveImport(draft, choices);
      editor.destroy();
      editor = mount(state.content);
      box.remove();
      schedule(0);
      toast(`Carta importada: ${findings.filter(f => !String(choices[f.id]).startsWith("__")).length} dato(s) vinculados`);
    });
    overlay.querySelector(".lm").append(box);
    box.querySelector("select, button")?.focus();
  }

  const close = () => { clearTimeout(timer); state.seq++; task?.cancel(); state.pdf?.destroy(); editor.destroy(); overlay.remove(); };
  $("close").addEventListener("click", close);
  /* Esc cierra primero un menú abierto del editor; después, el panel. */
  overlay.addEventListener("keydown", e => { if (e.key === "Escape" && !editor.dismiss()) close(); });
  schedule(0);
  if (docxFile) importWordFile(docxFile);
  return { close };
}
