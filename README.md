# EVE Tools

Calculators for EVE Online in one web app.

- **Ore prices** — ISK per hour by ore and grade (compressed vs raw) and gas for your fleet of miners and huffers; cargo-hold value and share split; belt value from the mining scanner; session estimates. Prices from Fuzzwork.
- **Incursions** — ISK/h and LP from your pasted wallet journal (based on the TLA Incursion calculator).

## Hosting

- **PHP server (recommended):** upload everything except `cache/` (PHP 7.4+, curl or `allow_url_fopen`). `prices.php` creates `cache/` next to itself, so that folder must be writable. Everyone using the page shares one price copy, refreshed from Fuzzwork at most every 10 minutes.
- **GitHub Pages or other static hosting:** works without PHP. Each browser asks Fuzzwork directly; if Fuzzwork doesn't allow that, Pull prices asks you to paste the prices instead.

The app ships with no prices and loads them on first launch. Open pages offer a reload when `js/version.js` on the site has a higher `APP_VERSION`.

## Run locally

```
PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:8000
```

Then open http://127.0.0.1:8000. No build step. See `CLAUDE.md` for structure and how to add a tool.
