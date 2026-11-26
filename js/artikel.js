// Artikel mode: der, die or das for the nouns of the current list. 12 nouns per round, no timer,
// a mistake does not end the round. Nouns with mistakes come first next time.
// Same outside shape as Game (start, destroy, holdFor, askQuit, ended/destroyed) for main.js.

import { ARTICLES, ARTICLE_SESSION, articleItems, articleSession, displayForms } from './core.js';
import * as store from './store.js';
import { t, tDays } from './i18n.js';
import { h, icon, modal, sfx } from './ui.js';

const RIGHT_MS = 650;
const WRONG_MS = 1500;

export class ArticleGame {
  constructor({ root, list, onMenu }) {
    this.root = root;
    this.list = list;
    this.onMenu = onMenu;
    this.ended = true;
    this.destroyed = false;
    this.timer = null;
    this.buildShell();
    if (typeof window !== 'undefined' && window.__vtMods !== undefined) window.__vtGame = this;
  }

  holdFor() { /* no timer here */ }

  buildShell() {
    this.elRound = h('span', { class: 'game-round' });
    this.elStreak = h('span', { class: 'art-streak', hidden: true }, icon('kombo'), h('span'));
    this.elBar = h('div', { class: 'art-bar', role: 'progressbar', 'aria-valuemin': '0' }, h('i'));
    this.board = h('main', { class: 'board board-artikel' });
    this.fx = h('div', { class: 'fx-layer', 'aria-hidden': 'true' });
    this.root.className = 'screen game lv-artikel no-timer';
    this.root.replaceChildren(
      h('header', { class: 'game-top' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('quitTitle'), onclick: () => this.askQuit() }, icon('close')),
        h('div', { class: 'game-info' },
          h('span', { class: 'game-level' }, icon('artikel', 'mode-icon'), t('level_artikel')),
          h('span', { class: 'round-line' }, this.elRound)),
        this.elStreak),
      this.elBar,
      h('div', { class: 'task-row' }, h('h2', { class: 'task-title' }, t('artikelTask'))),
      this.board,
      this.fx,
    );
  }

  /** keys: only these nouns ("Fehler wiederholen"); otherwise a new round. */
  start(keys = null) {
    clearTimeout(this.timer);
    const items = articleItems(this.list.words);
    const miss = store.articleData(this.list.id).miss;
    this.items = keys ? articleSession(items.filter((it) => keys.includes(it.key)), {}, keys.length) : articleSession(items, miss, ARTICLE_SESSION);
    this.i = 0;
    this.right = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.wrong = [];
    this.ended = false;
    this.locked = false;
    this.renderStreak();
    this.show();
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
  }

  renderProgress() {
    const n = this.items.length;
    this.elRound.textContent = t('artikelProgress', { i: Math.min(this.i + 1, n), n });
    this.elBar.firstChild.style.transform = 'scaleX(' + (this.i / n).toFixed(4) + ')';
    this.elBar.setAttribute('aria-valuemax', String(n));
    this.elBar.setAttribute('aria-valuenow', String(this.i));
  }

  renderStreak(pop = false) {
    const show = this.streak >= 2;
    this.elStreak.hidden = !show;
    if (!show) return;
    this.elStreak.lastChild.textContent = t('artikelStreak', { n: this.streak });
    if (pop) { this.elStreak.classList.remove('pop'); void this.elStreak.offsetWidth; this.elStreak.classList.add('pop'); }
  }

  show() {
    const it = this.items[this.i];
    this.renderProgress();
    const en = displayForms(it.w.en)[0] || it.w.en;
    this.elWord = h('span', { class: 'word art-word', lang: 'de' }, h('span', { class: 'art-the' }), ' ', h('span', null, it.noun));
    const card = h('div', { class: 'prompt-card pop art-card' },
      h('span', { class: 'label' }, t('label_de')),
      this.elWord,
      h('span', { class: 'art-hint', lang: 'en', 'aria-label': t('artikelHintAria', { w: en }) }, en));
    this.buttons = ARTICLES.map((a) => h('button', {
      class: 'art-btn art-' + a, type: 'button', lang: 'de', onclick: () => this.answer(a),
    }, a));
    this.board.replaceChildren(card, h('div', { class: 'art-options', role: 'group', 'aria-label': t('artikelTask') }, this.buttons));
    this.locked = false;
  }

  answer(a) {
    if (this.locked || this.ended || this.destroyed) return;
    this.locked = true;
    const it = this.items[this.i];
    const ok = a === it.article;
    const btn = this.buttons[ARTICLES.indexOf(a)];
    const rightBtn = this.buttons[ARTICLES.indexOf(it.article)];
    this.buttons.forEach((b) => { b.disabled = true; });
    this.elWord.firstChild.textContent = it.article;
    this.elWord.classList.add('shown', 'art-' + it.article);
    store.articleAnswer(this.list.id, it.key, ok);
    if (ok) {
      btn.classList.add('right');
      sfx.good();
      this.right++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.renderStreak(true);
    } else {
      btn.classList.add('wrong');
      rightBtn.classList.add('right', 'reveal');
      sfx.bump();
      if (!this.wrong.includes(it)) this.wrong.push(it);
      this.streak = 0;
      this.renderStreak();
    }
    this.timer = setTimeout(() => {
      if (this.destroyed) return;
      this.i++;
      if (this.i >= this.items.length) this.done();
      else this.show();
    }, ok ? RIGHT_MS : WRONG_MS);
  }

  done() {
    this.ended = true;
    this.renderProgress();
    const n = this.items.length;
    const res = store.articleResult(this.list.id, { right: this.right, total: n, streak: this.bestStreak });
    const st = store.countToday();
    const all = this.right === n;
    if (all) sfx.win(); else sfx.round();
    const wrongKeys = this.wrong.map((it) => it.key);
    const body = h('div', { class: 'modal-body' },
      h('div', { class: 'endless-sum' },
        h('span', { class: 'eyebrow' }, t('artikelRightLabel')),
        h('span', { class: 'big-number' }, String(this.right), h('span', { class: 'art-of' }, ' ' + t('artikelOf', { n }))),
        res.newBest
          ? h('span', { class: 'record-chip late' }, icon('star'), t('artikelNewBest'))
          : this.bestStreak >= 2 ? h('p', { class: 'modal-text' }, t('artikelBest', { n: this.bestStreak })) : null),
      this.wrong.length ? h('div', { class: 'art-wrong' },
        h('p', { class: 'art-wrong-head' }, t('artikelWrongHead')),
        this.wrong.map((it) => h('div', { class: 'art-wrong-row' },
          h('span', { lang: 'de' }, h('b', { class: 'art-' + it.article }, it.article), ' ' + it.noun),
          h('span', { class: 'art-wrong-en', lang: 'en' }, displayForms(it.w.en)[0] || it.w.en)))) : null,
      st.plus ? h('div', { class: 'st-chip-row' }, h('span', { class: 'st-chip' }, icon('streak'),
        t('streakChip') + ' ', h('b', null, st.n + ' ' + tDays(st.n)), h('span', { class: 'st-plus' }, '+1'))) : null);
    const buttons = [[{ label: t('menu'), value: 'menu', kind: 'outline' }, { label: t('again'), value: 'again', kind: 'primary', grow: true }]];
    if (wrongKeys.length) buttons.push([{ label: t('artikelRetry', { n: wrongKeys.length }), value: 'retry', kind: 'text', iconLeft: 'reset' }]);
    modal({
      title: all ? t('artikelAllRight') : t('artikelDoneTitle'),
      icon: { name: all ? 'check' : 'artikel', kind: all ? 'ok' : 'accent', extra: 'big' },
      center: true,
      body,
      buttons,
      cls: 'modal-end ' + (all ? 'modal-win' : ''),
    }).then((v) => {
      if (this.destroyed) return;
      if (v === 'again' || v === 'retry') {
        this.root.classList.remove('tr-show');
        void this.root.offsetWidth;
        this.root.classList.add('tr-show');
        setTimeout(() => this.root.classList.remove('tr-show'), 300);
        this.start(v === 'retry' ? wrongKeys : null);
      } else {
        this.destroy();
        this.onMenu();
      }
    });
  }

  askQuit() {
    if (this.destroyed) return;
    if (this.ended) { this.destroy(); this.onMenu(); return; }
    if (this.quitOpen) return;
    this.quitOpen = true;
    modal({
      title: t('quitTitle'),
      body: h('div', { class: 'modal-body' }, h('p', { class: 'modal-text' }, t('artikelQuitText'))),
      buttons: [{ label: t('quit'), value: 'quit', kind: 'danger' }, { label: t('resume'), value: 'resume', kind: 'outline', grow: true }],
    }).then((v) => {
      this.quitOpen = false;
      if (this.destroyed) return;
      if (v === 'quit') { this.destroy(); this.onMenu(); }
    });
  }
}
