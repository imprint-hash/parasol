#!/usr/bin/env node
// Prints the YouCam unit balance, today's live-scan counters and the guards.
// Free: reads the balance and the store only. `npm run budget`
import { credit } from "../src/youcam.js";
import { today, settings, LIVE_PER_IP_HOUR, LIVE_PER_IP_DAY } from "../src/budget.js";
import { storeName } from "../src/store.js";

const s = settings();
let units = "unavailable";
try {
  units = await credit({ fresh: true });
} catch (err) {
  units = `unavailable (${err.message})`;
}
const t = await today().catch((err) => ({ error: err.message }));
console.log(`YouCam units left : ${units}`);
console.log(`Unit floor        : ${s.floor}${typeof units === "number" ? `  (room for about ${Math.max(0, Math.floor((units - s.floor) / 24))} live scans at 24 units)` : ""}`);
console.log(`Live scans        : ${s.live ? "on" : "OFF"}`);
console.log(`Today (UTC)       : ${t.error ? `store error: ${t.error}` : `${t.liveScans} of ${s.perDay} live scans, ${t.units} units`}`);
console.log(`Per IP            : ${LIVE_PER_IP_HOUR} an hour, ${LIVE_PER_IP_DAY} a day`);
console.log(`Store             : ${storeName}`);
