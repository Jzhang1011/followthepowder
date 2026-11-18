// followthepowder: SkiDay at the root of followthepowder.com.
//   www.followthepowder.com/*  -> 301 https://followthepowder.com/* (query kept)
//   /api/*                     -> ski-data Worker (service binding)
//   everything else            -> GitHub Pages of Jzhang1011/followthepowder (repo root = site root)
const APEX = 'followthepowder.com';
const PAGES = 'https://jzhang1011.github.io';
const PAGES_PATH = '/followthepowder'; // project-site path on github.io; never visible on followthepowder.com
// Repo internals that are not part of the site.
const BLOCKED = ['/workers/', '/scripts/', '/.github/', '/README.md', '/.gitignore', '/.nojekyll'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname !== APEX) {
      return new Response(null, { status: 301, headers: { Location: `https://${APEX}${url.pathname}${url.search}`, 'Cache-Control': 'public, max-age=86400' } });
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return env.SKI_DATA_SVC.fetch(request);
    if (BLOCKED.some(p => url.pathname === p || url.pathname.startsWith(p))) return new Response('Not found', { status: 404 });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    // Someone typing the old layout (followthepowder.com/ski/...) -> the same page at the root.
    if (url.pathname === '/ski' || url.pathname.startsWith('/ski/')) {
      return new Response(null, { status: 301, headers: { Location: (url.pathname.slice(4) || '/') + url.search } });
    }
    const target = new URL(PAGES_PATH + url.pathname + url.search, PAGES);
    const fwd = new Headers();
    for (const h of ['accept', 'accept-language', 'if-none-match', 'if-modified-since', 'range', 'user-agent']) {
      const v = request.headers.get(h); if (v) fwd.set(h, v);
    }
    const res = await fetch(target, { method: request.method, headers: fwd, redirect: 'manual' });
    const headers = new Headers(res.headers);
    const loc = headers.get('location');
    if (loc) { // e.g. Pages "/followthepowder/foo" -> "/followthepowder/foo/": keep it on this host
      const l = new URL(loc, target);
      if (l.hostname === new URL(PAGES).hostname) {
        const p = l.pathname === PAGES_PATH || l.pathname.startsWith(PAGES_PATH + '/') ? l.pathname.slice(PAGES_PATH.length) || '/' : l.pathname;
        headers.set('location', `https://${APEX}${p}${l.search}`);
      }
    }
    if (res.status === 404 && (request.headers.get('accept') || '').includes('text/html')) {
      return new Response(null, { status: 302, headers: { Location: '/' } });
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
};
