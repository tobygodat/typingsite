import { test, expect, openApp, passageText, typeInto } from './fixtures.js';

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

test('code mode screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    await openApp(page);
    await page.locator('#mode-code').click();
    await page.locator('#duration-options [data-language="js"]').click();
    await expect(page.locator('#condition-line')).toContainText('code · js');
    await page.mouse.move(10, 10);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `docs/screenshots/code-mode/code-mode-${theme}.png` });
  }
});
