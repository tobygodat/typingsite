import { test, expect, openApp, chooseWords, completePassage, passageText } from './fixtures.js';

// Committed docs images are refreshed only with SCREENSHOTS=1; normal runs write to the test output.
const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/numbers-toggle/${name}` : testInfo.outputPath(name));

test('numbers toggle mixes digits into the passage and into the conditions', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await expect(page.locator('#numbers-toggle')).not.toBeChecked();
  expect(await passageText(page)).not.toMatch(/\d/);

  await page.locator('label[for="numbers-toggle"]').click();
  await expect(page.locator('#numbers-toggle')).toBeChecked();
  await expect(page.locator('#condition-line')).toContainText('numbers');
  await expect.poll(() => passageText(page)).toMatch(/\d/);

  await completePassage(page);
  await expect(page.locator('#result-conditions')).toContainText('numbers');
});

test('screenshots', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    await openApp(page);
    await page.locator('#mode-time').click();
    if (!(await page.locator('#numbers-toggle').isChecked())) await page.locator('label[for="numbers-toggle"]').click();
    await expect(page.locator('#numbers-toggle')).toBeChecked();
    await expect.poll(async () => /\d/.test(await passageText(page))).toBe(true);
    await page.screenshot({ path: shot(testInfo, `mode-bar-${theme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await chooseWords(page, 10);
  await completePassage(page);
  await expect(page.locator('#result-conditions')).toContainText('numbers');
  await page.screenshot({ path: shot(testInfo, 'run-card-dark.png') });
});
