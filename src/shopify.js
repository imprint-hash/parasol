/**
 * Shopify Storefront API client: the Parasol catalog and carts.
 *
 * - The Storefront token is used on the server only (it is a public-type
 *   token, but nothing in public/ needs it).
 * - catalog() reads collection "parasol" and keeps only products that also
 *   carry the `parasol` tag, so the dev store's sample snowboards and gift
 *   card can never appear or be bought. Cached 10 min in memory and 1 h in the
 *   store (pz_wx, id "shop:catalog").
 * - If Shopify can't be reached, catalog() falls back to
 *   products/parasol-products.csv (owned by Coder B) with `live:false`, and
 *   carts are refused with "Shop is offline. Here's the list."
 * - If Shopify answers but the parasol collection has 0 parasol products
 *   (missing, empty, or not published to the token's sales channel), it also
 *   falls back to the CSV list with `live:false`, so the kit still shows
 *   products and checkout is honestly off.
 *
 * catalog() → { products: Product[], live: boolean, source: "shopify"|"csv"|"none", message? }
 *   Product = {variantId, handle, title, vendor, price, currency, image,
 *              imageAlt, tags, available, url}   (PLAN.md section 4)
 * createCart(lines) → { checkoutUrl }
 *
 * SHOPIFY_API_URL points the client at a stub in tests.
 */

import "./env.js";
import { readFileSync } from "node:fs";
import { get, put } from "./store.js";
import { HttpError } from "./http.js";
import { productsFromCsvText } from "./catalog-csv.js";

export const API_VERSION = "2025-07";
const TIMEOUT_MS = 10_000;
const MEMORY_MS = 10 * 60_000;
const STORE_TTL_S = 3600;
export const MAX_LINES = 15;
export const MAX_QTY = 3;
const CSV_PATH = new URL("../products/parasol-products.csv", import.meta.url);

export const shopDomain = () => String(process.env.SHOPIFY_STORE_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const endpoint = () => process.env.SHOPIFY_API_URL || `https://${shopDomain()}/api/${API_VERSION}/graphql.json`;
const isStubbed = () => Boolean(process.env.SHOPIFY_API_URL);

const offline = () => new HttpError("Shop is offline. Here's the list.", 503, "shop_offline");

export const stats = { calls: 0 };

async function gql(query, variables) {
  const token = process.env.SHOPIFY_STOREFRONT_TOKEN;
  if (!token || (!shopDomain() && !isStubbed())) throw offline();
  stats.calls++;
  let res;
  try {
    res = await fetch(endpoint(), {
      method: "POST",
      headers: { "content-type": "application/json", "x-shopify-storefront-access-token": token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw offline();
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.errors?.length) throw offline();
  return json.data;
}

/* ---------- catalog ---------- */

// Products are found by the "parasol" tag (the CSV import tags every product
// but doesn't create a collection); the tag filter below is the second guard.
const CATALOG_QUERY = `query Parasol {
  products(first: 100, query: "tag:parasol") {
    nodes {
      handle title vendor tags onlineStoreUrl
      featuredImage { url altText }
      variants(first: 1) { nodes { id availableForSale price { amount currencyCode } } }
    }
  }
}`;

const hasParasolTag = (tags) => (tags || []).some((t) => String(t).trim().toLowerCase() === "parasol");
const cleanTags = (tags) => [...new Set((tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))];

export function productsFromStorefront(data) {
  const nodes = data?.products?.nodes || data?.collection?.products?.nodes || [];
  return nodes
    .filter((p) => hasParasolTag(p.tags))
    .map((p) => {
      const v = p.variants?.nodes?.[0];
      if (!v?.id) return null;
      return {
        variantId: v.id,
        handle: p.handle,
        title: p.title,
        vendor: p.vendor || "",
        price: Number(v.price?.amount) || 0,
        currency: v.price?.currencyCode || "USD",
        image: p.featuredImage?.url || null,
        imageAlt: p.featuredImage?.altText || p.title,
        tags: cleanTags(p.tags),
        available: Boolean(v.availableForSale),
        url: p.onlineStoreUrl || (shopDomain() ? `https://${shopDomain()}/products/${p.handle}` : null),
      };
    })
    .filter(Boolean);
}

/** Minimal RFC 4180 CSV parser (quotes, doubled quotes, newlines in quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f !== ""));
}

/** products/parasol-products.csv → Product[] (no variantId: the cart is off). */
export function productsFromCsv(text) {
  const [head, ...rows] = parseCsv(text.replace(/^﻿/, ""));
  if (!head) return [];
  const col = (name) => head.findIndex((h) => h.trim().toLowerCase() === name);
  const at = { title: col("title"), handle: col("url handle"), vendor: col("vendor"), tags: col("tags"), price: col("price"), image: col("product image url"), alt: col("image alt text"), status: col("status") };
  const v = (r, k) => (at[k] >= 0 ? String(r[at[k]] ?? "").trim() : "");
  return rows
    .filter((r) => v(r, "handle") && v(r, "title"))
    .map((r) => ({ tags: v(r, "tags").split(",").map((t) => t.trim()).filter(Boolean), r }))
    .filter(({ tags }) => hasParasolTag(tags))
    .map(({ tags, r }) => ({
      variantId: null,
      handle: v(r, "handle"),
      title: v(r, "title"),
      vendor: v(r, "vendor"),
      price: Number(v(r, "price")) || 0,
      currency: "USD",
      image: v(r, "image") || null,
      imageAlt: v(r, "alt") || v(r, "title"),
      tags: cleanTags(tags),
      available: !v(r, "status") || v(r, "status").toLowerCase() === "active",
      url: null,
    }));
}

const OFFLINE_MSG = "Shop is offline. Here's the list.";
const EMPTY_MSG = "The shop has no Parasol products listed yet. Here's the list; checkout is off for now.";

function csvCatalog(message = OFFLINE_MSG) {
  try {
    const products = productsFromCsvText(readFileSync(CSV_PATH, "utf8"));
    return { products, live: false, source: products.length ? "csv" : "none", message };
  } catch {
    return { products: [], live: false, source: "none", message: "Shop is offline." };
  }
}

let memo = null;
/** The Parasol catalog. Never throws: falls back to the CSV list. */
export async function catalog({ fresh = false } = {}) {
  if (!fresh && memo && Date.now() - memo.at < MEMORY_MS) return memo.value;
  const persist = !isStubbed();
  if (!fresh && persist) {
    const saved = await get("pz_wx", "shop:catalog").catch(() => null);
    if (saved && Date.now() - Date.parse(saved.at) < saved.ttl * 1000 && Array.isArray(saved.body?.products)) {
      memo = { at: Date.now(), value: saved.body };
      return saved.body;
    }
  }
  try {
    const products = productsFromStorefront(await gql(CATALOG_QUERY));
    if (!products.length) {
      // Reachable but nothing to sell: show the CSV list, keep checkout off,
      // and re-check soon so publishing the collection shows up quickly.
      const value = csvCatalog(EMPTY_MSG);
      memo = { at: Date.now() - MEMORY_MS + 60_000, value };
      return value;
    }
    const value = { products, live: true, source: "shopify" };
    memo = { at: Date.now(), value };
    if (persist) put("pz_wx", { id: "shop:catalog", at: new Date().toISOString(), ttl: STORE_TTL_S, body: value }).catch(() => {});
    return value;
  } catch {
    const value = csvCatalog();
    // Remember the fallback briefly so an outage doesn't hammer Shopify.
    memo = { at: Date.now() - MEMORY_MS + 60_000, value };
    return value;
  }
}
export const forgetCatalog = () => (memo = null);

let health = null;
/** "ok" or "down", cached 5 minutes. */
export async function shopHealth() {
  if (health && Date.now() - health.at < 5 * 60_000) return health.value;
  let value = "down";
  try {
    const d = await gql("{ shop { name } }");
    value = d?.shop?.name ? "ok" : "down";
  } catch {}
  health = { at: Date.now(), value };
  return value;
}
export const forgetShopHealth = () => (health = null);

/* ---------- cart ---------- */

/** Checks and merges cart lines. Throws HttpError 400 on anything off. */
export function validateLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw new HttpError("Send lines: [{variantId, quantity}].", 400, "bad_cart");
  if (lines.length > MAX_LINES) throw new HttpError(`A cart can have at most ${MAX_LINES} lines.`, 400, "bad_cart");
  const merged = new Map();
  for (const l of lines) {
    const id = l?.variantId, q = l?.quantity;
    if (typeof id !== "string" || !/^gid:\/\/shopify\/ProductVariant\/\d{1,20}$/.test(id)) throw new HttpError("One of the products isn't valid.", 400, "bad_cart");
    if (!Number.isInteger(q) || q < 1 || q > MAX_QTY) throw new HttpError(`Quantity must be a whole number from 1 to ${MAX_QTY}.`, 400, "bad_cart");
    merged.set(id, (merged.get(id) || 0) + q);
  }
  for (const q of merged.values()) if (q > MAX_QTY) throw new HttpError(`At most ${MAX_QTY} of each product.`, 400, "bad_cart");
  return [...merged].map(([variantId, quantity]) => ({ variantId, quantity }));
}

const CART_MUTATION = `mutation Cart($lines: [CartLineInput!]!) {
  cartCreate(input: { lines: $lines }) {
    cart { checkoutUrl }
    userErrors { field message }
  }
}`;

/** Creates a cart from Parasol catalog variants only. Returns {checkoutUrl}. */
export async function createCart(lines) {
  const clean = validateLines(lines);
  const cat = await catalog();
  if (!cat.live) throw offline();
  const known = new Map(cat.products.map((p) => [p.variantId, p]));
  for (const l of clean) {
    const p = known.get(l.variantId);
    if (!p) throw new HttpError("That product isn't in the Parasol shop.", 400, "not_in_catalog");
    if (!p.available) throw new HttpError(`${p.title} is sold out.`, 409, "sold_out");
  }
  const d = await gql(CART_MUTATION, { lines: clean.map((l) => ({ merchandiseId: l.variantId, quantity: l.quantity })) });
  const errs = d?.cartCreate?.userErrors || [];
  const url = d?.cartCreate?.cart?.checkoutUrl;
  if (errs.length || !url) throw new HttpError("The shop couldn't make that cart. Please try again.", 502, "shop_failed");
  let host;
  try {
    const u = new URL(url);
    host = u.protocol === "https:" ? u.host : null;
  } catch {}
  const okHost = host && (isStubbed() || host === shopDomain() || host.endsWith(".myshopify.com"));
  if (!okHost) throw new HttpError("The shop answered with an unexpected checkout address.", 502, "shop_failed");
  return { checkoutUrl: url };
}
