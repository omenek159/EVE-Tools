# EVE Tools

Multipurpose web app for EVE Online: a set of calculators behind one shell (header with logo + settings, horizontal tool menu). Plain HTML/CSS/ES modules plus one PHP endpoint — no build step, no framework, no npm dependencies.

## Layout

```
index.html               shell only: header, menu container, update bar, settings drawer, #views, #tip
css/app.css              all styles; theme tokens at the top (light + dark)
js/app.js                MODULES registry, menu, hash routing, lazy loading, settings, update check
js/version.js            APP_VERSION — raise it on every release
prices.php               Fuzzwork price proxy with a shared 10-min cache (cache/), and the version endpoint
.htaccess                Apache: no-cache revalidation for html/js/css/json, hides cache/
js/shared.js             formatting (isk, nf0, nf2, r2), esc, tooltip (showTip/hideTip), store
js/modules/<tool>.js     one file per tool
data/*.json              static data a module fetches
```

## Adding a tool

1. Create `js/modules/<name>.js` exporting:
   - `mount(el)` — render into `el` (may be async; fetch data here). Query inside `el`, not `document`.
   - `reset()` (optional) — re-initialise after Settings clears its saved data.
   - `unsavedNote()` (optional) — return e.g. "pasted scanner data" if a reload would lose something, else null (used by the update bar).
2. Add one entry to `MODULES` in `js/app.js`: `{ id, label, file, resetLabel, keys }`.
   `id` is the URL hash (ASCII letters/digits/hyphens; never `settings`, `sidebar`, `customize`, `upgrade`, `downloads`, `comment-*`).
   `keys` = the localStorage keys the module owns.
3. Modules load the first time their tab opens. Keep heavy data in `data/` and fetch it in `mount`.

## Conventions

- Reuse the shared components in `app.css`: `.layout` (side column + main), `.panel`, `.fld`, `.seg`, `.cell` heat cells (`--h` 0–0.54), `.pill ok|warn|bad`, `.legend`, `footer.note`.
- Colours only via CSS variables; check both light and dark themes.
- Numbers: monospace, tabular, right-aligned. ISK via `isk()` (1.2M / 3.40B).
- Browser storage only through `store` in `shared.js` (it may be unavailable). Storage is per-browser convenience, never the only copy of something important.
- Every formula and outside number gets a line in the module's `footer.note`, with its source.

## Hosting

Two targets; every change must work on both.

1. **Own PHP server (main).** Upload the repo (not `cache/`). Needs PHP 7.4+ with curl or allow_url_fopen, and a writable folder next to `prices.php` for `cache/`. The Ore module syncs prices from `prices.php` every 5 minutes; the shell polls `prices.php?version=1` and shows the update bar when `js/version.js` on the server is newer than the loaded page.
2. **claude.ai artifact (secondary).** No PHP there: `prices.php` 404s, auto-sync and the update check stop after the first failure, and Pull prices falls back to "open Fuzzwork, copy, paste". Keep that fallback. Don't publish `prices.php`/`.htaccess` to the artifact.

**Releasing:** raise `APP_VERSION` in `js/version.js` with every change that should reach open pages.

Artifact constraints (keep the page valid for both):

- The page can't fetch other sites (CSP) — only its own files.
- Scripts only inline/own files or cdnjs / jsDelivr / unpkg; fonts only Google Fonts; no remote images.
- No alert/confirm/prompt, no downloads, no window.open — build dialogs and Copy buttons into the page.
- Relative paths only (the artifact serves these files by relative path).

## Tools and sources

- **Ore prices** (`ore.js`, `data/ores.json`): port of the standalone Ore Profit Calculator v26. ISK/h per ore grade (compressed vs raw) and gas; fleet of miners (module yield, crit chance %, crit bonus %, drones) and gas huffers; mining session: cargo-hold paste, share of the hold paid in cheapest ore, mining-scanner paste for belt value, session estimate by duration / end time / until empty. Prices from Fuzzwork market aggregates via `prices.php`; `ores.json` holds type IDs, volumes (`fam`: [name, rawId, rawVol, compressedId, compressedVol]), a snapshot price set and default fleet. Saved state key `oreProfitCalc.v1` (shared with the standalone page; keep its migrations).
- **Incursions** (`incursions.js`): ISK/h from pasted wallet journal. Logic ported from TLA waitlist `frontend/src/Pages/ISKh.js` (MIT, github.com/luna-duclos/tla-waitlist). Overgrid factor `1 − 0.0725n − 0.0025n²`.
- **Reprocessing**: planned (shown as "soon" in the menu).

## Testing

- With PHP: `php -S 127.0.0.1:8000` in the repo folder (set `PHP_CLI_SERVER_WORKERS=4`; the built-in server is otherwise single-threaded and a slow Fuzzwork fetch blocks every other request).
- Without PHP (like the artifact): `python -m http.server` — Pull prices must show the paste fallback.
- ES modules don't load from `file://`. Check each tab, both themes, and the browser console for errors (a favicon 404 is expected).
