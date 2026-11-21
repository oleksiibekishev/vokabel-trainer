// Everything is saved in this browser (localStorage). No server.
import { BUILTIN_LISTS } from './builtin-lists.js';
import { parseWordList, LEVELS, LEVEL_IDS, createFixedRounds, fixedRoundsValid } from './core.js';

const KEY = 'vokabeltrainer.v1';

function defaults() {
  return {
    v: 1,
    lists: {},
    order: [],
    removedBuiltins: [],
    currentListId: null,
    progress: {},
    fixed: {},
    stats: {},
    settings: { lang: null, sound: true, vibrate: true, timing: {}, iosHintDismissed: false },
  };
}

let state = defaults();

function sanitize(s) {
  const d = defaults();
  if (!s || typeof s !== 'object' || s.v !== 1) return d;
  const out = { ...d, ...s };
  out.settings = { ...d.settings, ...(s.settings || {}) };
  for (const k of ['lists', 'progress', 'fixed', 'stats']) if (!out[k] || typeof out[k] !== 'object') out[k] = {};
  if (!Array.isArray(out.order)) out.order = [];
  if (!Array.isArray(out.removedBuiltins)) out.removedBuiltins = [];
  out.order = out.order.filter((id) => out.lists[id]);
  for (const id of Object.keys(out.lists)) if (!out.order.includes(id)) out.order.push(id);
  return out;
}

function mergeBuiltins() {
  BUILTIN_LISTS.forEach((b, i) => {
    if (state.removedBuiltins.includes(b.id)) return;
    const words = parseWordList(b.text).words;
    const existing = state.lists[b.id];
    if (existing) {
      existing.words = words;
      existing.name = b.name;
    } else {
      state.lists[b.id] = { id: b.id, name: b.name, words, builtin: true };
      state.order.splice(Math.min(i, state.order.length), 0, b.id);
    }
  });
  if (!state.lists[state.currentListId]) state.currentListId = state.order[0] || null;
}

export function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY)); } catch { raw = null; }
  state = sanitize(raw);
  mergeBuiltins();
  save();
  try { navigator.storage?.persist?.(); } catch { /* ignore */ }
  return state;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('save failed', e); }
}

export function get() {
  return state;
}

export function exportState() {
  return JSON.parse(JSON.stringify(state));
}

export function importState(obj) {
  const s = sanitize(obj);
  if (s === null || !obj || obj.v !== 1) throw new Error('bad state');
  state = s;
  mergeBuiltins();
  save();
}

// ---------- lists ----------

export function lists() {
  return state.order.map((id) => state.lists[id]).filter(Boolean);
}

export function currentList() {
  return state.lists[state.currentListId] || null;
}

export function selectList(id) {
  if (state.lists[id]) { state.currentListId = id; save(); }
}

export function addList(list) {
  state.lists[list.id] = list;
  if (!state.order.includes(list.id)) state.order.push(list.id);
  state.currentListId = list.id;
  state.removedBuiltins = state.removedBuiltins.filter((x) => x !== list.id);
  save();
}

export function deleteList(id) {
  if (!state.lists[id]) return;
  if (state.lists[id].builtin) state.removedBuiltins.push(id);
  delete state.lists[id];
  delete state.progress[id];
  delete state.fixed[id];
  delete state.stats[id];
  state.order = state.order.filter((x) => x !== id);
  if (state.currentListId === id) state.currentListId = state.order[0] || null;
  save();
}

// ---------- progress ----------

export function levelProgress(listId, level) {
  const p = state.progress[listId] || {};
  return p[level] || { completed: false, bestTimeLeft: null, bestRound: 0, plays: 0 };
}

export function isUnlocked(listId, level) {
  const i = LEVEL_IDS.indexOf(level);
  if (i <= 0) return true;
  return levelProgress(listId, LEVEL_IDS[i - 1]).completed;
}

/** Returns { newRecord, unlocked } */
export function recordResult(listId, level, { completed, timeLeft, round }) {
  const p = (state.progress[listId] = state.progress[listId] || {});
  const cur = levelProgress(listId, level);
  const next = { ...cur, plays: (cur.plays || 0) + 1, bestRound: Math.max(cur.bestRound || 0, round) };
  let newRecord = false;
  let unlocked = null;
  if (completed) {
    if (!cur.completed) {
      const i = LEVEL_IDS.indexOf(level);
      if (i < LEVEL_IDS.length - 1) unlocked = LEVEL_IDS[i + 1];
    }
    if (cur.bestTimeLeft == null || timeLeft > cur.bestTimeLeft) {
      newRecord = cur.bestTimeLeft != null;
      next.bestTimeLeft = timeLeft;
    }
    next.completed = true;
  }
  p[level] = next;
  save();
  return { newRecord, unlocked };
}

export function resetProgress() {
  state.progress = {};
  state.fixed = {};
  state.stats = {};
  save();
}

// ---------- fixed rounds (rounds 1–3 always the same words) ----------

export function fixedRounds(listId, level, words) {
  const f = (state.fixed[listId] = state.fixed[listId] || {});
  if (!fixedRoundsValid(level, f[level], words)) {
    f[level] = createFixedRounds(level, words);
    save();
  }
  return f[level];
}

// ---------- mistake statistics ----------

export function stats(listId) {
  return state.stats[listId] || {};
}

export function bumpStat(listId, wordId, ok) {
  const s = (state.stats[listId] = state.stats[listId] || {});
  const e = (s[wordId] = s[wordId] || { w: 0, r: 0 });
  if (ok) e.r++; else e.w++;
  save();
}

// ---------- settings ----------

export function settings() {
  return state.settings;
}

export function setSetting(key, value) {
  state.settings[key] = value;
  save();
}

export function timing(level) {
  const d = LEVELS[level];
  const o = state.settings.timing[level] || {};
  const clamp = (v, lo, hi, def) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def);
  return { start: clamp(o.start, 10, 600, d.start), bonus: clamp(o.bonus, 0, 120, d.bonus) };
}

export function setTiming(level, key, value) {
  const tm = (state.settings.timing[level] = state.settings.timing[level] || {});
  tm[key] = Number(value);
  save();
}

export function resetTiming() {
  state.settings.timing = {};
  save();
}
