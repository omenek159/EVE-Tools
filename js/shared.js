// Shared helpers used by every module: number formatting, escaping, tooltip, browser storage.

export const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
export const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Compact ISK: 1.23B, 4.5M, 12.3k */
export function isk(v) {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(1) + "k";
  return nf2.format(v);
}
export const fullIsk = v => v == null ? "no orders" : nf2.format(v) + " ISK";
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- tooltip (one shared element) ---------- */
const tip = document.getElementById("tip");
export function hideTip() { tip.hidden = true; }
export function showTip(anchor, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = anchor.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = r.right + 8, y = r.top;
  if (x + tw > innerWidth - 8) x = r.left - tw - 8;
  if (x < 8) { x = Math.max(8, Math.min(innerWidth - tw - 8, r.left)); y = r.bottom + 6; if (y + th > innerHeight - 8) y = r.top - th - 6; }
  y = Math.max(8, Math.min(y, innerHeight - th - 8));
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
addEventListener("scroll", hideTip, { passive: true });

/* ---------- storage (this browser only; may be unavailable) ---------- */
export const store = {
  getJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch (e) { return fallback; } },
  setJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} },
  get(key, fallback = "") { try { return localStorage.getItem(key) ?? fallback; } catch (e) { return fallback; } },
  set(key, val) { try { localStorage.setItem(key, val); } catch (e) {} },
  remove(key) { try { localStorage.removeItem(key); } catch (e) {} },
};
