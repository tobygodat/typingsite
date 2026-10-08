import { test, expect, openApp, passageText, typeInto } from './fixtures.js';

const TEXT = 'the quick brown fox jumps over the lazy dog';

test('custom text runs under its own condition and never becomes a best', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-custom').click();
  await expect(page.locator('#custom-options')).toBeVisible();
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#custom-text').fill(`  ${TEXT}\n  `);
  await expect(page.locator('#custom-count')).toContainText('/ 10,000');
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

test('smart punctuation is normalised to typeable characters', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill('“It’s fine” — she said…\n\tok');
  await page.locator('#custom-use').click();
  expect(await passageText(page)).toBe('"It\'s fine" - she said... ok');
});

test('emoji are dropped and the length cap holds after punctuation expands', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill('go 🚀 now');
  await page.locator('#custom-use').click();
  expect(await passageText(page)).toBe('go now');

  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill('…'.repeat(10000));
  await page.locator('#custom-use').click();
  expect((await passageText(page)).length).toBe(10000);
});

test('characters typed through an input method are refused with a message', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill('hello 世界');
  await page.locator('#custom-use').click();
  await expect(page.locator('#custom-error')).toContainText('input method');
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
