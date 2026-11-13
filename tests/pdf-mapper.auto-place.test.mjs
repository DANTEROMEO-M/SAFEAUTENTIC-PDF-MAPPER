import test from "node:test";
import assert from "node:assert/strict";
import { detectHorizontalRules, proposeSignature, proposeSealBand, parsePdfFontName, matchLocalFont } from "../js/pdf-mapper/auto-place.mjs";

/* Página de 720×540 pt a 1 px/pt, en blanco, con lo que cada prueba dibuje. */
function page() {
  const width = 720, height = 540, gray = new Uint8Array(width * height).fill(255);
  const fill = (x0, x1, y0, y1, v = 0) => { for (let y = 540 - y1; y < 540 - y0; y++) for (let x = x0; x < x1; x++) gray[y * width + x] = v; };
  return { raster: { gray, width, height, pageWidth: 720 }, fill };
}
const run = (id, text, x, y, size, width) => ({ id, text, x, y, size, width, box: { x0: x, x1: x + width, y0: y - size * 0.25, y1: y + size * 0.8 } });

test("detecta la línea de firma y descarta texto y bloques gruesos", () => {
  const { raster, fill } = page();
  fill(280, 460, 99, 100);          // línea de firma de 1 pt en y≈100
  fill(100, 150, 300, 320);         // bloque grueso (logo): no es una raya
  fill(50, 90, 400, 401);           // raya corta (<60 pt)
  const rules = detectHorizontalRules(raster, 540);
  assert.deepEqual(rules.map(r => [r.x0, r.x1, r.y]), [[280, 460, 99.5]]);
});

test("firma: sobre la línea, con el nombre del firmante debajo y sin chocar con el texto de arriba", () => {
  const rules = [{ x0: 280, x1: 460, y: 99.5, thickness: 1 }, { x0: 0, x1: 720, y: 5, thickness: 1 }];
  const runs = [run("n", "Ing. Laura Gómez Ruiz", 310, 86, 11, 120), run("t", "Con una duración de 8 horas.", 260, 150, 12, 200)];
  const s = proposeSignature(rules, runs, { pageWidth: 720, pageHeight: 540 });
  assert.equal(s.x + s.width / 2, 370);
  assert.equal(s.y, 101);
  assert.ok(s.y + s.height <= 147, "se detiene antes del renglón de arriba");
  assert.match(s.reason, /Ing\. Laura Gómez Ruiz/);
});

test("firma sin línea: sobre el nombre del firmante; sin nada, no se inventa", () => {
  const runs = [run("n", "Lic. David Campos Rodríguez", 300, 56, 12, 142)];
  const s = proposeSignature([], runs, { pageWidth: 720, pageHeight: 540 });
  assert.ok(s && s.y > 56 + 12 * 0.8);
  assert.match(s.reason, /no se encontró línea/);
  assert.equal(proposeSignature([], [], { pageWidth: 720, pageHeight: 540 }), null);
});

test("sello digital: la franja libre más baja del pie, dentro del área imprimible", () => {
  const { raster, fill } = page();
  fill(0, 720, 0, 12);              // franja de color al pie (dentro del margen)
  fill(20, 260, 14, 40);            // logo abajo a la izquierda
  const band = proposeSealBand(raster, 540, { pageWidth: 720 });
  assert.ok(band.x >= 260, "a la derecha del logo");
  assert.ok(band.line2 >= 14.17 && band.line1 > band.line2);
  assert.ok(band.width >= 200);
  const full = page(); full.fill(0, 720, 0, 100);
  assert.equal(proposeSealBand(full.raster, 540, { pageWidth: 720 }), null, "sin franja libre no se propone");
});

test("nombres de fuente del PDF y su fuente instalada", () => {
  assert.deepEqual(parsePdfFontName("Calibri,Bold"), { family: "Calibri", bold: true, italic: false });
  assert.deepEqual(parsePdfFontName("ABCDEF+TimesNewRomanPS-BoldMT"), { family: "TimesNewRoman", bold: true, italic: false });
  assert.deepEqual(parsePdfFontName("Baskerville Old Face"), { family: "Baskerville Old Face", bold: false, italic: false });
  const local = [
    { family: "Calibri", fullName: "Calibri", postscriptName: "Calibri", style: "Regular" },
    { family: "Calibri", fullName: "Calibri Bold", postscriptName: "Calibri-Bold", style: "Bold" },
    { family: "Times New Roman", fullName: "Times New Roman Bold", postscriptName: "TimesNewRomanPS-BoldMT", style: "Bold" },
    { family: "Baskerville Old Face", fullName: "Baskerville Old Face", postscriptName: "BaskOldFace", style: "Regular" }
  ];
  assert.equal(matchLocalFont(local, "Calibri,Bold").postscriptName, "Calibri-Bold");
  assert.equal(matchLocalFont(local, "Calibri").postscriptName, "Calibri");
  assert.equal(matchLocalFont(local, "TimesNewRomanPS-BoldMT").fullName, "Times New Roman Bold");
  assert.equal(matchLocalFont(local, "Baskerville Old Face").postscriptName, "BaskOldFace");
  assert.equal(matchLocalFont(local, "Edwardian Script ITC"), null, "si no está instalada, no se adivina");
  assert.equal(matchLocalFont(local, "Calibri,Italic"), null, "una variante distinta no sirve");
});

test("firma sin línea: sube por encima de todo el bloque del firmante, sin tapar texto", () => {
  const runs = [run("r", "Número de Registro", 318, 68.9, 12, 99), run("n", "Ing. Israel González Bernal", 302, 54.5, 12, 131), run("t", "Con una duración de 8 horas.", 283, 161.6, 18, 236)];
  const s = proposeSignature([], runs, { pageWidth: 720, pageHeight: 540 });
  assert.ok(s.y >= 68.9 + 12 * 0.8, `la base (${s.y}) queda sobre «Número de Registro»`);
  assert.ok(s.y + s.height <= 161.6 - 18 * 0.25, "y bajo el renglón de arriba");
});

test("QR sin QR del cliente: el cuadro libre más grande abajo a la derecha, con zona silenciosa", async () => {
  const { proposeQrSpot } = await import("../js/pdf-mapper/auto-place.mjs");
  const { raster, fill } = page();
  fill(600, 720, 0, 100);           // logo abajo a la derecha
  fill(0, 720, 250, 270);           // franja a media página
  const q = proposeQrSpot(raster, 540, { pageWidth: 720 });
  assert.equal(q.width, 110);
  assert.ok(q.x + q.width <= 600 - 4 || q.y >= 100 + 4, "no toca el logo");
  assert.ok(q.y + q.height <= 250 - 4, "no toca la franja");
  assert.ok(q.x >= 360, "en la mitad derecha");
  const full = page(); full.fill(0, 720, 0, 540);
  assert.equal(proposeQrSpot(full.raster, 540, { pageWidth: 720 }), null);
});
