# How Parasol uses YouCam: truth table

Every YouCam (Perfect Corp. S2S API) call Parasol makes or made. Sources: `src/youcam.js`, `src/simulate.js`, `src/scan.js`, `scratch/SPIKES.md`. Units were measured against our real balance (GET `/s2s/v2.0/credit/feature-cost` plus balance before/after).

| # | Tool / endpoint | Purpose in Parasol | Units (measured) | Live or demo | What we found | Why we chose it |
|---|---|---|---|---|---|---|
| 1 | File upload `POST /s2s/v2.0/file/skin-analysis` | Upload the selfie once, get a `file_id` | 0 (free) | Live | One uploaded `file_id` feeds both skin analysis and Fitzpatrick, run in parallel | One upload, two reads, less waiting |
| 2 | Skin Analysis `POST /s2s/v2.0/task/skin-analysis` (9 SD actions: skin_type + oiliness, moisture, acne, redness, pore, age_spot, texture, radiance) | The skin read that picks the travel kit | 14 (9 actions bill as "9–12 concerns") | Live (+ cached demo fixtures for Sam/Ada) | `skin_type` comes back per region: whole, t_zone, u_zone. Masks are full-size transparent PNGs on a 2-hour signed URL, laid over the user's own photo | Core of the product: scores drive the kit and the rescan check |
| 3 | Fitzpatrick pre-process `POST /s2s/v2.0/task/fitzpatrick-scale-analyzer/pre-process` | Face check: 0 faces or more than 1 face stops the scan | 0 (free) | Live | Returns one box per face; we refuse early without spending the 10 units | Free guard before paid work |
| 4 | Fitzpatrick Scale Analyzer `POST /s2s/v2.0/task/fitzpatrick-scale-analyzer` | Skin type I–VI for burn-time maths | 10 | Live | On the AI face of a woman with albinism (Sam) it read **type V**. YouCam reads facial features, not melanin. The app keeps the reading and, with the albinism switch on, uses **type I** | Burn time depends on skin type; the albinism override is the honest fix |
| 5 | Skin Simulation `POST /s2s/v2.0/task/skin-simulation` (`src/simulate.js`) | "Humid trip" preview: how skin may look on Day 3 | 4 (1–4 concerns) | Demo (Ada's Day 3) | Only `oiliness` *adds* change; the other sliders smooth or remove. So oiliness drives the preview. oiliness=1.0 then re-analysed: acne 89 → 77 (−12), shine read as acne. Deterministic (same input, same scores) | Lets a judge see the rescan check fire without a 3-day trip |
| 6 | Skin Tone `POST /s2s/v2.0/task/skin-tone-analysis` | Hex skin colour (wired in code) | 20 | **Kept off** (`YOUCAM_SKIN_TONE=0`) | Over our 5-unit-per-feature bar for what it adds | Cost discipline |
| 7 | AI Image Generator V2, text-to-image | Make the demo faces (Sam, Ada) so no real person's face is used | 1 | Build time only | Faces are labelled AI-generated everywhere in the app | Privacy: no stranger's selfie in the demo |
| 8 | AI Image Generator V2, image-to-image | Variant of a demo face | 1 | Build time only | Same labelling | Same |
| 9 | Credit `GET /s2s/v1.0/client/credit` | Read balance for the budget guard | 0 | Live | Balance cached 60 s | Never overspend the shared key |

## How the server behaves

- **Units are charged only on success**, so the server polls each task to the end instead of giving up early (poll every 1.5 s, up to 100 s).
- **Results are cached by the photo's SHA-256.** The same photo never costs units twice. Only scores are kept (up to 30 days), never the photo.
- Total spend while building: 100 units (24 on spikes, 76 on demo capture), then 36 on the Ada Day 3 re-runs.
