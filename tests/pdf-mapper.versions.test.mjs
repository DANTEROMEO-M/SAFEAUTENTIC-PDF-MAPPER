import test from "node:test";
import * as engine from "../js/pdf-mapper/engine.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fingerprint, addVersion, versionState, restoreVersion, summarizeChecks, mapSnapshot, MAX_VERSIONS } from "../js/pdf-mapper/template-versions.mjs";
import { buildAiBrief } from "../js/pdf-mapper/ai-brief.mjs";

const doc = () => ({
  id: "constancia-acme", label: "Constancia ACME", template: "constancia_acme.pdf", page: { width: 792, height: 612 }, pageCount: 1,
  fonts: { regular: "Helvetica" }, sample: { record: { nombre: "Ana" } },
  fields: [{ id: "nombre", type: "text", align: "left", x: 100, y: 300, width: 300, size: 16, fontKey: "regular", color: "black", dataKey: "record.nombre", source: { text: "JUAN" } }]
});

test("la huella cambia con el mapa y no con los datos de muestra ni las ayudas del editor", () => {
  const a = doc(), b = doc();
  b.sample = { record: { nombre: "Otra persona" } };
  b.fields[0].source = { text: "otro" };
  b.fields[0].textReplacement = "p0-t0";
  b.fields[0].textReplacements = ["p0-t0", "p0-t1"];
  b.fields[0].group = "g";
  assert.equal(fingerprint(a), fingerprint(b));
  assert.deepEqual(mapSnapshot(b).fields[0].textReplacements, ["p0-t0", "p0-t1"], "el snapshot conserva las referencias a varios fragmentos de texto");
  b.fields[0].y = 301;
  assert.notEqual(fingerprint(a), fingerprint(b));
  assert.equal(fingerprint({ ...a, fields: [{ ...a.fields[0], dataKey: "record.nombre", x: 100 }] }), fingerprint(a), "el orden de las claves no importa");
  assert.equal(mapSnapshot(a).fields[0].source.text, "JUAN", "el snapshot conserva el enlace visual al texto de origen");
});

test("versiones: aprobar el mismo mapa no duplica; un cambio deja la aprobación atrás", () => {
  let list = addVersion([], doc(), { status: "borrador", now: "2026-10-12T10:00:00Z" });
  list = addVersion(list, doc(), { status: "aprobada", checks: [{ dataset: "Ejemplo", errors: 0, warnings: 0 }], now: "2026-10-12T11:00:00Z" });
  assert.equal(list.length, 1);
  assert.equal(list[0].status, "aprobada");
  assert.equal(list[0].approvedAt, "2026-10-12T11:00:00Z");
  let st = versionState(list, doc());
  assert.deepEqual([st.isApproved, st.changedSinceApproval], [true, false]);
  const moved = doc(); moved.fields[0].x = 120;
  st = versionState(list, moved);
  assert.deepEqual([st.isApproved, st.changedSinceApproval, st.approved.n], [false, true, 1]);
  list = addVersion(list, moved, { status: "borrador" });
  assert.deepEqual(list.map(v => [v.n, v.status]), [[1, "aprobada"], [2, "borrador"]]);
  /* Restaurar la aprobada devuelve su mapa y conserva los datos de muestra. */
  const back = restoreVersion(moved, list[0]);
  assert.equal(back.fields[0].x, 100);
  assert.deepEqual(back.sample, moved.sample);
  assert.equal(versionState(list, back).isApproved, true);
});

test("las versiones restauran las ediciones de texto junto con el mapa", () => {
  const d = doc();
  d.fields[0].textReplacement = "p0-t2";
  d.fields[0].source = { text: "JUAN", box: { x0: 90, x1: 130, y0: 296, y1: 312 } };
  d.textEdits = [{ id: "p0-t2", action: "removeText" }];
  const version = addVersion([], d)[0];
  const changed = { ...d, textEdits: [] };
  const restored = restoreVersion(changed, version);
  assert.deepEqual(restored.textEdits, d.textEdits);
  assert.equal(restored.fields[0].textReplacement, "p0-t2");
  assert.deepEqual(restored.fields[0].source, d.fields[0].source);
});

test("el límite de versiones nunca descarta la última aprobada", () => {
  let list = addVersion([], doc(), { status: "aprobada" });
  for (let i = 1; i <= MAX_VERSIONS + 5; i++) { const d = doc(); d.fields[0].x = 100 + i; list = addVersion(list, d, { status: "borrador" }); }
  assert.equal(list.length, MAX_VERSIONS);
  assert.equal(list[0].status, "aprobada");
  assert.equal(list[0].n, 1);
});

test("resumen de pruebas por juego de datos", () => {
  assert.deepEqual(summarizeChecks([{ dataset: "Textos largos", warnings: [{ severity: "warn", type: "overflow" }, { severity: "error", type: "off-page" }] }]),
    [{ dataset: "Textos largos", errors: 1, warnings: 1, overflow: 1 }]);
});

const brief = integration => buildAiBrief({ doc: doc(), original: null, code: "/* código */", generatedAt: "2026-10-12",
  target: { file: "config/client/client.documents.mjs", functionName: "renderConstanciaAcme", isNew: true },
  fontName: () => "Helvetica", dataStatus: p => ({ status: p === "record.nombre" ? "delivered" : "platform" }), warnings: [], integration });

test("paquete para IA de una constancia nueva: estado, pasos de integración y verificación", () => {
  const out = brief({ kind: "constancia", tracked: true, templateFile: "constancia_acme.pdf", templateSha256: "ab".repeat(32),
    registryLine: '"constancia-acme": { label: "Constancia ACME", template: "templates/constancia_acme.pdf", render: renderConstanciaAcme },',
    approval: { n: 3, fingerprint: "1a2b3c4d", approvedAt: "2026-10-12T11:00:00Z", checks: [{ dataset: "Ejemplo", errors: 0, warnings: 0 }, { dataset: "Textos largos", errors: 0, warnings: 1 }] } });
  assert.match(out, /\*\*Aprobada:\*\* versión 3 \(huella `1a2b3c4d`\), el 2026-10-12/);
  assert.match(out, /«Textos largos» sin errores, 1 aviso\(s\) revisados/);
  assert.match(out, /1\. \*\*Plantilla\.\*\* Copia el PDF del cliente a `config\/client\/templates\/constancia_acme\.pdf`\. Su SHA-256 es `(ab){32}`/);
  assert.match(out, /después de la entrada `constancia` \(la primera entrada es la plantilla predeterminada del generador\)/);
  assert.match(out, /"constancia-acme": \{ label: "Constancia ACME", template: "templates\/constancia_acme\.pdf", render: renderConstanciaAcme \},/);
  assert.match(out, /listClientDocumentVariants\("constancia"\)/);
  assert.match(out, /resolveClientDocumentVariant/);
  assert.match(out, /Todos los datos que usa ya llegan a este render/);
  assert.ok(out.indexOf("## Integración") < out.indexOf("## Código propuesto"));
});

test("un dato que la constancia no recibe trae la guía de dónde agregarlo", () => {
  const d = doc(); d.fields.push({ id: "instructor", type: "text", x: 1, y: 1, size: 9, fontKey: "regular", textTemplate: "Instructor: {record.instructor}" });
  const out = buildAiBrief({ doc: d, original: null, code: "", generatedAt: "2026-10-12",
    target: { file: "config/client/client.documents.mjs", functionName: "renderConstanciaAcme", isNew: true },
    fontName: () => "Helvetica", dataStatus: p => ({ status: p === "record.nombre" ? "delivered" : "platform" }), warnings: [],
    integration: { kind: "constancia", tracked: true, templateFile: "x.pdf", registryLine: "x", approval: null } });
  assert.match(out, /### Cómo hacer llegar un dato a la constancia/);
  assert.match(out, /`_emitirDocConstancia\(fields\)`: agrégalo a `payload`/);
  assert.match(out, /\*\*Sin aprobar\*\*/);
  assert.match(out, /ver «Cómo hacer llegar un dato a la constancia»/);
});

test("un documento que no es constancia avisa que el generador no lo ofrece; uno existente no lleva pasos", () => {
  const other = brief({ kind: "documento", tracked: true, templateFile: "x.pdf", registryLine: "x", approval: null });
  assert.match(other, /no es una constancia \(su ID no empieza con `constancia-`\)/);
  const existing = brief({ kind: null, tracked: false, approval: null });
  assert.doesNotMatch(existing, /## Integración|## Estado de la plantilla/);
});

/* Preflight ampliado (secciones puras de pdf-mapper.html). */
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const mapper = engine;

test("preflight: un texto sin ajuste que no cabe en su caja se avisa con arreglo", () => {
  const d = doc();
  d.fields[0] = { ...d.fields[0], width: 40, align: "boxCenter", dataKey: "record.nombre" };
  d.sample = { record: { nombre: "María Guadalupe Fernández" } };
  const w = mapper.runPreflight(d).find(x => x.type === "overflow");
  assert.ok(w, "sin aviso de desborde");
  assert.equal(w.fix.kind, "fitWidth");
});

test("preflight: un dato encima de un texto de la plantilla sin tapar se avisa; tapado, no", () => {
  const d = doc();
  const run = { id: "p0-0", page: 0, text: "Nombre de ejemplo", x: 100, y: 300, width: 120, size: 16, box: { x0: 100, x1: 220, y0: 296, y1: 312.8 } };
  const env = { pdfTextFor: () => [run] };
  const w = mapper.runPreflight(d, env).find(x => /se imprime encima de «Nombre de ejemplo»/.test(x.message));
  assert.ok(w);
  assert.deepEqual(w.fix.boxes, [run.box]);
  d.fields[0].mask = { x: 98, y: 294, width: 125, height: 20, colorHex: "#ffffff" };
  assert.ok(!mapper.runPreflight(d, env).some(x => /se imprime encima/.test(x.message)));
});

test("preflight ignora el texto original retirado, pero sigue reportando otro texto superpuesto", () => {
  const d = doc();
  const source = { id: "p0-0", page: 0, text: "JUAN", x: 100, y: 300, width: 120, size: 16, box: { x0: 100, x1: 220, y0: 296, y1: 312.8 } };
  d.fields[0] = { ...d.fields[0], textReplacement: "p0-t0", source: { text: "JUAN", box: source.box } };
  const env = { pdfTextFor: () => [source] };
  assert.ok(!mapper.runPreflight(d, env).some(x => /se imprime encima/.test(x.message)));
  env.pdfTextFor = () => [{ ...source, text: "OTRO" }];
  assert.ok(mapper.runPreflight(d, env).some(x => /se imprime encima de «OTRO»/.test(x.message)));
});

test("preflight: un dato de una línea que tendría que bajar a menos de la mitad avisa y ofrece 2 líneas", () => {
  const d = doc();
  d.fields[0] = { ...d.fields[0], shrink: true, width: 300, size: 18, align: "boxCenter" };
  d.sample = { record: { nombre: "Servicios Integrales de Mantenimiento Industrial y Comercial del Valle de Toluca" } };
  const w = mapper.runPreflight(d).find(x => x.type === "overflow");
  assert.equal(w.severity, "warn");
  assert.equal(w.fix.kind, "twoLines");
  d.sample = { record: { nombre: "Ana López" } };
  assert.ok(!mapper.runPreflight(d).some(x => x.type === "overflow"), "un dato que cabe no avisa");
});
