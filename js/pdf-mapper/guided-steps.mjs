/* Pasos guiados de una plantilla nueva (4.4): qué está hecho, qué falta y
 * cuál es el siguiente clic. Módulo puro: recibe hechos ya calculados.
 *
 * facts: {
 *   constancia,           ¿es «constancia-…»?
 *   status,               mappingStatus(doc) (binding-suggest)
 *   fieldCount,
 *   fontsPending,         nombres de fuentes de la plantilla sin archivo
 *                         (null: aún no se leen los textos de la plantilla)
 *   approved,             la versión actual está aprobada
 *   packaged              el paquete descargado corresponde al mapa actual
 * } */
const DATA_CONCEPTS = new Set(["participante", "curso", "fecha", "folio"]);
const ELEMENT_CONCEPTS = new Set(["qr", "firma", "sello"]);
export function guidedSteps({ constancia, status = [], fieldCount = 0, fontsPending = [], approved = false, packaged = false }) {
  const missing = set => status.filter(s => set.has(s.concept) && s.required && !s.done);
  const missingData = constancia ? missing(DATA_CONCEPTS) : [];
  const missingEls = constancia ? missing(ELEMENT_CONCEPTS) : [];
  const sealPending = constancia && status.some(s => s.concept === "sello" && !s.done);
  const steps = [
    { id: "importar", label: "Importar el PDF", state: "done" },
    { id: "datos", label: "Vincular los datos", state: (constancia ? !missingData.length : fieldCount > 0) ? "done" : "todo",
      detail: missingData.length ? `Faltan: ${missingData.map(s => s.label.toLowerCase()).join(", ")}` : null, action: "datos" },
    { id: "elementos", label: "QR, firma y sello", state: !constancia ? "optional" : missingEls.length ? "todo" : sealPending ? "optional" : "done",
      detail: missingEls.length ? `Faltan: ${missingEls.map(s => s.label.toLowerCase()).join(", ")}` : sealPending ? "El sello digital es recomendado" : null,
      action: missingEls[0]?.concept || (sealPending ? "sello" : null) },
    { id: "fuentes", label: "Fuentes del cliente", state: fontsPending == null || fontsPending.length ? "optional" : "done",
      detail: fontsPending == null ? "Revisando las fuentes de la plantilla…" : fontsPending.length ? `${fontsPending.length} se aproxima${fontsPending.length === 1 ? "" : "n"} con una estándar` : null, action: "fuentes" },
    { id: "probar", label: "Probar y aprobar", state: approved ? "done" : "todo", action: "probar" },
    { id: "paquete", label: "Descargar el paquete", state: packaged ? "done" : "todo", action: "paquete" }
  ];
  /* El siguiente: el primer paso obligatorio sin hacer; aprobar y descargar
   * sólo tienen sentido con datos y elementos completos. */
  const next = steps.find(s => s.state === "todo") || null;
  return { steps, next, done: steps.filter(s => s.state === "done").length, total: steps.length };
}
