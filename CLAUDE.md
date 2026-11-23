# EVE Tools

Multipurpose web app for EVE Online: a set of calculators behind one shell (header with logo + settings, horizontal tool menu). Plain HTML/CSS/ES modules — no build step, no framework, no npm dependencies.

## Layout

```
index.html               shell only: header, menu container, settings drawer, #views, #tip
css/app.css              all styles; theme tokens at the top (light + dark)
js/app.js                MODULES registry, menu, hash routing, lazy loading, settings
js/shared.js             formatting (isk, nf0, nf2, r2), esc, tooltip (showTip/hideTip), store
js/modules/<tool>.js     one file per tool
data/*.json              static data a module fetches
```

## Adding a tool

1. Create `js/modules/<name>.js` exporting:
   - `mount(el)` — render into `el` (may be async; fetch data here). Query inside `el`, not `document`.
   - `reset()` (optional) — re-initialise after Settings clears its saved data.
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

## Hosting constraints (published as a claude.ai artifact)

- The page can't fetch other sites (CSP). That's why Ore prices offers "open Fuzzwork, copy, paste" as a fallback. Keep that fallback.
- Scripts only inline/own files or cdnjs / jsDelivr / unpkg; fonts only Google Fonts; no remote images.
- No alert/confirm/prompt, no downloads, no window.open — build dialogs and Copy buttons into the page.
- Relative paths only (the artifact serves these files by relative path).

## Tools and sources

- **Ore prices** (`ore.js`, `data/ores.json`): ISK/h per ore grade for a mining fleet, compressed vs raw. Prices from Fuzzwork market aggregates; `ores.json` holds type IDs, volumes and a snapshot price set.
- **Incursions** (`incursions.js`): ISK/h from pasted wallet journal. Logic ported from TLA waitlist `frontend/src/Pages/ISKh.js` (MIT, github.com/luna-duclos/tla-waitlist). Overgrid factor `1 − 0.0725n − 0.0025n²`.
- **Reprocessing**: planned (shown as "soon" in the menu).

## Testing

Serve the folder (`python -m http.server`) and open it — ES modules don't load from `file://`. Check each tab, both themes, and the browser console for errors.
