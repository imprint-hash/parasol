// /api/scan and the other platform routes, over real HTTP against the router.
// Offline: YouCam is a stub, Shopify is a closed port, the store is a temp file.
import { SECRETS, startApp } from "./helpers/env.js";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { startYoucamStub, fakeJpeg, fakePng, dataUrl } from "./helpers/youcam-stub.js";

const stub = await startYoucamStub();
process.env.YOUCAM_BASE_URL = stub.url;

const { reset, put, get, list } = await import("../src/store.js");
const { forgetHits } = await import("../src/budget.js");
const { forgetCredit } = await import("../src/youcam.js");
const app = await startApp();
after(async () => {
  await app.close();
  await stub.close();
});

beforeEach(async () => {
  stub.reset();
  forgetHits();
  forgetCredit();
  await reset();
  Object.assign(process.env, { LIVE_SCANS: "on", LIVE_SCANS_PER_DAY: "15", UNITS_FLOOR: "150", YOUCAM_POLL_MAX_MS: "3000" });
});

const scan = (image, extra = {}, headers) => app.call("POST", "/api/scan", { image, consent: true, consentVersion: 1, ...extra }, headers);
const youcamTaskCalls = () => stub.calls.filter((c) => c.path.startsWith("/s2s/v2.0/task") || c.path.startsWith("/s2s/v2.0/file")).length;

/* ---------- consent ---------- */

test("no consent, or consent as a string, is 400 no_consent with zero YouCam calls", async () => {
  for (const extra of [{ consent: undefined }, { consent: "true" }, { consent: 1 }, { consent: true, consentVersion: 2 }, { consent: true, consentVersion: "1" }]) {
    const r = await scan(dataUrl(fakeJpeg()), extra);
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.equal(r.body.code, "no_consent");
  }
  assert.equal(stub.calls.length, 0);
});

/* ---------- image validation ---------- */

test("non-images, SVG, an HTML polyglot, a wrong mime and broken base64 are 400 bad_image", async () => {
  const cases = [
    "data:image/jpeg;base64," + Buffer.from("just some text, not a photo").toString("base64"),
    "data:image/svg+xml;base64," + Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64"),
    "data:image/jpeg;base64," + Buffer.from("<html><script>alert(1)</script></html>").toString("base64"),
    dataUrl(fakePng(), "image/jpeg"), // PNG bytes labelled JPEG
    dataUrl(fakeJpeg(), "image/png"),
    dataUrl(fakeJpeg()).slice(0, -3), // truncated
    "data:image/jpeg;base64,!!!!",
    "data:text/html;base64,PGh0bWw+",
    "not a data url",
    12345,
  ];
  for (const image of cases) {
    const r = await scan(image);
    assert.equal(r.status, 400, String(image).slice(0, 40));
    assert.equal(r.body.code, "bad_image");
  }
  assert.equal(youcamTaskCalls(), 0);
});

test("a JPEG with no size header is bad_image", async () => {
  const r = await scan(dataUrl(Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0])));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "bad_image");
});

test("2 MB + 1 byte is 413 too_large", async () => {
  const head = fakeJpeg();
  const big = Buffer.concat([head, Buffer.alloc(2 * 1024 * 1024 + 1 - head.length)]);
  assert.equal(big.length, 2 * 1024 * 1024 + 1);
  const r = await scan(dataUrl(big));
  assert.equal(r.status, 413);
  assert.equal(r.body.code, "too_large");
  const ok = Buffer.concat([head, Buffer.alloc(2 * 1024 * 1024 - head.length)]);
  assert.equal((await scan(dataUrl(ok))).status, 200);
});

test("under 480 px on the short side is 422 too_small; over 4096 px is 422 too_large", async () => {
  let r = await scan(dataUrl(fakeJpeg(479, 1000)));
  assert.equal(r.status, 422);
  assert.equal(r.body.code, "too_small");
  r = await scan(dataUrl(fakePng(1000, 479), "image/png"));
  assert.equal(r.body.code, "too_small");
  r = await scan(dataUrl(fakeJpeg(800, 4097)));
  assert.equal(r.status, 422);
  assert.equal(r.body.code, "too_large");
  assert.equal(youcamTaskCalls(), 0);
  assert.equal((await scan(dataUrl(fakeJpeg(480, 4096)))).status, 200);
});

test("a body over 32 KB on other routes is 413", async () => {
  const r = await app.call("POST", "/api/demo/scan", { persona: "ada", pad: "x".repeat(33 * 1024) });
  assert.equal(r.status, 413);
});

/* ---------- a live scan ---------- */

test("a live scan returns a ScanView with skin, concerns, sun type, masks and a delete token", async () => {
  const img = fakeJpeg();
  const r = await scan(dataUrl(img));
  assert.equal(r.status, 200, r.text);
  const s = r.body.scan;
  assert.equal(s.source, "live");
  assert.equal(s.kind, "baseline");
  assert.match(s.id, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(s.skin.type, "combination");
  assert.equal(s.skin.tZone, "oily");
  assert.equal(s.skin.uZone, "normal");
  assert.equal(s.skin.scores.redness, 35);
  assert.equal(s.skin.overall, 75);
  assert.equal(s.skin.skinAge, 31);
  assert.deepEqual(s.fitz, { scale: "V", source: "youcam" });
  assert.equal(s.tone, null);
  assert.deepEqual(s.concerns, [{ metric: "oiliness", level: "watch" }, { metric: "redness", level: "strong" }]);
  assert.equal(Object.keys(s.masks).length, 8);
  assert.ok(Date.parse(s.masksExpireAt) > Date.now() + 60 * 60_000);
  assert.match(s.deleteToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(stub.skinRuns, 1);
  assert.equal(stub.started["fitzpatrick-scale-analyzer"], 1);
  assert.equal(stub.uploadedBytes, img.length);
  // One upload serves both features (spike S2).
  assert.equal(stub.calls.filter((c) => c.path.startsWith("/s2s/v2.0/file/")).length, 1);
});

test("the same image twice is one YouCam run; the second comes from the cache", async () => {
  const img = dataUrl(fakeJpeg());
  const a = await scan(img);
  const b = await scan(img);
  assert.equal(a.body.scan.source, "live");
  assert.equal(b.body.scan.source, "cache");
  assert.equal(stub.skinRuns, 1);
  assert.notEqual(a.body.scan.id, b.body.scan.id);
  assert.equal(a.body.scan.deleteToken, b.body.scan.deleteToken);
});

test("10 parallel identical uploads are one YouCam run", async () => {
  const img = dataUrl(fakeJpeg());
  const rs = await Promise.all(Array.from({ length: 10 }, () => scan(img)));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(stub.skinRuns, 1);
});

test("client-supplied hash, scores and source are ignored", async () => {
  const r = await scan(dataUrl(fakeJpeg()), { source: "demo", hash: "abc", imageHash: "abc", scores: { redness: 100 }, skin: { type: "dry" }, fitz: "I" });
  assert.equal(r.body.scan.source, "live");
  assert.equal(r.body.scan.skin.scores.redness, 35);
  assert.equal(r.body.scan.skin.type, "combination");
  assert.equal(r.body.scan.fitz.scale, "V");
  assert.equal(await get("pz_ycache", "abc"), null);
});

test("no image bytes are written to the store or the temp folder", async () => {
  const img = fakeJpeg(800, 1000, "UNIQUE-MARKER-" + "z".repeat(40));
  await scan(dataUrl(img));
  const file = process.env.PARASOL_STORE;
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  assert.ok(!text.includes("UNIQUE-MARKER"));
  assert.ok(!text.includes(img.toString("base64").slice(0, 60)));
  const [rec] = await list("pz_ycache");
  assert.deepEqual(Object.keys(rec).sort(), ["at", "delKey", "fitz", "id", "imageHash", "masks", "masksExpireAt", "skin", "tone"]);
});

test("masks past their expiry are never returned", async () => {
  const img = fakeJpeg();
  await scan(dataUrl(img));
  const hash = createHash("sha256").update(img).digest("hex");
  const rec = await get("pz_ycache", hash);
  await put("pz_ycache", { ...rec, masksExpireAt: new Date(Date.now() - 1000).toISOString() });
  const r = await scan(dataUrl(img));
  assert.equal(r.body.scan.source, "cache");
  assert.deepEqual(r.body.scan.masks, {});
  assert.equal(r.body.scan.masksExpireAt, null);
});

/* ---------- unit budget ---------- */

test("the 4th live scan from one IP in an hour is 429 with retryAfter, even with spoofed X-Forwarded-For", async () => {
  for (let i = 0; i < 3; i++) assert.equal((await scan(dataUrl(fakeJpeg()), {}, { "x-forwarded-for": `10.0.0.${i}` })).status, 200);
  const r = await scan(dataUrl(fakeJpeg()), {}, { "x-forwarded-for": "10.9.9.9", "x-real-ip": "10.9.9.9" });
  assert.equal(r.status, 429);
  assert.equal(r.body.code, "rate_limited");
  assert.ok(r.body.retryAfter > 0 && r.body.retryAfter <= 3600);
  assert.equal(r.headers.get("retry-after"), String(r.body.retryAfter));
  assert.equal(stub.skinRuns, 3);
});

test("on Vercel the right-most X-Forwarded-For entry is the client", async () => {
  const { clientIp } = await import("../src/budget.js");
  process.env.VERCEL = "1";
  try {
    assert.equal(clientIp({ headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.7" }, socket: {} }), "203.0.113.7");
  } finally {
    delete process.env.VERCEL;
  }
  assert.equal(clientIp({ headers: { "x-forwarded-for": "6.6.6.6" }, socket: { remoteAddress: "127.0.0.1" } }), "127.0.0.1");
});

test("the daily global cap is 503 live_off", async () => {
  process.env.LIVE_SCANS_PER_DAY = "1";
  assert.equal((await scan(dataUrl(fakeJpeg()))).status, 200);
  const r = await scan(dataUrl(fakeJpeg()));
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "live_off");
  assert.equal(stub.skinRuns, 1);
});

test("units below the floor is 503 live_off", async () => {
  stub.state.units = 173; // 173 − 24 < 150
  const r = await scan(dataUrl(fakeJpeg()));
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "live_off");
  assert.equal(stub.skinRuns, 0);
});

test("the kill switch LIVE_SCANS=off is 503 live_off, but cached results still work", async () => {
  const img = dataUrl(fakeJpeg());
  await scan(img);
  process.env.LIVE_SCANS = "off";
  const r = await scan(dataUrl(fakeJpeg()));
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "live_off");
  assert.equal((await scan(img)).body.scan.source, "cache");
  assert.equal((await app.call("GET", "/api/config")).body.liveScans, false);
});

test("YouCam out of units (CreditInsufficiency) is 503 live_off", async () => {
  stub.state.startStatus = 400;
  const r = await scan(dataUrl(fakeJpeg()));
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "live_off");
});

test("a YouCam 5xx on task start is 502 and the start is not retried (no double billing)", async () => {
  stub.state.startStatus = 500;
  const r = await scan(dataUrl(fakeJpeg()));
  assert.equal(r.status, 502);
  assert.equal(r.body.code, "youcam_failed");
  const starts = stub.calls.filter((c) => c.method === "POST" && c.path === "/s2s/v2.0/task/skin-analysis");
  assert.equal(starts.length, 1);
});

test("a task that never finishes is 502 after the poll deadline", async () => {
  process.env.YOUCAM_POLL_MAX_MS = "60";
  stub.state.neverFinish = true;
  const r = await scan(dataUrl(fakeJpeg()));
  assert.equal(r.status, 502);
  assert.equal(r.body.code, "youcam_failed");
});

/* ---------- YouCam face errors ---------- */

test("each YouCam face error maps to a 422 code with a retake tip, and nothing is cached", async () => {
  const cases = {
    error_no_face: "no_face",
    error_src_face_too_small: "face_position",
    error_src_face_out_of_bound: "face_position",
    error_pose: "face_angle",
    error_lighting_dark: "lighting",
    error_below_min_image_size: "too_small",
  };
  for (const [yc, code] of Object.entries(cases)) {
    forgetHits();
    await reset();
    stub.state.skinError = yc;
    const r = await scan(dataUrl(fakeJpeg()));
    assert.equal(r.status, 422, yc);
    assert.equal(r.body.code, code, yc);
    assert.ok(r.body.tip && r.body.tip.length > 20, yc);
    assert.equal((await list("pz_ycache")).length, 0);
  }
  forgetHits();
  await reset();
  stub.state.skinError = "unknown_internal_error";
  const r = await scan(dataUrl(fakeJpeg()));
  assert.equal(r.status, 502);
  assert.equal(r.body.code, "youcam_failed");
});

test("two faces in the photo is 422 multiple_faces", async () => {
  stub.state.faces = 2;
  const r = await scan(dataUrl(fakeJpeg()));
  assert.equal(r.status, 422);
  assert.equal(r.body.code, "multiple_faces");
  assert.equal(stub.started["fitzpatrick-scale-analyzer"] || 0, 0);
});

test("a Fitzpatrick failure alone still returns skin results with fitz:null", async () => {
  stub.state.fitzError = "error_inference";
  const r = await scan(dataUrl(fakeJpeg()));
  assert.equal(r.status, 200);
  assert.equal(r.body.scan.fitz, null);
  assert.equal(r.body.scan.skin.scores.redness, 35);
});

/* ---------- my data ---------- */

test("DELETE /api/my-data removes only the record the token belongs to; forged tokens are 403", async () => {
  const a = dataUrl(fakeJpeg()), b = dataUrl(fakeJpeg());
  const ta = (await scan(a)).body.scan.deleteToken;
  await scan(b);
  assert.equal((await list("pz_ycache")).length, 2);

  let r = await app.call("DELETE", "/api/my-data", { deleteTokens: ["forged"] });
  assert.equal(r.status, 403);
  r = await app.call("DELETE", "/api/my-data", { deleteTokens: ["A".repeat(43)] });
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted, 0);
  r = await app.call("DELETE", "/api/my-data", { deleteTokens: Array(21).fill(ta) });
  assert.equal(r.status, 400);

  r = await app.call("DELETE", "/api/my-data", { deleteTokens: [ta] });
  assert.equal(r.body.deleted, 1);
  assert.equal((await list("pz_ycache")).length, 1);
  // Gone: scanning the same photo runs YouCam again.
  assert.equal((await scan(a)).body.scan.source, "live");
});

/* ---------- demo ---------- */

test("demo scans come from fixtures with zero YouCam calls", async () => {
  const ada = await app.call("POST", "/api/demo/scan", { persona: "ada", kind: "baseline" });
  assert.equal(ada.status, 200);
  assert.equal(ada.body.scan.source, "demo");
  assert.equal(ada.body.scan.deleteToken, null);
  assert.equal(ada.body.scan.demo.face.kind, "ai-generated");
  assert.match(ada.body.scan.demo.face.label, /AI-generated/);
  assert.ok(Object.values(ada.body.scan.masks).every((m) => m.startsWith("/demo/ada/")));
  const rescan = await app.call("POST", "/api/demo/scan", { persona: "ada", kind: "rescan" });
  assert.equal(rescan.status, 200);
  assert.match(rescan.body.scan.demo.simulated.note, /Skin Simulation/);
  const sam = await app.call("POST", "/api/demo/scan", { persona: "sam" });
  assert.equal(sam.status, 200);
  assert.equal((await app.call("POST", "/api/demo/scan", { persona: "sam", kind: "rescan" })).body.code, "no_fixture");
  assert.equal((await app.call("POST", "/api/demo/scan", { persona: "../../.env" })).status, 400);
  assert.equal((await app.call("POST", "/api/demo/scan", { persona: "ada", kind: "x" })).status, 400);
  assert.equal(stub.calls.length, 0);
});

test("fixtures can't be changed through the API", async () => {
  const before = readFileSync(new URL("../data/demo/ada.json", import.meta.url), "utf8");
  await app.call("POST", "/api/demo/scan", { persona: "ada", kind: "baseline", skin: { scores: { redness: 1 } } });
  await scan(dataUrl(fakeJpeg()), { persona: "ada" });
  assert.equal(readFileSync(new URL("../data/demo/ada.json", import.meta.url), "utf8"), before);
  const again = await app.call("POST", "/api/demo/scan", { persona: "ada" });
  assert.notEqual(again.body.scan.skin.scores.redness, 1);
});

/* ---------- health, config, headers, secrets ---------- */

test("health and config answer, and no response contains a secret", async () => {
  const h = await app.call("GET", "/api/health");
  assert.equal(h.status, 200);
  assert.equal(h.body.ok, true);
  assert.equal(h.body.store, "file");
  assert.equal(h.body.youcamLive, true);
  assert.equal(h.body.demoReady, true);
  assert.equal(h.body.shopify, "down");
  const c = await app.call("GET", "/api/config");
  assert.deepEqual(Object.keys(c.body).sort(), ["disclaimer", "liveScans", "shopDomain", "storePassword", "testCard"]);
  assert.equal(c.body.storePassword, "letmein");
  stub.state.skinError = "error_no_face";
  const e = await scan(dataUrl(fakeJpeg()));
  for (const r of [h, c, e, await app.call("GET", "/api/nope"), await app.call("POST", "/api/cart", { lines: [] })]) {
    for (const s of Object.values(SECRETS)) if (s !== "test") assert.ok(!r.text.includes(s), r.text);
  }
});

test("every API answer is JSON with nosniff and a locked-down CSP, even errors", async () => {
  for (const [m, p, b] of [["GET", "/api/health"], ["GET", "/api/nope"], ["POST", "/api/scan", "{broken"], ["GET", "/api/places/%E0%A4%A"]]) {
    const r = await app.call(m, p, b);
    assert.match(r.headers.get("content-type"), /^application\/json/);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.ok(r.body && typeof r.body.error === "string" || p === "/api/health");
  }
});

/* ---------- cron ---------- */

test("cron cleanup needs the bearer secret and deletes only old pz_ records", async () => {
  assert.equal((await app.call("GET", "/api/cron/cleanup")).status, 401);
  assert.equal((await app.call("GET", "/api/cron/cleanup", undefined, { authorization: "Bearer nope" })).status, 401);
  const old = new Date(Date.now() - 31 * 86400_000).toISOString();
  const now = new Date().toISOString();
  await put("pz_ycache", { id: "old", at: old, skin: {} });
  await put("pz_ycache", { id: "new", at: now, skin: {} });
  await put("pz_budget", { id: "day:2020-01-01", day: "2020-01-01", liveScans: 1 });
  await put("pz_budget", { id: `day:${now.slice(0, 10)}`, day: now.slice(0, 10), liveScans: 1 });
  await put("pz_wx", { id: "wx-old", at: old, ttl: 3600, body: {} });
  await put("pz_wx", { id: "wx-new", at: now, ttl: 3600, body: {} });
  const r = await app.call("GET", "/api/cron/cleanup", undefined, { authorization: `Bearer ${SECRETS.CRON_SECRET}` });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.deleted, { pz_ycache: 1, pz_budget: 1, pz_wx: 1 });
  assert.deepEqual((await list("pz_ycache")).map((x) => x.id), ["new"]);
  assert.equal((await list("pz_wx")).length, 1);
});
