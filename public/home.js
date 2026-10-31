import { shell, esc, icon, errorBox, $ } from "./ui.js";
import { PERSONAS, update, addScan, profileFromScan, demoTrip, load, DEMO_TRIP_LABEL } from "./state.js";
import { demoScan } from "./api.js";
import { announce } from "./a11y.js";

shell({
  page: "home",
  speechText: () =>
    "Parasol. Sun safety for people with albinism, and every skin on the road. In parts of Sub-Saharan Africa, up to 1 in 5,000 people have albinism, and many die of skin cancer before 40. Three steps: take a selfie, add your trip, get your skin plan. Press Start to begin, or try the demo with no selfie. " +
    "Your photo is sent to YouCam for analysis and is not stored by Parasol. " +
    "Not medical advice. Burn times are estimates.",
});

const box = $("#demo");
const TRIP = DEMO_TRIP_LABEL;

$("#personas").innerHTML = Object.values(PERSONAS)
  .map(
    (p) => `<button type="button" class="persona" data-persona="${p.id}">
      <span class="p-face swatch-${p.id}"><img src="/demo/${p.id}/face.jpg" alt="" width="64" height="64"></span>
      <span class="p-txt"><span class="p-name">${esc(p.name)}${p.id === "sam" ? ` <span class="badge badge-solid p-start">Start here</span>` : ""}</span><span class="p-line">${esc(p.line)}</span><span class="p-trip">${TRIP}</span></span>
      ${icon("arrow")}
    </button>`
  )
  .join("");
// If a face thumbnail is missing, show the initial instead.
box.querySelectorAll(".p-face img").forEach((img) =>
  img.addEventListener("error", () => {
    img.replaceWith(document.createTextNode(img.closest(".persona").querySelector(".p-name").textContent.trim()[0]));
  })
);
box.insertAdjacentHTML("beforeend", `<p class="credit">AI-generated demo faces (YouCam AI Image Generator). Not real people.</p>`);

$("#cta-demo").addEventListener("click", (e) => {
  e.preventDefault();
  box.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  box.querySelector(".persona")?.focus({ preventScroll: true });
});

box.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-persona]");
  if (!b) return;
  const id = b.dataset.persona;
  const persona = PERSONAS[id];
  box.querySelectorAll(".persona").forEach((x) => (x.disabled = true));
  const msg = $("#demo-msg");
  msg.innerHTML = `<p class="loading" role="status">${icon("sun", "spin")} Loading ${esc(persona.name)}'s skin result…</p>`;
  try {
    const { scan } = await demoScan(id, "baseline");
    addScan(scan);
    update((s) => {
      s.demo = id;
      s.profile = profileFromScan(scan, { albinism: persona.albinism });
      s.profile.fitzFromScan = scan.fitz?.scale || null;
      s.trip = demoTrip();
      s.forecast = null;
      s.kit = null;
      s.rescan = null;
    });
    announce(`${persona.name}'s result is ready.`);
    location.href = `/scan?result=${encodeURIComponent(scan.id)}`;
  } catch (err) {
    box.querySelectorAll(".persona").forEach((x) => (x.disabled = false));
    msg.innerHTML = errorBox(err);
  }
});

// Returning visitor in the middle of the demo: offer to continue.
const s = load();
if (s.demo && s.trip) {
  box.insertAdjacentHTML("afterbegin", `<p class="note">${icon("info")} You're in the middle of the demo with ${esc(PERSONAS[s.demo]?.name || s.demo)}. <a href="/forecast">Continue to the forecast</a>.</p>`);
}
