import test from "node:test";
import assert from "node:assert/strict";
import { buildPackage, readPackage, packagePaths, sha256Hex, PROJECT_SCHEMA } from "../js/pdf-mapper/project-package.mjs";

const bytes = s => new TextEncoder().encode(s);
const FONT = bytes("fuente-calibri"), OTHER = bytes("fuente-otra");
const doc = async () => ({
  id: "constancia-edomex", label: "Constancia Edomex", template: "constancia_edomex.pdf", renderer: null,
  page: { width: 720, height: 540 }, pageCount: 1, fonts: { regular: "Helvetica" },
  customFonts: {
    calibri: { family: "Calibri", fileName: "calibri.ttf", sha256: await sha256Hex(FONT) },
    otra: { family: "Otra", fileName: "otra.ttf", sha256: await sha256Hex(OTHER) }
  },
  templateEdits: [{ id: "p0-e8", action: "remove" }],
  sample: { record: { nombre: "Ana" } },
  fields: [{ id: "curso", type: "text", x: 1, y: 1, size: 18, fontKey: "regular", fontFile: "calibri", dataKey: "record.nombreCurso" }]
});
const base = async d => ({ doc: d, versions: [{ n: 1, status: "aprobada", fingerprint: "abcd1234" }], ui: { hidden: [], locked: [] }, fingerprint: "abcd1234",
  generatedAt: "2026-10-13T10:00:00Z", code: "/* render */", brief: "# IA", map: "{}", templateBytes: bytes("PDF-EDITADO"), originalBytes: bytes("PDF-ORIGINAL"),
  fontBytes: { [await sha256Hex(FONT)]: FONT, [await sha256Hex(OTHER)]: OTHER } });
const asFiles = entries => new Map(entries.map(e => [e.path, typeof e.data === "string" ? bytes(e.data) : e.data]));

test("el paquete refleja public/: plantilla y fuentes en config/client, el resto en tools/", async () => {
  const { entries, missing } = await buildPackage(await base(await doc()));
  assert.deepEqual(missing, []);
  assert.deepEqual(entries.map(e => e.path).sort(), [
    "config/client/assets/fonts/calibri.ttf",
    "config/client/templates/constancia_edomex.pdf",
    "tools/pdf-mapper/constancia-edomex/LEEME.md",
    "tools/pdf-mapper/constancia-edomex/ia.md",
    "tools/pdf-mapper/constancia-edomex/mapa.json",
    "tools/pdf-mapper/constancia-edomex/original.pdf",
    "tools/pdf-mapper/constancia-edomex/proyecto.json",
    "tools/pdf-mapper/constancia-edomex/render.js"
  ], "la fuente sin uso no viaja");
});

test("el proyecto se lee de vuelta idéntico, con la plantilla ORIGINAL y las fuentes verificadas", async () => {
  const d = await doc();
  const { entries } = await buildPackage(await base(d));
  const back = await readPackage(asFiles(entries));
  assert.deepEqual(back.problems, []);
  assert.deepEqual(back.doc, d);
  assert.equal(new TextDecoder().decode(back.originalBytes), "PDF-ORIGINAL", "las ediciones se rehacen sobre el original");
  assert.deepEqual(back.fonts.map(f => f.key), ["calibri"]);
  assert.equal(back.versions[0].status, "aprobada");
  assert.equal(back.fingerprint, "abcd1234");
});

test("sin ediciones, la plantilla del paquete es el original", async () => {
  const d = await doc(); delete d.templateEdits;
  const { entries } = await buildPackage({ ...(await base(d)), originalBytes: null });
  assert.ok(!entries.some(e => e.path.endsWith("original.pdf")));
  const back = await readPackage(asFiles(entries));
  assert.equal(new TextDecoder().decode(back.originalBytes), "PDF-EDITADO");
});

test("una edición de texto también incluye el original y permite reconstruir el proyecto", async () => {
  const d = await doc();
  delete d.templateEdits;
  d.textEdits = [{ id: "p0-t4", action: "removeText" }];
  const { entries } = await buildPackage(await base(d));
  assert.ok(entries.some(e => e.path.endsWith("original.pdf")));
  const back = await readPackage(asFiles(entries));
  assert.deepEqual(back.doc.textEdits, d.textEdits);
  assert.equal(new TextDecoder().decode(back.originalBytes), "PDF-ORIGINAL");
});

test("un archivo alterado o faltante se reporta; un ZIP ajeno se rechaza", async () => {
  const { entries } = await buildPackage(await base(await doc()));
  const files = asFiles(entries);
  files.set("config/client/assets/fonts/calibri.ttf", bytes("otra cosa"));
  files.delete("tools/pdf-mapper/constancia-edomex/original.pdf");
  const back = await readPackage(files);
  assert.deepEqual(back.problems, [
    "Falta tools/pdf-mapper/constancia-edomex/original.pdf.",
    "config/client/assets/fonts/calibri.ttf cambió después de exportarse (su huella no coincide)."
  ]);
  await assert.rejects(readPackage(new Map([["otro/archivo.txt", bytes("x")]])), /no trae un proyecto/);
  const bad = new Map([["tools/pdf-mapper/x/proyecto.json", bytes(JSON.stringify({ schema: "otro" }))]]);
  await assert.rejects(readPackage(bad), /no es un proyecto de PDF Mapper/);
});

test("lo que falta al armar el paquete se dice antes de descargarlo", async () => {
  const d = await doc();
  const { missing } = await buildPackage({ ...(await base(d)), templateBytes: null, originalBytes: null, fontBytes: {} });
  assert.deepEqual(missing, [
    "No se encontró la plantilla «constancia_edomex.pdf».",
    "No se encontró el PDF original: el proyecto no podrá volver a editar la plantilla.",
    "Falta el archivo de la fuente «Calibri» en este navegador."
  ]);
});

test("LEEME: cómo usarlo y la huella de cada archivo", async () => {
  const { entries, manifest } = await buildPackage(await base(await doc()));
  const readme = entries.find(e => e.path.endsWith("LEEME.md")).data;
  assert.match(readme, /Descomprime este ZIP en la carpeta `public\/`/);
  assert.match(readme, /\| `config\/client\/assets\/fonts\/calibri\.ttf` \| Fuente «Calibri» \| `[0-9a-f]{64}` \|/);
  assert.equal(manifest.schema, PROJECT_SCHEMA);
  assert.equal(packagePaths({ id: "x", template: "y.pdf" }).template, "config/client/templates/y.pdf");
});
