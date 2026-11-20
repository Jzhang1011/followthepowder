# SkiDay — followthepowder.com

Live: https://followthepowder.com/ (www.followthepowder.com and the old https://madeformykids.com/ski/ 301 here)

A no-build static web app (HTML + ES modules) for "should we go skiing today?": a discovery page for ~77 North
American resorts (search, Near Me / Favorites / Best Conditions / Explore, list + map, compare) and a full Go / No-Go
dashboard for A-Basin, Copper and Steamboat (verdict, weather, CDOT roads + cameras, what to wear, cams, packing).
English / 中文, °F·in / °C·cm, built for iPhone Safari first.

## Repo layout
| Path | What |
|---|---|
| `index.html`, `css/`, `js/`, `img/`, `fonts/`, `vendor/` | The site. Repo root = site root; all paths are relative. |
| `data/` | `resorts.json` (full-dashboard resorts, routes, cams), `catalog.json` (discovery catalog), and the fallback snapshots `latest.json`, `intel.json`, `cameras.json` written by the backup Action. |
| `scripts/` | `stamp.mjs` (cache-busting), `fetch-data.mjs` + `collect.mjs` (data collection shared with the Worker). |
| `workers/site/` | `followthepowder` Worker: custom domains followthepowder.com + www, proxies GitHub Pages, `/api/*` → ski-data. |
| `workers/ski-data/` | `ski-data` Worker: 15-min cron refresh into KV, JSON API, anonymous event counter + stats page. |
| `.github/workflows/data-refresh.yml` | Daily backup data refresh (commits `data/*.json`). |

## How it is served / deploy
- **Site**: GitHub Pages of this repo (branch `main`, folder `/`, `.nojekyll`) at `jzhang1011.github.io/followthepowder/`.
  The `followthepowder` Worker (`workers/site`) owns followthepowder.com + www (Workers Custom Domains, so DNS
  records and edge certs are managed by Cloudflare) and proxies every non-API path to Pages. **Pushing to `main` is
  the only deploy step for the site**, including the Action's data commits.
- **API**: `/api/*` goes to the `ski-data` Worker through a service binding. Stats page:
  https://followthepowder.com/api/stats.html (asks for the refresh token; the token is never in the repo).
- **Workers** deploy by hand only when their code changes: `cd workers/site && npx wrangler@4 deploy`,
  `cd workers/ski-data && npx wrangler@4 deploy` (Cloudflare account of wealthlanding001@gmail.com). There is no
  CI deploy, so the repo needs no Cloudflare secret. (Wrangler wants a `package.json` + `node_modules/` in the
  folder it runs from; `workers/site` has one, for ski-data run `mkdir -p node_modules` first. Both are git-ignored.)
- Redirects: www → apex 301 (query kept); `/ski/...` on this host → root; old `madeformykids.com/ski/*` → here
  (handled by the madeformykids-landing Worker in Jzhang1011/MadeForMyKids; its `/ski/api/*` still proxies to ski-data).
- Repo internals (`/workers/`, `/scripts/`, `/.github/`, `/README.md`) are 404 on followthepowder.com.

## Cache-busting / iOS — run `stamp.mjs`
After editing anything in `js/` or `css/`, run `node scripts/stamp.mjs` before committing. It stamps a content hash
(`?v=…`) on `css/ski.css`, `js/app.js` and every module import, so Safari can't mix cached old and new files.

## Data jobs
- **Primary**: `ski-data` Worker cron (`*/15`), see `workers/ski-data/README.md`. The page reads `api/*`.
- **Fallback**: if an `api/` call fails, the page reads `data/latest.json`, `data/intel.json`, `data/cameras.json`.
  `.github/workflows/data-refresh.yml` refreshes them daily at 13:10 UTC (6:10 AM MST) with `node scripts/fetch-data.mjs`
  and commits to `main` with the built-in `GITHUB_TOKEN` (`contents: write`); that push also republishes Pages.
  Run it from the Actions tab (**Run workflow**) or locally. A failed source keeps its last good data and the run goes
  red (GitHub emails the owner).

## Secrets
| Where | Name | Notes |
|---|---|---|
| ski-data Worker (`wrangler secret put`) | `REFRESH_TOKEN` | Bearer for `POST /api/run` and the stats page. Local copy only at `~/.config/ski-data-refresh-token` on the maintainer's machine — never commit it. |
| ski-data Worker (optional) | `OPEN_METEO_KEY`, `COTRIP_API_KEY` | Not set (free tier). |
| GitHub Actions | none | The data Action uses the automatic `GITHUB_TOKEN`. |

Analytics: Google Tag Manager container GTM-WQH2HB5M (index.html) gets dataLayer events (ids/labels only, never search text, addresses, coordinates or city).
Privacy: our own event counter stores only allowlisted event names + labels and daily counts — no IPs, cookies or IDs;
`start_select` records `preset id` or `custom`, never an address or coordinates.

## Sections
- **Verdict** – GO / CAUTION / NO-GO per resort with itemized reasons (CDOT chain & traction law,
  closures, incidents, road conditions, NWS alerts, heavy snow, summit wind, extreme cold).
- **Weather** – Open-Meteo, base + summit elevations: hourly (24/48/72 h) and 7-day snowfall,
  freezing level, estimated snow line (freezing level − 300 m), Kuchera snow-to-liquid ratio.
- **Roads** – CDOT COtrip events matched to route segments by route name + bounding box, and 16 CDOT cameras.
- **What to wear** – adults & kids per day from summit feels-like temp, wind and snow.
- **Resort cams** – official webcam stills / live players (A-Basin & Copper via HDRelay, Steamboat via YouTube).
- **Packing** – editable list saved in `localStorage`.
- English / 中文 and °F·in / °C·cm toggles, saved in `localStorage`.

## Data
| Source | Endpoint | Key? |
|---|---|---|
| Weather | `api.open-meteo.com/v1/forecast` | no (CORS ok) |
| CDOT events | `api-511x-co.carsprogram.org/events/map-features?eventClassifications=chainLaws|roadClosures|roadReports|winterDriving` | no (CORS `*`) — the public feed behind cotrip.org |
| CDOT cameras | `api-511x-co.carsprogram.org/cameras/map-features`, images on `cocam.carsprogram.org` | no |
| NWS alerts | `api.weather.gov/alerts/active?point=lat,lon` | no |

The browser fetches everything live on load and every 10 minutes. `data/latest.json` is a
morning snapshot used as a fallback if a live call fails. A failed source shows "unavailable" — nothing is invented.

## Adding resorts (Ikon expansion)
Everything is driven by `data/resorts.json`: add a resort (lat/lon, base/summit elevation, webcams,
links) and its `route` as a list of `segments` (route names + bbox). Cameras reference COtrip camera IDs.
`shop.enabled` reserves a nav slot for a future gear shop.

## v2: resort intel (lifts, runs, hours, snow report)

`js/intel.js` normalizes each resort's own public report into one shape
(`lifts`, `trails`, `terrain`, `hours`, `status`, `baseCm`, `snow.h24/h48/d7/season`, `surface`, `asOf`).
Provider per resort is set in `data/resorts.json` → `resorts[].intel`:

| provider | used for | source |
|---|---|---|
| `abasin` | A-Basin | arapahoebasin.com/snow-report + /operating-hours- (HTML) |
| `powdr` | Copper | api.coppercolorado.com/api/v1/dor (needs Origin header → server-side only) |
| `mtnpowder` | Steamboat | mtnpowder.com/feed?resortId=6 |

`node scripts/fetch-data.mjs --intel-only` writes `data/intel.json` only. The Worker refreshes intel hourly
13–23 UTC. Missing fields render as "n/a" — never guessed.
Resort photos in `img/` are from Wikimedia Commons (credits in `resorts.json` and the page footer).

## v3: starting location, dynamic route, route cameras, design system

- **Start**: `js/start.js` — Photon (photon.komoot.io, fair-use, debounced 350 ms, ≥3 chars, memoised) autocomplete,
  presets from `trip.presets`, browser geolocation (rounded to ~100 m, reverse-geocoded via Photon). Stored in
  `localStorage['ski.start']`. Nominatim is *not* used (its policy forbids autocomplete).
- **Routing**: OSRM demo server (router.project-osrm.org; ≤1 req/s, non-commercial, no SLA). Requests are throttled to
  1 per 1.1 s and cached 3 days in `localStorage['ski.routes']` (8 entries). If it fails, the page falls back to the
  static DEN routes in `resorts.json` and says so. Drive time is OSRM's free-flow estimate (no traffic).
- **Cameras**: `data/cameras.json` (all public CDOT cameras, slimmed, written by the daily Action). `js/route.js`
  picks cameras ≤1.5 km from the route, prefers state highways on the route, spreads up to 15 evenly by distance.
- **Road events**: events carry sampled geometry (`geo`); they are matched to the route by proximity
  (Point ≤400 m on the same road; lines need ≥2 points near the route), assigned to route legs, and flagged
  `oppDir` when they only affect the opposite direction (downgraded to INFO).
- **Out-of-state starts**: legs outside Colorado show "no CDOT data"; the page notes where the route enters Colorado.
- **Map**: Leaflet 1.9.4 (self-hosted in `vendor/leaflet`, BSD-2) + OSM tiles, lazy-loaded when the roads section is near.
- **Design**: navy #14283F (nav, hero, verdict panel), glacier #DCEAF3, snow #F7F9FB, orange #F28C38, green #25845A,
  Inter (self-hosted variable font, OFL) — white cards for planning/weather sections.
