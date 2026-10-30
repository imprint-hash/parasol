// Low-vision mode, themes, text size, read-aloud and screen-reader announcements.
import { load, update } from "./state.js";

const root = document.documentElement;
const mq = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {} });
const darkQ = mq("(prefers-color-scheme: dark)");
const moreQ = mq("(prefers-contrast: more)");

export const prefs = () => load().prefs;

/** Low-vision is on when the user turned it on, or (never chosen) the OS asks for more contrast. */
export const lowVisionOn = () => (prefs().lowVision == null ? moreQ.matches : prefs().lowVision === true);

export function applyPrefs() {
  const p = prefs();
  // Beige light unless the person picked a theme themselves (old saved "auto" is ignored).
  const theme = p.themeChosen ? p.theme : "light";
  const dark = theme === "dark-gentle" || (theme === "auto" && darkQ.matches);
  root.dataset.theme = dark ? "dark" : "light";
  if (lowVisionOn()) root.dataset.lv = "1";
  else delete root.dataset.lv;
  const s = Math.min(2, Math.max(1, Number(p.textScale) || 1));
  root.style.fontSize = s === 1 ? "" : `${s * 100}%`;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#161213" : "#ffffff";
  document.dispatchEvent(new CustomEvent("parasol:prefs"));
}
darkQ.addEventListener?.("change", applyPrefs);
moreQ.addEventListener?.("change", applyPrefs);

export function setPref(key, value) {
  update((s) => {
    s.prefs[key] = value;
  });
  applyPrefs();
}

/* ---------- announcements ---------- */

let liveEl = null;
export function announce(msg) {
  if (!liveEl) liveEl = document.getElementById("live");
  if (!liveEl) return;
  liveEl.textContent = "";
  // A short gap makes screen readers treat a repeated message as new.
  setTimeout(() => (liveEl.textContent = msg), 60);
}

/* ---------- read aloud ---------- */

export const speechSupported = () => "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function";
// Chrome loads its voice list after the page, so ask early: by the time someone
// taps the speaker, the female voices are there to choose from.
if (speechSupported()) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.("voiceschanged", () => speechSynthesis.getVoices());
}

let speaking = false;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(speaking));
export const onSpeech = (fn) => listeners.add(fn);
export const isSpeaking = () => speaking;

// A woman's voice where the device has one. Browsers don't say a voice's
// gender, so this matches the names of common female voices on Windows,
// macOS/iOS, Android/Chrome and Edge, then falls back to any English voice.
const FEMALE = /\b(female|woman|zira|aria|jenny|libby|sonia|hazel|susan|ava|samantha|karen|moira|tessa|serena|kate|fiona|victoria|allison|susie|zoe|catherine|natasha|clara|emma|amy|joanna|salli|kimberly|ivy|ezinne|abeo|leah|neerja|heera)\b/i;
const MALE = /\b(male|david|mark|george|james|ryan|guy|daniel|alex|fred|oliver|thomas|arthur|rishi|aaron|ravi|prabhat|tom)\b/i;

function pickVoice() {
  const vs = (speechSynthesis.getVoices?.() || []).filter((v) => /^en/i.test(v.lang));
  const female = vs.filter((v) => FEMALE.test(v.name) && !/\bmale\b/i.test(v.name.replace(/female/i, "")));
  const preferred = (list) => list.find((v) => /^en-(GB|NG|ZA|US)/i.test(v.lang)) || list[0];
  return preferred(female) || preferred(vs.filter((v) => !MALE.test(v.name))) || preferred(vs) || null;
}

export function speak(text) {
  if (!speechSupported() || !text) return false;
  speechSynthesis.cancel();
  // Long texts are split into sentences: some engines stop after ~15 s.
  const parts = String(text).match(/[^.!?]+[.!?]*/g) || [text];
  const voice = pickVoice();
  speaking = true;
  emit();
  parts.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part.trim());
    u.rate = Number(prefs().speechRate) || 1;
    u.lang = voice?.lang || "en-GB";
    if (voice) u.voice = voice;
    if (i === parts.length - 1) {
      u.onend = u.onerror = () => {
        speaking = false;
        emit();
      };
    }
    speechSynthesis.speak(u);
  });
  return true;
}

export function stopSpeaking() {
  if (speechSupported()) speechSynthesis.cancel();
  speaking = false;
  emit();
}

/* ---------- focus ---------- */

/** Puts focus on the page h1 (or a given heading) so screen readers start there. */
export function focusHeading(el = document.querySelector("main h1")) {
  if (!el) return;
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: false });
}

export const reducedMotion = () => mq("(prefers-reduced-motion: reduce)").matches;
