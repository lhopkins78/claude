// Local / Docker server: serves public/ and hands /api/* to lib/api.mjs.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { handleApi } from "./lib/api.mjs";

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(import.meta.dirname, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const env = { key: process.env.POLLINATIONS_KEY, appPassword: process.env.APP_PASSWORD || "" };

if (!env.key?.startsWith("sk_")) {
  console.error("POLLINATIONS_KEY must be set to a secret key (sk_...).");
  process.exit(1);
}

function serveStatic(pathname, res) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return void res.writeHead(404).end("Not found");
  fs.readFile(file, (err, data) => {
    if (err) return void res.writeHead(404).end("Not found");
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" }).end(data);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (!url.pathname.startsWith("/api/")) {
    return req.method === "GET" ? serveStatic(url.pathname, res) : void res.writeHead(405).end();
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const request = new Request(url, {
    method: req.method,
    headers: Object.entries(req.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]])),
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? "half" : undefined,
  });
  const response = await handleApi(request, env);
  const headers = {};
  response.headers.forEach((v, k) => (headers[k] = k === "set-cookie" ? response.headers.getSetCookie() : v));
  res.writeHead(response.status, headers);
  if (response.body) Readable.fromWeb(response.body).pipe(res);
  else res.end();
}).listen(PORT, () => {
  console.log(`Pollinations Studio on http://localhost:${PORT}${env.appPassword ? " (password protected)" : ""}`);
});
