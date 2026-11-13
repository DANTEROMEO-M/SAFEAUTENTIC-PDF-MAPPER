import test from "node:test";
import assert from "node:assert/strict";

import { longExampleFor, stressValue } from "../js/pdf-mapper/data-catalog.mjs";

/* Juego «Textos largos» del PDF Mapper: el peor caso realista de cada dato
 * para que el preflight encuentre desbordes antes que un cliente real. */

test("textos largos: el catálogo da el peor caso, con el formato de cada documento", () => {
  assert.match(stressValue("record.nombre", "Juan Pérez", "constancia"), /^María Guadalupe .{20,}/);
  assert.equal(stressValue("data.record.razonSocial", "X", "carta"), longExampleFor("record.razonSocial"));
  assert.match(longExampleFor("record.fecha", "carta"), /^Estado de México, a /, "la fecha de la carta lleva el lugar");
  assert.doesNotMatch(longExampleFor("record.fecha", "constancia"), /Estado de México/);
});

test("textos largos: sin ejemplo en el catálogo se alarga el valor; códigos, fechas y números no", () => {
  const long = stressValue("record.lugarDelEvento", "Salón de usos múltiples", "nuevo");
  assert.ok(long.startsWith("Salón de usos múltiples ") && long.length >= "Salón de usos múltiples".length * 1.8);
  for (const fixed of ["DEMO-000123", "2026-01-01", "8", "PEJJ900101HDFRXN01", ""]) {
    assert.equal(stressValue("record.otro", fixed, "nuevo"), fixed);
  }
});
