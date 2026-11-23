// Ore Profit Calculator module.
import { r2, nf2, nf0, isk, fullIsk, esc, showTip, hideTip, store } from "../shared.js";

const KEY = "oreProfitCalc.v1";
const DATA_URL = new URL("../../data/ores.json", import.meta.url);
const SECTIONS = [
  { title: "Moon ores", from: 29, to: 33, cols: ["Base", "Brimful", "Glistening", ""] },
  { title: "Ores", from: 0, to: 29, cols: ["Base", "II-Grade", "III-Grade", "IV-Grade"] },
];
const GAS = { from: 33, to: 50 };

const TEMPLATE = `
  <div class="head">
    <h1>Ore Profit Calculator</h1>
    <span class="sub">Income per hour for your fleet's yield, priced from Fuzzwork market data</span>
  </div>
  <div class="layout">
    <aside class="side">
      <section class="panel" aria-labelledby="h-prices">
        <h2 id="h-prices">Market prices</h2>
        <div class="row2">
          <label class="fld">Market
            <select id="hub">
              <option value="region:10000002">The Forge (region)</option>
              <option value="station:60003760">Jita IV-4</option>
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
        <button class="btn btn-primary" id="pull" type="button">Pull prices</button>
        <div class="status"><span class="dot" id="statusDot"></span><span id="statusText"></span></div>
        <div class="paste" id="pastePanel" hidden>
          <span>This page can't reach Fuzzwork on its own. Fetch the prices in a new tab:</span>
          <ol>
            <li><a id="fwLink" href="#" target="_blank" rel="noopener">Open Fuzzwork prices</a> <button class="btn" id="copyUrl" type="button" style="padding:2px 8px;font-size:12px">Copy link</button></li>
            <li>Select all and copy the page (Ctrl+A, Ctrl+C). In Firefox, switch to "Raw Data" first.</li>
            <li>Paste it below.</li>
          </ol>
          <textarea id="pasteBox" placeholder='{"1230":{"buy":{...},"sell":{...}}, ...}' aria-label="Paste Fuzzwork JSON"></textarea>
          <div class="msg" id="pasteMsg" role="status"></div>
        </div>
      </section>
      <section class="panel" aria-labelledby="h-fleet">
        <div class="head"><h2 id="h-fleet">Fleet</h2><button class="btn" id="addMiner" type="button">+ Add miner</button></div>
        <div class="fleet">
          <div class="stat"><b id="fleetM3s">0</b><span>Ore yield m³/s</span></div>
          <div class="stat"><b id="fleetM3h">0</b><span>Ore m³ per hour</span></div>
        </div>
        <div id="miners" style="display:flex;flex-direction:column;gap:8px"></div>
        <label class="fld">Gas huffers, total yield (m³/s)
          <input type="number" id="huff" step="0.1" min="0">
        </label>
      </section>
    </aside>
    <main class="panel" aria-labelledby="h-ores" style="min-width:0">
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
    </main>
  </div>
  <footer class="note">
    Income = fleet yield (m³/s) × 3600 × ISK per m³. ISK per m³ = unit price ÷ raw ore volume, rounded to 0.01, so compressed and raw compare on the same mined m³.
    Miner yield = module yield × (1 + crit chance × crit bonus) + drone yield. Gas uses the huffer yield.
  </footer>`;

let DATA, S, $, init;

function defaults() {
  return {
    miners: DATA.miners.slice(0, 1).map((m, i) => ({ name: "Miner " + (i + 1), mod: m[0], crit: +(m[1] * 100).toFixed(4), mul: m[2], drone: m[3], on: true })),
    huff: DATA.huff, hub: "region:10000002", basis: "sellPct", unit: "h",
    prices: { source: "sheet", at: null, hub: "region:10000002", data: snapshot() },
  };
}
function snapshot() { const o = {}; for (const [id, v] of Object.entries(DATA.snap)) o[id] = { sell: { percentile: v } }; return o; }
const save = () => store.setJSON(KEY, S);

const minerYield = m => r2((+m.mod || 0) * (1 + (+m.crit || 0) / 100 * (+m.mul || 0)) + (+m.drone || 0));
const fleetYield = () => r2(S.miners.filter(m => m.on).reduce((a, m) => a + minerYield(m), 0));
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

export async function mount(el) {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error("ores.json " + res.status);
  DATA = await res.json();
  el.innerHTML = TEMPLATE;
  $ = id => el.querySelector("#" + id);
  S = Object.assign(defaults(), store.getJSON(KEY, {}));

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
          <label class="fld">Module m³/s<input type="number" id="mod-${i}" data-k="mod" step="0.1" min="0" value="${m.mod}"></label>
          <label class="fld">Crit chance %<input type="number" data-k="crit" step="0.01" min="0" value="${m.crit}"></label>
          <label class="fld">Crit bonus ×<input type="number" data-k="mul" step="0.1" min="0" value="${m.mul}"></label>
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
    S.miners.push({ name: "Miner " + (S.miners.length + 1), mod: 0, crit: 0, mul: 2.3, drone: 0, on: true });
    save(); renderMiners(); renderTables();
    $("mod-" + (S.miners.length - 1))?.focus();
  });
  $("huff").addEventListener("input", e => { S.huff = +e.target.value || 0; save(); renderTables(); });

  /* ---------- tables ---------- */
  const CELLS = new Map();
  function renderTables() {
    const fy = fleetYield(), unit = S.unit, q = ($("filter").value || "").trim().toLowerCase();
    const val = c => unit === "h" ? c.cH : c.cM3;
    const fmt = v => unit === "h" ? isk(v) : (v == null ? "—" : nf2.format(v));
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
          html += `<td class="cellwrap"><button type="button" class="${cls}" style="--h:${h}" data-key="${key}" aria-label="${esc(c.name)}">${v == null || v <= 0 ? "no orders" : fmt(v)}</button></td>`;
        }
        html += `</tr>`;
      }
    }
    $("ores").innerHTML = html;

    const gy = +S.huff || 0;
    const gas = DATA.fam.slice(GAS.from, GAS.to).map(f => calc(f[0], gy));
    const gmax = Math.max(...gas.map(c => unit === "h" ? c.rH : c.rM3).filter(v => v != null), 1);
    let gh = `<tr class="colh"><th>Gas cloud</th><th>Unit price</th><th>ISK / m³</th><th>ISK / hour</th></tr>`;
    for (const c of gas) {
      const hide = q && !c.name.toLowerCase().includes(q);
      const v = unit === "h" ? c.rH : c.rM3;
      const h = v == null || v <= 0 ? 0 : (0.04 + 0.5 * (v / gmax)).toFixed(3);
      gh += `<tr class="${hide ? "hidden" : ""}"><td class="name">${esc(c.name)}</td>
        <td class="n">${c.rp == null ? "—" : nf2.format(c.rp)}</td>
        <td class="n">${c.rM3 == null ? "—" : nf2.format(c.rM3)}</td>
        <td class="cellwrap"><span class="cell ${v == null || v <= 0 ? "none" : ""}" style="--h:${h}">${c.rH == null || c.rH <= 0 ? "no orders" : isk(c.rH)}</span></td></tr>`;
    }
    $("gas").innerHTML = gh;
  }
  $("filter").addEventListener("input", renderTables);
  const unitBtns = el.querySelectorAll("#oreUnit button");
  const syncUnit = () => unitBtns.forEach(x => x.setAttribute("aria-pressed", x.dataset.unit === S.unit));
  unitBtns.forEach(b => b.addEventListener("click", () => { S.unit = b.dataset.unit; save(); syncUnit(); renderTables(); }));

  /* ---------- tooltip ---------- */
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
  hubEl.addEventListener("change", () => { S.hub = hubEl.value; save(); updateLink(); renderStatus(); });
  const allIds = () => { const s = new Set(); DATA.fam.flat().forEach(it => { s.add(it[1]); if (it[3]) s.add(it[3]); }); return [...s]; };
  const fwUrl = () => { const [k, id] = S.hub.split(":"); return `https://market.fuzzwork.co.uk/aggregates/?${k}=${id}&types=${allIds().join(",")}`; };
  const updateLink = () => { $("fwLink").href = fwUrl(); };
  function renderStatus() {
    const dot = $("statusDot"), t = $("statusText"), p = S.prices;
    if (p.source === "sheet") {
      dot.className = "dot old";
      t.innerHTML = `Showing cached snapshot prices (The Forge, sell 5th percentile).${S.basis !== "sellPct" ? " Pull prices to use this basis." : ""}`;
    } else {
      const age = (Date.now() - p.at) / 36e5;
      dot.className = "dot " + (age > 6 ? "old" : "ok");
      const when = new Date(p.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      t.innerHTML = `Fuzzwork, ${esc(HUBNAME(p.hub))}, ${Object.keys(p.data).length} items. Pulled ${esc(when)}.${p.hub !== S.hub ? " <b>Market changed: pull again.</b>" : ""}`;
    }
  }
  function acceptPrices(json) {
    const keys = Object.keys(json || {});
    if (!keys.length || !keys.every(k => /^\d+$/.test(k)) || !json[keys[0]].sell) throw new Error("shape");
    S.prices = { source: "fuzzwork", at: Date.now(), hub: S.hub, data: json };
    save(); renderStatus(); renderTables();
  }
  const pastePanel = $("pastePanel"), pasteMsg = $("pasteMsg"), pasteBox = $("pasteBox");
  $("pull").addEventListener("click", async () => {
    const btn = $("pull"); btn.disabled = true; btn.textContent = "Pulling…";
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(fwUrl(), { signal: ctl.signal }); clearTimeout(to);
      if (!r.ok) throw new Error("http " + r.status);
      acceptPrices(await r.json());
      pastePanel.hidden = true;
    } catch (e) {
      pastePanel.hidden = false; pasteMsg.textContent = ""; pasteMsg.className = "msg";
      pasteBox.focus();
    } finally { btn.disabled = false; btn.textContent = "Pull prices"; }
  });
  pasteBox.addEventListener("input", () => {
    const t = pasteBox.value.trim(); if (!t) { pasteMsg.textContent = ""; return; }
    try {
      acceptPrices(JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)));
      pasteMsg.className = "msg ok"; pasteMsg.textContent = `Prices updated from ${HUBNAME(S.hub)}.`;
      pasteBox.value = "";
    } catch (e) {
      pasteMsg.className = "msg err"; pasteMsg.textContent = "That isn't the Fuzzwork price data. Copy the whole page from the Fuzzwork tab and paste it again.";
    }
  });
  $("copyUrl").addEventListener("click", async e => {
    try { await navigator.clipboard.writeText(fwUrl()); e.target.textContent = "Copied"; }
    catch (_) { e.target.textContent = "Copy failed"; }
    setTimeout(() => e.target.textContent = "Copy link", 1500);
  });

  init = () => {
    $("huff").value = S.huff; hubEl.value = S.hub; basisEl.value = S.basis;
    syncUnit(); updateLink(); renderMiners(); renderStatus(); renderTables();
  };
  init();
}

export function reset() {
  S = defaults(); save(); init?.();
}
