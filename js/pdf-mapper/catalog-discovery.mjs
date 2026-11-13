/* Descubrimiento del catálogo de client.documents.mjs a partir de su TEXTO
 * (nunca se importa ni se ejecuta ese archivo). Compartido por PDF Mapper y
 * Template Studio: antes cada página tenía su propia copia y la de Template
 * Studio se quedó con la versión vieja, que exigía "label" seguido de
 * "template" en ese orden exacto y dejaba de descubrir un documento si alguien
 * reordenaba sus propiedades. */

/* Índice del cierre que balancea el "(", "{" o "[" en openIdx, saltando
 * strings; -1 si no cierra. */
export function scanBalanced(text, openIdx) {
  const open = text[openIdx];
  const close = open === "(" ? ")" : open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) return -1;
  let depth = 0, inStr = null;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === "\\") { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/* Ubica cada objeto del catálogo por llave balanceada y busca sus
 * propiedades dentro del bloque sin importar el orden. "template" se devuelve
 * como nombre de archivo pelado: client.documents.mjs lo declara con la
 * carpeta ("templates/x.pdf") y los consumidores arman la ruta completa. Una
 * entrada que apunta a una constante (p. ej. CARTA_CDMX_DOCUMENT) no se puede
 * clasificar leyendo este archivo y se reporta como recognized: false. */
export function discoverFromSource(text) {
  const found = [];
  const idRe = /(["']?)([\w-]+)\1\s*:\s*\{/g;
  let m;
  while ((m = idRe.exec(text))) {
    const braceOpen = m.index + m[0].length - 1;
    const braceClose = scanBalanced(text, braceOpen);
    if (braceClose < 0) continue;
    const block = text.slice(braceOpen + 1, braceClose);
    const label = block.match(/label\s*:\s*"([^"]+)"/);
    const template = block.match(/template\s*:\s*"([^"]+)"/);
    if (!label || !template) continue;
    const render = block.match(/render\s*:\s*(\w+)/);
    found.push({ id: m[2], label: label[1], template: template[1].split("/").pop(), render: render ? render[1] : null, recognized: true });
  }
  const bareRef = /(["']?)([\w-]+)\1\s*:\s*([A-Z][A-Z0-9_]*)\s*[,}]/g;
  while ((m = bareRef.exec(text))) {
    if (found.some(f => f.id === m[2])) continue;
    found.push({ id: m[2], label: m[2], template: null, recognized: false, refName: m[3] });
  }
  return found;
}
