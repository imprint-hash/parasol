/**
 * Forecast rules: one day's weather + the person's skin → advice and needs.
 * Pure. Every threshold is a named constant here and tested on both sides.
 *
 * evaluate(profile, wx, {protect}) → {advice:[{id,text,why,tags}], needs, headline, darkMarks}
 *
 * `profile` is the validated shape from src/validate.js:
 *   {skinType, tZone, uZone, scores, concerns:[metric], fitz:"I".."VI", albinism}
 * `wx` is a DaySummary from src/days.js. `protect` is from burn.protectHours.
 *
 * Copy rules: plain words, the real numbers in "why", never certain, and
 * never tell anyone (deep skin included) that they don't need sunscreen.
 */

import { burnRange, protectThreshold } from "./burn.js";

export const HUMID_RH = 70; // % daytime mean, at or above
export const HUMID_TMAX = 26; // °C daytime max, at or above
export const DRY_RH = 40; // % daytime mean, at or below
export const COLD_TMIN = 5; // °C, at or below
export const WIND_KMH = 30; // km/h max, at or above
export const UV_MODERATE = 3; // WHO "moderate" starts at 3
export const UV_HIGH = 6; // WHO "high" starts at 6
export const UV_VERY_HIGH = 8; // WHO "very high" starts at 8
export const PM25_POOR = 35; // µg/m³ hourly max, at or above
export const HOT_TMAX = 30; // °C, at or above
// Humid heat also counts when the air is muggy by dew point even if the daytime
// humidity % looks moderate (hot desert coasts like Dubai: 35 °C at 46% RH is
// a dew point near 21 °C). Most people find a dew point of 20 °C or more muggy
// (US National Weather Service dew point comfort guidance).
export const HUMID_DEWPOINT = 20; // °C daytime mean, at or above
export const EXTREME_TMAX = 38; // °C, at or above
export const DUST_UGM3 = 50; // µg/m³ hourly max of desert dust (CAMS), at or above: our threshold for a "dusty" day
export const SWING_C = 12; // °C between the night low and the daytime high, at or above
export const FEELS_FREEZING = 0; // °C "feels like" (wind chill included), at or below
export const HEATING_TMAX = 10; // °C daytime high, at or below: indoor heating is likely on
// An age_spot concern on sun types IV–VI triggers the dark-marks advice from
// this UV upwards (below it there is little sun to warn about).
export const DARK_MARKS_CONCERN_UV = 3;

export const has = (profile, metric) => (profile?.concerns || []).includes(metric);
const veryFair = (p) => p.albinism === true || p.fitz === "I" || p.fitz === "II";
const deep = (p) => !p.albinism && (p.fitz === "V" || p.fitz === "VI");
const uvKnown = (wx) => Number.isFinite(wx.uvMax);
const n = (v) => typeof v === "number" && Number.isFinite(v);
/** Hot and humid: tMax ≥ 26 and either humidity ≥ 70% or a muggy dew point ≥ 20 °C. */
export const isHumidHeat = (wx) => n(wx.tMax) && wx.tMax >= HUMID_TMAX && ((n(wx.rhMean) && wx.rhMean >= HUMID_RH) || (n(wx.dewMean) && wx.dewMean >= HUMID_DEWPOINT));
const humidWords = (wx) => (n(wx.rhMean) && wx.rhMean >= HUMID_RH ? `${wx.rhMean}% humidity` : `Hot, sticky air`);

export function hourLabel(h) {
  if (!Number.isInteger(h)) return "midday";
  if (h === 0) return "midnight";
  if (h === 12) return "noon";
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}
const uvText = (wx) => `UV ${Math.round(wx.uvMax)}${Number.isInteger(wx.uvPeakHour) ? ` at ${hourLabel(wx.uvPeakHour)}` : ""}`;
const deg = (v) => `${Math.round(v)} °C`;

export const RULES = [
  {
    id: "flight-dry",
    when: (p, wx) => Number.isFinite(wx.flightHours),
    text: () => "Cabin air is very dry (often under 20%). Mist, rich moisturiser and lip balm in your bag.",
    why: (wx) => `${wx.flightHours} h flight; cabin humidity is often 10–20%`,
    tags: () => ["flight", "mist", "lip"],
  },
  {
    id: "humid-oily",
    when: (p, wx) => isHumidHeat(wx) && (p.skinType === "oily" || p.skinType === "combination" || has(p, "oiliness") || has(p, "acne")),
    text: (p, wx) => `${humidWords(wx)}. ${p.skinType === "combination" ? "Your T-zone" : "Your skin"} will likely get shiny: gel moisturiser, matte SPF.`,
    why: (wx) => `Daytime humidity ${wx.rhMean}%${n(wx.dewMean) ? ", sticky air" : ""}, up to ${deg(wx.tMax)}`,
    tags: () => ["humid", "gel", "matte"],
  },
  {
    id: "humid-dry-skin",
    when: (p, wx) => wx.rhMean >= HUMID_RH && p.skinType === "dry",
    text: () => "Humid air helps dry skin: a lighter layer by day is enough.",
    why: (wx) => `Daytime humidity ${wx.rhMean}%`,
    tags: () => ["gel"],
  },
  {
    id: "dry-air",
    when: (p, wx) => wx.rhMean !== null && wx.rhMean <= DRY_RH,
    text: (p) =>
      p.uZone === "dry" || has(p, "moisture")
        ? "Dry air, and your cheeks are already low on moisture: cream morning and night, and a mist in your bag."
        : "Dry air: your cheeks may feel tight. Cream at night.",
    why: (wx) => `Daytime humidity ${wx.rhMean}%`,
    tags: () => ["dry", "cream", "mist"],
  },
  {
    id: "cold",
    when: (p, wx) => wx.tMin !== null && wx.tMin <= COLD_TMIN,
    text: () => "Near freezing: protect your skin barrier. Balm on cheeks and lips.",
    why: (wx) => `Low of ${deg(wx.tMin)}`,
    tags: () => ["cold", "cream", "barrier", "lip"],
  },
  {
    id: "wind",
    when: (p, wx) => wx.windMax !== null && wx.windMax >= WIND_KMH,
    text: (p, wx) =>
      has(p, "redness")
        ? `Windy (up to ${Math.round(wx.windMax)} km/h), and your skin already shows some redness: it can flare. Stick to fragrance-free products.`
        : `Windy (up to ${Math.round(wx.windMax)} km/h): redness can flare.`,
    why: (wx) => `Wind up to ${Math.round(wx.windMax)} km/h`,
    tags: () => ["barrier", "fragrance-free"],
  },
  {
    id: "uv-moderate",
    when: (p, wx) => uvKnown(wx) && wx.uvMax >= UV_MODERATE && wx.uvMax < UV_HIGH,
    text: (p, wx) => `${uvText(wx)}. SPF 30 or higher if you're out at midday.`,
    why: (wx) => `Peak UV index ${wx.uvMax} (moderate is 3–5)`,
    tags: () => ["spf-30"],
  },
  {
    id: "uv-high",
    when: (p, wx) => uvKnown(wx) && wx.uvMax >= UV_HIGH,
    text: (p, wx) => `${uvText(wx)}: SPF 50, reapply every 2 hours.${wx.uvMax >= UV_VERY_HIGH ? " Hat and sunglasses at midday." : ""}`,
    why: (wx) => `Peak UV index ${wx.uvMax} (${wx.uvMax >= 11 ? "extreme is 11+" : wx.uvMax >= UV_VERY_HIGH ? "very high is 8–10" : "high is 6–7"})`,
    tags: (p, wx) => ["spf-50", "high-uv", "hat", ...(wx.uvMax >= UV_VERY_HIGH ? ["sunglasses", "uv-8-plus"] : [])],
  },
  {
    id: "uv-very-fair",
    // Fires from the person's own protect threshold: UV 2 for type I and albinism, UV 3 for type II.
    when: (p, wx) => veryFair(p) && uvKnown(wx) && wx.uvMax >= Math.min(UV_MODERATE, protectThreshold(p.fitz, p.albinism)),
    text: (p, wx, ctx = {}) => {
      const b = burnRange(p.fitz, wx.uvMax, { albinism: p.albinism });
      const at = Number.isInteger(wx.uvPeakHour) ? ` at ${hourLabel(wx.uvPeakHour)}` : "";
      const mins = !b ? "" : b.minutesLow === b.minutesHigh ? `about ${b.minutesLow} minutes` : `about ${b.minutesLow}–${b.minutesHigh} minutes`;
      const burn = b ? `You may start to burn in ${mins}${at}${b.fasterPossible ? ", maybe faster" : ""}. ` : "";
      const hours = ctx.protect ? `Protect hours: ${ctx.protect.from}–${ctx.protect.to}. ` : "";
      return `${burn}${hours}Hat, sleeves, sunglasses.`;
    },
    why: (wx) => `Peak UV index ${wx.uvMax}; burn times are estimates for how fast you burn`,
    tags: () => ["fitz-1-2", "spf-50", "hat", "sleeves", "sunglasses"],
  },
  {
    id: "uv-dark-marks",
    when: (p, wx) =>
      uvKnown(wx) && ((deep(p) && wx.uvMax >= UV_HIGH) || (["IV", "V", "VI"].includes(p.fitz) && !p.albinism && has(p, "age_spot") && wx.uvMax >= DARK_MARKS_CONCERN_UV)),
    text: () => "Strong sun can leave dark marks on your skin that take months to fade. SPF 50 with no white cast; a tinted one also blocks visible light.",
    why: (wx) => `Peak UV index ${wx.uvMax}; deeper skin marks easily even when it doesn't burn`,
    tags: (p) => [p.fitz === "IV" ? "fitz-3-4" : "fitz-5-6", "spf-50", "no-white-cast", "tinted"],
  },
  {
    id: "air-pollution",
    when: (p, wx) => wx.pm25Max !== null && wx.pm25Max >= PM25_POOR,
    text: () => "Air quality is poor today: cleanse well tonight.",
    why: (wx) => `Fine particles (PM2.5) up to ${Math.round(wx.pm25Max)} µg/m³`,
    tags: () => ["cleanser"],
  },
  {
    id: "sweat-water",
    when: (p, wx) => wx.tMax !== null && wx.tMax >= HOT_TMAX,
    text: () => "Hot day: use a water-resistant SPF if you'll sweat or swim, and reapply after 40 or 80 minutes, as the label says.",
    why: (wx) => `Up to ${deg(wx.tMax)}`,
    tags: () => ["water-resistant"],
  },
  {
    id: "extreme-heat",
    when: (p, wx) => n(wx.tMax) && wx.tMax >= EXTREME_TMAX,
    text: (p, wx) => `Extreme heat (up to ${deg(wx.tMax)}): stay in the shade at midday, drink water, keep skin layers light, and use a water-resistant SPF.`,
    why: (wx) => `Up to ${deg(wx.tMax)}`,
    tags: () => ["water-resistant", "gel", "mist"],
  },
  {
    id: "dust",
    when: (p, wx) => n(wx.dustMax) && wx.dustMax >= DUST_UGM3,
    text: () => "Dusty air in the forecast: cleanse gently tonight (no scrubbing), and keep a face mist handy.",
    why: (wx) => `Desert dust up to ${Math.round(wx.dustMax)} µg/m³`,
    tags: () => ["cleanser", "mist"],
  },
  {
    id: "big-swing",
    when: (p, wx) => n(wx.tMax) && n(wx.tMin) && wx.tMax - wx.tMin >= SWING_C,
    text: (p, wx) => `Warm days, cool nights (${deg(wx.tMin)} to ${deg(wx.tMax)}): a light layer by day, a richer cream at night.`,
    why: (wx) => `${Math.round(wx.tMax - wx.tMin)} °C between night and day`,
    tags: () => ["cream"],
  },
  {
    id: "wind-chill",
    when: (p, wx) => n(wx.feelsMin) && wx.feelsMin <= FEELS_FREEZING,
    text: (p, wx) => `Feels like ${deg(wx.feelsMin)} with the wind: cover your cheeks outdoors, and balm on lips and any exposed skin.`,
    why: (wx) => `"Feels like" as low as ${deg(wx.feelsMin)}${n(wx.windMax) ? `, wind up to ${Math.round(wx.windMax)} km/h` : ""}`,
    tags: () => ["cold", "barrier", "cream", "lip"],
  },
  {
    id: "indoor-heating",
    when: (p, wx) => n(wx.tMax) && wx.tMax <= HEATING_TMAX,
    text: () => "Cold out means heated rooms, and heated air is dry: moisturise at night and keep a mist in your bag.",
    why: (wx) => `Daytime high of ${deg(wx.tMax)}`,
    tags: () => ["dry", "cream", "mist"],
  },
  {
    id: "uv-unknown",
    when: (p, wx) => !uvKnown(wx),
    text: () => "UV not known yet: check again within 16 days of travel.",
    why: () => "Open-Meteo forecasts UV about 16 days ahead",
    tags: () => [],
  },
];

// uv-unknown sits high so a "typical" day never headlines something milder than "we don't know the UV yet".
export const PRIORITY = ["uv-very-fair", "uv-dark-marks", "flight-dry", "extreme-heat", "humid-oily", "wind-chill", "cold", "dust", "dry-air", "uv-unknown", "uv-high", "big-swing", "indoor-heating", "uv-moderate", "wind", "sweat-water", "air-pollution", "humid-dry-skin"];

export const CALM_HEADLINE = "A gentle day for your skin. Your usual routine is enough; SPF 30 if you're outside for hours.";

export function evaluate(profile, wx, ctx = {}) {
  const fired = RULES.filter((r) => r.when(profile, wx));
  fired.sort((a, b) => PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id));
  const advice = fired.map((r) => ({ id: r.id, text: r.text(profile, wx, ctx), why: r.why(wx), tags: r.tags(profile, wx) }));
  const needs = [...new Set(advice.flatMap((a) => a.tags))];
  return {
    advice,
    needs,
    headline: advice[0]?.text || CALM_HEADLINE,
    darkMarks: advice.some((a) => a.id === "uv-dark-marks"),
  };
}
