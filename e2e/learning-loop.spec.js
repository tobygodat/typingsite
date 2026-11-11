import { CORPUS_VERSION, METRIC_VERSION, completeAttempt, createAttempt, quoteCorpus } from '../src/typing.js';
import { runRecord } from '../src/insights.js';
import { test, expect, openApp, passageText, typeInto, chooseWords, completePassage, finishDrill, freshTextCheck, openView, signInWithEmail, chooseMore, chooseQuoteFilter, recordedHere } from './fixtures.js';

const translateY = (page) => page.locator('#text-display').evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).m42);

test('baseline, manual drill and fresh retest land in progress', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await chooseWords(page, 10);
  const baseline = await completePassage(page);

  // Sparse evidence gives a general drill, never a confident weakness: the result offers no target, and
  // neither does Train.
  await expect(page.locator('#result-drill')).toHaveText('Drill and retest');
  await openView(page, 'Train');
  await expect(page.locator('#train-heading')).toHaveText('General drill');
  await expect(page.locator('#train-evidence')).toBeHidden();
  await expect(page.locator('#train-words')).toBeHidden();
  await expect(page.locator('#start-drill')).toHaveText('Drill and retest');

  // The letters to drill are picked from Practice's "more" menu.
  await openView(page, 'Practice');
  await chooseMore(page, 'mode-drill');
  await page.locator('#manual-target-input').fill('br!');
  await page.locator('#apply-manual-target').click();
  await expect(page.locator('#manual-target-input')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#manual-target-error')).toHaveText('Use 1–8 letters, no spaces or punctuation.');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');

  await page.locator('#manual-target-input').fill('br');
  await page.locator('#apply-manual-target').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#session-title')).toHaveText('Practice “br”');
  await expect(page.locator('#session-description')).toHaveText('Doesn’t count toward your best.');
  await expect(page.locator('.practice-controls')).toBeHidden();
  const drill = await passageText(page);
  expect(drill.split(' ').every((word) => word.includes('br'))).toBe(true);

  // Long text scrolls inside the fixed three-line window and the caret stays in view.
  const typingFrom = await page.evaluate(() => Date.now());
  await typeInto(page, drill.slice(0, 190));
  await expect.poll(() => translateY(page)).toBeLessThan(0);
  const wrap = await page.locator('#typing-wrap').boundingBox();
  await expect.poll(async () => {
    const caret = await page.locator('#text-display .caret').boundingBox();

    return caret.y >= wrap.y && caret.y + caret.height <= wrap.y + wrap.height;
  }).toBe(true);
  expect(wrap.height).toBeGreaterThan(0);

  // The drill is 30 seconds long from its first key, then the retest starts itself.
  await page.clock.fastForward(29_000 - (await page.evaluate(() => Date.now()) - typingFrom));
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await page.clock.fastForward(1_000);
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await expect(page.locator('#session-title')).toHaveText('Measure the change');
  await expect(page.locator('#condition-line')).toContainText('10 words');
  const retest = await passageText(page);
  expect(retest).not.toBe(baseline);

  await completePassage(page);
  const panel = page.locator('#comparison-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-outcome', /^(improved|mixed|regressed|steady)$/);

  await openView(page, 'Progress');
  await expect(page.locator('#progress-empty')).toBeHidden();
  await expect(page.locator('.history-row')).toHaveCount(1);
  await expect(page.locator('.history-target')).toHaveText('“br” drill and retest');
  await expect(page.locator('.history-conditions')).toContainText('10 words');
  await page.locator('.history-summary').click();
  await expect(page.locator('.history-detail')).toContainText('30 s · br');
  // Ten words give too few "br" intervals to call a timing change. When neither run held "br", the row says
  // nothing about it rather than "0 before · 0 after".
  const held = [baseline, retest].some((text) => text.includes('br'));

  if (held) {
    await expect(page.locator('.history-conditions')).toContainText(/ · br · \d+ before · \d+ after$/);
    await expect(page.locator('.history-detail')).toContainText(/“br” clean intervals: \d+ before \/ \d+ after\. Too few samples to call a timing change\./);
  } else {
    await expect(page.locator('.history-conditions')).not.toContainText('br');
    await expect(page.locator('.history-detail')).not.toContainText('clean intervals');
  }
});

test('leaving a drill for another view ends it without drawing a retest passage', async ({ page, supabase }) => {
  const user = supabase.addUser('loop@stilltype.test');
  const runs = () => supabase.profileFor(user.email)?.runs?.map((run) => `${run.kind} ${run.status}`);
  await openApp(page);
  await signInWithEmail(page, user.email);
  await chooseWords(page, 10);
  await completePassage(page);
  await page.locator('#result-drill').click();
  await expect.poll(() => supabase.profileFor(user.email)?.runs?.length).toBe(1);
  const seen = supabase.profileFor(user.email).seenTextIds;
  await typeInto(page, (await passageText(page)).slice(0, 4));
  await openView(page, 'Progress');
  // The interrupted drill and anything drawn with it reach the account in the same save.
  await expect.poll(runs).toEqual(['test complete', 'drill interrupted']);
  expect(supabase.profileFor(user.email).seenTextIds).toEqual(seen);

  // Leaving through the palette for Challenge draws none either.
  await openView(page, 'Train');
  await page.locator('#start-drill').click();
  await typeInto(page, (await passageText(page)).slice(0, 4));
  await page.keyboard.press('Control+k');
  await page.keyboard.type('challenge');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-label')).toHaveText('challenge');
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'compete');
  await expect.poll(runs).toEqual(['test complete', 'drill interrupted', 'drill interrupted']);
  expect(supabase.profileFor(user.email).seenTextIds).toEqual(seen);

  // And leaving for learn to type.
  await openView(page, 'Train');
  await page.locator('#start-drill').click();
  await typeInto(page, (await passageText(page)).slice(0, 4));
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('learn to type');
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'learn');
  await expect.poll(runs).toEqual(['test complete', 'drill interrupted', 'drill interrupted', 'drill interrupted']);
  expect(supabase.profileFor(user.email).seenTextIds).toEqual(seen);

  // Train still drills and retests against the same baseline; the retest passage is drawn only once
  // a drill has run its 30 seconds.
  await openView(page, 'Train');
  await page.locator('#start-drill').click();
  await expect(page.locator('#session-description')).toHaveText('Doesn’t count toward your best.');
  expect(supabase.profileFor(user.email).seenTextIds).toEqual(seen);
  await finishDrill(page);
  await expect.poll(() => supabase.profileFor(user.email).seenTextIds.length).toBe(seen.length + 1);
  const withRetest = supabase.profileFor(user.email).seenTextIds;

  // Starting the daily challenge from the palette mid-drill records only the daily's own ids.
  await openView(page, 'Train');
  await page.locator('#start-drill').click();
  await typeInto(page, (await passageText(page)).slice(0, 4));
  await page.keyboard.press('Control+k');
  await page.keyboard.type('daily challenge');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-label')).toHaveText('daily challenge');
  await page.keyboard.press('Enter');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'daily');
  const added = () => supabase.profileFor(user.email).seenTextIds.filter((id) => !withRetest.includes(id));
  await expect.poll(() => runs().length).toBe(6);
  await expect.poll(() => added().some((id) => id.startsWith('daily-'))).toBe(true);
  expect(added().filter((id) => !id.startsWith('daily-'))).toEqual([]);
  // The daily dropped the drill's baseline, but Train plans from saved runs: the 10-word test is its
  // baseline again, so its drill leads on to a retest.
  await openView(page, 'Train');
  await expect(page.locator('#start-drill')).toBeEnabled();
  await page.locator('#start-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#condition-line')).toContainText('drill · 30 s');
  await expect(page.locator('#session-description')).toHaveText('Doesn’t count toward your best.');
});

// A saved 25-word run with a "th" slip every fourth character, so two of them make a recurring target.
const savedConditions = { mode: 'words', count: 25, duration: null, punctuation: false, quoteLength: null,
  difficulty: null, wordList: '1k', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };

function savedTrace(id, at) {
  const text = Array(25).fill('the').join(' ');
  const attempt = createAttempt({ id, text, textId: id, conditions: savedConditions });
  attempt.startedAt = 0;
  attempt.events = [...text].map((char, position) => ({ type: 'insert', text: position % 4 === 1 ? 'x' : char,
    position, offsetMs: position * 100, accepted: true }));

  return { ...completeAttempt(attempt, { endedAt: text.length * 100 }), at, fresh: true };
}

test('runs recorded on another device are no baseline: their drill stands alone, quietly', async ({ page, supabase }) => {
  // The saved runs are dated, and Progress opens on the last 30 days.
  await page.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
  const user = supabase.addUser('elsewhere@stilltype.test');
  const traces = [savedTrace('away-a', '2026-09-28T12:00:00Z'), savedTrace('away-b', '2026-09-29T12:00:00Z')];
  // The row as a device that recorded them left it before recordings stopped syncing.
  supabase.profiles.set(user.id, { data: { version: 2, preferences: {}, attempts: traces,
    runs: traces.map((t) => runRecord(t)), loops: [], seenTextIds: traces.map((t) => t.textId), bests: {}, updatedAt: '2026-09-29T12:00:00Z' } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  // The summaries arrive, so the recurring target does too; the recordings stay where they were made.
  await openView(page, 'Progress');
  await expect(page.locator('#training-targets')).toContainText('observed in 2 runs');
  await page.locator('#training-targets').getByRole('button', { name: 'Practice “th” again' }).click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#session-description')).toHaveText('Standalone drill.');
  await openView(page, 'Progress');
  await expect(page.locator('#run-history .run-row')).toHaveCount(2);
  await expect(page.locator('#run-history')).not.toContainText('View passage');
});

test('a drill started from saved history, left once, is retested against that history when drilled again', async ({ page, supabase }) => {
  const user = supabase.addUser('saved@stilltype.test');
  const traces = [savedTrace('saved-a', '2026-09-28T12:00:00Z'), savedTrace('saved-b', '2026-09-29T12:00:00Z')];

  const data = { version: 2, preferences: {}, attempts: traces,
    runs: traces.map((t) => runRecord(t)), loops: [], seenTextIds: traces.map((t) => t.textId), bests: {}, updatedAt: '2026-09-29T12:00:00Z' };

  supabase.profiles.set(user.id, { data });
  const profile = () => supabase.profileFor(user.email);
  const beforeIds = () => profile()?.loops?.map((loop) => loop.beforeAttemptId);
  await openApp(page);
  // Recorded on this device, so its recordings are here to be baselines.
  await recordedHere(page, user.id, data);
  // Signing in reloads the page, so no run has been shown in this tab: only the saved runs can be the baseline.
  await signInWithEmail(page, user.email);
  await openView(page, 'Progress');
  await expect(page.locator('#training-targets')).toContainText('50 tries');
  await expect(page.locator('#training-targets')).toContainText('observed in 2 runs');

  // A recurring target, left mid-drill for Progress.
  await page.locator('#training-targets').getByRole('button', { name: 'Practice “th” again' }).click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await typeInto(page, (await passageText(page)).slice(0, 8));
  await openView(page, 'Progress');
  await expect.poll(() => profile()?.runs?.map((run) => `${run.kind} ${run.status}`)).toEqual(['test complete', 'test complete', 'drill interrupted']);
  // The same pattern again finds the saved baseline: its drill runs its 30 seconds, then the retest.
  await page.locator('#training-targets').getByRole('button', { name: 'Practice “th” again' }).click();
  await expect(page.locator('#session-title')).toHaveText('Practice “th”');
  await expect(page.locator('#session-description')).toHaveText('Doesn’t count toward your best.');
  await finishDrill(page);
  await expect(page.locator('#condition-line')).toContainText('25 words');
  await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect.poll(beforeIds).toEqual(['saved-b']);
  const retest = profile().runs.at(-1);
  expect(retest.kind).toBe('retest');

  // After another reload, a comparison row's drill is retested too, now against that retest as the
  // newest compatible run.
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await page.reload();
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await openView(page, 'Progress');
  await page.locator('.history-summary').click();
  await page.locator('.history-detail').getByRole('button', { name: 'Practice “th” again' }).click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#session-title')).toHaveText('Practice “th”');
  await expect(page.locator('#session-description')).toHaveText('Doesn’t count toward your best.');
  await finishDrill(page);
  await expect(page.locator('#condition-line')).toContainText('25 words');
  await completePassage(page);
  await expect.poll(beforeIds).toEqual(['saved-b', retest.id]);
});

// A custom text result offers no drill, and is never a baseline. A drill started after it is against the
// run before the custom text, so after leaving it, Train's Drill and retest still retests that run.
test('a drill left after a custom text result keeps the earlier baseline’s retest', async ({ page }) => {
  const custom = 'the quick brown fox jumps over the lazy dog';
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await openView(page, 'Practice');
  await chooseMore(page, 'mode-custom');
  await page.locator('#custom-text').fill(custom);
  await page.locator('#custom-use').click();
  await typeInto(page, custom);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-drill')).toBeHidden();

  await chooseMore(page, 'mode-drill');
  await page.locator('#manual-target-input').fill('th');
  await page.locator('#apply-manual-target').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await typeInto(page, (await passageText(page)).slice(0, 4));
  await openView(page, 'Train');
  await expect(page.locator('#start-drill')).toBeVisible();
  await page.locator('#start-drill').click();
  await expect(page.locator('#session-description')).toHaveText('Doesn’t count toward your best.');
  await finishDrill(page);
  await expect(page.locator('#condition-line')).toContainText('10 words');
  expect(await passageText(page)).not.toBe(custom);
});

test('a manual drill works without a baseline', async ({ page }) => {
  await openApp(page);
  // With no run yet, Train's one button is a general drill that stands alone.
  await openView(page, 'Train');
  await expect(page.locator('#train-heading')).toHaveText('General drill');
  await expect(page.locator('#start-drill')).toBeEnabled();
  await page.locator('#start-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#session-description')).toHaveText('Standalone drill.');
  await openView(page, 'Practice');
  await chooseMore(page, 'mode-drill');
  await page.locator('#manual-target-input').fill('th');
  await page.locator('#apply-manual-target').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#session-title')).toHaveText('Practice “th”');
  await expect(page.locator('#condition-line')).toContainText('drill · 30 s');
});

test('an exhausted quote pool refuses a retest and explains why', async ({ page }) => {
  const pool = quoteCorpus.filter((quote) => quote.difficulty === 'gentle' && quote.text.split(/\s+/).length > 30 && quote.text.split(/\s+/).length <= 60);
  expect(pool.length).toBeGreaterThan(1);

  const texts = new Set(pool.map((quote) => quote.text));
  const seen = new Set();

  const note = async () => {
    const text = await passageText(page);

    if (texts.has(text)) seen.add(text);
  };

  await openApp(page);
  await page.locator('#mode-quote').click();
  await note();
  await chooseQuoteFilter(page, 'length', 'medium');
  await note();
  await chooseQuoteFilter(page, 'difficulty', 'gentle');

  // Every displayed quote is marked seen, so restarting walks the whole pool.
  for (let tries = 0; seen.size < pool.length && tries < pool.length + 3; tries += 1) {
    await note();

    if (seen.size < pool.length) await page.locator('#restart-button').click();
  }

  expect(seen.size).toBe(pool.length);

  await completePassage(page);
  // The drill runs its 30 seconds, then the retest finds no unseen quote and Train says why.
  await page.locator('#result-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await page.clock.install();
  await typeInto(page, (await passageText(page)).slice(0, 4));
  await page.clock.fastForward(30_000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'train');
  await expect(page.locator('#comparison-panel')).toHaveAttribute('data-outcome', 'unavailable');
  await expect(page.locator('#comparison-status')).toHaveText('No fair retest available.');
  await expect(page.locator('#comparison-caveat')).toContainText('You’ve seen every matching quote');
});

test('an empty quote filter says so and recovers', async ({ page }) => {
  await page.route('**/src/corpus.js', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/^.*id: 'short-gentle-[^\n]+\n/gm, '');
    await route.fulfill({ response, body });
  });
  await openApp(page);
  await page.locator('#mode-quote').click();
  await expect(page.locator('#quote-options')).toBeVisible();
  await chooseQuoteFilter(page, 'length', 'short');
  await chooseQuoteFilter(page, 'difficulty', 'gentle');
  await expect(page.locator('#text-display')).toHaveText('No passage matches these filters.');
  await expect(page.locator('#typing-input')).toBeDisabled();
  await expect(page.locator('#quote-difficulty')).toBeFocused();
  await expect(page.locator('#input-help')).toHaveText('Try another quote length or difficulty.');

  await chooseQuoteFilter(page, 'difficulty', 'steady');
  await chooseQuoteFilter(page, 'length', 'medium');
  await expect(page.locator('#typing-input')).toBeEnabled();
  const words = (await passageText(page)).split(/\s+/).length;
  expect(words).toBeGreaterThan(30);
  expect(words).toBeLessThanOrEqual(60);
});

test('clearing history needs the typed word and can be undone', async ({ page }) => {
  await openApp(page);
  const { baseline, retest } = await freshTextCheck(page);
  expect(retest).not.toBe(baseline);
  await expect(page.locator('#comparison-caveat')).not.toContainText('Couldn’t save');
  await openView(page, 'Progress');
  await expect(page.locator('.history-row')).toHaveCount(1);
  await expect(page.locator('.history-target')).toHaveText('General drill and retest');

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
