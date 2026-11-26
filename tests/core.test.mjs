import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  parseWordList, checkAnswer, answerVariants, displayForms, diffWords, closestForm, makeGaps,
  pickWords, pickDistractors, buildTypePlan, createFixedRounds, fixedRoundsValid, LEVELS,
  encodeData, decodeData, listToShare, listFromShare, primaryForm, answerDiff, variants, allVariants, gapTargets,
  ENDLESS, MOD_TYPES, stepValue, applyBonus, komboNext, rollModifier, fitTypeToMod, placeNewPairs, wirbelOrder, trainingTypes, trainingPick,
  trainingSession, TRAINING_MAX, streakInfo, bestStreak, missedDay, weekView, monthGrid, addDays, weekday, shiftMonth,
  BOMB, bombClock, bombLayout, listToText, articleItems, articleSession, ARTICLE_SESSION, ARTICLE_MIN,
  detectLangs, listLangs,
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

test('Kombo: ×2 +5 s, ×3 +10 s, ×4 +15 s, ×5 +20 s; slow answers go back to ×1', () => {
  const run = (fasts) => {
    let mult = 1;
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
  assert.deepEqual(all.seen, [2, 3, 4, 5, 5, 5], 'every fast answer one step up, ×5 is the top');
  assert.equal(all.total, 20, 'at most +20 s per round');
  assert.equal(run([true, true, true, true]).total, 20, 'choice (4 answers) can reach ×5 too');
  const broken = run([true, true, false, true]);
  assert.deepEqual(broken.seen, [2, 3, 1, 2]);
  assert.equal(broken.total, 15);
  assert.equal(run([false, false]).total, 0);
});

test('special rounds: from round 4, never twice in a row, limited per game, the game fits the special round', () => {
  for (const lvl of ['easy', 'medium', 'hard']) {
    const cfg = LEVELS[lvl];
    for (let g = 0; g < 2000; g++) {
      let prev = null;
      let count = 0;
      for (let round = 1; round <= cfg.rounds; round++) {
        const planned = round <= 3 ? cfg.fixed[round - 1] : cfg.pool[Math.floor(Math.random() * cfg.pool.length)];
        const m = rollModifier(cfg, round, planned, prev, count);
        if (round <= 3) assert.equal(m, null);
        if (m) {
          assert.equal(prev, null, 'never two special rounds in a row');
          assert.ok(cfg.mods.includes(m));
          assert.ok(MOD_TYPES[m].includes(fitTypeToMod(m, planned)), m + ' gets a game that fits');
          count++;
        }
        prev = m;
      }
      assert.ok(count <= cfg.modMax);
    }
  }
  assert.ok(!LEVELS.easy.mods.includes('zeitraffer'), 'no Zeitraffer in Leicht');
  assert.equal(fitTypeToMod('zeitraffer', 'gaps'), 'gaps', 'a fitting game stays');
  assert.equal(fitTypeToMod('wirbel', 'spell'), 'pairs');
  assert.ok(['pairs', 'choice'].includes(fitTypeToMod('kombo', 'gaps')));
  assert.equal(rollModifier(LEVELS.medium, 5, 'pairs', null, 0, () => 0.3), null, '25 % chance');
  // every special round equally often (Zeitraffer used to come in ~75 % of the cases)
  const seen = { wirbel: 0, kombo: 0, zeitraffer: 0, zeitbombe: 0 };
  for (let i = 0; i < 40000; i++) { const m = rollModifier(LEVELS.hard, 6, 'spell', null, 0); if (m) seen[m]++; }
  const total = Object.values(seen).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(seen)) assert.ok(Math.abs(seen[k] / total - 1 / 4) < 0.03, k + ': ' + (seen[k] / total).toFixed(2));
  assert.ok(!LEVELS.easy.mods.includes('zeitbombe'), 'no Zeitbombe in Leicht');
  assert.equal(fitTypeToMod('zeitbombe', 'spell'), 'pairs');
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

test('Wirbel shuffle: columns stay columns, mixed pairs stay split', () => {
  const pairs = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => ({ en: x + 'E', de: x + 'D' }));
  for (let i = 0; i < 200; i++) {
    const cols = wirbelOrder(pairs, false);
    assert.equal(cols.length, 12);
    assert.ok(cols.every((x, k) => x.endsWith(k % 2 === 0 ? 'E' : 'D')), 'English left, German right');
    const mixed = wirbelOrder(pairs, true);
    assert.equal(new Set(mixed).size, 12);
    for (const p of pairs) {
      const a = mixed.indexOf(p.en);
      const b = mixed.indexOf(p.de);
      assert.notEqual(a % 2, b % 2, 'one tile of every pair on each side');
    }
    const leftLangs = new Set(mixed.filter((_, k) => k % 2 === 0).map((x) => x.slice(-1)));
    assert.ok(leftLangs.size >= 1);
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

test('Fehlertraining: at most 10 words, the word of the last mistake first', () => {
  const ws = Array.from({ length: 15 }, (_, i) => ({ id: 'w' + i }));
  assert.equal(TRAINING_MAX, 10);
  assert.deepEqual(trainingSession(ws).map((w) => w.id), ws.slice(0, 10).map((w) => w.id));
  assert.deepEqual(trainingSession(ws, ['w12', 'w3']).slice(0, 3).map((w) => w.id), ['w12', 'w3', 'w0']);
  assert.equal(trainingSession(ws, ['w12']).length, 10);
  assert.equal(trainingSession(ws.slice(0, 4)).length, 4);
});

test('Tagesserie: days in a row, record, week and month view', () => {
  const today = '2026-11-22'; // a Sunday
  assert.equal(weekday(today), 6);
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  const days = ['2026-11-16', '2026-11-17', '2026-11-19', '2026-11-20', '2026-11-21'];
  let s = streakInfo(days, today);
  assert.equal(s.n, 3, 'today still open: the streak up to yesterday counts');
  assert.equal(s.doneToday, false);
  s = streakInfo([...days, today], today);
  assert.equal(s.n, 4);
  assert.equal(streakInfo(['2026-11-19', '2026-11-20'], today).n, 0, 'yesterday missed: streak broken');
  assert.equal(bestStreak(['2026-10-01', '2026-10-02', '2026-10-03', '2026-11-01']), 3);
  assert.equal(missedDay(['2026-11-16', '2026-11-17'], today), '2026-11-18');
  assert.equal(missedDay(['2026-11-21'], today), null, 'nothing missed yet');
  const week = weekView(days, today);
  assert.deepEqual(week.map((d) => d.code), ['done', 'done', 'empty', 'done', 'done', 'done', 'today-open']);
  assert.deepEqual(week.map((d) => d.old), [true, true, false, false, false, false, false], 'Mo/Tu are no longer part of the streak');
  assert.deepEqual(week.map((d) => d.link), [false, false, false, false, true, true, true]);
  assert.equal(week[6].wait, true, 'the link to today grows when today is played');
  const grid = monthGrid(days, '2026-11', today);
  assert.equal(grid.length, 6, 'always 6 rows');
  assert.equal(grid[0][6].day, 1, '1 November 2026 is a Sunday');
  const d20 = grid.flat().find((c) => c && c.day === 20);
  assert.ok(d20.lit && d20.joinLeft && d20.joinRight);
  assert.ok(grid.flat().find((c) => c && c.day === 22).today);
  assert.ok(grid.flat().find((c) => c && c.day === 23).future);
});

test('Zeitbombe: clock with hundredths, board split left/right', () => {
  assert.equal(bombClock(10000), '10,00');
  assert.equal(bombClock(6420), '06,42');
  assert.equal(bombClock(6421), '06,43', 'rounded up: 0,00 only when the time is really over');
  assert.equal(bombClock(1), '00,01');
  assert.equal(bombClock(0), '00,00');
  assert.equal(bombClock(-50), '00,00');
  assert.equal(BOMB.need, 5);
  assert.ok(BOMB.minWords >= BOMB.pairs * 2, 'enough words for two full boards');
  const ws = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  for (let i = 0; i < 300; i++) {
    const cells = bombLayout(ws);
    assert.equal(cells.length, 8);
    for (const w of ws) {
      const idx = cells.map((c, j) => (c.w === w ? j : -1)).filter((j) => j >= 0);
      assert.equal(idx.length, 2);
      assert.notEqual(idx[0] % 2, idx[1] % 2, 'one tile left, one right');
      assert.deepEqual(cells.filter((c) => c.w === w).map((c) => c.side).sort(), ['de', 'en']);
    }
  }
});

test('list editor: words as text and back without changes', () => {
  const words = parseWordList(BUILTIN_LISTS[0].text).words;
  const back = parseWordList(listToText(words)).words;
  assert.deepEqual(back.map((w) => w.id), words.map((w) => w.id));
  // a word with " – " inside: tab-separated instead
  const odd = [{ id: 'a', en: 'one – two', de: 'eins' }, { id: 'b', en: 'dog', de: 'Hund' }];
  const r = parseWordList(listToText(odd)).words;
  assert.deepEqual(r.map((w) => [w.en, w.de]), [['one – two', 'eins'], ['dog', 'Hund']]);
});

test('Artikel: nouns with der/die/das, rounds with the hard ones first', () => {
  const words = parseWordList(BUILTIN_LISTS[0].text).words;
  const items = articleItems(words);
  assert.ok(items.length >= ARTICLE_MIN);
  assert.ok(items.every((it) => ['der', 'die', 'das'].includes(it.article) && !/^(der|die|das)\b/i.test(it.noun)));
  const nouns = items.map((it) => it.noun);
  assert.ok(nouns.includes('Autowerkstatt') && nouns.includes('Lager') && nouns.includes('Bestand'));
  assert.ok(!nouns.some((n) => /\(|\//.test(n)), 'no plural marks or double forms: ' + nouns.join(','));
  assert.equal(items.find((it) => it.noun === 'Lager').article, 'das');
  const odd = articleItems([{ id: 'x', en: 'consumer', de: 'der/die Verbraucher/-in' }, { id: 'y', en: 'data', de: 'die Daten (Pl.)' }]);
  assert.equal(odd.length, 0);
  // a round: 12 nouns, every word at most once, nouns with mistakes first
  const hardKey = items[items.length - 1].key;
  for (let i = 0; i < 50; i++) {
    const s = articleSession(items, { [hardKey]: 2 });
    assert.equal(s.length, ARTICLE_SESSION);
    assert.equal(new Set(s.map((it) => it.w.id)).size, s.length, 'one noun per word');
    assert.ok(s.some((it) => it.key === hardKey), 'the noun with mistakes is in the round');
  }
  assert.equal(articleSession(items.slice(0, 3), {}).length, 3, 'small lists: all nouns');
});

test('list languages: German–Ukrainian, English–German, … are recognized; Artikel finds the German column', () => {
  const P = (t) => parseWordList(t).words;
  const deuk = P('der Tisch - стіл\ndie Lampe - лампа\ndas Fenster - вікно\nder Stuhl - стілець\ndie Tür - двері\ngehen - йти\nschön - гарний\ndas Haus - будинок');
  assert.deepEqual(detectLangs(deuk), { left: 'de', right: 'uk' });
  assert.equal(articleItems(deuk, detectLangs(deuk)).length, 6);
  assert.equal(articleItems(deuk, detectLangs(deuk)).find((it) => it.noun === 'Tisch').hint, 'стіл');
  assert.deepEqual(detectLangs(P('Tisch - стіл\nLampe - лампа\nFenster - вікно\nStuhl - стілець\nTür - двері\ngehen - йти\nschön - гарний\nHaus - будинок')), { left: 'de', right: 'uk' });
  assert.deepEqual(detectLangs(P('Table - стіл\nLamp - лампа\nWindow - вікно\nChair - стілець\nDoor - двері\nTo go - йти\nBeautiful - гарний\nHouse - будинок')), { left: 'en', right: 'uk' });
  assert.deepEqual(detectLangs(P('der Tisch - table\ndie Lampe - lamp\ndas Fenster - window\nder Stuhl - chair\ngehen - to go\nschön - beautiful')), { left: 'de', right: 'en' });
  assert.deepEqual(detectLangs(parseWordList(BUILTIN_LISTS[0].text).words), { left: 'en', right: 'de' });
  assert.deepEqual(listLangs({ words: deuk, langs: { left: 'en', right: 'uk' } }), { left: 'en', right: 'uk' }, 'the user’s choice wins');
  assert.equal(articleItems(deuk, { left: 'en', right: 'uk' }).length, 0, 'no German column, no Artikel');
  // the languages travel with a shared list
  const shared = listFromShare(listToShare({ name: 'DE–UK', words: deuk, langs: { left: 'de', right: 'uk' } }));
  assert.deepEqual(shared.langs, { left: 'de', right: 'uk' });
  assert.equal(listFromShare({ v: 1, n: 'x', w: [['a', 'b']], l: ['xx', 'de'] }).langs, undefined, 'unknown codes are ignored');
});
