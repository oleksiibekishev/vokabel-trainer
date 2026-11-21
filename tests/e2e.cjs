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
  const byEn = new Map(words.map((w) => [w.en, w]));
  const byDe = new Map(words.map((w) => [w.de, w]));

  const browser = await chromium.launch();
  const iphone = { ...devices['iPhone 13'], deviceScaleFactor: 1 };
  const ctx = await browser.newContext({ ...iphone, serviceWorkers: 'block', locale: 'de-DE' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE);
  await page.waitForSelector('.level-card');
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
      const partner = de.find((d) => d.text === byEn.get(e.text).de);
      assert.notEqual(e.i % 2, partner.i % 2, 'pair "' + e.text + '" must be split across both columns');
    }
    const leftLangs = new Set(cells.filter((c) => c.i % 2 === 0).map((c) => c.side));
    assert.equal(leftLangs.size, 2, 'left column mixes both languages');
  }

  async function solvePairs() {
    await checkPairColumns();
    const handles = await page.locator('.tile').elementHandles();
    const items = [];
    for (const el of handles) {
      items.push({ el, side: await el.getAttribute('data-side'), text: (await el.textContent()).trim() });
    }
    const en = items.filter((x) => x.side === 'en');
    const de = items.filter((x) => x.side === 'de');
    for (const e of en) {
      const w = byEn.get(e.text);
      const d = de.find((x) => x.text === w.de);
      await e.el.click();
      await d.el.click();
    }
  }

  async function solveChoice() {
    for (let q = 0; q < 4; q++) {
      if (await modalVisible()) return;
      const prompt = (await page.locator('.choice .prompt-card .word').textContent()).trim();
      const w = byDe.get(prompt) || byEn.get(prompt);
      const answer = byDe.get(prompt) ? w.en : w.de;
      const roundBefore = await roundText();
      await page.locator('.option', { hasText: answer }).filter({ hasText: new RegExp('^' + answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).first().click();
      await page.waitForTimeout(400);
      if ((await roundText()) !== roundBefore) return;
    }
  }

  async function solveGaps(mistake = false) {
    for (let k = 0; k < 2; k++) {
      const roundBefore = await roundText();
      const prompt = (await page.locator('.typing .prompt-card .word').textContent()).trim();
      const target = [...core.primaryForm(byDe.get(prompt).en)].filter((c) => c !== ' ');
      const slots = page.locator('.gapword .cell');
      const cnt = await slots.count();
      assert.equal(cnt, target.length, 'one cell per letter');
      let letters = '';
      for (let i = 0; i < cnt; i++) {
        if ((await slots.nth(i).getAttribute('class')).includes('gap')) letters += target[i];
      }
      if (mistake) letters = letters.slice(0, -1) + (letters.slice(-1) === 'x' ? 'y' : 'x');
      await page.locator('.gap-input').fill(letters);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      if (mistake || (await roundText()) !== roundBefore) return;
    }
  }

  async function solveSpell(typo = null) {
    const prompt = (await page.locator('.typing .prompt-card .word').textContent()).trim();
    const w = byDe.get(prompt);
    await page.locator('.spell-input').fill(typo || core.displayForms(w.en)[0].toUpperCase());
    await page.locator('.typing .btn.primary').click();
  }

  async function playRound() {
    const type = (await page.locator('.board').getAttribute('class')).replace('board board-', '').split(' ')[0];
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
  await page.waitForTimeout(1300);
  const t1 = Number(await page.locator('.timer .num').textContent());
  assert.ok(t1 < t0, 'timer counts down');
  // select en, switch selection to another en (no error), then wrong de
  const enTiles = page.locator('.tile[data-side=en]');
  await enTiles.nth(0).click();
  await enTiles.nth(1).click();
  assert.equal(await page.locator('.tile.sel').count(), 1, 'same-side tap switches selection');
  const selText = (await enTiles.nth(1).textContent()).trim();
  const wrongDe = page.locator('.tile[data-side=de]').filter({ hasNotText: byEn.get(selText).de }).first();
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
  assert.equal(Number(await page.locator('.timer .num').textContent()), 60);
  await page.locator('.game-top .icon-btn').click();
  await page.locator('.modal .btn', { hasText: 'Beenden' }).click();
  await page.waitForSelector('.home');

  // ---------- 2. play easy to the end ----------
  const easyTypes = await playLevel('easy', '04-easy');
  assert.ok(easyTypes.every((x) => x === 'pairs'));
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
  assert.ok(medTypes.includes('spell') && medTypes.includes('gaps') && medTypes.includes('choice'));
  await page.locator('.modal .btn', { hasText: 'Menü' }).click();
  await page.waitForSelector('.home');

  // ---------- 4. spelling mistake shows the letter diff ----------
  await page.evaluate(() => {
    const k = 'vokabeltrainer.v1';
    const s = JSON.parse(localStorage.getItem(k));
    s.settings.timing.hard = { start: 300 };
    localStorage.setItem(k, JSON.stringify(s));
  });
  await page.reload();
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
  await page.waitForSelector('.modal-fail .diff-cols');
  assert.ok(await page.locator('.dcell.missing, .dcell.bad, .dcell.extra').count() >= 1);
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
        await page.waitForSelector('.modal-fail .diff-cols');
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
  await page.evaluate(() => {
    const k = 'vokabeltrainer.v1';
    const s = JSON.parse(localStorage.getItem(k));
    s.settings.timing.easy = { start: 10 };
    localStorage.setItem(k, JSON.stringify(s));
  });
  await page.reload();
  await page.locator('.level-card.level-easy').click();
  await page.waitForSelector('.modal-fail', { timeout: 15000 });
  assert.ok((await page.locator('.modal').textContent()).includes('Zeit abgelaufen'));
  await shot(page, '10-timeup');
  await page.locator('.modal .btn', { hasText: 'Menü' }).click();
  await page.waitForSelector('.home');

  // ---------- 7. add a list by pasting text, then share link import ----------
  await page.locator('.list-card .btn', { hasText: 'Listen' }).click();
  await page.waitForSelector('textarea');
  await page.locator('textarea').fill('Wortliste\n\ndog - Hund\ncat - Katze\nhouse - Haus\ntree - Baum\ncar - Auto\nnoline');
  await page.locator('#list-name').fill('Testliste');
  assert.ok((await page.locator('.preview').textContent()).includes('5 Wortpaare'));
  await shot(page, '11-new-list');
  await page.locator('.btn', { hasText: 'Liste speichern' }).click();
  await page.waitForSelector('.home');
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
  assert.ok((await p2.locator('.modal').textContent()).includes('Testliste'));
  await shot(p2, '12-import-uk');
  await p2.locator('.modal .btn.primary').click();
  await p2.waitForFunction(() => document.querySelector('.list-name')?.textContent === 'Testliste');
  assert.ok(!p2.url().includes('#l='), 'hash cleared');
  await shot(p2, '13-home-uk');
  await ctx2.close();

  // words screen + settings render
  await page.locator('.list-card .btn', { hasText: 'Listen' }).click();
  await page.locator('.list-main', { hasText: 'Englisch – Liste 1' }).click();
  await page.waitForSelector('.home');
  await page.locator('.list-card .btn', { hasText: 'Wörter' }).click();
  await page.locator('.segmented button', { hasText: 'Schwierigste' }).click();
  await shot(page, '14-words');
  assert.ok(await page.locator('.miss:not(.none)').count() >= 1, 'mistakes are counted');
  await page.goBack();
  await page.waitForSelector('.home');
  await page.locator('.home-top .icon-btn').click();
  await page.waitForSelector('.switch');
  await shot(page, '15-settings');
  await page.locator('.btn', { hasText: 'Sicherungscode erstellen' }).click();
  const code = (await page.locator('.code-box output').textContent()).trim();
  assert.ok(code.startsWith('z') || code.startsWith('p'));

  // ---------- 8. Android back button during a game asks before quitting ----------
  await page.goBack();
  await page.waitForSelector('.home');
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
