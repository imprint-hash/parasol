/**
 * Burn clock, protect hours and the reapply rule. Pure functions.
 *
 * UV Index: 1 UVI = 0.025 W/m² of erythemally weighted irradiance
 * (WHO, "Global Solar UV Index: A Practical Guide", 2002, p. 4).
 *
 * Minimal erythema dose (MED) per sun type, in J/m² of erythemal UV. These
 * are approximate ranges as quoted in the UV-index literature for Fitzpatrick
 * skin types (e.g. the MED-by-skin-type tables used by national UV-index
 * services and in Fitzpatrick TB, Arch Dermatol 1988;124:869). Real MEDs vary
 * a lot between people, so the UI always calls these estimates.
 *
 * minutes = MED / (UVI × 0.025 W/m²) / 60, worked out at both ends of the
 * range and rounded DOWN to 5 minutes (the cautious direction), never below 5.
 * Type I at UVI 8: 150 J/m² / 0.2 W/m² = 750 s = 12.5 min → 10; 300 → 25 min.
 *
 * Albinism: no reliable MED exists, so we use type I's lowest value at both
 * ends (150 J/m²) and say "may be faster".
 */

export const UVI_WATTS = 0.025; // W/m² per UV Index unit (WHO 2002)
export const MED = {
  I: [150, 300],
  II: [250, 350],
  III: [300, 500],
  IV: [450, 600],
  V: [600, 1000],
  VI: [1000, 2000],
};
export const MED_MIDPOINT = { I: 200, II: 250, III: 350, IV: 450, V: 600, VI: 1000 };
export const ALBINISM_MED = 150;
export const ROUND_TO_MIN = 5;
export const MIN_UVI_FOR_CLOCK = 1;

/** WHO: protection is needed from UVI 3. For type I and albinism we start at 2 (our conservative choice). */
export const PROTECT_UVI = 3;
export const PROTECT_UVI_CONSERVATIVE = 2;

/** FDA / AAD: reapply at least every 2 hours, and after 40 or 80 minutes in water or sweat, per the label. */
export const REAPPLY_MIN = 120;
export const WATER_RESISTANCE_MIN = [40, 80];

export const ESTIMATE_NOTE = "Estimate. Not medical advice.";

// The tiny epsilon stops float error (12 × 0.025 = 0.30000000000000004) from knocking 25 down to 20.
const floorTo = (m) => Math.max(ROUND_TO_MIN, Math.floor(m / ROUND_TO_MIN + 1e-9) * ROUND_TO_MIN);
export const minutesFor = (med, uvi) => floorTo(med / (uvi * UVI_WATTS) / 60);

/**
 * Burn range at a given UV Index, or null when UVI < 1 (or unknown).
 * → {fitz, atUvi, minutesLow, minutesHigh, albinism, fasterPossible, note}
 */
export function burnRange(fitz, uvi, { albinism = false } = {}) {
  if (!Number.isFinite(uvi) || uvi < MIN_UVI_FOR_CLOCK) return null;
  const range = albinism ? [ALBINISM_MED, ALBINISM_MED] : MED[fitz];
  if (!range) return null;
  return {
    fitz: albinism ? "I" : fitz,
    atUvi: Math.round(uvi * 10) / 10,
    minutesLow: minutesFor(range[0], uvi),
    minutesHigh: minutesFor(range[1], uvi),
    albinism: Boolean(albinism),
    fasterPossible: Boolean(albinism),
    // For types V and VI the UI leads with dark marks and white cast; minutes go in a detail.
    detailOnly: fitz === "V" || fitz === "VI" ? !albinism : false,
    note: ESTIMATE_NOTE,
  };
}

/** The UVI threshold for protect hours for this person. */
export const protectThreshold = (fitz, albinism = false) => (albinism || fitz === "I" ? PROTECT_UVI_CONSERVATIVE : PROTECT_UVI);

const hh = (h) => `${String(h).padStart(2, "0")}:00`;

/**
 * Protect hours from hourly UV [{h, uvi}] (local hours 0–23): from the first
 * hour at or over the threshold to the end of the last one. null if none.
 * → {from:"10:00", to:"16:00", threshold, conservative}
 */
export function protectHours(hourly, fitz, albinism = false) {
  const threshold = protectThreshold(fitz, albinism);
  const over = (hourly || []).filter((x) => Number.isFinite(x?.uvi) && x.uvi >= threshold).map((x) => x.h);
  if (!over.length) return null;
  return {
    from: hh(Math.min(...over)),
    to: hh(Math.min(24, Math.max(...over) + 1)),
    threshold,
    conservative: threshold === PROTECT_UVI_CONSERVATIVE,
    ...(threshold === PROTECT_UVI_CONSERVATIVE ? { label: "From UV 2: our conservative choice" } : {}),
  };
}

/**
 * Minutes until the next sunscreen coat. 120 by default; after swimming or
 * sweating, the water-resistance time on the label (40 or 80), or 40 if the
 * label says nothing (cautious).
 */
export function reapplyMinutes({ water = false, sweat = false, waterResistance = null } = {}) {
  if (!water && !sweat) return REAPPLY_MIN;
  return WATER_RESISTANCE_MIN.includes(waterResistance) ? waterResistance : WATER_RESISTANCE_MIN[0];
}
