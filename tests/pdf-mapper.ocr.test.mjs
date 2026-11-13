import test from "node:test";
import assert from "node:assert/strict";
import { ocrWordToItem, ocrRuns, heightRatio, pageSizeForImage, OCR_REVIEW_CONFIDENCE } from "../js/pdf-mapper/ocr.mjs";

/* Palabras como las entrega tesseract.js: píxeles, origen arriba-izquierda.
 * Imagen carta a escala 2 (1224×1584 px). */
const SCALE = 2, PAGE_H = 792;
const word = (text, x0, top, w, h, confidence = 95, baseline) => ({ text, confidence, bbox: { x0, y0: top, x1: x0 + w, y1: top + h }, baseline });

test("una palabra se convierte a puntos PDF con origen abajo y línea base", () => {
  /* «JUAN» de 12 pt: mayúsculas ≈ 0.72 cuerpo = 8.64 pt = 17.28 px. */
  const it = ocrWordToItem(word("JUAN", 200, 800, 80, 17.28), { scale: SCALE, pageHeight: PAGE_H });
  assert.equal(it.str, "JUAN");
  assert.equal(it.x, 100);
  assert.ok(Math.abs(it.size - 12) < 0.01);
  assert.ok(Math.abs(it.y - (PAGE_H - (800 + 17.28) / SCALE)) < 0.01, "sin descendentes la base es el pie de la caja");
  assert.equal(it.family, "Helvetica");
  assert.equal(it.rotated, false);
});

test("los descendentes no inflan el tamaño ni bajan la línea base", () => {
  assert.ok(heightRatio("gestión") > heightRatio("JUAN"));
  const plain = ocrWordToItem(word("JUAN", 200, 800, 80, 17.28), { scale: SCALE, pageHeight: PAGE_H });
  /* «Pégy»: mayúscula + descendente = 0.94 cuerpo a 12 pt = 22.56 px. */
  const desc = ocrWordToItem(word("Pégy", 300, 800, 60, 22.56), { scale: SCALE, pageHeight: PAGE_H });
  assert.ok(Math.abs(desc.size - plain.size) < 0.01);
  assert.ok(Math.abs(desc.y - plain.y) < 0.01);
  /* «PÉREZ»: el acento sube la caja ~0.2 cuerpo sobre la mayúscula. */
  const accent = ocrWordToItem(word("PÉREZ", 400, 795.2, 80, 22.08), { scale: SCALE, pageHeight: PAGE_H });
  assert.ok(Math.abs(accent.size - plain.size) < 0.01, "el acento no infla el tamaño");
});

test("la línea base de Tesseract se usa cuando es coherente con la caja", () => {
  const it = ocrWordToItem(word("Hola", 0, 100, 40, 20, 90, { x0: 0, y0: 116, x1: 40, y1: 116 }), { scale: 1, pageHeight: 500 });
  assert.equal(it.y, 384);
  const bad = ocrWordToItem(word("Hola", 0, 100, 40, 20, 90, { x0: 0, y0: 900, x1: 40, y1: 900 }), { scale: 1, pageHeight: 500 });
  assert.equal(bad.y, 380, "una base fuera de la caja se ignora");
});

test("palabras de un renglón forman un run con confianza y revisión", () => {
  const words = [
    word("Otorga", 144, 800, 70, 17.28, 96),
    word("a:", 222, 800, 20, 17.28, 91),
    word("JUAN", 600, 800, 60, 17.28, 88),
    word("PÉREZ", 668, 800, 70, 17.28, 62),
    word("~", 900, 1200, 10, 10, 12)
  ];
  const runs = ocrRuns(words, { page: 0, scale: SCALE, pageHeight: PAGE_H });
  assert.deepEqual(runs.map(r => r.text), ["Otorga a:", "JUAN PÉREZ"], "el ruido se descarta y la columna se separa");
  assert.ok(runs.every(r => r.source === "ocr" && r.id.startsWith("ocr-p0-")));
  assert.equal(runs[0].confidence, 91);
  assert.equal(runs[0].needsReview, false);
  assert.equal(runs[1].confidence, 62);
  assert.equal(runs[1].needsReview, 62 < OCR_REVIEW_CONFIDENCE);
  assert.ok(runs[1].box.x1 > runs[1].box.x0 && runs[1].box.y1 > runs[1].box.y0);
});

test("sin palabras útiles no hay renglones", () => {
  assert.deepEqual(ocrRuns([], { scale: 2, pageHeight: 792 }), []);
  assert.deepEqual(ocrRuns([word("", 0, 0, 10, 10)], { scale: 2, pageHeight: 792 }), []);
  assert.equal(ocrWordToItem(word("x", 0, 0, 10, 10), { scale: 0, pageHeight: 792 }), null);
});

test("una imagen toma tamaño carta u oficio si su proporción coincide", () => {
  assert.deepEqual(pageSizeForImage(2550, 3300), { width: 612, height: 792 });
  assert.deepEqual(pageSizeForImage(3300, 2550), { width: 792, height: 612 });
  assert.deepEqual(pageSizeForImage(2550, 4200), { width: 612, height: 1008 });
  assert.deepEqual(pageSizeForImage(1500, 1500), { width: 720, height: 720 }, "otra proporción: la imagen a 150 ppp");
  assert.equal(pageSizeForImage(0, 10), null);
});
