// Shopify Storefront client and /api/cart, against a stub GraphQL server. Offline.
import { startApp } from "./helpers/env.js";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

const state = { down: false, empty: false, userErrors: [], checkoutUrl: "https://test-shop.myshopify.com/cart/c/abc?key=1" };
const calls = [];
const PRODUCTS = [
  { handle: "lrp-anthelios", title: "Anthelios UVMune 400 SPF50+", vendor: "La Roche-Posay", tags: ["parasol", "type-sunscreen", "spf-50-plus"], onlineStoreUrl: null, featuredImage: null, variants: { nodes: [{ id: "gid://shopify/ProductVariant/111", availableForSale: true, price: { amount: "38.0", currencyCode: "USD" } }] } },
  { handle: "sold-out-mist", title: "Mist", vendor: "Evian", tags: ["Parasol", "type-mist"], featuredImage: { url: "https://cdn.shopify.com/x.jpg", altText: "A mist" }, variants: { nodes: [{ id: "gid://shopify/ProductVariant/222", availableForSale: false, price: { amount: "9.5", currencyCode: "USD" } }] } },
  // A sample snowboard that somehow sits in the collection: no parasol tag, never shown.
  { handle: "the-minimal-snowboard", title: "The Minimal Snowboard", vendor: "Snowboard Vendor", tags: ["Winter"], variants: { nodes: [{ id: "gid://shopify/ProductVariant/50065009279235", availableForSale: true, price: { amount: "885.95", currencyCode: "USD" } }] } },
];
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const { query, variables } = JSON.parse(raw);
  calls.push({ token: req.headers["x-shopify-storefront-access-token"], query, variables });
  const send = (s, b) => res.writeHead(s, { "content-type": "application/json" }).end(JSON.stringify(b));
  if (state.down) return send(503, { errors: [{ message: "down" }] });
  if (query.includes("cartCreate")) return send(200, { data: { cartCreate: { cart: state.userErrors.length ? null : { checkoutUrl: state.checkoutUrl }, userErrors: state.userErrors } } });
  if (query.includes("collection(") && state.empty) return send(200, { data: { collection: null } });
  if (query.includes("collection(")) return send(200, { data: { collection: { products: { nodes: PRODUCTS } } } });
  if (query.includes("shop")) return send(200, { data: { shop: { name: "test" } } });
  return send(400, { errors: [{ message: "?" }] });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
process.env.SHOPIFY_API_URL = `http://127.0.0.1:${server.address().port}/graphql`;

const shop = await import("../src/shopify.js");
const { forgetHits } = await import("../src/budget.js");
const app = await startApp();
after(async () => {
  await app.close();
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  Object.assign(state, { down: false, empty: false, userErrors: [], checkoutUrl: "https://test-shop.myshopify.com/cart/c/abc?key=1" });
  calls.length = 0;
  shop.forgetCatalog();
  shop.forgetShopHealth();
  forgetHits();
});

const cartCalls = () => calls.filter((c) => c.query.includes("cartCreate")).length;

test("catalog keeps only parasol-tagged products from the parasol collection", async () => {
  const c = await shop.catalog();
  assert.equal(c.live, true);
  assert.equal(c.source, "shopify");
  assert.deepEqual(c.products.map((p) => p.handle), ["lrp-anthelios", "sold-out-mist"]);
  const p = c.products[0];
  assert.deepEqual(p, { variantId: "gid://shopify/ProductVariant/111", handle: "lrp-anthelios", title: "Anthelios UVMune 400 SPF50+", vendor: "La Roche-Posay", price: 38, currency: "USD", image: null, imageAlt: "Anthelios UVMune 400 SPF50+", tags: ["parasol", "type-sunscreen", "spf-50-plus"], available: true, url: "https://test-shop.myshopify.com/products/lrp-anthelios" });
  assert.equal(c.products[1].image, "https://cdn.shopify.com/x.jpg");
  assert.equal(c.products[1].tags[0], "parasol");
  // Cached: no second call.
  await shop.catalog();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].token, "shop-token-SECRET-123");
});

test("a cart with a parasol variant returns the checkout URL, password and test card", async () => {
  const r = await app.call("POST", "/api/cart", { lines: [{ variantId: "gid://shopify/ProductVariant/111", quantity: 2 }] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.checkoutUrl, state.checkoutUrl);
  assert.equal(r.body.storePassword, "letmein");
  assert.match(r.body.testCard, /Bogus Gateway/);
  const sent = calls.find((c) => c.query.includes("cartCreate")).variables;
  assert.deepEqual(sent, { lines: [{ merchandiseId: "gid://shopify/ProductVariant/111", quantity: 2 }] });
});

test("variants outside the parasol catalog (snowboard, gift card, made-up) are 400 with no cart created", async () => {
  for (const id of ["gid://shopify/ProductVariant/50065009279235", "gid://shopify/ProductVariant/50065009148163", "gid://shopify/ProductVariant/999"]) {
    const r = await app.call("POST", "/api/cart", { lines: [{ variantId: id, quantity: 1 }] });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "not_in_catalog");
  }
  assert.equal(cartCalls(), 0);
});

test("bad quantities, bad ids, too many lines and sold-out items are refused", async () => {
  const v = "gid://shopify/ProductVariant/111";
  for (const lines of [[{ variantId: v, quantity: 0 }], [{ variantId: v, quantity: 4 }], [{ variantId: v, quantity: -1 }], [{ variantId: v, quantity: 1.5 }], [{ variantId: v, quantity: "1" }], [{ variantId: v, quantity: 2 }, { variantId: v, quantity: 2 }], [{ variantId: "gid://shopify/Product/111", quantity: 1 }], [{ variantId: "javascript:alert(1)", quantity: 1 }], [], "x", Array.from({ length: 16 }, (_, i) => ({ variantId: `gid://shopify/ProductVariant/${i + 1}`, quantity: 1 }))]) {
    const r = await app.call("POST", "/api/cart", { lines });
    assert.equal(r.status, 400, JSON.stringify(lines).slice(0, 80));
    assert.equal(r.body.code, "bad_cart");
  }
  const sold = await app.call("POST", "/api/cart", { lines: [{ variantId: "gid://shopify/ProductVariant/222", quantity: 1 }] });
  assert.equal(sold.status, 409);
  assert.equal(cartCalls(), 0);
});

test("Shopify down: catalog falls back to the CSV list and the cart is 503 shop_offline", async () => {
  state.down = true;
  const c = await shop.catalog();
  assert.equal(c.live, false);
  assert.ok(["csv", "none"].includes(c.source));
  assert.ok(c.products.every((p) => p.variantId === null && p.tags.includes("parasol")));
  const r = await app.call("POST", "/api/cart", { lines: [{ variantId: "gid://shopify/ProductVariant/111", quantity: 1 }] });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "shop_offline");
  assert.equal(await shop.shopHealth(), "down");
});

test("Shopify reachable but 0 parasol products: CSV list, live:false, honest message, cart 503", async () => {
  state.empty = true;
  const c = await shop.catalog();
  assert.equal(c.live, false);
  assert.equal(c.source, "csv");
  assert.ok(c.products.length > 0);
  assert.ok(c.products.every((p) => p.variantId === null && p.tags.includes("parasol")));
  assert.match(c.message, /no Parasol products/);
  const r = await app.call("POST", "/api/cart", { lines: [{ variantId: "gid://shopify/ProductVariant/111", quantity: 1 }] });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "shop_offline");
});

test("Shopify userErrors or an off-site checkout URL are 502", async () => {
  state.userErrors = [{ field: ["lines"], message: "nope" }];
  let r = await app.call("POST", "/api/cart", { lines: [{ variantId: "gid://shopify/ProductVariant/111", quantity: 1 }] });
  assert.equal(r.status, 502);
  state.userErrors = [];
  state.checkoutUrl = "http://evil.example/checkout";
  r = await app.call("POST", "/api/cart", { lines: [{ variantId: "gid://shopify/ProductVariant/111", quantity: 1 }] });
  assert.equal(r.status, 502);
  assert.equal(r.body.code, "shop_failed");
});

test("CSV parsing: quotes, commas and newlines in fields; only parasol-tagged rows", () => {
  const csv = '﻿Title,URL handle,Vendor,Tags,Price,Status,Product image URL,Image alt text\n"Gel, light",gel-light,Neutrogena,"parasol, type-moisturiser, gel",21.99,Active,,\n"Board ""X""",board,Snow,Winter,500,Active,,\n"Two\nlines",two,V,parasol,1,Draft,,\n';
  const ps = shop.productsFromCsv(csv);
  assert.deepEqual(ps.map((p) => p.handle), ["gel-light", "two"]);
  assert.equal(ps[0].title, "Gel, light");
  assert.deepEqual(ps[0].tags, ["parasol", "type-moisturiser", "gel"]);
  assert.equal(ps[0].price, 21.99);
  assert.equal(ps[1].title, "Two\nlines");
  assert.equal(ps[1].available, false);
  assert.deepEqual(shop.parseCsv('a,"b ""q""",c\r\n1,2,3'), [["a", 'b "q"', "c"], ["1", "2", "3"]]);
});

test("health reports shopify ok when the stub answers", async () => {
  const r = await app.call("GET", "/api/health");
  assert.equal(r.body.shopify, "ok");
});
