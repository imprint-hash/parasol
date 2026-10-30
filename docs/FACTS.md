# Claims ledger

Every claim in the README, and the code that makes it true. Grep any row.

| Claim | Where it's wired | Checked by |
|---|---|---|
| One photo upload feeds Skin Analysis and Fitzpatrick in parallel | `src/scan.js`, `src/youcam.js` (`uploadFile`, `runTask`) | `test/scan.test.js`, `test/youcam.test.js` |
| Skin type is read per region (whole, T-zone, U-zone) | `src/scan.js` (skin-type normalisation) | `test/scan.test.js` |
| Fitzpatrick sun type I to VI drives the burn clock | `src/burn.js` (`MED`, `burnRange`) | `test/burn.test.js` |
| Burn minutes: UV index 1 = 0.025 W/m², MED ranges, rounded down | `src/burn.js` | `test/burn.test.js` |
| Albinism forces type I with the most cautious range | `src/burn.js` (`albinism` option), `src/validate.js` | `test/burn.test.js` ("albinism override") |
| Albinism / type I get a sun line from UV 2 | `src/rules.js` (`uv-very-fair`) | `test/rules.test.js` |
| Deep skin is never told to skip sunscreen | `src/rules.js` (`uv-dark-marks`) | `test/rules.test.js` ("deep skin is never told…") |
| Real hourly weather; "typical (last year)" beyond 16 days | `src/weather.js`, `src/days.js` | `test/weather.test.js` |
| Rescan shows only changes beyond day-to-day noise | `src/rescan.js` (`RESCAN_DELTA`, `compareScores`) | `test/rescan.test.js` |
| Likely causes only when the weather supports them | `src/rescan.js` (`compare`) | `test/rescan.test.js` |
| Kit picks real products by transparent tag scoring | `src/kit.js` (`matchKit`), `src/tags.js` | `test/kit.test.js` |
| Every product claim has a source | `products/build.mjs`, `products/SOURCES.md` | `test/catalog.test.js` |
| Cart only accepts Parasol products | `src/shopify.js`, `src/routes/core.js` (`/api/cart`) | `test/shopify.test.js`, `test/attack.test.js` |
| Same photo never costs twice (SHA-256 cache, in-flight dedupe) | `src/scan.js`, `src/youcam.js` | `test/attack.test.js` |
| 3 live scans per person per hour, daily cap, unit floor, kill switch | `src/budget.js` | `test/attack.test.js` |
| Explicit consent required before any YouCam call | `src/scan.js` | `test/attack.test.js` |
| Photos are never stored; scores deletable via My data | `src/scan.js`, `src/routes/core.js` (`/api/my-data`) | `test/attack.test.js` (privacy) |
| No secret ever appears in a response or in git | `src/http.js`, `src/routes/core.js` (`/api/config`) | `test/attack.test.js` (secrets) |
| Demo replays real captured YouCam results at zero units | `src/demo.js`, `data/demo/*.json`, `bin/capture-demo.mjs` | `test/attack.test.js` (demo makes 0 YouCam calls) |
| Demo faces are AI-generated with YouCam AI Image Generator | `public/demo/`, `data/demo/*.json` (`demo.label`) | visible on screen |
| Low-vision mode, gentle dark, read-aloud | `public/a11y.js`, `public/app.css` | manual (screenshots) |
