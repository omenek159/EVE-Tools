# EVE Tools

Multipurpose web app for EVE Online: a set of calculators behind one shell (header with logo + settings, horizontal tool menu). Plain HTML/CSS/ES modules plus one PHP endpoint — no build step, no framework, no npm dependencies.

## Layout

```
index.html               shell only: header (logo, price status, settings button), menu container, update bar, settings drawer, #views, #tip
css/app.css              all styles; theme tokens at the top (light + dark)
js/app.js                MODULES registry, menu, hash routing, lazy loading, settings, update check
js/version.js            APP_VERSION "MAJOR.MINOR" — raise it on every release; open pages poll this file for the update bar
prices.php               serves the prices saved by cron/prices.php (cache/prices_*.json) + the app version; fetches from Fuzzwork only items it has never priced
sde.php                  serves game data extracted from the SDE (cache/sde/<set>.json) to modules
cron/sde.php             cron job (CLI only, deployed outside the web root): downloads a new SDE build when CCP publishes one, extracts what modules need
cron/prices.php          cron job: fetches Fuzzwork prices for every market when Fuzzwork publishes new data; ESI adjusted prices hourly
cron/lib.php             helpers shared by the cron jobs (site folder argument, locking, HTTP, atomic JSON writes)
data/markets.json        the markets prices are kept for (used by prices.php and cron/prices.php)
.htaccess                Apache: no-cache revalidation for html/js/css/json, hides cache/
js/shared.js             formatting (isk, nf0, nf2, r2), esc, tooltip (showTip/hideTip), store, hand-off between tools (sendTo/takeFor)
js/prices.js             shared price service: one market + price basis for the whole app (Settings), one copy of the prices, status in the header
js/modules/<tool>.js     one file per tool
img/nanoswarm/*.png      RDF Nanoswarm bonus icons (CCP's module/script icons, taken from the EVE University wiki)
data/*.json              static data a module fetches (hand-maintained; game data that changes with patches comes from the SDE job instead)
```

## Adding a tool

1. Create `js/modules/<name>.js` exporting:
   - `mount(el)` — render into `el` (may be async; fetch data here). Query inside `el`, not `document`.
   - `reset()` (optional) — re-initialise after Settings clears its saved data.
   - `unsavedNote()` (optional) — return e.g. "pasted scanner data" if a reload would lose something, else null (used by the update bar).
2. Add one entry to `MODULES` in `js/app.js`: `{ id, label, file, resetLabel, keys }` (optional `tag`: a small label after the name in the menu, e.g. `"alpha"`).
   `id` is the URL hash (ASCII letters/digits/hyphens; never `settings`, `sidebar`, `customize`, `upgrade`, `downloads`, `comment-*`).
   `keys` = the localStorage keys the module owns.
3. Modules load the first time their tab opens. Keep heavy data in `data/` and fetch it in `mount`.

## Conventions

- Reuse the shared components in `app.css`: `.layout` (side column + main), `.panel`, `.fld`, `.seg`, `.cell` heat cells (`--h` 0–0.54), `.pill ok|warn|bad`, `.legend`.
- Colours only via CSS variables; check both light and dark themes.
- Numbers: monospace, tabular, right-aligned. ISK via `isk()` (1.2M / 3.40B).
- Browser storage only through `store` in `shared.js` (it may be unavailable). Storage is per-browser convenience, never the only copy of something important.
- No footers, except where a licence needs a credit (`footer.note` in Incursions: the TLA waitlist, MIT). Formulas, outside numbers and data sources are documented in the "Tools and sources" section below and in code comments, with their source; they are not shown on the page.
- Sending data to another tool: `sendTo(id, data)` from `shared.js` leaves it for that tool and opens its tab; the tool reads it with `takeFor(id)` at the end of `mount` and on the `eve:handoff` event.
- Market prices only through `js/prices.js`: call `want(ids)` in `mount`, read `price(id)`, re-render on `on(fn)`. No market/basis pickers or price status inside modules: they live in Settings and the header.

## Hosting

**PHP server only.** Upload the repo (not `cache/`). Needs PHP 7.4+, cron with PHP CLI (curl, zip), and a writable site folder for `cache/` (created by the cron jobs). Static hosting (GitHub Pages) and the claude.ai artifact are not targets: without PHP the Ore module shows "prices.php isn't available here" and has no prices.

**Prices:** the cron job `cron/prices.php` keeps prices current; pages get them through `prices.php`, which serves what the job saved (without the cron job there are no prices). The one exception: an item the saved copy has never had (a module or ship pasted into Reprocessing) is fetched from Fuzzwork by `prices.php` once, for the market asked for: only reprocessable items/materials from the SDE extract, at most 200 per request, one fetch per market at a time, and if Fuzzwork doesn't answer the item just has no price. It is added to `cache/price_requests.json` ({typeID: last asked}); the job then refreshes it with everything else on every market, and drops it once nobody has asked for it for 30 days. No direct Fuzzwork requests from the browser and no manual paste option; don't add either. The app ships with no prices (`data/ores.json` has none — keep it that way). The job checks Fuzzwork's orderset number every 2 minutes and fetches every market in `data/markets.json` only when it went up (new data comes about every 30 minutes). Items priced: everything in `data/ores.json`, every ore/moon ore/ice and every reprocessing output material from the SDE extract (~1,060), plus the on-demand items above. Fuzzwork is asked for at most 500 items per request. Pages get them through `js/prices.js`: one market and price basis for the whole app (Settings → Market prices, key `eveTools.prices.v1`; taken over once from the Ore module's old settings), loaded on first launch and checked every 2 minutes after (prices are sent only when the server's copy is newer). The header shows the market and when prices were updated, with a warning when the job hasn't run for 15 minutes (`jobAt` in every reply). Prices are kept in each visitor's browser and in the server's `cache/`; nothing writes back into the site's files.

**Cron jobs** (`cron/`, run with PHP CLI). Deploy uploads `cron/` to its own folder outside the web roots, one per instance: `/eve_cron/` (live) and `/evetest_cron/` (test) in the FTP root (`FTP_CRON_DIR_LIVE` / `FTP_CRON_DIR_TEST` override), so each job takes the instance's folder as its first argument; without it, the folder above the script is used. `cron/.htaccess` and a CLI check keep the jobs off the web wherever they end up.

- `php <cron folder>/prices.php <site folder>` — every 2 minutes, once per instance. Writes `cache/prices_<market>.json`, `cache/prices_state.json` (`runAt`, `error`) and, at most hourly, `cache/adjusted_prices.json` (ESI `/markets/prices` adjusted prices, used for reprocessing tax). `--force` fetches everything now.
- `php <cron folder>/sde.php <site folder>` — every hour, once per instance. Reads CCP's `latest.jsonl` (build number); only when the build changed it downloads the JSONL zip (~100 MB, needs ~700 MB free while unpacking), streams the needed files and writes `cache/sde/reprocessing.json` + `state.json`. A new file replaces the old one only after `validateReprocessing()` passes (known values confirmed in game); the previous copy is kept as `*.prev.json`. `--force` extracts again. Exits 1 and keeps the old data on any error.
- Server paths (use these when giving the user commands; PHP CLI is `/usr/local/bin/php`):

  | Instance | Site folder | Cron folder |
  |---|---|---|
  | live (eve.omenek.pl) | `/home/vh22350/eve_html` | `/home/vh22350/eve_cron` |
  | test (evetest.omenek.pl) | `/home/vh22350/evetest_html` | `/home/vh22350/evetest_cron` |

  e.g. `/usr/local/bin/php /home/vh22350/evetest_cron/prices.php /home/vh22350/evetest_html` (cron, every 2 min) and `.../sde.php ...` (hourly); add `--force --verbose` to run one by hand.
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

- **Ore prices** (`ore.js`, `data/ores.json`): port of the standalone Ore Profit Calculator v26. ISK/h per ore grade (compressed vs raw) and gas; fleet of miners (module yield, crit chance %, crit bonus %, drones) and gas huffers; mining session: cargo-hold paste, share of the hold paid in cheapest ore, mining-scanner paste for belt value, session estimate by duration / end time / until empty. "Reprocess" buttons in the Cargo hold and Scanner results titles (active after Add cargo / Calculate belt value on the current paste) send that ore, without gas, to Reprocessing as name / quantity / estimated value lines. Income = fleet yield (m³/s) × 3600 × ISK per m³; ISK per m³ = unit price ÷ raw ore volume rounded to 0.01 (compressed and raw compare on the same mined m³). Miner yield = module yield × (1 + crit chance × crit bonus) + drone yield; gas uses huffer yield. Belt value = units × unit price; clearing time and session cargo use fleet yield. Prices from Fuzzwork market aggregates via the price job (see Hosting). `ores.json` holds only static game data: the ore list (`fam`: [name, rawId, rawVol, compressedId, compressedVol]) and the default fleet (`miners`, `huff`) — no prices. Saved state key `oreProfitCalc.v1` (shared with the standalone page; keep its migrations).
- **Reprocessing** (`reprocessing.js`): paste items (list view), get the materials, their value, the tax and whether reprocessing beats selling. Structure (Athanor/Tatara/faction Fortizars/other Upwell/NPC station), security, ore/moon/ice rigs (T1/T2), tax %; character skills and implant entered by hand (ESI later). Ore/moon/ice yield = base (50, or rig 51/53 × security 1/1.06/1.12) × structure bonus × Reprocessing 3%/lvl × Reprocessing Efficiency 2%/lvl × ore skill 2%/lvl × implant; scrapmetal = base × (1 + 2% × Scrapmetal Processing) only (EVE University wiki). Whole batches (100 units for ore, 1 for most items; the rest stays unprocessed), output per material = batches × amount per batch × yield, rounded down; tax = rate × output × ESI adjusted price (confirmed in game). Input value = market price (market and basis from Settings; modules and ships priced on demand, see Hosting → Prices); the game's estimated price from the paste only when the market has no price. Base 50% is the Upwell service; NPC stations use their own yield (mostly 50%), no rigs or structure bonus. Data from the SDE extract (`sde.php?set=reprocessing`); saved settings key `eveTools.reprocessing.v1`. Receives pastes from the Ore calculator (replaces the paste box and calculates).
- **Incursions** (`incursions.js`): ISK/h from pasted wallet journal. Logic ported from TLA waitlist `frontend/src/Pages/ISKh.js` (MIT, github.com/luna-duclos/tla-waitlist). ISK/h = (total ISK − first site's payout) ÷ time from first to last payout (the first payout starts the clock); payouts with the same timestamp are alts paid for the same site; site type, LP and pilots on grid are matched from the exact ISK amount using the overgrid factor `1 − 0.0725n − 0.0025n²` for n pilots over the normal grid; CONCORD LP is paid only if the mothership dies.
- **RDF** (`rdf.js`, menu tag "alpha"): Rampant Drone Fabricator payout. Data after wave n = m × n(n+1)/2 (wave n adds m × n), m = class unit U (C1–C3 4, C4 5, C5/C6 6) × threat multiplier T (Low 1, Moderate 2, Severe 4, Critical 8). Threat from the Rampancy of the ships on grid (Low 0–11, Moderate 12–35, Severe 36–71, Critical 72+; ship values and wave pauses from patch notes 24.01). Valid after the 2026-09-22 patch; U and T from in-game cargo scans (corp sheet "Rampant Drone Science", tabs New - Critical / New - Severe); Low, Moderate, C1 and C6 Critical are not yet confirmed and show "estimated". Waves 5–100 (the Fabricator is invulnerable until wave 5); clicking a row in the wave list selects that wave for the payout tiles, and "Copy wave" copies its payout as text. Data valued at 200,000 ISK per unit (base price of type 91773; 0.01 m³ per unit); pilots = ships on grid. Nanoswarms (waves 5, 10, 15, 25, 35, 45, 65, 85; 16 types, 20% bonus) and the ship list (names and Rampancy values) from the EVE University wiki page "Rampant Drone Fabricator"; clicking a Nanoswarm dims it (saved), Reset undims all. Nanoswarm icons in `img/nanoswarm/` show the bonus type (Thermal Sink reuses the overheat icon tinted blue: the wiki has no heat-damage icon). Hybrid drone drops are out of scope. Test values: C3 Critical wave 7 = 896, C4 Critical 8 = 1,440, C5 Critical 8 = 1,728, C4 Severe 6 = 420, C6 Severe 10 = 1,320. Saved state key `eveTools.rdf.v1`.

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

**Until the site is public, MAJOR stays `0`** (restarted at `"0.1"` from the earlier 4.x/5.0 numbers). Never raise MAJOR until the user says so; every release raises MINOR instead:

- **MINOR** +1 for every release: a feature release from `rc` (raise it on `rc` just before merging into `main`) or a small change through `fix-*` (raise it on the `fix-*` branch). `"0.1"` → `"0.2"`.
- After the public launch (the user decides): MINOR +1 for each `fix-*` release, MAJOR +1 with MINOR back to 0 for a release with new features.
- Feature branches never change the version, so it only conflicts when it really changed on `main`.
- The update bar only offers a reload when the server's version is *higher* than the page's, so the one-time drop from 4.3/5.0 to 0.x isn't announced: pages already open on 4.3 or 5.0 need one manual reload.

## Testing

- `PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:8000` in the repo folder (the built-in server is otherwise single-threaded and a slow Fuzzwork fetch blocks every other request).
- ES modules don't load from `file://`. Check each tab, both themes, and the browser console for errors.
