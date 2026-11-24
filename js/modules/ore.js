// Ore Profit Calculator module (ported from the standalone Ore Profit Calculator v26).
// The app ships without prices. They come only from prices.php on the same server (shared Fuzzwork cache,
// refreshed at most every 10 minutes): loaded on first launch, then kept up to date automatically.
import { r2, nf2, nf0, isk, fullIsk, esc, showTip, hideTip, store } from "../shared.js";

const KEY = "oreProfitCalc.v1";
const DATA_URL = new URL("../../data/ores.json", import.meta.url);
const PRICES_URL = new URL("../../prices.php", import.meta.url);
const SECTIONS = [
  { title: "Moon ores", from: 29, to: 33, cols: ["Base", "Brimful", "Glistening", ""] },
  { title: "Ores", from: 0, to: 29, cols: ["Base", "II-Grade", "III-Grade", "IV-Grade"] },
];
const GAS_SECTIONS = [                 // wormhole gas first, then k-space gas
  { title: "Wormhole gas", from: 33, to: 42 },
  { title: "K-space gas", from: 42, to: 60 },
];
const SYNC_EVERY = 5 * 60 * 1000;      // ask for anything newer this often
const NO_PRICES = hub => ({ source: "none", at: null, hub, data: {} });

const TEMPLATE = `
  <div class="head">
    <h1>Ore Profit Calculator</h1>
    <span class="sub">Income per hour and belt value for your fleet, priced from Fuzzwork market data</span>
  </div>
  <div class="layout">
    <aside class="side">
      <section class="panel" aria-labelledby="h-prices">
        <h2 id="h-prices">Market prices</h2>
        <div class="row2">
          <label class="fld">Market
            <select id="hub">
              <option value="station:60003760">Jita IV-4</option>
              <option value="region:10000002">The Forge (region)</option>
              <option value="station:60008494">Amarr VIII</option>
              <option value="station:60011866">Dodixie IX</option>
              <option value="station:60004588">Rens VI</option>
              <option value="station:60005686">Hek VIII</option>
            </select>
          </label>
          <label class="fld">Price basis
            <select id="basis">
              <option value="sellPct">Sell, 5th percentile</option>
              <option value="sellMin">Sell, lowest</option>
              <option value="buyMax">Buy, highest</option>
              <option value="buyPct">Buy, 5th percentile</option>
              <option value="split">Split (buy/sell mid)</option>
            </select>
          </label>
        </div>
        <div class="status"><span class="dot" id="statusDot"></span><span id="statusText"></span></div>
        <div class="msg err" id="priceErr" role="alert" hidden><span id="priceErrText"></span> <button class="btn-link" id="priceRetry" type="button">Try again</button></div>
      </section>

      <section class="panel" aria-labelledby="h-fleet">
        <div class="head"><h2 id="h-fleet">Fleet</h2><button class="btn" id="addMiner" type="button">+ Add miner</button></div>
        <div class="seg fleet-tabs" role="group" aria-label="Fleet type">
          <button type="button" data-tab="ore">Ore</button>
          <button type="button" data-tab="gas">Gas</button>
        </div>
        <div class="fleet-tab" id="tab-ore">
          <div class="fleet">
            <div class="stat"><b id="fleetM3s">0</b><span>Ore yield m³/s</span></div>
            <div class="stat"><b id="fleetM3h">0</b><span>Ore m³ per hour</span></div>
          </div>
          <div id="miners" style="display:flex;flex-direction:column;gap:8px"></div>
        </div>
        <div class="fleet-tab" id="tab-gas" hidden>
          <div class="fleet">
            <div class="stat"><b id="gasM3s">0</b><span>Gas yield m³/s</span></div>
            <div class="stat"><b id="gasM3h">0</b><span>Gas m³ per hour</span></div>
          </div>
          <div id="huffers" style="display:flex;flex-direction:column;gap:8px"></div>
        </div>
      </section>
    </aside>

    <div class="mainc">
      <section class="panel" id="beltPanel" aria-labelledby="h-belt">
        <div class="head"><h2 id="h-belt">Mining session</h2><span class="sess-sum" id="sessSum"></span></div>

        <details class="fold" id="cargoBox">
          <summary><h3>Cargo hold</h3><span class="sum" id="cargoSum"></span></summary>
          <div class="fold-body">
            <textarea id="cargo" class="mono" spellcheck="false" aria-label="Hold contents" placeholder="Open your ore or gas hold in list view, select all (Ctrl+A), copy (Ctrl+C) and paste here." style="height:120px"></textarea>
            <div class="scan-actions">
              <button class="btn btn-primary" id="calcCargo" type="button">Add cargo</button>
              <button class="btn" id="clearCargo" type="button">Clear</button>
              <span class="msg err" id="cargoErr" role="alert" hidden></span>
            </div>
            <div id="cargoOut"></div>
            <details class="fold" id="shareBox" hidden>
              <summary><h3>Share of the hold</h3><span class="sum" id="shareSum"></span></summary>
              <div class="fold-body">
                <div class="share-row">
                  <label class="fld" style="width:110px">Share %<input type="number" id="sharePct" min="0" max="100" step="0.5"></label>
                  <div class="share-target" id="shareTarget"></div>
                </div>
                <div id="shareOut"></div>
              </div>
            </details>
            <p class="note">Raw and compressed ore are both valued at compressed prices. Gas is valued at its own price.</p>
          </div>
        </details>
        <details class="fold" id="scanBox">
          <summary><h3>Scanner results</h3><span class="sum" id="scanSum">paste results from the Mining scanner</span></summary>
          <div class="fold-body">
            <textarea id="scan" class="mono" spellcheck="false" aria-label="Mining scanner results" placeholder="In the Mining scanner, select the results (Ctrl+A), copy (Ctrl+C) and paste here." style="height:220px"></textarea>
            <div class="scan-actions">
              <button class="btn btn-primary" id="calcBelt" type="button">Calculate belt value</button>
              <button class="btn" id="clearBelt" type="button">Clear</button>
              <span class="msg err" id="beltErr" role="alert" hidden></span>
            </div>
          </div>
        </details>
        <div class="sess-box" id="sessTime" hidden>
          <p class="sess-intro">Enter how long you plan to mine this belt, or the time your fleet ends, to see your potential income. Tick Unlimited to mine until the belt is empty. The estimate uses the fleet yield from the Fleet panel.</p>
          <div class="sess-mode">
            <span class="mode-label">Session length</span>
            <div class="seg" id="sessModeSeg" role="group" aria-label="Session length">
              <button type="button" data-mode="dur">Duration</button>
              <button type="button" data-mode="end">End time</button>
            </div>
            <label class="check unl"><input type="checkbox" id="sessUnlimited"> Unlimited (until the belt is empty)</label>
          </div>
          <div class="sess-grid">
            <label class="fld" data-for="dur">Hours<input type="number" id="sessH" min="0" step="1"></label>
            <label class="fld" data-for="dur">Minutes<input type="number" id="sessM" min="0" max="59" step="5"></label>
            <label class="fld" data-for="end" hidden>Fleet ends at (your time)<input type="time" id="sessEnd" step="60"></label>
            <div class="end-info" data-for="end" id="sessEndInfo" hidden></div>
            <label class="check"><input type="checkbox" id="bestFirst"> Mine the most valuable ore first</label>
          </div>
          <ul class="sess-help">
            <li><b>Unchecked:</b> mined ore is valued at the belt's average ISK per m³, as if you mine every rock evenly.</li>
            <li><b>Checked:</b> the rocks with the highest compressed ISK per m³ are mined first.</li>
          </ul>
        </div>
        <div id="sessOut"></div>
        <div id="beltOut" hidden></div>
      </section>

      <section class="panel" aria-labelledby="h-ores" style="min-width:0">
        <div class="head">
          <h2 id="h-ores">Ores by grade</h2>
          <div class="toolbar">
            <div class="seg" id="oreUnit" role="group" aria-label="Show values as">
              <button type="button" data-unit="h">ISK / hour</button>
              <button type="button" data-unit="m3">ISK / m³</button>
            </div>
            <input type="search" id="filter" placeholder="Filter ores" aria-label="Filter ores">
          </div>
        </div>
        <div class="legend">
          <span>Values are for <b>compressed</b> ore. Hover or tap a value to see the raw price.</span>
          <span><span class="swatch"></span>Higher income in section</span>
          <span><span class="flag"></span>Raw sells for more than compressed</span>
        </div>
        <div class="tablewrap"><table id="ores"></table></div>
        <h2 style="margin-top:8px">Gas</h2>
        <div class="tablewrap"><table id="gas"></table></div>
      </section>
    </div>
  </div>
  <footer class="note">
    Income = fleet yield (m³/s) × 3600 × ISK per m³. ISK per m³ = unit price ÷ raw ore volume, rounded to 0.01, so compressed and raw compare on the same mined m³.
    Miner yield = module yield × (1 + crit chance % × crit bonus %) + drone yield. Gas uses the huffer yield. Belt value = units × unit price; time to clear and session cargo use the fleet yield.
    Prices: Fuzzwork market aggregates, loaded through prices.php on your server (one shared copy, refreshed at most every 10 minutes).
  </footer>`;

/* ---------- module state ---------- */
let DATA, S, $, $$, init, syncNow;
let belt = null;              // {rocks, unknown} from the last Calculate; never saved
let cargo = null;             // {items, skipped} from the last Add cargo; never saved
let lastSync = 0, syncing = false, pending = false;   // pending: another check was asked for while one was running
let retryStep = 0, retryTimer = null;                  // automatic retries after a failed check
const RETRY_MIN = [1, 2, 5];                           // minutes to wait after the 1st, 2nd, 3rd+ failure in a row
let noServer = false;         // prices.php isn't available here: stop syncing, say so
let BY_NAME, CARGO_NAMES;

function defaults() {
  return {
    miners: DATA.miners.slice(0, 1).map((m, i) => ({ name: "Miner " + (i + 1), mod: m[0], crit: +(m[1] * 100).toFixed(4), mul: +(m[2] * 100).toFixed(2), drone: m[3], on: true })),
    huffers: [{ name: "Huffer 1", mod: DATA.huff, on: true }], fleetTab: "ore",
    hub: "station:60003760", jitaDefault: true, critPct: true, basis: "sellPct", unit: "h",
    prices: NO_PRICES("station:60003760"),
  };
}
function loadState() {
  const stored = store.getJSON(KEY, null);
  S = Object.assign(defaults(), stored || {});
  // One-time upgrades of settings saved by older versions of the calculator.
  if (stored && !stored.jitaDefault) { S.hub = "station:60003760"; S.jitaDefault = true; }
  // The single "gas huffers total" field became a list of huffers.
  if (stored && !Array.isArray(stored.huffers)) S.huffers = [{ name: "Huffer 1", mod: +(stored.huff ?? DATA.huff) || 0, on: true }];
  delete S.huff;
  // Crit bonus used to be stored as a factor (2.4); it is now a percent (240) like the game shows.
  if (stored && !stored.critPct) { (S.miners || []).forEach(m => { if (+m.mul > 0 && +m.mul <= 20) m.mul = +(m.mul * 100).toFixed(2); }); S.critPct = true; }
  // Older versions shipped snapshot prices from a spreadsheet; drop them so fresh prices load on first launch.
  if (!S.prices || S.prices.source === "sheet") S.prices = NO_PRICES(S.hub);
  S.sess = Object.assign({ h: 1, m: 0, best: false, pct: 5, mode: "dur", end: "", unlimited: false }, S.sess || {});
}
const save = () => store.setJSON(KEY, S);

/* ---------- math ---------- */
const minerYield = m => r2((+m.mod || 0) * (1 + (+m.crit || 0) / 100 * (+m.mul || 0) / 100) + (+m.drone || 0));
const fleetYield = () => r2(S.miners.filter(m => m.on).reduce((a, m) => a + minerYield(m), 0));
const gasYield = () => r2(S.huffers.filter(h => h.on).reduce((a, h) => a + (+h.mod || 0), 0));
function price(id) {
  const d = S.prices.data[id]; if (!d) return null;
  const n = v => (v == null || v === "") ? null : parseFloat(v);
  const s = d.sell || {}, b = d.buy || {};
  let v;
  switch (S.basis) {
    case "sellPct": v = n(s.percentile); break;
    case "sellMin": v = n(s.min); break;
    case "buyMax": v = n(b.max); break;
    case "buyPct": v = n(b.percentile); break;
    case "split": { const x = n(b.max), y = n(s.min); v = (x == null || y == null) ? null : (x + y) / 2; break; }
  }
  return (v == null || isNaN(v)) ? null : v;
}
function calc(item, y) {
  const [name, rid, rvol, cid, cvol] = item;
  const rp = price(rid), cp = cid ? price(cid) : null;
  const rM3 = rp == null ? null : r2(rp / rvol), cM3 = cp == null ? null : r2(cp / rvol);
  return { name, rid, cid, rvol, cvol, rp, cp, rM3, cM3, rH: rM3 == null ? null : y * 3600 * rM3, cH: cM3 == null ? null : y * 3600 * cM3 };
}
// What an item is valued at: ore at its compressed price, gas (no compressed version) at its own price.
const isGas = ore => !ore.cid;
const salePrice = ore => isGas(ore) ? price(ore.rid) : price(ore.cid);

/* ---------- paste parsing (scanner, cargo) ---------- */
const cleanTxt = s => s.replace(/[   ]/g, " ").trim();
const parseUnits = s => { const d = cleanTxt(s).replace(/[^\d]/g, ""); return d ? parseInt(d, 10) : NaN; };
function parseMoney(s) {
  let t = cleanTxt(s).replace(/[^\d.,]/g, "");
  const m = t.match(/[.,](\d{1,2})$/); let dec = "";
  if (m) { dec = "." + m[1]; t = t.slice(0, -m[0].length); }
  t = t.replace(/[.,]/g, "");
  return t ? parseFloat(t + dec) : NaN;
}
function parseDistance(s) {
  const t = cleanTxt(s).toLowerCase(), n = parseMoney(t.replace(/[a-z ]/g, ""));
  if (isNaN(n)) return null; return /km/.test(t) ? n * 1000 : /au/.test(t) ? n * 1.496e11 : n;
}
function parseScan(text) {
  const rocks = [], unknown = new Map();
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cols = raw.split("\t").map(cleanTxt);
    const idx = cols.findIndex(c => BY_NAME.has(c.toLowerCase()));
    if (idx < 0) {
      const nm = cols.find(c => /[a-z]/i.test(c) && !/(m3|m³|isk|km|\bm$|au)$/i.test(c));
      if (nm && cols.some(c => /\d/.test(c))) unknown.set(nm, (unknown.get(nm) || 0) + 1);
      continue;
    }
    const ore = BY_NAME.get(cols[idx].toLowerCase()), units = parseUnits(cols[idx + 1] || "");
    if (!(units > 0)) continue;     // group header lines in the scanner have no units
    const iskCol = cols.slice(idx + 2).find(c => /isk/i.test(c)), distCol = cols.slice(idx + 2).find(c => /\d\s*(km|m|au)$/i.test(c));
    rocks.push({ ore, units, vol: units * ore.rvol, cvol: units * (ore.cvol || ore.rvol), scanIsk: iskCol ? parseMoney(iskCol) : null, dist: distCol ? parseDistance(distCol) : null });
  }
  return { rocks, unknown };
}
// Ore hold: name in column 1, quantity in column 2; any further columns are ignored.
function parseCargo(text) {
  const byName = new Map(), skipped = new Map();
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let cols = raw.split("\t").map(cleanTxt);
    if (cols.length < 2) { const m = cleanTxt(raw).match(/^(.*?[^\d\s])\s+(\d[\d ]*)(?:\s|$)/); if (m) cols = [m[1], m[2]]; }
    const name = cols[0] || "", qty = parseUnits(cols[1] || "");
    const hit = CARGO_NAMES.get(name.toLowerCase());
    if (!hit || !(qty > 0)) { if (name) skipped.set(name, (skipped.get(name) || 0) + 1); continue; }
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, { name: hit.compressed ? "Compressed " + hit.ore.name : hit.ore.name, ore: hit.ore, compressed: hit.compressed, qty: 0, estQty: 0, estIsk: 0 });
    const item = byName.get(key); item.qty += qty;
    const iskCol = cols.slice(2).find(c => /isk\s*$/i.test(c)), est = iskCol ? parseMoney(iskCol) : NaN;
    if (est >= 0) { item.estIsk += est; item.estQty += qty; }       // the game's estimated value of the stack
  }
  return { items: [...byName.values()], skipped };
}

function dur(h) { if (!isFinite(h)) return "—"; const m = Math.round(h * 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; }
const distTxt = m => m == null ? "—" : m >= 1e4 ? nf0.format(m / 1000) + " km" : nf0.format(m) + " m";

/* ===================================================================== */
export async function mount(el) {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error("ores.json " + res.status);
  DATA = await res.json();
  BY_NAME = new Map();   // lower-case raw ore name -> ore info
  DATA.fam.forEach((f, fi) => f.forEach((it, gi) => BY_NAME.set(it[0].toLowerCase(), { name: it[0], rid: it[1], rvol: it[2], cid: it[3], cvol: it[4], fam: f[0][0], fi, gi })));
  CARGO_NAMES = new Map();
  DATA.fam.forEach(f => f.forEach(it => {
    const o = BY_NAME.get(it[0].toLowerCase());
    CARGO_NAMES.set(it[0].toLowerCase(), { ore: o, compressed: false });
    if (it[3]) CARGO_NAMES.set(("Compressed " + it[0]).toLowerCase(), { ore: o, compressed: true });
  }));

  el.innerHTML = TEMPLATE;
  $ = id => el.querySelector("#" + id);
  $$ = sel => el.querySelectorAll(sel);
  loadState();

  /* ---------- miners ---------- */
  const minersEl = $("miners");
  function renderMiners() {
    minersEl.innerHTML = S.miners.map((m, i) => `
      <div class="miner ${m.on ? "" : "off"}" data-i="${i}">
        <div class="miner-top">
          <input type="checkbox" data-k="on" ${m.on ? "checked" : ""} aria-label="Include ${esc(m.name)}">
          <input type="text" data-k="name" value="${esc(m.name)}" aria-label="Miner name">
          <span class="miner-total num" id="mt-${i}"></span>
          <button class="btn-ghost" type="button" data-del="${i}" aria-label="Remove ${esc(m.name)}">✕</button>
        </div>
        <div class="miner-grid">
          <label class="fld">Total m³/s from modules<input type="number" id="mod-${i}" data-k="mod" step="0.1" min="0" value="${m.mod}"></label>
          <label class="fld">Crit chance %<input type="number" data-k="crit" step="0.01" min="0" value="${m.crit}"></label>
          <label class="fld">Crit bonus %<input type="number" data-k="mul" step="10" min="0" value="${m.mul}"></label>
          <label class="fld">Drone m³/s<input type="number" data-k="drone" step="0.1" min="0" value="${m.drone}"></label>
        </div>
      </div>`).join("");
    updateMinerTotals();
  }
  function updateMinerTotals() {
    S.miners.forEach((m, i) => { const e = $("mt-" + i); if (e) e.textContent = nf2.format(minerYield(m)) + " m³/s"; });
    const f = fleetYield();
    $("fleetM3s").textContent = nf2.format(f);
    $("fleetM3h").textContent = nf0.format(f * 3600);
  }
  minersEl.addEventListener("input", e => {
    const card = e.target.closest(".miner"); if (!card) return;
    const i = +card.dataset.i, k = e.target.dataset.k; if (!k) return;
    S.miners[i][k] = k === "on" ? e.target.checked : e.target.value;
    if (k === "on") card.classList.toggle("off", !e.target.checked);
    save(); updateMinerTotals(); renderTables();
  });
  minersEl.addEventListener("click", e => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    S.miners.splice(+b.dataset.del, 1); save(); renderMiners(); renderTables();
  });
  $("addMiner").addEventListener("click", () => {
    if (S.fleetTab === "gas") {
      S.huffers.push({ name: "Huffer " + (S.huffers.length + 1), mod: 0, on: true });
      save(); renderHuffers(); renderTables();
      $("hmod-" + (S.huffers.length - 1))?.focus(); return;
    }
    S.miners.push({ name: "Miner " + (S.miners.length + 1), mod: 0, crit: 0, mul: 230, drone: 0, on: true });
    save(); renderMiners(); renderTables();
    $("mod-" + (S.miners.length - 1))?.focus();
  });

  /* ---------- gas huffers: module yield only (scoops don't crit, no drones) ---------- */
  const huffersEl = $("huffers");
  function renderHuffers() {
    huffersEl.innerHTML = S.huffers.map((h, i) => `
      <div class="miner ${h.on ? "" : "off"}" data-i="${i}">
        <div class="miner-top">
          <input type="checkbox" data-k="on" ${h.on ? "checked" : ""} aria-label="Include ${esc(h.name)}">
          <input type="text" data-k="name" value="${esc(h.name)}" aria-label="Huffer name">
          <span class="miner-total num" id="ht-${i}"></span>
          <button class="btn-ghost" type="button" data-del="${i}" aria-label="Remove ${esc(h.name)}">✕</button>
        </div>
        <div class="miner-grid one">
          <label class="fld">Module m³/s<input type="number" id="hmod-${i}" data-k="mod" step="0.1" min="0" value="${h.mod}"></label>
        </div>
      </div>`).join("");
    updateHufferTotals();
  }
  function updateHufferTotals() {
    S.huffers.forEach((h, i) => { const e = $("ht-" + i); if (e) e.textContent = nf2.format(r2(+h.mod || 0)) + " m³/s"; });
    const g = gasYield();
    $("gasM3s").textContent = nf2.format(g);
    $("gasM3h").textContent = nf0.format(g * 3600);
  }
  huffersEl.addEventListener("input", e => {
    const card = e.target.closest(".miner"); if (!card) return;
    const i = +card.dataset.i, k = e.target.dataset.k; if (!k) return;
    S.huffers[i][k] = k === "on" ? e.target.checked : e.target.value;
    if (k === "on") card.classList.toggle("off", !e.target.checked);
    save(); updateHufferTotals(); renderTables();
  });
  huffersEl.addEventListener("click", e => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    S.huffers.splice(+b.dataset.del, 1); save(); renderHuffers(); renderTables();
  });
  function applyFleetTab() {
    const gas = S.fleetTab === "gas";
    $$(".fleet-tabs button").forEach(b => b.setAttribute("aria-pressed", b.dataset.tab === S.fleetTab));
    $("tab-ore").hidden = gas; $("tab-gas").hidden = !gas;
    $("addMiner").textContent = gas ? "+ Add huffer" : "+ Add miner";
  }
  $$(".fleet-tabs button").forEach(b => b.addEventListener("click", () => { S.fleetTab = b.dataset.tab; save(); applyFleetTab(); }));

  /* ---------- ore and gas tables ---------- */
  const CELLS = new Map(); // key -> calc result for tooltip
  function renderTables() {
    const fy = fleetYield(), unit = S.unit, q = ($("filter").value || "").trim().toLowerCase();
    const val = c => unit === "h" ? c.cH : c.cM3;
    const fmt = v => unit === "h" ? isk(v) : (v == null ? "—" : nf2.format(v));
    const none = S.prices.source === "none" ? "—" : "no orders";
    CELLS.clear();
    let html = "";
    for (const sec of SECTIONS) {
      const rows = DATA.fam.slice(sec.from, sec.to).map(f => f.map(it => calc(it, fy)));
      const vals = rows.flat().map(val).filter(v => v != null && v > 0);
      const max = Math.max(...vals, 1);
      const top = [...vals].sort((a, b) => b - a).slice(0, 3);
      const minTop = top.length ? top[top.length - 1] : Infinity;
      html += `<tr class="sec"><th colspan="5">${sec.title}<span class="muted">${unit === "h" ? "ISK per hour, compressed" : "ISK per mined m³, compressed"}</span></th></tr>`;
      html += `<tr class="colh"><th>Ore</th>${sec.cols.map(c => `<th>${c}</th>`).join("")}</tr>`;
      for (const r of rows) {
        const hide = q && !r.some(c => c.name.toLowerCase().includes(q));
        html += `<tr class="${hide ? "hidden" : ""}"><td class="name">${esc(r[0].name)}</td>`;
        for (let g = 0; g < 4; g++) {
          const c = r[g];
          if (!c) { html += `<td class="empty"></td>`; continue; }
          const key = "c" + c.rid; CELLS.set(key, c);
          const v = val(c);
          const h = v == null || v <= 0 ? 0 : (0.04 + 0.5 * (v / max)).toFixed(3);
          const rawWins = c.rM3 != null && c.cM3 != null && c.rM3 > c.cM3 * 1.05;
          const cls = ["cell", v == null || v <= 0 ? "none" : "", v != null && v > 0 && v >= minTop ? "best" : "", rawWins ? "rawwins" : ""].join(" ");
          html += `<td class="cellwrap"><button type="button" class="${cls}" style="--h:${h}" data-key="${key}" aria-label="${esc(c.name)}">${v == null || v <= 0 ? none : fmt(v)}</button></td>`;
        }
        html += `</tr>`;
      }
    }
    $("ores").innerHTML = html;

    const gy = gasYield();
    let gh = "";
    for (const sec of GAS_SECTIONS) {
      const gas = DATA.fam.slice(sec.from, sec.to).map(f => calc(f[0], gy));
      const gmax = Math.max(...gas.map(c => unit === "h" ? c.rH : c.rM3).filter(v => v != null), 1);
      gh += `<tr class="sec"><th colspan="3">${sec.title}</th></tr><tr class="colh"><th>Gas cloud</th><th>Unit price</th><th>${unit === "h" ? "ISK / hour" : "ISK / m³"}</th></tr>`;
      for (const c of gas) {
        const hide = q && !c.name.toLowerCase().includes(q);
        const v = unit === "h" ? c.rH : c.rM3;
        const h = v == null || v <= 0 ? 0 : (0.04 + 0.5 * (v / gmax)).toFixed(3);
        gh += `<tr class="${hide ? "hidden" : ""}"><td class="name">${esc(c.name)}</td>
          <td class="n">${c.rp == null ? "—" : nf2.format(c.rp)}</td>
          <td class="cellwrap"><span class="cell ${v == null || v <= 0 ? "none" : ""}" style="--h:${h}">${v == null || v <= 0 ? none : unit === "h" ? isk(v) : nf2.format(v)}</span></td></tr>`;
      }
    }
    $("gas").innerHTML = gh;
    renderBelt();
  }
  $("filter").addEventListener("input", renderTables);
  const syncUnit = () => $$("#oreUnit button").forEach(x => x.setAttribute("aria-pressed", x.dataset.unit === S.unit));
  $$("#oreUnit button").forEach(b => b.addEventListener("click", () => { S.unit = b.dataset.unit; save(); syncUnit(); renderTables(); }));

  function oreTip(btn) {
    const c = CELLS.get(btn.dataset.key); if (!c) return;
    const diff = (c.cM3 != null && c.rM3) ? (c.cM3 / c.rM3 - 1) * 100 : null;
    showTip(btn, `<h4>${esc(c.name)}</h4>
      <div class="grp"><span class="lbl">Compressed</span>
        <span>Unit price</span><span class="v">${fullIsk(c.cp)}</span>
        <span>ISK per mined m³</span><span class="v">${c.cM3 == null ? "—" : nf2.format(c.cM3)}</span>
        <span>Income</span><span class="v">${c.cH == null ? "—" : isk(c.cH) + "/h"}</span></div>
      <div class="grp"><span class="lbl">Raw (uncompressed)</span>
        <span>Unit price</span><span class="v">${fullIsk(c.rp)}</span>
        <span>ISK per mined m³</span><span class="v">${c.rM3 == null ? "—" : nf2.format(c.rM3)}</span>
        <span>Income</span><span class="v">${c.rH == null ? "—" : isk(c.rH) + "/h"}</span></div>
      ${diff == null ? "" : `<div class="cmp">Compressed vs raw: <span class="${diff >= 0 ? "up" : "down"}">${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%</span></div>`}`);
  }
  const oresEl = $("ores");
  oresEl.addEventListener("mouseover", e => { const b = e.target.closest(".cell[data-key]"); if (b) oreTip(b); });
  oresEl.addEventListener("mouseout", e => { const b = e.target.closest(".cell[data-key]"); if (b && !b.contains(e.relatedTarget)) hideTip(); });
  oresEl.addEventListener("focusin", e => { const b = e.target.closest(".cell[data-key]"); if (b) oreTip(b); });
  oresEl.addEventListener("focusout", hideTip);

  /* ---------- prices ---------- */
  const hubEl = $("hub"), basisEl = $("basis");
  const HUBNAME = v => hubEl.querySelector(`option[value="${v}"]`)?.textContent || v;
  basisEl.addEventListener("change", () => { S.basis = basisEl.value; save(); renderStatus(); renderTables(); });
  hubEl.addEventListener("change", () => { S.hub = hubEl.value; save(); renderStatus(); serverSync(); });   // load the new market's prices straight away
  const allIds = () => { const s = new Set(); DATA.fam.flat().forEach(it => { s.add(it[1]); if (it[3]) s.add(it[3]); }); return [...s]; };
  const priceUrl = since => `${PRICES_URL}?market=${encodeURIComponent(S.hub)}&types=${allIds().join(",")}${since ? `&since=${since}` : ""}`;

  function renderStatus() {
    const dot = $("statusDot"), t = $("statusText"), p = S.prices;
    if (p.source === "none") {
      dot.className = "dot err";
      t.innerHTML = noServer ? "No prices: prices.php isn't available here. Open EVE Tools on your PHP server."
        : $("priceErr").hidden ? "No prices yet. Loading them…" : "No prices yet.";
      return;
    }
    const age = (Date.now() - p.at) / 36e5;
    dot.className = "dot " + (age > 6 ? "old" : "ok");
    const when = new Date(p.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    if (p.hub !== S.hub) {
      t.innerHTML = noServer ? `Showing ${esc(HUBNAME(p.hub))} prices. prices.php isn't available here, so ${esc(HUBNAME(S.hub))} can't be loaded.` : `Loading ${esc(HUBNAME(S.hub))} prices…`;
      return;
    }
    t.innerHTML = `${esc(HUBNAME(p.hub))}, ${Object.keys(p.data).length} items. Prices from Fuzzwork, ${esc(when)}. They refresh automatically every ${Math.round((p.ttl || 600) / 60)} minutes.`;
  }
  function acceptPrices(res) {
    const json = res && res.data, keys = Object.keys(json || {});
    if (!keys.length || !keys.every(k => /^\d+$/.test(k)) || !json[keys[0]].sell) throw new Error("shape");
    S.prices = { source: "fuzzwork", at: res.fetchedAt * 1000, cached: !!res.cached, ttl: res.ttl || 600, hub: res.market || S.hub, data: json };
    save(); renderStatus(); renderTables();
  }

  // One request to prices.php returns the prices (only when newer than "since").
  // Errors with .noServer mean there's no working prices.php here (static hosting, file://).
  async function requestServer(since) {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 20000);
    let r;
    try { r = await fetch(priceUrl(since), { signal: ctl.signal, headers: { Accept: "application/json" }, cache: "no-store" }); }
    finally { clearTimeout(to); }
    let json;
    try { json = await r.json(); }
    catch (_) {
      const e = new Error(r.status === 404 ? "prices.php wasn't found next to this page." : `The server answered with HTTP ${r.status} instead of price data. Check that PHP is enabled for prices.php.`);
      e.noServer = true; throw e;
    }
    if (!r.ok || json.error) throw new Error(json.error || `The server answered with HTTP ${r.status}.`);
    return json;
  }

  // Errors are shown under the status line with a "Try again" link; failed checks also retry by themselves
  // after 1, 2, then 5 minutes. A missing prices.php stops checking (until Try again).
  const priceErr = $("priceErr");
  function showError(text) { $("priceErrText").textContent = text; priceErr.hidden = false; renderStatus(); }
  function clearError() { priceErr.hidden = true; retryStep = 0; }
  const errText = e => e.name === "AbortError" ? "The server didn't answer within 20 seconds."
    : e instanceof TypeError ? "Couldn't reach your server. Check your connection."
    : e.message === "shape" ? "The price data had no prices for these items." : e.message;
  function serverMissing() {
    noServer = true; renderStatus();
    showError("prices.php isn't available here. EVE Tools loads prices only through prices.php, so open it on your PHP server.");
  }
  $("priceRetry").addEventListener("click", () => { noServer = false; retryStep = 0; serverSync(); });

  // On launch, every 5 minutes, when the tab is shown again and when the market changes, ask prices.php for anything
  // newer. It returns the prices only when its shared copy (refreshed from Fuzzwork at most every 10 minutes) is newer
  // than ours. A check asked for while one is running (e.g. the market changed) runs as soon as that one ends.
  async function serverSync() {
    if (noServer) return;
    if (syncing) { pending = true; return; }
    syncing = true; pending = false; lastSync = Date.now();
    clearTimeout(retryTimer); retryTimer = null;
    const btn = $("priceRetry"); btn.disabled = true;
    try {
      const have = S.prices.source === "fuzzwork" && S.prices.hub === S.hub ? Math.floor(S.prices.at / 1000) : 0;
      const json = await requestServer(have);
      if (json.data) acceptPrices(json);
      clearError();
    } catch (e) {
      if (e.noServer) serverMissing();
      else {
        const wait = RETRY_MIN[Math.min(retryStep, RETRY_MIN.length - 1)]; retryStep++;
        showError(`${errText(e)} Trying again in ${wait} minute${wait > 1 ? "s" : ""}.`);
        retryTimer = setTimeout(serverSync, wait * 60 * 1000);
      }
    } finally {
      syncing = false; btn.disabled = false;
      if (pending) serverSync();
    }
  }
  setInterval(serverSync, SYNC_EVERY);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - lastSync > 2 * 60 * 1000) serverSync(); });

  /* ---------- cargo hold ---------- */
  function renderCargo(tipKey) {
    const sumEl = $("cargoSum"), outEl = $("cargoOut");
    if (!cargo) { sumEl.textContent = "paste the contents of your ore hold"; outEl.innerHTML = ""; renderShare(); return null; }
    const t = { name: "Already in hold", c: 0, r: 0, vol: 0, hold: 0, after: 0, missC: 0 };
    for (const it of cargo.items) {
      const o = it.ore, cp = salePrice(o), rp = price(o.rid);
      it.gas = isGas(o); it.cp = cp; it.rp = rp; it.c = cp == null ? null : it.qty * cp; it.r = rp == null ? null : it.qty * rp;
      it.vol = it.qty * o.rvol;                                  // m³ it took to mine
      it.hold = it.qty * (it.compressed ? o.cvol : o.rvol);      // m³ it takes in the hold now
      it.after = it.qty * (o.cvol || o.rvol);                    // m³ once all ore is compressed (gas stays as it is)
      t.c += it.c || 0; t.r += it.r || 0; t.vol += it.vol; t.hold += it.hold; t.after += it.after; if (it.c == null) t.missC++;
    }
    t.gas = cargo.items.every(it => it.gas);
    sumEl.innerHTML = `${cargo.items.length} stack${cargo.items.length === 1 ? "" : "s"} · <b>${isk(t.c)}</b>${cargo.items.some(it => it.gas) ? "" : " compressed"}`;
    const sk = [...cargo.skipped.entries()];
    outEl.innerHTML = `
      <div class="tablewrap"><table class="data" style="min-width:480px">
        <thead><tr><th>Item</th><th>Quantity</th><th>In hold m³</th><th>Value</th></tr></thead>
        <tbody>${cargo.items.map((it, i) => `<tr><td>${esc(it.name)}</td><td>${nf0.format(it.qty)}</td><td>${nf2.format(it.hold)}</td>
          <td><span class="val" tabindex="0" data-key="${tipKey("cg" + i, { name: it.name, vol: it.vol, c: it.c, r: it.r, cp: it.cp, rp: it.rp, gas: it.gas })}">${isk(it.c)}</span></td></tr>`).join("")}
          <tr class="total"><td>Total</td><td></td><td>${nf2.format(t.hold)}</td><td><span class="val" tabindex="0" data-key="${tipKey("cgt", t)}">${isk(t.c)}</span></td></tr></tbody>
      </table></div>
      ${t.missC ? `<p class="warn">${t.missC} item${t.missC > 1 ? "s have" : " has"} no price on this market and count as 0.</p>` : ""}
      ${sk.length ? `<p class="warn">Skipped (not ore or gas, or no quantity): ${sk.map(([n, c]) => esc(n) + (c > 1 ? ` (${c})` : "")).join(", ")}.</p>` : ""}`;
    renderShare();
    return t;
  }

  // Share: a percentage of the hold's estimated value (the game's ISK column), paid in the cheapest ore per unit.
  function renderShare() {
    const box = $("shareBox"), tgt = $("shareTarget"), out = $("shareOut"), sum = $("shareSum");
    if (!cargo) { box.hidden = true; return; }
    box.hidden = false;
    const pct = Math.min(100, Math.max(0, +S.sess.pct || 0));
    // Per unit: the game's estimate from the paste (ISK column). Stacks pasted without it (e.g. from icon view)
    // fall back to the market price of that exact item: compressed or raw, on the chosen market and price basis.
    const marketUsed = [], unpriced = [];
    const items = cargo.items.map(it => {
      if (it.estQty > 0 && it.estIsk > 0) return { it, unit: it.estIsk / it.estQty, avail: it.qty, src: "est" };
      const mp = price(it.compressed ? it.ore.cid : it.ore.rid);
      if (mp > 0) { marketUsed.push(it.name); return { it, unit: mp, avail: it.qty, src: "market" }; }
      unpriced.push(it.name); return null;
    }).filter(Boolean);
    const estTotal = items.reduce((a, x) => a + x.unit * x.avail, 0);
    const priceWarn = (marketUsed.length ? `<p class="warn">No estimated value in the paste for ${marketUsed.map(esc).join(", ")}, so the market price is used instead (${esc(HUBNAME(S.prices.hub || S.hub))}, ${esc(basisEl.selectedOptions[0].textContent.toLowerCase())}). Paste from list view to use the game's estimate.</p>` : "")
      + (unpriced.length ? `<p class="warn">No estimated value and no market price for ${unpriced.map(esc).join(", ")}; left out of the share.</p>` : "");
    if (!items.length) { sum.textContent = "no prices for this hold"; tgt.textContent = ""; out.innerHTML = priceWarn; return; }
    const target = estTotal * pct / 100;
    const basisTxt = marketUsed.length === items.length ? "at market prices" : marketUsed.length ? "estimated, partly at market prices" : "estimated";
    tgt.innerHTML = `${nf2.format(pct)}% of <b>${nf0.format(estTotal)}</b> ISK ${basisTxt} = <b>${nf0.format(target)}</b> ISK`;
    items.sort((a, b) => a.unit - b.unit);
    let left = target; const give = [];
    for (const x of items) {
      if (left <= 1e-6) break;
      const units = Math.min(x.avail, Math.ceil(left / x.unit - 1e-9)), value = units * x.unit;
      give.push({ name: x.it.name, units, unit: x.unit, value, src: x.src }); left -= value;
    }
    const covered = give.reduce((a, g) => a + g.value, 0);
    sum.innerHTML = (target <= 0 ? `${nf2.format(pct)}%` : `${nf2.format(pct)}% = ${isk(target)} · ` + give.map(g => `<b>${nf0.format(g.units)}</b> × ${esc(g.name)}`).join(" + "))
      + (marketUsed.length || unpriced.length ? ` · <span class="warnsum">⚠ market prices used</span>` : "");
    out.innerHTML = target <= 0 ? "" : `
      <div class="tablewrap"><table class="data give" style="min-width:480px">
        <thead><tr><th>Give</th><th>Units</th><th>Per unit</th><th>Value</th></tr></thead>
        <tbody>${give.map(g => `<tr><td>${esc(g.name)}${g.src === "market" ? ' <span class="mkt" title="Market price: no estimated value in the paste">market</span>' : ""}</td><td class="units">${nf0.format(g.units)}</td><td>${nf2.format(g.unit)}</td><td>${nf0.format(g.value)}</td></tr>`).join("")}
        <tr class="total"><td>Total</td><td></td><td></td><td>${nf0.format(covered)}</td></tr></tbody>
      </table></div>
      ${left > 1e-6 ? `<p class="warn">The hold doesn't hold enough ore to cover this share; ${nf0.format(left)} ISK is missing.</p>`
        : `<p class="note">Cheapest ore first, rounded up to whole units: covers the share with ${nf0.format(covered - target)} ISK to spare.</p>`}
      ${priceWarn}`;
  }

  /* ---------- session length ---------- */
  const sessHEl = $("sessH"), sessMEl = $("sessM"), bestEl = $("bestFirst"), sessEndEl = $("sessEnd"), endInfoEl = $("sessEndInfo"), sharePctEl = $("sharePct");
  // Session length: either a duration, or an end time on the viewer's clock (rolls to tomorrow once it has passed).
  function endTarget() {
    const m = /^(\d{1,2}):(\d{2})$/.exec(S.sess.end || ""); if (!m) return null;
    const now = new Date(), t = new Date(now); t.setHours(+m[1], +m[2], 0, 0);
    if (t <= now) t.setDate(t.getDate() + 1);
    return t;
  }
  function sessionHours() {
    if (S.sess.mode === "end") { const t = endTarget(); return t ? Math.max(0, (t - Date.now()) / 36e5) : 0; }
    return (+S.sess.h || 0) + (+S.sess.m || 0) / 60;
  }
  function renderEndInfo() {
    const t = endTarget();
    if (!t) { endInfoEl.innerHTML = `<span>Enter the time your fleet ends.</span>`; return; }
    const eve = t.toISOString().slice(11, 16), tomorrow = t.getDate() !== new Date().getDate();
    endInfoEl.innerHTML = `<b>${dur(sessionHours())}</b><span>left · ${eve} EVE time${tomorrow ? " tomorrow" : ""}</span>`;
  }
  function applyMode() {
    const end = S.sess.mode === "end", unl = !!S.sess.unlimited;
    $("sessUnlimited").checked = unl;
    // Unlimited switches the session length off: grey out its controls and hide the countdown.
    const seg = $("sessModeSeg"); seg.classList.toggle("is-off", unl);
    seg.querySelectorAll("button").forEach(b => { b.disabled = unl; b.setAttribute("aria-pressed", b.dataset.mode === S.sess.mode); });
    $$("#sessTime [data-for]").forEach(x => { x.classList.toggle("is-off", unl); x.querySelectorAll("input").forEach(i => i.disabled = unl); });
    $$('#sessTime [data-for="dur"]').forEach(x => x.hidden = end);
    $$('#sessTime [data-for="end"]').forEach(x => x.hidden = !end);
    if (end) renderEndInfo();
    if (unl) endInfoEl.hidden = true;
  }
  $("sessUnlimited").addEventListener("change", e => { S.sess.unlimited = e.target.checked; save(); applyMode(); renderBelt(); });
  $$("#sessModeSeg button").forEach(b => b.addEventListener("click", () => {
    S.sess.mode = b.dataset.mode;
    if (S.sess.mode === "end" && !S.sess.end) {            // first use: suggest one hour from now, to the next 5 minutes
      const d = new Date(Date.now() + 36e5); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
      S.sess.end = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); sessEndEl.value = S.sess.end;
    }
    save(); applyMode(); renderBelt();
  }));
  sessEndEl.addEventListener("input", () => { S.sess.end = sessEndEl.value; save(); renderEndInfo(); renderBelt(); });
  // While counting down to an end time, refresh once the remaining whole minutes change.
  let lastLeftMin = null;
  setInterval(() => {
    if (S.sess.mode !== "end" || S.sess.unlimited) return;
    const left = Math.round(sessionHours() * 60); if (left === lastLeftMin) return;
    lastLeftMin = left; renderEndInfo(); if (belt) renderBelt();
  }, 15000);
  function readSession() {
    S.sess = { ...S.sess, h: Math.max(0, +sessHEl.value || 0), m: Math.max(0, +sessMEl.value || 0), best: bestEl.checked }; save(); renderBelt();
  }
  [sessHEl, sessMEl].forEach(x => x.addEventListener("input", readSession));
  bestEl.addEventListener("change", readSession);
  sharePctEl.addEventListener("input", () => { S.sess.pct = Math.max(0, +sharePctEl.value || 0); save(); renderShare(); });

  /* ---------- belt value and session estimate ---------- */
  const BELT_TIPS = new Map();
  function renderBelt() {
    const y = fleetYield(), gy = gasYield(); let sessHours = sessionHours();
    const out = $("beltOut"), sessOut = $("sessOut"), scanSum = $("scanSum"), sessSum = $("sessSum");
    BELT_TIPS.clear();
    const tipKey = (k, o) => { BELT_TIPS.set(k, o); return k; };
    const cg = renderCargo(tipKey);
    const holdTile = cg ? `<div class="tile"><span>Already in hold</span><b><span class="val" tabindex="0" data-key="${tipKey("cgs", cg)}">${isk(cg.c)}</span></b><small>${nf0.format(cg.hold)} m³ in the hold now</small></div>` : "";
    $("sessTime").hidden = !belt;   // session length only matters once there is a belt
    if (!belt) {
      out.hidden = true; out.innerHTML = "";
      scanSum.textContent = "paste results from the Mining scanner";
      sessSum.innerHTML = cg ? `in hold <b>${isk(cg.c)}</b>` : "";
      sessOut.innerHTML = `${cg ? `<div class="tiles">${holdTile}</div>` : ""}<p class="note">Paste your Mining scanner results above and press Calculate belt value to set the session length and see the potential income.</p>`;
      return;
    }
    const { rocks, unknown } = belt;
    const tot = { rocks: 0, units: 0, vol: 0, cvol: 0, c: 0, r: 0, scan: 0, missC: 0 }, groups = new Map();
    for (const k of rocks) {
      const cp = salePrice(k.ore), rp = price(k.ore.rid);
      k.gas = isGas(k.ore); k.c = cp == null ? null : k.units * cp; k.r = rp == null ? null : k.units * rp;
      if (!groups.has(k.ore.fi)) groups.set(k.ore.fi, { fam: k.ore.fam, grades: new Map() });
      const g = groups.get(k.ore.fi);
      if (!g.grades.has(k.ore.gi)) g.grades.set(k.ore.gi, { name: k.ore.name, cp, rp, gas: k.gas, rocks: 0, units: 0, vol: 0, c: 0, r: 0 });
      const gr = g.grades.get(k.ore.gi);
      for (const o of [gr, tot]) { o.rocks++; o.units += k.units; o.vol += k.vol; o.c += k.c || 0; o.r += k.r || 0; }
      tot.cvol += k.cvol; tot.scan += k.scanIsk || 0; if (k.c == null) tot.missC++;
    }
    tot.gas = rocks.every(k => k.gas);
    const hasOre = rocks.some(k => !k.gas), hasGas = rocks.some(k => k.gas);
    // Ore is mined by the miners and gas by the huffers, at the same time: each pool has its own yield.
    const pools = [{ gas: false, y, rocks: rocks.filter(k => !k.gas) }, { gas: true, y: gy, rocks: rocks.filter(k => k.gas) }].filter(p => p.rocks.length);
    pools.forEach(p => {
      p.vol = p.rocks.reduce((a, k) => a + k.vol, 0); p.c = p.rocks.reduce((a, k) => a + (k.c || 0), 0); p.r = p.rocks.reduce((a, k) => a + (k.r || 0), 0);
      p.cvol = p.rocks.reduce((a, k) => a + k.cvol, 0); p.clearH = p.y > 0 ? p.vol / (p.y * 3600) : Infinity;
    });
    const clearH = Math.max(...pools.map(p => p.clearH)), avgM3 = tot.vol ? tot.c / tot.vol : 0;
    const finiteClear = Math.max(0, ...pools.map(p => p.clearH).filter(isFinite));
    const yieldTxt = pools.map(p => `${p.gas && pools.length > 1 ? "gas " : !p.gas && pools.length > 1 ? "ore " : ""}${nf2.format(p.y)} m³/s`).join(", ");

    // session estimate
    if (S.sess.unlimited) sessHours = finiteClear;            // mine everything the fleet can reach
    const sess = { name: `Cargo after ${dur(sessHours)}`, vol: 0, c: 0, r: 0, cvol: 0, gas: tot.gas };
    let runsOut = false;
    for (const p of pools) {
      const want = p.y * 3600 * sessHours, mined = Math.min(want, p.vol), frac = p.vol ? mined / p.vol : 0;
      if (want > p.vol && p.vol > 0) runsOut = true;
      sess.vol += mined;
      if (!S.sess.best) { sess.c += p.c * frac; sess.r += p.r * frac; sess.cvol += p.cvol * frac; continue; }
      let left = mined;
      for (const k of [...p.rocks].sort((a, b) => (b.c || 0) / b.vol - (a.c || 0) / a.vol)) {
        if (left <= 0) break;
        const part = Math.min(left, k.vol) / k.vol;
        sess.c += (k.c || 0) * part; sess.r += (k.r || 0) * part; sess.cvol += k.cvol * part; left -= k.vol * part;
      }
    }
    const minedM3 = sess.vol, frac = tot.vol ? minedM3 / tot.vol : 0;
    const things = n => `${nf0.format(n)} ${hasOre ? (n === 1 ? "rock" : "rocks") : (n === 1 ? "cloud" : "clouds")}`;
    scanSum.innerHTML = `${things(tot.rocks)} · <b>${isk(tot.c)}</b>${hasGas ? "" : " compressed"}`;
    const end = cg ? { name: `Cargo at end of session`, vol: sess.vol + cg.vol, c: sess.c + cg.c, r: sess.r + cg.r, gas: tot.gas && cg.gas } : null;
    sessSum.innerHTML = `${S.sess.unlimited ? `until the belt is empty (${dur(sessHours)})` : S.sess.mode === "end" && S.sess.end ? `until ${esc(S.sess.end)} (${dur(sessHours)})` : dur(sessHours)}${S.sess.best ? " · best ore first" : ""} · cargo <b>${isk(end ? end.c : sess.c)}</b>`;
    const minedTile = `<div class="tile${cg ? "" : " lead"}"><span>ISK to be earned</span><b><span class="val" tabindex="0" data-key="${tipKey("sess", sess)}">${isk(sess.c)}</span></b><small>${isk(sessHours > 0 ? sess.c / sessHours : null)} ISK/h · ${nf2.format(minedM3 ? sess.c / minedM3 : avgM3)} ISK per m³</small></div>`;
    sessOut.innerHTML = `
      <div class="tiles">
        ${cg ? `<div class="tile lead"><span>Cargo at end of session</span><b><span class="val" tabindex="0" data-key="${tipKey("end", end)}">${isk(end.c)}</span></b><small>in hold ${isk(cg.c)} + to be earned ${isk(sess.c)}</small></div>` : ""}
        ${minedTile}
        ${holdTile}
        <div class="tile"><span>${hasOre && hasGas ? "Ore and gas to be mined" : hasGas ? "Gas to be mined" : "Ore to be mined"}</span><b>${nf0.format(minedM3)}</b><small>m³ · ${(frac * 100).toFixed(1)}% of the ${hasOre ? "belt" : "site"}</small></div>
        <div class="tile"><span>${hasOre ? "Cargo after compressing" : "Cargo to haul"}</span><b>${nf0.format(sess.cvol + (cg ? cg.after : 0))}</b><small>m³ to haul${cg ? ", including the hold" : ""}${hasOre && hasGas ? " (gas isn't compressed)" : ""}</small></div>
      </div>
      ${!S.sess.unlimited && runsOut ? `<p class="warn">The ${hasOre ? "belt" : "site"} runs out after ${dur(finiteClear)}, so the estimate stops there.</p>` : ""}
      ${hasOre && y <= 0 ? `<p class="warn">Add a miner on the Ore tab of the Fleet panel to estimate the ore.</p>` : ""}
      ${hasGas && gy <= 0 ? `<p class="warn">Add a huffer on the Gas tab of the Fleet panel to estimate the gas.</p>` : ""}`;

    // belt results
    const byOpen = out.querySelector("#byOre")?.open ?? true, rocksOpen = !!out.querySelector("#rockList")?.open;
    // Grade names are shaded by rank: all grades on this belt are sorted by compressed ISK per m³ and
    // coloured by their position in that order (cheapest lightest, best darkest). Equal prices share a rank.
    const m3Of = o => o.vol ? Math.round(o.c / o.vol * 100) / 100 : 0;
    const levels = [...new Set([].concat(...[...groups.values()].map(g => [...g.grades.values()].map(m3Of))).filter(v => v > 0))].sort((a, b) => a - b);
    const rankOf = v => levels.length > 1 ? levels.indexOf(v) / (levels.length - 1) : 1;
    const nameCell = (cls, label, o) => {
      if (!cls.startsWith("grade")) return `<td>${esc(label)}</td>`;
      const v = m3Of(o), h = v > 0 ? (0.06 + 0.64 * rankOf(v)).toFixed(3) : 0, best = v > 0 && v === levels[levels.length - 1];
      return `<td class="hname"><span class="heat${best ? " best" : ""}" style="--h:${h}">${esc(label)}</span></td>`;
    };
    const row = (cls, label, o, key) => {
      const sh = tot.c ? o.c / tot.c : 0;
      return `<tr class="${cls}">${nameCell(cls, label, o)}<td>${nf0.format(o.rocks)}</td><td>${nf0.format(o.units)}</td><td>${o.vol && o.c > 0 ? nf2.format(o.c / o.vol) : "—"}</td>
        <td><span class="val" tabindex="0" data-key="${key}">${isk(o.c)}</span></td>
        <td><div class="share"><span>${(sh * 100).toFixed(1)}%</span><span class="bar"><i style="width:${(sh * 100).toFixed(1)}%"></i></span></div></td></tr>`;
    };
    const sumC = g => { let s = 0; g.grades.forEach(x => s += x.c); return s; };
    let rows = "";
    [...groups.entries()].sort((a, b) => sumC(b[1]) - sumC(a[1])).forEach(([fi, g]) => {
      const gs = [...g.grades.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
      const f = { rocks: 0, units: 0, vol: 0, c: 0, r: 0 }; gs.forEach(x => { for (const k in f) f[k] += x[k]; });
      // A type with a single grade of the same name (gas, Prismaticite) gets one row, not a type row plus a grade row.
      if (gs.length === 1 && gs[0].name === g.fam) { rows += row("grade solo", gs[0].name, gs[0], tipKey(`g${fi}_0`, gs[0])); return; }
      rows += row("fam", g.fam, f, tipKey("f" + fi, { name: g.fam + " (all grades)", ...f, gas: gs.every(x => x.gas) }));
      gs.forEach((x, i) => rows += row("grade", x.name, x, tipKey(`g${fi}_${i}`, x)));
    });
    const rockRows = rocks.map((k, i) => `<tr><td>${esc(k.ore.name)}</td><td>${nf0.format(k.units)}</td><td>${nf0.format(k.vol)}</td><td>${distTxt(k.dist)}</td>
      <td><span class="val" tabindex="0" data-key="${tipKey("r" + i, { name: k.ore.name + (k.gas ? " (one cloud)" : " (one rock)"), vol: k.vol, c: k.c, r: k.r, gas: k.gas })}">${isk(k.c)}</span></td><td>${isk(k.scanIsk)}</td></tr>`).join("");
    const unk = [...unknown.entries()];
    out.hidden = false;
    out.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--line);padding-top:12px;margin-top:2px">
      <h2>Belt</h2>
      <div class="tiles">
        <div class="tile lead"><span>${hasGas && !hasOre ? "Site value" : hasGas ? "Belt value" : "Belt value, compressed"}</span><b><span class="val" tabindex="0" data-key="${tipKey("tot", { name: "Whole belt", ...tot })}">${isk(tot.c)}</span></b><small>${nf2.format(avgM3)} ISK per m³</small></div>
        <div class="tile"><span>Total volume</span><b>${nf0.format(tot.vol)}</b><small>m³ · ${things(tot.rocks)}, avg ${nf0.format(tot.vol / tot.rocks)} m³</small></div>
        <div class="tile"><span>Time to clear</span><b>${dur(clearH)}</b><small>at ${yieldTxt}</small></div>
        <div class="tile"><span>Scanner estimate</span><b>${isk(tot.scan)}</b><small>the game's own valuation</small></div>
      </div>
      ${S.prices.source === "none" ? `<p class="warn">No prices loaded yet, so values show as 0.</p>` : ""}
      ${tot.missC ? `<p class="warn">${tot.missC} rock${tot.missC > 1 ? "s have" : " has"} no price on this market and count as 0.</p>` : ""}
      ${unk.length ? `<p class="warn">Not recognised and left out: ${unk.map(([n, c]) => `${esc(n)} (${c})`).join(", ")}.</p>` : ""}
      <details class="sub-fold" id="byOre"${byOpen ? " open" : ""}><summary>Value by ore and grade</summary>
        <div class="tablewrap" style="margin-top:8px"><table class="data">
          <thead><tr><th>Ore</th><th>Rocks</th><th>Units</th><th>ISK / m³</th><th>Value</th><th>Share of belt</th></tr></thead>
          <tbody>${rows}<tr class="total"><td>Total</td><td>${nf0.format(tot.rocks)}</td><td>${nf0.format(tot.units)}</td><td>${nf2.format(avgM3)}</td><td>${isk(tot.c)}</td><td>100%</td></tr></tbody>
        </table></div>
      </details>
      <details class="sub-fold" id="rockList"${rocksOpen ? " open" : ""}><summary>All rocks (${rocks.length})</summary>
        <div class="tablewrap" style="margin-top:8px"><table class="data">
          <thead><tr><th>Ore</th><th>Units</th><th>Volume m³</th><th>Distance</th><th>Value</th><th>Scanner estimate</th></tr></thead>
          <tbody>${rockRows}</tbody></table></div>
      </details>
      </div>`;
  }

  function beltTip(v) {
    const o = BELT_TIPS.get(v.dataset.key); if (!o) return;
    const diff = (o.r && o.c != null) ? (o.c / o.r - 1) * 100 : null;
    const unit = p => p == null ? "" : `<span>Unit price</span><span class="v">${nf2.format(p)}</span>`;
    const html = o.gas
      ? `<h4>${esc(o.name)}</h4>
        <div class="grp"><span class="lbl">Gas (sold as it is)</span><span>Value</span><span class="v">${o.c == null ? "no orders" : nf0.format(o.c) + " ISK"}</span>
          <span>ISK per m³ mined</span><span class="v">${o.c == null || !o.vol ? "—" : nf2.format(o.c / o.vol)}</span>${unit(o.cp)}</div>`
      : `<h4>${esc(o.name)}</h4>
        <div class="grp"><span class="lbl">Compressed</span><span>Value</span><span class="v">${o.c == null ? "no orders" : nf0.format(o.c) + " ISK"}</span>
          <span>ISK per m³ mined</span><span class="v">${o.c == null || !o.vol ? "—" : nf2.format(o.c / o.vol)}</span>${unit(o.cp)}</div>
        <div class="grp"><span class="lbl">Raw (uncompressed)</span><span>Value</span><span class="v">${o.r == null ? "no orders" : nf0.format(o.r) + " ISK"}</span>
          <span>ISK per m³ mined</span><span class="v">${o.r == null || !o.vol ? "—" : nf2.format(o.r / o.vol)}</span>${unit(o.rp)}</div>
        ${diff == null ? "" : `<div class="cmp">Compressed vs raw: <span class="${diff >= 0 ? "up" : "down"}">${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%</span></div>`}`;
    showTip(v, html, { below: true });
  }
  const beltPanel = $("beltPanel");
  beltPanel.addEventListener("mouseover", e => { const v = e.target.closest(".val"); if (v) beltTip(v); });
  beltPanel.addEventListener("mouseout", e => { const v = e.target.closest(".val"); if (v && !v.contains(e.relatedTarget)) hideTip(); });
  beltPanel.addEventListener("focusin", e => { const v = e.target.closest(".val"); if (v) beltTip(v); });
  beltPanel.addEventListener("focusout", hideTip);

  const beltErr = $("beltErr"), cargoErr = $("cargoErr");
  $("calcBelt").addEventListener("click", () => {
    const parsed = parseScan($("scan").value);
    if (!parsed.rocks.length) { beltErr.textContent = "No asteroids found. Copy the results from the Mining scanner window and paste them again."; beltErr.hidden = false; return; }
    beltErr.hidden = true; belt = parsed; $("scanBox").open = false; renderBelt();
  });
  $("calcCargo").addEventListener("click", () => {
    const parsed = parseCargo($("cargo").value);
    if (!parsed.items.length) { cargoErr.textContent = "No ore found. Copy the contents of your ore hold (name and quantity first) and paste them again."; cargoErr.hidden = false; return; }
    cargoErr.hidden = true; cargo = parsed; renderBelt();
  });
  $("clearCargo").addEventListener("click", () => { $("cargo").value = ""; cargo = null; cargoErr.hidden = true; renderBelt(); });
  $("clearBelt").addEventListener("click", () => { $("scan").value = ""; belt = null; beltErr.hidden = true; renderBelt(); });

  /* ---------- (re)initialise from state ---------- */
  init = () => {
    hubEl.value = S.hub; basisEl.value = S.basis;
    sessHEl.value = S.sess.h; sessMEl.value = S.sess.m; bestEl.checked = !!S.sess.best;
    sessEndEl.value = S.sess.end || ""; sharePctEl.value = S.sess.pct;
    syncUnit(); applyMode(); applyFleetTab();
    renderMiners(); renderHuffers(); renderStatus(); renderTables();
  };
  syncNow = serverSync;
  init();
  serverSync();
}

/** Called by Settings → reset after the module's saved data was removed. */
export function reset() {
  if (!init) return;
  loadState(); noServer = false; belt = null; cargo = null; $("priceErr").hidden = true; retryStep = 0;
  $("scan").value = ""; $("cargo").value = "";
  init(); syncNow();
}

/** For the update bar: what would be lost by reloading the page now. */
export function unsavedNote() {
  return belt || cargo ? "pasted scanner and cargo data" : null;
}
