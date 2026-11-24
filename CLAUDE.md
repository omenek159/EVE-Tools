# EVE Tools

Multipurpose web app for EVE Online: a set of calculators behind one shell (header with logo + settings, horizontal tool menu). Plain HTML/CSS/ES modules plus one PHP endpoint — no build step, no framework, no npm dependencies.

## Layout

```
index.html               shell only: header, menu container, update bar, settings drawer, #views, #tip
css/app.css              all styles; theme tokens at the top (light + dark)
js/app.js                MODULES registry, menu, hash routing, lazy loading, settings, update check
js/version.js            APP_VERSION "MAJOR.MINOR" — raise it on every release; open pages poll this file for the update bar
prices.php               serves the prices saved by cron/prices.php (cache/prices_*.json) + the app version; never contacts Fuzzwork
sde.php                  serves game data extracted from the SDE (cache/sde/<set>.json) to modules
cron/sde.php             cron job (CLI only, deployed outside the web root): downloads a new SDE build when CCP publishes one, extracts what modules need
cron/prices.php          cron job: fetches Fuzzwork prices for every market when Fuzzwork publishes new data; ESI adjusted prices hourly
cron/lib.php             helpers shared by the cron jobs (site folder argument, locking, HTTP, atomic JSON writes)
data/markets.json        the markets prices are kept for (used by prices.php and cron/prices.php)
.htaccess                Apache: no-cache revalidation for html/js/css/json, hides cache/
js/shared.js             formatting (isk, nf0, nf2, r2), esc, tooltip (showTip/hideTip), store
js/modules/<tool>.js     one file per tool
data/*.json              static data a module fetches (hand-maintained; game data that changes with patches comes from the SDE job instead)
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

**PHP server only.** Upload the repo (not `cache/`). Needs PHP 7.4+, cron with PHP CLI (curl, zip), and a writable site folder for `cache/` (created by the cron jobs). Static hosting (GitHub Pages) and the claude.ai artifact are not targets: without PHP the Ore module shows "prices.php isn't available here" and has no prices.

**Prices:** only the cron job `cron/prices.php` fetches prices; pages get them through `prices.php`, which only reads what the job saved (no fallback fetch: without the cron job there are no prices). No direct Fuzzwork requests from the browser and no manual paste option; don't add either. The app ships with no prices (`data/ores.json` has none — keep it that way). The job checks Fuzzwork's orderset number every 2 minutes and fetches every market in `data/markets.json` only when it went up (new data comes about every 30 minutes). Items priced: everything in `data/ores.json` plus the minerals from the SDE extract. The Ore module loads prices on first launch and checks every 2 minutes after (prices are sent only when the server's copy is newer); every reply carries `jobAt`, and the module warns when the job hasn't run for 15 minutes. Prices are kept in each visitor's browser and in the server's `cache/`; nothing writes back into the site's files.

**Cron jobs** (`cron/`, run with PHP CLI). Deploy uploads `cron/` to its own folder outside the web roots, one per instance: `/eve_cron/` (live) and `/evetest_cron/` (test) in the FTP root (`FTP_CRON_DIR_LIVE` / `FTP_CRON_DIR_TEST` override), so each job takes the instance's folder as its first argument; without it, the folder above the script is used. `cron/.htaccess` and a CLI check keep the jobs off the web wherever they end up.

- `php <cron folder>/prices.php <site folder>` — every 2 minutes, once per instance. Writes `cache/prices_<market>.json`, `cache/prices_state.json` (`runAt`, `error`) and, at most hourly, `cache/adjusted_prices.json` (ESI `/markets/prices` adjusted prices, used for reprocessing tax). `--force` fetches everything now.
- `php <cron folder>/sde.php <site folder>` — every hour, once per instance. Reads CCP's `latest.jsonl` (build number); only when the build changed it downloads the JSONL zip (~100 MB, needs ~700 MB free while unpacking), streams the needed files and writes `cache/sde/reprocessing.json` + `state.json`. A new file replaces the old one only after `validateReprocessing()` passes (known values confirmed in game); the previous copy is kept as `*.prev.json`. `--force` extracts again. Exits 1 and keeps the old data on any error.
- Jobs print nothing when there was nothing to do (`--verbose` shows every step), so the host's cron mail only carries news and errors; they exit 1 on errors.
- Game data that changes with patches (type materials, batch sizes, skill/rig/structure bonuses) comes from this job, not from files in the repo; nothing in `cache/` is ever committed or deployed.
- Outgoing requests from server jobs use User-Agent `EVE-Tools by omenek`.

**Deploy:** `.github/workflows/deploy.yml` uploads over FTP(S) only when run by hand (GitHub → Actions → Deploy → Run workflow). Branch `main` goes to the live site (https://eve.omenek.pl); any other branch goes to the test site (https://evetest.omenek.pl). Pushing deploys nothing.

**Update bar:** the shell re-reads `js/version.js` (no-store) every 5 minutes and when the tab comes back; if its APP_VERSION is higher than the loaded one, it offers a reload.

**Releasing:** raise `APP_VERSION` in `js/version.js` with every release (see Versioning below).

Other rules:

- Relative paths only, so the app works from any folder on the server.
- No alert/confirm/prompt — build dialogs and messages into the page.

## Tools and sources

- **Ore prices** (`ore.js`, `data/ores.json`): port of the standalone Ore Profit Calculator v26. ISK/h per ore grade (compressed vs raw) and gas; fleet of miners (module yield, crit chance %, crit bonus %, drones) and gas huffers; mining session: cargo-hold paste, share of the hold paid in cheapest ore, mining-scanner paste for belt value, session estimate by duration / end time / until empty. Prices from Fuzzwork market aggregates via the price job (see Hosting). `ores.json` holds only static game data: the ore list (`fam`: [name, rawId, rawVol, compressedId, compressedVol]) and the default fleet (`miners`, `huff`) — no prices. Saved state key `oreProfitCalc.v1` (shared with the standalone page; keep its migrations).
- **Incursions** (`incursions.js`): ISK/h from pasted wallet journal. Logic ported from TLA waitlist `frontend/src/Pages/ISKh.js` (MIT, github.com/luna-duclos/tla-waitlist). Overgrid factor `1 − 0.0725n − 0.0025n²`.

## Git

Ask the user before every commit and push.

### Branches

| Branch | What goes there |
|---|---|
| `main` | what's live. Never commit to it directly: it only receives merges from `rc` and `fix-*`. |
| `rc` | release candidate: finished features merged together for the final test on the test site, plus fixes for problems that come from combining them. |
| `feat-<name>` | one new module or bigger piece of work each (e.g. `feat-reprocessing`, `feat-rdf`). Updated only from `main`, never from `rc` (that would pull in other unreleased features). |
| `fix-<name>` | any small change to live, made from the latest `main`; deleted once merged. |

- **New feature:** `feat-*` → merge into `rc` → test `rc` on the test site → raise MAJOR on `rc` → merge `rc` into `main` → run Deploy on `main` → merge `main` into the other `feat-*` branches.
- **Small change:** `fix-*` from `main` → raise MINOR → test on the test site → merge into `main` → run Deploy on `main` → merge `main` into `rc` and every `feat-*` (otherwise the next release would undo the fix) → delete the `fix-*` branch.
- **Bug in an unreleased feature:** fix it on its `feat-*` branch, then merge that into `rc` again.
- Before working on a branch, fetch and update it: the user also commits from their own computer.
- The test site shows whichever branch was deployed last; redeploy `rc` after testing a `fix-*` branch there.

### Versioning

`APP_VERSION` in `js/version.js` is `"MAJOR.MINOR"`.

- **MINOR** +1 for each small change released through `fix-*` (`"3.1"` → `"3.2"`). Raise it on the `fix-*` branch.
- **MAJOR** +1, MINOR back to 0, for a release with new features (`"3.2"` → `"4.0"`), or when the user asks. Raise it on `rc` just before merging into `main`.
- Feature branches never change the version, so it only conflicts when it really changed on `main`.

## Testing

- `PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:8000` in the repo folder (the built-in server is otherwise single-threaded and a slow Fuzzwork fetch blocks every other request).
- ES modules don't load from `file://`. Check each tab, both themes, and the browser console for errors.
