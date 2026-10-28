import { test, expect, openApp, chooseWords, completePassage, openView } from './fixtures.js';

test('an earlier Undo timeout never hides a new clear confirmation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await page.clock.install({ time: new Date('2026-10-15T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-15T12:00:01Z'));

  const clear = async () => {
    await openView(page, 'Progress');
    await page.locator('#clear-history').click();
    await page.locator('#confirm-clear-input').fill('clear');
    await page.locator('#confirm-clear').click();
    await expect(page.locator('#undo-clear')).toBeVisible();
  };

  await clear();
  await page.locator('#undo-clear').click();
  await clear();
  await page.clock.runFor(1601);
  await expect(page.locator('#undo-clear')).toBeVisible();
  await page.locator('#undo-clear').click();
  await expect(page.locator('#history-feedback')).toHaveText('History restored.');
});
