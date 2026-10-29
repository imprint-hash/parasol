/**
 * A live scan, from request body to ScanView:
 *   consent → decode and check the image (type by magic bytes, size, pixel
 *   size from the JPEG SOF / PNG IHDR header) → SHA-256 → cache → budget →
 *   YouCam (skin analysis and Fitzpatrick in parallel) → normalise → cache →
 *   ScanView.
 *
 * The image bytes live only in this request's memory: they are hashed, sent
 * to YouCam's upload URL, then dropped. Only scores are cached, keyed by the
 * hash, and only after YouCam succeeded. Identical photos sent at the same
 * time share one YouCam run.
 */

import "./env.js";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { get, put, list, remove, storeName } from "./store.js";
import { HttpError } from "./http.js";
import { scanFace, YoucamError, COST, isStubbed } from "./youcam.js";
import { reserveLiveScan, rateLimit } from "./budget.js";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MIN_SHORT_SIDE = 480;
export const MAX_LONG_SIDE = 4096;
/** Body limit for /api/scan: base64 of a 2 MB image plus room for the JSON around it. */
export const SCAN_BODY_LIMIT = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4096;
/** YouCam ui_score is 1–100, higher is healthier. Below these, a concern. */
export const CONCERN = { watch: 60, strong: 40 };
export const METRICS = ["oiliness", "moisture", "acne", "redness", "pore", "age_spot", "texture", "radiance"];
const SKIN_TYPES = ["oily", "dry", "combination", "normal"];
const MASK_MARGIN_MS = 5 * 60_000;

const secret = () => process.env.PARASOL_SECRET || "dev-only-secret-not-for-production";

/* ---------- image checks ---------- */

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const startsWith = (buf, sig) => buf.length >= sig.length && sig.every((b, i) => buf[i] === b);

/** {width, height} from a PNG IHDR or the first JPEG SOF marker, or null. */
export function imageSize(buf, type) {
  if (type === "image/png") {
    if (buf.length < 24 || buf.toString("latin1", 12, 16) !== "IHDR") return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    let marker = buf[i + 1];
    while (marker === 0xff && i + 2 < buf.length) marker = buf[++i + 1]; // fill bytes
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end, or scan data before any SOF
    if (i + 4 > buf.length) return null;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      if (i + 9 > buf.length) return null;
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * Decodes and checks `data:image/jpeg;base64,…` (or png). Returns
 * {bytes, type, width, height}. Throws HttpError with the API's codes.
 */
export function decodeImage(dataUrl) {
  if (typeof dataUrl !== "string") throw new HttpError("Send the photo as a data URL.", 400, "bad_image");
  const m = /^data:(image\/(?:jpeg|png));base64,/.exec(dataUrl.slice(0, 40));
  if (!m) throw new HttpError("The photo must be a JPEG or PNG.", 400, "bad_image");
  const b64 = dataUrl.slice(m[0].length);
  if (b64.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4) throw new HttpError("That photo is over 2 MB.", 413, "too_large");
  if (!b64.length || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new HttpError("The photo data is broken or cut short.", 400, "bad_image");
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError("That photo is over 2 MB.", 413, "too_large");
  const type = m[1];
  const ok = type === "image/png" ? startsWith(bytes, PNG) : startsWith(bytes, JPEG);
  if (!ok) throw new HttpError("That file isn't a real JPEG or PNG photo.", 400, "bad_image");
  const size = imageSize(bytes, type);
  if (!size || !size.width || !size.height) throw new HttpError("We couldn't read that photo's size.", 400, "bad_image");
  const short = Math.min(size.width, size.height), long = Math.max(size.width, size.height);
  if (short < MIN_SHORT_SIDE) throw new HttpError(`The photo is too small: its short side must be at least ${MIN_SHORT_SIDE} pixels.`, 422, "too_small", { tip: "Use your phone's main camera, or a larger photo." });
  if (long > MAX_LONG_SIDE) throw new HttpError(`The photo is too large: its long side must be at most ${MAX_LONG_SIDE} pixels.`, 422, "too_large", { tip: "Use a smaller photo." });
  return { bytes, type, ...size };
}

/* ---------- normalising YouCam's answer ---------- */

/** When a signed S3 URL stops working (X-Amz-Date + X-Amz-Expires), or null. */
function signedUrlExpiry(url) {
  try {
    const u = new URL(url);
    const d = u.searchParams.get("X-Amz-Date"), s = Number(u.searchParams.get("X-Amz-Expires"));
    if (!d || !s) return null;
    const t = Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z`);
    return Number.isFinite(t) ? t + s * 1000 : null;
  } catch {
    return null;
  }
}

const lowerType = (v) => {
  const t = String(v || "").toLowerCase();
  return SKIN_TYPES.includes(t) ? t : null;
};

/** Skin type from region "whole"; otherwise T-zone oily with U-zone normal/dry is combination. */
export function skinTypeOf(tZone, uZone, whole) {
  if (whole) return whole;
  if (tZone === "oily" && (uZone === "normal" || uZone === "dry")) return "combination";
  return tZone || uZone || "normal";
}

export function concernsOf(scores) {
  return METRICS.filter((k) => Number.isFinite(scores[k]) && scores[k] < CONCERN.watch).map((metric) => ({ metric, level: scores[metric] < CONCERN.strong ? "strong" : "watch" }));
}

/** YouCam skin-analysis `output` (+ fitz, tone) → the cached record's body. */
export function normalise(output, fitz, tone, now = Date.now()) {
  const scores = {};
  const masks = {};
  let whole = null, tZone = null, uZone = null, overall = null, skinAge = null, expiry = Infinity;
  for (const o of output || []) {
    if (METRICS.includes(o.type) && Number.isFinite(o.ui_score) && (!o.region || o.region === "whole")) {
      scores[o.type] = Math.max(0, Math.min(100, Math.round(o.ui_score)));
      const url = o.mask_urls?.[0];
      if (typeof url === "string" && /^https:\/\//.test(url)) {
        masks[o.type] = url;
        expiry = Math.min(expiry, signedUrlExpiry(url) ?? now + 2 * 3600_000);
      }
    } else if (o.type === "skin_type") {
      const t = lowerType(o.skin_type);
      if (o.region === "whole") whole = t;
      else if (o.region === "t_zone") tZone = t;
      else if (o.region === "u_zone") uZone = t;
    } else if (o.type === "all" && Number.isFinite(o.score)) overall = Math.round(o.score);
    else if (o.type === "skin_age" && Number.isFinite(o.score)) skinAge = Math.round(o.score);
  }
  if (!Object.keys(scores).length) throw new YoucamError("The skin analysis came back without scores.", 502, "youcam_failed");
  return {
    skin: { type: skinTypeOf(tZone, uZone, whole), tZone, uZone, scores, overall, skinAge },
    fitz: fitz?.scale ? { scale: fitz.scale, source: "youcam" } : null,
    tone: tone?.hex ? { hex: tone.hex } : null,
    masks,
    masksExpireAt: Object.keys(masks).length ? new Date(expiry - MASK_MARGIN_MS).toISOString() : null,
  };
}

/* ---------- ScanView ---------- */

export const deleteTokenFor = (imageHash) => createHmac("sha256", secret()).update(`delete|${imageHash}`).digest("base64url");
const delKeyOf = (token) => createHash("sha256").update(`del|${token}`).digest("hex");

/** A record (cache or fixture) → the ScanView the API returns. */
export function toView(rec, { source, kind = "baseline", imageHash = null, now = Date.now(), extra = {} }) {
  const live = rec.masksExpireAt && Date.parse(rec.masksExpireAt) > now;
  const fixtureMasks = source === "demo";
  return {
    id: randomBytes(16).toString("base64url"),
    kind,
    source,
    takenAt: new Date(now).toISOString(),
    skin: rec.skin,
    concerns: concernsOf(rec.skin.scores),
    fitz: rec.fitz ?? null,
    tone: rec.tone ?? null,
    masks: fixtureMasks || live ? rec.masks || {} : {},
    masksExpireAt: fixtureMasks ? null : live ? rec.masksExpireAt : null,
    deleteToken: imageHash ? deleteTokenFor(imageHash) : null,
    ...extra,
  };
}

/* ---------- the live scan ---------- */

const inFlight = new Map();
const SCANS_PER_IP_HOUR = 20; // any scan request, cached or not

// Never let stub results land in the shared hosted cache.
const persist = () => !(isStubbed() && storeName === "supabase");

async function runLive(hash, img, ip) {
  const units = COST.skin + COST.fitz + (process.env.YOUCAM_SKIN_TONE === "1" ? COST.tone : 0);
  await reserveLiveScan(ip, units);
  let r;
  try {
    r = await scanFace(img.bytes, img.type, { tone: process.env.YOUCAM_SKIN_TONE === "1" });
  } catch (err) {
    if (err instanceof YoucamError) throw new HttpError(err.message, err.status, err.code, err.tip ? { tip: err.tip } : {});
    throw err;
  }
  let body;
  try {
    body = normalise(r.output, r.fitz, r.tone);
  } catch (err) {
    throw new HttpError(err.message, 502, "youcam_failed");
  }
  const rec = { id: hash, at: new Date().toISOString(), imageHash: hash, delKey: delKeyOf(deleteTokenFor(hash)), ...body };
  if (persist()) await put("pz_ycache", rec).catch((e) => console.error("ycache write failed:", e.message));
  return rec;
}

/** POST /api/scan. `body` is the parsed JSON, `ip` the caller's IP. */
export async function scanRequest(body, ip) {
  if (body.consent !== true || body.consentVersion !== 1) {
    throw new HttpError("Please read and accept the consent note before scanning.", 400, "no_consent");
  }
  const img = decodeImage(body.image);
  rateLimit(`scan|${ip}`, SCANS_PER_IP_HOUR);
  const kind = body.kind === "rescan" ? "rescan" : "baseline";
  const hash = createHash("sha256").update(img.bytes).digest("hex");

  const cached = persist() ? await get("pz_ycache", hash).catch(() => null) : null;
  if (cached?.skin) return toView(cached, { source: "cache", kind, imageHash: hash });

  if (inFlight.has(hash)) return toView(await inFlight.get(hash), { source: "cache", kind, imageHash: hash });
  const p = runLive(hash, img, ip).finally(() => inFlight.delete(hash));
  inFlight.set(hash, p);
  return toView(await p, { source: "live", kind, imageHash: hash });
}

/* ---------- My data ---------- */

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** DELETE /api/my-data: removes the cached scores each valid token belongs to. */
export async function deleteMyData(body) {
  const tokens = body.deleteTokens;
  if (!Array.isArray(tokens) || tokens.length === 0 || tokens.length > 20) throw new HttpError("Send deleteTokens: a list of 1 to 20 tokens.", 400, "bad_request");
  if (!tokens.every((t) => typeof t === "string" && TOKEN_RE.test(t))) throw new HttpError("One of those delete tokens isn't valid.", 403, "bad_token");
  let deleted = 0;
  for (const token of new Set(tokens)) {
    const recs = await list("pz_ycache", () => true, { delKey: delKeyOf(token) });
    for (const rec of recs) {
      // Belt and braces: the token must be this record's own HMAC.
      const want = Buffer.from(deleteTokenFor(rec.imageHash || ""));
      const got = Buffer.from(token);
      if (rec.id && want.length === got.length && timingSafeEqual(want, got)) {
        await remove("pz_ycache", rec.id);
        deleted++;
      }
    }
  }
  return { deleted };
}
