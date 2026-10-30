// /kit: one pick per slot with "why" chips, alternatives, buy-it-there specs
// and Shopify checkout (opens in a new tab, password and test card beside it).
import { shell, esc, icon, $, errorBox, loading, productThumb, money, setRibbonNext } from "./ui.js";
import { load, update, profileForApi } from "./state.js";
import { kit as getKit, cart, config } from "./api.js";
import { announce, focusHeading } from "./a11y.js";
import { SLOT_NAMES } from "./kit-names.js";

const view = $("#view");
let res = null; // /api/kit answer
let chosen = {}; // slot → variantId, or null when removed
let extra = []; // products added from a rescan: [{slot, product}]


const slotName = (s) => SLOT_NAMES[s] || s;

shell({ page: "kit", speechText });

function speechText() {
  if (!res) return "Your trip kit. Loading.";
  const items = lines();
  const picks = res.slots.filter((s) => chosen[s.slot] && pickOf(s)).map((s) => `${slotName(s.slot)}: ${pickOf(s).title}. Why: ${(s.why || []).join(", ")}.`);
  return `Your trip kit. ${picks.join(" ")} ${items.length} items, ${money(total(), currency())} in total. Checkout opens the Parasol demo shop in a new tab. Demo shop. Not affiliated with these brands.`;
}

// Products are keyed by variant id; the offline CSV list has none, so fall back to the handle.
const pid = (p) => p?.variantId || p?.handle || null;
const pickOf = (s) => [s.pick, ...(s.alternatives || [])].find((p) => p && pid(p) === chosen[s.slot]) || s.pick;
const isOffline = () => res?.shop?.live === false || res?.live === false;
const currency = () => res?.slots?.[0]?.pick?.currency || "USD";
function lines() {
  const ids = [...res.slots.filter((s) => chosen[s.slot]).map((s) => chosen[s.slot]), ...extra.map((x) => pid(x.product))];
  return [...new Set(ids)];
}
function total() {
  const all = [...res.slots.flatMap((s) => [s.pick, ...(s.alternatives || [])]), ...extra.map((x) => x.product)];
  return lines().reduce((sum, id) => sum + (Number(all.find((p) => pid(p) === id)?.price) || 0), 0);
}

async function start() {
  const st = load();
  if (!st.forecast?.needs) {
    view.innerHTML = `<div class="card stack-sm"><h2>Build your forecast first</h2><p class="muted">Your kit is chosen from what each day of your trip needs.</p><p><a class="btn btn-primary" href="${st.trip ? "/forecast" : "/trip"}">${st.trip ? "See my forecast" : "Plan my trip"}</a></p></div>`;
    return;
  }
  if (st.kit?.res) {
    ({ res, chosen = {}, extra = [] } = st.kit);
    return render();
  }
  view.innerHTML = loading("Choosing products for your skin and trip…");
  try {
    res = await getKit(profileForApi(st.profile), st.forecast.needs, st.trip?.carryOn !== false);
    chosen = Object.fromEntries(res.slots.map((s) => [s.slot, s.pick?.available === false ? null : pid(s.pick)]));
    persist();
    render();
    announce(`Your kit is ready: ${res.slots.length} items.`);
  } catch (err) {
    view.innerHTML = errorBox(err, { retry: true });
    view.querySelector("[data-retry]")?.addEventListener("click", start);
  }
}

function persist() {
  update((s) => (s.kit = { res, chosen, extra }));
}

function card(s, i) {
  const p = pickOf(s);
  if (!p)
    return `<article class="card kit-card" aria-labelledby="k-${i}"><p class="k-slot">Slot ${i + 1}</p><h2 class="k-title" id="k-${i}">${esc(slotName(s.slot))}</h2><p class="muted">Nothing in the demo shop fits this yet. See "Or buy it there" for what to look for.</p></article>`;
  const on = !!chosen[s.slot];
  const alts = [s.pick, ...(s.alternatives || [])].filter((x) => x && pid(x) !== pid(p));
  return `<article class="card kit-card" aria-labelledby="k-${i}">
    <div class="k-top">
      ${productThumb(p)}
      <div><p class="k-slot">Slot ${i + 1} · ${esc(slotName(s.slot))}</p><h2 class="k-title" id="k-${i}">${esc(p.title)}</h2>
      <p class="k-meta">${esc(p.vendor || "")}${(p.tags || []).includes("under-100ml") ? ` <span aria-hidden="true">·</span> <span class="ok">Under 100 ml</span>` : ""}${p.available === false ? ` <span aria-hidden="true">·</span> Out of stock` : ""}</p></div>
      <p class="k-price">${money(p.price, p.currency)}</p>
    </div>
    ${s.why?.length ? `<ul class="chips" aria-label="Why this pick">${s.why.map((w) => `<li class="chip">${esc(w)}</li>`).join("")}</ul>` : ""}
    <div class="k-actions">
      ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" class="small">Product page${icon("external")}<span class="sr-only"> (opens in a new tab)</span></a>` : "<span></span>"}
      <button type="button" class="included" data-toggle="${esc(s.slot)}" aria-pressed="${on}" ${p.available === false ? "disabled" : ""}>${icon(on ? "checkCircle" : "plusCircle")} ${on ? "In my kit" : "Add to kit"}<span class="sr-only">: ${esc(p.title)}</span></button>
    </div>
    ${
      alts.length
        ? `<details class="more"><summary>${alts.length} other option${alts.length > 1 ? "s" : ""}</summary><div><ul class="alts">${alts
            .map(
              (a) =>
                `<li>${productThumb(a)}<div><strong class="block">${esc(a.title)}</strong><span class="small muted">${esc(a.vendor || "")} · ${money(a.price, a.currency)}</span></div><button type="button" class="btn btn-soft" style="min-height:48px;padding:.5rem 1rem" data-swap="${esc(s.slot)}" data-variant="${esc(pid(a))}" ${a.available === false ? "disabled" : ""}>Choose<span class="sr-only"> ${esc(a.title)}</span></button></li>`
            )
            .join("")}</ul></div></details>`
        : ""
    }
  </article>`;
}

async function render() {
  const st = load();
  const cfg = await config();
  const offline = isOffline();
  const cities = (st.trip?.legs || []).map((l) => l.name).filter(Boolean);
  $("#sub").textContent = `Picked from the Parasol demo shop for ${skinWord(st.profile)} and your trip${cities.length ? ` to ${cities.join(", ")}` : ""}.`;
  view.innerHTML = `
  <div class="cols">
    <div class="stack">
      ${
        st.trip?.carryOn !== false
          ? `<div class="card-tint carry"><span class="c-ic" aria-hidden="true">${icon("luggage")}</span><div><p class="k-slot" style="color:var(--blue)">Carry-on friendly</p><p>Liquids under 100 ml each (carry-on liquids rule).</p></div></div>`
          : ""
      }
      ${offline ? `<div class="alert alert-info">${icon("info")}<div><p><strong>${esc(res.shop?.message || res.message || "Shop is offline. Here's the list.")}</strong></p></div></div>` : ""}
      <div class="stack" id="cards">${res.slots.map(card).join("")}</div>
      ${
        extra.length
          ? `<section class="card" aria-labelledby="extra-h"><h2 id="extra-h">Added after your rescan</h2><ul class="alts">${extra
              .map((x, k) => `<li>${productThumb(x.product)}<div><strong class="block">${esc(x.product.title)}</strong><span class="small muted">${esc(slotName(x.slot))} · ${money(x.product.price, x.product.currency)}</span></div><button type="button" class="icon-del" data-rmextra="${k}">${icon("trash")}<span class="sr-only">Remove ${esc(x.product.title)}</span></button></li>`)
              .join("")}</ul></section>`
          : ""
      }
    </div>
    <div class="stack sticky-col">
      <section class="card" aria-labelledby="buy-h">
        <h2 id="buy-h">Or buy it there</h2>
        <p class="muted small">What to look for at a local pharmacy, if you'd rather pack light.</p>
        <ul class="buy-there">${(res.buyThere || []).map((b) => `<li><strong class="block">${esc(slotName(b.slot))}</strong><span class="muted">${esc(b.lookFor)}</span></li>`).join("")}</ul>
      </section>
      <section class="shop-help" aria-labelledby="shop-h">
        <h2 id="shop-h" style="font-size:1.125rem;color:inherit">${icon("info")} How the demo checkout works</h2>
        <p>Checkout opens the Parasol demo shop (Shopify) in a new tab. No real money is taken.</p>
        ${cfg.storePassword ? `<p>Shop password: <code>${esc(cfg.storePassword)}</code></p>` : `<p>If the shop asks for a password, it is listed in the project README.</p>`}
        <p>Test card: ${esc(cfg.testCard || "Bogus Gateway: card number 1, any future date, any CVV")}</p>
      </section>
      <div id="cart-msg"></div>
      <p class="credit">${esc(res.disclaimer || "Demo shop. Not affiliated with these brands.")}</p>
    </div>
  </div>
  <div class="checkout-bar" role="region" aria-label="Checkout">
    <div><p class="small muted" id="cb-count"></p><p class="cb-total" id="cb-total"></p></div>
    <button type="button" class="btn btn-primary" id="checkout" ${offline ? "disabled" : ""}>Checkout ${icon("external")}<span class="sr-only"> (opens the demo shop in a new tab)</span></button>
  </div>`;
  updateBar();
  setRibbonNext("/rescan?demo=1", "Day 3 in Lagos: rescan");
}

const skinWord = (p) => (p ? `${{ oily: "oily", dry: "dry", combination: "combination", normal: "normal" }[p.skinType] || ""} skin, sun type ${p.fitz}${p.albinism ? " with albinism" : ""}` : "your skin");

function updateBar() {
  const n = lines().length;
  $("#cb-count").textContent = `${n} item${n === 1 ? "" : "s"}`;
  $("#cb-total").textContent = `${money(total(), currency())} total`;
  const b = $("#checkout");
  b.disabled = n === 0 || isOffline();
  if (isOffline()) b.innerHTML = "Shop offline";
}

view.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.toggle) {
    const s = res.slots.find((x) => x.slot === b.dataset.toggle);
    chosen[s.slot] = chosen[s.slot] ? null : pid(pickOf(s));
    persist();
    const i = res.slots.indexOf(s);
    b.closest("article").outerHTML = card(s, i);
    $(`[data-toggle="${CSS.escape(s.slot)}"]`).focus();
    updateBar();
    announce(chosen[s.slot] ? `${slotName(s.slot)} added.` : `${slotName(s.slot)} removed.`);
  } else if (b.dataset.swap) {
    const s = res.slots.find((x) => x.slot === b.dataset.swap);
    chosen[s.slot] = b.dataset.variant;
    persist();
    const i = res.slots.indexOf(s);
    b.closest("article").outerHTML = card(s, i);
    $(`#k-${i}`).setAttribute("tabindex", "-1");
    $(`#k-${i}`).focus();
    updateBar();
    announce(`Swapped to ${pickOf(s).title}.`);
  } else if (b.dataset.rmextra != null) {
    extra.splice(Number(b.dataset.rmextra), 1);
    persist();
    render();
  } else if (b.id === "checkout") checkout(b);
});

async function checkout(btn) {
  const ids = lines();
  if (!ids.length) return;
  btn.disabled = true;
  const msg = $("#cart-msg");
  msg.innerHTML = `<p class="loading" role="status">${icon("sun", "spin")} Making your cart…</p>`;
  // Open the tab now (inside the click) so pop-up blockers allow it.
  const w = window.open("", "_blank");
  try {
    const r = await cart(ids.filter((id) => id.startsWith("gid://")).map((variantId) => ({ variantId, quantity: 1 })));
    if (w) {
      w.opener = null;
      w.location.href = r.checkoutUrl;
    }
    msg.innerHTML = `<div class="alert alert-info">${icon("checkCircle")}<div><p><strong>Your cart is ready${w ? " in a new tab" : ""}.</strong></p>
      <p><a href="${esc(r.checkoutUrl)}" target="_blank" rel="noopener">Open checkout${icon("external")}<span class="sr-only"> (new tab)</span></a></p>
      ${r.storePassword ? `<p>Shop password: <code>${esc(r.storePassword)}</code></p>` : ""}<p>${esc(r.testCard || "")}</p></div></div>`;
    announce("Your cart is ready. Checkout opened in a new tab.");
  } catch (err) {
    w?.close();
    msg.innerHTML = errorBox(err);
    announce(err.message);
  } finally {
    btn.disabled = false;
  }
}

start().then(() => focusHeading());
