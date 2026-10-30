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
  if (meta) meta.content = dark ? "#1d1410" : "#faf6f1";
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

let speaking = false;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(speaking));
export const onSpeech = (fn) => listeners.add(fn);
export const isSpeaking = () => speaking;

function pickVoice() {
  const vs = speechSynthesis.getVoices?.() || [];
  return vs.find((v) => /^en-(GB|NG|ZA|US)/i.test(v.lang) && v.localService) || vs.find((v) => /^en/i.test(v.lang)) || null;
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
