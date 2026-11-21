import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  parseWordList, checkAnswer, answerVariants, displayForms, diffWords, closestForm, makeGaps,
  pickWords, pickDistractors, buildTypePlan, createFixedRounds, fixedRoundsValid, LEVELS,
  encodeData, decodeData, listToShare, listFromShare, primaryForm,
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

test('built-in list has the 40 words of the uploaded file', () => {
  const r = parseWordList(BUILTIN_LISTS[0].text);
  assert.equal(r.words.length, 40);
  assert.equal(r.skipped.length, 0);
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
