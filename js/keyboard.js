// Own on-screen keyboard for the typing games (Lücken, Schreiben). The phone keyboard suggests
// words while typing – and so gives the answer away. Here the input keeps the focus with
// inputmode="none" (no phone keyboard opens), the keys write into it; a hardware keyboard still works.
// Only on touch screens; can be switched off in the settings (then the phone keyboard as before).

import { keyLayout } from './core.js';
import * as store from './store.js';
import { t } from './i18n.js';
import { h, icon } from './ui.js';

const REPEAT_DELAY = 420;
const REPEAT_MS = 70;

/** On a touch screen, unless switched off in the settings. */
export function ownKeyboardWanted() {
  if (store.settings().ownKeyboard === false) return false;
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
}

export function touchScreen() {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
}

export class Keyboard {
  /** lang: language of the typed words ('de', 'en', 'uk'); extra: characters without a key in the layout. */
  constructor({ root, lang, extra = [] }) {
    this.root = root;
    this.lang = lang;
    this.input = null;
    this.max = 0;
    this.shift = 0; // 0 off, 1 next letter, 2 caps lock
    this.lastShift = 0;
    this.repeat = null;
    const L = keyLayout(lang);
    const n = Math.max(...L.rows.map((r) => [...r].length), [...L.rows[2]].length + 3);
    const key = (ch, cls = '') => h('button', {
      class: 'osk-key osk-ch' + cls, type: 'button', tabindex: '-1', 'data-k': ch, 'data-c': ch, lang,
    }, ch);
    this.letterKeys = [];
    const letters = (row) => [...row].map((ch) => { const b = key(ch); this.letterKeys.push(b); return b; });
    this.elShift = h('button', { class: 'osk-key osk-fn osk-shift', type: 'button', tabindex: '-1', 'data-k': 'shift', 'aria-label': t('kbShift'), 'aria-pressed': 'false', style: { '--w': 1.5 } }, icon('shift'));
    const rows = [
      extra.length ? h('div', { class: 'osk-row osk-extra' }, extra.map((ch) => key(ch, ' osk-small'))) : null,
      h('div', { class: 'osk-row' }, letters(L.rows[0])),
      h('div', { class: 'osk-row' }, letters(L.rows[1])),
      h('div', { class: 'osk-row' },
        this.elShift,
        letters(L.rows[2]),
        h('button', { class: 'osk-key osk-fn', type: 'button', tabindex: '-1', 'data-k': 'back', 'aria-label': t('kbBack'), style: { '--w': 1.5 } }, icon('backspace'))),
      h('div', { class: 'osk-row' },
        L.side.map((ch) => key(ch)),
        h('button', { class: 'osk-key osk-space', type: 'button', tabindex: '-1', 'data-k': ' ', 'aria-label': t('kbSpace'), style: { '--w': n - L.side.length - 2 } }, h('span', { class: 'osk-space-label' }, t('langName_' + lang))),
        h('button', { class: 'osk-key osk-enter', type: 'button', tabindex: '-1', 'data-k': 'enter', 'aria-label': t('check'), style: { '--w': 2 } }, icon('enter'))),
    ];
    this.el = h('div', { class: 'osk', role: 'group', 'aria-label': t('kbLabel'), style: { '--n': n } },
      h('div', { class: 'osk-in' }, rows));
    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('pointerup', (e) => this.up(e));
    this.el.addEventListener('pointercancel', (e) => this.up(e));
    this.el.addEventListener('lostpointercapture', (e) => this.up(e));
    // screen readers and switch access press keys with a click (no pointerdown before it)
    this.el.addEventListener('click', (e) => { if (e.detail === 0) { const k = e.target.closest('.osk-key'); if (k) this.press(k.dataset.k); } });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    // in <body>, not in the game screen: its enter/leave animations move the screen (transform)
    document.body.appendChild(this.el);
  }

  /** The keyboard writes into this input; maxLetters: Lücken (only so many letters). */
  attach(input, { maxLetters = 0 } = {}) {
    this.input = input;
    this.max = maxLetters;
    input.setAttribute('inputmode', 'none');
    if (this.shift !== 2) this.setShift(0);
    this.el.classList.add('on');
    this.root.classList.add('osk-on');
    this.root.style.setProperty('--osk-h', this.el.offsetHeight + 'px');
  }

  detach() {
    this.stopRepeat();
    this.input = null;
    this.el.classList.remove('on');
    this.root.classList.remove('osk-on');
  }

  destroy() {
    this.detach();
    this.el.remove();
  }

  down(e) {
    const k = e.target.closest('.osk-key');
    if (!k) return;
    e.preventDefault(); // the input keeps the focus
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    k.classList.add('down');
    if (store.settings().vibrate && navigator.vibrate) { try { navigator.vibrate(8); } catch { /* ignore */ } }
    this.press(k.dataset.k);
    if (k.dataset.k === 'back') {
      this.stopRepeat();
      this.repeat = setTimeout(() => {
        this.repeat = setInterval(() => this.press('back'), REPEAT_MS);
      }, REPEAT_DELAY);
    }
  }

  up(e) {
    const k = e.target.closest && e.target.closest('.osk-key');
    if (k) k.classList.remove('down');
    if (!k || k.dataset.k === 'back') this.stopRepeat();
  }

  stopRepeat() {
    clearTimeout(this.repeat);
    clearInterval(this.repeat);
    this.repeat = null;
  }

  press(k) {
    const inp = this.input;
    if (!inp || !inp.isConnected || inp.disabled) return;
    if (k === 'shift') { this.toggleShift(); return; }
    if (document.activeElement !== inp) {
      inp.focus({ preventScroll: true });
      const end = inp.value.length;
      try { inp.setSelectionRange(end, end); } catch { /* ignore */ }
    }
    if (k === 'enter') {
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      return;
    }
    if (k === 'back') { this.erase(); return; }
    let ch = k;
    if (this.shift && ch.length === 1) {
      const up = ch.toUpperCase();
      if (up.length === 1) ch = up;
    }
    if (this.max && /\p{L}/u.test(ch) && [...inp.value.replace(/[^\p{L}]/gu, '')].length >= this.max) return;
    this.write(ch);
    if (this.shift === 1) this.setShift(0);
  }

  write(ch) {
    const inp = this.input;
    const s = inp.selectionStart ?? inp.value.length;
    const e = inp.selectionEnd ?? s;
    inp.setRangeText(ch, s, e, 'end');
    inp.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
  }

  erase() {
    const inp = this.input;
    let s = inp.selectionStart ?? inp.value.length;
    const e = inp.selectionEnd ?? s;
    if (s === e) {
      if (s === 0) return;
      const before = [...inp.value.slice(0, s)];
      s -= before[before.length - 1].length;
    }
    inp.setRangeText('', s, e, 'end');
    inp.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  }

  /** Tap: the next letter big; tap twice quickly: all big (caps lock); tap again: off. */
  toggleShift() {
    const now = performance.now();
    if (this.shift === 0) this.setShift(now - this.lastShift < 350 ? 2 : 1);
    else if (this.shift === 1 && now - this.lastShift < 350) this.setShift(2);
    else this.setShift(0);
    this.lastShift = now;
  }

  setShift(v) {
    this.shift = v;
    this.elShift.classList.toggle('on', v > 0);
    this.elShift.classList.toggle('lock', v === 2);
    this.elShift.setAttribute('aria-pressed', String(v > 0));
    for (const b of this.letterKeys) {
      const ch = b.dataset.k;
      const up = ch.toUpperCase();
      const show = v && up.length === 1 ? up : ch;
      b.textContent = show;
      b.dataset.c = show;
    }
  }
}
