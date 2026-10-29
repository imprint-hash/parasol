/**
 * STUB written by Coder A so the router loads. Coder B replaces this file and
 * owns it from then on. Signatures agreed in PLAN.md section 4:
 *
 *   GET  /api/places?q=          q 2–60 chars → {results:[{id,name,admin1,country,lat,lon,timezone}]} (≤6)
 *   POST /api/forecast           {profile, trip} → {days:[Day], needs:[tag], horizon, sources:[…], generatedAt}
 *   POST /api/kit                {profile, needs, carryOn} → {slots:[…], buyThere:[…], disclaimer}
 *   POST /api/rescan/compare     {baseline, current, profile, days, selfReport} → {changes, causes, tonight, needs, safety}
 *
 * Same format as the router: [method, path, handler(ctx)], where ctx is
 * { req, body, params, query, ip }. Throw HttpError(message, status, code) for
 * user-facing failures. The catalog for /api/kit comes from
 * `catalog()` in src/shopify.js (see its comment for the shape).
 */

import { HttpError } from "../http.js";

const notYet = async () => {
  throw new HttpError("This part of Parasol isn't built yet.", 501, "not_ready");
};

export const routes = [
  ["GET", "/api/places", notYet],
  ["POST", "/api/forecast", notYet],
  ["POST", "/api/kit", notYet],
  ["POST", "/api/rescan/compare", notYet],
];

export const publicPaths = routes.map((r) => r[1]);
