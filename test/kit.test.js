import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchKit, scoreProduct, passes, W, KIT_DISCLAIMER } from "../src/kit.js";
import { SLOTS } from "../src/tags.js";
import { productsFromCsv } from "../src/shopify.js";

const CATALOG = productsFromCsv(readFileSync(new URL("../products/parasol-products.csv", import.meta.url), "utf8"));
const P = { skinType: "normal", concerns: [], fitz: "III", albinism: false };
const prod = (handle, tags, price = 10, extra = {}) => ({ variantId: `gid://x/${handle}`, handle, title: handle, vendor: "V", price, currency: "USD", image: null, imageAlt: handle, tags, available: true, url: null, ...extra });
const slot = (name) => SLOTS.find((s) => s.slot === name);

test("sunscreen, day moisturiser and cleanser are always in the kit; the rest follow the needs", () => {
  const k = matchKit([], CATALOG, P, true);
  assert.deepEqual(k.slots.map((s) => s.slot), ["sunscreen", "moisturiser-day", "cleanser"]);
  assert.equal(k.disclaimer, KIT_DISCLAIMER);
  const all = matchKit(["cold", "flight", "mist", "lip", "high-uv", "hat", "sleeves", "sunglasses", "humid", "matte"], CATALOG, P, true);
  assert.deepEqual(all.slots.map((s) => s.slot), SLOTS.map((s) => s.slot));
  assert.deepEqual(all.buyThere.map((b) => b.slot), SLOTS.map((s) => s.slot));
  for (const s of all.slots) assert.ok(s.pick, `${s.slot} has a pick from the real catalog`);
});

test("hard filter: type tag", () => {
  assert.ok(passes(prod("a", ["type-sunscreen"]), slot("sunscreen"), false));
  assert.ok(!passes(prod("a", ["type-moisturiser"]), slot("sunscreen"), false));
  assert.ok(!passes(prod("a", []), slot("sunscreen"), false));
});

test("hard filter: unavailable products are out", () => {
  assert.ok(!passes(prod("a", ["type-sunscreen"], 10, { available: false }), slot("sunscreen"), false));
});

test("hard filter: carry-on needs under-100ml for liquids only", () => {
  const big = prod("big", ["type-sunscreen"]);
  const small = prod("small", ["type-sunscreen", "under-100ml"]);
  const lip = prod("lip", ["type-lip"]);
  const hat = prod("hat", ["type-hat"]);
  assert.ok(!passes(big, slot("sunscreen"), true));
  assert.ok(passes(big, slot("sunscreen"), false));
  assert.ok(passes(small, slot("sunscreen"), true));
  assert.ok(passes(lip, slot("lip"), true), "lip balm sticks are not liquids");
  assert.ok(passes(hat, slot("hat"), true));
});

test("rich-cream slot takes creams and barrier balms, not gels", () => {
  assert.ok(passes(prod("c", ["type-moisturiser", "cream"]), slot("moisturiser-rich"), false));
  assert.ok(passes(prod("b", ["type-barrier"]), slot("moisturiser-rich"), false));
  assert.ok(!passes(prod("g", ["type-moisturiser", "gel"]), slot("moisturiser-rich"), false));
});

test("score weights, one at a time", () => {
  const needs = new Set();
  const s = (tags, profile = P, n = needs) => scoreProduct(prod("x", tags), { profile: { ...P, ...profile }, needs: n }).score;
  assert.equal(s(["normal"]), W.skin);
  assert.equal(s(["fitz-3-4"]), W.fitz);
  assert.equal(s(["no-white-cast"], { fitz: "V" }), W.noWhiteCast + 0);
  assert.equal(s(["no-white-cast"], { fitz: "IV" }), 0);
  assert.equal(s(["spf-50"], { fitz: "I" }), W.spf50);
  assert.equal(s(["spf-50-plus"], { fitz: "III", albinism: true }), W.spf50);
  assert.equal(s(["spf-50"], { fitz: "III" }), 0);
  assert.equal(s(["spf-50"], { fitz: "III" }, new Set(["uv-8-plus"])), W.spf50);
  assert.equal(s(["matte"], { skinType: "oily" }, new Set(["humid"])), W.matte);
  assert.equal(s(["matte"], { skinType: "oily" }), 0);
  assert.equal(s(["cream"], { skinType: "dry" }), W.cream);
  assert.equal(s(["cream"], {}, new Set(["cold"])), W.cream);
  assert.equal(s(["fragrance-free"], { concerns: ["redness"] }), W.fragranceFree);
  assert.equal(s(["acne-prone"], { concerns: ["acne"] }), W.acne);
  assert.equal(s(["travel-size"]), W.travel);
  assert.equal(s(["gel", "flight"], {}, new Set(["gel", "flight"])), 2 * W.need);
});

test("ties go to the cheaper product, then handle A→Z", () => {
  const cat = [prod("b-same", ["type-sunscreen"], 10), prod("a-same", ["type-sunscreen"], 10), prod("cheap", ["type-sunscreen"], 5)];
  const k = matchKit([], cat, P, false);
  const s = k.slots.find((x) => x.slot === "sunscreen");
  assert.equal(s.pick.handle, "cheap");
  assert.deepEqual(s.alternatives.map((a) => a.handle), ["a-same", "b-same"]);
});

test("a product is picked for one slot only", () => {
  const cat = [prod("cream", ["type-moisturiser", "cream"], 5)];
  const k = matchKit(["cold"], cat, P, false);
  const day = k.slots.find((x) => x.slot === "moisturiser-day");
  const rich = k.slots.find((x) => x.slot === "moisturiser-rich");
  assert.equal(day.pick.handle, "cream");
  assert.equal(rich.pick, null);
  assert.match(rich.note, /Buy it there/);
});

test("why chips are plain names of matched tags", () => {
  const cat = [prod("x", ["type-sunscreen", "spf-50", "no-white-cast", "under-100ml", "fitz-5-6"])];
  const s = matchKit(["no-white-cast"], cat, { ...P, fitz: "VI" }, true).slots[0];
  assert.ok(s.why.includes("No white cast"));
  assert.ok(s.why.includes("Made for deep skin"));
  assert.ok(s.why.includes("Under 100 ml"));
});

test("Ada (deep skin, humid trip): sunscreen pick has no white cast and fits carry-on", () => {
  const ada = { skinType: "combination", concerns: [], fitz: "VI", albinism: false };
  const k = matchKit(["fitz-5-6", "spf-50", "no-white-cast", "tinted", "humid", "gel", "matte", "high-uv", "hat", "uv-8-plus", "sunglasses", "flight", "mist", "lip", "water-resistant"], CATALOG, ada, true);
  const sun = k.slots.find((s) => s.slot === "sunscreen");
  assert.ok(sun.pick.tags.includes("no-white-cast") || sun.pick.tags.includes("tinted"), sun.pick.handle);
  assert.ok(sun.pick.tags.includes("under-100ml"));
  assert.match(k.buyThere.find((b) => b.slot === "sunscreen").lookFor, /no white cast/);
  assert.ok(k.slots.find((s) => s.slot === "blotting").pick);
});

test("Sam (albinism): SPF 50+, hat, sleeves and sunglasses", () => {
  const sam = { skinType: "normal", concerns: [], fitz: "I", albinism: true };
  const k = matchKit(["fitz-1-2", "spf-50", "hat", "sleeves", "sunglasses", "high-uv"], CATALOG, sam, true);
  const sun = k.slots.find((s) => s.slot === "sunscreen");
  assert.ok(sun.pick.tags.includes("spf-50") || sun.pick.tags.includes("spf-50-plus"), sun.pick.handle);
  for (const s of ["hat", "sleeves", "sunglasses"]) assert.ok(k.slots.find((x) => x.slot === s).pick, s);
  assert.ok(k.slots.find((x) => x.slot === "sunglasses").pick.tags.includes("uv400"));
  assert.ok(k.slots.find((x) => x.slot === "hat").pick.tags.includes("upf-50"));
});

test("carry-on on: every liquid pick in a real kit is under 100 ml", () => {
  const k = matchKit(["cold", "flight", "mist", "lip", "high-uv"], CATALOG, P, true);
  for (const s of k.slots) {
    if (!s.pick) continue;
    const liquid = ["type-sunscreen", "type-moisturiser", "type-cleanser", "type-mist", "type-aftersun", "type-barrier"].some((t) => s.pick.tags.includes(t));
    if (liquid) assert.ok(s.pick.tags.includes("under-100ml"), s.pick.handle);
  }
});

test("empty or bad catalog gives empty picks, not a crash", () => {
  const k = matchKit(["hat"], null, P, true);
  assert.ok(k.slots.every((s) => s.pick === null));
});
