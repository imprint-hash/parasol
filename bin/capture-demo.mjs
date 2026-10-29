#!/usr/bin/env node
/**
 * One-off LIVE capture of a demo persona → data/demo/<persona>.json and its
 * mask PNGs in public/demo/<persona>/. Spends real YouCam units, so it asks
 * for --yes and prints the cost first. Only run it on a face whose owner has
 * consented to it being shown in the public demo (or a synthetic face, or
 * YouCam's own docs sample). The ada and sam faces are AI-generated with
 * YouCam's AI Image Generator (scratch/gen-faces.mjs); --face-display points
 * at a resized copy already in public/demo/<persona>/.
 *
 *   node bin/capture-demo.mjs ada --image ada-scan.jpg --face-display /demo/ada/face.jpg \
 *        --face-kind ai-generated --credit "AI-generated demo face (YouCam AI Image Generator). Not a real person." \
 *        --simulate oiliness=0.6 --yes
 *   node bin/capture-demo.mjs sam --image sam-scan.jpg --face-display /demo/sam/face.jpg --face-kind ai-generated --credit "…" --yes
 *
 * Costs: skin analysis 14 + Fitzpatrick 10 per scan (+ tone 20 with --tone),
 * + Skin Simulation 4 and a second scan (24) with --simulate or --rescan-image.
 *
 * Rebuild a fixture from a saved raw capture, with no units spent:
 *   node bin/capture-demo.mjs sample --from-raw scratch/sample-raw.json \
 *        --face-url <public url> --face-kind youcam-docs-sample --credit "…"
 *
 * Raw YouCam answers are saved to scratch/capture-<persona>-raw.json (git-ignored).
 * Skin Simulation note: for oiliness, 1.0 ADDS the most shine; for redness,
 * acne, spots, pores and texture, 1.0 REMOVES the most. So a "worse" Day 3 can
 * only be simulated with oiliness (and radiance down is not available).
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { credit, scanFace, simulate, uploadFile, COST } from "../src/youcam.js";
import { normalise, decodeImage, METRICS } from "../src/scan.js";

const args = process.argv.slice(2);
const persona = args[0];
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);
const ROOT = new URL("../", import.meta.url);
const die = (msg) => (console.error(msg), process.exit(1));

if (!/^(ada|sam|sample)$/.test(persona || "")) die("Usage: capture-demo.mjs <ada|sam|sample> (--image <path|url> --yes | --from-raw <file>) [--face-kind k] [--credit text]");
const faceKind = opt("face-kind") || "consented-selfie";
if (!["consented-selfie", "ai-generated", "youcam-docs-sample"].includes(faceKind)) die("--face-kind must be consented-selfie, ai-generated or youcam-docs-sample");

async function readImage(src) {
  if (/^https:\/\//.test(src)) {
    const r = await fetch(src, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) die(`Couldn't download ${src}: ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
  return readFileSync(src);
}
const typeOf = (buf) => (buf[0] === 0x89 ? "image/png" : "image/jpeg");

/** Downloads each mask into public/demo/<persona>/<prefix><metric>.png and returns local paths. */
async function saveMasks(masks, prefix = "") {
  const dir = new URL(`public/demo/${persona}/`, ROOT);
  mkdirSync(dir, { recursive: true });
  const out = {};
  for (const m of METRICS) {
    if (!masks[m]) continue;
    const r = await fetch(masks[m], { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) die(`Mask ${m} download failed (${r.status}). Masks expire 2 h after capture.`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf[0] !== 0x89) die(`Mask ${m} isn't a PNG.`);
    writeFileSync(new URL(`${prefix}${m}.png`, dir), buf);
    out[m] = `/demo/${persona}/${prefix}${m}.png`;
  }
  return out;
}

async function asFixtureScan(raw, prefix) {
  const body = normalise(raw.output, raw.fitz, raw.tone);
  return { skin: body.skin, fitz: body.fitz, tone: body.tone, masks: await saveMasks(body.masks, prefix) };
}

const fixture = {
  persona,
  about: persona === "sample"
    ? "Real YouCam results for YouCam's own documentation sample face (not a Parasol user). Fallback only."
    : `Real YouCam results for the ${persona} demo persona, captured once by bin/capture-demo.mjs.${faceKind === "ai-generated" ? " The face is AI-generated (YouCam AI Image Generator); it is not a real person." : ""}`,
  capturedAt: new Date().toISOString(),
  face: { kind: faceKind, image: null, credit: opt("credit") || null },
  baseline: null,
  rescan: null,
};

if (opt("from-raw")) {
  const raw = JSON.parse(readFileSync(opt("from-raw"), "utf8"));
  fixture.capturedAt = raw.at || fixture.capturedAt;
  fixture.face.image = opt("face-url") || null;
  fixture.baseline = await asFixtureScan({ output: raw.skin.output, fitz: raw.fitz?.fitzpatrick_scale ? { scale: raw.fitz.fitzpatrick_scale } : null, tone: null }, "");
} else {
  const src = opt("image");
  if (!src) die("--image is required (or --from-raw).");
  const tone = flag("tone");
  const sim = opt("simulate");
  const second = Boolean(sim || opt("rescan-image"));
  const cost = (COST.skin + COST.fitz + (tone ? COST.tone : 0)) * (second ? 2 : 1) + (sim ? COST.simulation : 0);
  const balance = await credit({ fresh: true });
  console.log(`This capture costs about ${cost} units. Balance now: ${balance}.`);
  if (!flag("yes")) die("Add --yes to spend them.");
  const floor = Number(process.env.UNITS_FLOOR) || 150;
  if (balance - cost < floor) die(`That would take the balance below UNITS_FLOOR (${floor}).`);

  const bytes = await readImage(src);
  const type = typeOf(bytes);
  decodeImage(`data:${type};base64,${bytes.toString("base64")}`); // same checks as the API
  const raws = {};
  console.log("Scanning baseline…");
  raws.baseline = await scanFace(bytes, type, { tone });
  fixture.baseline = await asFixtureScan(raws.baseline, "");
  if (opt("face-display")) fixture.face.image = opt("face-display"); // a resized copy already in public/
  else if (/^https:\/\//.test(src)) fixture.face.image = src;
  else {
    const dir = new URL(`public/demo/${persona}/`, ROOT);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL(`face.${type === "image/png" ? "png" : "jpg"}`, dir), bytes);
    fixture.face.image = `/demo/${persona}/face.${type === "image/png" ? "png" : "jpg"}`;
  }

  if (second) {
    let rb, rtype, rface, simulated = null;
    if (sim) {
      const params = Object.fromEntries(sim.split(",").map((kv) => kv.split("=")).map(([k, v]) => [k.trim(), Number(v)]));
      console.log("Simulating Day 3 with YouCam Skin Simulation…", params);
      const fid = await uploadFile("skin-simulation", bytes, type);
      const url = await simulate({ src_file_id: fid }, params);
      rb = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(30_000) })).arrayBuffer());
      rtype = typeOf(rb);
      simulated = { feature: "YouCam Skin Simulation", params, note: "Demo: the Day 3 photo is simulated with YouCam Skin Simulation." };
    } else {
      rb = await readImage(opt("rescan-image"));
      rtype = typeOf(rb);
    }
    const ext = rtype === "image/png" ? "png" : "jpg";
    writeFileSync(new URL(`public/demo/${persona}/day3.${ext}`, ROOT), rb);
    rface = { image: `/demo/${persona}/day3.${ext}` };
    console.log("Scanning Day 3…");
    raws.rescan = await scanFace(rb, rtype, { tone });
    fixture.rescan = { ...(await asFixtureScan(raws.rescan, "day3-")), face: rface, simulated };
  }
  mkdirSync(new URL("scratch/", ROOT), { recursive: true });
  writeFileSync(new URL(`scratch/capture-${persona}-raw.json`, ROOT), JSON.stringify(raws, null, 1));
  console.log(`Balance after: ${await credit({ fresh: true })}.`);
}

const out = new URL(`data/demo/${persona}.json`, ROOT);
writeFileSync(out, JSON.stringify(fixture, null, 2) + "\n");
console.log(`Wrote ${fileURLToPath(out)}`);
