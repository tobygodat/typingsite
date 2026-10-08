// Fatigue-aware sittings: after eight practice tests under one condition set, a quiet line appears
// only when the last five all fall below the earlier runs' median, once per sitting, and a person
// can turn it off.
import { test, expect, openApp, passageText, typeInto, chooseWords, openSettings, openView } from './fixtures.js';

async function run(page, delay) {
  const text = await passageText(page);
  await typeInto(page, text, '#typing-input', { delay });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
}

async function again(page) {
  await page.locator('#run-again').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
}

// Committed docs images are rewritten only on request (SCREENSHOTS=1); a normal run keeps its
// capture in the test output folder.
const shotPath = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/fatigue-notice/${name}` : testInfo.outputPath(name));

// Three quick runs then five slower ones. The screenshot test passes realistic per-key delays
// (~100 ms is about 110 wpm, ~200 ms about 55 wpm) so the captured numbers look like a person's.
async function slowSitting(page, fast = 0, slow = 40) {
  await chooseWords(page, 10);
  for (let i = 0; i < 8; i += 1) {
    if (i) await again(page);
    await run(page, i < 3 ? fast : slow);
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

test('a slowing sitting shows the evidence once, and "don’t show this" turns it off', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await openApp(page);
  await slowSitting(page, 100, 200);
  const notice = page.locator('#fatigue-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(/Your last 5 runs are below the median of your earlier runs this session \(\d+ wpm\)\. You might take a short break\./);
  // The taller print lets go of the viewport while the notice shows, so "don’t show this" stays reachable.
  await expect(page.locator('#run-card')).toHaveCSS('position', 'static');

  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.mouse.move(10, 10);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('#run-card').screenshot({ path: shotPath(testInfo, `run-card-${scheme}.png`) });
  }

  await page.locator('#fatigue-dismiss').click();
  await expect(notice).toBeHidden();
  await expect(page.locator('#run-card')).toHaveCSS('position', 'sticky');
  await openSettings(page);
  await expect(page.locator('#fatigue-toggle')).not.toBeChecked();
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: shotPath(testInfo, `settings-${scheme}.png`) });
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

test('a change of exercise starts a fresh comparison, so harder settings never read as fatigue', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  await chooseWords(page, 10);
  for (let i = 0; i < 3; i += 1) {
    if (i) await again(page);
    await run(page, 0);
  }
  await again(page);
  await chooseWords(page, 25);
  for (let i = 0; i < 5; i += 1) {
    if (i) await again(page);
    await run(page, 40);
    await expect(page.locator('#fatigue-notice')).toBeHidden();
  }
});

// Seven runs that would tip into a notice on the eighth slow one, then history is cleared.
async function clearedSitting(page) {
  await chooseWords(page, 10);
  for (let i = 0; i < 7; i += 1) {
    if (i) await again(page);
    await run(page, i < 3 ? 0 : 40);
  }
  await expect(page.locator('#fatigue-notice')).toBeHidden();
  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(page.locator('#history-feedback')).toContainText('History cleared');
}

test('clearing history clears the sitting, so the next run says nothing', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  await clearedSitting(page);
  await openView(page, 'Practice');
  await run(page, 40);
  await expect(page.locator('#fatigue-notice')).toBeHidden();
});

test('undoing a clear brings the sitting back with the history', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  await clearedSitting(page);
  await page.locator('#undo-clear').click();
  await expect(page.locator('#history-feedback')).toContainText('History restored');
  await openView(page, 'Practice');
  await run(page, 40);
  await expect(page.locator('#fatigue-notice')).toBeVisible();
});
