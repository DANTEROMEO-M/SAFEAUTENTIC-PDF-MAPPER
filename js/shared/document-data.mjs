/* Contrato comun de datos para los engines documentales.
   Mantiene en un solo lugar la lectura segura de rutas, la deteccion de datos
   faltantes y los formatos basicos que usan PDF Mapper y Document Builder. */

export const DATA_BINDING_PATTERN = /{{\s*([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*)\s*}}/g;
export const DATA_PATH_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*$/;

export function readDataPath(data, path) {
  if (!DATA_PATH_PATTERN.test(String(path || ""))) return undefined;
  return String(path).split(".").reduce((value, key) => {
    if (value === null || value === undefined || typeof value !== "object") return undefined;
    return Object.hasOwn(value, key) ? value[key] : undefined;
  }, data);
}

export function isBlankData(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

export function collectDataBindings(value) {
  const bindings = new Set();
  for (const match of String(value ?? "").matchAll(DATA_BINDING_PATTERN)) bindings.add(match[1]);
  return [...bindings];
}

export function formatDataValue(value, format, locale = "es-MX") {
  if (isBlankData(value) || !format) return value;
  const kind = typeof format === "string" ? format : format.type;
  const options = typeof format === "object" ? format : {};
  if (kind === "uppercase") return String(value).toUpperCase();
  if (kind === "lowercase") return String(value).toLowerCase();
  if (kind === "capitalize") return String(value).replace(/\b\p{L}/gu, char => char.toUpperCase());
  if (kind === "date") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat(locale, options).format(date);
  }
  if (kind === "currency") {
    const number = Number(value);
    if (Number.isFinite(number)) return new Intl.NumberFormat(locale, { style: "currency", currency: options.currency || "MXN", ...options }).format(number);
  }
  if (kind === "number" || kind === "percentage") {
    const number = Number(value);
    if (Number.isFinite(number)) return new Intl.NumberFormat(locale, kind === "percentage" ? { style: "percent", ...options } : options).format(number);
  }
  return value;
}

export function inspectDataBindings(bindings, data, { allowBlank = [], repeated = [] } = {}) {
  const allowed = new Set(allowBlank);
  const repeatedPaths = new Set(repeated);
  const result = { bindings: [], missing: [], blank: [], repeated: [] };
  for (const path of [...new Set(bindings || [])]) {
    const value = readDataPath(data, path);
    result.bindings.push({ path, value, present: value !== undefined, blank: isBlankData(value) });
    if (repeatedPaths.has(path)) result.repeated.push({ path, rows: Array.isArray(value) ? value.length : 0 });
    if (value === undefined) result.missing.push(path);
    else if (isBlankData(value) && !allowed.has(path)) result.blank.push(path);
  }
  return result;
}

export function resolveDataText(text, data, { missing = new Set(), formats = {}, fallback = "" } = {}) {
  return String(text ?? "").replace(DATA_BINDING_PATTERN, (_token, path) => {
    const value = readDataPath(data, path);
    if (isBlankData(value)) {
      missing.add(path);
      return fallback;
    }
    return String(formatDataValue(value, formats[path]));
  });
}

export function createSyntheticData(bindings = [], { repeatedPaths = [], repeatedFields = {}, overrides = {} } = {}) {
  const result = structuredClone(overrides);
  for (const path of bindings) {
    /* Los bindings de columnas repetibles (`rows[].name`) describen el
       contenido de una fila, no otra rama del objeto raíz. El dato sintético
       de la colección ya se crea con `rows`; intentar escribir literalmente
       `rows[]` produciría una propiedad inválida paralela. */
    if (String(path).includes("[].")) continue;
    if (readDataPath(result, path) !== undefined) continue;
    const segments = String(path).split(".");
    let cursor = result;
    segments.forEach((segment, index) => {
      const last = index === segments.length - 1;
      if (last) cursor[segment] = repeatedPaths.includes(path)
        ? [Object.fromEntries((repeatedFields[path] || ["sample"]).map(field => [field, `Valor de ${field}`]))]
        : `Valor de ${path}`;
      else cursor = cursor[segment] ||= {};
    });
  }
  return result;
}
