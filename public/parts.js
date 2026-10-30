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

/* ---------- second design: gauges and city photos ---------- */

const SCENES = { cairo: "cairo", dubai: "dubai", reykjavik: "reykjavik", "reykjavík": "reykjavik" };
export const SCENE_CREDIT = "AI-generated image (YouCam AI Image Generator)";

/** <img> for a city we have a photo for (demo cities), or "" otherwise. */
export function scenePhoto(city, { alt = "", eager = false } = {}) {
  const k = SCENES[String(city || "").trim().toLowerCase()];
  if (!k) return "";
  return `<img src="/scenes/${k}-800.webp" srcset="/scenes/${k}-800.webp 800w, /scenes/${k}-1600.webp 1600w" sizes="(min-width: 960px) 50vw, 100vw" alt="${esc(alt)}" ${eager ? "" : 'loading="lazy"'} width="800" height="446">`;
}
export const hasScene = (city) => !!SCENES[String(city || "").trim().toLowerCase()];

const arc = (cx, cy, r, a0, a1) => {
  const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
};

/** Semicircle score gauge (0–100): the big "72%" dial. */
export function scoreGauge(score, label = "Skin score") {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  const a0 = Math.PI;
  const a1 = Math.PI + (Math.PI * s) / 100;
  return `<div class="gauge" role="img" aria-label="${esc(label)}: ${Math.round(s)} out of 100">
    <svg viewBox="0 0 200 112" aria-hidden="true" focusable="false">
      <path class="g-track" d="${arc(100, 104, 86, Math.PI, 2 * Math.PI - 0.0001)}" stroke-width="14" fill="none" stroke-linecap="round"/>
      ${s > 0 ? `<path class="g-fill" d="${arc(100, 104, 86, a0, a1)}" stroke-width="14" fill="none" stroke-linecap="round"/>` : ""}
    </svg>
    <div class="g-in" aria-hidden="true"><div class="g-big">${Math.round(s)}<small>/100</small></div><div class="g-lab">${esc(label)}</div></div>
  </div>`;
}

/** Semicircle UV gauge with the WHO colour bands and a needle. */
export function uvGauge(uvi, { label } = {}) {
  const u = Number(uvi);
  const known = Number.isFinite(u);
  const max = 12;
  const at = (v) => Math.PI + (Math.PI * Math.min(v, max)) / max;
  const bands = [[0, 3, "low"], [3, 6, "mod"], [6, 8, "high"], [8, 11, "vhigh"], [11, 12, "ext"]];
  const lvl = uvLevel(u);
  const a = at(known ? u : 0);
  const nx = 100 + 80 * Math.cos(a);
  const ny = 104 + 80 * Math.sin(a);
  return `<div class="uvg" role="img" aria-label="UV index ${known ? Math.round(u) : "not known"}${known ? `, ${esc(lvl.name)}` : ""}">
    <svg viewBox="0 0 200 112" aria-hidden="true" focusable="false">
      ${bands.map(([f, t, k]) => `<path class="uv-${k}" style="stroke:var(--uv-${k})" d="${arc(100, 104, 80, at(f) + 0.02, at(t) - 0.02)}" stroke-width="12" fill="none" stroke-linecap="butt"/>`).join("")}
      ${known ? `<circle class="needle" cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="9"/>` : ""}
    </svg>
    <div class="uvg-in" aria-hidden="true"><div class="big big-l">${known ? Math.round(u) : "?"}<span class="u">UV</span></div><div class="uvg-lab">${esc(label || (known ? lvl.name : "Not known yet"))}</div></div>
  </div>`;
}

/** Icon for an advice id from src/rules.js. */
export const ADVICE_ICON = {
  "flight-dry": "plane", "humid-oily": "drop", "humid-dry-skin": "drop", "dry-air": "drop", cold: "thermo", wind: "wind",
  "wind-chill": "snow", "indoor-heating": "home", dust: "haze", "air-pollution": "haze", "extreme-heat": "thermo", "big-swing": "swing",
  "uv-moderate": "sun", "uv-high": "sun", "uv-very-fair": "shield", "uv-dark-marks": "shield", "sweat-water": "drop",
};

/** Soft, filled weather glyph for a day (sun, hot sun, haze, snow-cold, plane). Decorative. */
export function wxGlyph(day, size = 40) {
  const w = day?.wx || {};
  const id = `g${Math.random().toString(36).slice(2, 8)}`;
  const sun = (r = 11, cx = 20, cy = 20) => `<defs><radialGradient id="${id}" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="#ffe2a6"/><stop offset=".6" stop-color="#f4b860"/><stop offset="1" stop-color="#d9772b"/></radialGradient></defs><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id})"/>`;
  let inner;
  if (day?.kind === "flight") inner = `<circle cx="20" cy="20" r="17" fill="#f6dfe2"/><path d="M28 23.5 21.5 21l-2.5 7h-2.4l.8-7.6L12 18.6V16l5.4 1.6.8-7.6h2.4l2.5 7.5 6.4 2.4z" fill="#6b5f62"/>`;
  else if (w.tMax != null && w.tMax <= 8)
    inner = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfd8e0"/></linearGradient></defs><path d="M11 26a6 6 0 0 1 1-11.9A8 8 0 0 1 27.5 13 6.5 6.5 0 0 1 28 26z" fill="url(#${id})" stroke="#a9b6c2"/><g stroke="#7d93a8" stroke-width="1.6" stroke-linecap="round"><path d="M14 30v5M12 32.5h4M21 30v5M19 32.5h4M28 30v5M26 32.5h4"/></g>`;
  else if (w.dustMax >= 50 || w.pm25Max >= 35)
    inner = `${sun(9, 22, 15)}<g stroke="#c9a77f" stroke-width="2.4" stroke-linecap="round" opacity=".95"><path d="M6 24h22M10 29h24M6 34h18"/></g>`;
  else if (Number(w.uvMax) >= 3 || w.tMax >= 26) inner = `${sun(11)}<g stroke="#f4b860" stroke-width="2" stroke-linecap="round"><path d="M20 3v4M20 33v4M3 20h4M33 20h4M8 8l2.8 2.8M29.2 29.2 32 32M8 32l2.8-2.8M29.2 10.8 32 8"/></g>`;
  else inner = `${sun(8, 15, 15)}<path d="M13 31a6 6 0 0 1 1-11.9A8 8 0 0 1 29.5 18 6.5 6.5 0 0 1 30 31z" fill="#fbedee" stroke="#dcbfc5"/>`;
  return `<svg class="wxg" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true" focusable="false">${inner}</svg>`;
}

/** Soft product illustration by product type, for products with no photo. Decorative. */
export function productArt(p) {
  const t = (p?.tags || []).find((x) => x.startsWith("type-")) || "";
  const id = `pa${Math.random().toString(36).slice(2, 8)}`;
  const defs = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f3dde0"/><stop offset=".45" stop-color="#fff8f8"/><stop offset="1" stop-color="#ebd0d4"/></linearGradient><linearGradient id="${id}c" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3d3537"/><stop offset=".5" stop-color="#5a4e51"/><stop offset="1" stop-color="#1e1a1b"/></linearGradient></defs>`;
  const shadow = `<ellipse cx="60" cy="112" rx="34" ry="5" fill="#1e1a1b" opacity=".12"/>`;
  const body = `fill="url(#${id})" stroke="#e0c3c8" stroke-width="1"`;
  const cap = `fill="url(#${id}c)"`;
  const shapes = {
    "type-sunscreen": `<path d="M44 20h32l-3 82a4 4 0 0 1-4 4H51a4 4 0 0 1-4-4z" ${body}/><rect x="47" y="96" width="26" height="14" rx="3" ${cap}/><rect x="52" y="40" width="16" height="30" rx="2" fill="#d88a96" opacity=".55"/>`,
    "type-aftersun": `<path d="M44 20h32l-3 82a4 4 0 0 1-4 4H51a4 4 0 0 1-4-4z" ${body}/><rect x="47" y="96" width="26" height="14" rx="3" fill="#a9b79a"/><rect x="52" y="40" width="16" height="30" rx="2" fill="#a9b79a" opacity=".5"/>`,
    "type-moisturiser": `<rect x="30" y="64" width="60" height="44" rx="8" ${body}/><rect x="28" y="52" width="64" height="16" rx="5" ${cap}/><rect x="42" y="78" width="36" height="12" rx="2" fill="#d88a96" opacity=".5"/>`,
    "type-barrier": `<rect x="30" y="64" width="60" height="44" rx="8" ${body}/><rect x="28" y="52" width="64" height="16" rx="5" ${cap}/>`,
    "type-cleanser": `<rect x="40" y="44" width="40" height="64" rx="10" ${body}/><rect x="52" y="30" width="16" height="14" ${cap}/><path d="M60 30V20h18v6" stroke="#1e1a1b" stroke-width="5" fill="none" stroke-linecap="round"/><rect x="48" y="62" width="24" height="22" rx="2" fill="#d88a96" opacity=".5"/>`,
    "type-lip": `<rect x="50" y="46" width="20" height="62" rx="5" ${body}/><rect x="50" y="28" width="20" height="22" rx="4" ${cap}/>`,
    "type-mist": `<rect x="42" y="40" width="36" height="68" rx="12" ${body}/><rect x="50" y="26" width="20" height="16" rx="3" ${cap}/><g fill="#a3b5c4" opacity=".7"><circle cx="82" cy="24" r="2"/><circle cx="88" cy="18" r="1.6"/><circle cx="90" cy="28" r="1.6"/></g>`,
    "type-hat": `<ellipse cx="60" cy="86" rx="48" ry="12" fill="#d8bf9f" stroke="#b8996f"/><path d="M36 84c0-22 10-38 24-38s24 16 24 38c-8 4-40 4-48 0z" fill="#e7d3b8" stroke="#b8996f"/><path d="M37 78c14 4 32 4 46 0" stroke="#1e1a1b" stroke-width="5"/>`,
    "type-sunglasses": `<g fill="#1e1a1b"><rect x="18" y="56" width="36" height="26" rx="12"/><rect x="66" y="56" width="36" height="26" rx="12"/></g><path d="M54 64q6-6 12 0" stroke="#1e1a1b" stroke-width="4" fill="none"/><path d="M24 62l6-4M72 62l6-4" stroke="#fff" stroke-opacity=".3" stroke-width="3"/>`,
    "type-sleeves": `<path d="M36 28h22l4 80H32z" ${body}/><path d="M62 28h22l4 80H58z" ${body}/>`,
    "type-blotting": `<rect x="34" y="38" width="52" height="66" rx="6" ${body}/><rect x="40" y="30" width="40" height="10" rx="3" ${cap}/>`,
  };
  return `<svg class="pa" viewBox="0 0 120 120" aria-hidden="true" focusable="false">${defs}${shadow}${shapes[t] || shapes["type-sunscreen"]}</svg>`;
}
