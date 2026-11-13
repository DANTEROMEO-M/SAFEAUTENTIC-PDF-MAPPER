import test from "node:test";
import * as engine from "../js/pdf-mapper/engine.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAiBrief } from "../js/pdf-mapper/ai-brief.mjs";

/* Fuentes del cliente: un campo con fontFile se dibuja con el archivo de
 * config/client/assets/fonts/ incrustado con fontkit; los demás, con su
 * fuente estándar. El archivo se pide una sola vez por documento. */
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const mapper = engine;

const doc = () => ({
  id: "constancia-acme", label: "Constancia ACME", template: "constancia_acme.pdf", renderer: null,
  page: { width: 720, height: 540 }, pageCount: 1, fonts: { regular: "Helvetica", bold: "HelveticaBold" },
  customFonts: { "baskerville-old-face": { family: "Baskerville Old Face", fileName: "baskerville-old-face.ttf", sha256: "ab".repeat(32), fsType: 8 },
    "sin-usar": { family: "Otra", fileName: "otra.ttf", sha256: "cd".repeat(32) } },
  sample: {},
  fields: [
    { id: "nombre", type: "text", align: "boxCenter", x: 200, y: 330, width: 400, size: 28, shrink: true, fontKey: "regular", fontFile: "baskerville-old-face", color: "black", textTemplate: "A: {record.nombre}" },
    { id: "folio", type: "text", align: "left", x: 20, y: 18, size: 12, fontKey: "bold", color: "black", dataKey: "record.folio" },
    { id: "curso", type: "text", align: "left", x: 20, y: 200, size: 12, fontKey: "regular", fontFile: "baskerville-old-face", color: "black", dataKey: "record.nombreCurso" }
  ]
});

test("sólo las fuentes que usa algún campo se exportan, con su ruta en el ClientPackage", () => {
  assert.deepEqual(mapper.usedCustomFonts(doc()), { "baskerville-old-face": { url: "/config/client/assets/fonts/baskerville-old-face.ttf", subset: true } });
});

test("el código exportado incrusta la fuente del cliente una vez y usa la estándar en lo demás", async () => {
  const code = mapper.buildNewDocumentExport(doc());
  const calls = [], fetched = [], embedded = [];
  const custom = { widthOfTextAtSize: (t, s) => String(t).length * s * 0.4, name: "custom" };
  const std = { widthOfTextAtSize: (t, s) => String(t).length * s * 0.5, name: "std" };
  const page = { getSize: () => ({ width: 720, height: 540 }), drawText: (t, o) => calls.push([t, o.font.name, o.size]), drawRectangle: () => {} };
  const pdfDoc = { getPages: () => [page], registerFontkit: fk => calls.push(["fontkit", fk.id]),
    embedFont: async (src, opts) => { embedded.push(typeof src === "string" ? src : `bytes subset=${opts?.subset}`); return typeof src === "string" ? std : custom; } };
  const pdfLib = { rgb: () => ({}), StandardFonts: { Helvetica: "Helvetica", HelveticaBold: "HelveticaBold" } };
  globalThis.fontkit = { id: "fk" };
  globalThis.fetch = async url => { fetched.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; };
  try {
    const render = new Function("clean", "drawFit", "drawCharacters", "drawSignature", "embedImage", code + "\nreturn renderConstanciaAcme;")(
      v => String(v ?? "").replace(/\s+/g, " ").trim(), () => {}, () => {}, async () => {}, async () => null);
    await render({ page, pdfDoc, data: { record: { nombre: "Ana López", folio: "A-1", nombreCurso: "Brigadas" } }, pdfLib });
  } finally { delete globalThis.fontkit; delete globalThis.fetch; }
  assert.deepEqual(fetched, ["/config/client/assets/fonts/baskerville-old-face.ttf"]);
  assert.deepEqual(embedded, ["bytes subset=true", "HelveticaBold"]);
  assert.deepEqual(calls.filter(c => c[0] !== "fontkit").map(c => [c[0], c[1]]), [["A: Ana López", "custom"], ["A-1", "std"], ["Brigadas", "custom"]]);
});

test("sin fuentes del cliente el código exportado no cambia", () => {
  const d = doc(); d.fields.forEach(f => delete f.fontFile);
  const code = mapper.buildNewDocumentExport(d);
  assert.doesNotMatch(code, /fontkit|customFontFiles/);
});

test("una fuente del cliente que ya no está en el documento se avisa", () => {
  const d = doc(); delete d.customFonts["baskerville-old-face"];
  assert.ok(mapper.runPreflight(d).some(w => w.fieldId === "nombre" && /fuente del cliente que ya no está/.test(w.message)));
});

test("el paquete para IA lista la fuente, su ruta y su huella, y la pide en la integración", () => {
  const out = buildAiBrief({ doc: doc(), original: null, code: "", generatedAt: "2026-10-13",
    target: { file: "config/client/client.documents.mjs", functionName: "renderConstanciaAcme", isNew: true },
    fontName: f => (f.fontFile ? "Baskerville Old Face (fuente del cliente)" : "Helvetica"), dataStatus: () => ({ status: "delivered" }), warnings: [],
    integration: { kind: "constancia", tracked: true, templateFile: "constancia_acme.pdf", registryLine: "x", approval: null } });
  assert.match(out, /«Baskerville Old Face» → `config\/client\/assets\/fonts\/baskerville-old-face\.ttf` \(SHA-256 `(ab){32}`\)/);
  assert.match(out, /1b\. \*\*Fuentes\.\*\* Copia `baskerville-old-face\.ttf`/);
  assert.doesNotMatch(out, /otra\.ttf/, "una fuente sin uso no se pide");
  assert.match(out, /Baskerville Old Face \(fuente del cliente\)/);
});

test("licencia de la fuente: fontkit entrega banderas; un número crudo se lee igual", () => {
  const ui = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const src = ui.match(/function fontLicense\(raw\) \{[\s\S]*?\n\}/)[0];
  const fontLicense = new Function(src + "; return fontLicense;")();
  assert.equal(fontLicense({ noEmbedding: true, viewOnly: false, editable: false }).restricted, true);
  assert.equal(fontLicense(0x0002).restricted, true, "fsType 2 = restringida");
  assert.equal(fontLicense({ editable: true }).restricted, false);
  assert.equal(fontLicense(0x0004).restricted, false, "ver e imprimir se puede incrustar");
  assert.equal(fontLicense(0x0000).restricted, false, "instalable");
  assert.equal(fontLicense(0x0208).bitmapOnly, true);
  assert.equal(fontLicense({ noSubsetting: true, editable: true }).noSubsetting, true);
});
