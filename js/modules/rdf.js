// Rampant Drone Fabricator: Rampancy Data Dump collected by a wave, its ISK value and the payout per pilot.
// The Fabricator holds m × n(n+1)/2 data after wave n is cleared (wave n adds m × n); m = class unit U × threat
// multiplier T. Threat comes from the Rampancy of the ships on grid. Mechanics: patch notes 23.02 and 24.01
// (2026-09-22 data increase); U and T from in-game cargo scans (corp sheet "Rampant Drone Science"), see below.
import { nf0, isk, esc, store } from "../shared.js";   // store: only to clear what an earlier version saved
import * as P from "../prices.js";

const DATA_URL = new URL("../../data/rdf.json", import.meta.url);   // the hybrid drones the Fabricator drops
const SIZES = { 5: "light", 10: "medium", 25: "heavy" };              // by packaged m³
const OLD_KEY = "eveTools.rdf.v1";   // earlier versions saved settings here; nothing is saved now

/* ---------- game constants (edit these two maps after a patch) ---------- */
// Class unit U = data after wave 1 at Low threat. C2–C6 measured (C1 shares C2/C3's loot tier, not measured).
const CLASS_UNIT = { C1: 4, C2: 4, C3: 4, C4: 5, C5: 6, C6: 6 };
// Threat multiplier T; each step doubles. Severe and Critical measured; Moderate only before the September
// patch; Low inferred from the doubling.
const THREATS = [   // from the lowest; `min` = Rampancy on grid needed, `pause` = seconds before the next wave
  { id: "Low", min: 0, mult: 1, pause: 18 },
  { id: "Moderate", min: 12, mult: 2, pause: 15 },
  { id: "Severe", min: 36, mult: 4, pause: 12 },
  { id: "Critical", min: 72, mult: 8, pause: 6 },
];
// Not yet confirmed by a cargo scan: Low and Moderate threat, C1 at any threat, C6 at Critical. Moderate is partly
// confirmed: a pre-patch C2 Moderate run (wave 63, 12,096 data = 6 × 2,016) × 4/3 (the +33% for C1–C3) gives 8, as here.
// Rampancy per ship on grid (patch notes 24.01).
const SHIPS = [   // names and values as on the EVE University wiki (Rampant Drone Fabricator)
  ["cruiser", "Cruiser (T1/Faction)", 1],
  ["logi", "Logistics Cruiser", 2],
  ["hac", "Heavy Assault Cruiser", 2],
  ["bc", "T1/Faction Battlecruiser", 2],
  ["cs", "Command Ship", 3],
  ["t3c", "Strategic Cruiser", 4],
  ["bs", "T1/Faction Battleship", 6],
  ["blops", "Black Ops", 8],
  ["marauder", "Marauder", 12],
  ["fax", "Force Auxiliary", 36],
  ["cap", "All other capital ships", 72],
];
// Nanoswarms (EVE University wiki, Rampant Drone Fabricator): two become vulnerable on these waves; destroying one
// gives its 20% bonus and the other self-destructs; clearing the wave without destroying either gives nothing.
const SWARM_WAVES = new Set([5, 10, 15, 25, 35, 45, 65, 85]);
// [name, bonus, icon in img/nanoswarm/]. Icons: CCP's module/script icons as used on the EVE University wiki, picked to
// show the bonus type; there is no heat-damage icon, so Thermal Sink uses the overheat icon tinted blue ("cool").
const SWARMS = [
  ["Clarifier", "Scan resolution", "scan-resolution"],
  ["Energized", "Capacitor capacity", "capacitor"],
  ["Focuser", "Turret optimal range", "optimal-range"],
  ["Light Squadron", "Light fighter damage", "light-fighter"],
  ["Masker", "Signature radius reduction", "signature"],
  ["Overclocker", "Overheat benefits", "overheat"],
  ["Patcher", "Local armor repair amount", "armor-repair"],
  ["Predictive", "Tracking speed", "tracking"],
  ["Prolonging", "Missile flight time", "missile-range"],
  ["Rapid Squadron", "Fighter velocity", "fighter-velocity"],
  ["Rapidity", "Ship velocity", "velocity"],
  ["Reflective", "Local shield boost amount", "shield-boost"],
  ["Suppressive", "Missile explosion radius reduction", "explosion-radius"],
  ["Thermal Sink", "Heat damage reduction", "overheat cool"],
  ["Trans-Patch", "Remote armor repair amount", "remote-armor"],
  ["Trans-Reflect", "Remote shield boost amount", "remote-shield"],
];
const ICON_DIR = new URL("../../img/nanoswarm/", import.meta.url);
const PRICE = 200000;           // ISK per unit: the item's base price (type 91773); Jita trades around it
const VOLUME = 0.01;            // m³ per unit
const MIN_WAVE = 5;             // the Fabricator is invulnerable until wave 5 is cleared
const MAX_WAVE = 100;
const FULL_RUN = MAX_WAVE * (MAX_WAVE + 1) / 2;   // 5,050

/* ---------- formulas ---------- */
export const threatOf = r => THREATS.reduce((t, x) => r >= x.min ? x : t, THREATS[0]);
export const baseData = (cls, threat) => CLASS_UNIT[cls] * threat.mult;          // m
// Must match in-game readings: C3 Critical waves 1/2/3/7 = 32/96/192/896, C4 Critical 8 = 1,440, C5 Critical 7/8 =
// 1,344/1,728, C4 Severe 6 = 420, C6 Severe 10 = 1,320 (cargo scans); C5 Critical 25 = 15,600 and 31 = 23,808 (corp
// runs of 2026-11-20, Janice appraisals vBtua5 and fE3IJ6: the Fabricator's whole loot). Before the September patch:
// C2 Moderate 63 = 12,096 (m 6; × 4/3 = 8 now, so 16,128).
export const totalData = (m, n) => m * n * (n + 1) / 2;
export const waveGain = (m, n) => m * n;

const TEMPLATE = `
  <div class="head">
    <div class="title-row"><h1>Rampant Drone Fabricator</h1><span class="tag">alpha</span>
      <button class="btn-link" id="toNotes" type="button">Notes</button></div>
    <span class="sub">Rampancy Data Dump collected by the wave you stop at, and what it's worth</span>
  </div>
  <div class="layout">
    <aside class="side">
      <section class="panel" aria-labelledby="h-rdf-wh">
        <h2 id="h-rdf-wh">Wormhole</h2>
        <div class="seg full" id="cls" role="group" aria-label="Wormhole class"></div>
        <div class="tiles two" id="whData"></div>
      </section>

      <section class="panel" aria-labelledby="h-rdf-swarm">
        <div class="head"><h2 id="h-rdf-swarm">Nanoswarms</h2><button class="btn" id="swarmReset" type="button" title="Show every Nanoswarm normally again">Reset</button></div>
        <p class="note">Two Nanoswarms become vulnerable on waves <b class="num">${[...SWARM_WAVES].join(", ")}</b>. Destroy one for its 20% bonus; the other self-destructs. Clear the wave without destroying either and you get no bonus.</p>
        <table class="data swarms"><thead><tr><th colspan="2">Nanoswarm</th><th>20% bonus</th></tr></thead>
          <tbody id="swarmRows"></tbody></table>
      </section>
    </aside>

    <div class="mainc">
      <section class="panel" aria-labelledby="h-rdf-sev">
        <details class="fold" id="sevFold">
          <summary><h3 id="h-rdf-sev">Severity</h3><span class="sum" id="sevSum"></span></summary>
          <div class="fold-body">
            <div class="legend" id="sevLegend"></div>
            <div class="ship-grid" id="ships"></div>
            <div class="scan-actions"><button class="btn" id="clearShips" type="button">Clear ships</button></div>
          </div>
        </details>
      </section>

      <section class="panel" aria-labelledby="h-rdf-loot">
        <details class="fold" id="lootFold">
          <summary><h3 id="h-rdf-loot">Drones</h3><span class="sum" id="lootSum"></span></summary>
          <div class="fold-body">
            <textarea id="lootPaste" class="mono" spellcheck="false" aria-label="Cargo with the Fabricator's drones" style="height:120px"
              placeholder="Open the cargo in list view, select the items (Ctrl+A), copy (Ctrl+C) and paste here. Only hybrid drones are counted; the data dump's value always comes from the selected wave."></textarea>
            <div class="scan-actions"><button class="btn" id="lootClear" type="button">Clear</button><span class="note" id="lootNote"></span></div>
            <div class="tablewrap" id="lootWrap" hidden><table class="data" id="lootTable"></table></div>
          </div>
        </details>
      </section>

      <section class="panel" aria-labelledby="h-rdf-pay">
        <div class="head"><h2 id="h-rdf-pay">Payout</h2>
          <div class="pay-actions">
          <button class="btn" id="copyRow" type="button" title="Copy the selected wave's payout"></button>
          <div class="seg" id="step" role="group" aria-label="Waves shown">
            <button type="button" data-step="5">Every 5th wave</button><button type="button" data-step="1">Every wave</button>
          </div></div>
        </div>
        <div class="tiles" id="tiles"></div>
        <div class="tablewrap"><table class="data" id="waveTable"></table></div>
      </section>
    </div>
  </div>
  <footer class="note rdf-notes" id="rdfNotes" tabindex="-1" aria-labelledby="h-rdf-notes">
    <h2 id="h-rdf-notes">Notes</h2>
    <ul>
      <li><b>Confirmed:</b> Fabricator data at Severe and Critical threat.</li>
      <li><b>Partially confirmed:</b> Moderate threat. An older run, recalculated for the September data increase, matches; it hasn't been checked in game since.</li>
      <li><b>Not confirmed yet:</b> Low threat. It follows the same pattern, but hasn't been checked in game.</li>
      <li><b>Threat level:</b> the calculator uses one threat level for the whole run. It doesn't follow ships joining or leaving the grid.</li>
      <li><b>Prices:</b> Fabricator data is valued at a fixed 200,000 ISK. Pasted drones use market prices.</li>
      <li><b>Payout per pilot:</b> one pilot per ship on grid, shared equally.</li>
    </ul>
    <p class="credit">Calculations based on RDF spreadsheet by <b>BaneOfUtric</b></p>
  </footer>`;

/* ---------- state ---------- */
let S, $, DRONES = new Map(), loot = [], ignored = 0;   // DRONES: lower-case name -> {id, name, vol}; loot: pasted drones
// Nothing is saved in the browser: every visit starts from these.
function defaults() { return { cls: "C3", ships: {}, wave: 20, step: 5, open: true, dim: [] }; }
const clampWave = v => Math.min(MAX_WAVE, Math.max(MIN_WAVE, Math.round(+v) || MIN_WAVE));
const count = id => Math.max(0, Math.floor(+S.ships[id] || 0));
const shipsOnGrid = () => SHIPS.reduce((a, [id]) => a + count(id), 0);
const rampancy = () => SHIPS.reduce((a, [id, , r]) => a + count(id) * r, 0);
const pilots = () => shipsOnGrid();   // 0 with no ships: per pilot shows 0 in the tiles and "-" in the list
const share = n => n * (n + 1) / (MAX_WAVE * (MAX_WAVE + 1));
const pct = x => (x * 100).toFixed(1) + "%";
const m = () => baseData(S.cls, threatOf(rampancy()));

/* ---------- pasted loot: hybrid drones only ---------- */
const cleanTxt = t => t.replace(/[\u00a0\u202f\u2009]/g, " ").trim();
// Cargo list view: name, quantity, then group, ... Same drones are added up; anything else (the data dump too) is ignored.
function parseLoot(text) {
  const byId = new Map(); let skip = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let cols = raw.split("\t").map(cleanTxt);
    if (cols.length < 2) { const mt = cleanTxt(raw).match(/^(.*?[^\d\s])\s+(\d[\d ,.]*)(?:\s|$)/); cols = mt ? [mt[1], mt[2]] : [cleanTxt(raw), "1"]; }
    const d = DRONES.get(cols[0].replace(/\*$/, "").trim().toLowerCase());
    const qty = cols[1] === "" ? 1 : parseInt(cols[1].replace(/[^\d]/g, ""), 10);
    if (!d || !(qty > 0)) { skip++; continue; }
    if (!byId.has(d.id)) byId.set(d.id, { ...d, qty: 0 });
    byId.get(d.id).qty += qty;
  }
  return { list: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)), skip };
}
// Value of the pasted drones at the market and basis chosen in Settings; drones without a price count as 0.
function drones() {
  let value = 0, count = 0, vol = 0, unpriced = 0;
  for (const d of loot) { const pr = P.price(d.id); count += d.qty; vol += d.qty * d.vol; if (pr == null) unpriced += d.qty; else value += pr * d.qty; }
  return { value, count, vol, unpriced };
}

function renderLoot() {
  const t = drones();
  $("#lootSum").innerHTML = loot.length ? `<b>${nf0.format(t.count)}</b> drone${t.count === 1 ? "" : "s"} · <b>${isk(t.value)}</b>` : "paste your cargo to add drones to the payout";
  $("#lootNote").textContent = [ignored ? `${nf0.format(ignored)} other line${ignored === 1 ? "" : "s"} ignored` : "",
    t.unpriced ? `${nf0.format(t.unpriced)} drone${t.unpriced === 1 ? " has" : "s have"} no price on ${P.hubName()}` : ""].filter(Boolean).join(" · ");
  $("#lootWrap").hidden = !loot.length;
  if (!loot.length) { $("#lootTable").innerHTML = ""; return; }
  $("#lootTable").innerHTML = `<thead><tr><th>Drone</th><th>Qty</th><th>Size</th><th>Unit price</th><th>Value</th></tr></thead>
    <tbody>${loot.map(d => { const pr = P.price(d.id); return `<tr><td>${esc(d.name)}</td><td>${nf0.format(d.qty)}</td><td>${SIZES[d.vol] || ""}</td>
      <td>${pr == null ? "no price" : isk(pr)}</td><td>${pr == null ? "—" : isk(pr * d.qty)}</td></tr>`; }).join("")}
    <tr class="total"><td>Total</td><td>${nf0.format(t.count)}</td><td>${nf0.format(t.vol)} m³</td><td></td><td>${isk(t.value)}</td></tr></tbody>`;
}
function onPaste() {
  const r = parseLoot($("#lootPaste").value);
  loot = r.list; ignored = r.skip;
  renderLoot(); renderTiles();
}

/* ---------- render ---------- */
function render() {
  const r = rampancy(), t = threatOf(r), mm = baseData(S.cls, t);
  const next = THREATS[THREATS.indexOf(t) + 1];
  const pillCls = { Low: "", Moderate: "ok", Severe: "warn", Critical: "bad" }[t.id];

  $("#cls").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.cls === S.cls));
  $("#whData").innerHTML = `
    <div class="tile"><span>Rampancy on grid</span><b>${nf0.format(r)}</b>${next ? `<small>${next.id} at ${next.min}</small>` : ""}</div>
    <div class="tile"><span>Severity</span><b><span class="pill ${pillCls}">${t.id}</span></b></div>
    <div class="tile"><span>Data after wave 1</span><b>${nf0.format(mm)}</b></div>
    <div class="tile"><span>Pause between waves</span><b>${t.pause} s</b></div>`;

  $("#sevSum").innerHTML = `Rampancy <b>${nf0.format(r)}</b> · ${t.id} · ${nf0.format(shipsOnGrid())} ship${shipsOnGrid() === 1 ? "" : "s"}`;
  $("#sevLegend").innerHTML = THREATS.map((x, i) =>
    `<span>${x.id}: ${x.min}${THREATS[i + 1] ? "–" + (THREATS[i + 1].min - 1) : "+"}</span>`).join("");
  $("#step").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.step === S.step));

  renderTable();
  renderTiles();
}

// Nanoswarm list; a click dims a row (e.g. the ones you don't want) and a second click brings it back.
function renderSwarms() {
  const dim = new Set(S.dim);
  $("#swarmRows").innerHTML = SWARMS.map(([n, e, ico]) => {
    const [file, mod] = ico.split(" ");
    return `<tr data-swarm="${esc(n)}" tabindex="0" aria-pressed="${dim.has(n)}"${dim.has(n) ? ` class="dim"` : ""}>
      <td class="ico"><img src="${ICON_DIR}${file}.png" alt="" width="24" height="24"${mod ? ` class="${mod}"` : ""}></td><td>${esc(n)}</td><td>${esc(e)}</td></tr>`;
  }).join("");
  $("#swarmReset").disabled = !dim.size;
}
function toggleSwarm(n) {
  S.dim = S.dim.includes(n) ? S.dim.filter(x => x !== n) : [...S.dim, n];
  renderSwarms();
  $(`#swarmRows tr[data-swarm="${CSS.escape(n)}"]`)?.focus();
}

// The payout tiles for the selected wave.
function renderTiles() {
  const mm = m(), n = S.wave, p = pilots();
  const tot = totalData(mm, n), val = tot * PRICE, dr = drones(), all = val + dr.value;
  const gainNext = n < MAX_WAVE ? waveGain(mm, n + 1) : 0;
  $("#tiles").innerHTML = `
    <div class="tile lead"><span>Data after wave ${n}</span><b>${nf0.format(tot)}</b><small>${nf0.format(tot * VOLUME)} m³</small></div>
    <div class="tile lead"><span>Worth</span><b>${isk(val)}</b><small>${nf0.format(PRICE)} ISK per unit</small></div>
    ${loot.length ? `<div class="tile"><span>Drones</span><b>${isk(dr.value)}</b><small>${nf0.format(dr.count)} drones · ${nf0.format(dr.vol)} m³</small></div>` : ""}
    <div class="tile"><span>Per pilot</span><b>${p ? isk(all / p) : "0"}</b><small>${p ? `${p} pilot${p === 1 ? "" : "s"} · ${nf0.format(tot / p)} data${loot.length ? ` · incl. ${isk(dr.value / p)} drones` : ""}` : "no ships on grid"}</small></div>
    <div class="tile"><span>Next wave adds</span><b>${n < MAX_WAVE ? isk(gainNext * PRICE) : "—"}</b><small>${n < MAX_WAVE ? `${nf0.format(gainNext)} data · ${p ? isk(gainNext * PRICE / p) : "0"} per pilot` : "last wave"}</small></div>`;
  $("#copyRow").textContent = `Copy wave ${n}`;
}

function renderTable() {
  const mm = m(), n = S.wave, p = pilots(), waves = [];
  for (let w = MIN_WAVE; w <= MAX_WAVE; w++) if (S.step === 1 || w % 5 === 0 || w === n) waves.push(w);
  $("#waveTable").innerHTML = `<thead><tr><th>Wave</th><th>Wave adds</th><th>Total data</th><th>Worth</th><th>Per pilot</th><th>Share of full run</th></tr></thead>
    <tbody>${waves.map(w => {
      const d = totalData(mm, w), sh = share(w);
      return `<tr${w === n ? ` class="cur" aria-selected="true"` : ` aria-selected="false"`} data-wave="${w}" tabindex="0">
        <td>${w}${SWARM_WAVES.has(w) ? ` <span class="pill swarm" title="Two Nanoswarms become vulnerable on this wave">Nanoswarm</span>` : ""}</td>
        <td>${nf0.format(waveGain(mm, w))}</td><td>${nf0.format(d)}</td>
        <td>${isk(d * PRICE)}</td><td>${p ? isk(d * PRICE / p) : "-"}</td>
        <td><span class="share">${pct(sh)}<span class="bar"><i style="width:${pct(sh)}"></i></span></span></td></tr>`;
    }).join("")}</tbody>`;
}

// Select a wave from the table: highlight its row and update the tiles above (the table itself stays as it is).
function selectWave(w) {
  S.wave = clampWave(w);
  $("#waveTable").querySelectorAll("tr[data-wave]").forEach(tr => {
    const on = +tr.dataset.wave === S.wave;
    tr.classList.toggle("cur", on); tr.setAttribute("aria-selected", on);
  });
  renderTiles();
}

function copyText() {
  const mm = m(), n = S.wave, d = totalData(mm, n), dr = drones(), v = d * PRICE + dr.value;
  return `Wave ${n}\nFabricator data: ${nf0.format(d)}\n${loot.length ? `Drones: ${nf0.format(dr.count)} (${isk(dr.value)})\n` : ""}`
    + `Total worth: ${isk(v)} (${pilots() ? isk(v / pilots()) : "0"} per pilot)\n${pct(share(n))} of full run`;
}
async function copy() {
  const txt = copyText(), b = $("#copyRow");
  let ok = false;
  try { await navigator.clipboard.writeText(txt); ok = true; } catch (_) {
    const ta = document.createElement("textarea");      // older browsers / no clipboard permission
    ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand("copy"); } catch (_) {}
    ta.remove();
  }
  b.textContent = ok ? "Copied" : "Couldn't copy";
  clearTimeout(copy.t); copy.t = setTimeout(() => { b.textContent = `Copy wave ${S.wave}`; }, 1500);
}

function fill() {
  $("#sevFold").open = !!S.open;
  $("#ships").querySelectorAll("input[data-ship]").forEach(i => { i.value = count(i.dataset.ship) || ""; });
  $("#lootPaste").value = ""; loot = []; ignored = 0;
  renderSwarms();
  renderLoot();
  render();
}

/* ---------- module API ---------- */
export async function mount(el) {
  el.innerHTML = TEMPLATE;
  $ = sel => el.querySelector(sel);
  S = defaults();
  store.remove(OLD_KEY);
  try {
    const r = await fetch(DATA_URL);
    for (const [id, name, vol] of (await r.json()).drones) DRONES.set(name.toLowerCase(), { id, name, vol });
  } catch (_) { /* no drone list: pasted cargo just isn't recognised */ }
  P.want([...DRONES.values()].map(d => d.id));
  P.on(() => { renderLoot(); renderTiles(); });

  $("#cls").innerHTML = Object.keys(CLASS_UNIT).map(c => `<button type="button" data-cls="${c}">${c}</button>`).join("");
  $("#ships").innerHTML = SHIPS.map(([id, name, r]) =>
    `<label class="ship"><span>${esc(name)} <span class="muted">(${r})</span></span>
      <input type="number" min="0" step="1" data-ship="${id}" placeholder="0" aria-label="${esc(name)}, number of ships"></label>`).join("");

  $("#cls").addEventListener("click", e => {
    const b = e.target.closest("[data-cls]"); if (!b) return;
    S.cls = b.dataset.cls; render();
  });
  $("#step").addEventListener("click", e => {
    const b = e.target.closest("[data-step]"); if (!b) return;
    S.step = +b.dataset.step; render();
  });
  $("#ships").addEventListener("input", e => {
    const i = e.target.closest("[data-ship]"); if (!i) return;
    const v = Math.max(0, Math.floor(+i.value || 0));
    if (v) S.ships[i.dataset.ship] = v; else delete S.ships[i.dataset.ship];
    render();
  });
  $("#clearShips").addEventListener("click", () => { S.ships = {}; fill(); });

  // Click a row (or Enter / Space on it) to select that wave.
  $("#waveTable").addEventListener("click", e => {
    const tr = e.target.closest("tr[data-wave]"); if (tr) selectWave(+tr.dataset.wave);
  });
  $("#waveTable").addEventListener("keydown", e => {
    const tr = e.target.closest("tr[data-wave]"); if (!tr) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectWave(+tr.dataset.wave); }
  });
  $("#copyRow").addEventListener("click", copy);
  // Not a #link: the URL hash picks the tool, so scroll instead.
  $("#toNotes").addEventListener("click", () => {
    const f = $("#rdfNotes");
    f.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    f.focus({ preventScroll: true });
  });
  $("#lootPaste").addEventListener("input", onPaste);
  $("#lootClear").addEventListener("click", () => { $("#lootPaste").value = ""; onPaste(); $("#lootPaste").focus(); });
  $("#swarmRows").addEventListener("click", e => {
    const tr = e.target.closest("tr[data-swarm]"); if (tr) toggleSwarm(tr.dataset.swarm);
  });
  $("#swarmRows").addEventListener("keydown", e => {
    const tr = e.target.closest("tr[data-swarm]"); if (!tr) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSwarm(tr.dataset.swarm); }
  });
  $("#swarmReset").addEventListener("click", () => { S.dim = []; renderSwarms(); });

  fill();
}

// The rest is easy to set again.
export const unsavedNote = () => [shipsOnGrid() ? "the RDF fleet" : "", loot.length ? "the pasted RDF loot" : ""].filter(Boolean).join(" and ") || null;

export function reset() { S = defaults(); if ($) fill(); }
