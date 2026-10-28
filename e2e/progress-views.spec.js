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
  const variants = page.getByRole('combobox', { name: 'Conditions', exact: true });

  await expect(page.locator('#progress-variants')).toBeHidden();
  await page.locator('.conditions-disclosure > summary').click();

  // The newest run's length opens, on its most used condition set.
  await expect(tests.getByRole('button', { name: '25 words' })).toHaveAttribute('aria-pressed', 'true');
  await expect(variants.locator('option')).toHaveText(['plain', 'punctuation']);
  await expect(variants.locator('option:checked')).toHaveText('plain');
  const conditionsLine = page.locator('#progress-conditions');
  await expect(conditionsLine).toBeVisible();
  await expect(conditionsLine).toHaveText('english 1k · 25 words · plain · physical keyboard · continue on error');
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
  await variants.selectOption({ label: 'punctuation' });
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
  await expect(variants.locator('option:checked')).toHaveText('plain');
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

test('practice notes count in the singular for one run, and in the plural otherwise', async ({ page, supabase }) => {
  await openProgress(page, supabase, [run(0, 60, 95)]);
  const note = page.locator('#practice-stats .progress-figure').filter({ has: page.locator('dt', { hasText: /^Active days$/ }) }).locator('.figure-note');
  await expect(note).toHaveText('1 run a day when you practise');
  await expect(page.locator('#goal-calendar')).toHaveAttribute('aria-label', /: 1 day with practice\./);
});

test('at 390px a pill row fades only at an edge with more of the row past it', async ({ page, supabase }) => {
  await openProgress(page, supabase);
  await page.setViewportSize({ width: 390, height: 844 });

  const fades = (id) => page.locator(`#${id}`).evaluate((row) => {
    const style = getComputedStyle(row);

    return [style.getPropertyValue('--fade-start'), style.getPropertyValue('--fade-end')];
  });

  // Without scroll timelines (Firefox today) every row keeps the plain fade at its right edge instead.
  if (!(await page.evaluate(() => CSS.supports('animation-timeline: scroll()')))) {
    await expect(page.locator('#progress-tabs')).toHaveCSS('mask-image', /^linear-gradient\(to right, .+, (transparent|rgba\(0, 0, 0, 0\))\)$/);

    return;
  }

  await expect.poll(() => fades('progress-period')).toEqual(['0px', '0px']);
  await expect.poll(() => fades('progress-tabs')).toEqual(['0px', '40px']);
  await page.locator('#progress-tabs').evaluate((row) => { row.scrollLeft = row.scrollWidth; });
  await expect.poll(() => fades('progress-tabs')).toEqual(['40px', '0px']);
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
  const variants = page.getByRole('combobox', { name: 'Conditions', exact: true });

  await showAll.click();
  await expect(rows).toHaveCount(15);
  await period.getByRole('button', { name: 'All' }).click();
  await expect(rows).toHaveCount(10);
  await expect(showAll).toHaveText('Show all 15 runs');

  await showAll.click();
  await page.locator('.conditions-disclosure > summary').click();
  await variants.selectOption({ label: 'punctuation' });
  await expect(rows).toHaveCount(10);
  await expect(showAll).toHaveText('Show all 12 runs');

  await showAll.click();
  await expect(rows).toHaveCount(12);
  await page.getByRole('group', { name: 'Test' }).getByRole('button', { name: '25 words' }).click();
  await expect(rows).toHaveCount(10);
});

test('Show all stays through a pill already chosen, and resets on a clear, its undo and a merged profile', async ({ page, supabase }) => {
  const many = Array.from({ length: 14 }, (_, i) => run(14 - i, 50 + i, 95));
  await openProgress(page, supabase, many);
  const rows = page.locator('#run-history .run-row');
  const showAll = page.locator('#show-all-runs');

  await showAll.click();
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '30 days' }).click();
  await expect(rows).toHaveCount(14);

  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await page.locator('#undo-clear').click();
  await expect(rows).toHaveCount(10);

  await showAll.click();
  await expect(rows).toHaveCount(14);
  const user = [...supabase.profiles.keys()][0];
  const row = supabase.profiles.get(user);
  supabase.profiles.set(user, { ...row, data: { ...row.data, runs: [...row.data.runs, run(0, 99, 99)], updatedAt: new Date(NOW.getTime() + 1000).toISOString() } });
  await page.evaluate(() => { document.activeElement?.blur(); dispatchEvent(new Event('online')); });
  await expect(rows.first()).toContainText('99 wpm');
  await expect(rows).toHaveCount(10);
});

test('quote sets that differ only by the punctuation setting say so on the conditions line, as their options do', async ({ page, supabase }) => {
  const quote = { mode: 'quote', count: null, quoteLength: 'short', difficulty: 'any', wordList: null };
  await openProgress(page, supabase, [run(2, 50, 95, quote), run(1, 55, 95, quote), run(0, 60, 95, { ...quote, punctuation: true })]);
  await page.locator('.conditions-disclosure > summary').click();
  const variants = page.getByRole('combobox', { name: 'Conditions', exact: true });
  await expect(variants.locator('option')).toHaveText(['punctuation setting off', 'punctuation setting on']);
  await expect(page.locator('#progress-conditions')).toContainText('any · punctuation setting off · physical keyboard');
  await variants.selectOption({ label: 'punctuation setting on' });
  await expect(page.locator('#progress-conditions')).toContainText('any · punctuation setting on · physical keyboard');
});

test('changing a period, test or condition keeps focus on its control', async ({ page, supabase }) => {
  await openProgress(page, supabase);

  const focused = () => page.evaluate(() => {
    const node = document.activeElement;

    return { text: node.textContent, group: node.parentElement?.getAttribute('aria-label') || '', pressed: node.getAttribute('aria-pressed') };
  });

  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '7 days' }).focus();
  await page.keyboard.press('Enter');
  expect(await focused()).toEqual({ text: '7 days', group: 'Period', pressed: 'true' });
  const disclosure = page.locator('.conditions-disclosure > summary');
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  const variants = page.getByRole('combobox', { name: 'Conditions', exact: true });
  await expect(variants).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(variants).toBeFocused();
  await expect(variants.locator('option:checked')).toHaveText('punctuation');
  await expect(page.locator('#progress-conditions')).toContainText('25 words · punctuation');
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

    return [...svg.querySelectorAll('.trend-runs circle')].flatMap((dot) => {
      const x = Number(dot.getAttribute('cx'));

      return x < left || x > right ? [x] : [];
    });
  });

  expect(outside).toEqual([]);
});

test('past midnight, crossing the narrow breakpoint first still moves the overview to the new window', async ({ page, supabase }) => {
  await openProgress(page, supabase, [run(6, 50, 95), run(3, 60, 95), run(0, 70, 95)]);
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '7 days' }).click();
  await expect(figure(page, '7 days')).toContainText('median of 3 runs');
  await page.clock.setSystemTime(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1, 0, 1));
  await page.setViewportSize({ width: 700, height: 900 });
  await page.clock.runFor(30000);
  await expect(figure(page, '7 days')).toContainText('median of 2 runs');
  await expect(page.locator('#run-history .run-row')).toHaveCount(2);
});

test('All runs from the first run to today, like 7 and 30 days', async ({ page, supabase }) => {
  await openProgress(page, supabase, [run(12, 50, 95), run(6, 60, 95), run(3, 70, 95)]);
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: 'All' }).click();
  await expect(page.locator('#progress-trend .trend-dot')).toHaveCount(3);

  const share = await page.locator('#progress-trend svg').evaluate((svg) => {
    const rule = svg.querySelector('.trend-rule');
    const [left, right] = [Number(rule.getAttribute('x1')), Number(rule.getAttribute('x2'))];
    const xs = [...svg.querySelectorAll('.trend-runs circle')].map((dot) => Number(dot.getAttribute('cx')));

    return (Math.max(...xs) - left) / (right - left);
  });

  expect(share).toBeCloseTo(9 / 12, 2);
});

test('with only practice to show, the panel stands alone, without tab semantics', async ({ page, supabase }) => {
  await openProgress(page, supabase, [{ ...run(1, 50, 95), kind: 'drill' }, { ...run(0, 50, 95), kind: 'drill' }]);
  await expect(page.locator('#practice-goal')).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.getByRole('tabpanel')).toHaveCount(0);
  await expect(page.locator('#view-practice')).not.toHaveAttribute('aria-labelledby', /./);
});

test('duration and period share a row with a compact overview and conditions disclosed on demand', async ({ page, supabase }, testInfo) => {
  const timed = { mode: 'time', count: null, duration: 15 };

  const list = [
    run(4, 45, 94),
    run(3, 55, 95, { ...timed, wordList: null, corpus: 'original-en-v3' }),
    run(2, 60, 96, { ...timed, wordList: '200' }),
    run(1, 65, 97, { ...timed, wordList: null, corpus: 'original-en-v3', correctionPolicy: 'mandatory' }),
    run(0, 70, 98, timed),
  ];

  await page.emulateMedia({ colorScheme: 'dark' });
  await openProgress(page, supabase, list);
  const variants = page.locator('#progress-variants');
  const disclosure = page.locator('.conditions-disclosure > summary');
  await expect(variants).toBeHidden();
  await expect(page.locator('#progress-conditions')).toBeHidden();
  const heading = await page.locator('#progress-heading').boundingBox();
  const duration = await page.getByRole('button', { name: '15 seconds', exact: true }).boundingBox();
  const period = await page.locator('#progress-period').boundingBox();
  const summary = await disclosure.boundingBox();
  expect(Math.abs(period.y + period.height / 2 - duration.y - duration.height / 2)).toBeLessThan(1);
  expect(period.x).toBeGreaterThan(duration.x + duration.width);
  expect(duration.y).toBeGreaterThan(heading.y + heading.height);
  expect(summary.y).toBe(duration.y);
  expect(summary.x).toBeGreaterThan(duration.x + duration.width);
  await expect(page.locator('#progress-heading')).toHaveCSS('font-size', '48px');
  await expect(page.locator('#progress-stats .figure-value').first()).toHaveCSS('font-size', '30px');
  await page.screenshot({ path: testInfo.outputPath('progress-desktop.png') });
  await page.setViewportSize({ width: 1024, height: 800 });
  const narrowDuration = await page.getByRole('button', { name: '15 seconds', exact: true }).boundingBox();
  const narrowPeriod = await page.locator('#progress-period').boundingBox();
  expect(Math.abs(narrowPeriod.y + narrowPeriod.height / 2 - narrowDuration.y - narrowDuration.height / 2)).toBeLessThan(1);
  await page.setViewportSize({ width: 1280, height: 900 });
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(variants).toBeFocused();
  await expect(variants.locator('option')).toHaveCount(4);
  const seen = new Set();

  for (const label of await variants.locator('option').allTextContents()) {
    await variants.selectOption({ label });
    await expect(variants).toBeFocused();
    await expect(page.locator('#run-history .run-row')).toHaveCount(1);
    const row = page.locator('#run-history .run-row');
    const id = await row.getAttribute('data-run-id');
    const expected = list.find((item) => item.id === id);
    seen.add(id);
    await expect(row).toContainText(`${expected.score.wpm} wpm`);
    await expect(figure(page, '30 days')).toContainText(`${expected.score.wpm} wpm`);
    await expect(page.locator('#progress-conditions')).toBeVisible();
  }

  expect(seen.size).toBe(4);
  await disclosure.click();

  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 320, height: 760 });
    await expect(variants).toBeHidden();
    await expect(page.locator('#progress-conditions')).toBeHidden();
    const tests = page.locator('#progress-tests');
    expect(await tests.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    await tests.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
    await expect(page.getByRole('button', { name: '120 seconds', exact: true })).toBeInViewport();
    await disclosure.click();
    await expect(variants).toBeVisible();
    const bounds = await variants.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    await expect(page.locator('#progress-conditions')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.screenshot({ path: testInfo.outputPath(`progress-320-${theme}-open.png`) });
    await disclosure.click();
    await page.screenshot({ path: testInfo.outputPath(`progress-320-${theme}.png`) });
  }
});

test('periods stay available with empty and activity-only history', async ({ page, supabase }) => {
  await openProgress(page, supabase, [{ ...run(1, 50, 95), kind: 'drill' }]);
  const period = page.getByRole('group', { name: 'Period' });
  await expect(page.locator('#practice-goal')).toBeVisible();
  await period.getByRole('button', { name: 'All', exact: true }).click();
  await expect(period.getByRole('button', { name: 'All', exact: true })).toBeFocused();
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(page.locator('#progress-empty')).toBeVisible();
  await expect(page.locator('.conditions-disclosure')).toBeHidden();
  await period.getByRole('button', { name: '7 days' }).click();
  await expect(period.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
});
