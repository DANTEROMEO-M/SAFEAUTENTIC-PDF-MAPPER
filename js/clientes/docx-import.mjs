/* Importar una carta de Word (.docx) al contenido `safeautentic.redaccion`.
 *
 * Lee el .docx en el navegador (ZIP con DecompressionStream, sin librerías) y
 * conserva lo que el editor sabe representar: párrafos con alineación,
 * sangría, interlineado, negritas/cursivas/subrayado/tamaño/fuente, títulos,
 * listas, tablas (v3), casillas «( )» y el bloque de firmas.
 *
 * Además IDENTIFICA lo variable de la carta para vincularlo a un dato:
 *   - texto resaltado (así marcan los datos las cartas de los clientes),
 *   - «XXX», instrucciones entre paréntesis («(Nombre del Obligado)»),
 *   - campos de combinar correspondencia (MERGEFIELD).
 * Cada hallazgo trae una sugerencia (`{{cliente.empresa}}`, `{{fecha.dia}}`…)
 * que quien importa confirma o cambia; `resolveImport` arma el contenido con
 * esas elecciones. Imágenes y cuadros de texto no entran (van en el
 * membrete) y se reportan.
 *
 * Puro salvo `unzipDocx` (usa DecompressionStream del navegador o de Node). */

import { normalizeContent, FONT_SIZES, MARGINS, MAX_INDENT, MAX_TABLE_ROWS, MAX_TABLE_COLS, EDITOR_VARIABLES } from "./doc-editor.mjs?v=20261101.1";

/* ── ZIP ───────────────────────────────────────────────────────────────── */

const WANTED = /^word\/(document|styles|numbering)\.xml$/;
export async function unzipDocx(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("El archivo no es un .docx válido.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const parts = {}, media = [];
  const utf8 = new TextDecoder("utf-8");
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true), size = view.getUint32(p + 20, true);
    const nameLength = view.getUint16(p + 28, true), extra = view.getUint16(p + 30, true), comment = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + extra + comment;
    if (/^word\/media\//.test(name)) { media.push(name); continue; }
    if (!WANTED.test(name) && !/^word\/(header|footer)\d*\.xml$/.test(name)) continue;
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const data = bytes.subarray(start, start + size);
    let raw = data;
    if (method === 8) raw = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    else if (method !== 0) continue;
    parts[name] = utf8.decode(raw);
  }
  if (!parts["word/document.xml"]) throw new Error("El .docx no trae word/document.xml.");
  return { parts, media };
}

/* ── XML mínimo (WordprocessingML es regular) ─────────────────────────── */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
const unescapeXml = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m);
const attr = (tag, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag); return m ? unescapeXml(m[1]) : null; };
const prop = (xml, tag) => new RegExp(`<${tag}(?=[\\s/>])[^>]*>`).exec(xml)?.[0] || null;
const on = tag => !!tag && !/w:val="(0|false|none)"/.test(tag);

/* Fin del elemento que abre en `start`, contando anidados del mismo nombre. */
function elementEnd(xml, start, tag) {
  const open = new RegExp(`<${tag}(?=[\\s>/])`, "g"), close = `</${tag}>`;
  let depth = 0, i = start;
  open.lastIndex = start;
  for (;;) {
    open.lastIndex = i;
    const o = open.exec(xml);
    const c = xml.indexOf(close, i);
    if (c < 0) return xml.length;
    if (o && o.index < c) {
      const selfClosing = xml[xml.indexOf(">", o.index) - 1] === "/";
      if (!selfClosing) depth++;
      i = xml.indexOf(">", o.index) + 1;
      if (selfClosing && depth === 0) return i;
    } else {
      depth--;
      i = c + close.length;
      if (depth === 0) return i;
    }
  }
}
/* Hijos directos de un contenedor con esos nombres, en orden. */
function children(xml, names) {
  const out = [], re = new RegExp(`<(${names.join("|")})(?=[\\s>/])`, "g");
  let i = 0;
  for (;;) {
    re.lastIndex = i;
    const m = re.exec(xml);
    if (!m) return out;
    const end = elementEnd(xml, m.index, m[1]);
    out.push({ tag: m[1], xml: xml.slice(m.index, end) });
    i = end;
  }
}

/* ── Catálogo de vínculos ─────────────────────────────────────────────── */

export const IMPORT_TARGETS = Object.freeze([
  ...EDITOR_VARIABLES.map(v => Object.freeze({ value: v.path, label: `${v.group} · ${v.label}` })),
  Object.freeze({ value: "__brk", label: "Indicación por completar […]" }),
  Object.freeze({ value: "__text", label: "Dejar el texto tal cual" })
]);
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "setiembre", "octubre", "noviembre", "diciembre"];
const fold = s => String(s).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const MERGE = { dia: "fecha.dia", mes: "fecha.mes", ano: "fecha.anio", anio: "fecha.anio", fecha: "fecha.hoy", razon_social: "cliente.empresa", empresa: "cliente.empresa", domicilio: "cliente.direccion", direccion: "cliente.direccion", rfc: "cliente.rfc", giro: "cliente.giro", municipio: "cliente.municipio", responsable: "cliente.encargado", representante: "cliente.encargado" };

/* Sugerencia para un texto marcado según lo que dice y lo que lo antecede. */
export function suggestFor(text, before = "", { merge = null } = {}) {
  const t = fold(text).trim(), b = fold(before).replace(/\s+/g, " ").trimEnd();
  if (merge) return MERGE[fold(merge).replace(/[^a-z_]/g, "")] || "__brk";
  if (/^\d{1,2}\s+de\s+[a-z]+\s+(de|del)\s+\d{4}$/.test(t) && MONTHS.some(m => t.includes(m))) return "fecha.hoy";
  if (/^\d{1,2}$/.test(t) && Number(t) <= 31) return "fecha.dia";
  if (MONTHS.includes(t)) return "fecha.mes";
  if (/^(19|20)\d{2}$/.test(t)) return "fecha.anio";
  const paren = /^\((.*)\)$/.exec(t)?.[1];
  if (paren !== undefined) {
    const ropc = /responsable oficial|ropc|tercero acreditado/.test(paren);
    if (/domicilio|direccion/.test(paren)) return ropc ? "consultor.direccionEmisor" : "cliente.direccion";
    if (/telefon/.test(paren)) return ropc ? "consultor.telefonoEmisor" : "cliente.telefono";
    if (ropc && /nombre/.test(paren)) return "consultor.nombreConsultor";
    if (/obligado|representante|propietario|titular del establecimiento/.test(paren) && /nombre/.test(paren)) return "cliente.encargado";
    if (/razon social|establecimiento/.test(paren) && /nombre|razon/.test(paren)) return "cliente.empresa";
    return "__brk";
  }
  /* Por lo que lo antecede (vale igual para un ejemplo resaltado y para «XXX»). */
  if (/raz[oó]n social:?$|establecimiento( mercantil)?( denominado)?:?$|denominad[oa]:?$/.test(b)) return "cliente.empresa";
  if (/domicilio( ubicado)?( en)?:?$|direccion:?$/.test(b)) return "cliente.direccion";
  if (/\bgiro( de)?:?$/.test(b)) return "cliente.giro";
  if (/\brfc:?$/.test(b)) return "cliente.rfc";
  if (/alcaldia:?$|municipio:?$/.test(b)) return "cliente.municipio";
  /* «a XXX de XXX de XXX» y «del día XXX de XXX de XXX». */
  if (/^x{3,}$/.test(t)) {
    if (/(,| a| el dia| del dia)$/.test(b)) return "fecha.dia";
    /* Word a veces pega el «de» al dato: «a XXXde XXX de». */
    if (/(\ba|dia) \S+? ?de$/.test(b)) return "fecha.mes";
    if (/de \S+? ?de$/.test(b)) return "fecha.anio";
    return "__brk";
  }
  /* Un renglón resaltado completo es énfasis para revisar, no un dato; una
     indicación («Detallar…», «Indicar…») se vuelve «[…]». */
  if (/^(detallar|indicar|describir|especificar|anotar|mencionar|agregar|escribir|llenar|completar)\b/.test(t)) return "__brk";
  if (t.length > 50) return "__text";
  return t.length > 3 ? "__brk" : "__text";
}

/* ── Párrafos ─────────────────────────────────────────────────────────── */

const nearestSize = pt => FONT_SIZES.reduce((best, s) => (Math.abs(s - pt) < Math.abs(best - pt) ? s : best), FONT_SIZES[0]);
function fontKind(name) {
  const f = fold(name || "");
  if (!f) return null;
  if (/courier|consolas|mono/.test(f)) return "mono";
  if (/times|georgia|garamond|cambria|book antiqua|palatino|serif/.test(f) && !/sans/.test(f)) return "serif";
  return "sans";
}
const ALIGN = { left: "left", start: "left", center: "center", right: "right", end: "right", both: "justify", distribute: "justify" };
const snapLh = n => (n < 1.08 ? 1 : n < 1.4 ? 1.15 : n < 1.75 ? 1.5 : 2);
/* Paréntesis con instrucción para quien llena el formato. */
const INSTRUCTION = /\((?=[^)]{3,200}\))(?:[^)]*\b(?:nombre|n[uú]mero|adecuar|administrador|establecimiento|domicilio|giro|raz[oó]n|indicar|especificar|describir|anotar|fecha|cargo)\b[^)]*)\)/gi;

/* Fragmentos de un párrafo: texto con formato, si está resaltado y si viene
 * de un campo de combinar. Dibujos y cuadros de texto se cuentan aparte. */
function paragraphRuns(pXml, base, stats) {
  stats.images += (pXml.match(/<pic:pic\b|<v:imagedata\b/g) || []).length;
  stats.boxes += (pXml.match(/<w:txbxContent\b/g) || []).length;
  let xml = pXml.replace(/<mc:AlternateContent[\s\S]*?<\/mc:AlternateContent>/g, "").replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, "").replace(/<w:pict>[\s\S]*?<\/w:pict>/g, "");
  /* Campo simple: su resultado son sus runs. */
  xml = xml.replace(/<w:fldSimple\b([^>]*)>([\s\S]*?)<\/w:fldSimple>/g, (_, a, inner) => `<w:r><w:instrText>${attr(`<x ${a}>`, "w:instr") || ""}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${inner}<w:r><w:fldChar w:fldCharType="end"/></w:r>`);
  const runs = [];
  let field = null;
  for (const m of xml.matchAll(/<w:r(?=[\s>])[\s\S]*?<\/w:r>/g)) {
    const r = m[0];
    const fc = attr(prop(r, "w:fldChar") || "", "w:fldCharType");
    if (fc === "begin") { field = { instr: "", result: false }; continue; }
    const instr = /<w:instrText[^>]*>([^<]*)<\/w:instrText>/.exec(r);
    if (instr && field) { field.instr += unescapeXml(instr[1]); continue; }
    if (instr && !field) { field = { instr: unescapeXml(instr[1]), result: false }; continue; }
    if (fc === "separate") { if (field) field.result = true; continue; }
    if (fc === "end") { field = null; continue; }
    if (field && !field.result) continue;
    const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(r)?.[1] || "";
    const fmt = {};
    if (on(prop(rPr, "w:b"))) fmt.b = true;
    if (on(prop(rPr, "w:i"))) fmt.i = true;
    if (on(prop(rPr, "w:u"))) fmt.u = true;
    const sz = Number(attr(prop(rPr, "w:sz") || "", "w:val"));
    if (sz) { const size = nearestSize(sz / 2); if (size !== base.fontSize) fmt.size = size; }
    const kind = fontKind(attr(prop(rPr, "w:rFonts") || "", "w:ascii"));
    if (kind && kind !== base.font) fmt.font = kind;
    const hl = attr(prop(rPr, "w:highlight") || "", "w:val");
    const shd = attr(prop(rPr, "w:shd") || "", "w:fill");
    const marked = (hl && hl !== "none") || (shd && /^(FFFF00|FFFF99|FFF2CC|FFE599)$/i.test(shd));
    let text = "";
    for (const t of r.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t\s*\/>|<w:(tab|br|cr)(?:\s[^>]*)?\/>/g)) {
      if (t[2] === "tab") text += "\t";
      else if (t[2]) { if (!/w:type="page"/.test(t[0])) text += "\n"; }
      else text += unescapeXml(t[1] || "");
    }
    if (!text) continue;
    const merge = field ? /MERGEFIELD\s+"?([^"\s\\]+)/i.exec(field.instr)?.[1] || null : null;
    runs.push({ ...fmt, text, marked: !!marked, merge });
  }
  return runs;
}

function paragraphAttrs(pXml, ctx) {
  const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(pXml)?.[1] || "";
  const out = { t: "p", align: "left", indent: 0, lh: 1.15 };
  const jc = attr(prop(pPr, "w:jc") || "", "w:val");
  if (jc && ALIGN[jc]) out.align = ALIGN[jc];
  const ind = prop(pPr, "w:ind");
  const left = Number(attr(ind || "", "w:left") ?? attr(ind || "", "w:start") ?? 0);
  if (left > 0) out.indent = Math.min(MAX_INDENT, Math.round(left / 20 / 36));
  const spacing = prop(pPr, "w:spacing");
  const line = Number(attr(spacing || "", "w:line"));
  if (line && (attr(spacing, "w:lineRule") || "auto") === "auto") out.lh = snapLh(line / 240);
  const style = attr(prop(pPr, "w:pStyle") || "", "w:val") || "";
  const level = /(?:heading|ttulo|titulo|t\W?tulo)\s?([1-3])/i.exec(fold(style).replace(/[^a-z0-9 ]/g, ""))?.[1];
  if (level) out.t = `h${level}`;
  const numId = attr(prop(pPr, "w:numId") || "", "w:val");
  if (numId && numId !== "0") {
    const ilvl = Number(attr(prop(pPr, "w:ilvl") || "", "w:val") || 0);
    out.t = "li";
    out.list = ctx.numbering[numId]?.[ilvl] === "bullet" ? "ul" : ctx.numbering[numId] ? "ol" : "ul";
    out.indent = Math.min(MAX_INDENT, ilvl);
  }
  return out;
}

function parseNumbering(xml = "") {
  const abstract = {};
  for (const a of children(xml, ["w:abstractNum"])) {
    const id = attr(a.xml, "w:abstractNumId");
    abstract[id] = {};
    for (const l of a.xml.matchAll(/<w:lvl\b[^>]*w:ilvl="(\d+)"[\s\S]*?<\/w:lvl>/g)) abstract[id][l[1]] = attr(prop(l[0], "w:numFmt") || "", "w:val") || "decimal";
  }
  const out = {};
  for (const n of children(xml, ["w:num"])) out[attr(n.xml, "w:numId")] = abstract[attr(prop(n.xml, "w:abstractNumId") || "", "w:val")] || {};
  return out;
}

function pageFrom(doc, styles) {
  const sect = [...doc.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)].pop()?.[0] || "";
  const h = Number(attr(prop(sect, "w:pgSz") || "", "w:h") || 15840);
  const mar = prop(sect, "w:pgMar") || "";
  const margin = (Number(attr(mar, "w:left") || 1440) + Number(attr(mar, "w:right") || 1440)) / 2 / 20;
  const nearest = Object.entries(MARGINS).reduce((best, [k, v]) => (Math.abs(v - margin) < Math.abs(MARGINS[best] - margin) ? k : best), "normal");
  const defaults = /<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.exec(styles || "")?.[0] || "";
  const normal = /<w:style\b[^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/.exec(styles || "")?.[0] || "";
  const sz = Number(attr(prop(normal, "w:sz") || prop(defaults, "w:sz") || "", "w:val") || 22);
  const font = fontKind(attr(prop(normal, "w:rFonts") || prop(defaults, "w:rFonts") || "", "w:ascii")) || "sans";
  return { size: h > 17000 ? "oficio" : "carta", margin: nearest, font, fontSize: nearestSize(sz / 2) };
}

/* ── Hallazgos ─────────────────────────────────────────────────────────── */

/* Junta los fragmentos marcados contiguos en un hallazgo y busca «XXX» e
 * instrucciones entre paréntesis en el resto. Devuelve los fragmentos del
 * párrafo, ya con `fid` en lo que hay que vincular. */
function markFindings(runs, findings, where) {
  const out = [];
  let open = null;
  const textSoFar = () => out.map(r => r.text).join("");
  const add = (text, run, { merge = null } = {}) => {
    const id = `h${findings.length + 1}`;
    const clean = text.replace(/\s+/g, " ").trim();
    findings.push({ id, kind: merge ? "campo" : "dato", text: clean, merge, where, before: textSoFar().slice(-60), suggest: suggestFor(clean, textSoFar(), { merge }) });
    return { ...run, text, fid: id };
  };
  for (const run of runs) {
    const { merge, marked, ...fmt } = run;
    if (merge) { open = null; out.push(add(run.text, fmt, { merge })); continue; }
    if (marked && run.text.trim()) {
      if (open) { open.text += run.text; findings.find(f => f.id === open.fid).text = open.text.replace(/\s+/g, " ").trim(); continue; }
      open = add(run.text, fmt);
      out.push(open);
      continue;
    }
    if (marked && open) { open.text += run.text; continue; }
    open = null;
    /* XXX e instrucciones entre paréntesis dentro de texto normal. */
    let last = 0;
    const text = run.text;
    const hits = [...text.matchAll(/X{3,}/g), ...text.matchAll(INSTRUCTION)].sort((a, b) => a.index - b.index);
    for (const hit of hits) {
      if (hit.index < last) continue;
      if (hit.index > last) out.push({ ...fmt, text: text.slice(last, hit.index) });
      out.push(add(hit[0], fmt));
      last = hit.index + hit[0].length;
    }
    if (last < text.length) out.push({ ...fmt, text: text.slice(last) });
  }
  /* La sugerencia de cada dato mira lo escrito antes de él. «SI ( )»
     resaltado (aunque Word lo parta en varios fragmentos) es una casilla. */
  for (const r of out) {
    if (!r.fid) continue;
    const i = findings.findIndex(x => x.id === r.fid), f = findings[i];
    if (!f.merge && /^\s*(si|no)?\s*\(\s?[xX]?\s?\)\s*$/i.test(f.text)) { findings.splice(i, 1); delete r.fid; continue; }
    f.suggest = suggestFor(f.text, f.before, { merge: f.merge });
  }
  return out;
}

/* «( )» y «(X)» sueltos → casillas. */
function withChecks(runs) {
  return runs.flatMap(run => {
    if (run.fid || !/\(\s?[xX]?\s?\)/.test(run.text)) return [run];
    const out = [];
    let last = 0;
    for (const m of run.text.matchAll(/\(\s?([xX]?)\s?\)/g)) {
      if (m.index > last) out.push({ ...run, text: run.text.slice(last, m.index) });
      out.push({ ...run, text: "", chk: !!m[1] });
      last = m.index + m[0].length;
    }
    if (last < run.text.length) out.push({ ...run, text: run.text.slice(last) });
    return out;
  });
}
/* Tabulaciones y espacios de acomodo → un espacio. */
const tidy = runs => runs.map(run => (run.chk !== undefined ? run : { ...run, text: run.text.replace(/\t+/g, " ").replace(/ {2,}/g, " ") }));
const plain = runs => runs.map(r => r.text).join("");

/* ── Firmas: «ATENTAMENTE», cargos y la línea «C. ⇥ C.» o de nombres ── */
const COLUMN_SPLIT = /\t+| {3,}/;
function detectSignatures(blocks, findings) {
  const at = blocks.findIndex(b => b.t !== "tbl" && /^\s*atentamente[\s.,]*$/i.test(plain(b.runs)));
  if (at < 0) return blocks;
  const after = blocks.slice(at + 1);
  const cols = b => (b.t === "tbl" ? [] : plain(b.runs).split(COLUMN_SPLIT).map(s => s.trim()).filter(Boolean));
  const cLine = after.findIndex(b => cols(b).length >= 2 && cols(b).every(s => /^c\.?$/i.test(s)));
  /* Los nombres: la siguiente línea de columnas, cerca y sin «C.» (otra
     línea «C. …» es un firmante aparte que no va en este bloque). */
  const nameLine = after.findIndex((b, i) => cLine >= 0 && i > cLine && i <= cLine + 4 && cols(b).length >= 2 && !cols(b).some(s => /^c\.(\s|$)/i.test(s)) && cols(b).every(s => s.length <= 60));
  const anchor = nameLine >= 0 ? nameLine : cLine;
  if (anchor < 0) return blocks;
  const n = Math.min(3, cols(after[anchor]).length);
  const titles = after.slice(0, cLine >= 0 ? cLine : anchor).filter(b => b.t !== "tbl" && plain(b.runs).trim()).map(b => plain(b.runs).replace(/\s+/g, " ").trim());
  const names = nameLine >= 0 ? after[nameLine] : null;
  /* Nombres: los hallazgos de esa línea se reparten por columna. */
  const nameTexts = names ? cols(names) : Array(n).fill("");
  const nameFid = names?.runs.find(r => r.fid)?.fid;
  if (nameFid) { const i = findings.findIndex(f => f.id === nameFid); if (i >= 0) findings.splice(i, 1); }
  const signers = Array.from({ length: n }, (_, i) => {
    const title = titles.length === n ? titles[i] : titles.length === 1 ? titles[0] : "";
    const ft = fold(title);
    const suggest = /responsable oficial|ropc|tercero/.test(ft) ? "consultor.nombreConsultor" : /representante|obligado|propietario|administrador|titular/.test(ft) ? "cliente.encargado" : "__brk";
    const id = `h${findings.length + 1}`;
    findings.push({ id, kind: "firma", text: nameTexts[i] || `Firmante ${i + 1}`, where: { signer: i + 1 }, before: title, suggest });
    return { lines: [{ runs: [{ text: nameTexts[i] || `Firmante ${i + 1}`, b: true, fid: id }] }, ...(title ? [{ runs: [{ text: title }] }] : [])] };
  });
  const end = at + 1 + anchor + 1;
  return [...blocks.slice(0, at + 1), { t: "sig", signers }, ...blocks.slice(end)];
}

/* ── Documento ─────────────────────────────────────────────────────────── */

/* parts: { "word/document.xml": xml, "word/styles.xml"?, "word/numbering.xml"? }
 * → { draft, findings, notes }. `draft` lleva `fid` en lo que se vincula. */
export function parseDocx(parts, { media = [] } = {}) {
  const doc = parts["word/document.xml"];
  const page = pageFrom(doc, parts["word/styles.xml"]);
  const ctx = { numbering: parseNumbering(parts["word/numbering.xml"]) };
  const stats = { images: 0, boxes: 0, truncated: 0 };
  const findings = [];
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(doc)?.[1] || "";
  let blocks = [];
  let empties = 0;
  for (const el of children(body, ["w:p", "w:tbl"])) {
    if (el.tag === "w:tbl") {
      empties = 0;
      const grid = [...el.xml.matchAll(/<w:gridCol\b[^>]*w:w="(\d+)"/g)].map(m => Number(m[1]));
      const rows = children(el.xml.replace(/^<w:tbl[^>]*>/, ""), ["w:tr"]).slice(0, MAX_TABLE_ROWS).map((tr, r) => {
        const cells = children(tr.xml.replace(/^<w:tr[^>]*>/, ""), ["w:tc"]).map(tc => {
          const runs = [];
          children(tc.xml.replace(/^<w:tc[^>]*>/, ""), ["w:p"]).forEach((p, k) => {
            const own = withChecks(tidy(markFindings(paragraphRuns(p.xml, page, stats), findings, { table: blocks.length, row: r + 1 })));
            if (k && plain(own).trim()) runs.push({ text: "\n" });
            if (plain(own).trim() || own.some(x => x.chk !== undefined)) runs.push(...own);
          });
          const span = Number(attr(prop(tc.xml, "w:gridSpan") || "", "w:val") || 1);
          const jc = attr(prop(tc.xml, "w:jc") || "", "w:val");
          return { runs, span, align: ALIGN[jc] || null };
        });
        const header = /<w:tblHeader\b/.test(tr.xml) || (r === 0 && cells.every(c => c.runs.filter(x => x.text.trim()).every(x => x.b)) && cells.some(c => plain(c.runs).trim()));
        /* Celdas combinadas: la celda ocupa su lugar y deja vacías las que abarca. */
        const full = cells.length === 1 && grid.length > 1 && cells[0].span >= grid.length;
        return { h: header, full, align: cells[0]?.align, cells: cells.flatMap(c => [c, ...Array(Math.max(0, c.span - 1)).fill({ runs: [] })]).map(({ runs }) => ({ runs })) };
      });
      const width = Math.max(1, ...rows.map(r => r.cells.length));
      if (width > MAX_TABLE_COLS) stats.truncated++;
      const total = grid.slice(0, width).reduce((n, w) => n + w, 0) || width;
      const cols = Array.from({ length: Math.min(width, MAX_TABLE_COLS) }, (_, i) => Math.max(1, Math.round(((grid[i] || total / width) / total) * 100)));
      /* Una fila de una sola celda que abarca todo el ancho (un título o un
         texto de la tabla de acomodo) sale como párrafo; la tabla se parte ahí.
         Una tabla de una sola celda es un recuadro: su texto va como párrafo. */
      let pending = [];
      const flushTable = () => {
        if (pending.length) blocks.push({ t: "tbl", cols, rows: pending.map(row => ({ ...(row.h ? { h: true } : {}), cells: row.cells.slice(0, MAX_TABLE_COLS) })) });
        pending = [];
      };
      for (const row of rows) {
        const filled = row.cells.filter(c => plain(c.runs).trim() || c.runs.some(r => r.chk !== undefined));
        if (row.full || width === 1) {
          flushTable();
          if (filled.length) blocks.push({ t: "p", align: row.align || "left", runs: filled[0].runs.map(r => (r.text === "\n" ? { text: " " } : r)) });
          continue;
        }
        pending.push(row);
      }
      flushTable();
      continue;
    }
    const attrs = paragraphAttrs(el.xml, ctx);
    const raw = paragraphRuns(el.xml, page, stats);
    if (!plain(raw).trim()) {
      /* Renglones vacíos de acomodo: a lo más dos seguidos. */
      if (++empties <= 2) blocks.push({ ...attrs, t: attrs.t === "li" ? "p" : attrs.t, runs: [] });
      continue;
    }
    empties = 0;
    blocks.push({ ...attrs, runs: markFindings(raw, findings, { block: blocks.length }) });
  }
  blocks = detectSignatures(blocks, findings).map(b => (b.t === "sig" || b.t === "tbl" ? b : { ...b, runs: withChecks(tidy(b.runs)) }));
  while (blocks.length && blocks[blocks.length - 1].t === "p" && !plain(blocks[blocks.length - 1].runs).trim()) blocks.pop();
  const notes = [];
  if (stats.images || media.length) notes.push(`${stats.images || media.length} imagen(es) no se importan: el logotipo y los encabezados van en el membrete (PDF de fondo).`);
  if (stats.boxes) notes.push(`${stats.boxes} cuadro(s) de texto no se importan. Si el Word es un diseño sobre una imagen (como una constancia), conviene mapearlo como PDF.`);
  if (stats.truncated) notes.push(`Una tabla tiene más de ${MAX_TABLE_COLS} columnas: se conservaron las primeras ${MAX_TABLE_COLS}.`);
  return { draft: { page, blocks }, findings, notes };
}

/* Contenido final con las elecciones: { [fid]: ruta | "__brk" | "__text" }. */
export function resolveImport(draft, choices = {}) {
  const resolve = runs => runs.map(run => {
    const { fid, ...rest } = run;
    if (!fid) return rest;
    const choice = choices[fid];
    const text = rest.text.replace(/\s+/g, " ").trim();
    if (!choice || choice === "__text") return rest;
    if (choice === "__brk") return { ...rest, text: /^\[.*\]$/.test(text) ? text : `[${text.replace(/^\((.*)\)$/, "$1").replace(/^X{3,}$/i, "Por completar")}]` };
    /* Un dato conserva los espacios que lo rodeaban en la carta. */
    const lead = /^\s*/.exec(rest.text)[0], trail = /\s*$/.exec(rest.text)[0];
    return { ...rest, text: `${lead}{{${choice}}}${trail}` };
  });
  const blocks = draft.blocks.map(block => (block.t === "sig"
    ? { ...block, signers: block.signers.map(s => ({ lines: s.lines.map(l => ({ runs: resolve(l.runs) })) })) }
    : block.t === "tbl" ? { ...block, rows: block.rows.map(row => ({ ...row, cells: row.cells.map(cell => ({ runs: resolve(cell.runs) })) })) }
    : { ...block, runs: resolve(block.runs) }));
  return normalizeContent({ page: draft.page, blocks });
}

/* Elecciones por defecto: las sugerencias. */
export const defaultChoices = findings => Object.fromEntries(findings.map(f => [f.id, f.suggest]));

export async function importDocx(buffer) {
  const { parts, media } = await unzipDocx(buffer);
  return parseDocx(parts, { media });
}
