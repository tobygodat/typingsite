import { test, expect, openApp } from './fixtures.js';
import { release } from '../src/release.js';

test.use({ serviceWorkers: 'allow' });

const trigger = (page) => page.getByRole('button', { name: `What’s new in Stilltype version ${release.version}`, exact: true });
const panel = (page) => page.getByRole('dialog', { name: 'What’s new', exact: true });

test('release panel opens by keyboard, contains focus and restores it on repeated dismissal', async ({ page }) => {
  await openApp(page);
  const button = trigger(page);
  await expect(button).toContainText(`v${release.version}`);
  await button.focus();
  for (const key of ['Enter', 'Space', 'Enter']) {
    await page.keyboard.press(key);
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole('heading', { name: `Version ${release.version}` })).toBeVisible();
    await expect(panel(page).getByRole('listitem')).toHaveText(release.notes);
    await expect(page.locator('#release-close')).toBeFocused();
    for (const tab of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(tab);
      expect(await page.evaluate(() => document.activeElement === document.body || Boolean(document.activeElement.closest('#release-dialog')))).toBe(true);
    }
    await page.keyboard.press('Control+k');
    await expect(page.locator('#palette')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await expect(button).toBeFocused();
  }
  await button.click();
  await page.locator('#release-close').click();
  await expect(panel(page)).toBeHidden();
  await expect(button).toBeFocused();
});

test('panel contents, padding and drags stay open; backdrop dismisses and restores focus', async ({ page }) => {
  await openApp(page);
  await trigger(page).click();
  await page.locator('#release-version').click();
  await expect(panel(page)).toBeVisible();
  const box = await panel(page).boundingBox();
  await page.mouse.click(box.x + 5, box.y + 5);
  await expect(panel(page)).toBeVisible();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await expect(panel(page)).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(panel(page)).toBeHidden();
  await expect(trigger(page)).toBeFocused();
});

for (const theme of ['dark', 'light']) {
  test(`${theme} narrow and short mobile panel fits and remains dismissible`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await openApp(page);
    await trigger(page).click();
    const box = await panel(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(Math.abs(box.x + box.width / 2 - 160)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - 284)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.screenshot({ path: testInfo.outputPath(`release-${theme}-mobile.png`) });
    await page.setViewportSize({ width: 568, height: 320 });
    await expect(page.locator('#release-close')).toBeVisible();
    await page.locator('#release-close').click();
    await expect(trigger(page)).toBeFocused();
  });
}

test('version panel is included in the offline shell', async ({ page, context }) => {
  await openApp(page);
  // Explicitly await registration before readiness to avoid racing startup registration.
  await page.evaluate(() => navigator.serviceWorker.register('/sw.js').then(() => undefined));
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state), { timeout: 10000 }).toBe('activated');
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.reload();
  await trigger(page).click();
  await expect(panel(page).getByRole('listitem')).toHaveText(release.notes);
  await page.keyboard.press('Escape');
  await expect(trigger(page)).toBeFocused();
  await context.setOffline(false);
});
