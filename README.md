# EVE Tools

Calculators for EVE Online in one web app.

- **Ore prices** — ISK per hour by ore and grade (compressed vs raw) and gas for your fleet of miners and huffers; cargo-hold value and share split; belt value from the mining scanner; session estimates. Prices from Fuzzwork.
- **Incursions** — ISK/h and LP from your pasted wallet journal (based on the TLA Incursion calculator).

## Hosting

Upload everything except `cache/` to a PHP web server (PHP 7.4+, curl or `allow_url_fopen`). `prices.php` creates `cache/` next to itself, so that folder must be writable. Open pages pick up new prices every few minutes and offer a reload when `js/version.js` on the server has a higher `APP_VERSION`.

Without PHP the app still works: Pull prices then asks you to paste the prices from Fuzzwork.

## Run locally

```
PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:8000
```

Then open http://127.0.0.1:8000. No build step. See `CLAUDE.md` for structure and how to add a tool.
