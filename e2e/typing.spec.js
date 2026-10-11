import { test, expect, openApp, passageText, typeInto, chooseWords, completePassage, openView } from './fixtures.js';

test('a corrected mistake keeps its first-try error and visible tint', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  // Miss a letter, not a space: the default list has many two-letter words.
  const at = [...text].findIndex((char, index) => index > 1 && /[a-z]/.test(char));
  const miss = text[at] === 'x' ? 'z' : 'x';

  await typeInto(page, text.slice(0, at) + miss);
  const wrong = page.locator('#text-display .char.wrong');
  await expect(wrong).toHaveCount(1);
  // Afterimage uses a tint as its second error cue; the old underline was retired.
  const errorCue = await wrong.evaluate((node) => ({
    background: getComputedStyle(node).backgroundColor,
    expected: getComputedStyle(document.documentElement).getPropertyValue('--danger-soft').trim(),
  }));
  expect(errorCue.background).toBe(errorCue.expected);
  expect(errorCue.background).not.toBe('rgba(0, 0, 0, 0)');

  await page.keyboard.press('Backspace');
  await expect(wrong).toHaveCount(0);
  await page.keyboard.type(text.slice(at));

  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-errors')).toHaveText('1');
  const accuracy = Number(await page.locator('#result-accuracy').textContent());
  expect(accuracy).toBeLessThan(100);
  expect(accuracy).toBeGreaterThan(90);
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');
  await expect(page.locator('#run-card')).toBeVisible();
  await expect(page.locator('#run-card-stamp')).toContainText('practice');
  await expect(page.locator('#result-conditions')).toContainText('10 words · plain · physical keyboard · continue on error');
  await expect(page.locator('#best')).toHaveText(/^Best · \d+ wpm$/);
});

test('stop on error blocks the next letter until the miss is fixed', async ({ page }) => {
  await openApp(page);
  await page.locator('details.preferences > summary').click();
  await page.locator('#stop-on-error-toggle').check();
  await expect(page.locator('#condition-line')).toContainText('stop on error');
  const text = await passageText(page);
  const miss = text[0] === 'x' ? 'z' : 'x';

  await typeInto(page, miss + text[1]);
  await expect(page.locator('#input-help')).toHaveText('Fix the underlined letter.');
  await expect(page.locator('#typing-wrap')).toHaveAttribute('data-blocked', 'true');
  await expect(page.locator('#typing-input')).toHaveValue(miss);

  await page.keyboard.press('Backspace');
  await page.keyboard.type(text.slice(0, 3));
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, 3));
  await expect(page.locator('#typing-wrap')).toHaveAttribute('data-blocked', 'false');
});

test('a timed run stops exactly at its limit', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await page.locator('#duration-options [data-length="15"]').click();
  await expect(page.locator('#timer')).toHaveText('15');
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 40));
  await expect(page.locator('#typing-status')).toHaveText('In progress');

  await page.clock.fastForward(15_000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-time')).toHaveText('15.0 s');
  await expect(page.locator('#result-accuracy')).toHaveText('100');
  await expect(page.locator('#result-conditions')).toContainText('15 s');
});

test('paste is refused and leaves the input empty', async ({ page }) => {
  await openApp(page);
  await page.locator('#typing-input').focus();
  await page.locator('#typing-input').evaluate((input) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'the whole passage');
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#typing-input')).toHaveValue('');
  await expect(page.locator('#input-help')).toHaveText('Paste is off. Type the passage.');
  await expect(page.locator('#announcement')).toHaveText('Paste is off. Type the passage.');
});

test('leaving mid-run interrupts it and keeps it out of bests', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 8));

  await openView(page, 'Progress');
  await openView(page, 'Train');
  await expect(page.locator('#result-delta')).toHaveText('Interrupted · not counted');
  await expect(page.locator('#result-comparison-note')).toContainText('isn’t counted');
  await expect(page.locator('#recommendation-title')).toHaveText('Restart for a counted run');
  await expect(page.locator('#start-drill')).toBeDisabled();
  await expect(page.locator('#best')).toHaveText('No best yet');
});

test('escape restarts with a new passage and no progress', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  const first = await passageText(page);
  await typeInto(page, first.slice(0, 5));
  await page.keyboard.press('Escape');
  await expect(page.locator('#typing-input')).toHaveValue('');
  await expect(page.locator('#typing-status')).toHaveText('Ready');
  await expect(page.locator('#progress-track')).toHaveAttribute('aria-valuetext', 'Not started');
  await expect(page.locator('#typing-input')).toBeFocused();
});

test('a finished words run announces its score once', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  const wpm = await page.locator('#result-wpm').textContent();
  await expect(page.locator('#announcement')).toHaveText(`${wpm} wpm, ${await page.locator('#result-accuracy').textContent()}% accuracy.`);
  await expect(page.locator('#live-stats')).not.toHaveAttribute('aria-live', /.+/);
  await expect(page.locator('#run-again')).toBeFocused();
});
