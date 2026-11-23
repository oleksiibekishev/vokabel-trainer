// Zeitbombe – special round (test version; switch: Einstellungen → Testfunktionen).
// 5 pairs in 10 s on a 4 × 2 board. After every 2 found pairs the whole board gets new words,
// so new tiles never give away which ones belong together. A wrong pair locks the board for 1 s,
// the time goes on. Success: the time is full again (Endlos: +20 s). Time over: the game ends.
// Everything of this round lives here and in css/zeitbombe.css; game.js only calls in.

import { BOMB, bombClock, bombLayout, pickWords, pickVariant } from './core.js';
import * as store from './store.js';
import { t } from './i18n.js';
import { h, icon, sfx } from './ui.js';

const ROOT_CLASSES = ['zb-mode', 'zb-enter', 'zb-exit', 'zb-refill', 'zb-alarm', 'zb-defused', 'zb-dead'];
const TOTAL = BOMB.secs * 1000;

export class Bomb {
  constructor(game) {
    this.g = game;
    this.mounted = false;
    this.seq = 0;
    this.state = 'off';
  }

  /** Timer, fuse and the 5 lamps go into the game header once; CSS keeps them hidden outside the round. */
  mount() {
    if (this.mounted) return;
    this.mounted = true;
    const g = this.g;
    g.root.classList.add('zb');
    this.elNum = h('span', { class: 'zb-num' }, bombClock(TOTAL));
    this.elTimer = h('div', { class: 'zb-timer', role: 'timer' }, this.elNum, h('span', { class: 'zb-unit' }, 's'));
    g.elTimer.parentNode.appendChild(this.elTimer);
    g.elBar.appendChild(h('div', { class: 'zb-fillwrap' }, h('div', { class: 'zb-fill' })));
    this.elRun = h('div', { class: 'zb-spark-run', 'aria-hidden': 'true' },
      h('span', { class: 'zb-spark' }), h('span', { class: 'zb-smoke' }, h('i'), h('i'), h('i')));
    this.elWrap = h('div', { class: 'zb-barwrap' });
    g.elBar.replaceWith(this.elWrap);
    this.elWrap.append(g.elBar, this.elRun);
    this.pips = Array.from({ length: BOMB.need }, () => h('span', { class: 'zb-pip' }, icon('check')));
    this.elPips = h('div', { class: 'zb-pips', role: 'img' }, this.pips);
    g.elDots.parentNode.appendChild(this.elPips);
  }

  /** New game ("Nochmal"): nothing of an old bomb stays. */
  reset() {
    this.seq++;
    this.state = 'off';
    if (this.g.root) this.g.root.classList.remove(...ROOT_CLASSES);
  }

  /** Timeouts that die with this bomb (restart, end of the game). */
  after(ms, fn) {
    const s = this.seq;
    const e = this.g.epoch;
    setTimeout(() => { if (s === this.seq && e === this.g.epoch && !this.g.destroyed) fn(); }, ms);
  }

  /** Start of the round: words of the first board (fewer than 4 pairs → no bomb). The main time stands still from now on. */
  begin() {
    this.mount();
    this.seq++;
    this.seen = new Set();
    this.found = new Set();
    const words = this.pickBoard();
    if (words.length < BOMB.pairs) return [];
    this.resetCounters();
    this.state = 'banner';
    this.g.hold('bomb');
    this.renderNum(true);
    this.setP(1);
    return words;
  }

  resetCounters() {
    this.left = TOTAL;
    this.matched = 0;
    this.onBoard = 0;
    this.sel = null;
    this.locked = false;
    this.swapping = false;
    this.alarm = false;
    this.needRestart = false;
    this.lastBeat = null;
    this.pips.forEach((p) => p.classList.remove('on', 'new'));
    this.renderPips();
  }

  /** 4 pairs, words not seen in this bomb first; found words never come back. */
  pickBoard() {
    const g = this.g;
    const pool = g.words.filter((w) => !this.found.has(w.id));
    const used = new Set([...g.used, ...this.seen]);
    const words = pickWords(pool, BOMB.pairs, { used, stats: store.stats(g.list.id) });
    words.forEach((w) => { this.seen.add(w.id); g.used.add(w.id); });
    return words;
  }

  // ---------- board ----------

  /** The 4 × 2 board; covered: words hidden under two bars (during the banner and before a restart). */
  renderBoard(words, { covered = false, fresh = false } = {}) {
    const g = this.g;
    this.sel = null;
    this.tiles = bombLayout(words).map(({ w, side }, i) => {
      const text = pickVariant(side === 'en' ? w.en : w.de, side);
      const el = h('button', { class: 'tile zb-tile', type: 'button', lang: side, 'data-side': side, 'data-wid': w.id },
        h('span', { class: 'zb-word' }, text));
      if (covered) el.appendChild(h('span', { class: 'zb-cover', 'aria-hidden': 'true' }, h('i'), h('i')));
      if (fresh) { el.classList.add('new'); el.style.setProperty('--d', (i * 30) + 'ms'); }
      const tile = { el, w, side, col: i % 2, text, done: false };
      el.addEventListener('click', () => this.tap(tile));
      return tile;
    });
    this.grid = h('div', { class: 'zb-board' }, this.tiles.map((x) => x.el));
    g.board.className = 'board board-bomb';
    g.board.replaceChildren(this.grid);
    if (fresh) this.after(30 * this.tiles.length + 260, () => this.tiles.forEach((x) => { x.el.classList.remove('new'); x.el.style.removeProperty('--d'); }));
  }

  /** Covers fade, words fade in. */
  reveal() {
    const grid = this.grid;
    grid.classList.add('zb-reveal');
    this.after(260, () => {
      grid.querySelectorAll('.zb-cover').forEach((c) => c.remove());
      grid.classList.remove('zb-reveal');
    });
  }

  // ---------- flow ----------

  /** After the banner: the header turns into the bomb (≤ 400 ms), then the countdown runs. */
  enter() {
    const g = this.g;
    const root = g.root;
    this.state = 'enter';
    const a = g.elTimer.getBoundingClientRect();
    const b = this.elTimer.getBoundingClientRect();
    root.style.setProperty('--zb-dx', ((b.left + b.width / 2) - (a.left + a.width / 2)).toFixed(1) + 'px');
    this.setP(1);
    this.renderNum(true);
    root.classList.add('zb-mode', 'zb-enter');
    this.after(240, () => this.reveal());
    this.after(400, () => {
      root.classList.remove('zb-enter');
      this.state = 'run';
    });
  }

  /** The countdown runs only while nothing else is going on (not during the board change or a pause). */
  ticking() {
    const g = this.g;
    return this.state === 'run' && !this.swapping && !g.ended && !g.destroyed && !g.holds.has('pause');
  }

  tick(dt) {
    this.left -= dt;
    if (this.left <= BOMB.alarmMs && !this.alarm) {
      this.alarm = true;
      this.g.root.classList.add('zb-alarm');
    }
    if (this.alarm) {
      const beat = Math.ceil(this.left / 1000);
      if (beat !== this.lastBeat && beat > 0) { this.lastBeat = beat; sfx.tick(); }
    }
    if (this.left <= 0) {
      this.left = 0;
      this.renderNum();
      this.setP(0);
      this.boom();
      return;
    }
    this.renderNum();
    this.setP(this.left / TOTAL);
  }

  renderNum(force = false) {
    this.elNum.textContent = bombClock(this.left ?? TOTAL);
    const sec = Math.ceil((this.left ?? TOTAL) / 1000);
    if (force || sec !== this.shownSec) {
      this.shownSec = sec;
      this.elTimer.setAttribute('aria-label', t('zbTimerAria', { s: sec }));
    }
  }

  /** Fuse: 1 = full, 0 = burnt. Set on the wrapper, so only the fuse and the spark are touched. */
  setP(p) {
    this.elWrap.style.setProperty('--zb-p', Math.max(0, Math.min(1, p)).toFixed(4));
  }

  renderPips(newIdx = -1) {
    this.pips.forEach((p, i) => {
      p.classList.toggle('on', i < this.matched);
      if (i === newIdx) { p.classList.remove('new'); void p.offsetWidth; p.classList.add('new'); }
    });
    this.elPips.setAttribute('aria-label', t('zbPipsAria', { k: this.matched }));
  }

  // ---------- taps ----------

  tap(tile) {
    // covers only exist before 'run' (the last one fades out while the clock already runs)
    if (this.state !== 'run' || this.locked || this.swapping || tile.done) return;
    const sel = this.sel;
    const pick = (x) => { this.sel = x; x.el.classList.add('sel'); x.el.setAttribute('aria-pressed', 'true'); };
    const drop = (x) => { x.el.classList.remove('sel'); x.el.removeAttribute('aria-pressed'); };
    if (!sel) { pick(tile); return; }
    drop(sel);
    this.sel = null;
    if (sel === tile) return;
    // same column or same language can never be a pair: just choose again, no penalty
    if (sel.col === tile.col || sel.side === tile.side) { pick(tile); return; }
    if (sel.w.id === tile.w.id) this.match(sel, tile);
    else this.miss(sel, tile);
  }

  mark(el, name) {
    const m = icon(name, 'mark');
    m.setAttribute('role', 'img');
    m.setAttribute('aria-label', t(name === 'check' ? 'right' : 'wrong'));
    m.removeAttribute('aria-hidden');
    el.appendChild(m);
  }

  match(a, b) {
    const g = this.g;
    for (const x of [a, b]) {
      x.done = true;
      x.el.classList.add('done');
      x.el.disabled = true;
      this.mark(x.el, 'check');
    }
    sfx.good();
    store.bumpStat(g.list.id, a.w.id, true);
    this.found.add(a.w.id);
    this.matched++;
    this.onBoard++;
    this.renderPips(this.matched - 1);
    if (this.matched >= BOMB.need) { this.win(); return; }
    if (this.onBoard >= BOMB.swapEvery) { this.swap(); return; }
    this.after(220, () => { a.el.classList.add('gone'); b.el.classList.add('gone'); });
    this.after(420, () => {
      for (const x of [a, b]) if (x.el.isConnected) x.el.replaceWith(h('div', { class: 'zb-slot' }));
    });
  }

  /** Wrong pair: both tiles red with ✗, the board is locked for 1 s – the time goes on. */
  miss(a, b) {
    const g = this.g;
    const marks = [];
    for (const x of [a, b]) {
      x.el.classList.add('wrong');
      this.mark(x.el, 'close');
      marks.push(x.el.lastChild);
    }
    sfx.bump();
    store.bumpStat(g.list.id, a.w.id, false);
    store.bumpStat(g.list.id, b.w.id, false);
    this.locked = true;
    this.grid.classList.remove('locked');
    void this.grid.offsetWidth;
    this.grid.classList.add('locked');
    this.after(BOMB.lockMs, () => {
      for (const x of [a, b]) x.el.classList.remove('wrong');
      marks.forEach((m) => m.remove());
      this.grid.classList.remove('locked');
      this.locked = false;
    });
  }

  /** 2 pairs found: all tiles go, 4 new pairs come. The countdown waits while the board changes (≈ 0.4 s). */
  swap() {
    this.swapping = true;
    this.onBoard = 0;
    this.after(200, () => this.grid.classList.add('swap-out'));
    this.after(380, () => {
      const words = this.pickBoard();
      if (!words.length) { this.win(); return; }
      this.renderBoard(words, { fresh: true });
      this.swapping = false;
    });
  }

  // ---------- endings ----------

  /** 5/5: "Entschärft!", the header comes back, the main time is full again. */
  win() {
    const g = this.g;
    const root = g.root;
    this.state = 'won';
    this.swapping = false;
    root.classList.remove('zb-alarm');
    root.classList.add('zb-defused');
    sfx.defuse();
    const sparks = h('span', { class: 'sparks', 'aria-hidden': 'true' },
      [0, 45, 90, 135, 180, 225, 270, 315].map((a, i) => h('i', {
        style: { '--a': a + 'deg', '--d': (i % 4) * 10 + 'ms', '--r': (50 + (i % 3) * 6) + 'px', '--c': i % 2 ? 'var(--bomb-spark)' : 'var(--ok-dot)' },
      })));
    this.elTimer.appendChild(sparks);
    setTimeout(() => sparks.remove(), 900);
    const pill = h('span', { class: 'callout zb-defused', role: 'status' }, icon('check'), t('zbDefused'));
    g.flash(h('div', { class: 'callout-layer zb' }, pill), 1000);
    this.after(700, () => pill.classList.add('out'));
    this.after(790, () => this.exit());
  }

  exit() {
    const g = this.g;
    const root = g.root;
    this.state = 'exit';
    root.classList.remove('zb-mode', 'zb-defused');
    root.classList.add('zb-exit');
    let chip;
    if (g.capMs) {
      g.timeLeft = Math.max(g.timeLeft, g.capMs);
      chip = { text: t('timeFull'), capped: true };
    } else {
      g.timeLeft += BOMB.endlessBonus * 1000;
      chip = { text: '+' + BOMB.endlessBonus + ' s', capped: false };
    }
    this.after(300, () => g.board.classList.add('zb-out'));
    this.after(420, () => {
      root.classList.remove('zb-exit');
      this.state = 'off';
      g.release('bomb');
      g.bombDone(chip);
    });
  }

  /** 00,00: the tiles shake and fall, then the end dialog (no list of words). */
  boom() {
    const g = this.g;
    if (g.ended) return;
    this.state = 'dead';
    const matched = this.matched;
    g.endRun();
    g.root.classList.remove('zb-alarm');
    g.root.classList.add('zb-dead');
    this.grid.classList.add('zb-blast');
    this.blast();
    sfx.boom();
    setTimeout(() => { if (!g.destroyed) g.bombLost(matched); }, 1100);
  }

  /**
   * The tiles jolt together (200 ms), then fall one after another, bottom row first in a zigzag
   * (440 ms each, 60 ms apart). ONE transform animation per tile (Web Animations): two CSS
   * animations on the same property kept Chrome from running them on the compositor (low fps).
   */
  blast() {
    const order = [6, 7, 5, 4, 2, 3, 1, 0];
    const reduce = this.g.reducedMotion();
    [...this.grid.children].forEach((el, i) => {
      const k = order[i] ?? i;
      const start = 200 + k * 60;
      el.style.transition = 'none';
      if (!el.classList.contains('zb-tile')) {
        el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' });
        return;
      }
      if (reduce) {
        el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: start, easing: 'ease', fill: 'forwards' });
        return;
      }
      const s = i % 2 ? 1 : -1;
      const fx = s * (10 + Math.round(Math.random() * 8));
      const fr = s * (10 + Math.round(Math.random() * 8));
      const total = start + 440;
      const at = (ms) => ms / total;
      el.animate([
        { offset: 0, transform: 'none', easing: 'ease-in-out' },
        { offset: at(50), transform: `translate(${(-0.2 * fx).toFixed(1)}px, -3px) rotate(${(-0.2 * fr).toFixed(1)}deg)`, easing: 'ease-in-out' },
        { offset: at(110), transform: `translate(${(0.15 * fx).toFixed(1)}px, 2px) rotate(${(0.15 * fr).toFixed(1)}deg)`, easing: 'ease-in-out' },
        { offset: at(160), transform: `rotate(${(-0.06 * fr).toFixed(2)}deg)`, easing: 'ease-in-out' },
        { offset: at(200), transform: 'none' },
        { offset: at(start), transform: 'none', easing: 'cubic-bezier(.55, 0, 1, .45)' },
        { offset: 1, transform: `translate(${fx}px, 760px) rotate(${fr}deg)` },
      ], { duration: total, fill: 'forwards' });
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 88, delay: start + 352, easing: 'linear', fill: 'forwards' });
    });
  }

  // ---------- pause ----------

  /** The app was hidden or the quit dialog opened while the bomb ticked: it starts again afterwards. */
  interrupt() {
    if (this.state === 'enter' || this.state === 'run') {
      this.seq++;
      this.state = 'stopped';
      this.needRestart = true;
    }
    return this.needRestart;
  }

  /** "Weiterspielen": new words under the covers, the fuse fills up, 10,00 again. No banner. */
  restart() {
    if (!this.needRestart) return;
    const g = this.g;
    const root = g.root;
    this.seq++;
    root.classList.remove('zb-alarm', 'zb-enter');
    root.classList.add('zb-mode');
    this.found = new Set();
    this.resetCounters();
    this.state = 'restart';
    this.renderNum(true);
    const words = this.pickBoard();
    this.renderBoard(words, { covered: true });
    g.board.classList.add('swap-in');
    this.setP(1);
    root.classList.add('zb-refill');
    this.after(320, () => this.reveal());
    this.after(480, () => {
      root.classList.remove('zb-refill');
      g.board.classList.remove('swap-in');
      this.state = 'run';
    });
  }
}
