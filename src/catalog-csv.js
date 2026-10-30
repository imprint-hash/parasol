/**
 * products/parasol-products.csv → Product[] (PLAN.md section 4 shape), for the
 * offline catalog. Reads Shopify's classic template (Handle, Variant Price,
 * Image Src, …), which is what the file uses, and the new template (URL
 * handle, Price, Product image URL, …) too, so either export works.
 * Only rows tagged `parasol` are kept. variantId is null: the cart is off.
 */

import { parseCsv } from "./shopify.js";

const COLUMNS = {
  handle: ["handle", "url handle"],
  title: ["title"],
  vendor: ["vendor"],
  tags: ["tags"],
  price: ["variant price", "price"],
  image: ["image src", "product image url"],
  alt: ["image alt text"],
  status: ["status"],
};

const cleanTags = (s) => [...new Set(String(s || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];

export function productsFromCsvText(text) {
  const [head, ...rows] = parseCsv(String(text || "").replace(/^﻿/, ""));
  if (!head) return [];
  const names = head.map((h) => h.trim().toLowerCase());
  const at = Object.fromEntries(Object.entries(COLUMNS).map(([k, opts]) => [k, opts.map((o) => names.indexOf(o)).find((i) => i >= 0) ?? -1]));
  const v = (r, k) => (at[k] >= 0 ? String(r[at[k]] ?? "").trim() : "");
  return rows
    .filter((r) => v(r, "handle") && v(r, "title"))
    .map((r) => ({ r, tags: cleanTags(v(r, "tags")) }))
    .filter(({ tags }) => tags.includes("parasol"))
    .map(({ r, tags }) => ({
      variantId: null,
      handle: v(r, "handle"),
      title: v(r, "title"),
      vendor: v(r, "vendor"),
      price: Number(v(r, "price")) || 0,
      currency: "USD",
      image: v(r, "image") || null,
      imageAlt: v(r, "alt") || v(r, "title"),
      tags,
      available: !v(r, "status") || v(r, "status").toLowerCase() === "active",
      url: null,
    }));
}
