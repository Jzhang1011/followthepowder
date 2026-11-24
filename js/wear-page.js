// Standalone What to Wear page (/what-to-wear/): the full outfit guide for one resort.
// Reuses the dashboard's own logic — Open-Meteo fetch via core.js (openMeteoUrl /
// splitOpenMeteo / dailyRows), the recommendation rules in core.js outfitFor, and the
// shared card renderer in js/wear.js. No duplicated weather or recommendation code.
import './site.js';
import { lang, units, t } from './site.js?v=6fbac9d207';
import { openMeteoUrl, splitOpenMeteo, dailyRows, fmt } from './core.js?v=6fbac9d207';
import { wearCard, bindWearExpand } from './wear.js?v=6fbac9d207';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem('ski.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('ski.' + k, JSON.stringify(v)); } catch {} }
};
const dayLabel = (date, opts = { weekday: 'short', month: 'numeric', day: 'numeric' }) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(lang() === 'zh' ? 'zh-CN' : 'en-US', { timeZone: 'UTC', ...opts }).format(new Date(Date.UTC(y, m - 1, d, 12)));
};

let cat = null, byId = new Map(), wxUrl = 'https://api.open-meteo.com/v1/forecast';
let resort = null, days = null;

function resolveResort(v) {
  if (!v || !cat) return null;
  if (byId.has(v)) return byId.get(v);
  const n = String(v).toLowerCase().trim();
  return cat.resorts.find(r => r.name.toLowerCase() === n || r.aliases.some(a => a.toLowerCase() === n)) || null;
}

function render() {
  const el = $('#wp-guide');
  if (!resort) return;
  const u = units();
  const inp = $('#wp-input'); if (inp) inp.placeholder = t('wp_pick_ph');
  $('#wp-name').textContent = resort.name;
  $('#wp-meta').textContent = `${resort.city}, ${resort.state} · ${fmt.elevRange(resort.baseElevM, resort.summitElevM, u)}`;
  $('#wp-dash').href = `/?resort=${encodeURIComponent(resort.id)}`;
  if (!days) { el.innerHTML = `<p class="muted">${esc(t('wp_loading'))}</p>`; return; }
  el.innerHTML = `<div class="scroll"><div class="wtrack">${days.slice(0, 7).map((d, i) => wearCard(d, i, { t, fmt, u, dayLabel })).join('')}</div></div>`;
}

async function loadForecast(r) {
  resort = r; days = null; render();
  try {
    const cfg = { resorts: [r], sources: { weather: wxUrl }, trip: { timezone: r.tz || 'America/Denver' } };
    const res = await fetch(openMeteoUrl(cfg));
    if (!res.ok) throw new Error('forecast ' + res.status);
    const wx = splitOpenMeteo(cfg, await res.json())[r.id];
    days = wx ? dailyRows(wx, r) : null;
    if (!days) throw new Error('no forecast rows');
  } catch (e) { console.warn('[wear] forecast failed:', e); days = []; }
  if (days && !days.length) $('#wp-guide').innerHTML = `<p class="muted">${esc(t('wp_unavailable'))}</p>`;
  else render();
}

function pick(v, push = true) {
  const r = resolveResort(v); if (!r) return false;
  LS.set('resort', r.id);
  if (push) { try { history.replaceState({}, '', `?resort=${encodeURIComponent(r.id)}`); } catch {} }
  const inp = $('#wp-input'); if (inp && inp.value !== r.name) inp.value = r.name;
  loadForecast(r);
  return true;
}

async function main() {
  bindWearExpand(document);
  try {
    const [c, cfg] = await Promise.all([
      fetch('/data/catalog.json').then(r => r.json()),
      fetch('/data/resorts.json').then(r => r.json()).catch(() => null)
    ]);
    cat = c; cat.resorts.forEach(r => byId.set(r.id, r));
    if (cfg?.sources?.weather) wxUrl = cfg.sources.weather;
  } catch (e) { console.warn('[wear] catalog failed:', e); }
  const list = $('#wp-list');
  if (list && cat) list.innerHTML = cat.resorts.map(r => `<option value="${esc(r.name)}">${esc(r.city)}, ${esc(r.state)}</option>`).join('');
  const q = new URLSearchParams(location.search).get('resort');
  const start = resolveResort(q) || resolveResort(LS.get('resort', null)) || byId.get('palisades') || cat?.resorts?.[0];
  if (start) pick(start.id, false);
  const inp = $('#wp-input');
  if (inp) {
    inp.addEventListener('change', () => { if (!pick(inp.value)) inp.value = resort ? resort.name : ''; });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (!pick(inp.value)) inp.value = resort ? resort.name : ''; } });
  }
  window.addEventListener('ski:units', render);
  window.addEventListener('ski:lang', render);
}

main();
