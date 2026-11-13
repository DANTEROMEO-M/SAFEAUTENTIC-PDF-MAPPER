/* PDF de una redacción (contrato `safeautentic.redaccion`, doc-editor.mjs).
 *
 * El editor de clientes imprime con el navegador; este módulo dibuja el mismo
 * contenido con pdf-lib, con las medidas de la hoja del editor
 * (doc-editor.css): márgenes, tamaños, títulos en em, sangría de 36 pt,
 * listas a 24 pt, interlineado por bloque, justificado, bloque de firmas,
 * tablas (v3; una fila nunca se parte y el encabezado se repite) y casillas.
 * Puede dibujar sobre una página de fondo (el membrete de una carta) y dentro
 * de una caja de cuerpo distinta de los márgenes.
 *
 * `layoutRedaccion` es puro (recibe una función de medida) y devuelve lo que
 * se dibuja en cada página; `renderRedaccionPdf` lo dibuja. Fuentes estándar
 * de PDF: un carácter que no codifican se sustituye por «?» y se reporta. */

import { normalizeContent, isSignatureBlock, isTableBlock, PAGE_SIZES, MARGINS, INDENT_STEP_PT } from "./doc-editor.mjs?v=20261101.1";

export const PDF_FONTS = Object.freeze({
  sans: Object.freeze(["Helvetica", "HelveticaBold", "HelveticaOblique", "HelveticaBoldOblique"]),
  serif: Object.freeze(["TimesRoman", "TimesRomanBold", "TimesRomanItalic", "TimesRomanBoldItalic"]),
  mono: Object.freeze(["Courier", "CourierBold", "CourierOblique", "CourierBoldOblique"])
});
export const fontKey = (family, bold, italic) => PDF_FONTS[family]?.[(bold ? 1 : 0) + (italic ? 2 : 0)] || PDF_FONTS.sans[0];

/* Como doc-editor.css. */
const HEADING_SCALE = { h1: 1.6, h2: 1.3, h3: 1.1 };
const LIST_PAD = 24;
const ASCENT = 0.78;
const SIG = { space: 44, rulePad: 4, lineHeight: 1.25, gap: { 1: 0, 2: 28, 3: 18 }, after: 10, before: 4, single: 0.58 };
const TBL = { padX: 4, padY: 2, before: 4, after: 6, lh: 1.15 };

/* Caja de cuerpo por defecto: la hoja menos sus márgenes. */
export function pageBox(page) {
  const size = PAGE_SIZES[page.size], margin = MARGINS[page.margin];
  return { width: size.width, height: size.height, x0: margin, x1: size.width - margin, top: size.height - margin, bottom: margin };
}

/* Fragmentos de un bloque: palabras y espacios con su formato; un «\n» es
 * un salto forzado. */
function pieces(runs, page, scale, heading) {
  const out = [];
  for (const run of runs) {
    const style = { font: fontKey(run.font || page.font, run.b || heading, run.i), size: (run.size || page.fontSize) * scale, u: !!run.u };
    for (const part of run.text.split(/(\n| +)/)) {
      if (!part) continue;
      out.push(part === "\n" ? { br: true, ...style } : { text: part, space: part[0] === " ", ...style });
    }
  }
  return out;
}

/* Renglones de un texto en un ancho; cada renglón son segmentos con x
 * relativa al inicio del renglón. */
function wrap(parts, width, measure, baseSize) {
  const lines = [];
  let line = [], x = 0;
  const flush = (forced) => {
    while (line.length && line[line.length - 1].space) { x -= line.pop().w; }
    const size = line.reduce((m, s) => Math.max(m, s.size), 0) || baseSize;
    lines.push({ segs: line, width: x, size, forced });
    line = []; x = 0;
  };
  for (const part of parts) {
    if (part.br) { flush(true); continue; }
    if (part.space && !line.length) continue;
    const w = measure(part.text, part.font, part.size);
    if (!part.space && x + w > width && line.length) {
      flush(false);
    }
    if (!part.space && w > width) {
      /* Una palabra más ancha que el renglón se parte por letras. */
      let chunk = "";
      for (const ch of part.text) {
        const cw = measure(chunk + ch, part.font, part.size);
        if (cw > width && chunk) { line.push({ ...part, text: chunk, x, w: measure(chunk, part.font, part.size) }); x += line[line.length - 1].w; flush(false); chunk = ch; }
        else chunk += ch;
      }
      if (chunk) { const cw = measure(chunk, part.font, part.size); line.push({ ...part, text: chunk, x, w: cw }); x += cw; }
      continue;
    }
    line.push({ ...part, x, w });
    x += w;
  }
  flush(true);
  return lines;
}

/* Posiciones finales de un renglón según la alineación. */
function place(line, left, width, align, last) {
  const extra = width - line.width;
  let shift = 0, gap = 0;
  if (align === "center") shift = extra / 2;
  else if (align === "right") shift = extra;
  else if (align === "justify" && !last && !line.forced) {
    const spaces = line.segs.filter(s => s.space).length;
    if (spaces) gap = extra / spaces;
  }
  let added = 0;
  return line.segs.map(seg => {
    const out = { ...seg, x: left + shift + seg.x + added };
    if (seg.space) { added += gap; out.w = seg.w + gap; }
    return out;
  });
}

/* Páginas con lo que hay que dibujar:
 *   [{ items: [{ type: "text", x, y, text, font, size, u, w } | { type: "rule", x0, x1, y } | { type: "vline", x, y0, y1 }],
 *      blocks: [{ index, top, bottom }] }]
 * box: caja de la primera página; nextBox: la de las siguientes (por
 * defecto la misma). measure(text, font, size) → ancho en puntos. */
export function layoutRedaccion(content, { measure, box = null, nextBox = null } = {}) {
  const model = normalizeContent(content);
  const first = box || pageBox(model.page), rest = nextBox || first;
  const pages = [];
  let current, cursor;
  const newPage = () => {
    const b = pages.length ? rest : first;
    current = { box: b, items: [], blocks: [] };
    pages.push(current);
    cursor = b.top;
  };
  newPage();
  const counters = [];
  let prevList = null;

  model.blocks.forEach((block, index) => {
    const b = current.box;
    if (isTableBlock(block)) {
      prevList = null;
      /* Cada fila completa en una hoja; si la tabla sigue en la siguiente,
         se repiten sus filas de encabezado. */
      const full = b.x1 - b.x0, total = block.cols.reduce((n, w) => n + w, 0);
      const widths = block.cols.map(w => (w / total) * full);
      const rows = block.rows.map(row => {
        const cells = row.cells.map((cell, c) => wrap(pieces(cell.runs, model.page, 1, !!row.h), Math.max(10, widths[c] - 2 * TBL.padX), measure, model.page.fontSize));
        const height = Math.max(...cells.map(lines => lines.reduce((h, line) => h + line.size * TBL.lh, 0))) + 2 * TBL.padY;
        return { row, cells, height };
      });
      const heads = rows.filter(r => r.row.h);
      cursor -= TBL.before;
      let top = cursor;
      const drawRow = r => {
        const bb = current.box, y0 = cursor, y1 = cursor - r.height;
        let x = bb.x0;
        current.items.push({ type: "rule", x0: bb.x0, x1: bb.x0 + full, y: y0 }, { type: "rule", x0: bb.x0, x1: bb.x0 + full, y: y1 }, { type: "vline", x: bb.x0, y0, y1 });
        r.cells.forEach((lines, c) => {
          let y = y0 - TBL.padY;
          for (const line of lines) {
            const h = line.size * TBL.lh, base = y - (h - line.size) / 2 - line.size * ASCENT;
            for (const seg of place(line, x + TBL.padX, widths[c] - 2 * TBL.padX, "left", true)) if (!seg.space || seg.u) current.items.push({ type: "text", y: base, ...seg });
            y -= h;
          }
          x += widths[c];
          current.items.push({ type: "vline", x, y0, y1 });
        });
        cursor = y1;
      };
      for (const r of rows) {
        /* No cabe y la hoja no está recién empezada: sigue en la siguiente. */
        if (cursor - r.height < current.box.bottom && cursor < current.box.top - TBL.before) {
          current.blocks.push({ index, top, bottom: cursor });
          newPage(); top = cursor;
          if (!r.row.h) for (const h of heads) drawRow(h);
        }
        drawRow(r);
      }
      cursor -= TBL.after;
      current.blocks.push({ index, top, bottom: cursor });
      return;
    }
    if (isSignatureBlock(block)) {
      prevList = null;
      const n = block.signers.length, gap = SIG.gap[n] ?? 18, size = model.page.fontSize;
      const full = b.x1 - b.x0;
      const colW = n === 1 ? full * SIG.single : (full - gap * (n - 1)) / n;
      const lineH = size * SIG.lineHeight;
      const cols = block.signers.map(signer => signer.lines.filter(l => l.runs.some(r => r.text))
        .flatMap(l => wrap(pieces(l.runs, model.page, 1, false), colW, measure, size)));
      const height = SIG.before + SIG.space + SIG.rulePad + Math.max(1, ...cols.map(c => c.length)) * lineH + SIG.after;
      if (cursor - height < current.box.bottom && cursor < current.box.top) newPage();
      const bb = current.box, top = cursor;
      const startX = n === 1 ? bb.x0 + (full - colW) / 2 : bb.x0;
      cols.forEach((lines, i) => {
        const x = startX + i * (colW + gap);
        const ruleY = top - SIG.before - SIG.space;
        current.items.push({ type: "rule", x0: x + colW * 0.04, x1: x + colW * 0.96, y: ruleY });
        lines.forEach((line, k) => {
          const base = ruleY - SIG.rulePad - k * lineH - (lineH - line.size) / 2 - line.size * ASCENT;
          for (const seg of place(line, x, colW, "center", true)) if (!seg.space) current.items.push({ type: "text", y: base, ...seg });
        });
      });
      cursor = top - height;
      current.blocks.push({ index, top, bottom: cursor });
      return;
    }

    /* Listas: viñeta o número a la izquierda del texto. */
    const list = block.t === "li" ? block.list : null;
    let marker = null;
    if (list) {
      const depth = block.indent;
      if (prevList === null) counters.length = 0;
      counters.length = depth + 1;
      counters[depth] = (counters[depth] || 0) + 1;
      marker = list === "ol" ? `${counters[depth]}.` : "•";
    }
    prevList = list;
    const scale = HEADING_SCALE[block.t] || 1;
    const heading = !!HEADING_SCALE[block.t];
    const left = b.x0 + block.indent * INDENT_STEP_PT + (list ? LIST_PAD : 0);
    const width = Math.max(20, b.x1 - left);
    const baseSize = model.page.fontSize * scale;
    const lines = wrap(pieces(block.runs, model.page, scale, heading), width, measure, baseSize);
    let top = cursor, startedAt = pages.length;
    lines.forEach((line, k) => {
      const h = line.size * block.lh;
      if (cursor - h < current.box.bottom && cursor < current.box.top) {
        if (pages.length === startedAt) current.blocks.push({ index, top, bottom: cursor });
        newPage(); top = cursor; startedAt = pages.length;
      }
      const lb = current.box;
      const l = lb.x0 + block.indent * INDENT_STEP_PT + (list ? LIST_PAD : 0);
      const base = cursor - (h - line.size) / 2 - line.size * ASCENT;
      if (k === 0 && marker) {
        const mFont = fontKey(model.page.font, false, false), mSize = baseSize;
        const mw = measure(marker, mFont, mSize);
        current.items.push({ type: "text", x: l - 6 - mw, y: base, text: marker, font: mFont, size: mSize, u: false, w: mw });
      }
      for (const seg of place(line, l, Math.max(20, lb.x1 - l), block.align, k === lines.length - 1)) {
        if (!seg.space || seg.u) current.items.push({ type: "text", y: base, ...seg });
      }
      cursor -= h;
    });
    current.blocks.push({ index, top, bottom: cursor });
  });
  return { page: model.page, pages };
}

/* Texto que la fuente estándar puede escribir; lo demás, «?». */
function encodable(font, text, report) {
  let out = "";
  for (const ch of text) {
    try { font.encodeText(ch); out += ch; }
    catch { out += "?"; report.unencodable.add(ch); }
  }
  return out;
}

/* PDF de la redacción. background: bytes de un PDF cuya primera página (y la
 * segunda, si existe, para las siguientes) va de fondo. */
export async function renderRedaccionPdf({ pdfLib, content, background = null, box = null, nextBox = null, report = {} }) {
  const { PDFDocument, StandardFonts, rgb } = pdfLib;
  const pdfDoc = await PDFDocument.create();
  const fonts = {};
  const fontOf = async key => (fonts[key] ||= await pdfDoc.embedFont(StandardFonts[key]));
  for (const family of Object.values(PDF_FONTS)) for (const key of family) await fontOf(key);
  report.unencodable = new Set();
  const measure = (text, key, size) => fonts[key].widthOfTextAtSize(encodable(fonts[key], text, report), size);
  const layout = layoutRedaccion(content, { measure, box, nextBox });
  report.pages = layout.pages.map(p => ({ blocks: p.blocks }));

  let backgrounds = [];
  if (background) {
    const src = await PDFDocument.load(background, { ignoreEncryption: true });
    const count = Math.min(2, src.getPageCount());
    backgrounds = await pdfDoc.embedPages(src.getPages().slice(0, count));
  }
  const fallback = PAGE_SIZES[layout.page.size];
  layout.pages.forEach((p, i) => {
    const bg = backgrounds[Math.min(i, backgrounds.length - 1)];
    const page = pdfDoc.addPage(bg ? [bg.width, bg.height] : [fallback.width, fallback.height]);
    if (bg) page.drawPage(bg, { x: 0, y: 0 });
    for (const item of p.items) {
      if (item.type === "rule") {
        page.drawLine({ start: { x: item.x0, y: item.y }, end: { x: item.x1, y: item.y }, thickness: 0.75, color: rgb(0, 0, 0) });
        continue;
      }
      if (item.type === "vline") {
        page.drawLine({ start: { x: item.x, y: item.y0 }, end: { x: item.x, y: item.y1 }, thickness: 0.75, color: rgb(0, 0, 0) });
        continue;
      }
      const font = fonts[item.font];
      if (!item.space) page.drawText(encodable(font, item.text, report), { x: item.x, y: item.y, size: item.size, font, color: rgb(0, 0, 0) });
      if (item.u) page.drawLine({ start: { x: item.x, y: item.y - item.size * 0.12 }, end: { x: item.x + item.w, y: item.y - item.size * 0.12 }, thickness: Math.max(0.5, item.size / 18), color: rgb(0, 0, 0) });
    }
  });
  report.unencodable = [...report.unencodable];
  return pdfDoc.save();
}
