// Pollinations Studio: a small server that keeps the Pollinations secret key
// on the server and exposes just what the web UI needs.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");

const GEN = "https://gen.pollinations.ai";
const MEDIA = "https://media.pollinations.ai";
const KEY = process.env.POLLINATIONS_KEY;
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const PORT = Number(process.env.PORT) || 3000;
const MAX_UPLOAD = 50 * 1024 * 1024;
const PUBLIC_DIR = path.join(__dirname, "public");

if (!KEY || !KEY.startsWith("sk_")) {
  console.error("POLLINATIONS_KEY must be set to a secret key (sk_...).");
  process.exit(1);
}

const auth = { Authorization: `Bearer ${KEY}` };

// ---------- helpers ----------
function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error("File too large"), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function upstreamError(r) {
  let text = await r.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    text = j.error?.message || j.message || j.error || text;
  } catch {}
  return { status: r.status, message: errorText(text || `Pollinations returned ${r.status}`) };
}

// Job errors can nest the provider's JSON error inside a message string.
function errorText(err) {
  let msg = err;
  for (let i = 0; i < 4 && msg && typeof msg !== "string"; i++) msg = msg.message || msg.error;
  for (let i = 0; i < 4 && typeof msg === "string" && msg.trim().startsWith("{"); i++) {
    try {
      const j = JSON.parse(msg);
      msg = j.error?.message || j.message || (typeof j.error === "string" ? j.error : msg);
      if (typeof msg !== "string") break;
    } catch { break; }
  }
  return typeof msg === "string" && msg ? msg.slice(0, 1000) : "Generation failed";
}

function checkPassword(req) {
  if (!APP_PASSWORD) return true;
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  const pass = Buffer.from(h.slice(6), "base64").toString().split(":").slice(1).join(":");
  const a = crypto.createHash("sha256").update(pass).digest();
  const b = crypto.createHash("sha256").update(APP_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// Results that came back directly (cached, HTTP 200) instead of as a job.
const localResults = new Map();
function storeLocal(buf, contentType) {
  const id = crypto.randomBytes(12).toString("hex");
  localResults.set(id, { buf, contentType });
  setTimeout(() => localResults.delete(id), 60 * 60 * 1000).unref();
  return id;
}

// ---------- models ----------
let modelCache = { at: 0, data: null };
async function getModels() {
  if (modelCache.data && Date.now() - modelCache.at < 5 * 60 * 1000) return modelCache.data;
  const r = await fetch(`${GEN}/image/models`, { headers: auth });
  if (!r.ok) throw Object.assign(new Error((await upstreamError(r)).message), { status: 502 });
  const raw = await r.json();
  const list = Array.isArray(raw) ? raw : raw.data || [];
  const data = list
    .map((m) => {
      const out = m.output_modalities || [];
      const inp = m.input_modalities || [];
      const kind = out.includes("video") ? "video" : out.includes("image") ? "image" : null;
      return kind && {
        id: m.name || m.id,
        title: m.title || m.name || m.id,
        description: m.description || "",
        kind,
        acceptsImage: inp.includes("image"),
        videoCapabilities: m.video_capabilities || [],
        maxReferenceImages: m.max_reference_images ?? (inp.includes("image") ? 1 : 0),
        resolutions: m.resolutions || [],
        durations: kind === "video" ? {
          min: m.min_duration ?? null,
          max: m.max_duration ?? null,
          default: m.default_duration ?? null,
          allowed: Array.isArray(m.allowed_durations) ? m.allowed_durations : null,
        } : null,
        paidOnly: !!m.paid_only,
      };
    })
    .filter(Boolean);
  modelCache = { at: Date.now(), data };
  return data;
}

// ---------- generation ----------
const IMAGE_PARAMS = ["width", "height", "seed", "quality", "resolution"];
const VIDEO_PARAMS = ["width", "height", "seed", "duration", "aspectRatio", "audio", "resolution"];

async function generate(body) {
  const kind = body.kind === "video" ? "video" : "image";
  const prompt = String(body.prompt || "").trim();
  if (!prompt) throw Object.assign(new Error("Prompt is required"), { status: 400 });
  if (prompt.length > 4000) throw Object.assign(new Error("Prompt is too long"), { status: 400 });

  const qs = new URLSearchParams();
  if (body.model) qs.set("model", String(body.model));
  for (const p of kind === "video" ? VIDEO_PARAMS : IMAGE_PARAMS) {
    const v = body[p];
    if (v !== undefined && v !== null && v !== "") qs.set(p, String(v));
  }
  const images = (Array.isArray(body.images) ? body.images : []).filter(
    (u) => typeof u === "string" && /^https:\/\//.test(u)
  );
  if (images.length) qs.set("image", images.join("|"));

  const url = `${GEN}/${kind}/${encodeURIComponent(prompt)}?${qs}`;
  const r = await fetch(url, { headers: { ...auth, Prefer: "respond-async" } });

  if (r.status === 202) {
    const j = await r.json();
    return { jobId: j.id, status: j.status || "pending" };
  }
  if (r.ok) {
    const contentType = r.headers.get("content-type") || (kind === "video" ? "video/mp4" : "image/jpeg");
    if (contentType.includes("application/json")) {
      const j = await r.json();
      if (j.id) return { jobId: j.id, status: j.status || "pending" };
    }
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: "succeeded", resultUrl: `/api/local/${storeLocal(buf, contentType)}`, contentType };
  }
  const e = await upstreamError(r);
  throw Object.assign(new Error(e.message || `Pollinations returned ${e.status}`), { status: e.status });
}

// ---------- static files ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
function serveStatic(req, res) {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, rel === "/" ? "index.html" : rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 404, { error: "Not found" });
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: "Not found" });
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

// ---------- router ----------
const server = http.createServer(async (req, res) => {
  try {
    if (!checkPassword(req)) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Pollinations Studio"' });
      return res.end("Password required");
    }
    const { pathname } = new URL(req.url, "http://x");

    if (req.method === "GET" && pathname === "/api/models") {
      return sendJson(res, 200, await getModels());
    }

    if (req.method === "POST" && pathname === "/api/upload") {
      const type = String(req.headers["content-type"] || "");
      if (!type.startsWith("image/")) return sendJson(res, 415, { error: "Only image uploads are supported" });
      const buf = await readBody(req, MAX_UPLOAD);
      const r = await fetch(`${MEDIA}/upload`, {
        method: "POST",
        headers: { ...auth, "Content-Type": type, "Content-Length": String(buf.length) },
        body: buf,
      });
      if (!r.ok) {
        const e = await upstreamError(r);
        return sendJson(res, e.status, { error: e.message });
      }
      const j = await r.json();
      return sendJson(res, 200, { url: j.url, id: j.id });
    }

    if (req.method === "POST" && pathname === "/api/generate") {
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString() || "{}");
      return sendJson(res, 200, await generate(body));
    }

    let m = pathname.match(/^\/api\/jobs\/([A-Za-z0-9_-]{1,128})$/);
    if (req.method === "GET" && m) {
      const r = await fetch(`${GEN}/v1/jobs/${m[1]}`, { headers: auth });
      if (!r.ok) {
        const e = await upstreamError(r);
        return sendJson(res, e.status, { error: e.message });
      }
      const job = await r.json();
      if (job.error) job.error = errorText(job.error);
      return sendJson(res, 200, job);
    }

    m = pathname.match(/^\/api\/jobs\/([A-Za-z0-9_-]{1,128})\/result$/);
    if (req.method === "GET" && m) {
      const headers = { ...auth };
      if (req.headers.range) headers.Range = req.headers.range;
      const r = await fetch(`${GEN}/v1/jobs/${m[1]}/result`, { headers });
      if (!r.ok && r.status !== 206) {
        const e = await upstreamError(r);
        return sendJson(res, e.status, { error: e.message });
      }
      const out = { "Cache-Control": "private, max-age=86400" };
      for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const v = r.headers.get(h);
        if (v) out[h] = v;
      }
      res.writeHead(r.status, out);
      return Readable.fromWeb(r.body).pipe(res);
    }

    m = pathname.match(/^\/api\/local\/([a-f0-9]{24})$/);
    if (req.method === "GET" && m) {
      const item = localResults.get(m[1]);
      if (!item) return sendJson(res, 404, { error: "Result expired" });
      res.writeHead(200, { "Content-Type": item.contentType, "Content-Length": item.buf.length });
      return res.end(item.buf);
    }

    if (req.method === "GET" && !pathname.startsWith("/api/")) return serveStatic(req, res);
    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error(err);
    if (!res.headersSent) sendJson(res, status, { error: err.message || "Server error" });
    else res.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`Pollinations Studio on http://localhost:${PORT}${APP_PASSWORD ? " (password protected)" : ""}`);
});
