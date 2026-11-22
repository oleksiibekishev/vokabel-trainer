// Tagesserie (days in a row): counter in the header, tile with the week, calendar.
// Design: "Vokabeltrainer – Tagesserie, Kalender & Übergänge".
import * as store from './store.js';
import { t, tList, tDays, plural } from './i18n.js';
import { h, icon, dimStatusBar } from './ui.js';
import { weekView, monthGrid, shiftMonth, bestStreak, addDays } from './core.js';

const SPARK_COLORS = ['var(--accent)', 'var(--ochre)', 'var(--olive)', 'var(--fig)', 'var(--sky)'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function replay(el, cls) {
  el.classList.remove(cls);
  void el.getBoundingClientRect();
  el.classList.add(cls);
}

/**
 * What the start screen shows. If a +1 or a break is still to be animated, the view shows the state
 * before it, and `anim` says what to play once the screen is visible.
 */
export function streakView() {
  const pending = store.peekStreakAnim();
  const brk = store.streakBreak();
  const cur = store.streak();
  const view = {
    today: cur.today, n: cur.n, doneToday: cur.doneToday, best: cur.best, days: cur.days,
    missed: brk.missed, lost: cur.n === 0 && brk.brokeToday && cur.best > 0, anim: null,
  };
  if (pending && cur.doneToday) {
    const before = new Set(cur.days);
    before.delete(cur.today);
    view.n = pending.from;
    view.doneToday = false;
    view.days = before;
    view.best = pending.bestBefore ?? Math.max(bestStreak([...before]), view.n);
    view.anim = { kind: 'plus', to: pending.to, best: cur.best, milestone: pending.milestone };
  } else if (brk.from > 0) {
    // before the animation the week still looks like the running streak
    view.n = brk.from;
    view.lost = false;
    view.anim = { kind: 'lost', from: brk.from, missed: brk.missed };
    view.runEnd = brk.missed ? addDays(brk.missed, -1) : null;
    view.missed = null;
  }
  return view;
}

const daysLabel = (n) => tDays(n) + ' ' + t('inARow');

function chipAria(v) {
  return t('streakChipAria', { n: v.n, d: tDays(v.n), state: t(v.doneToday ? 'streakStateDone' : 'streakStateOpen') });
}

// ---------- header chip ----------

export function streakChip(v, onOpen) {
  const num = h('span', { class: 'roll' }, String(v.n));
  const chip = h('span', { class: 'streak-chip' + (v.doneToday ? '' : ' pending') + (v.n === 0 ? ' zero' : '') },
    icon('streak'), num, h('i', { class: 'streak-dot' }));
  const btn = h('button', { class: 'streak-btn', type: 'button', 'aria-label': chipAria(v), onclick: onOpen }, chip);
  btn._parts = { chip, num };
  return btn;
}

// ---------- tile ----------

function hintOf(v) {
  if (v.lost) return ['lost', [t('streakHintLost', { n: v.best })]];
  if (v.doneToday) return ['done', [icon('check'), t('streakHintDone')]];
  if (v.n === 0) return ['', [t('streakHintNew')]];
  return ['', [t('streakHintOpen')]];
}

function weekList(v) {
  const short = tList('dayShort');
  const long = tList('dayLong');
  const days = weekView(v.days, v.today, v.missed, v.runEnd || null);
  return h('ol', { class: 'week', 'aria-label': t('weekAria') }, days.map((d) => {
    const cls = {
      done: 'done' + (d.old ? ' old' : ''), 'today-done': 'done today', 'today-open': 'pending today',
      missed: 'missed', future: 'future', empty: '',
    }[d.code];
    return h('li', { class: 'day ' + cls, style: { '--i': d.i }, 'data-day': d.i, 'aria-label': long[d.i] + ' – ' + t('dayState_' + d.code) },
      d.link ? h('span', { class: 'day-link' + (d.wait ? ' wait' : '') }) : null,
      h('span', { class: 'day-dot', 'aria-hidden': 'true' },
        h('span', { class: 'day-fill' }),
        d.code === 'today-done' ? icon('check') : h('span', { class: 'day-lbl' }, short[d.i])));
  }));
}

function bestEl(v, withChevron) {
  return h('span', { class: 'streak-best' }, icon('star'), t('streakRecord', { n: v.best }), withChevron ? icon('chevronRight', 'chev') : null);
}

function topRow(v, right) {
  return h('div', { class: 'streak-top' },
    h('span', { class: 'streak-icon' }, icon('streak')),
    h('div', { class: 'streak-count' },
      h('span', { class: 'streak-num roll' }, String(v.n)),
      h('span', { class: 'streak-label' }, daysLabel(v.n))),
    right);
}

export function streakCard(v, onOpen) {
  const [hc, ht] = hintOf(v);
  const card = h('section', {
    class: 'card streak', role: 'button', tabindex: '0', 'aria-haspopup': 'dialog', 'aria-label': t('streakCardAria'),
    onclick: onOpen,
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } },
  },
  topRow(v, bestEl(v, true)),
  weekList(v),
  h('p', { class: 'streak-hint ' + hc, 'aria-live': 'polite' }, ht));
  return card;
}

// ---------- animations on the start screen ----------

function roll(node, from, to, down) {
  node.classList.toggle('down', !!down);
  node.replaceChildren(h('span', { class: 'roll-old' }, String(from)), h('span', { class: 'roll-new' }, String(to)));
  clearTimeout(node._t);
  node._t = setTimeout(() => { node.textContent = String(to); node.classList.remove('down'); }, 520);
}

function sparks(host, n = 8, r = 28) {
  if (reduced()) return;
  const sp = h('span', { class: 'sparks', 'aria-hidden': 'true' });
  for (let i = 0; i < n; i++) {
    sp.appendChild(h('i', { style: { '--a': Math.round(i * 360 / n + (i % 2 ? 14 : 0)) + 'deg', '--r': (r + (i % 3) * 7) + 'px', '--c': SPARK_COLORS[i % SPARK_COLORS.length], '--d': ((i % 2) * 50) + 'ms' } }));
  }
  host.appendChild(sp);
  setTimeout(() => sp.remove(), 800);
}

function setHint(card, v) {
  const p = card.querySelector('.streak-hint');
  const [hc, ht] = hintOf(v);
  p.className = 'streak-hint ' + hc;
  p.replaceChildren(...ht);
  replay(p, 'swap');
}

/** +1 after the first finished game of the day: today fills, the chain grows, the numbers roll. */
async function animatePlus(card, chipBtn, a) {
  const v = { ...store.streak(), lost: false };
  const from = a.to - 1;
  if (chipBtn) {
    setTimeout(() => {
      const { chip, num } = chipBtn._parts;
      chip.querySelector('.streak-dot').classList.add('out');
      roll(num, from, a.to);
      chip.classList.remove('pending', 'zero');
      replay(chip, 'bump');
      sparks(chip, 8, 24);
      chipBtn.setAttribute('aria-label', chipAria(v));
    }, card ? 360 : 0);
  }
  if (!card) return;
  const day = card.querySelector('.day.today');
  const link = day && day.querySelector('.day-link');
  if (link) { link.classList.remove('wait'); replay(link, 'grow'); await wait(200); }
  if (day) {
    day.classList.remove('pending');
    day.classList.add('filling');
  }
  await wait(160);
  if (day) {
    const lbl = day.querySelector('.day-lbl');
    if (lbl) lbl.replaceWith(icon('check', 'pop'));
  }
  roll(card.querySelector('.streak-num'), from, a.to);
  card.querySelector('.streak-label').textContent = daysLabel(a.to);
  sparks(card.querySelector('.streak-icon'), 10, 34);
  await wait(300);
  if (day) {
    day.classList.add('done');
    day.classList.remove('filling');
    day.setAttribute('aria-label', tList('dayLong')[Number(day.dataset.day)] + ' – ' + t('dayState_today-done'));
  }
  card.querySelector('.streak-best').replaceWith(bestEl(v, true));
  setHint(card, v);
  await wait(300);
  if (a.milestone) await milestone(card, a.to);
}

/** 7, 14, 30, 50, 100 days: a wave over the week, a ring around the tile, a short message. */
async function milestone(card, n) {
  replay(card.querySelector('.week'), 'wave');
  replay(card, 'milestone');
  const text = n % 7 === 0 && n <= 14
    ? t('milestoneWeeks', { n: n / 7, w: plural(n / 7, 'week') })
    : t('milestoneDays', { n });
  const r = card.getBoundingClientRect();
  const pill = h('span', { class: 'callout record' }, icon('streak'), text);
  const layer = h('div', { class: 'callout-layer fixed', style: { top: Math.round(r.bottom + 8) + 'px' } }, pill);
  document.body.appendChild(layer);
  await wait(1450);
  pill.classList.add('out');
  await wait(260);
  layer.remove();
}

/** A day was missed: it gets crossed out, the chain fades, the number rolls down to 0. */
async function animateLost(card, chipBtn, a) {
  const v = store.streak();
  if (card) {
    const days = weekView(v.days, v.today, a.missed);
    const idx = days.findIndex((d) => d.key === a.missed);
    const day = idx >= 0 ? card.querySelector('.day[data-day="' + idx + '"]') : null;
    if (day) {
      day.classList.add('missed', 'missing');
      day.setAttribute('aria-label', tList('dayLong')[idx] + ' – ' + t('dayState_missed'));
      await wait(450);
    }
    card.querySelector('.week').classList.add('broken');
    roll(card.querySelector('.streak-num'), a.from, 0, true);
    card.querySelector('.streak-label').textContent = daysLabel(0);
  }
  if (chipBtn) {
    const { chip, num } = chipBtn._parts;
    roll(num, a.from, 0, true);
    chip.classList.add('zero');
    chipBtn.setAttribute('aria-label', chipAria({ ...v, n: 0 }));
  }
  if (!card) return;
  await wait(300);
  replay(card.querySelector('.streak-best'), 'bump');
  setHint(card, { ...v, n: 0, lost: true });
  await wait(300);
}

/** Plays what is still due (+1 or break). Call when the start screen is visible. */
export async function playStreakAnim(view, card, chipBtn) {
  const a = view.anim;
  if (!a) return;
  view.anim = null;
  if (a.kind === 'plus') {
    store.takeStreakAnim();
    store.setStreakShown(a.to);
    await animatePlus(card, chipBtn, a);
  } else {
    await animateLost(card, chipBtn, a);
  }
}

// ---------- calendar ----------

function monthName(ym) {
  const [y, m] = ym.split('-').map(Number);
  return tList('months')[m - 1] + ' ' + y;
}

function monthStat(days, ym) {
  const n = [...days].filter((d) => d.startsWith(ym)).length;
  return tList('months')[Number(ym.slice(5)) - 1] + ': ' + n + ' ' + tDays(n);
}

function monthPage(days, ym, today, cls = '') {
  const months = tList('months');
  const m = Number(ym.slice(5)) - 1;
  const rows = monthGrid(days, ym, today).map((row, r) => h('div', { class: 'cal-row', role: 'row', style: { '--i': 4 + r } },
    row.map((c) => {
      if (!c) return h('span', { class: 'cal-cell', 'aria-hidden': 'true' });
      const sr = c.lit ? t('dayState_done') : c.today ? t('dayState_today-open') : c.future ? '' : t('dayState_empty');
      return h('span', {
        class: 'cal-cell' + (c.lit ? ' lit' : '') + (c.joinLeft ? ' jl' : '') + (c.joinRight ? ' jr' : '') + (c.today ? ' today' : '') + (c.future ? ' future' : ''),
        role: 'gridcell', 'aria-label': c.day + '. ' + months[m] + (sr ? ' – ' + sr : ''),
      }, h('span', { class: 'cal-dot', 'aria-hidden': 'true' }, String(c.day)));
    })));
  return h('div', { class: 'cal-page' + (cls ? ' ' + cls : '') }, rows);
}

let calOpen = null;

export function calendarIsOpen() {
  return !!calOpen;
}

/**
 * The tile stretches over the start screen into the calendar.
 * onRequestClose: what ×, a tap on the dimmed page or Esc do (main.js goes back in the history,
 * so the Android back button closes the calendar too); default: close directly.
 */
export async function openCalendar(card, { setBusy = () => {}, onRequestClose = null } = {}) {
  if (calOpen || !card) return;
  setBusy(true);
  try {
    if (window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
      await wait(reduced() ? 30 : 450);
      window.scrollTo(0, 0);
    }
    const v = store.streak();
    const today = v.today;
    const days = v.days;
    const first = days.size ? [...days].sort()[0].slice(0, 7) : today.slice(0, 7);
    const last = today.slice(0, 7);
    let ym = last;
    const cr = card.getBoundingClientRect();
    const top = Math.max(10, cr.top);
    const scrim = h('div', { class: 'cal-scrim in' });
    const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('calClose') }, icon('close'));
    const prev = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('calPrev') }, icon('chevronLeft'));
    const next = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('calNext') }, icon('chevronRight'));
    const monthTitle = h('h3', { class: 'cal-month', 'aria-live': 'polite' }, monthName(ym));
    const mstat = h('span', null, monthStat(days, ym));
    const pages = h('div', { class: 'cal-pages', role: 'grid', 'aria-label': monthName(ym) }, monthPage(days, ym, today));
    const ghost = h('div', { class: 'cal-ghost', 'aria-hidden': 'true' });
    for (const ch of card.children) ghost.appendChild(ch.cloneNode(true));
    const body = h('div', { class: 'cal-body' },
      h('div', { class: 'cal-head streak-top', style: { '--i': 0 } },
        h('span', { class: 'streak-icon' }, icon('streak')),
        h('div', { class: 'streak-count' },
          h('span', { class: 'streak-num' }, String(v.n)),
          h('span', { class: 'streak-label' }, daysLabel(v.n))),
        closeBtn),
      h('p', { class: 'cal-stats', style: { '--i': 1 } }, icon('star'), t('streakRecord', { n: v.best }) + ' ' + tDays(v.best), h('span', { 'aria-hidden': 'true' }, '·'), mstat),
      h('div', { class: 'cal-nav', style: { '--i': 2 } }, prev, monthTitle, next),
      h('div', { class: 'cal-dow', style: { '--i': 3 }, 'aria-hidden': 'true' }, tList('dayShort').map((d) => h('span', null, d))),
      pages,
      h('p', { class: 'cal-legend', style: { '--i': 10 } },
        h('span', { class: 'cal-key' }), t('calLegendPlayed'), h('i'), h('span', { class: 'cal-key pending' }), t('calLegendOpen')));
    const cal = h('div', { class: 'cal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('calTitle') },
      h('div', { class: 'cal-shape', 'aria-hidden': 'true' },
        h('span', { class: 'cal-shadow' }), h('span', { class: 'cal-mid' }), h('span', { class: 'cal-cap t' }), h('span', { class: 'cal-cap b' })),
      ghost, body);
    cal.style.left = cr.left + 'px';
    cal.style.top = top + 'px';
    cal.style.width = cr.width + 'px';
    document.body.append(scrim, cal);
    const H = Math.min(body.scrollHeight, window.innerHeight - top - 12);
    cal.style.height = H + 'px';
    const dt = cr.top - top;
    cal.style.setProperty('--dt', dt + 'px');
    cal.style.setProperty('--k', ((cr.height - 30) / (H - 30)).toFixed(4));
    cal.style.setProperty('--db', (dt + cr.height - H) + 'px');
    document.documentElement.classList.add('locked');
    dimStatusBar('cal', true);
    cal.classList.add('opening');

    const setNav = () => {
      prev.disabled = ym <= first;
      next.disabled = ym >= last;
    };
    setNav();
    const page = (dir) => {
      const nym = shiftMonth(ym, dir);
      if (nym < first || nym > last) return;
      const old = pages.lastElementChild;
      old.style.setProperty('--px', dir * 28 + 'px');
      old.classList.add('out');
      const nu = monthPage(days, nym, today, 'in');
      nu.style.setProperty('--px', dir * 28 + 'px');
      pages.appendChild(nu);
      setTimeout(() => old.remove(), 240);
      ym = nym;
      pages.setAttribute('aria-label', monthName(ym));
      monthTitle.textContent = monthName(ym);
      replay(monthTitle, 'swap');
      mstat.textContent = monthStat(days, ym);
      replay(mstat, 'swap');
      setNav();
    };
    prev.addEventListener('click', () => page(-1));
    next.addEventListener('click', () => page(1));
    let x0 = null;
    pages.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
    pages.addEventListener('pointerup', (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 40) page(dx < 0 ? 1 : -1);
    });
    calOpen = { cal, scrim, card, closing: false };
    const requestClose = () => { if (calOpen && !calOpen.closing) (onRequestClose || closeCalendar)(); };
    closeBtn.addEventListener('click', requestClose);
    scrim.addEventListener('click', requestClose);
    calOpen.onKey = (e) => { if (e.key === 'Escape') requestClose(); };
    document.addEventListener('keydown', calOpen.onKey);
    await wait(560);
    cal.classList.remove('opening');
    closeBtn.focus({ preventScroll: true });
  } finally {
    setBusy(false);
  }
}

/** Back into the tile. */
export async function closeCalendar() {
  const c = calOpen;
  if (!c || c.closing) return;
  c.closing = true;
  document.removeEventListener('keydown', c.onKey);
  c.cal.classList.remove('opening');
  c.cal.classList.add('closing');
  c.scrim.classList.remove('in');
  c.scrim.classList.add('out');
  dimStatusBar('cal', false);
  await wait(470);
  c.cal.remove();
  c.scrim.remove();
  document.documentElement.classList.remove('locked');
  calOpen = null;
  if (c.card && c.card.isConnected) c.card.focus({ preventScroll: true });
}

