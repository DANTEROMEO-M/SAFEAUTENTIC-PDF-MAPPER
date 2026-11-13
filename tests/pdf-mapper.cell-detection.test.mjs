import test from "node:test";
import assert from "node:assert/strict";

import { detectCharacterCells, bestCellRun, centeredBaseline, distributeCenters, toGrayscale } from "../js/pdf-mapper/cell-detection.mjs";

/* Página sintética en grises (255 = papel) con utilidades para dibujar los
 * mismos elementos que traen los formularios reales: líneas base, marcas
 * verticales, rectángulos y texto de etiqueta. */
function canvas(width, height) {
  const gray = new Uint8Array(width * height).fill(255);
  const fill = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) gray[y * width + x] = 0; };
  return { gray, width, height, fill,
    hLine: (x0, x1, y, t = 2) => fill(x0, y, x1, y + t),
    vLine: (x, y0, y1, t = 2) => fill(x, y0, x + t, y1),
    rect: (x0, y0, x1, y1, t = 2) => { fill(x0, y0, x1, y0 + t); fill(x0, y1 - t, x1, y1); fill(x0, y0, x0 + t, y1); fill(x1 - t, y0, x1, y1); }
  };
}
const centers = r => r.cells.map(c => c.center);

test("peine (línea base + marcas): una casilla entre cada par de marcas", () => {
  const c = canvas(400, 120);
  c.hLine(20, 380, 80);                        // línea base
  for (let x = 40; x <= 340; x += 30) c.vLine(x, 50, 80); // 11 marcas → 10 casillas
  const r = detectCharacterCells(c.gray, c.width, c.height, { x0: 10, x1: 390, y0: 20, y1: 110 }, 65);
  assert.equal(r.kind, "comb");
  assert.equal(r.cells.length, 10);
  assert.deepEqual(centers(r), [55.5, 85.5, 115.5, 145.5, 175.5, 205.5, 235.5, 265.5, 295.5, 325.5]);
  assert.ok(r.band.top >= 49 && r.band.top <= 51 && r.band.bottom === 79, "franja = altura de las marcas");
});

test("una línea de tabla por encima de la etiqueta no se confunde con el borde de la casilla", () => {
  const c = canvas(400, 140);
  c.hLine(0, 400, 20);                          // borde de la fila de la tabla
  c.fill(40, 30, 200, 40);                      // etiqueta ("Clave Única de Registro…") — no es línea
  c.hLine(20, 380, 90);
  for (let x = 40; x <= 340; x += 30) c.vLine(x, 60, 90);
  const r = detectCharacterCells(c.gray, c.width, c.height, { x0: 10, x1: 390, y0: 10, y1: 120 }, 75);
  assert.equal(r.kind, "comb");
  assert.equal(r.cells.length, 10);
});

test("casillas cerradas contiguas y casillas sueltas con separación", () => {
  const joined = canvas(300, 100);
  joined.hLine(20, 262, 30); joined.hLine(20, 262, 60);
  for (let x = 20; x <= 260; x += 30) joined.vLine(x, 30, 62);
  const a = detectCharacterCells(joined.gray, joined.width, joined.height, { x0: 5, x1: 295, y0: 10, y1: 90 }, 45);
  assert.equal(a.kind, "boxes");
  assert.equal(a.cells.length, 8);

  const separate = canvas(300, 100);
  for (let i = 0; i < 6; i++) separate.rect(20 + i * 40, 30, 20 + i * 40 + 32, 62); // 32 px de ancho, 8 px de hueco
  const b = detectCharacterCells(separate.gray, separate.width, separate.height, { x0: 5, x1: 295, y0: 10, y1: 90 }, 45);
  assert.equal(b.cells.length, 6, "los huecos entre casillas no cuentan como casillas");
  /* En índices de píxel: bordes en 20–21 y 50–51 → centro 35.5 (quien llama
   * suma medio píxel al pasar a puntos). */
  assert.deepEqual(centers(b), [35.5, 75.5, 115.5, 155.5, 195.5, 235.5]);
});

test("grupos de anchos distintos (fecha año/mes/día) se conservan", () => {
  const c = canvas(400, 100);
  c.hLine(20, 380, 70);
  [30, 60, 90, 120, 150, 190, 230, 270, 310].forEach(x => c.vLine(x, 45, 70)); // 4 de 30 px + 4 de 40 px
  const r = detectCharacterCells(c.gray, c.width, c.height, { x0: 10, x1: 390, y0: 20, y1: 90 }, 60);
  assert.equal(r.cells.length, 8);
});

test("sin marcas: no inventa casillas", () => {
  const c = canvas(300, 100);
  c.fill(40, 40, 200, 50); // sólo texto
  const r = detectCharacterCells(c.gray, c.width, c.height, { x0: 5, x1: 295, y0: 10, y1: 90 }, 45);
  assert.deepEqual(r.cells, []);
});

test("bestCellRun elige el tramo contiguo que mejor coincide y respeta la cantidad", () => {
  const cells = [10, 30, 50, 70, 90, 110].map(center => ({ center }));
  assert.deepEqual(bestCellRun(cells, [52, 71, 88]).map(c => c.center), [50, 70, 90]);
  assert.equal(bestCellRun(cells.slice(0, 2), [10, 30, 50]), null);
});

test("línea base centrada, distribución uniforme y conversión a grises", () => {
  assert.equal(centeredBaseline(555.5, 570, 6.32), 559.59);
  assert.deepEqual(distributeCenters(10, 40, 4), [10, 20, 30, 40]);
  assert.deepEqual(distributeCenters(10, 99, 1), [10]);
  /* píxel transparente = papel blanco; negro opaco = 0 */
  assert.deepEqual([...toGrayscale(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]), 2, 1)], [255, 0]);
});
