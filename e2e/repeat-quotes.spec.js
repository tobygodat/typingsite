// Repeat quotes: off by default, a setting and a palette command, and honest labels when a seen quote returns.
import { test, expect, completePassage, openApp, openView, openSettings, passageText, typeInto } from './fixtures.js';

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function shot(page, testInfo, name) {
  // Let theme cross-fades and screen fades finish (the idle caret's breathing never does).
  await page.evaluate(() => Promise.race([new Promise((done) => setTimeout(done, 1000)), Promise.all(document.getAnimations()
    .filter((animation) => (animation instanceof CSSTransition || animation instanceof CSSAnimation) && animation.effect?.getComputedTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined)))]));
  const path = process.env.SCREENSHOTS ? `docs/screenshots/repeat-quotes/${name}.png` : testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
}

// Quote selection reads Math.random on every pick. Pinning it makes the middle of three short gentle
// quotes the first choice, and the same quote the one that comes back once repeats are on.
async function shortGentleQuotes(page) {
  await page.evaluate(() => { Math.random = () => 0.5; });
  await page.locator('#mode-quote').click();
  await page.locator('#quote-length').selectOption('short');
  await page.locator('#quote-difficulty').selectOption('gentle');
  await expect(page.locator('#input-help')).toHaveText('');
  return passageText(page);
}

async function setRepeats(page, on) {
  await openSettings(page);
  await page.locator('#repeat-quotes-toggle').setChecked(on);
}

// About 70 and 90 wpm: a human pace, so the scores on the run card are believable.
async function typeQuote(page, delay) {
  await typeInto(page, await passageText(page), '#typing-input', { delay });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
}

test('off by default: unseen quotes come first, and an exhausted pool says it is repeating', async ({ page }) => {
  await openApp(page);
  const shown = [await shortGentleQuotes(page)];
  for (let i = 0; i < 2; i += 1) {
    await page.locator('#restart-button').click();
    await expect(page.locator('#input-help')).toHaveText('');
    shown.push(await passageText(page));
  }
  expect(new Set(shown).size).toBe(3);
  await page.locator('#restart-button').click();
  expect(shown).toContain(await passageText(page));
  await expect(page.locator('#input-help')).toHaveText('You’ve seen every matching quote. Repeated text doesn’t count toward your best.');

  // The palette command shows and flips the setting, and the settings switch follows it.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('repeat quotes');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('repeat quotes');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-hint')).toHaveText('off');
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
  await openSettings(page);
  await expect(page.locator('#repeat-quotes-toggle')).toBeChecked();
  await expect(page.locator('#input-help')).toHaveText('Repeated text · doesn’t count toward your best.');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('repeat quotes');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-hint')).toHaveText('on');

  // Generated text never repeats, so outside quote mode the switch and the command are off limits.
  await page.keyboard.press('Escape');
  await page.locator('#mode-words').click();
  await openSettings(page);
  await expect(page.locator('#repeat-quotes-toggle')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('repeat quotes');
  await expect(page.locator('#palette-list')).not.toContainText('repeat quotes');
});

test('on: a seen quote can return to chase its score, but never sets a best, a baseline or a trend point', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  const quote = await shortGentleQuotes(page);
  await setRepeats(page, true);
  await shot(page, testInfo, 'settings-dark');
  await page.keyboard.press('Escape');

  // The first run on the quote is fresh text: it sets the best as usual.
  await typeQuote(page, 165);
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');
  const best = await page.locator('#best').textContent();
  expect(best).toMatch(/^Best · \d+ wpm$/);
  const first = Number(await page.locator('#result-wpm').textContent());

  await page.locator('#run-again').click();
  expect(await passageText(page)).toBe(quote);
  await expect(page.locator('#input-help')).toHaveText('Repeated text · doesn’t count toward your best.');
  await page.emulateMedia({ colorScheme: 'light' });
  await shot(page, testInfo, 'practice-repeated-light');

  // Typing it again faster beats the first run, but only against this passage.
  await typeQuote(page, 125);
  const again = Number(await page.locator('#result-wpm').textContent());
  expect(again).toBeGreaterThan(first);
  expect(again).toBeLessThan(115);
  await expect(page.locator('#result-delta')).toHaveText(`Repeated text · +${again - first} vs your best of ${first} on this passage`);
  await expect(page.locator('#result-comparison-note')).toHaveText('');
  await expect(page.locator('#result-conditions')).toContainText('repeated text · english · short quote · gentle');
  await expect(page.locator('#best')).toHaveText(best);
  await expect(page.locator('#skip-to-retest')).toBeDisabled();
  await expect(page.locator('#recommendation-meta')).toContainText('Repeated text stays out of your best, trends and retests');
  await shot(page, testInfo, 'results-repeated-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, testInfo, 'results-repeated-dark');

  await openView(page, 'Progress');
  await expect(page.locator('#run-history .run-row')).toHaveCount(2);
  await expect(page.locator('#run-history .run-row').first()).toContainText('practice · repeated text');
  await expect(page.locator('#progress-trend .trend-dot')).toHaveCount(2); // one fresh run, in each of the two charts
  await expect(page.locator('#progress-trend-note')).toContainText('1 repeated-text run is listed below but left out of the chart and weekly medians.');
  await page.emulateMedia({ colorScheme: 'light' });
  // The conditions, the week line and the trend note sit below the dock, with both runs in view.
  await page.locator('#progress-conditions').evaluate((node) => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 100));
  await shot(page, testInfo, 'progress-light');

  // Turning repeats off swaps a repeated passage that hasn't been started for unseen text. From another view
  // the swap waits until Practice opens, so the switch never moves you.
  await openView(page, 'Practice');
  await page.locator('#restart-button').click();
  expect(await passageText(page)).toBe(quote);
  await openView(page, 'Progress');
  await setRepeats(page, false);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'progress');
  expect(await passageText(page)).toBe(quote);
  await page.keyboard.press('Escape');
  await openView(page, 'Practice');
  await expect(page.locator('#input-help')).toHaveText('');
  expect(await passageText(page)).not.toBe(quote);

  // On Practice the swap is immediate.
  await setRepeats(page, true);
  await page.keyboard.press('Escape');
  await page.locator('#restart-button').click();
  expect(await passageText(page)).toBe(quote);
  await setRepeats(page, false);
  await expect(page.locator('#input-help')).toHaveText('');
  expect(await passageText(page)).not.toBe(quote);
});

// The palette's restart navigates to Practice (which swaps the stale repeat) and then restarts. Only the
// passage left showing is recorded as seen, so the swap in between doesn't use up an unseen quote.
test('off from another view, the palette restart swaps a queued repeat for fresh text and uses up one quote', async ({ page }) => {
  await openApp(page);
  const quote = await shortGentleQuotes(page);
  await setRepeats(page, true);
  await page.keyboard.press('Escape');
  await page.locator('#restart-button').click();
  expect(await passageText(page)).toBe(quote);
  await expect(page.locator('#input-help')).toHaveText('Repeated text · doesn’t count toward your best.');

  await openView(page, 'Progress');
  await setRepeats(page, false);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('restart test');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('restart test');
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#input-help')).toHaveText('');
  const swapped = await passageText(page);
  expect(swapped).not.toBe(quote);

  // Two of the three short gentle quotes are used, so exactly one unseen quote is left before the pool runs out.
  await page.locator('#restart-button').click();
  await expect(page.locator('#input-help')).toHaveText('');
  expect([quote, swapped]).not.toContain(await passageText(page));
  await page.locator('#restart-button').click();
  await expect(page.locator('#input-help')).toHaveText('You’ve seen every matching quote. Repeated text doesn’t count toward your best.');
});

test('a daily repeat attempt is repeated text too, so it is never a retest baseline', async ({ page }) => {
  await openApp(page);
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await page.locator('#start-daily').click();
  await completePassage(page);
  await expect(page.locator('#skip-to-retest')).toBeEnabled();
  await page.locator('#run-again').click();
  await expect(page.locator('#session-description')).toContainText('repeat attempt');
  await completePassage(page);
  await expect(page.locator('#result-delta')).toHaveText('Daily challenge complete · repeat attempt');
  await expect(page.locator('#skip-to-retest')).toBeDisabled();
  await expect(page.locator('#recommendation-meta')).toHaveText('A standalone drill. Finish a practice run to establish a fresh-text retest baseline.');
});

test('stop on error: a blocked letter swaps the notice for its hint without moving restart', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openApp(page);
  await shortGentleQuotes(page);
  await openSettings(page);
  await page.locator('#stop-on-error-toggle').setChecked(true);
  await page.locator('#repeat-quotes-toggle').setChecked(true);
  await page.keyboard.press('Escape');
  await page.locator('#restart-button').click();
  await expect(page.locator('#input-help')).toHaveText('Repeated text · doesn’t count toward your best.');
  const text = await passageText(page);
  const top = async () => (await page.locator('#restart-button').boundingBox()).y;
  await page.locator('#typing-input').focus();
  await page.keyboard.type(text.slice(0, 3));
  const before = await top();
  // A wrong letter is kept and underlined; the next key is blocked until it is fixed.
  await page.keyboard.type((text[3] === 'x' ? 'q' : 'x') + text[4]);
  await expect(page.locator('#input-help')).toHaveText('Fix the underlined letter.');
  expect(await top()).toBe(before);
});

test('on: a retest still draws unseen text and compares fairly', async ({ page }) => {
  await openApp(page);
  const quote = await shortGentleQuotes(page);
  await setRepeats(page, true);
  await page.keyboard.press('Escape');
  await typeQuote(page, 0);
  await page.locator('#skip-to-retest').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  expect(await passageText(page)).not.toBe(quote);
  await expect(page.locator('#session-description')).toHaveText('Fresh text, same conditions.');
  await expect(page.locator('#condition-line')).not.toContainText('repeated text');
  await typeQuote(page, 0);
  await expect(page.locator('#comparison-panel')).not.toHaveAttribute('data-outcome', 'unavailable');
});

test.describe('phone 390px', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the repeated-text notice fits beside restart', async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await shortGentleQuotes(page);
    await setRepeats(page, true);
    await page.keyboard.press('Escape');
    await page.locator('#restart-button').click();
    await expect(page.locator('#input-help')).toHaveText('Repeated text · doesn’t count toward your best.');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shot(page, testInfo, 'practice-repeated-mobile');
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});
