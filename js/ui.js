// Small DOM helpers. User content always goes through text nodes (never innerHTML),
// so words from shared lists can't inject markup.
import { t } from './i18n.js';
import * as store from './store.js';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk.startsWith('--') ? sk : sk.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), String(sv));
      } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

// Lucide icons (ISC licence), 24 px grid, drawn with currentColor.
const ICONS = {
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/>',
  iosShare: '<path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M8 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  listPlus: '<path d="M11 12H3"/><path d="M16 6H3"/><path d="M16 18H3"/><path d="M18 9v6"/><path d="M21 12h-6"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  keyboard: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.01"/><path d="M10 8h.01"/><path d="M14 8h.01"/><path d="M18 8h.01"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/><path d="M7 16h10"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  // special rounds and modes (design: Lucide tornado, flame, fast-forward, infinity, target + own Extrazeit and Zeitlimit)
  wirbel: '<path d="M21 4H3"/><path d="M18 8H6"/><path d="M19 12H9"/><path d="M16 16h-6"/><path d="M11 20H9"/>',
  kombo: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  zeitraffer: '<path d="M13 19 22 12 13 5z"/><path d="M2 19 11 12 2 5z"/>',
  extra: '<path d="M21 12.5A9 9 0 1 0 12.5 21"/><path d="M12 7v5l3 2"/><path d="M19 15v6"/><path d="M16 18h6"/>',
  limit: '<path d="M3.34 19a10 10 0 1 1 17.32 0"/><path d="m12 14 6 3"/><circle cx="12" cy="14" r="1"/>',
  endless: '<path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4Z"/>',
  training: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  trendDown: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  streak: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
};
const FILLED = new Set(['play', 'pause', 'star']);

export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon' + (FILLED.has(name) ? ' filled' : '') + (cls ? ' ' + cls : ''));
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

/** App logo: two cards, ivory and clay, on warm black. */
export function logo(cls = 'brand-logo') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 44 44');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', cls);
  svg.innerHTML = '<rect width="44" height="44" rx="11" fill="#1F1E1D"/><rect x="8" y="12" width="16" height="21" rx="3.5" fill="#FAF9F5" transform="rotate(-8 16 22.5)"/><rect x="20" y="10" width="16" height="21" rx="3.5" fill="#D97757" transform="rotate(7 28 20.5)"/>';
  return svg;
}

/** Difficulty marker: 1, 2 or 3 filled bars. */
export function levelBars(level, size = '') {
  const n = { easy: 1, medium: 2, hard: 3 }[level] || 1;
  return h('span', { class: 'lvbars lv-' + level + (size ? ' ' + size : ''), 'aria-hidden': 'true' },
    [1, 2, 3].map((i) => h('span', { class: i <= n ? 'on' : '' })));
}

// ---------- toast ----------

let toastTimer = null;
/** opts: { icon: 'check' } or { action: { label, onClick } } */
export function toast(msg, opts = {}) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(el);
  }
  el.className = 'toast' + (opts.action ? ' has-action' : '');
  el.replaceChildren(...[opts.icon ? icon(opts.icon) : null, h('span', null, msg)].filter(Boolean));
  if (opts.action) el.appendChild(h('button', { class: 'toast-btn', type: 'button', onclick: opts.action.onClick }, opts.action.label));
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), opts.action ? 10000 : 2600);
}

// ---------- modal ----------

function makeButton(b, close) {
  return h('button', {
    class: 'btn ' + (b.kind || 'outline') + (b.grow ? ' grow' : '') + (b.tall ? ' tall' : ''),
    type: 'button',
    onclick: () => close(b.value),
  }, b.iconLeft ? icon(b.iconLeft) : null, b.label, b.icon ? icon(b.icon, 'accent') : null);
}

// ---------- system status bar ----------
// While a dialog, sheet or the calendar dims the page, the status bar gets the same dimmed tone
// (page colour under the scrim), so there is no light/grey band above it.
const DIMMED = { light: '#999996', dark: '#111110' };
const dimKeys = new Set();
let dimSeq = 0;
export function dimStatusBar(key, on) {
  if (on) dimKeys.add(key); else dimKeys.delete(key);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    if (!m.dataset.base) m.dataset.base = m.getAttribute('content');
    const dark = (m.getAttribute('media') || '').includes('dark');
    m.setAttribute('content', dimKeys.size ? DIMMED[dark ? 'dark' : 'light'] : m.dataset.base);
  });
}

/** Removes every open dialog at once (when the screen changes). */
export function closeAllModals() {
  document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
  for (const k of [...dimKeys]) if (k.startsWith('modal')) dimKeys.delete(k);
  dimStatusBar('', false);
}

/**
 * Shows a dialog and resolves with the value of the pressed button.
 * icon: { name, kind: 'err' | 'accent' | 'ok', extra: 'big' | 'square' }
 * buttons: [{ label, value, kind: 'primary' | 'outline' | 'danger', grow }] or rows: [[...], [...]]
 */
export function modal({ title, icon: ic, body, buttons, cls = '', center = false, clear = false, dismissable = false, label }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    let done = false;
    const dimKey = 'modal' + (++dimSeq);
    if (!clear) dimStatusBar(dimKey, true);
    const close = (value) => {
      if (done) return;
      done = true;
      dimStatusBar(dimKey, false);
      wrap.classList.add('closing');
      setTimeout(() => wrap.remove(), clear ? 160 : 240);
      if (prevFocus && prevFocus.focus && prevFocus.isConnected) {
        try { prevFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
      }
      resolve(value);
    };
    const iconEl = ic ? h('span', { class: 'modal-icon ' + ic.kind + (ic.extra ? ' ' + ic.extra : ''), 'aria-hidden': 'true' }, icon(ic.name)) : null;
    const titleEl = title ? h('h2', { class: 'modal-title' }, title) : null;
    const head = center ? [iconEl, titleEl] : iconEl && !ic.above ? h('div', { class: 'modal-head' }, iconEl, titleEl) : [iconEl, titleEl];
    let actions = null;
    if (buttons && buttons.length) {
      const rows = Array.isArray(buttons[0]) ? buttons : [buttons];
      actions = rows.length > 1
        ? h('div', { class: 'modal-actions stacked' }, rows.map((r) => (r.length === 1 ? makeButton(r[0], close) : h('div', { class: 'btn-row' }, r.map((b) => makeButton(b, close))))))
        : h('div', { class: 'modal-actions' }, rows[0].map((b) => makeButton(b, close)));
    }
    const box = h('div', { class: 'modal ' + (center ? 'center ' : '') + cls, role: 'dialog', 'aria-modal': 'true', 'aria-label': label || title || '' },
      head, body || null, actions);
    const wrap = h('div', {
      class: 'modal-wrap' + (clear ? ' clear' : ''),
      onclick: (e) => { if (dismissable && e.target === wrap) close(null); },
    }, box);
    document.body.appendChild(wrap);
    const primary = box.querySelector('.btn.primary') || box.querySelector('.btn');
    if (primary) setTimeout(() => primary.focus({ preventScroll: true }), 30);
  });
}

/** Confirmation. danger: red action first (like "Spiel beenden?"), else primary action last. */
export function confirmDialog(title, text, okLabel, { danger = false, icon: ic = null } = {}) {
  const textEl = text instanceof Node ? text : h('p', { class: 'modal-text' }, text);
  const buttons = danger
    ? [{ label: okLabel, value: true, kind: 'danger' }, { label: t('cancel'), value: false, kind: 'outline', grow: true }]
    : [{ label: t('cancel'), value: false, kind: 'outline' }, { label: okLabel, value: true, kind: 'primary', grow: true }];
  return modal({ title, icon: ic ? { ...ic, above: true } : null, body: textEl, buttons, cls: 'modal-confirm', dismissable: true });
}

// ---------- sound & vibration ----------

let audioCtx = null;
function ctx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone(freq, dur, type = 'sine', delay = 0, gain = 0.12) {
  const c = ctx();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t0 = c.currentTime + delay;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export const sfx = {
  unlock() { if (store.settings().sound) ctx(); },
  good() { if (store.settings().sound) tone(880, 0.09, 'sine', 0, 0.08); },
  round() {
    if (!store.settings().sound) return;
    tone(660, 0.1); tone(990, 0.16, 'sine', 0.09);
  },
  bad() {
    if (store.settings().sound) { tone(180, 0.28, 'square', 0, 0.06); tone(140, 0.3, 'square', 0.12, 0.05); }
    if (store.settings().vibrate && navigator.vibrate) navigator.vibrate([90, 60, 160]);
  },
  /** Kombo step: the tone rises with the multiplier. */
  kombo(mult) {
    if (store.settings().sound) tone(660 + mult * 110, 0.1, 'triangle', 0.04, 0.09);
  },
  win() {
    if (!store.settings().sound) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', i * 0.11, 0.1));
  },
};
