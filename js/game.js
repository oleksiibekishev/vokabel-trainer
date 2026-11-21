import {
  LEVELS, LEVEL_IDS, ROUND_SIZE, buildTypePlan, pickWords, pickDistractors, makeGaps, primaryForm,
  checkAnswer, closestForm, diffWords, shuffle, wordFilterFor,
} from './core.js';
import * as store from './store.js';
import { t } from './i18n.js';
import { h, icon, modal, sfx } from './ui.js';

const BONUS_PAUSE_MS = 900;
const KEYBOARD_TYPES = ['gaps', 'spell'];

export class Game {
  constructor({ root, list, level, onMenu, onNextLevel }) {
    this.root = root;
    this.list = list;
    this.level = level;
    this.onMenu = onMenu;
    this.onNextLevel = onNextLevel;
    this.words = list.words;
    this.byId = new Map(this.words.map((w) => [w.id, w]));
    this.cfg = { ...LEVELS[level], ...store.timing(level) };
    this.holds = new Set();
    this.epoch = 0;
    this.ended = true;
    this.destroyed = false;
    this.currentInput = null;
    this.tick = this.tick.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.buildShell();
    this.raf = requestAnimationFrame(this.tick);
  }

  get running() {
    return !this.ended && !this.destroyed && this.holds.size === 0;
  }

  hold(reason) { this.holds.add(reason); }
  release(reason) { this.holds.delete(reason); }

  later(ms, fn) {
    const e = this.epoch;
    setTimeout(() => { if (e === this.epoch && !this.destroyed) fn(); }, ms);
  }

  // ---------- setup ----------

  buildShell() {
    const quitBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('quit'), onclick: () => this.askQuit() }, icon('close'));
    this.elRound = h('div', { class: 'game-round' });
    this.elTimerNum = h('span', { class: 'timer-num' }, '0');
    this.elTimer = h('div', { class: 'timer', role: 'timer' }, this.elTimerNum, h('span', { class: 'timer-unit' }, 's'));
    this.elBar = h('div', { class: 'timebar-fill' });
    this.elDots = h('div', { class: 'dots', 'aria-hidden': 'true' });
    this.elTask = h('div', { class: 'task-label' });
    this.board = h('main', { class: 'board' });
    this.fx = h('div', { class: 'fx-layer', 'aria-hidden': 'true' });
    this.root.className = 'screen game level-' + this.level;
    this.root.replaceChildren(
      h('header', { class: 'game-top' },
        quitBtn,
        h('div', { class: 'game-info' }, h('div', { class: 'game-level' }, t('level_' + this.level)), this.elRound),
        this.elTimer),
      h('div', { class: 'timebar' }, this.elBar),
      this.elDots,
      this.elTask,
      this.board,
      this.fx,
    );
  }

  start() {
    this.epoch++;
    this.ended = false;
    this.holds.clear();
    this.root.classList.remove('shake', 'paused');
    this.fx.replaceChildren();
    this.used = new Set();
    this.fixed = store.fixedRounds(this.list.id, this.level, this.words);
    this.fixed.forEach((r) => r.ids.forEach((id) => this.used.add(id)));
    this.plan = buildTypePlan(this.level);
    this.roundIdx = 0;
    this.timeLeft = this.cfg.start * 1000;
    this.shownSec = null;
    this.last = null;
    this.startRound();
  }

  destroy() {
    this.destroyed = true;
    this.epoch++;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  // ---------- timer ----------

  tick(ts) {
    if (this.destroyed) return;
    if (this.last == null) this.last = ts;
    const dt = Math.min(1000, ts - this.last);
    this.last = ts;
    if (this.running) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.renderTimer();
        this.timeUp();
      }
    }
    this.renderTimer();
    this.raf = requestAnimationFrame(this.tick);
  }

  renderTimer() {
    const sec = Math.ceil(this.timeLeft / 1000);
    if (sec !== this.shownSec) {
      this.shownSec = sec;
      this.elTimerNum.textContent = String(sec);
      this.elTimer.classList.toggle('low', sec <= 10 && !this.ended);
    }
    const pct = Math.max(0, Math.min(100, (this.timeLeft / (this.cfg.start * 1000)) * 100));
    this.elBar.style.width = pct + '%';
    this.elBar.classList.toggle('low', this.timeLeft <= 10000);
  }

  onVisibility() {
    if (document.hidden && !this.ended && !this.destroyed && !this.holds.has('pause')) this.showPause(false);
  }

  showPause(askQuit) {
    this.hold('pause');
    this.root.classList.add('paused');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const opts = askQuit
      ? { title: t('quitTitle'), body: h('p', null, t('quitText')), buttons: [{ label: t('quit'), value: 'quit', kind: 'danger' }, { label: t('resume'), value: 'resume', kind: 'primary' }] }
      : { title: t('pauseTitle'), buttons: [{ label: t('quit'), value: 'quit', kind: 'secondary' }, { label: t('resume'), value: 'resume', kind: 'primary' }] };
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

  renderDots() {
    this.elDots.replaceChildren(...this.plan.map((type, i) => h('span', {
      class: 'dot' + (i < this.roundIdx ? ' done' : '') + (i === this.roundIdx ? ' cur' : '') + (i < this.fixed.length ? ' fixed' : ''),
      'data-type': type,
    })));
  }

  startRound() {
    let type = this.plan[this.roundIdx];
    let words;
    if (this.roundIdx < this.fixed.length) {
      words = this.fixed[this.roundIdx].ids.map((id) => this.byId.get(id)).filter(Boolean);
    } else {
      words = pickWords(this.words, ROUND_SIZE[type], {
        used: this.used, stats: store.stats(this.list.id), filter: wordFilterFor(type),
      });
    }
    if (!words.length) {
      // e.g. a list without words long enough for the missing-letters game
      type = 'pairs';
      words = pickWords(this.words, ROUND_SIZE.pairs, { used: this.used, stats: store.stats(this.list.id) });
    }
    words.forEach((w) => this.used.add(w.id));
    this.roundType = type;
    this.roundWords = words;
    this.currentInput = null;
    this.elRound.textContent = t('round', { r: this.roundIdx + 1, n: this.cfg.rounds });
    this.elTask.textContent = t('task_' + type);
    this.renderDots();
    this.board.replaceChildren();
    this.board.className = 'board board-' + type;
    if (type === 'pairs') this.renderPairs(words);
    else if (type === 'choice') this.renderChoice(words);
    else if (type === 'gaps') this.renderGaps(words);
    else this.renderSpell(words);
  }

  /** Last answer of a round was right. Keyboard rounds start at once so the phone keyboard stays open. */
  finishRound() {
    this.hold('bonus');
    const next = this.plan[this.roundIdx + 1];
    this.board.classList.add('round-ok');
    if (next && KEYBOARD_TYPES.includes(next)) this.roundDone();
    else this.later(380, () => this.roundDone());
  }

  roundDone() {
    if (this.ended) return;
    this.roundIdx++;
    if (this.roundIdx >= this.cfg.rounds) {
      this.levelDone();
      return;
    }
    sfx.round();
    this.timeLeft += this.cfg.bonus * 1000;
    this.hold('bonus');
    if (this.cfg.bonus > 0) this.flyText('+' + this.cfg.bonus + ' s', 'bonus-fly');
    this.startRound();
    this.later(BONUS_PAUSE_MS, () => this.release('bonus'));
  }

  flyText(text, cls) {
    const el = h('div', { class: cls }, text);
    this.fx.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  // ---------- game: pairs ----------

  renderPairs(words) {
    const tiles = [];
    const make = (w, side) => {
      const el = h('button', { class: 'tile', type: 'button', lang: side, 'data-side': side }, side === 'en' ? w.en : w.de);
      const tile = { el, w, side, done: false };
      el.addEventListener('click', () => this.tapTile(tile));
      tiles.push(tile);
      return el;
    };
    if (!this.cfg.mixed) {
      const left = shuffle(words.slice()).map((w) => make(w, 'en'));
      const right = shuffle(words.slice()).map((w) => make(w, 'de'));
      this.board.appendChild(h('div', { class: 'pairs cols' },
        h('div', { class: 'col' }, h('div', { class: 'col-head' }, 'English'), left),
        h('div', { class: 'col' }, h('div', { class: 'col-head' }, 'Deutsch'), right)));
    } else {
      const all = [...words.map((w) => make(w, 'en')), ...words.map((w) => make(w, 'de'))];
      this.board.appendChild(h('div', { class: 'pairs grid' }, shuffle(all)));
    }
    this.pairs = { sel: null, left: words.length };
  }

  tapTile(tile) {
    if (this.ended || tile.done || this.holds.has('pause')) return;
    const ps = this.pairs;
    const sel = ps.sel;
    if (!sel) {
      ps.sel = tile;
      tile.el.classList.add('sel');
      return;
    }
    if (sel === tile) {
      tile.el.classList.remove('sel');
      ps.sel = null;
      return;
    }
    if (sel.side === tile.side) {
      sel.el.classList.remove('sel');
      ps.sel = tile;
      tile.el.classList.add('sel');
      return;
    }
    ps.sel = null;
    sel.el.classList.remove('sel');
    if (sel.w.id === tile.w.id) {
      sel.done = tile.done = true;
      sel.el.classList.add('done');
      tile.el.classList.add('done');
      sel.el.disabled = tile.el.disabled = true;
      sfx.good();
      store.bumpStat(this.list.id, tile.w.id, true);
      ps.left--;
      if (ps.left === 0) this.finishRound();
    } else {
      sel.el.classList.add('wrong');
      tile.el.classList.add('wrong');
      const en = sel.side === 'en' ? sel.w : tile.w;
      const de = sel.side === 'de' ? sel.w : tile.w;
      this.fail({ kind: 'pairs', en, de, ids: [en.id, de.id] });
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
      const buttons = opts.map((o) => {
        const b = h('button', { class: 'option', type: 'button', lang: af }, o[af]);
        b.addEventListener('click', () => pick(o, b, buttons, opts));
        return b;
      });
      wrap.replaceChildren(
        this.progressDots(qs.length, qi),
        h('div', { class: 'prompt-dir' }, t(q.dir === 'de2en' ? 'dirDeEn' : 'dirEnDe')),
        h('div', { class: 'prompt pop', lang: pf }, q.w[pf]),
        h('div', { class: 'options' }, buttons),
      );
    };
    const pick = (o, btn, buttons, opts) => {
      if (locked || this.ended || qi >= qs.length || this.holds.has('pause')) return;
      const q = qs[qi];
      if (o.id === q.w.id) {
        btn.classList.add('right');
        sfx.good();
        store.bumpStat(this.list.id, q.w.id, true);
        qi++;
        if (qi >= qs.length) {
          this.finishRound();
        } else {
          locked = true;
          this.later(300, () => { locked = false; show(); });
        }
      } else {
        btn.classList.add('wrong');
        buttons[opts.indexOf(q.w)].classList.add('reveal');
        this.fail({ kind: 'choice', word: q.w, dir: q.dir, chosen: o, ids: [q.w.id] });
      }
    };
    show();
  }

  progressDots(n, cur) {
    if (n <= 1) return document.createComment('single');
    return h('div', { class: 'q-progress' },
      Array.from({ length: n }, (_, i) => h('span', { class: i < cur ? 'done' : i === cur ? 'cur' : '' })));
  }

  // ---------- game: missing letters ----------

  renderGaps(words) {
    const keepFirst = this.level !== 'hard';
    const items = words.map((w) => {
      const target = primaryForm(w.en);
      return { w, target, hidden: makeGaps(target, this.cfg.gapRatio, keepFirst) };
    });
    let ii = 0;
    const wrap = h('div', { class: 'typing' });
    this.board.appendChild(wrap);
    const show = () => {
      const it = items[ii];
      const chars = [...it.target];
      const slots = chars.map((c, idx) => {
        if (it.hidden.includes(idx)) return h('span', { class: 'slot gap' });
        if (c === ' ') return h('span', { class: 'slot space' });
        return h('span', { class: 'slot' }, c);
      });
      const gapEls = it.hidden.map((idx) => slots[idx]);
      const input = h('input', {
        class: 'gap-input', type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none',
        spellcheck: 'false', maxlength: String(it.hidden.length), enterkeyhint: 'done', 'aria-label': t('task_gaps'),
      });
      const wordEl = h('div', { class: 'gapword', lang: 'en' }, slots, input);
      const okBtn = h('button', { class: 'btn primary wide', type: 'button' }, t('check'));
      const letters = () => [...input.value.replace(/[^\p{L}]/gu, '')].slice(0, it.hidden.length);
      const update = () => {
        const v = letters();
        if (input.value !== v.join('')) input.value = v.join('');
        gapEls.forEach((el, k) => {
          const target = chars[it.hidden[k]];
          const ch = v[k] ? (target === target.toUpperCase() ? v[k].toUpperCase() : v[k].toLowerCase()) : '';
          el.textContent = ch;
          el.classList.toggle('filled', !!ch);
          el.classList.toggle('cur', k === v.length);
        });
      };
      const submit = () => {
        if (this.ended || this.holds.has('pause')) return;
        const v = letters();
        if (v.length < it.hidden.length) {
          this.nudge(wordEl);
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
          else { this.flyText('✓', 'check-fly'); show(); }
        } else {
          gapEls.forEach((el, k) => {
            if (v[k].toLowerCase() !== chars[it.hidden[k]].toLowerCase()) el.classList.add('wrong');
          });
          this.fail({ kind: 'gaps', word: it.w, typed, expected: it.target, ids: [it.w.id] });
        }
      };
      input.addEventListener('input', update);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      okBtn.addEventListener('pointerdown', (e) => e.preventDefault());
      okBtn.addEventListener('click', submit);
      wrap.replaceChildren(
        this.progressDots(items.length, ii),
        h('div', { class: 'prompt-dir' }, t('dirDeEn')),
        h('div', { class: 'prompt pop', lang: 'de' }, it.w.de),
        wordEl,
        h('div', { class: 'hint' }, t('tapToType')),
        okBtn,
      );
      update();
      this.currentInput = input;
      input.focus({ preventScroll: true });
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
      const input = h('input', {
        class: 'spell-input', type: 'text', lang: 'en', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none',
        spellcheck: 'false', enterkeyhint: 'done', placeholder: t('typeHere'), 'aria-label': t('task_spell'),
      });
      const okBtn = h('button', { class: 'btn primary wide', type: 'button' }, t('check'));
      const submit = () => {
        if (this.ended || this.holds.has('pause')) return;
        const val = input.value.trim();
        if (!val) {
          this.nudge(input);
          input.focus({ preventScroll: true });
          return;
        }
        if (checkAnswer(val, w.en)) {
          input.classList.add('right');
          sfx.good();
          store.bumpStat(this.list.id, w.id, true);
          ii++;
          if (ii >= words.length) this.finishRound();
          else { this.flyText('✓', 'check-fly'); show(); }
        } else {
          input.classList.add('wrong');
          this.fail({ kind: 'spell', word: w, typed: val, expected: closestForm(val, w.en), ids: [w.id] });
        }
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      okBtn.addEventListener('pointerdown', (e) => e.preventDefault());
      okBtn.addEventListener('click', submit);
      wrap.replaceChildren(
        this.progressDots(words.length, ii),
        h('div', { class: 'prompt-dir' }, t('dirDeEn')),
        h('div', { class: 'prompt pop', lang: 'de' }, w.de),
        input,
        okBtn,
      );
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
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  fail(info) {
    if (this.ended) return;
    this.endRun();
    sfx.bad();
    info.ids.forEach((id) => store.bumpStat(this.list.id, id, false));
    store.recordResult(this.list.id, this.level, { completed: false, timeLeft: 0, round: this.roundIdx + 1 });
    this.root.classList.add('shake');
    setTimeout(() => {
      if (this.destroyed) return;
      this.root.classList.remove('shake');
      this.showEndModal({
        title: t('wrongTitle'),
        cls: 'modal-fail',
        body: h('div', null, this.failBody(info), h('p', { class: 'muted center' }, t('wrongSub'))),
      });
    }, 750);
  }

  failBody(info) {
    if (info.kind === 'pairs') {
      return h('div', { class: 'fail-pairs' },
        h('p', { class: 'fail-label' }, t('wrongPair')),
        h('div', { class: 'pair-row bad' }, h('span', { lang: 'en' }, info.en.en), h('span', { class: 'eq' }, '≠'), h('span', { lang: 'de' }, info.de.de)),
        h('p', { class: 'fail-label' }, t('correctPairs')),
        h('div', { class: 'pair-row good', style: { '--i': 1 } }, h('span', { lang: 'en' }, info.en.en), h('span', { class: 'eq' }, '='), h('span', { lang: 'de' }, info.en.de)),
        h('div', { class: 'pair-row good', style: { '--i': 2 } }, h('span', { lang: 'en' }, info.de.en), h('span', { class: 'eq' }, '='), h('span', { lang: 'de' }, info.de.de)),
      );
    }
    if (info.kind === 'choice') {
      const af = info.dir === 'de2en' ? 'en' : 'de';
      const pf = info.dir === 'de2en' ? 'de' : 'en';
      return h('div', { class: 'fail-choice' },
        h('div', { class: 'fail-prompt', lang: pf }, info.word[pf]),
        h('div', { class: 'answer-row bad' }, h('span', { class: 'answer-tag' }, t('yourChoice')), h('span', { class: 'answer-text strike', lang: af }, info.chosen[af])),
        h('div', { class: 'answer-row good', style: { '--i': 1 } }, h('span', { class: 'answer-tag' }, t('correctAnswer')), h('span', { class: 'answer-text', lang: af }, info.word[af])),
      );
    }
    // spelling or missing letters: letter-by-letter comparison
    const ops = diffWords(info.typed, info.expected);
    const cols = ops.map((op, i) => h('span', { class: 'dcol d-' + op.type, style: { '--i': i } },
      h('span', { class: 'dtop' }, op.type === 'missing' ? '' : op.a === ' ' ? ' ' : op.a),
      h('span', { class: 'dbot' }, op.type === 'extra' ? '' : op.b === ' ' ? ' ' : op.b)));
    return h('div', { class: 'fail-spell' },
      h('div', { class: 'fail-prompt', lang: 'de' }, info.word.de),
      h('div', { class: 'diff', lang: 'en' },
        h('div', { class: 'diff-labels' }, h('span', null, t('yourInput')), h('span', null, t('expected'))),
        h('div', { class: 'diff-grid' }, cols)),
      h('div', { class: 'full-answer' }, h('span', { lang: 'de' }, info.word.de), ' = ', h('span', { lang: 'en' }, info.word.en)),
    );
  }

  timeUp() {
    if (this.ended) return;
    this.endRun();
    sfx.bad();
    store.recordResult(this.list.id, this.level, { completed: false, timeLeft: 0, round: this.roundIdx + 1 });
    this.showEndModal({
      title: t('timeUpTitle'),
      cls: 'modal-fail',
      body: h('div', null,
        h('p', { class: 'center' }, t('timeUpSub', { r: this.roundIdx + 1, n: this.cfg.rounds })),
        h('div', { class: 'word-recap' }, this.roundWords.map((w) => h('div', { class: 'pair-row' },
          h('span', { lang: 'en' }, w.en), h('span', { class: 'eq' }, '='), h('span', { lang: 'de' }, w.de))))),
    });
  }

  levelDone() {
    this.endRun();
    sfx.win();
    const secs = Math.ceil(this.timeLeft / 1000);
    const res = store.recordResult(this.list.id, this.level, { completed: true, timeLeft: secs, round: this.cfg.rounds });
    this.confetti();
    const idx = LEVEL_IDS.indexOf(this.level);
    const next = LEVEL_IDS[idx + 1];
    const lines = [h('p', { class: 'center big' }, t('doneSub', { t: secs }))];
    if (res.newRecord) lines.push(h('p', { class: 'center record' }, t('newRecord')));
    if (res.unlocked) lines.push(h('p', { class: 'center unlocked' }, icon('check'), ' ', t('unlocked', { level: t('level_' + res.unlocked) })));
    if (!next) lines.push(h('p', { class: 'center' }, t('allDone')));
    this.showEndModal({ title: t('doneTitle'), cls: 'modal-win', body: h('div', null, lines), next });
  }

  showEndModal({ title, body, cls, next }) {
    const buttons = [{ label: t('menu'), value: 'menu', kind: 'secondary' }];
    if (next) {
      buttons.push({ label: t('again'), value: 'again', kind: 'secondary' });
      buttons.push({ label: t('nextLevel', { level: t('level_' + next) }), value: 'next', kind: 'primary' });
    } else {
      buttons.push({ label: t('again'), value: 'again', kind: 'primary' });
    }
    modal({ title, body, buttons, cls }).then((v) => {
      if (this.destroyed) return;
      if (v === 'again') this.start();
      else if (v === 'next') this.onNextLevel(next);
      else { this.destroy(); this.onMenu(); }
    });
  }

  confetti() {
    const colors = ['#4f46e5', '#16a34a', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];
    for (let i = 0; i < 36; i++) {
      this.fx.appendChild(h('span', {
        class: 'confetti',
        style: {
          left: Math.random() * 100 + '%',
          background: colors[i % colors.length],
          '--d': (Math.random() * 0.6).toFixed(2) + 's',
          '--r': Math.round(Math.random() * 720 - 360) + 'deg',
          '--x': Math.round(Math.random() * 120 - 60) + 'px',
        },
      }));
    }
  }
}
