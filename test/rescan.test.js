import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, compareScores, RESCAN_DELTA, SAFETY, NO_WEATHER_CAUSE, NO_CHANGE, CAUSES, MAX_CAUSES } from "../src/rescan.js";

const BASE = { oiliness: 80, moisture: 70, acne: 85, redness: 90, pore: 70, age_spot: 80, texture: 70, radiance: 75 };
const with_ = (o) => ({ ...BASE, ...o });
const day = (date, wx, city = "Lagos") => ({ date, city, wx: { uvMax: 4, rhMean: 55, tMin: 15, tMax: 24, windMax: 10, pm25Max: null, flightHours: null, ...wx } });
const MILD = [day("2026-11-03", {}), day("2026-11-04", {})];
const HUMID = [day("2026-11-03", { rhMean: 84, tMax: 31 }), day("2026-11-04", { rhMean: 82, tMax: 30 })];
const NO = { sun: false, newProduct: false, water: false, sleep: false };

test("delta = after − before; worse at ≤ −8, boundary both sides; noise is hidden", () => {
  assert.equal(RESCAN_DELTA, 8);
  assert.deepEqual(compareScores(BASE, with_({ oiliness: 72 })).map((c) => [c.metric, c.delta, c.worse]), [["oiliness", -8, true]]);
  assert.deepEqual(compareScores(BASE, with_({ oiliness: 73 })), []);
  assert.deepEqual(compareScores(BASE, with_({ oiliness: 88 })).map((c) => [c.metric, c.delta, c.worse]), [["oiliness", 8, false]]);
  assert.deepEqual(compareScores(BASE, with_({ oiliness: 87 })), []);
});

test("missing metrics are skipped", () => {
  assert.deepEqual(compareScores({ oiliness: 80 }, { moisture: 10 }), []);
});

test("humid_heat: oil/acne/pore worse plus a humid hot day → likely, with evidence", () => {
  const r = compare(BASE, with_({ oiliness: 60 }), HUMID, NO);
  assert.equal(r.causes[0].id, "humid_heat");
  assert.equal(r.causes[0].confidence, "likely");
  assert.equal(r.causes[0].evidence, "Lagos: up to 84% humidity and 31 °C on 2 of 2 days since you landed");
  assert.deepEqual(r.tonight, CAUSES.humid_heat.tonight);
  assert.ok(r.needs.includes("matte"));
  assert.equal(r.safety, SAFETY);
});

test("humid_heat needs both humidity ≥ 70 and tMax ≥ 26", () => {
  assert.equal(compare(BASE, with_({ acne: 70 }), [day("2026-11-03", { rhMean: 69, tMax: 31 })], NO).causes.length, 0);
  assert.equal(compare(BASE, with_({ acne: 70 }), [day("2026-11-03", { rhMean: 70, tMax: 25.9 })], NO).causes.length, 0);
  assert.equal(compare(BASE, with_({ pore: 60 }), [day("2026-11-03", { rhMean: 70, tMax: 26 })], NO).causes[0].id, "humid_heat");
});

test("dry_air: moisture/texture worse and a flight within 72 h", () => {
  const days = [day("2026-11-01", { flightHours: 7 }), day("2026-11-02", {}), day("2026-11-04", {})];
  const r = compare(BASE, with_({ moisture: 55 }), days, NO);
  assert.equal(r.causes[0].id, "dry_air");
  assert.match(r.causes[0].evidence, /7 h flight on 2026-11-01/);
  // 4 days before the latest day is outside the window.
  const old = [day("2026-10-31", { flightHours: 7 }), day("2026-11-04", {})];
  assert.equal(compare(BASE, with_({ moisture: 55 }), old, NO).causes.length, 0);
});

test("dry_air: or a day with rh ≤ 40, or tMin ≤ 5", () => {
  assert.equal(compare(BASE, with_({ texture: 60 }), [day("2026-11-03", { rhMean: 40 })], NO).causes[0].id, "dry_air");
  assert.equal(compare(BASE, with_({ texture: 60 }), [day("2026-11-03", { rhMean: 41 })], NO).causes.length, 0);
  assert.equal(compare(BASE, with_({ texture: 60 }), [day("2026-11-03", { tMin: 5 })], NO).causes[0].id, "dry_air");
  assert.equal(compare(BASE, with_({ texture: 60 }), [day("2026-11-03", { tMin: 5.1 })], NO).causes.length, 0);
});

test("cold_wind: redness worse with tMin ≤ 5 or wind ≥ 30", () => {
  assert.equal(compare(BASE, with_({ redness: 70 }), [day("2026-11-03", { windMax: 30, uvMax: 2 })], NO).causes[0].id, "cold_wind");
  assert.equal(compare(BASE, with_({ redness: 70 }), [day("2026-11-03", { windMax: 29.9, uvMax: 2 })], NO).causes.length, 0);
  assert.equal(compare(BASE, with_({ redness: 70 }), [day("2026-11-03", { tMin: 4, uvMax: 2 })], NO).causes[0].id, "cold_wind");
});

test("sun: redness or dark spots worse with UV ≥ 6; likely only if they say so", () => {
  const sunny = [day("2026-11-03", { uvMax: 6 })];
  assert.deepEqual(compare(BASE, with_({ age_spot: 70 }), sunny, NO).causes.map((c) => [c.id, c.confidence]), [["sun", "possible"]]);
  assert.deepEqual(compare(BASE, with_({ age_spot: 70 }), sunny, { ...NO, sun: true }).causes.map((c) => [c.id, c.confidence]), [["sun", "likely"]]);
  assert.equal(compare(BASE, with_({ age_spot: 70 }), [day("2026-11-03", { uvMax: 5.9 })], NO).causes.length, 0);
});

test("hard_water only when they report it, and moisture or redness is worse", () => {
  assert.equal(compare(BASE, with_({ moisture: 50 }), MILD, NO).causes.length, 0);
  const r = compare(BASE, with_({ moisture: 50 }), MILD, { ...NO, water: true });
  assert.deepEqual(r.causes.map((c) => [c.id, c.confidence]), [["hard_water", "possible"]]);
  assert.match(r.tonight[0], /Hard water can dry some people's skin/);
  assert.equal(compare(BASE, with_({ acne: 50 }), MILD, { ...NO, water: true }).causes.length, 0);
});

test("new_product when they report it: 'pause the newest product'", () => {
  const r = compare(BASE, with_({ acne: 60 }), MILD, { ...NO, newProduct: true });
  assert.deepEqual(r.causes.map((c) => c.id), ["new_product"]);
  assert.match(r.tonight[0], /Pause the newest product/);
});

test("at most 2 causes, likely before possible", () => {
  const days = [day("2026-11-03", { rhMean: 85, tMax: 31, uvMax: 9, windMax: 35 })];
  const r = compare(BASE, with_({ oiliness: 50, redness: 60, age_spot: 60 }), days, { ...NO, newProduct: true, water: true });
  assert.equal(r.causes.length, MAX_CAUSES);
  assert.ok(r.causes.every((c) => c.confidence === "likely"));
  const r2 = compare(BASE, with_({ age_spot: 60 }), [day("2026-11-03", { uvMax: 9 })], { ...NO, newProduct: true });
  assert.deepEqual(r2.causes.map((c) => c.confidence), ["possible", "possible"]);
});

test("worse but nothing matches: 'The weather doesn't explain this change.'", () => {
  const r = compare(BASE, with_({ radiance: 50 }), MILD, NO);
  assert.equal(r.causes.length, 0);
  assert.equal(r.summary, NO_WEATHER_CAUSE);
  assert.ok(r.tonight.length >= 2);
  assert.equal(r.safety, SAFETY);
});

test("no change beyond noise: summary says so, safety still there", () => {
  const r = compare(BASE, BASE, HUMID, NO);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.causes, []);
  assert.equal(r.summary, NO_CHANGE);
  assert.equal(r.safety, SAFETY);
});

test("Ada's demo: oilier on Day 3 in humid Lagos → humid heat, likely", () => {
  const r = compare(BASE, with_({ oiliness: 55, pore: 60 }), HUMID, { ...NO, sun: true });
  assert.equal(r.causes[0].label, "Humid heat");
  assert.ok(r.changes.every((c) => typeof c.label === "string"));
});

test("bad sleep adds a gentle line", () => {
  assert.match(compare(BASE, with_({ acne: 60 }), HUMID, { ...NO, sleep: true }).tonight.at(-1), /slept badly/);
});

test("Ada's demo in Dubai: muggy heat by dew point names humid_heat as the likely cause of her breakouts", () => {
  const dubai = [
    day("2026-11-03", { rhMean: 60, dewMean: 21.5, tMax: 33.2, flightHours: 3.5 }, "Dubai"),
    day("2026-11-04", { rhMean: 60, dewMean: 22.1, tMax: 33.6 }, "Dubai"),
    day("2026-11-05", { rhMean: 59, dewMean: 21.2, tMax: 33.4 }, "Dubai"),
  ];
  const r = compare(with_({ acne: 89 }), with_({ acne: 77 }), dubai, NO);
  assert.deepEqual(r.causes.map((c) => [c.id, c.confidence]), [["humid_heat", "likely"]]);
  assert.equal(r.causes[0].evidence, "Dubai: hot, sticky air and 34 °C on 3 of 3 days since you landed");
  // The same humidity % without the muggy dew point is not humid heat.
  const dry = dubai.map((d) => ({ ...d, wx: { ...d.wx, dewMean: 15 } }));
  assert.equal(compare(with_({ acne: 89 }), with_({ acne: 77 }), dry, NO).causes.length, 0);
});
