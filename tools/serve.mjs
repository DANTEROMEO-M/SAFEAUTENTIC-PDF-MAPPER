/* Servidor estático local del PDF Mapper (sin dependencias).

   npm start          → http://127.0.0.1:5179
   PORT=8080 npm start
*/
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = Number(process.env.PORT) || 5179;
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".ico": "image/x-icon", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".pdf": "application/pdf",
  ".ttf": "font/ttf", ".otf": "font/otf"
};

createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split("?")[0]);
  /* `normalize` corta el `../` antes de tocar el disco. */
  const rel = normalize(path === "/" ? "/index.html" : path).replace(/^([\\/]|\.\.)+/, "");
  for (const candidate of [rel, rel + ".html", join(rel, "index.html")]) {
    try {
      const body = await readFile(join(ROOT, candidate));
      /* Sin caché: al editar y recargar se ve siempre la versión actual. */
      res.writeHead(200, { "Content-Type": MIME[extname(candidate)] || "application/octet-stream", "Cache-Control": "no-cache, no-store, must-revalidate" });
      return res.end(body);
    } catch { /* siguiente candidato */ }
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("404 · " + path);
}).listen(PORT, "127.0.0.1", () => console.log(`PDF Mapper → http://127.0.0.1:${PORT}`));
