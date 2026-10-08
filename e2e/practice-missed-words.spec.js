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
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: shot(testInfo, `run-card-${scheme}`) });
    if (scheme === 'dark') {
      await page.locator('#practice-words').click();
      await expect(page.locator('#session-kicker')).toHaveText('missed words');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: shot(testInfo, 'practice-passage') });
    }
  }
});
