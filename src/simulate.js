/**
 * POST /api/simulate: "See how your skin may react". Runs YouCam Skin
 * Simulation on the traveller's own photo with a setting chosen from the trip
 * forecast, and returns the result image URL (YouCam hosts it for ~2 h).
 *
 * Skin Simulation can only make skin look *worse* in one way: oiliness, where
 * a higher intensity adds shine (for redness, acne, pores, spots and texture,
 * higher means smoother). So Parasol simulates what humid, hot days tend to
 * do: more shine. The intensity comes from the forecast's most humid / hottest
 * day, picked here on the server from two numbers, never from raw client
 * parameters.
 *
 * Guards, like a scan: explicit consent before the image is even read, the
 * same image checks, the per-IP and daily caps and the unit floor (cost 4
 * units, counted as one live call), cached by image hash + intensity (until
 * the YouCam URL expires), identical requests share one run. Parasol never
 * stores the photo, so the image is sent again (the scan's YouCam file id is
 * not kept). Demo personas return the saved fixture image at zero cost.
 */

import "./env.js";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { get, put, storeName } from "./store.js";
import { HttpError } from "./http.js";
import { uploadFile, simulate, YoucamError, COST, isStubbed } from "./youcam.js";
import { reserveLiveScan, rateLimit, serverSecret } from "./budget.js";
import { decodeImage, deleteTokenFor, delKeyOf } from "./scan.js";
import { PERSONAS } from "./demo.js";

/** YouCam Skin Simulation's own limit is a long side of 2560 px. */
export const SIM_MAX_LONG_SIDE = 2560;
export const LABEL = "Simulated with YouCam Skin Simulation. A preview, not a prediction.";
const URL_LIFE_MS = 2 * 3600_000 - 10 * 60_000;
const persist = () => !(isStubbed() && storeName === "supabase");
const inFlight = new Map();

const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/** Forecast numbers → {level, params, why}. humidity: highest daily mean %, tempMax: highest °C. */
export function simSettings(humidity, tempMax) {
  const rh = num(humidity, 0, 100), t = num(tempMax, -60, 60);
  if (rh === null || t === null) throw new HttpError("Send humidity (0–100) and tempMax (°C) from your forecast.", 400, "bad_request");
  const level = (rh >= 70 && t >= 28) || rh >= 85 ? "high" : rh >= 60 || t >= 30 ? "medium" : "low";
  const oiliness = { high: 1, medium: 0.6, low: 0.3 }[level];
  const why = {
    high: `How your skin may look after a few humid, hot days (${Math.round(rh)}% humidity, ${Math.round(t)} °C): more shine.`,
    medium: `How your skin may look after a few warm or humid days (${Math.round(rh)}% humidity, ${Math.round(t)} °C): a little more shine.`,
    low: "Your trip isn't very humid, so this shows only a light change: a little more shine.",
  }[level];
  return { level, params: { oiliness }, why };
}

function demoSim(persona) {
  if (!PERSONAS.includes(persona)) throw new HttpError("Choose a demo persona: ada or sam.", 400, "bad_persona");
  const f = new URL(`../data/demo/${persona}.json`, import.meta.url);
  const fx = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
  const sim = fx?.rescan?.simulated;
  if (!sim || !fx.rescan.face?.image) throw new HttpError("This demo traveller has no simulated photo. Try Ada.", 404, "no_fixture");
  return { source: "demo", before: fx.face?.image || null, after: fx.rescan.face.image, params: sim.params, level: "high", why: "How Ada's skin may look after a few humid days in Dubai: more shine.", label: LABEL, units: 0 };
}

async function runLive(id, hash, img, params, ip) {
  await reserveLiveScan(ip, COST.simulation);
  let url;
  try {
    const fileId = await uploadFile("skin-simulation", img.bytes, img.type);
    url = await simulate({ src_file_id: fileId }, params);
  } catch (err) {
    if (err instanceof YoucamError) throw new HttpError(err.message, err.status, err.code, err.tip ? { tip: err.tip } : {});
    throw err;
  }
  if (typeof url !== "string" || !/^https?:\/\//.test(url) || (!isStubbed() && !url.startsWith("https://"))) throw new HttpError("The skin simulation came back empty.", 502, "youcam_failed");
  const rec = { id, at: new Date().toISOString(), kind: "simulation", imageHash: hash, delKey: delKeyOf(deleteTokenFor(hash)), url, params, expiresAt: new Date(Date.now() + URL_LIFE_MS).toISOString() };
  if (persist()) await put("pz_ycache", rec).catch((e) => console.error("sim cache write failed:", e.message));
  return rec;
}

/** POST /api/simulate. */
export async function simulateRequest(body, ip) {
  if (body.persona !== undefined) {
    rateLimit(`demo|${ip}`, 300);
    return demoSim(body.persona);
  }
  if (body.consent !== true || body.consentVersion !== 1) throw new HttpError("Please read and accept the consent note before we send your photo.", 400, "no_consent");
  const { level, params, why } = simSettings(body.humidity, body.tempMax);
  const img = decodeImage(body.image);
  if (Math.max(img.width, img.height) > SIM_MAX_LONG_SIDE) throw new HttpError(`The photo is too large: its long side must be at most ${SIM_MAX_LONG_SIDE} pixels.`, 422, "too_large", { tip: "Use a smaller photo." });
  serverSecret();
  rateLimit(`scan|${ip}`, 20);
  const hash = createHash("sha256").update(img.bytes).digest("hex");
  const id = `sim:${hash}:${params.oiliness}`;
  const out = (rec, source) => ({ source, after: rec.url, params, level, why, label: LABEL, expiresAt: rec.expiresAt, units: source === "live" ? COST.simulation : 0 });

  const cached = persist() ? await get("pz_ycache", id).catch(() => null) : null;
  if (cached?.url && Date.parse(cached.expiresAt) > Date.now()) return out(cached, "cache");
  if (inFlight.has(id)) return out(await inFlight.get(id), "cache");
  const p = runLive(id, hash, img, params, ip).finally(() => inFlight.delete(id));
  inFlight.set(id, p);
  return out(await p, "live");
}
