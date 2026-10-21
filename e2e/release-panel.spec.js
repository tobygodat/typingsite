import { test, expect, openApp, chooseWords, passageText, typeInto } from './fixtures.js';

const version = (page) => page.getByRole('button', { name: 'What’s new in v0.2.0', exact: true });
const panel = (page) => page.getByRole('dialog', { name: 'v0.2.0', exact: true });

test('the footer version opens What’s new by keyboard and returns focus on Escape, Close and the backdrop', async ({ page }) => {
  await openApp(page);
  await expect(version(page)).toHaveText('v0.2.0');
  await version(page).focus();
  for (const key of ['Enter', 'Space']) {
    await page.keyboard.press(key);
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole('listitem')).toHaveCount(6);
    await page.keyboard.press('Control+k');
    await expect(page.locator('#palette')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await expect(version(page)).toBeFocused();
  }
  await version(page).click();
  await page.locator('#release-close').click();
  await expect(panel(page)).toBeHidden();
  await expect(version(page)).toBeFocused();
  await version(page).click();
  await page.mouse.click(5, 5);
  await expect(panel(page)).toBeHidden();
  await expect(version(page)).toBeFocused();
});

test('opening What’s new mid-run interrupts the run', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 6));
  await page.mouse.move(10, 10);
  await version(page).click();
  await expect(page.locator('#typing-status')).toHaveText('Interrupted');
  await page.keyboard.press('Escape');
  await typeInto(page, text.slice(6));
  await expect(page.locator('#result-delta')).toHaveText('Interrupted · not counted');
});

for (const theme of ['dark', 'light']) {
  test(`${theme} What’s new fits a 320px phone with reduced motion`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await openApp(page);
    await version(page).click();
    const box = await panel(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(box.y + box.height).toBeLessThanOrEqual(568);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.locator('#release-close').click();
    await expect(version(page)).toBeFocused();
  });
}
