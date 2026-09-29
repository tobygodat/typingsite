import { quoteCorpus } from '../src/typing.js';
import { test, expect, openApp, passageText, typeInto, chooseWords, completePassage, freshTextCheck, openView } from './fixtures.js';

const translateY = (page) => page.locator('#text-display').evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).m42);

test('baseline, manual drill and fresh retest land in progress', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await chooseWords(page, 10);
  const baseline = await completePassage(page);

  // Sparse evidence gives a general drill, never a confident weakness.
  await expect(page.locator('#recommendation-title')).toHaveText('General drill');
  await expect(page.locator('#recommendation-evidence')).toHaveText(/^(Too little data to target a pattern yet|Not enough clean data to name a weakness yet)/);
  await expect(page.locator('#recommendation-meta')).toHaveText('About 1 min, then a fresh 10-word retest.');

  await page.locator('#manual-heading').click();
  await page.locator('#manual-target-input').fill('br!');
  await page.locator('#apply-manual-target').click();
  await expect(page.locator('#manual-target-input')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#manual-target-error')).toHaveText('Use 1–8 letters, no spaces or punctuation.');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');

  await page.locator('#manual-target-input').fill('br');
  await page.locator('#apply-manual-target').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#session-title')).toHaveText('Practice “br”');
  await expect(page.locator('#session-description')).toHaveText('Doesn’t count toward your best.');
  await expect(page.locator('.practice-controls')).toBeHidden();
  const drill = await passageText(page);
  expect(drill.split(' ').every((word) => word.includes('br'))).toBe(true);

  // Long text scrolls inside the fixed three-line window and the caret stays in view.
  await typeInto(page, drill.slice(0, 190));
  await expect.poll(() => translateY(page)).toBeLessThan(0);
  const wrap = await page.locator('#typing-wrap').boundingBox();
  await expect.poll(async () => {
    const caret = await page.locator('#text-display .caret').boundingBox();
    return caret.y >= wrap.y && caret.y + caret.height <= wrap.y + wrap.height;
  }).toBe(true);
  expect(wrap.height).toBeGreaterThan(0);

  // The drill is one minute long, then the retest starts itself.
  await page.clock.fastForward(60_000);
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await expect(page.locator('#session-title')).toHaveText('Measure the change');
  await expect(page.locator('#condition-line')).toContainText('10 words');
  const retest = await passageText(page);
  expect(retest).not.toBe(baseline);

  await completePassage(page);
  const panel = page.locator('#comparison-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-outcome', /^(improved|mixed|regressed|steady)$/);
  // Ten words give too few "br" intervals to call a timing change.
  await expect(page.locator('#comparison-timing')).toHaveText('—');
  await expect(page.locator('#comparison-sample')).toHaveText(/^br · \d+ before · \d+ after · too few to call$/);

  await openView(page, 'Progress');
  await expect(page.locator('#progress-empty')).toBeHidden();
  await expect(page.locator('.history-row')).toHaveCount(1);
  await expect(page.locator('.history-target')).toHaveText('“br” drill and retest');
  await expect(page.locator('.history-conditions')).toContainText('10 words');
});

test('a skipped drill is saved as a fresh-text check', async ({ page }) => {
  await openApp(page);
  const { baseline, retest } = await freshTextCheck(page);
  expect(retest).not.toBe(baseline);
  await expect(page.locator('#comparison-caveat')).not.toContainText('Couldn’t save');
  await openView(page, 'Progress');
  await expect(page.locator('.history-target')).toHaveText('Fresh-text check');
});

test('a manual drill works without a baseline', async ({ page }) => {
  await openApp(page);
  await openView(page, 'Train');
  await expect(page.locator('#recommendation-title')).toHaveText('Finish a run to get a drill.');
  await expect(page.locator('#start-drill')).toBeDisabled();
  await page.locator('#manual-heading').click();
  await page.locator('#manual-target-input').fill('th');
  await page.locator('#apply-manual-target').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#session-title')).toHaveText('Practice “th”');
  await expect(page.locator('#condition-line')).toContainText('drill · 60 s');
});

test('an exhausted quote pool refuses a retest and explains why', async ({ page }) => {
  const pool = quoteCorpus.filter((quote) => quote.difficulty === 'gentle' && quote.text.split(/\s+/).length > 30 && quote.text.split(/\s+/).length <= 60);
  expect(pool.length).toBeGreaterThan(1);

  const texts = new Set(pool.map((quote) => quote.text));
  const seen = new Set();
  const note = async () => { const text = await passageText(page); if (texts.has(text)) seen.add(text); };
  await openApp(page);
  await page.locator('#mode-quote').click();
  await note();
  await page.locator('#quote-length').selectOption('medium');
  await page.locator('#quote-difficulty').selectOption('gentle');
  // Every displayed quote is marked seen, so restarting walks the whole pool.
  for (let tries = 0; seen.size < pool.length && tries < 10; tries += 1) {
    await note();
    if (seen.size < pool.length) await page.locator('#restart-button').click();
  }
  expect(seen.size).toBe(pool.length);

  await completePassage(page);
  await page.locator('#skip-to-retest').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#comparison-panel')).toHaveAttribute('data-outcome', 'unavailable');
  await expect(page.locator('#comparison-status')).toHaveText('No fair retest available.');
  await expect(page.locator('#comparison-caveat')).toContainText('You’ve seen every matching quote');
});

test('an empty quote filter says so and recovers', async ({ page }) => {
  const empty = quoteCorpus.filter((quote) => quote.difficulty === 'gentle' && quote.text.split(/\s+/).length <= 30);
  expect(empty).toHaveLength(0);

  await openApp(page);
  await page.locator('#mode-quote').click();
  await expect(page.locator('#quote-options')).toBeVisible();
  await page.locator('#quote-length').selectOption('short');
  await page.locator('#quote-difficulty').selectOption('gentle');
  await expect(page.locator('#text-display')).toHaveText('No passage matches these filters.');
  await expect(page.locator('#typing-input')).toBeDisabled();
  await expect(page.locator('#input-help')).toHaveText('Try another quote length or difficulty.');

  await page.locator('#quote-length').selectOption('medium');
  await expect(page.locator('#typing-input')).toBeEnabled();
  const words = (await passageText(page)).split(/\s+/).length;
  expect(words).toBeGreaterThan(30);
  expect(words).toBeLessThanOrEqual(60);
});

test('clearing history needs the typed word and can be undone', async ({ page }) => {
  await openApp(page);
  await freshTextCheck(page);
  await openView(page, 'Progress');
  await expect(page.locator('.history-row')).toHaveCount(1);

  await page.locator('#clear-history').click();
  await expect(page.locator('#clear-dialog')).toBeVisible();
  await page.locator('#confirm-clear-input').fill('clea');
  await expect(page.locator('#confirm-clear')).toBeDisabled();
  await page.locator('#confirm-clear-input').fill('clear');
  await expect(page.locator('#confirm-clear')).toBeEnabled();
  await page.locator('#confirm-clear').click();

  await expect(page.locator('#progress-empty')).toBeVisible();
  await expect(page.locator('#history-toast')).toBeVisible();
  await expect(page.locator('#undo-clear')).toBeFocused();
  await expect(page.locator('#best')).toHaveText('No best yet');

  await page.locator('#undo-clear').click();
  await expect(page.locator('#history-feedback')).toHaveText('History restored.');
  await expect(page.locator('.history-row')).toHaveCount(1);
  await expect(page.locator('#best')).toHaveText(/^Best · \d+ wpm$/);
});
