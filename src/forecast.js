/**
 * The trip forecast: weather for every day of a (validated) trip, run through
 * the rules for this (validated) profile.
 *
 * buildForecast(profile, trip, {now}) →
 *   {days:[Day], needs:[tag], horizon:"YYYY-MM-DD", sources:[…], generatedAt}
 *
 * Day = {date, city, timezone, kind:"forecast"|"typical"|"flight",
 *        basis:"forecast"|"typical"|"snapshot", label, wx, headline,
 *        advice:[{id,text,why,tags}], burn|null, protect|null, darkMarks,
 *        hourly:[{h,uvi,t,rh}]}
 *
 * Days within Open-Meteo's ~16-day horizon use the forecast. Later days use
 * the same dates last year ("Typical (last year)"). A forecast that comes
 * back short for some date falls back to typical for that date too.
 */

import { tripDays, splitHourly, pm25ByDate, maxByDate, summarise, addDays, daysBetween, lastYear, todayIn } from "./days.js";
import { forecast, airQuality, historical, snapshotFor, CREDIT, WeatherError, FORECAST_DAYS, AIR_DAYS } from "./weather.js";
import { evaluate } from "./rules.js";
import { burnRange, protectHours, ESTIMATE_NOTE } from "./burn.js";

const LABELS = { forecast: "Forecast", typical: "Typical (last year)", snapshot: "Saved snapshot" };

/** Last date the forecast covers, counted from today in UTC (Open-Meteo's own clock). */
export const horizonFrom = (now = new Date()) => addDays(now.toISOString().slice(0, 10), FORECAST_DAYS - 1);

async function legWeather(leg, dates, now) {
  const today = todayIn(leg.timezone, now);
  const horizon = horizonFrom(now);
  const first = dates[0], last = dates[dates.length - 1];
  const out = { forecast: new Map(), pm25: new Map(), dust: new Map(), typical: new Map(), snapshot: null, failed: false };
  const wantsForecast = first <= horizon;
  const pastDays = Math.max(0, daysBetween(first, today));

  try {
    if (wantsForecast) {
      const wantsAir = first <= addDays(today, AIR_DAYS - 1);
      const [fc, air] = await Promise.all([
        forecast(leg, pastDays),
        wantsAir ? airQuality(leg, pastDays).catch(() => null) : null, // air is a bonus: never fail the day for it
      ]);
      out.forecast = splitHourly(fc.hourly);
      if (air) {
        out.pm25 = pm25ByDate(air.hourly);
        out.dust = maxByDate(air.hourly, "dust");
      }
    }
    const missing = dates.filter((d) => !(out.forecast.get(d)?.length >= 20));
    if (missing.length) {
      const hist = await historical(leg, lastYear(missing[0]), lastYear(missing[missing.length - 1]));
      out.typical = splitHourly(hist.hourly);
    }
  } catch (err) {
    if (!(err instanceof WeatherError)) throw err;
    out.snapshot = snapshotFor(leg, first, last);
    if (!out.snapshot) throw err;
    out.forecast = splitHourly(out.snapshot.hourly);
    out.pm25 = out.snapshot.air ? pm25ByDate(out.snapshot.air) : new Map();
    out.dust = out.snapshot.air ? maxByDate(out.snapshot.air, "dust") : new Map();
    out.typical = new Map();
  }
  return out;
}

export function makeDay({ date, leg, flight, hours, pm25, dust = null, basis }, profile) {
  const { wx, hourly } = summarise(hours, { pm25, dust, flightHours: flight?.hours ?? null });
  const allHours = (hours || []).map((x) => ({ h: x.h, uvi: x.uvi }));
  const protect = wx.uvMax === null ? null : protectHours(allHours, profile.fitz, profile.albinism);
  const result = evaluate(profile, wx, { protect });
  const b = burnRange(profile.fitz, wx.uvMax, { albinism: profile.albinism });
  return {
    date,
    city: leg.name,
    timezone: leg.timezone,
    kind: flight ? "flight" : basis === "typical" ? "typical" : "forecast",
    basis,
    label: flight ? `Flight · ${LABELS[basis]}` : LABELS[basis],
    wx,
    headline: result.headline,
    advice: result.advice,
    needs: result.needs,
    burn: b ? { ...b, atHour: wx.uvPeakHour } : null,
    burnNote: b ? ESTIMATE_NOTE : wx.uvMax === null ? "UV not known yet: check again within 16 days of travel." : null,
    protect,
    darkMarks: result.darkMarks,
    hourly,
  };
}

export async function buildForecast(profile, trip, { now = new Date() } = {}) {
  const plan = tripDays(trip);
  const byLeg = new Map();
  for (const d of plan) {
    if (!byLeg.has(d.leg)) byLeg.set(d.leg, []);
    byLeg.get(d.leg).push(d.date);
  }
  const weather = new Map();
  await Promise.all([...byLeg].map(async ([i, dates]) => weather.set(i, await legWeather(trip.legs[i], dates, now))));

  const used = new Set();
  const days = plan.map((d) => {
    const leg = trip.legs[d.leg];
    const w = weather.get(d.leg);
    let hours = w.forecast.get(d.date);
    let basis = w.snapshot ? "snapshot" : "forecast";
    if (!(hours?.length >= 20) && !w.snapshot) {
      hours = w.typical.get(lastYear(d.date)) || [];
      basis = "typical";
    }
    used.add(basis);
    return makeDay({ date: d.date, leg, flight: d.flight, hours: hours || [], pm25: basis === "typical" ? null : w.pm25.get(d.date) ?? null, dust: basis === "typical" ? null : w.dust.get(d.date) ?? null, basis }, profile);
  });

  const sources = [{ ...CREDIT, used: [...used].map((b) => LABELS[b]) }];
  if ([...weather.values()].some((w) => w.snapshot)) sources.push({ name: "Saved snapshot", text: "Open-Meteo was unreachable, so these days use a saved snapshot of this city's weather.", capturedAt: [...weather.values()].find((w) => w.snapshot)?.snapshot.capturedAt || null });
  return {
    days,
    needs: [...new Set(days.flatMap((d) => d.needs))],
    horizon: horizonFrom(now),
    sources,
    generatedAt: now.toISOString(),
  };
}
