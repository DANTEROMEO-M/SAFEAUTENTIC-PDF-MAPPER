import test from "node:test";
import assert from "node:assert/strict";
import { normalizeItem, groupTextRuns, paragraphOf, inferAlignment, fieldGeometryFromRuns, freeSpan,
  standardStyleOf, backgroundColorAround, inkColorInside, maskFromRuns, runCoverage, PAGE_MARGIN } from "../js/pdf-mapper/pdf-text.mjs";

/* Items como los entrega pdf.js: transform [a,b,c,d,e,f], (e,f) = línea base. */
const item = (str, x, y, size, width, fontName = "g_d0_f1") => ({ str, transform: [size, 0, 0, size, x, y], width, height: size, fontName });
const norm = (it, font = {}) => normalizeItem(it, { page: 0, view: [0, 0], font: { name: it.fontName, ...font } });

test("la fuente incrustada se traduce a la estándar más parecida", () => {
  assert.deepEqual(standardStyleOf("ABCDEF+TimesNewRomanPS-BoldMT"), { family: "TimesRoman", bold: true, italic: false, fontName: "TimesNewRomanPS-BoldMT" });
  assert.equal(standardStyleOf("Arial-ItalicMT").italic, true);
  assert.equal(standardStyleOf("Arial-ItalicMT").family, "Helvetica");
  assert.equal(standardStyleOf("CourierNewPSMT").family, "Courier");
  assert.equal(standardStyleOf("Montserrat-SemiBold").bold, true);
  assert.equal(standardStyleOf("g_d0_f2", { serif: true, bold: true }).family, "TimesRoman", "sin nombre útil, las banderas de pdf.js");
  assert.equal(standardStyleOf("OpenSans-Regular").family, "Helvetica", "«sans» nunca es serif");
});

test("los pedazos de un renglón se unen y las columnas y estilos distintos se separan", () => {
  const items = [
    norm(item("Otorga la presente a:", 72, 400, 12, 118), { name: "Arial" }),
    norm(item("JUAN", 300, 400, 18, 48), { name: "Arial-BoldMT" }),
    norm(item(" ", 348, 400, 18, 5), { name: "Arial-BoldMT" }),
    norm(item("PÉREZ", 353, 400, 18, 60), { name: "Arial-BoldMT" }),
    norm(item("Folio:", 72, 100, 9, 26), { name: "Arial" }),
    norm(item("A-0001", 400, 100, 9, 30), { name: "Arial" })
  ];
  const runs = groupTextRuns(items);
  assert.deepEqual(runs.map(r => r.text), ["Otorga la presente a:", "JUAN PÉREZ", "Folio:", "A-0001"]);
  const name = runs[1];
  assert.equal(name.x, 300); assert.equal(name.y, 400); assert.equal(name.width, 113); assert.equal(name.size, 18);
  assert.equal(name.bold, true);
  assert.deepEqual(name.box, { x0: 300, x1: 413, y0: 395.5, y1: 414.4 });
});

/* Casos reales de cartas exportadas de Word (PRUEBASCARTAS). */
test("la puntuación de cierre en otra fuente se queda con su renglón", () => {
  const runs = groupTextRuns([
    norm(item("indicada en el margen", 85, 211, 11, 109), { name: "TimesNewRomanPSMT" }),
    norm(item(",", 194, 211, 11, 3), { name: "ArialMT" }),
    norm(item(" así mismo", 202, 211, 11, 50), { name: "TimesNewRomanPSMT" }),
    norm(item("(número fijo/móvil)", 300, 150, 10, 90), { name: "TimesNewRomanPS-BoldMT" }),
    norm(item(".", 390, 150, 10, 2.5), { name: "TimesNewRomanPSMT" })
  ]);
  assert.deepEqual(runs.map(r => r.text), ["indicada en el margen, así mismo", "(número fijo/móvil)."]);
  assert.equal(runs[1].bold, true, "el renglón conserva el estilo de su texto");
});

test("versalitas de Word: la inicial grande y el resto chico son una palabra", () => {
  const bold = { name: "TimesNewRomanPS-BoldMT" };
  const runs = groupTextRuns([
    norm(item("R", 149.7, 380.7, 10, 7.2), bold), norm(item("ESPONSABLE", 156.9, 380.7, 8, 52.9), bold),
    norm(item(" ", 209.8, 380.7, 8, 4.7), bold), norm(item("SOLIDARIO", 214.5, 380.7, 8, 46), bold),
    norm(item(" ", 260.5, 380.7, 8, 4.8), bold),
    norm(item("con el obligado", 265.3, 380.7, 10, 70), { name: "TimesNewRomanPSMT" }),
    norm(item("1/", 300, 384, 4.8, 4), { name: "TimesNewRomanPSMT" })
  ]);
  /* «1/» va un poco más arriba (superíndice): se lee primero y sigue aparte. */
  assert.deepEqual(runs.map(r => r.text), ["1/", "RESPONSABLE SOLIDARIO", "con el obligado"]);
  assert.equal(runs[1].size, 10, "el cuerpo es el de la letra grande");
});

test("un «espacio» más ancho que dos cuerpos es una tabulación: separa columnas", () => {
  const runs = groupTextRuns([
    norm(item("Nombre", 172.8, 492, 10, 35.7)), norm(item(" ", 208.6, 492, 10, 107.7)),
    norm(item("Puesto", 316.3, 492, 10, 31.1)), norm(item(" ", 347.4, 492, 10, 86.9)), norm(item("Firma", 434.3, 492, 10, 25.7)),
    /* Un espacio de justificado (menos de dos cuerpos) sigue uniendo. */
    norm(item("texto", 72, 300, 10, 22)), norm(item(" ", 94, 300, 10, 14)), norm(item("justificado", 108, 300, 10, 45))
  ]);
  assert.deepEqual(runs.map(r => r.text), ["Nombre", "Puesto", "Firma", "texto justificado"]);
});

test("pdf.js parte palabras sin espacio: se inserta el espacio por el hueco", () => {
  const runs = groupTextRuns([norm(item("Primeros", 100, 300, 10, 40)), norm(item("Auxilios", 143, 300, 10, 36))]);
  assert.equal(runs[0].text, "Primeros Auxilios");
});

test("texto girado no se ofrece como renglón mapeable", () => {
  const rotated = normalizeItem({ str: "Sello", transform: [0, 10, -10, 0, 50, 50], width: 20, fontName: "f" });
  assert.equal(rotated.rotated, true);
  assert.equal(groupTextRuns([rotated]).length, 0);
});

test("párrafo: renglones apilados del mismo estilo; alineación inferida", () => {
  const runs = groupTextRuns([
    norm(item("Por haber concluido satisfactoriamente", 200, 300, 11, 212)),
    norm(item("el curso de Protección Civil", 236, 286, 11, 140)),
    norm(item("Título distinto", 200, 200, 20, 140))
  ]);
  const p = paragraphOf(runs, runs[1]);
  assert.deepEqual(p.map(r => r.text), ["Por haber concluido satisfactoriamente", "el curso de Protección Civil"]);
  assert.equal(inferAlignment(p, 612), "pageCenter", "ambos centros en 306");
  assert.equal(inferAlignment([runs[2]], 612), "left");
});

test("un dato centrado en la página se mapea con caja simétrica que crece hasta el obstáculo", () => {
  const runs = groupTextRuns([
    norm(item("Juan Pérez", 341, 335, 16, 110), { name: "TimesNewRomanPS-BoldMT" }),
    norm(item("Folio", 650, 335, 8, 20))
  ]);
  const g = fieldGeometryFromRuns([runs[0]], { pageWidth: 792, allRuns: runs });
  /* Centro de la hoja 396; a la derecha choca con «Folio» (650 − 4 = 646) → mitad 250. */
  assert.equal(g.align, "boxCenter");
  assert.equal(g.shrink, true, "un renglón no se parte: se reduce");
  assert.equal(g.fit, undefined);
  assert.equal(g.y, 335); assert.equal(g.size, 16);
  assert.equal(g.x + g.width / 2, 396);
  assert.equal(g.width, 500);
  /* pdf.js mide 1.8 pt de más: la caja sigue centrada en la hoja, no en la medida. */
  const wide = groupTextRuns([norm(item("Juan Pérez", 341, 335, 16, 111.8))]);
  const g2 = fieldGeometryFromRuns(wide, { pageWidth: 792 });
  assert.equal(g2.x + g2.width / 2, 396);
});

test("un dato a la izquierda crece hacia la derecha; un texto fijo conserva su sitio", () => {
  const runs = groupTextRuns([norm(item("Empresa Ejemplo", 239, 398, 12, 90))]);
  const data = fieldGeometryFromRuns(runs, { pageWidth: 792 });
  assert.deepEqual({ align: data.align, x: data.x, width: data.width }, { align: "left", x: 239, width: 792 - PAGE_MARGIN - 239 });
  const fixed = fieldGeometryFromRuns(runs, { pageWidth: 792, variable: false });
  assert.deepEqual(fixed, { size: 12, y: 398, align: "left", x: 239 });
});

test("varios renglones conservan su interlineado y número de líneas", () => {
  const runs = groupTextRuns([norm(item("Línea uno del texto", 72, 500, 10, 90)), norm(item("Línea dos", 72, 487, 10, 45))]);
  const g = fieldGeometryFromRuns(runs, { pageWidth: 612 });
  assert.equal(g.lineHeight, 13); assert.equal(g.maxLines, 2); assert.equal(g.y, 500);
});

test("el espacio libre se detiene en textos de la misma franja y en el margen", () => {
  const runs = groupTextRuns([norm(item("A:", 72, 300, 10, 12)), norm(item("valor", 120, 300, 10, 25)), norm(item("B", 400, 300, 10, 8)), norm(item("otra franja", 200, 250, 10, 40))]);
  const span = freeSpan(runs, runs[1].box, 612, { ignore: [runs[1]] });
  assert.deepEqual(span, { left: 88, right: 396 });
});

test("color del papel alrededor y de la tinta dentro de la caja", () => {
  /* Página de 10×10 pt a 1 px/pt: papel crema, texto azul en el centro. */
  const width = 10, height = 10, rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([250, 245, 230, 255], i * 4);
  for (let y = 4; y <= 6; y++) for (let x = 3; x <= 6; x++) rgba.set([20, 40, 160, 255], (y * width + x) * 4);
  const raster = { rgba, width, height, pageWidth: 10 };
  const box = { x0: 3, x1: 6, y0: 4, y1: 6 };
  assert.equal(backgroundColorAround(raster, 10, box, 2), "#faf5e6");
  assert.equal(inkColorInside(raster, 10, box), "#1428a0");
  assert.equal(backgroundColorAround(null, 10, box), "#ffffff");
});

test("la máscara de respaldo o el reemplazo real marca el renglón como usado", () => {
  const [run] = groupTextRuns([norm(item("JUAN PÉREZ", 300, 400, 18, 113))]);
  const mask = maskFromRuns([run], "#ffffff");
  assert.ok(mask.x < run.box.x0 && mask.x + mask.width > run.box.x1 && mask.y < run.box.y0 && mask.y + mask.height > run.box.y1);
  assert.deepEqual(runCoverage(run, [{ id: "nombre", mask }]), { covered: true, fieldId: "nombre" });
  assert.deepEqual(runCoverage(run, [{ id: "nombre", textReplacement: "p0-t0", source: { text: run.text, box: run.box } }]), { covered: true, fieldId: "nombre" });
  assert.deepEqual(runCoverage(run, [{ id: "otro", page: 1, mask }]), { covered: false, fieldId: null }, "otra página");
});

test("la caja del dato se detiene en un gráfico de la plantilla, no sólo en otro texto", async () => {
  const { narrowByInk } = await import("../js/pdf-mapper/pdf-text.mjs");
  /* Página 100×40 pt a 1 px/pt; un adorno vertical oscuro en x 10–12. */
  const width = 100, height = 40, gray = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < height; y++) for (let x = 10; x <= 12; x++) gray[y * width + x] = 20;
  const raster = { gray, width, height, pageWidth: 100 };
  const box = { x0: 40, x1: 60, y0: 15, y1: 25 };
  assert.deepEqual(narrowByInk(raster, 40, box, { left: 2, right: 98 }), { left: 18, right: 98 });
  assert.deepEqual(narrowByInk(null, 40, box, { left: 2, right: 98 }), { left: 2, right: 98 });
});

test("un texto centrado dentro de un sello se centra en el sello y no se sale", async () => {
  const { frameAround } = await import("../js/pdf-mapper/pdf-text.mjs");
  /* Sello de 100 pt con «AGOSTO» centrado; otro gráfico grande alrededor. */
  const seal = { x0: 600, x1: 700, y0: 150, y1: 250 };
  const sheet = { x0: 0, x1: 792, y0: 0, y1: 612 };
  const run = { page: 0, text: "AGOSTO", x: 622, y: 205, width: 56, size: 15, family: "TimesRoman", bold: true, italic: false,
    box: { x0: 622, x1: 678, y0: 201.25, y1: 217 } };
  assert.equal(frameAround(run.box, [sheet, seal]), seal, "el más chico que lo contiene y comparte centro");
  assert.equal(frameAround(run.box, [{ x0: 610, x1: 760, y0: 150, y1: 250 }]), null, "si no comparte centro no es su marco");
  for (const variable of [true, false]) {
    const geo = fieldGeometryFromRuns([run], { pageWidth: 792, variable, frames: [sheet, seal] });
    assert.equal(geo.align, "boxCenter");
    assert.equal(geo.x + geo.width / 2, 650, "centro del sello");
    assert.equal(geo.width, 80, "80 % del sello");
    assert.equal(geo.shrink, true, "un mes largo se reduce");
  }
  const free = fieldGeometryFromRuns([run], { pageWidth: 792, variable: false });
  assert.equal(free.align, "left", "sin gráfico, igual que antes");
});
