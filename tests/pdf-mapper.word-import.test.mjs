/* «+ Importar» con un Word: la opción «Plantilla PDF» convierte el .docx en un
   PDF fijo con su texto tal cual (los «XXX» y ejemplos se quedan para
   vincularlos en el mapper). El PDF se traza con una pdf-lib falsa que
   registra lo dibujado. */
import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
const { wordToTemplatePdf } = await import("../js/pdf-mapper/letter-mode.mjs");

/* ZIP sin comprimir (método 0) con las partes dadas: basta para unzipDocx. */
function storedZip(files) {
  const enc = new TextEncoder(), chunks = [], central = [];
  let offset = 0;
  const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = enc.encode(name), data = enc.encode(text);
    const local = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0)];
    chunks.push(Uint8Array.from(local), nameBytes, data);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const count = Object.keys(files).length;
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(count), ...u16(count), ...u32(centralSize), ...u32(offset), ...u16(0)]);
  return Buffer.concat([...chunks, ...central, end]);
}
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const docx = body => storedZip({
  "[Content_Types].xml": "<Types/>",
  "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`
});
const para = text => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/* pdf-lib falsa: registra el texto dibujado; ★ no está en la fuente. */
function fakePdfLib() {
  const drawn = [];
  const font = { encodeText: ch => { if (ch === "★") throw new Error("no"); }, widthOfTextAtSize: (t, s) => t.length * s * 0.5, heightAtSize: s => s };
  const pdfLib = {
    StandardFonts: new Proxy({}, { get: (_, k) => k }),
    rgb: (r, g, b) => ({ r, g, b }),
    PDFDocument: { create: async () => ({
      embedFont: async () => font,
      addPage: size => ({ size, drawText: (text, o) => drawn.push({ text, y: o.y }), drawLine: () => {}, drawRectangle: () => {} }),
      save: async () => Uint8Array.from([37, 80, 68, 70])
    }) }
  };
  return { pdfLib, drawn };
}

test("Word → plantilla PDF: el texto sale tal cual, con sus datos marcados contados", async () => {
  const { pdfLib, drawn } = fakePdfLib();
  const result = await wordToTemplatePdf({ pdfLib, buffer: docx(para("Estimado XXX:") + para("Atentamente")) });
  assert.deepEqual([...result.bytes], [37, 80, 68, 70]);
  const text = drawn.map(d => d.text).join(" ");
  assert.match(text, /Estimado/);
  assert.match(text, /XXX/, "el marcador se conserva para vincularlo en el mapper");
  assert.match(text, /Atentamente/);
  assert.ok(result.findings >= 1, "«XXX» cuenta como dato por vincular");
  assert.deepEqual(result.notes, []);
});

test("Word → plantilla PDF: avisa los caracteres que la fuente no escribe", async () => {
  const { pdfLib } = fakePdfLib();
  const result = await wordToTemplatePdf({ pdfLib, buffer: docx(para("Calificación ★ final")) });
  assert.ok(result.notes.some(n => n.includes("★")));
});

test("Word sin texto o que no es .docx: error claro", async () => {
  const { pdfLib } = fakePdfLib();
  await assert.rejects(wordToTemplatePdf({ pdfLib, buffer: docx("") }), /no tiene texto/);
  await assert.rejects(wordToTemplatePdf({ pdfLib, buffer: Buffer.from("no es un zip") }), /no es un \.docx válido/);
});
