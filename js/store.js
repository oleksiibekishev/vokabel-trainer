// Everything is saved in this browser (localStorage). No server.
import { BUILTIN_LISTS, RETIRED_BUILTINS } from './builtin-lists.js';
import {
  parseWordList, LEVELS, LEVEL_IDS, createFixedRounds, fixedRoundsValid, dayKey, streakInfo, bestStreak, missedDay, STREAK_MILESTONES,
  trainingSession as trainingSessionOf,
} from './core.js';

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
    // Tagesserie: every day with a finished game (local "YYYY-MM-DD"); shown = the number last shown on the start screen
    days: [],
    streak: { best: 0, shown: 0, brokeOn: null },
    // Endlos opens for every list as soon as "Mittel" was passed in any list – and stays open
    // (also after "Fortschritt zurücksetzen" or deleting the list)
    unlocks: { endless: false },
    settings: { lang: null, sound: true, vibrate: true, timing: {}, iosHintDismissed: false },
  };
}

let state = defaults();

function sanitize(s) {
  const d = defaults();
  if (!s || typeof s !== 'object' || s.v !== 1) return d;
  const out = { ...d, ...s };
  out.settings = { ...d.settings, ...(s.settings || {}) };
  for (const k of ['lists', 'progress', 'fixed', 'stats', 'unlocks']) if (!out[k] || typeof out[k] !== 'object') out[k] = {};
  out.unlocks = { endless: out.unlocks.endless === true };
  out.days = Array.isArray(out.days) ? [...new Set(out.days.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort() : [];
  out.streak = { ...d.streak, ...(out.streak && typeof out.streak === 'object' ? out.streak : {}) };
  if (!Array.isArray(out.order)) out.order = [];
  if (!Array.isArray(out.removedBuiltins)) out.removedBuiltins = [];
  out.order = out.order.filter((id) => out.lists[id]);
  for (const id of Object.keys(out.lists)) if (!out.order.includes(id)) out.order.push(id);
  return out;
}

function mergeBuiltins() {
  for (const id of RETIRED_BUILTINS) {
    if (state.lists[id] && state.lists[id].builtin) {
      delete state.lists[id];
      delete state.progress[id];
      delete state.fixed[id];
      delete state.stats[id];
      state.order = state.order.filter((x) => x !== id);
    }
  }
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

/** Returns { newRecord, unlocked, endless } (endless: Endlos was opened just now) */
export function recordResult(listId, level, { completed, timeLeft, round }) {
  const p = (state.progress[listId] = state.progress[listId] || {});
  const cur = levelProgress(listId, level);
  const next = { ...cur, plays: (cur.plays || 0) + 1, bestRound: Math.max(cur.bestRound || 0, round) };
  let newRecord = false;
  let unlocked = null;
  let endless = false;
  if (completed) {
    if (!cur.completed) {
      const i = LEVEL_IDS.indexOf(level);
      if (i < LEVEL_IDS.length - 1) unlocked = LEVEL_IDS[i + 1];
    }
    if (level === 'medium' && !state.unlocks.endless) {
      state.unlocks.endless = true;
      endless = true;
    }
    if (cur.bestTimeLeft == null || timeLeft > cur.bestTimeLeft) {
      newRecord = cur.bestTimeLeft != null;
      next.bestTimeLeft = timeLeft;
    }
    next.completed = true;
  }
  p[level] = next;
  save();
  return { newRecord, unlocked, endless };
}

/** Levels, records, mistakes and the Tagesserie start again; Endlos stays open where it was open. */
export function resetProgress() {
  state.progress = {};
  state.fixed = {};
  state.stats = {};
  state.days = [];
  state.streak = { best: 0, shown: 0, brokeOn: null };
  pendingStreakAnim = null;
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

/** After a level is passed: rounds 1–3 get new words next time. */
export function renewFixedRounds(listId, level, words) {
  const f = (state.fixed[listId] = state.fixed[listId] || {});
  const old = new Set(((f[level]) || []).flatMap((r) => r.ids || []));
  f[level] = createFixedRounds(level, words, Math.random, old);
  save();
}

// ---------- Endlos ----------

/** Endlos: open for all lists once "Mittel" was passed in any list; it never closes again. */
export function endlessUnlocked() {
  if (state.unlocks.endless) return true;
  const passed = Object.keys(state.progress).some((id) => levelProgress(id, 'medium').completed);
  if (!passed) return false;
  state.unlocks.endless = true;
  save();
  return true;
}

export function endlessProgress(listId) {
  const p = state.progress[listId] || {};
  return p.endless || { best: 0, plays: 0 };
}

/** rounds = finished rounds. Returns { newRecord, best, prev } */
export function recordEndless(listId, rounds) {
  const p = (state.progress[listId] = state.progress[listId] || {});
  const cur = endlessProgress(listId);
  const newRecord = rounds > (cur.best || 0);
  p.endless = { best: Math.max(cur.best || 0, rounds), plays: (cur.plays || 0) + 1 };
  save();
  return { newRecord: newRecord && (cur.best || 0) > 0, best: p.endless.best, prev: cur.best || 0 };
}

// ---------- mistake statistics ----------

export function stats(listId) {
  return state.stats[listId] || {};
}

/** Words with mistakes, most mistakes first (for Fehlertraining). */
export function mistakeWords(listId, words) {
  const st = stats(listId);
  const mk = (id) => (st[id] ? st[id].w || 0 : 0);
  return words.filter((w) => mk(w.id) > 0).sort((a, b) => mk(b.id) - mk(a.id));
}

/** Fehlertraining: the word was answered right three times – its mistake counter starts at 0 again. */
export function clearMistakes(listId, wordId) {
  const e = state.stats[listId] && state.stats[listId][wordId];
  if (!e) return;
  e.w = 0;
  e.cleared = (e.cleared || 0) + 1;
  save();
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

/** Start time, round bonus and time limit of a level (own values from the settings or the defaults). */
export function timing(level) {
  const d = LEVELS[level];
  const o = state.settings.timing[level] || {};
  const clamp = (v, lo, hi, def) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def);
  const start = clamp(o.start, 10, 600, d.start);
  // without an own limit the limit follows the start time (the defaults are equal)
  const cap = Math.max(start, clamp(o.cap, 10, 600, start === d.start ? d.cap : start));
  return { start, bonus: clamp(o.bonus, 0, 120, d.bonus), cap };
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

// ---------- Tagesserie ----------

let pendingStreakAnim = null;

/** Current streak, record and played days. */
export function streak(today = dayKey()) {
  const info = streakInfo(state.days, today);
  return { ...info, today, best: Math.max(state.streak.best || 0, bestStreak(state.days), info.n), days: new Set(state.days) };
}

/**
 * A game was played to the end (won or lost; not "Beenden"): the first one of the day adds the day.
 * Returns { plus, n, milestone }; the +1 animation runs when the start screen is shown again.
 */
export function countToday(today = dayKey()) {
  if (state.days.includes(today)) return { plus: false, n: streak(today).n, milestone: false };
  const bestBefore = streak(today).best;
  state.days.push(today);
  state.days.sort();
  const now = streak(today);
  state.streak.best = Math.max(state.streak.best || 0, now.n);
  pendingStreakAnim = { from: now.n - 1, to: now.n, milestone: STREAK_MILESTONES.includes(now.n), bestBefore };
  save();
  return { plus: true, n: now.n, milestone: pendingStreakAnim.milestone };
}

/** The +1 that still has to be shown on the start screen (only once). */
export function takeStreakAnim() {
  const a = pendingStreakAnim;
  pendingStreakAnim = null;
  return a;
}

export function peekStreakAnim() {
  return pendingStreakAnim;
}

/**
 * Called when the start screen is shown: did the streak break since it was last shown?
 * Returns the number to animate down from (or 0) and remembers the new number.
 */
export function streakBreak(today = dayKey()) {
  const now = streak(today);
  const shown = state.streak.shown || 0;
  const from = shown > 0 && now.n === 0 ? shown : 0;
  if (from) state.streak.brokeOn = today;
  if (shown !== now.n || from) {
    state.streak.shown = now.n;
    save();
  }
  return { from, missed: missedDay(state.days, today), brokeToday: state.streak.brokeOn === today };
}

export function setStreakShown(n) {
  if (state.streak.shown !== n) { state.streak.shown = n; save(); }
}

/** Fehlertraining: the words of one session (at most 10, the given ones first). */
export function trainingWords(listId, words, focusIds = []) {
  return trainingSessionOf(mistakeWords(listId, words), focusIds);
}
