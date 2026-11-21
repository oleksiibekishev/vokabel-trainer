import * as store from './store.js';
import { t, tList, setLang, detectLang, LANGS, getLang } from './i18n.js';
import { h, icon, toast, modal, confirmDialog, sfx } from './ui.js';
import {
  LEVELS, LEVEL_IDS, MIN_WORDS, parseWordList, encodeData, decodeData, listToShare, listFromShare, listIdFor,
} from './core.js';
import { Game } from './game.js';

export const APP_VERSION = '1.0.0';

const app = document.getElementById('app');
let game = null;
let deferredInstall = null;
let wordsSort = 'order';

// ---------- navigation (Android back button returns to the menu) ----------

function show(name, arg) {
  if (game) { game.destroy(); game = null; }
  document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
  if (name === 'game') return showGame(arg);
  const screens = { home: renderHome, lists: renderLists, words: renderWords, settings: renderSettings };
  app.replaceChildren((screens[name] || renderHome)());
  window.scrollTo(0, 0);
}

function navigate(name, arg) {
  if (!history.state || history.state.screen !== 'sub') history.pushState({ screen: 'sub' }, '');
  show(name, arg);
}

function goHome() {
  if (history.state && history.state.screen === 'sub') history.back();
  else show('home');
}

window.addEventListener('popstate', () => {
  if (game && !game.ended && !game.destroyed) {
    history.pushState({ screen: 'sub' }, '');
    game.askQuit();
    return;
  }
  show('home');
});

function topbar(title) {
  return h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('back'), onclick: goHome }, icon('back')),
    h('h1', { class: 'topbar-title' }, title));
}

// ---------- home ----------

function renderHome() {
  const list = store.currentList();
  const wrap = h('div', { class: 'screen home' });
  wrap.appendChild(h('header', { class: 'topbar home-top' },
    h('div', { class: 'brand' },
      h('img', { class: 'brand-logo', src: 'icons/favicon.svg', alt: '' }),
      h('div', null, h('h1', null, t('appName')), h('p', { class: 'muted' }, t('tagline')))),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('settings'), onclick: () => navigate('settings') }, icon('gear'))));

  const banner = installBanner();
  if (banner) wrap.appendChild(banner);

  if (!list) {
    wrap.appendChild(h('section', { class: 'card' }, h('p', null, t('notEnoughWords', { n: MIN_WORDS })),
      h('button', { class: 'btn primary', onclick: () => navigate('lists') }, t('newList'))));
    return wrap;
  }

  wrap.appendChild(h('section', { class: 'card list-card' },
    h('div', { class: 'eyebrow' }, t('currentList')),
    h('div', { class: 'list-name' }, list.name),
    h('div', { class: 'muted' }, t('wordsN', { n: list.words.length })),
    h('div', { class: 'row' },
      h('button', { class: 'btn secondary', type: 'button', onclick: () => navigate('words') }, icon('book'), t('showWords')),
      h('button', { class: 'btn secondary', type: 'button', onclick: () => navigate('lists') }, icon('list'), t('changeList')))));

  const enough = list.words.length >= MIN_WORDS;
  if (!enough) wrap.appendChild(h('p', { class: 'warn' }, t('notEnoughWords', { n: MIN_WORDS })));
  wrap.appendChild(h('div', { class: 'levels' }, LEVEL_IDS.map((lvl) => levelCard(list, lvl, enough))));
  wrap.appendChild(h('details', { class: 'card rules' },
    h('summary', null, t('rulesTitle')),
    h('ul', null, tList('rules').map((r) => h('li', null, r)))));
  return wrap;
}

function levelCard(list, level, enough) {
  const L = LEVELS[level];
  const tm = store.timing(level);
  const unlocked = store.isUnlocked(list.id, level) && enough;
  const p = store.levelProgress(list.id, level);
  const types = ['pairs', 'choice', 'gaps', 'spell'].filter((ty) => L.fixed.includes(ty) || L.pool.includes(ty));
  let status;
  if (!store.isUnlocked(list.id, level)) {
    const prev = LEVEL_IDS[LEVEL_IDS.indexOf(level) - 1];
    status = h('span', { class: 'status locked-text' }, icon('lock'), t('lockedHint', { prev: t('level_' + prev) }));
  } else if (p.completed) {
    status = h('span', { class: 'status ok-text' }, t('completedBest', { t: p.bestTimeLeft ?? 0 }));
  } else if (p.plays) {
    status = h('span', { class: 'status' }, t('bestRound', { r: p.bestRound, n: L.rounds }));
  } else {
    status = h('span', { class: 'status muted' }, t('notPlayed'));
  }
  return h('button', {
    class: 'level-card level-' + level + (unlocked ? '' : ' locked'),
    type: 'button',
    disabled: !unlocked,
    onclick: () => { sfx.unlock(); navigate('game', level); },
  },
  h('div', { class: 'level-head' },
    h('span', { class: 'level-name' }, t('level_' + level)),
    unlocked ? h('span', { class: 'play-pill' }, icon('play'), t('play')) : icon('lock', 'lock-icon')),
  h('div', { class: 'level-meta' }, t('levelMeta', { rounds: L.rounds, start: tm.start, bonus: tm.bonus })),
  h('div', { class: 'chips' }, types.map((ty) => h('span', { class: 'chip chip-' + ty }, t('type_' + ty)))),
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
    return h('div', { class: 'banner' },
      h('span', null, t('install')),
      h('button', {
        class: 'btn primary small',
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
      h('span', null, t('installIos')),
      h('button', {
        class: 'icon-btn small', 'aria-label': t('dismiss'),
        onclick: (e) => { store.setSetting('iosHintDismissed', true); e.currentTarget.closest('.banner').remove(); },
      }, icon('close')));
  }
  return null;
}

// ---------- game ----------

function showGame(level) {
  if (game) game.destroy();
  const list = store.currentList();
  if (!list || !store.isUnlocked(list.id, level)) { show('home'); return; }
  const root = h('div', { class: 'screen game' });
  app.replaceChildren(root);
  game = new Game({
    root, list, level,
    onMenu: () => { game = null; goHome(); },
    onNextLevel: (lvl) => showGame(lvl),
  });
  game.start();
}

// ---------- lists ----------

function renderLists() {
  const wrap = h('div', { class: 'screen' }, topbar(t('lists')));
  const cur = store.currentList();
  const rows = store.lists().map((l) => h('div', { class: 'list-row' + (cur && cur.id === l.id ? ' active' : '') },
    h('button', { class: 'list-main', type: 'button', onclick: () => { store.selectList(l.id); goHome(); } },
      h('span', { class: 'list-title' }, l.name),
      h('span', { class: 'muted small' }, t('wordsN', { n: l.words.length })),
      cur && cur.id === l.id ? h('span', { class: 'badge' }, t('active')) : null),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('share'), onclick: () => shareList(l) }, icon('share')),
    h('button', {
      class: 'icon-btn danger-icon', type: 'button', 'aria-label': t('delete'),
      onclick: async () => {
        if (await confirmDialog(t('deleteListTitle'), t('deleteListText', { name: l.name }), t('delete'), true)) {
          store.deleteList(l.id);
          show('lists');
        }
      },
    }, icon('trash'))));
  wrap.appendChild(h('section', { class: 'card stack' }, rows));
  wrap.appendChild(newListForm());
  return wrap;
}

function newListForm() {
  const nameInput = h('input', { class: 'field', type: 'text', maxlength: '60', placeholder: t('listName'), 'aria-label': t('listName') });
  const area = h('textarea', { class: 'field area', rows: '7', placeholder: t('pastePlaceholder'), spellcheck: 'false', 'aria-label': t('orPaste') });
  const preview = h('div', { class: 'preview' });
  const fileInput = h('input', { type: 'file', accept: '.txt,.csv,.tsv,text/plain,text/csv', class: 'sr-only', id: 'file-in' });
  const saveBtn = h('button', { class: 'btn primary wide', type: 'button', disabled: true }, t('saveList'));

  const refresh = () => {
    const r = parseWordList(area.value);
    preview.replaceChildren();
    saveBtn.disabled = r.words.length < MIN_WORDS;
    if (!area.value.trim()) return;
    preview.appendChild(h('p', { class: r.words.length >= MIN_WORDS ? 'ok-text' : 'warn' },
      t('recognized', { n: r.words.length }), r.words.length < MIN_WORDS ? ' · ' + t('tooFew', { n: MIN_WORDS }) : ''));
    if (r.words.length) {
      preview.appendChild(h('div', { class: 'mini-table' }, r.words.slice(0, 4).map((w) => h('div', { class: 'pair-row' },
        h('span', { lang: 'en' }, w.en), h('span', { class: 'eq' }, '='), h('span', { lang: 'de' }, w.de)))));
    }
    if (r.skipped.length) {
      preview.appendChild(h('details', { class: 'skipped' },
        h('summary', null, t('skippedLines', { n: r.skipped.length })),
        r.skipped.slice(0, 20).map((s) => h('div', { class: 'muted small' }, s))));
    }
  };
  area.addEventListener('input', refresh);
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    area.value = await f.text();
    if (!nameInput.value) nameInput.value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 60);
    refresh();
  });
  saveBtn.addEventListener('click', () => {
    const r = parseWordList(area.value);
    if (r.words.length < MIN_WORDS) { toast(t('tooFew', { n: MIN_WORDS })); return; }
    const id = listIdFor(r.words);
    if (store.get().lists[id]) {
      store.selectList(id);
      toast(t('listExists'));
    } else {
      const name = nameInput.value.trim() || 'Liste ' + (store.lists().length + 1);
      store.addList({ id, name, words: r.words, builtin: false });
      toast(t('listSaved'));
    }
    goHome();
  });

  return h('section', { class: 'card stack' },
    h('h2', { class: 'card-title' }, t('newList')),
    h('label', { class: 'btn secondary file-btn', for: 'file-in' }, icon('upload'), t('chooseFile')),
    fileInput,
    h('div', { class: 'muted small' }, t('orPaste')),
    area,
    h('p', { class: 'muted small' }, t('formatHint')),
    nameInput,
    preview,
    saveBtn);
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
    const ta = h('textarea', { class: 'field area', rows: '4', readonly: true }, url);
    modal({ title: t('share'), body: ta, buttons: [{ label: t('done'), value: true, kind: 'primary' }], dismissable: true });
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
  const ok = await confirmDialog(t('importTitle'), t('importText', { name: incoming.name, n: incoming.words.length }), t('add'));
  if (!ok) return;
  store.addList({ id, name: incoming.name, words: incoming.words, builtin: false });
  show('home');
  toast(t('listSaved'));
}

// ---------- words ----------

function renderWords() {
  const list = store.currentList();
  const wrap = h('div', { class: 'screen' }, topbar(list ? list.name : t('words')));
  if (!list) return wrap;
  const st = store.stats(list.id);
  const mk = (id) => (st[id] ? st[id].w || 0 : 0);
  const seg = h('div', { class: 'segmented' },
    ['order', 'hard'].map((k) => h('button', {
      class: wordsSort === k ? 'on' : '', type: 'button',
      onclick: () => { wordsSort = k; show('words'); },
    }, t(k === 'order' ? 'sortOrder' : 'sortHard'))));
  let words = list.words.slice();
  if (wordsSort === 'hard') words.sort((a, b) => mk(b.id) - mk(a.id));
  const anyMistakes = words.some((w) => mk(w.id) > 0);
  wrap.appendChild(seg);
  if (wordsSort === 'hard' && !anyMistakes) wrap.appendChild(h('p', { class: 'muted center' }, t('noMistakes')));
  wrap.appendChild(h('section', { class: 'card word-table' }, words.map((w) => h('div', { class: 'word-row' },
    h('span', { class: 'w-en', lang: 'en' }, w.en),
    h('span', { class: 'w-de', lang: 'de' }, w.de),
    mk(w.id) ? h('span', { class: 'miss', title: t('mistakes') }, '✗ ' + mk(w.id)) : h('span', { class: 'miss empty' })))));
  return wrap;
}

// ---------- settings ----------

function toggleRow(label, key) {
  const on = !!store.settings()[key];
  return h('div', { class: 'set-row' },
    h('span', null, label),
    h('button', {
      class: 'switch' + (on ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label,
      onclick: () => { store.setSetting(key, !on); show('settings'); },
    }, h('span', { class: 'knob' })));
}

function renderSettings() {
  const wrap = h('div', { class: 'screen' }, topbar(t('settings')));
  const s = store.settings();

  wrap.appendChild(h('section', { class: 'card stack' },
    h('div', { class: 'set-row' }, h('span', null, t('language')),
      h('div', { class: 'segmented small' }, LANGS.map((l) => h('button', {
        class: getLang() === l.id ? 'on' : '', type: 'button',
        onclick: () => { store.setSetting('lang', l.id); setLang(l.id); show('settings'); },
      }, l.label)))),
    toggleRow(t('sound'), 'sound'),
    'vibrate' in navigator ? toggleRow(t('vibration'), 'vibrate') : null));

  const timingRows = LEVEL_IDS.map((lvl) => {
    const tm = store.timing(lvl);
    const num = (key, val) => h('input', {
      class: 'field num', type: 'number', inputmode: 'numeric', min: key === 'start' ? '10' : '0', max: key === 'start' ? '600' : '120',
      value: String(val), 'aria-label': t('level_' + lvl) + ' ' + t(key === 'start' ? 'startTime' : 'bonusTime'),
      onchange: (e) => { store.setTiming(lvl, key, e.target.value); e.target.value = String(store.timing(lvl)[key]); },
    });
    return h('div', { class: 'timing-row' },
      h('span', { class: 'timing-level level-dot-' + lvl }, t('level_' + lvl)),
      num('start', tm.start),
      num('bonus', tm.bonus));
  });
  wrap.appendChild(h('section', { class: 'card stack' },
    h('h2', { class: 'card-title' }, t('timing')),
    h('div', { class: 'timing-row timing-head' }, h('span'), h('span', { class: 'muted small' }, t('startTime')), h('span', { class: 'muted small' }, t('bonusTime'))),
    timingRows,
    h('button', { class: 'btn secondary', type: 'button', onclick: () => { store.resetTiming(); show('settings'); } }, t('resetTiming'))));

  const codeBox = h('div', { class: 'stack' });
  const loadArea = h('textarea', { class: 'field area', rows: '3', placeholder: t('pasteCode'), spellcheck: 'false', 'aria-label': t('pasteCode') });
  wrap.appendChild(h('section', { class: 'card stack' },
    h('h2', { class: 'card-title' }, t('backup')),
    h('p', { class: 'muted small' }, t('backupHint')),
    h('button', {
      class: 'btn secondary', type: 'button',
      onclick: async () => {
        const code = await encodeData(store.exportState());
        const ta = h('textarea', { class: 'field area mono', rows: '4', readonly: true }, code);
        const copyBtn = h('button', {
          class: 'btn primary', type: 'button',
          onclick: async () => {
            try { await navigator.clipboard.writeText(code); toast(t('copied')); } catch { ta.select(); }
          },
        }, t('copy'));
        codeBox.replaceChildren(ta, copyBtn);
      },
    }, t('makeCode')),
    codeBox,
    loadArea,
    h('button', {
      class: 'btn secondary', type: 'button',
      onclick: async () => {
        let data;
        try { data = await decodeData(loadArea.value.trim()); if (!data || data.v !== 1) throw new Error('x'); } catch { toast(t('badCode')); return; }
        if (!(await confirmDialog(t('loadCodeTitle'), t('loadCodeText'), t('loadCode'), true))) return;
        try { store.importState(data); } catch { toast(t('badCode')); return; }
        setLang(store.settings().lang || detectLang());
        show('settings');
        toast(t('loaded'));
      },
    }, t('loadCode'))));

  wrap.appendChild(h('section', { class: 'card stack' },
    h('button', {
      class: 'btn danger', type: 'button',
      onclick: async () => {
        if (await confirmDialog(t('resetTitle'), t('resetText'), t('reset'), true)) { store.resetProgress(); show('settings'); }
      },
    }, t('resetProgress'))));
  wrap.appendChild(h('p', { class: 'muted small center' }, t('version') + ' ' + APP_VERSION));
  void s;
  return wrap;
}

// ---------- boot ----------

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline mode unavailable */ });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    toast(t('updateReady'), { label: t('reload'), onClick: () => location.reload() });
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  if (!game && document.querySelector('.home')) show('home');
});

function boot() {
  store.load();
  setLang(store.settings().lang || detectLang());
  history.replaceState({ screen: 'home' }, '', location.href);
  show('home');
  handleImportLink();
  registerSW();
}

boot();
