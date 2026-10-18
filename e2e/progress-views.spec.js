import { CORPUS_VERSION, METRIC_VERSION } from '../src/typing.js';
import { test, expect, openApp, openView, openProgressView, signInWithEmail } from './fixtures.js';

const NOW = new Date('2026-10-17T15:00:00');
const daysAgo = (days, hour = 12) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - days, hour).toISOString();
const conditions = (extra = {}) => ({ mode: 'words', count: 25, duration: null, punctuation: false, numbers: false, quoteLength: null, difficulty: null,
  wordList: '1k', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, ...extra });
let n = 0;
const run = (days, wpm, accuracy, extra) => ({ id: `run-${n += 1}`, at: daysAgo(days, 9 + (n % 8)), kind: 'test', status: 'complete', interrupted: false, fresh: true,
  conditions: conditions(extra), textId: `text-${n}`, score: { wpm, accuracy }, elapsedMs: 20000, errors: 1, target: null, challengeDate: null, patterns: [] });

// Plain 25 words is the most used set and the newest run; punctuation and 15 s each sit apart from it.
const runs = [
  run(40, 40, 90),
  run(20, 50, 91),
  run(10, 30, 99, { punctuation: true }),
  run(3, 60, 92),
  run(2, 31, 99, { punctuation: true }),
  run(1, 32, 99, { punctuation: true }),
  run(1, 100, 97, { mode: 'time', count: null, duration: 15 }),
  run(0, 80, 94),
  run(0, 70, 96),
];

async function openProgress(page, supabase, list = runs) {
  await page.clock.install({ time: NOW });
  await page.setViewportSize({ width: 1280, height: 900 });
  const user = supabase.addUser('views@stilltype.test');
  supabase.profiles.set(user.id, { data: { version: 2, preferences: {}, attempts: [], runs: list, loops: [],
    seenTextIds: list.map((r) => r.textId), bests: {}, updatedAt: list.at(-1).at } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Progress');
}

const figure = (page, label) => page.locator('#progress-stats .progress-figure').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) });

test('period and test pills filter the overview, and condition sets never mix', async ({ page, supabase }) => {
  await openProgress(page, supabase);
  const tests = page.getByRole('group', { name: 'Test' });
  const period = page.getByRole('group', { name: 'Period' });
  const variants = page.getByRole('group', { name: 'Conditions' });

  // The newest run's length opens, on its most used condition set.
  await expect(tests.getByRole('button', { name: '25 words' })).toHaveAttribute('aria-pressed', 'true');
  await expect(variants.getByRole('button')).toHaveText(['no punctuation', 'punctuation']);
  await expect(variants.getByRole('button', { name: 'no punctuation' })).toHaveAttribute('aria-pressed', 'true');
  // The full conditions line waits behind a disclosure beside the condition sets.
  const conditionsLine = page.locator('#progress-conditions');
  await expect(conditionsLine).toBeHidden();
  await page.locator('.conditions-disclosure > summary').click();
  await expect(conditionsLine).toBeVisible();
  await expect(conditionsLine).toHaveText('english 1k · 25 words · plain · physical keyboard · continue on error · corpus v5 · metric v1');
  // A preset length with no runs stays in the row, disabled.
  await expect(tests.getByRole('button', { name: '100 words' })).toBeDisabled();
  await expect(tests.getByRole('button', { name: '15 seconds' })).toBeEnabled();

  await expect(period.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
  await expect(figure(page, 'This week')).toContainText('70 wpm');
  await expect(figure(page, 'This week')).toContainText('median of 3 runs');
  await expect(figure(page, 'Last week')).toContainText('no runs');
  await expect(figure(page, '30 days')).toContainText('65 wpm');
  await expect(figure(page, '30 days')).toContainText('median of 4 runs');
  await expect(figure(page, 'Accuracy')).toContainText('93%');
  await expect(figure(page, 'Accuracy')).toContainText('30-day median');
  await expect(figure(page, 'Best run')).toContainText('80 wpm');
  await expect(page.locator('#run-history .run-row')).toHaveCount(4);

  await period.getByRole('button', { name: '7 days' }).click();
  await expect(period.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
  await expect(figure(page, '7 days')).toContainText('70 wpm');
  await expect(figure(page, '7 days')).toContainText('median of 3 runs');
  await expect(figure(page, 'Accuracy')).toContainText('7-day median');
  await period.getByRole('button', { name: 'All' }).click();
  await expect(figure(page, 'All')).toContainText('60 wpm');
  await expect(figure(page, 'All')).toContainText('median of 5 runs');
  await expect(page.locator('#run-history .run-row')).toHaveCount(5);

  // Punctuation is its own set: only its three runs, none of the plain ones.
  await variants.getByRole('button', { name: 'punctuation', exact: true }).click();
  await expect(page.locator('#progress-conditions')).toContainText('25 words · punctuation');
  await expect(figure(page, 'All')).toContainText('31 wpm');
  await expect(figure(page, 'All')).toContainText('median of 3 runs');
  await expect(figure(page, 'Best run')).toContainText('32 wpm');
  await expect(figure(page, 'Accuracy')).toContainText('99%');
  await expect(page.locator('#run-history .run-row')).toHaveCount(3);
  await expect(page.locator('#run-history')).not.toContainText(/\b(40|50|60|70|80) wpm/);

  // Another length: no condition choice to make, and only its run.
  await tests.getByRole('button', { name: '15 seconds' }).click();
  await expect(tests.getByRole('button', { name: '15 seconds' })).toHaveAttribute('aria-pressed', 'true');
  await expect(variants).toBeHidden();
  await expect(figure(page, 'All')).toContainText('100 wpm');
  await expect(figure(page, 'All')).toContainText('median of 1 run');
  await expect(page.locator('#run-history .run-row')).toHaveCount(1);

  // Back at 25 words, the length opens on its most used set again.
  await tests.getByRole('button', { name: '25 words' }).click();
  await expect(variants.getByRole('button', { name: 'no punctuation' })).toHaveAttribute('aria-pressed', 'true');
  await expect(figure(page, 'All')).toContainText('median of 5 runs');
});

test('view tabs show one panel at a time, by arrow keys or a click, and stay chosen for the session', async ({ page, supabase }) => {
  await openProgress(page, supabase);
  const tablist = page.getByRole('tablist', { name: 'View' });
  const tab = (name) => tablist.getByRole('tab', { name, exact: true });
  const panels = ['speed', 'accuracy', 'consistency', 'practice', 'keys'];
  const shown = () => page.evaluate((ids) => ids.filter((id) => !document.getElementById(`view-${id}`).hidden), panels);

  await expect(tab('Speed')).toHaveAttribute('aria-selected', 'true');
  expect(await shown()).toEqual(['speed']);
  await expect(page.getByRole('tabpanel')).toHaveAccessibleName('Speed');
  await expect(tablist.locator('[tabindex="0"]')).toHaveCount(1);

  await tab('Speed').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab('Accuracy')).toBeFocused();
  await expect(tab('Accuracy')).toHaveAttribute('aria-selected', 'true');
  await expect(tab('Speed')).toHaveAttribute('aria-selected', 'false');
  expect(await shown()).toEqual(['accuracy']);
  await expect(page.locator('#accuracy-trend figcaption')).toHaveText('Accuracy by day');
  await page.keyboard.press('End');
  await expect(tab('Keys')).toBeFocused();
  expect(await shown()).toEqual(['keys']);
  await page.keyboard.press('ArrowRight');
  await expect(tab('Speed')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tab('Keys')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tab('Speed')).toBeFocused();
  expect(await shown()).toEqual(['speed']);

  await tab('Consistency').click();
  expect(await shown()).toEqual(['consistency']);
  await expect(page.locator('#progress-spread')).toContainText('Half your runs fall between 58 and 73 wpm.');
  await expect(page.locator('#progress-spread svg[role="img"]').first()).toHaveAttribute('aria-label', /^4 runs by speed, from 50 to 80 wpm\. Median 65 wpm; half the runs between 58 and 73 wpm\.$/);
  await expect(page.locator('#progress-spread')).toContainText('Each dot is a run.');

  await tab('Practice').click();
  expect(await shown()).toEqual(['practice']);
  await expect(page.locator('#practice-goal')).toBeVisible();
  await expect(page.locator('#practice-stats')).toContainText('Active days');
  await expect(page.locator('#practice-runs svg')).toHaveAttribute('aria-label', /^Runs per day from .+: 8 runs on 6 days, at most 2 in a day\.$/);

  // The chosen view outlives a trip to another screen.
  await openView(page, 'Practice');
  await openView(page, 'Progress');
  await expect(tab('Practice')).toHaveAttribute('aria-selected', 'true');
  expect(await shown()).toEqual(['practice']);
  await openProgressView(page, 'Speed');
  expect(await shown()).toEqual(['speed']);
});

test('the run list opens on the newest ten, and one button lists every run', async ({ page, supabase }) => {
  const many = Array.from({ length: 14 }, (_, i) => run(14 - i, 50 + i, 95));
  await openProgress(page, supabase, many);
  const rows = page.locator('#run-history .run-row');
  const showAll = page.getByRole('button', { name: 'Show all 14 runs' });
  await expect(rows).toHaveCount(14);
  await expect(rows.filter({ visible: true })).toHaveCount(10);
  await expect(rows.first()).toContainText('63 wpm');
  await showAll.click();
  await expect(rows.filter({ visible: true })).toHaveCount(14);
  await expect(showAll).toBeHidden();
  // Focus lands on the first run that was out of view, so the keyboard carries on from there.
  await expect(rows.nth(10).locator('summary')).toBeFocused();
  await rows.last().locator('summary').click();
  await expect(rows.last()).toHaveAttribute('open', '');
  await expect(rows.last()).toContainText('50 wpm');
});
