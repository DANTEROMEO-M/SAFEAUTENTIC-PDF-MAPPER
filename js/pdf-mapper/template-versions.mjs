/* Versiones de una plantilla mapeada — qué se probó y se aprobó, y si lo que
 * hay ahora en el editor sigue siendo eso.
 *
 * Una versión guarda el mapa y los enlaces de edición necesarios para
 * restaurarlo (no los datos de muestra), con su huella, estado y pruebas. La
 * huella ignora ayudas puramente visuales del editor.
 *
 * Módulo puro; la página guarda la lista en localStorage
 * (VERSIONS_KEY → { [docId]: versión[] }), sólo en este navegador. */

export const VERSIONS_KEY = "pdfMapperVersions.v1";
export const MAX_VERSIONS = 30;

/* El snapshot conserva los metadatos de edición; sólo se excluyen de la
 * huella las ayudas que no alteran el resultado ni el comportamiento. */
const FINGERPRINT_ONLY = new Set(["group", "groupLabel", "source", "maskOff", "needsReview", "textReplacement", "textReplacements", "replacementWarning"]);

/* JSON con claves ordenadas: el mismo mapa da siempre el mismo texto. */
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  }
  return JSON.stringify(value ?? null);
}

export function mapSnapshot(doc) {
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  return { id: doc.id, label: doc.label, template: doc.template, page: copy(doc.page), pages: copy(doc.pages), pageCount: doc.pageCount || 1,
    fonts: copy(doc.fonts), fields: copy(doc.fields || []), templateEdits: copy(doc.templateEdits), textEdits: copy(doc.textEdits), customFonts: copy(doc.customFonts) };
}

/* FNV-1a de 32 bits en hexadecimal: corta, estable y suficiente para saber
 * si dos mapas son el mismo (no es una firma de seguridad). */
export function fingerprint(doc) {
  const snapshot = mapSnapshot(doc);
  snapshot.fields = snapshot.fields.map(f => Object.fromEntries(Object.entries(f).filter(([k]) => !FINGERPRINT_ONLY.has(k))));
  const text = canonical(snapshot);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/* Nueva versión al final de la lista. Si el mapa no cambió desde la última,
 * no se duplica: se actualiza su estado (p. ej. de borrador a aprobada). */
export function addVersion(list = [], doc, { status = "borrador", note = "", checks = null, now = new Date().toISOString() } = {}) {
  const fp = fingerprint(doc);
  const last = list[list.length - 1];
  if (last && last.fingerprint === fp) {
    const updated = { ...last, status: status === "aprobada" ? "aprobada" : last.status, note: note || last.note, checks: checks || last.checks, ...(status === "aprobada" ? { approvedAt: now } : {}) };
    return [...list.slice(0, -1), updated];
  }
  const version = { n: (last?.n || 0) + 1, status, note, createdAt: now, fingerprint: fp, snapshot: mapSnapshot(doc), checks,
    ...(status === "aprobada" ? { approvedAt: now } : {}) };
  /* Se conservan las más recientes, pero nunca se descarta la última aprobada. */
  let next = [...list, version];
  while (next.length > MAX_VERSIONS) {
    const lastApproved = [...next].reverse().find(v => v.status === "aprobada");
    const drop = next.findIndex(v => v !== lastApproved);
    next = next.filter((_, i) => i !== drop);
  }
  return next;
}

/* Estado del mapa actual frente a sus versiones. */
export function versionState(list = [], doc) {
  const current = fingerprint(doc);
  const approved = [...list].reverse().find(v => v.status === "aprobada") || null;
  const same = list.find(v => v.fingerprint === current) || null;
  return {
    current, latest: list[list.length - 1] || null, approved, matching: same,
    isApproved: !!approved && approved.fingerprint === current,
    changedSinceApproval: !!approved && approved.fingerprint !== current
  };
}

/* Documento con el mapa de una versión (conserva datos de muestra y juegos). */
export function restoreVersion(doc, version) {
  const s = version.snapshot;
  const restored = { ...doc, page: s.page, pages: s.pages, pageCount: s.pageCount, fonts: s.fonts, fields: JSON.parse(JSON.stringify(s.fields)) };
  if (s.customFonts) restored.customFonts = JSON.parse(JSON.stringify(s.customFonts)); else delete restored.customFonts;
  if (s.templateEdits?.length) restored.templateEdits = JSON.parse(JSON.stringify(s.templateEdits)); else delete restored.templateEdits;
  if (s.textEdits?.length) restored.textEdits = JSON.parse(JSON.stringify(s.textEdits)); else delete restored.textEdits;
  return restored;
}

/* Resumen de pruebas que se guarda con una versión y viaja al paquete. */
export function summarizeChecks(results) {
  return results.map(r => ({ dataset: r.dataset, errors: r.warnings.filter(w => w.severity === "error").length,
    warnings: r.warnings.filter(w => w.severity === "warn").length, overflow: r.warnings.filter(w => w.type === "overflow").length }));
}
