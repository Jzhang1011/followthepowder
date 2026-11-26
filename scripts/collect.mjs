// Shared data collection for the ski dashboard. Used by the Cloudflare Worker (workers/ski-data/) and by
// the GitHub Action backup (scripts/fetch-data.mjs). Dependency-free; only needs fetch().
// Rule: a failed source never replaces good data with nothing. mergeSource() keeps the last good
// value and its own fetchedAt, and records the failure (status 'stale' = serving last good copy,
// 'failed' = nothing to serve).
import { fetchAllIntel } from '../js/intel.js';
import { openMeteoUrl, splitOpenMeteo, carsUrl, slimEvents, EVENT_CLASSES, nwsUrl, slimAlerts, wxGroupCfg,
  utahCarsUrl, utahKeyedUrl, slimUtahEvents, slimUtahRoadConditions, slimUtahCameras, slimUtahPasses,
  caRoadsUrl, CA_DISTRICTS, slimCaEvents,
  c2cUrl, slimNeEvents, ny511Url, slimNyEvents, massdotUrl, slimMaEvents,
  wyoroadPbfUrl, WYOROAD_PBF_FILE, wyoroadPbfFilename, decodeWyoPbf, slimWyEvents, wyoroadTextUrl, slimWyTextEvents,
  mdtGeoUrl, slimMtEvents,
  idahoWinterUrl, idahoEventUrl, slimIdKeyed, idahoWzdxUrl, slimIdWzdx, idahoMapIconsUrl, slimIdMapIcons,
  nmEventsUrl, NM_EVENT_TYPES, slimNmEvents,
  wsdotPassUrl, wsdotAlertsUrl, slimWaPasses, slimWaAlerts,
  tripcheckUrl, slimOrRoads,
  alaskaWinterUrl, alaskaEventUrl, slimAkKeyed, alaskaMapIconsUrl, slimAkMapIcons } from '../js/core.js';

export const UA = 'SkiDay ski dashboard (https://followthepowder.com/)';
export const SOURCES = ['weather', 'roads', 'alerts', 'cameras', 'intel', 'utah-roads', 'ca-roads', 'ne-roads', 'ny-roads', 'ma-roads', 'wy-roads', 'mt-roads', 'id-roads', 'nm-roads', 'wa-roads', 'or-roads', 'ak-roads'];
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
    getText: async (url, extra) => (await raw(url, extra, 'text/html')).text(),
    getBuffer: async (url, extra) => (await raw(url, extra, 'application/octet-stream')).arrayBuffer()
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
  },
  /**
   * California roads: {events} from Caltrans CWWP2 (keyless JSON, no auth): chain controls (cc)
   * + lane closures (lcs) for districts D3/D8/D9/D10. 8 files per tick, ~3.5 MB worst case, slimmed
   * to events on our segments. No cameras/passes feed exists (unlike UDOT) — cameras stay null.
   */
  async 'ca-roads'(cfg, http) {
    const cc = [], lcs = [];
    for (const d of CA_DISTRICTS) {
      for (const [feed, arr] of [['cc', cc], ['lcs', lcs]]) {
        const j = await http.getJson(caRoadsUrl(d, feed));
        if (!Array.isArray(j?.data)) throw new Error(`ca-roads: ${feed} D${d} has no data array`);
        arr.push(...j.data);
      }
    }
    return { events: slimCaEvents(cfg, { cc, lcs }) };
  },
  /**
   * Northeast roads, three sources (no single feed covers all five states):
   * ne-roads = Compass C2C incidents + lane closures (VT/NH/ME, keyless XML, two calls —
   * a combined dataTypes list is unverified); ny-roads = 511NY CARS closures + winter
   * driving + incidents (NY, keyless GeoJSON; the 18.4 MB winter file is filtered to the
   * ski corridors before storage); ma-roads = MassDOT ERS planned events (MA, keyless
   * XML, thin). No cameras/passes feed is wired in v1 — events only (CA precedent).
   * The winter fetch is the flaky one (18 MB); if it fails, closures + incidents still land.
   */
  async 'ne-roads'(cfg, http) {
    const xml = { Accept: 'application/xml, text/xml, */*' };
    const inc = await http.getText(c2cUrl('incidentData'), xml);
    const lcs = await http.getText(c2cUrl('laneClosureData'), xml);
    return { events: slimNeEvents(cfg, inc, lcs) };
  },
  async 'ny-roads'(cfg, http) {
    const closures = await http.getJson(ny511Url('closures'));
    const incidents = await http.getJson(ny511Url('incidents'));
    let winter = { features: [] };
    try { winter = await http.getJson(ny511Url('winterDriving')); }
    catch (e) { console.warn?.(`[ski] ny winterDriving failed, keeping closures+incidents: ${e.message || e}`); }
    return { events: slimNyEvents(cfg, { closures, winter, incidents }) };
  },
  async 'ma-roads'(cfg, http) {
    const xml = await http.getText(massdotUrl(), { Accept: 'application/xml, text/xml, */*' });
    return { events: slimMaEvents(cfg, xml) };
  },
  /**
   * Re-extract the WyoRoad conditions PBF filename from the live map bundle (only when the known
   * filename 404s — filenames are baked into the JS bundle and rotate on redeploy): map page ->
   * app entry JS -> map node JS -> wyoroadPbfFilename(). 3 extra fetches, only on rotation.
   */
  async 'wy-roads'(cfg, http) {
    let buf = null;
    try { buf = await http.getBuffer(wyoroadPbfUrl()); }
    catch (e) {
      console.warn?.(`[ski] wy PBF ${WYOROAD_PBF_FILE} failed (${e.message || e}), discovering filename from bundle`);
      const one = makeHttp({ tries: 1, timeoutMs: 20000 });
      try {
        const html = await one.getText('https://map.wyoroad.info/511-map/', { Accept: 'text/html' });
        const app = html.match(/\/511-map\/_app\/immutable\/entry\/(app\.[A-Za-z0-9_-]+\.js)/)?.[1];
        if (!app) throw new Error('map app entry not found');
        const appJs = await one.getText(`https://map.wyoroad.info/511-map/_app/immutable/entry/${app}`);
        const node = appJs.match(/nodes\/(2\.[A-Za-z0-9_-]+\.js)/)?.[1];
        if (!node) throw new Error('map node 2 not found');
        const bundle = await one.getText(`https://map.wyoroad.info/511-map/_app/immutable/nodes/${node}`);
        const file = wyoroadPbfFilename(bundle);
        if (!file) throw new Error('conditions PBF filename not in bundle');
        buf = await one.getBuffer(wyoroadPbfUrl(file));
        console.warn?.(`[ski] wy PBF filename rotated to ${file}`);
      } catch (e2) { console.warn?.(`[ski] wy PBF discovery failed (${e2.message || e2}), using text fallback`); }
    }
    if (buf?.byteLength) {
      try {
        const recs = decodeWyoPbf(buf);
        if (recs.length) return slimWyEvents(cfg, recs);
        console.warn?.('[ski] wy PBF decoded 0 records, using text fallback');
      } catch (e) { console.warn?.(`[ski] wy PBF decode failed (${e.message || e}), using text fallback`); }
    }
    // Text fallback: the Jackson town page covers both WY resorts' corridors. A PBF 404 is
    // "unknown", never "clear" — if this fetch also fails, the throw keeps the last good copy.
    const html = await http.getText(wyoroadTextUrl('Jackson'), { Accept: 'text/html' });
    return slimWyTextEvents(cfg, html);
  },
  /**
   * Montana roads: MDT 511 Iteris CDN GeoJSON (keyless): events + construction + restrictions
   * (3 GETs, ~49 KB/tick). One file failing does not lose the others; all three failing throws.
   */
  async 'mt-roads'(cfg, http) {
    const got = {}; const errs = [];
    for (const kind of ['events', 'construction', 'restrictions']) {
      try { got[kind] = await http.getJson(mdtGeoUrl(kind)); }
      catch (e) { errs.push(`${kind}: ${e.message || e}`); }
    }
    if (!Object.keys(got).length) throw new Error(`mt-roads: ${errs.join('; ')}`);
    if (errs.length) console.warn?.(`[ski] mt-roads partial: ${errs.join('; ')}`);
    return slimMtEvents(cfg, got);
  },
  /**
   * Idaho roads: keyed Developer API when a key is set (winterroads v3 + event v2, 2 calls/tick,
   * under the 10 calls / 60 s throttle), keyless fallback (WZDx work zones, filtered server-side
   * + mapIcons ActiveClosures/Construction points) otherwise. A 400/401 from the keyed API means
   * "key missing", not "no events" — any keyed failure falls back to keyless, never to nothing.
   * Without a key the source still works (thin keyless coverage), so the GitHub Action backup
   * keeps working.
   */
  async 'id-roads'(cfg, http, keys = {}) {
    const key = keys.idahoApiKey;
    if (key) {
      const keyHttp = makeHttp({ tries: 1, timeoutMs: 20000 });
      let winter = null, evs = null; const kerrs = [];
      try { winter = await keyHttp.getJson(idahoWinterUrl(key)); } catch (e) { kerrs.push(`winterroads: ${e.message || e}`); }
      try { evs = await keyHttp.getJson(idahoEventUrl(key)); } catch (e) { kerrs.push(`event: ${e.message || e}`); }
      if (winter != null || evs != null) {
        if (kerrs.length) console.warn?.(`[ski] id keyed partial: ${kerrs.join('; ')}`);
        return slimIdKeyed(cfg, winter ?? [], evs ?? []);
      }
      console.warn?.(`[ski] id keyed API failed (${kerrs.join('; ')}), falling back to keyless`);
    }
    const [wzdx, closures, construction] = await Promise.all([
      http.getJson(idahoWzdxUrl()),
      http.getJson(idahoMapIconsUrl('ActiveClosures')),
      http.getJson(idahoMapIconsUrl('Construction'))
    ]);
    return { events: [...slimIdWzdx(cfg, wzdx).events, ...slimIdMapIcons(cfg, closures, 'ActiveClosures').events,
      ...slimIdMapIcons(cfg, construction, 'Construction').events] };
  },
  /**
   * New Mexico roads: NMRoads GetEventsJSON (keyless). One comma-list call for all 13 event types
   * (verified live 2026-11-24: 95 events, 741 KB); if the comma list ever fails, one call per
   * event type. At least one per-type call must succeed or the source throws (last good kept).
   */
  async 'nm-roads'(cfg, http) {
    try {
      return slimNmEvents(cfg, await http.getJson(nmEventsUrl()));
    } catch (e) {
      console.warn?.(`[ski] nm comma-list failed (${e.message || e}), falling back to per-type calls`);
      const out = []; let ok = 0;
      for (const t of NM_EVENT_TYPES) {
        try { out.push(...slimNmEvents(cfg, await http.getJson(nmEventsUrl([t]))).events); ok++; }
        catch (e2) { console.warn?.(`[ski] nm type ${t} failed: ${e2.message || e2}`); }
      }
      if (!ok) throw e;
      return { events: out };
    }
  },
  /**
   * Washington roads: WSDOT Mountain Pass Conditions RSS (keyless, 16 passes, chain/traction
   * restrictions verbatim) + Highway Alerts KML (keyless, ~88 placemarks with point coordinates).
   * Both fetches must succeed — either failing throws so the last good copy is kept (a partial
   * tick would silently drop the other feed's events).
   */
  async 'wa-roads'(cfg, http) {
    const [passes, alerts] = await Promise.all([
      http.getText(wsdotPassUrl(), { Accept: 'application/rss+xml, application/xml, text/xml, */*' }),
      http.getText(wsdotAlertsUrl(), { Accept: 'application/vnd.google-earth.kml+xml, application/xml, text/xml, */*' })
    ]);
    return { events: [...slimWaPasses(cfg, passes).events, ...slimWaAlerts(cfg, alerts).events] };
  },
  /**
   * Oregon roads: ODOT TripCheck map files (keyless EsriJSON, Web Mercator): rw.js road-weather
   * stations (chain codes + conditions) + INCD.js incidents + EVENT.js events. All three must
   * succeed or the source throws (last good kept). The INCDLine/EVENTLine twins are not fetched —
   * the point incidents already carry the location; the lines duplicate them.
   */
  async 'or-roads'(cfg, http) {
    const any = { Accept: '*/*' }; // TripCheck 406s on application/json — it serves plain JS
    const [rw, incd, event] = await Promise.all([
      http.getJson(tripcheckUrl('rw'), any),
      http.getJson(tripcheckUrl('INCD'), any),
      http.getJson(tripcheckUrl('EVENT'), any)
    ]);
    return slimOrRoads(cfg, { rw, incd, event });
  },
  /**
   * Alaska roads: keyed Developer API when a key is set (winterroads v3 + event v2, 2 calls/tick,
   * under the 10 calls / 60 s throttle), keyless fallback (mapIcons Closures/Incidents/
   * Construction points) otherwise. Any keyed failure falls back to keyless, never to nothing.
   * No key exists yet — Jie must obtain one (free registration at 511.alaska.gov/my511/register)
   * and set it as the ALASKA_511_API_KEY Worker secret. WZDx is not fetched (0 features at
   * check; work zones arrive via the Construction layer).
   */
  async 'ak-roads'(cfg, http, keys = {}) {
    const key = keys.alaskaApiKey;
    if (key) {
      const keyHttp = makeHttp({ tries: 1, timeoutMs: 20000 });
      let winter = null, evs = null; const kerrs = [];
      try { winter = await keyHttp.getJson(alaskaWinterUrl(key)); } catch (e) { kerrs.push(`winterroads: ${e.message || e}`); }
      try { evs = await keyHttp.getJson(alaskaEventUrl(key)); } catch (e) { kerrs.push(`event: ${e.message || e}`); }
      if (winter != null || evs != null) {
        if (kerrs.length) console.warn?.(`[ski] ak keyed partial: ${kerrs.join('; ')}`);
        return slimAkKeyed(cfg, winter ?? [], evs ?? []);
      }
      console.warn?.(`[ski] ak keyed API failed (${kerrs.join('; ')}), falling back to keyless`);
    }
    const [closures, incidents, construction] = await Promise.all([
      http.getJson(alaskaMapIconsUrl('Closures')),
      http.getJson(alaskaMapIconsUrl('Incidents')),
      http.getJson(alaskaMapIconsUrl('Construction'))
    ]);
    return { events: [...slimAkMapIcons(cfg, closures, 'Closures').events,
      ...slimAkMapIcons(cfg, incidents, 'Incidents').events,
      ...slimAkMapIcons(cfg, construction, 'Construction').events] };
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
  const times = ['weather', 'roads', 'alerts', 'cameras', 'utah-roads', 'ca-roads', 'ne-roads', 'ny-roads', 'ma-roads', 'wy-roads', 'mt-roads', 'id-roads', 'nm-roads', 'wa-roads', 'or-roads', 'ak-roads'].map(k => rec[k]?.fetchedAt).filter(Boolean).sort();
  return {
    generatedAt: times[times.length - 1] || null, servedBy,
    sources: { weather: meta(rec.weather), roads: meta(rec.roads), alerts: meta(rec.alerts), cameras: meta(rec.cameras), 'utah-roads': meta(rec['utah-roads']), 'ca-roads': meta(rec['ca-roads']), 'ne-roads': meta(rec['ne-roads']), 'ny-roads': meta(rec['ny-roads']), 'ma-roads': meta(rec['ma-roads']), 'wy-roads': meta(rec['wy-roads']), 'mt-roads': meta(rec['mt-roads']), 'id-roads': meta(rec['id-roads']), 'nm-roads': meta(rec['nm-roads']), 'wa-roads': meta(rec['wa-roads']), 'or-roads': meta(rec['or-roads']), 'ak-roads': meta(rec['ak-roads']) },
    weather: rec.weather?.data || null, roads: rec.roads?.data || null, alerts: rec.alerts?.data || {}, cameras: rec.cameras?.data || null,
    'utah-roads': rec['utah-roads']?.data || null, 'ca-roads': rec['ca-roads']?.data || null,
    'ne-roads': rec['ne-roads']?.data || null, 'ny-roads': rec['ny-roads']?.data || null, 'ma-roads': rec['ma-roads']?.data || null,
    'wy-roads': rec['wy-roads']?.data || null, 'mt-roads': rec['mt-roads']?.data || null,
    'id-roads': rec['id-roads']?.data || null, 'nm-roads': rec['nm-roads']?.data || null,
    'wa-roads': rec['wa-roads']?.data || null, 'or-roads': rec['or-roads']?.data || null, 'ak-roads': rec['ak-roads']?.data || null
  };
}
export const toIntel = (r, servedBy) => ({ generatedAt: r?.fetchedAt || null, attemptAt: r?.attemptAt || null, status: r?.status || 'failed', error: r?.error || null, servedBy, resorts: r?.data || {} });
export const toCameras = (r, cfg, servedBy) => ({ generatedAt: r?.fetchedAt || null, attemptAt: r?.attemptAt || null, status: r?.status || 'failed', servedBy, source: `${cfg.sources.cars}/cameras/map-features`, cameras: r?.data || [] });

/** latest.json (+ intel.json, cameras.json) on disk -> records, so the Node backup can merge too. */
export function fromFiles(latest, intel, cams) {
  const rec = {};
  for (const k of ['weather', 'roads', 'alerts', 'cameras', 'utah-roads', 'ca-roads', 'ne-roads', 'ny-roads', 'ma-roads', 'wy-roads', 'mt-roads', 'id-roads', 'nm-roads', 'wa-roads', 'or-roads', 'ak-roads']) {
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
