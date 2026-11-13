/* OCR — textos de una plantilla escaneada (una imagen, sin capa de texto).
 *
 * pdf.js sólo lee texto vectorial: en un PDF escaneado o una foto no hay
 * renglones que elegir. El OCR corre en el navegador (tesseract.js) sobre la
 * página rasterizada y este módulo convierte sus palabras en los MISMOS
 * renglones que entrega pdf-text.mjs, para que sugerencias, mapeo automático
 * y creación de campos funcionen sin código aparte.
 *
 * Módulo puro: recibe las palabras ya reconocidas
 *   { text, confidence 0..100, bbox: {x0,y0,x1,y1}, baseline?: {x0,y0,x1,y1} }
 * en píxeles de la imagen (origen ARRIBA a la izquierda) y devuelve geometría
 * en puntos PDF con origen ABAJO a la izquierda ("y" = línea base).
 *
 * OCR no sabe la fuente: la familia queda Helvetica, sin negrita ni cursiva,
 * y el tamaño se estima por la altura de las letras. Cada renglón lleva
 * `source: "ocr"` y `confidence` (la peor de sus palabras) para que la
 * interfaz pida revisarlo. */

import { groupTextRuns } from "./pdf-text.mjs";

export const OCR_LANG = "spa";
/* Debajo de esto la palabra casi siempre es ruido (manchas, sellos, firmas). */
export const OCR_NOISE_CONFIDENCE = 30;
/* Debajo de esto el renglón se marca para revisión. */
export const OCR_REVIEW_CONFIDENCE = 75;

const ASCENDERS = /[A-ZÁÉÍÓÚÜÑ0-9bdfhiklt¿¡'"]/;
const DESCENDERS = /[gjpqyQ,;]/;
const ACCENTED_CAPS = /[ÁÉÍÓÚÜÑ]/;

/* Altura visible de una palabra en "cuerpos" de fuente (Helvetica): las
 * mayúsculas miden ~0.72, la x ~0.52, el acento de una mayúscula ~0.2 más
 * («PÉREZ») y los descendentes ~0.22 más. */
export function heightRatio(text) {
  const top = ACCENTED_CAPS.test(text) ? 0.92 : ASCENDERS.test(text) ? 0.72 : 0.52;
  return top + (DESCENDERS.test(text) ? 0.22 : 0);
}

/* Palabra de OCR → item como los de normalizeItem (pdf-text.mjs).
 * scale = píxeles por punto PDF de la imagen reconocida. */
export function ocrWordToItem(word, { page = 0, scale = 1, pageHeight }) {
  const text = String(word?.text ?? "").trim();
  const b = word?.bbox;
  if (!text || !b || !(scale > 0) || !(pageHeight > 0)) return null;
  const h = (b.y1 - b.y0) / scale;
  if (!(h > 0)) return null;
  const size = h / heightRatio(text);
  /* Línea base: la de Tesseract si es coherente con la caja; si no, el pie de
   * la caja menos el descendente. */
  const bl = word.baseline;
  const blPx = bl && Number.isFinite(bl.y0) && Number.isFinite(bl.y1) && bl.y0 >= b.y0 && bl.y0 <= b.y1 + 1
    ? (bl.y0 + bl.y1) / 2
    : b.y1 - (DESCENDERS.test(text) ? 0.22 * size * scale : 0);
  return {
    str: text, x: b.x0 / scale, y: pageHeight - blPx / scale,
    width: (b.x1 - b.x0) / scale, size, rotated: false, page,
    family: "Helvetica", bold: false, italic: false, fontName: ""
  };
}

const inside = (cx, cy, box) => cx >= box.x0 - 0.5 && cx <= box.x1 + 0.5 && cy >= box.y0 - 0.5 && cy <= box.y1 + 0.5;

/* Palabras → renglones de pdf-text con `source` y `confidence`. Se agrupan
 * con groupTextRuns (mismo criterio de renglón, columna y tamaño). */
export function ocrRuns(words, { page = 0, scale = 1, pageHeight } = {}) {
  const kept = (words || []).filter(w => (w?.confidence ?? 0) >= OCR_NOISE_CONFIDENCE)
    .map(w => ({ w, item: ocrWordToItem(w, { page, scale, pageHeight }) }))
    .filter(x => x.item);
  /* Una palabra sin mayúsculas ni ascendentes («a:», «con») sale con un
   * tamaño poco fiable y groupTextRuns la separaría de su renglón: cada
   * palabra toma la mediana de las palabras con ascendentes de su misma
   * línea base. */
  const lines = [];
  for (const x of [...kept].sort((p, q) => q.item.y - p.item.y)) {
    const line = lines.find(l => Math.abs(l.y - x.item.y) <= l.size * 0.3);
    if (line) line.members.push(x); else lines.push({ y: x.item.y, size: x.item.size, members: [x] });
  }
  for (const line of lines) {
    const tall = line.members.filter(({ item }) => ASCENDERS.test(item.str));
    const sizes = (tall.length ? tall : line.members).map(({ item }) => item.size).sort((p, q) => p - q);
    const size = sizes[Math.floor(sizes.length / 2)];
    for (const { item } of line.members) item.size = size;
  }
  const runs = groupTextRuns(kept.map(x => x.item), { page });
  return runs.map(run => {
    const mine = kept.filter(({ item }) => inside(item.x + item.width / 2, item.y + item.size * 0.2, run.box));
    const confidence = mine.length ? Math.round(Math.min(...mine.map(({ w }) => w.confidence))) : 0;
    return { ...run, id: `ocr-${run.id}`, source: "ocr", confidence, needsReview: confidence < OCR_REVIEW_CONFIDENCE };
  });
}

/* Imagen (foto o escaneo) → tamaño de página PDF. Si su proporción es la de
 * carta u oficio (vertical u horizontal) se usa ese tamaño; si no, la imagen
 * a 150 ppp. */
const PAPERS = [[612, 792], [612, 1008]];
export function pageSizeForImage(width, height) {
  if (!(width > 0) || !(height > 0)) return null;
  const landscape = width > height;
  const ratio = landscape ? width / height : height / width;
  for (const [w, h] of PAPERS) {
    if (Math.abs(ratio - h / w) <= 0.03) return landscape ? { width: h, height: w } : { width: w, height: h };
  }
  return { width: Math.round(width * 72 / 150 * 100) / 100, height: Math.round(height * 72 / 150 * 100) / 100 };
}
