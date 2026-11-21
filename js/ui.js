// Small DOM helpers. All text goes through text nodes (never innerHTML),
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
      }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
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

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-2.5a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.8 1.7 1l.4 2.5h4l.4-2.5c.6-.2 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.6Z',
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6 6 18',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z',
  share: 'M12 3v12M7 8l5-5 5 5M5 13v7h14v-7',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5',
  play: 'M8 5v14l11-7z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  pause: 'M8 5v14M16 5v14',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
};

export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon ' + cls);
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', ICONS[name] || '');
  svg.appendChild(p);
  return svg;
}

// ---------- toast ----------

let toastTimer = null;
export function toast(msg, action) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(el);
  }
  el.replaceChildren(h('span', null, msg));
  if (action) el.appendChild(h('button', { class: 'toast-btn', onclick: action.onClick }, action.label));
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 8000 : 2600);
}

// ---------- modal ----------

/**
 * Shows a dialog. buttons: [{label, value, kind}] → resolves with the value.
 * opts.dismissable: tapping the backdrop resolves with null.
 */
export function modal({ title, body, buttons, cls = '', dismissable = false }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const close = (value) => {
      wrap.classList.add('closing');
      setTimeout(() => wrap.remove(), 160);
      if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
      resolve(value);
    };
    const box = h('div', { class: 'modal ' + cls, role: 'dialog', 'aria-modal': 'true' },
      title ? h('h2', { class: 'modal-title' }, title) : null,
      body ? h('div', { class: 'modal-body' }, body) : null,
      buttons && buttons.length
        ? h('div', { class: 'modal-actions' },
          buttons.map((b) => h('button', { class: 'btn ' + (b.kind || 'secondary'), onclick: () => close(b.value) }, b.label)))
        : null,
    );
    const wrap = h('div', {
      class: 'modal-wrap',
      onclick: (e) => { if (dismissable && e.target === wrap) close(null); },
    }, box);
    document.body.appendChild(wrap);
    const primary = box.querySelector('.btn.primary') || box.querySelector('.btn');
    if (primary) setTimeout(() => primary.focus({ preventScroll: true }), 30);
  });
}

export function confirmDialog(title, text, okLabel, danger = false) {
  return modal({
    title,
    body: h('p', null, text),
    buttons: [
      { label: t('cancel'), value: false, kind: 'secondary' },
      { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' },
    ],
    dismissable: true,
  });
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
  win() {
    if (!store.settings().sound) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', i * 0.11, 0.1));
  },
};
