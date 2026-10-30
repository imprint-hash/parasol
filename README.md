# Parasol

Your skin, on the road. Scan your face once with YouCam Skin AI, add your trip, and Parasol tells you what each day's sun, humidity, cold and cabin air will do to *your* skin, builds a carry-on kit, and works out what went wrong after a breakout.

Not medical advice. Burn times are estimates.

## YouCam tools used

| Tool | Where |
|---|---|
| **AI Skin Analysis** (SD, 9 actions: skin type + 8 concerns, JSON with masks) | Every live scan; demo fixtures |
| **AI Fitzpatrick Skin Type Analysis** (detect, then classify) | Every live scan (sun type I–VI for the burn clock); the face count also catches group photos |
| **Skin Simulation** | Demo only: Ada's "Day 3 in Lagos" photo is simulated from her baseline face, then analysed |
| **AI Image Generator V2** (text-to-image) | The demo faces for Ada and Sam are AI-generated, not real people |
| AI Facial Color Tones Analyzer | Wired in but off (`YOUCAM_SKIN_TONE=0`): 20 units a scan is too dear for this budget |

## Run it

Node 22, no dependencies.

```
npm start        # http://localhost:3090
npm test         # offline: YouCam and Shopify are stubbed
npm run budget   # YouCam units left and today's live-scan counters
```

Configuration lives in `.env` locally and in Vercel's settings when deployed (never committed): `YOUCAM_API_KEY`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN`, `SHOPIFY_STORE_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PARASOL_SECRET`, `CRON_SECRET`, `LIVE_SCANS`, `LIVE_SCANS_PER_DAY`, `UNITS_FLOOR`, `YOUCAM_SKIN_TONE`.

## Privacy

- Your photo is resized in your browser, sent to YouCam (Perfect Corp.) for analysis, and dropped. Parasol never stores or hosts it.
- The server keeps only the scores, keyed by a fingerprint (SHA-256) of the photo, so scanning the same photo again costs nothing. **My data → Delete everything** removes them. Cached scores are deleted after 30 days anyway.
- Your profile, trip and scan history stay in your browser.

## Demo

**Try the demo** needs no selfie: Ada and Sam are real YouCam results, captured once (`bin/capture-demo.mjs`) on **AI-generated demo faces (YouCam AI Image Generator)**, and served from `data/demo/` at no cost.

## Shop

Demo shop, not affiliated with these brands. Checkout uses Shopify's test gateway: card number `1`, any future date, any CVV.

## Credits

Weather: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0). Product photos: [Open Beauty Facts](https://world.openbeautyfacts.org/) (CC BY-SA). Skin AI: [YouCam API by Perfect Corp.](https://yce.perfectcorp.com/). See `THIRD_PARTY_NOTICES.md`.
