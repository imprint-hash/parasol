/**
 * Open-Meteo client: geocoding, forecast, air quality and "last year on these
 * dates". Free, no key, CC BY 4.0 (credit "Weather data by Open-Meteo.com").
 *
 * - Forecast: api.open-meteo.com, `forecast_days=16` (+ `past_days` for a
 *   trip already under way). Asking by forecast_days rather than dates means
 *   we never trip the "out of allowed range" error at the horizon edge.
 * - Air quality: air-quality-api.open-meteo.com, pm2_5 and dust for 7 days.
 * - Typical (beyond the forecast): historical-forecast-api.open-meteo.com for
 *   the same dates last year. Spike S6 (29 Oct 2026): it DOES return
 *   uv_index (e.g. Lagos 2025-11-20 peak 7.8). The ERA5 archive API does not
 *   (uv_index units come back "undefined"), so we don't use it.
 * - Every answer is cached: in memory, and in the store (collection pz_wx,
 *   {id: sha1(url), at, ttl, body}) unless PARASOL_WX_CACHE=memory.
 *   TTLs: forecast 1 h, air 1 h, typical 30 days, geocoding 7 days.
 * - If Open-Meteo can't be reached, a leg near a city we keep a snapshot for
 *   (data/demo/weather-*.json) uses that, labelled "saved snapshot".
 *
 * Tests stub globalThis.fetch (test/helpers/meteo-stub.js); no live calls.
 */

import "./env.js";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { HttpError } from "./http.js";
import { get, put } from "./store.js";
import { addDays, daysBetween } from "./days.js";

export const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
export const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
export const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
export const HISTORICAL_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast";

export const FORECAST_DAYS = 16;
export const AIR_DAYS = 7;
export const MAX_PAST_DAYS = 92;
export const HOURLY = "uv_index,temperature_2m,relative_humidity_2m,wind_speed_10m,apparent_temperature";
export const AIR_HOURLY = "pm2_5,dust";
const TIMEOUT_MS = 10_000;
export const TTL = { forecast: 3600, air: 3600, typical: 30 * 86400, geocode: 7 * 86400 };

export const CREDIT = { name: "Open-Meteo", url: "https://open-meteo.com/", licence: "CC BY 4.0", text: "Weather data by Open-Meteo.com" };

export class WeatherError extends HttpError {
  constructor(message = "Weather data isn't available right now. Please try again in a minute.") {
    super(message, 502, "weather_down");
  }
}

export const stats = { calls: 0, cacheHits: 0 };
const memory = new Map();
export const forgetWeather = () => memory.clear();
const useStore = () => process.env.PARASOL_WX_CACHE !== "memory";

const round = (v, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;

export function buildUrl(base, params) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return u.toString();
}

async function fetchJson(url) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    stats.calls++;
    try {
      const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = await res.json().catch(() => null);
      if (res.ok && body && !body.error) return body;
      // 4xx is our request being wrong (e.g. a date out of range): no retry.
      if (res.status >= 400 && res.status < 500) throw Object.assign(new WeatherError(), { final: true, reason: body?.reason });
      lastErr = new WeatherError();
    } catch (err) {
      if (err?.final) throw err;
      lastErr = err instanceof WeatherError ? err : new WeatherError();
    }
  }
  throw lastErr;
}

/** GET with memory + store cache. */
async function cached(url, ttl) {
  const id = createHash("sha1").update(url).digest("hex");
  const hit = memory.get(id);
  if (hit && Date.now() - hit.at < ttl * 1000) {
    stats.cacheHits++;
    return hit.body;
  }
  if (useStore()) {
    const saved = await get("pz_wx", id).catch(() => null);
    if (saved && Date.now() - Date.parse(saved.at) < Number(saved.ttl) * 1000 && saved.body) {
      memory.set(id, { at: Date.parse(saved.at), body: saved.body });
      stats.cacheHits++;
      return saved.body;
    }
  }
  const body = await fetchJson(url);
  memory.set(id, { at: Date.now(), body });
  if (memory.size > 500) memory.delete(memory.keys().next().value);
  if (useStore()) put("pz_wx", { id, at: new Date().toISOString(), ttl, body }).catch(() => {});
  return body;
}

/** City search → [{id,name,admin1,country,lat,lon,timezone}] (≤6). */
export async function geocode(q) {
  const url = buildUrl(GEOCODE_URL, { name: q, count: 6, language: "en", format: "json" });
  const body = await cached(url, TTL.geocode);
  return (Array.isArray(body?.results) ? body.results : [])
    .filter((r) => Number.isFinite(r?.latitude) && Number.isFinite(r?.longitude) && typeof r?.timezone === "string" && r.timezone)
    .slice(0, 6)
    .map((r) => ({
      id: Number.isFinite(r.id) ? r.id : null,
      name: String(r.name || "").slice(0, 80),
      admin1: r.admin1 ? String(r.admin1).slice(0, 80) : null,
      country: r.country ? String(r.country).slice(0, 80) : null,
      lat: round(r.latitude, 4),
      lon: round(r.longitude, 4),
      timezone: r.timezone,
    }));
}

/** The next 16 days (and `pastDays` before today) of hourly weather. → Open-Meteo body */
export function forecast({ lat, lon, timezone }, pastDays = 0) {
  const url = buildUrl(FORECAST_URL, {
    latitude: round(lat), longitude: round(lon), timezone, hourly: HOURLY, wind_speed_unit: "kmh",
    forecast_days: FORECAST_DAYS, past_days: pastDays > 0 ? Math.min(MAX_PAST_DAYS, pastDays) : undefined,
  });
  return cached(url, TTL.forecast);
}

/** pm2_5 and desert dust (µg/m³) for the next 7 days. → Open-Meteo body */
export function airQuality({ lat, lon, timezone }, pastDays = 0) {
  const url = buildUrl(AIR_URL, {
    latitude: round(lat), longitude: round(lon), timezone, hourly: AIR_HOURLY,
    forecast_days: AIR_DAYS, past_days: pastDays > 0 ? Math.min(MAX_PAST_DAYS, pastDays) : undefined,
  });
  return cached(url, TTL.air);
}

/** Hourly weather for past dates (used for "last year on these dates"). → Open-Meteo body */
export function historical({ lat, lon, timezone }, start, end) {
  const url = buildUrl(HISTORICAL_URL, { latitude: round(lat), longitude: round(lon), timezone, hourly: HOURLY, wind_speed_unit: "kmh", start_date: start, end_date: end });
  return cached(url, TTL.typical);
}

/* ---------- saved snapshots (only if Open-Meteo is down) ---------- */

const DEMO_DIR = new URL("../data/demo/", import.meta.url);
export const SNAPSHOT_RADIUS_DEG = 0.5;
let snapshots = null;
export function loadSnapshots() {
  if (snapshots) return snapshots;
  snapshots = [];
  try {
    for (const f of readdirSync(DEMO_DIR)) {
      if (!/^weather-[a-z-]+\.json$/.test(f)) continue;
      try {
        const s = JSON.parse(readFileSync(new URL(f, DEMO_DIR), "utf8"));
        if (Number.isFinite(s.lat) && Number.isFinite(s.lon) && Array.isArray(s.hourly?.time)) snapshots.push(s);
      } catch {}
    }
  } catch {}
  return snapshots;
}

/**
 * The snapshot for a place, re-dated onto the trip's dates. A date the
 * snapshot has is used as is; any other date takes the snapshot day the same
 * number of days from "today" (so "day 4 of a trip starting tomorrow" always
 * gets snapshot day 4), cycling past the end. → {hourly, air, capturedAt} | null
 */
export function snapshotFor({ lat, lon }, from, to, today = new Date().toISOString().slice(0, 10)) {
  const s = loadSnapshots().find((x) => Math.abs(x.lat - lat) <= SNAPSHOT_RADIUS_DEG && Math.abs(x.lon - lon) <= SNAPSHOT_RADIUS_DEG);
  if (!s) return null;
  const srcDates = [...new Set(s.hourly.time.map((t) => t.slice(0, 10)))];
  if (!srcDates.length) return null;
  const n = daysBetween(from, to) + 1;
  const remap = (block, keys) => {
    const out = { time: [] };
    for (const k of keys) out[k] = [];
    for (let i = 0; i < n; i++) {
      const dst = addDays(from, i);
      const len = srcDates.length;
      const src = srcDates.includes(dst) ? dst : srcDates[((daysBetween(today, dst) % len) + len) % len];
      block.time.forEach((t, j) => {
        if (t.slice(0, 10) !== src) return;
        out.time.push(dst + t.slice(10));
        for (const k of keys) out[k].push(block[k]?.[j] ?? null);
      });
    }
    return out;
  };
  return {
    hourly: remap(s.hourly, HOURLY.split(",")),
    air: s.air?.time ? remap(s.air, AIR_HOURLY.split(",")) : null,
    capturedAt: s.capturedAt || null,
    city: s.city,
  };
}
