/**
 * Trip routes (owner: Coder B). Same format as the router:
 * [method, path, handler(ctx)], ctx = { req, body, params, query, ip }.
 *
 *   GET  /api/places?q=          q 2–60 chars → {results:[{id,name,admin1,country,lat,lon,timezone}]} (≤6)
 *   POST /api/forecast           {profile, trip} → {days:[Day], needs:[tag], horizon, sources, generatedAt}
 *   POST /api/kit                {profile, needs, carryOn} → {slots, buyThere, disclaimer, shop}
 *   POST /api/rescan/compare     {baseline, current, profile, days, selfReport} → {changes, causes, tonight, needs, safety}
 *
 * Profile and trip come in the request body (nothing is stored), and every
 * field is checked in src/validate.js. Routes that call Open-Meteo are
 * rate-limited per IP.
 */

import { HttpError } from "../http.js";
import { rateLimit } from "../budget.js";
import { geocode } from "../weather.js";
import { buildForecast } from "../forecast.js";
import { matchKit } from "../kit.js";
import { compare } from "../rescan.js";
import { catalog } from "../shopify.js";
import { readFileSync } from "node:fs";
import { productsFromCsvText } from "../catalog-csv.js";
import { validateProfile, validateTrip, validateNeeds, validateScores, validateDays, validateSelfReport } from "../validate.js";

export const PLACES_PER_HOUR = 120;
export const FORECASTS_PER_HOUR = 40;
export const Q_MIN = 2;
export const Q_MAX = 60;

const CSV_PATH = new URL("../../products/parasol-products.csv", import.meta.url);

/**
 * The shop catalog. If Shopify is down and the platform's CSV reader found
 * nothing (it expects the new template; the file is now the classic one),
 * read the CSV here so the offline list still shows.
 */
async function shopCatalog() {
  const shop = await catalog();
  if (shop.live || shop.products?.length) return shop;
  try {
    const products = productsFromCsvText(readFileSync(CSV_PATH, "utf8"));
    if (products.length) return { products, live: false, source: "csv", message: "Shop is offline. Here's the list." };
  } catch {}
  return shop;
}

const bad = (msg) => new HttpError(msg, 400, "bad_input");

export const routes = [
  ["GET", "/api/places", async ({ query, ip }) => {
    const raw = query.get("q");
    const q = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    if (q.length < Q_MIN || q.length > Q_MAX) throw bad(`Type ${Q_MIN} to ${Q_MAX} letters of a city name.`);
    rateLimit(`places|${ip}`, PLACES_PER_HOUR);
    return { results: await geocode(q) };
  }],

  ["POST", "/api/forecast", async ({ body, ip }) => {
    const profile = validateProfile(body.profile);
    const trip = validateTrip(body.trip);
    rateLimit(`forecast|${ip}`, FORECASTS_PER_HOUR);
    return buildForecast(profile, trip);
  }],

  ["POST", "/api/kit", async ({ body }) => {
    const profile = validateProfile(body.profile);
    const needs = validateNeeds(body.needs);
    if (body.carryOn !== undefined && typeof body.carryOn !== "boolean") throw bad("carryOn must be true or false.");
    const shop = await shopCatalog();
    const kit = matchKit(needs, shop.products, profile, body.carryOn !== false);
    return { ...kit, shop: { live: shop.live, source: shop.source, ...(shop.message ? { message: shop.message } : {}) } };
  }],

  ["POST", "/api/rescan/compare", async ({ body }) => {
    const baseline = validateScores(body.baseline, "baseline");
    const current = validateScores(body.current, "current");
    if (!baseline || !current) throw bad("Send the baseline and current scores.");
    const profile = body.profile === undefined ? null : validateProfile(body.profile);
    return compare(baseline, current, validateDays(body.days), validateSelfReport(body.selfReport), profile);
  }],
];

export const publicPaths = routes.map((r) => r[1]);
