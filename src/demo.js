/**
 * Demo fixtures: real YouCam results captured once by bin/capture-demo.mjs
 * and committed under data/demo/. Demo routes read only these files and
 * spend no units. They are files, never store records, so nothing sent to
 * the API can change what the demo shows.
 *
 * Slots:
 *   data/demo/ada.json     Ada (very deep skin): AI-generated face, baseline + simulated Day 3
 *   data/demo/sam.json     Sam (albinism): AI-generated face, baseline only
 *   data/demo/sample.json  YouCam's own docs sample face. Fallback, clearly
 *                          labelled placeholder for any persona whose file is
 *                          missing (`demo.placeholder: true`).
 *
 * File shape (written by capture-demo):
 *   { persona, about, capturedAt,
 *     face: { kind: "youcam-docs-sample"|"consented-selfie"|"ai-generated", image, credit },
 *     baseline: { skin, fitz, tone, masks: {metric: "/demo/<persona>/<metric>.png"} },
 *     rescan: null | { skin, fitz, fitzFrom?: "baseline", tone, masks, face?: {image}, simulated?: {feature, params, note} },
 *     profile?: { albinism, fitz },   persona settings the client applies (Sam: albinism → type I)
 *     fitzNote?: string }             honest note when the persona's sun type differs from YouCam's
 *
 * The ScanView's `fitz` is always YouCam's real reading; `demo.profile` says
 * what the persona's profile uses.
 */

import { readFileSync, existsSync } from "node:fs";
import { HttpError } from "./http.js";
import { toView } from "./scan.js";

export const PERSONAS = ["ada", "sam"];
const file = (name) => new URL(`../data/demo/${name}.json`, import.meta.url);

export const FACE_LABELS = {
  "ai-generated": "AI-generated demo face (YouCam AI Image Generator)",
  "youcam-docs-sample": "YouCam documentation sample face",
  "consented-selfie": "Demo face, shown with consent",
};

const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  let fx = null;
  try {
    if (existsSync(file(name))) {
      const j = JSON.parse(readFileSync(file(name), "utf8"));
      if (j?.baseline?.skin?.scores) fx = j;
    }
  } catch {}
  cache.set(name, fx);
  return fx;
}

/** True when every persona has its own captured fixture. */
export const demoReady = () => PERSONAS.every((p) => load(p));
export const fixturesPresent = () => [...PERSONAS, "sample"].filter((p) => load(p));

/** POST /api/demo/scan → {scan: ScanView}, from files only. */
export function demoScan(body) {
  const persona = body.persona;
  const kind = body.kind === undefined ? "baseline" : body.kind;
  if (!PERSONAS.includes(persona)) throw new HttpError("Choose a demo persona: ada or sam.", 400, "bad_persona");
  if (kind !== "baseline" && kind !== "rescan") throw new HttpError("kind must be baseline or rescan.", 400, "bad_request");
  const own = load(persona);
  const fx = own || load("sample");
  if (!fx) throw new HttpError("The demo isn't set up on this server yet.", 503, "no_fixture");
  const rec = fx[kind];
  if (!rec?.skin?.scores) throw new HttpError(`The demo ${kind} scan isn't captured yet.`, 404, "no_fixture");
  return {
    scan: toView(rec, {
      source: "demo",
      kind,
      extra: {
        demo: {
          persona,
          placeholder: !own,
          face: { kind: fx.face?.kind || null, label: FACE_LABELS[fx.face?.kind] || null, image: rec.face?.image || fx.face?.image || null, credit: fx.face?.credit || null },
          simulated: rec.simulated || null,
          fitzFrom: rec.fitzFrom || null,
          profile: own ? fx.profile || null : null,
          fitzNote: own ? fx.fitzNote || null : null,
        },
      },
    }),
  };
}
