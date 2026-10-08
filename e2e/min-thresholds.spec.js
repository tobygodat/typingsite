// Minimum accuracy and speed to continue: practice-only settings, judged on the timing tick after a
// grace period, ending a run as interrupted with its reason and keeping it out of bests.
import { test, expect, openApp, passageText, typeInto, chooseWords, completePassage, openSettings } from './fixtures.js';

const shot = (page, testInfo, name) => page.screenshot({
  path: process.env.SCREENSHOTS ? `docs/screenshots/min-thresholds/${name}.png` : testInfo.outputPath(`${name}.png`),
});

// Every sixth key is a miss: about 83% accuracy, typed through (continue on error is the default).
const withMisses = (text) => [...text].map((char, i) => (i % 6 === 5 ? (char === 'x' ? 'z' : 'x') : char)).join('');

// With the page clock paused, it moves only when the test moves it, so the pace is exact however
// busy the machine is: 200 ms a key is 60 wpm.
async function typeAtPace(page, text, msPerKey = 200) {
  await page.locator('#typing-input').focus();
  for (const char of text) {
    await page.keyboard.type(char);
    await page.clock.runFor(msPerKey);
  }
}

async function runCommand(page, query) {
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette-input')).toBeFocused();
  await page.keyboard.type(query);
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
}

test('falling below the minimum accuracy stops the run as interrupted, with its reason', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.clock.install();
  await openApp(page);
  await openSettings(page);
  await expect(page.locator('#min-accuracy')).toHaveValue('0');
  await expect(page.locator('#min-wpm')).toHaveValue('0');
  await expect(page.locator('#minimum-note')).toBeHidden();
  await page.locator('#min-accuracy').selectOption('95');
  await expect(page.locator('#minimum-note')).toHaveText('min 95% accuracy');
  await expect(page.locator('#condition-line')).toContainText('continue on error · corpus v5 · metric v1 · min 95% accuracy');
  await page.keyboard.press('Escape');

  // Twenty-four keys in 4.8 s stay inside the five-second grace, so the run is still going.
  const text = await passageText(page);
  await page.clock.pauseAt(Date.now() + 1000);
  await typeAtPace(page, withMisses(text.slice(0, 24)));
  await expect(page.locator('#typing-status')).toHaveText('In progress');

  // The first once-a-second tick after five seconds judges it.
  await page.clock.runFor(1000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await page.clock.resume();
  await expect(page.locator('#result-delta')).toHaveText('Interrupted · not counted');
  await expect(page.locator('#result-comparison-note')).toHaveText('Stopped: accuracy fell below 95%, so it isn’t counted.');
  await expect(page.locator('#recommendation-title')).toHaveText('Restart for a counted run');
  await expect(page.locator('#recommendation-evidence')).toContainText('fall below your minimums');
  await expect(page.locator('#announcement')).toHaveText(/^Stopped: accuracy fell below 95%\. \d+ wpm, 8\d% accuracy\.$/);
  await expect(page.locator('#result-conditions')).toContainText('min 95% accuracy');
  expect(Number(await page.locator('#result-accuracy').textContent())).toBeLessThan(95);
  const wpm = Number(await page.locator('#result-wpm').textContent());
  expect(wpm).toBe(48);
  await expect(page.locator('#result-time')).toHaveText('5.0 s');
  await expect(page.locator('#start-drill')).toBeDisabled();
  await expect(page.locator('#skip-to-retest')).toBeDisabled();
  await expect(page.locator('#run-again')).toBeFocused();
  await expect(page.locator('#best')).toHaveText('No best yet');
  await expect(page.locator('#typing-status')).toHaveText('Interrupted');
  await expect(page.locator('#typing-status')).toHaveClass(/badge-warning/);

  await page.mouse.move(1270, 790);
  await page.waitForTimeout(600);
  await shot(page, testInfo, 'stopped-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.waitForTimeout(450);
  await shot(page, testInfo, 'stopped-light');

  // Run again starts a fresh practice run that still carries the minimum.
  await page.locator('#run-again').click();
  await expect(page.locator('#typing-status')).toHaveText('Ready');
  await expect(page.locator('#minimum-note')).toHaveText('min 95% accuracy');
});

test('the grace period forgives an early miss, and a run that ends above the minimum counts', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await page.locator('#min-accuracy').selectOption('90');
  await page.keyboard.press('Escape');
  const text = await passageText(page);

  // Two misses in the first twelve keys: 83%, under the minimum for the ticks inside the grace.
  // From twenty keys on, two misses can't take accuracy under 90%, however fast the machine types.
  const opening = [...text.slice(0, 12)].map((char, i) => ([1, 3].includes(i) ? (char === 'x' ? 'z' : 'x') : char)).join('');
  await typeInto(page, opening, '#typing-input', { delay: 100 });
  await page.waitForTimeout(1200);
  await expect(page.locator('#typing-status')).toHaveText('In progress');
  await page.keyboard.type(text.slice(12), { delay: 60 });

  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');
  expect(Number(await page.locator('#result-accuracy').textContent())).toBeGreaterThanOrEqual(90);
  await expect(page.locator('#result-conditions')).toContainText('10 words · plain · physical keyboard · continue on error');
  await expect(page.locator('#result-conditions')).toContainText('min 90% accuracy');
  const best = await page.locator('#best').textContent();
  expect(best).toMatch(/^Best · \d+ wpm$/);

  // The minimum is a label, not a condition: switching it off keeps the same best.
  await openSettings(page);
  await page.locator('#min-accuracy').selectOption('0');
  await expect(page.locator('#best')).toHaveText(best);
  await page.keyboard.press('Escape');
  await page.locator('#run-again').click();
  await expect(page.locator('#minimum-note')).toBeHidden();
  await expect(page.locator('#condition-line')).not.toContainText('min');
});

test('a run that reaches its end under the minimum is stopped too, so every counted run met it', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await page.locator('#min-accuracy').selectOption('98');
  await page.keyboard.press('Escape');
  // Finished well inside the grace period, so only the final check can catch it.
  const text = await passageText(page);
  await typeInto(page, withMisses(text));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Interrupted · not counted');
  await expect(page.locator('#result-comparison-note')).toHaveText('Stopped: accuracy fell below 98%, so it isn’t counted.');
  await expect(page.locator('#best')).toHaveText('No best yet');
});

test('the palette sets a minimum speed, which stops a slow run and resets for a guest', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await page.locator('#typing-input').focus();
  await runCommand(page, 'minimum speed · 60');
  await expect(page.locator('#min-wpm')).toHaveValue('60');
  await expect(page.locator('#minimum-note')).toHaveText('min 60 wpm');
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette-input')).toBeFocused();
  await page.keyboard.type('minimum speed · 60');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-hint')).toHaveText('current');
  await page.keyboard.press('Escape');
  await expect(page.locator('#palette')).toBeHidden();
  await runCommand(page, 'minimum accuracy · 80');
  await expect(page.locator('#minimum-note')).toHaveText('min 80% accuracy · min 60 wpm');

  // 22 keys by five seconds is about 53 wpm: under 60 once the grace is over.
  const text = await passageText(page);
  await page.clock.pauseAt(Date.now() + 1000);
  await typeAtPace(page, text.slice(0, 22));
  await expect(page.locator('#typing-status')).toHaveText('In progress');
  await page.clock.runFor(1000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await page.clock.resume();
  await expect(page.locator('#result-comparison-note')).toHaveText('Stopped: speed fell below 60 wpm, so it isn’t counted.');
  expect(Number(await page.locator('#result-wpm').textContent())).toBeLessThan(60);
  await expect(page.locator('#best')).toHaveText('No best yet');

  // A guest keeps settings only for the tab.
  await page.reload();
  await expect(page.locator('#min-wpm')).toHaveValue('0');
  await expect(page.locator('#minimum-note')).toBeHidden();
});

test('retests and the daily challenge run to the end whatever the minimums', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await page.locator('#min-wpm').selectOption('20');
  await page.keyboard.press('Escape');
  await completePassage(page);
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');

  // The retest keeps the baseline's conditions but never stops at a minimum, so no outcome is filtered.
  await openSettings(page);
  await page.locator('#min-wpm').selectOption('100');
  await page.keyboard.press('Escape');
  await page.locator('#skip-to-retest').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await expect(page.locator('#condition-line')).not.toContainText('min');
  const retest = await passageText(page);
  await page.clock.pauseAt(Date.now() + 1000);
  await typeAtPace(page, retest.slice(0, 22));
  await page.clock.runFor(2000);
  await expect(page.locator('#typing-status')).toHaveText('In progress');
  await page.clock.resume();
  await page.keyboard.type(retest.slice(22));
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect(page.locator('#comparison-status')).not.toHaveText('Retest complete.');

  await runCommand(page, 'daily challenge');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'daily');
  await expect(page.locator('#condition-line')).not.toContainText('min');
});

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test('the settings rows and practice label fit', async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await openApp(page);
      await openSettings(page);
      await page.locator('#min-accuracy').selectOption('95');
      await page.locator('#min-wpm').selectOption('40');
      await expect(page.locator('#minimum-note')).toHaveText('min 95% accuracy · min 40 wpm');
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(await overflow()).toBeLessThanOrEqual(0);
      const popover = await page.locator('.preferences-popover').boundingBox();
      for (const id of ['#min-accuracy', '#min-wpm']) {
        const box = await page.locator(id).boundingBox();
        expect(box.x + box.width, id).toBeLessThanOrEqual(popover.x + popover.width);
      }
      if (viewport.width === 390) await shot(page, testInfo, 'settings-mobile');
      await page.locator('details.preferences summary').click();
      await expect(page.locator('.preferences-popover')).toBeHidden();
      expect(await overflow()).toBeLessThanOrEqual(0);
    });
  });
}

test('desktop settings and the practice label, dark and light', async ({ page }, testInfo) => {
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page);
    await openSettings(page);
    await page.locator('#min-accuracy').selectOption('95');
    await page.locator('#min-wpm').selectOption('40');
    await page.locator('#min-wpm').focus();
    await shot(page, testInfo, `settings-${scheme}`);
    await page.locator('details.preferences summary').click();
    await expect(page.locator('.preferences-popover')).toBeHidden();
    await expect(page.locator('#minimum-note')).toBeVisible();
    await page.mouse.move(1270, 790);
    await shot(page, testInfo, `practice-${scheme}`);
  }
});
