/**
 * Platform routes: health, config, scan, demo scan, my data, cart, cron.
 * Same format as the router: [method, path, handler(ctx), options?].
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { HttpError } from "../http.js";
import { storeName, list, remove } from "../store.js";
import { liveStatus, settings, rateLimit, secretOk } from "../budget.js";
import { scanRequest, deleteMyData, SCAN_BODY_LIMIT } from "../scan.js";
import { demoScan, demoReady, fixturesPresent } from "../demo.js";
import { createCart, shopHealth, shopDomain } from "../shopify.js";

export const TEST_CARD = "Bogus Gateway: card number 1, any future date, any CVV";
export const DISCLAIMER = "Not medical advice. Burn times are estimates. Demo shop: not affiliated with these brands.";

const DAY = 86400_000;
// The dev store's storefront password. Not a secret: Shopify forces a password
// on development stores, so it's shown to judges next to Checkout.
export const DEMO_STORE_PASSWORD = "ahltea";
const storePassword = () => process.env.SHOPIFY_STORE_PASSWORD || DEMO_STORE_PASSWORD;

/** Constant-time check of `Authorization: Bearer <secret>`. */
function bearerOk(req, secret) {
  if (!secret) return false;
  const want = createHash("sha256").update(`Bearer ${secret}`).digest();
  const got = createHash("sha256").update(String(req.headers.authorization || "")).digest();
  return timingSafeEqual(want, got);
}

async function cleanup(now = Date.now()) {
  const deleted = { pz_ycache: 0, pz_budget: 0, pz_wx: 0 };
  const old = (iso, ms) => Number.isFinite(Date.parse(iso)) && now - Date.parse(iso) > ms;
  for (const r of await list("pz_ycache", (r) => old(r.at, 30 * DAY))) {
    await remove("pz_ycache", r.id);
    deleted.pz_ycache++;
  }
  for (const r of await list("pz_budget", (r) => typeof r.day === "string" && old(`${r.day}T00:00:00Z`, 7 * DAY))) {
    await remove("pz_budget", r.id);
    deleted.pz_budget++;
  }
  // pz_wx records are {id, at, ttl (seconds), body}.
  for (const r of await list("pz_wx", (r) => Number.isFinite(Number(r.ttl)) && old(r.at, Number(r.ttl) * 1000))) {
    await remove("pz_wx", r.id);
    deleted.pz_wx++;
  }
  return deleted;
}

export const routes = [
  ["GET", "/api/health", async () => {
    const [live, shopify] = await Promise.all([liveStatus(), shopHealth()]);
    const config = secretOk() ? "ok" : "misconfigured";
    return { ok: config === "ok", store: storeName, config, youcamLive: live.live, demoReady: demoReady(), fixtures: fixturesPresent(), shopify };
  }],

  ["GET", "/api/config", async () => ({
    liveScans: settings().live,
    storePassword: storePassword(),
    shopDomain: shopDomain() || null,
    testCard: TEST_CARD,
    disclaimer: DISCLAIMER,
  })],

  ["POST", "/api/scan", async ({ body, ip }) => ({ scan: await scanRequest(body, ip) }), { maxBody: SCAN_BODY_LIMIT }],

  ["POST", "/api/demo/scan", async ({ body, ip }) => {
    rateLimit(`demo|${ip}`, 300);
    return demoScan(body);
  }],

  ["DELETE", "/api/my-data", async ({ body, ip }) => {
    rateLimit(`mydata|${ip}`, 30);
    return deleteMyData(body);
  }],

  ["POST", "/api/cart", async ({ body, ip }) => {
    rateLimit(`cart|${ip}`, 20);
    const { checkoutUrl } = await createCart(body.lines);
    return { checkoutUrl, storePassword: storePassword(), testCard: TEST_CARD };
  }],

  ["GET", "/api/cron/cleanup", async ({ req }) => {
    if (!bearerOk(req, process.env.CRON_SECRET)) throw new HttpError("Not allowed.", 401, "unauthorized");
    return { deleted: await cleanup() };
  }],
];

export const publicPaths = routes.map((r) => r[1]);
export { cleanup };
