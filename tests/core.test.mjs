import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  parseWordList, checkAnswer, answerVariants, displayForms, diffWords, closestForm, makeGaps,
  pickWords, pickDistractors, buildTypePlan, createFixedRounds, fixedRoundsValid, LEVELS,
  encodeData, decodeData, listToShare, listFromShare, primaryForm, answerDiff, variants, allVariants, gapTargets,
  ENDLESS, MOD_TYPES, stepValue, applyBonus, komboNext, rollModifier, placeNewPairs, trainingTypes, trainingPick,
} from '../js/core.js';
import { BUILTIN_LISTS } from '../js/builtin-lists.js';

const SAMPLE = `Vokabeln – Englisch / Deutsch

switch cabinet - Schaltschrank
colleague = workmate - Kollege / Kollegin
control panels - Bedienpanel(e)
to record - erfassen, aufnehmen
`;

test('parser skips the title and reads pairs', () => {
  const r = parseWordList(SAMPLE);
  assert.equal(r.words.length, 4);
  assert.deepEqual(r.skipped, ['Vokabeln – Englisch / Deutsch']);
  assert.equal(r.words[1].en, 'colleague = workmate');
  assert.equal(r.words[1].de, 'Kollege / Kollegin');
});

test('built-in list "KA1 E Vorbereitung" has the 36 words of the uploaded file', () => {
  assert.equal(BUILTIN_LISTS[0].name, 'KA1 E Vorbereitung');
  const r = parseWordList(BUILTIN_LISTS[0].text);
  assert.equal(r.words.length, 36);
  assert.equal(r.skipped.length, 4, 'title and 3 section headers are skipped');
  const upload = process.env.VOCAB_FILE;
  if (upload && existsSync(upload)) {
    const fromFile = parseWordList(readFileSync(upload, 'utf8'));
    assert.deepEqual(fromFile.words, r.words);
  }
});

test('parser handles tabs, semicolons and duplicates', () => {
  assert.equal(parseWordList('a\tb\nc\td\na\tb').words.length, 2);
  assert.equal(parseWordList('dog;Hund\ncat;Katze').words[1].de, 'Katze');
  assert.equal(parseWordList('just text').words.length, 0);
});

test('answer checking: case, synonyms, optional "to"', () => {
  assert.ok(checkAnswer('Colleague', 'colleague = workmate'));
  assert.ok(checkAnswer(' workmate ', 'colleague = workmate'));
  assert.ok(checkAnswer('record', 'to record'));
  assert.ok(checkAnswer('to record', 'to record'));
  assert.ok(checkAnswer('research  and development', 'research and development'));
  assert.ok(!checkAnswer('colleage', 'colleague = workmate'));
  assert.ok(!checkAnswer('', 'grinder'));
  assert.deepEqual(displayForms('Bedienpanel(e)'), ['Bedienpanel', 'Bedienpanele']);
  assert.deepEqual(answerVariants('studies (pl)'), ['studies'], 'grammar notes are not part of the answer');
  assert.ok(checkAnswer('everyday operations', 'everyday operations (pl)'));
  assert.ok(answerVariants('control panels').includes('control panels'));
});

test('diff shows missing, extra and wrong letters', () => {
  const d = diffWords('colleage', 'colleague');
  assert.equal(d.filter((o) => o.type !== 'ok').length, 1);
  assert.equal(d.find((o) => o.type === 'missing').b, 'u');
  const d2 = diffWords('grinderr', 'grinder');
  assert.equal(d2.filter((o) => o.type === 'extra').length, 1);
  const d3 = diffWords('stok', 'stock');
  assert.equal(d3.filter((o) => o.type !== 'ok').length, 1);
  assert.equal(closestForm('workmat', 'colleague = workmate'), 'workmate');
});

test('error comparison: whole wrong words vs. single letters', () => {
  const txt = (row) => row.map((x) => (x.sp ? ' ' : x.miss ? '_' : x.ch)).join('');
  const a = answerDiff('quality safe', 'quality control');
  assert.equal(txt(a.top), 'quality safe');
  assert.equal(txt(a.bot), 'quality control');
  assert.ok(a.top.slice(0, 7).every((x) => x.cls === ''), 'quality is correct');
  assert.ok(a.top.slice(8).every((x) => x.cls === 'wrongWord'), 'safe is marked as a whole');
  assert.ok(a.bot.slice(8).every((x) => x.cls === 'goodWord'));
  const b = answerDiff('colleage', 'colleague');
  assert.equal(b.top.filter((x) => x.miss).length, 1);
  assert.equal(b.bot.filter((x) => x.cls === 'good').map((x) => x.ch).join(''), 'u');
  const c = answerDiff('grinderr', 'grinder');
  assert.equal(c.top.filter((x) => x.cls === 'extra').length, 1);
  const d = answerDiff('researchand development', 'research and development');
  assert.equal(txt(d.bot), 'research␣and development', 'a missing space is shown as ␣');
  assert.equal(d.top.filter((x) => x.miss).length, 1);
});

test('several translations: variants, rounds without overlaps, safe distractors', () => {
  assert.deepEqual(variants('das Verzeichnis, der Bericht, die Dokumentation', 'de'), ['das Verzeichnis', 'der Bericht', 'die Dokumentation']);
  assert.deepEqual(variants('Kollege / Kollegin', 'de'), ['Kollege', 'Kollegin']);
  assert.deepEqual(variants('der/die Verbraucher/-in', 'de'), ['der/die Verbraucher/-in']);
  assert.deepEqual(variants('colleague = workmate', 'en'), ['colleague', 'workmate']);
  assert.equal(allVariants('colleague = workmate', 'en'), 'colleague / workmate');
  assert.deepEqual(gapTargets('colleague = workmate'), ['colleague', 'workmate']);
  const ws = [
    { id: 'a', en: 'record', de: 'das Verzeichnis, der Bericht' },
    { id: 'b', en: 'report', de: 'der Bericht' },
    { id: 'c', en: 'stock', de: 'der Bestand, das Lager' },
    { id: 'd', en: 'storage', de: 'die Lagerung' },
    { id: 'e', en: 'grinder', de: 'die Schleifmaschine' },
  ];
  for (let i = 0; i < 100; i++) {
    const ids = pickWords(ws, 5).map((w) => w.id);
    assert.ok(!(ids.includes('a') && ids.includes('b')), 'two words sharing "der Bericht" never in one round');
    const d = pickDistractors(ws, ws[0], 'en', 3, Math.random, 'de').map((w) => w.id);
    assert.ok(!d.includes('b'), '"report" is no wrong option when "der Bericht" is asked');
  }
});

test('levels: easy has choice, medium has gaps but no spelling, hard has spelling', () => {
  const types = (lvl) => new Set([...LEVELS[lvl].fixed, ...LEVELS[lvl].pool]);
  assert.deepEqual([...types('easy')].sort(), ['choice', 'pairs']);
  assert.deepEqual([...types('medium')].sort(), ['choice', 'gaps', 'pairs']);
  assert.deepEqual([...types('hard')].sort(), ['choice', 'gaps', 'pairs', 'spell']);
});

test('gaps never hide all letters and skip spaces', () => {
  for (let i = 0; i < 200; i++) {
    const w = 'research and development';
    const g = makeGaps(w, 0.5, false);
    assert.ok(g.length >= 2);
    for (const idx of g) assert.notEqual(w[idx], ' ');
    const g2 = makeGaps('stock', 0.35, true);
    assert.ok(!g2.includes(0));
    assert.ok(g2.length >= 2 && g2.length <= 4);
  }
  assert.equal(primaryForm('colleague = workmate'), 'colleague');
});

test('pickWords: unique, prefers unused, no duplicate texts', () => {
  const words = parseWordList(BUILTIN_LISTS[0].text).words;
  const used = new Set(words.slice(0, 30).map((w) => w.id));
  const p = pickWords(words, 6, { used });
  assert.equal(p.length, 6);
  assert.equal(new Set(p.map((w) => w.id)).size, 6);
  assert.equal(p.filter((w) => !used.has(w.id)).length, 6);
  const dup = [{ id: 'a', en: 'x', de: 'A' }, { id: 'b', en: 'y', de: 'A' }, { id: 'c', en: 'z', de: 'C' }];
  for (let i = 0; i < 50; i++) {
    const q = pickWords(dup, 3);
    assert.equal(new Set(q.map((w) => w.de)).size, q.length);
  }
});

test('distractors differ from the answer', () => {
  const words = parseWordList(BUILTIN_LISTS[0].text).words;
  const target = words.find((w) => w.en === 'stock');
  const d = pickDistractors(words, target, 'en', 3);
  assert.equal(d.length, 3);
  assert.ok(d.every((w) => w.en !== 'stock'));
});

test('plans and fixed rounds', () => {
  const words = parseWordList(BUILTIN_LISTS[0].text).words;
  for (const lvl of Object.keys(LEVELS)) {
    const plan = buildTypePlan(lvl);
    assert.equal(plan.length, LEVELS[lvl].rounds);
    assert.deepEqual(plan.slice(0, 3), LEVELS[lvl].fixed);
    const fixed = createFixedRounds(lvl, words);
    assert.ok(fixedRoundsValid(lvl, fixed, words));
    const all = fixed.flatMap((r) => r.ids);
    assert.equal(new Set(all).size, all.length);
  }
  assert.ok(!fixedRoundsValid('easy', [{ type: 'pairs', ids: ['nope'] }], words));
  for (const lvl of Object.keys(LEVELS)) {
    const first = createFixedRounds(lvl, words);
    const old = new Set(first.flatMap((r) => r.ids));
    const next = createFixedRounds(lvl, words, Math.random, old);
    assert.ok(fixedRoundsValid(lvl, next, words));
    assert.equal(next.flatMap((r) => r.ids).filter((id) => old.has(id)).length, 0, lvl + ': renewed rounds use other words');
  }
});

test('share codes round-trip and reject garbage', async () => {
  const words = parseWordList(BUILTIN_LISTS[0].text).words;
  const code = await encodeData(listToShare({ name: 'Test', words }));
  assert.ok(code.length < 1500, 'code length ' + code.length);
  const back = listFromShare(await decodeData(code));
  assert.equal(back.name, 'Test');
  assert.deepEqual(back.words, words);
  await assert.rejects(() => decodeData('xabc'));
  assert.throws(() => listFromShare({ v: 1, w: [] }));
});

test('time limit: the round bonus fills only up to the limit, Endlos has none', () => {
  assert.deepEqual(['easy', 'medium', 'hard'].map((l) => LEVELS[l].cap), [60, 40, 30]);
  for (const l of ['easy', 'medium', 'hard']) assert.equal(LEVELS[l].cap, LEVELS[l].start, l + ': limit = start time');
  assert.equal(applyBonus(25, 10, 30), 5);
  assert.equal(applyBonus(18, 10, 30), 10);
  assert.equal(applyBonus(30, 10, 30), 0);
  assert.equal(applyBonus(42, 10, 30), 0, 'above the limit (Extrazeit) nothing is taken away');
  assert.equal(applyBonus(95, 8, 0), 8, 'no limit in Endlos');
  assert.equal(ENDLESS.cap, 0);
});

test('Endlos: bonus gets smaller, Zeitraffer gets faster', () => {
  const bonus = (r) => stepValue(ENDLESS.bonusSteps, r);
  assert.deepEqual([1, 10, 11, 20, 21, 30, 31, 99].map(bonus), [10, 10, 8, 8, 6, 6, 5, 5]);
  assert.deepEqual([1, 20, 21, 50].map((r) => stepValue(ENDLESS.fastSteps, r)), [1.5, 1.5, 2, 2]);
  assert.equal(stepValue(LEVELS.hard.fastSteps, 9), 1.5);
});

test('Kombo: ×2 +5 s, ×3 +10 s, ×4 +15 s, ×5 +20 s; slow answers start again at ×1', () => {
  const run = (fasts) => {
    let mult = 0;
    let total = 0;
    const seen = [];
    for (const f of fasts) {
      const r = komboNext(mult, f);
      mult = r.mult;
      total += r.gain;
      seen.push(mult);
    }
    return { total, seen };
  };
  const all = run([true, true, true, true, true, true]);
  assert.deepEqual(all.seen, [1, 2, 3, 4, 5, 5], 'first answer ×1, then up to ×5');
  assert.equal(all.total, 20, '6 pairs: at most +20 s');
  assert.equal(run([true, true, true, true]).total, 15, 'choice (4 answers): at most ×4 = +15 s');
  const broken = run([true, true, false, true]);
  assert.deepEqual(broken.seen, [1, 2, 1, 2]);
  assert.equal(broken.total, 10);
});

test('special rounds: from round 4, never twice in a row, limited per game, only fitting games', () => {
  for (const lvl of ['easy', 'medium', 'hard']) {
    const cfg = LEVELS[lvl];
    for (let g = 0; g < 2000; g++) {
      let prev = null;
      let count = 0;
      for (let round = 1; round <= cfg.rounds; round++) {
        const type = round <= 3 ? cfg.fixed[round - 1] : cfg.pool[Math.floor(Math.random() * cfg.pool.length)];
        const m = rollModifier(cfg, round, type, prev, count);
        if (round <= 3) assert.equal(m, null);
        if (m) {
          assert.equal(prev, null, 'never two special rounds in a row');
          assert.ok(MOD_TYPES[m].includes(type), m + ' fits ' + type);
          assert.ok(cfg.mods.includes(m));
          count++;
        }
        prev = m;
      }
      assert.ok(count <= cfg.modMax);
    }
  }
  assert.ok(!LEVELS.easy.mods.includes('zeitraffer'), 'no Zeitraffer in Leicht');
  assert.equal(rollModifier(LEVELS.medium, 5, 'gaps', null, 0, () => 0), 'zeitraffer', 'gaps rounds can only be Zeitraffer');
  assert.equal(rollModifier(LEVELS.medium, 5, 'pairs', null, 0, () => 0.3), null, '25 % chance');
  // Endlos: the chance grows up to 50 %
  assert.equal(rollModifier(ENDLESS, 4, 'pairs', null, 0, () => 0.3), null);
  assert.notEqual(rollModifier(ENDLESS, 30, 'pairs', null, 99, () => 0.45), null);
  assert.equal(rollModifier(ENDLESS, 200, 'pairs', null, 99, () => 0.55), null);
});

test('Wirbel: new pairs go into the freed places, split like the rest of the board', () => {
  const ws = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  for (let i = 0; i < 200; i++) {
    const cols = placeNewPairs({ en: ['e1', 'e2', 'e3'], de: ['d1', 'd2', 'd3'] }, ws, false);
    assert.equal(cols.length, 6);
    assert.ok(cols.every((x) => (x.side === 'en' ? x.slot.startsWith('e') : x.slot.startsWith('d'))), 'columns: English stays left');
    assert.equal(new Set(cols.map((x) => x.slot)).size, 6);
    const mixed = placeNewPairs({ left: ['l1', 'l2', 'l3'], right: ['r1', 'r2', 'r3'] }, ws, true);
    for (const w of ws) {
      const two = mixed.filter((x) => x.w === w);
      assert.equal(two.length, 2);
      assert.notEqual(two[0].side, two[1].side);
      assert.ok(two.some((x) => x.slot[0] === 'l') && two.some((x) => x.slot[0] === 'r'), 'one tile left, one right');
    }
  }
});

test('Fehlertraining: three games per word, the same word never twice in a row', () => {
  assert.deepEqual(trainingTypes({ en: 'colleague', de: 'Kollege' }), ['choice', 'gaps', 'spell']);
  assert.deepEqual(trainingTypes({ en: 'ok', de: 'gut' }), ['choice', 'choice', 'spell'], 'too short for the gaps game');
  const q = [{ w: { id: 'a' } }, { w: { id: 'b' } }];
  assert.equal(trainingPick(q, 'a'), 1);
  assert.equal(trainingPick(q, 'b'), 0);
  assert.equal(trainingPick([{ w: { id: 'a' } }], 'a'), 0, 'only one word left');
});
