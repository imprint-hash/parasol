// /rescan: compare a new scan with a baseline and the weather since arrival.
import { shell, esc, icon, $, $$, errorBox, loading, fmtDate, photoImg, productThumb, productName, money } from "./ui.js";
import { load, update, addScan, todayIn, PERSONAS, profileForApi, DEMO_RESCAN_CITY } from "./state.js";
import { demoScan, liveScan, compare, kit as getKit } from "./api.js";
import { preparePhoto } from "./camera.js";
import { announce, focusHeading } from "./a11y.js";
import { METRICS } from "./parts.js";
import { SLOT_NAMES } from "./kit-names.js";

const view = $("#view");
const q = new URLSearchParams(location.search);
let speech = "Mid-trip skin check. Scan again after a bad day, and Parasol compares it with your first scan and the weather since you arrived.";
let photo = null;

shell({ page: "rescan", speechText: () => speech });

const REPORT = [
  ["sun", "I spent time in the sun"],
  ["newProduct", "I started a new product"],
  ["water", "The water felt different"],
  ["sleep", "I slept badly"],
];
const CONSENT =
  "Your photo is sent to YouCam (Perfect Corp.) for skin analysis and is not stored by Parasol. We keep only the scores, linked to a fingerprint of the photo so a repeat scan costs nothing. You can delete them any time in My data. Not medical advice.";

function baselines() {
  return load().scans.filter((s) => s.kind !== "rescan");
}

/** Days since arrival in the current city (≤10), from the saved forecast. */
function daysSinceArrival(demo) {
  const st = load();
  const days = st.forecast?.days || [];
  const slim = (d) => ({ date: d.date, city: d.city, kind: d.kind, wx: d.wx });
  if (demo) {
    // Demo: "Day 3 in Dubai" = the first three Dubai days, flight day included.
    return days.filter((d) => d.city === DEMO_RESCAN_CITY).slice(0, 3).map(slim);
  }
  const legs = st.trip?.legs || [];
  const leg = legs.find((l) => {
    const t = todayIn(l.timezone);
    return l.from <= t && t <= l.to;
  });
  if (!leg) return [];
  const t = todayIn(leg.timezone);
  return days.filter((d) => d.city === leg.name && d.date >= leg.from && d.date <= t).slice(-10).map(slim);
}

function start() {
  const st = load();
  const bases = baselines();
  const persona = st.demo ? PERSONAS[st.demo] : null;
  const demoBase = persona ? bases.find((s) => s.demo?.persona === persona.id) : null;
  if (!bases.length) {
    view.innerHTML = `<div class="card stack-sm"><h2>No first scan yet</h2><p class="muted">A rescan compares against your first scan. Start there, or try the demo.</p><p class="row gap"><a class="btn btn-primary" href="/scan">Use my selfie</a><a class="btn btn-secondary" href="/#demo">Try the demo</a></p></div>`;
    return;
  }
  const defBase = (demoBase || bases[0]).id;
  view.innerHTML = `
  <div id="result"></div>
  <div class="cols">
    <div class="stack">
      <fieldset class="card" aria-describedby="base-hint">
        <legend><h2 style="font-size:1.25rem">Compare with</h2></legend>
        <p class="small muted" id="base-hint" style="margin-top:.5rem">Your earlier scans on this device.</p>
        <ul class="history" style="margin-top:.75rem">${bases
          .map(
            (s) =>
              `<li><label><input type="radio" name="base" value="${esc(s.id)}" ${s.id === defBase ? "checked" : ""}><span><strong class="block">${s.demo ? `Demo: ${esc(PERSONAS[s.demo.persona]?.name || s.demo.persona)}` : "Your scan"}</strong><span class="small muted">${new Date(s.takenAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span></span></label></li>`
          )
          .join("")}</ul>
      </fieldset>
      <fieldset class="card">
        <legend><h2 style="font-size:1.25rem">Since you arrived…</h2></legend>
        <p class="small muted" style="margin-top:.5rem">Tick anything that applies. It helps explain the change.</p>
        <div class="stack-sm" style="margin-top:.75rem">${REPORT.map(([k, t]) => `<label class="check-row"><input type="checkbox" name="sr" value="${k}"><span>${t}</span></label>`).join("")}</div>
      </fieldset>
    </div>
    <div class="stack">
      ${
        persona
          ? `<section class="dk stack-sm" aria-labelledby="demo-h"><h2 id="demo-h">Demo: Day 3 in ${DEMO_RESCAN_CITY}</h2><p>${esc(persona.name)}'s Day 3 photo was made with YouCam Skin Simulation from the first photo, then analysed by YouCam.</p><button type="button" class="btn btn-primary btn-block" id="run-demo">Compare ${esc(persona.name)}'s Day 3 scan ${icon("arrow")}</button></section>`
          : ""
      }
      <section class="card" aria-labelledby="new-h">
        <h2 id="new-h">${icon("camera")} Take a new photo</h2>
        <p class="muted small" id="rc-consent">${esc(CONSENT)}</p>
        <label class="check-row"><input type="checkbox" id="consent" aria-describedby="rc-consent rc-err"><span><strong>I agree.</strong> Send my photo to YouCam for analysis.</span></label>
        <p class="err" id="rc-err" hidden>Please tick the box to agree first.</p>
        <input type="file" accept="image/*" capture="user" id="cam" class="file-hidden"><label for="cam" class="upload-btn">${icon("camera")} Take or choose a photo</label>
        <div id="prev"></div>
        <button type="button" class="btn btn-secondary btn-block" id="run-live" disabled>Analyse and compare</button>
      </section>
      <div id="msg"></div>
    </div>
  </div>`;

  $("#cam").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      photo = await preparePhoto(f);
      $("#prev").innerHTML = `<img src="${photo.previewUrl}" alt="Your new photo" style="max-height:14rem;margin:0 auto;border-radius:var(--r)">`;
      $("#run-live").disabled = false;
    } catch (err) {
      $("#prev").innerHTML = errorBox(err);
    }
  });
  $("#run-demo")?.addEventListener("click", () => run("demo"));
  $("#run-live").addEventListener("click", () => run("live"));
  if (q.get("demo") && persona && load().rescan?.persona === persona.id) showResult(load().rescan);
}

async function run(mode) {
  const st = load();
  const base = st.scans.find((s) => s.id === $('input[name="base"]:checked')?.value);
  if (mode === "live" && !$("#consent").checked) {
    $("#rc-err").hidden = false;
    $("#consent").focus();
    return;
  }
  const selfReport = Object.fromEntries(REPORT.map(([k]) => [k, !!$(`input[name="sr"][value="${k}"]`)?.checked]));
  const msg = $("#msg");
  msg.innerHTML = loading(mode === "demo" ? "Comparing the Day 3 scan…" : "Analysing your new photo…");
  announce("Comparing your scans.");
  try {
    const { scan: current } = mode === "demo" ? await demoScan(st.demo, "rescan") : await liveScan(photo.dataUrl);
    addScan(current);
    const days = daysSinceArrival(mode === "demo");
    const r = await compare({
      baseline: base.skin.scores,
      current: current.skin.scores,
      profile: profileForApi(st.profile),
      days,
      selfReport,
    });
    const saved = { at: Date.now(), persona: mode === "demo" ? st.demo : null, baseId: base.id, base: slim(base), current: slim(current), days: days.map((d) => ({ date: d.date, city: d.city })), r };
    update((s) => (s.rescan = saved));
    msg.innerHTML = "";
    showResult(saved, true);
  } catch (err) {
    msg.innerHTML = errorBox(err, { demo: err.code === "live_off" });
    announce(err.message);
  }
}

const slim = (s) => ({ id: s.id, takenAt: s.takenAt, scores: s.skin?.scores, face: s.demo?.face?.image || null, credit: s.demo?.face?.credit || null, simulated: s.demo?.simulated || null });

async function showResult(saved, focus = false) {
  const { r, base, current } = saved;
  const worse = (r.changes || []).filter((c) => c.worse);
  const city = saved.days?.at(-1)?.city || "";
  speech =
    `Mid-trip skin check. ` +
    (worse.length ? worse.map((c) => `${METRICS[c.metric]?.name || c.metric} went from ${c.before} to ${c.after}.`).join(" ") : "No change beyond normal day to day differences. ") +
    (r.causes || []).map((c) => `${c.confidence === "likely" ? "Likely" : "Possible"} cause: ${c.label}. ${c.evidence || ""}`).join(" ") +
    (r.tonight?.length ? ` Tonight: ${r.tonight.join(". ")}.` : "") +
    ` ${r.safety || ""}`;
  const box = $("#result");
  box.innerHTML = `
  <section class="dk" aria-labelledby="res-h">
    <div class="card-head"><h2 id="res-h" tabindex="-1">Your skin, then and now</h2>${saved.persona ? `<span class="badge badge-glass">Demo</span>` : ""}</div>
    <div class="ba">
      <figure><div class="ba-img">${base.face ? `<img src="${esc(base.face)}" alt="First scan photo">` : icon("face")}<span class="ba-tag glass">Before</span></div><figcaption><strong>First scan</strong>${new Date(base.takenAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</figcaption></figure>
      <figure class="now"><div class="ba-img">${current.face ? `<img src="${esc(current.face)}" alt="Day 3 photo">` : icon("face")}<span class="ba-tag glass">Now</span></div><figcaption><strong>${esc(current.simulated?.label || (saved.persona ? `Day 3 in ${DEMO_RESCAN_CITY}` : "New scan"))}</strong>${city ? esc(city) : ""}</figcaption></figure>
    </div>
    ${current.simulated?.note ? `<p class="credit">${esc(current.simulated.note)}</p>` : ""}
    ${base.credit ? `<p class="credit">${esc(base.credit)}</p>` : ""}
  </section>
  <div class="cols" style="margin-top:var(--gap)">
    <div class="stack">
      <section class="dk" aria-labelledby="ch-h">
        <div class="card-head"><h2 id="ch-h">What changed</h2><span class="small muted">Higher score = healthier</span></div>
        ${
          worse.length
            ? worse.map(changeRow).join("")
            : `<p class="note">${icon("checkCircle")} No score changed by more than normal day-to-day differences.</p>`
        }
        ${(r.changes || []).filter((c) => !c.worse).length ? `<details class="more"><summary>All scores</summary><div class="table-wrap"><table class="data"><thead><tr><th scope="col">Measure</th><th scope="col" class="num">Before</th><th scope="col" class="num">Now</th><th scope="col" class="num">Change</th></tr></thead><tbody>${r.changes.map((c) => `<tr><td>${esc(METRICS[c.metric]?.name || c.metric)}</td><td class="num">${c.before}</td><td class="num">${c.after}</td><td class="num">${c.delta > 0 ? "+" : ""}${c.delta}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
      </section>
      <section class="card-tint stack-sm" aria-labelledby="cause-h">
        <h2 id="cause-h">${icon("thermo")} ${r.causes?.length ? "What may explain it" : "Likely cause"}</h2>
        ${
          r.causes?.length
            ? r.causes.map((c) => `<div class="cause">${icon(c.confidence === "likely" ? "warn" : "info")}<div><p><strong>${esc(c.label)}</strong> <span class="badge ${c.confidence === "likely" ? "badge-warm" : "badge-neutral"}">${c.confidence === "likely" ? "Likely" : "Possible"}</span></p>${c.evidence ? `<p class="c-ev">${esc(c.evidence)}</p>` : ""}</div></div>`).join("")
            : `<p class="cause">${icon("info")} The weather doesn't explain this change.</p>`
        }
      </section>
    </div>
    <div class="stack">
      ${
        r.tonight?.length
          ? `<section class="card" aria-labelledby="tn-h"><div class="card-head"><h2 id="tn-h">Tonight</h2><span aria-hidden="true" style="color:var(--primary)">${icon("moon")}</span></div><div class="stack-sm">${r.tonight.map((t) => `<label class="check-row"><input type="checkbox"><span>${esc(t)}</span></label>`).join("")}</div></section>`
          : ""
      }
      <div id="add"></div>
      <p class="safety" role="note">${icon("warn")}<span>${esc(r.safety || "Blistering, fever, swelling near the eyes, or a rash that spreads: see a pharmacist or doctor.")}</span></p>
      <p class="credit">Not medical advice. Changes are "likely" or "possible", never certain.</p>
      <a class="btn btn-primary btn-block" href="/today">Go to today's routine ${icon("arrow")}</a>
    </div>
  </div>`;
  if (focus) {
    $("#res-h").focus();
    announce("Comparison ready.");
  }
  if (r.needs?.length) productsToAdd(r.needs);
}

function changeRow(c) {
  const name = METRICS[c.metric]?.name || c.metric;
  return `<div class="change"><div class="row spread"><strong>${esc(name)}</strong><span class="c-vals"><s aria-hidden="true">${c.before}</s><span class="worse">${c.after}</span><span class="sr-only">: from ${c.before} to ${c.after}</span></span></div>
    <div class="bar-track" aria-hidden="true"><div class="bar-fill strong" style="width:${Math.max(3, c.after)}%"></div></div>
    <p class="c-note">${icon("warn")} ${Math.abs(c.delta)} points worse</p></div>`;
}

async function productsToAdd(needs) {
  const st = load();
  const box = $("#add");
  try {
    const res = await getKit(profileForApi(st.profile), needs, st.trip?.carryOn !== false);
    const have = new Set([...(st.kit?.res?.slots || []).map((s) => s.slot), ...(st.kit?.extra || []).map((x) => x.slot)]);
    const picks = res.slots.filter((s) => s.pick && !have.has(s.slot)).slice(0, 3);
    if (!picks.length) return;
    box.innerHTML = `<section class="card stack-sm" aria-labelledby="add-h"><h2 id="add-h">Products to add</h2><ul class="acards acards-wide">${picks
      .map((s) => {
        const n = productName(s.pick);
        const full = [n.brand, n.name].filter(Boolean).join(" ");
        return `<li class="acard">
          <div class="ac-img">${photoImg(s.pick, productThumb({ ...s.pick, handle: null, image: null }))}</div>
          <p class="ac-brand">${esc(n.brand)}</p>
          <p class="ac-name">${esc(n.name)}</p>
          <p class="ac-price">${money(s.pick.price, s.pick.currency)}<span class="muted"> · ${esc(SLOT_NAMES[s.slot] || s.slot)}</span></p>
          ${s.why?.length ? `<ul class="chips" aria-label="Why ${esc(full)}">${s.why.slice(0, 3).map((w) => `<li class="chip">${esc(w)}</li>`).join("")}</ul>` : ""}
          <button type="button" class="btn btn-soft ac-btn" data-add="${esc(s.slot)}">Add<span class="sr-only"> ${esc(full)} to my kit</span></button>
        </li>`;
      })
      .join("")}</ul></section>`;
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-add]");
      if (!b) return;
      const s = picks.find((x) => x.slot === b.dataset.add);
      update((st2) => {
        if (!st2.kit) return;
        st2.kit.extra = [...(st2.kit.extra || []), { slot: s.slot, product: s.pick }];
      });
      b.outerHTML = load().kit ? `<span class="badge badge-blue">${icon("check")} Added</span>` : `<a class="small" href="/kit">Open your kit first</a>`;
      announce(`${s.pick.title} added to your kit.`);
    });
  } catch {
    // Optional extra: skip quietly if the shop can't answer.
  }
}

start();
focusHeading();
