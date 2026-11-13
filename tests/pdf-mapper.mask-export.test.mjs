import test from "node:test";
import * as engine from "../js/pdf-mapper/engine.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAiBrief } from "../js/pdf-mapper/ai-brief.mjs";

/* Las máscaras quedan como alternativa de compatibilidad para PDFs cuyo texto
* no se puede retirar con seguridad; los datos editor-only no se exportan. */

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const mapper = engine;

const doc = () => ({
  id: "constancia-acme", label: "Constancia ACME", template: "constancia_acme.pdf", renderer: null,
  page: { width: 792, height: 612 }, pageCount: 1, fonts: { regular: "Helvetica", bold: "HelveticaBold" },
  sample: { record: { nombre: "Ana López" } },
  fields: [
    { id: "nombre", type: "text", align: "boxCenter", x: 146, y: 335, width: 500, size: 16, fit: true, maxLines: 1, fontKey: "regular", bold: true, color: "black",
      dataKey: "record.nombre", source: { text: "JUAN PÉREZ" }, textReplacement: "p0-t0" },
    { id: "legacy", type: "text", align: "left", x: 300, y: 40, size: 9, fontKey: "regular", color: "black",
      dataKey: "record.legacy", replacementWarning: "text-not-isolated", mask: { x: 340, y: 330, width: 112, height: 19, colorHex: "#fffdf5" } },
    { id: "folio", type: "text", align: "left", x: 600, y: 40, size: 9, fontKey: "regular", color: "black", dataKey: "record.folio", maskOff: { x: 1, y: 1, width: 2, height: 2 } }
  ]
});

/* Ejecuta el código exportado con un pdf-lib simulado que registra el orden. */
async function runExport(d) {
  const code = mapper.buildNewDocumentExport(d);
  const calls = [];
  const page = {
    getSize: () => ({ width: 792, height: 612 }),
    drawRectangle: o => calls.push(["rect", o]),
    drawText: (t, o) => calls.push(["text", t, o])
  };
  const font = { widthOfTextAtSize: (t, s) => String(t).length * s * 0.5 };
  const pdfDoc = { getPages: () => [page], embedFont: async () => font };
  const pdfLib = { rgb: (r, g, b) => ({ r, g, b }), StandardFonts: { Helvetica: "Helvetica", HelveticaBold: "HelveticaBold" } };
  const clean = v => String(v ?? "").replace(/\s+/g, " ").trim();
  const drawFit = (pg, value, o) => pg.drawText(clean(value), o);
  const render = new Function("clean", "drawFit", "drawCharacters", "drawSignature", "embedImage",
    code + "\nreturn renderConstanciaAcme;")(clean, drawFit, () => {}, async () => {}, async () => null);
  await render({ page, pdfDoc, data: { record: { nombre: "Ana López", folio: "A-1" } }, pdfLib });
  return { code, calls };
}

test("la máscara de compatibilidad sigue dibujándose antes del campo de respaldo", async () => {
  const { calls } = await runExport(doc());
  assert.equal(calls[0][0], "rect");
  assert.deepEqual({ ...calls[0][1], color: { ...calls[0][1].color } }, { x: 340, y: 330, width: 112, height: 19, color: { r: 1, g: 253 / 255, b: 245 / 255 } });
  assert.deepEqual(calls.slice(1).map(c => c[0]), ["text", "text", "text"]);
  assert.deepEqual(calls.slice(1).map(c => c[1]), ["Ana López", "", "A-1"]);
});

test("sin parches el código exportado no cambia (no hay bucle de parches)", () => {
  const d = doc(); d.fields.forEach(f => delete f.mask);
  assert.doesNotMatch(mapper.buildNewDocumentExport(d), /drawRectangle\(\{ x: field\.mask/);
  assert.match(mapper.buildNewDocumentExport(doc()), /maskPage\.drawRectangle\(\{ x: field\.mask\.x/);
});

test("la referencia a texto retirado y los metadatos de edición no llegan al código", () => {
  const fields = doc().fields;
  fields[0].textReplacements = ["p0-t1", "p0-t2"];
  const literal = mapper.buildGenericFieldsLiteral(fields);
  assert.doesNotMatch(literal, /"source"|"maskOff"|"textReplacement"|"textReplacements"|"replacementWarning"|JUAN PÉREZ/);
  assert.match(literal, /"mask":\{"x":340/);
});

test("preflight: un parche fuera de la página se avisa", () => {
  const d = doc(); d.fields[1].mask.x = 780;
  const w = mapper.runPreflight(d).filter(x => x.fieldId === "legacy" && /parche/.test(x.message));
  assert.equal(w.length, 1);
  assert.equal(w[0].severity, "warn");
});

test("el paquete para IA distingue el texto retirado de las máscaras heredadas", () => {
  const d = doc();
  const brief = buildAiBrief({ doc: d, original: { fields: doc().fields.map(f => ({ ...f, source: { text: "otro" } })) },
    target: { file: "config/client/client.documents.mjs", functionName: "renderConstanciaAcme", isNew: true },
    fontName: () => "HelveticaBold", dataStatus: () => ({ status: "delivered" }), warnings: [], code: "", generatedAt: "2026-10-12" });
  assert.match(brief, /va en lugar del texto \\?"JUAN PÉREZ\\?" de la plantilla/);
  assert.match(brief, /tapa el texto original con un rectángulo #fffdf5 \(x 340, y 330, 112 × 19\)/);
  assert.match(brief, /Sin cambios: el código propuesto es equivalente al actual\./);
  assert.match(brief, /1 campo\(s\) tapan con un parche del color del papel: se ve tapado, pero el texto sigue dentro del PDF/);
});

test("el paquete para IA advierte cuando el ejemplo se conserva sin máscara", () => {
  const d = doc();
  d.fields.push({ id: "curso", type: "text", source: { text: "Curso de prueba" }, maskOff: { x: 1, y: 1, width: 10, height: 10 },
    replacementWarning: "text-not-isolated", dataKey: "record.curso" });
  const brief = buildAiBrief({ doc: d, original: null,
    target: { file: "config/client/client.documents.mjs", functionName: "renderConstanciaAcme", isNew: true },
    fontName: () => "Helvetica", dataStatus: () => ({ status: "delivered" }), warnings: [], code: "", generatedAt: "2026-10-12" });
  assert.match(brief, /1 campo\(s\) no pudieron retirar su texto original con seguridad y no aplican máscara automáticamente/);
});

test("un texto fijo que corrigió la plantilla va escrito en ella: el código ya no lo dibuja", async () => {
  const d = doc();
  d.fields.push(
    { id: "titulo", type: "text", align: "left", x: 72, y: 500, size: 12, fontKey: "regular", color: "black",
      literalText: "CARTA CORREGIDA", source: { text: "CARTA ORIGINAL" }, textReplacement: "p0-t5" },
    { id: "borrado", type: "text", align: "left", x: 72, y: 480, size: 12, fontKey: "regular", color: "black",
      literalText: "", source: { text: "Borrar esto" }, mask: { x: 70, y: 478, width: 90, height: 14, colorHex: "#ffffff" } },
    { id: "leyenda", type: "text", align: "left", x: 72, y: 460, size: 12, fontKey: "regular", color: "black", literalText: "Texto fijo nuevo" });
  assert.equal(mapper.isBakedText(d.fields.find(f => f.id === "titulo")), true);
  assert.equal(mapper.isBakedText(d.fields.find(f => f.id === "borrado")), true, "un texto borrado (y su máscara) también va en la plantilla");
  assert.equal(mapper.isBakedText(d.fields.find(f => f.id === "leyenda")), false, "un texto fijo agregado a mano lo sigue dibujando el código");
  assert.equal(mapper.isBakedText(d.fields.find(f => f.id === "nombre")), false, "un dato nunca va en la plantilla");
  const { code, calls } = await runExport(d);
  assert.doesNotMatch(code, /CARTA CORREGIDA|"borrado"/);
  assert.match(code, /Texto fijo nuevo/);
  assert.equal(calls.filter(c => c[0] === "rect" && c[1].x === 70).length, 0, "la máscara del texto borrado ya está en la plantilla");
  const brief = buildAiBrief({ doc: d, original: null,
    target: { file: "config/client/client.documents.mjs", functionName: "renderConstanciaAcme", isNew: true },
    fontName: () => "Helvetica", dataStatus: () => ({ status: "delivered" }), warnings: [], code, generatedAt: "2026-11-11" });
  assert.match(brief, /ya va escrito en la plantilla exportada; el código no lo dibuja/);
});
