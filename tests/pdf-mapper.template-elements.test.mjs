import test from "node:test";
import assert from "node:assert/strict";
import { tokenize, findElements, applyEdits, placementMatrix, multiply, looksLikeQr, qrLikeness,
  findTextObjects, matchTextReplacement, matchTextReplacements, applyTextRemovals, cleanTemplate } from "../js/pdf-mapper/template-elements.mjs";

const enc = s => new TextEncoder().encode(s);
const dec = b => new TextDecoder("latin1").decode(b);
/* Contenido como el de Word: imágenes con su cm dentro de q … Q, texto,
 * una cadena con paréntesis escapados y una imagen en línea. */
const CONTENT = `q 720 0 0 540 0 0 cm /Im0 Do Q
BT /F1 12 Tf 72 400 Td (Texto \\(con\\) parentesis) Tj ET
q 127.44 0 0 124.68 561 70.2 cm /QR Do Q
q 1 0 0 1 100 100 cm /Fm1 Do Q
q 20 0 0 10 300 300 cm BI /W 2 /H 1 /CS /G /BPC 8 ID ÿ\u0000 EI Q
% comentario /Im9 Do
`;
const XOBJ = { Im0: { subtype: "Image" }, QR: { subtype: "Image", width: 485, height: 475 }, Fm1: { subtype: "Form", bbox: [0, 0, 50, 20], matrix: [2, 0, 0, 2, 0, 0] } };

test("lee las operaciones sin confundir cadenas, comentarios ni imágenes en línea", () => {
  const ops = tokenize(enc(CONTENT));
  assert.deepEqual(ops.filter(o => o.op === "Do").map(o => o.operands[0].value), ["Im0", "QR", "Fm1"], "el Do del comentario no cuenta");
  assert.equal(ops.find(o => o.op === "Tj").operands[0].raw, "(Texto \\(con\\) parentesis)");
  const bi = ops.find(o => o.op === "BI");
  assert.match(dec(enc(CONTENT).subarray(bi.start, bi.end)), /^BI .* EI$/s);
});

test("cada elemento con su caja en la página: imagen, formulario (BBox × Matrix) e imagen en línea", () => {
  const els = findElements(tokenize(enc(CONTENT)), XOBJ);
  assert.deepEqual(els.map(e => [e.id, e.kind, e.name]), [["p0-e0", "image", "Im0"], ["p0-e1", "image", "QR"], ["p0-e2", "form", "Fm1"], ["p0-e3", "inline", null]]);
  assert.deepEqual(els[1].box, { x0: 561, y0: 70.2, x1: 688.44, y1: 194.88 });
  assert.deepEqual(els[2].box, { x0: 100, y0: 100, x1: 200, y1: 140 });
  assert.deepEqual(els[3].box, { x0: 300, y0: 300, x1: 320, y1: 310 });
  assert.equal(looksLikeQr(els[1]), true);
  assert.equal(looksLikeQr(els[0]), false, "el fondo de página no es un QR");
});

test("quitar borra sólo la operación del elemento; el resto queda idéntico", () => {
  const bytes = enc(CONTENT), ops = tokenize(bytes), els = findElements(ops, XOBJ);
  const out = dec(applyEdits(bytes, ops, els, [{ id: "p0-e1", action: "remove" }]));
  assert.doesNotMatch(out, /\/QR Do/);
  assert.equal(out.replace(/\s+/g, " "), dec(enc(CONTENT.replace("/QR Do", ""))).replace(/\s+/g, " "));
  assert.equal(findElements(tokenize(enc(out)), XOBJ).length, 3);
  assert.equal(applyEdits(bytes, ops, els, []), bytes, "sin ediciones, los mismos bytes");
});

test("identifica una única cadena aislada por contenido y posición", () => {
  const bytes = enc("BT /F1 12 Tf 1 0 0 1 72 400 Tm (Nombre de prueba) Tj ET");
  const objects = findTextObjects(tokenize(bytes));
  assert.deepEqual(objects.map(({ id, text, x, y, safe }) => ({ id, text, x, y, safe })),
    [{ id: "p0-t0", text: "Nombre de prueba", x: 72, y: 400, safe: true }]);
  assert.deepEqual(matchTextReplacement(objects, { text: "Nombre de prueba", x: 72.5, y: 401 }), { ok: true, id: "p0-t0" });
  assert.deepEqual(matchTextReplacement(objects, { text: "Nombre de prueba", x: 80, y: 400 }), { ok: false, reason: "text-not-isolated" });
});

test("ubica texto con CMap no decodificado y fragmentado usando la caja de pdf.js", () => {
  const objects = [
    { id: "p0-t0", text: "þ", x: 72, y: 400, safe: true },
    { id: "p0-t1", text: "þþ", x: 91, y: 400, safe: true },
    { id: "p0-t2", text: "Vecino", x: 150, y: 400, safe: true }
  ];
  assert.deepEqual(matchTextReplacements(objects, [
    { text: "Se otorga", x: 72, y: 400, width: 48, size: 12 }
  ]), { ok: true, ids: ["p0-t0", "p0-t1"] });
  assert.deepEqual(matchTextReplacement(objects, { text: "Se otorga", x: 72, y: 400 }),
    { ok: false, reason: "text-not-isolated" }, "sin caja medible no debe inferir el alcance");
});

test("el operador que empieza justo donde termina el renglón es del vecino: no se retira", () => {
  /* Carta de Word: «RESPONSABLE SOLIDARIO» en negrita y, pegado, «con el obligado…». */
  const objects = [
    { id: "p0-t10", text: "þþ", x: 149.7, y: 380.7, safe: true },
    { id: "p0-t11", text: "þþþ", x: 214.5, y: 380.7, safe: true },
    { id: "p0-t12", text: "þþþþ", x: 265.3, y: 380.7, safe: true }
  ];
  assert.deepEqual(matchTextReplacements(objects, [{ text: "RESPONSABLE SOLIDARIO", x: 149.7, y: 380.7, width: 115.6, size: 10 }]),
    { ok: true, ids: ["p0-t10", "p0-t11"] });
});

test("retira sólo el operador que pinta el texto y conserva el estado gráfico del PDF", () => {
  const bytes = enc("BT /F1 12 Tf 1 0 0 1 72 400 Tm 0.2 g 1 Tr (Nombre) Tj ET");
  const objects = findTextObjects(tokenize(bytes));
  assert.equal(objects[0].safe, true);
  const output = dec(applyTextRemovals(bytes, objects, [objects[0].id]));
  assert.match(output, /0\.2 g 1 Tr/);
  assert.match(output, /BT .* ET/);
  assert.doesNotMatch(output, /\(Nombre\) Tj/);
});

test("rechaza texto duplicado; los pintados seguidos sin reposicionar forman un solo tramo", () => {
  const bytes = enc("BT /F1 12 Tf 1 0 0 1 72 400 Tm (Repetido) Tj ET\nBT /F1 12 Tf 1 0 0 1 72 400 Tm (Repetido) Tj ET\nBT /F1 12 Tf 1 0 0 1 72 300 Tm (Otro) Tj (texto) Tj ET");
  const objects = findTextObjects(tokenize(bytes));
  assert.deepEqual(matchTextReplacement(objects, { text: "Repetido", x: 72, y: 400 }), { ok: false, reason: "ambiguous-text" });
  assert.deepEqual(objects.slice(2).map(({ id, text, safe }) => ({ id, text, safe })), [{ id: "p0-t2.0", text: "Otrotexto", safe: true }]);
  const output = dec(applyTextRemovals(bytes, objects, ["p0-t2.0"]));
  assert.doesNotMatch(output, /\(Otro\)|\(texto\)/, "el tramo sale completo, no sólo su primer pintado");
});

test("un renglón de un párrafo de Word se retira sin tocar los otros renglones del mismo BT…ET", () => {
  const bytes = enc("BT /F1 12 Tf 14 TL 1 0 0 1 72 500 Tm [(Se ) -20 (otorga)] TJ 0 -14 Td (a JUAN PEREZ) Tj (, vecino) Tj T* (de la ciudad) Tj (Fin) ' ET");
  const objects = findTextObjects(tokenize(bytes));
  assert.deepEqual(objects.map(({ id, text, x, y }) => ({ id, text, x, y })), [
    { id: "p0-t0.0", text: "Se otorga", x: 72, y: 500 },
    { id: "p0-t0.1", text: "a JUAN PEREZ, vecino", x: 72, y: 486 },
    { id: "p0-t0.2", text: "de la ciudad", x: 72, y: 472 },
    { id: "p0-t0.3", text: "Fin", x: 72, y: 458 }
  ]);
  assert.deepEqual(matchTextReplacement(objects, { text: "a JUAN PEREZ, vecino", x: 72, y: 486 }), { ok: true, id: "p0-t0.1" });
  const output = dec(applyTextRemovals(bytes, objects, ["p0-t0.1"]));
  assert.doesNotMatch(output, /JUAN|vecino/);
  assert.match(output, /\(otorga\)\] TJ 0 -14 Td/);
  assert.match(output, /T\* \(de la ciudad\) Tj \(Fin\) ' ET/);
  /* Las posiciones de los renglones restantes no cambian. */
  assert.deepEqual(findTextObjects(tokenize(enc(output))).filter(o => o.text).map(({ text, y }) => [text, y]),
    [["Se otorga", 500], ["de la ciudad", 472], ["Fin", 458]]);
});

test("al retirar un tramo con ' o \" se conserva el salto de renglón y el espaciado", () => {
  const bytes = enc("BT /F1 12 Tf 14 TL 1 0 0 1 72 500 Tm (Uno) Tj (Dos) ' 2 1 (Tres) \" (Cuatro) ' ET");
  const objects = findTextObjects(tokenize(bytes));
  const output = dec(applyTextRemovals(bytes, objects, ["p0-t0.1", "p0-t0.2"]));
  assert.doesNotMatch(output, /Dos|Tres/);
  assert.match(output, /2 Tw 1 Tc T\*/);
  assert.deepEqual(findTextObjects(tokenize(enc(output))).filter(o => o.text).map(({ text, y }) => [text, y]),
    [["Uno", 500], ["Cuatro", 458]]);
});

test("un BT…ET de varios pintados con operadores no textuales sigue sin retirarse", () => {
  const objects = findTextObjects(tokenize(enc("BT /F1 12 Tf 1 0 0 1 72 400 Tm (A) Tj /Im1 Do (B) Tj ET")));
  assert.deepEqual(objects.map(({ id, safe }) => ({ id, safe })), [{ id: "p0-t0", safe: false }]);
});

test("no retira texto que participa en un trazado de recorte", () => {
  const objects = findTextObjects(tokenize(enc("BT /F1 12 Tf 7 Tr 1 0 0 1 72 400 Tm (Recorte) Tj ET")));
  assert.equal(objects[0].safe, false);
});

test("calcula el origen de texto cuando el operador de comilla avanza el renglón", () => {
  const objects = findTextObjects(tokenize(enc("BT /F1 12 Tf 14 TL 1 0 0 1 72 400 Tm (Siguiente) ' ET")));
  assert.equal(objects[0].y, 386);
  assert.equal(objects[0].text, "Siguiente");
});

test("decodifica escapes y elimina sólo el objeto BT…ET coincidente", () => {
  const bytes = enc("BT /F1 12 Tf 1 0 0 1 10 20 Tm (A \\(B\\)\\040C) Tj ET\nBT /F1 12 Tf 1 0 0 1 30 40 Tm <FEFF00440045> Tj ET");
  const objects = findTextObjects(tokenize(bytes));
  assert.equal(objects[0].text, "A (B) C");
  assert.equal(objects[1].text, "DE");
  const output = dec(applyTextRemovals(bytes, objects, [objects[0].id]));
  assert.equal(output.includes("A \\(B\\)"), false);
  assert.match(output, /<FEFF00440045>/);
  assert.equal(dec(applyTextRemovals(bytes, objects, ["missing"])), dec(bytes));
});

test("no elimina un objeto si su cadena no coincide exactamente", () => {
  const bytes = enc("BT /F1 12 Tf 1 0 0 1 72 400 Tm (Texto original) Tj ET");
  const objects = findTextObjects(tokenize(bytes));
  assert.deepEqual(matchTextReplacement(objects, { text: "Texto alternativo", x: 72, y: 400 }), { ok: false, reason: "text-not-isolated" });
});

test("cleanTemplate retira texto antes de aplicar cambios gráficos que alteran los offsets", async () => {
  class Name {
    constructor(value) { this.value = value; }
    static of(value) { return new Name(value); }
    asString() { return `/${this.value}`; }
  }
  class Stream {
    constructor(data) { this.data = data; }
    getContents() { return this.data; }
  }
  class RawStream extends Stream {}
  class PdfArray {}
  const xobjects = new Map();
  const goneRef = { dict: { lookup: name => name.value === "Subtype" ? new Name("Image") : null } };
  const keepRef = { dict: { lookup: name => name.value === "Subtype" ? new Name("Image") : null } };
  xobjects.set(new Name("Gone"), goneRef);
  xobjects.set(new Name("Keep"), keepRef);
  const xobjectDict = {
    entries: () => [...xobjects.entries()],
    delete: name => xobjects.delete(name)
  };
  let content = new RawStream(enc("q 10 0 0 10 0 0 cm /Gone Do Q\nBT /F1 12 Tf 1 0 0 1 72 400 Tm (TARGET) Tj ET\nq 10 0 0 10 20 0 cm /Keep Do Q"));
  const page = {
    node: {
      Contents: () => content,
      Resources: () => ({ lookup: name => name.value === "XObject" ? xobjectDict : null }),
      set: (_name, value) => { content = value; }
    }
  };
  const context = {
    lookup: value => value,
    register: value => value,
    flateStream: data => new RawStream(data),
    delete: () => {}
  };
  const pdfDoc = {
    getPages: () => [page],
    getPageCount: () => 1,
    context,
    save: async () => content.data
  };
  const lib = {
    PDFName: Name,
    PDFArray: PdfArray,
    PDFRawStream: RawStream,
    decodePDFRawStream: stream => ({ decode: () => stream.data }),
    PDFDocument: { load: async () => pdfDoc }
  };
  const result = dec(await cleanTemplate(lib, enc("original"), [
    { id: "p0-t0", action: "removeText" },
    { id: "p0-e0", action: "remove" }
  ]));
  assert.doesNotMatch(result, /Gone|TARGET/);
  assert.match(result, /Keep Do/);
});

test("mover y cambiar de tamaño: el elemento cae exactamente en la caja nueva", () => {
  const bytes = enc(CONTENT), ops = tokenize(bytes), els = findElements(ops, XOBJ);
  const target = { x0: 40, y0: 60, x1: 100, y1: 118.7 };
  const out = applyEdits(bytes, ops, els, [{ id: "p0-e1", action: "place", box: target }, { id: "p0-e2", action: "place", box: { x0: 500, y0: 10, x1: 550, y1: 30 } }]);
  const moved = findElements(tokenize(out), XOBJ);
  const near = (a, b) => Object.keys(b).every(k => Math.abs(a[k] - b[k]) < 0.02);
  assert.ok(near(moved[1].box, target), JSON.stringify(moved[1].box));
  assert.ok(near(moved[2].box, { x0: 500, y0: 10, x1: 550, y1: 30 }), JSON.stringify(moved[2].box));
  assert.equal(moved.length, 4);
});

test("la matriz de colocación cumple M × CTM = CTM × P", () => {
  const ctm = [0, 50, -40, 0, 300, 100]; // girado 90°
  const from = { x0: 260, y0: 100, x1: 300, y1: 150 }, to = { x0: 10, y0: 20, x1: 30, y1: 45 };
  const m = placementMatrix(ctm, from, to);
  const P = [0.5, 0, 0, 0.5, 10 - 260 * 0.5, 20 - 100 * 0.5];
  const a = multiply(m, ctm), b = multiply(ctm, P);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9));
});

test("píxeles de QR: negro y blanco puros; un logo de colores no pasa", () => {
  const width = 40, height = 20, gray = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) if ((x + y) % 2) gray[y * width + x] = 0;      // QR a la izquierda
  for (let y = 0; y < 20; y++) for (let x = 20; x < 40; x++) gray[y * width + x] = 120 + (x % 5) * 10;     // logo gris a la derecha
  const raster = { gray, width, height, pageWidth: 40 };
  assert.equal(qrLikeness(raster, 20, { x0: 0, y0: 0, x1: 19, y1: 19 }), true);
  assert.equal(qrLikeness(raster, 20, { x0: 21, y0: 0, x1: 39, y1: 19 }), false);
});
