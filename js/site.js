// Shared page chrome for the standalone pages (/what-to-wear/, /learn/): header nav,
// hamburger menu, language + units toggles, footer localisation. These pages are plain
// HTML files (no app.js), so this module wires the same header the main app has.
// Language and units are read from the same localStorage keys the main app uses
// (ski.lang / ski.units), so a visitor's choice carries across pages.
import { STR } from './i18n.js?v=4b3c2ee12c';
import { dl } from './analytics.js?v=4b3c2ee12c';

const LS = {
  get: (k, d) => { try { const v = localStorage.getItem('ski.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('ski.' + k, JSON.stringify(v)); } catch {} }
};
export const lang = () => 'en'; // Chinese hidden per owner request (see app.js).
export const units = () => LS.get('units', 'imperial');
export const t = k => (STR[lang()] || STR.en)[k] ?? STR.en[k] ?? k;

function localize() {
  document.documentElement.lang = lang() === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  const u = units();
  document.querySelectorAll('[data-units-label]').forEach(el => { el.textContent = u === 'imperial' ? '°F · in' : '°C · cm'; });
  // Active nav item for this page.
  const here = location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('.mainnav a, .mnav a').forEach(a => {
    const p = new URL(a.href, location.origin).pathname.replace(/\/$/, '') || '/';
    if (p === here) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

export function initSite() {
  if (window.__siteInit) return; window.__siteInit = true;
  const run = () => {
    localize();
    const menu = document.getElementById('mnav'), hamb = document.getElementById('btn-menu');
    if (hamb && menu) hamb.addEventListener('click', () => {
      const open = menu.hidden; menu.hidden = !open; hamb.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', e => {
      if (e.target.closest('#mnav a')) { if (menu) menu.hidden = true; hamb?.setAttribute('aria-expanded', 'false'); }
    });
    const setLang = l => { LS.set('lang', l); localize(); window.dispatchEvent(new CustomEvent('ski:lang')); };
    const setUnits = u => { LS.set('units', u); localize(); window.dispatchEvent(new CustomEvent('ski:units')); };
    document.querySelectorAll('[data-lang-toggle]').forEach(b => b.addEventListener('click', () => setLang(lang() === 'zh' ? 'en' : 'zh')));
    document.querySelectorAll('[data-units-toggle]').forEach(b => b.addEventListener('click', () => setUnits(units() === 'imperial' ? 'metric' : 'imperial')));
    try { dl({ event: 'page_view', page_path: location.pathname + location.search }); } catch {}
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
}

// Auto-run when loaded as the page's own module script.
initSite();
