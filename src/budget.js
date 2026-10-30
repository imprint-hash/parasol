/**
 * Guards for the YouCam unit budget, and the client IP / rate-limit helpers
 * every route uses.
 *
 * A live scan must pass, in order:
 *   1. the kill switch (LIVE_SCANS=off) and a configured API key,
 *   2. the per-IP limit (LIVE_PER_IP_HOUR in any rolling hour, LIVE_PER_IP_DAY a day),
 *   3. the global daily cap (LIVE_SCANS_PER_DAY, default 15),
 *   4. the unit floor: YouCam's balance, minus the units this instance has
 *      reserved since that balance was read (the balance is cached 60 s),
 *      minus this scan's cost must stay at or above UNITS_FLOOR (default 150).
 *      If the balance can't be read, we stop.
 * Failing 1, 3 or 4 is 503 `live_off` (the client offers the demo); failing 2
 * is 429 `rate_limited` with retryAfter.
 *
 * Counters live in the store (pz_budget) so they hold across serverless
 * instances: `day:YYYY-MM-DD` {liveScans, units} and
 * `ip:<hmac(ip)>:YYYY-MM-DD` {liveScans, units, hits:[ms]}. IPs are never
 * stored raw. A small in-process lock keeps parallel requests on one instance
 * from both passing the same check.
 */

import "./env.js";
import { createHmac } from "node:crypto";
import { get, put } from "./store.js";
import { HttpError } from "./http.js";
import { credit, creditReadId } from "./youcam.js";

export const LIVE_PER_IP_HOUR = 3;
export const LIVE_PER_IP_DAY = 6;
const HOUR = 3600_000;

const num = (v, d) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
export const settings = () => ({
  live: String(process.env.LIVE_SCANS || "on").toLowerCase() !== "off" && Boolean(process.env.YOUCAM_API_KEY),
  perDay: num(process.env.LIVE_SCANS_PER_DAY, 15),
  floor: num(process.env.UNITS_FLOOR, 150),
});

export const dayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/**
 * The caller's IP. On Vercel the platform sets x-forwarded-for itself, and we
 * take the right-most entry (the one Vercel's edge added), so a client can't
 * pick its own IP by sending the header. Off Vercel (local, tests) headers are
 * ignored and the socket address is used.
 */
export function clientIp(req) {
  const h = req.headers || {};
  if (process.env.VERCEL) {
    const xff = String(h["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
    if (h["x-real-ip"]) return String(h["x-real-ip"]).trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

const secret = () => process.env.PARASOL_SECRET || "dev-only-secret-not-for-production";
export const ipHash = (ip) => createHmac("sha256", secret()).update(`ip|${ip}`).digest("base64url").slice(0, 22);

/* ---------- cheap in-memory rate limit, for routes that cost little ---------- */

const hits = new Map();
/** Throws 429 when `key` has made `max` calls in the last `windowMs`. */
export function rateLimit(key, max, windowMs = HOUR, now = Date.now()) {
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    const retryAfter = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
    throw new HttpError("Too many requests from here. Please wait a little and try again.", 429, "rate_limited", { retryAfter });
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value);
}
export const forgetHits = () => hits.clear();

/* ---------- live scan budget ---------- */

let lock = Promise.resolve();
const serial = (fn) => {
  const p = lock.then(fn, fn);
  lock = p.catch(() => {});
  return p;
};

// Units reserved on this instance since the balance we hold was read from YouCam.
let reserved = { read: null, units: 0 };

const liveOff = (why) => new HttpError(`Live scans are paused right now (${why}). Try the demo instead.`, 503, "live_off");

/** Whether live scans are possible at all right now (for /api/health and /api/config). */
export async function liveStatus(now = Date.now()) {
  const s = settings();
  if (!s.live) return { live: false, reason: "switched off" };
  const day = (await get("pz_budget", `day:${dayKey(now)}`).catch(() => null)) || { liveScans: 0 };
  if (day.liveScans >= s.perDay) return { live: false, reason: "daily limit reached" };
  try {
    const units = await credit();
    if (units < s.floor) return { live: false, reason: "unit floor", units };
    return { live: true, units };
  } catch {
    return { live: false, reason: "YouCam balance unavailable" };
  }
}

/**
 * Checks every guard for one live scan costing `units`, and if all pass,
 * counts it straight away (before YouCam is called, so a burst can't slip
 * through). Throws HttpError otherwise.
 */
export function reserveLiveScan(ip, units, now = Date.now()) {
  return serial(async () => {
    const s = settings();
    if (!s.live) throw liveOff("switched off");

    const day = dayKey(now);
    const ipId = `ip:${ipHash(ip)}:${day}`;
    const mine = (await get("pz_budget", ipId)) || { id: ipId, day, liveScans: 0, units: 0, hits: [] };
    const lastHour = (mine.hits || []).filter((t) => now - t < HOUR);
    if (lastHour.length >= LIVE_PER_IP_HOUR || mine.liveScans >= LIVE_PER_IP_DAY) {
      const retryAfter = mine.liveScans >= LIVE_PER_IP_DAY
        ? Math.ceil((Date.parse(`${day}T00:00:00Z`) + 24 * HOUR - now) / 1000)
        : Math.max(1, Math.ceil((Math.min(...lastHour) + HOUR - now) / 1000));
      throw new HttpError("You've used your live scans for now. Try again later, or use the demo.", 429, "rate_limited", { retryAfter });
    }

    const dayId = `day:${day}`;
    const total = (await get("pz_budget", dayId)) || { id: dayId, day, liveScans: 0, units: 0 };
    if (total.liveScans >= s.perDay) throw liveOff("daily limit reached");

    let balance;
    try {
      balance = await credit();
    } catch {
      throw liveOff("YouCam balance unavailable");
    }
    const read = creditReadId();
    if (reserved.read !== read) reserved = { read, units: 0 };
    if (balance - reserved.units - units < s.floor) throw liveOff("unit floor reached");
    reserved.units += units;

    await put("pz_budget", { ...total, liveScans: total.liveScans + 1, units: total.units + units, at: new Date(now).toISOString() });
    await put("pz_budget", { ...mine, liveScans: mine.liveScans + 1, units: mine.units + units, hits: [...lastHour, now], at: new Date(now).toISOString() });
    return { day, units };
  });
}

/** Today's counters, for bin/budget.mjs. */
export async function today(now = Date.now()) {
  return (await get("pz_budget", `day:${dayKey(now)}`)) || { liveScans: 0, units: 0 };
}
