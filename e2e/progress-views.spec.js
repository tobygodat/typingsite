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
  // The rest are built only when asked for.
  await expect(rows).toHaveCount(10);
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

test('in cpm the overview, the chart callout and its point all round the converted median once', async ({ page, supabase }) => {
  await openProgress(page, supabase, [run(0, 65, 95), run(0, 66, 95)]);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('speed unit · cpm');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('speed unit · cpm');
  await page.keyboard.press('Enter');
  await expect(figure(page, '30 days')).toContainText('328 cpm');
  await expect(figure(page, 'This week')).toContainText('328 cpm');
  await expect(page.locator('#progress-trend .trend-callout').first()).toHaveText(/^328 today/);
  await expect(page.locator('#progress-trend .trend-dot').last()).toHaveAttribute('aria-label', /: median 328 cpm over 2 runs/);
});

test('Show all lasts until the period, test or condition set changes', async ({ page, supabase }) => {
  const many = [...Array.from({ length: 14 }, (_, i) => run(14 - i, 50 + i, 95)), ...Array.from({ length: 12 }, (_, i) => run(14 - i, 40, 99, { punctuation: true })), run(0, 64, 95)];
  await openProgress(page, supabase, many);
  const rows = page.locator('#run-history .run-row');
  const showAll = page.locator('#show-all-runs');
  const period = page.getByRole('group', { name: 'Period' });
  const variants = page.getByRole('group', { name: 'Conditions' });

  await showAll.click();
  await expect(rows).toHaveCount(15);
  await period.getByRole('button', { name: 'All' }).click();
  await expect(rows).toHaveCount(10);
  await expect(showAll).toHaveText('Show all 15 runs');

  await showAll.click();
  await variants.getByRole('button', { name: 'punctuation', exact: true }).click();
  await expect(rows).toHaveCount(10);
  await expect(showAll).toHaveText('Show all 12 runs');

  await showAll.click();
  await expect(rows).toHaveCount(12);
  await page.getByRole('group', { name: 'Test' }).getByRole('button', { name: '25 words' }).click();
  await expect(rows).toHaveCount(10);
});

test('activating a period, test or condition pill keeps focus on that pill', async ({ page, supabase }) => {
  await openProgress(page, supabase);
  const focused = () => page.evaluate(() => {
    const node = document.activeElement;
    return { text: node.textContent, group: node.parentElement?.getAttribute('aria-label') || '', pressed: node.getAttribute('aria-pressed') };
  });
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '7 days' }).focus();
  await page.keyboard.press('Enter');
  expect(await focused()).toEqual({ text: '7 days', group: 'Period', pressed: 'true' });
  await page.getByRole('group', { name: 'Conditions' }).getByRole('button', { name: 'punctuation', exact: true }).focus();
  await page.keyboard.press('Enter');
  expect(await focused()).toEqual({ text: 'punctuation', group: 'Conditions', pressed: 'true' });
  await page.getByRole('group', { name: 'Test' }).getByRole('button', { name: '15 seconds' }).focus();
  await page.keyboard.press('Space');
  expect(await focused()).toEqual({ text: '15 s', group: 'Test', pressed: 'true' });
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  expect(await focused()).toEqual({ text: '25 words', group: 'Test', pressed: 'true' });
});

test('the runs-per-day strip follows the calendar across midnight', async ({ page, supabase }) => {
  await openProgress(page, supabase);
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '7 days' }).click();
  await openProgressView(page, 'Practice');
  const strip = page.locator('#practice-runs svg');
  await expect(strip).toHaveAttribute('aria-label', /^Runs per day from Oct 11 to Oct 17:/);
  await page.clock.fastForward('09:01:00');
  await expect(strip).toHaveAttribute('aria-label', /^Runs per day from Oct 12 to Oct 18:/);
});

test('across midnight on 7 days, the overview and the chart move to the new day together', async ({ page, supabase }) => {
  await openProgress(page, supabase, [run(6, 50, 95), run(3, 60, 95), run(0, 70, 95)]);
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '7 days' }).click();
  const points = page.locator('#progress-trend .trend-dot');
  await expect(figure(page, '7 days')).toContainText('median of 3 runs');
  await expect(points).toHaveCount(3);
  await page.clock.fastForward('09:01:00');
  await expect(figure(page, '7 days')).toContainText('median of 2 runs');
  await expect(points).toHaveCount(2);
  await expect(page.locator('#run-history .run-row')).toHaveCount(2);
  const drawn = await page.locator('#progress-trend svg').getAttribute('viewBox');
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(page.locator('#progress-trend svg')).not.toHaveAttribute('viewBox', drawn);
  const outside = await page.locator('#progress-trend svg').evaluate((svg) => {
    const rule = svg.querySelector('.trend-rule');
    const [left, right] = [Number(rule.getAttribute('x1')), Number(rule.getAttribute('x2'))];
    return [...svg.querySelectorAll('.trend-runs circle')].map((dot) => Number(dot.getAttribute('cx'))).filter((x) => x < left || x > right);
  });
  expect(outside).toEqual([]);
});

test('with only practice to show, the panel stands alone, without tab semantics', async ({ page, supabase }) => {
  await openProgress(page, supabase, [{ ...run(1, 50, 95), kind: 'drill' }, { ...run(0, 50, 95), kind: 'drill' }]);
  await expect(page.locator('#practice-goal')).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.getByRole('tabpanel')).toHaveCount(0);
  await expect(page.locator('#view-practice')).not.toHaveAttribute('aria-labelledby', /./);
});
