/**
 * The one place Parasol talks to YouCam (Perfect Corp. S2S API v2).
 *
 * - The API key stays on the server. Each HTTP call has a 20 s limit, at most
 *   MAX_AT_ONCE run together, and a busy YouCam (429, or 5xx on a read) is
 *   retried with growing waits. Task creation is retried on 429 only, so a
 *   flaky 5xx can never start (and bill) a task twice.
 * - Tasks are polled until they end in success or error. The spec warns that
 *   units are spent even if polling stops, so we keep going up to
 *   POLL_MAX_MS (100 s, inside Vercel's 120 s) before giving up.
 * - Every failure is a YoucamError with a plain message, an HTTP status and a
 *   Parasol code (no_face, face_angle, …) plus a retake tip where it helps.
 *
 * YOUCAM_BASE_URL points the client at a stub in tests.
 */

import "./env.js";

const DEFAULT_BASE = "https://yce-api-01.makeupar.com";
const TIMEOUT_MS = 20_000;
const MAX_AT_ONCE = 3;
const CREDIT_CACHE_MS = 60_000;

const base = () => (process.env.YOUCAM_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
const pollMs = () => Number(process.env.YOUCAM_POLL_MS) || 1500;
const pollMaxMs = () => Number(process.env.YOUCAM_POLL_MAX_MS) || 100_000;
export const isStubbed = () => Boolean(process.env.YOUCAM_BASE_URL);

/** The 8 concerns plus skin type: 9 SD actions, billed as "SD 9–12 concerns" (14 units). */
export const SKIN_ACTIONS = ["skin_type", "oiliness", "moisture", "acne", "redness", "pore", "age_spot", "texture", "radiance"];
/** Units per feature, from GET /s2s/v2.0/credit/feature-cost (spike S1, 29 Oct 2026). */
export const COST = { skin: 14, fitz: 10, tone: 20, simulation: 4 };

export class YoucamError extends Error {
  constructor(message, status = 502, code = "youcam_failed", tip = undefined, ycCode = undefined) {
    super(message);
    this.name = "YoucamError";
    this.status = status;
    this.code = code;
    this.tip = tip;
    this.ycCode = ycCode;
  }
}

const TIPS = {
  no_face: "We couldn't find a face. Face the camera in even light, with nothing covering your face.",
  face_angle: "Your face is turned or tilted. Look straight into the camera and keep your head level.",
  face_position: "Move closer so your face fills most of the frame (about two-thirds of its width), centred.",
  multiple_faces: "We found more than one face. Take the photo with only you in it.",
  lighting: "It's too dark. Face a window or a bright, even light, and avoid strong shadows.",
  too_small: "The photo is too small. Use your phone's main camera, or a photo at least 480 pixels on its short side.",
  too_large: "The photo is too large. Use one under 4096 pixels on its long side.",
  bad_image: "We couldn't use that photo. Try a different one.",
};

/** YouCam task error → [Parasol code, HTTP status]. Unknown codes are a YouCam failure (502). */
const ERROR_MAP = [
  [/^error_(src_)?no_face$|^error_ref_no_face$/, "no_face", 422],
  [/multiple_people|multiple_face/, "multiple_faces", 422],
  [/face_angle|large_face_angle|^error_pose$|face_pose|not_forward_facing/, "face_angle", 422],
  [/face_too_small|face_out_of_bound|face_position|face_parsing|insufficient_landmarks/, "face_position", 422],
  [/lighting/, "lighting", 422],
  [/below_min_image_size/, "too_small", 422],
  [/exceed_max_(image|file)size|resolution_unsupported/, "too_large", 422],
  [/nsfw|decode_image|unsupport_ratio/, "bad_image", 422],
];

export function mapTaskError(ycCode, detail = "") {
  const c = String(ycCode || "");
  for (const [re, code, status] of ERROR_MAP) {
    if (re.test(c)) return new YoucamError(TIPS[code], status, code, TIPS[code], c);
  }
  return new YoucamError("The skin analysis service couldn't finish. Please try again in a minute, or use the demo.", 502, "youcam_failed", undefined, c || String(detail).slice(0, 60));
}

/* ---------- concurrency and HTTP ---------- */

let running = 0;
const waiting = [];
async function slot(fn) {
  if (running >= MAX_AT_ONCE) await new Promise((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const stats = { calls: 0, tasks: 0, uploads: 0 };

/** One JSON call to YouCam. `retry5xx` is true for reads and free calls only. */
async function api(method, path, body, { retry5xx = method === "GET" } = {}) {
  const key = process.env.YOUCAM_API_KEY;
  if (!key) throw new YoucamError("Live scans aren't configured on this server.", 503, "live_off");
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    stats.calls++;
    let res;
    try {
      res = await slot(() => fetch(`${base()}${path}`, {
        method,
        headers: { authorization: `Bearer ${key}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }));
    } catch (err) {
      last = new YoucamError(/timeout|abort/i.test(`${err.name} ${err.message}`) ? "The skin analysis service took too long to answer." : "We couldn't reach the skin analysis service.", 502, "youcam_failed");
      // A POST that timed out may have been received: don't send it again.
      if (method !== "GET" && !retry5xx) break;
      await sleep(500 * (attempt + 1));
      continue;
    }
    const text = await res.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    if (res.ok && json) return json;
    const ycCode = json?.error_code || json?.data?.error || "";
    if (/CreditInsufficiency/i.test(ycCode)) throw new YoucamError("Live scans are paused right now (out of units). Try the demo instead.", 503, "live_off", undefined, ycCode);
    if (res.status === 401 || res.status === 403) throw new YoucamError("The skin analysis service refused our key.", 502, "youcam_failed", undefined, ycCode || String(res.status));
    last = res.status === 429
      ? new YoucamError("The skin analysis service is busy. Please try again in a minute.", 503, "youcam_busy", undefined, "429")
      : new YoucamError("The skin analysis service couldn't finish. Please try again in a minute, or use the demo.", 502, "youcam_failed", undefined, ycCode || String(res.status));
    const retryable = res.status === 429 || (res.status >= 500 && retry5xx);
    if (!retryable) break;
    const after = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 8) * 1000 : 600 * 2 ** attempt + Math.random() * 300);
  }
  throw last;
}

/* ---------- files and tasks ---------- */

/**
 * Uploads image bytes for one feature (free) and returns the file_id. The
 * bytes go only to YouCam's signed upload URL; nothing is written locally.
 */
export async function uploadFile(feature, bytes, contentType) {
  stats.uploads++;
  const ext = contentType === "image/png" ? "png" : "jpg";
  const r = await api("POST", `/s2s/v2.0/file/${feature}`, { files: [{ content_type: contentType, file_name: `selfie.${ext}`, file_size: bytes.length }] }, { retry5xx: true });
  const f = r?.data?.files?.[0];
  const up = f?.requests?.[0];
  if (!f?.file_id || !up?.url) throw new YoucamError("The skin analysis service didn't give us an upload address.", 502, "youcam_failed");
  let res;
  try {
    res = await slot(() => fetch(up.url, { method: up.method || "PUT", headers: up.headers || { "content-type": contentType }, body: bytes, signal: AbortSignal.timeout(TIMEOUT_MS) }));
  } catch {
    throw new YoucamError("We couldn't upload your photo to the skin analysis service.", 502, "youcam_failed");
  }
  if (!res.ok) throw new YoucamError("We couldn't upload your photo to the skin analysis service.", 502, "youcam_failed", undefined, `upload ${res.status}`);
  return f.file_id;
}

/** Starts a task and polls it to the end. Returns `data.results`. */
export async function runTask(path, body) {
  stats.tasks++;
  const started = await api("POST", path, body, { retry5xx: false });
  const id = started?.data?.task_id;
  if (!id) throw new YoucamError("The skin analysis service didn't start the task.", 502, "youcam_failed");
  const deadline = Date.now() + pollMaxMs();
  for (;;) {
    await sleep(pollMs());
    let s;
    try {
      s = await api("GET", `${path}/${encodeURIComponent(id)}`);
    } catch (err) {
      // Keep polling through blips until the deadline: the units are spent either way.
      if (Date.now() > deadline) throw err;
      continue;
    }
    const st = s?.data?.task_status;
    if (st === "success") return s.data.results ?? {};
    if (st === "error") throw mapTaskError(s.data.error, s.data.error_message);
    if (Date.now() > deadline) throw new YoucamError("The skin analysis took too long. Please try again, or use the demo.", 502, "youcam_failed", undefined, "poll_timeout");
  }
}

/* ---------- features ---------- */

/** `src` is {src_file_id} or {src_file_url}. Returns the raw `output` array. */
export async function skinAnalysis(src) {
  const r = await runTask("/s2s/v2.0/task/skin-analysis", { ...src, dst_actions: SKIN_ACTIONS, format: "json" });
  if (!Array.isArray(r?.output)) throw new YoucamError("The skin analysis came back empty.", 502, "youcam_failed");
  return r.output;
}

/**
 * Fitzpatrick sun type: detect faces (pre-process), then classify face 0.
 * More than one face is `multiple_faces`, none is `no_face`.
 */
export async function fitzpatrick(src, { onFaces } = {}) {
  const pre = await runTask("/s2s/v2.0/task/fitzpatrick-scale-analyzer/pre-process", src);
  const faces = Array.isArray(pre?.result) ? pre.result : [];
  onFaces?.(faces.length);
  if (faces.length > 1) throw mapTaskError("error_multiple_people");
  if (faces.length === 0) throw mapTaskError("error_no_face");
  const r = await runTask("/s2s/v2.0/task/fitzpatrick-scale-analyzer", { ...src, version: "1.0", index: 0 });
  const scale = r?.fitzpatrick_scale;
  if (!["I", "II", "III", "IV", "V", "VI"].includes(scale)) throw new YoucamError("The sun type came back empty.", 502, "youcam_failed");
  return { scale, faces: faces.length };
}

/** Skin tone (20 units; off unless YOUCAM_SKIN_TONE=1). Returns {hex} or throws. */
export async function skinTone(src) {
  const r = await runTask("/s2s/v2.0/task/skin-tone-analysis", { ...src, face_angle_strictness_level: "medium" });
  const hex = r?.color?.skin_color;
  if (!/^#[0-9a-f]{6}$/i.test(hex || "")) throw new YoucamError("The skin tone came back empty.", 502, "youcam_failed");
  return { hex: hex.toLowerCase() };
}

/** Skin Simulation (demo capture only). Returns the result image URL (valid ~2 h). */
export async function simulate(src, params) {
  const r = await runTask("/s2s/v2.0/task/skin-simulation", { ...src, ...params });
  if (!r?.url) throw new YoucamError("The skin simulation came back empty.", 502, "youcam_failed");
  return r.url;
}

let creditCache = null;
/** Unit balance (sum of all unit grants), cached 60 s. Free. */
export async function credit({ fresh = false } = {}) {
  if (!fresh && creditCache && Date.now() - creditCache.at < CREDIT_CACHE_MS) return creditCache.units;
  const r = await api("GET", "/s2s/v1.0/client/credit");
  const units = (r?.results || []).reduce((n, c) => n + (Number(c.amount) || 0), 0);
  creditCache = { at: Date.now(), units };
  return units;
}
export const forgetCredit = () => (creditCache = null);

/**
 * One full scan of a face photo: one upload, then skin analysis and the
 * Fitzpatrick sun type in parallel (and skin tone, if `tone`). A Fitzpatrick
 * or tone failure alone gives fitz/tone null (the user then picks their sun
 * type), except multiple faces, which fails the whole scan. Skin analysis
 * failing fails the scan.
 */
export async function scanFace(bytes, contentType, { tone = false } = {}) {
  // Spike S2: a file_id uploaded for skin-analysis is accepted by the other features.
  const fileId = await uploadFile("skin-analysis", bytes, contentType);
  const src = { src_file_id: fileId };
  const [skin, fitz, toneR] = await Promise.allSettled([
    skinAnalysis(src),
    fitzpatrick(src),
    tone ? skinTone(src) : Promise.resolve(null),
  ]);
  if (fitz.status === "rejected" && fitz.reason?.code === "multiple_faces") throw fitz.reason;
  if (skin.status === "rejected") throw skin.reason;
  return {
    output: skin.value,
    fitz: fitz.status === "fulfilled" ? fitz.value : null,
    fitzError: fitz.status === "rejected" ? fitz.reason?.code || "youcam_failed" : null,
    tone: toneR.status === "fulfilled" ? toneR.value : null,
    units: COST.skin + (fitz.status === "fulfilled" ? COST.fitz : 0) + (tone && toneR.status === "fulfilled" ? COST.tone : 0),
  };
}
