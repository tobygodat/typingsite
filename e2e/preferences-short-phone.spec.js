import { test, expect, openApp, openSettings } from './fixtures.js';

test.use({ viewport: { width: 375, height: 553 }, hasTouch: true, isMobile: true });

test('short-phone settings keep every category reachable and scroll only the content', async ({ page }, testInfo) => {
  await openApp(page);
  for (const category of ['appearance', 'practice', 'keyboard', 'sound', 'shortcuts']) {
    await openSettings(page, category);
    const panel = page.locator(`#settings-${category}`);
    await expect(panel).toBeVisible();
    const controls = panel.locator('input:not(:disabled), button');
    for (const control of await controls.all()) {
      if (!(await control.isVisible())) continue;
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
    }
    await expect(page.locator('#settings-done')).toBeInViewport();
    expect(await page.locator('#settings-dialog').evaluate((dialog) => dialog.scrollHeight - dialog.clientHeight)).toBe(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('short-phone-settings.png') });
});
