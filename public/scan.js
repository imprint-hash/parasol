// /scan: consent → capture → progress → result. Also the manual profile
// (?manual=1) and showing a saved result (?result=<id>, ?demo=<persona>).
import { shell, esc, icon, errorBox, $, $$, setRibbonNext } from "./ui.js";
import { load, update, addScan, profileFromScan, PERSONAS } from "./state.js";
import { liveScan, config } from "./api.js";
import { preparePhoto } from "./camera.js";
import { announce, focusHeading, setPref, lowVisionOn } from "./a11y.js";
import { faceDiagram, concernBars, fitzScale, FITZ, SKIN_TYPES, METRICS, zoneWord, scoreGauge, scoreLabel, albinismNote } from "./parts.js";

const avgScore = (sc = {}) => {
  const v = Object.values(sc).map(Number).filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
};

const view = $("#view");
const h1 = $("#h1");
const stepper = $("#stepper");
const q = new URLSearchParams(location.search);
let speech = "";
let photo = null; // { dataUrl, previewUrl } kept in memory only, never saved

shell({ page: "scan", speechText: () => speech });

const CONSENT =
  "Your photo is sent to YouCam (Perfect Corp.) for skin analysis and is not stored by Parasol. We keep only the scores, linked to a fingerprint of the photo so a repeat scan costs nothing. You can delete them any time in My data. Not medical advice.";

const TIPS = [
  ["sun", "Even daylight", "Face a window. Avoid strong light from behind you"],
  ["glasses", "No glasses or hat", "Keep your forehead and cheeks clear"],
  ["smile", "Face forward, relaxed", "Look straight at the camera, at eye level"],
  ["face", "Hair off your forehead", "Tie it back if you can"],
];

function title(text, step) {
  h1.textContent = text;
  document.title = `${text} · Parasol`;
  stepper.textContent = step;
}

/* ---------- consent + capture ---------- */

async function showCapture() {
  title("Let's read your skin", "Step 1 of 2: Quick skin read");
  const saved = load().scans[0];
  speech =
    "Let's read your skin. First, the consent: " + CONSENT + " Tips for a good photo: " + TIPS.map((t) => `${t[1]}. ${t[2]}.`).join(" ") + " Then take a photo or upload one, and press Analyse.";
  view.innerHTML = `
  <div class="cols">
    <div>
      <p class="lede">We look at two things: your skin type and how fast you burn.</p>
      ${saved ? `<p class="note">${icon("info")} You already have a result. <a href="/scan?result=${esc(saved.id)}">See it</a>.</p>` : ""}
      <div id="live-off"></div>
      <section class="card" aria-labelledby="consent-h">
        <div class="consent"><span class="c-dot" aria-hidden="true">${icon("lock")}</span><div class="stack-sm">
          <h2 id="consent-h" style="font-size:1.1875rem">Before you take a photo</h2>
          <p class="muted" id="consent-text">${esc(CONSENT)}</p>
        </div></div>
        <label class="check-row"><input type="checkbox" id="consent" aria-describedby="consent-text consent-err"><span><strong>I agree.</strong> Send my photo to YouCam for analysis.</span></label>
        <p class="err" id="consent-err" hidden>Please tick the box to agree before we analyse your photo.</p>
      </section>
      <div class="viewfinder" id="vf">
        <span class="vf-tag">${icon("sun")} Even light</span>
        <div class="vf-guide" aria-hidden="true"></div>
        <div class="vf-empty"><p>Your photo appears here. Fit your face inside the outline.</p></div>
      </div>
    </div>
    <div>
      <section aria-labelledby="tips-h"><h2 id="tips-h" class="sr-only">Photo tips</h2>
        <ul class="tips">${TIPS.map(([ic, t, d]) => `<li class="tip"><span class="t-ic" aria-hidden="true">${icon(ic)}</span><div><strong>${t}</strong><span>${d}</span></div></li>`).join("")}</ul>
      </section>
      <div class="shutter" style="margin-top:1.5rem">
        <input type="file" accept="image/*" capture="user" id="cam" class="file-hidden">
        <label for="cam" class="shutter-btn">${icon("camera")}<span class="sr-only">Take a photo</span></label>
        <label for="cam" aria-hidden="true">Take photo</label>
      </div>
      <div style="margin-top:1rem">
        <input type="file" accept="image/jpeg,image/png" id="upl" class="file-hidden">
        <label for="upl" class="upload-btn">${icon("image")} Or upload a photo</label>
      </div>
      <div id="photo-msg" style="margin-top:1rem"></div>
      <button type="button" class="btn btn-primary btn-block" id="analyse" style="margin-top:1rem" disabled>${icon("sparkle")} Analyse my skin</button>
      <ol class="progress-steps" id="progress" hidden style="margin-top:1rem" aria-label="Progress"></ol>
      <div id="scan-msg" style="margin-top:1rem"></div>
      <p class="center" style="margin-top:1rem"><a href="/scan?manual=1">Skip the selfie: choose by hand</a> · <a href="/#demo">Try the demo</a></p>
    </div>
  </div>`;

  config().then((c) => {
    if (c.liveScans === false) {
      $("#live-off").innerHTML = `<div class="alert alert-info">${icon("info")}<div><p><strong>Live scans are paused right now.</strong></p><p>Try the demo, or choose your skin by hand.</p><p class="row gap"><a class="btn btn-secondary" href="/#demo">Try the demo</a></p></div></div>`;
    }
  });

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const msg = $("#photo-msg");
    msg.innerHTML = "";
    try {
      photo = await preparePhoto(f);
      $("#vf").innerHTML = `<img class="preview" src="${photo.previewUrl}" alt="Your photo, ready to analyse"><span class="vf-hint">Photo ready</span>`;
      $("#analyse").disabled = false;
      announce("Photo ready. Press Analyse my skin.");
    } catch (err) {
      photo = null;
      $("#analyse").disabled = true;
      msg.innerHTML = errorBox(err);
    }
  };
  $("#cam").addEventListener("change", onFile);
  $("#upl").addEventListener("change", onFile);
  $("#consent").addEventListener("change", (e) => {
    if (e.target.checked) $("#consent-err").hidden = true;
  });
  $("#analyse").addEventListener("click", analyse);
}

const STEPS = ["Uploading your photo", "Reading your skin", "Checking how fast you burn"];

async function analyse() {
  const consent = $("#consent");
  if (!consent.checked) {
    $("#consent-err").hidden = false;
    consent.setAttribute("aria-invalid", "true");
    consent.focus();
    return;
  }
  consent.removeAttribute("aria-invalid");
  if (!photo) return;
  const btn = $("#analyse");
  btn.disabled = true;
  const list = $("#progress");
  list.hidden = false;
  $("#scan-msg").innerHTML = "";
  let step = 0;
  const paint = () => {
    list.innerHTML = STEPS.map((s, i) => `<li data-s="${i < step ? "done" : i === step ? "now" : "todo"}">${icon(i < step ? "checkCircle" : i === step ? "sun" : "clock", i === step ? "spin" : "")}${s}</li>`).join("");
    announce(`${STEPS[Math.min(step, STEPS.length - 1)]}…`);
  };
  paint();
  // The server does all three in one request; these steps show it is still working.
  const timers = [setTimeout(() => ((step = 1), paint()), 2500), setTimeout(() => ((step = 2), paint()), 9000)];
  try {
    const { scan } = await liveScan(photo.dataUrl);
    timers.forEach(clearTimeout);
    addScan(scan);
    update((s) => {
      s.demo = null;
      s.profile = profileFromScan(scan);
      s.profile.fitzFromScan = scan.fitz?.scale || null;
    });
    announce("Done. Your skin result is ready.");
    history.replaceState(null, "", `/scan?result=${encodeURIComponent(scan.id)}`);
    showResult(scan, true);
  } catch (err) {
    timers.forEach(clearTimeout);
    list.hidden = true;
    btn.disabled = false;
    const tipCodes = ["no_face", "face_angle", "face_position", "multiple_faces", "lighting", "too_small"];
    $("#scan-msg").innerHTML = errorBox(err, { demo: err.code === "live_off" || err.status >= 500 || err.status === 429 });
    if (tipCodes.includes(err.code)) $("#scan-msg").insertAdjacentHTML("beforeend", `<p class="note" style="margin-top:.5rem">Take a new photo with the tips above, then try again.</p>`);
    $("#scan-msg [role=alert]")?.focus?.();
    announce(err.message);
  }
}

/* ---------- result ---------- */

function showResult(scan, fresh = false) {
  const st = load();
  const demo = scan.demo || null;
  const persona = demo ? PERSONAS[demo.persona] : null;
  const prof = st.profile || profileFromScan(scan);
  const fitz = prof.fitz || scan.fitz?.scale || "III";
  const albinism = !!prof.albinism;
  const skin = scan.skin || {};
  const type = SKIN_TYPES[skin.type] || SKIN_TYPES.normal;
  title(persona ? `${persona.name}'s skin profile` : "Your skin profile", demo ? "Demo result" : "Analysis complete");
  const faceImg = demo?.face?.image || (fresh && photo?.previewUrl) || null;
  const masks = Object.entries(scan.masks || {}).filter(([k]) => METRICS[k]);
  const fitzNote = scan.fitz?.scale
    ? albinism && scan.fitz.scale !== "I"
      ? `YouCam read ${scan.fitz.scale} from the photo. ${persona ? persona.name + " has" : "You have"} albinism, so Parasol uses I, the most careful setting.`
      : `YouCam read ${scan.fitz.scale} (${FITZ[scan.fitz.scale]?.cap || ""}) from the photo.`
    : "YouCam couldn't tell from this photo. Please choose how fast you burn.";

  speech =
    `${h1.textContent}. ${type.name}. T-zone: ${zoneWord(skin.tZone)}. Cheeks: ${zoneWord(skin.uZone)}. ` +
    `How fast you burn: ${FITZ[fitz].cap}. ${albinism ? "Albinism is on, so Parasol uses the most careful burn times. " : ""}` +
    (scan.concerns?.length ? `Things to watch: ${scan.concerns.map((c) => METRICS[c.metric]?.name).filter(Boolean).join(", ")}. ` : "No skin concerns stood out. ") +
    "Next, save your profile and plan your trip. Not medical advice.";

  // Four floating tags around the face (ref: dark AI skincare app).
  const TAGS = [
    ["texture", "Texture"],
    ["moisture", "Hydration"],
    ["pore", "Pores"],
    ["redness", "Redness"],
  ].filter(([k]) => Number.isFinite(Number(skin.scores?.[k])));
  const tag = ([k, name], i) => {
    const v = Math.round(skin.scores[k]);
    return `<span class="mtag glass t${i + 1}"><span class="mt-k">${esc(name)}</span><span class="mt-v">${scoreLabel(v).text} · ${v}</span></span>`;
  };
  const overall = Number.isFinite(Number(skin.overall)) ? skin.overall : avgScore(skin.scores);

  view.innerHTML = `
  ${demo ? `<p class="muted">Demo: real YouCam analysis of an AI-generated face. ${demo.placeholder ? "Placeholder face from YouCam's documentation." : ""}</p>` : `<p class="muted">From YouCam's skin analysis of your photo${scan.source === "cache" ? " (saved result, no new analysis needed)" : ""}.</p>`}
  ${albinismNote(prof)}
  ${albinism && scan.fitz?.scale && scan.fitz.scale !== "I" ? `<p class="fitz-note-strong">${esc(fitzNote)}</p>` : ""}
  <section class="card summary3" aria-labelledby="sum-h">
    <h2 id="sum-h" class="sr-only">Your result in short</h2>
    <ul class="plan">
      <li data-ic><span class="p-ic" aria-hidden="true">${icon("drop")}</span><span class="p-text"><span class="block small muted">Skin type</span>${esc(type.name)}</span></li>
      <li data-ic><span class="p-ic" aria-hidden="true">${icon("sun")}</span><span class="p-text"><span class="block small muted">How fast you burn</span><span id="sum-burn">${esc(FITZ[albinism ? "I" : fitz].cap)}${albinism ? " (albinism)" : ""}</span></span></li>
      <li data-ic><span class="p-ic" aria-hidden="true">${icon("search")}</span><span class="p-text"><span class="block small muted">Top concern</span>${scan.concerns?.length ? esc(METRICS[scan.concerns[0].metric]?.name || scan.concerns[0].metric) : "Nothing stood out"}</span></li>
    </ul>
  </section>
  <div class="cols">
    <section class="dk analysis" aria-labelledby="ana-h">
      <div class="row spread gap"><h2 id="ana-h" style="font-size:1.25rem">Skin analysis</h2><span class="badge badge-glass">${icon("sparkle")} YouCam Skin AI</span></div>
      <div class="face-stage">
        <div class="fs-photo">${
          faceImg
            ? `<img src="${esc(faceImg)}" alt="${persona ? `${esc(persona.name)}, AI-generated demo face` : "Your photo"}" id="face-img"><img class="mask" id="mask-img" alt="" hidden>`
            : `<div style="padding:12% 6%;background:var(--beige);height:100%">${faceDiagram(skin.tZone, skin.uZone)}</div>`
        }</div>
        <svg class="lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path d="M24 16 L40 26" vector-effect="non-scaling-stroke"/><path d="M76 26 L60 50" vector-effect="non-scaling-stroke"/>
          <path d="M24 66 L40 58" vector-effect="non-scaling-stroke"/><path d="M76 74 L58 66" vector-effect="non-scaling-stroke"/>
        </svg>
        ${TAGS.map(tag).join("")}
      </div>
      ${demo?.face?.credit ? `<p class="credit center">${esc(demo.face.credit)}</p>` : ""}
      <div class="center stack-sm">
        <p class="eyebrow" style="justify-content:center">Skin type</p>
        <p style="font-family:var(--f-display);font-size:1.75rem;line-height:1.1">${esc(type.name)}</p>
        <p class="muted">T-zone: <strong>${esc(zoneWord(skin.tZone))}</strong> · Cheeks: <strong>${esc(zoneWord(skin.uZone))}</strong></p>
      </div>
      ${
        faceImg && masks.length
          ? `<p class="small muted" style="font-weight:500" id="mask-lab">Show what YouCam saw</p><fieldset class="seg scroll" aria-labelledby="mask-lab" style="margin-top:.5rem"><legend class="sr-only">Show what YouCam saw</legend>
          <label><input type="radio" name="mask" value="" checked><span>Photo</span></label>
          ${masks.map(([k]) => `<label><input type="radio" name="mask" value="${esc(k)}"><span>${esc(METRICS[k].name)}</span></label>`).join("")}
        </fieldset>
        ${scan.masksExpireAt ? `<p class="credit center">These overlays come from YouCam and disappear after about 2 hours.</p>` : ""}`
          : ""
      }
    </section>
    <div>
      <section class="card stack" aria-label="Details">
<div id="pan-ov">
          <h2 id="type-h">${esc(type.name)}</h2>
          <p class="muted">${esc(type.line)}</p>
          <div class="face-wrap">
            <div class="face-legend" aria-hidden="true"><span><span class="dot" style="background:#d14221"></span>Oily</span><span><span class="dot" style="background:#0369a1"></span>Balanced</span><span><span class="dot" style="background:#9d6a00"></span>Dry</span></div>
            ${faceDiagram(skin.tZone, skin.uZone)}
          </div>
          ${scan.concerns?.length ? `<p><strong>Watch:</strong> ${scan.concerns.map((c) => esc(METRICS[c.metric]?.name || c.metric)).join(", ")}.</p>` : `<p class="muted">No skin concern stood out.</p>`}
          ${scan.tone?.hex ? `<p class="row gap"><span class="tone-sw" style="background:${esc(scan.tone.hex)}" aria-hidden="true"></span>Skin tone from YouCam: <strong>${esc(scan.tone.hex)}</strong></p>` : ""}
        </div>
          <details class="more"><summary>See all scores</summary><div>
            ${scoreGauge(overall, "Overall skin score")}
            ${skin.skinAge ? `<p class="center muted">Skin age ${esc(skin.skinAge)}</p>` : ""}
            <p class="muted small">Scores from 1 to 100. Higher is healthier.</p>
            ${concernBars(skin.scores)}
          </div></details>
        </div>
        <div id="pan-su" style="margin-top:1.5rem">
          <h2 id="fz-h">How fast you burn</h2>
          <p class="subtle small">From I (burns very easily) to VI (rarely burns)</p>
          <fieldset class="fitz-scale" id="fitz-set"><legend class="sr-only">How fast you burn</legend>${fitzScale(fitz)}</fieldset>
          <div class="card-warm" id="fitz-desc" aria-live="polite"></div>
          <p class="${albinism ? "fitz-note-strong" : "small muted"}">${esc(fitzNote)}</p>
          <div class="card-tint-2">
            <label class="switch-row"><span><strong>${persona ? esc(persona.name) + " has" : "I have"} albinism</strong><span class="block small muted">Uses the most careful burn times.</span></span><input type="checkbox" role="switch" class="switch" id="albinism" ${albinism ? "checked" : ""}></label>
            <div id="lv-offer"></div>
          </div>
          <p class="small muted">Not right? Tap a different one above.</p>
        </div>
      </section>
      <button type="button" class="btn btn-primary btn-block" id="save">Save profile and plan my trip ${icon("arrow")}</button>
      <p class="credit center">Your profile stays on this device and shapes your forecast, burn times and kit. Not medical advice.</p>
    </div>
  </div>`;

  const desc = () => {
    const v = $('#fitz-set input:checked')?.value || fitz;
    const alb = $("#albinism").checked;
    const shown = alb ? "I" : v;
    $("#sum-burn").textContent = `${FITZ[shown].cap}${alb ? " (albinism)" : ""}`;
    $("#fitz-desc").innerHTML = `<h3>${icon("sun")} ${shown}: ${esc(FITZ[shown].cap)}${alb ? " (albinism)" : ""}</h3><p>${esc(alb ? "With albinism skin has little or no melanin, so it can burn very fast. Parasol uses the shortest burn times and earlier protect hours." : FITZ[shown].line)}</p>`;
  };
  const persist = () => {
    const v = $('#fitz-set input:checked')?.value || fitz;
    const alb = $("#albinism").checked;
    update((s) => {
      s.profile = { ...profileFromScan(scan, { fitz: v, albinism: alb }), fitzFromScan: scan.fitz?.scale || null };
      s.forecast = null; // profile changed: forecast and kit must be rebuilt
      s.kit = null;
    });
  };
  desc();
  $("#fitz-set").addEventListener("change", (e) => {
    if ($("#albinism").checked && e.target.value !== "I") $("#albinism").checked = false;
    // redraw the scale so the tick moves
    $("#fitz-set").innerHTML = `<legend class="sr-only">How fast you burn</legend>${fitzScale(e.target.value)}`;
    $(`#fitz-set input[value="${e.target.value}"]`).focus();
    desc();
    persist();
    announce(`${FITZ[e.target.value].cap} chosen.`);
  });
  $("#albinism").addEventListener("change", (e) => {
    if (e.target.checked) {
      $("#fitz-set").innerHTML = `<legend class="sr-only">How fast you burn</legend>${fitzScale("I")}`;
      if (!lowVisionOn())
        $("#lv-offer").innerHTML = `<p class="note" style="margin-top:.75rem">Many people with albinism have low vision. <button type="button" class="link-btn" id="lv-on">Turn on low-vision mode</button></p>`;
    } else $("#lv-offer").innerHTML = "";
    desc();
    persist();
  });
  view.addEventListener("click", (e) => {
    if (e.target.id === "lv-on") {
      setPref("lowVision", true);
      $("#lv-offer").innerHTML = `<p class="note" style="margin-top:.75rem">Low-vision mode is on. Change it any time with the Aa button.</p>`;
      announce("Low-vision mode on.");
    }
  });
  $$('input[name="mask"]').forEach((r) =>
    r.addEventListener("change", () => {
      const m = $("#mask-img");
      if (!r.value) {
        m.hidden = true;
        return;
      }
      m.src = scan.masks[r.value];
      m.alt = METRICS[r.value].alt;
      m.hidden = false;
    })
  );
  $("#save").addEventListener("click", () => {
    persist();
    location.href = "/trip";
  });
  if (albinism && !lowVisionOn())
    $("#lv-offer").innerHTML = `<p class="note" style="margin-top:.75rem">Many people with albinism have low vision. <button type="button" class="link-btn" id="lv-on">Turn on low-vision mode</button></p>`;
  if (!fresh) persist();
  setRibbonNext("/trip", "Your trip");
  focusHeading();
}

/* ---------- manual ---------- */

function showManual() {
  title("Choose your skin by hand", "No photo needed");
  const p = load().profile || {};
  speech = "Choose your skin by hand. Pick your skin type, then how fast you burn, from one to six. Turn on albinism if it applies. Then save and plan your trip.";
  view.innerHTML = `
  <form class="narrow stack" id="manual" novalidate>
    <fieldset class="card">
      <legend><h2 style="font-size:1.25rem">Skin type</h2></legend>
      <div class="stack-sm" style="margin-top:.75rem">
      ${Object.entries(SKIN_TYPES)
        .map(([k, v]) => `<label class="check-row"><input type="radio" name="skin" value="${k}" ${p.skinType === k ? "checked" : ""}><span><strong>${v.name}</strong><span class="block small muted">${v.line}</span></span></label>`)
        .join("")}
      </div>
    </fieldset>
    <fieldset class="card fitz-scale"><legend><h2 style="font-size:1.25rem">How fast you burn</h2></legend>
      <p class="small muted" style="margin-top:.5rem">How does your skin react to strong sun with no sunscreen?</p>
      <div id="mfitz">${fitzScale(p.fitz || "")}</div>
      <p id="mfitz-desc" class="muted" aria-live="polite"></p>
    </fieldset>
    <div class="card"><label class="switch-row"><span><strong>I have albinism</strong><span class="block small muted">Uses the most careful burn times.</span></span><input type="checkbox" role="switch" class="switch" id="malb" ${p.albinism ? "checked" : ""}></label></div>
    <p class="err" id="manual-err" hidden role="alert"></p>
    <button class="btn btn-primary btn-block" type="submit">${icon("plane")} Save profile and plan my trip</button>
  </form>`;
  const desc = () => {
    const v = $('#mfitz input:checked')?.value;
    $("#mfitz-desc").textContent = v ? `${v}: ${FITZ[v].line}` : "";
  };
  desc();
  $("#mfitz").addEventListener("change", (e) => {
    $("#mfitz").innerHTML = fitzScale(e.target.value);
    $(`#mfitz input[value="${e.target.value}"]`).focus();
    desc();
  });
  $("#manual").addEventListener("submit", (e) => {
    e.preventDefault();
    const skin = $('input[name="skin"]:checked')?.value;
    const alb = $("#malb").checked;
    const fz = alb ? "I" : $('#mfitz input:checked')?.value;
    const err = $("#manual-err");
    if (!skin || !fz) {
      err.hidden = false;
      err.textContent = !skin ? "Please choose a skin type." : "Please choose how fast you burn (or turn on albinism).";
      return;
    }
    update((s) => {
      s.profile = { skinType: skin, concerns: [], fitz: fz, albinism: alb };
      s.demo = null;
      s.forecast = null;
      s.kit = null;
    });
    location.href = "/trip";
  });
}

/* ---------- route ---------- */

const st = load();
if (q.get("manual")) showManual();
else if (q.get("result")) {
  const scan = st.scans.find((s) => s.id === q.get("result"));
  if (scan) showResult(scan);
  else showCapture();
} else if (q.get("demo")) {
  const scan = st.scans.find((s) => s.demo?.persona === q.get("demo") && s.kind === "baseline");
  if (scan) showResult(scan);
  else location.replace("/#demo");
} else showCapture();
