// Pollinations Studio API, written against web-standard Request/Response so the
// same code runs in the local Node server and in a Netlify Function.
const GEN = "https://gen.pollinations.ai";
const MEDIA = "https://media.pollinations.ai";
const MAX_UPLOAD = 50 * 1024 * 1024;
const COOKIE = "ps_auth";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

// Job errors can nest the provider's JSON error inside a message string.
export function errorText(err) {
  let msg = err;
  for (let i = 0; i < 4 && msg && typeof msg !== "string"; i++) msg = msg.message || msg.error;
  for (let i = 0; i < 4 && typeof msg === "string" && msg.trim().startsWith("{"); i++) {
    try {
      const j = JSON.parse(msg);
      msg = j.error?.message || j.message || (typeof j.error === "string" ? j.error : msg);
      if (typeof msg !== "string") break;
    } catch {
      break;
    }
  }
  return typeof msg === "string" && msg ? msg.slice(0, 1000) : "Generation failed";
}

async function upstreamError(r) {
  const text = await r.text().catch(() => "");
  return new HttpError(r.status, errorText(text || `Pollinations returned ${r.status}`));
}

// ---------- password (optional) ----------
async function authToken(password) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("pollinations-studio"));
  return Buffer.from(sig).toString("hex");
}

function getCookie(req, name) {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---------- models ----------
let modelCache = { at: 0, data: null };
async function getModels(auth) {
  if (modelCache.data && Date.now() - modelCache.at < 5 * 60 * 1000) return modelCache.data;
  const r = await fetch(`${GEN}/image/models`, { headers: auth });
  if (!r.ok) throw await upstreamError(r);
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

// ---------- media store ----------
async function uploadMedia(auth, body, contentType) {
  const r = await fetch(`${MEDIA}/upload`, {
    method: "POST",
    headers: { ...auth, "Content-Type": contentType, "Content-Length": String(body.byteLength) },
    body,
  });
  if (!r.ok) throw await upstreamError(r);
  return r.json();
}

// ---------- generation ----------
const IMAGE_PARAMS = ["width", "height", "seed", "quality", "resolution"];
const VIDEO_PARAMS = ["width", "height", "seed", "duration", "aspectRatio", "audio", "resolution"];

async function generate(auth, body) {
  const kind = body.kind === "video" ? "video" : "image";
  const prompt = String(body.prompt || "").trim();
  if (!prompt) throw new HttpError(400, "Prompt is required");
  if (prompt.length > 4000) throw new HttpError(400, "Prompt is too long");

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

  const r = await fetch(`${GEN}/${kind}/${encodeURIComponent(prompt)}?${qs}`, {
    headers: { ...auth, Prefer: "respond-async" },
  });
  if (!r.ok) throw await upstreamError(r);

  const contentType = r.headers.get("content-type") || "";
  if (r.status === 202 || contentType.includes("application/json")) {
    const j = await r.json();
    if (j.id) return { jobId: j.id, status: j.status || "pending" };
    throw new HttpError(502, "Unexpected response from Pollinations");
  }
  // A cached result came back directly: store it so the browser gets a public URL.
  const type = contentType || (kind === "video" ? "video/mp4" : "image/jpeg");
  const saved = await uploadMedia(auth, await r.arrayBuffer(), type);
  return { status: "succeeded", resultUrl: saved.url, contentType: type };
}

// ---------- router ----------
export async function handleApi(req, { key, appPassword = "" }) {
  try {
    if (!key || !key.startsWith("sk_")) throw new HttpError(500, "Server is missing POLLINATIONS_KEY");
    const auth = { Authorization: `Bearer ${key}` };
    const url = new URL(req.url);
    const { pathname } = url;

    if (req.method === "POST" && pathname === "/api/login") {
      if (!appPassword) return json(200, { ok: true });
      const { password } = await req.json().catch(() => ({}));
      if (!safeEqual(String(password || ""), appPassword)) throw new HttpError(401, "Wrong password");
      const secure = url.protocol === "https:" ? "; Secure" : "";
      return json(200, { ok: true }, {
        "Set-Cookie": `${COOKIE}=${await authToken(appPassword)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
      });
    }

    if (appPassword && !safeEqual(getCookie(req, COOKIE) || "", await authToken(appPassword))) {
      throw new HttpError(401, "Password required");
    }

    if (req.method === "GET" && pathname === "/api/models") {
      return json(200, await getModels(auth));
    }

    if (req.method === "POST" && pathname === "/api/upload") {
      const type = req.headers.get("content-type") || "";
      if (!type.startsWith("image/")) throw new HttpError(415, "Only image uploads are supported");
      const buf = await req.arrayBuffer();
      if (buf.byteLength > MAX_UPLOAD) throw new HttpError(413, "File too large");
      const j = await uploadMedia(auth, buf, type);
      return json(200, { url: j.url, id: j.id });
    }

    if (req.method === "POST" && pathname === "/api/generate") {
      const body = await req.json().catch(() => null);
      if (!body) throw new HttpError(400, "Invalid JSON");
      return json(200, await generate(auth, body));
    }

    let m = pathname.match(/^\/api\/jobs\/([A-Za-z0-9_-]{1,128})$/);
    if (req.method === "GET" && m) {
      const r = await fetch(`${GEN}/v1/jobs/${m[1]}`, { headers: auth });
      if (!r.ok) throw await upstreamError(r);
      const job = await r.json();
      if (job.error) job.error = errorText(job.error);
      return json(200, job);
    }

    m = pathname.match(/^\/api\/jobs\/([A-Za-z0-9_-]{1,128})\/result$/);
    if (req.method === "GET" && m) {
      const headers = { ...auth };
      const range = req.headers.get("range");
      if (range) headers.Range = range;
      const r = await fetch(`${GEN}/v1/jobs/${m[1]}/result`, { headers });
      if (!r.ok) throw await upstreamError(r);
      const out = new Headers({ "Cache-Control": "private, max-age=86400" });
      for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const v = r.headers.get(h);
        if (v) out.set(h, v);
      }
      return new Response(r.body, { status: r.status, headers: out });
    }

    throw new HttpError(404, "Not found");
  } catch (err) {
    const status = err instanceof HttpError && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error(err);
    return json(status, { error: err.message || "Server error" });
  }
}
