import { CORPUS_VERSION, METRIC_VERSION, completeAttempt, createAttempt } from '../src/typing.js';
import { dailyPassage, runRecord } from '../src/insights.js';
import { test, expect, openApp, openView, chooseWords, completePassage, freshTextCheck, passageText, typeInto, signInWithEmail } from './fixtures.js';

const conditions = { mode: 'words', count: 25, duration: null, punctuation: false, quoteLength: null,
  difficulty: null, wordList: '1k', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };

function errorTrace(id, at) {
  const text = Array(25).fill('the').join(' ');
  const attempt = createAttempt({ id, text, textId: id, conditions });
  attempt.startedAt = 0;
  attempt.events = [...text].map((char, position) => ({ type: 'insert', text: position % 4 === 1 ? 'x' : char,
    position, offsetMs: position * 100, accepted: true }));
  return { ...completeAttempt(attempt, { endedAt: text.length * 100 }), at, fresh: true };
}

test('Progress filters comparable runs, opens chart points, and explains a saved comparison', async ({ page }) => {
  await openApp(page);
  await freshTextCheck(page);
  await openView(page, 'Progress');
  await expect(page.locator('#run-history .run-row')).toHaveCount(2);
  await expect(page.locator('#progress-trend svg')).toHaveCount(2);
  const point = page.locator('#progress-trend .trend-dot').first();
  await point.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#run-history details[open]')).toHaveCount(1);
  await page.locator('.history-summary').click();
  await expect(page.locator('.history-detail')).toContainText('before');
  await expect(page.locator('.history-detail')).toContainText('after');
  await expect(page.locator('.history-detail')).toContainText('Skipped');

  await openView(page, 'Practice');
  await chooseWords(page, 25);
  await completePassage(page);
  await openView(page, 'Progress');
  const key = await page.locator('#progress-conditions option').evaluateAll((options) => options.find((o) => o.textContent.includes('25 words')).value);
  await page.locator('#progress-conditions').selectOption(key);
  await expect(page.locator('#run-history .run-row')).toHaveCount(1);
  await expect(page.locator('#history-list')).toBeHidden();
  await expect(page.locator('#progress-week')).toContainText('both this week and the preceding week');
});

test('recurring patterns survive account reload and start a drill with a compatible baseline', async ({ page, supabase }) => {
  await page.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
  const user = supabase.addUser('patterns@stilltype.test');
  const traces = [errorTrace('baseline-a', '2026-09-28T12:00:00Z'), errorTrace('baseline-b', '2026-09-29T12:00:00Z')];
  supabase.profiles.set(user.id, { data: { version: 2, preferences: {}, attempts: traces,
    runs: traces.map((t) => runRecord(t)), loops: [], seenTextIds: traces.map((t) => t.textId), bests: {}, updatedAt: '2026-09-29T12:00:00Z' } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Train');
  await expect(page.locator('#training-targets')).toContainText('50 tries');
  await expect(page.locator('#training-targets')).toContainText('observed in 2 runs');
  await page.locator('#training-targets').getByRole('button', { name: 'Practice “th” again' }).click();
  await expect(page.locator('#session-title')).toHaveText('Practice “th”');
  await typeInto(page, (await passageText(page)).slice(0, 20));
  await page.clock.fastForward(60_000);
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await expect(page.locator('#condition-line')).toContainText('25 words');
  await completePassage(page);
  await openView(page, 'Progress');
  await page.locator('.history-summary').click();
  await expect(page.locator('.history-detail')).toContainText('60 s · th');
  await page.locator('.history-detail').getByRole('button', { name: 'Practice “th” again' }).click();
  await expect(page.locator('#session-title')).toHaveText('Practice “th”');
});

test('daily passage ignores practice settings, labels repeats, and saves scores separately across reload', async ({ page, supabase }) => {
  await page.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
  supabase.addUser('daily@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'daily@stilltype.test');
  await chooseWords(page, 10);
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await page.locator('#start-daily').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'daily');
  await expect(page.locator('.practice-controls')).toBeHidden();
  await expect(page.locator('#session-description')).toContainText('first attempt');
  const daily = await passageText(page);
  expect(daily).toBe(dailyPassage(new Date('2026-09-30T12:00:00Z')).text);
  await completePassage(page);
  await expect(page.locator('#result-delta')).toHaveText('Daily challenge complete');
  await expect(page.locator('#best')).toHaveText('No best yet');
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await expect(page.locator('#daily-status')).toContainText('1 attempt');
  await page.locator('#start-daily').click();
  await expect(page.locator('#session-description')).toContainText('repeat attempt');
  expect(await passageText(page)).toBe(daily);
  await completePassage(page);
  await expect.poll(() => supabase.profileFor('daily@stilltype.test')?.runs.filter((r) => r.kind === 'daily').length).toBe(2);
  expect(supabase.profileFor('daily@stilltype.test').bests).toEqual({});
  expect(supabase.profileFor('daily@stilltype.test').preferences.mode).toBe('words');

  await page.reload();
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await expect(page.locator('#daily-status')).toContainText('2 attempts');
  await page.locator('#daily-history-panel summary').click();
  await expect(page.locator('.daily-result')).toHaveCount(2);
  await expect(page.locator('.daily-result').first()).toContainText('repeat attempt');
  await openView(page, 'Progress');
  await expect(page.locator('#progress-empty')).toBeVisible();
});

test('a UTC midnight refresh selects the next shared daily passage', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-30T23:59:50Z') });
  await openApp(page);
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await expect(page.locator('#daily-date')).toContainText('2026-09-30');
  await page.clock.fastForward(35_000);
  await expect(page.locator('#daily-date')).toContainText('2026-10-01');
  await page.locator('#start-daily').click();
  expect(await passageText(page)).toBe(dailyPassage(new Date('2026-10-01T00:00:00Z')).text);
});

test('daily interruption does not create a counted score', async ({ page }) => {
  await openApp(page);
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await page.locator('#start-daily').click();
  await typeInto(page, (await passageText(page)).slice(0, 5));
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await expect(page.locator('#daily-status')).toContainText('No completed');
  await expect(page.locator('#daily-history-panel')).toBeHidden();
  await expect(page.locator('#best')).toHaveText('No best yet');
});

test('new progress, training, and daily views fit a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await openApp(page);
  await freshTextCheck(page);
  for (const view of ['Progress', 'Train', 'Challenge']) {
    await openView(page, view);
    if (view === 'Challenge') await page.locator('#challenge-daily').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  }
});

test('older compact history survives without full traces and offers an honest standalone drill', async ({ page, supabase }) => {
  const user = supabase.addUser('history@stilltype.test');
  const runs = Array.from({ length: 30 }, (_, i) => runRecord(errorTrace(`old-${i}`, new Date(Date.now() - (30 - i) * 60000).toISOString())));
  supabase.profiles.set(user.id, { data: { version: 2, preferences: {}, attempts: [], runs,
    loops: [{ id: 'old-loop', at: runs[1].at, target: 'th', conditions, drillCompleted: true,
      beforeAttemptId: runs[0].id, afterAttemptId: runs[1].id,
      comparison: { state: 'improved', wpmDelta: 5, accuracyDelta: 1, before: { wpm: 60, accuracy: 98 }, after: { wpm: 65, accuracy: 99 } },
      targetTiming: { target: 'th', beforeCount: 4, afterCount: 5, deltaMs: null } }],
    seenTextIds: [], bests: {}, updatedAt: new Date(Date.now() - 60000).toISOString() } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Progress');
  await expect(page.locator('#run-history .run-row')).toHaveCount(30);
  await page.locator('.history-summary').click();
  await expect(page.locator('.history-detail')).toContainText('60 wpm · 98%');
  await expect(page.locator('.history-detail')).toContainText('65 wpm · 99%');
  await expect(page.locator('.history-detail')).toContainText('Too few samples');
  await page.locator('.history-detail button').click();
  await expect(page.locator('#session-description')).toContainText('Standalone drill');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
});

test('clear and undo include daily history, which guests do not retain after reload', async ({ page }) => {
  await openApp(page);
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await page.locator('#start-daily').click();
  await completePassage(page);
  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await expect(page.locator('#daily-status')).toContainText('No completed');
  await page.locator('#undo-clear').click();
  await expect(page.locator('#daily-status')).toContainText('1 attempt');
  await page.reload();
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await expect(page.locator('#daily-status')).toContainText('No completed');
});

test('a returning daily passage is a first attempt today but is not labelled fresh text', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
  await openApp(page);
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await page.locator('#start-daily').click();
  const text = await completePassage(page);
  await page.clock.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await page.locator('#start-daily').click();
  expect(await passageText(page)).toBe(text);
  await expect(page.locator('#session-description')).toContainText('first attempt');
  await expect(page.locator('#session-description')).toContainText('previously displayed passage');
});
