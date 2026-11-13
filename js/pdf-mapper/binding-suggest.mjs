/* Vinculación — qué dato de SafeAutentic corresponde a cada texto de la
 * plantilla de un cliente, y qué le falta a la plantilla para ser una
 * constancia completa.
 *
 * Las sugerencias salen de evidencia que se puede explicar al usuario, nunca
 * de una adivinanza opaca:
 *   1. la etiqueta del propio renglón («Folio: ACM-0451», «Duración: 8 horas»);
 *   2. la etiqueta vecina: a la izquierda en el mismo renglón («Instructor:»)
 *      o justo arriba («Se otorga la presente a:», «…el curso»);
 *   3. la forma del texto (una fecha, unas horas, un RFC, una razón social);
 *   4. para el participante, ser el nombre más destacado de la hoja.
 * Cada sugerencia trae sus razones y una confianza (alta / media / baja).
 *
 * Cuando el renglón mezcla texto fijo y dato («Duración: 8 horas»), la
 * sugerencia es una plantilla de texto («Duración: {record.duracion} horas»):
 * el texto fijo se conserva y sólo cambia el dato.
 *
 * Módulo puro: recibe renglones de pdf-text.mjs y campos del documento. */

const norm = t => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const MONTHS = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";

/* Elementos de una constancia. "path" es la clave que el render recibe en
 * "data" (ver data-catalog.mjs); "labels" se comparan con una etiqueta
 * completa (normalizada: minúsculas, sin acentos) y "inline" con el renglón
 * sin su marcador de relleno («Con una duración de xx horas.»). "tool":
 * herramienta para colocarlo a mano. */
export const CONCEPTS = [
  { id: "participante", label: "Nombre del participante", path: "record.nombre", kind: "text", required: true, shape: "persona",
    labels: [/nombre (del |de la )?(participante|alumn[oa]|trabajador[a]?|asistente|capacitand[oa]|interesad[oa])/, /(se )?(otorga|confiere|expide|extiende|entrega)n?( el presente| la presente)?( constancia| reconocimiento| diploma)?( a)?$/, /^(a|al|a la|c\.?)$/, /^nombre$/, /^otorgad[oa] a$/] },
  { id: "curso", label: "Nombre del curso", path: "record.nombreCurso", kind: "text", required: true, shape: "titulo",
    labels: [/\bcurso\b/, /(por )?(haber )?(acreditado|aprobado|concluido|participado|asistido|cursado|tomado)\b/, /\b(taller|capacitacion|diplomado|seminario|programa|platica|tema)\b/] },
  { id: "fecha", label: "Fecha", path: "record.fecha", kind: "text", required: true, shape: "fecha",
    labels: [/^fecha/, /fecha de (expedicion|emision|realizacion|imparticion)/, /(expedid|emitid|realizad)[oa]s? (el|a)\b/, /lugar y fecha/],
    inline: /\bfecha\b|\bel dia\b|^dad[oa] (en|el)\b|\ba los\b/ },
  { id: "folio", label: "Folio", path: "record.folio", kind: "text", required: true, shape: "folio",
    labels: [/^folio/, /^(no|num|numero)\.?( de)?( folio| control| constancia)?$/, /^clave$/], inline: /\bfolio\b/ },
  { id: "duracion", label: "Duración (horas)", path: "record.duracion", kind: "text", shape: "horas",
    labels: [/duracion/, /^(con )?(una )?(duracion|intensidad)( de)?$/, /^horas?$/], inline: /duracion|\bhoras?\b/ },
  { id: "empresa", label: "Empresa", path: "record.empresa", kind: "text", shape: "empresa",
    labels: [/^empresa/, /razon social/, /centro de trabajo/, /(de|para) la empresa$/, /^cliente$/, /^impartid[oa] (en|para)( la empresa)?$/], inline: /\bempresa\b|razon social/ },
  { id: "instructor", label: "Instructor", path: "record.instructor", kind: "text", shape: "persona",
    labels: [/instructor/, /capacitador/, /facilitador/, /^impartid[oa] por$/, /ponente/], inline: /\binstructor\b/ },
  { id: "municipio", label: "Lugar (municipio)", path: "record.municipio", kind: "text", shape: "lugar",
    labels: [/^(municipio|alcaldia|lugar|domicilio|direccion|sede)$/] },
  { id: "calificacion", label: "Calificación", path: "record.calificacion", kind: "text", shape: "numero",
    labels: [/calificacion|puntuacion|promedio/], inline: /calificacion/ },
  { id: "rfc", label: "RFC", path: "record.rfc", kind: "text", shape: "rfc", labels: [/^r\.?f\.?c\.?/] },
  { id: "qr", label: "Código QR de verificación", path: "qrImage", kind: "qr", required: true, tool: "qr" },
  { id: "firma", label: "Firma autógrafa", path: "signaturePng", kind: "image", required: true, tool: "image" },
  { id: "sello", label: "Sello digital (2 líneas)", path: "pki.line1", kind: "text", recommended: true, tool: "text" }
];
const TEXT_CONCEPTS = CONCEPTS.filter(c => c.kind === "text" && c.shape);

/* Cartas (corresponsabilidad, Cartas CDMX y todo documento que no sea
 * constancia ni DC-3): los datos que la emisión de cartas entrega
 * (data-catalog.mjs, grupo «carta») y el consultor del perfil. En una carta
 * la etiqueta suele ser el final del texto que antecede al dato («…con razón
 * social FIDEICOMISO…», «…y con domicilio en AV. …»), por eso sus etiquetas
 * se anclan al final. «column»: cargo de la firma en la misma columna que el
 * nombre (arriba, con «C.» de por medio, o justo abajo). */
const FECHA_TEXT = new RegExp(`(\\d{1,2}|[xX]{2,}|_{3,})\\s*de\\s*(${MONTHS}|[xX]{2,}|_{3,})\\s*(de|del)\\s*(\\d{4}|20\\s*_*|[xX]{2,}|_{3,})`, "i");
export const LETTER_CONCEPTS = [
  { id: "responsable", label: "Nombre del responsable", path: "record.nombreCliente", kind: "text", shape: "persona",
    labels: [/(representante legal|propietari[oa]|obligad[oa]|encargad[oa]|titular del establecimiento|responsable del establecimiento):?$/, /^(el|la) (suscrit[oa]|que suscribe)$/],
    hint: /obligad|representante|propietari|encargad/,
    column: /^(representante legal|propietari[oa]|apoderad[oa]|administrador|gerente|director|obligad[oa]|nombre (de la persona )?obligad)/ },
  { id: "razonSocial", label: "Razón social", path: "record.razonSocial", kind: "text", shape: "empresa",
    labels: [/razon social:?$/, /establecimiento( mercantil)?( denominado)?:?$/, /denominad[oa]:?$/, /denominacion( o razon social)?:?$/, /(la )?empresa:?$/], inline: /razon social|establecimiento|denominad/,
    hint: /razon social|denominacion|nombre del establecimiento|nombre de la empresa/ },
  { id: "domicilio", label: "Domicilio", path: "record.municipio", kind: "text", shape: "domicilio",
    labels: [/domicilio( ubicado)?( en)?:?$/, /ubicad[oa] en:?$/, /direccion:?$/, /^(municipio|alcaldia):?$/], inline: /domicilio|ubicad/,
    hint: /domicilio|direccion|calle/ },
  { id: "fecha", label: "Fecha", path: "record.fechaCdmx", kind: "text", shape: "fecha", value: FECHA_TEXT,
    labels: [/^fecha:?$/, /lugar y fecha:?$/], inline: /\bfecha\b|, a\b|\ba los\b/ },
  { id: "consultor", label: "Nombre del consultor", path: "profile.nombreConsultor", kind: "text", shape: "persona",
    labels: [/responsable oficial( de proteccion civil)?:?$/, /\bropc:?$/, /consultor:?$/, /tercero acreditado:?$/],
    hint: /responsable oficial|ropc|consultor|tercero acreditado/,
    column: /^(responsable oficial|ropc|consultor|tercero acreditado|asesor)/ },
  { id: "nombreComercial", label: "Nombre comercial", path: "record.nombreComercial", kind: "text", labels: [/nombre comercial:?$/] },
  { id: "actividad", label: "Actividad económica", path: "record.actividadEconomica", kind: "text", labels: [/actividad economica:?$/, /\bgiro:?$/] },
  { id: "scian", label: "Código SCIAN", path: "record.scian", kind: "text", shape: "scian", labels: [/scian:?$/] }
];
/* DC-3 (formato de la STPS): los campos del formulario de emisión
 * (data-catalog.mjs, grupo «dc3»). Cada etiqueta oficial va ARRIBA de su
 * casilla («Nombre (Anotar apellido paterno…)», «Clave Única de Registro de
 * Población», «Nombre del agente capacitador o STPS»), así que las etiquetas
 * se reconocen completas o por su arranque; las firmas del pie llevan el
 * cargo arriba de la línea. */
export const DC3_CONCEPTS = [
  { id: "participante", label: "Nombre del trabajador", path: "record.nombre", kind: "text", shape: "persona",
    labels: [/^nombre \(anotar apellido/, /^nombre( completo)? del (trabajador|participante)/, /^apellido paterno, apellido materno y nombre/] },
  { id: "curp", label: "CURP", path: "record.curp", kind: "text", shape: "curp",
    labels: [/clave unica de registro de poblacion/, /^c\.?u\.?r\.?p\.?$/] },
  { id: "ocupacion", label: "Ocupación específica", path: "record.ocupacion", kind: "text",
    labels: [/^ocupacion especifica/, /^ocupacion$/] },
  { id: "puesto", label: "Puesto", path: "record.puesto", kind: "text", labels: [/^puesto\*?$/] },
  { id: "empresa", label: "Razón social", path: "record.empresa", kind: "text", shape: "empresa",
    labels: [/^nombre o razon social/, /^razon social/, /^nombre de la empresa/] },
  { id: "rfc", label: "RFC", path: "record.rfc", kind: "text", shape: "rfc",
    labels: [/^registro federal de contribuyentes/, /^r\.?f\.?c\.?/] },
  { id: "curso", label: "Nombre del curso", path: "record.nombreCurso", kind: "text", shape: "titulo", labels: [/^nombre del curso/] },
  { id: "duracion", label: "Duración (horas)", path: "record.duracion", kind: "text", shape: "horas", labels: [/^duracion( en horas)?/] },
  { id: "periodo", label: "Fecha de inicio", path: "record.fechaInicio", kind: "text", shape: "fecha", labels: [/^periodo de ejecucion/] },
  { id: "area", label: "Área temática", path: "record.area", kind: "text", labels: [/^area tematica/] },
  { id: "agente", label: "Agente capacitador", path: "record.agente", kind: "text",
    labels: [/^nombre del agente capacitador/, /^agente capacitador/] },
  { id: "instructor", label: "Instructor", path: "record.instructor", kind: "text", shape: "persona",
    labels: [/^instructor( o tutor)?$/], column: /^instructor( o tutor)?$/ },
  { id: "patron", label: "Patrón o representante legal", path: "record.patron", kind: "text", shape: "persona",
    labels: [/^patron( o representante legal)?$/], column: /^patron( o representante legal)?$/ },
  { id: "representanteTrabajadores", label: "Representante de los trabajadores", path: "record.representanteTrabajadores", kind: "text", shape: "persona",
    labels: [/^representante de los trabajadores$/], column: /^representante de los trabajadores$/ }
];

/* Carta responsiva de extintores (grupo «responsiva»). */
export const RESPONSIVA_CONCEPTS = [
  LETTER_CONCEPTS.find(c => c.id === "razonSocial"),
  { id: "domicilio", label: "Domicilio", path: "record.domicilio", kind: "text", shape: "domicilio",
    labels: [/domicilio( ubicado)?( en)?:?$/, /ubicad[oa] en:?$/, /direccion:?$/], inline: /domicilio|ubicad/, hint: /domicilio|direccion|calle/ },
  { id: "factura", label: "Factura / folio", path: "record.factura", kind: "text", shape: "folio",
    labels: [/^(no\.? de )?factura:?$/, /^folio( de factura)?:?$/, /(segun|con) (la )?factura( numero| no\.?)?:?$/], inline: /\bfactura\b/ },
  { id: "fecha", label: "Fecha", path: "record.fecha", kind: "text", shape: "fecha", value: FECHA_TEXT,
    labels: [/^fecha:?$/, /lugar y fecha:?$/], inline: /\bfecha\b|, a\b|\ba los\b/ },
  { id: "alcance", label: "Alcance del servicio", path: "record.alcanceServicio", kind: "text",
    labels: [/alcance( del servicio)?:?$/, /(servicio|trabajos?) realizados?:?$/, /consistente en:?$/], inline: /\balcance\b/ }
];

/* Juego de datos del documento, según el formulario de emisión que lo llena:
 * constancia, DC-3, carta responsiva o cartas para todo lo demás. */
export function conceptsFor(doc) {
  if (isConstancia(doc)) return TEXT_CONCEPTS;
  if (doc?.id === "dc3") return DC3_CONCEPTS;
  if (doc?.id === "carta-responsiva") return RESPONSIVA_CONCEPTS;
  return LETTER_CONCEPTS;
}

/* Texto que casi siempre es fijo en una constancia (título, leyendas) y
 * palabras de etiqueta: un renglón con ellas no es un nombre de persona. */
const FIXED_WORDS = /\b(constancia|reconocimiento|diploma|certificado|participacion|habilidades|competencias|laborales|otorga|presente|haber|concluido|satisfactoriamente)\b/;
const LABEL_WORDS = /\b(registro|numero|stps|impartid[oa]|empresa|curso|duracion|datos|contacto|tel|folio|fecha|calificacion|nombre|firma|sello)\b/;

/* Marcador de relleno: lo que el cliente dejó en lugar del dato («xxxxx»,
 * «XX», «X» suelta, «_____»), con los dígitos pegados a él («0xxxxx26»: el
 * formato de folio del cliente no es parte de la plantilla). Nunca dentro de
 * una palabra («EXXON» no es un marcador). */
const SLOT = /(?<![\p{L}\p{N}])\d*(?:[xX]{2,}|X|_{3,}|\.{4,})\d*(?![\p{L}\p{N}])/u;
export function isPlaceholder(text) {
  const t = String(text ?? "").trim().replace(/^[“"«'‘]+|[”"»'’.,;:]+$/g, "").trim();
  if (!t || SLOT.test(t)) return true;
  if (/^(\d*[xX]{2,}\d*|X|_{3,}|\.{3,})$/.test(t)) return true;
  /* Una etiqueta escrita en lugar del dato: «“Razón Social”», «Nombre». */
  return TEXT_CONCEPTS.some(c => c.labels.some(re => re.test(norm(t))));
}

const SHAPES = {
  fecha: t => new RegExp(`\\b\\d{1,2}\\s+de\\s+(${MONTHS})\\s+(de|del)\\s+\\d{4}\\b`).test(norm(t)) || /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/.test(t) || /\b\d{4}-\d{2}-\d{2}\b/.test(t),
  horas: t => /\b\d{1,3}\s*(h|hrs?|horas?)\b/i.test(t),
  folio: t => /^[A-Z]{0,6}[-/ ]?\d{3,}[A-Z0-9/-]*$/i.test(t.trim()) || /^[A-Z]{2,}-[A-Z0-9-]{3,}$/i.test(t.trim()),
  rfc: t => /^[A-ZÑ&]{3,4}-?\d{6}-?[A-Z0-9]{3}$/i.test(t.replace(/\s/g, "")),
  empresa: t => /\b(s\.?\s?a\.?|s\.?\s?c\.?|de\s+c\.?\s?v\.?|s\.?\s?de\s+r\.?\s?l\.?|s\.?\s?a\.?\s?p\.?\s?i\.?)(\s|$|,)/i.test(t),
  numero: t => /^\d{1,3}([.,]\d{1,2})?$/.test(t.trim()),
  domicilio: t => /(#\s?\d|\bc\.?\s?p\.?\s?\d{5}|\b(av(enida)?|calle|col(onia)?|blvd|boulevard|carretera|km|prolongacion|alcaldia|municipio)\b)/.test(norm(t)),
  scian: t => /^\d{6}$/.test(t.trim()),
  curp: t => /^[A-Z]{4}\d{6}[HMX][A-Z]{5}[A-Z0-9]\d$/i.test(t.replace(/\s/g, "")),
  lugar: t => /,\s*(estado de mexico|cdmx|ciudad de mexico|edo\.? ?mex|mexico)\b/.test(norm(t)),
  persona: t => {
    const words = t.trim().split(/\s+/);
    if (words.length < 2 || words.length > 7 || t.length > 70 || /[\d:;"“”]/.test(t)) return false;
    return words.every(w => /^[\p{L}][\p{L}.'-]*$/u.test(w)) && words.filter(w => /^\p{Lu}/u.test(w)).length >= 2
      && !FIXED_WORDS.test(norm(t)) && !LABEL_WORDS.test(norm(t));
  },
  titulo: t => {
    const words = t.trim().split(/\s+/);
    return words.length >= 2 && t.length <= 140 && !/:$/.test(t) && !FIXED_WORDS.test(norm(t)) && /\p{Lu}/u.test(t);
  }
};
/* La forma sola dice mucho de una fecha o unas horas, y poco de un folio,
 * un nombre o un título (cualquier texto en mayúsculas lo parece). */
const STRONG_SHAPES = new Set(["fecha", "horas", "rfc", "empresa", "curp"]);
const SHAPE_LABELS = { curp: "tiene forma de CURP", domicilio: "tiene forma de domicilio", scian: "tiene forma de código SCIAN", fecha: "tiene forma de fecha", horas: "tiene forma de horas", folio: "tiene forma de folio", rfc: "tiene forma de RFC",
  empresa: "tiene forma de razón social", numero: "es un número corto", lugar: "tiene forma de lugar", persona: "tiene forma de nombre de persona", titulo: "tiene forma de título" };

/* Una etiqueta de carta es el final de un párrafo largo: en la razón sólo
 * se muestra su final. */
const shortText = t => (t.length > 50 ? "…" + t.slice(-45).trimStart() : t);
const labelMatches = (concept, text) => { const t = norm(text).replace(/[:.]+$/, "").trim(); return !!t && concept.labels.some(re => re.test(t)); };

/* «Etiqueta: valor» dentro del mismo renglón. */
function splitOwnLabel(text) {
  const m = /^(.{1,40}?)(\s*[:：]\s*)(.+)$/.exec(text);
  return m ? { label: m[1], sep: m[2], value: m[3] } : null;
}
/* «“valor”» o «“valor.”»: las comillas son diseño de la plantilla. */
function splitQuotes(text) {
  const m = /^([“"«'‘])(.+?)([”"»'’])([.,;]?)$/.exec(text.trim());
  return m ? { open: m[1], inner: m[2], close: m[3] + m[4] } : null;
}
/* El marcador de relleno que ocupa el dato; en una fecha incluye el año que
 * la plantilla trae escrito («xxxxx del 2026»), porque la fecha legible de
 * SafeAutentic ya lo lleva. */
function slotRegex(concept) {
  return concept.id === "fecha" ? new RegExp(SLOT.source + /(?:\s+(?:de|del)\s+\d{4}|\s+\d{4})?/.source, "u") : SLOT;
}

/* Etiquetas vecinas del renglón: a la izquierda en la misma línea base y el
 * renglón inmediatamente arriba (que se traslapa en horizontal o comparte
 * el centro). */
function neighbours(run, runs, pageWidth) {
  /* Un vecino con su propio dato («FOLIO: 0xxxxx26») no es la etiqueta de otro. */
  const bare = r => !SLOT.test(r.text) && !splitOwnLabel(r.text)?.value.trim();
  /* Lejos y sin «:», el texto de la izquierda es otra columna («Nombre ⇥ Puesto
   * ⇥ Firma», «C. ⇥ C.»), no la etiqueta del dato. */
  const labelGap = r => /[:：]\s*$/.test(r.text) || run.box.x0 - r.box.x1 <= run.size * 3;
  const left = runs.filter(r => r !== run && bare(r) && r.page === run.page && Math.abs(r.y - run.y) <= run.size * 0.4 && r.box.x1 <= run.box.x0 + 1 && run.box.x0 - r.box.x1 < pageWidth * 0.45 && labelGap(r))
    .sort((p, q) => q.box.x1 - p.box.x1)[0] || null;
  const centerOf = r => (r.box.x0 + r.box.x1) / 2;
  const above = runs.filter(r => r !== run && bare(r) && r.page === run.page && r.y > run.y && r.y - run.y <= Math.max(run.size, r.size) * 3.2
      && (r.box.x0 < run.box.x1 && run.box.x0 < r.box.x1 || Math.abs(centerOf(r) - centerOf(run)) <= 8))
    .sort((p, q) => p.y - q.y)[0] || null;
  /* Columna de una firma: textos que se traslapan en horizontal, hasta doce
   * cuerpos arriba (el cargo, con «C.» de por medio) o tres abajo; el más
   * cercano primero. */
  const overlaps = r => r.box.x0 < run.box.x1 && run.box.x0 < r.box.x1;
  const column = runs.filter(r => r !== run && r.page === run.page && overlaps(r) && !/^c\.?$/i.test(r.text.trim())
      && (r.y > run.y ? r.y - run.y <= run.size * 12 : run.y - r.y <= run.size * 3.2) && Math.abs(r.y - run.y) > run.size * 0.4)
    .sort((p, q) => Math.abs(p.y - run.y) - Math.abs(q.y - run.y));
  return { left, above, column };
}

/* Plantilla de texto que conserva lo fijo del renglón y pone el dato en su
 * lugar. null = el renglón entero es el dato. */
function templateFor(concept, text, own, quoted) {
  const slot = `{${concept.path}}`;
  const valueTemplate = value => {
    const re = slotRegex(concept);
    if (re.test(value)) return value.replace(re, slot);
    if (concept.id === "duracion" && /\d{1,3}/.test(value)) return value.replace(/\d{1,3}/, slot);
    const q = splitQuotes(value);
    return q ? q.open + slot + q.close : slot;
  };
  if (own) return own.label + own.sep + valueTemplate(own.value);
  /* El dato es parte del renglón («Ciudad de México, a 19 de septiembre de
   * 2024.»): se conserva lo fijo y sólo cambia el dato. */
  const part = concept.value?.exec(text);
  if (part && part[0].trim() !== text.trim()) return text.replace(concept.value, slot);
  const re = slotRegex(concept);
  if (re.test(text)) return text.replace(re, slot);
  if (quoted) return quoted.open + slot + quoted.close;
  if (concept.id === "duracion") { const m = /\d{1,3}/.exec(text); if (m && text.trim() !== m[0]) return text.replace(m[0], slot); }
  return null;
}

/* Sugerencias para un renglón (o el primero de varios).
 *   opts.varying: ids de renglones que cambian entre las páginas de un lote
 *   (pdf-text.mjs › compareBatchPages) — evidencia fuerte de dato variable. */
export function suggestBindings(selected, { runs = selected, pageWidth = 612, fields = [], varying = [], concepts = TEXT_CONCEPTS } = {}) {
  const lines = [...selected].sort((p, q) => q.y - p.y);
  const run = lines[0], text = lines.map(r => r.text).join(" ");
  const own = splitOwnLabel(text), ownLabel = own && own.value.trim() ? own : null;
  const quoted = splitQuotes(text);
  const value = ownLabel ? ownLabel.value : quoted ? quoted.inner : text;
  const slotted = SLOT.test(text);
  const placeholder = slotted || (!!(ownLabel || quoted) && isPlaceholder(value));
  const rest = norm(text.replace(SLOT, " "));
  const varies = lines.some(r => varying.includes(r.id));
  /* Un renglón que es una etiqueta («IMPARTIDO PARA LA EMPRESA», «…el curso
   * de:») no es un dato. */
  const isLabel = !placeholder && !varies && !ownLabel && !quoted
    && (((/:\s*$/.test(text) || LABEL_WORDS.test(norm(text))) && concepts.some(c => labelMatches(c, text)))
      /* «Número de Trabajadores:»: un texto corto que termina en «:» es etiqueta. */
      || (/:\s*$/.test(text) && text.length <= 40));
  /* Parece un dato: con forma, en mayúsculas o con hueco de relleno. Una
   * oración en minúsculas bajo una etiqueta de carta es más redacción. */
  const letters = value.replace(/[^\p{L}]/gu, "");
  const looksLikeData = placeholder || (letters.length >= 4 && letters.replace(/\P{Lu}/gu, "").length / letters.length >= 0.7);
  const { left, above, column } = neighbours(run, runs, pageWidth);
  const used = new Set(fields.flatMap(f => [f.dataKey, ...[...String(f.textTemplate || "").matchAll(/\{([\w.]+)\}/g)].map(m => m[1])]).filter(Boolean));
  const biggestPerson = runs.filter(r => SHAPES.persona(r.text)).sort((p, q) => q.size - p.size)[0];
  const out = [];
  if (isLabel) return out;
  /* Una instrucción entre paréntesis dice qué dato pide: «(Nombre del
   * Responsable Oficial de Protección Civil)», «(señalar domicilio…)». */
  const asks = /^\((.{3,160})\)\W*$/.exec(text.trim())?.[1];
  /* Por el cargo de una firma sólo se vincula un nombre o un hueco suelto,
   * nunca una oración que pasa por la columna. */
  const signable = (SHAPES.persona(value) && /^\p{Lu}/u.test(value.trim())) || (slotted && text.replace(SLOT, "").replace(/\W/g, "").length <= 2) || !!asks;
  for (const concept of concepts) {
    let score = 0; const reasons = [];
    const cargo = signable && concept.column && column.find(r => concept.column.test(norm(r.text)));
    if (asks && concept.hint?.test(norm(asks))) { score += 0.7; reasons.push(`el texto pide «${shortText(asks)}»`); }
    else if (ownLabel && labelMatches(concept, ownLabel.label)) { score += 0.7; reasons.push(`empieza con «${ownLabel.label.trim()}${ownLabel.sep.trim()}»`); }
    else if (slotted && concept.inline?.test(rest)) { score += 0.6; reasons.push(`el renglón dice «${text.replace(SLOT, "…")}»`); }
    else if (concept.value?.test(text) && concept.inline?.test(norm(text))) { score += 0.6; reasons.push(`el renglón dice «${text.slice(0, 60)}»`); }
    else if (left && labelMatches(concept, left.text)) { score += 0.6; reasons.push(`está a la derecha de «${shortText(left.text)}»`); }
    else if (above && labelMatches(concept, above.text) && (!concept.hint || looksLikeData || SHAPES[concept.shape]?.(value))) { score += 0.5; reasons.push(`está debajo de «${shortText(above.text)}»`); }
    else if (cargo) { score += 0.55; reasons.push(`firma con el cargo «${shortText(cargo.text)}»`); }
    const labelled = score > 0;
    if (!placeholder && SHAPES[concept.shape]?.(value)) {
      score += STRONG_SHAPES.has(concept.shape) ? 0.35 : 0.2; reasons.push(SHAPE_LABELS[concept.shape]);
    }
    if (labelled && placeholder) { score += 0.15; reasons.push("trae un marcador de relleno en lugar del dato"); }
    if (labelled && varies) { score += 0.25; reasons.push("cambia entre las páginas del PDF"); }
    if (concept.id === "participante" && biggestPerson === run && run.size >= 14) { score += 0.2; reasons.push("es el nombre más destacado de la hoja"); }
    if (!ownLabel && !placeholder && FIXED_WORDS.test(norm(text)) && concept.shape !== "titulo") score -= 0.3;
    if (score < 0.3) continue;
    out.push({ concept: concept.id, label: concept.label, path: concept.path, template: templateFor(concept, text, ownLabel, quoted),
      score: Math.round(Math.min(score, 1) * 100) / 100, confidence: score >= 0.6 ? "alta" : score >= 0.35 ? "media" : "baja",
      reasons, placeholder, alreadyUsed: used.has(concept.path) });
  }
  return out.sort((p, q) => q.score - p.score || Number(p.alreadyUsed) - Number(q.alreadyUsed)).slice(0, 3);
}

/* Propuesta de mapeo para toda una página: a cada elemento de la constancia
 * el renglón con la mejor sugerencia (confianza media o alta), sin repetir
 * renglones ni elementos, y sin tocar lo que ya está vinculado o tapado. */
export function proposeMappings(runs, { pageWidth = 612, fields = [], isCovered = () => false, varying = [], concepts = TEXT_CONCEPTS } = {}) {
  const used = new Set(fields.flatMap(f => [f.dataKey, ...[...String(f.textTemplate || "").matchAll(/\{([\w.]+)\}/g)].map(m => m[1])]).filter(Boolean));
  const candidates = [];
  for (const run of runs) {
    if (isCovered(run)) continue;
    for (const s of suggestBindings([run], { runs, pageWidth, fields, varying, concepts })) {
      if (s.confidence !== "baja" && !used.has(s.path)) candidates.push({ ...s, run });
    }
  }
  candidates.sort((p, q) => q.score - p.score);
  const takenRuns = new Set(), takenConcepts = new Set(), out = [];
  for (const c of candidates) {
    if (takenRuns.has(c.run.id) || takenConcepts.has(c.concept)) continue;
    takenRuns.add(c.run.id); takenConcepts.add(c.concept);
    out.push(c);
  }
  const order = new Map(concepts.map((c, i) => [c.id, i]));
  return out.sort((p, q) => order.get(p.concept) - order.get(q.concept));
}

/* ¿Es una constancia? Una variante del generador se llama «constancia-…». */
export function isConstancia(doc) { return doc?.id === "constancia" || /^constancia-/.test(doc?.id || ""); }

/* Qué elementos de una constancia ya tiene el documento. */
export function mappingStatus(doc) {
  const fields = doc.fields || [];
  const binds = (f, path) => {
    const key = String(f.dataKey || "").replace(/^data\./, "");
    return key === path || String(f.textTemplate || "").includes(`{${path}}`);
  };
  return CONCEPTS.filter(c => c.required || c.recommended || fields.some(f => binds(f, c.path))).map(c => {
    let field = null;
    if (c.kind === "qr") field = fields.find(f => f.type === "qr");
    else if (c.kind === "image") field = fields.find(f => f.type === "image" && /signaturePng$/.test(String(f.dataKey || "")));
    else if (c.id === "sello") field = fields.find(f => binds(f, "pki.line1") || binds(f, "pki.line2"));
    else field = fields.find(f => binds(f, c.path));
    return { concept: c.id, label: c.label, path: c.path, required: !!c.required, done: !!field, fieldId: field?.id || null, tool: c.tool || null };
  });
}

/* Reubicar el mapeo de otra plantilla (4.4): cada campo de texto del
 * documento de origen busca, en las propuestas de la plantilla nueva, el
 * mismo dato (dataKey o el {dato} de su plantilla de texto). QR, firma y
 * sello se vuelven a colocar en la nueva (no se copian sus coordenadas); lo
 * demás se copia escalado y queda para revisar.
 *   → { matched: [{ field, proposal }], placed: [field], review: [field] } */
export function fieldDataPath(f) {
  if (f.dataKey && f.literalText == null && !f.textTemplate) return String(f.dataKey).replace(/^data\./, "");
  return /\{([\w.]+)\}/.exec(String(f.textTemplate || ""))?.[1] || null;
}
const PLACED_PATHS = new Set(["qrImage", "signaturePng", "record.signaturePng", "pki.line1", "pki.line2"]);
export function planReanchor(sourceFields, proposals) {
  const byPath = new Map(proposals.map(p => [p.path, p]));
  const out = { matched: [], placed: [], review: [] }, used = new Set();
  for (const f of sourceFields) {
    const path = f.type === "qr" ? "qrImage" : fieldDataPath(f) || (f.type === "image" ? String(f.dataKey || "").replace(/^data\./, "") : null);
    if (path && PLACED_PATHS.has(path)) { out.placed.push(f); continue; }
    const p = f.type === "text" && path ? byPath.get(path) : null;
    if (p && !used.has(p.path)) { used.add(p.path); out.matched.push({ field: f, proposal: p }); }
    else out.review.push(f);
  }
  return out;
}
