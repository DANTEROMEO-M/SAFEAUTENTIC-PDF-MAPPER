/* Colocación automática de lo que una constancia necesita y la plantilla no
 * trae escrito: la firma (sobre la línea de firma) y el sello digital (en la
 * franja libre al pie). También encuentra, entre las fuentes instaladas en el
 * equipo, la que corresponde a un nombre de fuente del PDF.
 *
 * Módulo puro. raster = { gray, width, height, pageWidth } de la página (sin
 * los datos dibujados); coordenadas en puntos PDF, "y" hacia arriba. */

const r2 = v => Math.round(v * 100) / 100;
export const PRINT_MARGIN = 14.17;

/* Rayas horizontales oscuras y delgadas (líneas de firma, subrayados). */
export function detectHorizontalRules(raster, pageHeight, { minLength = 60, maxThickness = 3, dark = 120 } = {}) {
  if (!raster?.gray) return [];
  const s = raster.width / raster.pageWidth, minPx = Math.round(minLength * s), maxRows = Math.max(1, Math.round(maxThickness * s));
  const rowRuns = [];
  for (let y = 0; y < raster.height; y++) {
    const runs = [];
    let start = -1;
    for (let x = 0; x <= raster.width; x++) {
      const isDark = x < raster.width && raster.gray[y * raster.width + x] < dark;
      if (isDark && start < 0) start = x;
      else if (!isDark && start >= 0) { if (x - start >= minPx) runs.push([start, x - 1]); start = -1; }
    }
    rowRuns.push(runs);
  }
  /* Filas consecutivas con tramos traslapados = una misma raya. */
  const rules = [], open = [];
  for (let y = 0; y < raster.height; y++) {
    for (const [a, b] of rowRuns[y]) {
      const prev = open.find(r => r.lastY === y - 1 && a <= r.x1 && b >= r.x0);
      if (prev) { prev.lastY = y; prev.x0 = Math.min(prev.x0, a); prev.x1 = Math.max(prev.x1, b); }
      else open.push({ firstY: y, lastY: y, x0: a, x1: b });
    }
    for (let i = open.length - 1; i >= 0; i--) if (open[i].lastY < y) rules.push(...open.splice(i, 1));
  }
  rules.push(...open);
  return rules.filter(r => r.lastY - r.firstY + 1 <= maxRows).map(r => ({
    x0: r2(r.x0 / s), x1: r2((r.x1 + 1) / s),
    y: r2(pageHeight - (r.firstY + r.lastY + 1) / 2 / s),
    thickness: r2((r.lastY - r.firstY + 1) / s)
  }));
}

const looksLikePerson = t => {
  const words = t.trim().split(/\s+/);
  return words.length >= 2 && words.length <= 7 && !/[\d:@]/.test(t) && words.filter(w => /^\p{Lu}/u.test(w)).length >= 2;
};

/* Dónde va la firma: sobre una línea de firma (80–360 pt, en la mitad
 * inferior) con un nombre de persona justo debajo; si no hay línea, sobre el
 * nombre del firmante. La caja sube hasta el texto de arriba (máx. 70 pt). */
export function proposeSignature(rules, runs, { pageWidth, pageHeight, exclude = [] } = {}) {
  const below = (rule, run) => run.y < rule.y && rule.y - (run.y + run.size * 0.8) <= 40 && run.box.x0 < rule.x1 && run.box.x1 > rule.x0;
  const candidates = rules.filter(r => r.x1 - r.x0 >= 80 && r.x1 - r.x0 <= 360 && r.y < pageHeight * 0.55 && r.y > PRINT_MARGIN)
    .map(rule => {
      const signer = runs.filter(run => !exclude.includes(run.id) && below(rule, run)).sort((p, q) => q.y - p.y)[0] || null;
      return { rule, signer, score: (signer ? 2 : 0) + (signer && looksLikePerson(signer.text) ? 1 : 0) - Math.abs(((rule.x0 + rule.x1) / 2) - pageWidth / 2) / pageWidth };
    })
    .sort((p, q) => q.score - p.score);
  let center, base, width, reason;
  if (candidates.length && (candidates[0].signer || candidates.length === 1)) {
    const { rule, signer } = candidates[0];
    center = (rule.x0 + rule.x1) / 2; base = rule.y + 1.5; width = Math.min(rule.x1 - rule.x0, 200);
    reason = signer ? `sobre la línea de firma de «${signer.text}»` : "sobre la línea de firma";
  } else {
    const signer = runs.filter(r => !exclude.includes(r.id) && r.y < pageHeight * 0.45 && r.size <= 16 && looksLikePerson(r.text) && !/[“"]/.test(r.text))
      .sort((p, q) => Math.abs((p.box.x0 + p.box.x1) / 2 - pageWidth / 2) - Math.abs((q.box.x0 + q.box.x1) / 2 - pageWidth / 2))[0];
    if (!signer) return null;
    center = (signer.box.x0 + signer.box.x1) / 2; base = signer.box.y1 + 3; width = Math.max(120, Math.min(200, signer.box.x1 - signer.box.x0 + 40));
    reason = `sobre el nombre «${signer.text}» (no se encontró línea de firma)`;
  }
  const x0 = center - width / 2, x1 = center + width / 2;
  /* La firma no tapa texto: si un renglón (p. ej. «Número de Registro»,
   * parte del bloque del firmante) ocupa la base, la caja sube sobre él. */
  for (let i = 0; i < 6; i++) {
    const blocking = runs.filter(r => r.box.x0 < x1 && r.box.x1 > x0 && r.box.y0 < base + 24 && r.box.y1 > base);
    if (!blocking.length) break;
    base = Math.max(...blocking.map(r => r.box.y1)) + 3;
  }
  /* Techo: el primer texto de la plantilla que quede encima de la caja. */
  const above = runs.filter(r => r.box.y0 > base && r.box.x0 < x1 && r.box.x1 > x0).map(r => r.box.y0);
  const top = Math.min(base + 70, above.length ? Math.min(...above) - 2 : base + 70);
  const height = top - base;
  if (height < 24) return null;
  return { x: r2(x0), y: r2(base), width: r2(width), height: r2(height), reason };
}

/* Franja libre al pie para el sello digital (2 líneas de 5 pt): la más baja,
 * dentro del área imprimible, con el tramo sin tinta más largo (≥ 200 pt). */
export function proposeSealBand(raster, pageHeight, { pageWidth, margin = PRINT_MARGIN, height = 14, maxY = 90 } = {}) {
  if (!raster?.gray) return null;
  const s = raster.width / raster.pageWidth;
  let best = null;
  for (let y0 = Math.ceil(margin); y0 + height <= maxY; y0 += 1) {
    const py0 = Math.round((pageHeight - y0 - height) * s), py1 = Math.round((pageHeight - y0) * s);
    let run = 0, bestRun = 0, bestEnd = 0;
    const left = Math.round(margin * s), right = Math.round((pageWidth - margin) * s);
    for (let x = left; x <= right; x++) {
      let ink = 0;
      for (let y = py0; y < py1; y++) if (raster.gray[y * raster.width + x] < 160) ink++;
      if (x < right && ink <= (py1 - py0) * 0.02) { run++; continue; }
      if (run > bestRun) { bestRun = run; bestEnd = x; }
      run = 0;
    }
    const len = bestRun / s;
    if (len >= 200 && (!best || len > best.length + 40)) best = { x: r2((bestEnd - bestRun) / s), y: y0, length: r2(len) };
    if (best && len >= 400) break;
  }
  if (!best) return null;
  const width = Math.min(best.length - 6, 420);
  return { x: r2(best.x + 3), width: r2(width), line1: r2(best.y + 8.5), line2: r2(best.y + 2.5), size: 5 };
}

/* La fuente instalada que corresponde a un nombre del PDF («Calibri,Bold»,
 * «TimesNewRomanPS-BoldMT», «Baskerville Old Face»). localFonts: lo que
 * entrega queryLocalFonts() → { family, fullName, postscriptName, style }. */
const squash = t => String(t || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function parsePdfFontName(name) {
  const clean = String(name || "").replace(/^[A-Z]{6}\+/, "");
  const m = /^(.*?)[,-]((?:Bold|Italic|Oblique|BoldItalic|BoldOblique|Regular|Roman|SemiBold|Black|Light)(?:MT|PS)?)$/i.exec(clean);
  const family = (m ? m[1] : clean).replace(/(PS|MT)$/, "");
  const style = (m ? m[2] : "").toLowerCase();
  return { family, bold: /bold|black|heavy|semibold/.test(style), italic: /italic|oblique/.test(style) };
}
export function matchLocalFont(localFonts, pdfName) {
  const want = parsePdfFontName(pdfName), fam = squash(want.family), full = squash(pdfName);
  let best = null;
  for (const f of localFonts) {
    const style = String(f.style || "").toLowerCase();
    const bold = /bold|black|heavy|semibold/.test(style), italic = /italic|oblique/.test(style);
    let score = 0;
    if (squash(f.postscriptName) === full) score = 10;
    else if (squash(f.family) === fam || squash(f.fullName) === fam) score = 5;
    else continue;
    if (bold === want.bold) score += 2; else score -= 3;
    if (italic === want.italic) score += 2; else score -= 3;
    if (!best || score > best.score) best = { font: f, score };
  }
  return best && best.score >= 7 ? best.font : null;
}

/* Lugar para el QR de verificación cuando la plantilla no trae uno: el
 * cuadro libre más grande (110 → 60 pt) en la mitad inferior, con 4 pt de
 * zona silenciosa, prefiriendo la derecha y lo más bajo. */
export function proposeQrSpot(raster, pageHeight, { pageWidth, margin = PRINT_MARGIN, quiet = 4 } = {}) {
  if (!raster?.gray) return null;
  const s = raster.width / raster.pageWidth;
  /* Tabla de sumas: tinta en cualquier rectángulo en O(1). */
  const W = raster.width, H = raster.height, sum = new Uint32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) { row += raster.gray[y * W + x] < 160 ? 1 : 0; sum[(y + 1) * (W + 1) + x + 1] = sum[y * (W + 1) + x + 1] + row; }
  }
  const ink = (x0, y0, x1, y1) => sum[y1 * (W + 1) + x1] - sum[y0 * (W + 1) + x1] - sum[y1 * (W + 1) + x0] + sum[y0 * (W + 1) + x0];
  for (const side of [110, 96, 84, 72, 60]) {
    let best = null;
    for (let y = margin + quiet; y + side + quiet <= pageHeight * 0.5; y += 4) {
      for (let x = pageWidth - margin - quiet - side; x >= pageWidth * 0.5; x -= 4) {
        const px0 = Math.round((x - quiet) * s), px1 = Math.round((x + side + quiet) * s);
        const py0 = Math.round((pageHeight - y - side - quiet) * s), py1 = Math.round((pageHeight - y + quiet) * s);
        if (px0 < 0 || py0 < 0 || px1 > W || py1 > H) continue;
        if (ink(px0, py0, px1, py1) > (px1 - px0) * (py1 - py0) * 0.01) continue;
        const score = x - y * 0.5;
        if (!best || score > best.score) best = { x: r2(x), y: r2(y), side, score };
      }
    }
    if (best) return { x: best.x, y: best.y, width: best.side, height: best.side };
  }
  return null;
}
