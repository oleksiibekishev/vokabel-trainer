import * as store from './store.js';
import { t, tSplit, setLang, detectLang, LANGS, getLang } from './i18n.js';
import { h, icon, logo, levelBars, toast, modal, confirmDialog, sfx, closeAllModals } from './ui.js';
import {
  LEVELS, LEVEL_IDS, MIN_WORDS, parseWordList, encodeData, decodeData, listToShare, listFromShare, listIdFor, listToText,
  articleItems, ARTICLE_MIN, detectLangs, listLangs, LIST_LANGS,
} from './core.js';
import { Game } from './game.js';
import { ArticleGame } from './artikel.js';
import * as streakUI from './streak.js';
import { openIntro, closeIntro, introIsOpen } from './intro.js';

export const APP_VERSION = '1.11.0';

const app = document.getElementById('app');
let game = null;
let deferredInstall = null;
let updateWaiting = false;

// ---------- screens and transitions ----------
// #app shows the start screen or a game. Lists, the new-list form and the settings open as
// sheets from the bottom over the (receding, dimmed) start screen. A game fades in and out.

const SHEETS = {
  lists: () => renderLists(),
  addList: () => renderAddList(),
  editList: () => renderAddList(store.get().lists[editListId] || null),
  settings: () => renderSettings(),
};
let editListId = null; // the list "Liste bearbeiten" shows
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
  sh.layer.querySelector('.sheet-inner').replaceChildren(SHEETS[sh.name]());
}

async function openSheet(name) {
  const under = sheets.length ? sheets[sheets.length - 1].layer : app;
  if (under === app) app.style.setProperty('--sy', window.scrollY + 'px');
  const dim = h('div', { class: 'sheet-dim in' });
  const layer = h('div', { class: 'sheet sheet-in', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-inner' }, SHEETS[name]()));
  const title = layer.querySelector('h1');
  if (title) layer.setAttribute('aria-label', title.textContent);
  under.classList.remove('return');
  under.classList.add('recede');
  document.body.append(dim, layer);
  document.documentElement.classList.add('locked');
  const sh = { name, layer, dim, under };
  sheets.push(sh);
  layer.addEventListener('scroll', () => layer.classList.toggle('scrolled', layer.scrollTop > 2), { passive: true });
  dragToClose(sh);
  busy(true);
  await wait(ms(420));
  busy(false);
  layer.classList.remove('sheet-in');
  dim.classList.replace('in', 'on');
}

/**
 * Pull a sheet down to close it – only from the very top (handle and title bar, which stay at the
 * top while the content scrolls). Scrolling the content up never closes the sheet.
 */
function dragToClose(sh) {
  const { layer, dim } = sh;
  let y0 = null;
  let pid = null;
  let dy = 0;
  let dragging = false;
  let vel = 0;
  let lastY = 0;
  let lastT = 0;
  layer.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (sheets[sheets.length - 1] !== sh || document.documentElement.classList.contains('busy')) return;
    if (!e.target.closest('.sheet-grip, .sheet .topbar')) return;
    y0 = e.clientY; pid = e.pointerId; dy = 0; dragging = false; vel = 0; lastY = y0; lastT = e.timeStamp;
  });
  layer.addEventListener('pointermove', (e) => {
    if (y0 === null || e.pointerId !== pid) return;
    const d = e.clientY - y0;
    if (!dragging) {
      if (d < -10) { y0 = null; return; }
      if (d < 8) return;
      dragging = true;
      try { layer.setPointerCapture(pid); } catch { /* ignore */ }
      layer.classList.add('dragging');
    }
    dy = Math.max(0, d);
    if (e.timeStamp > lastT) vel = (e.clientY - lastY) / (e.timeStamp - lastT);
    lastY = e.clientY;
    lastT = e.timeStamp;
    layer.style.transform = 'translateY(' + dy + 'px)';
    dim.style.opacity = String(1 - 0.85 * Math.min(1, dy / layer.offsetHeight));
  });
  const end = (e) => {
    if (y0 === null || e.pointerId !== pid) return;
    y0 = null;
    if (!dragging) return;
    dragging = false;
    layer.classList.remove('dragging');
    // the finger was dragging, not tapping the ✕
    const block = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    layer.addEventListener('click', block, true);
    setTimeout(() => layer.removeEventListener('click', block, true), 80);
    if (e.type !== 'pointercancel' && (dy > layer.offsetHeight * 0.25 || (vel > 0.5 && dy > 40))) {
      goBack();
      return;
    }
    // not far enough: back up
    layer.classList.add('snap');
    dim.classList.add('snap');
    layer.style.transform = '';
    dim.style.opacity = '';
    setTimeout(() => { layer.classList.remove('snap'); dim.classList.remove('snap'); }, 260);
  };
  layer.addEventListener('pointerup', end);
  layer.addEventListener('pointercancel', end);
}

async function closeSheets(keep) {
  while (sheets.length > keep) {
    const sh = sheets.pop();
    // pulled down by hand: slide out from where the finger let go
    const m = /translateY\(([\d.]+)px\)/.exec(sh.layer.style.transform);
    if (m) sh.layer.style.setProperty('--from', m[1] + 'px');
    sh.layer.style.transform = '';
    if (sh.dim.style.opacity) { sh.dim.style.setProperty('--dim-o', sh.dim.style.opacity); sh.dim.style.opacity = ''; }
    sh.dim.classList.remove('in', 'on');
    sh.dim.classList.add('out');
    sh.under.classList.remove('recede');
    sh.under.classList.add('return');
    sh.layer.classList.add('sheet-out');
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
  st.endless = store.endlessUnlocked(list.id) ? 'open' : 'locked';
  return st;
}

/** Start a game: the start screen fades out, the game fades in, its parts one after another. */
async function startGame({ level, focus = [], fromGame = false } = {}) {
  const list = store.currentList();
  const allowed = list && (level === 'artikel' ? articleItems(list.words, listLangs(list)).length >= ARTICLE_MIN : list.words.length >= MIN_WORDS && (
    level === 'endless' ? store.endlessUnlocked(list.id)
      : level === 'training' ? store.mistakeWords(list.id, list.words).length > 0
        : LEVEL_IDS.includes(level) && store.isUnlocked(list.id, level)));
  if (!allowed) { await doShow('home'); return; }
  busy(true);
  if (sheets.length) {
    sheets.splice(0).forEach((sh) => { sh.layer.remove(); sh.dim.remove(); });
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
  game = level === 'artikel'
    ? new ArticleGame({ root, list, onMenu: () => { game = null; goBack(); } })
    : new Game({
      root, list, level, focus,
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
  if (introIsOpen() && !(history.state && history.state.intro)) { closeIntro(); return; }
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

/** Einführung (first start, or Einstellungen → Einführung); the back button closes it. */
function startIntro() {
  if (introIsOpen() || document.documentElement.classList.contains('busy')) return Promise.resolve();
  history.pushState({ screen: (history.state && history.state.screen) || 'home', intro: true }, '');
  return openIntro({ onRequestClose: () => history.back() });
}

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
  wrap.appendChild(h('div', { class: 'levels' }, LEVEL_IDS.map((lvl) => levelCard(list, lvl, enough))));
  wrap.appendChild(modesSection(list, enough));
  return wrap;
}

/** Endlos and Fehlertraining below the levels. */
function modesSection(list, enough) {
  const endlessOpen = store.endlessUnlocked(list.id);
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
    }),
    artikelCard(card, list));
}

/** Artikel: der, die, das for the nouns of the list (open from the start, needs 4 nouns with an article). */
function artikelCard(card, list) {
  const n = articleItems(list.words, listLangs(list)).length;
  const ad = store.articleData(list.id);
  let status;
  if (n < ARTICLE_MIN) status = { status: t('artikelEmpty'), statusCls: 'fresh' };
  else if (ad.last) status = { status: [icon('check'), t('artikelLast', { r: ad.last.right, n: ad.last.total })], statusCls: 'best' };
  else status = { status: t('artikelNouns', { n }), statusCls: 'fresh' };
  return card({ id: 'artikel', playable: n >= ARTICLE_MIN, desc: t('artikelMeta'), play: t('practice'), ...status });
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
      h('button', {
        class: 'icon-btn', type: 'button', 'aria-label': t('editListAria', { name: l.name }),
        onclick: () => { editListId = l.id; navigate('editList'); },
      }, icon('pencil')),
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
  const L = listLangs(list);
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
      h('div', { class: 'word-table-head' }, h('span', null, t('label_' + L.left) + ' · ' + t('label_' + L.right)), h('span', null, t('mistakesHead'))),
      words.map((w) => h('div', { class: 'word-row' },
        h('div', { class: 'words' }, h('span', { class: 'w-en', lang: L.left }, w.en), h('span', { class: 'w-de', lang: L.right }, w.de)),
        mk(w.id)
          ? h('span', { class: 'miss' }, icon('close'), String(mk(w.id)))
          : h('span', { class: 'miss none', 'aria-label': t('noMistakesAria') }, '–')))));
}

/** "Neue Liste" – or, with a list, "Liste bearbeiten" (same form, filled in). */
function renderAddList(editing = null) {
  const wrap = h('div', { class: 'screen' }, topbar(t(editing ? 'editList' : 'newList')));
  const nameInput = h('input', { class: 'field', id: 'list-name', type: 'text', maxlength: '60', placeholder: t('namePlaceholder'), required: true, autocomplete: 'off' });
  const area = h('textarea', { class: 'field area', id: 'list-text', rows: editing ? '12' : '8', placeholder: t('pastePlaceholder'), spellcheck: 'false' });
  if (editing) {
    nameInput.value = editing.name;
    area.value = listToText(editing.words);
  }
  const before = editing ? new Set(editing.words.map((w) => w.id)) : null;
  // languages of the two columns: guessed from the words until the user picks them
  const startLangs = editing ? listLangs(editing) : { left: 'en', right: 'de' };
  let langsPicked = !!(editing && editing.langs);
  const langSelect = (id, val) => h('select', { class: 'field lang-select', id, onchange: () => { langsPicked = true; refresh(); } },
    LIST_LANGS.map((c) => h('option', { value: c, selected: c === val }, t('langName_' + c))));
  const selL = langSelect('lang-left', startLangs.left);
  const selR = langSelect('lang-right', startLangs.right);
  const langNote = h('p', { class: 'hint-small lang-note' });
  const langBox = h('div', { class: 'field-group lang-box', hidden: !editing },
    h('span', { class: 'field-label' }, t('langsTitle')),
    h('div', { class: 'lang-row' },
      h('label', { class: 'lang-pick' }, h('small', null, t('langLeft')), selL),
      h('span', { class: 'lang-arrow', 'aria-hidden': 'true' }, '–'),
      h('label', { class: 'lang-pick' }, h('small', null, t('langRight')), selR)),
    langNote);
  const langsNow = () => ({ left: selL.value, right: selR.value });
  const preview = h('div', { class: 'preview', hidden: true });
  const fileInput = h('input', { type: 'file', accept: '.txt,.csv,.tsv,text/plain,text/csv', class: 'sr-only', id: 'file-in' });
  const nameHint = h('p', { class: 'field-error', hidden: true }, icon('alert'), t('nameRequired'));
  const saveBtn = h('button', { class: 'btn primary tall', type: 'button', disabled: true }, t(editing ? 'saveChanges' : 'saveList'));

  const refresh = () => {
    const r = parseWordList(area.value);
    const wordsOk = r.words.length >= MIN_WORDS;
    const named = nameInput.value.trim().length > 0;
    saveBtn.disabled = !(wordsOk && named);
    nameHint.hidden = named || !area.value.trim();
    nameInput.classList.toggle('invalid', !named && !!area.value.trim());
    preview.hidden = !area.value.trim();
    langBox.hidden = !editing && !r.words.length;
    if (!langsPicked && r.words.length) {
      const g = detectLangs(r.words);
      selL.value = g.left;
      selR.value = g.right;
    }
    if (r.words.length) langNote.textContent = langsPicked ? '' : t('langsGuess', { a: t('langName_' + selL.value), b: t('langName_' + selR.value) });
    if (preview.hidden) { preview.replaceChildren(); return; }
    let diff = null;
    if (editing) {
      const now = new Set(r.words.map((w) => w.id));
      const added = r.words.filter((w) => !before.has(w.id)).length;
      const removed = [...before].filter((id) => !now.has(id)).length;
      const renamed = nameInput.value.trim() !== editing.name;
      const L0 = listLangs(editing);
      const relang = L0.left !== selL.value || L0.right !== selR.value;
      diff = h('div', { class: 'preview-diff' }, added || removed
        ? [t('editAdded', { n: added }), t('editRemoved', { n: removed })].join(' · ')
        : renamed || relang ? '' : t('noChanges'));
      if (!added && !removed && !renamed && !relang) saveBtn.disabled = true;
    }
    preview.replaceChildren(...[
      wordsOk
        ? h('div', { class: 'preview-status ok' }, icon('check'), t('recognized', { n: r.words.length }))
        : h('div', { class: 'preview-status err' }, icon('alert'), t('tooFew', { n: MIN_WORDS })),
      diff,
      r.words.length ? h('div', { class: 'pair-mini' }, r.words.slice(0, 4).map((w) => h('div', null,
        h('span', { lang: selL.value }, w.en), h('span', { lang: selR.value }, w.de)))) : null,
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
    if (editing) {
      store.updateList(editing.id, { name, words: r.words, langs: langsNow() });
      toast(t('listUpdated'), { icon: 'check' });
      goBack();
      return;
    }
    const id = listIdFor(r.words);
    if (store.get().lists[id]) {
      store.selectList(id);
      toast(t('listExists'));
    } else {
      store.addList({ id, name, words: r.words, builtin: false, langs: langsNow() });
      toast(t('listSaved'), { icon: 'check' });
    }
    goBack();
  });

  if (editing) refresh();
  wrap.appendChild(h('section', { class: 'card stack' },
    h('div', { class: 'field-group' },
      h('label', { class: 'field-label', for: 'list-name' }, t('listName')),
      nameInput,
      nameHint),
    h('div', { class: 'field-group' },
      h('label', { class: 'field-label', for: 'list-text' }, t('pasteWords')),
      area,
      h('p', { class: 'hint-small' }, t(editing ? 'editHint' : 'formatHint'))),
    h('label', { class: 'btn outline', for: 'file-in' }, icon('upload'), t('orFile')),
    fileInput,
    preview,
    langBox,
    saveBtn));
  return wrap;
}

// The share link holds the whole list (#l=…), ~1000 characters for 36 words. is.gd turns it into a
// short link. Its API answers as JSONP (no CORS needed); without internet the long link is used.
const shortLinks = new Map();
function shortLink(url) {
  if (shortLinks.has(url)) return Promise.resolve(shortLinks.get(url));
  return new Promise((resolve) => {
    if (url.length > 4900 || navigator.onLine === false) { resolve(null); return; }
    const cb = '__vtShort' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    let timer = null;
    const finish = (v) => {
      if (!window[cb]) return;
      delete window[cb];
      clearTimeout(timer);
      s.remove();
      if (v) shortLinks.set(url, v);
      resolve(v);
    };
    window[cb] = (r) => finish(r && typeof r.shorturl === 'string' && /^https:\/\/is\.gd\/[A-Za-z0-9_-]+$/.test(r.shorturl) ? r.shorturl : null);
    s.src = 'https://is.gd/create.php?format=json&callback=' + cb + '&url=' + encodeURIComponent(url);
    s.onerror = () => finish(null);
    timer = setTimeout(() => finish(null), 7000);
    document.head.appendChild(s);
  });
}

async function shareList(list) {
  const code = await encodeData(listToShare(list));
  const long = location.origin + location.pathname + '#l=' + code;
  let url = long;
  const urlText = h('span', { class: 'share-url' }, t('shareMaking'));
  const linkBox = h('div', { class: 'share-link loading' }, icon('link'), urlText);
  const note = h('p', { class: 'share-note' });
  const send = h('button', { class: 'btn primary', type: 'button', disabled: true }, icon('share'), t('shareSend'));
  const copy = h('button', { class: 'btn outline', type: 'button', disabled: true }, icon('copy'), t('copyLink'));
  send.hidden = !navigator.share;
  send.addEventListener('click', async () => {
    try { await navigator.share({ title: list.name, text: t('shareText', { name: list.name }), url }); } catch { /* cancelled */ }
  });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); toast(t('linkCopied')); } catch { /* not allowed */ }
  });
  modal({
    title: t('shareTitle', { name: list.name }),
    body: h('div', { class: 'share-box' },
      h('p', { class: 'share-meta' }, t('shareWords', { n: list.words.length })),
      linkBox, note, h('div', { class: 'share-actions' }, copy, send)),
    buttons: [{ label: t('done'), value: true, kind: 'outline', grow: true }],
    dismissable: true,
  });
  const short = await shortLink(long);
  url = short || long;
  linkBox.classList.remove('loading');
  urlText.textContent = short ? short.replace(/^https:\/\//, '') : long.replace(/^https?:\/\//, '');
  note.textContent = short ? t('shareShortVia') : t('shareLongOnly');
  send.disabled = false;
  copy.disabled = false;
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
  store.addList({ id, name: incoming.name, words: incoming.words, builtin: false, ...(incoming.langs ? { langs: incoming.langs } : {}) });
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
    'vibrate' in navigator ? switchRow(t('vibration'), 'vibrate', t('vibrationHint')) : null,
    switchRow(t('zbSetting'), 'zeitbombe', t('zbSettingHint')),
    h('div', { class: 'set-row' },
      h('span', { class: 'set-label' }, t('introSetting'), h('small', null, t('introSettingHint'))),
      h('button', {
        class: 'btn outline set-btn', type: 'button',
        onclick: () => startIntro(),
      }, icon('play'), t('introShow')))));

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
  if (!updateWaiting || game || base !== 'home' || sheets.length || streakUI.calendarIsOpen() || introIsOpen() || document.querySelector('.modal-wrap')) return;
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
  show('home').then(async () => {
    // a shared list first (that is why the link was opened), then the Einführung on the very first start
    await handleImportLink();
    if (!store.settings().introSeen) await startIntro();
    playHomeAnims();
  });
  registerSW();
}

boot();
