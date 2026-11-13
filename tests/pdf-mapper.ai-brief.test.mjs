import test from "node:test";
import assert from "node:assert/strict";

import { buildAiBrief, diffFields } from "../js/pdf-mapper/ai-brief.mjs";
import { classifyDataPath, exampleFor, DATA_GROUPS } from "../js/pdf-mapper/data-catalog.mjs";

const baseDoc = {
  id: "dc3", label: "DC-3", template: "plantilla_dc3.pdf", page: { width: 612, height: 792 }, pageCount: 1,
  fields: [
    { id: "nombre", type: "text", x: 33, y: 595, width: 530, size: 11, fontKey: "bold", fit: true, align: "left", dataKey: "record.nombre" },
    { id: "curp", type: "characters", y: 559, size: 8.8, fontKey: "bold", centers: [38, 52.25], dataKey: "record.curp", group: "g" }
  ]
};
const clone = v => JSON.parse(JSON.stringify(v));
const brief = (doc, extra = {}) => buildAiBrief({
  doc, original: baseDoc, target: { file: "config/client/client.documents.mjs", functionName: "renderDc3", isNew: false },
  fontName: () => "HelveticaBold",
  dataStatus: p => { const c = classifyDataPath(p, doc.id); return { status: c.status, label: c.entry?.label }; },
  warnings: [], code: "async function renderDc3() {}", generatedAt: "2026-09-24", ...extra
});

test("diffFields: cambios por propiedad, altas y bajas; ignora propiedades sólo del editor", () => {
  const cur = clone(baseDoc.fields);
  cur[1].centers = [31.5, 48.5]; cur[1].group = "otro";
  cur.push({ id: "folio", type: "text" });
  const d = diffFields(baseDoc.fields, cur.filter(f => f.id !== "nombre"));
  assert.deepEqual(d.changes, [{ id: "curp", prop: "centers", before: [38, 52.25], after: [31.5, 48.5] }]);
  assert.deepEqual(d.added, ["folio"]);
  assert.deepEqual(d.removed, ["nombre"]);
});

test("paquete: dice dónde aplicar, qué cambió y conserva el código", () => {
  const doc = clone(baseDoc); doc.fields[1].y = 559.34;
  const md = brief(doc);
  assert.match(md, /Aplícalo en `config\/client\/client\.documents\.mjs`, función `renderDc3`/);
  assert.match(md, /\| curp \| y \| 559 \| 559\.34 \|/);
  assert.match(md, /```js\nasync function renderDc3\(\) \{\}\n```/);
  assert.match(brief(clone(baseDoc)), /Sin cambios: el código propuesto es equivalente al actual\./);
});

test("paquete: clasifica los datos en entregados, existentes en la plataforma y nuevos", () => {
  const doc = clone(baseDoc);
  doc.fields.push({ id: "emisor", type: "text", dataKey: "profile.rfcEmisor" });
  doc.fields.push({ id: "cliente", type: "text", dataKey: "cliente.telefono" });
  doc.fields.push({ id: "temas", type: "text", textTemplate: "Temas: {record.temasCurso}" });
  const md = brief(doc);
  assert.match(md, /Ya los entrega la plataforma a este documento: `record\.nombre` \(Nombre del trabajador\), `record\.curp`/);
  assert.match(md, /Ya los entrega.*`profile\.rfcEmisor` \(RFC del emisor\)/, "DC-3 recibe el perfil del emisor");
  assert.match(md, /hay que pasarlos en `data`: `cliente\.telefono`/);
  assert.match(md, /NUEVOS — .*`record\.temasCurso`/);
});

test("catálogo: clasificación por documento y ejemplos realistas", () => {
  assert.equal(classifyDataPath("record.curp", "dc3").status, "delivered");
  assert.equal(classifyDataPath("record.curp", "constancia").status, "platform");
  assert.equal(classifyDataPath("qrImage", "constancia").status, "delivered");
  assert.equal(classifyDataPath("data.qrImage", "constancia").status, "delivered", "data.X se trata como X");
  assert.equal(classifyDataPath("record.logoPng", "dc3").status, "delivered", "alias heredado del render de DC-3");
  assert.equal(classifyDataPath("profile.rfcEmisor", "carta").status, "platform");
  assert.equal(classifyDataPath("qrImage", "carta").status, "platform");
  assert.equal(classifyDataPath("record.inventado", "dc3").status, "new");
  assert.equal(exampleFor("record.curp").length, 18);
  assert.equal(exampleFor("signaturePng"), null, "las imágenes no tienen ejemplo de texto");
  const paths = DATA_GROUPS.flatMap(g => g.paths.map(p => g.id + ":" + p.path));
  assert.equal(new Set(paths).size, paths.length, "sin claves repetidas dentro de un mismo grupo");
});
