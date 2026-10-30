/**
 * A fake Open-Meteo for offline tests. stubMeteo(handler) replaces
 * globalThis.fetch: requests to *.open-meteo.com go to `handler(url)` (return
 * a JSON body, or throw {status} to answer an error); everything else (the
 * test's own calls to the app on 127.0.0.1) goes to the real fetch. Every
 * Open-Meteo call is recorded in `calls`. restore() puts fetch back.
 *
 * Set PARASOL_WX_CACHE=memory before importing src/ so the store cache
 * doesn't carry answers between tests; call forgetWeather() between tests.
 */

// Importing this helper (before src/) keeps the weather cache in memory only.
process.env.PARASOL_WX_CACHE = "memory";

const realFetch = globalThis.fetch;

export function stubMeteo(handler) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (!url.hostname.endsWith("open-meteo.com")) return realFetch(input, init);
    calls.push(url);
    try {
      const body = await handler(url);
      return new Response(JSON.stringify(body ?? {}), { status: 200, headers: { "content-type": "application/json" } });
    } catch (err) {
      if (err?.network) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ error: true, reason: err?.message || "stub error" }), { status: err?.status || 500, headers: { "content-type": "application/json" } });
    }
  };
  return { calls, restore: () => (globalThis.fetch = realFetch) };
}

const pad = (n) => String(n).padStart(2, "0");
const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Open-Meteo-shaped hourly block. `day(date, i)` may override the weather per
 * day: {uvPeak, tMin, tMax, rh, wind, pm25}. UV follows a bell curve that
 * peaks at 13:00.
 */
export function hourly(start, days, day = () => ({})) {
  const out = { time: [], uv_index: [], temperature_2m: [], relative_humidity_2m: [], wind_speed_10m: [], pm2_5: [] };
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const w = { uvPeak: 8, tMin: 24, tMax: 31, rh: 80, wind: 12, pm25: 20, ...day(date, i) };
    for (let h = 0; h < 24; h++) {
      out.time.push(`${date}T${pad(h)}:00`);
      const uv = w.uvPeak === null ? null : Math.max(0, Math.round(w.uvPeak * Math.exp(-((h - 13) ** 2) / 8) * 100) / 100);
      out.uv_index.push(uv);
      const t = w.tMin + (w.tMax - w.tMin) * Math.max(0, Math.sin(((h - 6) / 12) * Math.PI));
      out.temperature_2m.push(Math.round(t * 10) / 10);
      out.relative_humidity_2m.push(w.rh);
      out.wind_speed_10m.push(h === 14 ? w.wind : Math.round(w.wind * 0.6 * 10) / 10);
      out.pm2_5.push(h === 8 ? w.pm25 : Math.round(w.pm25 * 0.5));
    }
  }
  return out;
}

/** A default handler: forecast/air/historical all answer from `hourly`, dated from the request. */
export function defaultHandler({ day, today = new Date().toISOString().slice(0, 10), geocode } = {}) {
  return (url) => {
    const p = url.searchParams;
    if (url.hostname.startsWith("geocoding")) return geocode ? geocode(url) : { results: [] };
    if (url.hostname.startsWith("historical")) {
      const s = p.get("start_date"), e = p.get("end_date");
      const n = Math.round((Date.parse(e) - Date.parse(s)) / 86_400_000) + 1;
      const h = hourly(s, n, day);
      delete h.pm2_5;
      return { hourly: h };
    }
    const past = Number(p.get("past_days") || 0);
    const n = Number(p.get("forecast_days") || 7);
    const h = hourly(addDays(today, -past), past + n, day);
    if (url.hostname.startsWith("air-quality")) return { hourly: { time: h.time, pm2_5: h.pm2_5 } };
    delete h.pm2_5;
    return { hourly: h };
  };
}
