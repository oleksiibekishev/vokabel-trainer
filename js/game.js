import {
  LEVELS, LEVEL_IDS, ROUND_SIZE, buildTypePlan, pickWords, pickDistractors, makeGaps, primaryForm,
  checkAnswer, closestForm, answerDiff, shuffle, wordFilterFor,
} from './core.js';
import * as store from './store.js';
import { t, tSplit } from './i18n.js';
import { h, icon, levelBars, modal, sfx } from './ui.js';

const BONUS_PAUSE_MS = 900;
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
    this.elRound = h('span', { class: 'game-round' });
    this.elTimerNum = h('span', { class: 'num' }, '0');
    this.elTimer = h('output', { class: 'timer', role: 'timer' }, icon('pause'), this.elTimerNum, h('span', { class: 'unit' }, 's'));
    this.elBarFill = h('div', { class: 'timebar-fill' });
    this.elBar = h('div', { class: 'timebar' }, this.elBarFill);
    this.elDots = h('div', { class: 'dots', 'aria-hidden': 'true' });
    this.elTask = h('h2', { class: 'task-title' });
    this.board = h('main', { class: 'board' });
    this.fx = h('div', { class: 'fx-layer', 'aria-hidden': 'true' });
    this.root.className = 'screen game lv-' + this.level;
    this.root.replaceChildren(
      h('header', { class: 'game-top' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('quitTitle'), onclick: () => this.askQuit() }, icon('close')),
        h('div', { class: 'game-info' },
          h('span', { class: 'game-level' }, levelBars(this.level, 'sm'), t('level_' + this.level)),
          this.elRound),
        this.elTimer),
      this.elBar,
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
    const low = this.timeLeft <= 10000 && !this.ended;
    if (sec !== this.shownSec) {
      this.shownSec = sec;
      this.elTimerNum.textContent = String(sec);
      this.elTimer.setAttribute('aria-label', t('timeLeftAria', { t: sec }));
    }
    this.elTimer.classList.toggle('low', low);
    this.elBar.classList.toggle('low', low);
    const pct = Math.max(0, Math.min(100, (this.timeLeft / (this.cfg.start * 1000)) * 100));
    this.elBarFill.style.width = pct + '%';
  }

  onVisibility() {
    if (document.hidden && !this.ended && !this.destroyed && !this.holds.has('pause')) this.showPause(false);
  }

  showPause(askQuit) {
    this.hold('pause');
    this.root.classList.add('paused');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const opts = askQuit
      ? {
        title: t('quitTitle'),
        body: h('p', { class: 'modal-text' }, t('quitText')),
        buttons: [{ label: t('quit'), value: 'quit', kind: 'danger' }, { label: t('resume'), value: 'resume', kind: 'outline', grow: true }],
      }
      : {
        title: t('pauseTitle'),
        center: true,
        clear: true,
        icon: { name: 'pause', kind: 'accent', extra: 'big' },
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
    this.elDots.classList.toggle('many', this.plan.length > 10);
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
    this.root.classList.toggle('typing-round', KEYBOARD_TYPES.includes(type));
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
    if (this.cfg.bonus > 0) this.flash(h('div', { class: 'bonus-chip' }, '+' + this.cfg.bonus + ' s'), 1400);
    this.startRound();
    this.later(BONUS_PAUSE_MS, () => this.release('bonus'));
  }

  flash(el, ms) {
    this.fx.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  checkFly() {
    this.flash(h('div', { class: 'check-fly' }, icon('check')), 800);
  }

  questionHeader(n, cur, dir) {
    const bars = n > 1
      ? h('div', { class: 'qbars', 'aria-hidden': 'true' },
        Array.from({ length: n }, (_, i) => h('span', { class: i < cur ? 'done' : i === cur ? 'cur' : '' })))
      : null;
    return h('div', { class: 'qrow' + (bars ? '' : ' end') }, bars, h('span', { class: 'dir-chip' }, t(dir === 'de2en' ? 'dirDeEn' : 'dirEnDe')));
  }

  promptCard(field, text, compact) {
    return h('div', { class: 'prompt-card pop' + (compact ? ' compact' : '') },
      h('span', { class: 'label' }, t('label_' + field)),
      h('span', { class: 'word', lang: field }, text));
  }

  // ---------- game: pairs ----------

  renderPairs(words) {
    const make = (w, side) => {
      const el = h('button', { class: 'tile', type: 'button', lang: side, 'data-side': side }, side === 'en' ? w.en : w.de);
      const tile = { el, w, side, done: false };
      el.addEventListener('click', () => this.tapTile(tile));
      return el;
    };
    let grid;
    if (!this.cfg.mixed) {
      const left = shuffle(words.slice()).map((w) => make(w, 'en'));
      const right = shuffle(words.slice()).map((w) => make(w, 'de'));
      const cells = [h('span', { class: 'col-head' }, t('head_en')), h('span', { class: 'col-head' }, t('head_de'))];
      left.forEach((l, i) => cells.push(l, right[i]));
      grid = h('div', { class: 'pairs cols' }, cells);
    } else {
      // Languages are mixed between the columns, but every pair has
      // one word on the left and its partner on the right.
      const half = words.length % 2 && Math.random() < 0.5 ? Math.ceil(words.length / 2) : Math.floor(words.length / 2);
      const enLeft = shuffle(words.map((_, i) => i < half));
      const left = [];
      const right = [];
      words.forEach((w, i) => {
        const en = make(w, 'en');
        const de = make(w, 'de');
        if (enLeft[i]) { left.push(en); right.push(de); } else { left.push(de); right.push(en); }
      });
      shuffle(left);
      shuffle(right);
      const cells = [];
      left.forEach((l, i) => cells.push(l, right[i]));
      grid = h('div', { class: 'pairs grid' }, cells);
    }
    this.board.appendChild(grid);
    this.pairs = { sel: null, left: words.length };
  }

  tapTile(tile) {
    if (this.ended || tile.done || this.holds.has('pause')) return;
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
      if (ps.left === 0) this.finishRound();
    } else {
      for (const x of [sel, tile]) {
        x.el.classList.add('wrong');
        mark(x.el, 'close');
      }
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
        const b = h('button', { class: 'option', type: 'button', lang: af },
          h('span', null, o[af]), icon('check', 'icon-ok'), icon('close', 'icon-bad'));
        b.addEventListener('click', () => pick(o, b, buttons, opts));
        return b;
      });
      wrap.replaceChildren(
        this.questionHeader(qs.length, qi, q.dir),
        this.promptCard(pf, q.w[pf], false),
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
        h('span', { class: 'gapword', lang: 'en', 'aria-hidden': 'true' }, groupEls),
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
        if (this.ended || this.holds.has('pause')) return;
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
          this.fail({ kind: 'gaps', word: it.w, typed, expected: it.target, ids: [it.w.id] });
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
        this.promptCard('de', it.w.de, true),
        box,
        okBtn,
      );
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
      const input = h('input', {
        class: 'spell-input', type: 'text', lang: 'en', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none',
        spellcheck: 'false', enterkeyhint: 'done', placeholder: t('typeHere'), 'aria-label': t('typeHere'),
      });
      const okBtn = h('button', { class: 'btn primary typing-btn', type: 'button' }, t('check'));
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
          else { this.checkFly(); show(); }
        } else {
          input.classList.add('wrong');
          this.fail({ kind: 'spell', word: w, typed: val, expected: closestForm(val, w.en), ids: [w.id] });
        }
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      okBtn.addEventListener('pointerdown', (e) => e.preventDefault());
      okBtn.addEventListener('click', submit);
      wrap.replaceChildren(
        this.questionHeader(words.length, ii, 'de2en'),
        this.promptCard('de', w.de, true),
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
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => {
      if (this.destroyed) return;
      this.root.classList.remove('shake');
      this.showEndModal({
        title: t('wrongTitle'),
        cls: 'modal-fail',
        icon: { name: 'close', kind: 'err' },
        body: h('div', { class: 'modal-body' }, this.failBody(info), h('p', { class: 'encourage' }, t('wrongSub'))),
      });
    }, reduce ? 0 : 800);
  }

  okRow(enWord, deWord, cls) {
    return h('div', { class: 'res-row good ' + cls },
      icon('check'),
      h('span', null, h('b', { lang: 'en' }, enWord), ' = ', h('span', { lang: 'de' }, deWord)));
  }

  failBody(info) {
    if (info.kind === 'pairs') {
      return h('div', { class: 'modal-body' },
        h('div', { class: 'fail-group' },
          h('span', { class: 'fail-label' }, t('wrongPair')),
          h('div', { class: 'res-row bad' }, icon('close'),
            h('s', null, h('span', { lang: 'en' }, info.en.en), ' ≠ ', h('span', { lang: 'de' }, info.de.de)))),
        h('div', { class: 'fail-group' },
          h('span', { class: 'fail-label' }, t('correctPairs')),
          this.okRow(info.en.en, info.en.de, 'd1'),
          this.okRow(info.de.en, info.de.de, 'd2')));
    }
    if (info.kind === 'choice') {
      const af = info.dir === 'de2en' ? 'en' : 'de';
      const pf = info.dir === 'de2en' ? 'de' : 'en';
      return h('div', { class: 'modal-body' },
        h('div', { class: 'prompt-box' }, h('span', { class: 'label' }, t('label_' + pf)), h('span', { class: 'word', lang: pf }, info.word[pf])),
        h('div', { class: 'fail-group' },
          h('div', { class: 'answer-block bad' },
            h('span', { class: 'fail-label' }, t('yourChoice')),
            h('span', { class: 'val' }, icon('close'), h('s', { lang: af }, info.chosen[af]))),
          h('div', { class: 'answer-block good' },
            h('span', { class: 'fail-label' }, t('correctAnswer')),
            h('span', { class: 'val' }, icon('check'), h('span', { lang: af }, info.word[af])))));
    }
    return h('div', { class: 'modal-body' },
      h('div', { class: 'prompt-box' }, h('span', { class: 'label' }, t('label_de')), h('span', { class: 'word', lang: 'de' }, info.word.de)),
      this.diffView(info.typed, info.expected),
      h('p', { class: 'answer-line' }, h('span', { lang: 'de' }, info.word.de), ' = ', h('b', { lang: 'en' }, info.word.en)));
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
        h('span', { class: 'diff-text', lang: 'en', 'aria-hidden': 'true' }, row(top))),
      h('div', { class: 'diff-row correct', role: 'group', 'aria-label': t('expected') + ': ' + expected },
        h('span', { class: 'diff-label' }, icon('check'), t('expected')),
        h('span', { class: 'diff-text', lang: 'en', 'aria-hidden': 'true' }, row(bot))));
  }

  timeUp() {
    if (this.ended) return;
    this.endRun();
    sfx.bad();
    store.recordResult(this.list.id, this.level, { completed: false, timeLeft: 0, round: this.roundIdx + 1 });
    const [pre, bold, post] = tSplit('timeUpSub', { round: t('roundOf', { r: this.roundIdx + 1, n: this.cfg.rounds }) }, 'round');
    this.showEndModal({
      title: t('timeUpTitle'),
      cls: 'modal-fail',
      icon: { name: 'hourglass', kind: 'accent' },
      body: h('div', { class: 'modal-body' },
        h('p', { class: 'modal-text', style: { color: 'var(--text)' } }, pre, h('b', null, bold), post),
        h('div', { class: 'recap' }, this.roundWords.map((w) => h('div', null,
          h('span', { lang: 'en' }, w.en), h('span', { lang: 'de' }, w.de))))),
    });
  }

  levelDone() {
    this.endRun();
    sfx.win();
    const secs = Math.ceil(this.timeLeft / 1000);
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
    lines.push(h('p', { class: 'modal-text new-words' }, t('newFixed')));
    if (!next) lines.push(h('p', { class: 'modal-text' }, t('allDone')));
    const buttons = next
      ? [
        [{ label: t('nextLevel', { level: t('level_' + next) }), value: 'next', kind: 'primary', tall: true, icon: 'arrowRight' }],
        [{ label: t('menu'), value: 'menu', kind: 'outline' }, { label: t('again'), value: 'again', kind: 'outline' }],
      ]
      : [{ label: t('menu'), value: 'menu', kind: 'outline' }, { label: t('again'), value: 'again', kind: 'primary', grow: true }];
    this.showEndModal({ title: t('doneTitle'), icon: { name: 'check', kind: 'ok' }, center: true, body: lines, buttons, next, cls: 'modal-win' });
  }

  showEndModal({ title, body, icon: ic, center = false, buttons, next, cls = '' }) {
    const btns = buttons || [{ label: t('menu'), value: 'menu', kind: 'outline' }, { label: t('again'), value: 'again', kind: 'primary', grow: true }];
    modal({ title, icon: ic, body, buttons: btns, center, cls: 'modal-end ' + cls }).then((v) => {
      if (this.destroyed) return;
      if (v === 'again') this.start();
      else if (v === 'next') this.onNextLevel(next);
      else { this.destroy(); this.onMenu(); }
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
