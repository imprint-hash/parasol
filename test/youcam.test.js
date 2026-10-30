// The YouCam client and the pure scan helpers, against the stub. Offline.
import "./helpers/env.js";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startYoucamStub, fakeJpeg, fakePng } from "./helpers/youcam-stub.js";

const stub = await startYoucamStub();
process.env.YOUCAM_BASE_URL = stub.url;
const yc = await import("../src/youcam.js");
const { normalise, imageSize, skinTypeOf, concernsOf, CONCERN } = await import("../src/scan.js");
after(() => stub.close());
beforeEach(() => {
  stub.reset();
  yc.forgetCredit();
});

test("credit() sums the unit grants and caches for 60 s", async () => {
  stub.state.units = 500;
  assert.equal(await yc.credit(), 500);
  stub.state.units = 10;
  assert.equal(await yc.credit(), 500);
  assert.equal(await yc.credit({ fresh: true }), 10);
  assert.equal(stub.calls.filter((c) => c.path === "/s2s/v1.0/client/credit").length, 2);
});

test("scanFace uploads once, runs skin + Fitzpatrick, and tone only when asked", async () => {
  const r = await yc.scanFace(fakeJpeg(), "image/jpeg");
  assert.equal(r.fitz.scale, "V");
  assert.equal(r.tone, null);
  assert.equal(r.units, 24);
  assert.ok(Array.isArray(r.output));
  assert.equal(stub.started["skin-tone-analysis"], undefined);
  const t = await yc.scanFace(fakePng(), "image/png", { tone: true });
  assert.deepEqual(t.tone, { hex: "#8d5524" });
  assert.equal(t.units, 44);
});

test("the skin task is sent the 9 SD actions as JSON", async () => {
  assert.deepEqual(yc.SKIN_ACTIONS, ["skin_type", "oiliness", "moisture", "acne", "redness", "pore", "age_spot", "texture", "radiance"]);
  assert.equal(yc.COST.skin, 14);
  assert.equal(yc.COST.fitz, 10);
});

test("no face from the Fitzpatrick pre-process gives fitz:null, not a failed scan", async () => {
  stub.state.faces = 0;
  const r = await yc.scanFace(fakeJpeg(), "image/jpeg");
  assert.equal(r.fitz, null);
  assert.equal(r.fitzError, "no_face");
  assert.equal(r.units, 14);
});

test("mapTaskError covers YouCam's documented error codes", () => {
  const table = {
    error_no_face: ["no_face", 422],
    error_src_no_face: ["no_face", 422],
    error_multiple_people: ["multiple_faces", 422],
    error_large_face_angle: ["face_angle", 422],
    error_face_angle_leftward: ["face_angle", 422],
    error_face_pose: ["face_angle", 422],
    error_src_face_too_small: ["face_position", 422],
    error_face_position_out_of_boundary: ["face_position", 422],
    error_face_parsing: ["face_position", 422],
    error_insufficient_lighting: ["lighting", 422],
    error_lighting_dark: ["lighting", 422],
    error_below_min_image_size: ["too_small", 422],
    error_exceed_max_image_size: ["too_large", 422],
    exceed_max_filesize: ["too_large", 422],
    error_nsfw_content_detected: ["bad_image", 422],
    error_inference: ["youcam_failed", 502],
    unknown_internal_error: ["youcam_failed", 502],
    "": ["youcam_failed", 502],
  };
  for (const [code, [want, status]] of Object.entries(table)) {
    const e = yc.mapTaskError(code);
    assert.equal(e.code, want, code);
    assert.equal(e.status, status, code);
    if (status === 422) assert.ok(e.tip, code);
  }
});

test("a missing API key is live_off, not a crash", async () => {
  const key = process.env.YOUCAM_API_KEY;
  delete process.env.YOUCAM_API_KEY;
  try {
    await assert.rejects(yc.credit({ fresh: true }), (e) => e.code === "live_off" && e.status === 503);
  } finally {
    process.env.YOUCAM_API_KEY = key;
  }
});

/* ---------- pure helpers ---------- */

test("imageSize reads JPEG SOF (skipping other segments) and PNG IHDR", () => {
  assert.deepEqual(imageSize(fakeJpeg(1148, 646), "image/jpeg"), { width: 1148, height: 646 });
  assert.deepEqual(imageSize(fakePng(1104, 1472), "image/png"), { width: 1104, height: 1472 });
  assert.equal(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0]), "image/jpeg"), null);
  assert.equal(imageSize(Buffer.from([0xff, 0xd8, 0x00, 0x00]), "image/jpeg"), null);
  assert.equal(imageSize(Buffer.alloc(10), "image/png"), null);
});

test("skin type: region whole wins; else oily T-zone with normal/dry U-zone is combination", () => {
  assert.equal(skinTypeOf("oily", "normal", "dry"), "dry");
  assert.equal(skinTypeOf("oily", "normal", null), "combination");
  assert.equal(skinTypeOf("oily", "dry", null), "combination");
  assert.equal(skinTypeOf("oily", "oily", null), "oily");
  assert.equal(skinTypeOf(null, null, null), "normal");
});

test("concerns: below 60 is watch, below 40 is strong (boundaries both sides)", () => {
  assert.deepEqual(CONCERN, { watch: 60, strong: 40 });
  const c = concernsOf({ oiliness: 60, moisture: 59, acne: 40, redness: 39, pore: 100 });
  assert.deepEqual(c, [{ metric: "moisture", level: "watch" }, { metric: "acne", level: "watch" }, { metric: "redness", level: "strong" }]);
});

test("normalise reads the real YouCam output shape and the mask expiry from the signed URL", () => {
  const out = [
    { type: "oiliness", ui_score: 70, raw_score: 55.5, mask_urls: ["https://yce-us.s3-accelerate.amazonaws.com/ttl30/a/oiliness_output.png?X-Amz-Date=20261029T203754Z&X-Amz-Expires=7200&X-Amz-Signature=x"] },
    { type: "redness", ui_score: 95.4, mask_urls: [] },
    { type: "skin_type", region: "whole", skin_type: "Oily" },
    { type: "skin_type", region: "t_zone", skin_type: "Normal" },
    { type: "skin_type", region: "u_zone", skin_type: "Oily" },
    { type: "all", score: 81.625 },
    { type: "skin_age", score: 24 },
    { type: "resize_image", mask_urls: ["https://x/resize_image.jpg"] },
  ];
  const n = normalise(out, { scale: "II" }, null);
  assert.deepEqual(n.skin, { type: "oily", tZone: "normal", uZone: "oily", scores: { oiliness: 70, redness: 95 }, overall: 82, skinAge: 24 });
  assert.deepEqual(n.fitz, { scale: "II", source: "youcam" });
  assert.deepEqual(Object.keys(n.masks), ["oiliness"]);
  // 20:37:54 + 2 h − 5 min margin
  assert.equal(n.masksExpireAt, "2026-10-29T22:32:54.000Z");
  assert.throws(() => normalise([{ type: "all", score: 1 }]), /without scores/);
});
