// App shell: skip link, top bar (Aa, Read aloud, My data), display panel,
// bottom nav, the demo "Next" ribbon, footer, plus small DOM helpers and icons.
import { applyPrefs, setPref, prefs, lowVisionOn, speak, stopSpeaking, speechSupported, onSpeech, isSpeaking, focusHeading, announce } from "./a11y.js";
import { load } from "./state.js";
import { LOCAL_PHOTOS } from "./product-photos.js";

/* ---------- helpers ---------- */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export function on(el, type, sel, fn) {
  el.addEventListener(type, (e) => {
    const t = e.target.closest(sel);
    if (t && el.contains(t)) fn(e, t);
  });
}

const LONG = { weekday: "long", day: "numeric", month: "long" };
const SHORT = { day: "numeric", month: "short" };
const asDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
};
export const fmtDate = (iso, opts = SHORT) => (iso ? asDate(iso).toLocaleDateString("en-GB", opts) : "");
export const fmtLong = (iso) => fmtDate(iso, LONG);
export const fmtWeekday = (iso) => fmtDate(iso, { weekday: "short" });
export function fmtHour(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return "";
  const hh = Math.floor(n);
  const mm = Math.round((n - hh) * 60);
  const ap = hh >= 12 ? "pm" : "am";
  const h12 = hh % 12 || 12;
  return mm ? `${h12}:${String(mm).padStart(2, "0")} ${ap}` : `${h12} ${ap}`;
}
/** "10:30" or 10.5 → "10:30 am" */
export const fmtClock = (v) => (typeof v === "string" && v.includes(":") ? fmtHour(Number(v.split(":")[0]) + Number(v.split(":")[1]) / 60) : fmtHour(v));

export const daysBetween = (a, b) => Math.round((asDate(b) - asDate(a)) / 86400000);

/** UV level name, class and description (WHO bands). */
export function uvLevel(uvi) {
  const u = Number(uvi);
  if (!Number.isFinite(u)) return { key: "na", name: "Not known", short: "?" };
  if (u < 3) return { key: "low", name: "Low", short: "Low" };
  if (u < 6) return { key: "mod", name: "Moderate", short: "Moderate" };
  if (u < 8) return { key: "high", name: "High", short: "High" };
  if (u < 11) return { key: "vhigh", name: "Very high", short: "Very high" };
  return { key: "ext", name: "Extreme", short: "Extreme" };
}
export const uvText = (uvi) => (Number.isFinite(Number(uvi)) ? `${Math.round(uvi)} ${uvLevel(uvi).name}` : "Not known yet");

/* ---------- icons (24×24, stroked, aria-hidden) ---------- */

const P = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  sunrise: '<path d="M17 18a5 5 0 0 0-10 0"/><path d="M12 2v7M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1M8 6l4-4 4 4"/>',
  drop: '<path d="M12 2.7s6 6.6 6 11.3a6 6 0 0 1-12 0c0-4.7 6-11.3 6-11.3z"/>',
  thermo: '<path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/>',
  wind: '<path d="M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  speaker: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  play: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  timer: '<path d="M10 2h4M12 14l3-3"/><circle cx="12" cy="14" r="8"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  shieldCheck: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  plusCircle: '<circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12A9 9 0 0 1 18.5 5.8L21 8M21 3v5h-5M3 21v-5h5"/>',
  luggage: '<rect x="6" y="6" width="12" height="15" rx="2"/><path d="M9 6V3h6v3M10 10v7M14 10v7M8 21v1M16 21v1"/>',
  kit: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M12 11v6M9 14h6"/>',
  routine: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  glasses: '<circle cx="6" cy="15" r="4"/><circle cx="18" cy="15" r="4"/><path d="M10 15a2 2 0 0 1 4 0M2.5 13 5 7M21.5 13 19 7"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  face: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M17 4l1-2M20 7l2-1"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/>',
  sparkle: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/>',
  hat: '<path d="M2 17c0 1.7 4.5 3 10 3s10-1.3 10-3-2-2.5-4-2.8"/><path d="M6 14.2C6 9 8.5 6 12 6s6 3 6 8.2c-1.5.5-3.6.8-6 .8s-4.5-.3-6-.8z"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
  lock: '<rect x="4" y="11" width="16" height="11" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z"/>',
  bottle: '<path d="M9 2h6v3l2 3v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8l2-3z"/><path d="M7 12h10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  snow: '<path d="M12 2v20M4.9 7l14.2 10M4.9 17 19.1 7M9 4l3 2 3-2M9 20l3-2 3 2"/>',
  haze: '<path d="M3 8h12M3 12h18M3 16h14M7 20h12M17 6a3 3 0 0 1 3 3"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  swing: '<path d="M7 4v16M7 4 4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3"/>',
  vibrate: '<rect x="7" y="4" width="10" height="16" rx="2"/><path d="M3 8v8M21 8v8"/>',
};
export const icon = (name, cls = "") =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ""}</svg>`;

/** The Parasol mark: a parasol canopy over a handle. */
export const mark = (size = 40) =>
  `<svg class="mark" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true" focusable="false"><rect width="64" height="64" rx="32" fill="var(--mark-bg)"/><path d="M10 32C10 19.8 19.8 11 32 11s22 8.8 22 21c-3.2-2.6-6.6-2.6-9.6 0-3.2-2.6-6.8-2.6-10 0h-.8c-3.2-2.6-6.8-2.6-10 0-3-2.6-6.4-2.6-9.6 0z" fill="var(--mark-fg)"/><path d="M32 32v15a5 5 0 0 1-10 0" fill="none" stroke="var(--mark-ink)" stroke-width="4" stroke-linecap="round"/><path d="M32 11V7" stroke="var(--mark-ink)" stroke-width="4" stroke-linecap="round"/></svg>`;

/* ---------- shell ---------- */

const NAV = [
  ["forecast", "/forecast", "Forecast", "sunrise"],
  ["today", "/today", "Routine", "routine"],
  ["trip", "/trip", "Trip", "luggage"],
  ["kit", "/kit", "Kit", "kit"],
];

// The judge path. Each step names the page it lives on and where "Next" goes.
const DEMO_STEPS = [
  { page: "scan", label: "Your skin result", next: "/trip", nextLabel: "Your trip" },
  { page: "trip", label: "Your trip", next: "/forecast", nextLabel: "Your skin forecast" },
  { page: "forecast", label: "Skin forecast", next: "/kit", nextLabel: "Build my trip kit" },
  { page: "kit", label: "Trip kit and checkout", next: "/rescan?demo=1", nextLabel: "Day 3 in Dubai: rescan" },
  { page: "rescan", label: "Day 3 rescan", next: "/today", nextLabel: "Today and the sun timer" },
  { page: "today", label: "Today", next: "/data", nextLabel: "My data (end of demo)" },
];

let speechTextFn = () => document.querySelector("main")?.innerText || "";

export function shell({ page, speechText } = {}) {
  applyPrefs();
  if (speechText) speechTextFn = speechText;
  document.body.dataset.page = page || "";

  const skip = document.createElement("a");
  skip.className = "skip";
  skip.href = "#main";
  skip.textContent = "Skip to content";

  const header = document.createElement("header");
  header.className = "topbar";
  header.innerHTML = `
    <a class="brand" href="/" aria-label="Parasol home">${mark(40)}<span class="brand-txt"><span class="brand-name">Parasol</span><span class="brand-sub">Your skin, on the road</span></span></a>
    <nav class="topnav" aria-label="Main">${navLinks(page)}</nav>
    <div class="tb-actions" role="group" aria-label="Reading and display">
      <button type="button" class="icon-btn aa" id="btn-aa" aria-expanded="false" aria-controls="display-panel"><span aria-hidden="true">Aa</span><span class="sr-only">Display and low-vision settings</span></button>
      <button type="button" class="icon-btn speak" id="btn-speak" aria-pressed="false">${icon("speaker", "i-on")}${icon("stop", "i-off")}<span class="sr-only" id="speak-label">Read this page aloud</span></button>
      <a class="icon-btn data" href="/data" ${page === "data" ? 'aria-current="page"' : ""}>${icon("user")}<span class="sr-only">My data</span></a>
    </div>`;
  document.body.prepend(header);
  document.body.prepend(skip);

  const panel = document.createElement("section");
  panel.className = "display-panel";
  panel.id = "display-panel";
  panel.hidden = true;
  panel.setAttribute("aria-labelledby", "dp-title");
  panel.innerHTML = displayPanel();
  header.after(panel);

  const live = document.createElement("div");
  live.id = "live";
  live.className = "sr-only";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("role", "status");
  document.body.append(live);

  const main = document.querySelector("main");
  main.id = "main";
  main.tabIndex = -1;

  const foot = document.createElement("footer");
  foot.className = "foot";
  foot.innerHTML = `<p>Not medical advice. Burn times are estimates.</p><p>Demo shop. Not affiliated with these brands.</p><p class="foot-links"><a href="/data">My data and privacy</a> · Weather by <a href="https://open-meteo.com/" rel="noopener">Open-Meteo</a> · Skin analysis by YouCam (Perfect Corp.)</p>`;
  main.after(foot);

  if (page && page !== "home") {
    const nav = document.createElement("nav");
    nav.className = "bottom-nav";
    nav.setAttribute("aria-label", "Sections");
    nav.innerHTML = navLinks(page);
    document.body.append(nav);
    document.body.classList.add("has-bottom-nav");
  }

  ribbon(page);
  wireDisplay(header, panel);
  wireSpeech();
  document.addEventListener("parasol:prefs", () => syncPanel(panel));
  syncPanel(panel);

  // Focus the h1 so screen readers start at the page title (not on first paint with a mouse).
  requestAnimationFrame(() => focusHeading());
}

function navLinks(page) {
  return NAV.map(([id, href, label, ic]) => `<a href="${href}" class="nav-${id}" ${page === id ? 'aria-current="page"' : ""}>${icon(ic)}<span>${label}</span></a>`).join("");
}

function ribbon(page) {
  const demo = load().demo;
  if (!demo || page === "home") return;
  const i = DEMO_STEPS.findIndex((s) => s.page === page);
  const r = document.createElement("nav");
  r.className = "ribbon";
  r.setAttribute("aria-label", "Demo guide");
  if (page === "data") {
    r.innerHTML = `<span class="rb-step">Demo · finished</span><a class="rb-next" href="/#demo">Try the other traveller ${icon("arrow")}</a>`;
  } else if (i < 0) {
    r.innerHTML = `<span class="rb-step">Demo · with ${esc(cap(demo))}</span><a class="rb-next" href="/scan?demo=${esc(demo)}">Back to the demo ${icon("arrow")}</a>`;
  } else {
    const s = DEMO_STEPS[i];
    r.innerHTML = `<span class="rb-step">Demo · step ${i + 1} of ${DEMO_STEPS.length}<span class="rb-label">· ${esc(s.label)}</span></span><a class="rb-next" href="${s.next}">Next: ${esc(s.nextLabel)} ${icon("arrow")}</a>`;
  }
  document.querySelector("main").before(r);
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Lets a page change where the ribbon's Next link points (for example once data is ready). */
export function setRibbonNext(href, label) {
  const a = document.querySelector(".ribbon .rb-next");
  if (!a) return;
  a.href = href;
  if (label) a.innerHTML = `Next: ${esc(label)} ${icon("arrow")}`;
}

function displayPanel() {
  const sup = speechSupported();
  return `
  <div class="dp-inner">
    <div class="dp-head"><h2 id="dp-title">Display and reading</h2><button type="button" class="icon-btn" id="dp-close">${icon("close")}<span class="sr-only">Close display settings</span></button></div>
    <label class="switch-row big"><span><strong>Low-vision mode</strong><span class="muted block">Larger text, stronger contrast, bigger buttons.</span></span><input type="checkbox" role="switch" id="dp-lv" class="switch"></label>
    <div class="field"><label for="dp-scale">Text size <output id="dp-scale-out" for="dp-scale">100%</output></label><input type="range" id="dp-scale" min="100" max="200" step="10" value="100"></div>
    <fieldset class="seg"><legend>Theme</legend>
      <label><input type="radio" name="dp-theme" value="auto"><span>Auto</span></label>
      <label><input type="radio" name="dp-theme" value="light"><span>Light</span></label>
      <label><input type="radio" name="dp-theme" value="dark-gentle"><span>Gentle dark</span></label>
    </fieldset>
    ${
      sup
        ? `<div class="field"><label for="dp-rate">Reading speed <output id="dp-rate-out" for="dp-rate">1×</output></label><input type="range" id="dp-rate" min="0.6" max="1.4" step="0.1" value="1"></div>`
        : `<p class="note">Read aloud isn't available in this browser.</p>`
    }
  </div>`;
}

function syncPanel(panel) {
  const p = prefs();
  const lv = panel.querySelector("#dp-lv");
  lv.checked = lowVisionOn();
  const sc = Math.round((Number(p.textScale) || 1) * 100);
  panel.querySelector("#dp-scale").value = sc;
  panel.querySelector("#dp-scale-out").textContent = `${sc}%`;
  panel.querySelectorAll('[name="dp-theme"]').forEach((r) => (r.checked = r.value === (p.themeChosen ? p.theme || "light" : "light")));
  const rate = panel.querySelector("#dp-rate");
  if (rate) {
    rate.value = p.speechRate || 1;
    panel.querySelector("#dp-rate-out").textContent = `${Number(p.speechRate || 1).toFixed(1)}×`;
  }
  document.getElementById("btn-aa")?.classList.toggle("on", lowVisionOn());
}

function wireDisplay(header, panel) {
  const btn = header.querySelector("#btn-aa");
  const open = (yes) => {
    panel.hidden = !yes;
    btn.setAttribute("aria-expanded", String(yes));
    if (yes) panel.querySelector("#dp-lv").focus();
  };
  btn.addEventListener("click", () => open(panel.hidden));
  panel.querySelector("#dp-close").addEventListener("click", () => {
    open(false);
    btn.focus();
  });
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      open(false);
      btn.focus();
    }
  });
  panel.querySelector("#dp-lv").addEventListener("change", (e) => {
    setPref("lowVision", e.target.checked);
    announce(e.target.checked ? "Low-vision mode on." : "Low-vision mode off.");
  });
  panel.querySelector("#dp-scale").addEventListener("input", (e) => setPref("textScale", Number(e.target.value) / 100));
  panel.querySelectorAll('[name="dp-theme"]').forEach((r) =>
    r.addEventListener("change", () => {
      setPref("theme", r.value); setPref("themeChosen", true);
      announce(`Theme: ${r.parentElement.textContent.trim()}.`);
    })
  );
  panel.querySelector("#dp-rate")?.addEventListener("input", (e) => setPref("speechRate", Number(e.target.value)));
}

function wireSpeech() {
  const btn = document.getElementById("btn-speak");
  if (!speechSupported()) {
    btn.hidden = true;
    return;
  }
  const label = document.getElementById("speak-label");
  onSpeech((on) => {
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("on", on);
    label.textContent = on ? "Stop reading" : "Read this page aloud";
  });
  btn.addEventListener("click", () => {
    if (isSpeaking()) return stopSpeaking();
    speak(speechTextFn());
  });
  window.addEventListener("pagehide", stopSpeaking);
}

/** Read a given text now (used by page buttons like "Read the morning briefing"). */
export const readAloud = (text) => (isSpeaking() ? stopSpeaking() : speak(text));

/* ---------- reusable bits ---------- */

export function errorBox(err, { retry, demo } = {}) {
  const tip = err?.data?.tip ? `<p>${esc(err.data.tip)}</p>` : "";
  return `<div class="alert" role="alert">${icon("warn")}<div><p><strong>${esc(err?.message || "Something went wrong.")}</strong></p>${tip}${
    retry || demo ? `<p class="row gap">${retry ? `<button type="button" class="btn btn-secondary" data-retry>Try again</button>` : ""}${demo ? `<a class="btn btn-secondary" href="/#demo">Try the demo instead</a>` : ""}</p>` : ""
  }</div></div>`;
}

export const loading = (text = "Loading…") => `<div class="loading" role="status">${icon("sun", "spin")}<span>${esc(text)}</span></div>`;

/**
 * Photo sources for a product, best first: our own copy in /products/<handle>.webp
 * (credited in THIRD_PARTY_NOTICES.md), then the shop's featured image.
 * Returns { src, fallback } or null when there is no photo at all.
 */
export function productPhoto(p) {
  const local = p?.handle && LOCAL_PHOTOS.has(p.handle) ? `/products/${p.handle}.webp` : null;
  const src = local || p?.image || null;
  if (!src) return null;
  return { src, fallback: local && p?.image && p.image !== local ? p.image : null };
}

/** `<img>` markup for a product photo with the drawn/icon stand-in kept in a <template> as the last fallback. */
export function photoImg(p, stand, attrs = "") {
  const ph = productPhoto(p);
  if (!ph) return stand;
  return `<span class="thumb-wrap"><img class="thumb" src="${esc(ph.src)}"${ph.fallback ? ` data-fallback="${esc(ph.fallback)}"` : ""} alt="${esc(p.title || p.imageAlt || "")}" loading="lazy" ${attrs}><template>${stand}</template></span>`;
}

/** Product image or a neutral icon per product type. */
export function productThumb(p) {
  const t = (p?.tags || []).find((x) => x.startsWith("type-")) || "";
  const ic = { "type-hat": "hat", "type-sunglasses": "glasses", "type-sleeves": "shield", "type-mist": "drop", "type-lip": "heart" }[t] || "bottle";
  const fallback = `<span class="thumb thumb-ic" aria-hidden="true">${icon(ic)}</span>`;
  return photoImg(p, fallback, `width="72" height="72"`);
}

// A product photo that can't load (offline, blocked) tries the next source,
// then becomes the drawn stand-in or neutral icon.
document.addEventListener(
  "error",
  (e) => {
    const img = e.target;
    if (img?.classList?.contains("thumb") && img.dataset?.fallback) {
      img.src = img.dataset.fallback;
      delete img.dataset.fallback;
    } else if (img?.classList?.contains("thumb") && img.nextElementSibling?.tagName === "TEMPLATE") img.parentElement.replaceWith(img.nextElementSibling.content.cloneNode(true));
    else if (img?.tagName === "IMG" && img.closest(".r-thumb")) img.remove();
  },
  true
);

export const money = (amount, currency = "USD") => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-GB", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
};

/** ARIA tabs: click or arrow keys switch panels; only the active tab is in the tab order. */
export function wireTabs(list) {
  if (!list) return;
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const select = (t, focus) => {
    tabs.forEach((x) => {
      const on = x === t;
      x.setAttribute("aria-selected", String(on));
      x.tabIndex = on ? 0 : -1;
      const pan = document.getElementById(x.getAttribute("aria-controls"));
      if (pan) pan.hidden = !on;
    });
    if (focus) t.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", (e) => {
      const k = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: tabs.length - 1 - i }[e.key];
      if (k === undefined) return;
      e.preventDefault();
      select(tabs[(i + k + tabs.length) % tabs.length], true);
    });
  });
}
