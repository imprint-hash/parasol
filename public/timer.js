// The reapply timer. State lives in localStorage so it survives reloads.
// Announces once every 5 minutes and at zero (never every second).
import { get, set } from "./state.js";
import { announce, speak } from "./a11y.js";

export const REAPPLY = { normal: 120, water40: 40, water80: 80 };

export function start(minutes = REAPPLY.normal, label = "") {
  set("timer", { startedAt: Date.now(), minutes, label, done: false });
}
export const stop = () => set("timer", null);
export const current = () => get("timer");

/** Seconds left (0 when finished), or null when not running. */
export function secondsLeft(t = current()) {
  if (!t) return null;
  return Math.max(0, Math.round((t.startedAt + t.minutes * 60000 - Date.now()) / 1000));
}

export const fmt = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
};

/** Ticks every second and calls render(left, t). Fires the alert once at zero. */
export function run(render, onZero) {
  let lastAnnounce = null;
  const tick = () => {
    const t = current();
    const left = secondsLeft(t);
    render(left, t);
    if (left == null) return;
    const minLeft = Math.ceil(left / 60);
    if (left > 0 && minLeft % 5 === 0 && minLeft !== lastAnnounce) {
      lastAnnounce = minLeft;
      announce(`${minLeft} minutes until you reapply sunscreen.`);
    }
    if (left === 0 && !t.done) {
      set("timer", { ...t, done: true });
      alertZero();
      onZero?.();
    }
  };
  tick();
  return setInterval(tick, 1000);
}

function alertZero() {
  const msg = "Time to reapply your sunscreen.";
  announce(msg);
  speak(msg);
  try {
    navigator.vibrate?.([300, 150, 300, 150, 300]);
  } catch {}
}
