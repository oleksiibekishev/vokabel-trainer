// End-to-end test in a phone-sized Chromium.
// Usage: node tests/e2e.cjs http://localhost:8765/ [screenshotDir]
const { chromium, devices } = require('playwright');
const path = require('path');
const assert = require('assert');

const BASE = process.argv[2] || 'http://localhost:8765/';
const SHOTS = process.argv[3] || null;

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

async function main() {
  const core = await import(path.join(__dirname, '../js/core.js'));
  const { BUILTIN_LISTS } = await import(path.join(__dirname, '../js/builtin-lists.js'));
  const words = core.parseWordList(BUILTIN_LISTS[0].text).words;
  // tiles and prompts show one random translation, so look words up by every variant
  const byEn = new Map();
  const byDe = new Map();
  for (const w of words) {
    for (const v of core.variants(w.en, 'en')) byEn.set(v, w);
    for (const v of core.variants(w.de, 'de')) byDe.set(v, w);
  }
  const isEn = (w, text) => core.variants(w.en, 'en').includes(text);
  const isDe = (w, text) => core.variants(w.de, 'de').includes(text);

  const browser = await chromium.launch();
  const iphone = { ...devices['iPhone 13'], deviceScaleFactor: 1 };
  const ctx = await browser.newContext({ ...iphone, serviceWorkers: 'block', locale: 'de-DE' });
  // special rounds are random – off for the normal flows, forced where they are tested
  await ctx.addInitScript(() => { window.__vtMods = 'off'; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE);
  // ---------- 0. Einführung on the first start: 7 steps, buttons and swipe, then never again ----------
  await page.waitForSelector('.intro.in');
  assert.equal(await page.locator('.ob-dots i').count(), 7);
  assert.equal(await page.locator('.ob-slide.on .ob-title').textContent(), 'Willkommen!');
  assert.equal(await page.locator('.ob-back').evaluate((e) => getComputedStyle(e).visibility), 'hidden', 'no "Zurück" on the first step');
  await shot(page, '00-intro');
  await page.locator('.ob-next').click();
  await page.waitForFunction(() => document.querySelector('.ob-slide.on .ob-title').textContent === 'Ein Timer pro Level');
  // swipe to the next step
  const tb = await page.locator('.ob-track').boundingBox();
  await page.mouse.move(tb.x + tb.width * 0.8, tb.y + 300);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(tb.x + tb.width * 0.8 - i * 30, tb.y + 302);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.ob-slide.on .ob-title').textContent.startsWith('Vier Spiele'));
  await page.locator('.ob-back').click();
  await page.waitForFunction(() => document.querySelector('.ob-slide.on .ob-title').textContent === 'Ein Timer pro Level');
  for (let i = 0; i < 5; i++) await page.locator('.ob-next').click();
  assert.equal((await page.locator('.ob-next').textContent()).trim(), 'Los geht’s', 'last step');
  assert.ok((await page.locator('.ob-slide.on').textContent()).includes('Listen & Wörter'));
  await page.locator('.ob-next').click();
  await page.waitForFunction(() => !document.querySelector('.intro'));
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('vokabeltrainer.v1')).settings.introSeen), 'seen');
  await page.reload();
  await page.waitForSelector('.level-card');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.intro').count(), 0, 'only once');
  assert.equal(await page.locator('.rules').count(), 0, 'no rules box on the start screen any more');
  assert.equal(await page.locator('.level-card').count(), 3);
  assert.ok(await page.locator('.level-card.level-medium').isDisabled(), 'medium locked at start');
  await shot(page, '01-home');

  // ---------- helpers ----------
  const roundText = () => page.locator('.game-round').textContent();
  const modalVisible = () => page.locator('.modal').count();

  async function checkPairColumns() {
    const grid = page.locator('.pairs.grid');
    if (!(await grid.count())) return;
    const cells = await grid.locator('.tile').evaluateAll((els) => els.map((e, i) => ({ i, side: e.dataset.side, text: e.textContent.trim() })));
    const de = cells.filter((c) => c.side === 'de');
    const en = cells.filter((c) => c.side === 'en');
    for (const e of en) {
      const partner = de.find((d) => isDe(byEn.get(e.text), d.text));
      assert.notEqual(e.i % 2, partner.i % 2, 'pair "' + e.text + '" must be split across both columns');
    }
    const leftLangs = new Set(cells.filter((c) => c.i % 2 === 0).map((c) => c.side));
    assert.equal(leftLangs.size, 2, 'left column mixes both languages');
  }

  const seq = () => page.evaluate(() => window.__vtGame.qSeq);
  const roundOver = (s0) => page.evaluate((s) => window.__vtGame.qSeq !== s || window.__vtGame.roundOver || !!document.querySelector('.modal'), s0);
  const waitBanner = () => page.waitForFunction(() => !window.__vtGame || !window.__vtGame.holds.has('mod'));

  async function solvePairs() {
    await checkPairColumns();
    const s0 = await seq();
    // several passes: in a Wirbel round 3 new pairs come in after the first 3
    for (let pass = 0; pass < 4; pass++) {
      const handles = await page.locator('.tile:not(.done):not(.wirbel-out)').elementHandles();
      const items = [];
      for (const el of handles) {
        items.push({ el, side: await el.getAttribute('data-side'), text: (await el.textContent()).trim() });
      }
      const en = items.filter((x) => x.side === 'en');
      const de = items.filter((x) => x.side === 'de');
      for (const e of en) {
        const w = byEn.get(e.text);
        const d = de.find((x) => isDe(w, x.text));
        if (!d) continue;
        await e.el.click();
        await d.el.click();
      }
      if (await roundOver(s0)) return;
      await page.waitForTimeout(300);
      await page.waitForFunction(() => !window.__vtGame.holds.has('wirbel'));
    }
  }

  async function solveChoice() {
    for (let q = 0; q < 4; q++) {
      if (await modalVisible()) return;
      const prompt = (await page.locator('main.board .choice .prompt-card .word').textContent()).trim();
      const fromDe = byDe.has(prompt);
      const w = fromDe ? byDe.get(prompt) : byEn.get(prompt);
      const roundBefore = await roundText();
      const options = await page.locator('main.board .option').elementHandles();
      let clicked = false;
      for (const o of options) {
        const text = (await o.textContent()).trim();
        if (fromDe ? isEn(w, text) : isDe(w, text)) { await o.click(); clicked = true; break; }
      }
      assert.ok(clicked, 'correct option is offered for "' + prompt + '"');
      await page.waitForTimeout(400);
      if ((await roundText()) !== roundBefore) return;
    }
  }

  async function gapsOne(mistake = false) {
      const prompt = (await page.locator('main.board .typing .prompt-card .word').textContent()).trim();
      const slots = page.locator('main.board .gapword .cell');
      const cnt = await slots.count();
      const shown = await slots.evaluateAll((els) => els.map((e) => (e.classList.contains('gap') ? null : e.textContent)));
      const target = core.gapTargets(byDe.get(prompt).en).map((f) => [...f].filter((c) => c !== ' '))
        .find((f) => f.length === cnt && f.every((c, i) => shown[i] === null || shown[i] === c));
      assert.ok(target, 'gap word is one of the English spellings');
      let letters = '';
      for (let i = 0; i < cnt; i++) {
        if ((await slots.nth(i).getAttribute('class')).includes('gap')) letters += target[i];
      }
      if (mistake) letters = letters.slice(0, -1) + (letters.slice(-1) === 'x' ? 'y' : 'x');
      await page.locator('main.board .gap-input').fill(letters);
      await page.keyboard.press('Enter');
  }

  async function solveGaps(mistake = false) {
    for (let k = 0; k < 2; k++) {
      const roundBefore = await roundText();
      await gapsOne(mistake);
      await page.waitForTimeout(150);
      if (mistake || (await roundText()) !== roundBefore) return;
    }
  }

  /** One multiple-choice question (right or wrong answer). */
  async function choiceOne(wrong = false) {
    const prompt = (await page.locator('main.board .choice .prompt-card .word').textContent()).trim();
    const fromDe = byDe.has(prompt);
    const w = fromDe ? byDe.get(prompt) : byEn.get(prompt);
    for (const o of await page.locator('main.board .option').elementHandles()) {
      const text = (await o.textContent()).trim();
      const right = fromDe ? isEn(w, text) : isDe(w, text);
      if (right !== wrong) { await o.click(); return; }
    }
    throw new Error('no option for ' + prompt);
  }

  async function solveSpell(typo = null) {
    const prompt = (await page.locator('main.board .typing .prompt-card .word').textContent()).trim();
    const w = byDe.get(prompt);
    await page.locator('main.board .spell-input').fill(typo || core.displayForms(w.en)[0].toUpperCase());
    await page.locator('main.board .typing .btn.primary').click();
  }

  const boardType = async () => (await page.locator('.board').getAttribute('class')).replace('board board-', '').split(' ')[0];

  async function playRound() {
    await waitBanner();
    const type = await boardType();
    if (type === 'pairs') await solvePairs();
    else if (type === 'choice') await solveChoice();
    else if (type === 'gaps') await solveGaps();
    else await solveSpell();
    return type;
  }

  async function playLevel(level, label) {
    await page.locator('.level-card.level-' + level).click();
    await page.waitForSelector('.board');
    const total = Number((await roundText()).split('/')[1]);
    const seen = [];
    for (let r = 1; r <= total; r++) {
      assert.equal(await roundText(), `Runde ${r}/${total}`);
      if (r === 2) await shot(page, label + '-round2');
      seen.push(await playRound());
      if (r < total) {
        await page.waitForFunction((rr) => document.querySelector('.game-round').textContent.startsWith('Runde ' + rr), r + 1);
      }
    }
    await page.waitForSelector('.modal-win');
    const layering = await page.evaluate(() => {
      const layer = document.querySelector('.confetti-layer');
      const wrap = document.querySelector('.modal-wrap');
      return layer && layer.parentElement === document.body && Number(getComputedStyle(layer).zIndex) > Number(getComputedStyle(wrap).zIndex);
    });
    assert.ok(layering, 'confetti is drawn above the result dialog');
    await page.waitForTimeout(500);
    await shot(page, label + '-won');
    return seen;
  }

  // ---------- 1. wrong pair resets to round 1 ----------
  await page.locator('.level-card.level-easy').click();
  await page.waitForSelector('.tile');
  const firstRound = (await page.locator('.tile[data-side=en]').allTextContents()).sort();
  await shot(page, '02-easy-round1');
  // timer runs
  const t0 = Number(await page.locator('.timer .num').textContent());
  await page.waitForTimeout(2200);
  const t1 = Number(await page.locator('.timer .num').textContent());
  assert.ok(t1 < t0, 'timer counts down (after the short pause while the game comes in)');
  // select en, switch selection to another en (no error), then wrong de
  const enTiles = page.locator('.tile[data-side=en]');
  await enTiles.nth(0).click();
  await enTiles.nth(1).click();
  assert.equal(await page.locator('.tile.sel').count(), 1, 'same-side tap switches selection');
  const selText = (await enTiles.nth(1).textContent()).trim();
  let wrongDe = null;
  for (const d of await page.locator('.tile[data-side=de]').elementHandles()) {
    if (!isDe(byEn.get(selText), (await d.textContent()).trim())) { wrongDe = d; break; }
  }
  await wrongDe.click();
  await page.waitForSelector('.modal-fail');
  assert.equal(await page.locator('.modal-fail .res-row').count(), 3);
  await page.waitForTimeout(900);
  await shot(page, '03-wrong-pair');
  await page.locator('.modal .btn', { hasText: 'Nochmal' }).click();
  await page.waitForSelector('.tile');
  assert.equal(await roundText(), 'Runde 1/6');
  const firstRoundAgain = (await page.locator('.tile[data-side=en]').allTextContents()).sort();
  assert.deepEqual(firstRoundAgain, firstRound, 'round 1 has the same words every attempt');
  assert.ok(Number(await page.locator('.timer .num').textContent()) >= 59, 'restart begins with the full 60 s');
  await page.locator('.game-top .icon-btn').click();
  assert.ok((await page.locator('.modal').textContent()).includes('Tagesserie') === false, 'today already counts – no hint in the quit dialog');
  await page.locator('.modal .btn', { hasText: 'Beenden' }).click();
  await page.waitForSelector('.home');
  // the lost game above was the first finished game today: Tagesserie +1
  await page.waitForFunction(() => document.querySelector('.streak-chip .roll')?.textContent === '1' && document.querySelector('.streak-hint.done'));
  assert.ok((await page.locator('.streak-hint').textContent()).includes('Heute geschafft'));
  assert.equal(await page.locator('.week .day.today.done').count(), 1, 'today is filled in the week');
  await shot(page, '03b-streak-plus');

  // ---------- 2. play easy to the end ----------
  const easyTypes = await playLevel('easy', '04-easy');
  assert.ok(easyTypes.every((x) => x === 'pairs' || x === 'choice') && easyTypes.includes('choice'), 'easy: pairs and choice');
  assert.ok((await page.locator('.modal-win').textContent()).includes('Mittel'), 'unlock message');
  await page.locator('.modal .btn', { hasText: 'Menü' }).click();
  await page.waitForSelector('.home');
  assert.ok(!(await page.locator('.level-card.level-medium').isDisabled()), 'medium unlocked');
  await page.locator('.level-card.level-easy').click();
  await page.waitForSelector('.tile');
  const renewed = (await page.locator('.tile[data-side=en]').allTextContents()).map((x) => x.trim());
  assert.equal(renewed.filter((w) => firstRound.map((x) => x.trim()).includes(w)).length, 0, 'after passing, round 1 has new words');
  await page.locator('.game-top .icon-btn').click();
  await page.locator('.modal .btn', { hasText: 'Beenden' }).click();
  await page.waitForSelector('.home');
  await shot(page, '05-home-after-easy');

  // ---------- 3. medium: mixed grid + all game types ----------
  const medTypes = await playLevel('medium', '06-medium');
  assert.ok(medTypes.includes('gaps') && medTypes.includes('choice') && !medTypes.includes('spell'), 'medium: gaps, no spelling');
  assert.ok((await page.locator('.modal-win').textContent()).includes('Endlos'), 'Endlos is opened for all lists');
  assert.ok((await page.locator('.modal-win .st-chip').textContent()).includes('1 Tag'), 'Tagesserie chip in the result');
  await page.locator('.modal .btn', { hasText: 'Menü' }).click();
  await page.waitForSelector('.home');

  // ---------- 4. spelling mistake shows the letter diff ----------
  await page.evaluate(() => { window.__vtTiming = { hard: { start: 300 } }; });
  await page.locator('.level-card.level-hard').click();
  await page.waitForSelector('.board');
  for (let r = 1; r <= 2; r++) {
    await playRound();
    await page.waitForFunction((rr) => document.querySelector('.game-round').textContent.startsWith('Runde ' + rr), r + 1);
  }
  assert.equal(await page.locator('.board').getAttribute('class'), 'board board-spell', 'hard round 3 is spelling');
  const prompt = (await page.locator('.typing .prompt-card .word').textContent()).trim();
  const right = core.displayForms(byDe.get(prompt).en)[0];
  const typo = right.length > 4 ? right.slice(0, 2) + right.slice(3) + 'x' : right + 'x';
  assert.ok(!(await page.locator('.board').textContent()).includes('null'), 'no stray text on the board');
  await solveSpell(typo);
  await page.waitForSelector('.modal-fail .answer-diff');
  assert.ok(await page.locator('.diff-row.yours .ch.miss, .diff-row.yours .ch.bad, .diff-row.yours .ch.extra, .diff-row.yours .ch.wrongWord').count() >= 1);
  await page.waitForTimeout(1500);
  await shot(page, '07-spell-diff');
  await page.locator('.modal .btn', { hasText: 'Menü' }).click();
  await page.waitForSelector('.home');

  // ---------- 5. gaps mistake ----------
  let gapsFound = false;
  for (let attempt = 0; attempt < 6 && !gapsFound; attempt++) {
    await page.locator('.level-card.level-hard').click();
    await page.waitForSelector('.board');
    for (let r = 1; r <= 15; r++) {
      const cls = await page.locator('.board').getAttribute('class');
      if (cls.includes('board-gaps')) {
        await shot(page, '08-gaps');
        await solveGaps(true);
        await page.waitForSelector('.modal-fail .answer-diff');
        await page.waitForTimeout(1200);
        await shot(page, '09-gaps-diff');
        gapsFound = true;
        break;
      }
      await playRound();
      if (r < 15) await page.waitForFunction((rr) => document.querySelector('.game-round').textContent.startsWith('Runde ' + rr), r + 1);
    }
    await page.locator('.modal .btn', { hasText: 'Menü' }).click();
    await page.waitForSelector('.home');
  }
  assert.ok(gapsFound, 'gaps round tested');

  // ---------- 6. time runs out ----------
  await page.evaluate(() => { window.__vtTiming = { easy: { start: 10 } }; });
  await page.locator('.level-card.level-easy').click();
  await page.waitForSelector('.modal-fail', { timeout: 15000 });
  assert.ok((await page.locator('.modal').textContent()).includes('Zeit abgelaufen'));
  await shot(page, '10-timeup');
  await page.locator('.modal .btn', { hasText: 'Menü' }).click();
  await page.waitForSelector('.home');

  // ---------- 7. lists & words screen, add a list (name is required), share link import ----------
  await page.locator('.list-card .btn', { hasText: 'Listen & Wörter' }).click();
  await page.waitForSelector('.list-rows');
  assert.equal(await page.locator('.word-row').count(), words.length, 'words of the selected list are shown');
  const placement = await page.evaluate(() => {
    const rows = document.querySelector('.list-rows');
    const btn = document.querySelector('.add-list-btn');
    const wordsSec = document.querySelector('.words-section');
    return rows.nextElementSibling === btn && btn.nextElementSibling === wordsSec;
  });
  assert.ok(placement, '"Liste hinzufügen" sits right under the lists, above the words');
  await page.locator('.btn', { hasText: 'Liste hinzufügen' }).click();
  await page.waitForSelector('#list-text');
  const order = await page.evaluate(() => [...document.querySelectorAll('#list-name, #list-text, label[for=file-in]')].map((e) => e.id || 'file'));
  assert.deepEqual(order, ['list-name', 'list-text', 'file'], 'name first, then text, then file');
  await page.locator('#list-text').fill('Wortliste\n\ndog - Hund\ncat - Katze\nhouse - Haus\ntree - Baum\ncar - Auto\nnoline');
  assert.ok((await page.locator('.preview').textContent()).includes('5 Wortpaare'));
  assert.equal(await page.locator('#list-name').inputValue(), '', 'no automatic name');
  assert.ok(await page.locator('.btn', { hasText: 'Liste speichern' }).isDisabled(), 'cannot save without a name');
  assert.ok(await page.locator('.field-error').isVisible(), 'asks for a name');
  await page.locator('#list-name').fill('   ');
  assert.ok(await page.locator('.btn', { hasText: 'Liste speichern' }).isDisabled(), 'blank name is not a name');
  await page.locator('#list-name').fill('Testliste');
  await shot(page, '11-new-list');
  await page.locator('.btn', { hasText: 'Liste speichern' }).click();
  await page.waitForSelector('.list-rows');
  assert.ok((await page.locator('.list-row.active').textContent()).includes('Testliste'), 'back on the lists screen, new list selected');
  assert.equal(await page.locator('.word-row').count(), 5);
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.home') && !document.querySelector('.sheet') && !document.documentElement.classList.contains('busy'));
  assert.equal((await page.locator('.list-name').textContent()).trim(), 'Testliste');
  assert.ok(await page.locator('.level-card.level-medium').isDisabled(), 'new list starts locked');

  const shareUrl = await page.evaluate(async () => {
    const core = await import('./js/core.js');
    const s = JSON.parse(localStorage.getItem('vokabeltrainer.v1'));
    const list = s.lists[s.currentListId];
    return location.origin + location.pathname + '#l=' + (await core.encodeData(core.listToShare(list)));
  });
  const ctx2 = await browser.newContext({ ...iphone, serviceWorkers: 'block', locale: 'uk-UA' });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push(String(e)));
  await p2.goto(shareUrl);
  await p2.waitForSelector('.modal');
  assert.equal(await p2.locator('.intro').count(), 0, 'a shared list comes first, the Einführung after it');
  assert.ok((await p2.locator('.modal').textContent()).includes('Testliste'));
  await shot(p2, '12-import-uk');
  await p2.locator('.modal .btn.primary').click();
  await p2.waitForFunction(() => document.querySelector('.list-name')?.textContent === 'Testliste');
  await p2.waitForSelector('.intro.in');
  assert.ok((await p2.locator('.ob-slide.on').textContent()).includes('Вітаю'), 'Einführung in Ukrainian');
  await p2.locator('.ob-skip').click();
  await p2.waitForFunction(() => !document.querySelector('.intro'));
  assert.ok(!p2.url().includes('#l='), 'hash cleared');
  await shot(p2, '13-home-uk');
  await ctx2.close();

  // ---------- 7b. edit a list, share it with a short link, pull a sheet down to close it ----------
  await page.locator('.list-card .btn', { hasText: 'Listen & Wörter' }).click();
  await page.waitForSelector('.sheet .list-rows');
  await page.waitForFunction(() => !document.documentElement.classList.contains('busy'));
  await page.locator('.list-row', { hasText: 'Testliste' }).locator('.icon-btn[aria-label*="bearbeiten"]').click();
  await page.waitForSelector('#list-text');
  assert.equal(await page.locator('#list-name').inputValue(), 'Testliste', 'name filled in');
  assert.equal((await page.locator('#list-text').inputValue()).split('\n').length, 5, 'words filled in, one per line');
  assert.ok(await page.locator('.btn', { hasText: 'Änderungen speichern' }).isDisabled(), 'nothing changed yet');
  const txt = (await page.locator('#list-text').inputValue()).split('\n').filter((l) => !l.startsWith('car')).concat(['bird – Vogel']).join('\n');
  await page.locator('#list-text').fill(txt);
  await page.locator('#list-name').fill('Testliste neu');
  assert.ok((await page.locator('.preview-diff').textContent()).includes('neu: 1 · entfernt: 1'));
  await shot(page, '11b-edit-list');
  await page.locator('.btn', { hasText: 'Änderungen speichern' }).click();
  await page.waitForFunction(() => !document.querySelector('#list-text') && document.querySelector('.list-row.active')?.textContent.includes('Testliste neu'));
  const words2 = await page.locator('.word-row .w-en').allTextContents();
  assert.ok(words2.includes('bird') && !words2.includes('car') && words2.length === 5, 'words changed: ' + words2.join(','));
  // share: a short link from is.gd (faked here), the long one when that fails
  await page.route('https://is.gd/**', (route) => {
    const u = new URL(route.request().url());
    assert.ok(u.searchParams.get('url').includes('#l='), 'the long link goes to is.gd');
    route.fulfill({ contentType: 'application/javascript', body: u.searchParams.get('callback') + '({"shorturl":"https://is.gd/AbC123"})' });
  });
  await page.locator('.list-row.active .icon-btn[aria-label*="teilen"]').click();
  await page.waitForFunction(() => document.querySelector('.share-url')?.textContent === 'is.gd/AbC123');
  assert.ok(!(await page.locator('.share-actions .btn.outline').isDisabled()), 'copy ready');
  await page.waitForTimeout(300);
  await shot(page, '11c-share');
  await page.locator('.modal .btn', { hasText: 'Fertig' }).click();
  await page.waitForFunction(() => !document.querySelector('.modal'));
  await page.unroute('https://is.gd/**');
  await page.route('https://is.gd/**', (route) => {
    const cb = new URL(route.request().url()).searchParams.get('callback');
    route.fulfill({ contentType: 'application/javascript', body: cb + '({"errorcode":3,"errormessage":"Rate limit"})' });
  });
  // (the short link of a list is remembered, so another list here)
  await page.locator('.list-row', { hasText: 'KA1' }).locator('.icon-btn[aria-label*="teilen"]').click();
  await page.waitForFunction(() => document.querySelector('.share-note')?.textContent.includes('nicht möglich'));
  assert.ok((await page.locator('.share-url').textContent()).includes('#l='), 'long link as a fallback');
  await page.locator('.modal .btn', { hasText: 'Fertig' }).click();
  await page.waitForFunction(() => !document.querySelector('.modal'));
  await page.unroute('https://is.gd/**');
  // pull down: from the content nothing happens, a short pull springs back, a long one from the top closes
  const sheetBox = await page.locator('.sheet').boundingBox();
  // a slow pull (a quick flick closes the sheet even when it is short)
  const drag = async (x, y, dy) => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(x, y + (dy * i) / 8); await page.waitForTimeout(40); }
    await page.waitForTimeout(120);
    await page.mouse.up();
  };
  await drag(sheetBox.x + 100, sheetBox.y + 260, 300);
  await page.waitForTimeout(400);
  assert.ok(await page.locator('.sheet').count(), 'dragging the content does not close the sheet');
  await drag(sheetBox.x + 200, sheetBox.y + 6, 60);
  await page.waitForTimeout(400);
  assert.ok(await page.locator('.sheet').count(), 'a short pull springs back');
  assert.equal(await page.locator('.sheet').evaluate((e) => e.style.transform), '', 'back at the top');
  await drag(sheetBox.x + 200, sheetBox.y + 30, 380);
  await page.waitForFunction(() => document.querySelector('.home') && !document.querySelector('.sheet') && !document.documentElement.classList.contains('busy'));

  // words screen + settings render
  await page.locator('.list-card .btn', { hasText: 'Listen & Wörter' }).click();
  await page.locator('.list-main', { hasText: 'KA1 E Vorbereitung' }).click();
  await page.waitForFunction(() => document.querySelector('.list-row.active')?.textContent.includes('KA1 E Vorbereitung'));
  assert.equal(await page.locator('.words-section .segmented').count(), 0, 'no sort switch');
  const missCounts = await page.locator('.word-row .miss').evaluateAll((els) => els.map((e) => Number(e.textContent.replace(/\D/g, '')) || 0));
  assert.deepEqual(missCounts, missCounts.slice().sort((a, b) => b - a), 'hardest words first');
  await shot(page, '14-words');
  assert.ok(await page.locator('.miss:not(.none)').count() >= 1, 'mistakes are counted');
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.home') && !document.querySelector('.sheet') && !document.documentElement.classList.contains('busy'));
  await page.locator('.home-top .icon-btn').click();
  await page.waitForSelector('.switch');
  await shot(page, '15-settings');
  await page.locator('.btn', { hasText: 'Sicherungscode erstellen' }).click();
  const code = (await page.locator('.code-box output').textContent()).trim();
  assert.ok(code.startsWith('z') || code.startsWith('p'));

  // ---------- 8a. time limit, Kombo and Extrazeit (Leicht, Kombo forced in round 4) ----------
  const setState = (fn) => page.evaluate(fn);
  await page.evaluate(() => { window.__vtTiming = undefined; });
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.home') && !document.querySelector('.sheet') && !document.documentElement.classList.contains('busy'));
  assert.ok((await page.locator('.level-card.level-hard .level-meta').textContent()).includes('max. 30 s'), 'level card shows the limit');
  await page.evaluate(() => { window.__vtMods = { 4: 'kombo' }; });
  await page.locator('.level-card.level-easy').click();
  await page.waitForSelector('.tile');
  await playRound();
  await page.waitForSelector('.bonus-chip.capped');
  assert.ok((await page.locator('.bonus-chip').textContent()).includes('voll'), 'bonus only fills up to the limit');
  await shot(page, '19-zeit-voll');
  assert.ok(await page.evaluate(() => window.__vtGame.timeLeft <= 60000), 'never above 60 s in Leicht');
  for (let r = 2; r <= 3; r++) {
    await page.waitForFunction((rr) => document.querySelector('.game-round').textContent.startsWith('Runde ' + rr), r);
    await playRound();
  }
  await page.waitForFunction(() => document.querySelector('.game-round').textContent.startsWith('Runde 4'));
  await page.waitForSelector('.mod-banner.mod-kombo');
  await shot(page, '20-kombo-banner');
  await waitBanner();
  assert.equal(await page.locator('.time-slot .multi').textContent(), '×1', 'multiplier next to the timer');
  await page.evaluate(() => {
    window.__glows = 0;
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('kombo-glow')) window.__glows++; })))
      .observe(document.querySelector('.fx-layer'), { childList: true });
  });
  await playRound();
  assert.ok(await page.evaluate(() => window.__glows >= 2), 'the tiles glow blue when a Kombo step is earned');
  const reserve = await page.evaluate(() => window.__vtGame.reserve);
  assert.ok(reserve >= 15000, 'fast answers in a Kombo round give at least +15 s Extrazeit, got ' + reserve);
  await page.waitForFunction(() => document.querySelector('.game-round').textContent.startsWith('Runde 5'));
  await page.waitForTimeout(600);
  assert.ok(await page.locator('.extra-chip').isVisible(), 'Extrazeit is shown below the time bar');
  assert.ok(await page.evaluate(() => window.__vtGame.timeLeft <= 60000), 'Extrazeit is kept apart from the normal time');
  await shot(page, '21-extrazeit');
  await page.evaluate(() => { window.__vtGame.timeLeft = 200; });
  await page.waitForSelector('.callout.extra');
  assert.ok(await page.evaluate(() => window.__vtGame.timeLeft > 10000 && !window.__vtGame.ended), 'Extrazeit takes over when the time is up');
  await page.locator('.game-top .icon-btn').click();
  await page.locator('.modal .btn', { hasText: 'Beenden' }).click();
  await page.waitForSelector('.home');

  // ---------- 8b. Wirbel: after 3 pairs, 3 new ones come in the same places ----------
  await page.evaluate(() => { window.__vtMods = { 4: 'wirbel' }; });
  await page.locator('.level-card.level-easy').click();
  await page.waitForSelector('.tile');
  for (let r = 1; r <= 3; r++) {
    await playRound();
    await page.waitForFunction((rr) => document.querySelector('.game-round').textContent.startsWith('Runde ' + rr), r + 1);
  }
  await page.waitForSelector('.mod-banner.mod-wirbel');
  await shot(page, '22-wirbel-banner');
  await waitBanner();
  assert.equal(await page.locator('.mod-chip').textContent(), 'Wirbel');
  assert.equal(await page.locator('.pairs-count').textContent(), 'Paare 0/9');
  const firstEn = (await page.locator('.tile[data-side=en]').allTextContents()).map((x) => x.trim());
  const enTilesW = await page.locator('.tile[data-side=en]').elementHandles();
  for (let i = 0; i < 3; i++) {
    const e = enTilesW[i];
    const w = byEn.get((await e.textContent()).trim());
    for (const d of await page.locator('.tile[data-side=de]:not(.done)').elementHandles()) {
      if (isDe(w, (await d.textContent()).trim())) { await e.click(); await d.click(); break; }
    }
  }
  await page.waitForSelector('.tile.new');
  const enterAnims = await page.evaluate(() => [...document.querySelectorAll('.tile.new')].flatMap((el) => el.getAnimations().map((a) => a.animationName)));
  assert.ok(enterAnims.includes('enter'), 'new tiles really animate in, got ' + enterAnims);
  await page.waitForSelector('.tile.swirl');
  const swirlAnims = await page.evaluate(() => [...document.querySelectorAll('.tile.swirl')].flatMap((el) => el.getAnimations().map((a) => a.animationName)));
  assert.equal(swirlAnims.filter((n) => n === 'swirl').length, 12, 'all 12 tiles really swirl, got ' + swirlAnims);
  await shot(page, '23-wirbel-swirl');
  await page.waitForFunction(() => !window.__vtGame.holds.has('wirbel'));
  const nowEn = (await page.locator('.tile[data-side=en]').allTextContents()).map((x) => x.trim());
  assert.equal(nowEn.filter((x) => !firstEn.includes(x)).length, 3, '3 new pairs');
  assert.equal(await page.locator('.tile').count(), 12, 'the board keeps its size');
  assert.equal(await page.locator('.tile.done').count(), 0, 'matched pairs are gone');
  const cols = await page.locator('.pairs.cols').evaluate((g) => [...g.children].map((c, i) => ({ i, side: c.dataset.side })).filter((c) => c.side));
  assert.ok(cols.every((c) => (c.side === 'en') === (c.i % 2 === 0)), 'Leicht: English stays in the left column');
  assert.equal(await page.locator('.pairs-count').textContent(), 'Paare 3/9');
  await shot(page, '23-wirbel-new');
  await solvePairs();
  await page.waitForFunction(() => document.querySelector('.game-round').textContent.startsWith('Runde 5'));
  await page.locator('.game-top .icon-btn').click();
  await page.locator('.modal .btn', { hasText: 'Beenden' }).click();
  await page.waitForSelector('.home');

  // ---------- 8c. Zeitraffer (Mittel): the time runs 1.5× as fast ----------
  await page.evaluate(() => { window.__vtMods = { 4: 'zeitraffer' }; });
  await page.locator('.level-card.level-medium').click();
  await page.waitForSelector('.tile');
  for (let r = 1; r <= 3; r++) {
    await playRound();
    await page.waitForFunction((rr) => document.querySelector('.game-round').textContent.startsWith('Runde ' + rr), r + 1);
  }
  await page.waitForSelector('.mod-banner.mod-zeitraffer');
  await waitBanner();
  assert.ok(await page.locator('.game.mod-fast').count(), 'time bar shows the fast time');
  assert.equal(await page.locator('.speed').textContent(), '1,5×');
  const tA = await page.evaluate(() => window.__vtGame.timeLeft);
  await page.waitForTimeout(1000);
  const tB = await page.evaluate(() => window.__vtGame.timeLeft);
  assert.ok(tA - tB > 1300 && tA - tB < 1800, 'about 1.5 s per second, got ' + (tA - tB));
  await shot(page, '24-zeitraffer');
  await page.locator('.game-top .icon-btn').click();
  await page.locator('.modal .btn', { hasText: 'Beenden' }).click();
  await page.waitForSelector('.home');

  // ---------- 8c2. Zeitbombe (Mittel, test version): 5 pairs in 10 s, new board after every 2 ----------
  await page.evaluate(() => { window.__vtMods = { 4: 'zeitbombe' }; });
  await page.locator('.level-card.level-medium').click();
  await page.waitForSelector('.tile');
  for (let r = 1; r <= 3; r++) {
    await playRound();
    await page.waitForFunction((rr) => document.querySelector('.game-round').textContent.startsWith('Runde ' + rr), r + 1);
  }
  await page.waitForSelector('.mod-banner.mod-zeitbombe');
  assert.equal(await page.locator('.zb-tile').count(), 8, '4 × 2 board');
  assert.equal(await page.locator('.zb-cover').count(), 8, 'words covered during the banner');
  await page.waitForFunction(() => window.__vtGame.bomb.state === 'run');
  assert.equal(await page.locator('.game-top > .icon-btn').evaluate((e) => getComputedStyle(e).visibility), 'hidden', 'no × (no pause) in the bomb');
  const mainZ = await page.evaluate(() => window.__vtGame.timeLeft);
  const zbPairs = () => page.evaluate(() => {
    const by = {};
    [...document.querySelectorAll('.zb-board .zb-tile')].forEach((el, i) => { if (!el.classList.contains('done')) (by[el.dataset.wid] = by[el.dataset.wid] || []).push(i); });
    return by;
  });
  async function zbSolveOne() {
    const by = await zbPairs();
    const ids = Object.values(by).find((x) => x.length === 2);
    const n = await page.evaluate(() => window.__vtGame.bomb.matched);
    const hs = await page.locator('.zb-board .zb-tile').elementHandles();
    await hs[ids[0]].click();
    await hs[ids[1]].click();
    await page.waitForFunction((k) => window.__vtGame.bomb.matched > k, n);
    await page.waitForFunction(() => !window.__vtGame.bomb.swapping);
  }
  // a wrong pair: the board is locked for a moment, the game goes on
  {
    const by = await zbPairs();
    const sides = await page.locator('.zb-board .zb-tile').evaluateAll((els) => els.map((e) => e.dataset.side));
    const ws = Object.keys(by);
    let a = null; let b = null;
    for (const x of ws) for (const y of ws) if (x !== y) for (const i of by[x]) for (const j of by[y]) if (i % 2 !== j % 2 && sides[i] !== sides[j]) { a = i; b = j; }
    const hs = await page.locator('.zb-board .zb-tile').elementHandles();
    await hs[a].click();
    await hs[b].click();
    assert.ok(await page.locator('.zb-board.locked').count(), 'locked after a wrong pair');
    assert.equal(await page.locator('.modal').count(), 0, 'a wrong pair does not end the game');
    await page.waitForFunction(() => !document.querySelector('.zb-board.locked'), null, { timeout: 1600 });
  }
  const firstWids = Object.keys(await zbPairs()).sort();
  await zbSolveOne();
  await zbSolveOne();
  const nextWids = Object.keys(await zbPairs()).sort();
  assert.equal(nextWids.length, 4, 'after 2 pairs: a new board with 4 pairs');
  assert.ok(nextWids.every((w) => !firstWids.includes(w)), 'all words are new');
  await shot(page, '24b-zeitbombe');
  // a pause starts the bomb again with new words
  await page.evaluate(() => window.__vtGame.showPause(false));
  await page.waitForSelector('.modal .zb-note');
  await page.locator('.modal .btn.primary').click();
  await page.waitForFunction(() => window.__vtGame.bomb.state === 'run' && window.__vtGame.bomb.matched === 0);
  for (let i = 0; i < 5; i++) await zbSolveOne();
  await page.waitForFunction(() => document.querySelector('.game-round').textContent.startsWith('Runde 5'));
  assert.equal(await page.evaluate(() => Math.round(window.__vtGame.timeLeft / 1000)), 40, 'defused: the time is full (Mittel 40 s)');
  assert.ok(mainZ <= 40000);
  assert.equal(await page.locator('.bonus-chip').textContent(), 'Zeit voll');
  assert.ok(await page.locator('.dot.zb-dot.done').count(), 'the round dot shows the bomb');
  await page.locator('.game-top .icon-btn').click();
  await page.locator('.modal .btn', { hasText: 'Beenden' }).click();
  await page.waitForSelector('.home');

  // ---------- 8d. Endlos: open since "Mittel" was passed, no limit, smaller bonus from round 11 ----------
  await page.evaluate(() => { window.__vtMods = 'off'; });
  assert.ok(!(await page.locator('.mode-card.mode-endless').isDisabled()), 'Endlos is open after Mittel');
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('vokabeltrainer.v1')).unlocks.endless === true), 'saved for good');
  await shot(page, '25-home-modes');
  await page.locator('.mode-card.mode-endless').click();
  await page.waitForSelector('.board');
  assert.equal(await roundText(), 'Runde 1');
  for (let r = 1; r <= 10; r++) {
    await playRound();
    await page.waitForFunction((rr) => window.__vtGame.roundIdx === rr, r);
    if (r === 1) {
      await page.waitForTimeout(950);
      assert.ok(await page.evaluate(() => window.__vtGame.timeLeft > 30000), 'Endlos: no limit, time can go above 30 s');
    }
  }
  await page.waitForSelector('.note-pill', { hasText: 'Bonus jetzt +8 s' });
  await shot(page, '26-endless-bonus');
  await waitBanner();
  const typeE = await boardType();
  if (typeE === 'pairs') {
    const e = page.locator('.tile[data-side=en]').first();
    const w = byEn.get((await e.textContent()).trim());
    await e.click();
    for (const d of await page.locator('.tile[data-side=de]').elementHandles()) {
      if (!isDe(w, (await d.textContent()).trim())) { await d.click(); break; }
    }
  } else if (typeE === 'choice') await choiceOne(true);
  else if (typeE === 'gaps') await gapsOne(true);
  else await solveSpell('qqqq');
  await page.waitForSelector('.modal-fail .endless-sum');
  assert.equal(await page.locator('.endless-sum .big-number').textContent(), '10');
  await shot(page, '27-endless-over');
  await page.locator('.modal .btn', { hasText: 'Menü' }).click();
  await page.waitForSelector('.home');
  assert.ok((await page.locator('.mode-card.mode-endless').textContent()).includes('Rekord: 10 Runden'));

  // ---------- 8e. Fehlertraining: no timer, every word 3× right, a mistake brings the word back later ----------
  const trainingCard = page.locator('.mode-card.mode-training');
  assert.ok(!(await trainingCard.isDisabled()), 'there are words with mistakes');
  const nMistakes = Number((await trainingCard.locator('.mode-status').textContent()).replace(/\D/g, ''));
  assert.ok(nMistakes >= 2);
  await trainingCard.click();
  await page.waitForSelector('.board');
  assert.equal(await roundText(), 'Noch ' + nMistakes + ' Wörter');
  assert.ok(!(await page.locator('.timer').isVisible()), 'no timer');
  await shot(page, '28-training');
  let answered = 0;
  let mistakeDone = false;
  for (let i = 0; i < nMistakes * 3 + 10; i++) {
    if (await page.locator('.modal-win').count()) break;
    const s0 = await seq();
    const type = await boardType();
    if (!mistakeDone && type === 'choice') {
      await choiceOne(true);
      await page.waitForSelector('.modal-fail');
      assert.ok((await page.locator('.modal').textContent()).includes('Kommt später nochmal'));
      await shot(page, '29-training-wrong');
      await page.locator('.modal .btn', { hasText: 'Weiter' }).click();
      mistakeDone = true;
    } else if (type === 'choice') await choiceOne();
    else if (type === 'gaps') await gapsOne();
    else await solveSpell();
    answered++;
    await page.waitForFunction((s) => window.__vtGame.qSeq !== s || document.querySelector('.modal-win'), s0);
  }
  await page.waitForSelector('.modal-win');
  assert.equal(await page.locator('main.board').evaluate((b) => b.children.length), 0, 'the last word does not come back after it flew away');
  assert.ok(mistakeDone, 'a mistake was tested');
  assert.ok((await page.locator('.modal-win').textContent()).includes('Alle Fehlerwörter geübt'));
  assert.ok(answered >= nMistakes * 3, 'every word needs 3 right answers');
  await page.locator('.modal .btn', { hasText: 'Menü' }).click();
  await page.waitForSelector('.home');
  assert.ok(await page.locator('.mode-card.mode-training').isDisabled(), 'no words with mistakes left');
  assert.ok((await page.locator('.mode-card.mode-training').textContent()).includes('Keine Fehlerwörter'));

  // settings: no own level times any more; Zeitbombe switch; Einführung again (back button closes it)
  await page.locator('.home-top .icon-btn').click();
  await page.waitForSelector('.sheet .switch');
  assert.equal(await page.locator('.timing').count(), 0, 'no level times');
  assert.ok(await page.locator('.set-row', { hasText: 'Zeitbombe' }).locator('.switch.on').count(), 'Zeitbombe on');
  assert.equal(await page.locator('.set-row', { hasText: 'ausprobieren' }).count(), 0, 'no test button');
  await page.locator('.set-row', { hasText: 'Einführung' }).locator('.btn').click();
  await page.waitForSelector('.intro.in');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.intro') && document.querySelector('.sheet'));
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.home') && !document.querySelector('.sheet') && !document.documentElement.classList.contains('busy'));

  // ---------- 8f. sheets, status bar, calendar ----------
  // the status bar keeps the page colour (no dimming with dialogs)
  const statusBar = () => page.evaluate(() => document.querySelector('meta[name="theme-color"][media*="light"]').getAttribute('content'));
  await page.locator('.list-card .btn', { hasText: 'Listen & Wörter' }).click();
  await page.waitForSelector('.sheet .list-rows');
  assert.ok(await page.locator('.app.recede').count(), 'the start screen recedes behind the sheet');
  assert.equal(await statusBar(), '#FAF9F5', 'status bar keeps the page colour with a sheet');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.sheet'));
  assert.equal(await statusBar(), '#FAF9F5', 'status bar back to normal');
  await page.locator('.streak').click();
  await page.waitForSelector('.cal .cal-cell.today.lit');
  await page.waitForTimeout(600);
  await shot(page, '30-calendar');
  assert.ok((await page.locator('.cal-stats').textContent()).includes('1 Tag'));
  assert.ok(await page.locator('.cal-nav .icon-btn').first().isDisabled(), 'no months before the first game');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.cal'));

  // ---------- 8g. "Üben" from a mistake: Fehlertraining starts with that word, at most 10 words ----------
  await setState(() => {
    const k = 'vokabeltrainer.v1';
    const s = JSON.parse(localStorage.getItem(k));
    const list = s.lists[s.currentListId];
    s.stats[s.currentListId] = {};
    list.words.slice(0, 14).forEach((w) => { s.stats[s.currentListId][w.id] = { w: 1, r: 0 }; });
    localStorage.setItem(k, JSON.stringify(s));
  });
  await page.reload();
  await page.waitForSelector('.home');
  await page.locator('.level-card.level-easy').click();
  await page.waitForSelector('main.board .tile');
  const failTile = page.locator('main.board .tile[data-side=en]').first();
  const failedWord = byEn.get((await failTile.textContent()).trim());
  await failTile.click();
  for (const d of await page.locator('main.board .tile[data-side=de]').elementHandles()) {
    if (!isDe(failedWord, (await d.textContent()).trim())) { await d.click(); break; }
  }
  await page.waitForSelector('.modal-fail');
  await page.waitForTimeout(500);
  await shot(page, '31-fail-practice');
  await page.locator('.modal .btn', { hasText: 'Diese Wörter üben' }).click();
  await page.waitForFunction(() => window.__vtGame && window.__vtGame.mode === 'training' && window.__vtGame.tCur);
  assert.equal(await roundText(), 'Noch 10 Wörter', 'one session has at most 10 words');
  const firstTrained = await page.evaluate(() => window.__vtGame.tCur.w.id);
  assert.ok(firstTrained === failedWord.id || (await page.evaluate((id) => window.__vtGame.tQueue[0].w.id === id || window.__vtGame.tCur.w.id === id, failedWord.id)), 'the failed words come first');
  await page.locator('.game-top .icon-btn').click();
  await page.locator('.modal .btn', { hasText: 'Beenden' }).click();
  await page.waitForSelector('.home');

  // ---------- 8h. a missed day breaks the streak (once, with the animation) ----------
  await setState(() => {
    const k = 'vokabeltrainer.v1';
    const s = JSON.parse(localStorage.getItem(k));
    const key = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    s.days = [key(4), key(3), key(2)];
    s.streak = { best: 3, shown: 3, brokeOn: null };
    localStorage.setItem(k, JSON.stringify(s));
  });
  await page.reload();
  await page.waitForSelector('.streak-hint.lost');
  await page.waitForFunction(() => document.querySelector('.streak .streak-num').textContent === '0' && document.querySelector('.streak-chip .roll').textContent === '0');
  assert.ok(await page.locator('.week .day.missed').count() <= 1, 'the missed day is crossed out (if it is in this week)');
  assert.ok((await page.locator('.streak-hint').textContent()).includes('Rekord bleibt 3'));
  await shot(page, '32-streak-lost');

  // ---------- 8i. "Fortschritt zurücksetzen": Endlos stays open (for every list) ----------
  await page.locator('.home-top .icon-btn').click();
  await page.waitForSelector('.sheet .switch');
  await page.locator('.btn', { hasText: 'Fortschritt zurücksetzen' }).click();
  await page.locator('.modal .btn', { hasText: 'Zurücksetzen' }).click();
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.sheet'));
  assert.ok(await page.locator('.level-card.level-medium').isDisabled(), 'levels are locked again');
  assert.ok(!(await page.locator('.mode-card.mode-endless').isDisabled()), 'Endlos stays open');
  assert.equal(await page.locator('.streak-chip .roll').textContent(), '0', 'Tagesserie starts again');

  // ---------- 8. Android back button during a game asks before quitting ----------
  await page.waitForFunction(() => document.querySelector('.home') && !document.querySelector('.sheet') && !document.documentElement.classList.contains('busy'));
  await page.locator('.level-card.level-easy').click();
  await page.waitForSelector('.tile');
  await page.goBack();
  await page.waitForSelector('.modal');
  assert.ok((await page.locator('.modal').textContent()).includes('Spiel beenden'));
  await page.locator('.modal .btn', { hasText: 'Weiterspielen' }).click();
  await page.waitForSelector('.tile');

  await ctx.close();

  // ---------- 9. service worker: works offline after first visit ----------
  const ctx3 = await browser.newContext({ ...iphone });
  const p3 = await ctx3.newPage();
  await p3.goto(BASE);
  await p3.waitForSelector('.level-card');
  await p3.evaluate(() => navigator.serviceWorker.ready);
  await p3.waitForTimeout(500);
  await ctx3.setOffline(true);
  await p3.reload();
  await p3.waitForSelector('.level-card', { timeout: 5000 });
  await ctx3.close();

  await browser.close();
  if (errors.length) {
    console.error('Browser errors:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('E2E OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
