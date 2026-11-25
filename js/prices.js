// Market prices shared by every module: one market and price basis for the whole app (chosen in Settings),
// one copy of the prices, one status (shown in the header and in Settings).
// Prices come only from prices.php on the same server, which serves what the server's price job saved
// (cron/prices.php: Fuzzwork data, fetched when Fuzzwork publishes, about every 30 minutes).
// Modules call want(ids) with the items they need, read price(id), and listen with on(fn).
import { store } from "./shared.js";

const KEY = "eveTools.prices.v1";
const OLD_ORE_KEY = "oreProfitCalc.v1";             // the Ore module kept market, basis and prices before
const PRICES_URL = new URL("../prices.php", import.meta.url);
const MARKETS_URL = new URL("../data/markets.json", import.meta.url);
const SYNC_EVERY = 2 * 60 * 1000;                   // ask for anything newer this often (the price job runs this often too)
const JOB_LATE = 15 * 60 * 1000;                    // the price job hasn't run for this long: prices may be out of date
const RETRY_MIN = [1, 2, 5];                        // minutes to wait after the 1st, 2nd, 3rd+ failure in a row
export const BASES = {
  sellPct: "Sell, 5th percentile", sellMin: "Sell, lowest", buyMax: "Buy, highest",
  buyPct: "Buy, 5th percentile", split: "Split (buy/sell mid)",
};

/* ---------- saved state: {hub, basis, cache: {hub, at, ids, data}} ---------- */
function load() {
  const s = store.getJSON(KEY, null);
  if (s) return s;
  const ore = store.getJSON(OLD_ORE_KEY, {}) || {};                 // first run: take over the Ore module's choices
  const p = ore.prices && ore.prices.source === "fuzzwork" ? ore.prices : null;
  return { hub: ore.hub || "station:60003760", basis: ore.basis in BASES ? ore.basis : "sellPct",
    cache: p ? { hub: p.hub, at: p.at, ids: Object.keys(p.data || {}), data: p.data || {} } : null };
}
const S = load();
const save = () => store.setJSON(KEY, S);
save();                                             // keep what was taken over from the Ore module's old settings

let markets = { "station:60003760": "Jita IV-4" };
const wanted = new Set(), listeners = new Set();
let jobAt = null, error = "", noServer = false, syncing = false, pending = false, lastSync = 0, retryStep = 0, retryTimer = null;

export const ready = fetch(MARKETS_URL).then(r => r.ok ? r.json() : null).then(m => { if (m) markets = m; }).catch(() => {});

function emit() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
/** Call fn whenever prices, market, basis or status change. Returns a function that stops it. */
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export const getMarkets = () => markets;
/** Some open tool uses prices (the header shows the status only then). */
export const active = () => wanted.size > 0;
export const hub = () => S.hub;
export const basis = () => S.basis;
export const hubName = (v = S.hub) => markets[v] || v;
export const basisName = () => BASES[S.basis];
export function setHub(v) { if (v === S.hub || !(v in markets)) return; S.hub = v; save(); emit(); sync(); }
export function setBasis(v) { if (v === S.basis || !(v in BASES)) return; S.basis = v; save(); emit(); }

/** Prices of the current market are loaded (possibly from an earlier visit). */
const current = () => S.cache && S.cache.hub === S.hub ? S.cache : null;

/** Unit price of an item on the current market and basis, or null (no orders / not loaded). */
export function price(id) {
  const c = current(), d = c && c.data[id]; if (!d) return null;
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
  return (v == null || isNaN(v) || v <= 0) ? null : v;
}

/**
 * Where prices stand, for status lines:
 * state "ok" | "old" (job late or prices > 6 h old) | "loading" | "err" | "none" (no prices and not loading)
 */
export function status() {
  const c = current();
  return { state: noServer ? "err" : c ? (jobAt != null && Date.now() - jobAt > JOB_LATE) || Date.now() - c.at > 6 * 36e5 ? "old" : "ok" : error ? "err" : "loading",
    hub: S.hub, at: c ? c.at : null, items: c ? Object.keys(c.data).length : 0, jobAt,
    jobLate: jobAt != null && Date.now() - jobAt > JOB_LATE, error, noServer };
}

/** The items a module needs prices for. Loads them if they aren't in the saved copy yet. */
export function want(ids) {
  let added = false;
  for (const id of ids) { const k = String(id); if (!wanted.has(k)) { wanted.add(k); added = true; } }
  if (added) { if (!lastSync) setTimeout(sync, 0); else sync(); }
}

async function request(since) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 20000);
  const url = `${PRICES_URL}?market=${encodeURIComponent(S.hub)}&types=${[...wanted].join(",")}${since ? `&since=${since}` : ""}`;
  let r;
  try { r = await fetch(url, { signal: ctl.signal, headers: { Accept: "application/json" }, cache: "no-store" }); }
  finally { clearTimeout(to); }
  let json;
  try { json = await r.json(); }
  catch (_) {
    const e = new Error(r.status === 404 ? "prices.php wasn't found on this server." : `The server answered with HTTP ${r.status} instead of price data. Check that PHP is enabled for prices.php.`);
    e.noServer = true; throw e;
  }
  if (!r.ok || json.error) throw new Error(json.error || `The server answered with HTTP ${r.status}.`);
  return json;
}
const errText = e => e.name === "AbortError" ? "The server didn't answer within 20 seconds."
  : e instanceof TypeError ? "Couldn't reach your server. Check your connection." : e.message;

/** Ask prices.php for anything newer (all of it when the market changed or new items are wanted). */
export async function sync() {
  if (noServer || !wanted.size) return;
  if (syncing) { pending = true; return; }
  syncing = true; pending = false; lastSync = Date.now();
  clearTimeout(retryTimer); retryTimer = null;
  const hubAsked = S.hub;
  try {
    const c = current(), complete = c && [...wanted].every(id => c.ids.includes(id));
    const json = await request(complete ? Math.floor(c.at / 1000) : 0);
    if (hubAsked === S.hub) {
      jobAt = json.jobAt ? json.jobAt * 1000 : null;
      if (json.data) { S.cache = { hub: S.hub, at: json.fetchedAt * 1000, ids: [...wanted], data: json.data }; save(); }
    }
    error = ""; retryStep = 0;
  } catch (e) {
    if (e.noServer) { noServer = true; error = "prices.php isn't available here. EVE Tools loads prices only through prices.php, so open it on your PHP server."; }
    else {
      const wait = RETRY_MIN[Math.min(retryStep, RETRY_MIN.length - 1)]; retryStep++;
      error = `${errText(e)} Trying again in ${wait} minute${wait > 1 ? "s" : ""}.`;
      retryTimer = setTimeout(sync, wait * 60 * 1000);
    }
  } finally {
    syncing = false; emit();
    if (pending) sync();
  }
}
/** "Try again" after an error. */
export function retry() { noServer = false; retryStep = 0; error = ""; emit(); sync(); }

setInterval(sync, SYNC_EVERY);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - lastSync > 60 * 1000) sync(); });
