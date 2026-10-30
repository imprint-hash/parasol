// /trip: cities, dates, flights, carry-on. Saves to localStorage, then /forecast.
import { shell, esc, icon, $, $$, fmtDate, daysBetween, uvLevel, errorBox } from "./ui.js";
import { load, update, today, addDays, demoTrip } from "./state.js";
import { places } from "./api.js";
import { announce, focusHeading } from "./a11y.js";
import { miniMap } from "./parts.js";

const view = $("#view");
const MAX_LEGS = 5;
const MAX_DAYS = 30;
let trip = structuredClone(load().trip || { legs: [], flights: [], carryOn: true });
if (!trip.legs.length) trip.legs.push(blankLeg());
let editing = new Set(trip.legs.map((l, i) => (l.lat == null ? i : -1)).filter((i) => i >= 0));

function blankLeg() {
  const last = trip?.legs?.at(-1);
  const from = last?.to ? addDays(last.to, 1) : addDays(today(), 1);
  return { name: "", country: "", lat: null, lon: null, timezone: null, from, to: addDays(from, 2) };
}

shell({ page: "trip", speechText });

function speechText() {
  if (!trip.legs.some((l) => l.name)) return "Your travel route. Add each city of your trip, with the dates you arrive and leave. Then see your day by day forecast.";
  const parts = trip.legs.filter((l) => l.name).map((l, i) => `Stop ${i + 1}: ${l.name}, ${fmtDate(l.from)} to ${fmtDate(l.to)}.`);
  const fl = (trip.flights || []).map((f) => `Flight on ${fmtDate(f.date)}, ${f.hours} hours.`);
  return `Your travel route. ${parts.join(" ")} ${fl.join(" ")} Carry-on only is ${trip.carryOn ? "on" : "off"}. Next: see your day by day forecast.`;
}

/** Summary of the cached forecast for one city, if we have one. */
function wxFor(leg) {
  const f = load().forecast;
  if (!f?.days) return null;
  const ds = f.days.filter((d) => d.city === leg.name && d.kind !== "flight" && d.wx);
  if (!ds.length) return null;
  const max = (k) => Math.max(...ds.map((d) => Number(d.wx[k])).filter(Number.isFinite));
  const avg = (k) => {
    const v = ds.map((d) => Number(d.wx[k])).filter(Number.isFinite);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
  };
  return { t: max("tMax"), rh: avg("rhMean"), uv: max("uvMax") };
}

function flightBetween(i) {
  const next = trip.legs[i + 1];
  if (!next) return null;
  return (trip.flights || []).find((f) => f.date === next.from) || null;
}

function legCard(leg, i) {
  const n = daysBetween(leg.from, leg.to) + 1;
  const wx = leg.lat != null ? wxFor(leg) : null;
  const ed = editing.has(i);
  const uv = wx && Number.isFinite(wx.uv) ? uvLevel(wx.uv) : null;
  return `<section class="card leg" aria-labelledby="leg-h-${i}">
    <div class="leg-head">
      <span class="leg-num" aria-hidden="true">${i + 1}</span>
      <div class="leg-title"><h2 id="leg-h-${i}">${leg.name ? `${esc(leg.name)}${leg.country ? `, ${esc(leg.country)}` : ""}` : "Choose a city"}</h2>
      <p class="muted small">${fmtDate(leg.from)} – ${fmtDate(leg.to)} · ${n} day${n === 1 ? "" : "s"}</p></div>
      <span class="badge badge-neutral">Stop ${i + 1}</span>
    </div>
    ${leg.lat != null ? miniMap(leg, i) : ""}
    ${
      wx
        ? `<dl class="wx-row"><div><dt>Temp</dt><dd>${Math.round(wx.t)}°C</dd></div><div><dt>Humidity</dt><dd>${Math.round(wx.rh)}%</dd></div><div><dt>UV max</dt><dd class="uv-val uv-${uv?.key || "na"}">${uv ? `${Math.round(wx.uv)} ${uv.name}` : "Not known"}</dd></div></dl>`
        : leg.lat != null
          ? `<p class="note">${icon("info")} Weather appears after you build the forecast.</p>`
          : ""
    }
    ${
      ed
        ? editor(leg, i)
        : `<div class="row spread"><button type="button" class="link-btn" data-edit="${i}">Change city or dates<span class="sr-only"> for stop ${i + 1}</span></button>${trip.legs.length > 1 ? `<button type="button" class="icon-del" data-del="${i}">${icon("trash")}<span class="sr-only">Remove stop ${i + 1}${leg.name ? `, ${esc(leg.name)}` : ""}</span></button>` : ""}</div>`
    }
  </section>`;
}

function editor(leg, i) {
  return `<div class="stack-sm" data-editor="${i}">
    <div class="field combo">
      <label for="city-${i}">City</label>
      <input type="text" id="city-${i}" data-city="${i}" value="${esc(leg.name)}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="city-list-${i}" aria-describedby="city-hint-${i}" placeholder="Type a city, e.g. Lisbon">
      <span class="hint" id="city-hint-${i}">Type at least 2 letters, then choose from the list.</span>
      <ul class="combo-list" id="city-list-${i}" role="listbox" hidden aria-label="Matching cities"></ul>
    </div>
    <div class="grid-2">
      <div class="field"><label for="from-${i}">Arrive</label><input type="date" id="from-${i}" data-from="${i}" value="${esc(leg.from)}" min="${today()}" max="${addDays(today(), 365)}"></div>
      <div class="field"><label for="to-${i}">Leave</label><input type="date" id="to-${i}" data-to="${i}" value="${esc(leg.to)}" min="${today()}" max="${addDays(today(), 400)}"></div>
    </div>
    <div class="row spread"><button type="button" class="btn btn-soft" data-done="${i}">${icon("check")} Done</button>${trip.legs.length > 1 ? `<button type="button" class="icon-del" data-del="${i}">${icon("trash")}<span class="sr-only">Remove stop ${i + 1}</span></button>` : ""}</div>
  </div>`;
}

function flightCard(i) {
  const a = trip.legs[i];
  const b = trip.legs[i + 1];
  const f = flightBetween(i);
  if (!f)
    return `<div class="flight"><button type="button" class="link-btn" data-addflight="${i}">${icon("plane")} Add a flight${a.name && b.name ? ` from ${esc(a.name)} to ${esc(b.name)}` : ""}</button></div>`;
  const fi = trip.flights.indexOf(f);
  return `<section class="flight" aria-label="Flight to ${esc(b.name || "the next stop")}">
    <p class="flight-head">${icon("plane")} ${esc(fmtH(f.hours))} in the air · ${fmtDate(f.date)}</p>
    <p>${esc(a.name || "…")} → ${esc(b.name || "…")}</p>
    <div class="warn-box">${icon("drop")}<p><strong>Cabin air is very dry</strong> (often under 20% humidity). Your forecast adds a flight-day plan.</p></div>
    <div class="grid-2">
      <div class="field"><label for="fd-${fi}">Flight date</label><input type="date" id="fd-${fi}" data-fdate="${fi}" value="${esc(f.date)}"></div>
      <div class="field"><label for="fh-${fi}">Hours in the air</label><input type="number" id="fh-${fi}" data-fhours="${fi}" value="${esc(f.hours)}" min="0.5" max="20" step="0.5" inputmode="decimal"></div>
    </div>
    <button type="button" class="link-btn" data-delflight="${fi}">Remove this flight</button>
  </section>`;
}
const fmtH = (h) => {
  const n = Number(h);
  const hh = Math.floor(n);
  const mm = Math.round((n - hh) * 60);
  return mm ? `${hh}h ${mm}m` : `${hh}h`;
};

function render(focusSel) {
  const st = load();
  view.innerHTML = `
  <div class="cols">
    <div class="legs" id="legs">
      ${trip.legs.map((l, i) => legCard(l, i) + (i < trip.legs.length - 1 ? flightCard(i) : "")).join("")}
      ${trip.legs.length < MAX_LEGS ? `<button type="button" class="btn btn-soft btn-block" id="add-leg">${icon("plusCircle")} Add another destination</button>` : `<p class="note">Up to ${MAX_LEGS} cities per trip.</p>`}
    </div>
    <div class="sticky-col stack">
      ${!st.profile ? `<div class="alert alert-info">${icon("info")}<div><p><strong>Read your skin first</strong> for a forecast made for you.</p><p class="row gap"><a class="btn btn-secondary" href="/scan">Use my selfie</a><a class="btn btn-secondary" href="/scan?manual=1">Choose by hand</a></p></div></div>` : ""}
      <section class="card" aria-labelledby="carry-h">
        <label class="switch-row"><span class="row gap" style="flex-wrap:nowrap"><span class="leg-num" aria-hidden="true">${icon("luggage")}</span><span><strong id="carry-h">Carry-on bag only</strong><span class="block small muted">Liquids under 100 ml each (carry-on liquids rule).</span></span></span><input type="checkbox" role="switch" class="switch" id="carry" ${trip.carryOn !== false ? "checked" : ""}></label>
        <p class="note">${icon("shieldCheck")} When this is on, your kit only suggests liquids under 100 ml. Rules differ by airport: check yours.</p>
      </section>
      <div id="trip-err"></div>
      <button type="button" class="btn btn-primary btn-block" id="go">${icon("sunrise")} See my day-by-day forecast ${icon("arrow")}</button>
      ${!st.demo ? `<p class="center"><button type="button" class="link-btn" id="fill-demo">Fill in the demo trip (London → Lagos → Cape Town)</button></p>` : ""}
    </div>
  </div>`;
  if (focusSel) $(focusSel)?.focus();
}

/* ---------- city search ---------- */

let timer = null;
let results = [];
let active = -1;

function openList(i, items) {
  const list = $(`#city-list-${i}`);
  const input = $(`#city-${i}`);
  results = items;
  active = -1;
  if (!items.length) {
    list.innerHTML = `<li role="option" aria-disabled="true" class="subtle">No matching cities</li>`;
  } else {
    list.innerHTML = items
      .map((r, k) => `<li role="option" id="opt-${i}-${k}" data-pick="${k}" aria-selected="false">${esc(r.name)}<span class="block subtle">${esc([r.admin1, r.country].filter(Boolean).join(", "))}</span></li>`)
      .join("");
  }
  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
  announce(items.length ? `${items.length} cities found. Use the arrow keys to choose.` : "No matching cities.");
}
function closeList(i) {
  const list = $(`#city-list-${i}`);
  if (!list) return;
  list.hidden = true;
  $(`#city-${i}`)?.setAttribute("aria-expanded", "false");
  $(`#city-${i}`)?.removeAttribute("aria-activedescendant");
}
function pick(i, k) {
  const r = results[k];
  if (!r) return;
  Object.assign(trip.legs[i], { name: r.name, country: r.country || "", lat: r.lat, lon: r.lon, timezone: r.timezone });
  closeList(i);
  save();
  render(`#from-${i}`);
  announce(`${r.name} chosen.`);
}

view.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.city != null) {
    const i = Number(t.dataset.city);
    trip.legs[i].lat = null; // typed text no longer matches a picked city
    clearTimeout(timer);
    const qv = t.value.trim();
    if (qv.length < 2) return closeList(i);
    timer = setTimeout(async () => {
      try {
        const { results: rs = [] } = await places(qv);
        if ($(`#city-${i}`)?.value.trim() === qv) openList(i, rs);
      } catch (err) {
        const list = $(`#city-list-${i}`);
        list.innerHTML = `<li role="option" aria-disabled="true">${esc(err.message)}</li>`;
        list.hidden = false;
      }
    }, 280);
  }
});

view.addEventListener("keydown", (e) => {
  const t = e.target;
  if (t.dataset.city == null) return;
  const i = Number(t.dataset.city);
  const list = $(`#city-list-${i}`);
  if (list.hidden || !results.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
    $$("li", list).forEach((li, k) => li.setAttribute("aria-selected", String(k === active)));
    t.setAttribute("aria-activedescendant", `opt-${i}-${active}`);
    $(`#opt-${i}-${active}`)?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    pick(i, active < 0 ? 0 : active);
  } else if (e.key === "Escape") closeList(i);
});

view.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.from != null) {
    const leg = trip.legs[Number(t.dataset.from)];
    const oldFrom = leg.from;
    leg.from = t.value;
    if (leg.to < leg.from) leg.to = leg.from;
    // Keep a flight that landed on the old arrival day attached to the leg.
    const f = (trip.flights || []).find((x) => x.date === oldFrom);
    if (f) f.date = leg.from;
  } else if (t.dataset.to != null) trip.legs[Number(t.dataset.to)].to = t.value;
  else if (t.dataset.fdate != null) trip.flights[Number(t.dataset.fdate)].date = t.value;
  else if (t.dataset.fhours != null) trip.flights[Number(t.dataset.fhours)].hours = Number(t.value);
  else if (t.id === "carry") trip.carryOn = t.checked;
  else return;
  save();
});

view.addEventListener("click", (e) => {
  const b = e.target.closest("button, li[data-pick]");
  if (!b) return;
  const d = b.dataset;
  if (d.pick != null) {
    const i = Number(b.closest("ul").id.split("-").pop());
    return pick(i, Number(d.pick));
  }
  if (d.edit != null) {
    editing.add(Number(d.edit));
    return render(`#city-${d.edit}`);
  }
  if (d.done != null) {
    const i = Number(d.done);
    if (trip.legs[i].lat == null) {
      $(`#city-hint-${i}`).innerHTML = `<span class="err">Choose a city from the list first.</span>`;
      return $(`#city-${i}`).focus();
    }
    editing.delete(i);
    return render(`[data-edit="${i}"]`);
  }
  if (d.del != null) {
    const i = Number(d.del);
    const gone = trip.legs.splice(i, 1)[0];
    trip.flights = (trip.flights || []).filter((f) => f.date !== gone.from);
    editing = new Set([...editing].filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)));
    save();
    announce(`Removed ${gone.name || "stop"}.`);
    return render("#add-leg");
  }
  if (d.addflight != null) {
    const next = trip.legs[Number(d.addflight) + 1];
    trip.flights = [...(trip.flights || []), { date: next.from, hours: 3 }];
    save();
    return render(`#fh-${trip.flights.length - 1}`);
  }
  if (d.delflight != null) {
    trip.flights.splice(Number(d.delflight), 1);
    save();
    return render();
  }
  if (b.id === "add-leg") {
    trip.legs.push(blankLeg());
    editing.add(trip.legs.length - 1);
    save();
    return render(`#city-${trip.legs.length - 1}`);
  }
  if (b.id === "fill-demo") {
    trip = demoTrip();
    editing.clear();
    save();
    announce("Demo trip filled in.");
    return render("#go");
  }
  if (b.id === "go") return go();
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".combo")) $$(".combo-list").forEach((l) => (l.hidden = true));
});

function save() {
  update((s) => {
    s.trip = trip;
    s.forecast = null;
    s.kit = null;
  });
}

function validate() {
  const legs = trip.legs;
  for (const [i, l] of legs.entries()) {
    if (l.lat == null) return [`Stop ${i + 1}: choose a city from the list.`, `#city-${i}`, i];
    if (!l.from || !l.to || l.to < l.from) return [`Stop ${i + 1}: the leave date must be on or after the arrive date.`, `#to-${i}`, i];
    if (i > 0 && l.from < legs[i - 1].to) return [`Stop ${i + 1} starts before stop ${i} ends.`, `#from-${i}`, i];
  }
  if (legs[0].from < today()) return ["The trip can't start in the past.", "#from-0", 0];
  if (daysBetween(today(), legs[0].from) > 365) return ["The trip must start within a year.", "#from-0", 0];
  if (daysBetween(legs[0].from, legs.at(-1).to) + 1 > MAX_DAYS) return [`Trips can be up to ${MAX_DAYS} days.`, `#to-${legs.length - 1}`, legs.length - 1];
  for (const f of trip.flights || []) if (!(f.hours >= 0.5 && f.hours <= 20)) return ["Flight hours must be between 0.5 and 20.", null, null];
  return null;
}

function go() {
  const bad = validate();
  const box = $("#trip-err");
  if (bad) {
    const [msg, sel, i] = bad;
    if (i != null && !editing.has(i)) {
      editing.add(i);
      render();
    }
    $("#trip-err").innerHTML = errorBox({ message: msg });
    announce(msg);
    if (sel) $(sel)?.focus();
    return;
  }
  box.innerHTML = "";
  save();
  location.href = "/forecast";
}

render();
focusHeading();
