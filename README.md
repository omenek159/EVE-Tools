# EVE Tools

Calculators for EVE Online in one web app.

- **Ore prices** — ISK per hour by ore and grade (compressed vs raw) and gas for your fleet of miners and huffers; cargo-hold value and share split; belt value from the mining scanner; session estimates. Prices from Fuzzwork.
- **Incursions** — ISK/h and LP from your pasted wallet journal (based on the TLA Incursion calculator).

## Hosting

Needs a PHP web server (PHP 7.4+, curl or `allow_url_fopen`). Upload everything except `cache/`. `prices.php` creates `cache/` next to itself, so that folder must be writable. Static hosting such as GitHub Pages isn't supported: prices come only from `prices.php`.

The app ships with no prices and loads them through `prices.php` on first launch; everyone using the page shares one copy, refreshed from Fuzzwork at most every 10 minutes. Open pages offer a reload when `js/version.js` on the server has a higher `APP_VERSION`.

## Deploy

GitHub → Actions → Deploy → Run workflow, then pick the branch: `main` goes to the live site, any other branch to the test site. Pushing a branch doesn't deploy. Setup (FTP secrets and folders) is described at the top of `.github/workflows/deploy.yml`.

## Run locally

```
PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:8000
```

Then open http://127.0.0.1:8000. No build step. See `CLAUDE.md` for structure and how to add a tool.
