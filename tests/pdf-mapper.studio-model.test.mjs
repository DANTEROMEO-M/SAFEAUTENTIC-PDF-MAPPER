import test from "node:test";
import assert from "node:assert/strict";

import { buildStudioModel, parseDraft } from "../js/pdf-mapper/studio-model.mjs";

const discovered = [
  { id: "constancia", label: "Constancia CDMX", template: "plantilla_constancia.pdf", recognized: true },
  { id: "dc3", label: "DC-3", template: "plantilla_dc3.pdf", recognized: true },
  { id: "nuevo-catalogo", label: "Nuevo", template: "n.pdf", recognized: true },
  { id: "cartas-cdmx", label: "cartas-cdmx", template: null, recognized: false, refName: "CARTA_CDMX_DOCUMENT" }
];
const seedFields = { constancia: { fields: [{ id: "nombre", y: 335 }] }, dc3: { fields: [{ id: "curp", y: 559 }] } };

test("sin borrador: sólo el catálogo, sin inventar campos ni páginas", () => {
  const m = buildStudioModel({ discovered, draft: null });
  assert.deepEqual(m.templates.map(t => [t.id, t.local, t.fieldCount, t.pageCount]), [
    ["constancia", null, null, null], ["dc3", null, null, null], ["nuevo-catalogo", null, null, null]
  ]);
  assert.deepEqual(m.platform.map(p => p.id), ["cartas-cdmx"]);
  assert.deepEqual(m.inProgress, []);
});

test("con borrador: cambios frente al original, mapas locales e importados", () => {
  const draft = parseDraft(JSON.stringify({
    seedSnapshot: JSON.stringify(seedFields),
    docs: {
      constancia: { label: "Constancia CDMX", fields: [{ id: "nombre", y: 335 }], pageCount: 1 },
      dc3: { label: "DC-3", fields: [{ id: "curp", y: 559.34 }], pageCount: 1 },
      "nuevo-catalogo": { label: "Nuevo", fields: [] },
      "solicitud": { label: "Solicitud", template: "solicitud.pdf", fields: [{ id: "a" }, { id: "b" }], pageCount: 2 }
    }
  }));
  const m = buildStudioModel({ discovered, draft });
  assert.deepEqual(m.templates.map(t => [t.id, t.local, t.fieldCount]), [["constancia", "same", 1], ["dc3", "changed", 1], ["nuevo-catalogo", "draft", 0]]);
  assert.deepEqual(m.imported.map(i => [i.id, i.kind, i.fieldCount, i.pageCount]), [["solicitud", "imported", 2, 2]]);
  assert.deepEqual(m.inProgress.map(d => d.id), ["dc3", "nuevo-catalogo", "solicitud"]);
});

test("un documento de texto fluido con cambios en el modo «Bloques de texto» está en curso", () => {
  const draft = parseDraft(JSON.stringify({ seedSnapshot: "{}", docs: {}, flow: { "cartas-cdmx": { base: "{}", model: { pages: [] } } } }));
  const m = buildStudioModel({ discovered, draft });
  assert.deepEqual(m.platform.map(p => [p.id, p.local]), [["cartas-cdmx", "changed"]]);
  assert.deepEqual(m.inProgress.map(d => [d.id, d.kind]), [["cartas-cdmx", "platform"]]);
  assert.deepEqual(buildStudioModel({ discovered, draft: parseDraft(JSON.stringify({ seedSnapshot: "{}", docs: {} })) }).platform.map(p => p.local), [null]);
});

test("borrador ilegible o incompleto se ignora", () => {
  assert.equal(parseDraft("{no es json"), null);
  assert.equal(parseDraft(JSON.stringify({ seedSnapshot: "{}" })), null);
});
