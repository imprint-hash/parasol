import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, RULES, PRIORITY, CALM_HEADLINE, hourLabel, HUMID_RH, HUMID_TMAX, DRY_RH, COLD_TMIN, WIND_KMH, UV_MODERATE, UV_HIGH, UV_VERY_HIGH, PM25_POOR, HOT_TMAX, DARK_MARKS_CONCERN_UV, HUMID_DEWPOINT, EXTREME_TMAX, DUST_UGM3, SWING_C, FEELS_FREEZING, HEATING_TMAX, isHumidHeat } from "../src/rules.js";
import { NEED_TAGS } from "../src/tags.js";

// A mild day that fires nothing.
const WX = { uvMax: 1, uvPeakHour: 12, rhMean: 55, tMin: 12, tMax: 20, windMax: 10, pm25Max: 5, flightHours: null };
const P = { skinType: "normal", tZone: null, uZone: null, scores: null, concerns: [], fitz: "III", albinism: false };
const ids = (p, wx) => evaluate({ ...P, ...p }, { ...WX, ...wx }).advice.map((a) => a.id);
const fires = (id, p, wx) => ids(p, wx).includes(id);

test("a mild day fires no rule and gets the calm headline (which still mentions SPF)", () => {
  const r = evaluate(P, WX);
  assert.deepEqual(r.advice, []);
  assert.equal(r.headline, CALM_HEADLINE);
  assert.match(r.headline, /SPF/);
});

test("every rule has a priority, and every tag it can emit is a known need", () => {
  for (const r of RULES) assert.ok(PRIORITY.includes(r.id), r.id);
  const hot = { uvMax: 11, uvPeakHour: 13, rhMean: 90, tMin: 0, tMax: 35, windMax: 50, pm25Max: 80, flightHours: 8 };
  for (const p of [{ fitz: "I" }, { fitz: "VI" }, { fitz: "IV", concerns: ["age_spot"] }]) {
    for (const a of evaluate({ ...P, ...p, skinType: "oily" }, hot).advice) for (const t of a.tags) assert.ok(NEED_TAGS.has(t), `${a.id}: ${t}`);
  }
});

test("flight-dry: flight day only", () => {
  assert.ok(fires("flight-dry", {}, { flightHours: 0.5 }));
  assert.ok(!fires("flight-dry", {}, { flightHours: null }));
  const a = evaluate(P, { ...WX, flightHours: 7 }).advice[0];
  assert.deepEqual(a.tags, ["flight", "mist", "lip"]);
  assert.match(a.why, /7 h flight/);
});

test("humid-oily: rh ≥ 70 and tMax ≥ 26 with oily/combination skin or an oiliness/acne concern", () => {
  const hot = { rhMean: HUMID_RH, tMax: HUMID_TMAX };
  assert.ok(fires("humid-oily", { skinType: "oily" }, hot));
  assert.ok(fires("humid-oily", { skinType: "combination" }, hot));
  assert.ok(fires("humid-oily", { concerns: ["acne"] }, hot));
  assert.ok(fires("humid-oily", { concerns: ["oiliness"] }, hot));
  assert.ok(!fires("humid-oily", { skinType: "normal" }, hot));
  assert.ok(!fires("humid-oily", { skinType: "oily" }, { rhMean: HUMID_RH - 1, tMax: HUMID_TMAX }));
  assert.ok(!fires("humid-oily", { skinType: "oily" }, { rhMean: HUMID_RH, tMax: HUMID_TMAX - 0.1 }));
  const a = evaluate({ ...P, skinType: "combination" }, { ...WX, rhMean: 85, tMax: 31 }).advice.find((x) => x.id === "humid-oily");
  assert.match(a.text, /85% humidity\. Your T-zone/);
  assert.deepEqual(a.tags, ["humid", "gel", "matte"]);
});

test("humid-dry-skin: rh ≥ 70 with dry skin", () => {
  assert.ok(fires("humid-dry-skin", { skinType: "dry" }, { rhMean: HUMID_RH }));
  assert.ok(!fires("humid-dry-skin", { skinType: "dry" }, { rhMean: HUMID_RH - 1 }));
  assert.ok(!fires("humid-dry-skin", { skinType: "oily" }, { rhMean: 90 }));
});

test("dry-air: rh ≤ 40, stronger text with a dry U-zone or moisture concern", () => {
  assert.ok(fires("dry-air", {}, { rhMean: DRY_RH }));
  assert.ok(!fires("dry-air", {}, { rhMean: DRY_RH + 1 }));
  assert.ok(!fires("dry-air", {}, { rhMean: null }));
  const plain = evaluate(P, { ...WX, rhMean: 30 }).advice[0].text;
  const strong = evaluate({ ...P, concerns: ["moisture"] }, { ...WX, rhMean: 30 }).advice[0].text;
  const zone = evaluate({ ...P, uZone: "dry" }, { ...WX, rhMean: 30 }).advice[0].text;
  assert.notEqual(plain, strong);
  assert.equal(strong, zone);
});

test("cold: tMin ≤ 5", () => {
  assert.ok(fires("cold", {}, { tMin: COLD_TMIN }));
  assert.ok(!fires("cold", {}, { tMin: COLD_TMIN + 0.1 }));
});

test("wind: windMax ≥ 30, stronger with a redness concern", () => {
  assert.ok(fires("wind", {}, { windMax: WIND_KMH }));
  assert.ok(!fires("wind", {}, { windMax: WIND_KMH - 0.1 }));
  const plain = evaluate(P, { ...WX, windMax: 40 }).advice[0].text;
  const red = evaluate({ ...P, concerns: ["redness"] }, { ...WX, windMax: 40 }).advice[0].text;
  assert.match(red, /redness/);
  assert.notEqual(plain, red);
});

test("uv-moderate: 3 ≤ UV < 6", () => {
  assert.ok(fires("uv-moderate", {}, { uvMax: UV_MODERATE }));
  assert.ok(fires("uv-moderate", {}, { uvMax: 5.9 }));
  assert.ok(!fires("uv-moderate", {}, { uvMax: 2.9 }));
  assert.ok(!fires("uv-moderate", {}, { uvMax: UV_HIGH }));
  assert.match(evaluate(P, { ...WX, uvMax: 4, uvPeakHour: 13 }).advice[0].text, /^UV 4 at 1 pm\. SPF 30/);
});

test("uv-high: UV ≥ 6; hat always, sunglasses from UV 8", () => {
  assert.ok(fires("uv-high", {}, { uvMax: UV_HIGH }));
  assert.ok(!fires("uv-high", {}, { uvMax: 5.9 }));
  const at7 = evaluate(P, { ...WX, uvMax: 7.9 }).advice.find((a) => a.id === "uv-high");
  const at8 = evaluate(P, { ...WX, uvMax: UV_VERY_HIGH }).advice.find((a) => a.id === "uv-high");
  assert.ok(at7.tags.includes("hat") && !at7.tags.includes("sunglasses"));
  assert.ok(at8.tags.includes("sunglasses") && at8.tags.includes("uv-8-plus"));
  assert.match(at8.text, /SPF 50, reapply every 2 hours/);
});

test("uv-very-fair: from the person's protect threshold (UV 2 for type I and albinism, UV 3 for type II); burn minutes and protect hours in the text", () => {
  assert.ok(fires("uv-very-fair", { fitz: "I" }, { uvMax: 3 }));
  assert.ok(fires("uv-very-fair", { fitz: "II" }, { uvMax: 3 }));
  assert.ok(fires("uv-very-fair", { fitz: "IV", albinism: true }, { uvMax: 3 }));
  assert.ok(fires("uv-very-fair", { fitz: "I" }, { uvMax: 2 }));
  assert.ok(fires("uv-very-fair", { fitz: "IV", albinism: true }, { uvMax: 2 }));
  assert.ok(!fires("uv-very-fair", { fitz: "I" }, { uvMax: 1.9 }));
  assert.ok(!fires("uv-very-fair", { fitz: "II" }, { uvMax: 2.9 }));
  assert.ok(!fires("uv-very-fair", { fitz: "III" }, { uvMax: 9 }));
  const r = evaluate({ ...P, fitz: "I" }, { ...WX, uvMax: 8, uvPeakHour: 13 }, { protect: { from: "10:00", to: "16:00" } });
  assert.equal(r.advice[0].id, "uv-very-fair");
  assert.equal(r.headline, "You may start to burn in about 10–25 minutes at 1 pm. Protect hours: 10:00–16:00. Hat, sleeves, sunglasses.");
  const alb = evaluate({ ...P, fitz: "I", albinism: true }, { ...WX, uvMax: 8, uvPeakHour: 13 });
  assert.match(alb.headline, /about 10 minutes at 1 pm, maybe faster/);
});

test("uv-dark-marks: V–VI with UV ≥ 6, or IV–VI with an age_spot concern from UV 3", () => {
  assert.ok(fires("uv-dark-marks", { fitz: "V" }, { uvMax: UV_HIGH }));
  assert.ok(fires("uv-dark-marks", { fitz: "VI" }, { uvMax: UV_HIGH }));
  assert.ok(!fires("uv-dark-marks", { fitz: "VI" }, { uvMax: 5.9 }));
  assert.ok(!fires("uv-dark-marks", { fitz: "IV" }, { uvMax: 9 }));
  assert.ok(fires("uv-dark-marks", { fitz: "IV", concerns: ["age_spot"] }, { uvMax: DARK_MARKS_CONCERN_UV }));
  assert.ok(!fires("uv-dark-marks", { fitz: "IV", concerns: ["age_spot"] }, { uvMax: DARK_MARKS_CONCERN_UV - 0.1 }));
  assert.ok(!fires("uv-dark-marks", { fitz: "III", concerns: ["age_spot"] }, { uvMax: 9 }));
  assert.ok(!fires("uv-dark-marks", { fitz: "VI", albinism: true }, { uvMax: 9 }), "albinism is treated as very fair, not deep");
  const r = evaluate({ ...P, fitz: "VI" }, { ...WX, uvMax: 11 });
  assert.equal(r.darkMarks, true);
  assert.equal(r.advice[0].id, "uv-dark-marks");
  assert.ok(r.needs.includes("no-white-cast") && r.needs.includes("tinted") && r.needs.includes("fitz-5-6"));
  assert.equal(evaluate({ ...P, fitz: "IV", concerns: ["age_spot"] }, { ...WX, uvMax: 4 }).advice[0].tags[0], "fitz-3-4");
});

test("air-pollution: pm2.5 ≥ 35, null ignored", () => {
  assert.ok(fires("air-pollution", {}, { pm25Max: PM25_POOR }));
  assert.ok(!fires("air-pollution", {}, { pm25Max: PM25_POOR - 0.1 }));
  assert.ok(!fires("air-pollution", {}, { pm25Max: null }));
});

test("sweat-water: tMax ≥ 30", () => {
  assert.ok(fires("sweat-water", {}, { tMax: HOT_TMAX }));
  assert.ok(!fires("sweat-water", {}, { tMax: HOT_TMAX - 0.1 }));
});

test("uv-unknown: UV null fires the 'check again' line and no UV rule", () => {
  const r = ids({ fitz: "I" }, { uvMax: null, uvPeakHour: null });
  assert.deepEqual(r, ["uv-unknown"]);
  assert.match(evaluate(P, { ...WX, uvMax: null }).headline, /UV not known yet: check again within 16 days of travel/);
});

test("headline priority: very-fair > dark-marks > flight > humid-oily > cold > dry-air", () => {
  const all = { uvMax: 9, rhMean: 80, tMax: 31, tMin: 2, flightHours: 6 };
  assert.equal(ids({ fitz: "I", skinType: "oily" }, all)[0], "uv-very-fair");
  assert.equal(ids({ fitz: "VI", skinType: "oily" }, all)[0], "uv-dark-marks");
  assert.equal(ids({ fitz: "III", skinType: "oily" }, all)[0], "flight-dry");
  assert.equal(ids({ fitz: "III", skinType: "oily" }, { ...all, flightHours: null })[0], "humid-oily");
  assert.equal(ids({ fitz: "III" }, { tMin: 2, rhMean: 30 })[0], "cold");
  assert.equal(ids({ fitz: "III" }, { rhMean: 30 })[0], "dry-air");
});

test("deep skin is never told it doesn't need sunscreen, at any UV", () => {
  for (const fitz of ["V", "VI"]) {
    for (const uvMax of [null, 0, 1, 3, 6, 9, 12]) {
      const r = evaluate({ ...P, fitz }, { ...WX, uvMax });
      const text = [r.headline, ...r.advice.map((a) => a.text)].join(" ").toLowerCase();
      assert.doesNotMatch(text, /(don't|do not|no) need (any )?(sunscreen|spf)|skip (the )?(sunscreen|spf)|sunscreen (is )?(optional|not needed)/, `${fitz} @ ${uvMax}`);
      if (uvMax >= 3) assert.match(text, /spf/, `${fitz} @ ${uvMax} should mention SPF`);
    }
  }
});

test("needs are the union of fired rule tags, without duplicates", () => {
  const r = evaluate({ ...P, fitz: "I" }, { ...WX, uvMax: 9 });
  assert.equal(new Set(r.needs).size, r.needs.length);
  for (const t of ["spf-50", "hat", "sleeves", "sunglasses", "fitz-1-2", "high-uv"]) assert.ok(r.needs.includes(t), t);
});

test("hour labels", () => {
  assert.equal(hourLabel(0), "midnight");
  assert.equal(hourLabel(9), "9 am");
  assert.equal(hourLabel(12), "noon");
  assert.equal(hourLabel(13), "1 pm");
  assert.equal(hourLabel(null), "midday");
});

/* ---------- harsh-weather rules (Cairo, Dubai, Reykjavik) ---------- */

test("humid heat by dew point: tMax ≥ 26 and dew point ≥ 20 °C counts even at moderate humidity %", () => {
  assert.ok(isHumidHeat({ tMax: 26, rhMean: 46, dewMean: HUMID_DEWPOINT }));
  assert.ok(!isHumidHeat({ tMax: 26, rhMean: 46, dewMean: HUMID_DEWPOINT - 0.1 }));
  assert.ok(!isHumidHeat({ tMax: 25.9, rhMean: 46, dewMean: 25 }));
  assert.ok(!isHumidHeat({ tMax: 35, rhMean: 46, dewMean: null }));
  const a = evaluate({ ...P, skinType: "oily" }, { ...WX, tMax: 34, rhMean: 46, dewMean: 21.4 }).advice.find((x) => x.id === "humid-oily");
  assert.match(a.text, /^Muggy heat \(dew point 21 °C\)\. Your skin/);
  assert.match(a.why, /dew point 21 °C/);
});

test("extreme-heat: tMax ≥ 38", () => {
  assert.ok(fires("extreme-heat", {}, { tMax: EXTREME_TMAX }));
  assert.ok(!fires("extreme-heat", {}, { tMax: EXTREME_TMAX - 0.1 }));
  assert.ok(!fires("extreme-heat", {}, { tMax: null }));
  assert.match(evaluate(P, { ...WX, tMax: 41 }).headline, /^Extreme heat \(up to 41 °C\)/);
});

test("dust: desert dust ≥ 50 µg/m³", () => {
  assert.ok(fires("dust", {}, { dustMax: DUST_UGM3 }));
  assert.ok(!fires("dust", {}, { dustMax: DUST_UGM3 - 0.1 }));
  assert.ok(!fires("dust", {}, { dustMax: null }));
  assert.ok(!fires("dust", {}, {}), "older snapshots have no dust field");
  const a = evaluate(P, { ...WX, dustMax: 104.8 }).advice[0];
  assert.deepEqual(a.tags, ["cleanser", "mist"]);
  assert.match(a.why, /105 µg\/m³/);
});

test("big-swing: night low to day high ≥ 12 °C", () => {
  assert.ok(fires("big-swing", {}, { tMin: 18, tMax: 18 + SWING_C }));
  assert.ok(!fires("big-swing", {}, { tMin: 18, tMax: 18 + SWING_C - 0.1 }));
  assert.match(evaluate(P, { ...WX, tMin: 17, tMax: 32 }).advice.find((x) => x.id === "big-swing").text, /17 °C to 32 °C/);
});

test("wind-chill: 'feels like' ≤ 0 °C", () => {
  assert.ok(fires("wind-chill", {}, { feelsMin: FEELS_FREEZING }));
  assert.ok(!fires("wind-chill", {}, { feelsMin: FEELS_FREEZING + 0.1 }));
  assert.ok(!fires("wind-chill", {}, { feelsMin: null }));
  assert.match(evaluate(P, { ...WX, feelsMin: -3.4, windMax: 29 }).headline, /^Feels like -3 °C with the wind/);
});

test("indoor-heating: daytime high ≤ 10 °C", () => {
  assert.ok(fires("indoor-heating", {}, { tMax: HEATING_TMAX }));
  assert.ok(!fires("indoor-heating", {}, { tMax: HEATING_TMAX + 0.1 }));
  assert.ok(evaluate(P, { ...WX, tMax: 7 }).needs.includes("mist"));
});

test("harsh priorities: extreme heat beats humid; wind chill beats cold; dust beats dry air", () => {
  assert.equal(ids({ skinType: "oily" }, { tMax: 39, rhMean: 80 })[0], "extreme-heat");
  assert.equal(ids({}, { tMin: 2, feelsMin: -4, tMax: 6 })[0], "wind-chill");
  assert.equal(ids({}, { dustMax: 80, rhMean: 30 })[0], "dust");
});
