// /forecast: one card per day of the trip, with burn clock and hourly UV.
import { shell, esc, icon, $, fmtDate, fmtLong, fmtWeekday, fmtHour, fmtClock, uvLevel, uvText, errorBox, loading } from "./ui.js";
import { load, update, tripForApi, profileForApi } from "./state.js";
import { forecast as getForecast } from "./api.js";
import { announce, focusHeading } from "./a11y.js";
import { FITZ, burnDial, minutesText, scenePhoto, SCENE_CREDIT, uvGauge, wxGlyph, ADVICE_ICON } from "./parts.js";
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
    if (Number.isFinite(Number(d.wx.uvMax))) parts.push(`UV ${Math.round(d.wx.uvMax)}, ${uvLevel(d.wx.uvMax).name}, at ${fmtHour(d.wx.uvPeakHour)}.`);
    parts.push(`Up to ${Math.round(d.wx.tMax)} degrees, ${Math.round(d.wx.rhMean)} percent humidity.`);
  }
  const head = headlineText(d);
  parts.splice(2, 0, head);
  (d.advice || []).filter((a) => a.text !== head).forEach((a) => parts.push(a.text));
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
    view.innerHTML = `<div class="card stack-sm"><h2>Read your skin first</h2><p class="muted">Your forecast depends on your skin.</p><p class="row gap"><a class="btn btn-primary" href="/scan">Use my selfie</a><a class="btn btn-secondary" href="/scan?manual=1">Choose by hand</a><a class="btn btn-secondary" href="/#demo">Try the demo</a></p></div>`;
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
  <div class="trip-strip">${legs.map((l) => esc(l.name)).join(` ${icon("arrow")} `)}</div>
  <p class="muted small">${fmtDate(first)} – ${fmtDate(last)} · ${data.days.length} days · ${esc(FITZ[p.albinism ? "I" : p.fitz]?.cap || "")}${p.albinism ? " (albinism)" : ""} · ${esc(skinName(p.skinType))}</p>
  <section aria-labelledby="days-h">
    <div class="row spread"><h2 id="days-h" style="font-size:1.25rem">Trip days</h2><span class="small subtle">Choose a day</span></div>
    <div class="day-chips" role="group" aria-labelledby="days-h">
      ${data.days
        .map((d) => {
          const t = d.wx && Number.isFinite(Number(d.wx.tMax)) ? `${Math.round(d.wx.tMax)}°` : "–";
          return `<button type="button" class="day-chip" data-day="${d.date}" aria-pressed="${d.date === sel}"><span class="dc-d">${fmtWeekday(d.date)} ${fmtDate(d.date)}</span>${wxGlyph(d, 30)}<span class="dc-t">${t}</span><span class="dc-c">${d.kind === "flight" ? "Flight" : esc(d.city)}</span><span class="sr-only">, ${d.kind === "flight" ? `flight to ${esc(d.city)}` : ""} UV ${uvText(d.wx?.uvMax)}</span></button>`;
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
            `<tr><td><button type="button" class="link-btn" data-day="${d.date}" style="min-height:0;padding:0">${fmtWeekday(d.date)} ${fmtDate(d.date)}</button></td><td>${esc(d.city)}${d.kind === "flight" ? " (flight)" : d.kind === "typical" ? " (typical)" : ""}</td><td class="num"><span class="uv-txt-${uvLevel(d.wx?.uvMax).key}" style="font-weight:600">${Number.isFinite(Number(d.wx?.uvMax)) ? `${Math.round(d.wx.uvMax)} ${esc(uvLevel(d.wx.uvMax).short)}` : "–"}</span></td><td class="num">${d.wx ? Math.round(d.wx.tMax) + "°" : "–"}</td><td class="num">${d.wx ? Math.round(d.wx.rhMean) + "%" : "–"}</td></tr>`
        )
        .join("")}</tbody>
    </table></div>
    <p class="small muted">${sourcesLine()}</p>
  </section>
  <a class="btn btn-primary btn-block" href="/kit">Build my trip kit ${icon("arrow")}</a>`;
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
  const photo = scenePhoto(d.city, { alt: "" });
  const stat = (ic, lab, val, unit, note = "") => `<div class="stat"><span class="s-lab">${icon(ic)} ${lab}</span><span class="s-val">${val}${unit ? `<small>${unit}</small>` : ""}</span>${note ? `<span class="s-note">${note}</span>` : ""}</div>`;
  const r = (v) => (v == null || !Number.isFinite(Number(v)) ? "–" : Math.round(v));
  const tiles = d.wx
    ? `<div class="stat-row four">
        ${stat("thermo", "High", r(wx.tMax), "°C", `low ${r(wx.tMin)}°`)}
        ${stat("sun", "UV", uvKnown ? r(wx.uvMax) : "?", "", uvKnown ? `${esc(lv.name)} at ${esc(fmtHour(wx.uvPeakHour))}` : "not known yet")}
        ${stat("drop", d.kind === "flight" ? "Humidity on the ground" : "Humidity", r(wx.rhMean), "%", wx.dewMean != null && wx.dewMean >= 20 ? "sticky air" : "")}
        ${stat("wind", "Wind", r(wx.windMax), "km/h", wx.windMax >= 30 ? "strong" : "")}
        ${wx.dustMax != null ? stat("haze", "Dust", r(wx.dustMax), "", wx.dustMax >= 50 ? "hazy air" : "") : stat("thermo", "Feels like", r(wx.feelsMin), "°", "coldest hour")}
        ${wx.pm25Max != null ? stat("haze", "Air", r(wx.pm25Max), "", wx.pm25Max >= 35 ? "poor" : "ok") : ""}
      </div>`
    : "";
  const head = headlineText(d) || "Nothing special for your skin today. Usual routine.";
  box.innerHTML = `
  <article class="city-hero ${photo ? "" : "no-photo"}" aria-labelledby="day-h">
    ${photo}
    <div class="ch-top">
      <div><p class="ch-sub">${icon(d.kind === "flight" ? "plane" : "pin")} ${d.kind === "flight" ? `Flight to ${esc(d.city)}` : esc(d.city)}</p><h2 id="day-h" tabindex="-1">${esc(fmtLong(d.date))}</h2></div>
      <span class="badge badge-glass">${esc(d.label || KIND[d.kind] || "")}</span>
    </div>
    <div>
      <p class="ch-say">${esc(head)}</p>
      ${photo ? `<p class="credit" style="margin-top:.5rem">${SCENE_CREDIT}</p>` : ""}
    </div>
  </article>
  <div class="cols">
    <div>
      ${d.kind === "flight" ? flightNote(d) : ""}
      <section class="dk" aria-labelledby="burn-h">
        <div class="card-head"><h2 id="burn-h" style="font-size:1.375rem">Burn clock</h2></div>
        ${burnDial(d.burn, wx.uvMax, { deep })}
        ${burnText(d, p, deep)}
      </section>
      ${rest.length ? `<section class="card" aria-labelledby="todo-h"><h3 id="todo-h">Also today</h3><ul class="plan">${rest.map((a) => `<li data-ic><span class="p-ic" aria-hidden="true">${icon(ADVICE_ICON[a.id] || "info")}</span><span class="p-text">${esc(a.text)}</span></li>`).join("")}</ul></section>` : ""}
    </div>
    <div>
      <button type="button" class="btn btn-secondary btn-block" id="more-btn" aria-expanded="false" aria-controls="more-box">Show details</button>
      <div id="more-box" class="stack" hidden>
        ${tiles ? `<section class="dk" aria-label="Weather details">${tiles}</section>` : ""}
        ${top?.why || rest.some((a) => a.why) ? `<section class="card stack-sm" aria-label="Why"><h3>Why</h3>${[top, ...rest].filter((a) => a?.why).map((a) => `<p class="small muted">${esc(a.why)}</p>`).join("")}</section>` : ""}
        ${d.protect ? `<div class="protect">${icon("sun")}<div><p class="p-lab">Protect hours</p><p class="p-val">${esc(fmtClock(d.protect.from))} – ${esc(fmtClock(d.protect.to))}: shade, hat, sunscreen</p></div></div>` : ""}
        ${deep && d.burn ? `<p class="small">Without sunscreen, at ${esc(fmtHour(d.burn.atHour))}, you may start to burn after about ${minutesText(d.burn)}. Estimate.</p>` : ""}
        ${!uvKnown && d.kind === "typical" ? `<p class="note">${icon("info")} UV not known yet: check again within 16 days of travel.</p>` : ""}
        <section class="dk" aria-labelledby="uvh-h">
          <div class="card-head"><h2 id="uvh-h" style="font-size:1.375rem">Sun through the day</h2></div>
          ${uvGauge(wx.uvMax, { label: uvKnown ? `peak at ${fmtHour(wx.uvPeakHour)}` : "" })}
          ${uvChart(d.hourly || [], { title: `Sun strength by hour, ${d.city}, ${fmtDate(d.date)}`, protect: d.protect })}
        </section>
      </div>
    </div>
  </div>`;
  $("#more-btn").addEventListener("click", (e) => {
    const open = e.currentTarget.getAttribute("aria-expanded") !== "true";
    e.currentTarget.setAttribute("aria-expanded", String(open));
    e.currentTarget.textContent = open ? "Hide details" : "Show details";
    $("#more-box").hidden = !open;
  });
  if (focus) $("#day-h").focus();
}

function burnText(d, p, deep) {
  if (!d.burn) {
    const u = Number(d.wx?.uvMax);
    return `<p class="center muted">${Number.isFinite(u) ? (u < 1 ? "The sun stays weak all day: no burn estimate." : "No burn estimate for this day.") : "UV isn't known for this day yet, so the burn clock is off."}</p>`;
  }
  if (deep) return `<p class="center">Strong sun can leave dark marks that take months to fade. Use SPF 50 with no white cast.</p>`;
  return `<p class="center">Without sunscreen${p.albinism ? ", maybe faster" : ""}. Estimate, not medical advice.</p>`;
}

function flightNote(d) {
  return `<section class="card-blue stack-sm" aria-labelledby="fl-h"><div class="card-head"><h2 id="fl-h" style="font-size:1.375rem">${icon("plane")} Flight day</h2><span class="badge badge-neutral">${d.wx?.flightHours ? `${esc(d.wx.flightHours)} h in the air` : fmtDate(d.date)}</span></div><p>Cabin air is very dry, often under 20% humidity. Mist, a rich moisturiser and lip balm in your bag.</p><p class="small">Source: WHO, International Travel and Health (cabin environment).</p></section>`;
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
