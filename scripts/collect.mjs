// Shared data collection for the ski dashboard. Used by the Cloudflare Worker (workers/ski-data/) and by
// the GitHub Action backup (scripts/fetch-data.mjs). Dependency-free; only needs fetch().
// Rule: a failed source never replaces good data with nothing. mergeSource() keeps the last good
// value and its own fetchedAt, and records the failure (status 'stale' = serving last good copy,
// 'failed' = nothing to serve).
import { fetchAllIntel } from '../js/intel.js';
import { openMeteoUrl, splitOpenMeteo, carsUrl, slimEvents, EVENT_CLASSES, nwsUrl, slimAlerts, wxGroupCfg,
  utahCarsUrl, utahKeyedUrl, slimUtahEvents, slimUtahRoadConditions, slimUtahCameras, slimUtahPasses } from '../js/core.js';

export const UA = 'SkiDay ski dashboard (https://followthepowder.com/)';
export const SOURCES = ['weather', 'roads', 'alerts', 'cameras', 'intel', 'utah-roads'];
const now = () => new Date().toISOString();

export function makeHttp({ tries = 3, timeoutMs = 25000 } = {}) {
  async function raw(url, extra = {}, accept = 'application/json, application/geo+json') {
    let last;
    for (let i = 0; i < tries; i++) {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept, ...extra }, signal: ctl.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${new URL(url).host}`);
        return r;
      } catch (e) { last = e; if (i < tries - 1) await new Promise(res => setTimeout(res, 1200 * (i + 1))); }
      finally { clearTimeout(tm); }
    }
    throw last;
  }
  return {
    getJson: async (url, extra) => (await raw(url, extra)).json(),
    getText: async (url, extra) => (await raw(url, extra, 'text/html')).text()
  };
}

/** Collectors: each returns data or throws. `keys` = optional provider keys (Worker secrets). */
export const collectors = {
  async weather(full, http, keys = {}) {
    const cfg = wxGroupCfg(full, keys.wxGroup || 0); // one weather group per call (group 0 unless asked)
    if (!cfg.resorts.length) throw new Error(`weather: group ${keys.wxGroup || 0} has no resorts`);
    // A commercial Open-Meteo key switches to the customer endpoint; same response format.
    const c = keys.openMeteoKey ? { ...cfg, sources: { ...cfg.sources, weather: 'https://customer-api.open-meteo.com/v1/forecast' } } : cfg;
    let url = openMeteoUrl(c);
    if (keys.openMeteoKey) url += `&apikey=${encodeURIComponent(keys.openMeteoKey)}`;
    const split = splitOpenMeteo(cfg, await http.getJson(url));
    if (Object.keys(split).length !== cfg.resorts.length) throw new Error(`weather: got ${Object.keys(split).length}/${cfg.resorts.length} resorts`);
    return split;
  },
  async roads(cfg, http) {
    const events = [];
    for (const cls of EVENT_CLASSES) events.push(...slimEvents(cfg, cls, await http.getJson(carsUrl(cfg, cls))));
    return { events };
  },
  async alerts(cfg, http) {
    const out = {}; const errs = [];
    for (const r of cfg.resorts) {
      try { out[r.id] = slimAlerts(await http.getJson(nwsUrl(cfg, r))); } catch (e) { errs.push(`${r.id}: ${e.message || e}`); }
    }
    // Partial is fine (a resort without a fresh answer shows 'alerts unavailable'); all failing is an outage.
    if (errs.length === cfg.resorts.length) throw new Error(`alerts: ${errs.join('; ')}`);
    if (errs.length) console.warn?.(`[ski] alerts partial: ${errs.join('; ')}`);
    return out;
  },
  /** Returns { route: fixed DEN-route cameras, all: statewide slim list } with per-view image timestamps. */
  async cameras(cfg, http) {
    const json = await http.getJson(`${cfg.sources.cars}/cameras/map-features`);
    const feats = json.features || [];
    if (!feats.length) throw new Error('cameras: empty list');
    const newest = views => Math.max(0, ...views.map(v => v.imageTimestamp || 0)) || null;
    const byId = new Map(feats.map(f => [f.properties.id, f.properties]));
    const route = cfg.cameras.map(c => {
      const p = byId.get(c.id);
      if (!p) return { id: c.id, found: false };
      const still = p.views.find(v => v.type === 'STILL_IMAGE');
      const stream = p.views.find(v => v.type === 'WMP');
      return { id: c.id, found: true, name: p.name, broken: p.views.every(v => v.broken),
        image: still?.url || c.image, stream: stream?.url || null, ts: newest(p.views), lastUpdated: p.lastUpdated || null };
    });
    const all = [];
    for (const f of feats) {
      const p = f.properties || {}, g = f.geometry?.coordinates;
      if (!p.public || !g) continue;
      const v = p.views.find(x => !x.broken) || p.views[0];
      if (!v) continue;
      const img = v.type === 'STILL_IMAGE' ? v.url : v.videoPreviewUrl;
      if (!img) continue;
      all.push({ id: p.id, lon: +g[0].toFixed(5), lat: +g[1].toFixed(5), name: p.name, route: p.route || null,
        local: !!p.location?.localRoad, img, stream: v.type === 'WMP' ? v.url : null,
        broken: p.views.every(x => x.broken), ts: v.imageTimestamp || newest(p.views) });
    }
    return { route, all };
  },
  async intel(cfg, http) { return fetchAllIntel(cfg, http); },
  /**
   * Utah roads: {events, cameras, passes}. Events always come from the keyless ArcGIS UDOT feed
   * (or the keyed ibi511 /event feed when a key is present, with ArcGIS as fallback). When
   * keys.udotApiKey is set, three more single-try keyed calls add road-condition segments
   * (traction/chain restrictions + icy/snow-covered roads), corridor cameras and mountain passes.
   * Keyed calls are 4 per 15-min tick at most — well under UDOT's 10 calls / 60 s throttle.
   * Without a key the source still works (events only), so the GitHub Action backup keeps working.
   */
  async 'utah-roads'(cfg, http, keys = {}) {
    const out = { events: [], cameras: [], passes: [] };
    const key = keys.udotApiKey;
    if (key) {
      const keyHttp = makeHttp({ tries: 1, timeoutMs: 20000 });
      try { out.events.push(...slimUtahEvents(cfg, await keyHttp.getJson(utahKeyedUrl(cfg, key, 'event')), { keyed: true })); }
      catch { out.events.push(...slimUtahEvents(cfg, await http.getJson(utahCarsUrl(cfg)))); }
      try { out.cameras = slimUtahCameras(cfg, await keyHttp.getJson(utahKeyedUrl(cfg, key, 'cameras'))); } catch (e) { console.warn?.(`[ski] utah cameras: ${e.message || e}`); }
      try { out.events.push(...slimUtahRoadConditions(cfg, await keyHttp.getJson(utahKeyedUrl(cfg, key, 'roadconditions', 3)))); } catch (e) { console.warn?.(`[ski] utah roadconditions: ${e.message || e}`); }
      try { out.passes = slimUtahPasses(cfg, await keyHttp.getJson(utahKeyedUrl(cfg, key, 'mountainpasses'))); } catch (e) { console.warn?.(`[ski] utah mountainpasses: ${e.message || e}`); }
    } else {
      out.events.push(...slimUtahEvents(cfg, await http.getJson(utahCarsUrl(cfg))));
    }
    return out;
  }
};

/** Merge one source attempt into its last record. */
export function mergeSource(prev, attempt) {
  const t = now();
  if (attempt.ok) return { status: 'ok', ok: true, fetchedAt: t, attemptAt: t, error: null, data: attempt.data };
  const has = prev && prev.data != null;
  return { status: has ? 'stale' : 'failed', ok: has, fetchedAt: has ? prev.fetchedAt : null, attemptAt: t, error: attempt.error, data: has ? prev.data : null };
}

/** Intel merges per resort: a resort whose fetch failed keeps its last good report, flagged. */
export function mergeIntel(prev, next) {
  const t = now(); const out = {}; const errs = [];
  for (const [id, v] of Object.entries(next || {})) {
    const p = prev?.data?.[id];
    if (v.ok) out[id] = v;
    else {
      errs.push(`${id}: ${v.error}`);
      out[id] = p?.ok ? { ...p, stale: true, lastError: v.error, lastAttempt: t } : v;
    }
  }
  const allBad = Object.values(out).every(v => !v.ok);
  return { status: errs.length ? (allBad ? 'failed' : 'stale') : 'ok', ok: !allBad, fetchedAt: errs.length && prev?.fetchedAt && allBad ? prev.fetchedAt : t,
    attemptAt: t, error: errs.length ? errs.join('; ') : null, data: out };
}

const meta = r => r ? { ok: !!r.ok, status: r.status, fetchedAt: r.fetchedAt, attemptAt: r.attemptAt, error: r.error || null } : { ok: false, status: 'failed', fetchedAt: null, attemptAt: null, error: 'never fetched' };

/** Records -> the latest.json shape the page reads. */
export function toLatest(rec, servedBy) {
  const times = ['weather', 'roads', 'alerts', 'cameras', 'utah-roads'].map(k => rec[k]?.fetchedAt).filter(Boolean).sort();
  return {
    generatedAt: times[times.length - 1] || null, servedBy,
    sources: { weather: meta(rec.weather), roads: meta(rec.roads), alerts: meta(rec.alerts), cameras: meta(rec.cameras), 'utah-roads': meta(rec['utah-roads']) },
    weather: rec.weather?.data || null, roads: rec.roads?.data || null, alerts: rec.alerts?.data || {}, cameras: rec.cameras?.data || null,
    'utah-roads': rec['utah-roads']?.data || null
  };
}
export const toIntel = (r, servedBy) => ({ generatedAt: r?.fetchedAt || null, attemptAt: r?.attemptAt || null, status: r?.status || 'failed', error: r?.error || null, servedBy, resorts: r?.data || {} });
export const toCameras = (r, cfg, servedBy) => ({ generatedAt: r?.fetchedAt || null, attemptAt: r?.attemptAt || null, status: r?.status || 'failed', servedBy, source: `${cfg.sources.cars}/cameras/map-features`, cameras: r?.data || [] });

/** latest.json (+ intel.json, cameras.json) on disk -> records, so the Node backup can merge too. */
export function fromFiles(latest, intel, cams) {
  const rec = {};
  for (const k of ['weather', 'roads', 'alerts', 'cameras', 'utah-roads']) {
    const s = latest?.sources?.[k]; const d = latest?.[k];
    const has = d != null && s?.ok !== false && !(k === 'alerts' && !Object.values(d).some(v => v));
    rec[k] = has ? { status: s?.status || 'ok', ok: true, fetchedAt: s?.fetchedAt || latest.generatedAt, attemptAt: s?.attemptAt || null, error: s?.error || null, data: d } : null;
  }
  rec.intel = intel ? { status: intel.status || 'ok', ok: true, fetchedAt: intel.generatedAt, data: intel.resorts || {} } : null;
  rec.camsall = cams?.cameras?.length ? { status: cams.status || 'ok', ok: true, fetchedAt: cams.generatedAt, data: cams.cameras } : null;
  return rec;
}

/** Run a list of sources against previous records; returns the new records (+ camsall) and failures. */
export async function runSources(names, cfg, prev, keys = {}, log = console) {
  const http = makeHttp(); const rec = {}; const failures = [];
  for (const name of names) {
    try {
      const data = await collectors[name](cfg, http, keys);
      if (name === 'intel') { rec.intel = mergeIntel(prev.intel, data); if (rec.intel.error) failures.push(`intel: ${rec.intel.error}`); }
      else if (name === 'cameras') { rec.cameras = mergeSource(prev.cameras, { ok: true, data: data.route }); rec.camsall = mergeSource(prev.camsall, { ok: true, data: data.all }); }
      else rec[name] = mergeSource(prev[name], { ok: true, data });
    } catch (e) {
      const error = String(e?.message || e);
      failures.push(`${name}: ${error}`);
      log.error?.(`[ski] ${name} failed: ${error}`);
      rec[name] = mergeSource(prev[name], { ok: false, error });
      if (name === 'cameras' && prev.camsall) rec.camsall = { ...mergeSource(prev.camsall, { ok: false, error }) };
    }
  }
  return { rec, failures };
}
