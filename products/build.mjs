#!/usr/bin/env node
/**
 * Builds products/parasol-products.csv (Shopify's classic product CSV
 * template, as exported by the dev store, plus a final "Collection" column) and products/SOURCES.md from the list
 * below. This file is the single source of every product claim: change a
 * claim here, re-run `node products/build.mjs`, and both outputs follow.
 *
 * Rules (PLAN.md section 9):
 * - Every claim in `desc` was read on the source page on `checked`. A product
 *   with a claim we could not verify was dropped (see DROPPED).
 * - Photos come from products/photos.json. Only openly licensed ones (Open
 *   Beauty Facts, CC BY-SA) are used, in the CSV "Image Src" and as local
 *   copies in public/products/; no brand photography. Credits are written into THIRD_PARTY_NOTICES.md.
 * - Tags only from src/tags.js; exactly one type-* tag; `parasol` added here.
 * - Prices are the USD price on the source page on the date checked.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const PHOTOS = JSON.parse(readFileSync(new URL("photos.json", import.meta.url), "utf8"));
const OPEN = (ph) => ph?.source === "open-beauty-facts";

// Shopify's CLASSIC product template, column for column as in the dev store's
// own export (products_export_1.csv, 30 Oct 2026), minus the two snowboard
// metafield columns, plus "Collection": the one extra column Shopify's
// importer accepts (help.shopify.com/en/manual/products/import-export/using-csv);
// it creates the collection "Parasol" (handle parasol) if it doesn't exist.
const HEADER = [
  "Handle", "Title", "Body (HTML)", "Vendor", "Product Category", "Type", "Tags", "Published",
  "Option1 Name", "Option1 Value", "Option1 Linked To", "Option2 Name", "Option2 Value", "Option2 Linked To",
  "Option3 Name", "Option3 Value", "Option3 Linked To", "Variant SKU", "Variant Grams",
  "Variant Inventory Tracker", "Variant Inventory Policy", "Variant Fulfillment Service", "Variant Price",
  "Variant Compare At Price", "Variant Requires Shipping", "Variant Taxable", "Unit Price Total Measure",
  "Unit Price Total Measure Unit", "Unit Price Base Measure", "Unit Price Base Measure Unit", "Variant Barcodes",
  "Image Src", "Image Position", "Image Alt Text", "Gift Card", "SEO Title", "SEO Description",
  "Variant Image", "Variant Weight Unit", "Variant Tax Code", "Cost per item", "Included / Canada",
  "Price / Canada", "Compare At Price / Canada", "Status", "Variant Packed Length", "Variant Packed Width",
  "Variant Packed Height", "Variant Packed Dimension Unit", "Collection",
];

const NOT_AFFILIATED = "Demo shop. Not affiliated with this brand.";

// How each source was read:
//   brand-json   the brand's own Shopify product JSON / page, fetched directly
//   page         the retailer or brand page, fetched directly (JSON-LD offer)
//   page-ai      the brand page, read through a fetch-and-summarise tool
//   search       the retailer page as captured by a web search index (price only)
const P = [
  // ---------------- sunscreens ----------------
  {
    handle: "supergoop-unseen-sunscreen-spf-50-mini", title: "Supergoop! Unseen Sunscreen SPF 50 (0.68 fl oz)", vendor: "Supergoop!", type: "Sunscreen",
    price: 19.0, tags: ["type-sunscreen", "spf-50", "chemical", "no-white-cast", "gel", "normal", "combination", "dry", "oily", "sensitive", "acne-prone", "fitz-1-2", "fitz-3-4", "fitz-5-6", "under-100ml"],
    desc: ["Broad spectrum SPF 50 in a clear, weightless gel with a natural finish.", "The brand says: no white cast on all skin tones; recommended for normal, combination, dry, oily, sensitive or acne-prone skin.", "Filters: avobenzone, homosalate, octisalate, octocrylene.", "Not labelled water resistant.", "0.68 fl oz."],
    src: "https://supergoop.com/products/unseen-sunscreen-spf-50", how: "brand-json", claims: "SPF 50; 0.68 fl oz $19; clear gel, natural finish; no white cast on all skin tones; skin types listed; actives avobenzone 3%, homosalate 7%, octisalate 5%, octocrylene 9%; page says use a water-resistant sunscreen if swimming (not WR)",
  },
  {
    handle: "supergoop-play-everyday-lotion-spf-50-1oz", title: "Supergoop! PLAY Everyday Lotion SPF 50 (1 fl oz)", vendor: "Supergoop!", type: "Sunscreen",
    price: 12.0, tags: ["type-sunscreen", "spf-50", "water-resistant", "no-white-cast", "high-uv", "under-100ml"],
    desc: ["Broad spectrum SPF 50 lotion for face and body.", "Water and sweat resistant (80 minutes).", "The brand says: no white cast, non-comedogenic, fast-absorbing and non-greasy.", "1 fl oz."],
    src: "https://supergoop.com/products/everyday-sunscreen", how: "brand-json", claims: "SPF 50; 1 fl oz $12; water- & sweat-resistant 80 min; no white cast; non-comedogenic; face & body",
  },
  {
    handle: "supergoop-mineral-mattescreen-spf-40-mini", title: "Supergoop! Mineral Mattescreen SPF 40, Sunrise (0.68 fl oz)", vendor: "Supergoop!", type: "Sunscreen",
    price: 24.0, tags: ["type-sunscreen", "spf-30", "mineral", "tinted", "matte", "normal", "combination", "oily", "sensitive", "humid", "under-100ml"],
    desc: ["Tinted mineral sunscreen, broad spectrum SPF 40, with a matte finish that blurs the look of pores.", "Filters: zinc oxide 17.42%, titanium dioxide 1.33%.", "Recommended by the brand for normal, combination, oily or sensitive skin.", "Not labelled water resistant.", "Shade Sunrise, 0.68 fl oz."],
    src: "https://supergoop.com/products/smooth-and-poreless-mattescreen", how: "brand-json", claims: "SPF 40; Sunrise 0.68 fl oz $24; mineral (ZnO 17.42%, TiO2 1.33%); tinted; matte finish; normal/combination/oily/sensitive; not WR",
  },
  {
    handle: "supergoop-play-everyday-face-lotion-spf-50-fragrance-free", title: "Supergoop! PLAY Everyday Face Lotion SPF 50 Fragrance-Free (1.7 fl oz)", vendor: "Supergoop!", type: "Sunscreen",
    price: 16.0, tags: ["type-sunscreen", "spf-50", "no-white-cast", "fragrance-free", "dry", "normal", "under-100ml"],
    desc: ["Broad spectrum SPF 50 face lotion, fragrance-free.", "The brand says: blends in clear with no white cast, non-greasy, and gives 24 hours of hydration.", "1.7 fl oz."],
    src: "https://supergoop.com/products/play-everyday-face-lotion-spf-50", how: "brand-json", claims: "SPF 50; 1.7 fl oz $16; fragrance-free; no white cast; 24h hydration (brand claim)",
  },
  {
    handle: "supergoop-glowscreen-spf-40-mini", title: "Supergoop! Glowscreen SPF 40, Sunrise (0.68 fl oz)", vendor: "Supergoop!", type: "Sunscreen",
    price: 19.0, tags: ["type-sunscreen", "spf-30", "tinted", "dewy", "dry", "normal", "under-100ml"],
    desc: ["Tinted sunscreen, broad spectrum SPF 40, with a luminous finish.", "The brand says it primes for makeup and is clinically tested for all-day hydration.", "Shade Sunrise, 0.68 fl oz."],
    src: "https://supergoop.com/products/glowscreen-spf-40", how: "brand-json", claims: "SPF 40; Sunrise .68 fl oz $19; tinted; luminous (dewy) finish; all-day hydration (brand claim)",
  },
  {
    handle: "eltamd-uv-clear-spf-46-deluxe-mini", title: "EltaMD UV Clear Broad-Spectrum SPF 46, Deluxe Mini (0.5 oz)", vendor: "EltaMD", type: "Sunscreen",
    price: 23.5, tags: ["type-sunscreen", "spf-30", "hybrid", "no-white-cast", "fragrance-free", "fitz-1-2", "fitz-3-4", "travel-size", "under-100ml"],
    desc: ["Broad spectrum SPF 46 with 5% niacinamide.", "Filters: zinc oxide 9%, octinoxate 7.5%.", "Fragrance-free, oil-free and non-comedogenic; the brand says it wears without a white cast and works best on fair to medium skin tones.", "Not labelled water resistant.", "Deluxe mini, net wt 0.5 oz (14 g)."],
    src: "https://eltamd.com/products/eltamd-uv-clear-broad-spectrum-spf-46-copy", how: "brand-json", claims: "SPF 46; deluxe mini 0.5 oz/14 g $23.50; ZnO 9% + octinoxate 7.5% (full-size page); fragrance-free; no white cast; fair to medium tones; page says use WR sunscreen if swimming (not WR)",
  },
  {
    handle: "eltamd-uv-clear-tinted-spf-46-deluxe-mini", title: "EltaMD UV Clear Tinted SPF 46, Deluxe Mini (0.5 oz)", vendor: "EltaMD", type: "Sunscreen",
    price: 24.5, tags: ["type-sunscreen", "spf-30", "hybrid", "tinted", "fragrance-free", "sensitive", "acne-prone", "fitz-1-2", "fitz-3-4", "travel-size", "under-100ml"],
    desc: ["Broad spectrum SPF 46 with a sheer tint and 5% niacinamide.", "Filters: zinc oxide 9%, octinoxate 7.5%.", "Fragrance-free and oil-free; the brand designs it for sensitive, rosacea and acne-prone skin, best on light to medium-deep tones.", "Not labelled water resistant.", "Deluxe mini, net wt 0.5 oz (14 g)."],
    src: "https://eltamd.com/products/mini-deluxe-uv-clear-tinted-broad-spectrum-spf-46", how: "brand-json", claims: "SPF 46; deluxe mini 0.5 oz $24.50; tinted; ZnO 9% + octinoxate 7.5%; fragrance-free; sensitive/rosacea/acne-prone; light to medium-deep tones; not WR",
  },
  {
    handle: "eltamd-uv-clear-deep-tinted-spf-46", title: "EltaMD UV Clear Deep Tinted SPF 46 (1.7 oz)", vendor: "EltaMD", type: "Sunscreen",
    price: 48.0, tags: ["type-sunscreen", "spf-30", "tinted", "no-white-cast", "fragrance-free", "sensitive", "fitz-5-6", "under-100ml"],
    desc: ["Broad spectrum SPF 46 designed and tested on deeper skin tones, with micronized zinc oxide and 5% niacinamide.", "The brand says it blends in sheer with no white cast on deeper skin; fragrance-free, oil-free, suitable for sensitive skin.", "Not labelled water resistant.", "Net wt 1.7 oz (48 g)."],
    src: "https://eltamd.com/products/eltamd-uv-clear-deep-tinted-broad-spectrum-spf-46", how: "brand-json", claims: "SPF 46; 1.7 oz/48 g $48; designed & tested on deeper skin tones; no white cast; fragrance-free; sensitive; not WR",
  },
  {
    handle: "eltamd-uv-clear-blemish-prone-oil-balancing-spf-50-deluxe-mini", title: "EltaMD UV Clear Blemish-Prone & Oil Balancing SPF 50, Deluxe Mini (0.5 oz)", vendor: "EltaMD", type: "Sunscreen",
    price: 25.5, tags: ["type-sunscreen", "spf-50", "hybrid", "no-white-cast", "oily", "acne-prone", "travel-size", "under-100ml"],
    desc: ["Hybrid broad spectrum SPF 50 made for and tested on acne-prone skin, with 5% niacinamide.", "The brand says it helps with excess oil, is non-comedogenic, and leaves a transparent natural finish with no white cast.", "Not labelled water resistant.", "Deluxe mini, net wt 0.5 oz (14 g)."],
    src: "https://eltamd.com/products/deluxe-mini-uv-clear-blemish-prone-oil-balancing-spf-50", how: "brand-json", claims: "SPF 50; deluxe mini 0.5 oz $25.50; hybrid; acne-prone; reduces excess oil (brand claim); transparent finish; no white cast",
  },
  {
    handle: "black-girl-sunscreen-make-it-matte-spf-45", title: "Black Girl Sunscreen Make It Matte SPF 45", vendor: "Black Girl Sunscreen", type: "Sunscreen",
    price: 21.99, tags: ["type-sunscreen", "spf-30", "chemical", "matte", "no-white-cast", "water-resistant", "fragrance-free", "fitz-5-6"],
    desc: ["Broad spectrum SPF 45 with a matte finish.", "Water resistant (80 minutes).", "The brand guarantees it free of white cast, fragrance, parabens, oxybenzone and octinoxate.", "Filters: homosalate, octisalate, octocrylene, avobenzone."],
    src: "https://blackgirlsunscreen.com/product/make-it-matte-spf-45/", how: "page-ai", claims: "SPF 45; $21.99; matte; WR 80 min; free of white cast & fragrance; actives homosalate 10%, octisalate 5%, octocrylene 10%, avobenzone 3%. Size NOT listed on page, so no size claim and no under-100ml tag",
  },
  {
    handle: "beauty-of-joseon-relief-sun-spf50", title: "Beauty of Joseon Relief Sun: Rice + Niacinamide SPF50+ (50 ml)", vendor: "Beauty of Joseon", type: "Sunscreen",
    price: 18.0, tags: ["type-sunscreen", "spf-50-plus", "dewy", "dry", "under-100ml"],
    desc: ["SPF50+ PA++++ sunscreen with rice extract.", "The brand describes a creamy yet lightweight texture that hydrates without stickiness and leaves skin looking dewy.", "Not labelled water resistant.", "50 ml (1.69 fl oz)."],
    src: "https://beautyofjoseon.com/products/relief-sun-rice-probiotics", how: "brand-json", claims: "SPF50+ PA++++; 50 ml/1.69 fl oz $18 (1-pack); hydrating, dewy (brand claim). Shown sold out on the brand's global store on the date checked",
  },
  {
    handle: "cerave-hydrating-mineral-sunscreen-spf-30-sheer-tint-deep", title: "CeraVe Hydrating Mineral Sunscreen SPF 30 Face Sheer Tint, Deep (1.7 fl oz)", vendor: "CeraVe", type: "Sunscreen",
    price: 15.99, tags: ["type-sunscreen", "spf-30", "mineral", "tinted", "no-white-cast", "sensitive", "acne-prone", "fitz-5-6", "under-100ml"],
    desc: ["Tinted mineral sunscreen, broad spectrum SPF 30, made for deep skin tones.", "Filters: titanium dioxide and zinc oxide, with hyaluronic acid, niacinamide and ceramides.", "The brand says it blends on without leaving a white cast; made for all skin types including acne-prone and sensitive.", "Not labelled water resistant.", "1.7 fl oz."],
    src: "https://www.cerave.com/sunscreen/face/hydrating-mineral-sunscreen-spf-30-face-sheer-tint-deep", how: "page", claims: "SPF 30; 1.7 fl oz $15.99; mineral (TiO2 + ZnO); tinted, shade Deep; deep skin tones; no white cast; acne-prone & sensitive",
  },
  {
    handle: "la-roche-posay-anthelios-ultra-light-mineral-spf-50", title: "La Roche-Posay Anthelios Ultra-Light Mineral Sunscreen SPF 50 (1.7 fl oz)", vendor: "La Roche-Posay", type: "Sunscreen",
    price: 42.99, tags: ["type-sunscreen", "spf-50", "mineral", "matte", "no-white-cast", "water-resistant", "sensitive", "fluid", "under-100ml"],
    desc: ["100% mineral (zinc oxide, titanium dioxide) broad spectrum SPF 50, developed for sensitive skin.", "Non-whitening, fast-absorbing texture with a matte finish.", "Water resistant (40 minutes).", "1.7 fl oz."],
    src: "https://www.dermstore.com/p/la-roche-posay-anthelios-mineral-ultra-light-sunscreen-fluid-spf-50/11429027/", how: "page", claims: "SPF 50; 1.7 fl oz $42.99 (Dermstore offer); mineral ZnO + TiO2; matte; non-whitening; WR 40 min; sensitive skin",
  },
  {
    handle: "la-roche-posay-anthelios-uv-hydra-spf-50", title: "La Roche-Posay Anthelios UV Hydra Daily Invisible Sunscreen SPF 50 (1.7 fl oz)", vendor: "La Roche-Posay", type: "Sunscreen",
    price: 39.99, tags: ["type-sunscreen", "spf-50", "dewy", "no-white-cast", "dry", "fitz-1-2", "fitz-3-4", "fitz-5-6", "under-100ml"],
    desc: ["Daily hydrating broad spectrum SPF 50 with hyaluronic acid, for all skin types including dry skin.", "The brand says the invisible finish blends into all skin tones and leaves skin dewy, with 48-hour hydration.", "Not labelled water resistant.", "1.7 fl oz."],
    src: "https://www.dermstore.com/p/la-roche-posay-anthelios-uv-hydra-daily-invisible-sunscreen-spf-50-50ml/14926194/", how: "page", claims: "SPF 50; 1.7 fl oz $39.99 (Dermstore offer); hydrating, dry skin; invisible on all skin tones; dewy finish; 48h hydration (brand claim)",
  },

  // ---------------- moisturisers and barrier ----------------
  {
    handle: "neutrogena-hydro-boost-water-gel", title: "Neutrogena Hydro Boost Water Gel (1.7 oz)", vendor: "Neutrogena", type: "Moisturiser",
    price: 26.99, tags: ["type-moisturiser", "gel", "dewy", "normal", "oily", "combination", "humid", "under-100ml"],
    desc: ["Ultra-light water gel moisturiser with hyaluronic acid for normal to oily and combination skin.", "Leaves skin looking refreshed and dewy. Contains the brand's signature fragrance.", "1.7 oz."],
    src: "https://www.neutrogena.com/products/skincare/neutrogena-hydro-boost-water-gel-with-hyaluronic-acid/6811047", how: "page", claims: "Water gel; hyaluronic acid; normal to oily & combination; dewy; with signature fragrance; 1.7 oz. Price $26.99 from Ulta (search): https://www.ulta.com/p/hydro-boost-water-gel-pimprod2043020?sku=2620419",
  },
  {
    handle: "cerave-moisturizing-cream-travel", title: "CeraVe Moisturizing Cream, Travel Size (1.89 oz)", vendor: "CeraVe", type: "Moisturiser",
    price: 6.0, tags: ["type-moisturiser", "cream", "dry", "normal", "fragrance-free", "barrier", "cold", "travel-size", "under-100ml"],
    desc: ["Rich moisturising cream for normal to dry skin, with ceramides.", "Fragrance-free; the brand says it helps repair and maintain the skin barrier.", "Travel size, 1.89 oz."],
    src: "https://www.cerave.com/skincare/moisturizers/moisturizing-cream", how: "page", claims: "Cream; normal to dry skin; fragrance-free; helps repair skin barrier; 1.89 fl oz size listed. Price $6.00 (one-time purchase) from Walmart (search): https://www.walmart.com/ip/CeraVe-Moisturizing-Cream-1-89-Oz/116279093",
  },
  {
    handle: "vanicream-daily-facial-moisturizer", title: "Vanicream Daily Facial Moisturizer (3 fl oz)", vendor: "Vanicream", type: "Moisturiser",
    price: 13.97, tags: ["type-moisturiser", "fragrance-free", "sensitive", "oily", "dry", "combination", "normal", "under-100ml"],
    desc: ["Lightweight, non-greasy daily facial moisturiser with ceramides and hyaluronic acid.", "Made for sensitive skin and, says the brand, suitable for oily, dry and combination skin. Fragrance-free and non-comedogenic.", "3 fl oz."],
    src: "https://www.vanicream.com/product/vanicream-daily-facial-moisturizer", how: "page", claims: "Non-greasy, non-comedogenic; all skin types incl. sensitive, oily, dry, combination; fragrance free. Price $13.97 and 3 fl oz from Walmart (search): https://www.walmart.com/ip/Vanicream-Daily-Facial-Moisturizer/131271676",
  },
  {
    handle: "la-roche-posay-cicaplast-balm-b5-plus-40ml", title: "La Roche-Posay Cicaplast Balm B5+ (40 ml)", vendor: "La Roche-Posay", type: "Barrier balm",
    price: 18.99, tags: ["type-barrier", "cream", "barrier", "cold", "dry", "sensitive", "fragrance-free", "under-100ml"],
    desc: ["Multi-purpose soothing balm with panthenol, madecassoside and shea butter for dry, chapped and irritated skin on face and body.", "The brand says it helps protect skin from the drying effects of wind and cold. Fragrance-free and non-comedogenic.", "40 ml."],
    src: "https://www.dermstore.com/p/la-roche-posay-cicaplast-balm-b5-soothing-therapeutic-multi-purpose-cream-40ml/11288509/", how: "page", claims: "40 ml variant $18.99 (Dermstore offer sku 11288509); dry/very dry skin; protects from wind and cold; fragrance free; non-comedogenic",
  },

  // ---------------- cleansers ----------------
  {
    handle: "cerave-hydrating-facial-cleanser-travel", title: "CeraVe Hydrating Facial Cleanser, Travel Size (3 fl oz)", vendor: "CeraVe", type: "Cleanser",
    price: 6.99, tags: ["type-cleanser", "dry", "normal", "fragrance-free", "travel-size", "under-100ml"],
    desc: ["Gentle lotion cleanser for normal to dry skin with ceramides and hyaluronic acid.", "Removes dirt and makeup without stripping moisture. Fragrance-free and non-comedogenic.", "Travel size, 3 fl oz."],
    src: "https://www.cerave.com/skincare/cleansers/hydrating-facial-cleanser", how: "page", claims: "Normal to dry skin; free of added fragrance; non-comedogenic; 3 fl oz size listed. Price $6.99 for 3.0 oz travel size from Ulta (search): https://www.ulta.com/p/travel-size-hydrating-facial-cleanser-balanced-dry-skin-xlsImpprod19011099",
  },
  {
    handle: "cerave-foaming-facial-cleanser-travel", title: "CeraVe Foaming Facial Cleanser, Travel Size (3 fl oz)", vendor: "CeraVe", type: "Cleanser",
    price: 5.99, tags: ["type-cleanser", "gel", "oily", "normal", "humid", "travel-size", "under-100ml"],
    desc: ["Foaming gel cleanser for normal to oily skin with ceramides and niacinamide.", "Washes away excess oil, dirt and makeup.", "Travel size, 3 fl oz."],
    src: "https://www.cerave.com/skincare/cleansers/foaming-facial-cleanser", how: "page", claims: "Normal to oily skin; oil control; 3 fl oz size listed. Price $5.99 for 3.0 oz travel size from Ulta (search): https://www.ulta.com/p/travel-size-foaming-facial-cleanser-pimprod2003422",
  },
  {
    handle: "vanicream-gentle-facial-cleanser-travel", title: "Vanicream Gentle Facial Cleanser, Travel Size (2.5 fl oz)", vendor: "Vanicream", type: "Cleanser",
    price: 6.99, tags: ["type-cleanser", "fragrance-free", "sensitive", "dry", "travel-size", "under-100ml"],
    desc: ["Soap-free, gentle facial cleanser for dry, sensitive and delicate skin.", "Fragrance-free, oil-free and non-comedogenic.", "Travel size, 2.5 fl oz."],
    src: "https://www.vanicream.com/product/vanicream-facial-cleanser", how: "page", claims: "Soap-free; dry/sensitive skin; fragrance free; 2.5 oz travel size. Price $6.99 from Ulta (search): https://www.ulta.com/p/travel-size-gentle-facial-cleanser-sensitive-skin-pimprod2042400?sku=2619670",
  },

  // ---------------- lip ----------------
  {
    handle: "supergoop-play-lip-shield-spf-30-mint", title: "Supergoop! PLAY Lip Shield SPF 30, Mint", vendor: "Supergoop!", type: "Lip balm",
    price: 10.0, tags: ["type-lip", "spf-30", "water-resistant", "high-uv"],
    desc: ["Moisturising lip balm stick, broad spectrum SPF 30, with coconut, avocado and grape seed oils.", "Water resistant (80 minutes).", "Flavour: mint."],
    src: "https://supergoop.com/products/play-lip-shield-spf-30-mint", how: "brand-json", claims: "SPF 30; $10 single stick; water resistant 80 min; mint",
  },
  {
    handle: "aquaphor-lip-repair-stick-spf-30", title: "Aquaphor Lip Repair Stick + SPF 30 (0.17 oz)", vendor: "Aquaphor", type: "Lip balm",
    price: 6.99, tags: ["type-lip", "spf-30", "fragrance-free", "cold", "barrier", "dry"],
    desc: ["Lip repair stick with broad spectrum SPF 30, vitamins and shea butter, for very dry lips.", "The brand says it hydrates lips in dry, cold or windy conditions. Fragrance-free.", "0.17 oz."],
    src: "https://www.aquaphorus.com/products/aquaphor/aquaphor-lip-repair-stick-sunscreen", how: "page", claims: "SPF 30; 0.17 oz; dry, cold, windy conditions; fragrance free. Price $6.99 single stick from Walgreens (search): https://www.walgreens.com/store/c/productlist/aquaphor-lip-balm-&-treatments-lip-balm/N=361413-2000014462-805",
  },

  // ---------------- mist, after-sun, blotting ----------------
  {
    handle: "avene-thermal-spring-water-50ml", title: "Avène Thermal Spring Water, Travel Size (50 ml)", vendor: "Avène", type: "Face mist",
    price: 10.0, tags: ["type-mist", "sensitive", "flight", "travel-size", "under-100ml"],
    desc: ["Thermal spring water mist that the brand says soothes, softens and calms skin.", "Travel size, 50 ml."],
    src: "https://www.dermstore.com/p/avene-thermal-spring-water-50ml/15057663/", how: "page", claims: "50 ml $10 (Dermstore offer); soothes, softens, calms (brand claim); Avène USA calls the 50 ml its travel size",
  },
  {
    handle: "sun-bum-after-sun-cool-down-lotion-3oz", title: "Sun Bum After Sun Cool Down Lotion, Travel (3 oz)", vendor: "Sun Bum", type: "After-sun",
    price: 9.49, tags: ["type-aftersun", "travel-size", "under-100ml"],
    desc: ["Soothing aloe vera after-sun lotion.", "Travel size, 3 oz."],
    src: "https://www.sunbum.com/products/after-sun-cool-down-lotion", how: "brand-json", claims: "Aloe lotion; 3oz Travel variant $9.49",
  },
  {
    handle: "clean-and-clear-oil-absorbing-sheets-50", title: "Clean & Clear Oil Absorbing Sheets (50 sheets)", vendor: "Clean & Clear", type: "Blotting papers",
    price: 12.88, tags: ["type-blotting", "oily", "combination", "humid"],
    desc: ["Blotting sheets that lift excess oil and shine without smudging makeup.", "For normal, oily and combination skin.", "50 sheets."],
    src: "https://www.walmart.com/ip/Clean-Clear-Essentials-Oil-Absorbing-Sheets-for-Oily-Skin-50-Ct/10801468", how: "search", claims: "50 count $12.88; removes excess oil; normal, oily & combination skin",
  },

  // ---------------- accessories ----------------
  {
    handle: "coolibar-perla-packable-wide-brim-hat-black", title: "Coolibar Perla Packable Wide Brim Hat UPF 50+, Black", vendor: "Coolibar", type: "Hat",
    price: 29.99, tags: ["type-hat", "upf-50", "travel-size"],
    desc: ["Packable wide-brim sun hat in a poly 'straw' you can roll and fold.", "UPF 50+, which the brand says blocks 98% of UVA/UVB rays.", "Brim 10 cm at the front. One size (57 cm)."],
    src: "https://coolibar.com/products/womens-perla-packable-wide-brim-hat-black", how: "brand-json", claims: "UPF 50+ (blocks 98% UVA/UVB); packable, travel-friendly; one size 57 cm; brim 10 cm front; $29.99",
  },
  {
    handle: "coolibar-leo-shapeable-wide-brim-hat-black", title: "Coolibar Leo Shapeable Wide Brim Hat UPF 50+, Black, S/M", vendor: "Coolibar", type: "Hat",
    price: 26.99, tags: ["type-hat", "upf-50"],
    desc: ["Shapeable wide-brim sun hat with a chin cord, sweatband and air vents.", "UPF 50+, which the brand says blocks 98% of UVA/UVB rays.", "Brim 10 cm front, 8 cm sides and back. Size S/M (57 cm)."],
    src: "https://coolibar.com/products/unisex-leo-shapeable-wide-brim-hat-black", how: "brand-json", claims: "UPF 50+ (blocks 98% UVA/UVB); S/M 57 cm; brim 10/8/8 cm; $26.99",
  },
  {
    handle: "coolibar-navagio-arm-sleeves-blue-dusk", title: "Coolibar Navagio Arm Sleeves UPF 50+, Blue Dusk, L/XL", vendor: "Coolibar", type: "UV sleeves",
    price: 19.99, tags: ["type-sleeves", "upf-50", "travel-size"],
    desc: ["Pull-on sun sleeves for the forearms in the brand's ZnO fabric; they slip off into a pocket or bag.", "UPF 50+. Sold as a pair.", "Size L/XL."],
    src: "https://coolibar.com/products/mens-sun-arm-sleeves-blue-dusk", how: "brand-json", claims: "UPF 50+; pair; tuck into pocket or travel bag; L/XL $19.99",
  },
  {
    handle: "coolibar-lumaleo-sun-sleeves-arctic-blue", title: "Coolibar LumaLeo Sleeves with Thumbholes UPF 50+, Arctic Blue, S/M", vendor: "Coolibar", type: "UV sleeves",
    price: 19.99, tags: ["type-sleeves", "upf-50"],
    desc: ["Form-fitting sun sleeves with thumbholes that also cover the back of the hand.", "UPF 50+. Sold as a pair.", "Size S/M."],
    src: "https://coolibar.com/products/womens-w-lumaleo-sun-sleeves-arctic-blue", how: "brand-json", claims: "UPF 50+; thumbholes; pair; S/M $19.99",
  },
  {
    handle: "coolibar-solaira-polarized-sunglasses-black", title: "Coolibar Solaira Polarized Sunglasses, Black", vendor: "Coolibar", type: "Sunglasses",
    price: 90.0, tags: ["type-sunglasses", "uv400"],
    desc: ["Rectangular acetate sunglasses with polarized lenses.", "UV400 lenses: 100% UVA and UVB protection, says the brand."],
    src: "https://coolibar.com/products/unisex-solaira-polarized-sunglasses-black", how: "brand-json", claims: "UV400 lenses, 100% UVA/UVB; polarized; acetate; $90",
  },
  {
    handle: "coolibar-solvana-sunglasses-black", title: "Coolibar Solvana Sunglasses, Black", vendor: "Coolibar", type: "Sunglasses",
    price: 90.0, tags: ["type-sunglasses", "uv400"],
    desc: ["Square acetate sunglasses with a keyhole bridge.", "UV400 lenses: 100% UVA and UVB protection, says the brand."],
    src: "https://coolibar.com/products/solvana-sunglasses-black", how: "brand-json", claims: "UV400 lenses, 100% UVA/UVB; acetate; $90",
  },
];

const CHECKED = "2026-10-29";

export const DROPPED = [
  ["La Roche-Posay Anthelios UVMune 400 Invisible Fluid SPF50+", "No US listing from the brand or a major US retailer; brand US page returns 403. Replaced by Anthelios Ultra-Light Mineral SPF 50 and UV Hydra SPF 50 (Dermstore)."],
  ["Bioderma Photoderm Aquafluide SPF50+", "Not found on bioderma.us or a major US retailer."],
  ["Altruist Dermatologist Sunscreen SPF50", "Brand store prices are in GBP; no verifiable USD price. Albinism-charity claim therefore not used."],
  ["Neutrogena Ultra Sheer Dry-Touch SPF 100+", "Marked discontinued on neutrogena.com; the current Max SPF 100+ body page has no price and is not labelled water resistant."],
  ["Black Girl Sunscreen SPF 30", "Brand page shows a price range ($10.99 to $18.99) without a price per size."],
  ["Bolden SPF 30 Brightening Moisturizer", "Brand site blocks automated reading; no verifiable page."],
  ["Fenty Skin Hydra Vizor SPF 30 (mini)", "Brand site unreachable (certificate error); only UK/EU prices found."],
  ["Supergoop! Unseen Sunscreen SPF 40", "Reformulated; the brand now sells Unseen SPF 50, which is listed instead."],
  ["Evian facial spray 50 ml", "No verifiable US listing found; Avène Thermal Spring Water covers the mist slot."],
  ["Vanicream Moisturizing Cream 2 oz", "No single-tube price found at a major retailer; Vanicream Daily Facial Moisturizer listed instead."],
];

/* ---------- output ---------- */

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const html = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const products = P.map((p, i) => {
  const ph = PHOTOS[p.handle];
  return { ...p, image: OPEN(ph) ? ph.image : "", obf: OPEN(ph) ? ph.code : "", photo: ph || null, tags: [...new Set([...p.tags, "parasol"])], sku: `PZ-${String(i + 1).padStart(3, "0")}` };
});

function row(p) {
  const description = `<p>${p.desc.map(html).join(" ")}</p> <p>${NOT_AFFILIATED}</p>`;
  // Value spellings copied from the store's export (true/false, deny, manual, active).
  // Inventory is NOT tracked (tracker left blank): the classic template has no
  // quantity column, and a tracked product with 0 stock and policy "deny" would
  // be unavailable for sale, so the kit and cart would skip it.
  const cells = {
    Handle: p.handle, Title: p.title, "Body (HTML)": description, Vendor: p.vendor, "Product Category": "", Type: p.type,
    Tags: p.tags.join(", "), Published: "true", "Option1 Name": "Title", "Option1 Value": "Default Title",
    "Variant SKU": p.sku, "Variant Grams": "0.0", "Variant Inventory Tracker": "", "Variant Inventory Policy": "deny",
    "Variant Fulfillment Service": "manual", "Variant Price": p.price.toFixed(2), "Variant Requires Shipping": "true",
    "Variant Taxable": "true", "Image Src": p.image || "", "Image Position": p.image ? "1" : "",
    "Image Alt Text": p.image ? p.title : "", "Gift Card": "false",
    "Variant Weight Unit": "g", Status: "active", Collection: "Parasol",
  };
  return HEADER.map((h) => csvCell(cells[h])).join(",");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const dir = new URL(".", import.meta.url);
  writeFileSync(new URL("parasol-products.csv", dir), [HEADER.join(","), ...products.map(row)].join("\n") + "\n");
  const lines = [
    "# Parasol product sources",
    "",
    "Every claim in `parasol-products.csv` comes from the page below, read on the date shown. Generated by `node products/build.mjs` (edit claims there, not here).",
    "",
    "How the page was read: **brand-json** the brand's own product data/page fetched directly; **page** the brand or retailer page fetched directly (prices from its JSON-LD offer where shown); **page-ai** the brand page read through a fetch-and-summarise tool; **search** the retailer page as captured by a web search index (used for prices only when the page blocks direct reading).",
    "",
    "Images: listed in `products/photos.json` and credited in THIRD_PARTY_NOTICES.md. Open Beauty Facts photos (CC BY-SA 3.0, https://world.openbeautyfacts.org) are used as the CSV \"Image Src\". No brand photography is used anywhere. Products with no openly licensed photo show a drawn stand-in.",
    "",
    "| handle | source URL | date checked | read as | claims verified | OBF code |",
    "|---|---|---|---|---|---|",
    ...products.map((p) => `| ${p.handle} | ${p.src} | ${CHECKED} | ${p.how} | ${p.claims.replace(/\|/g, "/")} | ${p.obf || ""} |`),
    "",
    "## Dropped",
    "",
    "| product | why |",
    "|---|---|",
    ...DROPPED.map(([n, w]) => `| ${n} | ${w} |`),
    "",
  ];
  writeFileSync(new URL("SOURCES.md", dir), lines.join("\n"));

  // Local photo copies the app can show (public/products/<handle>.webp).
  const pub = new URL("../public/", dir);
  const local = products.filter((p) => p.photo && existsSync(new URL(`products/${p.handle}.webp`, pub))).map((p) => p.handle);
  writeFileSync(
    new URL("product-photos.js", pub),
    `// Generated by \`node products/build.mjs\`. Products with a local photo in /products/<handle>.webp (credits: THIRD_PARTY_NOTICES.md).\nexport const LOCAL_PHOTOS = new Set(${JSON.stringify(local, null, 2)});\n`
  );

  // Photo credits in THIRD_PARTY_NOTICES.md, between the markers.
  const notices = new URL("../THIRD_PARTY_NOTICES.md", dir);
  const START = "<!-- product-photos:start -->", END = "<!-- product-photos:end -->";
  const credit = (p) => {
    const ph = p.photo;
    return OPEN(ph)
      ? `| ${p.title} | Open Beauty Facts, product [${ph.code}](${ph.page}) ([image](${ph.image})) | ${ph.author} | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)${ph.note ? `. ${ph.note}` : ""} |`
      : `| ${p.title} | [${ph.owner} product page](${ph.page}) ([image](${ph.image})) | ${ph.owner} | ${ph.license} |`;
  };
  const block = [
    START,
    "Generated by `node products/build.mjs` from `products/photos.json`. Local copies (resized, WebP) are in `public/products/<handle>.webp`.",
    "",
    "| product | source | author / owner | license |",
    "|---|---|---|---|",
    ...products.filter((p) => local.includes(p.handle)).map(credit),
    "",
    `Products without a photo (drawn stand-in shown): ${products.filter((p) => !local.includes(p.handle)).map((p) => p.title).join("; ") || "none"}.`,
    END,
  ].join("\n");
  const text = readFileSync(notices, "utf8");
  writeFileSync(notices, text.includes(START) ? text.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block) : text);
  console.log(`${local.length} local photos`);
  console.log(`wrote ${products.length} products`);
}
