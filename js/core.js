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
    reasons.push({ level: 'unknown', kind: 'roads', key: resort.region === 'UT' ? 'r_roads_unavailable_ut' : resort.region === 'CA' ? 'r_roads_unavailable_ca' : 'r_roads_unavailable' });
  } else {
    for (const leg of resort.route) {
      const evs = roads.events.filter(e => e.segs.includes(leg.seg));
      const chains = evs.filter(e => e.cls === 'chainLaws');
      const closures = evs.filter(e => e.cls === 'roadClosures');
      const incidents = evs.filter(e => e.cls === 'roadReports');
      const cond = evs.filter(e => e.cls === 'winterDriving' && WINTER_BAD.test(`${e.title} ${e.tooltip}`));
      for (const e of closures) {
        const full = /closed|closure/i.test(e.title) && !/lane closed|lanes closed|shoulder|ramp/i.test(e.title);
        const lvl = leg.alt || e.oppDir || future(e) ? 'info' : (full ? leg.closure : 'caution');
        reasons.push({ level: lvl, kind: 'closure', seg: leg.seg, ev: e, key: future(e) ? 'r_scheduled' : (full ? 'r_closure' : 'r_partial_closure') });
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
    // chain/traction-law type, so absence there is only "not reported" (info).
    if (!main.some(r => r.kind === 'chain')) {
      if (roads.chainKnown) reasons.push({ level: 'go', kind: 'chain', key: 'r_no_chain' });
      else if (resort.region === 'UT') reasons.push({ level: 'info', kind: 'chain', key: 'r_chain_unknown' });
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
