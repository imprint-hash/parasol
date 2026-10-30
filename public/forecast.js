// /forecast: one card per day of the trip, with burn clock and hourly UV.
import { shell, esc, icon, $, fmtDate, fmtLong, fmtWeekday, fmtHour, fmtClock, uvLevel, uvText, errorBox, loading } from "./ui.js";
import { load, update, tripForApi, profileForApi } from "./state.js";
import { forecast as getForecast } from "./api.js";
import { announce, focusHeading } from "./a11y.js";
import { burnDial, minutesText } from "./parts.js";
import { uvChart } from "./chart.js";

const view = $("#view");
let data = null;
let sel = null;

shell({ page: "forecast", speechText });

const isDeep = (p, day) => day?.darkMarks || ["V", "VI"].includes(p?.fitz);
const headlineText = (d) => (typeof d.headline === "string" ? d.headline : d.headline?.text || d.advice?.[0]?.text || "");
const KIND = { forecast: "Forecast", typical: "Typical (last year)", flight: "Flight day" };

function speechText() {
  if (!data) return "Your skin forecast. Loading.";
  const d = data.days.find((x) => x.date === sel) || data.days[0];
  const p = load().profile;
  const parts = [`${fmtLong(d.date)} in ${d.city}.`, KIND[d.kind] ? `${KIND[d.kind]}.` : ""];
  if (d.wx) {
    if (Number.isFinite(Number(d.wx.uvMax))) parts.push(`UV ${Math.round(d.wx.uvMax)} at ${fmtHour(d.wx.uvPeakHour)}.`);
    parts.push(`Up to ${Math.round(d.wx.tMax)} degrees, ${Math.round(d.wx.rhMean)} percent humidity.`);
  }
  parts.push(headlineText(d));
  (d.advice || []).forEach((a) => parts.push(a.text));
  if (d.burn && !isDeep(p, d)) parts.push(`You may start to burn in about ${minutesText(d.burn).replace("–", " to ")} at ${fmtHour(d.burn.atHour)}. This is an estimate, not medical advice.`);
  if (d.protect) parts.push(`Protect hours: ${fmtClock(d.protect.from)} to ${fmtClock(d.protect.to)}.`);
  return parts.filter(Boolean).join(" ");
}

async function start() {
  const st = load();
  if (!st.trip?.legs?.some((l) => l.lat != null)) {
    view.innerHTML = `<div class="card stack-sm"><h2>No trip yet</h2><p class="muted">Add your cities and dates first.</p><p><a class="btn btn-primary" href="/trip">Plan my trip</a></p></div>`;
    return;
  }
  if (!st.profile) {
    view.innerHTML = `<div class="card stack-sm"><h2>Read your skin first</h2><p class="muted">Your forecast depends on your skin and sun type.</p><p class="row gap"><a class="btn btn-primary" href="/scan">Use my selfie</a><a class="btn btn-secondary" href="/scan?manual=1">Choose by hand</a><a class="btn btn-secondary" href="/#demo">Try the demo</a></p></div>`;
    return;
  }
  if (st.forecast?.days?.length) {
    data = st.forecast;
    return render();
  }
  view.innerHTML = loading("Checking the weather for every day of your trip…");
  announce("Building your forecast.");
  try {
    data = await getForecast(profileForApi(st.profile), tripForApi(st.trip));
    update((s) => (s.forecast = data));
    render();
    announce(`Forecast ready: ${data.days.length} days.`);
  } catch (err) {
    view.innerHTML = errorBox(err, { retry: true });
    view.querySelector("[data-retry]")?.addEventListener("click", start);
  }
}

function pickDefault() {
  const h = decodeURIComponent(location.hash.replace(/^#d=/, ""));
  if (data.days.some((d) => d.date === h)) return h;
  // Open on the strongest-sun day: that's the one that matters most.
  const ranked = data.days.filter((d) => d.kind !== "flight" && Number.isFinite(Number(d.wx?.uvMax))).sort((a, b) => b.wx.uvMax - a.wx.uvMax);
  return (ranked[0] || data.days[0]).date;
}

function render() {
  const st = load();
  const p = st.profile;
  sel ||= pickDefault();
  const legs = st.trip.legs.filter((l) => l.lat != null);
  const first = data.days[0]?.date;
  const last = data.days.at(-1)?.date;
  view.innerHTML = `
  <div class="trip-strip">${legs.map((l) => esc(l.name)).join(` ${icon("plane")} `)}</div>
  <p class="muted small">${fmtDate(first)} – ${fmtDate(last)} · ${data.days.length} days · Sun type ${esc(p.fitz)}${p.albinism ? " (albinism)" : ""} · ${esc(skinName(p.skinType))}</p>
  <section aria-labelledby="days-h">
    <div class="row spread"><h2 id="days-h" class="label" style="font-size:var(--fs-label)">${icon("calendar")} Trip days</h2><span class="small subtle">Choose a day</span></div>
    <div class="day-chips" role="group" aria-label="Trip days">
      ${data.days
        .map((d) => {
          const lv = uvLevel(d.wx?.uvMax);
          return `<button type="button" class="day-chip" data-day="${d.date}" aria-pressed="${d.date === sel}"><span class="uvdot bg-uv-${d.kind === "flight" ? "na" : lv.key}" aria-hidden="true"></span>${fmtWeekday(d.date)} ${fmtDate(d.date)}: ${d.kind === "flight" ? "Flight" : esc(d.city)}${d.kind === "flight" ? ` ${icon("plane")}` : ""}<span class="sr-only">, UV ${uvText(d.wx?.uvMax)}</span></button>`;
        })
        .join("")}
    </div>
  </section>
  <div id="day"></div>
  <section class="card" aria-labelledby="glance-h">
    <h2 id="glance-h">The whole trip at a glance</h2>
    <div class="table-wrap"><table class="data">
      <caption class="sr-only">Every day of the trip: city, UV, temperature and humidity</caption>
      <thead><tr><th scope="col">Day</th><th scope="col">Where</th><th scope="col" class="num">UV</th><th scope="col" class="num">High</th><th scope="col" class="num">Humidity</th></tr></thead>
      <tbody>${data.days
        .map(
          (d) =>
            `<tr><td><button type="button" class="link-btn" data-day="${d.date}" style="min-height:0;padding:0">${fmtWeekday(d.date)} ${fmtDate(d.date)}</button></td><td>${esc(d.city)}${d.kind === "flight" ? " (flight)" : d.kind === "typical" ? " (typical)" : ""}</td><td class="num"><span class="uv-${uvLevel(d.wx?.uvMax).key}" style="font-weight:700">${Number.isFinite(Number(d.wx?.uvMax)) ? Math.round(d.wx.uvMax) : "–"}</span></td><td class="num">${d.wx ? Math.round(d.wx.tMax) + "°" : "–"}</td><td class="num">${d.wx ? Math.round(d.wx.rhMean) + "%" : "–"}</td></tr>`
        )
        .join("")}</tbody>
    </table></div>
    <p class="small muted">${sourcesLine()}</p>
  </section>
  <a class="btn btn-primary btn-block" href="/kit">${icon("kit")} Build my trip kit ${icon("arrow")}</a>`;
  renderDay(false);
  // Scroll only the chip row (scrollIntoView would also nudge the page sideways).
  const chip = document.querySelector('.day-chip[aria-pressed="true"]');
  if (chip) chip.parentElement.scrollLeft = chip.offsetLeft - chip.parentElement.clientWidth / 2 + chip.clientWidth / 2;
}

function sourcesLine() {
  const s = (data.sources || []).map((x) => (typeof x === "string" ? x : x.name || x.label)).filter(Boolean);
  const when = data.generatedAt ? new Date(data.generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";
  const typical = data.days.some((d) => d.kind === "typical") ? ` Days after ${fmtDate(data.horizon)} use last year's weather on the same dates ("Typical").` : "";
  return `Weather: ${esc(s.join(", ") || "Open-Meteo")}${when ? `, checked ${esc(when)}` : ""}.${typical} Not medical advice. Burn times are estimates.`;
}
const skinName = (t) => ({ oily: "Oily skin", dry: "Dry skin", combination: "Combination skin", normal: "Normal skin" })[t] || "Skin type not set";

function renderDay(focus = true) {
  const p = load().profile;
  const d = data.days.find((x) => x.date === sel) || data.days[0];
  const wx = d.wx || {};
  const lv = uvLevel(wx.uvMax);
  const deep = isDeep(p, d);
  const hot = ["vhigh", "ext"].includes(lv.key);
  const uvKnown = Number.isFinite(Number(wx.uvMax));
  // The headline repeats the top advice line: show its "why" there, list the rest.
  const top = (d.advice || []).find((a) => a.text === headlineText(d));
  const rest = (d.advice || []).filter((a) => a !== top);
  const box = $("#day");
  box.innerHTML = `
  <div class="cols">
    <article class="card" aria-labelledby="day-h">
      <div class="card-head">
        <div><p class="eyebrow">${icon(d.kind === "flight" ? "plane" : "pin")} ${esc(d.city)}</p><h2 id="day-h" tabindex="-1">${esc(fmtLong(d.date))}</h2><p class="kind-tag ${d.kind === "typical" ? "subtle" : "muted"}">${esc(d.label || KIND[d.kind] || "")}</p></div>
        ${hot ? `<span class="alertpill">${icon("warn")} UV ${lv.name.toLowerCase()}</span>` : ""}
      </div>
      ${
        d.wx
          ? `<div class="stats">
        <div class="stat">${icon("thermo")}<span class="s-val">${Math.round(wx.tMax)}°C</span><span class="s-lab">low ${Math.round(wx.tMin)}°</span></div>
        <div class="stat">${icon("drop")}<span class="s-val">${Math.round(wx.rhMean)}%</span><span class="s-lab">${d.kind === "flight" ? "cabin air" : "humidity"}</span></div>
        <div class="stat ${hot ? "uv-hot" : ""}">${icon("sun")}<span class="s-val">${uvKnown ? `UV ${Math.round(wx.uvMax)}` : "UV ?"}</span><span class="s-lab">${uvKnown ? lv.name : "not known yet"}</span></div>
      </div>`
          : ""
      }
      ${headlineText(d) ? `<div class="headline-box"><span class="h-ic" aria-hidden="true">${icon(d.kind === "flight" ? "plane" : deep ? "shield" : "sun")}</span><div><p class="h-lab">Today's main thing</p><p class="h-txt">${esc(headlineText(d))}</p>${top?.why ? `<p class="small" style="margin-top:.375rem">Why: ${esc(top.why)}</p>` : ""}</div></div>` : ""}
      ${
        rest.length
          ? `<h3 class="row gap" style="font-size:1.0625rem">${icon("shieldCheck")} What to do</h3>
      <ol class="plan">${rest.map((a) => `<li><span class="p-text">${esc(a.text)}</span>${a.why ? `<span class="p-why">Why: ${esc(a.why)}</span>` : ""}</li>`).join("")}</ol>`
          : top ? "" : `<p class="muted">Nothing special for your skin today. Usual routine.</p>`
      }
      ${wx.windMax != null || wx.pm25Max != null ? `<p class="small muted">${wx.windMax != null ? `Wind up to ${Math.round(wx.windMax)} km/h.` : ""} ${wx.pm25Max != null ? `Fine dust (PM2.5) up to ${Math.round(wx.pm25Max)} µg/m³.` : ""}</p>` : ""}
      ${!uvKnown && d.kind === "typical" ? `<p class="note">${icon("info")} UV not known yet: check again within 16 days of travel.</p>` : ""}
    </article>
    <div>
      ${d.kind === "flight" ? flightNote(d) : ""}
      <section class="card" aria-labelledby="burn-h">
        <div class="card-head"><h2 id="burn-h">${icon("timer")} Burn clock</h2><span class="badge badge-neutral">Sun type ${esc(p.fitz)}${p.albinism ? " · albinism" : ""}</span></div>
        ${burnDial(d.burn, wx.uvMax, { deep })}
        ${burnText(d, p, deep)}
        ${d.protect ? `<div class="protect">${icon("sun")}<div><p class="p-lab">Protect hours${["I"].includes(p.fitz) || p.albinism ? " (our conservative choice: UV 2 and up)" : " (UV 3 and up)"}</p><p class="p-val">${esc(fmtClock(d.protect.from))} – ${esc(fmtClock(d.protect.to))}: shade, hat, sunscreen</p></div></div>` : ""}
        <p class="credit">Estimate. Not medical advice. The ring shows how strong the sun is at its peak, out of UV 12.</p>
      </section>
      <section class="card" aria-labelledby="uvh-h">
        <h2 id="uvh-h">UV through the day</h2>
        ${uvChart(d.hourly || [], { title: `UV by hour, ${d.city}, ${fmtDate(d.date)}`, protect: d.protect })}
      </section>
    </div>
  </div>`;
  if (focus) $("#day-h").focus();
}

function burnText(d, p, deep) {
  if (!d.burn) {
    const u = Number(d.wx?.uvMax);
    return `<p class="center muted">${Number.isFinite(u) ? (u < 1 ? "The sun stays weak all day: no burn estimate." : "No burn estimate for this day.") : "UV isn't known for this day yet, so the burn clock is off."}</p>`;
  }
  const mins = minutesText(d.burn);
  if (deep)
    return `<p class="center">Strong sun can leave dark marks on your skin that take months to fade. Use SPF 50 with no white cast; a tinted one also blocks visible light.</p>
    <details class="more"><summary>Burn time estimate</summary><div><p>Without sunscreen, at ${esc(fmtHour(d.burn.atHour))} (UV ${Math.round(d.burn.atUvi)}), you may start to burn after about ${mins}. Estimate. Not medical advice.</p></div></details>`;
  return `<p class="center">Without sunscreen, you may start to burn in about <strong>${mins}</strong> at ${esc(fmtHour(d.burn.atHour))}${p.albinism ? ", and it may be faster" : ""}.</p>`;
}

function flightNote(d) {
  return `<section class="card-blue stack-sm" aria-labelledby="fl-h"><div class="card-head"><h2 id="fl-h" style="color:inherit">${icon("plane")} Flight day</h2><span class="badge badge-neutral">${fmtDate(d.date)}</span></div><p>Cabin air is very dry, often under 20% humidity. Mist, a rich moisturiser and lip balm in your bag.</p><p class="small">Source: WHO, International Travel and Health (cabin environment).</p></section>`;
}

view.addEventListener("click", (e) => {
  const b = e.target.closest("[data-day]");
  if (!b) return;
  sel = b.dataset.day;
  history.replaceState(null, "", `#d=${sel}`);
  document.querySelectorAll(".day-chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.day === sel)));
  renderDay(true);
  const d = data.days.find((x) => x.date === sel);
  announce(`${fmtLong(sel)}, ${d.city}.`);
});

start().then(() => focusHeading());
