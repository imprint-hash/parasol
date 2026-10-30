// Plain names for kit slots (slot ids come from src/tags.js on the server).
export const SLOT_NAMES = {
  sunscreen: "Face sunscreen",
  "moisturiser-day": "Day moisturiser",
  "moisturiser-rich": "Rich cream for cold or dry air",
  cleanser: "Gentle cleanser",
  lip: "Lip balm with SPF",
  mist: "Face mist",
  aftersun: "After-sun",
  hat: "Wide-brim hat",
  sleeves: "UV sleeves",
  sunglasses: "Sunglasses",
  blotting: "Blotting papers",
};

// What each slot does, for the "Why it's for you" sentence on a product card.
export const SLOT_JOBS = {
  sunscreen: "Daily face sun cover",
  "moisturiser-day": "Light daily moisture",
  "moisturiser-rich": "Extra moisture for cold, dry air",
  cleanser: "A gentle wash that takes sunscreen off",
  lip: "SPF for your lips, which burn easily",
  mist: "Quick moisture for dry cabin air",
  aftersun: "Cooling care after a long day out",
  hat: "Shade for your face, ears and neck",
  sleeves: "Arm cover without more sunscreen",
  sunglasses: "Cover for your eyes and the thin skin around them",
  blotting: "Shine control for humid heat",
};

/** "very fair, dry skin with albinism" style phrase from a profile. */
export function skinPhrase(p) {
  if (!p) return "skin";
  const tone = p.albinism ? "very fair" : { I: "very fair", II: "fair", III: "medium", IV: "light brown", V: "brown", VI: "deep" }[p.fitz] || "";
  const type = { oily: "oily", dry: "dry", combination: "combination", normal: "normal" }[p.skinType] || "";
  return `${[tone, type].filter(Boolean).join(", ")} skin${p.albinism ? " with albinism" : ""}`.trim();
}
