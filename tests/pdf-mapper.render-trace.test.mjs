/* Documentos del ClientPackage leídos EJECUTANDO su renderer
 * (js/pdf-mapper/render-trace.mjs). Los renderers de aquí imitan los que se
 * escriben a mano en un client.documents.mjs: helpers propios, colores en
 * hex, fuentes por nombre, textos con prefijo, parches y casillas. Lo que el
 * editor recibe debe ser lo que el código dibuja. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { traceRender, fieldsFromTrace } from "../js/pdf-mapper/render-trace.mjs";

const clean = v => String(v ?? "").replace(/\s+/g, " ").trim();
function wrap(text, font, size, maxWidth) {
  const lines = []; let cur = "";
  for (const w of clean(text).split(" ").filter(Boolean)) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cur && font.widthOfTextAtSize(cand, size) > maxWidth) { lines.push(cur); cur = w; } else cur = cand;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
function drawFit(page, text, { x, y, width, size = 10, font, color, maxLines = 1, lineHeight = 11, center = false }) {
  const raw = clean(text); if (!raw) return;
  wrap(raw, font, size, width).slice(0, maxLines).forEach((line, i) => {
    let fs = size;
    while (fs > 6 && font.widthOfTextAtSize(line, fs) > width) fs -= 0.4;
    const dx = center ? x + (width - font.widthOfTextAtSize(line, fs)) / 2 : x;
    page.drawText(line, { x: dx, y: y - i * lineHeight, size: fs, font, color });
  });
}
function drawCharacters(page, value, centers, { y, size, font }) {
  const t = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, centers.length);
  centers.forEach((c, i) => { if (t[i]) page.drawText(t[i], { x: c - font.widthOfTextAtSize(t[i], size) / 2, y, size, font }); });
}
async function drawSignature(page, img, { x, y, width, height }) {
  if (!img) return;
  const k = Math.min(width / img.width, height / img.height);
  page.drawImage(img, { x: x + (width - img.width * k) / 2, y: y + (height - img.height * k) / 2, width: img.width * k, height: img.height * k });
}
const trace = async (render, size = { width: 720, height: 540 }) => fieldsFromTrace(await traceRender(render, size), { pageWidth: size.width });
const byId = (fields, id) => fields.find(f => f.id === id);

test("helper propio de una línea: caja centrada exacta, prefijo, mayúsculas, color y fuente", async () => {
  const { fields } = await trace(async ({ page, pdfDoc, data, pdfLib }) => {
    const record = data.record || data;
    const color = h => pdfLib.rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
    const line = async (text, { x, y, width, size, font, color: c }) => {
      const f = await pdfDoc.embedFont(pdfLib.StandardFonts[font]);
      const value = clean(text); let fs = size;
      while (fs > 6 && f.widthOfTextAtSize(value, fs) > width) fs -= 0.4;
      page.drawText(value, { x: x + (width - f.widthOfTextAtSize(value, fs)) / 2, y, size: fs, font: f, color: c });
    };
    await line(`A: ${record.nombre || ""}`, { x: 58.5, y: 341.98, width: 620.64, size: 28, font: "TimesRomanBold", color: color("#e60000") });
    await line(`“${clean(record.nombreCurso).toUpperCase()}”`, { x: 45.63, y: 275.78, width: 646.37, size: 14, font: "HelveticaBold", color: color("#000000") });
  });
  assert.deepEqual(byId(fields, "nombre"), { id: "nombre", type: "text", y: 341.98, size: 28, font: { family: "TimesRoman", bold: true, italic: false, standard: true },
    dataKey: "record.nombre", textTemplate: "A: {record.nombre}", colorHex: "#e60000", width: 620.64, x: 58.5, align: "boxCenter", shrink: true });
  const curso = byId(fields, "nombreCurso");
  assert.equal(curso.textTemplate, "“{record.nombreCurso}”");
  assert.equal(curso.textCase, "uppercase");
  assert.equal(curso.color, "black");
  assert.deepEqual([curso.x, curso.width], [45.63, 646.37]);
});

test("drawFit: renglones, interlineado y el recorte a un renglón", async () => {
  const { fields } = await trace(async ({ page, pdfDoc, data, pdfLib }) => {
    const record = data.record || data;
    const font = await pdfDoc.embedFont(pdfLib.StandardFonts.TimesRoman);
    drawFit(page, `A: ${record.nombre || ""}`, { x: 182.3, y: 352.97, width: 394.51, size: 28, font, maxLines: 2, lineHeight: 33.6, center: true });
    drawFit(page, `Con una duración de ${clean(record.duracion)} horas.`, { x: 244.61, y: 145.62, width: 313.9, size: 17, font, center: true });
    drawFit(page, record.instructor, { x: 56, y: 226, width: 150, size: 8.2, font, maxLines: 2, lineHeight: 8, center: true });
  });
  const nombre = byId(fields, "nombre");
  assert.deepEqual([nombre.x, nombre.width, nombre.align, nombre.fit, nombre.maxLines, nombre.lineHeight], [182.3, 394.51, "boxCenter", true, 2, 33.6]);
  const duracion = byId(fields, "duracion");
  assert.deepEqual([duracion.fit, duracion.maxLines, duracion.textTemplate], [true, 1, "Con una duración de {record.duracion} horas."]);
  assert.deepEqual([byId(fields, "instructor").maxLines, byId(fields, "instructor").lineHeight], [2, 8]);
});

test("texto fijo, centrado en la página y alineado a la izquierda", async () => {
  const { fields } = await trace(async ({ page, pdfDoc, data, pdfLib }) => {
    const font = await pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica);
    const name = data.record.nombre;
    page.drawText(name, { x: page.getSize().width / 2 - font.widthOfTextAtSize(name, 16) / 2, y: 335, size: 16, font });
    page.drawText("Por su participación en el curso de:", { x: 266.82, y: 295.24, size: 18, font });
  });
  assert.equal(byId(fields, "nombre").align, "pageCenter");
  const fijo = fields.find(f => f.literalText);
  assert.deepEqual([fijo.literalText, fijo.x, fijo.align], ["Por su participación en el curso de:", 266.82, "left"]);
});

test("QR con marco y leyenda, firma y logo: la caja donde el código los acomoda", async () => {
  const { fields } = await trace(async ({ page, pdfDoc, data, pdfLib }) => {
    const record = data.record || data;
    const font = await pdfDoc.embedFont(pdfLib.StandardFonts.TimesRomanBold);
    const qr = data.qrImage || record.qrPng;
    page.drawImage(qr, { x: 80.14, y: 279.63, width: 75, height: 75 });
    page.drawRectangle({ x: 77.14, y: 276.63, width: 81, height: 81, borderColor: pdfLib.rgb(0, 0, 0), borderWidth: 1 });
    page.drawText("Escanea para", { x: 80.14 + 37.5 - font.widthOfTextAtSize("Escanea para", 6) / 2, y: 359.63, size: 6, font });
    await drawSignature(page, data.signaturePng, { x: 265, y: 106.75, width: 200, height: 70 });
    const logo = data.logoPng;
    const k = Math.min(116 / logo.width, 58 / logo.height);
    page.drawImage(logo, { x: 32, y: 704 + (58 - logo.height * k) / 2, width: logo.width * k, height: logo.height * k });
  });
  const qr = byId(fields, "qr");
  assert.deepEqual([qr.x, qr.y, qr.width, qr.height], [80.14, 279.63, 75, 75]);
  assert.deepEqual(qr.frame, { enabled: true, width: 1, padding: 3, color: "black" });
  assert.equal(qr.captionTop.text, "Escanea para");
  assert.equal(qr.captionTop.offsetY, 5);
  const firma = byId(fields, "firma");
  assert.deepEqual([firma.x, firma.y, firma.width, firma.height, firma.hAlign], [265, 106.75, 200, 70, "center"]);
  const logo = byId(fields, "logoPng");
  assert.deepEqual([logo.x, logo.y, logo.width, logo.height, logo.hAlign], [32, 704, 116, 58, "left"]);
});

test("casillas: dos grupos seguidos en la misma línea son dos campos", async () => {
  const { fields } = await trace(async ({ page, pdfDoc, data, pdfLib }) => {
    const font = await pdfDoc.embedFont(pdfLib.StandardFonts.HelveticaBold);
    drawCharacters(page, data.record.fechaInicioDigits, [255, 271, 286.5, 302, 320.5, 341.5, 362.5, 383.5], { y: 367, size: 9.5, font });
    drawCharacters(page, data.record.fechaFinDigits, [425, 444.5, 464, 483.5, 503.5, 524.5, 545.5, 566.5], { y: 367, size: 9.5, font });
  }, { width: 612, height: 792 });
  assert.deepEqual(fields.map(f => [f.dataKey, f.centers.length, f.centers[0]]), [["record.fechaInicioDigits", 8, 255], ["record.fechaFinDigits", 8, 425]]);
});

test("parches blancos: el que queda bajo un dato es su parche; los demás no se pierden", async () => {
  const { fields } = await trace(async ({ page, pdfDoc, data, pdfLib }) => {
    const font = await pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica);
    const white = pdfLib.rgb(1, 1, 1);
    page.drawRectangle({ x: 22.27, y: 12.85, width: 111.41, height: 21.32, color: white });
    page.drawRectangle({ x: 300, y: 400, width: 50, height: 20, color: white });
    drawFit(page, `Folio:${clean(data.record.folio)}`, { x: 23.47, y: 18.55, width: 225.63, size: 18, font });
  });
  assert.deepEqual(byId(fields, "folio").mask, { x: 22.27, y: 12.85, width: 111.41, height: 21.32, colorHex: "#ffffff" });
  const parche = byId(fields, "parche");
  assert.equal(parche.literalText, "");
  assert.deepEqual(parche.mask, { x: 300, y: 400, width: 50, height: 20, colorHex: "#ffffff" });
});
