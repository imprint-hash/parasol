// /data: what this browser keeps, the skin scores our server keeps for up to 30 days, and "Delete everything".
import { shell, esc, icon, $, fmtDate, errorBox } from "./ui.js";
import { load, clearAll, PERSONAS } from "./state.js";
import { deleteMyData } from "./api.js";
import { announce, focusHeading, applyPrefs } from "./a11y.js";
import { FITZ } from "./parts.js";

const view = $("#view");

shell({
  page: "data",
  speechText: () => {
    const s = load();
    return `My data. Your trip stays on this device. We keep only your skin scores (never your photo) for up to 30 days, and you can delete them here. You have ${s.scans.length} scan${s.scans.length === 1 ? "" : "s"} saved${s.trip ? " and one trip" : ""}. Your photos are never kept: they are sent to YouCam for analysis and not stored by Parasol. Use Delete everything to remove it all.`;
  },
});

const SRC = { live: "Your photo, analysed by YouCam", cache: "Your photo (saved result reused)", demo: "Demo" };

function render() {
  const s = load();
  const tokens = s.scans.map((x) => x.deleteToken).filter(Boolean);
  view.innerHTML = `
  ${s.demo ? `<div class="card-warm stack-sm"><h2>That's the demo</h2><p>You've seen ${PERSONAS[s.demo] ? `${esc(PERSONAS[s.demo].name)}'s` : "the"} trip from skin read to checkout, a skin change and the sun timer. Delete it below, or <a href="/#demo">try the other traveller</a>.</p></div>` : ""}
  <div class="cols">
    <div class="stack">
      <section class="card" aria-labelledby="scans-h">
        <h2 id="scans-h">Scans (${s.scans.length})</h2>
        ${
          s.scans.length
            ? `<ul class="history">${s.scans
                .map(
                  (x) =>
                    `<li class="card-tint-2"><strong class="block">${x.kind === "rescan" ? "Skin changed" : "First scan"} · ${esc(x.demo ? `Demo: ${PERSONAS[x.demo.persona]?.name || x.demo.persona}` : SRC[x.source] || x.source)}</strong><span class="small muted">${new Date(x.takenAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · scores only, no photo${x.deleteToken ? " · a copy of the scores is cached on our server" : ""}</span></li>`
                )
                .join("")}</ul>`
            : `<p class="muted">No scans saved.</p>`
        }
      </section>
      <section class="card" aria-labelledby="trip-h">
        <h2 id="trip-h">Trip and profile</h2>
        <dl class="kv">
          <dt>Trip</dt><dd>${s.trip?.legs?.length ? s.trip.legs.map((l) => `${esc(l.name || "?")} (${fmtDate(l.from)}–${fmtDate(l.to)})`).join(", ") : "None"}</dd>
          <dt>Skin</dt><dd>${s.profile ? `${esc(s.profile.skinType)}, ${esc((FITZ[s.profile.fitz]?.cap || "").toLowerCase())}${s.profile.albinism ? ", albinism" : ""}` : "None"}</dd>
          <dt>Forecast</dt><dd>${s.forecast?.days ? `${s.forecast.days.length} days saved` : "None"}</dd>
          <dt>Kit</dt><dd>${s.kit?.res ? `${s.kit.res.slots.length} slots saved` : "None"}</dd>
          <dt>Settings</dt><dd>Theme ${esc(s.prefs.theme)}, text ${Math.round((s.prefs.textScale || 1) * 100)}%, low-vision ${s.prefs.lowVision ? "on" : s.prefs.lowVision === false ? "off" : "follows your device"}</dd>
        </dl>
      </section>
    </div>
    <div class="stack">
      <section class="card-tint stack-sm" aria-labelledby="priv-h">
        <h2 id="priv-h">${icon("lock")} Privacy, plainly</h2>
        <p>Your photo is sent to YouCam (Perfect Corp.) for skin analysis and is not stored by Parasol.</p>
        <p>Your trip stays on this device. We keep only your skin scores (never your photo) for up to 30 days, linked to a fingerprint of the photo so a repeat scan costs nothing. You can delete them here. We keep no trip, profile or account.</p>
        <p>Weather comes from Open-Meteo, using only the city locations you choose.</p>
      </section>
      <section class="card stack-sm" aria-labelledby="del-h">
        <h2 id="del-h">Delete everything</h2>
        <p class="muted">Removes the cached scores on our server${tokens.length ? ` (${tokens.length})` : ""} and everything saved in this browser.</p>
        <button type="button" class="btn danger-btn btn-block" id="del">${icon("trash")} Delete everything</button>
        <div id="del-msg"></div>
      </section>
    </div>
  </div>`;

  $("#del").addEventListener("click", async () => {
    if (!confirm("Delete all your Parasol data on this device and the cached scores on our server?")) return;
    const msg = $("#del-msg");
    try {
      let n = 0;
      for (let i = 0; i < tokens.length; i += 20) n += (await deleteMyData(tokens.slice(i, i + 20))).deleted || 0;
      clearAll();
      applyPrefs();
      render();
      $("#del-msg").innerHTML = `<p class="note" role="status">${icon("checkCircle")} Done. Everything is deleted${tokens.length ? ` (${n} cached result${n === 1 ? "" : "s"} removed from our server)` : ""}.</p>`;
      announce("Everything is deleted.");
      document.querySelector(".ribbon")?.remove();
    } catch (err) {
      msg.innerHTML = errorBox(err);
    }
  });
}

render();
focusHeading();
