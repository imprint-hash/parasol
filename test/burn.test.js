import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { burnRange, minutesFor, protectHours, protectThreshold, reapplyMinutes, MED, ALBINISM_MED, UVI_WATTS, PROTECT_UVI, PROTECT_UVI_CONSERVATIVE } from "../src/burn.js";

test("WHO constant: 1 UVI = 0.025 W/m²", () => assert.equal(UVI_WATTS, 0.025));

test("minutes = MED / (UVI × 0.025) / 60, rounded down to 5, never below 5", () => {
  assert.equal(minutesFor(150, 8), 10); // 12.5 → 10
  assert.equal(minutesFor(300, 8), 25);
  assert.equal(minutesFor(150, 40), 5); // 2.5 → floor 5
});

test("burn minutes for every sun type at UVI 1, 8 and 12", () => {
  const expected = {
    1: { I: [100, 200], II: [165, 230], III: [200, 330], IV: [300, 400], V: [400, 665], VI: [665, 1330] },
    8: { I: [10, 25], II: [20, 25], III: [25, 40], IV: [35, 50], V: [50, 80], VI: [80, 165] },
    12: { I: [5, 15], II: [10, 15], III: [15, 25], IV: [25, 30], V: [30, 55], VI: [55, 110] },
  };
  for (const uvi of [1, 8, 12]) {
    for (const fitz of Object.keys(MED)) {
      const b = burnRange(fitz, uvi);
      assert.deepEqual([b.minutesLow, b.minutesHigh], expected[uvi][fitz], `type ${fitz} at UVI ${uvi}`);
      assert.equal(b.note, "Estimate. Not medical advice.");
      assert.ok(b.minutesLow <= b.minutesHigh);
    }
  }
});

test("UVI below 1, zero, missing or NaN gives no burn clock", () => {
  assert.equal(burnRange("I", 0), null);
  assert.equal(burnRange("I", 0.99), null);
  assert.equal(burnRange("I", null), null);
  assert.equal(burnRange("I", NaN), null);
  assert.ok(burnRange("I", 1));
});

test("unknown sun type gives null", () => assert.equal(burnRange("VII", 8), null));

test("albinism override: 150 J/m² at both ends, 'may be faster', whatever the reported type", () => {
  for (const fitz of ["I", "IV", "VI"]) {
    const b = burnRange(fitz, 8, { albinism: true });
    assert.equal(b.minutesLow, minutesFor(ALBINISM_MED, 8));
    assert.equal(b.minutesHigh, b.minutesLow);
    assert.equal(b.fasterPossible, true);
    assert.equal(b.fitz, "I");
    assert.equal(b.detailOnly, false);
  }
});

test("types V and VI put the minutes in a detail; others lead with them", () => {
  assert.equal(burnRange("V", 9).detailOnly, true);
  assert.equal(burnRange("VI", 9).detailOnly, true);
  assert.equal(burnRange("IV", 9).detailOnly, false);
});

const day = (peak) => Array.from({ length: 24 }, (_, h) => ({ h, uvi: Math.max(0, peak - Math.abs(h - 13)) }));

test("protect hours: UVI ≥ 3 by default (WHO), boundary both sides", () => {
  assert.equal(PROTECT_UVI, 3);
  assert.equal(protectHours([{ h: 12, uvi: 2.99 }], "III"), null);
  assert.deepEqual(protectHours([{ h: 12, uvi: 3 }], "III"), { from: "12:00", to: "13:00", threshold: 3, conservative: false });
  const p = protectHours(day(8), "IV");
  assert.equal(p.from, "08:00"); // uvi 3 at 08:00 (8 - 5)
  assert.equal(p.to, "19:00"); // last hour 18:00 has uvi 3
});

test("protect hours: type I and albinism start at UVI 2, labelled conservative", () => {
  assert.equal(protectThreshold("I"), PROTECT_UVI_CONSERVATIVE);
  assert.equal(protectThreshold("II"), PROTECT_UVI);
  assert.equal(protectThreshold("V", true), PROTECT_UVI_CONSERVATIVE);
  assert.equal(protectHours([{ h: 12, uvi: 1.99 }], "I"), null);
  const p = protectHours([{ h: 12, uvi: 2 }], "I");
  assert.equal(p.conservative, true);
  assert.match(p.label, /conservative/);
  assert.equal(protectHours([{ h: 12, uvi: 2 }], "II"), null);
});

test("protect hours ignore null UV and end at 24:00 at most", () => {
  assert.equal(protectHours([{ h: 12, uvi: null }], "I"), null);
  assert.equal(protectHours([{ h: 23, uvi: 5 }], "III").to, "24:00");
});

test("reapply: 120 by default, 40/80 after water or sweat per label, 40 if unknown", () => {
  assert.equal(reapplyMinutes(), 120);
  assert.equal(reapplyMinutes({ water: true, waterResistance: 80 }), 80);
  assert.equal(reapplyMinutes({ sweat: true, waterResistance: 40 }), 40);
  assert.equal(reapplyMinutes({ water: true }), 40);
  assert.equal(reapplyMinutes({ water: true, waterResistance: 999 }), 40);
});
