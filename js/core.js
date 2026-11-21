// Pure logic: parsing, answer checking, word selection, encoding.
// No DOM access here, so it can be unit-tested in Node.

export const LEVEL_IDS = ['easy', 'medium', 'hard'];

// rounds: number of rounds; start: start time (s); bonus: seconds per finished round
// fixed: types of rounds 1–3 (same words every attempt); pool: types of the random rounds
export const LEVELS = {
  easy: {
    rounds: 6, start: 60, bonus: 10, mixed: false, gapRatio: 0.35,
    fixed: ['pairs', 'choice', 'pairs'],
    pool: ['pairs', 'pairs', 'choice'],
  },
  medium: {
    rounds: 10, start: 40, bonus: 10, mixed: true, gapRatio: 0.35,
    fixed: ['pairs', 'choice', 'pairs'],
    pool: ['pairs', 'pairs', 'choice', 'choice', 'gaps', 'gaps', 'gaps'],
  },
  hard: {
    rounds: 15, start: 30, bonus: 10, mixed: true, gapRatio: 0.5,
    fixed: ['pairs', 'choice', 'spell'],
    pool: ['pairs', 'pairs', 'pairs', 'choice', 'choice', 'gaps', 'gaps', 'gaps', 'spell', 'spell', 'spell', 'spell'],
  },
};

export const ROUND_SIZE = { pairs: 6, choice: 4, gaps: 2, spell: 1 };
export const MIN_WORDS = 4;

const SEPARATORS = ['\t', ' – ', ' — ', ' - ', ' | ', ';'];

export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function norm(s) {
  return String(s)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function clean(s) {
  return String(s).replace(/\s+/g, ' ').trim().replace(/^["']+|["']+$/g, '').trim();
}

export function wordId(en, de) {
  return 'w' + hashStr(norm(en) + '|' + norm(de));
}

/**
 * Parses "english - deutsch" lines. The separator used by most lines wins,
 * so a title like "Vokabeln – Englisch / Deutsch" is skipped.
 */
export function parseWordList(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  let sep = null;
  let bestCount = 0;
  for (const s of SEPARATORS) {
    const c = lines.filter((l) => l.includes(s)).length;
    if (c > bestCount) { bestCount = c; sep = s; }
  }
  const words = [];
  const skipped = [];
  if (!sep) {
    return { words, skipped: lines.map((l) => l.trim()).filter(Boolean), separator: null };
  }
  const seen = new Set();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(sep);
    if (idx < 0) { skipped.push(line); continue; }
    const en = clean(line.slice(0, idx).replace(/^\d+[.)]\s+/, ''));
    const de = clean(line.slice(idx + sep.length));
    if (!en || !de || en.length > 120 || de.length > 120) { skipped.push(line); continue; }
    const id = wordId(en, de);
    if (seen.has(id)) continue;
    seen.add(id);
    words.push({ id, en, de });
  }
  return { words, skipped, separator: sep };
}

const NOTE_RE = /\(\s*(?:pl|pl\.|plural|sg|sg\.|sing\.?|n|v|adj|adv|ae|be|us|uk|am|br|infml|fml|coll)\s*\)/gi;

function expandParens(p) {
  p = p.replace(NOTE_RE, '').replace(/\s+/g, ' ').trim();
  if (!/\([^)]*\)/.test(p)) return [p];
  const without = p.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const withIt = p.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
  return [without, withIt];
}

/** All accepted spellings in original case: "colleague = workmate" -> ["colleague", "workmate"] */
export function displayForms(text) {
  const parts = String(text).split(/\s*(?:=|\/|,|;)\s*/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) for (const e of expandParens(p)) if (e && !out.includes(e)) out.push(e);
  return out.length ? out : [String(text).trim()];
}

/** Normalized accepted answers; a leading "to " is optional. */
export function answerVariants(text) {
  const out = new Set();
  for (const f of displayForms(text)) {
    const n = norm(f);
    if (!n) continue;
    out.add(n);
    if (n.startsWith('to ') && n.length > 3) out.add(n.slice(3));
  }
  return [...out];
}

export function checkAnswer(input, text) {
  const n = norm(String(input).replace(/[.!]+$/, ''));
  if (!n) return false;
  return answerVariants(text).includes(n);
}

/**
 * The translations of one side as they are shown in the games.
 * German: "das Verzeichnis, der Bericht, die Dokumentation" -> 3 variants; "Kollege / Kollegin" -> 2;
 * "der/die Verbraucher/-in" stays one (slash without spaces). English also splits on "=".
 */
export function variants(text, side) {
  const re = side === 'en' ? /\s*[,;=]\s*|\s+\/\s+/ : /\s*[,;]\s*|\s+\/\s+/;
  const out = [];
  for (const p of String(text).split(re)) {
    const v = p.trim();
    if (v && !out.some((o) => norm(o) === norm(v))) out.push(v);
  }
  return out.length ? out : [String(text).trim()];
}

export function pickVariant(text, side, rnd = Math.random) {
  const v = variants(text, side);
  return v[Math.floor(rnd() * v.length)];
}

/** All correct answers of one side, for the error dialog. */
export function allVariants(text, side) {
  return variants(text, side).join(side === 'en' ? ' / ' : ', ');
}

/** English spellings that can be used for the missing-letters game (one is picked at random). */
export function gapTargets(en) {
  const out = [];
  for (const v of variants(en, 'en')) {
    const f = expandParens(v)[0];
    if (f && [...f].filter((c) => /\p{L}/u.test(c)).length >= 3 && !out.includes(f)) out.push(f);
  }
  return out.length ? out : [primaryForm(en)];
}

/** First spelling, used as the target for the missing-letters game. */
export function primaryForm(text) {
  return displayForms(text)[0];
}

function eqChar(a, b) {
  return a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();
}

export function editDistance(a, b) {
  return diffWords(a, b).filter((o) => o.type !== 'ok').length;
}

/**
 * Letter-by-letter alignment of what was typed vs. what was expected.
 * ops: ok | sub (wrong letter) | extra (typed too much) | missing (letter left out)
 */
export function diffWords(typed, expected) {
  const a = [...String(typed)];
  const b = [...String(expected)];
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = eqChar(a[i - 1], b[j - 1]) ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const same = eqChar(a[i - 1], b[j - 1]);
      if (dp[i][j] === dp[i - 1][j - 1] + (same ? 0 : 1)) {
        ops.push({ type: same ? 'ok' : 'sub', a: a[i - 1], b: b[j - 1] });
        i--; j--;
        continue;
      }
    }
    if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ type: 'extra', a: a[i - 1] });
      i--;
    } else {
      ops.push({ type: 'missing', b: b[j - 1] });
      j--;
    }
  }
  return ops.reverse();
}

/**
 * Comparison for the error dialog, compared word by word.
 * Returns two rows of tokens: { ch, cls } for a letter, { sp: true } between words,
 * { miss: true } for a letter that was left out (top row only).
 * cls: '' ok · 'bad' wrong letter · 'extra' letter too much · 'wrongWord' word is completely different ·
 *      'good' correct letter to learn · 'goodWord' the correct word for a completely different one
 * A word that is mostly wrong is marked as a whole instead of letter by letter.
 */
export function answerDiff(typed, expected) {
  const top = [];
  const bot = [];
  const push = (row, ch, cls) => row.push(ch === ' ' ? (cls ? { ch: '␣', cls } : { sp: true }) : { ch, cls });
  const word = (a, b) => {
    const ops = diffWords(a, b);
    const wrong = ops.filter((o) => o.type !== 'ok').length;
    if (wrong > Math.max([...a].length, [...b].length) / 2) {
      for (const ch of a) push(top, ch, a.trim() ? 'wrongWord' : '');
      for (const ch of b) push(bot, ch, b.trim() ? 'goodWord' : '');
      return;
    }
    for (const op of ops) {
      if (op.type === 'ok') { push(top, op.a, ''); push(bot, op.b, ''); }
      else if (op.type === 'sub') { push(top, op.a, 'bad'); push(bot, op.b, 'good'); }
      else if (op.type === 'extra') push(top, op.a, 'extra');
      else { top.push({ miss: true }); push(bot, op.b, 'good'); }
    }
  };
  const tw = String(typed).trim().split(/\s+/).filter(Boolean);
  const ew = String(expected).trim().split(/\s+/).filter(Boolean);
  if (tw.length === ew.length) {
    tw.forEach((a, i) => {
      if (i) { top.push({ sp: true }); bot.push({ sp: true }); }
      word(a, ew[i]);
    });
  } else {
    word(tw.join(' '), ew.join(' '));
  }
  return { top, bot };
}

/** The accepted spelling closest to what was typed (for the error animation). */
export function closestForm(typed, text) {
  const forms = displayForms(text);
  let best = forms[0];
  let bestD = Infinity;
  for (const f of forms) {
    const d = editDistance(norm(typed), norm(f));
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Indices of letters to hide in the missing-letters game. */
export function makeGaps(word, ratio, keepFirst, rnd = Math.random) {
  const chars = [...word];
  const letterIdx = chars.map((c, i) => (/\p{L}/u.test(c) ? i : -1)).filter((i) => i >= 0);
  const L = letterIdx.length;
  if (L < 2) return [];
  const candidates = keepFirst ? letterIdx.slice(1) : letterIdx.slice();
  let k = Math.round(L * ratio);
  k = Math.max(L >= 4 ? 2 : 1, k);
  k = Math.min(k, L - 1, candidates.length);
  return shuffle(candidates, rnd).slice(0, k).sort((x, y) => x - y);
}

function weightOf(stats, id) {
  const s = stats && stats[id];
  const wrong = s ? s.w || 0 : 0;
  return 1 + Math.min(wrong, 4) * 1.5;
}

/**
 * Picks n words: unused words first (weighted towards words with mistakes),
 * then already used ones. Never two words with the same English or German text in one round.
 */
export function pickWords(words, n, { used = new Set(), stats = {}, rnd = Math.random, filter = null } = {}) {
  const pool = filter ? words.filter(filter) : words.slice();
  const picked = [];
  const seenEn = new Set();
  const seenDe = new Set();
  const take = (cands) => {
    const bag = cands.map((w) => ({ w, weight: weightOf(stats, w.id) }));
    while (picked.length < n && bag.length) {
      const total = bag.reduce((s, x) => s + x.weight, 0);
      let r = rnd() * total;
      let idx = 0;
      for (; idx < bag.length - 1; idx++) {
        r -= bag[idx].weight;
        if (r <= 0) break;
      }
      const { w } = bag.splice(idx, 1)[0];
      const en = variants(w.en, 'en').map(norm);
      const de = variants(w.de, 'de').map(norm);
      if (en.some((x) => seenEn.has(x)) || de.some((x) => seenDe.has(x))) continue;
      en.forEach((x) => seenEn.add(x));
      de.forEach((x) => seenDe.add(x));
      picked.push(w);
    }
  };
  take(pool.filter((w) => !used.has(w.id)));
  if (picked.length < n) take(pool.filter((w) => used.has(w.id) && !picked.includes(w)));
  return picked;
}

/** Wrong options for multiple choice, preferring similar-looking words. */
export function pickDistractors(words, target, field, k, rnd = Math.random, promptField = null) {
  const tn = norm(target[field]);
  const side = field === 'en' ? 'en' : 'de';
  const tVars = new Set(variants(target[field], side).map(norm));
  const pVars = promptField ? new Set(variants(target[promptField], promptField === 'en' ? 'en' : 'de').map(norm)) : null;
  const overlaps = (w) => variants(w[field], side).some((v) => tVars.has(norm(v)))
    || (pVars && variants(w[promptField], promptField === 'en' ? 'en' : 'de').some((v) => pVars.has(norm(v))));
  const tokens = (s) => s.split(/[\s/=,]+/).filter((x) => x.length > 2);
  const tTokens = new Set(tokens(tn));
  const scored = words
    .filter((w) => w.id !== target.id && !overlaps(w))
    .map((w) => {
      const n = norm(w[field]);
      let s = rnd() * 2;
      for (const tok of tokens(n)) if (tTokens.has(tok)) s += 3;
      if (n[0] === tn[0]) s += 0.8;
      s -= Math.abs(n.length - tn.length) / 10;
      return { w, s };
    })
    .sort((x, y) => y.s - x.s);
  const out = [];
  const seen = new Set([tn]);
  for (const { w } of scored) {
    const n = norm(w[field]);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(w);
    if (out.length >= k) break;
  }
  return out;
}

/** Plan of round types: 3 fixed rounds + shuffled random rounds. */
export function buildTypePlan(levelId, rnd = Math.random) {
  const L = LEVELS[levelId];
  const rest = shuffle(L.pool.slice(), rnd).slice(0, L.rounds - L.fixed.length);
  return [...L.fixed, ...rest];
}

export function wordFilterFor(type) {
  if (type === 'gaps') return (w) => [...primaryForm(w.en)].filter((c) => /\p{L}/u.test(c)).length >= 3;
  return null;
}

/**
 * Words for the 3 fixed rounds of a level. They stay the same until the level is
 * passed; then new ones are drawn, avoiding the previous words while possible.
 */
export function createFixedRounds(levelId, words, rnd = Math.random, avoid = new Set()) {
  const L = LEVELS[levelId];
  const used = new Set(avoid);
  return L.fixed.map((type) => {
    const ws = pickWords(words, ROUND_SIZE[type], { used, rnd, filter: wordFilterFor(type) });
    ws.forEach((w) => used.add(w.id));
    return { type, ids: ws.map((w) => w.id) };
  });
}

export function fixedRoundsValid(levelId, fixed, words) {
  const L = LEVELS[levelId];
  if (!Array.isArray(fixed) || fixed.length !== L.fixed.length) return false;
  const ids = new Set(words.map((w) => w.id));
  const want = Math.min(words.length, ROUND_SIZE.pairs);
  return fixed.every((r, i) => {
    if (!r || r.type !== L.fixed[i] || !Array.isArray(r.ids) || !r.ids.length) return false;
    if (!r.ids.every((id) => ids.has(id))) return false;
    if (r.type === 'pairs' && r.ids.length < want) return false;
    return true;
  });
}

// ---------- sharing lists / backup codes ----------

function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipeBytes(bytes, stream) {
  const s = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function encodeData(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream !== 'undefined') {
    try {
      return 'z' + bytesToB64url(await pipeBytes(bytes, new CompressionStream('deflate-raw')));
    } catch { /* fall through */ }
  }
  return 'p' + bytesToB64url(bytes);
}

export async function decodeData(code) {
  const s = String(code || '').trim();
  const kind = s[0];
  const bytes = b64urlToBytes(s.slice(1));
  let raw;
  if (kind === 'z') raw = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
  else if (kind === 'p') raw = bytes;
  else throw new Error('bad code');
  return JSON.parse(new TextDecoder().decode(raw));
}

export function listToShare(list) {
  return { v: 1, n: list.name, w: list.words.map((w) => [w.en, w.de]) };
}

/** Validates untrusted share data and turns it into a list. */
export function listFromShare(data) {
  if (!data || data.v !== 1 || !Array.isArray(data.w)) throw new Error('bad list');
  const name = String(data.n || 'Liste').slice(0, 60).trim() || 'Liste';
  const words = [];
  const seen = new Set();
  for (const pair of data.w.slice(0, 2000)) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const en = clean(String(pair[0])).slice(0, 120);
    const de = clean(String(pair[1])).slice(0, 120);
    if (!en || !de) continue;
    const id = wordId(en, de);
    if (seen.has(id)) continue;
    seen.add(id);
    words.push({ id, en, de });
  }
  if (!words.length) throw new Error('empty list');
  return { name, words };
}

export function listIdFor(words) {
  return 'l' + hashStr(words.map((w) => w.id).sort().join(','));
}
