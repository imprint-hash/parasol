// /today: today's card in the city's time zone, routine, and the sun timer.
import { shell, esc, icon, $, fmtLong, fmtHour, fmtClock, uvLevel, readAloud } from "./ui.js";
import { load, update, todayIn, PERSONAS } from "./state.js";
import { announce, focusHeading } from "./a11y.js";
import * as T from "./timer.js";
import { burnDial, minutesText } from "./parts.js";

const view = $("#view");
const st = load();
let day = null;
let label = "";
let tick = null;

shell({ page: "today", speechText: () => speech() });

/** Pick today's day: the leg we're in, or a clearly labelled preview. */
function chooseDay() {
  const days = st.forecast?.days || [];
  if (!days.length) return null;
  for (const l of st.trip?.legs || []) {
    const t = todayIn(l.timezone);
    const d = days.find((x) => x.date === t && (x.city === l.name || x.kind === "flight"));
    if (d) return { d, label: "" };
  }
  if (st.demo) {
    const lagos = days.filter((x) => x.city === "Lagos");
    const d = lagos[2] || lagos.at(-1) || days[0];
    return { d, label: "Demo preview: Day 3 in Lagos" };
  }
  return { d: days[0], label: `Preview: your trip starts ${fmtLong(days[0].date)}` };
}

const nowHour = (tz) => {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  } catch {
    return new Date().getHours();
  }
};

function routine() {
  const k = st.kit?.res?.slots || [];
  const pick = (slot) => k.find((s) => s.slot === slot && st.kit.chosen?.[slot]);
  const title = (slot, fallback) => {
    const s = pick(slot);
    if (!s) return fallback;
    const p = [s.pick, ...(s.alternatives || [])].find((x) => x?.variantId === st.kit.chosen[slot]) || s.pick;
    return p.title;
  };
  const wx = day?.wx || {};
  const humid = wx.rhMean >= 70;
  const dry = wx.rhMean <= 40 || wx.tMin <= 5 || day?.kind === "flight";
  const uvHigh = wx.uvMax >= 6;
  const tags = new Set((day?.advice || []).flatMap((a) => a.tags || []));
  const am = [
    { id: "am-cleanse", t: "Gentle cleanse", d: title("cleanser", "A gentle, fragrance-free cleanser. Lukewarm water.") },
    { id: "am-moist", t: humid ? "Light gel moisturiser" : dry ? "Moisturiser, a bit richer today" : "Moisturiser", d: title("moisturiser-day", humid ? "A thin gel layer is enough in humid air." : "A thin layer before sunscreen.") },
    { id: "am-spf", t: wx.uvMax >= 3 || tags.has("spf-50") ? "Sunscreen SPF 50" : "Sunscreen SPF 30+", d: `${title("sunscreen", "Broad-spectrum sunscreen.")} Two finger-lengths for face, ears and neck.`, essential: true },
  ];
  if (pick("lip") || tags.has("lip")) am.push({ id: "am-lip", t: "Lip balm with SPF", d: title("lip", "Reapply after eating and drinking.") });
  if (tags.has("hat") || tags.has("sunglasses") || pick("hat")) am.push({ id: "am-hat", t: "Hat and sunglasses", d: "Wide brim, and sunglasses marked UV400." });
  if (day?.kind === "flight") am.push({ id: "am-mist", t: "Mist and balm in your bag", d: title("mist", "Cabin air is very dry.") });
  const pm = [
    { id: "pm-cleanse", t: "Cleanse well", d: wx.pm25Max >= 35 ? "Air quality was poor today: cleanse twice, gently." : "Take off sunscreen and the day's sweat." },
    { id: "pm-moist", t: dry ? "Rich cream" : "Moisturiser", d: title(dry ? "moisturiser-rich" : "moisturiser-day", dry ? "Dry air: a richer cream overnight." : "A light layer.") },
  ];
  if (uvHigh) pm.push({ id: "pm-after", t: "After-sun", d: title("aftersun", "Cool, soothing gel on skin that saw the sun.") });
  return { am, pm };
}

function speech() {
  if (!day) return "Today. Build your forecast first.";
  const wx = day.wx || {};
  const parts = [`Today in ${day.city}.`, label];
  if (Number.isFinite(Number(wx.uvMax))) parts.push(`UV ${Math.round(wx.uvMax)} at ${fmtHour(wx.uvPeakHour)}.`);
  parts.push(typeof day.headline === "string" ? day.headline : "");
  const left = T.secondsLeft();
  if (left != null) parts.push(left > 0 ? `Reapply sunscreen in ${Math.ceil(left / 60)} minutes.` : "Time to reapply your sunscreen.");
  const r = routine();
  parts.push(`Morning routine: ${r.am.map((x) => x.t).join(", ")}.`);
  parts.push(`Evening: ${r.pm.map((x) => x.t).join(", ")}.`);
  return parts.filter(Boolean).join(" ");
}

function list(items, date, heading, id) {
  const done = new Set(st.routine?.[date] || []);
  const n = items.filter((x) => done.has(x.id)).length;
  return `<section aria-labelledby="${id}">
    <div class="row spread" style="margin-bottom:.75rem"><h2 id="${id}" class="row gap">${icon(id === "am-h" ? "sunrise" : "moon")} ${heading}</h2><span class="small" style="color:var(--primary);font-weight:700" id="${id}-n">${n} of ${items.length} done</span></div>
    <ul class="routine">${items
      .map(
        (x) =>
          `<li class="${x.essential ? "essential" : ""}"><label><input type="checkbox" data-r="${x.id}" ${done.has(x.id) ? "checked" : ""}><span class="r-box" aria-hidden="true">${icon("check")}</span><span class="r-title">${esc(x.t)}</span><span class="r-desc">${esc(x.d)}</span>${x.essential ? `<span class="r-tag badge badge-solid">Essential</span>` : ""}</label></li>`
      )
      .join("")}</ul>
  </section>`;
}

function render() {
  const c = chooseDay();
  if (!c) {
    view.innerHTML = `<div class="card stack-sm"><h2>No forecast yet</h2><p class="muted">Today's routine comes from your trip forecast.</p><p class="row gap"><a class="btn btn-primary" href="${st.trip ? "/forecast" : "/trip"}">${st.trip ? "Build my forecast" : "Plan my trip"}</a><a class="btn btn-secondary" href="/#demo">Try the demo</a></p></div>`;
    return;
  }
  day = c.d;
  label = c.label;
  const wx = day.wx || {};
  const h = nowHour(day.timezone);
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const name = st.demo ? PERSONAS[st.demo]?.name : "";
  $("#h1").textContent = `${part}${name ? `, ${name}` : ""}`;
  $("#where").innerHTML = `${icon("pin")} ${esc(day.city)} · ${esc(fmtLong(day.date))}`;
  // In a preview we show the peak hour; on a real day, the current hour.
  const hourNow = label ? Math.round(wx.uvPeakHour ?? 13) : h;
  const uvNow = Number((day.hourly || []).find((x) => x.h === hourNow)?.uvi);
  const lvNow = uvLevel(uvNow);
  const r = routine();
  const deep = day.darkMarks || ["V", "VI"].includes(st.profile?.fitz);
  // Burn time scales with 1/UV: same dose at a weaker sun takes longer.
  const burnNow =
    day.burn && uvNow >= 1
      ? { ...day.burn, atUvi: uvNow, atHour: hourNow, minutesLow: round5((day.burn.minutesLow * day.burn.atUvi) / uvNow), minutesHigh: round5((day.burn.minutesHigh * day.burn.atUvi) / uvNow) }
      : null;

  view.innerHTML = `
  ${label ? `<p class="note">${icon("info")} ${esc(label)}</p>` : ""}
  <div class="cols">
    <div class="stack">
      <div class="row spread gap"><span class="badge badge-blue">${icon("sun")} UV ${Number.isFinite(uvNow) ? Math.round(uvNow) : "?"} ${label ? `at ${fmtHour(hourNow)}` : "now"} · max ${Number.isFinite(Number(wx.uvMax)) ? Math.round(wx.uvMax) : "?"}</span>${label ? "" : `<span class="small subtle">${fmtHour(h)} local time</span>`}</div>
      <button type="button" class="briefing" id="brief"><span class="b-ic" aria-hidden="true">${icon("speaker")}</span><span class="b-txt"><strong>Read my briefing aloud</strong><span class="small muted">Today's weather, routine and timer</span></span>${icon("play", "play")}</button>
      <section class="card" aria-labelledby="timer-h">
        <div class="card-head"><h2 id="timer-h" class="row gap"><span class="dot" style="background:var(--primary)" aria-hidden="true"></span> Sun timer</h2><span class="badge badge-neutral">Sun type ${esc(st.profile?.fitz || "?")}</span></div>
        <div id="timer"></div>
      </section>
      ${
        Number.isFinite(uvNow) && uvNow >= 6
          ? `<div class="alert">${icon("warn")}<div><p><strong>UV ${Math.round(uvNow)} (${lvNow.name}) ${label ? "at the peak hour" : "right now"}.</strong></p><p>Reapply straight away after swimming, towel drying or heavy sweating.</p></div></div>`
          : ""
      }
      <section class="card" aria-labelledby="bn-h">
        <h2 id="bn-h">${icon("timer")} Burn clock, ${label ? `at ${fmtHour(hourNow)}` : "this hour"}</h2>
        ${burnDial(burnNow, uvNow, { deep })}
        ${
          burnNow
            ? deep
              ? `<p class="center">Strong sun can leave dark marks that take months to fade. SPF 50, no white cast.</p><details class="more"><summary>Burn time estimate</summary><div><p>Without sunscreen you may start to burn after about ${minutesText(burnNow)}.</p></div></details>`
              : `<p class="center">Without sunscreen, you may start to burn in about <strong>${minutesText(burnNow)}</strong>${st.profile?.albinism ? ", and it may be faster" : ""}.</p>`
            : `<p class="center muted">${Number.isFinite(uvNow) ? "The sun is weak this hour." : "UV isn't known for this hour."}</p>`
        }
        ${day.protect ? `<div class="protect">${icon("sun")}<div><p class="p-lab">Protect hours</p><p class="p-val">${esc(fmtClock(day.protect.from))} – ${esc(fmtClock(day.protect.to))}</p></div></div>` : ""}
        <p class="credit">Estimate. Not medical advice.</p>
      </section>
    </div>
    <div class="stack">
      ${list(r.am, day.date, "Morning routine", "am-h")}
      ${list(r.pm, day.date, "Evening routine", "pm-h")}
      <section class="card-tint stack-sm" aria-labelledby="bo-h"><h2 id="bo-h">${icon("face")} Skin playing up?</h2><p class="muted">Scan again and Parasol compares it with your first scan and the weather since you landed.</p><a class="btn btn-secondary" href="/rescan">Do a rescan</a></section>
    </div>
  </div>`;

  $("#brief").addEventListener("click", () => readAloud(speech()));
  view.addEventListener("change", (e) => {
    const id = e.target.dataset?.r;
    if (!id) return;
    update((s) => {
      const set = new Set(s.routine[day.date] || []);
      e.target.checked ? set.add(id) : set.delete(id);
      s.routine = { [day.date]: [...set] }; // keep only today's ticks
    });
    const sec = e.target.closest("section");
    const boxes = sec.querySelectorAll("input[data-r]");
    const n = [...boxes].filter((b) => b.checked).length;
    sec.querySelector("[id$='-n']").textContent = `${n} of ${boxes.length} done`;
  });
  renderTimer();
}
const round5 = (m) => Math.max(5, Math.round(m / 5) * 5);

function renderTimer() {
  const box = $("#timer");
  const C = 2 * Math.PI * 42;
  if (tick) clearInterval(tick);
  const t = T.current();
  if (!t) {
    box.innerHTML = `
      <div class="ring idle"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="none" class="r-track" stroke-width="7"/><circle cx="50" cy="50" r="42" fill="none" class="r-prog" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg>
      <div class="ring-in"><span class="r-lab">Reapply every</span><span class="r-big" id="idle-min">2:00</span><span class="r-unit">hours : mins</span></div></div>
      <fieldset class="seg"><legend>Swimming or sweating? (with water-resistant sunscreen)</legend>
        <label><input type="radio" name="tmode" value="120" checked><span>No: 2 hours</span></label>
        <label><input type="radio" name="tmode" value="80"><span>80 min label</span></label>
        <label><input type="radio" name="tmode" value="40"><span>40 min label</span></label>
      </fieldset>
      <button type="button" class="btn btn-primary btn-block" id="t-start">${icon("sun")} I'm going outside now</button>
      <p class="credit">Reapply every 2 hours, or after 40 or 80 minutes of swimming or sweating, matching the water-resistance on the label (FDA, AAD).</p>`;
    box.querySelectorAll('[name="tmode"]').forEach((r) =>
      r.addEventListener("change", () => {
        const m = Number(r.value);
        $("#idle-min").textContent = m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` : `0:${m}`;
      })
    );
    $("#t-start").addEventListener("click", () => {
      const m = Number(box.querySelector('[name="tmode"]:checked').value);
      T.start(m);
      announce(`Sun timer started. Reapply in ${m} minutes.`);
      renderTimer();
      $("#t-again")?.focus();
    });
    return;
  }
  const next = new Date(t.startedAt + t.minutes * 60000).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true });
  box.innerHTML = `
    <div class="ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="none" class="r-track" stroke-width="7"/><circle cx="50" cy="50" r="42" fill="none" class="r-prog" id="t-ring" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg>
    <div class="ring-in"><span class="r-lab">Reapply in</span><span class="r-big" id="t-left" role="timer" aria-live="off">–</span><span class="r-unit" id="t-unit"></span></div></div>
    <p class="center"><strong>Next reapply at ${esc(next)}</strong></p>
    <div id="t-done"></div>
    <div class="stack-sm">
      <button type="button" class="btn btn-blue btn-block" id="t-again">${icon("refresh")} I reapplied (restart ${t.minutes} min)</button>
      <button type="button" class="btn btn-secondary btn-block" id="t-stop">Back inside (stop timer)</button>
    </div>`;
  tick = T.run(
    (left) => {
      if (left == null) return;
      $("#t-left").textContent = T.fmt(left);
      $("#t-unit").textContent = left >= 3600 ? "hours : mins" : "mins : secs";
      $("#t-ring").setAttribute("stroke-dashoffset", String(C * (1 - left / (t.minutes * 60))));
      if (left === 0) $("#t-done").innerHTML = `<p class="timer-done" role="alert">${icon("warn")} Time to reapply your sunscreen.</p>`;
    },
    () => {}
  );
  $("#t-again").addEventListener("click", () => {
    T.start(t.minutes);
    announce(`Timer restarted. Reapply in ${t.minutes} minutes.`);
    renderTimer();
    $("#t-again").focus();
  });
  $("#t-stop").addEventListener("click", () => {
    T.stop();
    announce("Sun timer stopped.");
    renderTimer();
    $("#t-start").focus();
  });
}

render();
focusHeading();
