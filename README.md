# EVE Tools

Calculators for EVE Online in one web app.

- **Ore prices** — ISK per hour by ore and grade (compressed vs raw) and gas for your fleet of miners and huffers; cargo-hold value and share split; belt value from the mining scanner; session estimates. Prices from Fuzzwork.
- **Reprocessing** — what pasted items (ore, ice, modules, ships, …) reprocess into, the tax, and whether reprocessing beats selling them; structure, rigs, skills and implants.
- **Incursions** — ISK/h and LP from your pasted wallet journal (based on the TLA Incursion calculator).

## Hosting

Needs a PHP web server (PHP 7.4+) and cron with PHP CLI (curl and zip extensions). Upload everything except `cache/`. The cron jobs create `cache/` in the site folder, so it must be writable by the user cron runs as. Static hosting such as GitHub Pages isn't supported: prices come only from `prices.php`.

Two cron jobs keep the server's data current; set both up for each instance (Deploy puts `cron/` into `/eve_cron/` for live and `/evetest_cron/` for test, outside the web roots):

- `php <cron folder>/prices.php <site folder>` every 2 minutes: Fuzzwork market prices, fetched when Fuzzwork publishes new data.
- `php <cron folder>/sde.php <site folder>` every hour: game data from CCP's SDE, downloaded only when CCP publishes a new build.

Until a job has run once, the modules that need it show an error. The jobs print nothing unless something changed or failed.

The app ships with no prices and loads them through `prices.php` on first launch; everyone using the page shares one copy, refreshed from Fuzzwork when it publishes new market data (about every 30 minutes). Open pages offer a reload when `js/version.js` on the server has a higher `APP_VERSION` (`"MAJOR.MINOR"`: MINOR for small fixes, MAJOR for new features).

## Branches

- `main`: what's live; it only receives merges.
- `rc`: finished features tested together before release.
- `feat-<name>`: work on a new module.
- `fix-<name>`: a small change to live, made from `main`, then merged into `main`, `rc` and the `feat-*` branches.

See `CLAUDE.md` for the full workflow and versioning.

## Deploy

GitHub → Actions → Deploy → Run workflow, then pick the branch: `main` goes to the live site, any other branch to the test site. Pushing a branch doesn't deploy. Setup (FTP secrets and folders) is described at the top of `.github/workflows/deploy.yml`.

## Run locally

```
PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:8000
```

Then open http://127.0.0.1:8000. No build step. See `CLAUDE.md` for structure and how to add a tool.
