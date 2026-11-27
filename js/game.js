import {
  LEVELS, LEVEL_IDS, ENDLESS, ROUND_SIZE, WIRBEL_EXTRA, KOMBO_MAX, MOD_TYPES, buildTypePlan, endlessTypes, pickWords, pickDistractors,
  makeGaps, checkAnswer, closestForm, answerDiff, shuffle, wordFilterFor, variants, pickVariant, allVariants, gapTargets, norm,
  stepValue, applyBonus, komboNext, rollModifier, fitTypeToMod, placeNewPairs, wirbelOrder, trainingTypes, trainingPick, BOMB,
  listLangs, answerVariants, extraKeys,
} from './core.js';
import { Bomb } from './bomb.js';
import { Keyboard, ownKeyboardWanted } from './keyboard.js';
import * as store from './store.js';
import { t, tSplit, tDays } from './i18n.js';
import { h, icon, levelBars, modal, sfx } from './ui.js';

const BONUS_PAUSE_MS = 900;
const MOD_BANNER_MS = 1500;
const KEYBOARD_TYPES = ['gaps', 'spell'];
const CONFETTI = ['#D97757', '#788C5D', '#C9A82D', '#C46686', '#6A9BCC', '#E3DACC'];

/** Cell width so that the longest word still fits on one line. */
function cellWidth(longest, avail, max, min) {
  if (!longest) return max;
  return Math.max(min, Math.min(max, Math.floor((avail - (longest - 1) * 2) / longest)));
}

function splitWords(chars) {
  const groups = [[]];
  chars.forEach((c, i) => {
    if (c === ' ') groups.push({ space: i }, []);
    else groups[groups.length - 1].push(i);
  });
  return groups;
}

/** 1.5 -> "1,5" */
function fmtFactor(f) {
  return String(f).replace('.', ',');
}

/** Restarts a CSS animation class. */
function replay(el, cls) {
  el.classList.remove(cls);
  void el.getBoundingClientRect();
  el.classList.add(cls);
}

/**
 * One game. level: 'easy' | 'medium' | 'hard' (a level with a fixed number of rounds),
 * 'endless' (rounds without end) or 'training' (Fehlertraining: words with mistakes, no timer).
 */
export class Game {
  constructor({ root, list, level, onMenu, onNextLevel, onTrain, focus = [] }) {
    this.root = root;
    this.list = list;
    this.level = level;
    this.mode = level === 'endless' || level === 'training' ? level : 'level';
    this.onMenu = onMenu;
    this.onNextLevel = onNextLevel;
    this.onTrain = onTrain;
    this.focus = focus;
    this.words = list.words;
    this.byId = new Map(this.words.map((w) => [w.id, w]));
    // languages of the two columns: side 'en' = left column, side 'de' = right column (e.g. Deutsch – Ukrainisch)
    const L = listLangs(list);
    this.lang = { en: L.left, de: L.right };
    if (this.mode === 'endless') this.cfg = { ...ENDLESS };
    else if (this.mode === 'training') this.cfg = { timer: false, mixed: true, gapRatio: 0.35, keepFirst: true };
    else this.cfg = { ...LEVELS[level], ...store.timing(level) };
    // tests: other times for a level (window.__vtTiming = { easy: { start: 10 } })
    const vt = typeof window !== 'undefined' && window.__vtTiming && window.__vtTiming[level];
    if (vt) { Object.assign(this.cfg, vt); if (vt.start && !vt.cap) this.cfg.cap = Math.max(this.cfg.cap, vt.start); }
    // Zeitbombe (test version): can be switched off in the settings and needs at least 8 words
    if (this.cfg.mods && (store.settings().zeitbombe === false || this.words.length < BOMB.minWords)) {
      this.cfg.mods = this.cfg.mods.filter((m) => m !== 'zeitbombe');
    }
    this.bomb = null;
    this.capMs = (this.cfg.cap || 0) * 1000;
    // tests can switch special rounds off ('off') or force them ({ 4: 'wirbel' })
    this.testMods = typeof window !== 'undefined' ? window.__vtMods : undefined;
    if (this.testMods !== undefined) window.__vtGame = this;
    this.holds = new Set();
    this.epoch = 0;
    this.qSeq = 0;
    this.ended = true;
    this.destroyed = false;
    this.currentInput = null;
    this.tick = this.tick.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.buildShell();
    // own keyboard for Lücken and Schreiben (the phone keyboard would suggest the words)
    this.kb = ownKeyboardWanted()
      ? new Keyboard({ root: this.root, lang: this.lang.en, extra: extraKeys(this.words.flatMap((w) => answerVariants(w.en)), this.lang.en) })
      : null;
    this.raf = requestAnimationFrame(this.tick);
  }

  get running() {
    return !this.ended && !this.destroyed && this.holds.size === 0;
  }

  /** No answers while paused, during the special-round banner, while Wirbel moves the tiles or after the last answer of a round. */
  blocked() {
    return this.ended || this.destroyed || this.roundOver || this.holds.has('pause') || this.holds.has('mod') || this.holds.has('wirbel');
  }

  hold(reason) { this.holds.add(reason); }

  /** The time waits while the screen comes in. */
  holdFor(ms) {
    if (!ms) return;
    this.hold('enter');
    setTimeout(() => this.release('enter'), ms);
  }
  release(reason) { this.holds.delete(reason); }

  later(ms, fn) {
    const e = this.epoch;
    setTimeout(() => { if (e === this.epoch && !this.destroyed) fn(); }, ms);
  }

  reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ---------- setup ----------

  buildShell() {
    this.elRound = h('span', { class: 'game-round' });
    this.elModChip = h('span', { class: 'mod-chip', hidden: true });
    this.elSlot = h('div', { class: 'time-slot' });
    this.elTimerNum = h('span', { class: 'num' }, '0');
    this.elTimer = h('output', { class: 'timer', role: 'timer' },
      icon('pause', 'i-pause'), icon('extra', 'i-extra'), this.elTimerNum, h('span', { class: 'unit' }, 's'));
    this.elSteps = h('div', { class: 'word-steps', hidden: this.mode !== 'training' });
    this.elBarFill = h('div', { class: 'timebar-fill' });
    this.elBar = h('div', { class: 'timebar' }, this.elBarFill);
    this.elDots = h('div', { class: 'dots', 'aria-hidden': 'true' });
    this.elExtraNum = h('span');
    this.elExtra = h('span', { class: 'extra-chip', role: 'img', hidden: true }, icon('extra'), this.elExtraNum);
    this.elStatusEnd = h('div', { class: 'status-end' }, this.elExtra);
    this.elFuseFill = h('i');
    this.elFuse = h('span', { class: 'fuse', 'aria-hidden': 'true' }, this.elFuseFill);
    this.elMultiVal = h('span');
    this.elMulti = h('span', { class: 'multi idle', role: 'img' }, icon('kombo'), this.elMultiVal);
    this.elSpeed = h('span', { class: 'speed' });
    this.elTask = h('h2', { class: 'task-title' });
    this.elPairsCount = h('span', { class: 'pairs-count', hidden: true });
    this.board = h('main', { class: 'board' });
    this.fx = h('div', { class: 'fx-layer', 'aria-hidden': 'true' });
    const label = this.mode === 'level'
      ? [levelBars(this.level, 'sm'), t('level_' + this.level)]
      : [icon(this.level, 'mode-icon'), t('level_' + this.level)];
    this.root.className = 'screen game lv-' + this.level + (this.cfg.timer === false ? ' no-timer' : '');
    this.root.replaceChildren(
      h('header', { class: 'game-top' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('quitTitle'), onclick: () => this.askQuit() }, icon('close')),
        h('div', { class: 'game-info' },
          h('span', { class: 'game-level' }, label),
          h('span', { class: 'round-line' }, this.elRound, this.elModChip)),
        this.elSlot,
        this.elTimer,
        this.elSteps),
      this.elBar,
      h('div', { class: 'head-rule' }),
      h('div', { class: 'status-row' }, this.elDots, this.elStatusEnd),
      h('div', { class: 'task-row' }, this.elTask, this.elPairsCount),
      this.board,
      this.fx,
    );
  }

  start() {
    this.epoch++;
    this.ended = false;
    this.holds.clear();
    if (this.bomb) this.bomb.reset();
    this.root.classList.remove('shake', 'paused', 'on-extra', 'mod-fast', 'x2');
    this.fx.replaceChildren();
    this.used = new Set();
    this.roundIdx = 0;
    this.timeLeft = (this.cfg.start || 0) * 1000;
    this.reserve = 0;
    this.reserveShown = 0;
    this.extraLagUntil = 0;
    this.playMs = 0;
    this.mod = null;
    this.modRevealed = false;
    this.modCount = 0;
    this.roundMods = [];
    this.kombo = { mult: 1, last: 0, cold: false };
    this.noticeFree = 0;
    this.shownSec = null;
    this.shownReserve = null;
    this.last = null;
    if (this.mode === 'training') {
      this.fixed = [];
      this.plan = [];
      // one session: at most 10 words, the word(s) of the last mistake first
      this.tQueue = store.trainingWords(this.list.id, this.words, this.focus).map((w) => ({ w, step: 0, types: trainingTypes(w) }));
      this.focus = [];
      this.tLearned = 0;
      this.tLast = null;
    } else if (this.mode === 'endless') {
      this.fixed = [];
      this.plan = endlessTypes();
      this.best = store.endlessProgress(this.list.id).best || 0;
      this.recordShown = false;
    } else {
      this.fixed = store.fixedRounds(this.list.id, this.level, this.words);
      this.fixed.forEach((r) => r.ids.forEach((id) => this.used.add(id)));
      this.plan = buildTypePlan(this.level);
    }
    this.startRound();
  }

  destroy() {
    this.destroyed = true;
    this.epoch++;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.kb) this.kb.destroy();
  }

  // ---------- timer ----------

  /** Zeitraffer: the time runs faster in this round. */
  speed() {
    return this.mod === 'zeitraffer' ? stepValue(this.cfg.fastSteps, this.roundIdx + 1) : 1;
  }

  tick(ts) {
    if (this.destroyed) return;
    if (this.last == null) this.last = ts;
    const dt = Math.min(1000, ts - this.last);
    this.last = ts;
    if (this.running && this.cfg.timer !== false) {
      this.playMs += dt;
      this.timeLeft -= dt * this.speed();
      if (this.timeLeft <= 0) {
        if (this.reserve > 0) this.useReserve();
        else {
          this.timeLeft = 0;
          this.renderTimer();
          this.timeUp();
        }
      }
    }
    if (this.bomb && this.bomb.ticking()) this.bomb.tick(dt);
    this.renderTimer();
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Kombo seconds: above the limit they wait as Extrazeit until the normal time is used up. */
  addExtra(ms) {
    if (this.capMs) this.reserve += ms;
    else this.timeLeft += ms;
  }

  /** The normal time is over: the Extrazeit pours into the time bar, the game goes on. */
  useReserve() {
    const add = this.capMs ? Math.min(this.reserve, this.capMs) : this.reserve;
    this.timeLeft += add;
    this.reserve -= add;
    this.reserveShown = this.reserve;
    this.root.classList.add('on-extra');
    sfx.round();
    const chip = this.elExtra;
    if (!chip.hidden) {
      const a = chip.getBoundingClientRect();
      const b = this.elBar.getBoundingClientRect();
      chip.style.setProperty('--px', (b.left + b.width * 0.33 - (a.left + a.width / 2)) + 'px');
      chip.style.setProperty('--py', (b.top - a.top) + 'px');
      replay(chip, 'pour');
      setTimeout(() => { chip.classList.remove('pour'); this.shownReserve = null; }, 420);
    }
    this.callout('extra', icon('extra'), t('extraUsed'), 1450);
  }

  renderTimer() {
    if (this.cfg.timer === false) return;
    const sec = Math.max(0, Math.ceil(this.timeLeft / 1000));
    const low = this.timeLeft + this.reserve <= 10000 && !this.ended && !(this.bomb && this.bomb.state !== 'off');
    if (sec !== this.shownSec) {
      this.shownSec = sec;
      this.elTimerNum.textContent = String(sec);
      this.elTimer.setAttribute('aria-label', t('timeLeftAria', { t: sec }));
    }
    this.elTimer.classList.toggle('low', low);
    this.elBar.classList.toggle('low', low);
    const ref = this.capMs || this.cfg.start * 1000;
    this.elBarFill.style.setProperty('--p', Math.max(0, Math.min(1, this.timeLeft / ref)).toFixed(4));
    this.renderExtra();
    if (this.mod === 'kombo' && this.modRevealed && !this.roundOver) this.renderFuse();
  }

  /** Extrazeit chip below the time bar (in a Kombo round it is there from the start, empty). */
  renderExtra() {
    const chip = this.elExtra;
    if (chip.classList.contains('pour')) return;
    if (performance.now() >= this.extraLagUntil) this.reserveShown = this.reserve;
    const rs = Math.ceil(this.reserveShown / 1000);
    const visible = rs > 0 || (this.mod === 'kombo' && this.modRevealed && !!this.capMs);
    if (rs === this.shownReserve && visible === !chip.hidden) return;
    const up = rs > (this.shownReserve || 0);
    this.shownReserve = rs;
    chip.hidden = !visible;
    chip.classList.toggle('empty', rs <= 0);
    this.elExtraNum.textContent = '+' + rs + ' s';
    chip.setAttribute('aria-label', t('extraTimeAria', { t: rs }));
    if (up && rs > 0) replay(chip, 'bump');
  }

  onVisibility() {
    if (document.hidden && !this.ended && !this.destroyed && !this.holds.has('pause')) this.showPause(false);
  }

  showPause(askQuit) {
    // Zeitbombe: a pause would give time to read the words – the bomb starts again with new ones
    const bombNote = this.bomb && this.bomb.interrupt()
      ? h('p', { class: 'st-note zb-note' }, icon('zeitbombe'), h('span', null, t('zbPauseNote'))) : null;
    this.hold('pause');
    this.root.classList.add('paused');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const opts = askQuit
      ? {
        title: t('quitTitle'),
        body: h('div', { class: 'modal-body' },
          h('p', { class: 'modal-text' }, t(this.mode === 'training' ? 'quitTextTraining' : 'quitText')),
          bombNote,
          store.streak().doneToday ? null : h('p', { class: 'st-note' }, icon('streak'), h('span', null, t('streakQuitNote')))),
        buttons: [{ label: t('quit'), value: 'quit', kind: 'danger' }, { label: t('resume'), value: 'resume', kind: 'outline', grow: true }],
      }
      : {
        title: t('pauseTitle'),
        center: true,
        clear: true,
        icon: { name: 'pause', kind: 'accent', extra: 'big' },
        body: bombNote ? h('div', { class: 'modal-body' }, bombNote) : null,
        buttons: [{ label: t('quit'), value: 'quit', kind: 'outline' }, { label: t('resume'), value: 'resume', kind: 'primary', grow: true }],
      };
    modal(opts).then((v) => {
      if (this.destroyed) return;
      if (v === 'quit') {
        this.destroy();
        this.onMenu();
        return;
      }
      this.root.classList.remove('paused');
      this.release('pause');
      this.last = null;
      if (this.bomb && this.bomb.needRestart) this.bomb.restart();
      if (this.currentInput && this.currentInput.isConnected) this.currentInput.focus({ preventScroll: true });
    });
  }

  askQuit() {
    if (this.destroyed) return;
    if (this.ended) { this.destroy(); this.onMenu(); return; }
    if (this.holds.has('pause')) return;
    this.showPause(true);
  }

  // ---------- rounds ----------

  dotClass(i) {
    const mod = i < this.roundIdx || (i === this.roundIdx && this.modRevealed) ? this.roundMods[i] : null;
    return 'dot' + (i < this.roundIdx ? ' done' : '') + (i === this.roundIdx ? ' cur' : '') + (i < this.fixed.length ? ' fixed' : '')
      + (mod ? ' has-mod mod-' + mod + (mod === 'zeitbombe' ? ' zb-dot' : '') : '');
  }

  /** Round dots; a special round is a diamond. Endlos shows only the last rounds. */
  renderDots({ roll = false, mark = false } = {}) {
    if (this.mode === 'training') return;
    const dot = (i) => h('span', { class: this.dotClass(i) + (mark && i === this.roundIdx ? ' mark' : ''), 'data-type': this.plan[i] });
    if (this.mode === 'endless') {
      // from the left; from round 7 on the row moves on and the oldest dot fades out
      const dots = [];
      const scrolled = this.roundIdx >= 6;
      for (let i = Math.max(0, this.roundIdx - 5); i <= this.roundIdx; i++) dots.push(dot(i));
      this.elDots.className = 'dots window' + (scrolled ? ' scrolled' : '');
      this.elDots.replaceChildren(h('span', { class: 'dots-track' + (roll && scrolled ? ' rolling' : '') }, dots));
      return;
    }
    this.elDots.className = 'dots' + (this.plan.length > 10 ? ' many' : '');
    this.elDots.replaceChildren(...this.plan.map((_, i) => dot(i)));
  }

  renderRoundLine() {
    const r = this.roundIdx + 1;
    if (this.mode === 'endless') {
      const rec = Math.max(this.best, this.roundIdx);
      this.elRound.textContent = t('roundEndless', { r }) + (rec > 0 ? ' · ' + t('recordShort', { n: rec }) : '');
    } else {
      this.elRound.textContent = t('round', { r, n: this.cfg.rounds });
    }
  }

  /** Special round for this round (or null). */
  pickMod(round, type) {
    const tm = this.testMods;
    if (tm !== undefined) return tm && typeof tm === 'object' ? tm[round] || null : null;
    return rollModifier(this.cfg, round, type, this.roundMods[this.roundIdx - 1] || null, this.modCount);
  }

  ensurePlan() {
    if (this.mode === 'endless') while (this.plan.length <= this.roundIdx + 1) this.plan.push(...endlessTypes());
  }

  startRound(learnedAnim = false) {
    this.qSeq++;
    this.roundOver = false;
    if (this.mode === 'training') { this.startTrainingQuestion(learnedAnim); return; }
    this.ensurePlan();
    const round = this.roundIdx + 1;
    const isFixed = this.roundIdx < this.fixed.length;
    let type = this.plan[this.roundIdx];
    let mod = this.pickMod(round, type);
    if (mod && isFixed && mod === 'wirbel') mod = null;
    if (mod && !MOD_TYPES[mod].includes(type)) {
      // the game of this round is fitted to the special round (Wirbel → Paare, Kombo → Paare/Auswahl)
      type = fitTypeToMod(mod, type);
      this.plan[this.roundIdx] = type;
    }
    let words = null;
    if (mod === 'zeitbombe') {
      // own board: 4 pairs now, new words after every 2 found pairs (bomb.js)
      if (!this.bomb) this.bomb = new Bomb(this);
      words = this.bomb.begin();
      if (words.length < BOMB.pairs) { mod = null; words = null; this.release('bomb'); }
    }
    if (words) {
      // Zeitbombe: the words come from bomb.js
    } else if (isFixed) {
      words = this.fixed[this.roundIdx].ids.map((id) => this.byId.get(id)).filter(Boolean);
    } else {
      const n = ROUND_SIZE[type] + (mod === 'wirbel' ? WIRBEL_EXTRA : 0);
      const filter = wordFilterFor(type);
      if (this.mode === 'endless' && this.words.filter((w) => !this.used.has(w.id) && (!filter || filter(w))).length < n) {
        this.used.clear(); // Endlos: every word once, then from the start
      }
      words = pickWords(this.words, n, { used: this.used, stats: store.stats(this.list.id), filter });
      if (mod === 'wirbel' && words.length < n) {
        mod = null;
        words = words.slice(0, ROUND_SIZE.pairs);
      }
    }
    if (!words.length) {
      // e.g. a list without words long enough for the missing-letters game
      type = 'pairs';
      if (mod === 'wirbel') mod = null;
      words = pickWords(this.words, ROUND_SIZE.pairs, { used: this.used, stats: store.stats(this.list.id) });
    }
    words.forEach((w) => this.used.add(w.id));
    this.mod = mod;
    this.modRevealed = false;
    if (mod) {
      this.modCount++;
      this.roundMods[this.roundIdx] = mod;
    }
    this.kombo = { mult: 1, last: this.playMs, cold: false };
    this.roundType = type;
    this.roundWords = words;
    this.currentInput = null;
    if (this.kb) this.kb.detach();
    this.renderRoundLine();
    this.elTask.textContent = this.taskText(type);
    this.root.classList.toggle('typing-round', KEYBOARD_TYPES.includes(type));
    this.renderDots({ roll: this.mode === 'endless' && this.roundIdx > 0 });
    this.renderBoard(type, words);
    this.renderModUI();
    if (mod) this.showModBanner(mod);
  }

  /** "Schreib das Wort auf Deutsch" in a German–Ukrainian list (the typed word is the left column). */
  taskText(type) {
    return type === 'spell' ? t('task_spellIn', { lang: t('langIn_' + this.lang.en) }) : t('task_' + type);
  }

  renderBoard(type, words) {
    if (this.mod === 'zeitbombe' && this.bomb) {
      this.pairs = null;
      this.bomb.renderBoard(words, { covered: true });
      this.renderPairsCount();
      return;
    }
    this.board.replaceChildren();
    this.board.className = 'board board-' + type;
    this.pairs = null;
    if (type === 'pairs') this.renderPairs(words);
    else if (type === 'choice') this.renderChoice(words);
    else if (type === 'gaps') this.renderGaps(words);
    else this.renderSpell(words);
    this.renderPairsCount();
  }

  /** Last answer of a round was right. Keyboard rounds start at once so the phone keyboard stays open. */
  finishRound() {
    this.roundOver = true;
    if (this.mode === 'training') { this.trainingRight(); return; }
    this.hold('bonus');
    this.ensurePlan();
    const next = this.plan[this.roundIdx + 1];
    this.board.classList.add('round-ok');
    if (next && KEYBOARD_TYPES.includes(next)) this.roundDone();
    else this.later(380, () => this.roundDone());
  }

  roundDone({ bombChip = null } = {}) {
    if (this.ended) return;
    this.roundIdx++;
    if (this.mode === 'level' && this.roundIdx >= this.cfg.rounds) {
      this.levelDone();
      return;
    }
    sfx.round();
    this.root.classList.remove('on-extra');
    const want = this.mode === 'endless' ? stepValue(this.cfg.bonusSteps, this.roundIdx) : this.cfg.bonus;
    this.hold('bonus');
    if (bombChip) {
      // Zeitbombe defused: the time was filled by the bomb ("Zeit voll" / Endlos "+20 s"), no round bonus on top
      this.flash(h('div', { class: 'bonus-layer' }, h('span', { class: 'bonus-chip' + (bombChip.capped ? ' capped' : '') }, bombChip.text)), 1400);
      replay(this.elTimer, 'bump');
    } else if (want > 0) {
      const add = applyBonus(this.timeLeft / 1000, want, this.cfg.cap);
      this.timeLeft += add * 1000;
      // only up to the limit: "+3 s · voll", or "Zeit voll" when nothing fits any more
      const capped = add < want - 0.001;
      const shown = Math.round(add);
      const text = !capped ? '+' + want + ' s' : shown > 0 ? t('bonusCapped', { t: shown }) : t('timeFull');
      this.flash(h('div', { class: 'bonus-layer' }, h('span', { class: 'bonus-chip' + (capped ? ' capped' : '') }, text)), 1400);
      if (shown > 0) replay(this.elTimer, 'bump');
    }
    this.startRound();
    if (bombChip) {
      replay(this.board, 'swap-in');
      setTimeout(() => this.board.classList.remove('swap-in'), 300);
    }
    if (this.mode === 'endless') {
      if (!this.recordShown && this.best > 0 && this.roundIdx > this.best) {
        this.recordShown = true;
        this.notice(() => this.callout('record', icon('star'), t('newRecord'), 1450), 1450);
      }
      const nextBonus = stepValue(this.cfg.bonusSteps, this.roundIdx + 1);
      if (nextBonus !== want) {
        this.notice(() => this.flash(h('div', { class: 'callout-layer note' },
          h('span', { class: 'note-pill' }, icon('trendDown'), t('bonusNow', { t: nextBonus }))), 1650), 1650);
      }
    }
    this.later(BONUS_PAUSE_MS, () => this.release('bonus'));
  }

  flash(el, ms) {
    this.fx.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  /** Short messages, one after another (never on top of the special-round banner). */
  notice(fn, ms) {
    const now = performance.now();
    const at = Math.max(now, this.noticeFree || 0);
    this.noticeFree = at + ms;
    if (at - now < 20) fn();
    else this.later(at - now, fn);
  }

  /** A pill in the middle: "Extrazeit!", "Neuer Rekord!", "Gelernt". */
  callout(kind, ic, text, ms) {
    const pill = h('span', { class: 'callout ' + kind }, ic, text);
    this.flash(h('div', { class: 'callout-layer ' + kind }, pill), ms);
    setTimeout(() => pill.classList.add('out'), ms - 260);
  }

  /** A small chip that flies from one element to another ("+5 s" into the Extrazeit). */
  flyChip(text, from, to) {
    if (!to || to.hidden) return;
    const base = this.fx.getBoundingClientRect();
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    this.flash(h('span', {
      class: 'fly-chip',
      style: { left: (a.left - base.left) + 'px', top: (a.top - base.top) + 'px', '--fx': (b.left - a.left) + 'px', '--fy': (b.top - a.top) + 'px' },
    }, text), 700);
  }

  checkFly() {
    this.flash(h('div', { class: 'check-fly' }, icon('check')), 800);
  }

  // ---------- special rounds ----------

  /** 1.5 s at the start of the round: badge, name and rule; the timer stands still. */
  showModBanner(mod) {
    this.hold('mod');
    this.noticeFree = performance.now() + MOD_BANNER_MS;
    const banner = h('div', { class: 'mod-banner mod-' + mod, role: 'status' },
      h('span', { class: 'mod-badge' }, icon(mod)),
      h('span', { class: 'mod-text' },
        h('b', null, t('modTitle_' + mod)),
        h('span', null, t('modRule_' + mod, { f: fmtFactor(this.speed()) }))),
      h('span', { class: 'mod-clock' }));
    this.fx.appendChild(banner);
    this.later(MOD_BANNER_MS - 250, () => banner.classList.add('out'));
    this.later(MOD_BANNER_MS, () => {
      banner.remove();
      this.release('mod');
      this.modRevealed = true;
      this.renderDots({ mark: true });
      this.renderModUI(true);
      if (mod === 'zeitbombe' && this.bomb) this.bomb.enter();
    });
  }

  /** Chip next to the round, multiplier or speed next to the timer, stripes on the time bar. */
  renderModUI(pop = false) {
    const m = this.modRevealed ? this.mod : null;
    const sp = this.speed();
    this.root.classList.toggle('mod-fast', m === 'zeitraffer');
    this.root.classList.toggle('x2', m === 'zeitraffer' && sp >= 2);
    this.elModChip.hidden = !m;
    if (m) {
      this.elModChip.className = 'mod-chip mod-' + m + (pop ? ' in' : '');
      this.elModChip.setAttribute('aria-label', t('mod_' + m));
      this.elModChip.replaceChildren(icon(m), h('span', { class: 'mod-name' }, t('mod_' + m)));
      // on narrow phones only the icon (the banner already said the name)
      const name = this.elModChip.querySelector('.mod-name');
      if (name.scrollWidth > name.clientWidth + 1) this.elModChip.classList.add('compact');
    }
    if (m === 'kombo') {
      this.elSlot.replaceChildren(this.elMulti, this.elFuse);
      this.updateMulti(pop ? 'in' : null);
    } else if (m === 'zeitraffer') {
      this.elSpeed.textContent = fmtFactor(sp) + '×';
      this.elSlot.replaceChildren(this.elSpeed);
      if (pop) replay(this.elSpeed, 'pop');
    } else {
      this.elSlot.replaceChildren();
    }
    this.renderExtra();
  }

  /** Wirbel: "Paare 3/9" next to the task. */
  renderPairsCount() {
    const ps = this.mod === 'wirbel' ? this.pairs : null;
    this.elPairsCount.hidden = !ps;
    if (!ps) return;
    const [pre, a, post] = tSplit('pairsCount', { a: ps.matched, b: ps.total }, 'a');
    this.elPairsCount.replaceChildren(...[pre, h('b', null, a), post].filter((x) => x !== ''));
  }

  updateMulti(anim) {
    const k = this.kombo;
    const mult = k.cold ? 1 : k.mult;
    this.elMultiVal.textContent = '×' + mult;
    this.elMulti.className = 'multi' + (mult <= 1 ? ' idle' : '') + (mult >= KOMBO_MAX ? ' max' : '');
    this.elMulti.setAttribute('aria-label', t('mod_kombo') + ' ×' + mult);
    if (anim) replay(this.elMulti, anim);
  }

  /** Kombo: how much of the window for the next fast answer is left. */
  renderFuse() {
    const k = this.kombo;
    let left = Math.max(0, 1 - (this.playMs - k.last) / this.cfg.kombo);
    if (this.reducedMotion()) left = Math.ceil(left * 6) / 6;
    this.elFuseFill.style.transform = 'scaleX(' + left.toFixed(3) + ')';
    const cold = left <= 0;
    if (cold === k.cold) return;
    k.cold = cold;
    if (cold && k.mult > 1) {
      // the streak is over: the multiplier fades quietly back to ×1
      replay(this.elMulti, 'fade');
      this.later(200, () => this.updateMulti('in'));
    } else {
      this.updateMulti();
    }
  }

  /** A right answer in a Kombo round. els: the tiles/option of this answer – they glow blue when a step is earned. */
  komboHit(els = []) {
    if (this.mod !== 'kombo') return;
    const k = this.kombo;
    const fast = this.playMs - k.last <= this.cfg.kombo;
    k.last = this.playMs;
    const r = komboNext(k.mult, fast);
    k.mult = r.mult;
    k.cold = false;
    this.updateMulti(r.gain ? 'pop' : null);
    if (r.gain) {
      this.addExtra(r.gain * 1000);
      this.extraLagUntil = performance.now() + 560;
      sfx.kombo(k.mult);
      this.flyChip('+' + r.gain + ' s', this.elMulti, this.capMs ? this.elExtra : this.elTimer);
      this.komboGlow(els, k.mult >= KOMBO_MAX);
    }
  }

  /**
   * Short blue glow around the answered tiles. It lives in the effects layer (the next question can
   * replace the buttons right away) and only fades and scales – smooth on the compositor.
   */
  komboGlow(els, max) {
    const base = this.fx.getBoundingClientRect();
    for (const el of els) {
      if (!el || !el.isConnected) continue;
      const r = el.getBoundingClientRect();
      this.flash(h('span', {
        class: 'kombo-glow' + (max ? ' max' : ''),
        style: { left: (r.left - base.left) + 'px', top: (r.top - base.top) + 'px', width: r.width + 'px', height: r.height + 'px' },
      }), 700);
    }
  }

  questionHeader(n, cur, dir) {
    let left = null;
    if (this.mode === 'training' && this.tCur) {
      left = h('span', { class: 'step-caption' }, t('stepCaption', { s: this.tCur.step + 1, type: t('type_' + this.roundType) }));
    } else if (n > 1) {
      left = h('div', { class: 'qbars', 'aria-hidden': 'true' },
        Array.from({ length: n }, (_, i) => h('span', { class: i < cur ? 'done' : i === cur ? 'cur' : '' })));
    }
    return h('div', { class: 'qrow' + (left ? '' : ' end') }, left, h('span', { class: 'dir-chip' }, this.dirLabel(dir)));
  }

  /** "Deutsch → Englisch" etc. for the languages of this list. */
  dirLabel(dir) {
    const [from, to] = dir === 'de2en' ? ['de', 'en'] : ['en', 'de'];
    return t('dirFmt', { a: t('langName_' + this.lang[from]), b: t('langName_' + this.lang[to]) });
  }

  promptCard(field, text, compact) {
    return h('div', { class: 'prompt-card pop' + (compact ? ' compact' : '') },
      h('span', { class: 'label' }, t('label_' + this.lang[field])),
      h('span', { class: 'word', lang: this.lang[field] }, text));
  }

  // ---------- game: pairs ----------

  makeTile(w, side) {
    const text = pickVariant(side === 'en' ? w.en : w.de, side);
    const el = h('button', { class: 'tile', type: 'button', lang: this.lang[side], 'data-side': side, 'data-wid': w.id }, text);
    const tile = { el, w, side, text, done: false };
    el.addEventListener('click', () => this.tapTile(tile));
    return el;
  }

  renderPairs(words) {
    // Wirbel: the last 3 words come in after the first 3 pairs
    const extra = this.mod === 'wirbel' ? words.slice(-WIRBEL_EXTRA) : [];
    const shown = this.mod === 'wirbel' ? words.slice(0, -WIRBEL_EXTRA) : words;
    let grid;
    if (!this.cfg.mixed) {
      const left = shuffle(shown.slice()).map((w) => this.makeTile(w, 'en'));
      const right = shuffle(shown.slice()).map((w) => this.makeTile(w, 'de'));
      const cells = [h('span', { class: 'col-head' }, t('head_' + this.lang.en)), h('span', { class: 'col-head' }, t('head_' + this.lang.de))];
      left.forEach((l, i) => cells.push(l, right[i]));
      grid = h('div', { class: 'pairs cols' }, cells);
    } else {
      // Languages are mixed between the columns, but every pair has
      // one word on the left and its partner on the right.
      const half = shown.length % 2 && Math.random() < 0.5 ? Math.ceil(shown.length / 2) : Math.floor(shown.length / 2);
      const enLeft = shuffle(shown.map((_, i) => i < half));
      const left = [];
      const right = [];
      shown.forEach((w, i) => {
        const en = this.makeTile(w, 'en');
        const de = this.makeTile(w, 'de');
        if (enLeft[i]) { left.push(en); right.push(de); } else { left.push(de); right.push(en); }
      });
      shuffle(left);
      shuffle(right);
      const cells = [];
      left.forEach((l, i) => cells.push(l, right[i]));
      grid = h('div', { class: 'pairs grid' }, cells);
    }
    this.board.appendChild(grid);
    this.pairs = { sel: null, left: words.length, matched: 0, total: words.length, extra, grid };
  }

  /**
   * Wirbel after the 3rd pair: the matched pairs vanish, 3 new pairs come in at their places,
   * then all tiles swirl to new places (Leicht: within their column; else every pair stays split
   * left/right). Taps are off and the time stands still while the tiles move (≈ 1.4 s).
   */
  wirbelSwap() {
    const ps = this.pairs;
    const extra = ps.extra;
    ps.extra = [];
    const grid = ps.grid;
    const doneTiles = [...grid.querySelectorAll('.tile.done')];
    // from now on the tiles only move with the Wirbel animations (no fade-in when they are re-ordered)
    grid.classList.add('wirbel');
    this.hold('wirbel');
    this.later(150, () => doneTiles.forEach((el) => el.classList.add('vanish')));
    this.later(470, () => {
      const cells = [...grid.children].filter((c) => c.classList.contains('tile'));
      const freed = this.cfg.mixed
        ? { left: doneTiles.filter((e) => cells.indexOf(e) % 2 === 0), right: doneTiles.filter((e) => cells.indexOf(e) % 2 === 1) }
        : { en: doneTiles.filter((e) => e.dataset.side === 'en'), de: doneTiles.filter((e) => e.dataset.side === 'de') };
      placeNewPairs(freed, extra, this.cfg.mixed).forEach(({ w, side, slot }, i) => {
        const el = this.makeTile(w, side);
        el.classList.add('new');
        el.style.setProperty('--d', (i * 40) + 'ms');
        slot.replaceWith(el);
      });
    });
    this.later(470 + 300 + extra.length * 2 * 40 + 40, () => this.wirbelShuffle());
  }

  wirbelShuffle() {
    const grid = this.pairs.grid;
    const tiles = [...grid.querySelectorAll('.tile')];
    const first = new Map(tiles.map((el) => [el, el.getBoundingClientRect()]));
    const byWord = new Map();
    for (const el of tiles) {
      const p = byWord.get(el.dataset.wid) || {};
      p[el.dataset.side] = el;
      byWord.set(el.dataset.wid, p);
    }
    const order = wirbelOrder([...byWord.values()].filter((p) => p.en && p.de), this.cfg.mixed);
    order.forEach((el) => grid.appendChild(el));
    order.forEach((el, i) => {
      el.classList.remove('new');
      el.style.removeProperty('--d');
      const a = first.get(el);
      const z = el.getBoundingClientRect();
      el.style.setProperty('--dx', (a.left - z.left) + 'px');
      el.style.setProperty('--dy', (a.top - z.top) + 'px');
      el.style.setProperty('--rot', ((i % 2 ? 1 : -1) * (8 + (i % 3) * 4)) + 'deg');
      el.classList.add('swirl');
    });
    this.later(640, () => {
      order.forEach((el) => {
        el.classList.remove('swirl');
        ['--dx', '--dy', '--rot'].forEach((v) => el.style.removeProperty(v));
      });
      this.release('wirbel');
    });
  }

  tapTile(tile) {
    if (tile.done || this.blocked()) return;
    const ps = this.pairs;
    const sel = ps.sel;
    if (!sel) {
      ps.sel = tile;
      tile.el.classList.add('sel');
      tile.el.setAttribute('aria-pressed', 'true');
      return;
    }
    if (sel === tile) {
      tile.el.classList.remove('sel');
      tile.el.removeAttribute('aria-pressed');
      ps.sel = null;
      return;
    }
    if (sel.side === tile.side) {
      sel.el.classList.remove('sel');
      sel.el.removeAttribute('aria-pressed');
      ps.sel = tile;
      tile.el.classList.add('sel');
      tile.el.setAttribute('aria-pressed', 'true');
      return;
    }
    ps.sel = null;
    sel.el.classList.remove('sel');
    sel.el.removeAttribute('aria-pressed');
    const mark = (el, name) => {
      const m = icon(name, 'mark');
      m.setAttribute('role', 'img');
      m.setAttribute('aria-label', t(name === 'check' ? 'right' : 'wrong'));
      m.removeAttribute('aria-hidden');
      el.appendChild(m);
    };
    if (sel.w.id === tile.w.id) {
      sel.done = tile.done = true;
      for (const x of [sel, tile]) {
        x.el.classList.add('done');
        x.el.disabled = true;
        mark(x.el, 'check');
      }
      sfx.good();
      store.bumpStat(this.list.id, tile.w.id, true);
      ps.left--;
      ps.matched++;
      this.komboHit([sel.el, tile.el]);
      this.renderPairsCount();
      if (ps.left === 0) this.finishRound();
      else if (ps.extra.length && ps.matched === WIRBEL_EXTRA) this.wirbelSwap();
    } else {
      for (const x of [sel, tile]) {
        x.el.classList.add('wrong');
        mark(x.el, 'close');
      }
      const enT = sel.side === 'en' ? sel : tile;
      const deT = sel.side === 'de' ? sel : tile;
      this.fail({ kind: 'pairs', en: enT.w, de: deT.w, enText: enT.text, deText: deT.text, ids: [enT.w.id, deT.w.id] });
    }
  }

  // ---------- game: multiple choice ----------

  renderChoice(words) {
    const qs = words.map((w) => ({ w, dir: Math.random() < 0.5 ? 'de2en' : 'en2de' }));
    let qi = 0;
    let locked = false;
    const wrap = h('div', { class: 'choice' });
    this.board.appendChild(wrap);
    const show = () => {
      const q = qs[qi];
      const pf = q.dir === 'de2en' ? 'de' : 'en';
      const af = q.dir === 'de2en' ? 'en' : 'de';
      const opts = shuffle([q.w, ...pickDistractors(this.words, q.w, af, 3, Math.random, pf)]);
      q.promptText = pickVariant(q.w[pf], pf);
      const texts = new Map(opts.map((o) => [o, pickVariant(o[af], af)]));
      const buttons = opts.map((o) => {
        const b = h('button', { class: 'option', type: 'button', lang: this.lang[af] },
          h('span', null, texts.get(o)), icon('check', 'icon-ok'), icon('close', 'icon-bad'));
        b.addEventListener('click', () => pick(o, b, buttons, opts, texts.get(o)));
        return b;
      });
      wrap.replaceChildren(
        this.questionHeader(qs.length, qi, q.dir),
        this.promptCard(pf, q.promptText, false),
        h('div', { class: 'options' }, buttons),
      );
    };
    const pick = (o, btn, buttons, opts, chosenText) => {
      if (locked || qi >= qs.length || this.blocked()) return;
      const q = qs[qi];
      if (o.id === q.w.id) {
        btn.classList.add('right');
        sfx.good();
        store.bumpStat(this.list.id, q.w.id, true);
        qi++;
        this.komboHit([btn]);
        if (qi >= qs.length) {
          this.finishRound();
        } else {
          locked = true;
          this.later(300, () => { locked = false; show(); });
        }
      } else {
        btn.classList.add('wrong');
        buttons[opts.indexOf(q.w)].classList.add('reveal');
        this.fail({ kind: 'choice', word: q.w, dir: q.dir, promptText: q.promptText, chosenText, ids: [q.w.id] });
      }
    };
    show();
  }

  // ---------- game: missing letters ----------

  renderGaps(words) {
    const keepFirst = this.cfg.keepFirst !== false;
    const items = words.map((w) => {
      const opts = gapTargets(w.en);
      const target = opts[Math.floor(Math.random() * opts.length)];
      return { w, target, prompt: pickVariant(w.de, 'de'), hidden: makeGaps(target, this.cfg.gapRatio, keepFirst) };
    });
    let ii = 0;
    const wrap = h('div', { class: 'typing' });
    this.board.appendChild(wrap);
    const show = () => {
      const it = items[ii];
      const chars = [...it.target];
      const groups = splitWords(chars);
      const longest = Math.max(...groups.filter(Array.isArray).map((g) => g.length));
      const avail = Math.min(528, window.innerWidth - 32) - 12;
      const cw = cellWidth(longest, avail, 20, 13);
      const cells = new Map();
      const groupEls = groups.map((g) => {
        if (!Array.isArray(g)) return null;
        return h('span', { class: 'wgroup' }, g.map((idx) => {
          const isGap = it.hidden.includes(idx);
          const el = h('span', { class: 'cell' + (isGap ? ' gap' : ''), style: { width: cw + 'px', fontSize: Math.min(19, Math.round(cw * 0.95)) + 'px' } }, isGap ? '' : chars[idx]);
          cells.set(idx, el);
          return el;
        }));
      });
      const gapEls = it.hidden.map((idx) => cells.get(idx));
      const input = h('input', {
        class: 'gap-input', type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none',
        spellcheck: 'false', maxlength: String(it.hidden.length), enterkeyhint: 'done', 'aria-label': t('task_gaps') + ': ' + chars.map((c, i) => (it.hidden.includes(i) ? '_' : c)).join(' '),
      });
      const box = h('div', { class: 'gapbox' },
        h('span', { class: 'gapword', lang: this.lang.en, 'aria-hidden': 'true' }, groupEls),
        h('span', { class: 'gap-hint', 'aria-hidden': 'true' }, icon('keyboard'), t('tapToType')),
        input);
      const okBtn = h('button', { class: 'btn primary typing-btn', type: 'button' }, t('check'));
      const letters = () => [...input.value.replace(/[^\p{L}]/gu, '')].slice(0, it.hidden.length);
      const update = () => {
        const v = letters();
        if (input.value !== v.join('')) input.value = v.join('');
        gapEls.forEach((el, k) => {
          const target = chars[it.hidden[k]];
          const ch = v[k] ? (target === target.toUpperCase() ? v[k].toUpperCase() : v[k].toLowerCase()) : '';
          el.textContent = ch;
          el.classList.toggle('filled', !!ch);
          el.classList.toggle('cur', k === v.length && document.activeElement === input);
        });
      };
      const submit = () => {
        if (this.blocked()) return;
        const v = letters();
        if (v.length < it.hidden.length) {
          this.nudge(box);
          input.focus({ preventScroll: true });
          return;
        }
        const assembled = chars.slice();
        it.hidden.forEach((idx, k) => { assembled[idx] = v[k]; });
        const typed = assembled.join('');
        if (typed.toLowerCase() === it.target.toLowerCase()) {
          gapEls.forEach((el) => el.classList.add('right'));
          sfx.good();
          store.bumpStat(this.list.id, it.w.id, true);
          ii++;
          if (ii >= items.length) this.finishRound();
          else { this.checkFly(); show(); }
        } else {
          gapEls.forEach((el, k) => {
            if (v[k].toLowerCase() !== chars[it.hidden[k]].toLowerCase()) el.classList.add('wrong');
          });
          this.fail({ kind: 'gaps', word: it.w, prompt: it.prompt, alts: [it.w], typed, expected: it.target, ids: [it.w.id] });
        }
      };
      input.addEventListener('input', update);
      input.addEventListener('focus', update);
      input.addEventListener('blur', update);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      okBtn.addEventListener('pointerdown', (e) => e.preventDefault());
      okBtn.addEventListener('click', submit);
      wrap.replaceChildren(
        this.questionHeader(items.length, ii, 'de2en'),
        this.promptCard('de', it.prompt, true),
        box,
        okBtn,
      );
      if (this.kb) this.kb.attach(input, { maxLetters: it.hidden.length });
      this.currentInput = input;
      input.focus({ preventScroll: true });
      update();
    };
    show();
  }

  // ---------- game: spelling ----------

  renderSpell(words) {
    let ii = 0;
    const wrap = h('div', { class: 'typing' });
    this.board.appendChild(wrap);
    const show = () => {
      const w = words[ii];
      const prompt = pickVariant(w.de, 'de');
      const alts = this.words.filter((x) => x === w || variants(x.de, 'de').some((v) => norm(v) === norm(prompt)));
      const input = h('input', {
        class: 'spell-input', type: 'text', lang: this.lang.en, autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none',
        spellcheck: 'false', enterkeyhint: 'done', placeholder: t('typeHere_' + this.lang.en), 'aria-label': t('typeHere_' + this.lang.en),
      });
      const okBtn = h('button', { class: 'btn primary typing-btn', type: 'button' }, t('check'));
      const submit = () => {
        if (this.blocked()) return;
        const val = input.value.trim();
        if (!val) {
          this.nudge(input);
          input.focus({ preventScroll: true });
          return;
        }
        if (alts.some((x) => checkAnswer(val, x.en))) {
          input.classList.add('right');
          sfx.good();
          store.bumpStat(this.list.id, w.id, true);
          ii++;
          if (ii >= words.length) this.finishRound();
          else { this.checkFly(); show(); }
        } else {
          input.classList.add('wrong');
          this.fail({ kind: 'spell', word: w, prompt, alts, typed: val, expected: closestForm(val, alts.map((x) => x.en).join(' = ')), ids: [w.id] });
        }
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      okBtn.addEventListener('pointerdown', (e) => e.preventDefault());
      okBtn.addEventListener('click', submit);
      wrap.replaceChildren(
        this.questionHeader(words.length, ii, 'de2en'),
        this.promptCard('de', prompt, true),
        input,
        okBtn,
      );
      if (this.kb) this.kb.attach(input);
      this.currentInput = input;
      input.focus({ preventScroll: true });
    };
    show();
  }

  nudge(el) {
    el.classList.remove('nudge');
    void el.offsetWidth;
    el.classList.add('nudge');
  }

  // ---------- endings ----------

  endRun() {
    this.ended = true;
    this.epoch++;
    this.currentInput = null;
    if (this.kb) this.kb.detach();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  fail(info) {
    if (this.ended) return;
    if (this.mode === 'training') { this.trainingWrong(info); return; }
    this.endRun();
    sfx.bad();
    info.ids.forEach((id) => store.bumpStat(this.list.id, id, false));
    const summary = this.mode === 'endless' ? this.endlessSummary() : null;
    if (this.mode === 'level') store.recordResult(this.list.id, this.level, { completed: false, timeLeft: 0, round: this.roundIdx + 1 });
    const st = store.countToday();
    this.root.classList.add('shake');
    // a small text button below the two main buttons: practise the word(s) of this mistake
    const ids = [...new Set(info.ids)];
    const buttons = [
      [{ label: t('menu'), value: 'menu', kind: 'outline' }, { label: t('again'), value: 'again', kind: 'primary', grow: true }],
      [{ label: t(ids.length > 1 ? 'practiceWords' : 'practiceWord'), value: 'train', kind: 'text', iconLeft: 'training' }],
    ];
    setTimeout(() => {
      if (this.destroyed) return;
      this.root.classList.remove('shake');
      this.showEndModal({
        title: t('wrongTitle'),
        cls: 'modal-fail',
        icon: { name: 'close', kind: 'err' },
        body: h('div', { class: 'modal-body' }, this.failBody(info), summary || h('p', { class: 'encourage' }, t('wrongSub')),
          st.plus ? this.streakChip(st) : null),
        buttons,
        trainIds: ids,
      });
    }, this.reducedMotion() ? 0 : 800);
  }

  /** Endlos is over: finished rounds as a big number, record. */
  endlessSummary() {
    const n = this.roundIdx;
    const res = store.recordEndless(this.list.id, n);
    return h('div', { class: 'endless-sum' },
      h('span', { class: 'eyebrow' }, t('roundsDone')),
      h('span', { class: 'big-number' }, String(n)),
      res.newRecord
        ? h('span', { class: 'record-chip late' }, icon('star'), t('newRecord'))
        : res.best > 0 ? h('p', { class: 'modal-text' }, res.best === 1 ? t('endlessBestOne') : t('endlessBest', { n: res.best })) : null);
  }

  /** "Tagesserie: 5 Tage" (+1 when this game was the first one of the day). */
  streakChip(st) {
    return h('div', { class: 'st-chip-row' },
      h('span', { class: 'st-chip' + (st.plus ? '' : ' plain') },
        icon('streak'), t('streakChip') + ' ', h('b', null, st.n + ' ' + tDays(st.n)),
        st.plus ? h('span', { class: 'st-plus' }, '+1') : null));
  }

  okRow(enWord, deWord, cls) {
    return h('div', { class: 'res-row good ' + cls },
      icon('check'),
      h('span', null, h('b', { lang: this.lang.en }, enWord), ' = ', h('span', { lang: this.lang.de }, deWord)));
  }

  failBody(info) {
    if (info.kind === 'pairs') {
      return h('div', { class: 'modal-body' },
        h('div', { class: 'fail-group' },
          h('span', { class: 'fail-label' }, t('wrongPair')),
          h('div', { class: 'res-row bad' }, icon('close'),
            h('s', null, h('span', { lang: this.lang.en }, info.enText), ' ≠ ', h('span', { lang: this.lang.de }, info.deText)))),
        h('div', { class: 'fail-group' },
          h('span', { class: 'fail-label' }, t('correctPairs')),
          this.okRow(allVariants(info.en.en, 'en'), allVariants(info.en.de, 'de'), 'd1'),
          this.okRow(allVariants(info.de.en, 'en'), allVariants(info.de.de, 'de'), 'd2')));
    }
    if (info.kind === 'choice') {
      const af = info.dir === 'de2en' ? 'en' : 'de';
      const pf = info.dir === 'de2en' ? 'de' : 'en';
      return h('div', { class: 'modal-body' },
        h('div', { class: 'prompt-box' }, h('span', { class: 'label' }, t('label_' + this.lang[pf])), h('span', { class: 'word', lang: this.lang[pf] }, info.promptText)),
        h('div', { class: 'fail-group' },
          h('div', { class: 'answer-block bad' },
            h('span', { class: 'fail-label' }, t('yourChoice')),
            h('span', { class: 'val' }, icon('close'), h('s', { lang: this.lang[af] }, info.chosenText))),
          h('div', { class: 'answer-block good' },
            h('span', { class: 'fail-label' }, variants(info.word[af], af).length > 1 ? t('allAnswers') : t('correctAnswer')),
            h('span', { class: 'val' }, icon('check'), h('span', { lang: this.lang[af] }, allVariants(info.word[af], af))))));
    }
    return h('div', { class: 'modal-body' },
      h('div', { class: 'prompt-box' }, h('span', { class: 'label' }, t('label_' + this.lang.de)), h('span', { class: 'word', lang: this.lang.de }, info.prompt)),
      this.diffView(info.typed, info.expected),
      this.answerLine(info.prompt, info.alts));
  }

  /** "Kollegin = colleague / workmate" – every accepted English answer. */
  answerLine(prompt, alts) {
    const answers = [];
    for (const a of alts) for (const v of variants(a.en, 'en')) if (!answers.some((x) => norm(x) === norm(v))) answers.push(v);
    return h('div', { class: 'answer-line' },
      answers.length > 1 ? h('span', { class: 'fail-label' }, t('allAnswers')) : null,
      h('p', null, h('span', { lang: this.lang.de }, prompt), ' = ', h('b', { lang: this.lang.en }, answers.join(' / '))));
  }

  /** Error comparison: "your answer" and "correct" as two labelled rows, wrong parts marked. */
  diffView(typed, expected) {
    const { top, bot } = answerDiff(typed, expected);
    let k = 0;
    const total = top.length + bot.length;
    const wobAt = total * 35 + 250;
    const row = (tokens) => {
      const groups = [[]];
      tokens.forEach((tk) => (tk.sp ? groups.push([]) : groups[groups.length - 1].push(tk)));
      return groups.filter((g) => g.length).map((g) => h('span', { class: 'ch-word' }, g.map((tk) => {
        const delay = (k++) * 35;
        const flag = tk.miss || (tk.cls && tk.cls !== '');
        const cls = 'ch' + (tk.miss ? ' miss' : tk.cls ? ' ' + tk.cls : '') + (flag ? ' wob' : '');
        return h('span', { class: cls, style: { '--in': delay + 'ms', '--wob': wobAt + 'ms' } }, tk.miss ? '' : tk.ch);
      })));
    };
    return h('div', { class: 'answer-diff' },
      h('div', { class: 'diff-row yours', role: 'group', 'aria-label': t('yourInput') + ': ' + typed },
        h('span', { class: 'diff-label' }, icon('close'), t('yourInput')),
        h('span', { class: 'diff-text', lang: this.lang.en, 'aria-hidden': 'true' }, row(top))),
      h('div', { class: 'diff-row correct', role: 'group', 'aria-label': t('expected') + ': ' + expected },
        h('span', { class: 'diff-label' }, icon('check'), t('expected')),
        h('span', { class: 'diff-text', lang: this.lang.en, 'aria-hidden': 'true' }, row(bot))));
  }

  timeUp() {
    if (this.ended) return;
    this.endRun();
    sfx.bad();
    const recap = h('div', { class: 'recap' }, this.roundWords.map((w) => h('div', null,
      h('span', { lang: this.lang.en }, allVariants(w.en, 'en')), h('span', { lang: this.lang.de }, allVariants(w.de, 'de')))));
    if (this.mode === 'endless') {
      const summary = this.endlessSummary();
      const st = store.countToday();
      this.showEndModal({
        title: t('gameOver'),
        center: true,
        cls: 'modal-fail',
        icon: { name: 'endless', kind: 'accent', extra: 'big' },
        body: h('div', { class: 'modal-body' }, summary, recap, st.plus ? this.streakChip(st) : null),
      });
      return;
    }
    store.recordResult(this.list.id, this.level, { completed: false, timeLeft: 0, round: this.roundIdx + 1 });
    const [pre, bold, post] = tSplit('timeUpSub', { round: t('roundOf', { r: this.roundIdx + 1, n: this.cfg.rounds }) }, 'round');
    const intro = h('p', { class: 'modal-text', style: { color: 'var(--text)' } }, pre, h('b', null, bold), post);
    const st = store.countToday();
    this.showEndModal({
      title: t('timeUpTitle'),
      cls: 'modal-fail',
      icon: { name: 'hourglass', kind: 'accent' },
      body: h('div', { class: 'modal-body' }, intro, recap, st.plus ? this.streakChip(st) : null),
    });
  }

  /** Zeitbombe defused: next round, the time is already full (bomb.js). */
  bombDone(chip) {
    this.roundDone({ bombChip: chip });
  }

  /** Zeitbombe: time over. Straight to the end dialog – no list of words. */
  bombLost(found) {
    const pairs = t('zbPairsOf', { k: found, n: BOMB.need });
    if (this.mode === 'endless') {
      const summary = this.endlessSummary();
      const st = store.countToday();
      this.showEndModal({
        title: t('zbBoomTitle'),
        center: true,
        cls: 'modal-fail',
        icon: { name: 'zeitbombe', kind: 'zb', extra: 'big' },
        body: h('div', { class: 'modal-body' }, summary,
          h('p', { class: 'modal-text' }, t('zbEndlessLine', { r: this.roundIdx + 1 }) + ' · ' + pairs),
          st.plus ? this.streakChip(st) : null),
      });
      return;
    }
    store.recordResult(this.list.id, this.level, { completed: false, timeLeft: 0, round: this.roundIdx + 1 });
    const st = store.countToday();
    this.showEndModal({
      title: t('zbBoomTitle'),
      cls: 'modal-fail',
      icon: { name: 'zeitbombe', kind: 'zb' },
      body: h('div', { class: 'modal-body' },
        h('p', { class: 'modal-text', style: { color: 'var(--text)' } },
          h('b', null, t('zbRound', { r: this.roundIdx + 1, n: this.cfg.rounds })), ' · ' + pairs),
        h('p', { class: 'encourage' }, t('zbEncourage')),
        st.plus ? this.streakChip(st) : null),
    });
  }

  levelDone() {
    this.endRun();
    sfx.win();
    const secs = Math.ceil((this.timeLeft + this.reserve) / 1000);
    const res = store.recordResult(this.list.id, this.level, { completed: true, timeLeft: secs, round: this.cfg.rounds });
    store.renewFixedRounds(this.list.id, this.level, this.words);
    this.confetti();
    const next = LEVEL_IDS[LEVEL_IDS.indexOf(this.level) + 1];
    const lines = [
      h('div', { class: 'rest' },
        h('span', { class: 'eyebrow' }, t('restLabel')),
        h('span', { class: 'rest-num' }, String(secs), h('span', { class: 'unit' }, ' s'))),
    ];
    if (res.newRecord) lines.push(h('span', { class: 'record-chip' }, icon('star'), t('newRecord')));
    if (res.unlocked) lines.push(h('p', { class: 'unlock-line' }, icon('check'), t('unlocked', { level: t('level_' + res.unlocked) })));
    if (res.endless) lines.push(h('p', { class: 'unlock-line' }, icon('check'), t('endlessUnlockedList')));
    lines.push(h('p', { class: 'modal-text new-words' }, t('newFixed')));
    if (!next) lines.push(h('p', { class: 'modal-text' }, t('allDone')));
    lines.push(this.streakChip(store.countToday()));
    const buttons = next
      ? [
        [{ label: t('nextLevel', { level: t('level_' + next) }), value: 'next', kind: 'primary', tall: true, icon: 'arrowRight' }],
        [{ label: t('menu'), value: 'menu', kind: 'outline' }, { label: t('again'), value: 'again', kind: 'outline' }],
      ]
      : [{ label: t('menu'), value: 'menu', kind: 'outline' }, { label: t('again'), value: 'again', kind: 'primary', grow: true }];
    this.showEndModal({ title: t('doneTitle'), icon: { name: 'check', kind: 'ok' }, center: true, body: lines, buttons, next, cls: 'modal-win' });
  }

  showEndModal({ title, body, icon: ic, center = false, buttons, next, cls = '', trainIds = [] }) {
    const btns = buttons || [{ label: t('menu'), value: 'menu', kind: 'outline' }, { label: t('again'), value: 'again', kind: 'primary', grow: true }];
    modal({ title, icon: ic, body, buttons: btns, center, cls: 'modal-end ' + cls }).then((v) => {
      if (this.destroyed) return;
      if (v === 'again') this.replay();
      else if (v === 'next') this.onNextLevel(next);
      else if (v === 'train' && this.onTrain) { this.destroy(); this.onTrain(trainIds); }
      else { this.destroy(); this.onMenu(); }
    });
  }

  /** "Nochmal": the new game fades in. */
  replay() {
    replay(this.root, 'tr-show');
    setTimeout(() => this.root.classList.remove('tr-show'), 300);
    this.start();
  }

  // ---------- Fehlertraining ----------

  startTrainingQuestion(learnedAnim = false) {
    const q = this.tQueue;
    if (!q.length) { this.trainingDone(); return; }
    const it = q.splice(trainingPick(q, this.tLast), 1)[0];
    this.tCur = it;
    this.tLast = it.w.id;
    const type = it.types[it.step];
    const left = q.length + 1;
    this.mod = null;
    this.roundType = type;
    this.roundWords = [it.w];
    this.currentInput = null;
    if (this.kb) this.kb.detach();
    // after a learned word the counter changes when the word card arrives there
    if (learnedAnim) this.later(450, () => this.renderTrainingCount(left, true));
    else this.renderTrainingCount(left, false);
    this.renderSteps();
    this.elTask.textContent = this.taskText(type);
    this.root.classList.toggle('typing-round', KEYBOARD_TYPES.includes(type));
    this.renderBoard(type, [it.w]);
    if (learnedAnim) this.board.classList.add('swap-in');
    this.renderModUI();
  }

  /** "Noch 7 Wörter", with a check mark after a learned word. */
  renderTrainingCount(n, learned) {
    const [pre, num, post] = tSplit(n === 1 ? 'wordsLeftOne' : 'wordsLeft', { n }, 'n');
    const b = h('b', null, num);
    this.elRound.replaceChildren(...[learned ? h('span', { class: 'learn-mark' }, icon('check')) : null, pre, b, post].filter((x) => x !== null && x !== ''));
    if (learned) replay(b, 'bump');
  }

  /** Progress of the current word: "2/3" and three dots (Auswahl → Lücken → Schreiben). */
  renderSteps(popIdx = -1) {
    const step = this.tCur ? Math.min(this.tCur.step, 3) : 0;
    this.elSteps.setAttribute('aria-label', step + '/3');
    this.elSteps.replaceChildren(h('span', { class: 'word-steps-label' }, step + '/3'),
      ...[0, 1, 2].map((i) => h('i', { class: 'word-step' + (i < step ? ' done' : i === step ? ' cur' : '') + (i === popIdx ? ' pop' : '') })));
  }

  /** Right answer: one step further; after 3 steps the word is learned and flies into the counter. */
  trainingRight() {
    const it = this.tCur;
    const doneIdx = it.step;
    it.step++;
    const learned = it.step >= it.types.length;
    this.renderSteps(doneIdx);
    if (learned) {
      store.clearMistakes(this.list.id, it.w.id);
      this.tLearned++;
    } else {
      this.tQueue.push(it);
    }
    this.board.classList.add('round-ok');
    const next = this.tQueue.length ? this.tQueue[trainingPick(this.tQueue, it.w.id)] : null;
    const nextKb = !!next && KEYBOARD_TYPES.includes(next.types[next.step]);
    if (!learned) {
      if (nextKb) this.startRound();
      else this.later(420, () => this.startRound());
      return;
    }
    if (!next) {
      // the last word: it flies into the counter, the board stays empty until the result
      this.later(350, () => {
        this.flyLearned();
        this.board.replaceChildren();
        this.elTask.textContent = '';
        this.later(650, () => this.startRound());
      });
    } else if (nextKb) {
      this.flyLearned();
      this.startRound(true);
    } else {
      this.later(350, () => { this.flyLearned(); this.startRound(true); });
    }
  }

  /** The finished question flies into the word counter, "Gelernt" pops up. */
  flyLearned() {
    const base = this.fx.getBoundingClientRect();
    const a = this.board.getBoundingClientRect();
    const target = this.elRound.querySelector('b') || this.elRound;
    const b = target.getBoundingClientRect();
    const ghost = h('div', {
      class: 'learn-fly',
      style: {
        left: (a.left - base.left) + 'px', top: (a.top - base.top) + 'px', width: a.width + 'px', height: a.height + 'px',
        '--lx': (b.left + b.width / 2 - (a.left + a.width / 2)) + 'px', '--ly': (b.top + b.height / 2 - (a.top + a.height / 2)) + 'px',
      },
    });
    // a copy without form fields, so nothing can get the focus
    const copy = this.board.cloneNode(true);
    copy.querySelectorAll('input, button').forEach((x) => {
      const span = h('span', { class: x.className });
      span.textContent = x.tagName === 'INPUT' ? x.value : x.textContent;
      x.replaceWith(span);
    });
    ghost.append(...copy.childNodes);
    this.flash(ghost, 480);
    this.callout('learned', icon('check'), t('learnedShort'), 1000);
  }

  /** Wrong answer: show what was wrong, the word starts again at step 1 and comes back later. */
  trainingWrong(info) {
    this.roundOver = true;
    sfx.bad();
    info.ids.forEach((id) => store.bumpStat(this.list.id, id, false));
    const it = this.tCur;
    it.step = 0;
    this.tQueue.push(it);
    this.currentInput = null;
    if (this.kb) this.kb.detach();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    this.root.classList.add('shake');
    const e = this.epoch;
    setTimeout(() => {
      if (this.destroyed || e !== this.epoch) return;
      this.root.classList.remove('shake');
      modal({
        title: t('wrongTitle'),
        icon: { name: 'close', kind: 'err' },
        cls: 'modal-end modal-fail',
        body: h('div', { class: 'modal-body' }, this.failBody(info), h('p', { class: 'later-note' }, icon('reset'), t('laterAgain'))),
        buttons: [{ label: t('menu'), value: 'quit', kind: 'outline' }, { label: t('goOn'), value: 'go', kind: 'primary', grow: true }],
      }).then((v) => {
        if (this.destroyed) return;
        if (v === 'quit') { this.destroy(); this.onMenu(); return; }
        this.startRound();
      });
    }, this.reducedMotion() ? 0 : 800);
  }

  trainingDone() {
    this.endRun();
    sfx.win();
    this.confetti();
    const n = this.tLearned;
    const st = store.countToday();
    const more = store.mistakeWords(this.list.id, this.words).length;
    modal({
      title: t(more ? 'trainingRoundDone' : 'trainingDoneTitle'),
      icon: { name: 'check', kind: 'ok' },
      center: true,
      cls: 'modal-end modal-win',
      body: [
        h('div', { class: 'big-stat' },
          h('span', { class: 'big-number' }, String(n)),
          h('span', { class: 'eyebrow' }, n === 1 ? t('wordLearned') : t('wordsLearned'))),
        more ? h('p', { class: 'modal-text' }, more === 1 ? t('trainingMoreOne') : t('trainingMore', { n: more })) : null,
        st.plus ? this.streakChip(st) : null,
      ].filter(Boolean),
      buttons: more
        ? [{ label: t('menu'), value: 'menu', kind: 'outline' }, { label: t('practiceMore'), value: 'more', kind: 'primary', grow: true }]
        : [{ label: t('menu'), value: 'menu', kind: 'primary', grow: true, tall: true }],
    }).then((v) => {
      if (this.destroyed) return;
      if (v === 'more') { this.replay(); return; }
      this.destroy();
      this.onMenu();
    });
  }

  /** Confetti in its own layer above the result dialog (not under its dimmed backdrop). */
  confetti() {
    const layer = h('div', { class: 'confetti-layer', 'aria-hidden': 'true' });
    for (let i = 0; i < 48; i++) {
      const round = i % 4 === 0;
      const w = round ? 9 : 7 + (i % 3) * 2;
      const hgt = round ? 9 : 11 + (i % 2) * 5;
      layer.appendChild(h('span', {
        class: 'confetti',
        style: {
          left: Math.random() * 100 + '%',
          width: w + 'px',
          height: hgt + 'px',
          borderRadius: round ? '50%' : '2px',
          background: CONFETTI[i % CONFETTI.length],
          '--d': (Math.random() * 0.7).toFixed(2) + 's',
          '--dur': (1.8 + (i % 5) * 0.2).toFixed(2) + 's',
          '--r': Math.round(Math.random() * 720 - 360) + 'deg',
          '--x': Math.round(Math.random() * 120 - 60) + 'px',
          '--y': Math.round(Math.random() * 60) + 'vh',
        },
      }));
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 3600);
  }
}
