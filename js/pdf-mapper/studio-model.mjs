/* Modelo de Template Studio: qué documentos hay y en qué estado, usando
 * SÓLO datos verificables — nunca se inventa un estado:
 *   - el catálogo real (client.documents.mjs leído como texto →
 *     discoverFromSource);
 *   - el borrador de PDF Mapper guardado en este navegador (localStorage
 *     "pdfMapperDraft.v1": documentos con sus campos y el snapshot de los
 *     valores originales con los que se comparan).
 * La disponibilidad del PDF de cada plantilla la comprueba la página aparte
 * (una petición al servidor), porque no es un dato puro. */

export const DRAFT_KEY = "pdfMapperDraft.v1";

export function parseDraft(raw) {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw);
    return draft && typeof draft === "object" && draft.docs && typeof draft.docs === "object" ? draft : null;
  } catch { return null; }
}

/*
 * local:
 *   "changed" — hay cambios en este navegador respecto a los valores originales;
 *   "same"    — el borrador existe pero coincide con el original;
 *   "draft"   — hay un mapa local sin original con qué comparar;
 *   null      — nada guardado para este documento.
 */
export function buildStudioModel({ discovered = [], draft = null }) {
  const drafted = draft?.docs || {};
  let seed = {};
  try { seed = JSON.parse(draft?.seedSnapshot || "{}") || {}; } catch { seed = {}; }
  const localState = id => {
    const local = drafted[id];
    if (!local) return null;
    if (!seed[id]) return "draft";
    return JSON.stringify(local.fields) === JSON.stringify(seed[id].fields) ? "same" : "changed";
  };
  const facts = id => {
    const local = drafted[id];
    return { fieldCount: local ? local.fields?.length ?? 0 : null, pageCount: local?.pageCount ?? null };
  };
  const discoveredIds = new Set(discovered.map(d => d.id));
  const templates = discovered.filter(d => d.recognized).map(d => ({
    id: d.id, label: d.label, template: d.template, kind: "template", local: localState(d.id), ...facts(d.id)
  }));
  /* Documentos de plataforma (texto que fluye): PDF Mapper los edita en su
   * modo "Bloques de texto" y sólo guarda borrador si hay cambios (draft.flow). */
  const flowDrafts = draft?.flow && typeof draft.flow === "object" ? draft.flow : {};
  const platform = discovered.filter(d => !d.recognized).map(d => ({ id: d.id, label: d.label, kind: "platform", ref: d.refName || null, local: flowDrafts[d.id] ? "changed" : null }));
  const imported = Object.entries(drafted)
    .filter(([id]) => !discoveredIds.has(id))
    .map(([id, doc]) => ({ id, label: doc.label || id, template: doc.template || null, kind: seed[id] ? "orphan" : "imported", local: localState(id), ...facts(id) }));
  const inProgress = [...templates.filter(t => t.local === "changed" || t.local === "draft"), ...platform.filter(p => p.local), ...imported];
  return { templates, platform, imported, inProgress };
}
