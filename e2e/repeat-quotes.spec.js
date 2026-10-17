// Repeat quotes: off by default, a setting and a palette command, and honest labels when a seen quote returns.
import { test, expect, completePassage, openApp, openView, openSettings, passageText, signInWithEmail, typeInto, chooseMore } from './fixtures.js';

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// Docs images are taken only on request (SCREENSHOTS=1).
async function shot(page, name) {
  if (!process.env.SCREENSHOTS) return;
  // Let theme cross-fades and screen fades finish (the idle caret's breathing never does).
  await page.evaluate(() => Promise.race([new Promise((done) => setTimeout(done, 1000)), Promise.all(document.getAnimations()
    .filter((animation) => (animation instanceof CSSTransition || animation instanceof CSSAnimation) && animation.effect?.getComputedTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined)))]));
  await page.screenshot({ path: `docs/screenshots/repeat-quotes/${name}.png` });
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

// Repeat quotes sits in the collapsed test content category of settings.
async function openTestContent(page) {
  await openSettings(page);
  const category = page.locator('#test-content-settings');
  if (!(await category.evaluate((node) => node.open))) await category.locator('summary').click();
  await expect(page.locator('#repeat-quotes-toggle')).toBeVisible();
}

async function setRepeats(page, on) {
  await openTestContent(page);
  await page.locator('#repeat-quotes-toggle').setChecked(on);
}

const EXHAUSTED = 'You’ve seen every matching quote. Repeated text doesn’t count toward your best.';
const REPEATED = 'Repeated text · doesn’t count toward your best.';

// From Progress, through the typed confirmation; the undo toast is then showing.
async function clearHistory(page) {
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(page.locator('#undo-clear')).toBeFocused();
}

// With `msPerKey`, the page clock (installed by the test) is paused and moves only when the test moves
// it, a word at a time, so the pace is exact however busy the machine is: 165 and 125 ms a key are
// about 73 and 96 wpm.
async function typeQuote(page, msPerKey = 0) {
  const text = await passageText(page);
  if (!msPerKey) await typeInto(page, text);
  else {
    await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
    await page.locator('#typing-input').focus();
    for (const word of text.match(/\S+\s*/g)) {
      await page.keyboard.type(word);
      await page.clock.fastForward(word.length * msPerKey);
    }
    await page.clock.resume();
  }
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
  await openTestContent(page);
  await expect(page.locator('#repeat-quotes-toggle')).toBeChecked();
  await expect(page.locator('#input-help')).toHaveText('Repeated text · doesn’t count toward your best.');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('repeat quotes');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-hint')).toHaveText('on');

  // Generated text never repeats, so outside quote mode the switch and the command are off limits.
  await page.keyboard.press('Escape');
  await page.locator('#mode-words').click();
  await openTestContent(page);
  await expect(page.locator('#repeat-quotes-toggle')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('repeat quotes');
  await expect(page.locator('#palette-list')).not.toContainText('repeat quotes');
});

test('custom text is never labelled repeated text, keeps its passage when repeats change and stays out of Progress', async ({ page }) => {
  const text = 'the quick brown fox jumps over the lazy dog';
  await openApp(page);
  await page.locator('#mode-quote').click();
  await chooseMore(page, 'mode-custom');
  await page.locator('#custom-text').fill(text);
  await page.locator('#custom-use').click();
  // A custom passage is never fresh, but it is its own session, not a repeat.
  await expect(page.locator('#condition-line')).toHaveText(/^custom text · /);
  await expect(page.locator('#input-help')).toHaveText('');

  await setRepeats(page, true);
  await page.keyboard.press('Escape');
  expect(await passageText(page)).toBe(text);
  await expect(page.locator('#condition-line')).toHaveText(/^custom text · /);
  await expect(page.locator('#input-help')).toHaveText('');

  // The same text twice: still never "repeated text", never chasing a passage best.
  for (let i = 0; i < 2; i += 1) {
    await typeInto(page, text);
    await expect(page.locator('#result-conditions')).toHaveText(/^custom text · /);
    await expect(page.locator('#result-delta')).toHaveText('Custom text complete · not counted toward your best');
    if (i === 0) {
      await page.locator('#run-again').click();
      expect(await passageText(page)).toBe(text);
    }
  }

  await openView(page, 'Progress');
  await expect(page.locator('#progress-empty')).toBeVisible();
  await expect(page.locator('#run-history .run-row')).toHaveCount(0);
});

test('on: a seen quote can return to chase its score, but never sets a best, a baseline or a trend point', async ({ page }) => {
  test.setTimeout(60_000);
  await page.clock.install();
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  const quote = await shortGentleQuotes(page);
  await setRepeats(page, true);
  await shot(page, 'settings-dark');
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
  await shot(page, 'practice-repeated-light');

  // Typing it again faster beats the first run, but only against this passage.
  await typeQuote(page, 125);
  const again = Number(await page.locator('#result-wpm').textContent());
  expect(again).toBeGreaterThan(first);
  // The run ends on its last key, before the clock steps past the last word, so it lasts the passage less that
  // word at 125 ms a key. The bounds allow up to one word of slack.
  const pace = (keys) => quote.length / 5 / (keys * 125 / 60000);
  expect(again).toBeGreaterThanOrEqual(Math.floor(pace(quote.length)));
  expect(again).toBeLessThanOrEqual(Math.ceil(pace(quote.length - quote.match(/\S+$/)[0].length)));
  await expect(page.locator('#result-delta')).toHaveText(`Repeated text · +${again - first} vs your best of ${first} wpm on this passage`);
  await expect(page.locator('#result-comparison-note')).toHaveText('');
  await expect(page.locator('#result-conditions')).toContainText('repeated text · english · short quote · gentle');
  await expect(page.locator('#best')).toHaveText(best);
  await expect(page.locator('#skip-to-retest')).toBeDisabled();
  await expect(page.locator('#recommendation-meta')).toContainText('Repeated text stays out of your best, trends and retests');
  await shot(page, 'results-repeated-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, 'results-repeated-dark');

  await openView(page, 'Progress');
  await expect(page.locator('#run-history .run-row')).toHaveCount(2);
  await expect(page.locator('#run-history .run-row').first()).toContainText(' · repeated text');
  await expect(page.locator('#progress-trend .trend-dot')).toHaveCount(2); // one fresh run, in each of the two charts
  await expect(page.locator('#progress-trend-note')).toContainText('1 repeated-text run not charted.');
  await page.emulateMedia({ colorScheme: 'light' });
  // The conditions, the week line and the trend note sit below the dock, with both runs in view.
  await page.locator('#progress-conditions').evaluate((node) => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 100));
  await shot(page, 'progress-light');

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

// Clearing history empties the seen list, so the passage still waiting on Practice is the first text the
// cleared history shows: fresh text, recorded as seen. Undo gives it back the label the restored history gave it.
test('clearing history makes a queued repeat fresh text, which can set a best', async ({ page, supabase }) => {
  test.setTimeout(120_000);
  supabase.addUser('repeats@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'repeats@stilltype.test');
  const quote = await shortGentleQuotes(page);
  await setRepeats(page, true);
  await page.keyboard.press('Escape');
  await typeQuote(page);
  const cloud = () => supabase.profileFor('repeats@stilltype.test');
  await expect.poll(() => cloud()?.runs.length).toBe(1);
  const first = cloud().runs[0].id;
  await page.locator('#run-again').click();
  expect(await passageText(page)).toBe(quote);
  await expect(page.locator('#input-help')).toHaveText(REPEATED);

  await openView(page, 'Progress');
  await clearHistory(page);
  await openView(page, 'Practice');
  expect(await passageText(page)).toBe(quote);
  await expect(page.locator('#input-help')).toHaveText('');
  await expect(page.locator('#condition-line')).not.toContainText('repeated text');
  await typeQuote(page);
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');
  await expect(page.locator('#result-conditions')).not.toContainText('repeated text');
  await expect(page.locator('#best')).toHaveText(/^Best · \d+ wpm$/);
  await expect.poll(() => cloud()?.runs.map((r) => r.id !== first)).toEqual([true]);
  const profile = cloud();
  expect(profile.runs[0]).toMatchObject({ fresh: true });
  expect(Object.values(profile.bests)).toEqual([expect.objectContaining({ attemptId: profile.runs[0].id })]);
});

test('clearing history relabels an exhausted-pool repeat, and undo puts the label back', async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page);
  await shortGentleQuotes(page);
  await typeQuote(page);
  await page.locator('#run-again').click();
  await expect(page.locator('#input-help')).toHaveText('');
  await page.locator('#restart-button').click();
  await expect(page.locator('#input-help')).toHaveText('');
  await page.locator('#restart-button').click();
  await expect(page.locator('#input-help')).toHaveText(EXHAUSTED);
  const repeated = await passageText(page);

  // Undone at once, the restored history has seen every matching quote again.
  await openView(page, 'Progress');
  await clearHistory(page);
  await page.locator('#undo-clear').click();
  await expect(page.locator('#history-feedback')).toHaveText('History restored.');
  await openView(page, 'Practice');
  expect(await passageText(page)).toBe(repeated);
  await expect(page.locator('#input-help')).toHaveText(EXHAUSTED);
  await expect(page.locator('#condition-line')).toContainText('repeated text');

  // Cleared for good, the waiting quote is fresh and the only one seen, so two unseen quotes follow it.
  await openView(page, 'Progress');
  await clearHistory(page);
  await openView(page, 'Practice');
  expect(await passageText(page)).toBe(repeated);
  await expect(page.locator('#input-help')).toHaveText('');
  await expect(page.locator('#condition-line')).not.toContainText('repeated text');
  const shown = [repeated];
  for (let i = 0; i < 2; i += 1) {
    await page.locator('#restart-button').click();
    await expect(page.locator('#input-help')).toHaveText('');
    shown.push(await passageText(page));
  }
  expect(new Set(shown).size).toBe(3);
  await page.locator('#restart-button').click();
  await expect(page.locator('#input-help')).toHaveText(EXHAUSTED);
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
  await openTestContent(page);
  await page.locator('#correction-select').selectOption('mandatory');
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
  await typeQuote(page);
  await page.locator('#skip-to-retest').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  expect(await passageText(page)).not.toBe(quote);
  await expect(page.locator('#session-description')).toHaveText('Fresh text, same conditions.');
  await expect(page.locator('#condition-line')).not.toContainText('repeated text');
  await typeQuote(page);
  await expect(page.locator('#comparison-panel')).not.toHaveAttribute('data-outcome', 'unavailable');
});

test.describe('phone 390px', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the repeated-text notice fits beside restart', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await shortGentleQuotes(page);
    await setRepeats(page, true);
    await page.keyboard.press('Escape');
    await page.locator('#restart-button').click();
    await expect(page.locator('#input-help')).toHaveText('Repeated text · doesn’t count toward your best.');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shot(page, 'practice-repeated-mobile');
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});
