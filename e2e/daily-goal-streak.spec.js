import { test, expect, openApp, chooseWords, completePassage, openView } from './fixtures.js';

test('daily goal line and practice calendar render on Progress', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await page.locator('.preferences summary').click();
  await page.locator('#daily-goal').selectOption('5');
  await page.keyboard.press('Escape');
  await chooseWords(page, 10);
  await completePassage(page);
  await openView(page, 'Progress');
  await expect(page.locator('#practice-goal')).toBeVisible();
  await expect(page.locator('#goal-line')).toHaveText(/^Today \d+ \/ 5 min · \d+-day streak$/);
  const days = page.locator('#goal-calendar .goal-day');
  expect(await days.count()).toBeGreaterThanOrEqual(17 * 7 + 1);
  const today = days.last();
  await expect(today).toHaveAttribute('data-level', '1');
  await expect(today).toHaveAttribute('title', /^[A-Z][a-z]{2} \d{1,2}: \d+ min$/);

  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.mouse.move(640, 300);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `docs/screenshots/daily-goal-streak/progress-${theme}.png` });
  }
});
