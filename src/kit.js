/**
 * Trip kit matcher. Pure: matchKit(needs, catalog, profile, carryOn).
 *
 * For each slot the trip needs (src/tags.js SLOTS), pick 1 product and up to
 * 2 alternatives from the catalog.
 *
 * Hard filters: the slot's type tag; `available`; with carry-on on, liquids
 * must be tagged `under-100ml`. A product is picked for one slot only.
 *
 * Score (PLAN.md section 9):
 *   +3 skin-type tag matches          +3 fitz group tag matches
 *   +3 no-white-cast for V–VI         +3 spf-50/spf-50-plus for I–II/albinism or UV ≥ 8
 *   +2 matte for oily/combination on humid trips
 *   +2 cream for dry skin or cold trips
 *   +2 fragrance-free with a redness concern
 *   +2 acne-prone with an acne concern
 *   +1 per trip need present          +1 travel-size
 * Ties: cheaper first, then handle A→Z.
 */

import { SLOTS, LIQUID_TYPES, TAG_LABELS, SKIN_TYPES, fitzGroup } from "./tags.js";

export const KIT_DISCLAIMER = "Demo shop. Not affiliated with these brands. Not medical advice: check labels and patch-test new products.";
export const ALTERNATIVES = 2;

const DISPLAY_ONLY = ["spf-50-plus", "spf-50", "spf-30", "upf-50", "uv400"];

export const W = { skin: 3, fitz: 3, noWhiteCast: 3, spf50: 3, matte: 2, cream: 2, fragranceFree: 2, acne: 2, need: 1, travel: 1 };

const typeOf = (p) => (p.tags || []).find((t) => t.startsWith("type-")) || null;

/** → {score, matched:[tag]} — matched tags become the "why" chips. */
export function scoreProduct(p, ctx) {
  const tags = new Set(p.tags || []);
  const { profile, needs } = ctx;
  let score = 0;
  const matched = [];
  const add = (pts, tag) => {
    score += pts;
    if (tag && !matched.includes(tag)) matched.push(tag);
  };
  if (tags.has(profile.skinType)) add(W.skin, profile.skinType);
  const group = fitzGroup(profile.fitz, profile.albinism);
  if (group && tags.has(group)) add(W.fitz, group);
  const deep = !profile.albinism && (profile.fitz === "V" || profile.fitz === "VI");
  if (deep && tags.has("no-white-cast")) add(W.noWhiteCast, "no-white-cast");
  const fair = profile.albinism || profile.fitz === "I" || profile.fitz === "II";
  if ((fair || needs.has("uv-8-plus")) && (tags.has("spf-50") || tags.has("spf-50-plus"))) add(W.spf50, tags.has("spf-50-plus") ? "spf-50-plus" : "spf-50");
  if ((profile.skinType === "oily" || profile.skinType === "combination") && needs.has("humid") && tags.has("matte")) add(W.matte, "matte");
  if ((profile.skinType === "dry" || needs.has("cold")) && tags.has("cream")) add(W.cream, "cream");
  const concerns = profile.concerns || [];
  if (concerns.includes("redness") && tags.has("fragrance-free")) add(W.fragranceFree, "fragrance-free");
  if (concerns.includes("acne") && tags.has("acne-prone")) add(W.acne, "acne-prone");
  // Skin-type words double as needs ("dry" air), but on a product they mean the
  // skin type, so they only score through the skin-type match above.
  for (const n of needs) if (tags.has(n) && !SKIN_TYPES.includes(n)) add(W.need, n);
  if (tags.has("travel-size")) add(W.travel, "travel-size");
  if (ctx.carryOn && tags.has("under-100ml")) matched.push("under-100ml");
  // Shown as chips but worth no points: what the product is (SPF, UPF, UV400).
  for (const t of DISPLAY_ONLY) if (tags.has(t) && !matched.includes(t)) matched.push(t);
  return { score, matched: [...new Set(matched)] };
}

export function passes(p, slot, carryOn) {
  const type = typeOf(p);
  if (!type || !slot.types.includes(type)) return false;
  if (p.available === false) return false;
  if (carryOn && LIQUID_TYPES.has(type) && !(p.tags || []).includes("under-100ml")) return false;
  // The rich-cream slot wants a cream or a barrier balm, not a light gel.
  if (slot.prefer && !slot.prefer.some((t) => (p.tags || []).includes(t) || type === `type-${t}`)) return false;
  return true;
}

const why = (matched) => matched.map((t) => TAG_LABELS[t]).filter(Boolean);

const publicProduct = (p) => ({
  variantId: p.variantId ?? null, handle: p.handle, title: p.title, vendor: p.vendor || "", price: Number(p.price) || 0,
  currency: p.currency || "USD", image: p.image || null, imageAlt: p.imageAlt || p.title, tags: p.tags || [], available: p.available !== false, url: p.url || null,
});

/** The generic "look for this at a local pharmacy" line for a slot. */
export function lookFor(slot, profile, needs) {
  const deep = !profile.albinism && (profile.fitz === "V" || profile.fitz === "VI");
  const fair = profile.albinism || profile.fitz === "I" || profile.fitz === "II";
  const spf = fair || needs.has("spf-50") ? "SPF 50" : "SPF 30 or higher";
  switch (slot) {
    case "sunscreen": {
      const bits = [`${spf}, broad spectrum (UVA + UVB)`];
      if (deep) bits.push("'no white cast' or tinted");
      if (needs.has("matte") || profile.skinType === "oily") bits.push("matte or oil-free");
      if (needs.has("water-resistant")) bits.push("water resistant (40 or 80 min)");
      if ((profile.concerns || []).includes("redness")) bits.push("fragrance-free");
      return bits.join(", ");
    }
    case "moisturiser-day":
      return needs.has("humid") || profile.skinType === "oily" ? "Light gel or oil-free lotion, non-comedogenic" : "Light lotion with ceramides or hyaluronic acid, fragrance-free";
    case "moisturiser-rich":
      return "Rich cream or balm with ceramides, shea or panthenol, fragrance-free";
    case "cleanser":
      return profile.skinType === "oily" ? "Gentle foaming or gel cleanser, soap-free" : "Gentle cream or lotion cleanser, soap-free, fragrance-free";
    case "lip":
      return "Lip balm with SPF 30 or higher";
    case "mist":
      return "Plain thermal water or a fragrance-free face mist, under 100 ml";
    case "aftersun":
      return "Plain aloe vera gel or a fragrance-free after-sun lotion";
    case "hat":
      return "Wide-brim hat (7 cm or more all round), UPF 50+ if labelled";
    case "sleeves":
      return "UPF 50+ arm sleeves or a long-sleeved UPF shirt";
    case "sunglasses":
      return "Sunglasses labelled UV400 or '100% UVA/UVB', wraparound if you can";
    case "blotting":
      return "Plain blotting papers (oil-absorbing sheets)";
    default:
      return "";
  }
}

const richSlot = (needs) => SLOTS.find((s) => s.slot === "moisturiser-rich").when(needs);

export function matchKit(needsList, catalog, profile, carryOn = true) {
  const needs = new Set(needsList || []);
  const products = Array.isArray(catalog) ? catalog : [];
  const used = new Set();
  const slots = [];
  const buyThere = [];
  for (const slot of SLOTS) {
    if (!slot.when(needs)) continue;
    buyThere.push({ slot: slot.slot, label: slot.label, lookFor: lookFor(slot.slot, profile, needs) });
    let pool = products.filter((p) => !used.has(p.handle) && passes(p, slot, carryOn));
    // When the trip also gets a rich-cream slot, keep the day slot light.
    if (slot.slot === "moisturiser-day" && richSlot(needs)) {
      const light = pool.filter((p) => !(p.tags || []).includes("cream"));
      if (light.length) pool = light;
    }
    const ranked = pool
      .map((p) => ({ p, ...scoreProduct(p, { profile, needs, carryOn }) }))
      .sort((a, b) => b.score - a.score || (Number(a.p.price) || 0) - (Number(b.p.price) || 0) || String(a.p.handle).localeCompare(String(b.p.handle)));
    if (!ranked.length) {
      slots.push({ slot: slot.slot, label: slot.label, pick: null, why: [], alternatives: [], note: "Nothing in our demo shop fits this yet. See 'Buy it there'." });
      continue;
    }
    const [top, ...rest] = ranked;
    used.add(top.p.handle);
    slots.push({
      slot: slot.slot,
      label: slot.label,
      pick: publicProduct(top.p),
      why: why(top.matched),
      score: top.score,
      alternatives: rest.slice(0, ALTERNATIVES).map((r) => ({ ...publicProduct(r.p), why: why(r.matched) })),
    });
  }
  return { slots, buyThere, disclaimer: KIT_DISCLAIMER };
}
