// Shared What-to-Wear rendering: the outfit cards used by the resort dashboard
// (js/app.js renderWear) and the standalone page (js/wear-page.js). The recommendation
// rules themselves live in core.js outfitFor; this module only renders them, so both
// surfaces always show the same outfits from the same data.
import { outfitFor } from './core.js?v=4b3c2ee12c';

export const WICON = { w_base_light: '👕', w_base_mid: '👕', w_base_heavy: '👕', w_mid_fleece_opt: '🧶', w_mid_fleece: '🧶', w_mid_puffy: '🧥', w_shell: '🧥', w_jacket_insulated: '🧥',
  w_gaiter: '🧣', w_balaclava: '🥷', w_facemask: '😷', w_gloves: '🧤', w_gloves_warm: '🧤', w_mittens: '🧤', w_handwarmers: '🔥', w_toewarmers: '🔥', w_socks: '🧦', w_helmet_goggles: '🥽', w_spare_gloves: '🎒' };
export const NICON = { n_kid_breaks: '☕', n_frostbite: '👃', n_wind: '💨', n_snow_lens: '🟡', n_sun_lens: '🕶️', n_sunscreen: '🧴', n_warm_vent: '🌤️' };
export const BAND = { mild: '🙂', cold: '🥶', verycold: '❄️', extreme: '🧊', unknown: '?' };
const LAYER = k => /^w_base/.test(k) ? 'base' : /^w_mid/.test(k) ? 'mid' : /^w_(shell|jacket)/.test(k) ? 'outer' : 'extra';

/** One layer column (adults or kids) for a day's outfit. ctx = { t } (i18n lookup). */
export function outfitCol(keys, who, aud, t) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const g = { base: [], mid: [], outer: [], extra: [] };
  keys.forEach(k => g[LAYER(k)].push(k));
  const chip = k => `<button type="button" class="wi" data-k="${k}" title="${esc(t(k))}"><i>${WICON[k] || '•'}</i>${esc(t('s_' + k))}</button>`;
  const CAT = { base: 'base_layer', mid: 'mid_layer', outer: 'outer_layer', extra: 'accessories' };
  const det = l => g[l].length ? `<ul class="wdet" hidden>${g[l].map(k => `<li>${WICON[k] || '•'} ${esc(t(k))}</li>`).join('')}</ul>` : '';
  const head = l => g[l].length ? `<button type="button" class="ln" data-wexp="${CAT[l]}" aria-expanded="false">${esc(t(l === 'extra' ? 'wear_extras' : 'wear_layers_' + l))} <span aria-hidden="true">▸</span></button>` : `<span class="ln">${esc(t(l === 'extra' ? 'wear_extras' : 'wear_layers_' + l))}</span>`;
  return `<div class="wcol" data-aud="${aud}"><div class="who">${who}</div>
    ${['base', 'mid', 'outer'].map(l => `<div class="layer l-${l}">${head(l)}${g[l].map(chip).join('') || '<span class="muted small">—</span>'}${det(l)}</div>`).join('')}
    <div class="extras">${g.extra.length ? head('extra') : ''}${g.extra.map(chip).join('')}${det('extra')}</div></div>`;
}

/** One day's outfit card. ctx = { t, fmt, u, dayLabel } where dayLabel formats a YYYY-MM-DD date
 *  and t/fmt/u are the caller's i18n, unit-format and unit helpers. */
export function wearCard(d, i, ctx) {
  const { t, fmt, u, dayLabel } = ctx;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const o = outfitFor(d);
  return `<article class="wcard band-${o.band}" data-day="${i === 0 ? 'today' : esc(d.date)}">
      <header><b>${i === 0 ? esc(t('wear_today')) : esc(dayLabel(d.date, { weekday: 'short', month: 'numeric', day: 'numeric' }))}</b>
        <span class="wtemp">${BAND[o.band]} ${fmt.temp(d.summit.feelsMin, u)}</span><span class="badge band-${o.band}">${esc(t('band_' + o.band))}</span></header>
      <div class="wcols">${outfitCol(o.adult, '👩 ' + esc(t('adults')), 'adult', t)}${outfitCol(o.kid, '🧒 ' + esc(t('kids')), 'kid', t)}</div>
      <div class="wnotes">${o.notes.map(k => `<span class="wi n" title="${esc(t(k))}"><i>${NICON[k] || '•'}</i>${esc(t('s_' + k))}</span>`).join('')}</div>
    </article>`;
}

/** Layer expand/collapse (the ▸ buttons in outfitCol). Call once on the page root. */
export function bindWearExpand(root = document) {
  root.addEventListener('click', e => {
    const wx = e.target.closest('[data-wexp]');
    if (!wx) return;
    const open = wx.getAttribute('aria-expanded') !== 'true';
    const det = wx.parentElement.querySelector('.wdet');
    setTimeout(() => { wx.setAttribute('aria-expanded', String(open)); if (det) det.hidden = !open; }, 0);
  });
}
