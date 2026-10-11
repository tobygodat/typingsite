import { test, expect, openApp, passageText, typeInto, chooseWords } from './fixtures.js';

// Types the passage with one wrong-then-fixed letter in each chosen word.
// `delay` (ms per key) lets the screenshots show a human typing speed.
async function typeWithMisses(page, text, wordIndexes, delay = 0) {
  const words = text.split(' ');
  await page.locator('#typing-input').focus();
  for (const [index, word] of words.entries()) {
    if (wordIndexes.includes(index)) {
      const miss = word[0] === 'x' ? 'z' : 'x';
      await page.keyboard.type(miss, { delay });
      await page.keyboard.press('Backspace', { delay });
    }
    await page.keyboard.type(index < words.length - 1 ? `${word} ` : word, { delay });
  }
}

async function finishWithTwoMisses(page, delay = 0) {
  await openApp(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  const words = text.split(' ');
  // Two distinct words, so the button counts two missed.
  const first = 1;
  const second = words.findIndex((word, index) => index > first && word !== words[first]);
  await typeWithMisses(page, text, [first, second], delay);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  return [words[first], words[second]];
}

test('missed and slowest words become their own uncounted practice run', async ({ page }) => {
  const missed = await finishWithTwoMisses(page);
  const best = await page.locator('#best').textContent();
  const button = page.locator('#practice-words');
  await expect(button).toBeVisible();
  await expect(button).toHaveText(/^Practice these [3-7] words$/);
  // The slowest words are one timing each, so they show their speed and the run's median.
  const evidence = page.locator('#practice-words-evidence');
  await expect(evidence).toContainText(`missed first try: ${missed.join(', ')}`);
  await expect(evidence).toContainText(/slowest in this run: .+ \d+ wpm .*· median \d+ wpm over \d+ clean words/);
  // A sentence, not a conditions line: Literata throughout, and every number a book-face figure.
  await expect(evidence).toHaveCSS('font-family', /^"?Literata/);
  const figures = evidence.locator('.num');
  expect(await figures.count()).toBeGreaterThanOrEqual(3);
  for (const figure of await figures.all()) {
    await expect(figure).toHaveText(/^\d+$/);
    await expect(figure).toHaveCSS('font-family', /^"?Literata/);
    await expect(figure).toHaveCSS('font-variant-numeric', 'lining-nums tabular-nums');
  }
  const bare = await evidence.evaluate((node) => [...node.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent).join(''));
  expect(bare).not.toMatch(/\d/);

  await button.click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  const practice = (await passageText(page)).split(' ');
  expect(practice.length).toBe(40);
  for (const word of missed) expect(practice).toContain(word);
  await expect(page.locator('#condition-line')).toContainText('missed words · not counted');
  await expect(page.locator('#session-kicker')).toHaveText('missed words');

  await typeInto(page, practice.join(' '));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Word practice complete · not counted toward your best');
  await expect(page.locator('#result-conditions')).toContainText('missed words');
  await expect(page.locator('#run-card-stamp')).toContainText('missed');
  // The retest it offers keeps the 10-word baseline's shape.
  await expect(page.locator('#recommendation-meta')).toHaveText('About 1 min, then a fresh 10-word retest.');
  // A fast practice run on short words must not become a personal best.
  await expect(page.locator('#best')).toHaveText(best);
  // Run again stays on the same practice passage.
  await page.locator('#run-again').click();
  await expect(page.locator('#session-kicker')).toHaveText('missed words');
  expect((await passageText(page)).split(' ')).toEqual(practice);
});

test('after a timed test, the practice run lasts until its passage is typed', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await page.locator('#duration-options [data-length="15"]').click();
  await expect(page.locator('#timer')).toHaveText('15');
  // Two distinct words with a fixed miss each, then the 15 s limit ends the run.
  const words = (await passageText(page)).split(' ');
  const second = words.findIndex((word, index) => index > 1 && word !== words[1]);
  await typeWithMisses(page, words.slice(0, second + 2).join(' '), [1, second]);
  await page.clock.fastForward(15_000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-time')).toHaveText('15.0 s');

  await page.locator('#practice-words').click();
  await expect(page.locator('#session-kicker')).toHaveText('missed words');
  await expect(page.locator('#timer-label')).toHaveText('words');
  await expect(page.locator('#timer-unit')).toHaveText('/40');
  await expect(page.locator('#condition-line')).not.toContainText('15 s');
  const practice = await passageText(page);
  await typeInto(page, practice.slice(0, 20));
  // Well past the timed test's 15 s, the practice run is still going.
  await page.clock.fastForward(20_000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#typing-status')).toHaveText('In progress');
  await typeInto(page, practice.slice(20));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Word practice complete · not counted toward your best');
  expect(parseFloat(await page.locator('#result-time').textContent())).toBeGreaterThan(20);
  await expect(page.locator('#result-conditions')).not.toContainText('15 s');
});

test('a missed comma is practised with its comma, and the run says punctuation', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await page.locator('#punctuation-toggle').check();
  await expect(page.locator('#condition-line')).toContainText('punctuation');
  const text = await passageText(page);
  const words = text.split(' ');
  // Generated punctuation puts a comma after the fifth word: miss only that comma.
  const comma = words[4];
  expect(comma).toMatch(/,$/);
  const at = words.slice(0, 5).join(' ').length - 1;
  await page.locator('#typing-input').focus();
  await page.keyboard.type(text.slice(0, at));
  await page.keyboard.type('x');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text.slice(at));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#practice-words-evidence')).toContainText(`missed first try: “${comma}”`);

  await page.locator('#practice-words').click();
  await expect(page.locator('#session-kicker')).toHaveText('missed words');
  expect((await passageText(page)).split(' ')).toContain(comma);
  await expect(page.locator('#condition-line')).toContainText('missed words · not counted · 40 words · punctuation');
});

// Committed docs images are only rewritten on request (SCREENSHOTS=1); normal runs still take
// the shots, into the test's own output folder.
const shot = (testInfo, name) => process.env.SCREENSHOTS
  ? `docs/screenshots/practice-missed-words/${name}.png`
  : testInfo.outputPath(`${name}.png`);

test('screenshots', async ({ page }, testInfo) => {
  // Two runs typed at a human pace take most of the default 30 s.
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 1000 });
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    // ~130ms per key is roughly 90 wpm, so the card shows a believable run.
    await finishWithTwoMisses(page, 130);
    await expect(page.locator('#practice-words')).toBeVisible();
    await page.mouse.move(1270, 990);
    // The card runs past the fold; show its foot, where the evidence and the offer sit.
    await page.locator('#run-card').evaluate((card) => card.scrollIntoView({ block: 'end', behavior: 'instant' }));
    await page.evaluate(() => window.scrollBy(0, 24));
    await page.screenshot({ path: shot(testInfo, `run-card-${scheme}`) });
    if (scheme === 'dark') {
      await page.locator('#practice-words').click();
      await expect(page.locator('#session-kicker')).toHaveText('missed words');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: shot(testInfo, 'practice-passage') });
    }
  }
});
