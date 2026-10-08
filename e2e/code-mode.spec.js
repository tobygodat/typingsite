import { test, expect, openApp, passageText, typeInto, chooseWords, completePassage } from './fixtures.js';

test('code mode serves a python snippet and keeps the run out of bests', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-code').click();
  await page.locator('#duration-options [data-language="python"]').click();
  await expect(page.locator('#duration-options [data-language="python"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#condition-line')).toContainText('code · python');
  const text = await passageText(page);
  expect(text).toMatch(/[:(]/);
  expect(text).not.toMatch(/\n| {2}/);

  await typeInto(page, text);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-conditions')).toContainText('code · python');
  await expect(page.locator('#result-delta')).toHaveText('Code run complete · not counted toward your best');
  await expect(page.locator('#skip-to-retest')).toBeDisabled();
  await expect(page.locator('#best')).toHaveText('Code runs aren’t ranked');
});

// Docs captures only refresh with SCREENSHOTS=1; normal runs write to the test output folder.
test('a code run clears the earlier practice baseline', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await expect(page.locator('#skip-to-retest')).toBeEnabled();
  await page.locator('#run-again').click();
  await page.locator('#mode-code').click();
  await expect(page.locator('#condition-line')).toContainText('code ·');
  await completePassage(page);
  await expect(page.locator('#result-delta')).toHaveText('Code run complete · not counted toward your best');
  await expect(page.locator('#skip-to-retest')).toBeDisabled();
  await expect(page.locator('#recommendation-meta')).toContainText('A standalone drill');
});

test('code mode screenshots', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    await openApp(page);
    await page.locator('#mode-code').click();
    await page.locator('#duration-options [data-language="js"]').click();
    await expect(page.locator('#condition-line')).toContainText('code · js');
    await page.mouse.move(10, 10);
    await page.waitForTimeout(300);
    const name = `code-mode-${theme}.png`;
    await page.screenshot({ path: process.env.SCREENSHOTS ? `docs/screenshots/code-mode/${name}` : testInfo.outputPath(name) });
  }
});
