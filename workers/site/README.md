# workers/site: the `followthepowder` Worker

Serves SkiDay at https://followthepowder.com (apex canonical).

- `www.followthepowder.com/*` → 301 `https://followthepowder.com/*` (query kept)
- `/api/*` → `ski-data` Worker via service binding `SKI_DATA_SVC` (data API, event counter, `/api/stats.html`)
- everything else → GitHub Pages of this repo (`https://jzhang1011.github.io/followthepowder/<path>`), so pushing
  to `main` updates the site. Repo internals (`/workers/`, `/scripts/`, `/.github/`, `/README.md`) are 404;
  `/ski/...` 301s to the root path; an unknown HTML page 302s to `/`.
- Custom domains (both hostnames) are declared in `wrangler.toml`; wrangler creates their proxied DNS
  records and edge certificates. Deploy only when this Worker changes: `npx wrangler@4 deploy` from this folder.
