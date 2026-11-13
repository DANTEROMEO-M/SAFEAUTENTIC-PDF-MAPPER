/* Modo "Bloques de texto" de PDF Mapper: documentos de plataforma cuyo
 * contenido es texto que fluye, sin coordenadas por campo (Cartas CDMX,
 * Carta responsiva). El editor cambia su CONTENIDO — la constante de datos de
 * su módulo —, nunca su renderer: la vista previa llama al renderer real con
 * el contenido editado, así que lo que se ve es lo que se imprime.
 *
 * Módulo puro (sin DOM ni pdf-lib): registro de documentos, roles de bloque,
 * datos disponibles, preflight, diferencias y el texto exportado para la IA. */

/* Versión independiente: sin documentos de plataforma registrados. Cada
 * entrada sería { id, label, shape: "pages" | "content", module, file, tests }. */
export const FLOW_DOCUMENTS = Object.freeze({});

const clone = value => JSON.parse(JSON.stringify(value));

/* Lo editable de cada documento, tomado del objeto que exporta su módulo. */
export function modelFromDocument(flowDoc, moduleDocument) {
  return flowDoc.shape === "pages"
    ? { pages: clone(moduleDocument.pages), authority: clone(moduleDocument.authority || {}) }
    : { content: clone(moduleDocument.content) };
}

/* ---- Bloques (Cartas CDMX) ---- */
export const BLOCK_ROLES = Object.freeze({
  paragraph: "Párrafo",
  date: "Fecha",
  subject: "Asunto",
  title: "Título",
  recipient: "Destinatario",
  bullet: "Viñeta",
  bulletText: "Continuación de viñeta",
  activities: "Tabla de actividades",
  signature: "Firma",
  signatures: "Firma doble"
});
/* Roles que son un párrafo con estilo propio (fuente y alineación). */
export const TEXT_ROLES = Object.freeze(["paragraph", "date", "subject", "title"]);
export const ALIGNMENTS = Object.freeze({ left: "Izquierda", center: "Centro", right: "Derecha", justify: "Justificado" });
/* Familias que el renderer sabe dibujar (fuentes estándar de PDF). */
export const BLOCK_FONTS = Object.freeze({ Helvetica: "Sans · Helvetica", TimesRoman: "Serif · Times", Courier: "Monoespaciada · Courier" });
/* Roles que admiten estilo propio (fuente, negrita, cursiva, color, tamaño). */
export const STYLED_ROLES = Object.freeze(["paragraph", "date", "subject", "title", "bullet", "bulletText"]);
const STYLE_KEYS = ["font", "color", "size"];
export const roleOf = block => block?.role || "paragraph";
export const isSignature = block => ["signature", "signatures"].includes(roleOf(block));

/* Bloque nuevo, con el estilo que ya usa el documento para ese rol. */
export function newBlock(role = "paragraph") {
  if (role === "bullet" || role === "bulletText") return { role, text: "" };
  const styles = {
    paragraph: { bold: false, italic: false, align: "justify" },
    date: { bold: false, italic: false, align: "right" },
    subject: { bold: true, italic: false, align: "left" },
    title: { bold: true, italic: false, align: "center" }
  };
  const style = styles[role] || styles.paragraph;
  return role === "paragraph" ? { text: "", ...style } : { role, text: "", ...style };
}

/* Cambiar de rol entre párrafos conserva el texto y el estilo propio
 * (fuente, color, tamaño); negrita y alineación son las del rol nuevo. */
export function withTextRole(block, role) {
  const next = { ...newBlock(role), text: block.text ?? "" };
  for (const key of STYLE_KEYS) if (block[key] != null) next[key] = block[key];
  if (role === "paragraph") delete next.role;
  return next;
}

/* Textos editables de un bloque, con la ruta de cada uno dentro del bloque. */
export function blockTexts(block) {
  const role = roleOf(block);
  if (role === "recipient") return (block.lines || []).map((text, i) => ({ key: `lines.${i}`, text }));
  if (role === "signature") return [{ key: "title", text: block.title }, ...(block.lines || []).map((line, i) => ({ key: `lines.${i}.text`, text: line.text }))];
  if (role === "signatures") {
    return [
      { key: "title", text: block.title },
      ...(block.left || []).map((line, i) => ({ key: `left.${i}.text`, text: line.text })),
      ...(block.right || []).map((line, i) => ({ key: `right.${i}.text`, text: line.text })),
      ...(block.lower ? [{ key: "lower", text: block.lower }] : [])
    ];
  }
  if (role === "activities") {
    return [
      ...(block.columns || []).map((text, i) => ({ key: `columns.${i}`, text })),
      ...(block.rows || []).flatMap((row, r) => row.map((text, c) => ({ key: `rows.${r}.${c}`, text }))),
      { key: "mark", text: block.mark }
    ];
  }
  return [{ key: "text", text: block.text }];
}

export function blockExcerpt(block, max = 90) {
  const text = blockTexts(block).map(item => String(item.text ?? "").trim()).filter(Boolean).join(" · ");
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

/* ---- Textos con nombre (Carta responsiva) ---- */
export const RESPONSIVA_SLOTS = Object.freeze([
  ["sections.first", "Franja del encabezado · primera página"],
  ["sections.annex", "Franja del encabezado · anexo de equipos"],
  ["sections.conditions", "Franja del encabezado · página de condiciones"],
  ["title", "Título"],
  ["subtitle", "Subtítulo"],
  ["issued", "Fecha de emisión"],
  ["reference", "Factura / referencia"],
  ["scope", "Alcance del servicio"],
  ["salutation", "Saludo"],
  ["intro", "Párrafo de introducción"],
  ["companyLabel", "Etiqueta de la empresa"],
  ["locationLabel", "Etiqueta de la ubicación"],
  ["equipmentTitle", "Título de la tabla de equipos"],
  ["equipmentContinued", "Título de la tabla en páginas de continuación"],
  ["quantityHeader", "Encabezado de la columna de cantidad"],
  ["descriptionHeader", "Encabezado de la columna de descripción"],
  ["conditionsTitle", "Título de las condiciones"],
  ["signerLabel", "Leyenda bajo la firma"],
  ["qrLabel", "Leyenda bajo el QR"],
  ["footer", "Pie de página"],
  ["pageLabel", "Número de página"],
  ["continues", "Aviso al pie cuando la tabla sigue en la página siguiente"]
]);
export const readPath = (source, path) => String(path).split(".").reduce((value, key) => value?.[key], source);
export function writePath(target, path, value) {
  const keys = String(path).split(".");
  const last = keys.pop();
  const node = keys.reduce((acc, key) => acc[key], target);
  node[last] = value;
}

export function contentTexts(content) {
  if(content?.version===1&&content.labels&&content.sections)return [...Object.entries(content.labels).map(([key,text])=>({key:`labels.${key}`,label:key,text})),...content.extras.map((e,i)=>({key:`extras.${i}.text`,label:`Texto adicional ${i+1}`,text:e.text}))];
  return [
    ...RESPONSIVA_SLOTS.map(([key, label]) => ({ key, label, text: readPath(content, key) })),
    ...(content.conditions || []).map((text, i) => ({ key: `conditions.${i}`, label: `Condición ${i + 1}`, text }))
  ];
}

/* ---- Datos ---- */
const BINDING = /\{\{\s*([^}]*?)\s*\}\}/g;
export function bindingsIn(text) {
  return [...String(text ?? "").matchAll(BINDING)].map(match => match[1]);
}
/* Rutas hoja de un objeto de datos (las listas no se insertan en un texto). */
export function flattenPaths(value, prefix = "") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, inner]) => flattenPaths(inner, prefix ? `${prefix}.${key}` : key));
}
/* Datos de la Carta responsiva (el renderer arma este contexto). */
export const RESPONSIVA_BINDINGS = Object.freeze(["issuer.name", "document.date", "document.reference", "document.scope"]);
export const RESPONSIVA_PAGE_BINDINGS = Object.freeze(["page", "pages"]);

/* Juegos de datos de muestra por documento de plataforma: { [id]: [{ name, payload, profile }] }. */
export const FLOW_SAMPLES = Object.freeze({});

/* ---- Preflight ----
 * known: rutas {{…}} que el renderer sabe resolver.
 * unencodable(texto): caracteres que la fuente estándar del PDF no escribe.
 * reports: [{ dataset, report }] — el reporte de maquetación del renderer real
 *          con cada juego de datos. */
export function flowPreflight({ shape, model, known, unencodable = () => [], reports = [] }) {
  const warnings = [];
  const add = (severity, type, target, message) => warnings.push({ severity, type, target, message });
  const checkText = (text, target, label, allowed) => {
    const value = String(text ?? "");
    const unknown = [...new Set(bindingsIn(value).filter(path => !allowed.has(path)))];
    if (unknown.length) add("error", "binding", target, `${label}: ${unknown.map(path => `{{${path}}}`).join(", ")} no existe — se imprimiría vacío`);
    if (/\{\{|\}\}/.test(value.replace(BINDING, ""))) add("warn", "binding", target, `${label}: llaves {{ }} incompletas o mal escritas`);
    const bad = unencodable(value.replace(BINDING, ""));
    if (bad.length) add("error", "encoding", target, `${label}: carácter(es) que la fuente del PDF no puede escribir: ${bad.map(c => `«${c}»`).join(" ")}`);
  };
  const knownSet = new Set(known);
  if (shape === "pages") {
    model.pages.forEach((page, p) => {
      if (!page.blocks.length) add("info", "empty", { page: p }, `Página ${p + 1}: no tiene bloques (sale en blanco)`);
      const signatureAt = page.blocks.findIndex(isSignature);
      page.blocks.forEach((block, b) => {
        const target = { page: p, block: b };
        const label = `Página ${p + 1}, bloque ${b + 1} (${BLOCK_ROLES[roleOf(block)] || roleOf(block)})`;
        if (!BLOCK_ROLES[roleOf(block)]) add("error", "role", target, `${label}: rol desconocido — el renderer lo dibujaría como párrafo`);
        if (signatureAt >= 0 && b > signatureAt) add("warn", "order", target, `${label}: va después de la firma y no se imprime (la firma cierra la página)`);
        for (const item of blockTexts(block)) checkText(item.text, target, label, knownSet);
        if (STYLED_ROLES.includes(roleOf(block))) {
          if (!String(block.text ?? "").trim()) add("info", "empty", target, `${label}: está vacío y no se imprime`);
          if (block.font != null && !BLOCK_FONTS[block.font]) add("error", "style", target, `${label}: la fuente «${block.font}» no existe — se usaría Helvetica`);
          if (block.color != null && !/^#[0-9a-f]{6}$/i.test(block.color)) add("error", "style", target, `${label}: el color «${block.color}» no es #rrggbb — se usaría el negro del formato`);
          if (block.size != null && !(block.size >= 5 && block.size <= 28)) add("warn", "style", target, `${label}: ${block.size} pt está fuera de lo legible en una carta (5–28 pt)`);
        }
      });
    });
    for (const [key, text] of Object.entries(model.authority || {})) checkText(text, { authority: key }, `Destinataria (${key})`, knownSet);
  } else {
    const withPage = new Set([...knownSet, ...RESPONSIVA_PAGE_BINDINGS]);
    for (const slot of contentTexts(model.content)) checkText(slot.text, { slot: slot.key }, slot.label, slot.key === "pageLabel" ? withPage : knownSet);
    if (!model.content.conditions?.length) add("info", "empty", { slot: "conditions" }, "No hay condiciones: la sección sale sólo con su título");
  }
  /* Lo que sólo el renderer real sabe: hasta dónde baja cada página. Un
   * mismo choque en varios juegos de datos se reporta una vez. */
  const issues = new Map();
  for (const { dataset, report } of reports) {
    for (const page of report?.pages || []) {
      for (const issue of page.issues || []) {
        const key = `${page.page}|${issue}`;
        if (!issues.has(key)) issues.set(key, { page: page.page, issue, datasets: [] });
        issues.get(key).datasets.push(dataset);
      }
    }
  }
  for (const { page, issue, datasets } of issues.values()) {
    const with_ = `con ${datasets.map(name => `«${name}»`).join(" y ")}`;
    const target = shape === "pages" ? { page: page - 1 } : null;
    if (issue === "overflow") add("error", "layout", target, `Página ${page}: ${with_} el contenido baja hasta el pie o se sale de la hoja — acorta el texto o muévelo a otra página`);
    else if (issue === "qr") add("warn", "layout", target, `Página ${page}: ${with_} el texto llega a la zona del QR y su recuadro blanco lo taparía`);
    else if (issue === "signature") add("error", "layout", target, `Página ${page}: ${with_} las condiciones llegan a la zona de la firma y se enciman`);
    else add("warn", "layout", target, `Página ${page}: ${with_} ${issue}`);
  }
  return warnings;
}

/* ---- Diferencias ---- */
/* Subsecuencia común más larga: qué se conservó, quitó o agregó. */
function lcs(a, b) {
  const m = a.length, n = b.length;
  const table = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { ops.push({ op: "keep", a: i++, b: j++ }); }
    else if (table[i + 1][j] >= table[i][j + 1]) ops.push({ op: "del", a: i++ });
    else ops.push({ op: "add", b: j++ });
  }
  while (i < m) ops.push({ op: "del", a: i++ });
  while (j < n) ops.push({ op: "add", b: j++ });
  return ops;
}
/* Pasa de operaciones a cambios legibles: un borrado seguido de un
 * agregado en el mismo lugar es un cambio. */
function listChanges(before, after, describe) {
  const ops = lcs(before.map(item => JSON.stringify(item)), after.map(item => JSON.stringify(item)));
  const changes = [];
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.op === "del" && ops[k + 1]?.op === "add") {
      const was = describe(before[op.a]), now = describe(after[ops[k + 1].b]);
      /* Mismo texto y estilo a la vista: cambió algo que la descripción no
       * resume (tamaños, espacios, líneas de firma): el código lo lleva. */
      changes.push({ kind: "changed", index: ops[k + 1].b, before: was, after: was === now ? `${now} — cambió su formato (tamaños, espacios o posiciones)` : now });
      k++;
    }
    else if (op.op === "del") changes.push({ kind: "removed", index: op.a, before: describe(before[op.a]) });
    else if (op.op === "add") changes.push({ kind: "added", index: op.b, after: describe(after[op.b]) });
  }
  return changes;
}
/* Rol, estilo (en los párrafos) y el texto: así un cambio sólo de negrita o
 * de alineación también se lee en el paquete. */
function describeBlock(block) {
  const role = roleOf(block);
  const parts = [];
  if (STYLED_ROLES.includes(role)) {
    parts.push(block.bold && block.italic ? "negrita y cursiva" : block.bold ? "negrita" : block.italic ? "cursiva" : "normal");
    if (TEXT_ROLES.includes(role)) parts.push((ALIGNMENTS[block.align || "justify"] || block.align).toLowerCase());
    if (block.font) parts.push(BLOCK_FONTS[block.font] || block.font);
    if (block.size != null) parts.push(`${block.size} pt`);
    if (block.color) parts.push(block.color);
  }
  return `${BLOCK_ROLES[role] || role}${parts.length ? ` (${parts.join(", ")})` : ""}: «${blockExcerpt(block, 120)}»`;
}

export function diffModel(shape, original, edited) {
  if(shape==='quote')return [...new Set([...Object.keys(original.content),...Object.keys(edited.content)])].filter(k=>JSON.stringify(original.content[k])!==JSON.stringify(edited.content[k])).map(k=>({where:k,kind:'changed',before:JSON.stringify(original.content[k]),after:JSON.stringify(edited.content[k])}));
  const changes = [];
  if (shape === "pages") {
    for (const key of new Set([...Object.keys(original.authority || {}), ...Object.keys(edited.authority || {})])) {
      if (original.authority?.[key] !== edited.authority?.[key]) changes.push({ where: `Destinataria (${key})`, kind: "changed", before: original.authority?.[key] ?? "", after: edited.authority?.[key] ?? "" });
    }
    const count = Math.max(original.pages.length, edited.pages.length);
    for (let p = 0; p < count; p++) {
      const a = original.pages[p], b = edited.pages[p];
      if (!a) { changes.push({ where: `Página ${p + 1}`, kind: "added", after: `página nueva con ${b.blocks.length} bloque(s)` }); continue; }
      if (!b) { changes.push({ where: `Página ${p + 1}`, kind: "removed", before: `página con ${a.blocks.length} bloque(s)` }); continue; }
      const { blocks: _a, ...pageA } = a, { blocks: _b, ...pageB } = b;
      if (JSON.stringify(pageA) !== JSON.stringify(pageB)) changes.push({ where: `Página ${p + 1}`, kind: "changed", before: JSON.stringify(pageA), after: JSON.stringify(pageB) });
      for (const change of listChanges(a.blocks, b.blocks, describeBlock)) changes.push({ ...change, where: `Página ${p + 1}, bloque ${change.index + 1}` });
    }
  } else {
    for (const [key, label] of RESPONSIVA_SLOTS) {
      const before = readPath(original.content, key), after = readPath(edited.content, key);
      if (before !== after) changes.push({ where: label, kind: "changed", before, after });
    }
    for (const change of listChanges(original.content.conditions || [], edited.content.conditions || [], text => `«${text}»`)) {
      changes.push({ ...change, where: `Condición ${change.index + 1}` });
    }
  }
  return changes;
}

/* ---- Literales JS, con el mismo formato que el módulo ----
 * Sin cambios, el literal es idéntico al del archivo (lo protege una
 * prueba): la IA no recibe diferencias fantasma. */
const indent = depth => "  ".repeat(depth);
function jsonLiteral(value, depth) {
  if (Array.isArray(value)) {
    const flat = value.every(v => typeof v !== "object" || v === null) || (value.length && value.every(v => Array.isArray(v) && v.every(x => typeof x !== "object")));
    if (flat && JSON.stringify(value).length < 110) return JSON.stringify(value).replace(/","/g, "\", \"").replace(/\],\[/g, "], [");
    return "[\n" + value.map(v => indent(depth + 1) + jsonLiteral(v, depth + 1)).join(",\n") + "\n" + indent(depth) + "]";
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    const inline = entries.every(([, v]) => typeof v !== "object") && JSON.stringify(value).length < 110;
    if (inline) return "{ " + entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ") + " }";
    return "{\n" + entries.map(([k, v]) => `${indent(depth + 1)}${JSON.stringify(k)}: ${jsonLiteral(v, depth + 1)}`).join(",\n") + "\n" + indent(depth) + "}";
  }
  return JSON.stringify(value);
}
function frozenLiteral(value, depth) {
  if (Array.isArray(value)) return "Object.freeze([\n" + value.map(v => indent(depth + 1) + frozenLiteral(v, depth + 1)).join(",\n") + "\n" + indent(depth) + "])";
  if (value && typeof value === "object") return "Object.freeze({\n" + Object.entries(value).map(([k, v]) => `${indent(depth + 1)}${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${frozenLiteral(v, depth + 1)}`).join(",\n") + "\n" + indent(depth) + "})";
  return JSON.stringify(value);
}
export const formatPagesLiteral = pages => `const CARTA_CDMX_PAGES = ${jsonLiteral(pages, 0)};`;
export const formatAuthorityLiteral = authority => `const CDMX_AUTHORITY = ${frozenLiteral(authority, 0)};`;
export const formatContentLiteral = content => `const CARTA_RESPONSIVA_CONTENT = ${frozenLiteral(content, 0)};`;

/* Código a pegar: sólo las constantes que cambiaron (o el contenido
 * completo, si no cambió nada, como referencia). */
export function flowCode(shape, original, edited) {
  if(shape==='quote')return `export const COTIZACION_CONTENT = ${frozenLiteral(edited.content,0)};`;
  if (shape === "content") return formatContentLiteral(edited.content);
  const parts = [];
  if (JSON.stringify(original.authority) !== JSON.stringify(edited.authority)) parts.push(formatAuthorityLiteral(edited.authority));
  if (JSON.stringify(original.pages) !== JSON.stringify(edited.pages) || !parts.length) parts.push(formatPagesLiteral(edited.pages));
  return parts.join("\n\n");
}

/* ---- Paquete para la IA ---- */
const show = value => String(value ?? "").replace(/\s+/g, " ").trim() || "(vacío)";
export function buildFlowBrief({ flowDoc, original, edited, warnings = [], generatedAt }) {
  const shape = flowDoc.shape;
  const changes = diffModel(shape, original, edited);
  const constants = shape === "quote" ? "`COTIZACION_CONTENT`" : shape === "pages" ? "`CARTA_CDMX_PAGES` (y `CDMX_AUTHORITY` si aparece abajo)" : "`CARTA_RESPONSIVA_CONTENT`";
  const lines = [];
  const push = (...items) => lines.push(...items);
  push(`# Cambios en «${flowDoc.label}» (\`${flowDoc.id}\`) — texto fluido`, "");
  push(`> Paquete generado por PDF Mapper el ${generatedAt}. Aplícalo en \`${flowDoc.file}\`.`,
    `> Reemplaza sólo ${constants} por el código de abajo. No toques el renderer, las funciones de datos ni los helpers: el contenido es data y el renderer ya sabe dibujarlo.`, "");
  push("## Cómo está hecho este documento", "");
  if(shape==='quote'){
    push('- `COTIZACION_CONTENT` contiene etiquetas, colores, desplazamientos/estilos de bloques, QR y textos adicionales.', '- Los datos de prueba no son datos de una cotización emitida. No cambies cálculos, permisos, firma o protección PDF.', '- El QR sólo codifica la URL HTTPS indicada; no crea una validación pública de cotizaciones.');
  } else if (shape === "pages") {
    push("- Cada página es `{ layout, gap?, qr?, blocks }`; `layout` es \"standard\" o \"alert\" (página de Alerta Sísmica).",
      "- Cada bloque declara su rol: sin rol, \"date\", \"subject\" o \"title\" es un párrafo (fuente según `bold`/`italic`, alineación según `align`); \"recipient\" son las líneas del destinatario; \"bullet\" y \"bulletText\" son viñetas; \"activities\" es la tabla de actividades; \"signature\" y \"signatures\" son las firmas y cierran la página.",
      "- Los textos admiten datos `{{ruta}}` de `buildCartasCdmxData`, `{{authority.*}}` (destinataria) y `{{signer.ropc}}`.");
  } else {
    push("- `CARTA_RESPONSIVA_CONTENT` guarda los textos visibles; el diseño (colores, franjas, tabla, firma, QR) vive en el renderer.",
      "- Admiten datos `{{issuer.name}}`, `{{document.date}}`, `{{document.reference}}`, `{{document.scope}}`; `pageLabel` además `{{page}}` y `{{pages}}`.");
  }
  push("");
  push("## Cambios respecto al original", "");
  if (!changes.length) push("Sin cambios: el código propuesto es idéntico al actual.", "");
  else {
    const kind = { changed: "Cambió", added: "Nuevo", removed: "Se quitó" };
    for (const change of changes) {
      if (change.kind === "changed") push(`- **${change.where}** — ${kind.changed}: ${show(change.before)} → ${show(change.after)}`);
      else if (change.kind === "added") push(`- **${change.where}** — ${kind.added}: ${show(change.after)}`);
      else push(`- **${change.where}** — ${kind.removed}: ${show(change.before)}`);
    }
    push("");
  }
  if (warnings.length) {
    push("## Advertencias del preflight", "");
    const label = { error: "Error", warn: "Aviso", info: "Nota" };
    const rank = { error: 0, warn: 1, info: 2 };
    for (const w of [...warnings].sort((a, b) => (rank[a.severity] ?? 1) - (rank[b.severity] ?? 1))) push(`- **${label[w.severity] || w.severity}:** ${w.message}`);
    push("");
  }
  push("## Validación", "", "```bash", `node --test ${flowDoc.tests.join(" ")}`, "```", "");
  if(shape==='quote')push('Revisa el PDF con varios conceptos, IVA 0/8/16, firma, QR y textos largos. La referencia de cotización es `_designlab/fixtures/cotizacion.golden.json`; sólo debe cambiar tras revisar el diseño intencional. No regeneres las referencias de cartas por un cambio de cotización.', '');
  else push("La prueba de fotos (`platform-cartas.snapshot.test.mjs`) detecta cualquier cambio de lo impreso. Si el cambio es intencional, regenera la referencia y revisa su diff:", "", "```bash", "UPDATE_GOLDEN=1 node --test _designlab/platform-cartas.snapshot.test.mjs", "```", "");
  push("## Código propuesto", "", "```js", flowCode(shape, original, edited), "```", "");
  return lines.join("\n");
}
