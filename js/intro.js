// Einführung: shown once on the first start (instead of the old "So funktioniert's" box),
// again from Einstellungen → Einführung. 7 short steps; swipe, buttons or the arrow keys.
// The pictures are built from the app's own pieces (tiles, timer, dots, badges).

import * as store from './store.js';
import { t, tList } from './i18n.js';
import { h, icon, logo, levelBars } from './ui.js';

let cur = null; // { el, rail, slides, i, resolve, onRequestClose }

export function introIsOpen() {
  return !!cur;
}

// ---------- pictures ----------

const tile = (text, cls = '', lang = 'en') => h('span', { class: 'ob-tile ' + cls, lang }, text);

function artWelcome() {
  return h('div', { class: 'ob-art ob-welcome' },
    logo('ob-logo'),
    h('div', { class: 'ob-pair' },
      tile('garage', 'a'),
      h('span', { class: 'ob-link', 'aria-hidden': 'true' }),
      tile('die Autowerkstatt', 'b', 'de')));
}

function artTimer() {
  const dots = Array.from({ length: 10 }, (_, i) => h('span', {
    class: 'dot' + (i < 3 ? ' fixed done' : i === 3 ? ' done' : i === 4 ? ' cur' : ''),
  }));
  return h('div', { class: 'ob-art ob-timer' },
    h('div', { class: 'ob-head' },
      h('span', { class: 'ob-round' }, levelBars('medium', 'sm'), t('round', { r: 5, n: 10 })),
      h('span', { class: 'ob-time' }, h('b', null, '27'), h('span', null, 's'))),
    h('div', { class: 'timebar ob-bar' }, h('div', { class: 'ob-fill' })),
    h('span', { class: 'bonus-chip ob-plus' }, '+10 s'),
    h('div', { class: 'dots ob-dots' }, dots));
}

function artGames() {
  const card = (type, pic) => h('div', { class: 'ob-game' }, h('div', { class: 'ob-pic' }, pic), h('span', null, t('type_' + type)));
  return h('div', { class: 'ob-art ob-games' },
    card('pairs', h('div', { class: 'ob-mini-pairs' }, tile('dog', 'xs'), tile('Hund', 'xs ok', 'de'))),
    card('choice', h('div', { class: 'ob-mini-choice' }, h('i'), h('i', { class: 'on' }), h('i'))),
    card('gaps', h('div', { class: 'ob-mini-gaps', lang: 'en' }, ['h', '', 'u', 's', ''].map((c) => h('i', { class: c ? '' : 'gap' }, c)))),
    card('spell', h('div', { class: 'ob-mini-spell', lang: 'en' }, 'house', h('i', { class: 'caret' }))));
}

function artSpecial() {
  const mods = ['wirbel', 'kombo', 'zeitraffer'];
  if (store.settings().zeitbombe !== false) mods.push('zeitbombe');
  return h('div', { class: 'ob-art ob-special' }, h('ul', null, mods.map((m) => h('li', null,
    h('span', { class: 'legend-icon mod-' + m, 'aria-hidden': 'true' }, icon(m)),
    h('span', null, h('b', null, t('mod_' + m)), ' – ' + t('legend_' + m))))));
}

function artLevels() {
  const row = (lvl, state) => h('div', { class: 'ob-level lv-' + lvl + ' ' + state },
    levelBars(lvl), h('span', null, t('level_' + lvl)), icon(state === 'done' ? 'check' : state === 'locked' ? 'lock' : 'play'));
  return h('div', { class: 'ob-art ob-levels' },
    row('easy', 'done'), row('medium', 'open'), row('hard', 'locked'),
    h('div', { class: 'ob-modes' },
      h('span', { class: 'ob-mode' }, icon('endless'), t('level_endless')),
      h('span', { class: 'ob-mode' }, icon('training'), t('level_training'))));
}

function artStreak() {
  const days = tList('dayShort');
  return h('div', { class: 'ob-art ob-streak' },
    h('span', { class: 'streak-chip ob-chip' }, icon('streak'), h('span', null, '5')),
    h('div', { class: 'ob-week' }, days.map((d, i) => h('span', { class: 'ob-day' + (i < 5 ? ' lit' : '') + (i === 4 ? ' today' : ''), style: { '--i': i } },
      h('i', null, i < 5 ? icon('check') : null), h('small', null, d)))));
}

function artLists() {
  const row = (name, n, active) => h('div', { class: 'ob-list' + (active ? ' active' : '') },
    h('span', { class: 'ob-list-name' }, h('b', null, name), h('small', null, t('wordsN', { n }))),
    h('span', { class: 'ob-list-icons' }, icon('pencil'), icon('share')));
  return h('div', { class: 'ob-art ob-lists' },
    row('KA1 E Vorbereitung', 36, true),
    row(t('obMyList'), 24, false),
    h('span', { class: 'ob-add' }, icon('listPlus'), t('addList')));
}

const STEPS = [
  { art: artWelcome, key: 1 },
  { art: artTimer, key: 2, note: true },
  { art: artGames, key: 3 },
  { art: artSpecial, key: 4 },
  { art: artLevels, key: 5 },
  { art: artStreak, key: 6 },
  { art: artLists, key: 7 },
];

// ---------- the overlay ----------

/**
 * Opens the Einführung; resolves when it is closed (finished, skipped or back button).
 * onRequestClose: how to close (main.js goes back in the history, so the back button works).
 */
export function openIntro({ onRequestClose } = {}) {
  if (cur) return Promise.resolve();
  return new Promise((resolve) => {
    const n = STEPS.length;
    const slides = STEPS.map((s, i) => h('section', {
      class: 'ob-slide', 'aria-roledescription': 'slide', 'aria-label': t('introStep', { i: i + 1, n }), 'aria-hidden': 'true',
    },
    s.art(),
    h('h2', { class: 'ob-title' }, t('intro' + s.key + 'Title')),
    h('p', { class: 'ob-text' }, t('intro' + s.key + 'Text')),
    s.note ? h('p', { class: 'ob-note' }, t('intro' + s.key + 'Note')) : null));
    const rail = h('div', { class: 'ob-rail' }, slides);
    const track = h('div', { class: 'ob-track' }, rail);
    const dots = h('div', { class: 'ob-dots', 'aria-hidden': 'true' }, slides.map(() => h('i')));
    const skip = h('button', { class: 'btn text ob-skip', type: 'button' }, t('introSkip'));
    const back = h('button', { class: 'btn outline ob-back', type: 'button' }, t('introBack'));
    const next = h('button', { class: 'btn primary ob-next', type: 'button' }, t('introNext'), icon('arrowRight', 'accent'));
    const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    const el = h('div', { class: 'intro', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('introSetting'), tabindex: '-1' },
      h('div', { class: 'ob-top' }, dots, skip), track, h('div', { class: 'ob-actions' }, back, next), live);
    cur = { el, rail, slides, dots, back, next, live, i: -1, resolve, onRequestClose };

    const close = () => (onRequestClose ? onRequestClose() : closeIntro());
    skip.addEventListener('click', close);
    back.addEventListener('click', () => go(cur.i - 1));
    next.addEventListener('click', () => (cur.i >= n - 1 ? close() : go(cur.i + 1)));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') go(cur.i + 1);
      else if (e.key === 'ArrowLeft') go(cur.i - 1);
      else if (e.key === 'Escape') close();
    });
    swipe(track);

    document.body.appendChild(el);
    document.documentElement.classList.add('locked');
    go(0);
    requestAnimationFrame(() => el.classList.add('in'));
    // focus on the dialog (not on "Weiter": a focus ring there looked like an error on phones)
    setTimeout(() => el.focus({ preventScroll: true }), 50);
  });
}

function go(i) {
  if (!cur) return;
  const n = cur.slides.length;
  i = Math.max(0, Math.min(n - 1, i));
  if (i === cur.i) { cur.rail.style.transform = 'translateX(' + (-i * 100) + '%)'; return; }
  cur.i = i;
  cur.rail.style.transform = 'translateX(' + (-i * 100) + '%)';
  cur.slides.forEach((s, k) => {
    s.classList.toggle('on', k === i);
    s.setAttribute('aria-hidden', String(k !== i));
  });
  [...cur.dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
  cur.back.style.visibility = i === 0 ? 'hidden' : '';
  const last = i === n - 1;
  cur.next.firstChild.textContent = t(last ? 'introDone' : 'introNext');
  cur.next.classList.toggle('done', last);
  cur.live.textContent = t('introStep', { i: i + 1, n }) + ': ' + t('intro' + STEPS[i].key + 'Title');
}

/** Swipe left/right; vertical movement is left to the browser. */
function swipe(track) {
  let x0 = null;
  let y0 = 0;
  let dx = 0;
  let pid = null;
  let horiz = null;
  track.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; pid = e.pointerId; horiz = null;
  });
  track.addEventListener('pointermove', (e) => {
    if (x0 === null || e.pointerId !== pid || !cur) return;
    const ddx = e.clientX - x0;
    const ddy = e.clientY - y0;
    if (horiz === null) {
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
      horiz = Math.abs(ddx) > Math.abs(ddy);
      if (!horiz) { x0 = null; return; }
      try { track.setPointerCapture(pid); } catch { /* ignore */ }
      cur.rail.classList.add('dragging');
    }
    dx = ddx;
    const edge = (cur.i === 0 && dx > 0) || (cur.i === cur.slides.length - 1 && dx < 0);
    cur.rail.style.transform = 'translateX(calc(' + (-cur.i * 100) + '% + ' + (edge ? dx / 3 : dx) + 'px))';
  });
  const end = (e) => {
    if (x0 === null || e.pointerId !== pid || !cur) return;
    x0 = null;
    if (!horiz) return;
    cur.rail.classList.remove('dragging');
    const w = track.offsetWidth;
    if (dx < -Math.min(60, w * 0.18)) go(cur.i + 1);
    else if (dx > Math.min(60, w * 0.18)) go(cur.i - 1);
    else go(cur.i);
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
}

/** Closes the overlay (the Einführung counts as seen – also when skipped). */
export function closeIntro() {
  if (!cur) return Promise.resolve();
  const c = cur;
  cur = null;
  if (!store.settings().introSeen) store.setSetting('introSeen', true);
  c.el.classList.remove('in');
  c.el.classList.add('out');
  return new Promise((r) => setTimeout(() => {
    c.el.remove();
    if (!document.querySelector('.sheet') && !document.querySelector('.cal')) document.documentElement.classList.remove('locked');
    c.resolve();
    r();
  }, 260));
}
