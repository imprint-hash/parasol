/**
 * Weather, days, forecast and the trip routes, offline: fetch to Open-Meteo is
 * stubbed (test/helpers/meteo-stub.js). Includes the trip/profile/places
 * items from the attack list (PLAN.md section 11, item 4).
 */
import "./helpers/env.js";
import { stubMeteo, defaultHandler, hourly } from "./helpers/meteo-stub.js";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startApp } from "./helpers/env.js";
import { forgetWeather, geocode, snapshotFor, stats as wxStats } from "../src/weather.js";
import { tripDays, splitHourly, summarise, lastYear, isDate, addDays } from "../src/days.js";
import { buildForecast, horizonFrom } from "../src/forecast.js";
import { validateTrip, validateProfile } from "../src/validate.js";
import { forgetHits } from "../src/budget.js";

const TODAY = new Date().toISOString().slice(0, 10);
const d = (n) => addDays(TODAY, n);
const LAGOS = { name: "Lagos", lat: 6.4541, lon: 3.3947, timezone: "Africa/Lagos" };
const LONDON = { name: "London", lat: 51.5085, lon: -0.1257, timezone: "Europe/London" };
const ADA = { skinType: "combination", fitz: "VI", concerns: [] };
const SAM = { skinType: "normal", fitz: "II", albinism: true };

let app, stub;
before(async () => (app = await startApp()));
after(async () => {
  stub?.restore();
  await app.close();
});
beforeEach(() => {
  stub?.restore();
  forgetWeather();
  forgetHits();
});

/* ---------- days.js ---------- */

test("dates: isDate, lastYear (29 Feb → 28 Feb)", () => {
  assert.ok(isDate("2028-02-29"));
  assert.ok(!isDate("2027-02-29"));
  assert.ok(!isDate("2026-13-01"));
  assert.ok(!isDate("26-11-01"));
  assert.equal(lastYear("2028-02-29"), "2027-02-28");
  assert.equal(lastYear("2027-01-05"), "2026-01-05");
});

test("tripDays: one per date; a changeover day goes to the arriving city; flights attached", () => {
  const days = tripDays({ legs: [{ ...LONDON, from: "2026-11-01", to: "2026-11-02" }, { ...LAGOS, from: "2026-11-02", to: "2026-11-04" }], flights: [{ date: "2026-11-02", hours: 6.5 }] });
  assert.deepEqual(days.map((x) => [x.date, x.leg, x.flight?.hours ?? null]), [["2026-11-01", 0, null], ["2026-11-02", 1, 6.5], ["2026-11-03", 1, null], ["2026-11-04", 1, null]]);
});

test("summarise: daytime 08–20 for rh and tMax, whole day for tMin and wind", () => {
  const h = splitHourly(hourly("2026-11-02", 1, () => ({ uvPeak: 9, tMin: 20, tMax: 32, rh: 84, wind: 31 })));
  const { wx, hourly: hrs } = summarise(h.get("2026-11-02"), { pm25: 41, flightHours: 5 });
  assert.equal(wx.uvMax, 9);
  assert.equal(wx.uvPeakHour, 13);
  assert.equal(wx.rhMean, 84);
  assert.equal(wx.tMin, 20);
  assert.equal(wx.windMax, 31);
  assert.equal(wx.pm25Max, 41);
  assert.equal(wx.flightHours, 5);
  assert.deepEqual(wx.cabinRh, [10, 20]);
  assert.ok(hrs.every((x) => x.h >= 6 && x.h <= 21));
});

test("summarise: no UV series gives uvMax null", () => {
  const h = splitHourly(hourly("2026-11-02", 1, () => ({ uvPeak: null })));
  assert.equal(summarise(h.get("2026-11-02")).wx.uvMax, null);
});

/* ---------- forecast.js ---------- */

test("forecast within 16 days uses the forecast API; later days use last year's dates", async () => {
  stub = stubMeteo(defaultHandler());
  const trip = validateTrip({ legs: [{ ...LAGOS, from: d(10), to: d(20) }] });
  const f = await buildForecast(validateProfile(ADA), trip);
  assert.equal(f.horizon, horizonFrom());
  assert.equal(f.days.length, 11);
  for (const day of f.days) assert.equal(day.kind, day.date <= f.horizon ? "forecast" : "typical", day.date);
  const hist = stub.calls.filter((u) => u.hostname.startsWith("historical"));
  assert.equal(hist.length, 1);
  assert.equal(hist[0].searchParams.get("start_date"), lastYear(addDays(f.horizon, 1)));
  assert.equal(hist[0].searchParams.get("end_date"), lastYear(d(20)));
  assert.equal(f.days.find((x) => x.kind === "typical").label, "Typical (last year)");
  assert.equal(f.sources[0].name, "Open-Meteo");
});

test("forecast: a trip far ahead only calls the historical API, and asks for the timezone", async () => {
  stub = stubMeteo(defaultHandler());
  const trip = validateTrip({ legs: [{ ...LAGOS, from: d(200), to: d(203) }] });
  const f = await buildForecast(validateProfile(ADA), trip);
  assert.ok(f.days.every((x) => x.kind === "typical"));
  assert.deepEqual([...new Set(stub.calls.map((u) => u.hostname.split(".")[0]))], ["historical-forecast-api"]);
  assert.equal(stub.calls[0].searchParams.get("timezone"), "Africa/Lagos");
});

test("typical days without UV: burn clock off, UV unknown line", async () => {
  stub = stubMeteo(defaultHandler({ day: () => ({ uvPeak: null }) }));
  const trip = validateTrip({ legs: [{ ...LAGOS, from: d(200), to: d(201) }] });
  const f = await buildForecast(validateProfile(SAM), trip);
  for (const day of f.days) {
    assert.equal(day.burn, null);
    assert.equal(day.protect, null);
    assert.match(day.headline, /UV not known yet/);
  }
});

test("Ada in humid Lagos: dark marks first, no white cast in the needs, minutes only as detail", async () => {
  stub = stubMeteo(defaultHandler({ day: () => ({ uvPeak: 11, rh: 84, tMax: 31 }) }));
  const f = await buildForecast(validateProfile(ADA), validateTrip({ legs: [{ ...LAGOS, from: d(1), to: d(3) }], flights: [{ date: d(1), hours: 6.5 }] }));
  assert.equal(f.days[0].kind, "flight");
  assert.equal(f.days[0].advice[0].id, "uv-dark-marks");
  assert.ok(f.days.every((x) => x.darkMarks));
  assert.equal(f.days[1].burn.detailOnly, true);
  for (const t of ["no-white-cast", "tinted", "humid", "matte", "flight", "mist"]) assert.ok(f.needs.includes(t), t);
  assert.ok(f.days[1].wx.pm25Max !== undefined);
});

test("Sam with albinism: burn clock 'maybe faster' and conservative protect hours", async () => {
  stub = stubMeteo(defaultHandler({ day: () => ({ uvPeak: 8 }) }));
  const f = await buildForecast(validateProfile(SAM), validateTrip({ legs: [{ ...LAGOS, from: d(1), to: d(1) }] }));
  const day = f.days[0];
  assert.equal(day.burn.minutesLow, day.burn.minutesHigh);
  assert.equal(day.burn.fasterPossible, true);
  assert.equal(day.protect.conservative, true);
  assert.match(day.headline, /maybe faster/);
});

test("Open-Meteo down: a demo city falls back to the saved snapshot, labelled", async () => {
  stub = stubMeteo(() => {
    throw { status: 503 };
  });
  const f = await buildForecast(validateProfile(ADA), validateTrip({ legs: [{ ...LAGOS, from: d(1), to: d(9) }] }));
  assert.equal(f.days.length, 9);
  assert.ok(f.days.every((x) => x.basis === "snapshot" && x.label === "Saved snapshot"));
  assert.ok(f.days.every((x) => x.wx.uvMax !== null));
  assert.ok(f.sources.some((s) => s.name === "Saved snapshot"));
});

test("Open-Meteo down and no snapshot: 502 weather_down from the route", async () => {
  stub = stubMeteo(() => {
    throw { network: true };
  });
  const r = await app.call("POST", "/api/forecast", { profile: ADA, trip: { legs: [{ name: "Reykjavik", lat: 64.1, lon: -21.9, timezone: "Atlantic/Reykjavik", from: d(1), to: d(2) }] } });
  assert.equal(r.status, 502);
  assert.equal(r.body.code, "weather_down");
});

test("snapshotFor re-dates the saved days and cycles them", () => {
  const s = snapshotFor(LAGOS, "2030-01-01", "2030-01-10");
  assert.equal(s.hourly.time[0], "2030-01-01T00:00");
  assert.equal(s.hourly.time.length, 240);
  assert.equal(snapshotFor({ lat: 0, lon: 0 }, "2030-01-01", "2030-01-02"), null);
});

test("weather answers are cached: a second forecast makes no new calls", async () => {
  stub = stubMeteo(defaultHandler());
  const trip = validateTrip({ legs: [{ ...LONDON, from: d(1), to: d(3) }] });
  await buildForecast(validateProfile(ADA), trip);
  const n = stub.calls.length;
  await buildForecast(validateProfile(SAM), trip);
  assert.equal(stub.calls.length, n);
  assert.ok(wxStats.cacheHits > 0);
});

/* ---------- routes ---------- */

test("POST /api/forecast returns the section-4 shape", async () => {
  stub = stubMeteo(defaultHandler());
  const r = await app.call("POST", "/api/forecast", { profile: ADA, trip: { legs: [{ ...LONDON, from: d(1), to: d(2) }, { ...LAGOS, from: d(2), to: d(5) }], flights: [{ date: d(2), hours: 6.5 }], carryOn: true } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body).sort(), ["days", "generatedAt", "horizon", "needs", "sources"]);
  const day = r.body.days[1];
  for (const k of ["date", "city", "timezone", "kind", "wx", "headline", "advice", "burn", "protect", "darkMarks", "hourly"]) assert.ok(k in day, k);
  for (const k of ["uvMax", "uvPeakHour", "rhMean", "tMin", "tMax", "windMax", "pm25Max"]) assert.ok(k in day.wx, k);
  assert.equal(day.city, "Lagos");
  assert.equal(day.kind, "flight");
});

test("GET /api/places: geocoding results trimmed to the section-4 shape", async () => {
  stub = stubMeteo(defaultHandler({
    geocode: (u) => ({ results: [{ id: 1, name: "Lagos", admin1: "Lagos", country: "Nigeria", latitude: 6.45407, longitude: 3.39467, timezone: "Africa/Lagos", population: 9000000 }, { id: 2, name: "Nowhere", latitude: 1, longitude: 1 }] }),
  }));
  const r = await app.call("GET", "/api/places?q=Lagos");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results, [{ id: 1, name: "Lagos", admin1: "Lagos", country: "Nigeria", lat: 6.4541, lon: 3.3947, timezone: "Africa/Lagos" }]);
  assert.equal(stub.calls[0].searchParams.get("name"), "Lagos");
});

test("GET /api/places: q 2–60 chars; bad %-escapes answer 400 JSON", async () => {
  stub = stubMeteo(defaultHandler());
  for (const q of ["", "a", "x".repeat(61)]) {
    const r = await app.call("GET", `/api/places?q=${q}`);
    assert.equal(r.status, 400, `q=${q.length}`);
    assert.equal(r.body.code, "bad_input");
  }
  assert.equal((await app.call("GET", `/api/places?q=${"x".repeat(60)}`)).status, 200);
  const bad = await app.call("GET", "/api/places?q=%E0%A4%A");
  assert.ok([200, 400].includes(bad.status));
  assert.ok(bad.body, "always JSON");
  assert.ok(stub.calls.every((u) => { const n = u.searchParams.get("name"); return n.length >= 2 && n.length <= 60; }), "no out-of-range query reached Open-Meteo");
});

test("GET /api/places is rate-limited per IP", async () => {
  stub = stubMeteo(defaultHandler());
  let last;
  for (let i = 0; i < 125; i++) last = await app.call("GET", `/api/places?q=city${i}`);
  assert.equal(last.status, 429);
  assert.equal(last.body.code, "rate_limited");
});

const TRIP = () => ({ legs: [{ ...LAGOS, from: d(1), to: d(3) }] });
const forecastStatus = async (profile, trip) => {
  const r = await app.call("POST", "/api/forecast", { profile, trip });
  return r;
};

test("attack: bad trips get 400 and no Open-Meteo call", async () => {
  stub = stubMeteo(defaultHandler());
  const leg = (o) => ({ ...LAGOS, from: d(1), to: d(2), ...o });
  const cases = {
    "6 legs": { legs: Array.from({ length: 6 }, (_, i) => leg({ from: d(i + 1), to: d(i + 1) })) },
    "31 days": { legs: [leg({ from: d(1), to: d(31) })] },
    "from > to": { legs: [leg({ from: d(3), to: d(2) })] },
    "NaN lat (string)": { legs: [leg({ lat: "NaN" })] },
    "null lat": { legs: [leg({ lat: null })] },
    "lat 91": { legs: [leg({ lat: 91 })] },
    "lon -181": { legs: [leg({ lon: -181 })] },
    "bad timezone": { legs: [leg({ timezone: "Mars/Olympus" })] },
    "timezone injection": { legs: [leg({ timezone: "../../etc/passwd" })] },
    "start > 365 days": { legs: [leg({ from: d(366), to: d(367) })] },
    "far past": { legs: [leg({ from: d(-60), to: d(-59) })] },
    "bad date": { legs: [leg({ from: "2026-02-30", to: d(2) })] },
    "no legs": { legs: [] },
    "legs not a list": { legs: "Lagos" },
    "no name": { legs: [leg({ name: "" })] },
    "out of order": { legs: [leg({ from: d(5), to: d(6) }), leg({ from: d(1), to: d(2) })] },
    "7 flights": { legs: [leg({ from: d(1), to: d(9) })], flights: Array.from({ length: 7 }, (_, i) => ({ date: d(1 + i), hours: 2 })) },
    "flight 0.4 h": { legs: [leg({})], flights: [{ date: d(1), hours: 0.4 }] },
    "flight 21 h": { legs: [leg({})], flights: [{ date: d(1), hours: 21 }] },
    "flight outside trip": { legs: [leg({})], flights: [{ date: d(9), hours: 3 }] },
    "carryOn string": { legs: [leg({})], carryOn: "yes" },
  };
  for (const [name, trip] of Object.entries(cases)) {
    const r = await forecastStatus(ADA, trip);
    assert.equal(r.status, 400, `${name}: ${r.text}`);
    assert.equal(r.body.code, "bad_input", name);
  }
  assert.equal(stub.calls.length, 0);
});

test("attack: trip limits are inclusive (5 legs, 30 days, 365 days ahead are fine)", () => {
  const leg = (o) => ({ ...LAGOS, ...o });
  assert.doesNotThrow(() => validateTrip({ legs: Array.from({ length: 5 }, (_, i) => leg({ from: d(i + 1), to: d(i + 1) })) }));
  assert.doesNotThrow(() => validateTrip({ legs: [leg({ from: d(1), to: d(30) })] }));
  assert.doesNotThrow(() => validateTrip({ legs: [leg({ from: d(364), to: d(364) })] }));
  assert.doesNotThrow(() => validateTrip({ legs: [leg({ from: d(1), to: d(1) })], flights: [{ date: d(1), hours: 0.5 }, { date: d(1), hours: 20 }] }));
});

test("attack: bad profiles get 400", async () => {
  stub = stubMeteo(defaultHandler());
  const cases = {
    'fitz "VII"': { ...ADA, fitz: "VII" },
    "fitz number": { ...ADA, fitz: 5 },
    "unknown skinType": { ...ADA, skinType: "scaly" },
    "score 101": { ...ADA, scores: { oiliness: 101 } },
    "score -1": { ...ADA, scores: { acne: -1 } },
    "score string": { ...ADA, scores: { acne: "50" } },
    "1000 concerns": { ...ADA, concerns: Array.from({ length: 1000 }, () => "acne") },
    "unknown concern": { ...ADA, concerns: ["wrinkles"] },
    "albinism string": { ...ADA, albinism: "true" },
    "bad toneHex": { ...ADA, toneHex: "red; background:url(x)" },
    "no profile": null,
  };
  for (const [name, profile] of Object.entries(cases)) {
    const r = await forecastStatus(profile, TRIP());
    assert.equal(r.status, 400, `${name}: ${r.text}`);
  }
  assert.equal(stub.calls.length, 0);
});

test("profile: albinism forces sun type I and keeps what was reported", () => {
  const p = validateProfile({ skinType: "dry", fitz: "V", albinism: true, concerns: [{ metric: "redness", level: "watch" }, "redness"] });
  assert.equal(p.fitz, "I");
  assert.equal(p.reportedFitz, "V");
  assert.deepEqual(p.concerns, ["redness"]);
});

test("names are cleaned before they are echoed back", async () => {
  stub = stubMeteo(defaultHandler());
  const r = await app.call("POST", "/api/forecast", { profile: ADA, trip: { legs: [{ ...LAGOS, name: "<img src=x onerror=alert(1)>Lagos", from: d(1), to: d(1) }] } });
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.body.days[0].city, /[<>]/);
});

test("POST /api/kit: validates, falls back to the CSV list when Shopify is down", async () => {
  const r = await app.call("POST", "/api/kit", { profile: ADA, needs: ["humid", "matte", "no-white-cast", "hat"], carryOn: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.shop.live, false);
  assert.equal(r.body.shop.source, "csv");
  assert.ok(r.body.slots.find((s) => s.slot === "sunscreen").pick);
  assert.ok(Array.isArray(r.body.buyThere));
  assert.match(r.body.disclaimer, /Not affiliated/);
  for (const body of [{ profile: ADA, needs: ["<script>"] }, { profile: ADA, needs: "hat" }, { profile: ADA, carryOn: "no" }, { profile: { ...ADA, fitz: "VII" } }, { profile: ADA, needs: Array.from({ length: 61 }, () => "hat") }]) {
    assert.equal((await app.call("POST", "/api/kit", body)).status, 400, JSON.stringify(body).slice(0, 80));
  }
});

test("POST /api/rescan/compare: shape and validation", async () => {
  const base = { oiliness: 80, acne: 85, pore: 70, moisture: 70, redness: 90 };
  const r = await app.call("POST", "/api/rescan/compare", {
    baseline: base, current: { ...base, oiliness: 60 }, profile: ADA,
    days: [{ date: d(-1), city: "Lagos", kind: "forecast", wx: { uvMax: 9, rhMean: 84, tMin: 25, tMax: 31, windMax: 10, pm25Max: null } }],
    selfReport: { sun: true, newProduct: false, water: false, sleep: false },
  });
  assert.equal(r.status, 200, r.text);
  for (const k of ["changes", "causes", "tonight", "needs", "safety"]) assert.ok(k in r.body, k);
  assert.equal(r.body.causes[0].id, "humid_heat");
  const bad = [
    { baseline: base },
    { baseline: base, current: { oiliness: 150 } },
    { baseline: base, current: base, days: Array.from({ length: 11 }, () => ({ date: d(0), wx: {} })) },
    { baseline: base, current: base, selfReport: { sun: "yes" } },
    { baseline: base, current: base, days: [{ date: "nope", wx: {} }] },
  ];
  for (const b of bad) assert.equal((await app.call("POST", "/api/rescan/compare", b)).status, 400, JSON.stringify(b).slice(0, 80));
});

test("geocode() drops results without coordinates or time zone", async () => {
  stub = stubMeteo(defaultHandler({ geocode: () => ({ results: [{ name: "X", latitude: 1, longitude: 2 }, { name: "Y", latitude: 1, longitude: 2, timezone: "UTC" }] }) }));
  assert.deepEqual((await geocode("xy")).map((r) => r.name), ["Y"]);
});
