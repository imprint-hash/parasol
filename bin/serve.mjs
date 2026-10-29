// Local server: `npm start`, then http://localhost:3090
// Serves public/ with clean URLs (/scan → scan.html) and the same security
// headers as vercel.json, and sends /api/* to the router.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, normalize, extname, sep } from "node:path";
import { handle } from "../src/router.js";

const port = Number(process.env.PORT) || 3090;
const PUBLIC = fileURLToPath(new URL("../public", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".json": "application/json", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };

// The same headers Vercel adds, so local testing sees the real CSP.
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const HEADERS = Object.fromEntries((vercel.headers?.[0]?.headers || []).map((h) => [h.key, h.value]));

createServer(async (req, res) => {
  if (req.url.startsWith("/api/") || req.url === "/api") return handle(req, res);
  for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, "http://local").pathname);
  } catch {
    return res.writeHead(400).end("Bad request");
  }
  const clean = !extname(path) && path !== "/" ? `${path}.html` : path;
  const file = normalize(join(PUBLIC, clean.endsWith("/") ? `${clean}index.html` : clean));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + sep)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-cache" }).end(body);
  } catch {
    try {
      res.writeHead(404, { "content-type": TYPES[".html"] }).end(await readFile(join(PUBLIC, "404.html")));
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
    }
  }
}).listen(port, () => console.log(`Parasol on http://localhost:${port}`));
