import { test, expect, openApp, openView, passageText, typeInto, chooseWords, completePassage, finishDrill, chooseMore } from './fixtures.js';

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
  await expect(evidence).toContainText(/slowest in this run: .+ \d+ wpm/);
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
  // Like a drill, word practice leads on to a drill and retest of the run its words came from.
  await expect(page.locator('#result-drill')).toBeVisible();
  await expect(page.locator('#result-drill')).toHaveText(/^Drill/);
  // Word practice has no best of its own, so the footer says it isn't counted.
  await expect(page.locator('#best')).toHaveText('Not counted');
  // A practice run is never mined for words of its own: Run again repeats its passage.
  await expect(page.locator('#practice-words')).toBeHidden();
  await expect(page.locator('#practice-words-evidence')).toBeHidden();
  // Run again stays on the same practice passage.
  await page.locator('#run-again').click();
  await expect(page.locator('#session-kicker')).toHaveText('missed words');
  expect((await passageText(page)).split(' ')).toEqual(practice);
  // A fast practice run on short words must not become a personal best. Going to Practice leaves word
  // practice for the 10-word test, whose best is unchanged.
  await page.locator('.nav-item[data-nav="practice"]').click();
  await expect(page.locator('#session-kicker')).toHaveText('practice');
  await expect(page.locator('#condition-line')).toContainText('10 words');
  await expect(page.locator('#best')).toHaveText(best);
});

test('custom text offers no word practice, and word practice closes the custom editor', async ({ page }) => {
  await finishWithTwoMisses(page);
  await expect(page.locator('#practice-words')).toBeVisible();

  // The custom editor is open, over the result, when word practice starts.
  await chooseMore(page, 'mode-custom');
  await expect(page.locator('#custom-options')).toBeVisible();
  await expect(page.locator('#practice-words')).toBeVisible();
  await page.locator('#practice-words').click();
  await expect(page.locator('#session-kicker')).toHaveText('missed words');
  await expect(page.locator('#custom-options')).toBeHidden();
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-pressed', 'false');

  // A custom run with the same kind of slip is never mined for words to practise.
  await page.locator('.nav-item[data-nav="practice"]').click();
  await chooseMore(page, 'mode-custom');
  const text = 'the quick brown fox jumps over the lazy dog';
  await page.locator('#custom-text').fill(text);
  await page.locator('#custom-use').click();
  await expect(page.locator('#condition-line')).toContainText('custom text');
  await typeWithMisses(page, text, [1, 3], 60);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Custom text complete · not counted toward your best');
  await expect(page.locator('#result-words .word-miss').first()).toBeVisible();
  await expect(page.locator('#practice-words')).toBeHidden();
  await expect(page.locator('#practice-words-evidence')).toBeHidden();
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
  await chooseWords(page, 50);
  await page.locator('#punctuation-toggle').check();
  await expect(page.locator('#condition-line')).toContainText('punctuation');
  const text = await passageText(page);
  const words = text.split(' ');
  // Generated punctuation puts a comma after about one word in five: miss only the first such comma.
  const index = words.findIndex((word) => /^[a-z]+,$/.test(word));
  expect(index).toBeGreaterThan(0);
  const comma = words[index];
  const at = words.slice(0, index + 1).join(' ').length - 1;
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

test('a drill offers no word practice, while a daily run does', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  // A manual drill with no baseline ends on its own result card rather than starting a retest.
  await chooseMore(page, 'mode-drill');
  await page.locator('#manual-target-input').fill('th');
  await page.locator('#apply-manual-target').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  const drill = (await passageText(page)).split(' ');
  await typeWithMisses(page, `${drill.slice(0, 6).join(' ')} `, [1, 3]);
  await page.clock.fastForward(30_000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Drill complete · not counted toward your best');
  await expect(page.locator('#result-words .word-miss').first()).toBeVisible();
  // Its text is synthetic and target-heavy, so its misses and slow words are never offered.
  await expect(page.locator('#practice-words')).toBeHidden();
  await expect(page.locator('#practice-words-evidence')).toBeHidden();

  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await page.locator('#start-daily').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'daily');
  const daily = await passageText(page);
  const words = daily.split(' ');
  const second = words.findIndex((word, index) => index > 1 && word !== words[1]);
  await typeWithMisses(page, daily, [1, second]);
  await expect(page.locator('#result-delta')).toHaveText('Daily challenge complete');
  await expect(page.locator('#practice-words')).toBeVisible();
  await expect(page.locator('#practice-words-evidence')).toContainText('missed first try:');
});

test('a daily passage shown before offers no word practice', async ({ page }) => {
  // Two whole daily passages take longer than the default 30 s on a slow machine.
  test.setTimeout(60_000);
  await openApp(page);
  const daily = async () => {
    await openView(page, 'Challenge');
    await page.locator('#challenge-daily').click();
    await page.locator('#start-daily').click();
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'daily');
    const text = await passageText(page);
    const words = text.split(' ');
    await typeWithMisses(page, text, [1, words.findIndex((word, index) => index > 1 && word !== words[1])]);
    await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  };
  // The first attempt is on fresh text, so its misses are offered.
  await daily();
  await expect(page.locator('#result-delta')).toHaveText('Daily challenge complete');
  await expect(page.locator('#practice-words')).toBeVisible();
  // A repeat is on a passage already shown, which is never evidence: no words, the same misses or not.
  await daily();
  await expect(page.locator('#result-delta')).toHaveText('Daily challenge complete · repeat attempt');
  await expect(page.locator('#result-words .word-miss').first()).toBeVisible();
  await expect(page.locator('#practice-words')).toBeHidden();
  await expect(page.locator('#practice-words-evidence')).toBeHidden();
});

// A retest's result is its comparison, on Train. A retest is measured, so its own misses are still
// offered as word practice, on its card behind Back to practice.
const wordPracticeOffer = (page) => page.getByRole('button', { name: /^Practice (this word|these \d+ words)$/ });

test('words practised from a retest are retested against that retest', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  // A clean baseline, then its drill and a retest with two missed words.
  await completePassage(page);
  await expect(page.locator('#result-accuracy')).toHaveText('100');
  await page.locator('#result-drill').click();
  await finishDrill(page);
  const retest = await passageText(page);
  const words = retest.split(' ');
  const second = words.findIndex((word, index) => index > 1 && word !== words[1]);
  await typeWithMisses(page, retest, [1, second]);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'train');
  await expect(page.locator('#comparison-panel')).toBeVisible();
  const accuracy = Number(await page.locator('#comparison-accuracy-now').textContent());
  expect(accuracy).toBeLessThan(100);
  // A retest is measured, so its own misses are offered.
  await page.locator('#comparison-back').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(wordPracticeOffer(page)).toBeVisible();
  await expect(page.locator('#practice-words-evidence')).toBeVisible();
  await expect(page.locator('#practice-words-evidence')).toContainText(`missed first try: ${words[1]}, ${words[second]}`);

  await wordPracticeOffer(page).click();
  await expect(page.locator('#session-kicker')).toHaveText('missed words');
  await completePassage(page);
  await page.locator('#result-drill').click();
  await finishDrill(page);
  await expect(page.locator('#condition-line')).toContainText('10 words');
  expect(await passageText(page)).not.toBe(retest);
  await completePassage(page);
  // Clean fresh text is compared with the retest whose words were practised, not the clean baseline.
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect(page.locator('#comparison-accuracy')).toHaveText(`+${100 - accuracy} pp`);
});

test('words practised from a drill’s retest are drilled and retested under the drill the result names', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  // A manual "br" drill, then the retest it starts after its 30 seconds, typed with two misses.
  await chooseMore(page, 'mode-drill');
  await page.locator('#manual-target-input').fill('br');
  await page.locator('#apply-manual-target').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await typeInto(page, (await passageText(page)).slice(0, 20));
  await page.clock.fastForward(30_000);
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  const retest = await passageText(page);
  const words = retest.split(' ');
  const second = words.findIndex((word, index) => index > 1 && word !== words[1]);
  await typeWithMisses(page, retest, [1, second]);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await page.locator('#comparison-back').click();
  await expect(page.locator('#practice-words-evidence')).toContainText(`missed first try: ${words[1]}, ${words[second]}`);

  await wordPracticeOffer(page).click();
  await expect(page.locator('#session-kicker')).toHaveText('missed words');
  await completePassage(page);
  // Word practice leads on to a drill and retest; the loop records the drill that actually ran.
  const offer = await page.locator('#result-drill').textContent();
  await page.locator('#result-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  const drilled = (await page.locator('#session-title').textContent()).match(/^Practice “(.+)”$/)?.[1] ?? null;
  expect(offer).toBe(drilled ? `Drill “${drilled}”` : 'Drill and retest');
  await finishDrill(page);
  await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await openView(page, 'Progress');
  await expect(page.locator('.history-target')).toHaveText([drilled ? `“${drilled}” drill and retest` : 'General drill and retest', '“br” drill and retest']);
});

test('a missed capital is practised as written, and the run doesn’t say punctuation', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await page.locator('#punctuation-toggle').check();
  // Generated punctuation sometimes adds contractions, quotes, brackets or dashes; draw again until it adds only
  // capitals and sentence marks, so the practice that follows has no mark of its own.
  let text = await passageText(page);
  for (let tries = 0; tries < 30 && /[^\p{L}\p{N} ,.?!]/u.test(text); tries += 1) {
    await page.locator('#restart-button').click();
    await expect.poll(() => passageText(page)).not.toBe(text);
    text = await passageText(page);
  }
  expect(text).not.toMatch(/[^\p{L}\p{N} ,.?!]/u);
  // Generated punctuation capitalises the first word, with nothing after it: miss only its capital.
  const capital = text.split(' ')[0];
  expect(capital).toMatch(/^\p{Lu}\p{Ll}*$/u);
  await page.locator('#typing-input').focus();
  await page.keyboard.type('x');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#practice-words-evidence')).toContainText(`missed first try: ${capital}`);

  await page.locator('#practice-words').click();
  await expect(page.locator('#session-kicker')).toHaveText('missed words');
  const practice = await passageText(page);
  expect(practice.split(' ')).toContain(capital);
  // A capital is a letter: with no comma, period or other mark in the passage, it isn't punctuation.
  expect(practice).not.toMatch(/[^\p{L}\p{N} ]/u);
  await expect(page.locator('#condition-line')).toContainText('missed words · not counted · 40 words · physical keyboard');
});

const shot = (name) => `docs/screenshots/practice-missed-words/${name}.png`;

test('screenshots', async ({ page }) => {
  test.skip(!process.env.SCREENSHOTS, 'docs screenshots only; run with SCREENSHOTS=1');
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
    await page.screenshot({ path: shot(`run-card-${scheme}`) });
    if (scheme === 'dark') {
      await page.locator('#practice-words').click();
      await expect(page.locator('#session-kicker')).toHaveText('missed words');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: shot('practice-passage') });
    }
  }
});
