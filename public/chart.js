// Hourly UV bar chart (SVG) with a matching table for screen readers and
// anyone who prefers numbers. The chart itself is hidden from assistive tech.
import { esc, uvLevel, fmtHour } from "./ui.js";

const FROM = 6;
const TO = 20;

export function uvChart(hourly = [], { title = "UV by hour", protect } = {}) {
  const hours = hourly.filter((x) => x.h >= FROM && x.h <= TO && Number.isFinite(Number(x.uvi)));
  if (!hours.length) return `<p class="note">Hourly UV isn't known for this day yet.</p>`;
  const W = 340;
  const H = 150;
  const padL = 22;
  const padB = 22;
  const top = Math.max(12, Math.ceil(Math.max(...hours.map((x) => x.uvi))));
  const bw = (W - padL) / (TO - FROM + 1);
  const y = (v) => (H - padB) - (v / top) * (H - padB - 8);
  const grid = [0, 3, 6, 8, 11].filter((v) => v <= top);
  const pf = protect?.from ? Number(String(protect.from).split(":")[0]) + Number(String(protect.from).split(":")[1] || 0) / 60 : null;
  const pt = protect?.to ? Number(String(protect.to).split(":")[0]) + Number(String(protect.to).split(":")[1] || 0) / 60 : null;
  const band =
    pf != null && pt != null
      ? `<rect x="${padL + (pf - FROM) * bw}" y="0" width="${Math.max(0, (pt - pf) * bw)}" height="${H - padB}" fill="var(--primary-soft)" opacity="0.6"/>`
      : "";
  const bars = hours
    .map((x) => {
      const l = uvLevel(x.uvi);
      const bx = padL + (x.h - FROM) * bw + 2;
      return `<rect class="bar uv-${l.key}" x="${bx.toFixed(1)}" y="${y(x.uvi).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${Math.max(1, H - padB - y(x.uvi)).toFixed(1)}"/>`;
    })
    .join("");
  const labels = [6, 9, 12, 15, 18]
    .map((h) => `<text x="${padL + (h - FROM) * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${h === 12 ? "noon" : fmtHour(h).replace(" ", "")}</text>`)
    .join("");
  const gl = grid.map((v) => `<line class="grid" x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("");

  const rows = hours
    .map((x) => {
      const l = uvLevel(x.uvi);
      return `<tr><td>${esc(fmtHour(x.h))}</td><td class="num">${Math.round(x.uvi * 10) / 10}</td><td>${l.name}</td>${x.t != null ? `<td class="num">${Math.round(x.t)}°C</td>` : "<td></td>"}${x.rh != null ? `<td class="num">${Math.round(x.rh)}%</td>` : "<td></td>"}</tr>`;
    })
    .join("");

  return `<figure class="mt-0" style="margin:0">
    <svg class="uvchart" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">${band}${gl}${bars}${labels}</svg>
    <figcaption class="legend">${pf != null ? '<span><span class="dot" style="background:var(--primary-soft);border:1px solid var(--primary)"></span>Protect hours</span>' : ""}<span><span class="dot bg-uv-low"></span>Low</span><span><span class="dot bg-uv-mod"></span>Moderate</span><span><span class="dot bg-uv-high"></span>High</span><span><span class="dot bg-uv-vhigh"></span>Very high</span><span><span class="dot bg-uv-ext"></span>Extreme</span></figcaption>
  </figure>
  <details class="more"><summary>${esc(title)} as a table</summary><div class="table-wrap"><table class="data"><caption class="sr-only">${esc(title)}</caption><thead><tr><th scope="col">Time</th><th scope="col" class="num">UV</th><th scope="col">Level</th><th scope="col" class="num">Temp</th><th scope="col" class="num">Humidity</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}
