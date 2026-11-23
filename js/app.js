// App shell: module registry, menu, hash routing, lazy module loading, settings drawer.
import { hideTip, store } from "./shared.js";

/* ---------- module registry ----------
   To add a tool: create js/modules/<name>.js exporting mount(el) and optionally reset(),
   then add one entry here. `keys` are the browser-storage keys the module uses (for Settings → reset). */
const MODULES = [
  { id: "ore-prices", label: "Ore prices", file: "./modules/ore.js",
    resetLabel: "Reset ore calculator", keys: ["oreProfitCalc.v1"] },
  { id: "incursions", label: "Incursions", file: "./modules/incursions.js",
    resetLabel: "Clear pasted incursion wallet", keys: ["eveTools.incursions.v2"] },
  { id: "reprocessing", label: "Reprocessing", soon: true },
];
const LIVE = MODULES.filter(m => !m.soon);

/* ---------- settings state ---------- */
const APP_KEY = "eveTools.app.v1";
const APP = Object.assign({ theme: "auto", start: LIVE[0].id }, store.getJSON(APP_KEY, {}));
const saveApp = () => store.setJSON(APP_KEY, APP);

function applyTheme() {
  if (APP.theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = APP.theme;
  document.querySelectorAll("#setTheme button").forEach(b => b.setAttribute("aria-pressed", b.dataset.theme === APP.theme));
}

/* ---------- menu + view containers ---------- */
const menu = document.getElementById("menuItems");
const views = document.getElementById("views");
menu.innerHTML = MODULES.map(m => m.soon
  ? `<a class="soon" aria-disabled="true">${m.label}<span class="tag">soon</span></a>`
  : `<a href="#${m.id}" data-view="${m.id}">${m.label}</a>`).join("");

/* ---------- lazy loading ---------- */
const loaded = new Map(); // id -> Promise<module>
function load(m) {
  if (loaded.has(m.id)) return loaded.get(m.id);
  const el = document.createElement("div");
  el.className = "inner wrap";
  el.dataset.viewPanel = m.id;
  el.innerHTML = `<p class="sub">Loading ${m.label}…</p>`;
  views.appendChild(el);
  const p = import(m.file)
    .then(async mod => { await mod.mount(el); return mod; })
    .catch(err => {
      console.error(err);
      el.innerHTML = `<p class="msg err">Couldn't load ${m.label}. Reload the page to try again.</p>`;
      loaded.delete(m.id);
      throw err;
    });
  loaded.set(m.id, p);
  return p;
}

function route() {
  const h = location.hash.slice(1);
  const m = LIVE.find(x => x.id === h) || LIVE.find(x => x.id === APP.start) || LIVE[0];
  load(m).catch(() => {});
  views.querySelectorAll("[data-view-panel]").forEach(p => p.hidden = p.dataset.viewPanel !== m.id);
  menu.querySelectorAll("a[data-view]").forEach(a => a.dataset.view === m.id ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  hideTip();
}
addEventListener("hashchange", route);

/* ---------- settings drawer ---------- */
const drawer = document.getElementById("settings"), scrim = document.getElementById("scrim"), opener = document.getElementById("openSettings");
const resetMsg = document.getElementById("resetMsg");
function openSettings() { drawer.hidden = false; scrim.hidden = false; document.getElementById("closeSettings").focus(); }
function closeSettings() { drawer.hidden = true; scrim.hidden = true; resetMsg.textContent = ""; opener.focus(); }
opener.addEventListener("click", openSettings);
document.getElementById("closeSettings").addEventListener("click", closeSettings);
scrim.addEventListener("click", closeSettings);
addEventListener("keydown", e => { if (e.key === "Escape" && !drawer.hidden) closeSettings(); });

document.querySelectorAll("#setTheme button").forEach(b => b.addEventListener("click", () => { APP.theme = b.dataset.theme; saveApp(); applyTheme(); }));

const startEl = document.getElementById("setStart");
startEl.innerHTML = LIVE.map(m => `<option value="${m.id}">${m.label}</option>`).join("");
startEl.value = APP.start;
startEl.addEventListener("change", () => { APP.start = startEl.value; saveApp(); });

const resets = document.getElementById("resetButtons");
resets.innerHTML = LIVE.filter(m => m.resetLabel).map(m => `<button class="btn danger" type="button" data-reset="${m.id}">${m.resetLabel}</button>`).join("");
resets.addEventListener("click", async e => {
  const b = e.target.closest("[data-reset]"); if (!b) return;
  const m = LIVE.find(x => x.id === b.dataset.reset);
  m.keys.forEach(k => store.remove(k));
  if (loaded.has(m.id)) { try { (await loaded.get(m.id)).reset?.(); } catch (_) {} }
  resetMsg.className = "msg ok"; resetMsg.textContent = `${m.label}: done.`;
});

applyTheme();
route();
