/* Eliminación real de texto de la plantilla (js/pdf-mapper/text-removal.mjs).
 * Contenidos de página sintéticos: lo que importa es que se quiten las letras
 * de la zona y que NINGUNA otra letra cambie de lugar. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../js/pdf-mapper/template-elements.mjs";
import { stringBytes, textShows, planTextRemoval, removeTextInBoxes, glyphsInBoxes } from "../js/pdf-mapper/text-removal.mjs";

const enc = s => new TextEncoder().encode(s);
const dec = b => new TextDecoder("latin1").decode(b);
const simple = { bytes: 1, width: () => 500, ascent: 800, descent: -200 };
const fonts = { F1: simple, F2: { bytes: 2, width: () => 1000, ascent: 800, descent: -200 } };
const glyphs = content => textShows(tokenize(content), fonts).flatMap(s => s.parts.filter(p => p.type === "str").flatMap(p => p.glyphs));
const text = content => glyphs(content).map(g => String.fromCharCode(g.code)).join("");
const at = g => g.center.map(v => v.toFixed(3)).join(",");
/* Zona que abarca las letras [from, to) de la página. */
const boxOver = (content, from, to) => {
  const gs = glyphs(content).slice(from, to);
  return { x0: Math.min(...gs.map(g => g.center[0])) - 0.1, x1: Math.max(...gs.map(g => g.center[0])) + 0.1,
    y0: Math.min(...gs.map(g => g.center[1])) - 0.1, y1: Math.max(...gs.map(g => g.center[1])) + 0.1 };
};
/* Quita y comprueba que lo demás quedó exactamente igual. */
function removeAndCheck(src, from, to) {
  const content = enc(src), box = boxOver(content, from, to);
  const before = glyphs(content), keep = before.filter((_, i) => i < from || i >= to);
  const { content: out, report } = removeTextInBoxes(content, fonts, [{ ...box, key: "z" }]);
  const after = glyphs(out);
  assert.deepEqual(after.map(at), keep.map(at), "las letras que quedan no se mueven");
  assert.deepEqual(after.map(g => g.code), keep.map(g => g.code));
  assert.equal(glyphsInBoxes(out, fonts, [box])[0], 0, "no queda ninguna letra en la zona");
  return { out, report: report.perBox[0] };
}

test("cadenas del contenido: escapes, octales, continuación de línea y hexadecimal", () => {
  assert.equal(dec(stringBytes({ type: "string", raw: "(a\\(b\\)c\\\\d)" })), "a(b)c\\d");
  assert.equal(dec(stringBytes({ type: "string", raw: "(\\101\\102C)" })), "ABC");
  assert.equal(dec(stringBytes({ type: "string", raw: "(uno\\\ndos)" })), "unodos");
  assert.deepEqual(Array.from(stringBytes({ type: "hex", raw: "<00 41 4>" })), [0, 0x41, 0x40]);
});

test("ubica cada letra con Td, Tf y los anchos de la fuente", () => {
  const gs = glyphs(enc("BT /F1 10 Tf 100 700 Td (AB) Tj ET"));
  assert.equal(gs.length, 2);
  assert.deepEqual(gs.map(g => g.center.map(v => +v.toFixed(2))), [[102.5, 703], [107.5, 703]]);
});

test("quitar una palabra completa no mueve lo que sigue en la misma línea", () => {
  const { out, report } = removeAndCheck("BT /F1 10 Tf 100 700 Td (Nombre) Tj ( fijo) Tj ET", 0, 6);
  assert.equal(report.removed, 6);
  assert.equal(report.partial, 0);
  assert.equal(text(out), " fijo");
});

test("quitar sólo una parte de una instrucción conserva la etiqueta fija", () => {
  const { out, report } = removeAndCheck("BT /F1 12 Tf 72 500 Td (Otorga a: Juan Perez) Tj ET", 10, 20);
  assert.equal(report.partial, 1);
  assert.equal(text(out), "Otorga a: ");
});

test("respeta TJ con ajustes, Tc, Tw y Tz", () => {
  removeAndCheck("BT /F1 11 Tf 2 Tc 3 Tw 90 Tz 50 400 Td [(Ana) -250 (Lopez Ruiz)] TJ (fin) Tj ET", 3, 9);
});

test("respeta ' y \" (siguiente línea con espaciados)", () => {
  removeAndCheck("BT /F1 10 Tf 14 TL 60 600 Td (linea uno) Tj (dos) ' 1 0.5 (tres) \" ET", 9, 12);
});

test("fuentes de 2 bytes (Identity-H)", () => {
  const { out } = removeAndCheck("BT /F2 9 Tf 30 300 Td <00410042004300440045> Tj ET", 1, 3);
  assert.equal(glyphs(out).length, 3);
});

test("respeta q/Q y cm entre instrucciones", () => {
  removeAndCheck("q 1 0 0 1 20 30 cm BT /F1 10 Tf 0 0 Td (dentro) Tj ET Q BT /F1 10 Tf 0 0 Td (fuera) Tj ET", 0, 6);
});

test("sin letras en la zona, el contenido queda idéntico byte por byte", () => {
  const content = enc("BT /F1 10 Tf 100 700 Td (Hola) Tj ET 0 0 m 10 10 l S");
  const { content: out, report } = removeTextInBoxes(content, fonts, [{ x0: 0, y0: 0, x1: 10, y1: 10, key: "vacia" }]);
  assert.equal(out, content);
  assert.equal(report.perBox[0].removed, 0);
});

test("una fuente sin métricas se marca como aproximada", () => {
  const plan = planTextRemoval(textShows(tokenize(enc("BT /FX 10 Tf 0 0 Td (abc) Tj ET")), fonts), [{ x0: -5, y0: -5, x1: 50, y1: 50 }]);
  assert.equal(plan.perBox[0].approx, true);
});
