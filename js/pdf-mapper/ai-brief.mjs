/* "Paquete para IA": el texto que el usuario copia y entrega a una IA para
 * que aplique los cambios en el código de SafeAutentic. PDF Mapper no
 * escribe en el proyecto; este paquete es su salida principal, así que debe
 * bastarle a la IA por sí solo: qué archivo tocar, qué cambió exactamente,
 * el mapa completo, qué datos existen y cuáles faltan, y el código propuesto.
 *
 * Módulo puro: recibe todo ya calculado por el editor (código exportado,
 * advertencias, clasificación de datos) y sólo arma el texto. */

import { isBakedText } from "./engine.mjs";

const fmt = n => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
const show = v => (v === undefined ? "—" : typeof v === "number" ? fmt(v) : JSON.stringify(v));
const cell = v => String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");

/* Propiedades que sólo organizan el editor (no cambian el PDF). */
const EDITOR_ONLY = new Set(["group", "groupLabel", "source", "maskOff", "needsReview", "textReplacement", "textReplacements", "replacementWarning"]);

/* Diferencias campo por campo entre el documento original y el actual. */
export function diffFields(originalFields, currentFields) {
  const byId = list => new Map(list.map(f => [f.id, f]));
  const before = byId(originalFields), after = byId(currentFields);
  const changes = [];
  for (const [id, cur] of after) {
    const orig = before.get(id);
    if (!orig) continue;
    const keys = new Set([...Object.keys(orig), ...Object.keys(cur)]);
    for (const key of keys) {
      if (EDITOR_ONLY.has(key)) continue;
      if (JSON.stringify(orig[key]) !== JSON.stringify(cur[key])) changes.push({ id, prop: key, before: orig[key], after: cur[key] });
    }
  }
  return {
    changes,
    added: currentFields.filter(f => !before.has(f.id)).map(f => f.id),
    removed: originalFields.filter(f => !after.has(f.id)).map(f => f.id)
  };
}

function alignLabel(f) {
  if (f.role) return `fórmula especial (${f.role})`;
  return { pageCenter: "centrado en la página", boxCenter: "centrado en su caja", boxRight: "derecha en su caja", left: "izquierda" }[f.align || "left"] || f.align;
}
function dataLabel(f) {
  if (f.literalText != null) return `texto fijo ${JSON.stringify(f.literalText)}`;
  if (f.textTemplate) return `plantilla ${JSON.stringify(f.textTemplate)}`;
  return f.dataKey ? `\`${f.dataKey}\`` : "—";
}
function notesFor(f) {
  const notes = [];
  if (f.type === "characters") notes.push(`${f.centers.length} casillas, centros ${JSON.stringify(f.centers)}${f.allowHyphen ? ", admite guion" : ""}`);
  if (f.type === "text" && f.shrink) notes.push("una sola línea: reduce la fuente hasta 6 pt si no cabe en su ancho");
  if (f.type === "text" && f.fit) notes.push(`ajusta y envuelve: máx. ${f.maxLines || 1} línea(s), interlineado ${fmt(f.lineHeight || f.size + 1)}`);
  if (f.type === "image") notes.push(`imagen "contain", ${f.hAlign === "left" ? "alineada a la izquierda" : "centrada"}`);
  if (f.type === "qr" && f.frame?.enabled) notes.push(`marco ${f.frame.color} de ${fmt(f.frame.width)} pt`);
  if (f.type === "qr" && f.captionTop?.text) notes.push(`texto superior ${JSON.stringify(f.captionTop.text)}`);
  if (f.type === "qr" && f.captionBottom?.text) notes.push(`texto inferior ${JSON.stringify(f.captionBottom.text)}`);
  if (f.type === "checkbox") notes.push(`marca "${f.checkedGlyph || "X"}"${f.literalChecked != null ? `, siempre ${f.literalChecked ? "marcada" : "vacía"}` : ""}`);
  if (f.prefix || f.suffix) notes.push(`prefijo ${JSON.stringify(f.prefix || "")}, sufijo ${JSON.stringify(f.suffix || "")}`);
  if (f.textCase) notes.push(f.textCase === "uppercase" ? "MAYÚSCULAS" : "minúsculas");
  if (f.source?.text) notes.push(`va en lugar del texto ${JSON.stringify(f.source.text)} de la plantilla`);
  if (isBakedText(f)) notes.push("ya va escrito en la plantilla exportada; el código no lo dibuja");
  if (f.mask) notes.push(`tapa el texto original con un rectángulo ${f.mask.colorHex || "#ffffff"} (x ${fmt(f.mask.x)}, y ${fmt(f.mask.y)}, ${fmt(f.mask.width)} × ${fmt(f.mask.height)})`);
  if (f.colorHex) notes.push(`color ${f.colorHex}`);
  else if (f.color && f.color !== "black") notes.push(`color ${f.color}`);
  return notes.join("; ");
}

/*
 * input: {
 *   doc,                    documento actual del editor
 *   original,               documento original (null si es nuevo)
 *   target: { file, functionName, isNew },
 *   fontName(field),        nombre de la fuente estándar ya resuelta
 *   dataStatus(path),       "delivered" | "platform" | "new" (+ label)
 *   warnings: [{ message }],
 *   code,                   bloque de código propuesto
 *   generatedAt             "AAAA-MM-DD"
 *   integration             (opcional) {
 *     kind: "constancia" | "documento" | null  — null: documento que ya existe;
 *     tracked,                el editor lleva versiones de este mapa;
 *     approval: { n, fingerprint, approvedAt, checks } | null,
 *     changedSinceApproval,
 *     templateFile, templateSha256, registryLine   (documento nuevo)
 *   }
 * }
 */
const CONSTANCIA_DATA_GUIDE = [
  "- `js/index-logic.js` › `_emitirDocConstancia(fields)`: agrégalo a `payload` (se cifra con el documento y permite reimprimirlo) y al objeto que devuelve, que es el `record` con que se dibuja el PDF.",
  "- Quién lo llena: el formulario de emisión (`_baseConstancia` en `js/index-logic.js`), la finalización de cursos (`js/dashboard.js` y `js/cursos.js`, llamadas a `_sa_emitirDocConstancia`) y la importación masiva (`js/index-logic.js`).",
  "- Reimpresión desde administración: `js/shared/pdf.js` arma `r` con el payload descifrado; agrega ahí la misma clave."
];
export function buildAiBrief({ doc, original, target, fontName, dataStatus, warnings, code, generatedAt, integration = null }) {
  const lines = [];
  const push = (...l) => lines.push(...l);
  const pageCount = doc.pageCount || 1;

  push(`# ${target.isNew ? "Documento nuevo" : "Cambios en"} «${doc.label}» (\`${doc.id}\`)`, "");
  push(`> Paquete generado por PDF Mapper el ${generatedAt}. Aplícalo en \`${target.file}\`${target.functionName ? `, función \`${target.functionName}\`` : ""}.`,
    "> No modifiques otros documentos del catálogo ni los helpers compartidos (clean, drawFit, drawCharacters, drawSignature, embedImage).", "");

  if (integration && (integration.kind || integration.tracked)) {
    push("## Estado de la plantilla", "");
    if (integration.approval) {
      const ap = integration.approval, checks = ap.checks || [];
      push(`- **Aprobada:** versión ${ap.n} (huella \`${ap.fingerprint}\`), el ${String(ap.approvedAt || "").slice(0, 10)}. El mapa de este paquete es exactamente esa versión.`);
      if (checks.length) push(`- Probada con ${checks.length} juego(s) de datos: ${checks.map(c => `«${c.dataset}» ${c.errors ? `${c.errors} error(es)` : "sin errores"}${c.warnings ? `, ${c.warnings} aviso(s) revisados` : ""}`).join("; ")}.`);
    } else {
      push(`- **Sin aprobar**${integration.changedSinceApproval ? ": el mapa cambió después de la última versión aprobada" : ""}. Antes de integrarla, quien la mapeó debe probarla y aprobarla en PDF Mapper («Probar»).`);
    }
    push("");
  }

  push("## Documento", "");
  push(`- Plantilla PDF: \`config/client/templates/${doc.template}\`${target.isNew ? " — hay que copiar ahí el PDF original." : ""}`);
  push(`- Página: ${fmt(doc.page.width)} × ${fmt(doc.page.height)} pt${pageCount > 1 ? ` (el PDF tiene ${pageCount} páginas)` : ""}.`);
  push("- Coordenadas en puntos PDF con origen en la esquina INFERIOR izquierda: \"x\" crece a la derecha y \"y\" hacia arriba. En los textos, \"y\" es la línea base.");
  const usedFonts = Object.entries(doc.customFonts || {}).filter(([k]) => doc.fields.some(f => f.fontFile === k));
  if (usedFonts.length) {
    push(`- Fuentes del cliente que el código incrusta (con fontkit, que el código carga si hace falta): ${usedFonts.map(([, f]) => `«${f.family}» → \`config/client/assets/fonts/${f.fileName}\` (SHA-256 \`${f.sha256}\`${f.license ? `; licencia: ${f.license}` : ""})`).join("; ")}. Descárgalas desde Exportar («Descargar fuentes»).`);
  }
  const edits = doc.templateEdits || [];
  if (edits.length || doc.textEdits?.length) {
    const removed = edits.filter(e => e.action === "remove").length, placed = edits.length - removed;
    const removedText = doc.textEdits?.length || 0;
    push(`- La plantilla se editó en PDF Mapper (${[removedText ? `${removedText} texto(s) original(es) retirado(s) del contenido PDF` : "", removed ? `${removed} elemento(s) quitado(s)` : "", placed ? `${placed} movido(s) o con otro tamaño` : ""].filter(Boolean).join(", ")}): usa la plantilla que se descarga desde Exportar («Descargar plantilla»), NO el PDF original del cliente.`);
  }
  const patched = doc.fields.filter(f => f.mask).length;
  if (patched) push(`- La plantilla trae texto de ejemplo que ${patched} campo(s) tapan con un parche del color del papel: se ve tapado, pero el texto sigue dentro del PDF (se puede seleccionar o buscar). Si el cliente puede entregar la plantilla sin el ejemplo, úsala y quita esos parches (\`mask\`).`);
  const unresolvedText = doc.fields.filter(f => f.replacementWarning && !f.textReplacement && !f.textReplacements?.length && !f.mask).length;
  if (unresolvedText) push(`- ${unresolvedText} campo(s) no pudieron retirar su texto original con seguridad y no aplican máscara automáticamente: el ejemplo seguirá visible detrás del dato. En PDF Mapper se puede activar la máscara manualmente o usar una plantilla sin ese texto.`);
  if (doc.acroFieldCount) push(`- La plantilla trae ${doc.acroFieldCount} campo(s) de formulario (AcroForm). Para que no queden cajas editables encima del texto dibujado, aplánalos al renderizar: \`pdfDoc.getForm().flatten()\`.`);
  push("");

  if (original) {
    const { changes, added, removed } = diffFields(original.fields, doc.fields);
    push("## Cambios respecto al original", "");
    if (!changes.length && !added.length && !removed.length) {
      push("Sin cambios: el código propuesto es equivalente al actual.", "");
    } else {
      if (changes.length) {
        push("| Campo | Propiedad | Antes | Ahora |", "|---|---|---|---|");
        for (const c of changes) push(`| ${cell(c.id)} | ${cell(c.prop)} | ${cell(show(c.before))} | ${cell(show(c.after))} |`);
        push("");
      }
      if (added.length) push(`Campos agregados: ${added.map(id => `\`${id}\``).join(", ")}.`, "");
      if (removed.length) push(`Campos eliminados: ${removed.map(id => `\`${id}\``).join(", ")}.`, "");
    }
  }

  push(`## Campos (${doc.fields.length})`, "");
  const multiPage = pageCount > 1;
  if (multiPage) push("Cada campo se dibuja en su página: `pdfDoc.getPages()[página - 1]`.", "");
  push(`| Campo | Tipo |${multiPage ? " Pág. |" : ""} Dato | X | Y | Ancho | Alto | Fuente | Tamaño | Alineación | Notas |`, `|---|---|${multiPage ? "---|" : ""}---|---|---|---|---|---|---|---|---|`);
  for (const f of doc.fields) {
    const x = f.type === "characters" ? "casillas" : f.align === "pageCenter" || f.role ? "—" : show(f.x);
    const w = f.width != null ? show(f.width) : f.type === "checkbox" ? show(f.size) : "—";
    const h = f.height != null ? show(f.height) : f.type === "checkbox" ? show(f.size) : "—";
    const font = f.fontKey ? fontName(f) : "—";
    const size = f.size != null && f.type !== "checkbox" ? show(f.size) : "—";
    const align = f.type === "text" ? alignLabel(f) : "—";
    push(`| ${cell(f.id)} | ${f.type} |${multiPage ? ` ${(f.page || 0) + 1} |` : ""} ${cell(dataLabel(f))} | ${x} | ${show(f.y)} | ${w} | ${h} | ${font} | ${size} | ${cell(align)} | ${cell(notesFor(f))} |`);
  }
  push("");

  const paths = [...new Set(doc.fields.flatMap(f => [
    f.literalText == null && !f.textTemplate ? f.dataKey : null,
    ...[...String(f.textTemplate || "").matchAll(/\{([\w.]+)\}/g)].map(m => m[1])
  ]).filter(Boolean))];
  const groups = { delivered: [], platform: [], new: [] };
  if (paths.length) {
    for (const p of paths) { const s = dataStatus(p); groups[s.status].push(`\`${p}\`${s.label ? ` (${s.label})` : ""}`); }
    push("## Datos", "");
    if (groups.delivered.length) push(`- Ya los entrega la plataforma a este documento: ${groups.delivered.join(", ")}.`);
    if (groups.platform.length) push(`- Existen en SafeAutentic pero hoy no llegan a este render — hay que pasarlos en \`data\`: ${groups.platform.join(", ")}.`);
    if (groups.new.length) push(`- NUEVOS — SafeAutentic no los captura todavía; hay que agregarlos al formulario de emisión y al payload: ${groups.new.join(", ")}.`);
    push("");
    if (integration?.kind === "constancia" && (groups.platform.length || groups.new.length)) {
      push("### Cómo hacer llegar un dato a la constancia", "", "La constancia recibe `data.record`. Para cada dato pendiente:", "", ...CONSTANCIA_DATA_GUIDE, "");
    }
  }
  const needsData = groups.platform.length > 0 || groups.new.length > 0;

  if (warnings.length) {
    push("## Advertencias del preflight", "");
    const severityLabel = { error: "Error", warn: "Aviso", info: "Nota" };
    const rank = { error: 0, warn: 1, info: 2 };
    for (const w of [...warnings].sort((a, b) => (rank[a.severity] ?? 1) - (rank[b.severity] ?? 1))) {
      push(`- ${w.severity ? `**${severityLabel[w.severity] || w.severity}:** ` : ""}${w.message}`);
    }
    push("");
  }

  if (integration?.kind) {
    const constancia = integration.kind === "constancia";
    push("## Integración en SafeAutentic", "");
    push("> Con el paquete ZIP de PDF Mapper (Exportar → «Descargar paquete»), los pasos de plantilla y fuentes se resuelven descomprimiéndolo en `public/`: cada archivo queda en su lugar y `LEEME.md` trae su huella.", "");
    push(`1. **Plantilla.** Copia ${integration.templateEdited ? "la plantilla editada (Exportar → «Descargar plantilla»)" : "el PDF del cliente"} a \`config/client/templates/${integration.templateFile}\`.${integration.templateSha256 ? ` Su SHA-256 es \`${integration.templateSha256}\`; confírmalo con \`certutil -hashfile ${integration.templateFile} SHA256\` (Windows) o \`sha256sum ${integration.templateFile}\`.` : ""}`);
    const fontsUsed = Object.entries(doc.customFonts || {}).filter(([k]) => doc.fields.some(f => f.fontFile === k));
    if (fontsUsed.length) push(`1b. **Fuentes.** Copia ${fontsUsed.map(([, f]) => `\`${f.fileName}\``).join(", ")} (Exportar → «Descargar fuentes») a \`config/client/assets/fonts/\` y confirma su SHA-256 como el de la plantilla.`);
    push(`2. **Render.** En \`${target.file}\`, pega el bloque de «Código propuesto» antes de \`export const clientDocuments\`. Usa los helpers que ese archivo ya define (\`clean\`, \`drawFit\`, \`drawCharacters\`, \`drawSignature\`, \`embedImage\`); no los dupliques.`);
    push(`3. **Catálogo.** Dentro de \`clientDocuments\`, ${constancia ? "después de la entrada `constancia` (la primera entrada es la plantilla predeterminada del generador), " : ""}agrega:`, "", "   ```js", `   ${integration.registryLine}`, "   ```");
    push(constancia
      ? `4. **Generador.** No hay que tocar el dashboard: \`listClientDocumentVariants("constancia")\` (\`js/shared/client-documents.mjs\`) ofrece «${doc.label}» en «Plantilla de constancia» (emisión, cursos y administración). La plantilla elegida se guarda en \`record.plantilla\` y \`resolveClientDocumentVariant\` la usa al generar y al reimprimir.`
      : `4. **Generador.** Este documento no es una constancia (su ID no empieza con \`constancia-\`): el generador no lo ofrece. Necesita su propio flujo de emisión — formulario, payload y una llamada a \`renderClientDocument(${JSON.stringify(doc.id)}, { data })\` —, que queda fuera de este paquete.`);
    push(`5. **Datos.** ${needsData ? "Haz llegar los datos marcados arriba como existentes en la plataforma o nuevos" + (constancia ? " (ver «Cómo hacer llegar un dato a la constancia»)." : ".") : "Todos los datos que usa ya llegan a este render: no hay que tocar formularios ni payloads."}`, "");
    push("## Verificación", "");
    push("1. Desde `public/`: `node --test _designlab/client-documents.test.mjs _designlab/client-documents.variants.test.mjs _designlab/client-package*.test.mjs`, sin fallas.");
    if (constancia) {
      push(`2. En el dashboard, emite una constancia de prueba eligiendo «${doc.label}» en «Plantilla de constancia».`,
        "3. Compárala con el «PDF de pruebas» de PDF Mapper: mismas posiciones y fuentes, y sin restos del texto de ejemplo de la plantilla.",
        "4. Escanea su QR: `validate.html` debe verificarla. Las constancias emitidas antes siguen validando y reimprimiéndose con su plantilla.");
    } else {
      push("2. Genera el documento desde su flujo y compáralo con el «PDF de pruebas» de PDF Mapper.");
    }
    push("");
  }

  push("## Código propuesto", "", "```js", code, "```", "");
  return lines.join("\n");
}
