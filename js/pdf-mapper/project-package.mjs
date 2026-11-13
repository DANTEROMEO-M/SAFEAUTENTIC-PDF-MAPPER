/* Paquete de integración de PDF Mapper — un solo ZIP con todo lo que una
 * plantilla mapeada necesita para llegar a producción y para retomarse en
 * otro navegador.
 *
 * Las rutas reflejan la carpeta public/ del repositorio, así que basta con
 * descomprimirlo ahí:
 *   config/client/templates/<plantilla>.pdf      plantilla (editada, si aplica)
 *   config/client/assets/fonts/<fuente>.ttf      fuentes del cliente que se usan
 *   tools/pdf-mapper/<id>/render.js              código para client.documents.mjs
 *   tools/pdf-mapper/<id>/ia.md                  paquete para IA
 *   tools/pdf-mapper/<id>/mapa.json              mapa neutral
 *   tools/pdf-mapper/<id>/proyecto.json          proyecto para «Abrir proyecto»
 *   tools/pdf-mapper/<id>/original.pdf           PDF original (sólo si se editó)
 *   tools/pdf-mapper/<id>/LEEME.md               contenido y huellas
 * tools/ no se publica en el hosting: el proyecto viaja con el repositorio
 * sin quedar expuesto.
 *
 * Módulo puro (sólo crypto.subtle para las huellas). La página arma el ZIP
 * con JSZip y lo lee de vuelta. */

export const PROJECT_SCHEMA = "safeautentic.pdf-mapper/project";
export const PROJECT_VERSION = 1;

const enc = new TextEncoder();
export async function sha256Hex(bytes) {
  const data = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function packagePaths(doc) {
  const dir = `tools/pdf-mapper/${doc.id}`;
  return {
    dir,
    template: `config/client/templates/${doc.template}`,
    font: fileName => `config/client/assets/fonts/${fileName}`,
    render: `${dir}/render.js`, brief: `${dir}/ia.md`, map: `${dir}/mapa.json`,
    project: `${dir}/proyecto.json`, original: `${dir}/original.pdf`, readme: `${dir}/LEEME.md`
  };
}

/* Fuentes del cliente que usa algún campo (las demás no viajan). */
export function fontsInUse(doc) {
  return Object.entries(doc.customFonts || {}).filter(([key]) => (doc.fields || []).some(f => f.fontFile === key));
}

/*
 * input: {
 *   doc, versions, ui, fingerprint, generatedAt,
 *   code, brief, map,                      textos del export
 *   templateBytes,                         plantilla que se integra (editada si aplica)
 *   originalBytes,                         PDF original (requerido si hay ediciones de plantilla o texto)
 *   fontBytes: { [sha256]: Uint8Array }
 * }
 * → { entries: [{ path, data }], manifest, missing: [mensajes] }
 */
export async function buildPackage({ doc, versions = [], ui = null, fingerprint = null, generatedAt = new Date().toISOString(),
  code, brief, map, templateBytes, originalBytes = null, fontBytes = {} }) {
  const p = packagePaths(doc);
  const entries = [], files = {}, missing = [];
  const add = async (path, data, role) => {
    entries.push({ path, data });
    files[path] = { role, sha256: await sha256Hex(data), bytes: typeof data === "string" ? enc.encode(data).length : data.length };
  };
  if (!templateBytes) missing.push(`No se encontró la plantilla «${doc.template}».`);
  else await add(p.template, templateBytes, "template");
  const edited = (doc.templateEdits || []).length > 0 || (doc.textEdits || []).length > 0;
  if (edited) {
    if (originalBytes) await add(p.original, originalBytes, "original");
    else missing.push("No se encontró el PDF original: el proyecto no podrá volver a editar la plantilla.");
  }
  for (const [key, font] of fontsInUse(doc)) {
    const bytes = fontBytes[font.sha256];
    if (!bytes) { missing.push(`Falta el archivo de la fuente «${font.family}» en este navegador.`); continue; }
    if (await sha256Hex(bytes) !== font.sha256) { missing.push(`El archivo de «${font.family}» no coincide con su huella.`); continue; }
    await add(p.font(font.fileName), bytes, "font:" + key);
  }
  await add(p.render, code, "render");
  await add(p.brief, brief, "brief");
  await add(p.map, map, "map");
  const manifest = {
    schema: PROJECT_SCHEMA, version: PROJECT_VERSION, generatedAt, fingerprint,
    doc: JSON.parse(JSON.stringify(doc)), versions: JSON.parse(JSON.stringify(versions || [])), ui: ui ? JSON.parse(JSON.stringify(ui)) : null,
    files
  };
  await add(p.project, JSON.stringify(manifest, null, 2), "project");
  await add(p.readme, buildReadme(doc, manifest, p), "readme");
  return { entries, manifest, missing };
}

export function buildReadme(doc, manifest, p = packagePaths(doc)) {
  const roles = { template: "Plantilla que se integra", original: "PDF original del cliente (para volver a editar)", render: "Código para client.documents.mjs",
    brief: "Paquete para IA", map: "Mapa neutral (coordenadas y campos)", project: "Proyecto de PDF Mapper (Abrir proyecto)" };
  const lines = [
    `# «${doc.label}» (\`${doc.id}\`) — paquete de PDF Mapper`, "",
    `Generado el ${String(manifest.generatedAt).slice(0, 10)}${manifest.fingerprint ? ` · mapa \`${manifest.fingerprint}\`` : ""}.`, "",
    "## Cómo usarlo", "",
    "1. Descomprime este ZIP en la carpeta `public/` del repositorio: la plantilla y las fuentes quedan en su lugar dentro de `config/client/`.",
    `2. Entrega \`${p.brief}\` a la IA: dice qué pegar en \`config/client/client.documents.mjs\` (el código está en \`${p.render}\`).`,
    `3. Para seguir editando en otro navegador: PDF Mapper → «Abrir proyecto» y elige este ZIP.`, "",
    "`tools/` no se publica en el hosting; conviene versionarlo para conservar el proyecto.", "",
    "## Contenido", "", "| Archivo | Qué es | SHA-256 |", "|---|---|---|"
  ];
  for (const [path, f] of Object.entries(manifest.files)) {
    const role = f.role.startsWith("font:") ? `Fuente «${doc.customFonts?.[f.role.slice(5)]?.family || f.role.slice(5)}»` : roles[f.role] || f.role;
    lines.push(`| \`${path}\` | ${role} | \`${f.sha256}\` |`);
  }
  return lines.join("\n") + "\n";
}

/* Proyecto leído de un ZIP: verifica esquema y huellas y devuelve lo que
 * hace falta para restaurarlo. files: Map(ruta → Uint8Array). */
export async function readPackage(files) {
  const projectPath = [...files.keys()].find(p => /^tools\/pdf-mapper\/[^/]+\/proyecto\.json$/.test(p));
  if (!projectPath) throw new Error("El ZIP no trae un proyecto de PDF Mapper (tools/pdf-mapper/<id>/proyecto.json).");
  let manifest;
  try { manifest = JSON.parse(new TextDecoder().decode(files.get(projectPath))); }
  catch { throw new Error("proyecto.json no es un JSON válido."); }
  if (manifest.schema !== PROJECT_SCHEMA) throw new Error("proyecto.json no es un proyecto de PDF Mapper.");
  if (manifest.version > PROJECT_VERSION) throw new Error(`El proyecto es de una versión más nueva de PDF Mapper (${manifest.version}).`);
  const doc = manifest.doc, p = packagePaths(doc), problems = [];
  const verified = async (path, required) => {
    const data = files.get(path), expected = manifest.files?.[path]?.sha256;
    if (!data) { if (required) problems.push(`Falta ${path}.`); return null; }
    if (expected && await sha256Hex(data) !== expected) { problems.push(`${path} cambió después de exportarse (su huella no coincide).`); return null; }
    return data;
  };
  const edited = (doc.templateEdits || []).length > 0 || (doc.textEdits || []).length > 0;
  /* Las ediciones se aplican sobre el ORIGINAL; sin ediciones, la plantilla es el original. */
  const originalBytes = edited ? await verified(p.original, true) : await verified(p.template, true);
  const fonts = [];
  for (const [key, font] of fontsInUse(doc)) {
    const data = await verified(p.font(font.fileName), true);
    if (data) fonts.push({ key, sha256: font.sha256, bytes: data });
  }
  return { doc, versions: manifest.versions || [], ui: manifest.ui || null, fingerprint: manifest.fingerprint || null, originalBytes, fonts, problems };
}
