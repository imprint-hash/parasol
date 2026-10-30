// What this browser remembers lives here (localStorage key "parasol.v1").
// The server keeps no profile or trip; it caches only skin scores (never the
// photo) keyed by the photo's hash, for up to 30 days, deletable via My data.

const KEY = "parasol.v1";
const MAX_SCANS = 10;

const fresh = () => ({
  prefs: { lowVision: null, theme: "light", textScale: 1, speechRate: 1 },
  scans: [],
  profile: null,
  trip: null,
  timer: null,
  forecast: null, // last /api/forecast answer, so pages can show it again
  kit: null, // last /api/kit answer plus the user's choices
  demo: null, // "ada" | "sam" while the guided demo is running
  routine: {}, // { "YYYY-MM-DD": ["am-cleanse", …] }
  rescan: null, // last rescan result
});

let memo = null;

export function load() {
  if (memo) return memo;
  let s = null;
  try {
    s = JSON.parse(localStorage.getItem(KEY));
  } catch {}
  const base = fresh();
  memo = s && typeof s === "object" ? { ...base, ...s, prefs: { ...base.prefs, ...(s.prefs || {}) } } : base;
  if (!Array.isArray(memo.scans)) memo.scans = [];
  return memo;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(load()));
  } catch {
    // Storage full or blocked (private mode): the app still works for this visit.
  }
}

export const get = (k) => load()[k];

export function set(k, v) {
  load()[k] = v;
  save();
  return v;
}

export function update(fn) {
  const s = load();
  fn(s);
  save();
  return s;
}

export function clearAll() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  memo = null;
}

/* ---------- scans and profile ---------- */

export function addScan(scan) {
  update((s) => {
    s.scans = [scan, ...s.scans.filter((x) => x.id !== scan.id)].slice(0, MAX_SCANS);
  });
  return scan;
}

export const latestScan = (kind) => load().scans.find((x) => !kind || x.kind === kind) || null;

/** Profile the forecast/kit/rescan routes expect (PLAN section 4). */
export function profileFromScan(scan, { fitz, albinism = false } = {}) {
  const sk = scan.skin || {};
  const p = {
    skinType: sk.type || "normal",
    concerns: (scan.concerns || []).map((c) => c.metric),
    fitz: albinism ? "I" : fitz || scan.fitz?.scale || "III",
    albinism: !!albinism,
  };
  if (sk.tZone) p.tZone = sk.tZone;
  if (sk.uZone) p.uZone = sk.uZone;
  if (sk.scores) p.scores = { ...sk.scores };
  if (scan.tone?.hex) p.toneHex = scan.tone.hex;
  return p;
}

/* ---------- dates ---------- */

const pad = (n) => String(n).padStart(2, "0");
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + n));
}
export const today = () => isoDate(new Date());

/** Today's date in a city's time zone, as YYYY-MM-DD. */
export function todayIn(timezone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return today();
  }
}

/* ---------- the demo ---------- */

export const PERSONAS = {
  ada: {
    id: "ada",
    name: "Ada",
    line: "Very deep skin. Strong sun can leave dark marks.",
    fitz: "V",
    albinism: false,
  },
  sam: {
    id: "sam",
    name: "Sam",
    line: "Very fair skin with albinism. Burns fast.",
    fitz: "I",
    albinism: true,
  },
};

export const CITIES = {
  cairo: { name: "Cairo", admin1: "Cairo", country: "Egypt", lat: 30.0626, lon: 31.2497, timezone: "Africa/Cairo" },
  dubai: { name: "Dubai", admin1: "Dubai", country: "United Arab Emirates", lat: 25.0772, lon: 55.3093, timezone: "Asia/Dubai" },
  reykjavik: { name: "Reykjavik", admin1: "Capital Region", country: "Iceland", lat: 64.1355, lon: -21.8954, timezone: "Atlantic/Reykjavik" },
};

/** The demo city that gets the "Day 3" rescan and the Today preview. */
export const DEMO_RESCAN_CITY = "Dubai";
export const DEMO_TRIP_LABEL = "Cairo → Dubai → Reykjavik";

/** Cairo → Dubai → Reykjavik, starting tomorrow, about 3 days each, with the two flights. */
export function demoTrip() {
  const d1 = addDays(today(), 1);
  const leg = (c, from, to) => ({ name: c.name, country: c.country, lat: c.lat, lon: c.lon, timezone: c.timezone, from, to });
  return {
    legs: [
      leg(CITIES.cairo, d1, addDays(d1, 2)),
      leg(CITIES.dubai, addDays(d1, 3), addDays(d1, 5)),
      leg(CITIES.reykjavik, addDays(d1, 6), addDays(d1, 8)),
    ],
    flights: [
      { date: addDays(d1, 3), hours: 3.5, from: "Cairo", to: "Dubai" },
      { date: addDays(d1, 6), hours: 7, from: "Dubai", to: "Reykjavik" },
    ],
    carryOn: true,
  };
}

/** The trip in the exact shape /api/forecast accepts (drops UI-only fields). */
export function tripForApi(trip) {
  return {
    legs: trip.legs.map(({ name, lat, lon, timezone, from, to }) => ({ name, lat, lon, timezone, from, to })),
    flights: (trip.flights || []).filter((f) => f.date && f.hours).map(({ date, hours }) => ({ date, hours: Number(hours) })),
    carryOn: trip.carryOn !== false,
  };
}

/** The profile in the exact shape the API accepts (drops UI-only fields). */
export function profileForApi(p) {
  const { fitzFromScan, ...rest } = p || {};
  return rest;
}
