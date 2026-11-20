// Google Tag Manager dataLayer events (container GTM-WQH2HB5M is loaded from index.html).
// Params are ids, names of resorts and UI labels only: never search text, typed text, addresses,
// coordinates or city names. Every push carries the same keys (null when n/a) so GTM's data model
// never carries a stale value from an earlier event into the next one.
const KEYS = ['resort_name', 'resort_id', 'source', 'tab', 'location_type', 'start_preset', 'clothing_category', 'audience', 'day',
  'forecast_type', 'action', 'section', 'resort_names', 'resort_count', 'item', 'list', 'link_type', 'link_domain', 'page_type'];
let ctx = { nameOf: () => null, currentId: () => null };
export function dl(o) {
  try {
    const base = {}; for (const k of KEYS) base[k] = null;
    (window.dataLayer = window.dataLayer || []).push({ ...base, ...o });
  } catch {}
}
// gtag('event', name, params) also works: forwarded into dataLayer as a Custom Event (only if no real gtag exists).
if (typeof window.gtag !== 'function') {
  window.gtag = function (cmd, name, params) {
    if (cmd === 'event' && typeof name === 'string') dl({ event: name, ...(params || {}) });
    else (window.dataLayer = window.dataLayer || []).push(arguments);
  };
}
const curName = () => { const id = ctx.currentId(); return id ? ctx.nameOf(id) || id : null; };
const once = new Set(); // per page view: scroll interactions fire once per chart

export function selectResort(id, source) { dl({ event: 'select_resort', resort_id: id, resort_name: ctx.nameOf(id) || id, source }); }
export function resortCompare(ids) { dl({ event: 'resort_compare', resort_names: ids.map(id => ctx.nameOf(id) || id).join(', '), resort_count: ids.length }); }
export function forecast(type, action) { dl({ event: 'forecast_interaction', resort_name: curName(), forecast_type: type, action }); }
export function gear(item, list, action) { dl({ event: 'gear_recommendation_click', resort_name: curName(), item, list, action }); }
export function tabChange(tab) { dl({ event: 'tab_change', tab }); }
export function startSet(s) {
  const k = s.kind === 'auto-ip' ? 'ip' : s.kind === 'auto-geo' ? 'auto' : 'manual';
  dl({ event: 'start_location_set', location_type: k, start_preset: s.kind === 'preset' ? s.id : null });
}
let vpvReady = false; // the first page_view comes from GTM's own page-load trigger
export function pageView(type, id) {
  once.clear();
  if (!vpvReady) { vpvReady = true; return; }
  dl({ event: 'virtual_page_view', page_type: type, resort_id: id || null, resort_name: id ? ctx.nameOf(id) || id : null,
    page_path: location.pathname + location.search, page_location: location.origin + location.pathname + location.search, page_title: document.title });
}

const host = h => h.replace(/^www\./, '');
function linkType(a, u) {
  const h = host(u.hostname);
  if (/(^|\.)cotrip\.org$/.test(h)) return 'cotrip';
  if (/(^|\.)weather\.gov$/.test(h)) return 'nws';
  if (/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(h)) return 'live_stream';
  if (/^maps\.app\.goo\.gl$|^(maps\.)?google\.[a-z.]+$/.test(h) && (/maps/.test(u.hostname + u.pathname))) return 'google_maps';
  if (a.closest('.thumb')) return a.querySelector('.play') || a.classList.contains('live') ? 'live_stream' : 'webcam';
  if (/(^|\.)(wikimedia|wikipedia)\.org$/.test(h)) return 'wikipedia';
  if (/(^|\.)openstreetmap\.org$/.test(h)) return 'map_attribution';
  if (a.closest('#resorts')) return /cam/i.test(u.href) ? 'webcam' : 'resort_site';
  if (a.closest('#intel, #b-mtn, #mtn-now, .blinks, .links, .bhero, .dcard, .alt')) return 'resort_site';
  return 'other';
}
const SEC_TILES = ['snow_report', 'temperature', 'lifts', 'runs', 'terrain', 'base_depth'];
const SEC_ITILES = ['lifts', 'runs', 'terrain', 'base_depth', 'season_status', 'lift_hours'];

export function initAnalytics(c) {
  ctx = { ...ctx, ...c };
  const onLink = e => {
    const a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    let u; try { u = new URL(a.href, location.href); } catch { return; }
    if (!/^https?:$/.test(u.protocol) || u.host === location.host) return;
    const card = a.closest('[data-id], [data-alt]');
    const id = ctx.currentId() || card?.dataset.id || card?.dataset.alt || null;
    dl({ event: 'external_link_click', resort_name: id ? ctx.nameOf(id) || id : null, resort_id: id, link_type: linkType(a, u), link_domain: host(u.hostname) });
  };
  document.addEventListener('click', onLink, true);
  document.addEventListener('auxclick', e => { if (e.button === 1) onLink(e); }, true);
  document.addEventListener('click', e => {
    const t = e.target; if (!t.closest) return;
    // in-page live stream embed
    if (t.closest('.yt[data-yt]') && !t.closest('.yt iframe')) dl({ event: 'external_link_click', resort_name: curName(), resort_id: ctx.currentId(), link_type: 'live_stream', link_domain: 'youtube-nocookie.com', action: 'embed_play' });
    // snow conditions
    const tile = t.closest('#mtn-now .tiles .tile, #b-mtn .tiles .tile');
    if (tile) { const i = [...tile.parentElement.children].indexOf(tile); dl({ event: 'snow_conditions_click', resort_name: curName(), section: SEC_TILES[i] || 'other' }); }
    const it = t.closest('#intel .itile');
    if (it) { const i = [...it.parentElement.children].indexOf(it); dl({ event: 'snow_conditions_click', resort_name: curName(), section: SEC_ITILES[i] || 'other' }); }
    if (t.closest('#intel .sbars')) dl({ event: 'snow_conditions_click', resort_name: curName(), section: 'snow_chart' });
    // forecast
    const fc = t.closest('[data-fc]'); if (fc && !t.closest('summary')) forecast(fc.dataset.fc, 'click');
    const sum = t.closest('summary');
    if (sum) {
      const d = sum.parentElement, opening = !d.open;
      if (d.closest('#outlook')) forecast('snow_outlook', opening ? 'expand' : 'collapse');
      else if (d.closest('#weather')) forecast('daily', opening ? 'info_open' : 'info_close');
    }
    // what to wear: per-category expand
    const wx = t.closest('[data-wexp]');
    if (wx) {
      const card = wx.closest('[data-day]'), col = wx.closest('[data-aud]');
      if (wx.getAttribute('aria-expanded') !== 'true') dl({ event: 'what_to_wear_expand', resort_name: curName(), clothing_category: wx.dataset.wexp, audience: col?.dataset.aud || null, day: card?.dataset.day || null });
    }
    const chip = t.closest('#wear .wi[data-k]');
    if (chip) gear(chip.dataset.k.replace(/^[wn]_/, ''), 'what_to_wear', 'click');
  });
  // first horizontal scroll of a forecast chart
  document.addEventListener('scroll', e => {
    const el = e.target; if (!(el instanceof Element)) return;
    const fc = el.closest('[data-fc]'); if (!fc) return;
    const k = 'scroll:' + fc.dataset.fc; if (once.has(k)) return; once.add(k); forecast(fc.dataset.fc, 'scroll');
  }, true);
}
