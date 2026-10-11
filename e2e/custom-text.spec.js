import { test, expect, chooseWords, completePassage, openApp, openSettings, openView, passageText, typeInto } from './fixtures.js';

const TEXT = 'the quick brown fox jumps over the lazy dog';

test('custom text runs under its own condition and never becomes a best', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-custom').click();
  await expect(page.locator('#custom-options')).toBeVisible();
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#custom-text').fill(`  ${TEXT}\n  `);
  await expect(page.locator('#custom-count')).toContainText('/ 3,000');
  await page.locator('#custom-use').click();

  await expect(page.locator('#custom-options')).toBeHidden();
  await expect(page.locator('#condition-line')).toContainText('custom text');
  expect(await passageText(page)).toBe(TEXT);

  await typeInto(page, TEXT);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-conditions')).toContainText('custom text');
  await expect(page.locator('#result-delta')).toContainText('not counted toward your best');

  // Run again keeps the custom text rather than falling back to a generated passage.
  await page.locator('#run-again').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#condition-line')).toContainText('custom text');
  expect(await passageText(page)).toBe(TEXT);

  // Back on a normal test, nothing was recorded as a personal best.
  await page.locator('.nav-item[data-nav="practice"]').click();
  await page.locator('#mode-time').click();
  await expect(page.locator('#best')).toHaveText('No best yet');
});

async function finishCustom(page, text = TEXT) {
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill(text);
  await page.locator('#custom-use').click();
  await typeInto(page, text);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
}

test('custom results offer no drill or retest, even with a normal baseline retained', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await expect(page.locator('#start-drill')).toBeVisible();
  await expect(page.locator('#recommendation-meta')).toContainText('10-word retest');

  await page.locator('.nav-item[data-nav="practice"]').click();
  await finishCustom(page);
  for (const id of ['#start-drill', '#skip-to-retest', '#recommendation-meta', '#recommendation-title']) {
    await expect(page.locator(id)).toBeHidden();
  }
  await expect(page.locator('#run-again')).toBeVisible();
});

test('leaving custom for practice restores the test controls', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await finishCustom(page);

  await page.locator('.nav-item[data-nav="practice"]').click();
  await expect(page.locator('#condition-line')).not.toContainText('custom text');
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#mode-words')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#duration-options')).toBeVisible();
  await expect(page.locator('label[for="punctuation-toggle"]')).toBeVisible();

  // Esc on a custom passage keeps it custom; a mode button leaves it.
  await finishCustom(page);
  await page.locator('#run-again').click();
  await page.locator('#typing-input').press('Escape');
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-pressed', 'true');
  expect(await passageText(page)).toBe(TEXT);
  await page.locator('#mode-time').click();
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#duration-options')).toBeVisible();
});

// A normal practice passage under the default 30-second test, with the custom editor shut.
async function expectNormalPractice(page) {
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#custom-options')).toBeHidden();
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#mode-time')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#duration-options')).toBeVisible();
  await expect(page.locator('#condition-line')).toHaveText(/^english( \w+)? · 30 s · plain · /);
  expect(await passageText(page)).not.toBe(TEXT);
}

test('going back to practice closes the custom editor', async ({ page }) => {
  await openApp(page);
  // A custom session with its editor reopened; Progress is still empty, since custom runs are not counted.
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill(TEXT);
  await page.locator('#custom-use').click();
  await page.locator('#mode-custom').click();
  await expect(page.locator('#custom-options')).toBeVisible();
  await openView(page, 'Progress');
  await page.locator('#progress-empty [data-action="go-practice"]').click();
  await expectNormalPractice(page);

  // The editor opened over a normal test closes the same way.
  await page.locator('#mode-custom').click();
  await expect(page.locator('#custom-options')).toBeVisible();
  await openView(page, 'Progress');
  await page.locator('#progress-empty [data-action="go-practice"]').click();
  await expectNormalPractice(page);

  // A custom run finished with the editor open, then Practice in the dock.
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill(TEXT);
  await page.locator('#custom-use').click();
  await page.locator('#mode-custom').click();
  await typeInto(page, TEXT);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await openView(page, 'Practice');
  await expectNormalPractice(page);
});

async function paletteRun(page, label) {
  await page.locator('#palette-trigger').click();
  await page.keyboard.type(label);
  await page.locator('#palette-list [role="option"]').filter({ hasText: label }).first().click();
  await expect(page.locator('#palette')).toBeHidden();
}

test('a word list change keeps a custom passage, from settings or the palette', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill(TEXT);
  await page.locator('#custom-use').click();

  await openSettings(page);
  // The word list and numbers sit under "test content" in settings.
  await page.locator('#test-content-settings > summary').click();
  await page.locator('#word-list').selectOption('1k');
  await expect(page.locator('#condition-line')).toContainText('custom text');
  expect(await passageText(page)).toBe(TEXT);
  // Numbers, beside it, keeps the custom passage too, with no digits mixed into it.
  await page.locator('#numbers-toggle').check();
  await expect(page.locator('#condition-line')).toContainText('custom text');
  expect(await passageText(page)).toBe(TEXT);
  await page.keyboard.press('Escape');

  await paletteRun(page, 'word list · top 5k');
  await expect(page.locator('#word-list')).toHaveValue('5k');
  await expect(page.locator('#condition-line')).toContainText('custom text');
  expect(await passageText(page)).toBe(TEXT);

  // From the results of a finished custom run too, and restart test does the same.
  await typeInto(page, TEXT);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await paletteRun(page, 'word list · top 200');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#condition-line')).toContainText('custom text');
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-pressed', 'true');
  expect(await passageText(page)).toBe(TEXT);
  await typeInto(page, TEXT);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await paletteRun(page, 'restart test');
  await expect(page.locator('#condition-line')).toContainText('custom text');
  expect(await passageText(page)).toBe(TEXT);
});

test('the footer best follows the session: none for custom, back for the word test', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await page.locator('.nav-item[data-nav="practice"]').click();
  await expect(page.locator('#best')).toHaveText(/^Best · \d+ wpm$/);
  const best = await page.locator('#best').textContent();

  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill(TEXT);
  await page.locator('#custom-use').click();
  await expect(page.locator('#best')).toHaveText('Not counted');
  // Nor does the palette call the word test current.
  await page.locator('#palette-trigger').click();
  const option = (label) => page.locator('#palette-list [role="option"]').filter({ hasText: label }).first();
  await expect(option('custom text')).toContainText('current');
  await expect(option('words · 10 words')).not.toContainText('current');
  await page.keyboard.press('Escape');

  await page.locator('#mode-words').click();
  await expect(page.locator('#best')).toHaveText(best);
});

test('text too short to time is refused, and a short phrase is accepted', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill('a');
  await expect(page.locator('#custom-error')).toHaveText('Use at least 2 words and 10 characters, so the run is long enough to time.');
  await expect(page.locator('#custom-text')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#custom-use')).toBeDisabled();

  await page.locator('#custom-text').fill('hello world');
  await expect(page.locator('#custom-error')).toHaveText('');
  await expect(page.locator('#custom-use')).toBeEnabled();
  await page.locator('#custom-use').click();
  expect(await passageText(page)).toBe('hello world');

  // Automation finishes eleven letters well inside a second: the card shows no rate rather than thousands of wpm.
  await typeInto(page, 'hello world');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  const seconds = parseFloat(await page.locator('#result-time').textContent());
  if (seconds < 1) {
    await expect(page.locator('#result-wpm')).toHaveText('—');
    await expect(page.locator('#result-raw')).toHaveText('—');
    await expect(page.locator('.run-card-graph')).toBeHidden();
    await expect(page.locator('#announcement')).toContainText('Too quick to time');
  } else {
    await expect(page.locator('#result-wpm')).toHaveText(/^\d+$/);
  }
});

test('smart punctuation is normalised to typeable characters', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill('“It’s fine” — she said…\n\tok');
  await page.locator('#custom-use').click();
  expect(await passageText(page)).toBe('"It\'s fine" - she said... ok');
});

test('accents fold to plain letters and the length cap is checked after punctuation expands', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill('café\u034F au lait');
  await page.locator('#custom-use').click();
  expect(await passageText(page)).toBe('cafe au lait');

  // 501 "ab…" words are 2,004 characters as pasted but 3,005 once each ellipsis expands: refused with the count.
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill(Array(501).fill('ab…').join(' '));
  await page.locator('#custom-use').click();
  await expect(page.locator('#custom-error')).toContainText('Keep it to 3,000 characters');
  await expect(page.locator('#custom-error')).toContainText('3,005');
  await expect(page.locator('#custom-options')).toBeVisible();

  await page.locator('#custom-text').fill(Array(500).fill('ab…').join(' '));
  await page.locator('#custom-use').click();
  expect((await passageText(page)).length).toBe(2999);
});

test('changing stop on error keeps the custom passage', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill(TEXT);
  await page.locator('#custom-use').click();
  await expect(page.locator('#condition-line')).toContainText('continue on error');

  await openSettings(page);
  await page.locator('#stop-on-error-toggle').check();
  await expect(page.locator('#condition-line')).toContainText('custom text');
  await expect(page.locator('#condition-line')).toContainText('stop on error');
  expect(await passageText(page)).toBe(TEXT);
});

test('invisible format characters are stripped', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill('\uFEFFsoft\u00ADware left\u200Eto \u2066right\u2069 zero\u200Bwidth jo\u200Din no\u200Cn');
  await page.locator('#custom-use').click();
  expect(await passageText(page)).toBe('software leftto right zerowidth join non');
});

test('the panel appears without motion and never opens beside a live run', async ({ page }) => {
  await openApp(page);
  await page.mouse.move(10, 10);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 3));
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');

  // Pointer movement brings the controls back; opening custom then restarts the run first.
  await page.mouse.move(80, 80);
  await expect(page.locator('body')).toHaveAttribute('data-running', 'false');
  await page.locator('#mode-custom').click();
  await expect(page.locator('#custom-options')).toBeVisible();
  await expect(page.locator('#custom-options')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('#typing-status')).toHaveText('Ready');
  await expect(page.locator('#typing-input')).toHaveValue('');

  // If a run starts with the panel open, it steps back with the rest of the setup.
  const fresh = await passageText(page);
  await typeInto(page, fresh.slice(0, 2));
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  await expect(page.locator('#custom-options')).toHaveCSS('opacity', '0');
});

test('characters an English keyboard can’t type are refused by name', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill('go 🚀 now');
  await page.locator('#custom-use').click();
  await expect(page.locator('#custom-error')).toContainText('“🚀” (U+1F680) can’t be typed here');

  await page.locator('#custom-text').fill('hello 世界');
  await page.locator('#custom-use').click();
  await expect(page.locator('#custom-error')).toContainText('“世” (U+4E16) can’t be typed here');
  await expect(page.locator('#custom-text')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#custom-options')).toBeVisible();
  await expect(page.locator('#condition-line')).not.toContainText('custom text');

  await page.locator('#custom-text').fill('hello world');
  await expect(page.locator('#custom-error')).toHaveText('');
  await page.locator('#custom-use').click();
  expect(await passageText(page)).toBe('hello world');
});

// Committed screenshots are refreshed only with SCREENSHOTS=1; a normal run writes to the test's output folder.
const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/custom-text/${name}.png` : testInfo.outputPath(`${name}.png`));

test('screenshots', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    await openApp(page);
    await page.locator('#mode-custom').click();
    await page.waitForTimeout(400);
    await page.locator('#custom-text').fill('Paste anything you like to practise on: a paragraph from a book, an email you keep retyping, or a list of tricky words.');
    await page.screenshot({ path: shot(testInfo, `panel-${theme}`) });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('#custom-use').click();
  await expect(page.locator('#condition-line')).toContainText('custom text');
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot(testInfo, 'passage-dark') });
});
