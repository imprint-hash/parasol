/**
 * Input checks for the trip routes. Each function returns a clean copy with
 * only the known fields, or throws HttpError(400, "bad_input") with a plain
 * message. Nothing from the client is trusted or passed through as-is.
 */

import { HttpError } from "./http.js";
import { SKIN_TYPES, FITZ, METRICS, NEED_TAGS } from "./tags.js";
import { isDate, addDays, daysBetween, todayIn } from "./days.js";

export const MAX_LEGS = 5;
export const MAX_TRIP_DAYS = 30;
export const MAX_START_AHEAD_DAYS = 365;
export const MAX_START_PAST_DAYS = 30; // a trip already under way still gets /today
export const MAX_FLIGHTS = 6;
export const FLIGHT_HOURS = [0.5, 20];
export const MAX_CONCERNS = 20;
export const MAX_NEEDS = 60;
export const MAX_RESCAN_DAYS = 10;
const ZONES = ["oily", "dry", "normal", "combination"];

const bad = (msg) => new HttpError(msg, 400, "bad_input");
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const cleanText = (v, max) => String(v).replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, max);

export function isTimeZone(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$|^UTC$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function validateScores(s, label = "scores") {
  if (s === undefined || s === null) return null;
  if (!isObj(s)) throw bad(`${label} must be an object of scores from 0 to 100.`);
  const out = {};
  for (const m of METRICS) {
    if (s[m] === undefined || s[m] === null) continue;
    const v = s[m];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) throw bad(`${label}.${m} must be a number from 0 to 100.`);
    out[m] = Math.round(v);
  }
  return out;
}

export function validateProfile(p) {
  if (!isObj(p)) throw bad("Send your skin profile.");
  if (!SKIN_TYPES.includes(p.skinType)) throw bad(`skinType must be one of ${SKIN_TYPES.join(", ")}.`);
  if (!FITZ.includes(p.fitz)) throw bad("fitz must be a sun type from I to VI.");
  if (p.albinism !== undefined && typeof p.albinism !== "boolean") throw bad("albinism must be true or false.");
  for (const z of ["tZone", "uZone"]) if (p[z] !== undefined && p[z] !== null && !ZONES.includes(p[z])) throw bad(`${z} must be one of ${ZONES.join(", ")}.`);
  if (p.concerns !== undefined && !Array.isArray(p.concerns)) throw bad("concerns must be a list.");
  const raw = p.concerns || [];
  if (raw.length > MAX_CONCERNS) throw bad(`At most ${MAX_CONCERNS} concerns.`);
  const concerns = [];
  for (const c of raw) {
    const m = typeof c === "string" ? c : isObj(c) ? c.metric : null;
    if (!METRICS.includes(m)) throw bad(`Unknown concern. Use ${METRICS.join(", ")}.`);
    if (!concerns.includes(m)) concerns.push(m);
  }
  if (p.toneHex !== undefined && p.toneHex !== null && !/^#[0-9a-fA-F]{6}$/.test(String(p.toneHex))) throw bad("toneHex must look like #a1b2c3.");
  return {
    skinType: p.skinType,
    tZone: p.tZone || null,
    uZone: p.uZone || null,
    scores: validateScores(p.scores, "scores"),
    concerns,
    fitz: p.albinism === true ? "I" : p.fitz,
    reportedFitz: p.fitz,
    albinism: p.albinism === true,
    toneHex: p.toneHex || null,
  };
}

/**
 * A trip: 1–5 legs in date order, starting within 365 days (or up to 30 days
 * ago) and at most 30 days long; up to 6 flights inside the trip.
 */
export function validateTrip(t, now = new Date()) {
  if (!isObj(t)) throw bad("Send your trip.");
  if (!Array.isArray(t.legs) || t.legs.length < 1) throw bad("Add at least one city to your trip.");
  if (t.legs.length > MAX_LEGS) throw bad(`At most ${MAX_LEGS} cities per trip.`);
  const legs = t.legs.map((l, i) => {
    const n = i + 1;
    if (!isObj(l)) throw bad(`City ${n} isn't valid.`);
    const name = typeof l.name === "string" ? cleanText(l.name, 80) : "";
    if (!name) throw bad(`City ${n} needs a name.`);
    const lat = l.lat, lon = l.lon;
    if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) throw bad(`City ${n}: latitude must be between -90 and 90.`);
    if (typeof lon !== "number" || !Number.isFinite(lon) || lon < -180 || lon > 180) throw bad(`City ${n}: longitude must be between -180 and 180.`);
    if (!isTimeZone(l.timezone)) throw bad(`City ${n}: that time zone isn't valid.`);
    if (!isDate(l.from) || !isDate(l.to)) throw bad(`City ${n}: dates must look like 2026-11-02.`);
    if (l.from > l.to) throw bad(`City ${n}: the leave date is before the arrive date.`);
    return { name, lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, timezone: l.timezone, from: l.from, to: l.to };
  });
  for (let i = 1; i < legs.length; i++) if (legs[i].from < legs[i - 1].from) throw bad("Put the cities in the order you visit them.");
  const start = legs[0].from;
  const end = legs.reduce((m, l) => (l.to > m ? l.to : m), start);
  if (daysBetween(start, end) + 1 > MAX_TRIP_DAYS) throw bad(`Trips can be at most ${MAX_TRIP_DAYS} days long.`);
  const today = todayIn(legs[0].timezone, now);
  if (start > addDays(today, MAX_START_AHEAD_DAYS)) throw bad(`Trips must start within ${MAX_START_AHEAD_DAYS} days.`);
  if (end < addDays(today, -MAX_START_PAST_DAYS) || start < addDays(today, -MAX_START_PAST_DAYS)) throw bad("That trip is too far in the past.");

  if (t.flights !== undefined && !Array.isArray(t.flights)) throw bad("flights must be a list.");
  const rawFlights = t.flights || [];
  if (rawFlights.length > MAX_FLIGHTS) throw bad(`At most ${MAX_FLIGHTS} flights.`);
  const flights = rawFlights.map((f, i) => {
    if (!isObj(f) || !isDate(f.date)) throw bad(`Flight ${i + 1}: the date must look like 2026-11-02.`);
    if (f.date < start || f.date > end) throw bad(`Flight ${i + 1} is outside your trip dates.`);
    const h = f.hours;
    if (typeof h !== "number" || !Number.isFinite(h) || h < FLIGHT_HOURS[0] || h > FLIGHT_HOURS[1]) throw bad(`Flight ${i + 1}: hours in the air must be between ${FLIGHT_HOURS[0]} and ${FLIGHT_HOURS[1]}.`);
    return { date: f.date, hours: Math.round(h * 2) / 2 };
  });
  if (t.carryOn !== undefined && typeof t.carryOn !== "boolean") throw bad("carryOn must be true or false.");
  return { legs, flights, carryOn: t.carryOn !== false, start, end };
}

export function validateNeeds(n) {
  if (n === undefined || n === null) return [];
  if (!Array.isArray(n)) throw bad("needs must be a list of tags.");
  if (n.length > MAX_NEEDS) throw bad(`At most ${MAX_NEEDS} needs.`);
  const unknown = n.filter((t) => !NEED_TAGS.has(t));
  if (unknown.length) throw bad(`Unknown need: ${String(unknown[0]).slice(0, 30)}.`);
  return [...new Set(n)];
}

const wxNum = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/** Days sent back for a rescan: only the weather numbers we use, range-checked. */
export function validateDays(days) {
  if (days === undefined || days === null) return [];
  if (!Array.isArray(days)) throw bad("days must be a list.");
  if (days.length > MAX_RESCAN_DAYS) throw bad(`Send at most ${MAX_RESCAN_DAYS} days since you arrived.`);
  return days.map((d, i) => {
    if (!isObj(d) || !isDate(d.date) || !isObj(d.wx)) throw bad(`Day ${i + 1} isn't valid.`);
    const w = d.wx;
    return {
      date: d.date,
      city: typeof d.city === "string" ? cleanText(d.city, 80) : "",
      kind: ["forecast", "typical", "flight"].includes(d.kind) ? d.kind : "forecast",
      wx: {
        uvMax: wxNum(w.uvMax, 0, 25),
        rhMean: wxNum(w.rhMean, 0, 100),
        tMin: wxNum(w.tMin, -90, 60),
        tMax: wxNum(w.tMax, -90, 60),
        windMax: wxNum(w.windMax, 0, 400),
        pm25Max: wxNum(w.pm25Max, 0, 2000),
        flightHours: wxNum(w.flightHours, FLIGHT_HOURS[0], FLIGHT_HOURS[1]),
      },
    };
  });
}

export function validateSelfReport(s) {
  if (s === undefined || s === null) return { sun: false, newProduct: false, water: false, sleep: false };
  if (!isObj(s)) throw bad("selfReport must be an object.");
  const out = {};
  for (const k of ["sun", "newProduct", "water", "sleep"]) {
    if (s[k] !== undefined && typeof s[k] !== "boolean") throw bad(`selfReport.${k} must be true or false.`);
    out[k] = s[k] === true;
  }
  return out;
}
