/**
 * The product catalog (products/parasol-products.csv) against the rules in
 * PLAN.md section 9. With LIVE_SHOP=1 and real Shopify env vars it also
 * checks the live store's parasol collection with the same rules.
 */
import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv } from "../src/shopify.js";
import { productsFromCsvText } from "../src/catalog-csv.js";
import { PRODUCT_TAGS, TYPE_TAGS, LIQUID_TYPES } from "../src/tags.js";

const TEXT = readFileSync(new URL("../products/parasol-products.csv", import.meta.url), "utf8");
const SOURCES = readFileSync(new URL("../products/SOURCES.md", import.meta.url), "utf8");
const [HEAD, ...ROWS] = parseCsv(TEXT);
const col = (name) => HEAD.indexOf(name);
const cell = (r, name) => r[col(name)];
const PRODUCTS = productsFromCsvText(TEXT);

const EXPECTED_HEADER = "Handle,Title,Body (HTML),Vendor,Product Category,Type,Tags,Published,Option1 Name,Option1 Value,Option1 Linked To,Option2 Name,Option2 Value,Option2 Linked To,Option3 Name,Option3 Value,Option3 Linked To,Variant SKU,Variant Grams,Variant Inventory Tracker,Variant Inventory Policy,Variant Fulfillment Service,Variant Price,Variant Compare At Price,Variant Requires Shipping,Variant Taxable,Unit Price Total Measure,Unit Price Total Measure Unit,Unit Price Base Measure,Unit Price Base Measure Unit,Variant Barcodes,Image Src,Image Position,Image Alt Text,Gift Card,SEO Title,SEO Description,Variant Image,Variant Weight Unit,Variant Tax Code,Cost per item,Included / Canada,Price / Canada,Compare At Price / Canada,Status,Variant Packed Length,Variant Packed Width,Variant Packed Height,Variant Packed Dimension Unit,Collection";

export function checkProducts(products) {
  for (const p of products) {
    const types = p.tags.filter((t) => t.startsWith("type-"));
    assert.equal(types.length, 1, `${p.handle}: exactly one type tag (${types})`);
    for (const t of p.tags) assert.ok(PRODUCT_TAGS.has(t), `${p.handle}: unknown tag "${t}"`);
    assert.ok(p.tags.includes("parasol"), `${p.handle}: parasol tag`);
    const spf = p.tags.filter((t) => /^spf-/.test(t));
    assert.ok(spf.length <= 1, `${p.handle}: one SPF tag at most`);
    if (p.tags.includes("type-sunscreen") || p.tags.includes("type-lip")) assert.equal(spf.length, 1, `${p.handle}: sunscreens and lip SPFs state their SPF`);
    if (p.tags.includes("under-100ml") || p.tags.includes("travel-size")) {
      // Only meaningful for liquids and packable items; never on something that isn't small.
      assert.ok(LIQUID_TYPES.has(types[0]) || ["type-hat", "type-sleeves", "type-lip"].includes(types[0]) || !p.tags.includes("under-100ml"), `${p.handle}: under-100ml on a non-liquid`);
    }
    assert.ok(p.price > 0, `${p.handle}: price`);
  }
  const has = (...tags) => products.filter((p) => tags.every((t) => p.tags.includes(t)));
  const sun = has("type-sunscreen");
  assert.ok(sun.filter((p) => p.tags.includes("spf-50") || p.tags.includes("spf-50-plus")).length >= 2, "≥2 SPF 50+ sunscreens for very fair skin");
  assert.ok(sun.filter((p) => p.tags.includes("no-white-cast") || p.tags.includes("tinted")).length >= 4, "≥4 no-white-cast or tinted for deep skin");
  assert.ok(has("type-sunscreen", "matte").length >= 2, "≥2 matte sunscreens for oily skin");
  assert.ok(sun.filter((p) => p.tags.includes("dry") || p.tags.includes("dewy")).length >= 1, "≥1 hydrating sunscreen for dry skin");
  assert.ok(has("type-hat", "upf-50").length >= 1, "a UPF 50 hat");
  assert.ok(has("type-sleeves", "upf-50").length >= 1, "UPF 50 sleeves");
  assert.ok(has("type-sunglasses", "uv400").length >= 1, "UV400 sunglasses");
  // Every slot can be filled with carry-on on.
  for (const t of TYPE_TAGS) {
    const inType = has(t);
    assert.ok(inType.length >= 1, `at least one ${t}`);
    if (LIQUID_TYPES.has(t) && t !== "type-barrier") assert.ok(inType.some((p) => p.tags.includes("under-100ml")), `${t}: a carry-on size`);
  }
}

test("header matches the store's classic export exactly (minus snowboard metafields), plus Collection", () => {
  assert.equal(HEAD.join(","), EXPECTED_HEADER);
});

test("30–36 products, unique handles and SKUs, every row the same width", () => {
  assert.ok(ROWS.length >= 30 && ROWS.length <= 36, `${ROWS.length} rows`);
  assert.equal(new Set(ROWS.map((r) => cell(r, "Handle"))).size, ROWS.length);
  assert.equal(new Set(ROWS.map((r) => cell(r, "Variant SKU"))).size, ROWS.length);
  for (const r of ROWS) assert.equal(r.length, HEAD.length, cell(r, "Handle"));
  assert.equal(PRODUCTS.length, ROWS.length);
});

test("fixed columns use the export's own spellings", () => {
  for (const r of ROWS) {
    const h = cell(r, "Handle");
    assert.match(h, /^[a-z0-9]+(-[a-z0-9]+)*$/, h);
    assert.equal(cell(r, "Option1 Name"), "Title", h);
    assert.equal(cell(r, "Option1 Value"), "Default Title", h);
    assert.equal(cell(r, "Published"), "true", h);
    assert.equal(cell(r, "Status"), "active", h);
    // Not tracked: no quantity column in the classic template, and tracked + 0 + deny = unbuyable.
    assert.equal(cell(r, "Variant Inventory Tracker"), "", h);
    assert.equal(cell(r, "Variant Inventory Policy"), "deny", h);
    assert.equal(cell(r, "Variant Requires Shipping"), "true", h);
    assert.equal(cell(r, "Variant Taxable"), "true", h);
    assert.equal(cell(r, "Variant Fulfillment Service"), "manual", h);
    assert.equal(cell(r, "Gift Card"), "false", h);
    assert.equal(cell(r, "Collection"), "Parasol", h);
    assert.match(cell(r, "Variant Price"), /^\d+\.\d{2}$/, h);
  }
});

test("descriptions end with the not-affiliated line and contain no scripts", () => {
  for (const r of ROWS) {
    const d = cell(r, "Body (HTML)");
    assert.ok(d.endsWith("<p>Demo shop. Not affiliated with this brand.</p>"), cell(r, "Handle"));
    assert.doesNotMatch(d, /<script|javascript:|on\w+=/i);
  }
});

test("images only from Open Beauty Facts, with an OBF code in SOURCES.md", () => {
  for (const r of ROWS) {
    const img = cell(r, "Image Src");
    if (!img) continue;
    assert.match(img, /^https:\/\/images\.openbeautyfacts\.org\//, cell(r, "Handle"));
    const line = SOURCES.split("\n").find((l) => l.startsWith(`| ${cell(r, "Handle")} |`));
    assert.match(line, /\| \d{8,14} \|$/, `${cell(r, "Handle")}: OBF code recorded`);
  }
});

test("every product has a SOURCES.md line with a URL and a date", () => {
  for (const r of ROWS) {
    const h = cell(r, "Handle");
    const line = SOURCES.split("\n").find((l) => l.startsWith(`| ${h} |`));
    assert.ok(line, `${h} in SOURCES.md`);
    assert.match(line, /\| https:\/\/[^ ]+ \| \d{4}-\d{2}-\d{2} \|/, h);
  }
});

test("tags: vocabulary, one type tag, parasol, and coverage minimums", () => {
  checkProducts(PRODUCTS);
});

test("live store matches the same rules (LIVE_SHOP=1 only)", { skip: process.env.LIVE_SHOP !== "1" }, async () => {
  // test/helpers/env.js swapped in fake Shopify settings; put the real ones back from .env.
  const env = Object.fromEntries(
    readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n").map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]),
  );
  process.env.SHOPIFY_STORE_DOMAIN = env.SHOPIFY_STORE_DOMAIN;
  process.env.SHOPIFY_STOREFRONT_TOKEN = env.SHOPIFY_STOREFRONT_TOKEN;
  delete process.env.SHOPIFY_API_URL;
  const { catalog } = await import("../src/shopify.js");
  const shop = await catalog({ fresh: true });
  assert.equal(shop.source, "shopify");
  checkProducts(shop.products);
  const live = new Set(shop.products.map((p) => p.handle));
  for (const p of PRODUCTS) assert.ok(live.has(p.handle), `${p.handle} is in the live parasol collection`);
});
