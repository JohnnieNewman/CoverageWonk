# CoverageWonk.com

Studio coverage of the canon. Cinematic masterpieces evaluated against contemporary development metrics by The Coverage Wonk.

## Stack

- Static HTML/CSS/JS — no build step required at deploy time
- Hosted on Vercel (auto-deploy on push to `main`)
- Domain: coveragewonk.com (Namecheap, A-records pointing to Vercel)

## Project structure

```
/index.html             — Home / Coverage Ledger
/method.html            — Evaluation methodology
/consultations.html     — Three-tier paid coverage services
/styles.css             — Master stylesheet (single sheet, no preprocessor)
/script.js              — List rendering, filter/sort, share button
/reviews-data.js        — Review index data (drives home page list)
/reviews/<slug>.html    — One static HTML page per coverage file
/build_reviews.py       — Local build script for generating review pages
                          (gitignored; not deployed)
/vercel.json            — Vercel routing + cache headers
```

## Adding a new review

1. Open `build_reviews.py`.
2. Append a new entry to the `REVIEWS` list with all required fields.
3. Add the corresponding metadata entry to `reviews-data.js`.
4. Run `python3 build_reviews.py` to regenerate `/reviews/<slug>.html`.
5. Commit + push. Vercel auto-deploys.

## Local preview

```bash
python3 -m http.server 8000
# Open http://localhost:8000
```
