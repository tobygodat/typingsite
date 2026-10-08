import { test, expect, openApp, passageText, typeInto, chooseWords, completePassage, openSettings } from './fixtures.js';

test('tab as the restart key resets the passage, and esc still works', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await page.locator('#restart-key').selectOption('Tab');
  await expect(page.locator('#restart-key-hint')).toHaveText('tab');
  await page.keyboard.press('Escape');
  await expect(page.locator('.preferences-popover')).toBeHidden();

  const before = await passageText(page);
  await typeInto(page, before.slice(0, 3));
  await expect(page.locator('#text-display .char.correct')).toHaveCount(3);
  await page.keyboard.press('Tab');
  await expect(page.locator('#typing-input')).toBeFocused();
  await expect(page.locator('#text-display .char.correct')).toHaveCount(0);
  await expect(page.locator('#typing-input')).toHaveValue('');
  await expect(page.locator('body')).not.toHaveAttribute('data-running', 'true');

  // Esc keeps working alongside the chosen key.
  await typeInto(page, (await passageText(page)).slice(0, 2));
  await page.keyboard.press('Escape');
  await expect(page.locator('#text-display .char.correct')).toHaveCount(0);

  // From the result card, Tab starts a fresh run.
  await completePassage(page);
  await page.locator('body').evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Tab');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#typing-input')).toBeFocused();
});

test('tab still moves focus inside the settings popover', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await page.locator('#restart-key').selectOption('Tab');
  await page.locator('#restart-key').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#live-toggle')).toBeFocused();
  await expect(page.locator('.preferences-popover')).toBeVisible();
});

test('enter restarts from the result card but not mid-run', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await page.locator('#restart-key').selectOption('Enter');
  await expect(page.locator('#restart-key-hint')).toHaveText('enter');
  await page.keyboard.press('Escape');

  const text = await passageText(page);
  await typeInto(page, text.slice(0, 3));
  await page.keyboard.press('Enter');
  await expect(page.locator('#text-display .char.correct')).toHaveCount(3);

  await page.keyboard.press('Escape');
  await completePassage(page);
  await page.locator('body').evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#text-display .char.correct')).toHaveCount(0);
});

test('screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page);
    await openSettings(page);
    await page.locator('#restart-key').selectOption('Tab');
    await page.screenshot({ path: `docs/screenshots/quick-restart/settings-${scheme}.png` });
  }
});
