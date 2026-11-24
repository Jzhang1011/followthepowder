// Shared, dependency-free logic for the ski dashboard.
// Runs in the browser (ES module) and in Node (scripts/fetch-data.mjs).

export const EVENT_CLASSES = ['chainLaws', 'roadClosures', 'roadReports', 'winterDriving'];

/* ---------------- Weather (Open-Meteo) ---------------- */

const HOURLY = ['temperature_2m', 'apparent_temperature', 'precipitation', 'rain', 'showers', 'snowfall',
  'freezing_level_height', 'wind_speed_10m', 'wind_gusts_10m', 'weather_code', 'visibility',
  'temperature_700hPa', 'temperature_600hPa', 'temperature_500hPa'];
const DAILY = ['temperature_2m_max', 'temperature_2m_min', 'apparent_temperature_min', 'apparent_temperature_max',
  'snowfall_sum', 'precipitation_sum', 'rain_sum', 'showers_sum', 'wind_gusts_10m_max', 'wind_speed_10m_max',
  'weather_code', 'uv_index_max', 'sunrise', 'sunset'];

/** One request for every resort: two points each — base (base lat/lon + base elevation) and summit
 * (summit lat/lon + official summit elevation, so summit wind/precip come from the summit grid cell). */
/** Weather is fetched and stored in small groups of resorts (resorts.json wxGroup, default 0) so no
 *  single request, KV value or page download carries all of them. Group 0 rides in latest.json. */
export const wxGroupOf = r => r?.wxGroup || 0;
export const wxGroupCount = cfg => 1 + Math.max(0, ...cfg.resorts.map(wxGroupOf));
export const wxGroupCfg = (cfg, g) => ({ ...cfg, resorts: cfg.resorts.filter(r => wxGroupOf(r) === g) });

export function openMeteoUrl(cfg) {
  const lat = [], lon = [], elev = [];
  for (const r of cfg.resorts) {
    lat.push(r.lat, r.summitLat ?? r.lat); lon.push(r.lon, r.summitLon ?? r.lon); elev.push(r.baseElevM, r.summitElevM);
  }
  const p = new URLSearchParams({
    latitude: lat.join(','), longitude: lon.join(','), elevation: elev.join(','),
    hourly: HOURLY.join(','), daily: DAILY.join(','),
    timezone: cfg.resorts[0]?.tz || cfg.trip.timezone || 'America/Denver', forecast_days: '10',
    wind_speed_unit: 'kmh', temperature_unit: 'celsius', precipitation_unit: 'mm'
  });
  return `${cfg.sources.weather}?${p}`;
}

/** Map the Open-Meteo array response onto {resortId: {base, summit}}. */
export function splitOpenMeteo(cfg, json) {
  const arr = Array.isArray(json) ? json : [json];
  const out = {};
  cfg.resorts.forEach((r, i) => {
    const base = arr[i * 2], summit = arr[i * 2 + 1];
    if (base && summit && base.hourly && summit.hourly) out[r.id] = { base, summit };
  });
  return out;
}

/**
 * Snow-to-liquid ratio estimate (Kuchera method) from the warmest temperature
 * in the snow-growth column. Open-Meteo's own snowfall uses a fixed ~7:1 ratio,
 * so we estimate a temperature-dependent ratio instead.
 */
export function kucheraRatio(tMaxC) {
  if (tMaxC == null || Number.isNaN(tMaxC)) return null;
  const tK = tMaxC + 273.15;
  const r = tK <= 271.16 ? 12 + 2 * (271.16 - tK) : 12 + (271.16 - tK);
  return Math.max(3, Math.min(25, r));
}

function columnMax(h, i, includeT700) {
  const vals = [h.temperature_2m?.[i], h.temperature_600hPa?.[i], h.temperature_500hPa?.[i]];
  if (includeT700) vals.push(h.temperature_700hPa?.[i]);
  const v = vals.filter(x => typeof x === 'number');
  return v.length ? Math.max(...v) : null;
}

/** Derived hourly rows for one point. */
export function hourlyRows(point, resort) {
  const h = point.hourly; const rows = [];
  const incl700 = resort.baseElevM < 2900;
  for (let i = 0; i < h.time.length; i++) {
    const precip = h.precipitation?.[i] ?? null;
    const liquid = (h.rain?.[i] ?? 0) + (h.showers?.[i] ?? 0);
    const swe = precip == null ? null : Math.max(0, precip - liquid);
    const ratio = swe > 0 ? kucheraRatio(columnMax(h, i, incl700)) : null;
    rows.push({
      time: h.time[i], t: h.temperature_2m?.[i], feels: h.apparent_temperature?.[i],
      precip, swe, snowModel: h.snowfall?.[i] ?? null,
      snowEst: swe != null && ratio != null ? swe * ratio / 10 : (swe === 0 ? 0 : null),
      ratio, fzl: h.freezing_level_height?.[i] ?? null,
      wind: h.wind_speed_10m?.[i], gust: h.wind_gusts_10m?.[i], code: h.weather_code?.[i], vis: h.visibility?.[i]
    });
  }
  return rows;
}

/** Daily summary combining base + summit points. */
export function dailyRows(wx, resort) {
  const { base, summit } = wx;
  const bh = hourlyRows(base, resort), sh = hourlyRows(summit, resort);
  const days = base.daily.time.map((date, d) => {
    const pick = rows => rows.filter(r => r.time.startsWith(date));
    const bs = pick(bh), ss = pick(sh);
    const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
    const fz = ss.map(r => r.fzl).filter(v => v != null);
    const swe = sum(ss, 'swe');
    const est = sum(ss, 'snowEst');
    return {
      date,
      code: summit.daily.weather_code?.[d] ?? base.daily.weather_code?.[d],
      base: {
        tMax: base.daily.temperature_2m_max?.[d], tMin: base.daily.temperature_2m_min?.[d],
        feelsMin: base.daily.apparent_temperature_min?.[d], feelsMax: base.daily.apparent_temperature_max?.[d],
        snow: base.daily.snowfall_sum?.[d], precip: base.daily.precipitation_sum?.[d],
        gust: base.daily.wind_gusts_10m_max?.[d]
      },
      summit: {
        tMax: summit.daily.temperature_2m_max?.[d], tMin: summit.daily.temperature_2m_min?.[d],
        feelsMin: summit.daily.apparent_temperature_min?.[d], feelsMax: summit.daily.apparent_temperature_max?.[d],
        snow: summit.daily.snowfall_sum?.[d], precip: summit.daily.precipitation_sum?.[d],
        gust: summit.daily.wind_gusts_10m_max?.[d], wind: summit.daily.wind_speed_10m_max?.[d]
      },
      uv: summit.daily.uv_index_max?.[d],
      fzlMin: fz.length ? Math.min(...fz) : null,
      fzlMax: fz.length ? Math.max(...fz) : null,
      // Snow line is typically ~300 m below the freezing level.
      snowLineMin: fz.length ? Math.max(0, Math.min(...fz) - 300) : null,
      snowLineMax: fz.length ? Math.max(0, Math.max(...fz) - 300) : null,
      // Lowest model visibility at the summit during lift hours (9 AM–4 PM local), metres.
      visMin: (() => { const v = ss.filter(r => { const h = +r.time.slice(11, 13); return h >= 9 && h <= 16; }).map(r => r.vis).filter(x => x != null); return v.length ? Math.min(...v) : null; })(),
      swe, snowEst: est,
      ratio: swe > 0.2 ? est * 10 / swe : null,
      ratioModel: swe > 0.2 && summit.daily.snowfall_sum?.[d] != null ? summit.daily.snowfall_sum[d] * 10 / swe : null
    };
  });
  return days;
}

export function weatherEmoji(code) {
  if (code == null) return '·';
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code === 85 || code === 86) return '❄️';
  if (code >= 95) return '⛈️';
  return '·';
}

/* ---------------- Roads (CDOT COtrip / CARS) ---------------- */

export function carsUrl(cfg, cls) {
  return `${cfg.sources.cars}/events/map-features?eventClassifications=${cls}`;
}

function stripHtml(s) { return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }

function boundsOf(f) {
  const b = f.properties?.eventReport?.bounds;
  if (b && b.minLat != null) return [b.minLon, b.minLat, b.maxLon, b.maxLat];
  // fall back to geometry
  const pts = [];
  const walk = c => { if (typeof c[0] === 'number') pts.push(c); else c.forEach(walk); };
  if (f.geometry?.coordinates) walk(f.geometry.coordinates);
  if (!pts.length) return null;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Keep only the fields the UI needs; tag each event with the segments it touches. */
export function slimEvents(cfg, cls, json) {
  const out = [];
  for (const f of (json?.features || [])) {
    const p = f.properties || {};
    const bb = boundsOf(f);
    const route = p.route || (p.title || '').split(':')[0];
    const segs = [];
    for (const [id, s] of Object.entries(cfg.segments)) {
      if (!bb) continue;
      const routeOk = s.routes.some(r => route && route.replace(/-/g, ' ').toUpperCase() === r.replace(/-/g, ' ').toUpperCase());
      const hit = bb[0] <= s.bbox[2] && bb[2] >= s.bbox[0] && bb[1] <= s.bbox[3] && bb[3] >= s.bbox[1];
      if (routeOk && hit) segs.push(id);
    }
    // Keep every event (dynamic routes match by geometry); `geo` = up to 40 sampled [lon,lat] points.
    const pts = [];
    const walk = c => { if (typeof c[0] === 'number') pts.push([+c[0].toFixed(4), +c[1].toFixed(4)]); else c.forEach(walk); };
    if (f.geometry?.coordinates) walk(f.geometry.coordinates);
    const step = Math.max(1, Math.ceil(pts.length / 40));
    const geo = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
    if (!segs.length && !geo.length) continue;
    const er = p.eventReport?.eventDescription || {};
    out.push({
      id: p.id, cls, segs, route, geo,
      title: p.title || er.descriptionHeader || p.tooltip,
      tooltip: p.tooltip || '',
      detail: stripHtml(p.description || er.descriptionFull).slice(0, 600),
      eventType: p.eventType || null, priority: p.priority ?? null, icon: p.icon || null,
      updated: p.updated || null, start: p.startTime?.time || null
    });
  }
  return out;
}

/** Classify a chain-law event. */
export function chainLevel(ev) {
  const s = `${ev.title} ${ev.tooltip} ${ev.detail}`.toLowerCase();
  if (/\br-3\b/.test(s)) return 'nogo'; // Caltrans R-3: chains on every vehicle, no exceptions
  if (/\br-[12]\b/.test(s)) return 'caution'; // Caltrans R-1 / R-2 chain controls
  if (/code\s*16|passenger vehicle chain law|chain law for all/.test(s)) return 'nogo';
  if (/code\s*15|traction law/.test(s)) return 'caution';
  if (/commercial|code\s*1[89]/.test(s)) return 'info';
  return 'caution';
}

const WINTER_BAD = /(icy|ice|snow ?packed|snow covered|blowing snow|drifting|poor visibility|slushy|black ice|whiteout|closed)/i;

/* ---------------- Roads (UDOT, Utah) ---------------- */

/** Keyless ArcGIS UDOT events query URL (layer 0, point geometry, ~87 active features). */
export function utahCarsUrl(cfg) {
  const fields = ['OBJECTID', 'RoadwayName', 'EventType', 'EventCategory', 'Description', 'DirectionOfTravel', 'IsFullClosure',
    'LanesAffected', 'MPStart', 'MPEnd', 'StartDate', 'PlannedEndDate', 'LastUpdated', 'Reported', 'Name'];
  const q = new URLSearchParams({ where: '1=1', outFields: fields.join(','), returnGeometry: 'true', f: 'json' });
  return `${cfg.sources.udotEvents}/0/query?${q}`;
}

/** Keyed ibi511 UDOT Traffic API URL. Throttle: 10 calls / 60 s — callers must stay well under it. */
export function utahKeyedUrl(cfg, key, resource, version = 2) {
  return `${cfg.sources.udot}/api/v${version}/get/${resource}?key=${encodeURIComponent(key)}`;
}

const UDOT_ALIASES = {
  'big cottonwood canyon road': 'SR-190', 'little cottonwood canyon road': 'SR-210', 'belt route': 'I-215',
  'dwight d. eisenhower highway': 'I-80', 'united states highway 89': 'US-89', 'united states highway 189': 'US-189',
  'united states highway 40': 'US-40', 'wasatch boulevard': 'SR-190', '6200 south': 'SR-190'
};
/** One RoadwayName token -> canonical route number ('I 84' -> 'I-84', 'Big Cottonwood Canyon Road' -> 'SR-190'). */
function normUtahRoad(s) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const low = t.toLowerCase();
  if (UDOT_ALIASES[low]) return UDOT_ALIASES[low];
  const m = low.match(/^(i|us|sr)\s+(\d+[a-z]?)$/);
  if (m) return `${m[1].toUpperCase()}-${m[2]}`;
  return t;
}
const sameRoad = (a, b) => String(a || '').replace(/-/g, ' ').toUpperCase() === String(b || '').replace(/-/g, ' ').toUpperCase();
/** Segment ids an event touches: route-name match AND point/polygon inside the segment bbox.
 *  Events with no usable road name are tagged only when the point falls in exactly one segment bbox.
 *  With `routeOnly` (road-condition segments, whose RoadwayName names the road authoritatively),
 *  a route-name match alone is enough when there is no geometry to check against. */
function utahSegIds(cfg, tokens, lon, lat, bbox, { routeOnly = false } = {}) {
  const ids = [];
  const b = bbox || (lon != null && lat != null ? [lon, lat, lon, lat] : null);
  for (const [id, s] of Object.entries(cfg.segments)) {
    if (!b) {
      if (routeOnly && tokens.length && s.routes.some(r => tokens.some(tk => sameRoad(tk, r)))) ids.push(id);
      continue;
    }
    const hit = b[0] <= s.bbox[2] + 0.001 && b[2] >= s.bbox[0] - 0.001 && b[1] <= s.bbox[3] + 0.001 && b[3] >= s.bbox[1] - 0.001;
    if (!hit) continue;
    if (!tokens.length) { ids.push(id); continue; }
    if (s.routes.some(r => tokens.some(tk => sameRoad(tk, r)))) ids.push(id);
  }
  if (!tokens.length) return ids.length === 1 ? ids : [];
  return ids;
}

/** Decode a UDOT (Google polyline, precision 5) string; null when it does not decode to Utah coords. */
function decodeUtahPolyline(str) {
  try {
    const f = 1e5, out = [];
    let i = 0, lat = 0, lon = 0;
    while (i < str.length) {
      for (const which of [0, 1]) {
        let b, shift = 0, res = 0;
        do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const d = (res & 1) ? ~(res >> 1) : (res >> 1);
        if (which === 0) lat += d; else lon += d;
      }
      out.push([+(lon / f).toFixed(4), +(lat / f).toFixed(4)]);
    }
    if (!out.length || out.some(p => p[0] < -113 || p[0] > -110 || p[1] < 39 || p[1] > 43)) return null;
    return out;
  } catch { return null; }
}
const sampleGeo = pts => {
  if (!pts?.length) return [];
  const step = Math.max(1, Math.ceil(pts.length / 40));
  return pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
};
const dirWord = d => ({ EB: 'eastbound', WB: 'westbound', NB: 'northbound', SB: 'southbound' }[String(d || '').toUpperCase()] || '');

/**
 * Normalize UDOT events into the slim event shape the frontend expects
 * ({id, cls, segs, route, geo, title, tooltip, detail, eventType, priority, icon, updated, start}).
 * Accepts the keyless ArcGIS feed ({features:[{attributes, geometry}]}) or the keyed ibi511 /event
 * list ([{ID, EventType, ...}]) when `keyed` is set. Bucket mapping: full closure -> roadClosures;
 * accidentsAndIncidents -> roadReports (incident); roadwork -> roadReports with eventType 'routine'
 * (so the verdict treats it as minor); Road Weather -> winterDriving. The feed carries no chain /
 * traction-law type, so cls is never 'chainLaws' here — chain status comes from roadconditions.
 */
export function slimUtahEvents(cfg, json, { keyed = false } = {}) {
  const rows = keyed ? (Array.isArray(json) ? json : []) : (json?.features || []).map(f => ({ ...(f.attributes || {}), _x: f.geometry?.x, _y: f.geometry?.y }));
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    // ArcGIS only returns OBJECTID when it is in outFields; fall back to the row index so an
    // upstream field change degrades to unstable ids instead of dropping every event.
    const oid = keyed ? a.ID : (a.OBJECTID ?? `arc-${i}`);
    if (oid == null) continue;
    const full = keyed ? a.IsFullClosure === true : String(a.IsFullClosure || '').toLowerCase() === 'true';
    const et = a.EventType || '', cat = a.EventCategory || '';
    const cls = full || et === 'closures' ? 'roadClosures'
      : et === 'accidentsAndIncidents' ? 'roadReports'
      : cat === 'Road Weather' ? 'winterDriving' : 'roadReports';
    const tokens = String(a.RoadwayName || '').split(',').map(normUtahRoad).filter(Boolean);
    if (a.Name) tokens.push(normUtahRoad(a.Name));
    const desc = String(a.Description || '');
    for (const m of desc.matchAll(/\b(?:SR|US|I)[- ]?\d+[A-Z]?\b/gi)) tokens.push(normUtahRoad(m[0]));
    const route = tokens[0] || (a.Name ? String(a.Name) : '');
    const lon = keyed ? a.Longitude : a._x, lat = keyed ? a.Latitude : a._y;
    let geo = [], bbox = null;
    if (keyed && Array.isArray(a.EncodedPolyline) && a.EncodedPolyline.length) {
      const pts = decodeUtahPolyline(a.EncodedPolyline[0]);
      if (pts) { geo = sampleGeo(pts); const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
    }
    if (!geo.length && lon != null && lat != null) geo = [[+lon.toFixed(4), +lat.toFixed(4)]];
    if (!geo.length) continue;
    const segs = utahSegIds(cfg, [...new Set(tokens)], lon, lat, bbox);
    if (!segs.length && !geo.length) continue;
    const title = (desc.split('\n')[0] || a.Name || cat || 'UDOT event').trim();
    const detail = [desc, a.Comment && a.Comment !== desc ? a.Comment : ''].filter(Boolean).join('\n').slice(0, 600);
    const toMs = s => (typeof s === 'number' && s > 0 ? (s < 1e12 ? s * 1000 : s) : null);
    out.push({
      id: `udot-${oid}`, cls, segs, route, geo,
      title, tooltip: dirWord(a.DirectionOfTravel),
      detail: stripHtml(detail),
      eventType: et === 'roadwork' ? 'routine' : null, priority: null, icon: null,
      updated: toMs(a.LastUpdated), start: toMs(a.StartDate)
    });
  }
  return out;
}

/* ---------- Caltrans (California) — CWWP2 keyless JSON, parallel to the Utah collector ---------- */
export const CA_DISTRICTS = ['3', '8', '9', '10'];
export function caRoadsUrl(district, feed) {
  const p = String(district).padStart(2, '0');
  return `https://cwwp2.dot.ca.gov/data/d${district}/${feed}/${feed}StatusD${p}.json`;
}
/** "YYYY-MM-DD" + "HH:MM:SS" in America/Los_Angeles (the feed carries no zone marker) -> epoch ms. */
function pacificEpoch(dateStr, timeStr) {
  const [y, mo, d] = String(dateStr || '').split('-').map(Number);
  const [h, mi, s] = String(timeStr || '').split(':').map(Number);
  if (!y || !mo || !d) return null;
  const guess = Date.UTC(y, mo - 1, d, h || 0, mi || 0, s || 0);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map(p => [p.type, p.value]));
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return guess - (asUTC - guess);
}
/**
 * Normalize Caltrans CWWP2 chain controls (cc) + lane closures (lcs) into the slim event shape.
 * `cc`/`lcs` are the `data` arrays from the district files (each entry wrapped: {cc:{...}} / {lcs:{...}}).
 * Chain controls carry real levels R-0..R-3: R-0 means no controls (dropped — absence of a chain event
 * is the all-clear here, unlike Utah where chain status is genuinely unreported). Lane closures are
 * filtered to ones active at `nowS`; planned future closures are not "should I go today" data.
 */
export function slimCaEvents(cfg, { cc = [], lcs = [] } = {}, nowS = Date.now() / 1000) {
  const out = [];
  const toMs = v => { const n = typeof v === 'string' ? +v : v; return (typeof n === 'number' && n > 0) ? (n < 1e12 ? n * 1000 : n) : null; };
  const where = (a, b) => { const s = [a, b].filter(Boolean).join(' → '); return s ? ` (${s})` : ''; };
  for (const w of cc) {
    const a = w?.cc; if (!a) continue;
    const st = a.statusData?.status;
    if (a.inService !== 'true' || !st || st === 'R-0') continue;
    const loc = a.location || {};
    const lon = parseFloat(loc.longitude), lat = parseFloat(loc.latitude);
    const route = String(loc.route || '');
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !route) continue;
    const segs = utahSegIds(cfg, [route], lon, lat, null);
    const sd = a.statusData || {};
    const start = sd.statusTimestamp ? pacificEpoch(sd.statusTimestamp.statusDate, sd.statusTimestamp.statusTime) : null;
    // "ROAD CLOSED" is a seasonal pass closure, not a chain control: it belongs in roadClosures
    // (a full closure can no-go a leg) rather than chainLaws (which only ever cautions).
    const closed = /closed/i.test(st);
    out.push({ id: `ca-cc-${a.index}`, cls: closed ? 'roadClosures' : 'chainLaws', segs, route, geo: [[+lon.toFixed(4), +lat.toFixed(4)]],
      title: closed ? `Full closure — ${route}${loc.locationName ? ` (${loc.locationName})` : ''}`
        : `Chain control ${st} — ${route}${loc.locationName ? ` (${loc.locationName})` : loc.nearbyPlace ? ` (${loc.nearbyPlace})` : ''}`,
      tooltip: '', detail: [sd.statusDescription, loc.direction ? `${loc.direction}bound` : '', loc.postmile ? `postmile ${loc.postmile}` : ''].filter(Boolean).join(' · '),
      eventType: null, priority: null, icon: null, updated: toMs(a.recordTimestamp?.recordEpoch), start });
  }
  for (const w of lcs) {
    const a = w?.lcs; if (!a) continue;
    // Rest-area closures are not road closures for a driver: skip them (facility "Rest Area"
    // or a rest-area name on either end) so they never caution a route.
    const loc = a.location || {}, b = loc.begin || {}, e = loc.end || {};
    if (a.closure?.facility === 'Rest Area' || /rest area/i.test(`${b.beginLocationName || ''} ${e.endLocationName || ''}`)) continue;
    const ct = a.closure?.closureTimestamp || {};
    const start = toMs(ct.closureStartEpoch), end = ct.isClosureEndIndefinite === 'true' ? null : toMs(ct.closureEndEpoch);
    if (start == null || start / 1000 > nowS || (end != null && end / 1000 < nowS)) continue;
    const blon = parseFloat(b.beginLongitude), blat = parseFloat(b.beginLatitude), elon = parseFloat(e.endLongitude), elat = parseFloat(e.endLatitude);
    const route = String(b.beginRoute || '');
    if (!route || !Number.isFinite(blon) || !Number.isFinite(blat)) continue;
    const geo = [[+blon.toFixed(4), +blat.toFixed(4)]];
    if (Number.isFinite(elon) && Number.isFinite(elat)) geo.push([+elon.toFixed(4), +elat.toFixed(4)]);
    // Segment match by the closure's midpoint, not its bounding box: a closure that merely
    // overlaps a segment's bbox (e.g. the winter-closed north half of the SR-158 loop) must
    // not flag the resort approach on the other side of it. The dynamic route path matches
    // by geometry anyway; this is only the static fallback.
    const mLon = geo.length > 1 ? (geo[0][0] + geo[1][0]) / 2 : geo[0][0];
    const mLat = geo.length > 1 ? (geo[0][1] + geo[1][1]) / 2 : geo[0][1];
    const segs = utahSegIds(cfg, [route], mLon, mLat, null);
    const toc = a.closure?.typeOfClosure || '';
    const kind = toc === 'Full' ? 'Full closure' : toc === 'Lane' ? 'Lane closed' : (toc || 'Road work');
    out.push({ id: `ca-lcs-${a.index}`, cls: 'roadClosures', segs, route, geo,
      title: `${kind} — ${route}${where(b.beginLocationName, e.endLocationName)}`,
      tooltip: loc.travelFlowDirection || '',
      detail: [a.closure?.typeOfWork, a.closure?.lanesClosed ? `${a.closure.lanesClosed} lane(s) closed` : ''].filter(Boolean).join(' · '),
      eventType: null, priority: null, icon: null, updated: toMs(a.recordTimestamp?.recordEpoch), start, end });
  }
  return out;
}

/* ---------- Northeast roads — Compass C2C (VT/NH/ME), 511NY CARS (NY), MassDOT ERS (MA) ---------- */
// No single feed covers the Northeast, so the worker keeps three sources (ne-roads, ny-roads,
// ma-roads) and the page merges them into one slot. None of the three reports chain / traction
// law (zero hits for "chain"/"traction" in every live feed file), so no NE event ever carries
// cls 'chainLaws' — the chain display reads "Not reported in the Northeast" (see verdictFor).
// Every NE slim event carries `src` ('ne' | 'ny' | 'ma') so the UI can name its feed.

/** C2C / ERS XML is parsed with small tag extractors — neither the Worker nor the Node backup has a DOMParser. */
function xmlDecode(s) { return String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
function xmlTag(xml, tag) { const m = String(xml || '').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`)); return m ? xmlDecode(m[1].trim()) : ''; }
function xmlAttr(tagStr, attr) { const m = String(tagStr || '').match(new RegExp(`${attr}="([^"]*)"`)); return m ? m[1] : ''; }
function xmlRecords(xml, tag) { const out = []; const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, 'g'); let m; while ((m = re.exec(String(xml || '')))) out.push({ attrs: m[1], body: m[2] }); return out; }
/** ISO timestamps with over-long fractions (C2C emits 7 digits) -> epoch ms; null when unparseable. */
function parseIsoTs(s) { if (!s) return null; const t = Date.parse(String(s).replace(/(\.\d{3})\d+/, '$1')); return Number.isFinite(t) ? t : null; }
/** Integer microdegrees (C2C) -> decimal degrees. */
const udeg = s => { const n = parseInt(String(s || '').replace(/[^0-9-]/g, ''), 10); return Number.isFinite(n) ? n / 1e6 : null; };
/** "2026-11-25 at 09:00" in America/New_York (MassDOT ERS) -> epoch ms; falls back to ISO parse. */
function easternEpoch(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})\s+at\s+(\d{1,2}):(\d{2})/);
  if (!m) return parseIsoTs(s);
  const [, y, mo, d, h, mi] = m;
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map(p => [p.type, p.value]));
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return guess - (asUTC - guess);
}
/** Canonical route number: 'NH 135' / 'US 4' / 'VT-31' -> 'NH-135' / 'US-4' / 'VT-31'. */
function normNeRoad(s) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  const m = t.match(/^(I|US|SR|VT|NH|ME|MA|NY)\s*-?\s*(\d+[A-Z]?)$/i);
  return m ? `${m[1].toUpperCase()}-${m[2].toUpperCase()}` : t;
}
/** Route tokens out of free text: 'I-89 SB in Royalton', 'Fore River Bridge (3A)' -> ['I-89'], ['MA-3A']. */
function neRouteTokens(s) {
  const out = [];
  for (const m of String(s || '').matchAll(/\b(?:I|US|SR|VT|NH|ME|MA|NY)[- ]?\d+[A-Z]?\b/gi)) out.push(normNeRoad(m[0]));
  const paren = String(s || '').match(/\((\d+[A-Z]?)\)/);
  if (paren) out.push(`MA-${paren[1]}`);
  return out;
}
const c2cDir = d => { const t = String(d || '').trim(); if (!t) return ''; return /^[NSEW]B$/i.test(t) ? dirWord(t) : `${t.toLowerCase()}bound`; };
const firstLine = s => String(s || '').split('\n')[0].trim();

export const C2C_NETWORKS = 'Vermont,NewHampshire,Maine';
/** Compass C2C: one call per dataType — a combined dataTypes list is unverified. Keyless XML. */
export function c2cUrl(dataType) {
  return `https://nec-por.ne-compass.com/NEC.XmlDataPortal/api/c2c?networks=${C2C_NETWORKS}&dataTypes=${dataType}`;
}
/** 511NY CARS: closures carry the site config's maxBeginDateOffset; winter/incidents take no extra params. Keyless GeoJSON. */
export function ny511Url(cls) {
  const base = 'https://api-511x-nysdot.carsprogram.org/events/map-features';
  return cls === 'closures' ? `${base}?eventClassifications=closures&maxBeginDateOffset=300000` : `${base}?eventClassifications=${cls}`;
}
/** MassDOT Planned Roadway Events XML (ERS). Plain HTTP — the HTTPS variant is unverified. */
export function massdotUrl() { return 'http://events.massdot.evbg.net/'; }

/**
 * Normalize C2C incidentData + laneClosureData into the slim event shape.
 * Incidents are roadReports (the feed holds ~5 across three states). Lane closures are
 * roadClosures, but only when a lane is still Blocked: a reopened road has every lane Cleared,
 * while a live restriction (seasonal closure, crossover, one-lane bridge) still blocks one.
 * Without an affectedLanesDetail block the record is kept. Geometry: start/end points for
 * incidents, start + midpoint polyline + end for closures (sampled to 40 pts).
 */
export function slimNeEvents(cfg, incidentXml, closureXml) {
  const out = [];
  const loc = (body, which) => {
    const b = xmlTag(body, which);
    return { roadway: xmlTag(b, 'roadway'), dir: xmlTag(b, 'direction'), city: xmlTag(b, 'city'),
      lat: udeg(xmlTag(b, 'lat')), lon: udeg(xmlTag(b, 'lon')) };
  };
  for (const rec of xmlRecords(incidentXml, 'incident')) {
    const b = rec.body, s = loc(b, 'startLocation'), e = loc(b, 'endLocation');
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const desc = xmlTag(b, 'desc');
    const tokens = [...new Set([normNeRoad(s.roadway), ...neRouteTokens(desc)].filter(Boolean))];
    const geo = [[+s.lon.toFixed(4), +s.lat.toFixed(4)]];
    if (Number.isFinite(e.lat) && Number.isFinite(e.lon)) geo.push([+e.lon.toFixed(4), +e.lat.toFixed(4)]);
    const segs = utahSegIds(cfg, tokens, s.lon, s.lat, null);
    out.push({ id: `c2c-${xmlAttr(rec.attrs, 'id') || `inc-${out.length}`}`, cls: 'roadReports', segs,
      route: tokens[0] || '', geo,
      title: firstLine(desc) || `Incident — ${s.roadway || 'Tri-State'}`,
      tooltip: c2cDir(s.dir),
      detail: [desc, [s.city, e.city].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' → ')].filter(Boolean).join(' · ').slice(0, 600),
      eventType: null, priority: null, icon: null,
      updated: parseIsoTs(xmlTag(b, 'lastUpdatedTimestamp')), start: parseIsoTs(xmlTag(b, 'createdTimestamp')), src: 'ne' });
  }
  for (const rec of xmlRecords(closureXml, 'laneClosure')) {
    const b = rec.body;
    // NOTE: <status> carries no signal here — live closures (VT-108 Smugglers Notch seasonal
    // closure, VT-65 floating bridge, the I-89 Royalton crossover) all read "Opened". The
    // discriminator is the lane state: a reopened road (Frank J. Wood Bridge) has every lane
    // Cleared, a live restriction still has a Blocked lane.
    const ald = xmlTag(b, 'affectedLanesDetail');
    if (ald && !/status="Blocked"/.test(ald)) continue; // every lane cleared
    const s = loc(b, 'startLocation'), e = loc(b, 'endLocation');
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const desc = xmlTag(b, 'desc');
    const tokens = [...new Set([normNeRoad(s.roadway), ...neRouteTokens(desc)].filter(Boolean))];
    const pts = [[s.lon, s.lat]];
    for (const p of xmlRecords(xmlTag(b, 'midpoints'), 'point')) {
      const la = udeg(xmlTag(p.body, 'lat')), lo = udeg(xmlTag(p.body, 'lon'));
      if (Number.isFinite(la) && Number.isFinite(lo)) pts.push([lo, la]);
    }
    if (Number.isFinite(e.lat) && Number.isFinite(e.lon)) pts.push([e.lon, e.lat]);
    const geo = sampleGeo(pts.map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]));
    // Segment match by the closure's midpoint, not its bounding box: a closure that merely
    // overlaps a segment's bbox must not flag the resort approach on the other side of it.
    // (Same rule as slimCaEvents: the VT-108 Smugglers Notch seasonal closure's southern tip
    // touches the Stowe access segment, but its midpoint is in the Notch — it must not nogo Stowe.)
    const mLon = (pts[0][0] + pts[pts.length - 1][0]) / 2, mLat = (pts[0][1] + pts[pts.length - 1][1]) / 2;
    const segs = utahSegIds(cfg, tokens, mLon, mLat, null);
    const full = /road closed|closed to (all )?traffic|full closure|is closed for/i.test(desc);
    const where = [s.city, e.city].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' → ');
    out.push({ id: `c2c-${xmlAttr(rec.attrs, 'id') || `lc-${out.length}`}`, cls: 'roadClosures', segs,
      route: tokens[0] || '', geo,
      title: `${full ? 'Road closed' : 'Lane closed'} — ${tokens[0] || s.roadway || 'Tri-State'}${where ? ` (${where})` : ''}`,
      tooltip: c2cDir(s.dir),
      detail: desc.slice(0, 600),
      eventType: null, priority: null, icon: null,
      updated: parseIsoTs(xmlTag(b, 'lastUpdatedTimestamp')), start: parseIsoTs(xmlTag(b, 'createdTimestamp')), src: 'ne' });
  }
  return out;
}

// Ski-corridor routes for the NY winter filter (§1.7 note 5): the report's list plus every route
// the NE segments already name. The raw winter file is 18.4 MB / 495 features per tick, so the
// corridor + condition filter runs before the KV write, never after.
const NY_CORRIDOR_EXTRA = ['I-87', 'NY 86', 'NY 73', 'NY 28', 'NY 30', 'I-90', 'NY 8', 'NY 12', 'NY 9N'];
/** NY winter condition codes (category 57): 2 clear/dry, 3 wet, 4 snow/ice. Codes 1 (update pending)
 *  and 26 (no active reporting, 411 of 495) mean unknown — never "clear" — so they are dropped. */
const NY_WINTER_OK = { 2: 'Generally Clear and Dry', 3: 'Wet', 4: 'Snow/Ice' };
/**
 * Normalize 511NY closures + winter driving + incidents into the slim event shape.
 * Closures/incidents: active only (the files carry inactive records, some from 2024).
 * Winter: corridor routes + real conditions only (see NY_WINTER_OK); geometry is the full
 * MultiLineString polyline, sampled to 40 points, and the segment match uses its bbox.
 */
export function slimNyEvents(cfg, { closures = {}, winter = {}, incidents = {} } = {}) {
  const out = [];
  const toMs = v => (typeof v === 'number' && v > 0 ? v : null);
  const geoOf = f => {
    const pts = [];
    const walk = c => { if (typeof c[0] === 'number') pts.push([+c[0].toFixed(4), +c[1].toFixed(4)]); else c.forEach(walk); };
    if (f.geometry?.coordinates) walk(f.geometry.coordinates);
    return pts;
  };
  const corridor = new Set([...Object.values(cfg.segments).flatMap(s => s.routes), ...NY_CORRIDOR_EXTRA].map(normNeRoad));
  for (const f of (closures.features || [])) {
    const p = f.properties || {};
    if (p.active !== true) continue;
    const route = normNeRoad(p.route || (p.title || '').split(':')[0]);
    const pts = geoOf(f);
    const bb = boundsOf(f);
    const segs = utahSegIds(cfg, route ? [route] : [], null, null, bb);
    if (!segs.length && !pts.length) continue;
    out.push({ id: `ny-${p.id}`, cls: 'roadClosures', segs, route, geo: sampleGeo(pts),
      title: p.title || p.tooltip || `Road closure — ${route}`,
      tooltip: p.tooltip || '',
      detail: stripHtml(p.description || '').slice(0, 600),
      eventType: p.eventType || null, priority: p.priority ?? null, icon: p.icon || null,
      updated: toMs(p.updated), start: toMs(p.startTime?.time), src: 'ny' });
  }
  for (const f of (winter.features || [])) {
    const p = f.properties || {};
    const code = p.eventReport?.headlinePhrase?.code;
    if (!(code in NY_WINTER_OK) || p.active !== true) continue;
    const route = normNeRoad(p.route || p.eventReport?.location?.routeDesignator || '');
    if (!route || !corridor.has(route)) continue; // outside the ski corridors — dropped before storage
    const pts = geoOf(f);
    const bb = boundsOf(f);
    const segs = utahSegIds(cfg, [route], null, null, bb);
    if (!segs.length && !pts.length) continue;
    out.push({ id: `ny-w-${p.id}`, cls: 'winterDriving', segs, route, geo: sampleGeo(pts),
      title: p.title || `${route}: ${NY_WINTER_OK[code]}.`,
      tooltip: p.tooltip || '',
      detail: '',
      eventType: p.eventType || null, priority: p.priority ?? null, icon: p.icon || null,
      updated: toMs(p.updated), start: toMs(p.eventReport?.beginTime?.time), src: 'ny' });
  }
  for (const f of (incidents.features || [])) {
    const p = f.properties || {};
    if (p.active !== true) continue;
    const route = normNeRoad(p.route || (p.title || '').split(':')[0]);
    const pts = geoOf(f);
    const bb = boundsOf(f);
    const segs = utahSegIds(cfg, route ? [route] : [], null, null, bb);
    if (!segs.length && !pts.length) continue;
    out.push({ id: `ny-i-${p.id}`, cls: 'roadReports', segs, route, geo: sampleGeo(pts),
      title: p.title || p.tooltip || `Incident — ${route}`,
      tooltip: p.tooltip || '',
      detail: stripHtml(p.description || '').slice(0, 600),
      eventType: p.eventType || null, priority: p.priority ?? null, icon: p.icon || null,
      updated: toMs(p.updated), start: toMs(p.startTime?.time), src: 'ny' });
  }
  return out;
}

/**
 * Normalize MassDOT ERS planned roadway events into the slim event shape. The feed is thin
 * (2 events at probe time) and MA is drive-through only for every NE resort, so events match
 * by point/bbox and mostly carry no segment. RoadwayName is free text ("Fore River Bridge (3A)");
 * only Open events inside their window count — planned future lifts are not today's drive data.
 */
export function slimMaEvents(cfg, xml, nowMs = Date.now()) {
  const out = [];
  for (const rec of xmlRecords(xml, 'Event')) {
    const b = rec.body;
    if (!/open/i.test(xmlTag(b, 'EventStatus'))) continue;
    const start = easternEpoch(xmlTag(b, 'EventStartDate'));
    const end = easternEpoch(xmlTag(b, 'EventEndDate'));
    if (start != null && start > nowMs) continue;
    if (end != null && end < nowMs) continue;
    const lat = parseFloat(xmlTag(b, 'PrimaryLatitude')), lon = parseFloat(xmlTag(b, 'PrimaryLongitude'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const road = xmlTag(b, 'RoadwayName');
    const tokens = [...new Set(neRouteTokens(road))];
    const segs = utahSegIds(cfg, tokens, lon, lat, null);
    const sub = xmlTag(b, 'EventSubType'), lane = xmlTag(b, 'LaneBlockageDescription');
    out.push({ id: `ma-${xmlTag(b, 'EventId') || `ev-${out.length}`}`, cls: 'roadReports', segs,
      route: tokens[0] || road, geo: [[+lon.toFixed(4), +lat.toFixed(4)]],
      title: [sub, road].filter(Boolean).join(' — ') || `MassDOT event — ${road}`,
      tooltip: xmlTag(b, 'Direction'),
      detail: [xmlTag(b, 'LocationDescription'), lane].filter(Boolean).join(' · ').slice(0, 600),
      eventType: null, priority: null, icon: null,
      updated: parseIsoTs(xmlTag(b, 'LastUpdate')), start, src: 'ma' });
  }
  return out;
}

/* ---------- Rockies roads — WyoRoad (WY), MDT 511 (MT), Idaho 511 (ID), NMRoads (NM) ---------- */
// Four state feeds, no single source covers the Rockies. Every slim below returns {events} in the
// same shape slimCaEvents/slimNeEvents return ({id, cls, segs, route, geo, title, tooltip, detail,
// eventType, priority, icon, updated, start, src}), matched to segments by route name + bbox the
// same way utahSegIds does it. A non-200/empty upstream response means "unknown", never "clear" —
// the collectors throw in that case so mergeSource keeps the last good copy.
// Chain levels exist as data only in Wyoming (CL1/CL2 in the WyoRoad feed, rendered in WYDOT's
// words "Level 1/2"); MT/ID/NM have no live chain-level data, so no event from those states ever
// carries cls 'chainLaws' — the chain display reads "Not reported" there.

/** Google encoded polyline (precision 5) -> [[lon, lat], ...]; no geographic bounds check, so it
 *  works for any state (unlike decodeUtahPolyline, which rejects points outside Utah). */
function decodePolyline(str) {
  try {
    const out = [];
    let i = 0, lat = 0, lon = 0;
    while (i < str.length) {
      for (const which of [0, 1]) {
        let b, shift = 0, res = 0;
        do { b = str.charCodeAt(i++) - 63; res += (b & 0x1f) * 2 ** shift; shift += 5; } while (b >= 0x20);
        const d = (res % 2) ? -(Math.floor(res / 2)) - 1 : Math.floor(res / 2);
        if (which === 0) lat += d; else lon += d;
      }
      out.push([+(lon / 1e5).toFixed(4), +(lat / 1e5).toFixed(4)]);
    }
    return out.length ? out : null;
  } catch { return null; }
}
/** One or many encoded polylines (string, or the [string] arrays Idaho/Utah send) -> sampled geo. */
function polylineGeo(polys) {
  const list = Array.isArray(polys) ? polys : [polys];
  const pts = [];
  for (const p of list) { const d = typeof p === 'string' ? decodePolyline(p) : null; if (d) pts.push(...d); }
  return sampleGeo(pts);
}
/** Web Mercator metres (wkid 102100, as NMRoads sends them) -> [lon, lat] degrees. Never store
 *  the raw metre values as degrees — they land ~100x off in the wrong hemisphere. */
function fromWebMercator(x, y) {
  const R = 6378137;
  const lon = x / R * 180 / Math.PI;
  const lat = 180 / Math.PI * (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2);
  return [+lon.toFixed(4), +lat.toFixed(4)];
}
/** The segment route a token list actually matched (for the event's `route` label), else the first token. */
function matchedRoute(cfg, tokens) {
  for (const t of tokens) for (const s of Object.values(cfg.segments)) if (s.routes.some(r => sameRoad(r, t))) return t;
  return tokens[0] || '';
}

/* ----- Wyoming — WyoRoad map PBF (primary) + classic text pages (fallback) ----- */
// The map snapshot is XOR-obfuscated protobuf: every string field is base64, XORed with the key
// below (the map bundle's own X() function), then UTF-8. Field numbers are the bundle's
// ConditionsAttributes letters a..u = 1..21: 1 ROAD_CODE, 2 IMPACT_MAP, 3 CLOSURE_REASON,
// 4 CUSTOM_CLOSURE_REASON, 5 OPEN_MSG, 6 LOCT, 7 NTT, 8 FR, 9 EIGHT_CODES, 10 NINE_CODES,
// 11 WEIGHT, 12 WEIGHT_REASON, 13 WEIGHT_CUSTOM_REASON, 14 BI, 15 CL1, 16 CL2, 17 NLT, 18 NUT,
// 19 EBOR, 20 HAIL, 21 LAST_MODIFIED (Unix seconds). Impact letters (bundle's
// _processImpactConditions): L low, M medium, H high, P/D/I partial closure, C closed.
// Surface codes (field 9): 81 Dry, 82 Wet, 83 Slick, 84 Slick in Spots, 85 Drifted Snow,
// 810 Slush, anything else non-zero = multiple. Atmospheric codes (field 10): 91/0 none,
// 92 Snowfall, 93 Rain, 94 Strong Winds, 95 Fog, 96 Blowing Snow, 97 Reduced Visibility.
export const WYOROAD_XOR_KEY = 'EkhJp6wsgahsqkiw5nahFOSCwAND1zhZ';
export const WYOROAD_PBF_FILE = 'Msg-IynkRefv.pbf'; // current conditions filename; rotates on redeploy
export function wyoroadPbfUrl(filename = WYOROAD_PBF_FILE) {
  return `https://map.wyoroad.info/wti511map-data/${filename}`;
}
/** The conditions PBF filename, extracted from the map JS bundle: the bundle assigns
 *  `_conditionsURL=X(<VAR>)` and defines `<VAR>` as a backtick base64 string; XOR-decoding it
 *  yields the full URL. Returns null when the bundle no longer has that shape (the collector
 *  then keeps the last known filename and falls back to the text pages). */
export function wyoroadPbfFilename(bundleJs) {
  const s = String(bundleJs || '');
  const anchor = s.match(/_conditionsURL\s*=\s*X\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/);
  if (!anchor) return null;
  const def = s.match(new RegExp(`(?<![A-Za-z0-9_$])${anchor[1]}\\s*=\\s*\`([A-Za-z0-9+/]+={0,2})\``));
  if (!def) return null;
  const url = wyoroadXorDecode(def[1]);
  const m = url && url.match(/\/([^/]+\.pbf)$/);
  return m ? m[1] : null;
}
/** The bundle's X(): base64 -> XOR with the key -> UTF-8. Null when the input is not base64. */
export function wyoroadXorDecode(b64) {
  try {
    const raw = Uint8Array.from(atob(String(b64 || '')), c => c.charCodeAt(0));
    const key = new TextEncoder().encode(WYOROAD_XOR_KEY);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw[i] ^ key[i % key.length];
    return new TextDecoder().decode(out);
  } catch { return null; }
}
function pbfVarint(buf, i) {
  let res = 0, shift = 0;
  while (i < buf.length) {
    const b = buf[i++];
    res += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return [res, i];
    shift += 7;
    if (shift > 63) return [null, i];
  }
  return [null, i];
}
/** One protobuf message -> Map(field number -> varint value | length-delimited bytes). */
function pbfFields(buf) {
  const out = new Map();
  let i = 0;
  while (i < buf.length) {
    const [tag, ni] = pbfVarint(buf, i); i = ni;
    if (tag == null) break;
    const fn = Math.floor(tag / 8), wt = tag % 8;
    if (wt === 0) { const [v, nj] = pbfVarint(buf, i); i = nj; if (v == null) break; out.set(fn, v); }
    else if (wt === 2) { const [len, nj] = pbfVarint(buf, i); i = nj; if (len == null || nj + len > buf.length) break; out.set(fn, buf.slice(nj, nj + len)); i = nj + len; }
    else if (wt === 5) i += 4;
    else if (wt === 1) i += 8;
    else break;
  }
  return out;
}
/**
 * XOR-decode + minimal protobuf-parse of the WyoRoad conditions PBF into section records
 * ({code, impact, closureReason, customClosureReason, openMsg, loct, ntt, fr, eightCodes,
 * nineCodes, weight, weightReason, weightCustomReason, bi, cl1, cl2, nlt, nut, ebor, hail,
 * lastModified}). Dependency-free. Top level = repeated field-1 messages; a truncated tail is
 * dropped, not fatal. Verified live 2026-11-24: 437 records, e.g. JACKW22B (WY-22, impact P,
 * black ice + falling rock) and JACKW390B (WY-390, impact M, falling rock).
 */
export function decodeWyoPbf(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const recs = [];
  let i = 0;
  while (i < bytes.length) {
    const [tag, ni] = pbfVarint(bytes, i); i = ni;
    if (tag == null) break;
    if (Math.floor(tag / 8) !== 1 || tag % 8 !== 2) break;
    const [len, nj] = pbfVarint(bytes, i); i = nj;
    if (len == null || nj + len > bytes.length) break;
    const f = pbfFields(bytes.slice(nj, nj + len));
    i = nj + len;
    const str = n => {
      const raw = f.get(n);
      if (raw == null) return '';
      try { return wyoroadXorDecode(new TextDecoder().decode(raw)) ?? ''; } catch { return ''; }
    };
    const num = n => { const v = f.get(n); return typeof v === 'number' ? v : 0; };
    const code = str(1);
    if (!code) continue;
    recs.push({ code, impact: str(2), closureReason: str(3), customClosureReason: str(4), openMsg: str(5),
      loct: num(6), ntt: num(7), fr: num(8), eightCodes: num(9), nineCodes: num(10), weight: num(11),
      weightReason: str(12), weightCustomReason: str(13), bi: num(14), cl1: num(15), cl2: num(16),
      nlt: num(17), nut: num(18), ebor: num(19), hail: num(20), lastModified: num(21) });
  }
  return recs;
}
/** All ways to split a digit run into 2–3 digit route numbers ("26287" -> [26,287] and [262,87]). */
function wyDigitSplits(digits) {
  if (digits.length <= 3) return [[digits]];
  const out = [];
  const rec = (i, parts) => {
    if (i === digits.length) { if (parts.length > 1) out.push(parts); return; }
    for (const len of [2, 3]) if (i + len <= digits.length) rec(i + len, [...parts, digits.slice(i, i + len)]);
  };
  rec(0, []);
  return out.length ? out : [[digits]];
}
/**
 * Route tokens out of a WTI section code ("JACKW390B" -> ["WY-390"], "DUBUS26287WB" ->
 * ["US-26","US-287","US-262","US-87"], "JACK189191B" -> ["US-189","US-191","WY-189","WY-191"]).
 * The code is <town><route><direction/suffix>; prefixed runs (I/US/W/WYO + digits) keep their
 * prefix, bare digit runs get both US- and WY- candidates — the segment match in slimWyEvents
 * keeps only the tokens a corridor segment actually names, so the extra candidates are harmless.
 * Named sections with no route number ("JACKSNAKEB", Snake River Canyon) yield no tokens and
 * are dropped by the slim (no geometry to match by); the text fallback covers that stretch.
 */
export function wyRouteTokens(code) {
  const s = String(code || '').toUpperCase();
  const out = [];
  const add = (prefix, num) => { const r = `${prefix}-${num}`; if (!out.includes(r)) out.push(r); };
  const consumed = [];
  const pre = /(I|US|WYO|W)(\d{2,8})/g;
  let m;
  while ((m = pre.exec(s))) {
    const p = m[1] === 'W' || m[1] === 'WYO' ? 'WY' : m[1];
    consumed.push([m.index, m.index + m[0].length]);
    for (const parts of wyDigitSplits(m[2])) for (const n of parts) add(p, n);
  }
  const bare = /(\d{2,8})/g;
  while ((m = bare.exec(s))) {
    if (consumed.some(([a, b]) => m.index >= a && m.index < b)) continue;
    for (const parts of wyDigitSplits(m[1])) for (const n of parts) { add('US', n); add('WY', n); }
  }
  return out;
}
const WY_SURFACE = { 81: 'Dry', 82: 'Wet', 83: 'Slick', 84: 'Slick in Spots', 85: 'Drifted Snow', 810: 'Slush' };
const WY_ATMOS = { 92: 'Snowfall', 93: 'Rain', 94: 'Strong Winds', 95: 'Fog', 96: 'Blowing Snow', 97: 'Reduced Visibility' };
/**
 * Decoded WyoRoad conditions -> {events}. The PBF carries no geometry, so sections match by
 * route name only (routeOnly): a condition anywhere on US-89 flags every US-89 corridor segment,
 * the same granularity as the text fallback. Closures (impact C/D/I or a closure reason) are
 * roadClosures; partial closures (P) are roadReports (a partial closure must not no-go a leg the
 * way a full closure does); CL1/CL2 are chainLaws titled "Chain Law Level 1/2" in WYDOT's words;
 * surface/atmospheric conditions are winterDriving with the feed's own labels. The seasonal
 * "No Trailer Traffic" rule (Nov 15–Apr 1) rides in the detail text, never as a closure event.
 * Dry + clear + no flags produces no event (like CA's dropped R-0).
 */
export function slimWyEvents(cfg, decoded) {
  const out = [];
  // Same road + same condition can come from two overlapping sections (e.g. JACKW22JWB with no
  // flags and JACKW22B with black ice + falling rock + no-trailer-traffic): keep the richer one
  // so advisory flags are not lost to whichever section the feed lists first.
  const push = e => {
    const k = `${e.cls}|${e.route}|${e.title}`;
    const i = out.findIndex(x => `${x.cls}|${x.route}|${x.title}` === k);
    if (i < 0) { out.push(e); return; }
    const old = out[i];
    if ((e.tooltip || '').length + (e.detail || '').length > (old.tooltip || '').length + (old.detail || '').length) out[i] = e;
  };
  for (const r of decoded || []) {
    const tokens = wyRouteTokens(r.code);
    if (!tokens.length) continue;
    const segs = utahSegIds(cfg, tokens, null, null, null, { routeOnly: true });
    if (!segs.length) continue;
    const route = matchedRoute(cfg, tokens);
    const updated = r.lastModified ? r.lastModified * 1000 : null;
    const advisories = [];
    if (r.bi) advisories.push('Black ice');
    if (r.fr) advisories.push('Falling rock');
    if (r.hail) advisories.push('Hail');
    if (r.ebor) advisories.push('Blow-over risk');
    if (r.ntt) advisories.push('No trailer traffic');
    const adv = advisories.join(' · ');
    const base = { segs, route, geo: [], updated, start: null, eventType: null, priority: null, icon: null, src: 'wy' };
    const closed = ['C', 'D', 'I'].includes(r.impact) || r.closureReason || r.customClosureReason;
    if (closed) {
      const reason = r.closureReason || r.customClosureReason || '';
      push({ ...base, id: `wy-${r.code}-closed`, cls: 'roadClosures',
        title: `Road closed — ${route}${reason ? ` (${reason})` : ''}`, tooltip: '',
        detail: [r.openMsg, reason, adv].filter(Boolean).join(' · ').slice(0, 600) });
      continue;
    }
    if (r.impact === 'P') {
      push({ ...base, id: `wy-${r.code}-partial`, cls: 'roadReports',
        title: `Partial closure — ${route}`, tooltip: '',
        detail: [r.closureReason || r.customClosureReason || '', r.openMsg, adv].filter(Boolean).join(' · ').slice(0, 600) });
    }
    if (r.cl2 || r.cl1) {
      const lvl = r.cl2 ? 2 : 1;
      push({ ...base, id: `wy-${r.code}-chain`, cls: 'chainLaws',
        title: `Chain Law Level ${lvl} — ${route}`, tooltip: '',
        detail: [adv, r.openMsg].filter(Boolean).join(' · ').slice(0, 600) });
    }
    const surf = WY_SURFACE[r.eightCodes];
    const atmos = WY_ATMOS[r.nineCodes];
    const label = (surf && r.eightCodes !== 81) ? surf : (!surf && r.eightCodes ? 'Multiple surface conditions' : (atmos || null));
    if (label) {
      push({ ...base, id: `wy-${r.code}-cond`, cls: 'winterDriving',
        title: `${label} — ${route}`, tooltip: adv,
        detail: [adv, r.openMsg].filter(Boolean).join(' · ').slice(0, 600) });
    } else if (adv) {
      push({ ...base, id: `wy-${r.code}-adv`, cls: 'winterDriving',
        title: `${adv} — ${route}`, tooltip: '',
        detail: [adv, r.openMsg].filter(Boolean).join(' · ').slice(0, 600) });
    }
    if (r.weight && r.weightReason) {
      push({ ...base, id: `wy-${r.code}-weight`, cls: 'roadReports', eventType: 'routine',
        title: `Weight restriction: ${r.weightReason} — ${route}`, tooltip: '',
        detail: `Weight limit ${r.weight} lbs — ${r.weightReason}${r.weightCustomReason ? ` (${r.weightCustomReason})` : ''}`.slice(0, 600) });
    }
  }
  return { events: out };
}

/** Classic WyoRoad text page for one town (same conditions as server-rendered HTML). */
export function wyoroadTextUrl(town = 'Jackson') {
  return `https://www.wyoroad.info/pls/Browse/WRR.TownResults?SelectedTown=${encodeURIComponent(town)}`;
}
function wyHtmlDecode(s) {
  return String(s || '').replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}
/** "Nov 24, 2026, 12:53 PM" in America/Denver (the page carries no zone marker) -> epoch ms. */
function wyReportEpoch(s) {
  const m = String(s || '').match(/([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  const mo = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }[m[1].toLowerCase()];
  if (mo == null) return null;
  let h = +m[4]; if (/pm/i.test(m[6]) && h < 12) h += 12; if (/am/i.test(m[6]) && h === 12) h = 0;
  const guess = Date.UTC(+m[3], mo, +m[2], h, +m[5]);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map(p => [p.type, p.value]));
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return guess - (asUTC - guess);
}
/** Route tokens out of a text-page route cell: "US 26/89" -> ["US-26","US-89"] (bare parts
 *  inherit the first part's prefix); "WY 22" -> ["WY-22"]. */
function wyTextRoutes(cell) {
  const parts = String(cell || '').split('/').map(p => p.trim()).filter(Boolean);
  if (!parts.length) return [];
  const out = [];
  let prefix = '';
  for (const p of parts) {
    const m = p.match(/^(I|US|SR|WY|WYO)\s+(\d+[A-Z]?)$/i) || p.match(/^(\d+[A-Z]?)$/);
    if (!m) continue;
    if (m[2]) { prefix = m[1].toUpperCase() === 'WYO' ? 'WY' : m[1].toUpperCase(); out.push(`${prefix}-${m[2].toUpperCase()}`); }
    else if (prefix) out.push(`${prefix}-${m[1].toUpperCase()}`);
  }
  return out;
}
/**
 * Parse the WRR.TownResults HTML table (Route | Location | Conditions | Advisories | Restrictions
 * | Last Report Time) -> {events}. The route cell carries a rowspan over its rows, so the current
 * route is tracked across rows; a closure row spans its condition cell over the advisory +
 * restriction columns. "Dry"/"None" conditions produce no event; the standing seasonal
 * "No Trailer Traffic" / Safe Pass text stays in the detail, never a closure. Verified against
 * the live Jackson page 2026-11-24 (5 routes, 13 location rows).
 */
export function slimWyTextEvents(cfg, html) {
  const out = []; const seen = new Set();
  const push = e => { const k = `${e.cls}|${e.route}|${e.title}`; if (!seen.has(k)) { seen.add(k); out.push(e); } };
  const rows = String(html || '').match(/<tr[\s\S]*?<\/tr>/gi) || [];
  let route = '', tokens = [];
  rows.forEach((row, ri) => {
    const cells = [];
    const re = /<td\s+class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/gi;
    let m;
    while ((m = re.exec(row))) cells.push({ cls: m[1], text: wyHtmlDecode(stripHtml(m[2]).replace(/\s+/g, ' ').trim()) });
    if (!cells.length) return;
    const town = cells.find(c => c.cls === 'town');
    if (town) { route = town.text; tokens = wyTextRoutes(route); }
    const loc = cells.find(c => c.cls === 'closurelocation');
    if (!loc || !tokens.length) return;
    const cond = cells.find(c => /cond$/.test(c.cls));
    const advCell = cells.find(c => c.cls === 'noimpact' || /^(low|mod|high)impact$/.test(c.cls));
    const restrCell = cells.find(c => /restrict/.test(c.cls));
    const timeCell = cells.find(c => c.cls === 'rpttime');
    const condition = cond ? cond.text : '';
    const advisories = advCell && advCell.text !== 'None' ? advCell.text : '';
    const restrictions = restrCell && restrCell.text !== 'None' ? restrCell.text : '';
    const updated = timeCell ? wyReportEpoch(timeCell.text) : null;
    const segs = utahSegIds(cfg, tokens, null, null, null, { routeOnly: true });
    if (!segs.length) return;
    const r = matchedRoute(cfg, tokens);
    const base = { segs, route: r, geo: [], updated, start: null, eventType: null, priority: null, icon: null, src: 'wy' };
    const detail = [loc.text, advisories, restrictions].filter(Boolean).join(' · ').slice(0, 600);
    if (/road closed/i.test(condition)) {
      push({ ...base, id: `wy-text-${r.replace(/[^A-Za-z0-9]+/g, '-')}-${ri}`, cls: 'roadClosures',
        title: `Road closed — ${r} (${loc.text})`, tooltip: '', detail });
      return;
    }
    if (/chain law/i.test(`${advisories} ${restrictions}`)) {
      const lvl = /level\s*2/i.test(`${advisories} ${restrictions}`) ? 2 : 1;
      push({ ...base, id: `wy-text-${r.replace(/[^A-Za-z0-9]+/g, '-')}-${ri}-chain`, cls: 'chainLaws',
        title: `Chain Law Level ${lvl} — ${r}`, tooltip: '', detail });
    }
    if (condition && !/^(none|dry)$/i.test(condition)) {
      push({ ...base, id: `wy-text-${r.replace(/[^A-Za-z0-9]+/g, '-')}-${ri}`, cls: 'winterDriving',
        title: `${condition} — ${r}`, tooltip: advisories, detail });
    } else if (advisories && /falling rock|black ice/i.test(advisories)) {
      push({ ...base, id: `wy-text-${r.replace(/[^A-Za-z0-9]+/g, '-')}-${ri}-adv`, cls: 'winterDriving',
        title: `${advisories} — ${r}`, tooltip: '', detail });
    }
  });
  return { events: out };
}

/* ----- Montana — MDT 511 Iteris CDN GeoJSON (keyless) ----- */
/** Iteris ClearRoute CDN GeoJSON: kinds events/construction/restrictions (+cameras/rwis/dms). */
export function mdtGeoUrl(kind) {
  return `https://mt.cdn.iteris-atis.com/geojson/icons/metadata/icons.${kind}.geojson`;
}
/**
 * MDT events + construction + restrictions -> {events}. Points only (no polylines), so segments
 * match by route name + point-in-bbox, as with UDOT point events. Coordinates are strings in
 * the feed and are coerced to numbers. Construction is roadReports with eventType 'routine'
 * (long-running projects, same as Utah roadwork); restrictions (length/width limits) are
 * roadReports; an events-file record whose headline/report says closed becomes roadClosures.
 * No chain levels exist in this feed — no event ever carries cls 'chainLaws'.
 */
export function slimMtEvents(cfg, { events = {}, construction = {}, restrictions = {} } = {}) {
  const out = [];
  const walk = (file, kind) => {
    for (const f of (file?.features || [])) {
      const p = f.properties || {};
      const g = f.geometry?.coordinates || [];
      const lon = parseFloat(g[0]), lat = parseFloat(g[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const route = normNeRoad(p.route || '');
      const tokens = route ? [route] : [];
      const segs = utahSegIds(cfg, tokens, lon, lat, null);
      const geo = [[+lon.toFixed(4), +lat.toFixed(4)]];
      if (!segs.length && !geo.length) continue;
      const headline = String(p.headline || '');
      const report = stripHtml(p.report || p.enhanced_report || '').slice(0, 600);
      const loc = String(p.location_description || '');
      const closed = kind === 'events' && /clos/i.test(`${headline} ${report}`);
      const id = `mt-${kind === 'events' ? 'ev' : kind === 'construction' ? 'cn' : 'rs'}-${p.event_id || `${lon.toFixed(4)},${lat.toFixed(4)}`}`;
      out.push({ id, cls: closed ? 'roadClosures' : 'roadReports', segs, route, geo,
        title: closed ? `Road closed — ${route || loc}` : [headline, route].filter(Boolean).join(' — ') || `MDT event — ${route || loc}`,
        tooltip: p.dir ? dirWord(p.dir) : '',
        detail: [loc, report].filter(Boolean).join(' · ').slice(0, 600),
        eventType: kind === 'construction' ? 'routine' : null, priority: null, icon: null,
        updated: typeof p.last_update === 'number' ? p.last_update * 1000 : null, start: null, src: 'mt' });
    }
  };
  walk(events, 'events'); walk(construction, 'construction'); walk(restrictions, 'restrictions');
  return { events: out };
}

/* ----- Idaho — keyed Developer API (primary) + WZDx / mapIcons (keyless fallback) ----- */
/** Idaho 511 Developer API (keyed; 10 calls / 60 s — the collector makes 2 per tick). */
export function idahoWinterUrl(key) { return `https://511.idaho.gov/api/v3/get/winterroads?key=${encodeURIComponent(key)}`; }
export function idahoEventUrl(key) { return `https://511.idaho.gov/api/v2/get/event?key=${encodeURIComponent(key)}`; }
/** Idaho roadway spellings: "ID-44"/"SH-55" both appear, so each token carries its twin. */
function idRoadTokens(name) {
  const t = String(name || '').trim().replace(/\s+/g, ' ');
  const m = t.match(/^(I|US|SR|ID|SH)[- ]?(\d+[A-Z]?)$/i);
  if (!m) return t ? [t] : [];
  const pre = m[1].toUpperCase(), num = m[2].toUpperCase();
  if (pre === 'ID' || pre === 'SH') return [`ID-${num}`, `SH-${num}`];
  if (pre === 'SR') return [`SR-${num}`];
  return [`${pre}-${num}`];
}
const ID_WINTER_BAD = /(snow|ice|icy|slick|slush|drift|blowing|whiteout|poor visibility|wet)/i;
/**
 * Keyed winterroads (v3) + event (v2) -> {events}. Both endpoints return bare arrays (verified
 * against the docs samples). "Overall Status" has no published vocabulary, so it is mapped
 * defensively by keyword: a bad-weather word -> winterDriving, "Dry" (and nothing else) -> no
 * event, an unknown value -> no event (unknown stays unknown, never clear). A status mentioning
 * a closure -> roadClosures. Events: full closure -> roadClosures, roadwork -> roadReports with
 * eventType 'routine', accidentsAndIncidents -> roadReports. A 400/401 from the API means the
 * key is missing/invalid, not "no events" — the collector falls back to keyless on any failure.
 */
export function slimIdKeyed(cfg, winter, events) {
  const out = [];
  const toMs = v => (typeof v === 'number' && v > 0 ? (v < 1e12 ? v * 1000 : v) : null);
  const winterRows = Array.isArray(winter) ? winter : (winter?.WinterRoads || winter?.data || winter?.results || []);
  for (const s of winterRows) {
    const tokens = idRoadTokens(s.RoadwayName);
    if (!tokens.length) continue;
    const geo = polylineGeo(s.EncodedPolyline);
    const segs = utahSegIds(cfg, tokens, null, null, geo.length ? (() => { const xs = geo.map(p => p[0]), ys = geo.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; })() : null, { routeOnly: !geo.length });
    if (!segs.length && !geo.length) continue;
    const route = matchedRoute(cfg, tokens);
    const status = String(s['Overall Status'] || '');
    const text = [status, s['Weather Conditions'], s['Special Conditions']].filter(Boolean).join(' · ');
    const updated = toMs(s.LastUpdated);
    if (/clos/i.test(text)) {
      out.push({ id: `id-winter-${s.Id}-closed`, cls: 'roadClosures', segs, route, geo,
        title: `Road closed — ${route}`, tooltip: '',
        detail: [s.LocationDescription, text].filter(Boolean).join(' · ').slice(0, 600),
        eventType: null, priority: null, icon: null, updated, start: null, src: 'id' });
      continue;
    }
    if (!ID_WINTER_BAD.test(text)) continue; // Dry, or an unknown value: no event (unknown, not clear)
    out.push({ id: `id-winter-${s.Id}`, cls: 'winterDriving', segs, route, geo,
      title: `${status || 'Winter conditions'} — ${route}`, tooltip: [s['Weather Conditions'], s['Special Conditions']].filter(Boolean).join(' · '),
      detail: [s.LocationDescription, text].filter(Boolean).join(' · ').slice(0, 600),
      eventType: null, priority: null, icon: null, updated, start: null, src: 'id' });
  }
  const eventRows = Array.isArray(events) ? events : (events?.Events || events?.data || events?.results || []);
  for (const a of eventRows) {
    const tokens = idRoadTokens(a.RoadwayName);
    const desc = String(a.Description || '');
    for (const m of desc.matchAll(/\b(?:SH|ID|US|I)[- ]?\d+[A-Z]?\b/gi)) tokens.push(...idRoadTokens(m[0]));
    const lon = +a.Longitude, lat = +a.Latitude;
    let geo = polylineGeo(a.EncodedPolyline);
    const hasPt = Number.isFinite(lon) && Number.isFinite(lat);
    if (!geo.length && hasPt) geo = [[+lon.toFixed(4), +lat.toFixed(4)]];
    if (!geo.length) continue;
    const bbox = geo.length ? (() => { const xs = geo.map(p => p[0]), ys = geo.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; })() : null;
    const segs = utahSegIds(cfg, [...new Set(tokens)], hasPt ? lon : null, hasPt ? lat : null, bbox);
    if (!segs.length && !geo.length) continue;
    const route = matchedRoute(cfg, [...new Set(tokens)]);
    const full = a.IsFullClosure === true || a.EventType === 'closures';
    const cls = full ? 'roadClosures' : 'roadReports';
    const title = (desc.split('\n')[0] || a.EventSubType || a.EventType || 'Idaho 511 event').trim();
    out.push({ id: `id-event-${a.ID ?? a.Id ?? `${route}-${out.length}`}`, cls, segs, route, geo,
      title, tooltip: dirWord(a.DirectionOfTravel),
      detail: [desc, a.Comment && a.Comment !== desc ? a.Comment : '', a.LanesAffected || ''].filter(Boolean).join(' · ').slice(0, 600),
      eventType: a.EventType === 'roadwork' ? 'routine' : null, priority: null, icon: null,
      updated: toMs(a.LastUpdated), start: toMs(a.StartDate), src: 'id' });
  }
  return { events: out };
}

/** Idaho WZDx work zones (keyless GeoJSON, ~2.7 MB / 1,161 features — filtered before storage). */
export function idahoWzdxUrl() { return 'https://511.idaho.gov/api/wzdx'; }
/**
 * WZDx -> {events}, filtered server-side to the corridor route set before returning (never the
 * raw 2.7 MB). Work zones only — no closures, no conditions. A feature is kept when one of its
 * road_names matches a corridor route (with ID/SH twins) or its geometry bbox overlaps a
 * corridor segment bbox. Geometry may be Point/MultiPoint/LineString/MultiLineString.
 */
export function slimIdWzdx(cfg, geojson) {
  const out = [];
  const corridor = new Set(Object.values(cfg.segments).flatMap(s => s.routes.flatMap(idRoadTokens)));
  const hitsCorridor = (names, bbox) => {
    if (names.some(n => corridor.has(normNeRoad(n)) || idRoadTokens(n).some(t => corridor.has(t)))) return true;
    if (!bbox) return false;
    return Object.values(cfg.segments).some(s => bbox[0] <= s.bbox[2] && bbox[2] >= s.bbox[0] && bbox[1] <= s.bbox[3] && bbox[3] >= s.bbox[1]);
  };
  for (const f of (geojson?.features || [])) {
    const p = f.properties || {}, cd = p.core_details || {};
    const pts = [];
    const walk = c => { if (typeof c[0] === 'number') pts.push([+c[0].toFixed(4), +c[1].toFixed(4)]); else c.forEach(walk); };
    if (f.geometry?.coordinates) walk(f.geometry.coordinates);
    const bbox = pts.length ? (() => { const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; })() : null;
    const names = Array.isArray(cd.road_names) ? cd.road_names : [];
    if (!hitsCorridor(names, bbox)) continue;
    const tokens = [...new Set(names.flatMap(idRoadTokens))];
    const segs = utahSegIds(cfg, tokens, null, null, bbox, { routeOnly: !bbox });
    const desc = String(cd.description || '').trim();
    const road = names[0] || '';
    const route = matchedRoute(cfg, tokens) || road;
    out.push({ id: `id-wzdx-${p.road_event_id || `${road}-${out.length}`}`, cls: 'roadReports', segs, route, geo: sampleGeo(pts),
      title: desc ? (firstLine(desc) || `Work zone — ${road}`) : `Work zone — ${road || 'Idaho'}`,
      tooltip: cd.direction || '',
      detail: [desc, p.start_date ? `from ${p.start_date}` : '', p.end_date ? `to ${p.end_date}` : ''].filter(Boolean).join(' · ').slice(0, 600),
      eventType: 'routine', priority: null, icon: null,
      updated: parseIsoTs(cd.update_date), start: parseIsoTs(p.start_date), end: parseIsoTs(p.end_date), src: 'id' });
  }
  return { events: out };
}

/** Idaho 511 mapIcons points layer (keyless): ActiveClosures, Incidents, Construction, ... */
export function idahoMapIconsUrl(layer) { return `https://511.idaho.gov/map/mapIcons/${layer}`; }
/**
 * mapIcons points -> {events}. Points only (no route/description/timestamp in the JSON — same
 * shape as NE511); a point matches a segment only when it falls in exactly one segment bbox
 * (utahSegIds' no-token rule). ActiveClosures are roadClosures, everything else roadReports.
 * Detail lives in the HTML tooltips, which this collector does not fetch.
 */
export function slimIdMapIcons(cfg, json, layer = 'points') {
  const out = [];
  const items = Array.isArray(json?.item2) ? json.item2 : [];
  const isClosure = /clos/i.test(layer);
  for (const it of items) {
    const loc = it.location || [];
    const lat = parseFloat(loc[0]), lon = parseFloat(loc[1]); // mapIcons location is [lat, lon]
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const segs = utahSegIds(cfg, [], lon, lat, null);
    const geo = [[+lon.toFixed(4), +lat.toFixed(4)]];
    if (!segs.length && !geo.length) continue;
    out.push({ id: `id-icons-${layer}-${it.itemId}`, cls: isClosure ? 'roadClosures' : 'roadReports', segs, route: '', geo,
      title: isClosure ? 'Active closure (Idaho 511)' : `${layer} (Idaho 511)`,
      tooltip: '', detail: '',
      eventType: null, priority: null, icon: null, updated: null, start: null, src: 'id' });
  }
  return { events: out };
}

/* ----- New Mexico — NMRoads GetEventsJSON (keyless) ----- */
/** NMRoads event types (from the site's JS): 5 closure, 6 crash, 7 alert, 8 laneClosure,
 *  9 roadwork, 13 fairDrivingConditions, 14 weatherAdvisory, 16 difficultDrivingConditions,
 *  17 severeDrivingConditions, 18 specialEvent, 19 construction, 20 seasonalClosure,
 *  21 signalPowerOutage. One comma-list call covers them all (verified live 2026-11-24). */
export const NM_EVENT_TYPES = [5, 6, 7, 8, 9, 13, 14, 16, 17, 18, 19, 20, 21];
/** Canonical route number for Rockies feeds: normNeRoad's prefix list is NE-only, so 'NM 134'
 *  / 'MT 64' / 'WY 22' come back unchanged — this one hyphenates the Rockies prefixes too. */
const normRkRoad = s => {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  const m = t.match(/^(I|US|SR|ID|SH|NM|MT|WY)\s*-?\s*(\d+[A-Z]?)$/i);
  return m ? `${m[1].toUpperCase()}-${m[2].toUpperCase()}` : normNeRoad(t);
};
export function nmEventsUrl(types = NM_EVENT_TYPES) {
  const list = Array.isArray(types) ? types.join(',') : String(types);
  return `https://servicev5.nmroads.com/RealMapWAR/GetEventsJSON?eventType=${list}&returnData=all`;
}
/**
 * NMRoads events -> {events}. The response is a bare array (or {events: [...]}). Coordinates
 * are Web Mercator metres in both `longitude`/`latitude` and `geometryAsJSON.paths` and are
 * converted to degrees before any bbox math. Driving conditions: fair (13) is an explicit
 * posting, difficult (16) is winterDriving (the description's "snow packed and icy" wording
 * is kept in the tooltip so the verdict's winter-bad check sees it), severe (17) is a
 * roadClosure so the leg's closure level applies — absence of any driving-conditions event is
 * unknown, never clear. Lane closures are titled "Lane closed — ..." (CA style) so the verdict
 * treats them as partial, not full closures.
 */
export function slimNmEvents(cfg, json) {
  const rows = Array.isArray(json) ? json : (json?.events || []);
  const out = [];
  const toMs = v => (typeof v === 'number' && v > 0 ? (v < 1e12 ? v * 1000 : v) : null);
  rows.forEach((e, i) => {
    const type = e.eventType ?? e.incidentType;
    const route = normRkRoad(`${e.routeName || ''} ${e.routeNumber || ''}`.trim());
    const tokens = route ? [route] : [];
    let geo = [];
    try {
      const gj = typeof e.geometryAsJSON === 'string' ? JSON.parse(e.geometryAsJSON) : e.geometryAsJSON;
      const pts = [];
      const walk = c => { if (typeof c[0] === 'number') pts.push(fromWebMercator(c[0], c[1])); else c.forEach(walk); };
      if (gj?.paths) walk(gj.paths);
      geo = sampleGeo(pts);
    } catch { /* fall through to the point below */ }
    const mx = +e.longitude, my = +e.latitude;
    if (!geo.length && Number.isFinite(mx) && Number.isFinite(my)) geo = [fromWebMercator(mx, my)];
    if (!geo.length) return;
    const bbox = (() => { const xs = geo.map(p => p[0]), ys = geo.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; })();
    const segs = utahSegIds(cfg, tokens, null, null, bbox);
    if (!segs.length && !geo.length) return;
    const miles = (e.milemarkerfrom != null && e.milemarkerto != null) ? ` (mile ${e.milemarkerfrom}–${e.milemarkerto})` : '';
    const desc = stripHtml(e.description || '').trim();
    const updated = toMs(e.updatedateEpoc) ?? toMs(e.entereddateEpoc);
    const start = toMs(e.entereddateEpoc);
    const base = { segs, route, geo, updated, start, eventType: null, priority: null, icon: null, src: 'nm' };
    const where = [e.atPointA, e.atPointB].filter(Boolean).join(' → ');
    if (type === 5 || type === 20) {
      out.push({ ...base, id: `nm-${type}-${i}`, cls: 'roadClosures',
        title: `Road closed${type === 20 ? ' (seasonal)' : ''} — ${route}${miles}`,
        tooltip: '', detail: [e.title || '', desc, where].filter(Boolean).join(' · ').slice(0, 600) });
    } else if (type === 8) {
      out.push({ ...base, id: `nm-${type}-${i}`, cls: 'roadClosures',
        title: `Lane closed — ${route}${miles}`,
        tooltip: '', detail: [e.title || '', desc, where].filter(Boolean).join(' · ').slice(0, 600) });
    } else if (type === 13 || type === 16) {
      const level = type === 13 ? 'Fair' : 'Difficult';
      out.push({ ...base, id: `nm-${type}-${i}`, cls: 'winterDriving',
        title: `${level} driving conditions — ${route}${miles}`,
        tooltip: desc.slice(0, 200),
        detail: [e.title || '', desc, where].filter(Boolean).join(' · ').slice(0, 600) });
    } else if (type === 17) {
      out.push({ ...base, id: `nm-${type}-${i}`, cls: 'roadClosures',
        title: `Severe driving conditions — ${route}${miles}`,
        tooltip: desc.slice(0, 200),
        detail: [e.title || '', desc, where].filter(Boolean).join(' · ').slice(0, 600) });
    } else {
      const routine = type === 9 || type === 19;
      out.push({ ...base, id: `nm-${type}-${i}`, cls: 'roadReports',
        title: (e.title || e.incidentDesc || `NMRoads event — ${route}`).trim(),
        tooltip: '', detail: [desc, where].filter(Boolean).join(' · ').slice(0, 600),
        eventType: routine ? 'routine' : null });
    }
  });
  return { events: out };
}

/** Road-condition segments that are icy / snow-covered, plus any non-'none' Restriction (traction/chain).
 *  Restriction values are unverified live (all 'none' at probe time) — the raw value goes into the title,
 *  so the UI shows whatever UDOT reports and chainLevel() can match 'traction law' / 'code 15/16' when present. */
export function slimUtahRoadConditions(cfg, json) {
  const out = [];
  for (const s of (Array.isArray(json) ? json : [])) {
    const name = String(s.RoadwayName || '');
    const m = name.match(/^(I|US|SR)[- ]?(\d+[A-Z]?)/i);
    if (!m) continue;
    const route = `${m[1].toUpperCase()}-${m[2]}`;
    const rc = String(s.RoadCondition || ''), wc = String(s.WeatherCondition || ''), rs = s.Restriction;
    const hasRestriction = rs != null && String(rs).toLowerCase() !== 'none' && String(rs).trim() !== '';
    const icy = /icy spots|snow covered|patchy snow/i.test(rc);
    if (!hasRestriction && !icy) continue;
    let geo = [], bbox = null;
    if (Array.isArray(s.EncodedPolyline)) {
      for (const p of s.EncodedPolyline) { const pts = decodeUtahPolyline(p); if (pts) { geo.push(...pts); } }
      if (geo.length) { geo = sampleGeo(geo); const xs = geo.map(p => p[0]), ys = geo.map(p => p[1]); bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
    }
    const segs = utahSegIds(cfg, [route], null, null, bbox, { routeOnly: true });
    if (!segs.length && !geo.length) continue;
    const detail = `Road condition: ${rc || '—'}; weather: ${wc || '—'}; restriction: ${rs ?? 'none'}`;
    if (hasRestriction) {
      out.push({ id: `udot-rc-${s.Id}-chain`, cls: 'chainLaws', segs, route, geo,
        title: `Traction restriction: ${rs} — ${name}`, tooltip: '', detail,
        eventType: null, priority: null, icon: null, updated: null, start: null });
    }
    if (icy) {
      const label = /patchy snow/i.test(rc) ? 'Snow covered in patches' : rc.replace(/^./, c => c.toUpperCase());
      out.push({ id: `udot-rc-${s.Id}-winter`, cls: 'winterDriving', segs, route, geo,
        title: `${label} — ${name}`, tooltip: '', detail,
        eventType: null, priority: null, icon: null, updated: null, start: null });
    }
  }
  return out;
}

/** Keyed UDOT cameras -> the {id, lon, lat, name, route, local, img, stream, broken} shape selectCameras() takes.
 *  Kept only when the camera is on a corridor road (its Roadway is a segment route number) AND
 *  inside a corridor bbox, so the payload stays small (332 of 2091 at probe time). */
export function slimUtahCameras(cfg, json) {
  const routes = new Set(Object.values(cfg.segments).flatMap(s => s.routes.map(normUtahRoad)).filter(r => /^(I|US|SR)-\d/.test(r)));
  const out = [];
  for (const c of (Array.isArray(json) ? json : [])) {
    const lon = +c.Longitude, lat = +c.Latitude;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const rn = normUtahRoad(c.Roadway);
    if (!routes.has(rn)) continue;
    const inCorridor = Object.values(cfg.segments).some(s => lon >= s.bbox[0] - 0.01 && lon <= s.bbox[2] + 0.01 && lat >= s.bbox[1] - 0.01 && lat <= s.bbox[3] + 0.01);
    if (!inCorridor) continue;
    const v = (c.Views || [])[0];
    if (!v?.Url) continue;
    out.push({ id: `udot-${c.Id}`, lon: +lon.toFixed(5), lat: +lat.toFixed(5),
      name: c.Location || `${c.Roadway || ''} ${c.Direction || ''}`.trim() || `UDOT camera ${c.Id}`,
      route: rn, local: false, img: v.Url, stream: null,
      broken: String(v.Status || '').toLowerCase() !== 'enabled', ts: null });
  }
  return out;
}

/** Keyed mountain passes, kept when the pass road is one of the resort drive corridors. */
export function slimUtahPasses(cfg, json) {
  const routes = new Set(Object.values(cfg.segments).flatMap(s => s.routes.map(normUtahRoad)));
  const out = [];
  for (const p of (Array.isArray(json) ? json : [])) {
    const road = String(p.Roadway || '');
    const m = road.match(/^(I|US|SR)[- ]?(\d+[A-Z]?)/i);
    if (!m || !routes.has(`${m[1].toUpperCase()}-${m[2]}`)) continue;
    out.push({ id: `udot-pass-${p.Id}`, name: p.Name || road, roadway: road,
      airTempF: p.AirTemperature ?? null, windMph: p.WindSpeed ?? null, gustMph: p.WindGust ?? null,
      windDir: p.WindDirection || null, surfaceTempF: p.SurfaceTemp ?? null,
      surface: p.SurfaceStatus || null, visibilityMi: p.Visibility ?? null });
  }
  return out;
}

/* ---------------- NWS alerts ---------------- */

export function nwsUrl(cfg, r) { return `${cfg.sources.nws}?point=${r.lat.toFixed(4)},${r.lon.toFixed(4)}`; }

export function slimAlerts(json) {
  return (json?.features || []).map(f => ({
    event: f.properties?.event, headline: f.properties?.headline, severity: f.properties?.severity,
    onset: f.properties?.onset, ends: f.properties?.ends || f.properties?.expires
  }));
}

/* ---------------- Verdict ---------------- */

const RANK = { go: 0, info: 0, unknown: 1, caution: 2, nogo: 3 };
export function worst(levels) {
  let w = 'go';
  for (const l of levels) if ((RANK[l] ?? 0) > RANK[w]) w = l;
  return w;
}

/** Visibility (m, Open-Meteo model) -> level: under 1 km caution (fog / whiteout possible), under 3 km info. */
export const visLevel = m => m < 1000 ? 'caution' : m < 3000 ? 'info' : 'go';

/**
 * Build itemized reasons for a resort. Each reason: {level, kind, text:{key, args}, seg?, ev?}.
 * `roads` = {ok, events[]}, `alerts` = {ok, list[]}, `days` = dailyRows or null.
 */
export function verdictFor(cfg, resort, { roads, alerts, days, intel = null, now = Date.now() }) {
  const reasons = [];
  if (intel && intel.ok) {
    if (intel.status === 'closed') reasons.push({ level: 'nogo', kind: 'resort', key: 'r_resort_closed', note: intel.note });
    else if (intel.lifts && intel.lifts.total && intel.lifts.open / intel.lifts.total < 0.25) reasons.push({ level: 'caution', kind: 'resort', key: 'r_limited', val: intel.lifts });
    else if (intel.lifts) reasons.push({ level: 'go', kind: 'resort', key: 'r_lifts_ok', val: intel.lifts });
  }
  const future = e => e.start && e.start > now + 2 * 3600e3;
  const rules = cfg.rules;
  const segIds = resort.route.map(r => r.seg);

  if (!roads || !roads.ok) {
    reasons.push({ level: 'unknown', kind: 'roads', key: resort.region === 'UT' ? 'r_roads_unavailable_ut' : resort.region === 'CA' ? 'r_roads_unavailable_ca' : resort.region === 'NE' ? 'r_roads_unavailable_ne' : 'r_roads_unavailable' });
  } else {
    for (const leg of resort.route) {
      const evs = roads.events.filter(e => e.segs.includes(leg.seg));
      const chains = evs.filter(e => e.cls === 'chainLaws');
      const closures = evs.filter(e => e.cls === 'roadClosures');
      const incidents = evs.filter(e => e.cls === 'roadReports');
      const cond = evs.filter(e => e.cls === 'winterDriving' && WINTER_BAD.test(`${e.title} ${e.tooltip}`));
      for (const e of closures) {
        const full = /closed|closure/i.test(e.title) && !/lane closed|lanes closed|shoulder|ramp/i.test(e.title);
        // NMRoads "severe" driving conditions (type 17) mean the road is effectively impassable:
        // no-go regardless of the leg's static closure level. Only NM emits this exact phrase.
        const severe = /severe driving conditions/i.test(e.title);
        const lvl = leg.alt || e.oppDir || future(e) ? 'info' : (severe ? 'nogo' : (full ? leg.closure : 'caution'));
        reasons.push({ level: lvl, kind: 'closure', seg: leg.seg, ev: e, key: severe ? 'r_severe' : (future(e) ? 'r_scheduled' : (full ? 'r_closure' : 'r_partial_closure')) });
      }
      for (const e of chains) {
        const lvl = leg.alt || e.oppDir ? 'info' : chainLevel(e);
        reasons.push({ level: lvl, kind: 'chain', seg: leg.seg, ev: e, key: lvl === 'nogo' ? 'r_chain_law' : (lvl === 'info' ? 'r_chain_commercial' : 'r_traction_law') });
      }
      for (const e of incidents) {
        const routine = future(e) || e.eventType === 'routine' || /maintenance|road work|construction/i.test(e.title);
        reasons.push({ level: leg.alt || e.oppDir || routine ? 'info' : 'caution', kind: 'incident', seg: leg.seg, ev: e, key: 'r_incident' });
      }
      for (const e of cond) {
        reasons.push({ level: leg.alt || e.oppDir ? 'info' : 'caution', kind: 'conditions', seg: leg.seg, ev: e, key: 'r_conditions' });
      }
    }
    const main = reasons.filter(r => r.seg && r.level !== 'info');
    // When the road feed carries chain data (Colorado CDOT, California Caltrans), the absence of a
    // chain event is positive evidence there is no chain law: say so (go). Utah feeds carry no
    // chain/traction-law type, and no Northeast feed reports chain / traction law at all, so absence
    // there is only "not reported" (info).
    if (!main.some(r => r.kind === 'chain')) {
      if (roads.chainKnown) reasons.push({ level: 'go', kind: 'chain', key: 'r_no_chain' });
      else if (resort.region === 'UT') reasons.push({ level: 'info', kind: 'chain', key: 'r_chain_unknown' });
      else if (resort.region === 'NE') reasons.push({ level: 'info', kind: 'chain', key: 'r_chain_unknown_ne' });
      else reasons.push({ level: 'info', kind: 'chain', key: 'r_chain_unknown_ca' });
    }
    if (!main.some(r => r.kind === 'closure')) reasons.push({ level: 'go', kind: 'closure', key: 'r_no_closure' });
    if (!main.some(r => r.kind === 'incident')) reasons.push({ level: 'go', kind: 'incident', key: 'r_no_incident' });
  }

  if (!alerts || !alerts.ok) {
    reasons.push({ level: 'unknown', kind: 'nws', key: 'r_nws_unavailable' });
  } else if (!alerts.list.length) {
    reasons.push({ level: 'go', kind: 'nws', key: 'r_nws_none' });
  } else {
    for (const a of alerts.list) {
      const lvl = rules.nwsNoGo.includes(a.event) ? 'nogo' : (rules.nwsCaution.includes(a.event) ? 'caution' : 'info');
      reasons.push({ level: lvl, kind: 'nws', key: 'r_nws', alert: a });
    }
  }

  if (!days || !days.length) {
    reasons.push({ level: 'unknown', kind: 'weather', key: 'r_wx_unavailable' });
  } else {
    const d = days[0];
    const snow = Math.max(d.base.snow ?? 0, d.summit.snow ?? 0, d.snowEst ?? 0);
    if (snow >= rules.snowCautionCm) reasons.push({ level: 'caution', kind: 'snow', key: 'r_heavy_snow', val: snow });
    else reasons.push({ level: 'go', kind: 'snow', key: 'r_snow_ok', val: snow });
    const g = d.summit.gust ?? 0;
    if (g >= rules.gustCautionKmh) reasons.push({ level: 'caution', kind: 'wind', key: 'r_wind', val: g });
    else reasons.push({ level: 'go', kind: 'wind', key: 'r_wind_ok', val: g });
    if (d.visMin != null) {
      const vl = visLevel(d.visMin);
      reasons.push({ level: vl, kind: 'vis', key: vl === 'caution' ? 'r_vis_low' : vl === 'info' ? 'r_vis_some' : 'r_vis_ok', val: d.visMin });
    }
    const f = d.summit.feelsMin;
    if (f != null && f <= rules.feelsLikeCautionC) reasons.push({ level: 'caution', kind: 'cold', key: 'r_cold', val: f });
  }

  // Unknown road data means we can't say "Go" with confidence.
  let level = worst(reasons.map(r => r.level));
  if (level === 'unknown') level = 'caution';
  return { level, reasons, segIds };
}

/**
 * Plain-language recommendation from the resort's own report and the worst issue found on the page.
 * `rep` = {ok, status, lifts:{open,total}, terrain:{pct}, snow:{h24 (cm)}}; `level` = worst of the page's checks (go|caution|nogo).
 * Used by the full dashboards and the basic catalog pages, so both say the same thing for the same data.
 */
export function recommendFrom(rep, level) {
  if (!rep || !rep.ok || !rep.status) return { cls: 'unknown', key: 'rec_noreport' };
  if (rep.status === 'closed') return { cls: 'nogo', key: 'rec_closed' };
  if (level === 'nogo') return { cls: 'nogo', key: 'rec_other' };
  const lim = rep.status === 'open' && ((rep.lifts?.total && rep.lifts.open / rep.lifts.total < 0.25) || (rep.terrain?.pct != null && rep.terrain.pct < 25));
  if (lim) return { cls: 'caution', key: 'rec_limited' };
  if (level === 'caution') return { cls: 'caution', key: 'rec_some' };
  // "Great" only with fresh snow reported by the resort (15 cm ≈ 6″) and at least half the terrain open.
  if ((rep.snow?.h24 ?? 0) >= 15 && (rep.terrain?.pct ?? 0) >= 50) return { cls: 'go', key: 'rec_great' };
  return { cls: 'go', key: 'rec_good' };
}

/* ---------------- What to wear ---------------- */

/** Returns {band, adult:[keys], kid:[keys], notes:[keys]} for one day. Temps in °C, wind km/h. */
export function outfitFor(day) {
  const feels = Math.min(day.summit.feelsMin ?? 99, day.base.feelsMin ?? 99);
  const warm = Math.max(day.base.feelsMax ?? -99, day.base.tMax ?? -99);
  const snow = Math.max(day.summit.snow ?? 0, day.base.snow ?? 0);
  const gust = day.summit.gust ?? 0;
  const sunny = day.code != null && day.code <= 2;
  let band;
  if (feels === 99) band = 'unknown';
  else if (feels >= -4) band = 'mild';      // ≥ 25°F
  else if (feels >= -12) band = 'cold';     // 10–25°F
  else if (feels >= -20) band = 'verycold'; // -4–10°F
  else band = 'extreme';                    // < -4°F
  const A = { mild: ['w_base_light', 'w_mid_fleece_opt', 'w_shell', 'w_gloves', 'w_socks', 'w_helmet_goggles'],
    cold: ['w_base_mid', 'w_mid_fleece', 'w_jacket_insulated', 'w_gaiter', 'w_gloves_warm', 'w_socks', 'w_helmet_goggles'],
    verycold: ['w_base_heavy', 'w_mid_puffy', 'w_jacket_insulated', 'w_balaclava', 'w_mittens', 'w_handwarmers', 'w_socks', 'w_helmet_goggles'],
    extreme: ['w_base_heavy', 'w_mid_puffy', 'w_jacket_insulated', 'w_facemask', 'w_mittens', 'w_handwarmers', 'w_toewarmers', 'w_socks', 'w_helmet_goggles'],
    unknown: [] }[band];
  const K = { mild: ['w_base_mid', 'w_mid_fleece', 'w_jacket_insulated', 'w_mittens', 'w_socks', 'w_helmet_goggles', 'w_spare_gloves'],
    cold: ['w_base_heavy', 'w_mid_fleece', 'w_jacket_insulated', 'w_balaclava', 'w_mittens', 'w_handwarmers', 'w_socks', 'w_helmet_goggles', 'w_spare_gloves'],
    verycold: ['w_base_heavy', 'w_mid_puffy', 'w_jacket_insulated', 'w_facemask', 'w_mittens', 'w_handwarmers', 'w_toewarmers', 'w_socks', 'w_helmet_goggles', 'w_spare_gloves'],
    extreme: ['w_base_heavy', 'w_mid_puffy', 'w_jacket_insulated', 'w_facemask', 'w_mittens', 'w_handwarmers', 'w_toewarmers', 'w_socks', 'w_helmet_goggles', 'w_spare_gloves'],
    unknown: [] }[band];
  const notes = [];
  if (band === 'extreme' || band === 'verycold') notes.push('n_kid_breaks');
  if (band === 'extreme') notes.push('n_frostbite');
  if (gust >= 50) notes.push('n_wind');
  if (snow >= 5) notes.push('n_snow_lens');
  else if (sunny) notes.push('n_sun_lens');
  notes.push('n_sunscreen');
  if (warm >= 4) notes.push('n_warm_vent');
  return { band, feels, adult: A, kid: K, notes };
}

/* ---------------- Units ---------------- */

export const fmt = {
  temp: (c, u) => c == null ? '—' : (u === 'imperial' ? `${Math.round(c * 9 / 5 + 32)}°F` : `${Math.round(c)}°C`),
  snow: (cm, u) => cm == null ? '—' : cm < 0.05 ? (u === 'imperial' ? '0″' : '0 cm') : (u === 'imperial' ? `${(cm / 2.54).toFixed(cm >= 25.4 ? 0 : 1)}″` : `${cm.toFixed(cm >= 10 ? 0 : 1)} cm`),
  liquid: (mm, u) => mm == null ? '—' : (u === 'imperial' ? `${(mm / 25.4).toFixed(2)}″` : `${mm.toFixed(1)} mm`),
  elev: (m, u) => m == null ? '—' : (u === 'imperial' ? `${Math.round(m * 3.28084 / 10) * 10} ft` : `${Math.round(m / 10) * 10} m`),
  elevRange: (a, b, u) => {
    if (a == null || b == null) return '—';
    if (u === 'imperial') { const k = m => (m * 3.28084 / 1000).toFixed(1); return `${k(a)}–${k(b)}k ft`; }
    return `${Math.round(a / 10) * 10}–${Math.round(b / 10) * 10} m`;
  },
  vis: (m, u) => { if (m == null) return '—'; if (m >= 16000) return u === 'imperial' ? '10+ mi' : '16+ km'; if (u === 'imperial') { const mi = m / 1609.34; return mi < 3 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`; } const k = m / 1000; return k < 3 ? `${k.toFixed(1)} km` : `${Math.round(k)} km`; },
  wind: (k, u) => k == null ? '—' : (u === 'imperial' ? `${Math.round(k / 1.609)} mph` : `${Math.round(k)} km/h`),
  ratio: r => r == null ? '—' : `${Math.round(r)}:1`
};
