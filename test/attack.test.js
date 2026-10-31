/**
 * Attack tests (PLAN.md section 11, Tester list). Offline only:
 *   - YouCam is the stub in test/helpers/youcam-stub.js,
 *   - Shopify is answered in-process for the fake shop domain (no network),
 *   - Open-Meteo goes through test/helpers/meteo-stub.js,
 *   - every other host is blocked, so nothing here can reach the internet or
 *     spend YouCam units.
 *
 * Tests marked `{ todo: "BUG-n: …" }` are real bugs found by the Tester. They
 * run and report as TODO so the suite stays green; each one passes once the
 * bug is fixed. Search for "BUG-" to find them.
 */

// Fake secrets must load before anything reads .env.
import { SECRETS, TEST_DIR, startApp } from "./helpers/env.js";
import { startYoucamStub, fakeJpeg, fakePng, dataUrl, DEFAULT_SCORES } from "./helpers/youcam-stub.js";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHOP_DOMAIN = "test-shop.myshopify.com";

/* ---------- network guard + in-process Shopify ---------- */

const realFetch = globalThis.fetch;
const blocked = [];
const shop = { calls: [], down: false, checkoutUrl: `https://${SHOP_DOMAIN}/cart/c/abc?key=1`, userErrors: [] };
const SHOP_PRODUCTS = [
  { handle: "lrp-anthelios", title: "Anthelios SPF50+", vendor: "La Roche-Posay", tags: ["parasol", "type-sunscreen", "spf-50-plus"], featuredImage: null, variants: { nodes: [{ id: "gid://shopify/ProductVariant/111", availableForSale: true, price: { amount: "38.0", currencyCode: "USD" } }] } },
  { handle: "sold-out-mist", title: "Mist", vendor: "Evian", tags: ["parasol", "type-mist"], featuredImage: null, variants: { nodes: [{ id: "gid://shopify/ProductVariant/222", availableForSale: false, price: { amount: "9.5", currencyCode: "USD" } }] } },
  // The dev store's sample snowboard and gift card: no parasol tag, so never sellable.
  { handle: "the-minimal-snowboard", title: "The Minimal Snowboard", vendor: "Snowboard Vendor", tags: ["Winter"], variants: { nodes: [{ id: "gid://shopify/ProductVariant/50065009279235", availableForSale: true, price: { amount: "885.95", currencyCode: "USD" } }] } },
  { handle: "gift-card", title: "Gift Card", vendor: "Snowboard Vendor", tags: [], variants: { nodes: [{ id: "gid://shopify/ProductVariant/50065009344771", availableForSale: true, price: { amount: "10.0", currencyCode: "USD" } }] } },
];
const SNOWBOARD = "gid://shopify/ProductVariant/50065009279235";
const GIFT_CARD = "gid://shopify/ProductVariant/50065009344771";

function shopAnswer(init) {
  const { query = "" } = JSON.parse(init?.body || "{}");
  shop.calls.push({ token: init?.headers?.["x-shopify-storefront-access-token"], query });
  const send = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (shop.down) return send(503, { errors: [{ message: "down" }] });
  if (query.includes("cartCreate")) return send(200, { data: { cartCreate: { cart: shop.userErrors.length ? null : { checkoutUrl: shop.checkoutUrl }, userErrors: shop.userErrors } } });
  if (query.includes("products(") || query.includes("collection(")) {
    // The real store returns everything the token can see; the server must filter.
    return send(200, { data: { products: { nodes: SHOP_PRODUCTS }, collection: { products: { nodes: SHOP_PRODUCTS } } } });
  }
  if (query.includes("shop")) return send(200, { data: { shop: { name: "test" } } });
  return send(400, { errors: [{ message: "?" }] });
}

globalThis.fetch = async (input, init) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return realFetch(input, init);
  if (u.hostname === SHOP_DOMAIN) return shopAnswer(init);
  blocked.push(u.hostname);
  throw new TypeError(`blocked by attack.test.js: no live calls (${u.hostname})`);
};
// Use the real Shopify endpoint path (so the checkout host check is real), answered above.
delete process.env.SHOPIFY_API_URL;
process.env.SHOPIFY_STORE_DOMAIN = SHOP_DOMAIN;

// The meteo stub captures globalThis.fetch at import, so import it after the guard.
const { stubMeteo, defaultHandler } = await import("./helpers/meteo-stub.js");
const meteo = stubMeteo(defaultHandler({ geocode: () => ({ results: [{ id: 1, name: "Lagos", admin1: "Lagos", country: "Nigeria", latitude: 6.45, longitude: 3.39, timezone: "Africa/Lagos" }] }) }));

const stub = await startYoucamStub();
process.env.YOUCAM_BASE_URL = stub.url;

/* ---------- collect every log line, to check for secrets at the end ---------- */

const logs = [];
for (const k of ["log", "info", "warn", "error", "debug"]) {
  const orig = console[k].bind(console);
  console[k] = (...a) => {
    logs.push(a.map((x) => (typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(" "));
    orig(...a);
  };
}

const store = await import("../src/store.js");
const { forgetHits, clientIp } = await import("../src/budget.js");
const youcam = await import("../src/youcam.js");
const scanMod = await import("../src/scan.js");
const shopMod = await import("../src/shopify.js");
const { forgetWeather } = await import("../src/weather.js");
const { burnRange, protectHours } = await import("../src/burn.js");
const { evaluate, CALM_HEADLINE } = await import("../src/rules.js");
const { validateProfile } = await import("../src/validate.js");
const { addDays } = await import("../src/days.js");
const { reset, put, get, list } = store;

const app = await startApp();
after(async () => {
  meteo.restore();
  globalThis.fetch = realFetch;
  await app.close();
  await stub.close();
});

const BASE_ENV = { LIVE_SCANS: "on", LIVE_SCANS_PER_DAY: "15", UNITS_FLOOR: "150", YOUCAM_POLL_MAX_MS: "3000", YOUCAM_SKIN_TONE: "0", YOUCAM_BASE_URL: stub.url, PARASOL_SECRET: SECRETS.PARASOL_SECRET };
beforeEach(async () => {
  stub.reset();
  forgetHits();
  youcam.forgetCredit();
  shopMod.forgetCatalog();
  shopMod.forgetShopHealth();
  forgetWeather();
  Object.assign(shop, { down: false, checkoutUrl: `https://${SHOP_DOMAIN}/cart/c/abc?key=1`, userErrors: [] });
  shop.calls.length = 0;
  meteo.calls.length = 0;
  delete process.env.VERCEL;
  Object.assign(process.env, BASE_ENV);
  await reset();
});

/**
 * One request on its own socket (no keep-alive). Used for oversized bodies,
 * which leave a keep-alive connection unusable (see BUG-6).
 */
function rawCall(method, path, body, headers = {}) {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(app.url + path, { method, agent: false, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data), ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode, headers: { get: (k) => res.headers[k.toLowerCase()] ?? null }, body: json, text });
      });
    });
    req.on("error", (e) => (e.code === "EPIPE" || e.code === "ECONNRESET" ? null : reject(e)));
    req.end(data);
  });
}

const scan = (image, extra = {}, headers) => app.call("POST", "/api/scan", { image, consent: true, consentVersion: 1, ...extra }, headers);
const youcamCalls = () => stub.calls.filter((c) => c.path.startsWith("/s2s/v2.0/task") || c.path.startsWith("/s2s/v2.0/file") || c.path.startsWith("/upload/")).length;
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const TODAY = new Date().toISOString().slice(0, 10);
const d = (n) => addDays(TODAY, n);

/* =====================================================================
 * 1. Consent
 * ===================================================================== */

test("consent: missing, string, number, wrong version, or smuggled via __proto__ is 400 with zero YouCam calls", async () => {
  const img = dataUrl(fakeJpeg());
  const bodies = [
    { image: img },
    { image: img, consent: "true", consentVersion: 1 },
    { image: img, consent: 1, consentVersion: 1 },
    { image: img, consent: [true], consentVersion: 1 },
    { image: img, consent: { value: true }, consentVersion: 1 },
    { image: img, consent: true },
    { image: img, consent: true, consentVersion: "1" },
    { image: img, consent: true, consentVersion: 0 },
    { image: img, consent: false, consentVersion: 1 },
  ];
  for (const b of bodies) {
    const r = await app.call("POST", "/api/scan", b);
    assert.equal(r.status, 400, JSON.stringify({ ...b, image: "…" }));
    assert.equal(r.body.code, "no_consent");
  }
  // JSON "__proto__" becomes an own key, never the prototype: still no consent.
  const r = await app.call("POST", "/api/scan", `{"image":"${img}","__proto__":{"consent":true,"consentVersion":1}}`);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "no_consent");
  assert.equal(stub.calls.length, 0, "no YouCam call at all, not even the free credit check");
  assert.equal((await list("pz_budget")).length, 0, "nothing counted against the budget");
});

test("consent is checked before the image: a huge bad photo without consent is still no_consent", async () => {
  const r = await app.call("POST", "/api/scan", { image: "data:text/html;base64,PGh0bWw+", consent: "yes" });
  assert.equal(r.body.code, "no_consent");
  assert.equal(stub.calls.length, 0);
});

/* =====================================================================
 * 2. Unit burn
 * ===================================================================== */

test("unit burn: 10 parallel DIFFERENT photos from one IP are exactly 3 YouCam runs, the rest 429", async () => {
  const rs = await Promise.all(Array.from({ length: 10 }, () => scan(dataUrl(fakeJpeg()))));
  const by = rs.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  assert.deepEqual(by, { 200: 3, 429: 7 });
  assert.equal(stub.skinRuns, 3);
  for (const r of rs.filter((x) => x.status === 429)) assert.equal(r.body.code, "rate_limited");
});

test("unit burn: per-IP daily limit (6) is 429 with retryAfter up to UTC midnight, even after the hour rolls over", async () => {
  assert.equal((await scan(dataUrl(fakeJpeg()))).status, 200);
  const [rec] = (await list("pz_budget")).filter((r) => r.id.startsWith("ip:"));
  assert.ok(rec, "an ip: budget record exists");
  assert.ok(!rec.id.includes("127.0.0.1"), "IPs are never stored raw");
  await put("pz_budget", { ...rec, liveScans: 6, hits: [Date.now() - 2 * 3600_000] });
  const r = await scan(dataUrl(fakeJpeg()));
  assert.equal(r.status, 429);
  assert.equal(r.body.code, "rate_limited");
  const toMidnight = Math.ceil((Date.parse(`${TODAY}T00:00:00Z`) + 86400_000 - Date.now()) / 1000);
  assert.ok(Math.abs(r.body.retryAfter - toMidnight) <= 2, `retryAfter ${r.body.retryAfter} vs ${toMidnight}`);
  assert.equal(stub.skinRuns, 1);
});

test("unit burn: the hourly window rolls: 3 scans over an hour ago don't block a new one", async () => {
  assert.equal((await scan(dataUrl(fakeJpeg()))).status, 200);
  const [rec] = (await list("pz_budget")).filter((r) => r.id.startsWith("ip:"));
  const old = Date.now() - 61 * 60_000;
  await put("pz_budget", { ...rec, liveScans: 3, hits: [old, old, old] });
  assert.equal((await scan(dataUrl(fakeJpeg()))).status, 200);
});

test("unit burn: cache hits are free: the same photo 5 more times is still 1 run and doesn't eat the IP quota", async () => {
  const img = dataUrl(fakeJpeg());
  for (let i = 0; i < 6; i++) assert.equal((await scan(img)).status, 200);
  assert.equal(stub.skinRuns, 1);
  const [rec] = (await list("pz_budget")).filter((r) => r.id.startsWith("ip:"));
  assert.equal(rec.liveScans, 1);
  // Two more different photos still fit in the hour.
  assert.equal((await scan(dataUrl(fakeJpeg()))).status, 200);
  assert.equal((await scan(dataUrl(fakeJpeg()))).status, 200);
});

test("unit burn: daily cap across many clients: 10 parallel scans from 10 IPs with a cap of 2 are exactly 2 runs", async () => {
  process.env.VERCEL = "1";
  process.env.LIVE_SCANS_PER_DAY = "2";
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => scan(dataUrl(fakeJpeg()), {}, { "x-forwarded-for": `198.51.100.${i + 1}` })));
  const by = rs.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  assert.deepEqual(by, { 200: 2, 503: 8 });
  assert.ok(rs.filter((r) => r.status === 503).every((r) => r.body.code === "live_off"));
  assert.equal(stub.skinRuns, 2);
});

test("unit burn: a daily cap of 0 stops the first scan; a junk cap falls back to 15, not unlimited", async () => {
  process.env.LIVE_SCANS_PER_DAY = "0";
  assert.equal((await scan(dataUrl(fakeJpeg()))).body.code, "live_off");
  process.env.LIVE_SCANS_PER_DAY = "lots";
  await put("pz_budget", { id: `day:${TODAY}`, day: TODAY, liveScans: 15, units: 360 });
  assert.equal((await scan(dataUrl(fakeJpeg()))).body.code, "live_off");
  assert.equal(stub.skinRuns, 0);
});

test("unit burn: the unit floor boundary (174 − 24 = 150 passes, 173 fails; with skin tone the cost is 44)", async () => {
  stub.state.units = 174;
  assert.equal((await scan(dataUrl(fakeJpeg()))).status, 200);
  youcam.forgetCredit();
  forgetHits();
  await reset();
  stub.state.units = 173;
  assert.equal((await scan(dataUrl(fakeJpeg()))).body.code, "live_off");
  youcam.forgetCredit();
  process.env.YOUCAM_SKIN_TONE = "1";
  stub.state.units = 193; // 193 − 44 < 150
  assert.equal((await scan(dataUrl(fakeJpeg()))).body.code, "live_off");
  assert.equal(stub.skinRuns, 1);
});

test("unit burn: YouCam balance unreadable means stop (503), not go", async () => {
  process.env.YOUCAM_BASE_URL = "http://127.0.0.1:9"; // closed port
  const r = await scan(dataUrl(fakeJpeg()));
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "live_off");
});

test(
  "unit burn: the floor check must not trust a stale cached balance during a burst",
  async () => {
    stub.state.units = 200; // floor 150, cost 24
    assert.equal((await scan(dataUrl(fakeJpeg()))).status, 200);
    stub.state.units = 176;
    assert.equal((await scan(dataUrl(fakeJpeg()))).status, 200);
    stub.state.units = 152; // 152 − 24 = 128 < 150
    const r = await scan(dataUrl(fakeJpeg()));
    assert.equal(r.status, 503, "third scan must be refused: real balance would drop to 128");
  }
);

test("unit burn: kill switch LIVE_SCANS=off (any case) is 503 with zero task calls; /api/config and /api/health agree", async () => {
  for (const v of ["off", "OFF", "Off"]) {
    process.env.LIVE_SCANS = v;
    const r = await scan(dataUrl(fakeJpeg()));
    assert.equal(r.status, 503, v);
    assert.equal(r.body.code, "live_off");
  }
  assert.equal(youcamCalls(), 0);
  assert.equal((await app.call("GET", "/api/config")).body.liveScans, false);
  assert.equal((await app.call("GET", "/api/health")).body.youcamLive, false);
});

test(
  "unit burn: kill switch fails closed for obvious 'off' spellings",
  async () => {
    for (const v of ["false", "0", "no", "off ", "disabled"]) {
      youcam.forgetCredit();
      process.env.LIVE_SCANS = v;
      const r = await scan(dataUrl(fakeJpeg()));
      assert.equal(r.status, 503, `LIVE_SCANS=${JSON.stringify(v)} should stop live scans`);
    }
  }
);

test("unit burn: the same photo twice is 1 run; 10 parallel identical uploads are 1 run", async () => {
  const img = dataUrl(fakeJpeg());
  assert.equal((await scan(img)).body.scan.source, "live");
  assert.equal((await scan(img)).body.scan.source, "cache");
  assert.equal(stub.skinRuns, 1);
  stub.reset();
  const img2 = dataUrl(fakeJpeg());
  const rs = await Promise.all(Array.from({ length: 10 }, () => scan(img2)));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(stub.skinRuns, 1);
  assert.equal(stub.started["fitzpatrick-scale-analyzer"], 1);
  assert.equal(rs.filter((r) => r.body.scan.source === "live").length, 1);
});

test("unit burn: 10 parallel identical uploads with only 1 IP slot left still work, as 1 run", async () => {
  await scan(dataUrl(fakeJpeg()));
  await scan(dataUrl(fakeJpeg()));
  const img = dataUrl(fakeJpeg());
  const rs = await Promise.all(Array.from({ length: 10 }, () => scan(img)));
  assert.ok(rs.every((r) => r.status === 200), rs.map((r) => r.status).join(","));
  assert.equal(stub.skinRuns, 3);
});

test("unit burn: 10 parallel identical uploads that hit a face error are 1 run, all 422", async () => {
  stub.state.skinError = "error_no_face";
  const img = dataUrl(fakeJpeg());
  const rs = await Promise.all(Array.from({ length: 10 }, () => scan(img)));
  assert.ok(rs.every((r) => r.status === 422 && r.body.code === "no_face"));
  assert.equal(stub.skinRuns, 1);
});

test("unit burn: demo routes make zero YouCam calls (not even the credit check)", async () => {
  for (const body of [{ persona: "ada" }, { persona: "ada", kind: "baseline" }, { persona: "ada", kind: "rescan" }, { persona: "sam" }, { persona: "sam", kind: "rescan" }, { persona: "nobody" }]) {
    await app.call("POST", "/api/demo/scan", body);
  }
  assert.equal(stub.calls.length, 0);
});

test("unit burn: X-Forwarded-For spoofing (on Vercel only the right-most entry counts; off Vercel headers are ignored)", async () => {
  process.env.VERCEL = "1";
  const real = "203.0.113.7";
  for (let i = 0; i < 3; i++) assert.equal((await scan(dataUrl(fakeJpeg()), {}, { "x-forwarded-for": `10.0.0.${i}, ${real}` })).status, 200);
  for (const spoof of [`10.9.9.9, ${real}`, `${real}`, `1.1.1.1,2.2.2.2, ${real}`, ` ${real} `]) {
    const r = await scan(dataUrl(fakeJpeg()), {}, { "x-forwarded-for": spoof, "x-real-ip": "10.1.1.1" });
    assert.equal(r.status, 429, spoof);
  }
  assert.equal(stub.skinRuns, 3);
  // x-real-ip can't override x-forwarded-for.
  assert.equal(clientIp({ headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9", "x-real-ip": "1.2.3.4" }, socket: {} }), "203.0.113.9");
  delete process.env.VERCEL;
  assert.equal(clientIp({ headers: { "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7" }, socket: { remoteAddress: "192.0.2.1" } }), "192.0.2.1");
});

/* =====================================================================
 * 3. Cache poisoning
 * ===================================================================== */

test("cache poisoning: client-supplied hash, id, scores, source, kind, deleteToken and masks are ignored", async () => {
  const img = fakeJpeg();
  const r = await scan(dataUrl(img), {
    source: "demo", hash: "a".repeat(64), imageHash: "a".repeat(64), id: "mine", deleteToken: "x".repeat(43),
    scores: { redness: 100 }, skin: { type: "dry", scores: { redness: 100 } }, fitz: { scale: "I" }, masks: { redness: "javascript:alert(1)" },
    masksExpireAt: "2999-01-01T00:00:00Z", kind: "<img src=x onerror=alert(1)>",
  });
  assert.equal(r.status, 200);
  const s = r.body.scan;
  assert.equal(s.source, "live");
  assert.equal(s.kind, "baseline");
  assert.notEqual(s.id, "mine");
  assert.equal(s.skin.scores.redness, DEFAULT_SCORES.redness);
  assert.equal(s.fitz.scale, "V");
  assert.ok(Object.values(s.masks).every((u) => u.startsWith("https://")));
  assert.equal(s.deleteToken, scanMod.deleteTokenFor(sha(img)));
  assert.equal(await get("pz_ycache", "a".repeat(64)), null);
  assert.ok(await get("pz_ycache", sha(img)));
});

test("cache poisoning: nothing is cached unless YouCam succeeded (face error, 5xx, timeout, empty scores, two faces)", async () => {
  const cases = [
    ["face error", () => (stub.state.skinError = "error_face_position_too_small"), 422],
    ["task start 500", () => (stub.state.startStatus = 500), 502],
    ["never finishes", () => { stub.state.neverFinish = true; process.env.YOUCAM_POLL_MAX_MS = "60"; }, 502],
    ["success but no scores", () => (stub.state.scores = {}), 502],
    ["two faces", () => (stub.state.faces = 2), 422],
  ];
  for (const [name, arrange, status] of cases) {
    stub.reset();
    forgetHits();
    await reset();
    Object.assign(process.env, BASE_ENV);
    arrange();
    const r = await scan(dataUrl(fakeJpeg()));
    assert.equal(r.status, status, name);
    assert.equal((await list("pz_ycache")).length, 0, `${name}: nothing cached`);
  }
});

test("cache poisoning: YouCam scores out of range are clamped 0–100, odd skin types dropped, non-https masks dropped", async () => {
  stub.state.scores = { ...DEFAULT_SCORES, redness: 150, acne: -20, oiliness: 55.6 };
  stub.state.skinTypes = { whole: "<script>", t_zone: "Oily", u_zone: "Dry" };
  const s = (await scan(dataUrl(fakeJpeg()))).body.scan;
  assert.equal(s.skin.scores.redness, 100);
  assert.equal(s.skin.scores.acne, 0);
  assert.equal(s.skin.scores.oiliness, 56);
  assert.equal(s.skin.type, "combination");

  const out = scanMod.normalise([
    { type: "redness", ui_score: 50, mask_urls: ["javascript:alert(1)"] },
    { type: "acne", ui_score: 50, mask_urls: ["http://evil.example/x.png"] },
    { type: "pore", ui_score: 50, mask_urls: ["data:image/svg+xml,<svg onload=alert(1)>"] },
    { type: "__proto__", ui_score: 1 },
    { type: "constructor", ui_score: 1 },
    { type: "moisture", ui_score: "50" },
  ], null, null);
  assert.deepEqual(out.masks, {});
  assert.deepEqual(Object.keys(out.skin.scores).sort(), ["acne", "pore", "redness"]);
  assert.equal(out.masksExpireAt, null);
});

test("cache poisoning: demo fixtures can't be changed through the API or the store", async () => {
  const files = ["ada", "sam", "sample"].map((n) => join(ROOT, "data/demo", `${n}.json`));
  const before = files.map((f) => (existsSync(f) ? readFileSync(f, "utf8") : null));
  const ada0 = (await app.call("POST", "/api/demo/scan", { persona: "ada" })).body.scan;
  // Records with fixture-like ids in the only writable collection.
  for (const id of ["ada", "sam", "sample", "baseline", "demo"]) await put("pz_ycache", { id, skin: { type: "dry", scores: { redness: 1 } } });
  await app.call("POST", "/api/demo/scan", { persona: "ada", skin: { scores: { redness: 1 } }, baseline: { skin: {} } });
  await scan(dataUrl(fakeJpeg()), { persona: "ada", kind: "baseline" });
  const ada1 = (await app.call("POST", "/api/demo/scan", { persona: "ada" })).body.scan;
  assert.deepEqual(ada1.skin, ada0.skin);
  assert.deepEqual(files.map((f) => (existsSync(f) ? readFileSync(f, "utf8") : null)), before);
  for (const persona of ["__proto__", "constructor", "sample", "../ada", "ada.json", "ADA", ["ada"], { toString: "ada" }, "ada\u0000"]) {
    const r = await app.call("POST", "/api/demo/scan", { persona });
    assert.equal(r.status, 400, JSON.stringify(persona));
  }
});

test("cache poisoning: a deleteToken for one photo can't delete another; forged or malformed tokens are refused", async () => {
  const a = fakeJpeg(), b = fakeJpeg();
  const ta = (await scan(dataUrl(a))).body.scan.deleteToken;
  const tb = (await scan(dataUrl(b))).body.scan.deleteToken;
  assert.notEqual(ta, tb);
  const del = (deleteTokens) => app.call("DELETE", "/api/my-data", { deleteTokens });

  // Malformed → 403.
  for (const t of [["forged"], [ta + "x"], [ta.slice(1)], [123], [null], [{ token: ta }], [ta.replace(/./, "+")]]) {
    assert.equal((await del(t)).status, 403, JSON.stringify(t).slice(0, 30));
  }
  // Wrong shape → 400.
  for (const t of [ta, [], Array(21).fill(ta), undefined]) assert.equal((await del(t)).status, 400);
  // Well-formed forgeries delete nothing: the raw hash, an HMAC with the wrong key,
  // an HMAC with the public dev fallback, and the token of a different hash.
  const forged = [
    Buffer.from(sha(a), "hex").toString("base64url").padEnd(43, "A").slice(0, 43),
    createHmac("sha256", "wrong-key").update(`delete|${sha(a)}`).digest("base64url"),
    createHmac("sha256", "dev-only-secret-not-for-production").update(`delete|${sha(a)}`).digest("base64url"),
    scanMod.deleteTokenFor(sha(fakeJpeg())),
  ];
  const r = await del(forged);
  assert.equal(r.body.deleted, 0);
  assert.equal((await list("pz_ycache")).length, 2);
  // The real token deletes exactly its own record, once.
  assert.equal((await del([ta, ta])).body.deleted, 1);
  assert.equal(await get("pz_ycache", sha(a)), null);
  assert.ok(await get("pz_ycache", sha(b)));
  assert.equal((await del([ta])).body.deleted, 0);
});

/* =====================================================================
 * 4. Input validation
 * ===================================================================== */

test("input: non-images, SVG, HTML polyglot, GIF, WebP, wrong mime, odd data-URL forms and broken base64 are bad_image with no YouCam call", async () => {
  const jpeg = fakeJpeg();
  const b64 = jpeg.toString("base64");
  const cases = {
    text: "data:image/jpeg;base64," + Buffer.from("hello").toString("base64"),
    svg: "data:image/svg+xml;base64," + Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>").toString("base64"),
    svgAsJpeg: "data:image/jpeg;base64," + Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64"),
    htmlPolyglot: "data:image/png;base64," + Buffer.from("<!doctype html><script>alert(1)</script>").toString("base64"),
    gif: "data:image/jpeg;base64," + Buffer.from("GIF89a\x01\x00\x01\x00").toString("base64"),
    webp: "data:image/jpeg;base64," + Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 ").toString("base64"),
    pngLabelledJpeg: dataUrl(fakePng(), "image/jpeg"),
    jpegLabelledPng: dataUrl(jpeg, "image/png"),
    gifMime: `data:image/gif;base64,${b64}`,
    webpMime: `data:image/webp;base64,${b64}`,
    upperCase: `DATA:IMAGE/JPEG;BASE64,${b64}`,
    withParams: `data:image/jpeg;charset=utf-8;base64,${b64}`,
    notBase64: `data:image/jpeg,${encodeURIComponent(jpeg.toString("latin1"))}`,
    truncated: dataUrl(jpeg).slice(0, -3),
    truncatedTo1: `data:image/jpeg;base64,${b64.slice(0, 1)}`,
    empty: "data:image/jpeg;base64,",
    base64url: `data:image/jpeg;base64,${jpeg.toString("base64url")}`.padEnd(30, "-") + "-_-_",
    newlines: `data:image/jpeg;base64,${b64.slice(0, 8)}\n${b64.slice(8)}`,
    paddingInMiddle: `data:image/jpeg;base64,${b64.slice(0, 8)}====${b64.slice(8)}`,
    leadingSpace: ` ${dataUrl(jpeg)}`,
    array: [dataUrl(jpeg)],
    object: { toString: () => dataUrl(jpeg) },
    nul: null,
  };
  for (const [name, image] of Object.entries(cases)) {
    const r = await scan(image);
    assert.equal(r.status, 400, name);
    assert.equal(r.body.code, "bad_image", name);
  }
  assert.equal(youcamCalls(), 0);
});

test("input: hostile JPEG/PNG headers (zero size, huge size, looping or short segments) never hang or crash", async () => {
  const u16 = (v) => Buffer.from([v >> 8, v & 255]);
  const sof = (w, h) => Buffer.concat([Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]), u16(h), u16(w), Buffer.alloc(10)]);
  const jpeg = (...parts) => Buffer.concat([Buffer.from([0xff, 0xd8]), ...parts, Buffer.from([0xff, 0xd9])]);
  const png = (w, h) => {
    const b = fakePng(800, 1000);
    b.writeUInt32BE(w >>> 0, 16);
    b.writeUInt32BE(h >>> 0, 20);
    return b;
  };
  const cases = [
    [jpeg(sof(0, 0)), 400, "bad_image"],
    [jpeg(sof(800, 0)), 400, "bad_image"],
    [jpeg(sof(65535, 65535)), 422, "too_large"],
    [jpeg(Buffer.from([0xff, 0xe0, 0x00, 0x00])), 400, "bad_image"], // segment length 0
    [jpeg(Buffer.from([0xff, 0xe0, 0x00, 0x01])), 400, "bad_image"], // segment length 1
    [jpeg(Buffer.from([0xff, 0xe0, 0xff, 0xff])), 400, "bad_image"], // length past the end
    [jpeg(Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x03])), 400, "bad_image"], // SOF cut short
    [Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(5000, 0xff)]), 400, "bad_image"], // endless fill bytes
    [png(0, 1000), 400, "bad_image"],
    [png(0x80000000, 1000), 422, "too_large"],
    [png(4097, 1000), 422, "too_large"],
    [png(1000, 479), 422, "too_small"],
  ];
  for (const [buf, status, code] of cases) {
    const type = buf[0] === 0x89 ? "image/png" : "image/jpeg";
    const r = await scan(dataUrl(buf, type));
    assert.equal(r.status, status, buf.subarray(0, 12).toString("hex"));
    assert.equal(r.body.code, code);
  }
  assert.equal(youcamCalls(), 0);
});

test("input: size limits: 2 MB + 1 byte is 413; 4096/4097 and 480/479 px boundaries; a 4 MB body is 413 JSON", async () => {
  const head = fakeJpeg();
  const big = Buffer.concat([head, Buffer.alloc(2 * 1024 * 1024 + 1 - head.length)]);
  let r = await scan(dataUrl(big));
  assert.equal(r.status, 413);
  assert.equal(r.body.code, "too_large");
  assert.equal((await scan(dataUrl(fakeJpeg(4097, 800)))).body.code, "too_large");
  assert.equal((await scan(dataUrl(fakeJpeg(479, 479)))).body.code, "too_small");
  assert.equal((await scan(dataUrl(fakePng(479, 4096), "image/png"))).body.code, "too_small");
  assert.equal(youcamCalls(), 0);
  r = await rawCall("POST", "/api/scan", { consent: true, consentVersion: 1, image: "data:image/jpeg;base64," + "A".repeat(4 * 1024 * 1024) });
  assert.equal(r.status, 413);
  assert.match(r.headers.get("content-type"), /^application\/json/);
});

test(
  "input: after a 413 for an oversized body, the next requests on the same keep-alive connection still get answers",
  async () => {
    const own = await startApp(); // its own origin, so a poisoned socket can't leak into other tests
    try {
      const big = JSON.stringify({ consent: true, consentVersion: 1, image: "data:image/jpeg;base64," + "A".repeat(4 * 1024 * 1024) });
      assert.equal((await own.call("POST", "/api/scan", big)).status, 413);
      for (let i = 0; i < 3; i++) {
        const t = Date.now();
        const r = await own.call("GET", "/api/config");
        assert.equal(r.status, 200);
        assert.ok(Date.now() - t < 2000, "answer took over 2 s");
      }
    } finally {
      await own.close();
    }
  }
);

test("input: request bodies that aren't a JSON object are 400 bad_json; other routes cap at 32 KB", async () => {
  for (const body of ["[]", "null", '"x"', "1", "{", "{\"a\":}", "\u0000"]) {
    const r = await app.call("POST", "/api/kit", body);
    assert.equal(r.status, 400, body);
    assert.match(r.headers.get("content-type"), /json/);
  }
  const r = await rawCall("POST", "/api/kit", { profile: { skinType: "oily", fitz: "V" }, pad: "x".repeat(40 * 1024) });
  assert.equal(r.status, 413);
  assert.match(r.headers.get("content-type"), /^application\/json/);
});

const LAGOS = { name: "Lagos", lat: 6.4541, lon: 3.3947, timezone: "Africa/Lagos" };
const ADA = { skinType: "combination", fitz: "VI", concerns: [] };
const okTrip = () => ({ legs: [{ ...LAGOS, from: d(1), to: d(3) }], flights: [], carryOn: true });

test("input: trip attacks (6 legs, 31 days, from > to, NaN/91 lat, bad zone, >365 days out, bad flights) are 400 with no weather call", async () => {
  const legN = (n) => Array.from({ length: n }, (_, i) => ({ ...LAGOS, name: `C${i}`, from: d(1 + i), to: d(1 + i) }));
  const cases = {
    sixLegs: { legs: legN(6) },
    noLegs: { legs: [] },
    legsNotArray: { legs: "Lagos" },
    days31: { legs: [{ ...LAGOS, from: d(1), to: d(31) }] },
    fromAfterTo: { legs: [{ ...LAGOS, from: d(5), to: d(3) }] },
    latNaNString: { legs: [{ ...LAGOS, lat: "NaN", from: d(1), to: d(2) }] },
    latNull: { legs: [{ ...LAGOS, lat: null, from: d(1), to: d(2) }] },
    latString: { legs: [{ ...LAGOS, lat: "6.45", from: d(1), to: d(2) }] },
    lat91: { legs: [{ ...LAGOS, lat: 91, from: d(1), to: d(2) }] },
    latMinus91: { legs: [{ ...LAGOS, lat: -91, from: d(1), to: d(2) }] },
    lon181: { legs: [{ ...LAGOS, lon: 181, from: d(1), to: d(2) }] },
    zoneMars: { legs: [{ ...LAGOS, timezone: "Mars/Olympus_Mons", from: d(1), to: d(2) }] },
    zoneTraversal: { legs: [{ ...LAGOS, timezone: "../../etc/passwd", from: d(1), to: d(2) }] },
    zoneNewline: { legs: [{ ...LAGOS, timezone: "Africa/Lagos\n", from: d(1), to: d(2) }] },
    zoneNumber: { legs: [{ ...LAGOS, timezone: 1, from: d(1), to: d(2) }] },
    zoneHuge: { legs: [{ ...LAGOS, timezone: "A/" + "b".repeat(100), from: d(1), to: d(2) }] },
    badDate: { legs: [{ ...LAGOS, from: "2026-02-30", to: d(2) }] },
    dateWithTime: { legs: [{ ...LAGOS, from: `${d(1)}T00:00:00Z`, to: d(2) }] },
    start366: { legs: [{ ...LAGOS, from: d(366), to: d(367) }] },
    farPast: { legs: [{ ...LAGOS, from: d(-60), to: d(-58) }] },
    outOfOrder: { legs: [{ ...LAGOS, from: d(5), to: d(6) }, { ...LAGOS, name: "B", from: d(1), to: d(2) }] },
    noName: { legs: [{ ...LAGOS, name: "<>", from: d(1), to: d(2) }] },
    sevenFlights: { legs: [{ ...LAGOS, from: d(1), to: d(9) }], flights: Array.from({ length: 7 }, (_, i) => ({ date: d(1 + i), hours: 2 })) },
    flightTooShort: { legs: [{ ...LAGOS, from: d(1), to: d(3) }], flights: [{ date: d(1), hours: 0.4 }] },
    flightTooLong: { legs: [{ ...LAGOS, from: d(1), to: d(3) }], flights: [{ date: d(1), hours: 21 }] },
    flightOutside: { legs: [{ ...LAGOS, from: d(1), to: d(3) }], flights: [{ date: d(10), hours: 2 }] },
    carryOnString: { ...okTrip(), carryOn: "yes" },
  };
  for (const [name, trip] of Object.entries(cases)) {
    const r = await app.call("POST", "/api/forecast", { profile: ADA, trip });
    assert.equal(r.status, 400, name);
    assert.equal(r.body.code, "bad_input", name);
  }
  assert.equal(meteo.calls.length, 0);
});

test("input: a city name with markup is cleaned before it comes back", async () => {
  const trip = { legs: [{ ...LAGOS, name: '<img src=x onerror=alert(1)>Lagos"\'&', from: d(1), to: d(2) }] };
  const r = await app.call("POST", "/api/forecast", { profile: ADA, trip });
  assert.equal(r.status, 200, r.text);
  for (const day of r.body.days) assert.ok(!/[<>]/.test(day.city), day.city);
});

test("input: profile attacks (fitz VII, unknown skin type, scores out of 0–100, 1000 concerns, bad albinism/tone) are 400", async () => {
  const cases = {
    fitzVII: { ...ADA, fitz: "VII" },
    fitzLower: { ...ADA, fitz: "vi" },
    fitzNumber: { ...ADA, fitz: 6 },
    fitzMissing: { skinType: "oily" },
    skinUnknown: { ...ADA, skinType: "greasy" },
    skinMarkup: { ...ADA, skinType: "oily<script>" },
    score101: { ...ADA, scores: { redness: 101 } },
    scoreNeg: { ...ADA, scores: { redness: -1 } },
    scoreString: { ...ADA, scores: { redness: "50" } },
    scoresArray: { ...ADA, scores: [1, 2] },
    concerns1000: { ...ADA, concerns: Array.from({ length: 1000 }, () => "acne") },
    concerns21: { ...ADA, concerns: Array.from({ length: 21 }, () => "acne") },
    concernUnknown: { ...ADA, concerns: ["wrinkles"] },
    concernsString: { ...ADA, concerns: "acne" },
    albinismString: { ...ADA, albinism: "true" },
    toneJs: { ...ADA, toneHex: "javascript:alert(1)" },
    toneCss: { ...ADA, toneHex: "#fff;background:url(x)" },
    zoneBad: { ...ADA, tZone: "<b>" },
    notObject: "oily",
  };
  for (const [name, profile] of Object.entries(cases)) {
    for (const path of ["/api/forecast", "/api/kit"]) {
      const r = await app.call("POST", path, { profile, trip: okTrip(), needs: [] });
      assert.equal(r.status, 400, `${name} on ${path}`);
    }
  }
  // JSON numbers too big for a double parse as Infinity.
  for (const path of ["/api/forecast", "/api/kit"]) {
    const r = await app.call("POST", path, `{"profile":{"skinType":"oily","fitz":"V","scores":{"redness":1e999}},"needs":[]}`);
    assert.equal(r.status, 400, `Infinity score on ${path}`);
  }
  assert.equal(meteo.calls.length, 0);
});

test("input: kit and rescan attacks (unknown/too many needs, carryOn string, 11 days, bad selfReport, bad scores) are 400", async () => {
  const kit = (b) => app.call("POST", "/api/kit", { profile: ADA, ...b });
  assert.equal((await kit({ needs: ["<script>"] })).status, 400);
  assert.equal((await kit({ needs: Array.from({ length: 61 }, () => "spf-50") })).status, 400);
  assert.equal((await kit({ needs: "spf-50" })).status, 400);
  assert.equal((await kit({ carryOn: "no" })).status, 400);
  assert.equal((await kit({ needs: ["spf-50"] })).status, 200);

  const day = { date: d(1), city: "Lagos", wx: { uvMax: 9, rhMean: 80, tMin: 24, tMax: 31, windMax: 10 } };
  const cmp = (b) => app.call("POST", "/api/rescan/compare", { baseline: { redness: 60 }, current: { redness: 40 }, ...b });
  assert.equal((await cmp({ days: Array(11).fill(day) })).status, 400);
  assert.equal((await cmp({ days: [{ ...day, date: "yesterday" }] })).status, 400);
  assert.equal((await cmp({ selfReport: { sun: "yes" } })).status, 400);
  assert.equal((await cmp({ selfReport: [] })).status, 400);
  assert.equal((await cmp({ baseline: { redness: 1000 } })).status, 400);
  assert.equal((await cmp({ baseline: undefined })).status, 400);
  assert.equal((await cmp({ current: "40" })).status, 400);
  assert.equal((await cmp({ profile: { ...ADA, fitz: "VII" } })).status, 400);
  // Out-of-range weather is dropped (null), not trusted.
  const ok = await cmp({ days: [{ ...day, wx: { uvMax: 999, rhMean: -5, tMin: "cold" } }], selfReport: { sun: true } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.safety && /doctor|pharmacist/.test(ok.body.safety));
});

test("input: cart attacks (snowboard, gift card, qty 0/4/-1/1.5/'1', 16 lines, duplicates over 3, bad ids) are refused with no cartCreate", async () => {
  const cart = (lines) => app.call("POST", "/api/cart", { lines });
  const ok = "gid://shopify/ProductVariant/111";
  const cases = [
    [[{ variantId: SNOWBOARD, quantity: 1 }], 400, "not_in_catalog"],
    [[{ variantId: GIFT_CARD, quantity: 1 }], 400, "not_in_catalog"],
    [[{ variantId: ok, quantity: 1 }, { variantId: SNOWBOARD, quantity: 1 }], 400, "not_in_catalog"],
    [[{ variantId: ok, quantity: 0 }], 400, "bad_cart"],
    [[{ variantId: ok, quantity: 4 }], 400, "bad_cart"],
    [[{ variantId: ok, quantity: -1 }], 400, "bad_cart"],
    [[{ variantId: ok, quantity: 1.5 }], 400, "bad_cart"],
    [[{ variantId: ok, quantity: "1" }], 400, "bad_cart"],
    [[{ variantId: ok }], 400, "bad_cart"],
    [[{ variantId: ok, quantity: 2 }, { variantId: ok, quantity: 2 }], 400, "bad_cart"],
    [Array.from({ length: 16 }, (_, i) => ({ variantId: `gid://shopify/ProductVariant/${1000 + i}`, quantity: 1 })), 400, "bad_cart"],
    [Array.from({ length: 15 }, (_, i) => ({ variantId: `gid://shopify/ProductVariant/${1000 + i}`, quantity: 1 })), 400, "not_in_catalog"],
    [[{ variantId: "gid://shopify/Product/111", quantity: 1 }], 400, "bad_cart"],
    [[{ variantId: `${ok}?x=1`, quantity: 1 }], 400, "bad_cart"],
    [[{ variantId: `${ok}\n`, quantity: 1 }], 400, "bad_cart"],
    [[{ variantId: "gid://shopify/ProductVariant/222", quantity: 1 }], 409, "sold_out"],
    [[], 400, "bad_cart"],
    [{ variantId: ok, quantity: 1 }, 400, "bad_cart"],
  ];
  for (const [lines, status, code] of cases) {
    const r = await cart(lines);
    assert.equal(r.status, status, JSON.stringify(lines).slice(0, 80));
    assert.equal(r.body.code, code, JSON.stringify(lines).slice(0, 80));
  }
  assert.equal(shop.calls.filter((c) => c.query.includes("cartCreate")).length, 0);
  const good = await cart([{ variantId: ok, quantity: 3 }]);
  assert.equal(good.status, 200, good.text);
  assert.match(good.body.checkoutUrl, /^https:\/\/test-shop\.myshopify\.com\//);
});

test("input: a checkout URL that isn't https on the shop's own host is refused (no open redirect)", async () => {
  const ok = [{ variantId: "gid://shopify/ProductVariant/111", quantity: 1 }];
  for (const url of ["https://evil.example.com/cart", "http://test-shop.myshopify.com/cart", "javascript:alert(1)", "//evil.example.com", "https://test-shop.myshopify.com.evil.example/x", "data:text/html,hi"]) {
    shop.checkoutUrl = url;
    const r = await app.call("POST", "/api/cart", { lines: ok });
    assert.equal(r.status, 502, url);
    assert.equal(r.body.code, "shop_failed", url);
  }
  shop.down = true;
  shopMod.forgetCatalog();
  const r = await app.call("POST", "/api/cart", { lines: ok });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "shop_offline");
});

test("input: places q over 60 chars, under 2, control-only, and broken %-escapes answer JSON 400/200, never 500", async () => {
  const q = async (raw) => app.call("GET", `/api/places?q=${raw}`);
  assert.equal((await q("a".repeat(61))).status, 400);
  assert.equal((await q("é".repeat(61))).status, 400);
  assert.equal((await q("a")).status, 400);
  assert.equal((await q("%00%01%1f")).status, 400);
  assert.equal((await q("")).status, 400);
  assert.equal((await app.call("GET", "/api/places")).status, 400);
  assert.equal((await q("a".repeat(60))).status, 200);
  for (const raw of ["%E0%A4%A", "%", "%%", "%ZZagos", "%C0%AF%C0%AF", "Lag%00os"]) {
    const r = await q(raw);
    assert.ok([200, 400].includes(r.status), `${raw} → ${r.status}`);
    assert.match(r.headers.get("content-type"), /^application\/json/);
  }
  for (const path of ["/api/%E0%A4%A", "/api/%", "/api/..%2f..%2f.env", "/api/demo/%2e%2e/scan"]) {
    const r = await app.call("GET", path);
    assert.ok([400, 404, 405].includes(r.status), `${path} → ${r.status}`);
    assert.match(r.headers.get("content-type"), /^application\/json/);
  }
});

/* =====================================================================
 * 5. Secrets
 * ===================================================================== */

const FAKE_SECRETS = Object.values(SECRETS).filter((s) => s.length >= 8);
const leaks = (text) => FAKE_SECRETS.filter((s) => String(text).includes(s)).length;

test("secrets: no response (success or error, any route) contains a secret or the Bearer header", async () => {
  const rs = [];
  rs.push(await app.call("GET", "/api/health"));
  rs.push(await app.call("GET", "/api/config"));
  rs.push(await scan(dataUrl(fakeJpeg())));
  stub.state.skinError = "error_no_face";
  rs.push(await scan(dataUrl(fakeJpeg())));
  stub.state.skinError = undefined;
  stub.state.startStatus = 500;
  rs.push(await scan(dataUrl(fakeJpeg())));
  stub.state.startStatus = undefined;
  rs.push(await app.call("POST", "/api/demo/scan", { persona: "ada" }));
  rs.push(await app.call("POST", "/api/cart", { lines: [{ variantId: "gid://shopify/ProductVariant/111", quantity: 1 }] }));
  rs.push(await app.call("POST", "/api/kit", { profile: ADA, needs: ["spf-50"] }));
  rs.push(await app.call("GET", "/api/cron/cleanup", undefined, { authorization: "Bearer wrong" }));
  rs.push(await app.call("GET", "/api/cron/cleanup", undefined, { authorization: `Bearer ${SECRETS.CRON_SECRET}` }));
  rs.push(await app.call("DELETE", "/api/my-data", { deleteTokens: ["x"] }));
  rs.push(await app.call("GET", "/api/nope"));
  rs.push(await app.call("POST", "/api/scan", "{broken"));
  // Out-of-units and a refused key.
  youcam.forgetCredit();
  stub.state.startStatus = 400;
  rs.push(await scan(dataUrl(fakeJpeg())));
  for (const r of rs) {
    assert.equal(leaks(r.text), 0, `secret in a ${r.status} answer`);
    assert.ok(!/Bearer|x-shopify-storefront-access-token|apikey/i.test(r.text), "auth header text in an answer");
    assert.ok(!/\bat [^\n]+\.js:\d+/.test(r.text), "stack trace in an answer");
  }
});

test("secrets: /api/config exposes only liveScans, the store password, shop domain, test card and disclaimer", async () => {
  const c = await app.call("GET", "/api/config");
  assert.deepEqual(Object.keys(c.body).sort(), ["disclaimer", "liveScans", "shopDomain", "storePassword", "testCard"]);
  assert.equal(c.body.shopDomain, SHOP_DOMAIN);
  assert.equal(c.body.storePassword, "letmein");
  const h = await app.call("GET", "/api/health");
  assert.ok(!("units" in h.body) && !("key" in h.body));
});

test("secrets: the Storefront token goes only to the shop host, and the cron needs the exact bearer", async () => {
  await app.call("POST", "/api/kit", { profile: ADA, needs: [] });
  assert.ok(shop.calls.length > 0);
  assert.ok(shop.calls.every((c) => c.token === SECRETS.SHOPIFY_STOREFRONT_TOKEN));
  assert.deepEqual([...new Set(blocked)], [], "no request left for a real host");
  // (Trailing spaces can't be tested over HTTP: header values are trimmed in transit.)
  for (const auth of [`bearer ${SECRETS.CRON_SECRET}`, SECRETS.CRON_SECRET, `Bearer ${SECRETS.CRON_SECRET.slice(0, -1)}`, "Bearer "]) {
    assert.equal((await app.call("GET", "/api/cron/cleanup", undefined, { authorization: auth })).status, 401, auth.length);
  }
});

/** The real .env values (never printed), for repo and history scans. */
function realSecretValues() {
  const file = join(ROOT, ".env");
  if (!existsSync(file)) return null;
  const want = ["YOUCAM_API_KEY", "YOUCAM_SECRET_KEY", "SHOPIFY_STOREFRONT_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "PARASOL_SECRET", "CRON_SECRET"];
  const out = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && want.includes(m[1]) && m[2].replace(/^["']|["']$/g, "").length >= 12) out.push([m[1], m[2].replace(/^["']|["']$/g, "")]);
  }
  return out;
}
const TOKEN_PATTERNS = [
  ["Shopify admin/app token", /shp(at|ss|ca|pa)_[a-fA-F0-9]{32}/],
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{16,}/],
  ["JWT (legacy Supabase key)", /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
  ["Stripe-style live key", /sk_live_[A-Za-z0-9]{16,}/],
];
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.size < 5 * 1024 * 1024) out.push(p);
  }
  return out;
}

test("secrets: public/ and data/demo hold no .env secret values and no token-shaped strings", () => {
  const real = realSecretValues() || [];
  const files = [...walk(join(ROOT, "public")), ...walk(join(ROOT, "data/demo"))];
  for (const f of files) {
    const text = readFileSync(f, "latin1");
    for (const [name, v] of real) assert.ok(!text.includes(v), `${name} value found in ${f.slice(ROOT.length)}`);
    for (const [name, re] of TOKEN_PATTERNS) assert.ok(!re.test(text), `${name} pattern in ${f.slice(ROOT.length)}`);
  }
});

test("secrets: .env is ignored and was never committed; git history and tracked files hold no secret values", (t) => {
  let git;
  try {
    git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    git("rev-parse", "--git-dir");
  } catch {
    return t.skip("git not available");
  }
  assert.equal(git("ls-files", "--", ".env", ".env.*").trim(), "", ".env is tracked");
  assert.equal(git("log", "--all", "--format=%H", "--", ".env").trim(), "", ".env appears in history");
  assert.match(readFileSync(join(ROOT, ".gitignore"), "utf8"), /^\.env$/m);
  const history = git("log", "-p", "--all", "--no-color");
  const real = realSecretValues() || [];
  for (const [name, v] of real) assert.ok(!history.includes(v), `${name} value found in git history`);
  for (const [name, re] of TOKEN_PATTERNS) assert.ok(!re.test(history), `${name} pattern found in git history`);
});

test(
  "secrets: a missing PARASOL_SECRET on Vercel must not fall back to a public default key",
  async () => {
    process.env.VERCEL = "1";
    delete process.env.PARASOL_SECRET;
    const img = fakeJpeg();
    const r = await scan(dataUrl(img), {}, { "x-forwarded-for": "198.51.100.77" });
    const publicToken = createHmac("sha256", "dev-only-secret-not-for-production").update(`delete|${sha(img)}`).digest("base64url");
    assert.ok(r.status !== 200 || r.body.scan.deleteToken !== publicToken, "token is derivable from a public string");
  }
);

/* =====================================================================
 * 6. YouCam error mapping
 * ===================================================================== */

test("youcam errors: every face/photo error code in the YouCam spec maps to the right 422 code with a tip", () => {
  const cases = {
    error_no_face: "no_face", error_src_no_face: "no_face", error_ref_no_face: "no_face",
    error_multiple_people: "multiple_faces", error_multiple_faces: "multiple_faces",
    error_pose: "face_angle", error_face_pose: "face_angle", error_large_face_angle: "face_angle", error_src_large_face_angle: "face_angle",
    error_face_angle_invalid: "face_angle", error_face_not_forward_facing: "face_angle",
    error_face_angle_upward: "face_angle", error_face_angle_downward: "face_angle", error_face_angle_leftward: "face_angle",
    error_face_angle_rightward: "face_angle", error_face_angle_left_tilt: "face_angle", error_face_angle_right_tilt: "face_angle",
    error_src_face_too_small: "face_position", error_src_face_out_of_bound: "face_position", error_face_position_invalid: "face_position",
    error_face_position_too_small: "face_position", error_face_position_out_of_boundary: "face_position",
    error_face_parsing: "face_position", error_insufficient_landmarks: "face_position",
    error_lighting_dark: "lighting", error_insufficient_lighting: "lighting",
    error_below_min_image_size: "too_small", error_exceed_max_image_size: "too_large", error_resolution_unsupported: "too_large",
    error_nsfw_content_detected: "bad_image", error_decode_image: "bad_image", error_unsupport_ratio: "bad_image",
  };
  for (const [yc, code] of Object.entries(cases)) {
    const e = youcam.mapTaskError(yc);
    assert.equal(e.code, code, yc);
    assert.equal(e.status, 422, yc);
    assert.ok(typeof e.tip === "string" && e.tip.length > 20, yc);
  }
  for (const yc of ["error_inference", "unknown_internal_error", "error_download_image", "", undefined, "<script>"]) {
    const e = youcam.mapTaskError(yc);
    assert.equal(e.status, 502, String(yc));
    assert.equal(e.code, "youcam_failed");
    assert.ok(!String(e.message).includes("<script>"));
  }
});

test("youcam errors: over HTTP each face error is 422 + tip, and the tip never echoes YouCam's raw code", async () => {
  for (const yc of ["error_face_angle_left_tilt", "error_insufficient_lighting", "error_face_position_out_of_boundary", "error_src_no_face"]) {
    forgetHits();
    await reset();
    stub.state.skinError = yc;
    const r = await scan(dataUrl(fakeJpeg()));
    assert.equal(r.status, 422, yc);
    assert.ok(r.body.tip && r.body.tip.length > 20, yc);
    assert.ok(!r.text.includes("error_"), `raw code leaked: ${r.text}`);
  }
});

test("youcam errors: a poll timeout is 502; YouCam unreachable after the budget check is 502", async () => {
  process.env.YOUCAM_POLL_MAX_MS = "50";
  stub.state.neverFinish = true;
  let r = await scan(dataUrl(fakeJpeg()));
  assert.equal(r.status, 502);
  assert.equal(r.body.code, "youcam_failed");
  stub.reset();
  forgetHits();
  await reset();
  await youcam.credit({ fresh: true }); // balance read while YouCam is up…
  process.env.YOUCAM_BASE_URL = "http://127.0.0.1:9"; // …then it goes away
  r = await scan(dataUrl(fakeJpeg()));
  assert.equal(r.status, 502);
  assert.equal(r.body.code, "youcam_failed");
});

test("youcam errors: Fitzpatrick failing alone (error, or no face in pre-process) still returns skin results with fitz null", async () => {
  stub.state.fitzError = "error_inference";
  let r = await scan(dataUrl(fakeJpeg()));
  assert.equal(r.status, 200);
  assert.equal(r.body.scan.fitz, null);
  assert.equal(r.body.scan.skin.scores.redness, DEFAULT_SCORES.redness);
  stub.reset();
  forgetHits();
  stub.state.faces = 0;
  r = await scan(dataUrl(fakeJpeg()));
  assert.equal(r.status, 200);
  assert.equal(r.body.scan.fitz, null);
  assert.ok(r.body.scan.skin.scores);
});

/* =====================================================================
 * 7. Privacy
 * ===================================================================== */

function filesNewerThan(dir, since, depth = 2, out = []) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory() && depth > 0) filesNewerThan(p, since, depth - 1, out);
    else if (st.isFile() && st.mtimeMs >= since && st.size < 20 * 1024 * 1024) out.push(p);
  }
  return out;
}

test("privacy: after a scan no image bytes are in the store file, the temp folder, the project data folder or the logs", async () => {
  const since = Date.now() - 1000;
  const marker = "PRIVACY-MARKER-" + Math.random().toString(36).slice(2);
  const img = fakeJpeg(800, 1000, marker + "-".repeat(40));
  const b64 = img.toString("base64");
  const r = await scan(dataUrl(img));
  assert.equal(r.status, 200);
  const needles = [marker, b64.slice(20, 80), Buffer.from(marker).toString("base64").slice(0, 16)];
  const candidates = [...filesNewerThan(tmpdir(), since), ...filesNewerThan(join(ROOT, "data"), since), process.env.PARASOL_STORE];
  for (const f of candidates) {
    if (!f || !existsSync(f)) continue;
    let text;
    try {
      text = readFileSync(f, "latin1");
    } catch {
      continue;
    }
    for (const n of needles) assert.ok(!text.includes(n), `image bytes found in ${f}`);
    assert.ok(!text.includes(img.toString("latin1").slice(0, 60)), `raw image bytes in ${f}`);
  }
  for (const line of logs) for (const n of needles) assert.ok(!line.includes(n), "image bytes in a log line");
  assert.ok(!existsSync(join(ROOT, "data/store.json")) || statSync(join(ROOT, "data/store.json")).mtimeMs < since, "tests must not write the repo store");
  // The cache record is scores only.
  const rec = await get("pz_ycache", sha(img));
  assert.deepEqual(Object.keys(rec).sort(), ["at", "delKey", "fitz", "id", "imageHash", "masks", "masksExpireAt", "skin", "tone"]);
  assert.ok(!JSON.stringify(rec).includes("base64"));
});

test("privacy: DELETE /api/my-data removes the cache record from the store file itself", async () => {
  const img = fakeJpeg();
  const { deleteToken } = (await scan(dataUrl(img))).body.scan;
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(readFileSync(process.env.PARASOL_STORE, "utf8").includes(sha(img)));
  assert.equal((await app.call("DELETE", "/api/my-data", { deleteTokens: [deleteToken] })).body.deleted, 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!readFileSync(process.env.PARASOL_STORE, "utf8").includes(sha(img)), "hash still in the store file");
});

test("privacy: expired masks are never returned from the cache", async () => {
  const img = fakeJpeg();
  await scan(dataUrl(img));
  const rec = await get("pz_ycache", sha(img));
  await put("pz_ycache", { ...rec, masksExpireAt: new Date(Date.now() - 1).toISOString() });
  const s = (await scan(dataUrl(img))).body.scan;
  assert.deepEqual(s.masks, {});
  assert.equal(s.masksExpireAt, null);
});

test(
  "privacy copy: the home page must not say results stay on this device (scores are cached on our server)",
  () => {
    const home = readFileSync(join(ROOT, "public/index.html"), "utf8");
    const data = readFileSync(join(ROOT, "public/data.js"), "utf8");
    assert.ok(!/trip and results stay on this device/i.test(home));
    assert.ok(!/scans, trip and settings in this browser only/i.test(data));
  }
);

/* =====================================================================
 * 8. Rules correctness
 * ===================================================================== */

const EXPECTED_BURN = {
  1: { I: [100, 200], II: [165, 230], III: [200, 330], IV: [300, 400], V: [400, 665], VI: [665, 1330] },
  8: { I: [10, 25], II: [20, 25], III: [25, 40], IV: [35, 50], V: [50, 80], VI: [80, 165] },
  12: { I: [5, 15], II: [10, 15], III: [15, 25], IV: [25, 30], V: [30, 55], VI: [55, 110] },
};

test("rules: burn minutes for every sun type at UVI 1, 8 and 12 match MED / (UVI × 0.025) / 60, floored to 5", () => {
  const MED = { I: [150, 300], II: [250, 350], III: [300, 500], IV: [450, 600], V: [600, 1000], VI: [1000, 2000] };
  const floor5 = (m) => Math.max(5, Math.floor(m / 5 + 1e-9) * 5);
  for (const [uvi, row] of Object.entries(EXPECTED_BURN)) {
    for (const [fitz, [lo, hi]] of Object.entries(row)) {
      const b = burnRange(fitz, Number(uvi));
      assert.equal(b.minutesLow, lo, `${fitz} @ ${uvi} low`);
      assert.equal(b.minutesHigh, hi, `${fitz} @ ${uvi} high`);
      assert.equal(lo, floor5(MED[fitz][0] / (uvi * 0.025) / 60));
      assert.equal(hi, floor5(MED[fitz][1] / (uvi * 0.025) / 60));
      assert.ok(b.minutesLow <= b.minutesHigh);
      assert.match(b.note, /Estimate\. Not medical advice\./);
      assert.equal(b.detailOnly, fitz === "V" || fitz === "VI");
    }
  }
});

test("rules: UVI 0, below 1, negative, NaN or unknown sun type gives no burn clock", () => {
  for (const uvi of [0, 0.99, -3, NaN, null, undefined, Infinity, "8"]) assert.equal(burnRange("I", uvi), null, String(uvi));
  for (const fitz of ["VII", "i", "", undefined]) assert.equal(burnRange(fitz, 8), null, String(fitz));
});

test(
  "rules: burnRange ignores inherited keys like __proto__ / constructor",
  () => {
    for (const fitz of ["__proto__", "constructor", "toString"]) assert.equal(burnRange(fitz, 8), null, fitz);
  }
);

test("rules: albinism overrides the sun type to I with the most cautious MED at both ends, and protect hours from UV 2", () => {
  for (const fitz of ["I", "III", "V", "VI"]) {
    const b = burnRange(fitz, 8, { albinism: true });
    assert.equal(b.fitz, "I");
    assert.deepEqual([b.minutesLow, b.minutesHigh], [10, 10]);
    assert.equal(b.fasterPossible, true);
    assert.equal(b.detailOnly, false, "albinism minutes are never hidden");
    assert.equal(validateProfile({ skinType: "normal", fitz, albinism: true }).fitz, "I");
  }
  assert.deepEqual([burnRange("VI", 12, { albinism: true }).minutesLow, burnRange("VI", 12, { albinism: true }).minutesHigh], [5, 5]);
  const hourly = [{ h: 9, uvi: 1.9 }, { h: 10, uvi: 2 }, { h: 13, uvi: 2.9 }, { h: 15, uvi: 2 }, { h: 16, uvi: 1 }];
  assert.deepEqual(protectHours(hourly, "V", true)?.from, "10:00");
  assert.equal(protectHours(hourly, "V", false), null);
});

const SUNSCREEN_NOT_NEEDED = [
  /(don'?t|do not|doesn'?t|does not|won'?t|no) need (any |a |to wear |to use )?(sun ?screen|spf|sun cream|protection)/i,
  /(sun ?screen|spf|sun cream|protection) (isn'?t|aren'?t|is not|are not) (needed|necessary|required)/i,
  /(sun ?screen|spf|sun cream) (is )?optional/i,
  /skip (the |your )?(sun ?screen|spf|sun cream)/i,
  /no (sun ?screen|spf|sun cream) (needed|required|necessary)/i,
  // "Almost never burns" is the standard type VI description and is followed by a warning.
  /(immune|can'?t burn|(?<!almost )never burns?|natural (spf|protection))/i,
];

test("rules: a V–VI card never says sunscreen isn't needed, across a grid of weather; UV ≥ 3 always mentions SPF", () => {
  const profiles = [];
  for (const fitz of ["V", "VI"]) for (const skinType of ["oily", "dry", "combination", "normal"]) for (const concerns of [[], ["age_spot"], ["redness", "acne"]]) profiles.push({ skinType, fitz, concerns, albinism: false, tZone: null, uZone: null });
  let checked = 0;
  for (const p of profiles) {
    for (const uvMax of [null, 0, 1, 2.9, 3, 5.9, 6, 8, 11, 14]) {
      for (const [rhMean, tMin, tMax, windMax, pm25Max, flightHours] of [[80, 24, 31, 10, 40, null], [30, -2, 4, 45, null, null], [50, 15, 22, 10, null, 7]]) {
        const wx = { uvMax, uvPeakHour: 13, rhMean, tMin, tMax, windMax, pm25Max, ...(flightHours ? { flightHours } : {}) };
        const r = evaluate(p, wx, { protect: null });
        const all = [r.headline, ...r.advice.flatMap((a) => [a.text, a.why])].join(" | ");
        for (const re of SUNSCREEN_NOT_NEEDED) assert.ok(!re.test(all), `${p.fitz}/${uvMax}: ${all}`);
        if (Number.isFinite(uvMax) && uvMax >= 3) assert.match(all, /SPF/, `${p.fitz} at UV ${uvMax} with no SPF line`);
        if (Number.isFinite(uvMax) && uvMax >= 6) assert.equal(r.darkMarks, true);
        checked++;
      }
    }
  }
  assert.ok(checked > 500);
  assert.ok(!SUNSCREEN_NOT_NEEDED.some((re) => re.test(CALM_HEADLINE)));
});

test("rules: no front-end or server copy says sunscreen isn't needed", () => {
  const files = [...walk(join(ROOT, "public")).filter((f) => /\.(html|js)$/.test(f)), ...walk(join(ROOT, "src"))];
  for (const f of files) {
    // Code comments may quote the rule itself ("never tell anyone … they don't need sunscreen").
    const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const re of SUNSCREEN_NOT_NEEDED) assert.ok(!re.test(text), `${f.slice(ROOT.length)} matches ${re}`);
  }
});

test("rules: /api/forecast end to end: Ada (VI) leads with dark marks and hides minutes; Sam (albinism, sent as V) gets type I minutes", async () => {
  const trip = { legs: [{ ...LAGOS, from: d(1), to: d(3) }], flights: [], carryOn: true };
  const ada = await app.call("POST", "/api/forecast", { profile: ADA, trip });
  assert.equal(ada.status, 200, ada.text);
  for (const day of ada.body.days) {
    const all = [day.headline, ...day.advice.map((a) => a.text)].join(" | ");
    for (const re of SUNSCREEN_NOT_NEEDED) assert.ok(!re.test(all), all);
    assert.equal(day.darkMarks, true);
    assert.equal(day.advice[0].id, "uv-dark-marks");
    assert.equal(day.burn.detailOnly, true);
  }
  const sam = await app.call("POST", "/api/forecast", { profile: { skinType: "normal", fitz: "V", albinism: true }, trip });
  assert.equal(sam.status, 200);
  for (const day of sam.body.days) {
    assert.equal(day.burn.fitz, "I");
    assert.equal(day.burn.minutesLow, day.burn.minutesHigh);
    assert.equal(day.advice[0].id, "uv-very-fair");
    assert.ok(!day.darkMarks, "albinism never gets the deep-skin message");
    assert.ok(day.protect?.conservative);
  }
});

test(
  "rules: someone with albinism is never told 'a gentle day, your usual routine is enough' while protect hours are on",
  () => {
    const wx = { uvMax: 2.6, uvPeakHour: 13, rhMean: 55, tMin: 14, tMax: 22, windMax: 10, pm25Max: null };
    const hourly = [{ h: 11, uvi: 2.1 }, { h: 13, uvi: 2.6 }, { h: 15, uvi: 2.0 }];
    for (const p of [{ skinType: "normal", fitz: "I", albinism: true, concerns: [] }, { skinType: "normal", fitz: "I", albinism: false, concerns: [] }]) {
      const protect = protectHours(hourly, p.fitz, p.albinism);
      assert.ok(protect, "protect hours exist");
      const r = evaluate(p, wx, { protect });
      assert.notEqual(r.headline, CALM_HEADLINE);
      assert.match([r.headline, ...r.advice.map((a) => a.text)].join(" "), /SPF|protect/i);
    }
  }
);

/* =====================================================================
 * 9. Headers: JSON everywhere, nosniff, CSP with frame-ancestors 'none'
 * ===================================================================== */

test("headers: every API answer (200, 400, 404, 405, 413, 429, 503) is JSON with nosniff, no-store and frame-ancestors 'none'", async () => {
  process.env.LIVE_SCANS = "off";
  const reqs = [
    ["GET", "/api/health"],
    ["GET", "/api/config"],
    ["GET", "/api/nope"],
    ["GET", "/api"],
    ["GET", "/api/scan"],
    ["OPTIONS", "/api/scan"],
    ["PUT", "/api/cart", {}],
    ["POST", "/api/scan", "{broken"],
    ["POST", "/api/scan", { image: dataUrl(fakeJpeg()), consent: true, consentVersion: 1 }],
    ["GET", "/api/places?q=a"],
    ["GET", "/api/places/%E0%A4%A"],
    ["DELETE", "/api/my-data", { deleteTokens: ["bad"] }],
    ["GET", "/api/cron/cleanup"],
    ["POST", "/api/demo/scan", { persona: "ada" }],
    ["GET", "/API/HEALTH"],
    ["GET", "/api/health/"],
    ["GET", "/api/health?<script>"],
  ];
  const seen = new Set();
  for (const [m, p, b] of reqs) {
    const r = await app.call(m, p, b);
    seen.add(r.status);
    assert.match(r.headers.get("content-type") || "", /^application\/json/, `${m} ${p}`);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", `${m} ${p}`);
    assert.match(r.headers.get("content-security-policy") || "", /frame-ancestors 'none'/, `${m} ${p}`);
    assert.match(r.headers.get("content-security-policy") || "", /default-src 'none'/);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.ok(!/^\s*</.test(r.text), `${m} ${p} answered HTML`);
    assert.ok(r.body && typeof r.body === "object", `${m} ${p} body is not JSON`);
    if (r.status >= 400) assert.equal(typeof r.body.error, "string", `${m} ${p}`);
  }
  const big = await rawCall("POST", "/api/kit", { pad: "x".repeat(40 * 1024) });
  assert.equal(big.status, 413);
  assert.match(big.headers.get("content-type"), /^application\/json/);
  assert.equal(big.headers.get("x-content-type-options"), "nosniff");
  assert.match(big.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  for (const s of [200, 400, 404, 405, 503]) assert.ok(seen.has(s), `status ${s} was exercised`);
  // 429 too.
  for (let i = 0; i < 31; i++) await app.call("DELETE", "/api/my-data", { deleteTokens: ["A".repeat(43)] });
  const r = await app.call("DELETE", "/api/my-data", { deleteTokens: ["A".repeat(43)] });
  assert.equal(r.status, 429);
  assert.match(r.headers.get("content-type"), /^application\/json/);
  assert.equal(r.headers.get("retry-after"), String(r.body.retryAfter));
});

test("headers: the static site CSP (vercel.json, also used by bin/serve.mjs) is locked down, and pages need no inline script", () => {
  const v = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  const h = Object.fromEntries(v.headers[0].headers.map((x) => [x.key.toLowerCase(), x.value]));
  assert.equal(v.headers[0].source, "/(.*)");
  const csp = h["content-security-policy"];
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /connect-src 'self'(;|$)/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.ok(!/script-src[^;]*('unsafe-inline'|'unsafe-eval'|\*|data:|https:)/.test(csp), "script-src is loose");
  assert.equal(h["x-content-type-options"], "nosniff");
  assert.equal(v.functions["api/index.js"].maxDuration, 120);
  for (const f of walk(join(ROOT, "public")).filter((x) => x.endsWith(".html"))) {
    const html = readFileSync(f, "utf8");
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), `inline <script> in ${f.slice(ROOT.length)} (blocked by CSP)`);
    assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(html), `inline event handler in ${f.slice(ROOT.length)}`);
    assert.ok(!/javascript:/i.test(html), `javascript: URL in ${f.slice(ROOT.length)}`);
  }
});

/* =====================================================================
 * Front-end honesty and XSS sweep (static)
 * ===================================================================== */

test("front end: no leftover mockup claims (on-device, offline mode, dermatologist, calibrated, multi-spectral, TSA, reef-safe…)", () => {
  const banned = [/on-device/i, /offline mode/i, /dermatolog/i, /calibrat/i, /multi-?spectral/i, /\bTSA\b/, /reef[- ]safe/i, /clinically/i, /\bproven\b/i, /\bguarantee/i, /\b9\d(\.\d)?% accura/i, /\baccuracy\b/i, /medical[- ]grade/i, /\bdiagnos/i];
  for (const f of walk(join(ROOT, "public")).filter((x) => /\.(html|js|json)$/.test(x))) {
    const text = readFileSync(f, "utf8");
    for (const re of banned) assert.ok(!re.test(text), `${f.slice(ROOT.length)} contains ${re}`);
  }
});

test("front end: disclaimers are on every page (shared footer) and the shop note sits next to checkout", () => {
  const ui = readFileSync(join(ROOT, "public/ui.js"), "utf8");
  assert.match(ui, /Not medical advice\. Burn times are estimates\./);
  assert.match(ui, /Demo shop\. Not affiliated with these brands\./);
  for (const f of walk(join(ROOT, "public")).filter((x) => x.endsWith(".html") && !x.endsWith("404.html"))) {
    const html = readFileSync(f, "utf8");
    const mods = [...html.matchAll(/<script[^>]*src="\/([a-z0-9-]+\.js)"/gi)].map((m) => m[1]).filter((n) => n !== "boot.js");
    assert.ok(mods.length, `${f.slice(ROOT.length)} loads a page module`);
    const usesShell = mods.some((m) => /\bshell\(/.test(readFileSync(join(ROOT, "public", m), "utf8")));
    assert.ok(usesShell, `${f.slice(ROOT.length)} doesn't call shell(), so it has no disclaimer footer`);
  }
  assert.match(readFileSync(join(ROOT, "public/kit.js"), "utf8"), /Not affiliated/);
  for (const page of ["scan.js", "rescan.js", "forecast.js"]) assert.match(readFileSync(join(ROOT, "public", page), "utf8"), /Not medical advice/i, page);
});

test("front end: no innerHTML sink takes API or user text without esc()", () => {
  // Fields that carry API or user text. Each must appear inside esc(...) when written into HTML.
  const risky = /\$\{\s*((?:[a-z]+\.)*(?:city|name|title|vendor|label|evidence|lookFor|text|why|headline|safety|imageAlt|image|checkoutUrl|country|admin1|hex|tip|error|message))\s*\}/gi;
  // Reviewed by hand: these interpolate the app's own constants (UV level names,
  // score labels, persona names, nav labels), never API or user text.
  const INTERNAL = new Set([
    "public/chart.js:l.name", "public/parts.js:l.text", "public/parts.js:name", "public/scan.js:persona.name", "public/scan.js:v.name",
    "public/today.js:lvNow.name", "public/trip.js:uv.name", "public/ui.js:label",
    "public/ui.js:tip", // already built with esc(err.data.tip) on the line above
  ]);
  const offenders = [];
  for (const f of walk(join(ROOT, "public")).filter((x) => x.endsWith(".js"))) {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/<[a-z]/i.test(line)) return; // only lines that build markup
      for (const m of line.matchAll(risky)) {
        // speech/announce strings are plain text, not markup
        if (/announce\(|speech|parts\.push|title\(/.test(line)) continue;
        if (INTERNAL.has(`${f.slice(ROOT.length)}:${m[1]}`)) continue;
        offenders.push(`${f.slice(ROOT.length)}:${i + 1} \${${m[1]}}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});

/* ---------- last: logs ---------- */

test("secrets: no log line written during these tests contains a secret", () => {
  for (const line of logs) assert.equal(leaks(line), 0, "secret in a log line");
  assert.deepEqual([...new Set(blocked)], [], "something tried to reach a real host");
});

/* =====================================================================
 * Skin Simulation (/api/simulate)
 * ===================================================================== */

const simulateCall = (image, extra = {}) => app.call("POST", "/api/simulate", { image, consent: true, consentVersion: 1, humidity: 80, tempMax: 33, ...extra });
const simRuns = () => stub.started["skin-simulation"] || 0;

test("simulate: no consent (missing, string, wrong version) is 400 no_consent with zero YouCam calls, even with a bad image", async () => {
  for (const b of [{}, { consent: "true", consentVersion: 1 }, { consent: true }, { consent: true, consentVersion: "1" }]) {
    const r = await app.call("POST", "/api/simulate", { image: "data:text/html;base64,PGh0bWw+", humidity: 80, tempMax: 30, ...b });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "no_consent");
  }
  assert.equal(stub.calls.length, 0);
  assert.equal((await list("pz_budget")).length, 0);
});

test("simulate: a live run costs 4 units, is cached by image + intensity, and its params come from the forecast only", async () => {
  const img = dataUrl(fakeJpeg());
  const r = await simulateCall(img, { params: { redness: 1 }, oiliness: 0.01 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.source, "live");
  assert.deepEqual(r.body.params, { oiliness: 1 });
  assert.match(r.body.label, /preview, not a prediction/);
  assert.equal((await simulateCall(img)).body.source, "cache");
  assert.equal(simRuns(), 1);
  assert.equal((await simulateCall(img, { humidity: 40, tempMax: 20 })).body.params.oiliness, 0.3);
  assert.equal(simRuns(), 2);
  const day = await get("pz_budget", `day:${TODAY}`);
  assert.equal(day.units, 8);
  assert.equal((await simulateCall(img, { humidity: "80" })).body.code, "bad_request");
});

test("simulate: counts toward the per-IP hourly limit shared with scans (3), the unit floor and the kill switch", async () => {
  assert.equal((await scan(dataUrl(fakeJpeg()))).status, 200);
  assert.equal((await simulateCall(dataUrl(fakeJpeg()))).status, 200);
  assert.equal((await simulateCall(dataUrl(fakeJpeg()))).status, 200);
  const r = await simulateCall(dataUrl(fakeJpeg()));
  assert.equal(r.status, 429);
  assert.equal(r.body.code, "rate_limited");
  forgetHits();
  await reset();
  youcam.forgetCredit();
  stub.state.units = 153; // 153 − 4 < 150
  assert.equal((await simulateCall(dataUrl(fakeJpeg()))).body.code, "live_off");
  process.env.LIVE_SCANS = "off";
  assert.equal((await simulateCall(dataUrl(fakeJpeg()))).body.code, "live_off");
  assert.equal(simRuns(), 2);
});

test("simulate: demo personas return the saved image with zero YouCam calls; unknown persona is 400; photos over 2560 px are refused", async () => {
  const r = await app.call("POST", "/api/simulate", { persona: "ada" });
  assert.equal(r.status, 200);
  assert.equal(r.body.source, "demo");
  assert.equal(r.body.units, 0);
  assert.match(r.body.after, /^\/demo\/ada\//);
  assert.equal((await app.call("POST", "/api/simulate", { persona: "__proto__" })).body.code, "bad_persona");
  assert.equal((await simulateCall(dataUrl(fakeJpeg(1000, 3000)))).body.code, "too_large");
  assert.equal(stub.calls.length, 0);
});

test("simulate: a My data delete token removes the cached simulation too", async () => {
  const img = fakeJpeg();
  const s = await scan(dataUrl(img));
  assert.equal((await simulateCall(dataUrl(img))).status, 200);
  const r = await app.call("DELETE", "/api/my-data", { deleteTokens: [s.body.scan.deleteToken] });
  assert.equal(r.body.deleted, 2);
});
