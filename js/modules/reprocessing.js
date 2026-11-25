// Reprocessing calculator: what pasted items reprocess into, what that's worth, and whether it beats selling them.
// Game data (materials per batch, batch sizes, skill/implant/structure/rig bonuses) comes from the server's SDE
// extract (sde.php?set=reprocessing, kept current by cron/sde.php). Market prices come from the app's shared price
// service (js/prices.js, market and basis chosen in Settings); CCP's adjusted prices for the tax from prices.php.
import { nf2, nf0, isk, esc, showTip, hideTip, store, takeFor } from "../shared.js";
import * as P from "../prices.js";

const KEY = "eveTools.reprocessing.v1";
const SDE_URL = new URL("../../sde.php?set=reprocessing", import.meta.url);
const PRICES_URL = new URL("../../prices.php", import.meta.url);
const ADJ_EVERY = 30 * 60 * 1000;          // ask prices.php for newer adjusted prices this often (they change about daily)
const T_REPRO = 3385, T_REPRO_EFF = 3389, T_SCRAP = 12196;
const CLASSES = { ore: "Ore", moon: "Moon ore", ice: "Ice", scrap: "Scrapmetal" };
const NPC = "npc", OTHER = "other";        // structure choices besides the SDE's refinery-bonus structures

const TEMPLATE = `
  <div class="head">
    <h1>Reprocessing</h1>
    <span class="sub">What your items reprocess into and whether that beats selling them</span>
  </div>
  <div class="layout">
    <aside class="side">
      <section class="panel" aria-labelledby="h-rp-where">
        <h2 id="h-rp-where">Structure</h2>
        <div class="row2">
          <label class="fld">Structure<select id="structure"></select></label>
          <label class="fld">System<select id="sec">
            <option value="high">High sec</option><option value="low">Low sec</option><option value="null">Null sec / WH</option>
          </select></label>
        </div>
        <div class="row2" id="rigRow">
          <label class="fld">Ore rig<select data-rig="ore"></select></label>
          <label class="fld">Moon ore rig<select data-rig="moon"></select></label>
          <label class="fld">Ice rig<select data-rig="ice"></select></label>
          <label class="fld">Tax %<input type="number" id="tax" min="0" max="100" step="0.1"></label>
        </div>
        <div class="row2" id="npcRow" hidden>
          <label class="fld">Station yield %<input type="number" id="stationYield" min="0" max="100" step="1"></label>
          <label class="fld">Tax %<input type="number" id="npcTax" min="0" max="100" step="0.1"></label>
        </div>
        <div class="yields" id="yields"></div>
      </section>

      <section class="panel" aria-labelledby="h-rp-char">
        <h2 id="h-rp-char">Character</h2>
        <div class="skill-grid" id="skills"></div>
        <label class="fld">Implant<select id="implant"></select></label>
      </section>

    </aside>

    <div class="mainc">
      <section class="panel" aria-labelledby="h-rp-items">
        <div class="head"><h2 id="h-rp-items">Items to reprocess</h2><span class="sess-sum" id="pasteSum"></span></div>
        <textarea id="paste" class="mono" spellcheck="false" aria-label="Items to reprocess" style="height:140px"
          placeholder="Open the hangar or container in list view, select the items (Ctrl+A), copy (Ctrl+C) and paste here."></textarea>
        <div class="scan-actions">
          <button class="btn btn-primary" id="calc" type="button">Reprocess</button>
          <button class="btn" id="clear" type="button">Clear</button>
          <span class="msg err" id="pasteErr" role="alert" hidden></span>
        </div>
      </section>

      <section class="panel" id="results" aria-labelledby="h-rp-out" hidden>
        <h2 id="h-rp-out">Result</h2>
        <div class="tiles" id="tiles"></div>
        <div id="warns"></div>
        <h3 class="tbl-title">Materials</h3>
        <div class="tablewrap"><table class="data" id="matTable"></table></div>
        <h3 class="tbl-title">Items</h3>
        <div class="tablewrap"><table class="data" id="itemTable"></table></div>
      </section>
    </div>
  </div>`;

/* ---------- state ---------- */
let D, S, $, items = null, adjusted = {}, adjustedAt = 0;
let pasteText = "", refill = null, source = "";   // refill: re-read the settings into the page (after Settings → reset); source: where a sent paste came from

function defaults() {
  return { structure: "35835", sec: "high", rigs: { ore: 0, moon: 0, ice: 0 }, tax: 0, npcTax: 5, stationYield: 50,
    skills: {}, implant: "" };
}
const save = () => store.setJSON(KEY, S);

/* ---------- yields ---------- */
// The M-set rig of a class and tier (1 = T1, 2 = T2); L/XL rigs have the same numbers.
function rig(cls, tier) {
  if (!tier) return null;
  return Object.values(D.rigs).find(r => r.class === cls && r.name.endsWith(tier === 2 ? " II" : " I")) || null;
}
const lvl = id => +S.skills[id] || 0;
const bonus = (id, l) => (D.skills[id]?.bonus || 0) / 100 * l;
function yieldFor(cls, skill) {
  const npc = S.structure === NPC;
  let base = npc ? (+S.stationYield || 0) : D.baseYield;
  if (cls === "scrap") return base / 100 * (1 + bonus(T_SCRAP, lvl(T_SCRAP)));
  if (!npc) {
    const r = rig(cls, +S.rigs[cls] || 0);
    if (r) base = r.yield * r.security[S.sec];
    base *= 1 + (D.structures[S.structure]?.bonus || 0) / 100;
  }
  return base / 100 * (1 + bonus(T_REPRO, lvl(T_REPRO))) * (1 + bonus(T_REPRO_EFF, lvl(T_REPRO_EFF)))
    * (1 + bonus(skill, lvl(skill))) * (1 + (D.implants[S.implant]?.bonus || 0) / 100);
}
const taxRate = () => (S.structure === NPC ? +S.npcTax : +S.tax) / 100 || 0;

/* ---------- prices ---------- */
const price = id => P.price(id);

/* ---------- paste ---------- */
const cleanTxt = s => s.replace(/[   ]/g, " ").trim();
const parseUnits = s => { const d = cleanTxt(s).replace(/[^\d]/g, ""); return d ? parseInt(d, 10) : NaN; };
function parseMoney(s) {
  let t = cleanTxt(s).replace(/[^\d.,]/g, "");
  const m = t.match(/[.,](\d{1,2})$/); let dec = "";
  if (m) { dec = "." + m[1]; t = t.slice(0, -m[0].length); }
  t = t.replace(/[.,]/g, "");
  return t ? parseFloat(t + dec) : NaN;
}
// List view: name, quantity, then group, ..., "<n> ISK" (estimated price of the stack). Same items are added up.
function parsePaste(text) {
  const byId = new Map(), skipped = new Map();
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let cols = raw.split("\t").map(cleanTxt);
    if (cols.length < 2) { const m = cleanTxt(raw).match(/^(.*?[^\d\s])\s+(\d[\d ]*)(?:\s|$)/); cols = m ? [m[1], m[2]] : [cleanTxt(raw), "1"]; }
    const name = cols[0].replace(/\*$/, "").trim(), qty = cols[1] === "" ? 1 : parseUnits(cols[1]);
    const id = D.byName.get(name.toLowerCase());
    if (!id || !(qty > 0)) { if (name) skipped.set(name, (skipped.get(name) || 0) + 1); continue; }
    if (!byId.has(id)) byId.set(id, { id, it: D.items[id], qty: 0, est: 0, estQty: 0 });
    const e = byId.get(id); e.qty += qty;
    const iskCol = cols.slice(2).find(c => /isk\s*$/i.test(c)), est = iskCol ? parseMoney(iskCol) : NaN;
    if (est >= 0) { e.est += est; e.estQty += qty; }
  }
  return { list: [...byId.values()], skipped };
}

/* ---------- calculation ---------- */
function compute() {
  const mats = new Map(), rows = [];
  let inVal = 0, outVal = 0, tax = 0, inMissing = 0, outMissing = new Set(), adjMissing = new Set();
  const rate = taxRate();
  for (const e of items.list) {
    const it = e.it, y = yieldFor(it.class, it.skill);
    const batches = Math.floor(e.qty / it.portion), left = e.qty - batches * it.portion;
    let val = 0, t = 0;
    const out = [];
    for (const [mid, per] of Object.entries(it.materials)) {
      const q = Math.floor(batches * per * y);
      if (!q) continue;
      const p = price(mid), a = adjusted[mid];
      if (p == null) outMissing.add(mid); else val += q * p;
      if (a == null) { if (rate) adjMissing.add(mid); } else t += q * a * rate;
      out.push([mid, q]);
      mats.set(mid, (mats.get(mid) || 0) + q);
    }
    // Input value (processed part only): the market price (market and basis from Settings); the game's estimate
    // from the paste only when the market has no price for the item.
    const used = batches * it.portion;
    let iv = null, ivSrc = null;
    if (price(e.id) != null) { iv = price(e.id) * used; ivSrc = "market"; }
    else if (e.estQty === e.qty && e.est > 0) { iv = e.est * used / e.qty; ivSrc = "est"; }
    if (iv == null && used) inMissing++;
    inVal += iv || 0; outVal += val; tax += t;
    rows.push({ e, y, batches, left, used, out, val, tax: t, iv, ivSrc });
  }
  return { mats, rows, inVal, outVal, tax, net: outVal - tax, inMissing, outMissing, adjMissing };
}

/* ===================================================================== */
export async function mount(el) {
  el.innerHTML = `<div class="panel"><p class="note">Loading game data…</p></div>`;
  let r;
  try { r = await fetch(SDE_URL, { headers: { Accept: "application/json" } }); }
  catch (_) { el.innerHTML = `<div class="panel"><p class="warn">Couldn't reach the server for the game data.</p></div>`; return; }
  const json = await r.json().catch(() => null);
  if (!r.ok || !json || json.error) {
    el.innerHTML = `<div class="panel"><p class="warn">${esc(json?.error || `sde.php isn't available here (HTTP ${r.status}). Open EVE Tools on your PHP server.`)}</p></div>`;
    return;
  }
  D = json;
  D.byName = new Map(Object.entries(D.items).map(([id, it]) => [it.name.toLowerCase(), id]));

  S = Object.assign(defaults(), store.getJSON(KEY, {}));
  el.innerHTML = TEMPLATE;
  $ = id => el.querySelector("#" + id);

  /* ----- structure ----- */
  const structOpts = Object.entries(D.structures).map(([id, s]) => [id, `${s.name} (+${nf2.format(s.bonus).replace(/\.?0+$/, "")}%)`])
    .concat([[OTHER, "Other Upwell structure"], [NPC, "NPC station"]]);
  $("structure").innerHTML = structOpts.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("");
  el.querySelectorAll("[data-rig]").forEach(sel => {
    sel.innerHTML = `<option value="0">None</option><option value="1">T1</option><option value="2">T2</option>`;
  });
  $("implant").innerHTML = `<option value="">None</option>` + Object.entries(D.implants)
    .sort((a, b) => a[1].bonus - b[1].bonus).map(([id, i]) => `<option value="${id}">${esc(i.name)} (+${i.bonus}%)</option>`).join("");

  // Skills in groups, each in game order (ore by tier, moon ore by rarity). Skills the SDE adds later go to "Other".
  // Labels drop "Processing" ("Simple Ore Processing" -> "Simple"); the full name is in the tooltip.
  const GROUPS = [
    ["General", [T_REPRO, T_REPRO_EFF], n => n],
    ["Ore", [60377, 60378, 60379, 60380, 60381, 12189, 90040], n => n.replace(/\s+Ore Processing$/i, "")],
    ["Moon ore", [46152, 46153, 46154, 46155, 46156], n => n.replace(/\s+Moon Ore Processing$/i, "")],
    ["Other", [18025, T_SCRAP, 90398], n => n.replace(/\s+Processing$/i, "")],
  ];
  const placed = new Set(GROUPS.flatMap(g => g[1]));
  GROUPS[3][1] = GROUPS[3][1].concat(Object.keys(D.skills).map(Number).filter(id => !placed.has(id)));
  const levels = [0, 1, 2, 3, 4, 5].map(l => `<option>${l}</option>`).join("");
  $("skills").innerHTML = GROUPS.map(([title, ids, label]) => `<div class="sk-h">${title}</div>` + ids.filter(id => D.skills[id])
    .map(id => `<label class="sk" title="${esc(D.skills[id].name)}"><span>${esc(label(D.skills[id].name))}</span><select data-skill="${id}" aria-label="${esc(D.skills[id].name)}">${levels}</select></label>`).join("")).join("");

  function fill() {
    $("structure").value = S.structure in D.structures || S.structure === NPC || S.structure === OTHER ? S.structure : "35835";
    $("sec").value = S.sec; $("tax").value = S.tax; $("npcTax").value = S.npcTax; $("stationYield").value = S.stationYield;
    el.querySelectorAll("[data-rig]").forEach(s => s.value = S.rigs[s.dataset.rig] || 0);
    el.querySelectorAll("[data-skill]").forEach(s => s.value = lvl(s.dataset.skill));
    $("implant").value = S.implant in D.implants ? S.implant : "";
  }
  fill();

  function renderYields() {
    const npc = S.structure === NPC;
    $("rigRow").hidden = npc; $("npcRow").hidden = !npc;
    const ex = { ore: 60377, moon: 46152, ice: 18025, scrap: T_SCRAP };   // a skill of each class, for its yield
    $("yields").innerHTML = Object.entries(CLASSES).map(([c, t]) => `<span class="yield"><b>${nf2.format(yieldFor(c, ex[c]) * 100)}%</b> ${t}${c === "ore" || c === "moon" ? "*" : ""}</span>`).join("")
      + `<p class="note">* with this character's skill for that ore; each ore uses its own processing skill.</p>`;
  }
  const changed = () => { save(); renderYields(); render(); };
  $("structure").addEventListener("change", e => { S.structure = e.target.value; changed(); });
  $("sec").addEventListener("change", e => { S.sec = e.target.value; changed(); });
  el.querySelectorAll("[data-rig]").forEach(s => s.addEventListener("change", () => { S.rigs[s.dataset.rig] = +s.value; changed(); }));
  for (const k of ["tax", "npcTax", "stationYield"]) $(k).addEventListener("input", e => { S[k] = e.target.value; changed(); });
  el.querySelectorAll("[data-skill]").forEach(s => s.addEventListener("change", () => { S.skills[s.dataset.skill] = +s.value; changed(); }));
  $("implant").addEventListener("change", e => { S.implant = e.target.value; changed(); });
  renderYields();

  /* ----- prices ----- */
  P.want(Object.keys(D.materials).concat(Object.keys(D.items).filter(id => D.items[id].class !== "scrap")));
  P.on(() => render());
  async function syncAdjusted() {     // CCP's adjusted prices, for the tax
    try {
      const r = await fetch(`${PRICES_URL}?adjusted=1&types=${Object.keys(D.materials).join(",")}${adjustedAt ? `&since=${adjustedAt / 1000}` : ""}`,
        { headers: { Accept: "application/json" }, cache: "no-store" });
      const a = await r.json();
      if (a?.data) { adjusted = a.data; adjustedAt = a.fetchedAt * 1000; render(); }
    } catch (_) { /* no adjusted prices: the result says the tax can't be worked out */ }
  }
  syncAdjusted();
  setInterval(syncAdjusted, ADJ_EVERY);
  refill = () => { S = defaults(); fill(); renderYields(); render(); };

  /* ----- items sent from another tool (Ore calculator → Reprocess): replace the paste and calculate ----- */
  function receive() {
    const d = takeFor("reprocessing");
    if (!d || !d.text) return;
    $("paste").value = pasteText = d.text; source = "";
    $("calc").click();
    source = d.from ? `from the Ore calculator's ${d.from}` : ""; render();
    requestAnimationFrame(() => $("results").scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  /* ----- paste ----- */
  $("calc").addEventListener("click", () => {
    pasteText = $("paste").value;
    items = parsePaste(pasteText);
    P.want(items.list.map(e => e.id));     // the server fetches prices it has never had (modules, ships, ...)
    const err = $("pasteErr");
    err.hidden = !!items.list.length;
    err.textContent = items.list.length ? "" : pasteText.trim() ? "Nothing in the paste can be reprocessed." : "Paste items first.";
    if (!items.list.length) items = null;
    render();
  });
  $("clear").addEventListener("click", () => { $("paste").value = ""; pasteText = ""; items = null; $("pasteErr").hidden = true; render(); });
  $("paste").addEventListener("input", e => { pasteText = e.target.value; source = ""; });

  /* ----- results ----- */
  function render() {
    $("results").hidden = !items;
    $("pasteSum").innerHTML = items ? `<b>${nf0.format(items.list.length)}</b> item type${items.list.length === 1 ? "" : "s"}` + (source ? ` <span class="muted">${esc(source)}</span>` : "") : "";
    if (!items) return;
    const c = compute(), diff = c.net - c.inVal;
    const tile = (label, v, small = "", lead = false) => `<div class="tile${lead ? " lead" : ""}"><span>${label}</span><b>${v}</b>${small ? `<small>${small}</small>` : ""}</div>`;
    $("tiles").innerHTML = tile("Items value", isk(c.inVal), "market, processed part")
      + tile("Materials value", isk(c.outVal), esc(`${P.hubName()}, ${P.basisName().toLowerCase()}`))
      + tile("Tax", isk(c.tax), `${nf2.format(taxRate() * 100)}% of adjusted value`)
      + tile(diff >= 0 ? "Reprocessing gains" : "Reprocessing loses", isk(Math.abs(diff)), `materials − tax − items value`, true);

    const w = [];
    if (items.skipped.size) w.push(`Not reprocessable or not recognised: ${[...items.skipped.keys()].slice(0, 12).map(esc).join(", ")}${items.skipped.size > 12 ? ` and ${items.skipped.size - 12} more` : ""}.`);
    if (c.outMissing.size) w.push(`${c.outMissing.size} material${c.outMissing.size > 1 ? "s have" : " has"} no price on this market and count as 0.`);
    if (!P.status().at) w.push(`No market prices loaded yet, so values show as 0.`);
    if (taxRate() && !adjustedAt) w.push(`No adjusted prices from the server yet, so the tax can't be worked out.`);
    else if (c.adjMissing.size) w.push(`${c.adjMissing.size} material${c.adjMissing.size > 1 ? "s have" : " has"} no adjusted price, so the tax is too low.`);
    if (c.inMissing) w.push(`${c.inMissing} item${c.inMissing > 1 ? "s have" : " has"} no market price and no estimated value in the paste; left out of the items value.`);
    if (c.rows.some(r => r.left)) w.push(`Some items don't fill a whole batch; the leftover stays unprocessed (see Left).`);
    $("warns").innerHTML = w.map(t => `<p class="warn">${t}</p>`).join("");

    const mats = [...c.mats.entries()].map(([id, q]) => ({ id, q, p: price(id) })).sort((a, b) => (b.q * (b.p || 0)) - (a.q * (a.p || 0)));
    $("matTable").innerHTML = `<thead><tr><th>Material</th><th>Amount</th><th>Unit price</th><th>Value</th></tr></thead><tbody>`
      + mats.map(m => `<tr><td>${esc(D.materials[m.id]?.name || m.id)}</td><td>${nf0.format(m.q)}</td><td>${m.p == null ? "—" : nf2.format(m.p)}</td><td>${m.p == null ? "—" : isk(m.q * m.p)}</td></tr>`).join("")
      + `<tr class="total"><td>Total</td><td></td><td></td><td>${isk(c.outVal)}</td></tr></tbody>`;

    const rows = c.rows.slice().sort((a, b) => (b.val - b.tax) - (a.val - a.tax));
    $("itemTable").innerHTML = `<thead><tr><th>Item</th><th>Quantity</th><th>Left</th><th>Yield</th><th>Items value</th><th>Materials − tax</th><th></th></tr></thead><tbody>`
      + rows.map(r => {
        const net = r.val - r.tax, better = r.iv == null || !r.used ? "" : net >= r.iv
          ? `<span class="pill ok">reprocess</span>` : `<span class="pill bad">sell</span>`;
        return `<tr data-id="${r.e.id}"><td>${esc(r.e.it.name)} <span class="muted cls">${CLASSES[r.e.it.class]}</span></td><td>${nf0.format(r.e.qty)}</td><td>${r.left ? nf0.format(r.left) : ""}</td>`
          + `<td>${nf2.format(r.y * 100)}%</td><td>${r.iv == null ? "—" : isk(r.iv)}${r.ivSrc === "est" ? ' <span class="mkt" title="No market price: the game\'s estimated price from the paste">est.</span>' : ""}</td>`
          + `<td><span class="val">${isk(net)}</span></td><td>${better}</td></tr>`;
      }).join("") + `</tbody>`;
    $("itemTable").querySelectorAll("tr[data-id] .val").forEach(v => {
      const r = rows.find(x => x.e.id === v.closest("tr").dataset.id);
      v.addEventListener("mouseenter", () => showTip(v, `<b>${esc(r.e.it.name)}</b><br>${nf0.format(r.batches)} batch${r.batches === 1 ? "" : "es"} of ${nf0.format(r.e.it.portion)}<br>`
        + r.out.map(([m, q]) => `${nf0.format(q)} ${esc(D.materials[m]?.name || m)}`).join("<br>") + `<br>Tax ${nf2.format(r.tax)} ISK`));
      v.addEventListener("mouseleave", hideTip);
    });
  }

  // Last, once every handler above is in place: take what another tool sent, now and whenever it sends more.
  receive();
  addEventListener("eve:handoff", e => { if (e.detail === "reprocessing") receive(); });
}

export function reset() { refill?.(); }
export function unsavedNote() { return pasteText.trim() ? "pasted items" : null; }
