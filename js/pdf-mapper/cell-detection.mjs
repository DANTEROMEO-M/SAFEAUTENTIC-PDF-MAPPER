/* Detección de casillas de caracteres (CURP, RFC, fechas, folios…) sobre la
 * página YA rasterizada — no sobre los trazos vectoriales del PDF: así
 * funciona igual con formularios vectoriales (con transformaciones anidadas
 * como la plantilla DC-3), con casillas dibujadas como rectángulos o como
 * "peine" (línea base + marcas verticales) y con PDFs escaneados.
 *
 * Todo aquí trabaja en píxeles del raster (origen arriba a la izquierda, "y"
 * crece hacia abajo) y es puro: recibe un arreglo de grises y devuelve
 * geometría. La conversión a puntos PDF la hace quien llama. */

const DARK_THRESHOLD = 160;
const LINE_ROW_FILL = 0.5;
const LINE_COLUMN_FILL = 0.6;

export function toGrayscale(rgba, width, height) {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    /* Transparente = papel blanco (pdf.js no pinta el fondo en todos los PDFs). */
    const a = rgba[p + 3] / 255;
    gray[i] = Math.round((0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]) * a + 255 * (1 - a));
  }
  return gray;
}

function groupRuns(flags, offset) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) { if (start < 0) start = i; }
    else if (start >= 0) { runs.push({ start: offset + start, end: offset + i - 1, center: offset + (start + i - 1) / 2 }); start = -1; }
  }
  return runs;
}
function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/*
 * gray/width/height: página en grises. region: { x0, x1, y0, y1 } en px (zona
 * a revisar: la fila de casillas con algo de margen). textCenterY: "y" (px)
 * donde se espera el centro del texto — decide qué líneas horizontales son el
 * borde superior/inferior de ESTA fila cuando la zona alcanza otras.
 *
 * Devuelve { cells: [{ x0, x1, center }], band: { top, bottom } | null,
 * kind: "boxes" | "comb" | "open" }, o cells vacío si no hay casillas.
 */
export function detectCharacterCells(gray, width, height, region, textCenterY) {
  const x0 = Math.max(0, Math.floor(region.x0)), x1 = Math.min(width, Math.ceil(region.x1));
  const y0 = Math.max(0, Math.floor(region.y0)), y1 = Math.min(height, Math.ceil(region.y1));
  if (x1 - x0 < 4 || y1 - y0 < 4) return { cells: [], band: null, kind: "open" };
  const dark = (x, y) => gray[y * width + x] < DARK_THRESHOLD;

  /* 1. Líneas horizontales (bordes superior/inferior o línea base del peine). */
  const rowFlags = [];
  for (let y = y0; y < y1; y++) {
    let n = 0;
    for (let x = x0; x < x1; x++) if (dark(x, y)) n++;
    rowFlags.push(n / (x1 - x0) >= LINE_ROW_FILL);
  }
  const hLines = groupRuns(rowFlags, y0);
  const yc = textCenterY ?? (y0 + y1) / 2;
  const above = hLines.filter(l => l.center < yc).pop() || null;
  const below = hLines.find(l => l.center > yc) || null;

  /* 2. Franja vertical donde viven las marcas de cada casilla. */
  let band, kind;
  const tickRun = (x, fromY, step, limit) => {
    let n = 0;
    for (let y = fromY; y >= y0 && y < y1 && n < limit; y += step) { if (dark(x, y)) n++; else break; }
    return n;
  };
  const combBand = (line, step) => {
    const from = step < 0 ? line.start - 1 : line.end + 1;
    const runs = [];
    for (let x = x0; x < x1; x++) { const r = tickRun(x, from, step, y1 - y0); if (r >= 3) runs.push(r); }
    const h = runs.length ? median(runs) : Math.round((y1 - y0) / 3);
    return step < 0 ? { top: from - h + 1, bottom: from } : { top: from, bottom: from + h - 1 };
  };
  /* La altura se mide SIEMPRE siguiendo las marcas desde la línea base: una
   * línea horizontal por encima sólo es el borde superior de la casilla si
   * las marcas llegan hasta ella. Si no, es otra cosa (el borde de la fila de
   * la tabla, por encima de la etiqueta) y tomarla metería la etiqueta en la
   * franja. */
  const REACH_TOLERANCE = 2;
  if (below) {
    band = combBand(below, -1); kind = "comb";
    if (above && band.top <= above.end + 1 + REACH_TOLERANCE) { band = { top: above.end + 1, bottom: below.start - 1 }; kind = "boxes"; }
  } else if (above) { band = combBand(above, 1); kind = "comb"; }
  else { band = { top: y0, bottom: y1 - 1 }; kind = "open"; }
  if (band.bottom - band.top < 2) return { cells: [], band: null, kind };

  /* 3. Marcas verticales: columnas oscuras en casi toda la franja. */
  const colFlags = [];
  const bandRows = band.bottom - band.top + 1;
  for (let x = x0; x < x1; x++) {
    let n = 0;
    for (let y = band.top; y <= band.bottom; y++) if (dark(x, y)) n++;
    colFlags.push(n / bandRows >= LINE_COLUMN_FILL);
  }
  const vLines = groupRuns(colFlags, x0);
  if (vLines.length < 2) return { cells: [], band, kind };

  /* 4. Intervalos entre marcas = casillas. Se descartan los huecos angostos
   * (casillas separadas dibujadas como rectángulos independientes: borde
   * derecho de una + borde izquierdo de la siguiente) y los tramos demasiado
   * anchos (zona sin casillas dentro de la región revisada). */
  const intervals = vLines.slice(1).map((l, i) => ({ x0: vLines[i].end + 1, x1: l.start - 1, center: (vLines[i].center + l.center) / 2, width: l.center - vLines[i].center }));
  const maxWidth = Math.max(...intervals.map(iv => iv.width));
  const ref = median(intervals.filter(iv => iv.width >= 0.3 * maxWidth).map(iv => iv.width));
  const cells = intervals.filter(iv => iv.width >= 0.45 * ref && iv.width <= 2.5 * ref).map(({ x0, x1, center }) => ({ x0, x1, center }));
  return { cells, band, kind };
}

/* Tramo contiguo de "centers.length" casillas detectadas que mejor coincide
 * con los centros actuales del campo (menor suma de distancias). Sirve cuando
 * la cantidad de caracteres es parte del contrato (CURP = 18) y la zona
 * revisada alcanzó casillas vecinas; null si se detectaron menos casillas de
 * las que el campo necesita. */
export function bestCellRun(cells, centers) {
  const n = centers.length;
  if (!n || cells.length < n) return null;
  let best = null;
  for (let start = 0; start + n <= cells.length; start++) {
    let cost = 0;
    for (let i = 0; i < n; i++) cost += Math.abs(cells[start + i].center - centers[i]);
    if (!best || cost < best.cost) best = { start, cost };
  }
  return cells.slice(best.start, best.start + n);
}

/* Línea base que centra verticalmente un texto de altura "capHeight" dentro
 * de una casilla [bottom, top] (coordenadas PDF: "y" crece hacia arriba). */
export function centeredBaseline(bottom, top, capHeight) {
  return Math.round((bottom + (top - bottom - capHeight) / 2) * 100) / 100;
}

/* Reparte "count" centros uniformemente entre el primero y el último dados
 * (o conserva el único si count es 1). */
export function distributeCenters(first, last, count) {
  if (count <= 1) return [first];
  const step = (last - first) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round((first + i * step) * 100) / 100);
}
