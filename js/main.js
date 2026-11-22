import * as store from './store.js';
import { t, tList, tSplit, setLang, detectLang, LANGS, getLang } from './i18n.js';
import { h, icon, logo, levelBars, toast, modal, confirmDialog, sfx, dimStatusBar, closeAllModals } from './ui.js';
import {
  LEVELS, LEVEL_IDS, MIN_WORDS, parseWordList, encodeData, decodeData, listToShare, listFromShare, listIdFor,
} from './core.js';
import { Game } from './game.js';
import * as streakUI from './streak.js';

export const APP_VERSION = '1.8.0';

const app = document.getElementById('app');
let game = null;
let deferredInstall = null;
let updateWaiting = false;

// ---------- screens and transitions ----------
// #app shows the start screen or a game. Lists, the new-list form and the settings open as
// sheets from the bottom over the (receding, dimmed) start screen. A game fades in and out.

const SHEETS = { lists: () => renderLists(), addList: () => renderAddList(), settings: () => renderSettings() };
const sheets = []; // open sheets, bottom to top: { name, layer, dim, under }
let base = 'home'; // 'home' | 'game'
let homeScroll = 0;
let homeView = null; // { view, card, chip } – streak animations play once the start screen is visible
let levelsBefore = null; // level states before a game, to animate what changed

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ms = (x) => (reduced() ? 0 : x);
function busy(on) { document.documentElement.classList.toggle('busy', on); }

/** The elements of a screen come in one after another. */
function cascade(el, cls, step = 40) {
  [...el.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i, 10)));
  el.classList.add(cls, 'tr-build');
  const n = Math.min(el.children.length, 10);
  setTimeout(() => el.classList.remove(cls, 'tr-build'), 120 + n * step + 320);
  return 120 + n * step + 120;
}

// transitions run one after another
let queue = Promise.resolve();
function show(name, arg) {
  queue = queue.then(() => doShow(name, arg)).catch((e) => { console.error(e); busy(false); });
  return queue;
}

async function doShow(name, arg) {
  closeAllModals();
  if (name === 'home' && streakUI.calendarIsOpen()) { await streakUI.closeCalendar(); return; }
  if (name === 'game') { await startGame(arg); return; }
  if (SHEETS[name]) {
    const idx = sheets.findIndex((x) => x.name === name);
    if (idx >= 0 && idx === sheets.length - 1) { refreshSheet(sheets[idx]); return; }
    if (idx >= 0) { refreshSheet(sheets[idx]); await closeSheets(idx + 1); return; }
    if (base === 'game') { if (game) { game.destroy(); game = null; } base = 'home'; refreshHome(); }
    await openSheet(name);
    return;
  }
  // start screen
  if (sheets.length) { refreshHome(); await closeSheets(0); return; }
  if (base === 'game') { await returnToMenu(); return; }
  refreshHome();
  setTimeout(applyUpdateIfIdle, 300);
}

function refreshHome() {
  const y = window.scrollY;
  app.replaceChildren(renderHome());
  window.scrollTo(0, y);
}

function refreshSheet(sh) {
  sh.layer.firstElementChild.replaceChildren(SHEETS[sh.name]());
}

async function openSheet(name) {
  const under = sheets.length ? sheets[sheets.length - 1].layer : app;
  if (under === app) app.style.setProperty('--sy', window.scrollY + 'px');
  const dim = h('div', { class: 'sheet-dim in' });
  const layer = h('div', { class: 'sheet sheet-in', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'sheet-inner' }, SHEETS[name]()));
  const title = layer.querySelector('h1');
  if (title) layer.setAttribute('aria-label', title.textContent);
  under.classList.remove('return');
  under.classList.add('recede');
  document.body.append(dim, layer);
  document.documentElement.classList.add('locked');
  dimStatusBar('sheet-' + name, true);
  sheets.push({ name, layer, dim, under });
  busy(true);
  await wait(ms(420));
  busy(false);
  layer.classList.remove('sheet-in');
}

async function closeSheets(keep) {
  while (sheets.length > keep) {
    const sh = sheets.pop();
    sh.dim.classList.remove('in');
    sh.dim.classList.add('out');
    sh.under.classList.remove('recede');
    sh.under.classList.add('return');
    sh.layer.classList.add('sheet-out');
    dimStatusBar('sheet-' + sh.name, false);
    busy(true);
    await wait(ms(320));
    busy(false);
    sh.layer.remove();
    sh.dim.remove();
    sh.under.classList.remove('return');
  }
  if (!sheets.length) {
    document.documentElement.classList.remove('locked');
    if (base === 'home') {
      playHomeAnims();
      setTimeout(applyUpdateIfIdle, 300);
    }
  }
}

function levelStates(list) {
  if (!list) return null;
  const st = {};
  for (const lvl of LEVEL_IDS) st[lvl] = !store.isUnlocked(list.id, lvl) ? 'locked' : store.levelProgress(list.id, lvl).completed ? 'done' : 'open';
  st.endless = store.endlessUnlocked() ? 'open' : 'locked';
  return st;
}

/** Start a game: the start screen fades out, the game fades in, its parts one after another. */
async function startGame({ level, focus = [], fromGame = false, forceMods = null } = {}) {
  const list = store.currentList();
  const allowed = list && list.words.length >= MIN_WORDS && (
    level === 'endless' ? store.endlessUnlocked()
      : level === 'training' ? store.mistakeWords(list.id, list.words).length > 0
        : LEVEL_IDS.includes(level) && store.isUnlocked(list.id, level));
  if (!allowed) { await doShow('home'); return; }
  busy(true);
  if (sheets.length) {
    sheets.splice(0).forEach((sh) => { sh.layer.remove(); sh.dim.remove(); dimStatusBar('sheet-' + sh.name, false); });
    document.documentElement.classList.remove('locked');
    app.classList.remove('recede', 'return');
  }
  if (base === 'home') {
    homeScroll = window.scrollY;
    levelsBefore = levelStates(list);
    const old = app.firstElementChild;
    if (old && !reduced()) { old.classList.add('tr-c-out'); await wait(150); }
  }
  if (game) game.destroy();
  base = 'game';
  const root = h('div', { class: 'screen game' });
  app.replaceChildren(root);
  window.scrollTo(0, 0);
  game = new Game({
    root, list, level, focus, forceMods,
    onMenu: () => { game = null; goBack(); },
    onNextLevel: (lvl) => show('game', { level: lvl, fromGame: true }),
    onTrain: (ids) => show('game', { level: 'training', focus: ids, fromGame: true }),
  });
  game.start();
  if (!reduced()) {
    if (fromGame) {
      root.classList.add('tr-show');
      setTimeout(() => root.classList.remove('tr-show'), 300);
    } else {
      game.holdFor(cascade(root, 'tr-c-in'));
    }
  }
  busy(false);
}

/** Back from a game: it fades out, the start screen comes back where it was, then the news is shown. */
async function returnToMenu() {
  if (game) { game.destroy(); game = null; }
  busy(true);
  const old = app.firstElementChild;
  if (old && !reduced()) { old.classList.add('tr-c-out-back'); await wait(150); }
  base = 'home';
  app.replaceChildren(renderHome());
  window.scrollTo(0, homeScroll);
  const home = app.firstElementChild;
  if (!reduced()) await wait(cascade(home, 'tr-c-in-back'));
  busy(false);
  await playHomeAnims();
  setTimeout(applyUpdateIfIdle, 300);
}

/** After a game: a passed level, a new level, the Tagesserie +1 (or a broken streak). */
async function playHomeAnims() {
  const hv = homeView;
  if (!hv || !hv.home.isConnected) return;
  const before = levelsBefore;
  levelsBefore = null;
  const now = levelStates(store.currentList());
  if (before && now) {
    let changed = false;
    for (const k of Object.keys(now)) {
      if (now[k] === before[k]) continue;
      const card = hv.home.querySelector(k === 'endless' ? '.mode-card.mode-endless' : '.level-card.level-' + k);
      if (!card) continue;
      changed = true;
      if (before[k] === 'locked') {
        card.classList.add('unlock-anim');
        const pill = card.querySelector('.play-pill');
        if (pill) pill.classList.add('pop-anim');
      }
      const status = card.querySelector('.level-status, .mode-status');
      if (status) status.classList.add('swap');
    }
    if (changed) await wait(ms(260));
  }
  if (hv.view.anim) await streakUI.playStreakAnim(hv.view, hv.card, hv.chip);
}

function navigate(name, arg) {
  history.pushState({ screen: name }, '');
  show(name, arg);
}

function goBack() {
  if (history.state && history.state.screen && history.state.screen !== 'home') history.back();
  else if (history.state && history.state.cal) history.back();
  else show('home');
}

window.addEventListener('popstate', () => {
  if (game && !game.ended && !game.destroyed) {
    history.pushState({ screen: 'game' }, '');
    game.askQuit();
    return;
  }
  const screen = (history.state && history.state.screen) || 'home';
  if (streakUI.calendarIsOpen() && !(history.state && history.state.cal)) { streakUI.closeCalendar(); return; }
  if (screen === 'game') {
    history.replaceState({ screen: 'home' }, '');
    show('home');
    return;
  }
  show(screen);
});

function openCalendar(card) {
  if (!card || streakUI.calendarIsOpen() || document.documentElement.classList.contains('busy')) return;
  history.pushState({ screen: 'home', cal: true }, '');
  streakUI.openCalendar(card, { setBusy: busy, onRequestClose: () => history.back() });
}

function topbar(title) {
  return h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('back'), onclick: goBack }, icon('chevronDown')),
    h('h1', { class: 'topbar-title' }, title));
}

// ---------- home ----------

function renderHome() {
  const list = store.currentList();
  const wrap = h('div', { class: 'screen home' });
  const view = streakUI.streakView();
  const open = () => openCalendar(homeView && homeView.card);
  const chip = streakUI.streakChip(view, open);
  const head = h('header', { class: 'topbar home-top' },
    logo(),
    h('div', { class: 'brand' }, h('h1', null, t('appName')), h('p', null, t('tagline'))),
    chip,
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('settings'), onclick: () => navigate('settings') }, icon('gear')));
  wrap.appendChild(head);
  const card = streakUI.streakCard(view, open);
  homeView = { view, card, chip, home: wrap };

  const banner = installBanner();
  if (banner) wrap.appendChild(banner);
  wrap.appendChild(card);

  if (!list) {
    wrap.appendChild(h('div', { class: 'empty-card' },
      h('span', { class: 'icon-tile', 'aria-hidden': 'true' }, icon('list')),
      h('span', { class: 'serif' }, t('emptyLists')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => navigate('addList') }, icon('listPlus'), t('addList'))));
    return wrap;
  }

  wrap.appendChild(h('section', { class: 'card list-card' },
    h('div', { class: 'eyebrow' }, t('currentList')),
    h('div', { class: 'list-name' }, list.name),
    h('div', { class: 'count' }, t('wordsN', { n: list.words.length })),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn outline', type: 'button', onclick: () => navigate('lists') }, icon('book'), t('listsAndWords')))));

  const enough = list.words.length >= MIN_WORDS;
  if (!enough) {
    wrap.appendChild(h('div', { class: 'notice-err', role: 'alert' }, icon('alert'),
      h('span', null, t('listTooSmall', { n: list.words.length, min: MIN_WORDS }))));
  }
  const rules = h('details', { class: 'rules', open: !store.settings().rulesClosed },
    h('summary', null, t('rulesTitle'), icon('chevronDown')),
    h('ol', null, tList('rules').map((r, i) => h('li', null, h('span', { class: 'num' }, String(i + 1)), h('span', null, r)))),
    legend());
  rules.addEventListener('toggle', () => store.setSetting('rulesClosed', !rules.open));
  wrap.appendChild(rules);
  wrap.appendChild(h('div', { class: 'levels' }, LEVEL_IDS.map((lvl) => levelCard(list, lvl, enough))));
  wrap.appendChild(modesSection(list, enough));
  return wrap;
}

/** Endlos and Fehlertraining below the levels. */
function modesSection(list, enough) {
  const endlessOpen = store.endlessUnlocked();
  const ep = store.endlessProgress(list.id);
  const mistakes = store.mistakeWords(list.id, list.words).length;
  const card = ({ id, playable, desc, status, statusCls, play, badge }) => h('button', {
    class: 'mode-card mode-' + id + (playable ? '' : ' locked'),
    type: 'button',
    disabled: !playable,
    onclick: () => { sfx.unlock(); navigate('game', { level: id }); },
  },
  h('span', { class: 'mode-head' },
    h('span', { class: 'mode-icon-tile', 'aria-hidden': 'true' }, icon(id), badge ? h('span', { class: 'mode-badge' }, badge) : null),
    h('span', { class: 'mode-titles' },
      h('span', { class: 'mode-name' }, t('level_' + id)),
      h('span', { class: 'mode-desc' }, desc))),
  h('span', { class: 'mode-foot' },
    h('span', { class: 'mode-status ' + statusCls }, status),
    playable ? h('span', { class: 'play-pill' }, icon('play'), play) : null));
  let endlessStatus;
  if (!endlessOpen) endlessStatus = { status: [icon('lock'), t('endlessLocked')], statusCls: 'locked' };
  else if (ep.best > 0) endlessStatus = { status: [icon('star'), ep.best === 1 ? t('endlessBestOne') : t('endlessBest', { n: ep.best })], statusCls: 'best' };
  else endlessStatus = { status: t('notPlayed'), statusCls: 'fresh' };
  return h('section', { class: 'modes', 'aria-label': t('moreModes') },
    h('h2', { class: 'modes-title' }, t('moreModes')),
    card({ id: 'endless', playable: endlessOpen && enough, desc: t('endlessMeta'), play: t('play'), ...endlessStatus }),
    card({
      id: 'training',
      playable: mistakes > 0 && enough,
      desc: t('trainingMeta'),
      status: mistakes === 0 ? t('trainingEmpty') : mistakes === 1 ? t('trainingCountOne') : t('trainingCount', { n: mistakes }),
      statusCls: mistakes ? 'best' : 'fresh',
      play: t('practice'),
      badge: mistakes > 0 ? String(mistakes) : null,
    }));
}

/** Special rounds, Extrazeit and the time limit, each with its icon (in "So funktioniert's"). */
function legend() {
  const item = (cls, ic, name, text) => h('li', null,
    h('span', { class: 'legend-icon ' + cls, 'aria-hidden': 'true' }, icon(ic)),
    h('span', null, h('b', null, name), ' – ' + text));
  return h('div', { class: 'legend' },
    h('div', { class: 'legend-head' },
      h('span', { class: 'legend-title' }, t('specialRounds')),
      h('span', { class: 'legend-hint' }, h('span', { class: 'dot has-mod done', 'aria-hidden': 'true' }), t('specialHint'))),
    h('ul', null,
      item('mod-wirbel', 'wirbel', t('mod_wirbel'), t('legend_wirbel')),
      item('mod-kombo', 'kombo', t('mod_kombo'), t('legend_kombo')),
      item('mod-zeitraffer', 'zeitraffer', t('mod_zeitraffer'), t('legend_zeitraffer')),
      store.settings().zeitbombe !== false ? item('mod-zeitbombe', 'zeitbombe', t('mod_zeitbombe'), t('legend_zeitbombe')) : null,
      item('tone-extra', 'extra', t('extraTime'), t('legend_extra')),
      item('', 'limit', t('limitName'), t('legend_limit'))));
}

function levelCard(list, level, enough) {
  const L = LEVELS[level];
  const tm = store.timing(level);
  const levelOpen = store.isUnlocked(list.id, level);
  const playable = levelOpen && enough;
  const p = store.levelProgress(list.id, level);
  const types = ['pairs', 'choice', 'gaps', 'spell'].filter((ty) => L.fixed.includes(ty) || L.pool.includes(ty));
  let status;
  if (!levelOpen) {
    const prev = LEVEL_IDS[LEVEL_IDS.indexOf(level) - 1];
    status = h('span', { class: 'level-status locked' }, icon('lock'), h('span', null, t('lockedHint', { prev: t('level_' + prev) })));
  } else if (p.completed) {
    status = h('span', { class: 'level-status ok' }, icon('check'), h('span', null, t('completedBest', { t: p.bestTimeLeft ?? 0 })));
  } else if (p.plays) {
    status = h('span', { class: 'level-status best' }, h('span', null, t('bestRound', { r: p.bestRound, n: L.rounds })));
  } else {
    status = h('span', { class: 'level-status fresh' }, h('span', null, t('notPlayed')));
  }
  const lockIcon = icon('lock', 'lock-icon');
  lockIcon.setAttribute('role', 'img');
  lockIcon.setAttribute('aria-label', t('locked'));
  lockIcon.removeAttribute('aria-hidden');
  return h('button', {
    class: 'level-card level-' + level + (playable ? '' : ' locked'),
    type: 'button',
    disabled: !playable,
    onclick: () => { sfx.unlock(); navigate('game', { level }); },
  },
  h('span', { class: 'level-head' },
    levelBars(level),
    h('span', { class: 'level-name' }, t('level_' + level)),
    playable ? h('span', { class: 'play-pill' }, icon('play'), t('play')) : lockIcon),
  h('span', { class: 'level-meta' }, t('levelMeta', { rounds: L.rounds, start: tm.start, bonus: tm.bonus, cap: tm.cap })),
  h('span', { class: 'chips' }, types.map((ty) => h('span', { class: 'chip' }, t('type_' + ty)))),
  status);
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

function installBanner() {
  if (isStandalone()) return null;
  if (deferredInstall) {
    return h('div', { class: 'card install-card' },
      icon('download'),
      h('span', null, t('installAndroid')),
      h('button', {
        class: 'btn primary small', type: 'button',
        onclick: async () => {
          const p = deferredInstall;
          deferredInstall = null;
          p.prompt();
          try { await p.userChoice; } catch { /* ignore */ }
          show('home');
        },
      }, t('install')));
  }
  if (isIos() && !store.settings().iosHintDismissed) {
    return h('div', { class: 'banner' },
      icon('iosShare'),
      h('p', null, t('installIos')),
      h('button', {
        class: 'icon-btn', type: 'button', 'aria-label': t('dismiss'),
        onclick: (e) => { store.setSetting('iosHintDismissed', true); e.currentTarget.closest('.banner').remove(); },
      }, icon('close')));
  }
  return null;
}

// ---------- lists & words ----------

function renderLists() {
  const wrap = h('div', { class: 'screen' }, topbar(t('lists')));
  const addBtn = h('button', { class: 'btn outline add-list-btn', type: 'button', onclick: () => navigate('addList') }, icon('listPlus'), t('addList'));
  const cur = store.currentList();
  const all = store.lists();
  if (!all.length) {
    wrap.appendChild(h('div', { class: 'info-dashed' }, icon('info'), t('emptyLists')));
    wrap.appendChild(addBtn);
    return wrap;
  }
  wrap.appendChild(h('section', { class: 'card list-rows', 'aria-label': t('chooseList') }, all.map((l) => {
    const active = cur && cur.id === l.id;
    return h('div', { class: 'list-row' + (active ? ' active' : '') },
      h('button', {
        class: 'list-main', type: 'button', 'aria-pressed': String(!!active),
        onclick: () => { store.selectList(l.id); show('lists'); },
      },
      h('span', { class: 'list-title' }, l.name, active ? h('span', { class: 'badge' }, t('active')) : null),
      h('span', { class: 'list-count' }, t('wordsN', { n: l.words.length }))),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('shareList', { name: l.name }), onclick: () => shareList(l) }, icon('share')),
      h('button', {
        class: 'icon-btn err', type: 'button', 'aria-label': t('deleteList', { name: l.name }),
        onclick: async () => {
          if (await confirmDialog(t('deleteListTitle'), t('deleteListText', { name: l.name }), t('delete'), { danger: true })) {
            store.deleteList(l.id);
            show('lists');
          }
        },
      }, icon('trash')));
  })));
  wrap.appendChild(addBtn);
  if (cur) wrap.appendChild(wordsSection(cur));
  return wrap;
}

function wordsSection(list) {
  const st = store.stats(list.id);
  const mk = (id) => (st[id] ? st[id].w || 0 : 0);
  // always hardest first (most mistakes); words without mistakes keep the list order
  const words = list.words.slice().sort((a, b) => mk(b.id) - mk(a.id));
  return h('section', { class: 'stack words-section' },
    h('div', { class: 'section-head' },
      h('h2', null, t('wordsIn', { name: list.name })),
      h('span', { class: 'list-count' }, t('wordsN', { n: list.words.length }) + ' · ' + t('sortHard'))),
    !words.some((w) => mk(w.id) > 0) ? h('div', { class: 'info-dashed' }, icon('info'), t('noMistakes')) : null,
    h('div', { class: 'word-table' },
      h('div', { class: 'word-table-head' }, h('span', null, t('wordsHead')), h('span', null, t('mistakesHead'))),
      words.map((w) => h('div', { class: 'word-row' },
        h('div', { class: 'words' }, h('span', { class: 'w-en', lang: 'en' }, w.en), h('span', { class: 'w-de', lang: 'de' }, w.de)),
        mk(w.id)
          ? h('span', { class: 'miss' }, icon('close'), String(mk(w.id)))
          : h('span', { class: 'miss none', 'aria-label': t('noMistakesAria') }, '–')))));
}

function renderAddList() {
  const wrap = h('div', { class: 'screen' }, topbar(t('newList')));
  const nameInput = h('input', { class: 'field', id: 'list-name', type: 'text', maxlength: '60', placeholder: t('namePlaceholder'), required: true, autocomplete: 'off' });
  const area = h('textarea', { class: 'field area', id: 'list-text', rows: '8', placeholder: t('pastePlaceholder'), spellcheck: 'false' });
  const preview = h('div', { class: 'preview', hidden: true });
  const fileInput = h('input', { type: 'file', accept: '.txt,.csv,.tsv,text/plain,text/csv', class: 'sr-only', id: 'file-in' });
  const nameHint = h('p', { class: 'field-error', hidden: true }, icon('alert'), t('nameRequired'));
  const saveBtn = h('button', { class: 'btn primary tall', type: 'button', disabled: true }, t('saveList'));

  const refresh = () => {
    const r = parseWordList(area.value);
    const wordsOk = r.words.length >= MIN_WORDS;
    const named = nameInput.value.trim().length > 0;
    saveBtn.disabled = !(wordsOk && named);
    nameHint.hidden = named || !area.value.trim();
    nameInput.classList.toggle('invalid', !named && !!area.value.trim());
    preview.hidden = !area.value.trim();
    if (preview.hidden) { preview.replaceChildren(); return; }
    preview.replaceChildren(...[
      wordsOk
        ? h('div', { class: 'preview-status ok' }, icon('check'), t('recognized', { n: r.words.length }))
        : h('div', { class: 'preview-status err' }, icon('alert'), t('tooFew', { n: MIN_WORDS })),
      r.words.length ? h('div', { class: 'pair-mini' }, r.words.slice(0, 4).map((w) => h('div', null,
        h('span', { lang: 'en' }, w.en), h('span', { lang: 'de' }, w.de)))) : null,
      r.skipped.length ? h('details', { class: 'skipped' },
        h('summary', null, r.skipped.length === 1 ? t('skippedOne') : t('skippedLines', { n: r.skipped.length }), icon('chevronDown')),
        r.skipped.slice(0, 20).map((x) => h('div', null, x))) : null,
    ].filter(Boolean));
  };
  area.addEventListener('input', refresh);
  nameInput.addEventListener('input', refresh);
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    area.value = await f.text();
    refresh();
  });
  saveBtn.addEventListener('click', () => {
    const r = parseWordList(area.value);
    const name = nameInput.value.trim();
    if (r.words.length < MIN_WORDS || !name) return;
    const id = listIdFor(r.words);
    if (store.get().lists[id]) {
      store.selectList(id);
      toast(t('listExists'));
    } else {
      store.addList({ id, name, words: r.words, builtin: false });
      toast(t('listSaved'), { icon: 'check' });
    }
    goBack();
  });

  wrap.appendChild(h('section', { class: 'card stack' },
    h('div', { class: 'field-group' },
      h('label', { class: 'field-label', for: 'list-name' }, t('listName')),
      nameInput,
      nameHint),
    h('div', { class: 'field-group' },
      h('label', { class: 'field-label', for: 'list-text' }, t('pasteWords')),
      area,
      h('p', { class: 'hint-small' }, t('formatHint'))),
    h('label', { class: 'btn outline', for: 'file-in' }, icon('upload'), t('orFile')),
    fileInput,
    preview,
    saveBtn));
  return wrap;
}

async function shareList(list) {
  const code = await encodeData(listToShare(list));
  const url = location.origin + location.pathname + '#l=' + code;
  const text = t('shareText', { name: list.name });
  if (navigator.share) {
    try { await navigator.share({ title: list.name, text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(t('linkCopied'));
  } catch {
    const ta = h('textarea', { class: 'field area mono', rows: '4', readonly: true }, url);
    modal({ title: t('share'), body: ta, buttons: [{ label: t('done'), value: true, kind: 'primary', grow: true }], dismissable: true });
    setTimeout(() => ta.select(), 50);
  }
}

async function handleImportLink() {
  const m = location.hash.match(/^#l=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  history.replaceState(history.state, '', location.pathname + location.search);
  let incoming;
  try {
    incoming = listFromShare(await decodeData(m[1]));
  } catch {
    toast(t('badLink'));
    return;
  }
  const id = listIdFor(incoming.words);
  if (store.get().lists[id]) {
    store.selectList(id);
    show('home');
    toast(t('listExists'));
    return;
  }
  const [pre, name, post] = tSplit('importText', { name: '„' + incoming.name + '“', n: incoming.words.length }, 'name');
  const ok = await confirmDialog(t('importTitle'), h('p', { class: 'modal-text' }, pre, h('b', null, name), post), t('add'),
    { icon: { name: 'listPlus', kind: 'accent', extra: 'square' } });
  if (!ok) return;
  store.addList({ id, name: incoming.name, words: incoming.words, builtin: false });
  show('home');
  toast(t('listSaved'), { icon: 'check' });
}

// ---------- settings ----------

function switchRow(label, key, hint) {
  const on = !!store.settings()[key];
  return h('div', { class: 'set-row' },
    h('span', { class: 'set-label' }, label, hint ? h('small', null, hint) : null),
    h('button', {
      class: 'switch' + (on ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label,
      onclick: () => { store.setSetting(key, !on); show('settings'); },
    }, h('span', { class: 'track' }, h('span', { class: 'knob' }))));
}

function renderSettings() {
  const wrap = h('div', { class: 'screen' }, topbar(t('settings')));

  wrap.appendChild(h('section', { class: 'card settings-card' },
    h('div', { class: 'set-row' },
      h('span', { class: 'set-label' }, t('language')),
      h('div', { class: 'segmented compact', role: 'group', 'aria-label': t('language') }, LANGS.map((l) => h('button', {
        class: getLang() === l.id ? 'on' : '', type: 'button', 'aria-pressed': String(getLang() === l.id),
        onclick: () => { store.setSetting('lang', l.id); setLang(l.id); show('settings'); },
      }, l.label)))),
    switchRow(t('sound'), 'sound'),
    'vibrate' in navigator ? switchRow(t('vibration'), 'vibrate', t('vibrationHint')) : null));

  // test version of the Zeitbombe: switch it off, or play it right away
  const zbOn = store.settings().zeitbombe !== false;
  const cur = store.currentList();
  const canTry = zbOn && cur && cur.words.length >= 8 && store.isUnlocked(cur.id, 'medium');
  wrap.appendChild(h('section', { class: 'card settings-card' },
    h('h2', { class: 'card-title', style: { fontSize: '20px', margin: '14px 0 2px' } }, t('testFeatures')),
    switchRow(t('zbSetting'), 'zeitbombe', t('zbSettingHint')),
    zbOn ? h('div', { class: 'set-row' },
      h('span', { class: 'set-label' }, t('zbTry'), h('small', null, canTry ? t('zbTryHint') : t('zbTryLocked'))),
      h('button', {
        class: 'btn outline', type: 'button', disabled: !canTry, style: { flex: 'none', height: '44px', padding: '0 14px' },
        onclick: () => navigate('game', { level: 'medium', forceMods: { 1: 'zeitbombe' } }),
      }, icon('zeitbombe'), t('zbTryShort'))) : null));

  const timingCells = [
    h('span'), h('span', { class: 'timing-head' }, t('startTime')), h('span', { class: 'timing-head' }, t('bonusTime')),
    h('span', { class: 'timing-head' }, t('limitTime')),
  ];
  const ARIA = { start: 'startAria', bonus: 'bonusAria', cap: 'limitAria' };
  const fields = {};
  for (const lvl of LEVEL_IDS) {
    const tm = store.timing(lvl);
    const num = (key, val) => h('input', {
      class: 'num-field', type: 'number', inputmode: 'numeric', min: key === 'bonus' ? '0' : '10', max: key === 'bonus' ? '120' : '600',
      value: String(val), 'aria-label': t(ARIA[key], { level: t('level_' + lvl) }),
      onchange: (e) => {
        store.setTiming(lvl, key, e.target.value);
        // the limit is never below the start time, so both fields are refreshed
        const now = store.timing(lvl);
        for (const k of Object.keys(ARIA)) fields[lvl + k].value = String(now[k]);
      },
    });
    for (const k of Object.keys(ARIA)) fields[lvl + k] = num(k, tm[k]);
    timingCells.push(
      h('span', { class: 'timing-level lv-' + lvl }, levelBars(lvl, 'md'), t('level_' + lvl)),
      fields[lvl + 'start'], fields[lvl + 'bonus'], fields[lvl + 'cap']);
  }
  wrap.appendChild(h('section', { class: 'card stack' },
    h('div', { class: 'section-head' },
      h('h2', null, t('timing')),
      h('button', { class: 'btn text', type: 'button', onclick: () => { store.resetTiming(); show('settings'); } }, icon('reset'), t('resetTiming'))),
    h('div', { class: 'timing' }, timingCells)));

  const codeBox = h('div', { class: 'code-box', hidden: true });
  const loadArea = h('textarea', { class: 'field area mono', id: 'code-in', rows: '2', spellcheck: 'false' });
  wrap.appendChild(h('section', { class: 'card stack' },
    h('div', { class: 'field-group' },
      h('h2', { class: 'card-title', style: { fontSize: '20px' } }, t('backup')),
      h('p', { class: 'hint-small', style: { fontSize: '13.5px' } }, t('backupHint'))),
    h('button', {
      class: 'btn outline', type: 'button',
      onclick: async () => {
        const code = await encodeData(store.exportState());
        codeBox.hidden = false;
        codeBox.replaceChildren(
          h('div', { class: 'head' },
            h('span', { class: 'eyebrow' }, t('yourCode')),
            h('button', {
              class: 'btn text', type: 'button',
              onclick: async () => {
                try { await navigator.clipboard.writeText(code); toast(t('copied'), { icon: 'check' }); } catch { /* select manually */ }
              },
            }, icon('copy'), t('copy'))),
          h('output', null, code));
      },
    }, t('makeCode')),
    codeBox,
    h('div', { class: 'field-group' },
      h('label', { class: 'field-label', for: 'code-in' }, t('pasteCode')),
      loadArea),
    h('button', {
      class: 'btn outline', type: 'button',
      onclick: async () => {
        let data;
        try { data = await decodeData(loadArea.value.trim()); if (!data || data.v !== 1) throw new Error('x'); } catch { toast(t('badCode')); return; }
        if (!(await confirmDialog(t('loadCodeTitle'), t('loadCodeText'), t('loadCode'), { danger: true }))) return;
        try { store.importState(data); } catch { toast(t('badCode')); return; }
        setLang(store.settings().lang || detectLang());
        show('settings');
        toast(t('loaded'), { icon: 'check' });
      },
    }, t('loadCode'))));

  wrap.appendChild(h('button', {
    class: 'btn danger-soft', type: 'button',
    onclick: async () => {
      if (await confirmDialog(t('resetTitle'), t('resetText'), t('reset'), { danger: true })) { store.resetProgress(); show('settings'); }
    },
  }, icon('reset'), t('resetProgress')));
  wrap.appendChild(h('p', { class: 'version' }, t('version') + ' ' + APP_VERSION));
  return wrap;
}

// ---------- boot ----------

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline mode unavailable */ });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    updateWaiting = true;
    applyUpdateIfIdle();
  });
}

/** A new version is installed: reload quietly as soon as we are on the start screen (never during a game). */
function applyUpdateIfIdle() {
  if (!updateWaiting || game || base !== 'home' || sheets.length || streakUI.calendarIsOpen() || document.querySelector('.modal-wrap')) return;
  updateWaiting = false;
  location.reload();
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  if (!game && base === 'home' && !sheets.length) show('home');
});

function boot() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  // a thin line under the sticky header once the start screen is scrolled
  window.addEventListener('scroll', () => {
    const head = base === 'home' ? document.querySelector('.home-top') : null;
    if (head) head.classList.toggle('scrolled', window.scrollY > 4);
  }, { passive: true });
  store.load();
  setLang(store.settings().lang || detectLang());
  history.replaceState({ screen: 'home' }, '', location.href);
  show('home').then(() => playHomeAnims());
  handleImportLink();
  registerSW();
}

boot();
