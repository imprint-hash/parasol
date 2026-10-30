// Drawn pieces shared by pages: face zone diagram, concern bars, sun type scale,
// burn-clock dial, city mini-map. Every drawing has a text equivalent nearby.
import { esc, icon, uvLevel, fmtHour } from "./ui.js";

/* ---------- skin ---------- */

export const METRICS = {
  oiliness: { name: "Oiliness", ic: "drop", alt: "Shine highlighted on forehead and nose" },
  moisture: { name: "Moisture", ic: "drop", alt: "Drier areas highlighted" },
  acne: { name: "Spots (acne)", ic: "sparkle", alt: "Spots marked on the skin" },
  redness: { name: "Redness", ic: "thermo", alt: "Areas of redness highlighted" },
  pore: { name: "Pores", ic: "search", alt: "Visible pores highlighted" },
  age_spot: { name: "Dark spots", ic: "sun", alt: "Dark spots marked" },
  texture: { name: "Texture", ic: "image", alt: "Uneven texture highlighted" },
  radiance: { name: "Radiance (glow)", ic: "sparkle", alt: "Glow and dullness mapped" },
};

export const SKIN_TYPES = {
  oily: { name: "Oily skin", line: "Shine across the face, especially later in the day." },
  dry: { name: "Dry skin", line: "Can feel tight, especially in dry air and after flights." },
  combination: { name: "Combination skin", line: "Oilier T-zone (forehead, nose, chin), drier or normal cheeks." },
  normal: { name: "Normal skin", line: "Fairly balanced: not very oily, not very dry." },
};
const ZONE_WORD = { oily: "Oily", dry: "Dry", normal: "Balanced", combination: "Mixed" };
export const zoneWord = (z) => ZONE_WORD[z] || "Balanced";

/** Plain label for a 1–100 YouCam score (higher is healthier). */
export function scoreLabel(score) {
  const s = Number(score);
  if (s < 40) return { cls: "strong", text: "Needs care" };
  if (s < 60) return { cls: "watch", text: "Watch" };
  if (s < 80) return { cls: "", text: "Good" };
  return { cls: "", text: "Very good" };
}

/** Face diagram: T-zone (forehead + nose + chin) and cheeks (U-zone). */
export function faceDiagram(tZone, uZone) {
  const tOily = tZone === "oily";
  const uOily = uZone === "oily";
  const uDry = uZone === "dry";
  const tFill = tOily ? "#ffdad2" : tZone === "dry" ? "#ffddb0" : "#cde5ff";
  const tInk = tOily ? "#8b1b00" : tZone === "dry" ? "#614000" : "#004f7b";
  const uFill = uOily ? "#ffdad2" : uDry ? "#ffddb0" : "#cde5ff";
  const uInk = uOily ? "#8b1b00" : uDry ? "#614000" : "#004f7b";
  const label = `Face map. T-zone (forehead, nose and chin): ${zoneWord(tZone)}. Cheeks: ${zoneWord(uZone)}.`;
  return `<svg class="face-svg" viewBox="0 0 200 236" role="img" aria-label="${esc(label)}">
    <path class="head" d="M100 16C155 16 178 52 178 118C178 176 142 220 100 220C58 220 22 176 22 118C22 52 45 16 100 16Z" stroke-width="4"/>
    <ellipse cx="58" cy="140" rx="26" ry="19" fill="${uFill}" fill-opacity="0.92"/>
    <ellipse cx="142" cy="140" rx="26" ry="19" fill="${uFill}" fill-opacity="0.92"/>
    <path d="M46 54C74 46 126 46 154 54C150 76 132 80 115 80L115 150C115 163 85 163 85 150L85 80C68 80 50 76 46 54Z" fill="${tFill}" fill-opacity="0.95"/>
    <ellipse cx="100" cy="196" rx="20" ry="9" fill="${tFill}" fill-opacity="0.95"/>
    <path class="feat" d="M54 94Q68 88 82 94M118 94Q132 88 146 94" stroke-linecap="round" stroke-width="3" fill="none"/>
    <circle class="eye" cx="68" cy="106" r="4"/><circle class="eye" cx="132" cy="106" r="4"/>
    <path class="feat" d="M84 182Q100 190 116 182" stroke-linecap="round" stroke-width="3" fill="none"/>
    ${tOily ? '<path d="M92 34L96 26L100 34L108 38L100 42L96 50L92 42L84 38Z" fill="#d14221"/>' : ""}
    <text x="100" y="70" text-anchor="middle" font-size="12" fill="${tInk}">T-zone: ${zoneWord(tZone)}</text>
    <text x="58" y="144" text-anchor="middle" font-size="10.5" fill="${uInk}">${zoneWord(uZone)}</text>
    <text x="142" y="144" text-anchor="middle" font-size="10.5" fill="${uInk}">${zoneWord(uZone)}</text>
  </svg>`;
}

/** Concern bars for the 8 YouCam scores. */
export function concernBars(scores = {}, { only } = {}) {
  const keys = (only || Object.keys(METRICS)).filter((k) => Number.isFinite(Number(scores[k])));
  return `<ul class="bars">${keys
    .map((k) => {
      const s = Math.round(scores[k]);
      const l = scoreLabel(s);
      return `<li class="bar-row"><div class="bar-top"><span class="bar-name"><span class="b-ic">${icon(METRICS[k].ic)}</span>${esc(METRICS[k].name)}</span><span class="bar-val ${l.cls}">${l.text} (${s})</span></div><div class="bar-track" aria-hidden="true"><div class="bar-fill ${l.cls}" style="width:${Math.max(3, s)}%"></div></div></li>`;
    })
    .join("")}</ul>`;
}

/* ---------- sun type ---------- */

export const FITZ = {
  I: { cap: "Very fair", line: "Always burns, never tans. Burns fast in strong sun." },
  II: { cap: "Fair", line: "Burns easily, tans a little." },
  III: { cap: "Medium", line: "Sometimes burns, tans slowly to light brown." },
  IV: { cap: "Olive", line: "Rarely burns, tans easily. Dark marks can follow strong sun." },
  V: { cap: "Brown", line: "Very rarely burns. Strong sun can leave dark marks that last months." },
  VI: { cap: "Deep", line: "Almost never burns. Sun still damages skin and can leave dark marks." },
};
export const FITZ_KEYS = ["I", "II", "III", "IV", "V", "VI"];

export function fitzScale(selected, name = "fitz") {
  return `<div class="fitz-row">${FITZ_KEYS.map(
    (k, i) =>
      `<label><input type="radio" name="${name}" value="${k}" ${k === selected ? "checked" : ""} aria-label="Sun type ${k}: ${FITZ[k].cap}"><span class="fitz-sw fz${i + 1}" aria-hidden="true">${k === selected ? icon("check") : k}</span><span class="f-cap" aria-hidden="true">${k === selected ? `Type ${k}` : FITZ[k].cap}</span></label>`
  ).join("")}</div>`;
}

/* ---------- burn clock ---------- */

/** The dial. The ring shows UV strength at the peak hour (out of 12). */
export function burnDial(burn, uvMax, { deep = false } = {}) {
  const u = Number(burn?.atUvi ?? uvMax);
  const lvl = uvLevel(u);
  const C = 2 * Math.PI * 66;
  const frac = Number.isFinite(u) ? Math.min(1, u / 12) : 0;
  let inner;
  if (!burn) {
    inner = `<span class="d-sub">${icon("sun")} UV ${Number.isFinite(u) ? Math.round(u) : "?"}</span><span class="d-big" style="font-size:1.5rem">${Number.isFinite(u) && u < 1 ? "Low sun" : "No estimate"}</span>`;
  } else if (deep) {
    inner = `<span class="d-lab">${icon("warn")} Dark-mark risk</span><span class="d-big" style="font-size:2rem">UV ${Math.round(u)}</span><span class="d-sub">${icon("clock")} peak ${esc(fmtHour(burn.atHour))}</span>`;
  } else {
    inner = `<span class="d-lab">${icon("warn")} May burn in</span><span class="d-big">${burn.minutesLow === burn.minutesHigh ? burn.minutesLow : `${burn.minutesLow}–${burn.minutesHigh}`}<span class="d-unit"> min</span></span><span class="d-sub">${icon("clock")} at ${esc(fmtHour(burn.atHour))}, UV ${Math.round(u)}</span>`;
  }
  return `<div class="dial" style="--uv-c: var(--uv-${lvl.key})">
    <svg viewBox="0 0 160 160" aria-hidden="true" focusable="false">
      <circle cx="80" cy="80" r="66" fill="none" class="d-track" stroke-width="14"/>
      <circle cx="80" cy="80" r="56" class="d-face"/>
      <circle cx="80" cy="80" r="66" fill="none" class="d-ring" stroke-width="14" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - frac)).toFixed(1)}"/>
    </svg>
    <div class="dial-in">${inner}</div>
  </div>`;
}

/* ---------- mini map ---------- */

const climateOf = (lat) => {
  const a = Math.abs(lat);
  if (a < 23.5) return { tag: "Tropical sun", ic: "sun", c1: "#1f8a9e", c2: "#e9a23b" };
  if (a < 40) return { tag: lat < 0 ? "Southern sun" : "Warm sun", ic: "sun", c1: "#2c6fa3", c2: "#7ec4cf" };
  return { tag: "Cool air", ic: "wind", c1: "#5b6c8f", c2: "#a9b8d6" };
};

/** A stylised postcard map: grid, latitude band and a pin. No map tiles are loaded. */
export function miniMap(leg, idx = 0) {
  const c = climateOf(Number(leg.lat));
  const id = `mm${idx}`;
  // Where the city sits on a 360×180 world, scaled into the card.
  const y = 70 - (Number(leg.lat) / 90) * 55;
  const lat = `${Math.abs(leg.lat).toFixed(1)}°${leg.lat >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(leg.lon).toFixed(1)}°${leg.lon >= 0 ? "E" : "W"}`;
  return `<div class="minimap" aria-hidden="true">
    <svg viewBox="0 0 320 112" preserveAspectRatio="xMidYMid slice">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.c1}"/><stop offset="1" stop-color="${c.c2}"/></linearGradient></defs>
      <rect width="320" height="112" fill="url(#${id})"/>
      <g stroke="rgba(255,255,255,.22)" stroke-width="1">${[40, 80, 120, 160, 200, 240, 280].map((x) => `<path d="M${x} 0V112"/>`).join("")}${[28, 56, 84].map((yy) => `<path d="M0 ${yy}H320"/>`).join("")}</g>
      <path d="M0 70H320" stroke="rgba(255,255,255,.55)" stroke-dasharray="4 5" stroke-width="1.5"/>
      <path d="M-10 ${y + 30}C60 ${y + 10} 90 ${y + 40} 150 ${y + 22}S260 ${y + 4} 330 ${y + 26}V130H-10Z" fill="rgba(255,255,255,.16)"/>
      <g transform="translate(200 ${Math.max(22, Math.min(88, y))})"><circle r="16" fill="rgba(255,255,255,.25)"/><path d="M0 -14C-7 -14 -11 -9 -11 -4C-11 4 0 12 0 12S11 4 11 -4C11 -9 7 -14 0 -14Z" fill="#fff"/><circle cy="-4" r="4" fill="${c.c1}"/></g>
    </svg>
    <span class="mm-coord">${lat} ${lon}</span>
    <span class="mm-tag">${icon(c.ic)} ${c.tag}</span>
  </div>`;
}

/** "12–25 minutes" or "10 minutes" when both ends match (albinism). */
export const minutesText = (b) => (b.minutesLow === b.minutesHigh ? `${b.minutesLow} minutes` : `${b.minutesLow}–${b.minutesHigh} minutes`);
