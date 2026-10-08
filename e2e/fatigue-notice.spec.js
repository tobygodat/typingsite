// Fatigue-aware sittings: after eight practice tests, a quiet line appears only when the last five
// all fall below the sitting's earlier median, once per sitting, and a person can turn it off.
import { test, expect, openApp, passageText, typeInto, chooseWords, openSettings } from './fixtures.js';

async function run(page, delay) {
  const text = await passageText(page);
  await typeInto(page, text, '#typing-input', { delay });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
}

async function again(page) {
  await page.locator('#run-again').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
}

async function slowSitting(page) {
  await chooseWords(page, 10);
  for (let i = 0; i < 8; i += 1) {
    if (i) await again(page);
    await run(page, i < 3 ? 0 : 40);
    if (i < 7) await expect(page.locator('#fatigue-notice')).toBeHidden();
  }
}

test('one run says nothing, and the settings toggle is on by default', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await run(page, 0);
  await expect(page.locator('#fatigue-notice')).toBeHidden();
  await openSettings(page);
  const toggle = page.locator('#fatigue-toggle');
  await expect(toggle).toBeChecked();
  await expect(page.locator('label[for="fatigue-toggle"]')).toContainText('break suggestions');
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
});

test('a slowing sitting shows the evidence once, and "don’t show this" turns it off', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  await slowSitting(page);
  const notice = page.locator('#fatigue-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(/Your last 5 runs are below this session’s median \(\d+ wpm\)\. A short break usually helps\./);

  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.mouse.move(10, 10);
    await notice.scrollIntoViewIfNeeded();
    await page.locator('#run-card').screenshot({ path: `docs/screenshots/fatigue-notice/run-card-${scheme}.png` });
  }

  await page.locator('#fatigue-dismiss').click();
  await expect(notice).toBeHidden();
  await openSettings(page);
  await expect(page.locator('#fatigue-toggle')).not.toBeChecked();
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: `docs/screenshots/fatigue-notice/settings-${scheme}.png` });
  }
});

test('once per sitting: a ninth slow run does not repeat the line', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  await slowSitting(page);
  await expect(page.locator('#fatigue-notice')).toBeVisible();
  await again(page);
  await run(page, 40);
  await expect(page.locator('#fatigue-notice')).toBeHidden();
});
