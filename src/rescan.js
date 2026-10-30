/**
 * Rescan: what changed since the baseline scan, and the likely reasons.
 * Pure: compare(baseline, current, days, selfReport, profile).
 *
 * YouCam ui_scores run 1–100, higher is healthier, so delta = after − before
 * and a metric is WORSE when delta ≤ −RESCAN_DELTA. Changes smaller than
 * RESCAN_DELTA either way are treated as day-to-day noise and not shown
 * (spike S8 sets the value; 8 by default).
 *
 * Causes (at most 2, "likely" before "possible"), each with fixed tonight
 * steps and its own needs. Wording is never certain. The safety line is
 * always returned.
 */

import { HUMID_RH, DRY_RH, COLD_TMIN, WIND_KMH, UV_HIGH, isHumidHeat } from "./rules.js";
import { METRICS } from "./tags.js";
import { addDays } from "./days.js";

export const RESCAN_DELTA = Number(process.env.RESCAN_DELTA) > 0 ? Number(process.env.RESCAN_DELTA) : 8;
export const FLIGHT_WINDOW_DAYS = 3; // "flight within 72 h"
export const MAX_CAUSES = 2;
export const SAFETY = "Blistering, fever, swelling near the eyes, or a rash that spreads: see a pharmacist or doctor.";
export const NO_WEATHER_CAUSE = "The weather doesn't explain this change.";
export const NO_CHANGE = "No change bigger than normal day-to-day differences.";

export const METRIC_LABELS = {
  oiliness: "Oil and shine", moisture: "Moisture", acne: "Breakouts", redness: "Redness",
  pore: "Pores", age_spot: "Dark spots", texture: "Texture", radiance: "Radiance",
};

export const CAUSES = {
  humid_heat: {
    label: "Humid heat",
    tonight: ["Cleanse gently once, with lukewarm water.", "Use a light gel moisturiser instead of a rich cream.", "Skip heavy oils and balms on your T-zone tonight.", "Tomorrow: matte SPF and blotting papers, not more layers."],
    needs: ["humid", "gel", "matte", "blotting"],
  },
  dry_air: {
    label: "Dry air",
    tonight: ["Cleanse with a gentle cream cleanser, no scrubs.", "Moisturise on slightly damp skin.", "Add a rich cream or balm on dry patches.", "Drink water and keep a mist for the daytime."],
    needs: ["dry", "cream", "barrier", "mist"],
  },
  cold_wind: {
    label: "Cold and wind",
    tonight: ["Skip exfoliating acids and scrubs for a few nights.", "Use a fragrance-free barrier cream or balm.", "Balm on lips and cheeks before you go out tomorrow.", "Lukewarm, not hot, water when you wash."],
    needs: ["cold", "barrier", "fragrance-free", "lip"],
  },
  sun: {
    label: "Sun",
    tonight: ["Cool (not icy) water on your face, then a soothing fragrance-free moisturiser.", "Skip retinoids and acids tonight.", "Tomorrow: SPF 50, reapply every 2 hours, and a hat at midday."],
    needs: ["spf-50", "high-uv", "hat", "aftersun"],
  },
  hard_water: {
    label: "Hard water",
    tonight: ["Hard water can dry some people's skin: rinse with bottled or filtered water if you can.", "Pat dry, don't rub.", "Moisturise straight after washing."],
    needs: ["dry", "cream", "fragrance-free"],
  },
  new_product: {
    label: "A new product",
    tonight: ["Pause the newest product for a few days.", "Go back to your simplest routine: cleanse, moisturise, SPF in the day.", "If it settles, reintroduce the product on a small patch first."],
    needs: ["fragrance-free", "sensitive"],
  },
};

const worse = (changes, metrics) => changes.some((c) => c.worse && metrics.includes(c.metric));
const fmt = (v) => Math.round(v);

/** Count days matching `test`, for evidence lines like "Lagos: 84% humidity on 2 of 3 days". */
function evidence(days, test, describe) {
  const hits = days.filter((d) => test(d.wx));
  if (!hits.length) return null;
  const cities = [...new Set(hits.map((d) => d.city).filter(Boolean))].join(" and ");
  return `${cities ? `${cities}: ` : ""}${describe(hits)} on ${hits.length} of ${days.length} day${days.length === 1 ? "" : "s"} since you landed`;
}
const maxOf = (hits, k) => Math.max(...hits.map((d) => d.wx[k]));
const minOf = (hits, k) => Math.min(...hits.map((d) => d.wx[k]));

export function compareScores(baseline, current) {
  const changes = [];
  for (const m of METRICS) {
    const before = baseline?.[m], after = current?.[m];
    if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
    const delta = after - before;
    if (Math.abs(delta) < RESCAN_DELTA) continue;
    changes.push({ metric: m, label: METRIC_LABELS[m], before: fmt(before), after: fmt(after), delta: fmt(delta), worse: delta <= -RESCAN_DELTA });
  }
  return changes.sort((a, b) => a.delta - b.delta);
}

export function compare(baseline, current, days = [], selfReport = {}, profile = null) {
  const changes = compareScores(baseline, current);
  const causes = [];
  const anyWorse = changes.some((c) => c.worse);
  const latest = days.reduce((m, d) => (d.date > m ? d.date : m), "");

  if (anyWorse) {
    if (worse(changes, ["oiliness", "acne", "pore"])) {
      const ev = evidence(days, isHumidHeat, (h) => {
        const wet = h.filter((d) => d.wx.rhMean >= HUMID_RH);
        return wet.length
          ? `up to ${maxOf(wet, "rhMean")}% humidity and ${fmt(maxOf(h, "tMax"))} °C`
          : `muggy heat (dew point up to ${fmt(maxOf(h, "dewMean"))} °C) and ${fmt(maxOf(h, "tMax"))} °C`;
      });
      if (ev) causes.push({ id: "humid_heat", evidence: ev, confidence: "likely" });
    }
    if (worse(changes, ["moisture", "texture"])) {
      const flight = days.find((d) => Number.isFinite(d.wx.flightHours) && latest && d.date >= addDays(latest, -FLIGHT_WINDOW_DAYS));
      const ev = flight
        ? `A ${flight.wx.flightHours} h flight on ${flight.date}: cabin air is often 10–20% humidity`
        : evidence(days, (w) => (w.rhMean !== null && w.rhMean <= DRY_RH) || (w.tMin !== null && w.tMin <= COLD_TMIN), (h) => {
            const dry = h.filter((d) => d.wx.rhMean !== null && d.wx.rhMean <= DRY_RH);
            return dry.length ? `humidity as low as ${minOf(dry, "rhMean")}%` : `lows of ${fmt(minOf(h, "tMin"))} °C`;
          });
      if (ev) causes.push({ id: "dry_air", evidence: ev, confidence: "likely" });
    }
    if (worse(changes, ["redness"])) {
      const ev = evidence(days, (w) => (w.tMin !== null && w.tMin <= COLD_TMIN) || (w.windMax !== null && w.windMax >= WIND_KMH), (h) => {
        const windy = h.filter((d) => d.wx.windMax !== null && d.wx.windMax >= WIND_KMH);
        return windy.length ? `wind up to ${fmt(maxOf(windy, "windMax"))} km/h` : `lows of ${fmt(minOf(h, "tMin"))} °C`;
      });
      if (ev) causes.push({ id: "cold_wind", evidence: ev, confidence: "likely" });
    }
    if (worse(changes, ["redness", "age_spot"])) {
      const ev = evidence(days, (w) => w.uvMax !== null && w.uvMax >= UV_HIGH, (h) => `UV up to ${fmt(maxOf(h, "uvMax"))}`);
      if (ev) causes.push({ id: "sun", evidence: selfReport.sun ? `${ev}, and you said you spent time in the sun` : ev, confidence: selfReport.sun ? "likely" : "possible" });
    }
    if (selfReport.water && worse(changes, ["moisture", "redness"])) {
      causes.push({ id: "hard_water", evidence: "You said the water felt different", confidence: "possible" });
    }
  }
  if (selfReport.newProduct) {
    causes.push({ id: "new_product", evidence: "You said you started a new product", confidence: "possible" });
  }

  const order = { likely: 0, possible: 1 };
  const top = causes
    .map((c, i) => ({ ...c, i }))
    .sort((a, b) => order[a.confidence] - order[b.confidence] || a.i - b.i)
    .slice(0, MAX_CAUSES)
    .map(({ i, ...c }) => ({ ...c, label: CAUSES[c.id].label }));

  const tonight = top.length
    ? [...new Set(top.flatMap((c) => CAUSES[c.id].tonight))]
    : anyWorse
      ? ["Keep tonight simple: gentle cleanse, fragrance-free moisturiser.", "Skip scrubs, acids and retinoids for a night or two.", "Scan again in a couple of days to see if it settles."]
      : ["Keep doing what you're doing.", "Scan again in a few days, in similar light, for a fair comparison."];
  const needs = [...new Set(top.flatMap((c) => CAUSES[c.id].needs))];
  if (selfReport.sleep) tonight.push("You said you slept badly: sleep can show on skin too, so an early night helps.");

  return {
    changes,
    causes: top,
    summary: !anyWorse ? NO_CHANGE : top.length ? null : NO_WEATHER_CAUSE,
    tonight,
    needs,
    safety: SAFETY,
    threshold: RESCAN_DELTA,
    ...(profile?.albinism ? { note: "With albinism, any new spot or sore that doesn't heal in a few weeks is worth showing to a doctor." } : {}),
  };
}
