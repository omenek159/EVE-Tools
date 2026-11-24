# EVE Tools

Multipurpose web app for EVE Online: a set of calculators behind one shell (header with logo + settings, horizontal tool menu). Plain HTML/CSS/ES modules plus one PHP endpoint — no build step, no framework, no npm dependencies.

## Layout

```
index.html               shell only: header, menu container, update bar, settings drawer, #views, #tip
css/app.css              all styles; theme tokens at the top (light + dark)
js/app.js                MODULES registry, menu, hash routing, lazy loading, settings, update check
js/version.js            APP_VERSION "MAJOR.MINOR" — raise it on every release; open pages poll this file for the update bar
prices.php               Fuzzwork price proxy; shared cache (cache/) refreshed when Fuzzwork publishes a new orderset
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

**PHP server only.** Upload the repo (not `cache/`). Needs PHP 7.4+ with curl or allow_url_fopen, and a writable folder next to `prices.php` for `cache/`. Static hosting (GitHub Pages) and the claude.ai artifact are not targets: without PHP the Ore module shows "prices.php isn't available here" and has no prices.

**Prices:** only `prices.php` fetches prices — no direct Fuzzwork requests from the browser and no manual paste option; don't add either. The app ships with no prices (`data/ores.json` has none — keep it that way). The server fetches new prices only when Fuzzwork has published new data (it checks Fuzzwork's orderset number at most every 2 minutes; new data comes about every 30 minutes). The Ore module loads them on first launch and checks every 2 minutes after (prices are sent only when the server's shared copy is newer). Prices are kept in each visitor's browser and in the server's `cache/`; nothing writes back into the site's files.

**Deploy:** `.github/workflows/deploy.yml` uploads over FTP(S) only when run by hand (GitHub → Actions → Deploy → Run workflow). Branch `main` goes to the live site (https://eve.omenek.pl); any other branch goes to the test site (https://eve.omenek.pl/__test). Pushing deploys nothing.

**Update bar:** the shell re-reads `js/version.js` (no-store) every 5 minutes and when the tab comes back; if its APP_VERSION is higher than the loaded one, it offers a reload.

**Releasing:** raise `APP_VERSION` in `js/version.js` with every release (see Versioning below).

Other rules:

- Relative paths only, so the app works from any folder on the server.
- No alert/confirm/prompt — build dialogs and messages into the page.

## Tools and sources

- **Ore prices** (`ore.js`, `data/ores.json`): port of the standalone Ore Profit Calculator v26. ISK/h per ore grade (compressed vs raw) and gas; fleet of miners (module yield, crit chance %, crit bonus %, drones) and gas huffers; mining session: cargo-hold paste, share of the hold paid in cheapest ore, mining-scanner paste for belt value, session estimate by duration / end time / until empty. Prices from Fuzzwork market aggregates (see Hosting). `ores.json` holds only static game data: the ore list (`fam`: [name, rawId, rawVol, compressedId, compressedVol]) and the default fleet (`miners`, `huff`) — no prices. Saved state key `oreProfitCalc.v1` (shared with the standalone page; keep its migrations).
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
