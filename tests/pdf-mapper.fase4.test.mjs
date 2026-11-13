import test from "node:test";
import * as engine from "../js/pdf-mapper/engine.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* Fase 4.3 — «Arreglar todo lo seguro»: sólo arreglos que no requieren
 * criterio, y «Usar 2 líneas» sólo si el párrafo no choca con nada. */
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const mapper = engine;

const field = (id, y, extra = {}) => ({ id, type: "text", align: "boxCenter", x: 160, y, width: 400, size: 18, shrink: true, fontKey: "regular", dataKey: "record." + id, ...extra });
const doc = fields => ({ id: "constancia-x", page: { width: 720, height: 540 }, pageCount: 1, fonts: { regular: "Helvetica" }, fields });
const w = (fieldId, kind, severity = "warn") => ({ fieldId, severity, message: "", fix: { kind, label: kind } });

test("sólo entran los arreglos sin criterio, uno por campo y tipo", () => {
  const d = doc([field("curso", 275), field("otro", 100)]);
  const plan = mapper.planSafeFixes(d, [w("curso", "twoLines"), w("curso", "twoLines"), w("otro", "intoPage"), w("otro", "qrBackground"), w("otro", "sample", "info"), w("fantasma", "size")]);
  assert.deepEqual(plan.map(x => `${x.fieldId}:${x.fix.kind}`), ["curso:twoLines", "otro:sample"]);
  assert.ok(!mapper.SAFE_FIX_KINDS.has("intoPage"), "mover nunca es automático");
  assert.ok(!mapper.SAFE_FIX_KINDS.has("mask"), "las máscaras quedan como alternativa explícita");
});

test("2 líneas no se aplica si el párrafo choca con otro campo", () => {
  const curso = field("curso", 275), fecha = field("fecha", 258, { size: 14 });
  assert.equal(mapper.twoLinesCollides(doc([curso, fecha]), curso), true);
  assert.equal(mapper.twoLinesCollides(doc([curso, field("lejos", 150)]), curso), false);
  assert.deepEqual(mapper.planSafeFixes(doc([curso, fecha]), [w("curso", "twoLines")]), []);
});

test("2 líneas no se aplica sobre texto de la plantilla sin tapar; tapado, sí", () => {
  const curso = field("curso", 275);
  const run = { id: "p0-1", text: "IMPARTIDO EN", box: { x0: 320, x1: 416, y0: 258, y1: 270 } };
  assert.equal(mapper.twoLinesCollides(doc([curso]), curso, [run]), true);
  const tapado = field("otro", 400, { mask: { x: 318, y: 256, width: 100, height: 16 } });
  assert.equal(mapper.twoLinesCollides(doc([curso, tapado]), curso, [run]), false);
});

/* Fase 4.4 — reubicar un mapeo y pasos guiados. */
import { planReanchor, fieldDataPath } from "../js/pdf-mapper/binding-suggest.mjs";
import { guidedSteps } from "../js/pdf-mapper/guided-steps.mjs";

test("reubicar: cada dato busca su texto equivalente; QR, firma y sello se recolocan; lo demás se revisa", () => {
  const src = [
    { id: "nombre", type: "text", textTemplate: "A: {record.nombre}", textCase: "uppercase" },
    { id: "curso", type: "text", dataKey: "record.nombreCurso" },
    { id: "instructor", type: "text", textTemplate: "Instructor: {record.instructor}" },
    { id: "leyenda", type: "text", literalText: "Válido en todo el país" },
    { id: "qr", type: "qr", dataKey: "qrImage" },
    { id: "firma", type: "image", dataKey: "signaturePng" },
    { id: "selloLinea1", type: "text", dataKey: "pki.line1" }
  ];
  const proposals = [{ path: "record.nombre", run: { id: "r1" } }, { path: "record.nombreCurso", run: { id: "r2" } }, { path: "record.fecha", run: { id: "r3" } }];
  const plan = planReanchor(src, proposals);
  assert.deepEqual(plan.matched.map(m => [m.field.id, m.proposal.run.id]), [["nombre", "r1"], ["curso", "r2"]]);
  assert.deepEqual(plan.placed.map(f => f.id), ["qr", "firma", "selloLinea1"]);
  assert.deepEqual(plan.review.map(f => f.id), ["instructor", "leyenda"]);
  assert.equal(fieldDataPath({ dataKey: "data.signaturePng" }), "signaturePng");
});

test("pasos guiados: el siguiente es el primer obligatorio sin hacer", () => {
  const status = [
    { concept: "participante", label: "Nombre del participante", required: true, done: true },
    { concept: "curso", label: "Nombre del curso", required: true, done: false },
    { concept: "qr", label: "Código QR de verificación", required: true, done: false },
    { concept: "sello", label: "Sello digital (2 líneas)", required: false, done: false }
  ];
  let g = guidedSteps({ constancia: true, status, fontsPending: ["Calibri"] });
  assert.equal(g.next.id, "datos");
  assert.equal(g.steps[1].detail, "Faltan: nombre del curso");
  assert.equal(g.steps[3].state, "optional", "las fuentes nunca bloquean");
  status[1].done = true;
  g = guidedSteps({ constancia: true, status });
  assert.equal(g.next.id, "elementos"); assert.equal(g.next.action, "qr");
  status[2].done = true;
  g = guidedSteps({ constancia: true, status });
  assert.equal(g.steps[2].state, "optional", "sin sello, recomendado pero no bloquea");
  assert.equal(g.next.id, "probar");
  g = guidedSteps({ constancia: true, status, approved: true, packaged: true });
  assert.equal(g.next, null); assert.equal(g.done, 5);
});

test("pasos guiados: mientras no se leen las fuentes, el paso no se marca hecho", () => {
  const g = guidedSteps({ constancia: false, fieldCount: 1, fontsPending: null });
  assert.equal(g.steps[3].state, "optional");
  assert.match(g.steps[3].detail, /Revisando/);
});
