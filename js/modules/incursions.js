// Incursion ISK/h Calculator module — ISK/h from the in-game wallet journal.
// Logic rewritten from tla-waitlist frontend/src/Pages/ISKh.js (MIT, github.com/luna-duclos/tla-waitlist).
import { isk, esc, store } from "../shared.js";

const KEY = "eveTools.incursions.v2";

// [siteType, base ISK payout, base LP, normal grid size]
const SITES = [
  ["Mothership (HS)",    63000000, 14000,  80],
  ["Mothership (LS/NS)", 90000000, 20000, 120],
  ["HQ (HS)",            31500000,  7000,  40],
  ["HQ (LS/NS)",         45000000, 10000,  60],
  ["AS (HS)",            18200000,  3500,  20],
  ["AS (LS/NS)",         26000000,  5000,  30],
  ["VG (HS)",            10395000,  1400,  10],
  ["VG (LS/NS)",         15000000,  2000,  15],
];

// Payout reduction when the site is overgridded (more pilots than normal)
const payoutFactor = og => 1 - 0.0725 * og - 0.0025 * og ** 2;

// Lookup: exact (reduced) ISK payout -> site info
const PAYOUTS = (() => {
  const res = {};
  for (const [siteType, payout, lp, normalGrid] of SITES) {
    for (let og = 0; og < 11; og++) {
      const f = payoutFactor(og), p = Math.round(payout * f);
      res[p] = { siteType, payout: p, lp: Math.round(lp * f), onGrid: og > 0 ? normalGrid + og : null, normalGrid };
    }
  }
  return res;
})();

export function parseWallet(text) {
  const entries = [];
  for (const line of text.split("\n")) {
    const [datetime, origin, value, , description] = line.trim().split(/\t|\s{2,}/);
    if (!origin || !description || !value) continue;
    if (!/ISK/.test(value)) continue;
    if (!/reward payout/i.test(origin) || !/concord/i.test(description)) continue;
    const amount = Math.round(parseFloat(value.replace(/[.,]\d{2} /, " ").replace(/\D/g, "")));
    let [date, time] = datetime.split(" ");
    if (time && time.split(":").length === 2) time += ":00"; // wallet sometimes omits seconds
    const ts = Date.parse(date.replace(/\./g, "-") + "T" + time + "Z") / 1000;
    if (!Number.isFinite(ts) || !Number.isFinite(amount)) continue;
    entries.push({ time: ts, value: amount });
  }
  entries.sort((a, b) => a.time - b.time || a.value - b.value);

  const r = { isk: 0, lp: 0, sites: 0, chars: 1, raw: [] };
  const siteTimes = [];
  let prev = null, chars = 0;
  for (const e of entries) {
    if (e.time !== prev) { r.sites++; chars = 1; if (prev !== null) siteTimes.push(e.time - prev); prev = e.time; }
    else { chars++; r.chars = Math.max(r.chars, chars); } // same timestamp = an alt paid for the same site
    const s = PAYOUTS[e.value];
    r.isk += e.value; r.lp += s ? s.lp : 0;
    r.raw.push({ time: e.time, isk: e.value, lp: s ? s.lp : null, onGrid: s ? s.onGrid : null, siteType: s ? s.siteType : null, normalGrid: s ? s.normalGrid : null });
  }
  if (!siteTimes.length) return null;
  r.minTime = Math.min(...siteTimes); r.maxTime = Math.max(...siteTimes);
  r.startTime = r.raw[0].time; r.endTime = r.raw[r.raw.length - 1].time;
  r.firstSitePayout = r.raw[0].isk;
  r.duration = r.endTime - r.startTime;
  return r;
}
export const summarize = d => ({
  ...d,
  iskPerHour: Math.round((d.isk - d.firstSitePayout) / (d.duration / 3600)),
  avgSiteTime: Math.round(d.duration / (d.sites - 1)),
});

function fmtDur(sec) {
  const g = [], h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) g.push(h + "h"); if (m > 0) g.push(m + "min"); if (s > 0) g.push(s + "s");
  return g.length ? g.slice(0, 2).join(" ") : "–";
}
const fmtET = sec => new Date(sec * 1000).toLocaleString("en-GB", { timeZone: "UTC" }) + " ET";
const fmtN = n => n == null ? "–" : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

function tlaText(s) {
  const L = [`${fmtN(s.iskPerHour)} ISK/h`, `${fmtN(s.isk)} ISK + ${fmtN(s.lp)} LP`, `${fmtN(s.sites)} sites completed`];
  if (s.chars > 1) L.push(`${fmtN(s.chars)} characters included in payout calculation`);
  L.push(`${fmtDur(s.minTime)} ~ ${fmtDur(s.maxTime)} (average ${fmtDur(s.avgSiteTime)})`);
  L.push(`${new Date(s.startTime * 1000).toLocaleString("en-GB", { timeZone: "UTC" })} ++ ${fmtDur(s.duration)}`);
  return L.join("\n");
}

const TEMPLATE = `
  <div class="head">
    <h1>Incursion ISK/h Calculator</h1>
    <span class="sub">From your wallet journal. Based on the TLA Incursion calculator (<a href="https://github.com/luna-duclos/tla-waitlist" style="color:var(--accent)">source, MIT</a>)</span>
  </div>
  <div class="layout">
    <aside class="side">
      <section class="panel" aria-labelledby="h-wallet">
        <h2 id="h-wallet">Paste wallet</h2>
        <span class="sub">In game, open your wallet journal, select the incursion payouts, press Ctrl+C and paste here. English client only.</span>
        <label class="fld">Wallet journal lines
          <textarea id="wallet" spellcheck="false" class="wallet-box"></textarea>
        </label>
        <div class="toolbar">
          <button class="btn" id="btnClear" type="button">Clear</button>
          <span class="msg" id="parseStatus" role="status"></span>
        </div>
      </section>
      <section class="panel" aria-labelledby="h-ref">
        <h2 id="h-ref">Site base payouts</h2>
        <div class="tablewrap"><table id="incRef" class="compact"></table></div>
      </section>
    </aside>
    <div class="mainc">
      <section class="panel result" id="incResult" aria-live="polite"></section>
      <main class="panel" aria-labelledby="h-payouts">
        <h2 id="h-payouts">Payouts</h2>
        <div class="tablewrap logbox" id="incLog"></div>
      </main>
    </div>
  </div>
  <footer class="note">
    ISK/h = (total ISK − first site's payout) ÷ time from first to last payout, since the first payout marks the start of the clock.
    Payouts with the same timestamp count as alts paid for the same site. Site type, LP and pilots on grid are matched from the exact ISK amount,
    using a reduction of 1 − 0.0725·n − 0.0025·n² for n pilots over the normal grid. CONCORD LP is only paid if the mothership dies.
  </footer>`;

let $, update;

export function mount(el) {
  el.innerHTML = TEMPLATE;
  $ = id => el.querySelector("#" + id);
  const wallet = $("wallet");

  function renderResult(d) {
    const box = $("incResult");
    if (!d) {
      box.innerHTML = `<h2>Result</h2><p class="sub" style="margin:0">Paste at least two sites' worth of payouts (two different timestamps) to get a result.</p>`;
      return;
    }
    const s = summarize(d);
    box.innerHTML = `
      <h2>Result</h2>
      <div class="big num">${fmtN(s.iskPerHour)}<small>ISK/h</small></div>
      <div class="num" style="font-size:15px">${fmtN(s.isk)} ISK + <span class="lp">${fmtN(s.lp)} LP</span></div>
      <dl class="kv">
        <div><dt>Sites completed</dt><dd>${fmtN(s.sites)}</dd></div>
        <div><dt>Characters paid</dt><dd>${fmtN(s.chars)}</dd></div>
        <div><dt>Average site</dt><dd>${fmtDur(s.avgSiteTime)}</dd></div>
        <div><dt>Fastest ~ slowest</dt><dd>${fmtDur(s.minTime)} ~ ${fmtDur(s.maxTime)}</dd></div>
        <div><dt>First payout</dt><dd>${fmtET(s.startTime)}</dd></div>
        <div><dt>Total time</dt><dd>${fmtDur(s.duration)}</dd></div>
        <div><dt>First site (excluded)</dt><dd>${fmtN(s.firstSitePayout)}</dd></div>
        <div><dt>ISK per site</dt><dd>${fmtN(Math.round(s.isk / s.sites))}</dd></div>
      </dl>
      <div class="toolbar"><button class="btn btn-primary" id="btnCopyTla" type="button">Copy results (TLA format)</button><span class="msg" id="copyStatus" role="status"></span></div>`;
    $("btnCopyTla").addEventListener("click", async () => {
      const st = $("copyStatus");
      try { await navigator.clipboard.writeText(tlaText(s)); st.className = "msg ok"; st.textContent = "Copied"; }
      catch (e) { st.className = "msg err"; st.textContent = "Copy blocked by the browser"; }
    });
  }

  function renderLog(d) {
    const box = $("incLog");
    if (!d) { box.innerHTML = `<p class="sub" style="margin:0">No incursion payouts found yet.</p>`; return; }
    let prev = null, rows = "";
    for (const r of d.raw) {
      const alt = r.time === prev; prev = r.time;
      const site = r.siteType ? esc(r.siteType) : `<span class="pill bad">Unknown amount</span>`;
      const grid = r.onGrid !== null ? `${r.onGrid} <span class="pill warn">+${r.onGrid - r.normalGrid} over</span>`
                 : r.normalGrid ? `≤ ${r.normalGrid} <span class="pill ok">Optimal</span>` : "–";
      rows += `<tr class="${alt ? "alt" : ""}"><td class="n" style="text-align:left">${alt ? "↳ alt" : fmtET(r.time)}</td><td class="name">${site}</td>
        <td class="n">${fmtN(r.isk)}</td><td class="n">${fmtN(r.lp)}</td><td class="n">${grid}</td></tr>`;
    }
    box.innerHTML = `<table><thead><tr class="colh"><th>Time (EVE)</th><th style="text-align:left">Site</th><th>ISK</th><th>LP</th><th>On grid</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  let rows = `<tr class="colh"><th>Site</th><th>Base ISK</th><th>LP</th><th>Grid</th></tr>`;
  for (const [n, i, lp, g] of SITES) rows += `<tr><td class="name">${n}</td><td class="n">${isk(i)}</td><td class="n">${fmtN(lp)}</td><td class="n">${g}</td></tr>`;
  $("incRef").innerHTML = rows;

  update = () => {
    const d = parseWallet(wallet.value), n = d ? d.raw.length : 0, st = $("parseStatus");
    st.className = "msg";
    st.textContent = d ? `${n} payout line${n === 1 ? "" : "s"} found` : (wallet.value.trim() ? "No usable payouts yet" : "");
    renderResult(d); renderLog(d);
  };
  wallet.addEventListener("input", () => { store.set(KEY, wallet.value); update(); });
  $("btnClear").addEventListener("click", () => { wallet.value = ""; store.remove(KEY); update(); wallet.focus(); });

  wallet.value = store.get(KEY, "");
  update();
}

export function reset() {
  if (!$) return;
  $("wallet").value = "";
  update();
}
