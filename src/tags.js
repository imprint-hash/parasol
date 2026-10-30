/**
 * The one tag vocabulary. Product tags in Shopify (and in
 * products/parasol-products.csv) must come from TYPE_TAGS + ATTRIBUTE_TAGS;
 * test/catalog.test.js fails on anything else. Forecast rules emit "needs",
 * which are attribute tags plus a few slot names (NEED_ONLY_TAGS) that are
 * never put on products.
 *
 * SPF tags mean: spf-30 = SPF 30 to 49, spf-50 = SPF 50, spf-50-plus = labelled
 * above 50 ("50+", 70, 100). A product gets exactly one of them.
 */

export const TYPE_TAGS = [
  "type-sunscreen", "type-moisturiser", "type-cleanser", "type-lip", "type-mist", "type-aftersun",
  "type-hat", "type-sleeves", "type-sunglasses", "type-blotting", "type-barrier",
];

export const ATTRIBUTE_TAGS = [
  "spf-30", "spf-50", "spf-50-plus", "mineral", "chemical", "hybrid", "tinted", "no-white-cast",
  "matte", "dewy", "gel", "cream", "fluid", "oily", "dry", "combination", "normal", "sensitive",
  "acne-prone", "fitz-1-2", "fitz-3-4", "fitz-5-6", "water-resistant", "fragrance-free",
  "travel-size", "under-100ml", "flight", "humid", "cold", "high-uv", "barrier", "upf-50", "uv400",
  "parasol",
];

/** Needs that name a slot or a trip condition rather than a product attribute. */
export const NEED_ONLY_TAGS = ["mist", "lip", "hat", "sleeves", "sunglasses", "cleanser", "aftersun", "blotting", "uv-8-plus"];

export const PRODUCT_TAGS = new Set([...TYPE_TAGS, ...ATTRIBUTE_TAGS]);
export const NEED_TAGS = new Set([...ATTRIBUTE_TAGS.filter((t) => t !== "parasol"), ...NEED_ONLY_TAGS]);

/** Product types that count as liquids under the 100 ml carry-on rule. Lip sticks are solids. */
export const LIQUID_TYPES = new Set(["type-sunscreen", "type-moisturiser", "type-cleanser", "type-mist", "type-aftersun", "type-barrier"]);

export const SKIN_TYPES = ["oily", "dry", "combination", "normal"];
export const FITZ = ["I", "II", "III", "IV", "V", "VI"];
export const METRICS = ["oiliness", "moisture", "acne", "redness", "pore", "age_spot", "texture", "radiance"];

/** "I" → "fitz-1-2"; albinism always counts as the most sun-sensitive group. */
export function fitzGroup(fitz, albinism = false) {
  if (albinism) return "fitz-1-2";
  if (fitz === "I" || fitz === "II") return "fitz-1-2";
  if (fitz === "III" || fitz === "IV") return "fitz-3-4";
  if (fitz === "V" || fitz === "VI") return "fitz-5-6";
  return null;
}

/** Plain names for the "why" chips on a kit pick. */
export const TAG_LABELS = {
  "spf-30": "SPF 30+",
  "spf-50": "SPF 50",
  "spf-50-plus": "SPF 50+",
  mineral: "Mineral filters",
  chemical: "Chemical filters",
  hybrid: "Mineral + chemical filters",
  tinted: "Tinted",
  "no-white-cast": "No white cast",
  matte: "Matte finish",
  dewy: "Dewy finish",
  gel: "Light gel",
  cream: "Rich cream",
  fluid: "Thin fluid",
  oily: "For oily skin",
  dry: "For dry skin",
  combination: "For combination skin",
  normal: "For normal skin",
  sensitive: "For sensitive skin",
  "acne-prone": "For breakout-prone skin",
  "fitz-1-2": "For very fair skin",
  "fitz-3-4": "For medium skin",
  "fitz-5-6": "Made for deep skin",
  "water-resistant": "Water resistant",
  "fragrance-free": "Fragrance free",
  "travel-size": "Travel size",
  "under-100ml": "Under 100 ml",
  flight: "Good for flights",
  humid: "Good in humid heat",
  cold: "Good in the cold",
  "high-uv": "For strong sun",
  barrier: "Protects your skin barrier",
  "upf-50": "UPF 50+ fabric",
  uv400: "UV400 lenses",
};

/**
 * Kit slots, in display order. `types` are the product types allowed in the
 * slot; `when(needs)` decides whether the trip needs the slot at all.
 * `lookFor` is the generic "buy it there" spec for a local pharmacy.
 */
export const SLOTS = [
  { slot: "sunscreen", label: "Face sunscreen", types: ["type-sunscreen"], when: () => true },
  { slot: "moisturiser-day", label: "Day moisturiser", types: ["type-moisturiser"], when: () => true },
  { slot: "moisturiser-rich", label: "Rich cream for cold or dry air", types: ["type-moisturiser", "type-barrier"], prefer: ["cream", "barrier"], when: (n) => n.has("cold") || n.has("dry") },
  { slot: "cleanser", label: "Gentle cleanser", types: ["type-cleanser"], when: () => true },
  { slot: "lip", label: "Lip balm with SPF", types: ["type-lip"], when: (n) => n.has("lip") || n.has("high-uv") },
  { slot: "mist", label: "Face mist", types: ["type-mist"], when: (n) => n.has("mist") },
  { slot: "aftersun", label: "After-sun", types: ["type-aftersun"], when: (n) => n.has("high-uv") },
  { slot: "hat", label: "Wide-brim hat", types: ["type-hat"], when: (n) => n.has("hat") },
  { slot: "sleeves", label: "UV sleeves", types: ["type-sleeves"], when: (n) => n.has("sleeves") },
  { slot: "sunglasses", label: "Sunglasses", types: ["type-sunglasses"], when: (n) => n.has("sunglasses") },
  { slot: "blotting", label: "Blotting papers", types: ["type-blotting"], when: (n) => n.has("humid") && n.has("matte") },
];
