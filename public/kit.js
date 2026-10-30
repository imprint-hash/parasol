// /kit: one pick per slot with "why" chips, alternatives, buy-it-there specs
// and Shopify checkout (opens in a new tab, password and test card beside it).
import { shell, esc, icon, $, errorBox, loading, productThumb, photoImg, money, setRibbonNext } from "./ui.js";
import { load, update, profileForApi } from "./state.js";
import { kit as getKit, cart, config } from "./api.js";
import { announce, focusHeading } from "./a11y.js";
import { SLOT_NAMES } from "./kit-names.js";
import { productArt } from "./parts.js";

const view = $("#view");
let res = null; // /api/kit answer
let chosen = {}; // slot → variantId, or null when removed
let extra = []; // products added from a rescan: [{slot, product}]


const slotName = (s) => SLOT_NAMES[s] || s;

// The kit starts with only the essentials hearted; every other slot waits
// under "Add if you like" until the person adds it. The hat is an essential
// for sun type I-II and for albinism.
const ESSENTIALS = ["sunscreen", "lip", "moisturiser-day"];
const KIT_VERSION = 2; // saved kits from before essentials-first are re-chosen once
const isEssential = (slot, profile = load().profile) => ESSENTIALS.includes(slot) || (slot === "hat" && !!(profile?.albinism || ["I", "II"].includes(profile?.fitz)));
const firstChoice = (profile) => Object.fromEntries(res.slots.map((s) => [s.slot, isEssential(s.slot, profile) && s.pick && s.pick.available !== false ? pid(s.pick) : null]));

shell({ page: "kit", speechText });

function speechText() {
  if (!res) return "Your trip kit. Loading.";
  const items = lines();
  const picks = res.slots.filter((s) => chosen[s.slot] && pickOf(s)).map((s) => `${slotName(s.slot)}: ${pickOf(s).title}. Why: ${(s.why || []).join(", ")}.`);
  const more = res.slots.filter((s) => !chosen[s.slot] && pickOf(s) && !isEssential(s.slot)).map((s) => slotName(s.slot));
  return `Your trip kit. ${picks.join(" ")} ${more.length ? `Add if you like: ${more.join(", ")}.` : ""} ${items.length} items, ${money(total(), currency())} in total. Checkout opens the Parasol demo shop in a new tab. Demo shop. Not affiliated with these brands.`;
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
    if (st.kit.v !== KIT_VERSION) {
      chosen = firstChoice(st.profile);
      persist();
    }
    return render();
  }
  view.innerHTML = loading("Choosing products for your skin and trip…");
  try {
    res = await getKit(profileForApi(st.profile), st.forecast.needs, st.trip?.carryOn !== false);
    chosen = firstChoice(st.profile);
    persist();
    render();
    announce(`Your kit is ready: ${lines().length} essentials picked, more to add if you like.`);
  } catch (err) {
    view.innerHTML = errorBox(err, { retry: true });
    view.querySelector("[data-retry]")?.addEventListener("click", start);
  }
}

function persist() {
  update((s) => (s.kit = { res, chosen, extra, v: KIT_VERSION }));
}

const GROUPS = {
  sun: ["sunscreen", "lip", "aftersun"],
  moisture: ["moisturiser-day", "moisturiser-rich", "mist"],
  cleanse: ["cleanser", "blotting"],
  wear: ["hat", "sleeves", "sunglasses"],
};
const GROUP_NAMES = { all: "All", sun: "Sun care", moisture: "Moisture", cleanse: "Cleanse", wear: "Hat and glasses" };
let filter = "all";
const groupOf = (slot) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(slot)) || "all";
const HEART = `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/></svg>`;

function card(s, i) {
  const p = pickOf(s);
  const hidden = filter !== "all" && groupOf(s.slot) !== filter ? "hidden" : "";
  if (!p)
    return `<article class="pcard" data-slot="${esc(s.slot)}" aria-labelledby="k-${i}" ${hidden}><div class="pc-img">${productArt(null)}<span class="badge badge-neutral pc-slot">${esc(slotName(s.slot))}</span></div><div class="pc-body"><h2 class="k-title" id="k-${i}">${esc(slotName(s.slot))}</h2><p class="k-meta">Nothing in the demo shop fits this yet. See "Or buy it there".</p></div></article>`;
  const on = !!chosen[s.slot];
  const alts = [s.pick, ...(s.alternatives || [])].filter((x) => x && pid(x) !== pid(p));
  const img = photoImg(p, productArt(p));
  return `<article class="pcard" data-slot="${esc(s.slot)}" aria-labelledby="k-${i}" ${hidden}>
    <div class="pc-img">${img}<span class="badge badge-neutral pc-slot">${esc(slotName(s.slot))}</span>
      <button type="button" class="heart" data-toggle="${esc(s.slot)}" aria-pressed="${on}" ${p.available === false ? "disabled" : ""}>${HEART}<span class="sr-only">${on ? "In my kit" : "Add to my kit"}: ${esc(p.title)}</span></button>
    </div>
    <div class="pc-body">
      <div class="pc-top"><h2 class="k-title" id="k-${i}">${esc(p.title)}</h2><p class="k-price">${money(p.price, p.currency)}</p></div>
      <p class="k-meta">${esc(p.vendor || "")}${(p.tags || []).includes("under-100ml") ? " · Under 100 ml" : ""}${p.available === false ? " · Out of stock" : ""}${on ? " · <strong>In my kit</strong>" : ""}</p>
      ${s.why?.length ? `<ul class="chips" aria-label="Why this pick">${s.why.map((w) => `<li class="chip">${esc(w)}</li>`).join("")}</ul>` : ""}
      ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" class="small">Product page ${icon("external")}<span class="sr-only"> (opens in a new tab)</span></a>` : ""}
      ${
        alts.length
          ? `<details class="more"><summary>${alts.length} other option${alts.length > 1 ? "s" : ""}</summary><div><ul class="alts">${alts
              .map(
                (a) =>
                  `<li>${productThumb(a)}<div><strong class="block small">${esc(a.title)}</strong><span class="small muted">${money(a.price, a.currency)}</span></div><button type="button" class="btn btn-soft" style="min-height:44px;padding:.375rem .875rem" data-swap="${esc(s.slot)}" data-variant="${esc(pid(a))}" ${a.available === false ? "disabled" : ""}>Choose<span class="sr-only"> ${esc(a.title)}</span></button></li>`
              )
              .join("")}</ul></div></details>`
          : ""
      }
    </div>
  </article>`;
}

async function render() {
  const st = load();
  const cfg = await config();
  const offline = isOffline();
  const cities = (st.trip?.legs || []).map((l) => l.name).filter(Boolean);
  $("#sub").textContent = `Picked from the Parasol demo shop for ${skinWord(st.profile)} and your trip${cities.length ? ` to ${cities.join(", ")}` : ""}. Tap the heart to keep or drop an item.`;
  const groups = ["all", ...Object.keys(GROUPS).filter((g) => res.slots.some((x) => groupOf(x.slot) === g))];
  const indexed = res.slots.map((s, i) => [s, i]);
  const essential = indexed.filter(([s]) => isEssential(s.slot, st.profile));
  const optional = indexed.filter(([s]) => !isEssential(s.slot, st.profile));
  view.innerHTML = `
  <div class="row spread gap">
    <h2 id="find-h" style="font-size:1.5rem">Find products for your trip</h2>
    ${st.trip?.carryOn !== false ? `<span class="badge badge-neutral">${icon("luggage")} Carry-on: liquids under 100 ml</span>` : ""}
  </div>
  <div class="filters" role="group" aria-labelledby="find-h">${groups.map((g) => `<button type="button" class="filter" data-filter="${g}" aria-pressed="${g === filter}">${GROUP_NAMES[g]}</button>`).join("")}</div>
  ${offline ? `<div class="alert alert-info">${icon("info")}<div><p><strong>${esc(res.shop?.message || res.message || "Shop is offline. Here's the list.")}</strong></p></div></div>` : ""}
  <div class="kit-grid" id="cards">${essential.map(([s, i]) => card(s, i)).join("")}</div>
  ${
    optional.length
      ? `<section class="stack-sm" id="more" aria-labelledby="more-h" ${moreHidden() ? "hidden" : ""}><h2 id="more-h" style="font-size:1.375rem">Add if you like</h2><p class="muted small">Not in your kit yet. Tap the heart to add one.</p><div class="kit-grid" id="cards-more">${optional.map(([s, i]) => card(s, i)).join("")}</div></section>`
      : ""
  }
  <p class="credit">Product images © their brands or credited photographers. Demo shop, not affiliated with these brands.</p>
  ${
    extra.length
      ? `<section class="card" aria-labelledby="extra-h"><h2 id="extra-h">Added after your rescan</h2><ul class="alts">${extra
          .map((x, k) => `<li>${productThumb(x.product)}<div><strong class="block">${esc(x.product.title)}</strong><span class="small muted">${esc(slotName(x.slot))} · ${money(x.product.price, x.product.currency)}</span></div><button type="button" class="icon-del" data-rmextra="${k}">${icon("trash")}<span class="sr-only">Remove ${esc(x.product.title)}</span></button></li>`)
          .join("")}</ul></section>`
      : ""
  }
  <div class="checkout-bar" role="region" aria-label="Checkout">
    <div><p class="small" id="cb-count"></p><p class="cb-total" id="cb-total"></p></div>
    <button type="button" class="btn btn-primary" id="checkout" ${offline ? "disabled" : ""}>Checkout ${icon("external")}<span class="sr-only"> (opens the demo shop in a new tab)</span></button>
  </div>
  <div id="cart-msg"></div>
  <div class="cols">
    <section class="shop-help" aria-labelledby="shop-h">
      <h2 id="shop-h" style="font-size:1.375rem">How the demo checkout works</h2>
      <p>Checkout opens the Parasol demo shop (Shopify) in a new tab. No real money is taken.</p>
      ${cfg.storePassword ? `<p>Shop password: <code>${esc(cfg.storePassword)}</code></p>` : `<p>If the shop asks for a password, it is listed in the project README.</p>`}
      <p>Test card: ${esc(cfg.testCard || "Bogus Gateway: card number 1, any future date, any CVV")}</p>
      <p class="credit">${esc(res.disclaimer || "Demo shop. Not affiliated with these brands.")}</p>
    </section>
    <section class="card" aria-labelledby="buy-h">
      <h2 id="buy-h" style="font-size:1.375rem">Or buy it there</h2>
      <p class="muted small">What to look for at a local pharmacy, if you'd rather pack light.</p>
      <ul class="buy-there">${(res.buyThere || []).map((b) => `<li><strong class="block">${esc(slotName(b.slot))}</strong><span class="muted">${esc(b.lookFor)}</span></li>`).join("")}</ul>
    </section>
  </div>`;
  updateBar();
  setRibbonNext("/rescan?demo=1", "Day 3 in Dubai: rescan");
}

// The "Add if you like" section hides when the filter leaves none of its cards.
const moreHidden = () => filter !== "all" && !res.slots.some((s) => !isEssential(s.slot) && groupOf(s.slot) === filter);

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
    $(`[data-toggle="${CSS.escape(s.slot)}"]`)?.focus();
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
  } else if (b.dataset.filter) {
    filter = b.dataset.filter;
    view.querySelectorAll(".filter").forEach((f) => f.setAttribute("aria-pressed", String(f.dataset.filter === filter)));
    view.querySelectorAll(".pcard").forEach((c) => (c.hidden = filter !== "all" && groupOf(c.dataset.slot) !== filter));
    if ($("#more")) $("#more").hidden = moreHidden();
    announce(`Showing ${GROUP_NAMES[filter]}.`);
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
