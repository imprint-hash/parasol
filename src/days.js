/**
 * Turning a trip and Open-Meteo hourly data into per-day summaries. Pure.
 *
 * Open-Meteo is always asked for the city's own time zone, so the "time"
 * strings it returns ("2026-11-02T13:00") are already local: the date is the
 * first 10 characters and the hour is characters 11–12.
 *
 * DaySummary (wx):
 *   uvMax, uvPeakHour    from hourly uv_index (null if the source has no UV)
 *   rhMean, tMax         daytime hours only, 08:00–20:00 local
 *   tMin                 the whole day
 *   windMax              wind_speed_10m in km/h, whole day
 *   pm25Max              from the air-quality API, null beyond its 7-day range
 *   flightHours          hours in the air if this is a flight day, else null
 *
 * Flight days keep the city's weather and add the cabin: relative humidity is
 * often 10–20% on long flights (WHO, International Travel and Health, ch. 2
 * "Travel by air: cabin humidity and dehydration").
 */

export const DAY_START_HOUR = 8;
export const DAY_END_HOUR = 20;
export const CABIN_RH = [10, 20];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" for a real calendar date, else false. */
export function isDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Same calendar day one year earlier (29 Feb → 28 Feb). */
export function lastYear(date) {
  const [y, m, d] = date.split("-").map(Number);
  const day = m === 2 && d === 29 ? 28 : d;
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Today's date in a time zone ("Africa/Lagos"). */
export function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * The days of a (validated) trip, one per date. A date that is one leg's last
 * day and the next leg's first goes to the next leg: you wake up in the old
 * city but spend the day travelling to, and the afternoon in, the new one.
 * → [{date, leg (index), flight: {hours} | null}]
 */
export function tripDays(trip) {
  const out = [];
  const flights = new Map();
  for (const f of trip.flights || []) flights.set(f.date, (flights.get(f.date) || 0) + f.hours);
  trip.legs.forEach((leg, i) => {
    for (let d = leg.from; d <= leg.to; d = addDays(d, 1)) {
      if (d === leg.to && trip.legs.slice(i + 1).some((l) => l.from === d)) continue;
      if (out.some((x) => x.date === d)) continue;
      out.push({ date: d, leg: i, flight: flights.has(d) ? { hours: flights.get(d) } : null });
    }
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Open-Meteo `hourly` block → Map(date → [{h, uvi, t, rh, wind}]). Missing
 * series give nulls, so a source without UV still yields usable days.
 */
export function splitHourly(hourly) {
  const by = new Map();
  const time = Array.isArray(hourly?.time) ? hourly.time : [];
  time.forEach((ts, i) => {
    if (typeof ts !== "string" || ts.length < 13) return;
    const date = ts.slice(0, 10), h = Number(ts.slice(11, 13));
    if (!Number.isInteger(h)) return;
    if (!by.has(date)) by.set(date, []);
    by.get(date).push({
      h,
      uvi: num(hourly.uv_index?.[i]),
      t: num(hourly.temperature_2m?.[i]),
      rh: num(hourly.relative_humidity_2m?.[i]),
      wind: num(hourly.wind_speed_10m?.[i]),
    });
  });
  return by;
}

/** Air-quality `hourly` block → Map(date → max pm2_5) (dates with no values are left out). */
export function pm25ByDate(hourly) {
  const by = new Map();
  const time = Array.isArray(hourly?.time) ? hourly.time : [];
  time.forEach((ts, i) => {
    const v = num(hourly.pm2_5?.[i]);
    if (v === null || typeof ts !== "string") return;
    const d = ts.slice(0, 10);
    by.set(d, Math.max(by.get(d) ?? -Infinity, v));
  });
  return by;
}

const round1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const maxOf = (xs) => (xs.length ? Math.max(...xs) : null);
const minOf = (xs) => (xs.length ? Math.min(...xs) : null);

/**
 * One day's hours → {wx, hourly}. `hourly` (for the chart) keeps 06:00–21:00.
 */
export function summarise(hours, { pm25 = null, flightHours = null } = {}) {
  const hs = (hours || []).slice().sort((a, b) => a.h - b.h);
  const daytime = hs.filter((x) => x.h >= DAY_START_HOUR && x.h <= DAY_END_HOUR);
  const uvs = hs.filter((x) => x.uvi !== null);
  let peak = null;
  for (const x of uvs) if (!peak || x.uvi > peak.uvi) peak = x;
  const wx = {
    uvMax: peak ? round1(peak.uvi) : null,
    uvPeakHour: peak && peak.uvi > 0 ? peak.h : null,
    rhMean: daytime.some((x) => x.rh !== null) ? Math.round(mean(daytime.map((x) => x.rh).filter((v) => v !== null))) : null,
    tMin: round1(minOf(hs.map((x) => x.t).filter((v) => v !== null))),
    tMax: round1(maxOf(daytime.map((x) => x.t).filter((v) => v !== null))),
    windMax: round1(maxOf(hs.map((x) => x.wind).filter((v) => v !== null))),
    pm25Max: round1(num(pm25)),
    flightHours: num(flightHours),
  };
  if (wx.flightHours !== null) wx.cabinRh = CABIN_RH;
  const hourly = hs.filter((x) => x.h >= 6 && x.h <= 21).map(({ h, uvi, t, rh }) => ({ h, uvi: round1(uvi), t: round1(t), rh }));
  return { wx, hourly };
}
