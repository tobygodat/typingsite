import { test, expect, openApp, openSettings } from './fixtures.js';

test.use({ viewport: { width: 375, height: 553 }, hasTouch: true, isMobile: true });

test('short-phone settings clear the account control and every touch-sized row remains reachable', async ({ page }, testInfo) => {
  await openApp(page);
  await openSettings(page);
  const theme = page.locator('#theme-select');
  expect(await theme.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return document.elementFromPoint(box.right - 4, box.top + 4)?.id;
  })).toBe('theme-select');
  const popover = page.locator('.preferences-popover');
  const rows = popover.locator('.preference-row:visible');
  for (const height of await rows.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))) {
    expect(height).toBeGreaterThanOrEqual(44);
  }
  await rows.last().scrollIntoViewIfNeeded();
  await expect(rows.last()).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath('short-phone-settings.png') });
});
