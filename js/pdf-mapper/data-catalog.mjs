/* Catálogo de los datos que SafeAutentic YA captura y entrega a los renderers
 * de documentos — transcrito el 2026-09-24 leyendo el flujo real de emisión:
 *   js/index-logic.js   → payload por tipo (CONSTANCIA, CARTA_CORRESPONSABILIDAD,
 *                          CARTAS_CDMX, CARTA_RESPONSIVA, OTRO), _collectDc3Fields,
 *                          _generarDC3PDFBytes, _fillClientFields (expediente)
 *   js/shared/pdf.js    → data de la constancia (record, qrImage, signaturePng, pki)
 *   config/client/client.documents.mjs → qué lee cada render (data.record || data)
 *
 * Para qué sirve en PDF Mapper:
 *  - proponer claves de datos y valores de muestra realistas al mapear;
 *  - decirle a la IA, en el paquete exportado, qué claves ya existen en la
 *    plataforma y cuáles son NUEVAS (un documento que todavía no existe en
 *    SafeAutentic necesitará que alguien las capture en un formulario).
 *
 * No es un contrato ejecutable: si el flujo de emisión cambia, este catálogo
 * se actualiza a mano igual que SEED_DOCUMENTS.
 *
 * Las claves son rutas RELATIVAS a "data" (el argumento del render), igual
 * que las resuelve el código exportado: "record.nombre" → data.record.nombre,
 * "signaturePng" → data.signaturePng. "aliases" recoge otras formas que ya
 * aparecen en el proyecto para el mismo dato (p. ej. "record.logoPng", que el
 * render de DC-3 lee como respaldo), y "data.X" se trata como "X".
 *
 * "delivered" (grupo) + "documents" (grupo o entrada): la clave llega hoy en
 * "data" al render de esos documentos. delivered: false = el dato existe en
 * la plataforma (expediente) pero hoy no se entrega a ningún render. */

export const DATA_GROUPS = [
  {
    id: "constancia", label: "Constancia (formulario de emisión)", documents: ["constancia"], delivered: true,
    paths: [
      { path: "record.nombre", label: "Nombre del participante", example: "Juan Pérez Ejemplo" },
      { path: "record.folio", label: "Folio", example: "DEMO-000123" },
      { path: "record.nombreCurso", label: "Nombre del curso", example: "Protección Civil Básica" },
      { path: "record.empresa", label: "Empresa", example: "Empresa Ejemplo S.A. de C.V." },
      { path: "record.municipio", label: "Municipio / dirección", example: "Toluca, Estado de México" },
      { path: "record.rfc", label: "RFC de la empresa", example: "EEJ900101AB1" },
      { path: "record.fecha", label: "Fecha legible", example: "5 de septiembre del 2026" },
      { path: "record.fechaRaw", label: "Fecha ISO", example: "2026-09-05" },
      { path: "record.duracion", label: "Duración (horas)", example: "8" },
      { path: "record.calificacion", label: "Calificación", example: "10" }
    ]
  },
  {
    id: "dc3", label: "DC-3 (datos del participante)", documents: ["dc3"], delivered: true,
    paths: [
      { path: "record.nombre", label: "Nombre del trabajador", example: "Juan Pérez Ejemplo" },
      { path: "record.curp", label: "CURP (18)", example: "PEJJ900101HDFRXN01", kind: "characters" },
      { path: "record.ocupacion", label: "Ocupación específica", example: "Operador" },
      { path: "record.puesto", label: "Puesto", example: "Técnico de mantenimiento" },
      { path: "record.empresa", label: "Razón social", example: "Empresa Ejemplo S.A. de C.V." },
      { path: "record.rfc", label: "RFC (13)", example: "PEJJ900101AB1", kind: "characters" },
      { path: "record.rfcDisplay", label: "RFC con guiones para casillas", example: "PEJ-900101-AB1", kind: "characters" },
      { path: "record.nombreCurso", label: "Nombre del curso", example: "Protección Civil Básica" },
      { path: "record.duracion", label: "Duración (horas)", example: "8" },
      { path: "record.fechaInicio", label: "Fecha de inicio (ISO)", example: "2026-01-01" },
      { path: "record.fechaFin", label: "Fecha de término (ISO)", example: "2026-01-02" },
      { path: "record.fechaInicioDigits", label: "Inicio AAAAMMDD para casillas", example: "20260101", kind: "characters" },
      { path: "record.fechaFinDigits", label: "Término AAAAMMDD para casillas", example: "20260102", kind: "characters" },
      { path: "record.area", label: "Área temática", example: "6000 SEGURIDAD" },
      { path: "record.agente", label: "Agente capacitador", example: "Consultor Ejemplo" },
      { path: "record.instructor", label: "Instructor", example: "Instructor Ejemplo" },
      { path: "record.patron", label: "Patrón o representante legal", example: "Patrón Ejemplo" },
      { path: "record.representanteTrabajadores", label: "Representante de los trabajadores", example: "Representante Ejemplo" }
    ]
  },
  {
    id: "carta", label: "Carta de corresponsabilidad / Cartas CDMX", documents: ["carta", "cartas-cdmx"], delivered: true,
    paths: [
      { path: "record.nombreCliente", label: "Nombre del responsable", example: "Juan Pérez Ejemplo" },
      { path: "record.razonSocial", label: "Razón social", example: "Empresa Ejemplo S.A. de C.V." },
      /* El formulario copia la razón social también en "empresa" (payload). */
      { path: "record.empresa", label: "Razón social (copia en «empresa»)", example: "Empresa Ejemplo S.A. de C.V." },
      { path: "record.municipio", label: "Municipio / dirección", example: "Toluca, Estado de México" },
      { path: "record.fecha", label: "Fecha con lugar", example: "Estado de México, a 5 de septiembre de 2026." },
      { path: "record.fechaCdmx", label: "Fecha legible", example: "5 de septiembre de 2026" },
      { path: "record.fechaRaw", label: "Fecha ISO", example: "2026-09-05" },
      { path: "record.nombreComercial", label: "Nombre comercial (CDMX)", example: "Comercial Ejemplo" },
      { path: "record.actividadEconomica", label: "Actividad económica (CDMX)", example: "Comercio al por menor" },
      { path: "record.scian", label: "Código SCIAN (CDMX)", example: "461110" }
    ]
  },
  {
    id: "responsiva", label: "Carta responsiva de extintores", documents: ["carta-responsiva"], delivered: true,
    paths: [
      { path: "record.razonSocial", label: "Razón social", example: "Empresa Ejemplo S.A. de C.V." },
      { path: "record.domicilio", label: "Domicilio", example: "Av. Ejemplo 123, Toluca" },
      { path: "record.factura", label: "Factura / folio", example: "F-000123" },
      { path: "record.fecha", label: "Fecha legible", example: "5 de septiembre de 2026" },
      { path: "record.alcanceServicio", label: "Alcance del servicio", example: "Recarga y mantenimiento" },
      { path: "record.equipos", label: "Equipos (lista: cantidad, concepto…)", example: "[lista]", kind: "list" }
    ]
  },
  {
    id: "otro", label: "Otro documento", documents: [], delivered: true,
    paths: [
      { path: "record.tituloDocumento", label: "Título del documento", example: "Constancia de participación" },
      { path: "record.nombre", label: "Nombre", example: "Juan Pérez Ejemplo" },
      { path: "record.folio", label: "Folio", example: "000" },
      { path: "record.municipio", label: "Municipio", example: "Toluca, Estado de México" }
    ]
  },
  {
    id: "imagenes", label: "Imágenes que genera la plataforma", documents: [], delivered: true,
    paths: [
      { path: "signaturePng", aliases: ["record.signaturePng"], label: "Firma autógrafa del emisor", example: "(imagen)", kind: "image", documents: ["constancia", "dc3", "carta", "cartas-cdmx", "carta-responsiva"] },
      { path: "qrImage", label: "QR de verificación (constancia)", example: "(imagen)", kind: "image", documents: ["constancia"] },
      { path: "qrPng", aliases: ["record.qrPng"], label: "QR de verificación (cartas)", example: "(imagen)", kind: "image", documents: ["carta", "cartas-cdmx", "carta-responsiva"] },
      { path: "logoPng", aliases: ["record.logoPng"], label: "Logo del emisor (DC-3)", example: "(imagen)", kind: "image", documents: ["dc3"] }
    ]
  },
  {
    id: "pki", label: "Sello PKI (constancia)", documents: ["constancia"], delivered: true,
    paths: [
      { path: "pki.line1", label: "Sello — línea 1", example: "* DOCUMENTO FIRMADO DIGITALMENTE - SafeAutentic PKI" },
      { path: "pki.line2", label: "Sello — línea 2", example: "Emitido por: Emisor Ejemplo   Serial: 0001" }
    ]
  },
  {
    /* Sólo DC-3 recibe hoy el perfil completo (_generarDC3PDFBytes → data.profile). */
    id: "emisor", label: "Emisor (perfil del consultor)", documents: ["dc3"], delivered: true,
    paths: [
      { path: "profile.nombreConsultor", label: "Nombre del consultor", example: "Consultor Ejemplo" },
      { path: "profile.empresaEmisora", label: "Empresa emisora", example: "Consultoría Ejemplo S.C." },
      { path: "profile.rfcEmisor", label: "RFC del emisor", example: "CEJ900101AB1" },
      { path: "profile.direccionEmisor", label: "Dirección del emisor", example: "Calle Ejemplo 45, CDMX" },
      { path: "profile.telefonoEmisor", label: "Teléfono del emisor", example: "55 0000 0000" },
      { path: "profile.registroStps", label: "Registro STPS", example: "EJE-000000-0000" },
      { path: "profile.email", label: "Correo del emisor", example: "emisor@ejemplo.mx" }
    ]
  },
  {
    id: "cliente", label: "Cliente (expediente seleccionado)", documents: [], delivered: false,
    paths: [
      { path: "cliente.empresa", label: "Empresa", example: "Empresa Ejemplo S.A. de C.V." },
      { path: "cliente.encargado", label: "Encargado", example: "Juan Pérez Ejemplo" },
      { path: "cliente.rfc", label: "RFC", example: "EEJ900101AB1" },
      { path: "cliente.direccion", label: "Dirección", example: "Av. Ejemplo 123, Toluca" },
      { path: "cliente.municipio", label: "Municipio", example: "Toluca" },
      { path: "cliente.telefono", label: "Teléfono", example: "722 000 0000" },
      { path: "cliente.correo", label: "Correo", example: "contacto@ejemplo.mx" },
      { path: "cliente.giro", label: "Giro", example: "Manufactura" },
      { path: "cliente.numEmpleados", label: "Número de empleados", example: "25" }
    ]
  }
];

/* Clasifica una clave usada en un documento:
 *  "delivered" — la plataforma ya la entrega al render de ESTE documento;
 *  "platform"  — existe en la plataforma (otro documento, expediente o perfil)
 *                pero habría que entregarla a este render;
 *  "new"       — SafeAutentic no la captura hoy: hay que agregarla al
 *                formulario de emisión. */
export function normalizeDataPath(path) {
  return String(path || "").replace(/^data\./, "");
}
function matches(entry, path) {
  return entry.path === path || !!entry.aliases?.includes(path);
}
export function classifyDataPath(path, documentId) {
  const key = normalizeDataPath(path);
  let best = null;
  for (const group of DATA_GROUPS) {
    const entry = group.paths.find(p => matches(p, key));
    if (!entry) continue;
    const documents = entry.documents || group.documents;
    if (group.delivered && documents.includes(documentId)) return { status: "delivered", entry, group };
    best = best || { status: "platform", entry, group };
  }
  return best || { status: "new", entry: null, group: null };
}

/* Peor caso realista de cada dato, para el juego de muestra «Textos largos»
 * (prueba de estrés del preflight): nombres compuestos, razones sociales
 * completas, direcciones con colonia. Un valor por grupo cuando el formato
 * cambia según el documento (la fecha de la carta lleva el lugar). */
const LONG_NAME = "María Guadalupe Fernández de la Barrera Villaseñor";
const LONG_PERSON = "Ing. José Luis Hernández de la Fuente Castañeda";
const LONG_COMPANY = "Servicios Integrales de Mantenimiento Industrial y Comercial del Valle de Toluca, S.A.P.I. de C.V.";
const LONG_CONSULTANCY = "Consultoría Integral en Seguridad y Protección Civil del Centro, S.C.";
const LONG_ADDRESS = "Av. Paseo Tollocan 1234 Int. 5, Col. Santa Ana Tlapaltitlán, Toluca, Estado de México";
const LONG_DATE = "28 de septiembre de 2026";
const LONG_EXAMPLES = {
  "record.nombre": LONG_NAME,
  "record.nombreCliente": LONG_NAME,
  "record.nombreCurso": "Formación de Brigadas Multifuncionales de Protección Civil: Primeros Auxilios, Evacuación y Combate de Incendios",
  "record.empresa": LONG_COMPANY,
  "record.razonSocial": LONG_COMPANY,
  "record.municipio": LONG_ADDRESS,
  "record.domicilio": LONG_ADDRESS,
  "record.fecha": { constancia: "28 de septiembre del 2026", carta: "Estado de México, a 28 de septiembre de 2026.", responsiva: LONG_DATE },
  "record.fechaCdmx": LONG_DATE,
  "record.ocupacion": "Supervisor de Seguridad, Higiene y Medio Ambiente",
  "record.puesto": "Coordinador de Mantenimiento Preventivo y Correctivo de Instalaciones",
  "record.agente": LONG_CONSULTANCY,
  "record.instructor": LONG_PERSON,
  "record.patron": "Lic. María Fernanda Gutiérrez de los Monteros Ruiz",
  "record.representanteTrabajadores": "Juan Carlos Rodríguez de la Peña Villalobos",
  "record.nombreComercial": "Abarrotes y Materias Primas La Esperanza del Valle de México",
  "record.actividadEconomica": "Comercio al por menor de abarrotes, ultramarinos y misceláneas",
  "record.alcanceServicio": "Recarga, mantenimiento preventivo y prueba hidrostática de extintores de PQS y CO2",
  "record.tituloDocumento": "Constancia de participación en el simulacro de evacuación por sismo",
  "profile.nombreConsultor": LONG_PERSON,
  "profile.empresaEmisora": LONG_CONSULTANCY,
  "profile.direccionEmisor": "Calle Josefa Ortiz de Domínguez 1520 Int. 3, Col. Centro, Cuauhtémoc, Ciudad de México",
  "cliente.empresa": LONG_COMPANY,
  "cliente.encargado": LONG_NAME,
  "cliente.direccion": LONG_ADDRESS,
  "cliente.municipio": "San Juan Bautista Tuxtepec",
  "cliente.giro": "Fabricación de estructuras metálicas y productos de herrería"
};
export function longExampleFor(path, documentId) {
  const key = normalizeDataPath(path);
  const value = LONG_EXAMPLES[key];
  if (value == null || typeof value === "string") return value ?? null;
  return value[classifyDataPath(key, documentId).group?.id] ?? Object.values(value)[0];
}
/* Valor de estrés para una clave: el peor caso del catálogo; si no lo hay, el
 * valor actual alargado (≈1.8×) repitiendo sus palabras. Códigos, fechas y
 * números tienen longitud fija y se dejan igual. */
export function stressValue(path, value, documentId) {
  const known = longExampleFor(path, documentId);
  if (known != null) return known;
  const text = String(value ?? "");
  if (!/\p{L}{3}/u.test(text) || (/\d/.test(text) && !/\s/.test(text))) return value;
  const words = text.split(/\s+/).filter(Boolean);
  let out = text;
  for (let i = 0; out.length < text.length * 1.8; i++) out += " " + words[i % words.length];
  return out;
}

/* Valor de ejemplo del catálogo para una clave (null si no existe o si es una
 * imagen/lista, que no tienen un ejemplo de texto). */
export function exampleFor(path) {
  const key = normalizeDataPath(path);
  for (const group of DATA_GROUPS) {
    const entry = group.paths.find(p => matches(p, key));
    if (entry && entry.kind !== "image" && entry.kind !== "list") return entry.example;
  }
  return null;
}
