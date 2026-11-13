// Progress, "What changed" (TOB-420): the lead, what moved it, the small charts, and every view one step away.
import { CORPUS_VERSION, METRIC_VERSION } from '../src/typing.js';
import { englishFrequency } from '../src/learner.js';
import { test, expect, openApp, openView, openProgressDetail, openProgressView, signInWithEmail, completePassage } from './fixtures.js';

// A Saturday afternoon: this week is Oct 11 to 17, the week before Oct 4 to 10.
const NOW = new Date('2026-10-17T15:00:00');
const daysAgo = (days, hour = 12) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - days, hour).toISOString();

const conditions = (extra = {}) => ({ mode: 'words', count: 25, duration: null, punctuation: false, numbers: false, quoteLength: null, difficulty: null,
  wordList: '1k', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, ...extra });

// Common pairs at the run's pace, one in three missed once in ten tries, then the rows given.
const BACKGROUND = [...englishFrequency().pairs].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([pair]) => pair);
const patterns = (rows) => [...BACKGROUND.filter((pair) => !rows.some((row) => row[0] === pair)).map((pair, i) => [pair, 10, i % 3 ? 0 : 1, 10, 200, 0]), ...rows];

let n = 0;

const run = (days, wpm, accuracy, extra, rows = null) => ({ id: `run-${n += 1}`, at: daysAgo(days, 9 + (n % 8)), kind: 'test', status: 'complete', interrupted: false, fresh: true,
  conditions: conditions(extra), textId: `text-${n}`, score: { wpm, accuracy }, elapsedMs: 20000, errors: 1, target: null, challengeDate: null,
  patterns: rows ? patterns(rows) : [], keys: [], keysVersion: 0 });

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

// Two weeks at plain 25 words, faster this week (medians 73 then 78): five pairs missed once a run before, clean in
// more tries since, so all five are fixed.
const FIXED = ['qu', 'ex', 'ox', 'ux', 'ix'];

const weekRuns = (before = [70, 72, 74, 73, 75, 71, 74], after = [76, 78, 77, 79, 78, 80], pairs = FIXED) => [
  ...before.map((wpm, i) => run(13 - i, wpm, 95, {}, pairs.map((pair) => [pair, 8, 1, 8, 200, 0]))),
  ...after.map((wpm, i) => run(5 - i, wpm, 96, {}, pairs.map((pair) => [pair, 15, 0, 15, 200, 0]))),
];

const profileOf = (list, extra = {}) => ({ version: 2, preferences: {}, attempts: [], runs: list, loops: [], seenTextIds: list.map((r) => r.textId), bests: {},
  updatedAt: list.at(-1)?.at || NOW.toISOString(), ...extra });

async function openProgress(page, supabase, list = runs, { width = 1280, height = 900, extra = {} } = {}) {
  await page.clock.install({ time: NOW });
  await page.setViewportSize({ width, height });
  const user = supabase.addUser('views@stilltype.test');
  supabase.profiles.set(user.id, { data: profileOf(list, extra) });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Progress');
}

// Signing out reloads the page, and the page as served already reads guest, before app.js has wired the account's
// buttons. So "guest" alone can be the half-loaded page, where a press on Sign in opens nothing; the reload's load
// event comes only after the app's script has run (TOB-448).
async function signOut(page) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type('sign out');
  await Promise.all([page.waitForEvent('load'), page.keyboard.press('Enter')]);
  await expect(page.locator('#account')).toHaveAttribute('data-state', 'guest');
}

const lead = (page) => ({ number: page.locator('#lead-figure .lead-number'), spoken: page.locator('#lead-figure .sr-only'), sentence: page.locator('#lead-sentence'),
  sample: page.locator('#lead-sample'), note: page.locator('#lead-note') });

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/progress/${name}` : testInfo.outputPath(name));

const resolved = (page, token) => page.evaluate((name) => {
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();

  return color;
}, token);

test('the lead is this week against the week before, with both medians, their runs and conditions, and no page heading', async ({ page, supabase }) => {
  await openProgress(page, supabase, weekRuns());
  const { number, spoken, sentence, sample } = lead(page);
  await expect(number).toHaveText('+5');
  await expect(spoken).toHaveText('5 wpm faster than the week before.');
  await expect(page.locator('#lead-figure .lead-unit')).toHaveText('wpm');
  await expect(page.locator('#week-lead')).toHaveAttribute('data-tone', 'gain');
  await expect(number).toHaveCSS('color', await resolved(page, '--accent'));
  await expect(sentence).toHaveText('78 this week, 73 the week before');
  await expect(sample).toHaveText('medians of 6 and 7 runs');
  await expect(page.locator('#progress-conditions')).toHaveText('english 1k · 25 words · plain · physical keyboard · continue on error');
  // The dock names the page; the one heading is for assistive technology.
  await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toHaveClass(/sr-only/);
  await expect(page.locator('#progress-screen :is(h1, h2):not(.sr-only):visible')).toHaveCount(0);
});

test('a drop reads as a drop in coral, and a week without change as none', async ({ page, supabase }) => {
  await openProgress(page, supabase, weekRuns([80, 82, 81, 80, 79, 83, 81], [76, 75, 77, 74, 76, 75]));
  await expect(lead(page).number).toHaveText('−5');
  await expect(lead(page).spoken).toHaveText('5 wpm slower than the week before.');
  await expect(page.locator('#week-lead')).toHaveAttribute('data-tone', 'drop');
  await expect(lead(page).number).toHaveCSS('color', await resolved(page, '--danger'));
  await expect(lead(page).sentence).toHaveText('76 this week, 81 the week before');

  const user = supabase.addUser('flat@stilltype.test');
  supabase.profiles.set(user.id, { data: profileOf(weekRuns([75, 76, 74, 75, 75, 77, 74], [75, 74, 76, 75, 75, 76])) });
  await signOut(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Progress');
  await expect(lead(page).number).toHaveText('0');
  await expect(lead(page).spoken).toHaveText('The same as the week before.');
  await expect(page.locator('#week-lead')).toHaveAttribute('data-tone', 'flat');
  await expect(lead(page).number).toHaveCSS('color', await resolved(page, '--text'));
});

test('one week of history: the lead is this week so far, and predicts nothing', async ({ page, supabase }) => {
  // Five runs from Tuesday on, none the week before: there is nothing to say about a week with no runs.
  await openProgress(page, supabase, [72, 75, 74, 77, 76].map((wpm, i) => run(4 - i, wpm, 95)));
  const { number, sentence, sample, note } = lead(page);
  await expect(page.locator('#week-lead')).toHaveAttribute('data-state', 'this-week');
  await expect(number).toHaveText('75');
  await expect(sentence).toHaveText('this week so far');
  await expect(sample).toHaveText('median of 5 runs');
  await expect(note).toBeHidden();
  const practice = page.locator('#week-movers .is-practice');
  await expect(practice.locator('.mover-change')).toHaveText('0 → to 1 min · 5 days in a row');
  await expect(practice.locator('.status')).toHaveText('more');
});

test('one run so far: the lead shows that run and what a week’s median takes', async ({ page, supabase }) => {
  await openProgress(page, supabase, [run(0, 64, 95)]);
  await expect(page.locator('#week-lead')).toHaveAttribute('data-state', 'thin');
  await expect(lead(page).number).toHaveText('64');
  await expect(lead(page).sentence).toHaveText('your latest run');
  await expect(lead(page).sample).toHaveText('1 run this week');
  await expect(lead(page).note).toHaveText('A week has a median from 3 runs.');
});

test('the conditions line is the control: lengths and condition sets change the lead and the lists, and sets never mix', async ({ page, supabase }) => {
  await openProgress(page, supabase);
  const tests = page.getByRole('group', { name: 'Test' });
  const variants = page.getByRole('combobox', { name: 'Conditions', exact: true });
  await expect(tests).toBeHidden();
  await page.locator('.conditions-disclosure > summary').click();

  // The newest run's length opens, on its most used condition set.
  await expect(tests.getByRole('button', { name: '25 words' })).toHaveAttribute('aria-pressed', 'true');
  await expect(variants.locator('option')).toHaveText(['plain', 'punctuation']);
  await expect(variants.locator('option:checked')).toHaveText('plain');
  await expect(tests.getByRole('button', { name: '100 words' })).toBeDisabled();
  await expect(tests.getByRole('button', { name: '15 seconds' })).toBeEnabled();
  await expect(lead(page).sentence).toHaveText('this week so far');
  await expect(lead(page).sample).toHaveText('median of 3 runs');

  // Punctuation is its own set: its runs, none of the plain ones.
  await variants.selectOption({ label: 'punctuation' });
  await expect(page.locator('#progress-conditions')).toContainText('25 words · punctuation');
  await expect(lead(page).sample).toHaveText('2 runs this week');
  await openProgressDetail(page, 'runs');
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: 'All' }).click();
  await expect(page.locator('#run-history .run-row')).toHaveCount(3);
  await expect(page.locator('#run-history')).not.toContainText(/\b(40|50|60|70|80) wpm/);

  // The control, still open, came along to the runs. Another length: no condition choice to make, and only its run.
  await tests.getByRole('button', { name: '15 seconds' }).click();
  await expect(tests.getByRole('button', { name: '15 seconds' })).toHaveAttribute('aria-pressed', 'true');
  await expect(variants).toBeHidden();
  await expect(page.locator('#run-history .run-row')).toHaveCount(1);
  await expect(page.locator('#run-history')).toContainText('100 wpm');
});

test('what moved it: the fixed pairs with their evidence, three at a time, then practice; a named pair still drills from Keys', async ({ page, supabase }) => {
  await openProgress(page, supabase, weekRuns());
  const rows = page.locator('#week-movers > li');
  await expect(page.locator('#week-movers')).toHaveAccessibleName('What changed since last week');
  // Ranked by the time each saved; three show, then practice.
  await expect(rows.filter({ visible: true }).locator('.mover-unit')).toHaveText(['ex', 'qu', 'ix', 'practice']);
  const unit = (name) => rows.filter({ has: page.locator('.mover-unit', { hasText: new RegExp(`^${name}$`) }) });
  await expect(unit('ex').locator('.mover-change')).toHaveText('7 of 56 → to 0 of 90 missed');
  await expect(unit('ex').locator('.status')).toHaveText('fixed');
  await expect(unit('ex').locator('.mover-after')).toHaveCSS('color', await resolved(page, '--accent'));
  await expect(unit('ex').locator('.mover-change')).toHaveAttribute('title', '56 tries in 7 runs before this week, 90 tries in 6 runs this week');
  // A fixed row is a fact, with nothing to press.
  await expect(rows.filter({ visible: true }).locator('.status')).toHaveText(['fixed', 'fixed', 'fixed', 'same']);
  await expect(rows.locator('button')).toHaveCount(1);
  // Two minutes each week: the same, as a plain fact.
  await expect(rows.last().locator('.mover-change')).toHaveText('2 → to 2 min · 6 days in a row');

  await expect(page.locator('#more-movers')).toHaveText('2 more');
  await page.locator('#more-movers').click();
  await expect(page.locator('#more-movers')).toHaveAttribute('aria-expanded', 'true');
  await expect(rows.filter({ visible: true }).locator('.mover-unit')).toHaveText(['ex', 'qu', 'ix', 'ox', 'ux', 'practice']);
  await page.locator('#more-movers').click();
  await expect(rows.filter({ visible: true })).toHaveCount(4);

  // Drilling a named pair stays one step away: Patterns across runs in Keys starts the drill Train would.
  await openProgressDetail(page, 'keys');
  const target = page.locator('#training-targets .training-target').first();
  const name = (await target.locator('h3').textContent()).match(/“(.+)”/)[1];
  await target.getByRole('button', { name: `Practice “${name}” again` }).click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#session-title')).toHaveText(`Practice “${name}”`);
  // Coming back from another screen, Progress opens on its overview.
  await openView(page, 'Progress');
  await expect(page.locator('#progress-screen')).toHaveAttribute('data-detail', '');
});

// The list holds only what there is: no "more" under a short list, a practice row alone, and no list at all.
test('exactly three fixed pairs all show, with no control for more', async ({ page, supabase }) => {
  await openProgress(page, supabase, weekRuns(undefined, undefined, ['qu', 'ex', 'ox']));
  await expect(page.locator('#week-movers > li:visible .mover-unit')).toHaveCount(4);
  await expect(page.locator('#week-movers > li .mover-unit').last()).toHaveText('practice');
  await expect(page.locator('#more-movers')).toBeHidden();
  await expect(page.locator('#more-movers')).toHaveText('');
});

test('one fixed pair lists alone with practice, a week with nothing fixed lists practice, and with neither there is no list', async ({ page, supabase }) => {
  await openProgress(page, supabase, weekRuns(undefined, undefined, ['qu']));
  const units = page.locator('#week-movers > li .mover-unit');
  await expect(units).toHaveText(['qu', 'practice']);
  await expect(page.locator('#more-movers')).toBeHidden();

  const signInAs = async (email, list) => {
    const user = supabase.addUser(email);
    supabase.profiles.set(user.id, { data: profileOf(list) });
    await signOut(page);
    await signInWithEmail(page, email);
    await openView(page, 'Progress');
  };

  await signInAs('practice-only@stilltype.test', weekRuns(undefined, undefined, []));
  await expect(units).toHaveText(['practice']);
  await expect(page.locator('#more-movers')).toBeHidden();
  await expect(page.locator('#week-moved')).toBeVisible();

  // Runs a month old: a lead that says so, no list and no rule left over, and the links to everything else.
  await signInAs('old@stilltype.test', [run(30, 60, 95), run(29, 62, 95), run(28, 61, 95)]);
  await expect(page.locator('#week-lead')).toHaveAttribute('data-state', 'none');
  await expect(page.locator('#week-moved')).toBeHidden();
  await expect(page.locator('#week-movers > li')).toHaveCount(0);
  await expect(page.locator('#progress-more')).toBeVisible();
});

test('the practice row opens the practice calendar, with its goal, streaks and runs started, and Progress goes back to it', async ({ page, supabase }) => {
  await openProgress(page, supabase, weekRuns(), { extra: { preferences: { dailyGoal: 5 } } });
  // No day met the 5-minute goal, so no streak is claimed.
  await expect(page.locator('#week-movers .is-practice .mover-change')).toHaveText('2 → to 2 min');
  await page.getByRole('button', { name: 'practice calendar', exact: true }).click();
  await expect(page.locator('#progress-screen')).toHaveAttribute('data-detail', 'calendar');
  await expect(page.locator('#progress-detail-heading')).toBeFocused();
  await expect(page.locator('#progress-detail-heading')).toHaveText('Practice');
  await expect(page.locator('#practice-goal')).toBeVisible();
  await expect(page.locator('#practice-stats')).toContainText('Active days');
  await expect(page.locator('#practice-stats')).toContainText('Runs started');
  await expect(page.locator('#practice-runs svg')).toHaveAttribute('aria-label', /^Runs per day from .+: 13 runs on 13 days, at most 1 in a day\.$/);
  await page.locator('#progress-back').click();
  await expect(page.getByRole('button', { name: 'practice calendar', exact: true })).toBeFocused();
});

test('practice notes count in the singular for one run, and in the plural otherwise', async ({ page, supabase }) => {
  await openProgress(page, supabase, [run(0, 60, 95)]);
  await openProgressView(page, 'Practice');
  const note = page.locator('#practice-stats .progress-figure').filter({ has: page.locator('dt', { hasText: /^Active days$/ }) }).locator('.figure-note');
  await expect(note).toHaveText('1 run a day when you practise');
  await expect(page.locator('#goal-calendar')).toHaveAttribute('aria-label', /: 1 day with practice\./);
});

test('two small charts, each with its value at the line’s end, open their full charts, whose tabs move by arrow keys', async ({ page, supabase }) => {
  await openProgress(page, supabase);
  const speed = page.locator('#week-speed button');
  await expect(speed).toHaveAccessibleName('Speed by day, Sep 18 to today: 3 days, 4 runs, from 50 to 75 wpm. 75 wpm today, the median of 2 runs. Open the speed chart.');
  await expect(page.locator('#week-speed .week-chart-value')).toHaveText('75 wpm');
  await expect(page.locator('#week-speed .week-chart-runs')).toHaveText('2 runs');
  await expect(page.locator('#week-accuracy .week-chart-value')).toHaveText('95%');
  await expect(page.locator('#week-speed .trend-label').last()).toHaveText('today');

  await speed.click();
  await expect(page.locator('#progress-screen')).toHaveAttribute('data-detail', 'trends');
  const tablist = page.getByRole('tablist', { name: 'Chart' });
  const tab = (name) => tablist.getByRole('tab', { name, exact: true });
  const shown = () => page.evaluate(() => ['speed', 'accuracy', 'consistency'].filter((id) => !document.getElementById(`view-${id}`).hidden));
  await expect(tab('Speed')).toHaveAttribute('aria-selected', 'true');
  expect(await shown()).toEqual(['speed']);
  await expect(page.getByRole('tabpanel')).toHaveAccessibleName('Speed');
  await tab('Speed').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab('Accuracy')).toBeFocused();
  expect(await shown()).toEqual(['accuracy']);
  await expect(page.locator('#accuracy-trend figcaption')).toHaveText('Accuracy by day');
  await page.keyboard.press('End');
  await expect(tab('Consistency')).toBeFocused();
  await expect(page.locator('#progress-spread')).toContainText('Half your runs fall between 58 and 73 wpm.');
  await page.keyboard.press('ArrowRight');
  await expect(tab('Speed')).toBeFocused();

  // A point opens its day's latest run among the runs; back is the overview.
  const point = page.locator('#progress-trend .trend-dot').first();
  await point.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#progress-screen')).toHaveAttribute('data-detail', 'runs');
  await expect(page.locator('#run-history details[open]')).toHaveCount(1);
  await page.locator('#progress-back').click();
  await expect(page.locator('#progress-screen')).toHaveAttribute('data-detail', '');

  // The accuracy chart opens its own tab, and back returns focus to it.
  await page.locator('#week-accuracy button').click();
  await expect(tab('Accuracy')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#progress-back').click();
  await expect(page.locator('#week-accuracy button')).toBeFocused();
});

// The figures the old page stood in a row, where the charts they summarise are: the period's median speed and
// accuracy, its fastest run with the day, and the runs counted.
test('under the full charts, the period in figures: median speed and accuracy, the best run and its day, and the runs counted', async ({ page, supabase }) => {
  await openProgress(page, supabase);
  const figures = page.locator('#trend-figures');
  const screen = page.locator('#progress-screen');
  await page.locator('#week-speed button').click();
  await expect(figures).toBeVisible();
  await expect(figures).toHaveText('median 65 wpm · 93% accuracy · best run 80 wpm on Oct 17 · 4 runs');
  await expect(figures.locator('data')).toHaveCount(2);
  await expect(figures.locator('data').first()).toHaveAttribute('value', '65');

  // The view's own filters keep it open: a period, then a condition set, each with focus kept on its control.
  const week = page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '7 days' });
  await week.click();
  await expect(screen).toHaveAttribute('data-detail', 'trends');
  await expect(week).toBeFocused();
  await expect(figures).toBeVisible();
  await expect(figures).toHaveText('median 70 wpm · 94% accuracy · best run 80 wpm on Oct 17 · 3 runs');
  await expect(page.locator('#progress-trend svg')).toBeVisible();
  expect(await overflow(page)).toBe(0);

  // Another set, another sample: the figures never mix conditions.
  await page.locator('.conditions-disclosure > summary').click();
  const variants = page.getByRole('combobox', { name: 'Conditions', exact: true });
  await variants.selectOption({ label: 'punctuation' });
  await expect(screen).toHaveAttribute('data-detail', 'trends');
  await expect(figures).toBeVisible();
  await expect(figures).toHaveText('median 32 wpm · 99% accuracy · best run 32 wpm on Oct 16 · 2 runs');

  // Another length, with its one run, and the way back still leads to the overview.
  await variants.selectOption({ label: 'plain' });
  const seconds = page.getByRole('group', { name: 'Test' }).getByRole('button', { name: '15 seconds' });
  await seconds.click();
  await expect(screen).toHaveAttribute('data-detail', 'trends');
  await expect(seconds).toBeFocused();
  await expect(figures).toBeVisible();
  await expect(figures).toHaveText('median 100 wpm · 97% accuracy · best run 100 wpm on Oct 16 · 1 run');
  await page.locator('#progress-back').click();
  await expect(screen).toHaveAttribute('data-detail', '');
});

// The full charts, their figures and their note are drawn together. A run from another device reaches all three at
// once; with focus on a chart point, which a redraw would drop, all three wait for the view's next drawing.
test('a run from another device reaches the full chart, its figures and its note together', async ({ page, supabase }) => {
  await openProgress(page, supabase);
  const figures = page.locator('#trend-figures');
  const points = page.locator('#progress-trend .trend-dot');
  await page.locator('#week-speed button').click();
  await expect(figures).toHaveText('median 65 wpm · 93% accuracy · best run 80 wpm on Oct 17 · 4 runs');
  const before = await points.count();

  const user = [...supabase.profiles.keys()][0];

  const arrive = async (added) => {
    const row = supabase.profiles.get(user);
    supabase.profiles.set(user, { ...row, data: { ...row.data, runs: [...row.data.runs, added], updatedAt: new Date(Date.parse(row.data.updatedAt) + 1000).toISOString() } });
    await page.evaluate(() => dispatchEvent(new Event('online')));
  };

  await arrive(run(5, 120, 99));
  await expect(figures).toHaveText('median 70 wpm · 94% accuracy · best run 120 wpm on Oct 12 · 5 runs');
  await expect(points).toHaveCount(before + 1);
  await expect(page.locator('#progress-screen')).toHaveAttribute('data-detail', 'trends');

  // Focus on a point of the chart: the next run waits, chart and figures alike, and focus stays.
  const point = page.locator('#progress-trend .trend-dot').first();
  await point.focus();
  await arrive(run(4, 130, 99));
  // The overview behind the view has the run (its sample line is the tell), and the view has not been drawn again.
  await expect(page.locator('#lead-sample')).toHaveText('median of 5 runs');
  await expect(figures).toHaveText('median 70 wpm · 94% accuracy · best run 120 wpm on Oct 12 · 5 runs');
  await expect(points).toHaveCount(before + 1);
  await expect(point).toBeFocused();

  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: 'All' }).click();
  await expect(figures).toHaveText('median 70 wpm · 94% accuracy · best run 130 wpm on Oct 13 · 7 runs');
  await expect(points).toHaveCount(before + 3);
});

test('an empty period fills when a run arrives from another device, and is never left blank', async ({ page, supabase }) => {
  await openProgress(page, supabase, [run(20, 60, 95), run(18, 64, 95), run(16, 62, 95)]);
  const note = page.locator('#progress-trend-note');
  await page.locator('#week-speed button').click();
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '7 days' }).click();
  await expect(note).toHaveText('No runs in this period.');
  await expect(page.locator('#trend-figures')).toBeHidden();

  const user = [...supabase.profiles.keys()][0];
  const row = supabase.profiles.get(user);
  supabase.profiles.set(user, { ...row, data: { ...row.data, runs: [...row.data.runs, run(0, 70, 96)], updatedAt: new Date(NOW.getTime() + 1000).toISOString() } });
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(page.locator('#trend-figures')).toHaveText('median 70 wpm · 96% accuracy · best run 70 wpm on Oct 17 · 1 run');
  await expect(page.locator('#progress-trend .trend-dot')).toHaveCount(1);
  await expect(note).toHaveText('');
  await expect(page.locator('#progress-screen')).toHaveAttribute('data-detail', 'trends');
});

test('the best run is the newest of a tie', async ({ page, supabase }) => {
  await openProgress(page, supabase, [run(6, 80, 95), run(2, 80, 96), run(1, 70, 94)]);
  await page.locator('#week-speed button').click();
  await expect(page.locator('#trend-figures')).toHaveText('median 80 wpm · 95% accuracy · best run 80 wpm on Oct 15 · 3 runs');
});

test('a period with no runs keeps the full charts open without figures, and a best run with no date says so', async ({ page, supabase }) => {
  await openProgress(page, supabase, [run(20, 60, 95), { ...run(0, 99, 97), at: null }]);
  const figures = page.locator('#trend-figures');
  const period = (name) => page.getByRole('group', { name: 'Period' }).getByRole('button', { name });
  await page.locator('#week-speed button').click();
  await expect(figures).toHaveText('median 60 wpm · 95% accuracy · best run 60 wpm on Sep 27 · 1 run');
  await period('7 days').click();
  await expect(page.locator('#progress-screen')).toHaveAttribute('data-detail', 'trends');
  await expect(figures).toBeHidden();
  await expect(page.locator('#progress-trend-note')).toHaveText('No runs in this period.');
  await period('All').click();
  await expect(figures).toBeVisible();
  await expect(figures).toHaveText('median 80 wpm · 96% accuracy · best run 99 wpm, date unavailable · 2 runs');
});

test('a guest with no runs sees no tagline, and a thin week states its counts and predicts nothing', async ({ page, supabase }) => {
  await openApp(page);
  await openView(page, 'Progress');
  await expect(page.locator('#progress-empty-title')).toHaveText('Nothing to compare yet');
  await expect(page.locator('#progress-empty .lead-context > *')).toHaveCount(1);

  // Two runs the week before and four this week: the count is the evidence, and no date is promised.
  await openProgress(page, supabase, [run(9, 70, 95), run(8, 71, 95), run(3, 72, 95), run(2, 75, 95), run(1, 74, 95), run(0, 77, 95)]);
  await expect(page.locator('#week-lead')).toHaveAttribute('data-state', 'this-week');
  await expect(lead(page).note).toHaveText('The week before has 2 runs, too few for a median.');
});

test('undoing a clear comes back to the conditions that were showing', async ({ page, supabase }) => {
  await openProgress(page, supabase);
  await page.locator('.conditions-disclosure > summary').click();
  await page.getByRole('combobox', { name: 'Conditions', exact: true }).selectOption({ label: 'punctuation' });
  await expect(page.locator('#progress-conditions')).toContainText('25 words · punctuation');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(page.locator('#progress-empty')).toBeVisible();
  await page.locator('#undo-clear').click();
  await expect(page.locator('#progress-conditions')).toContainText('25 words · punctuation');
  await expect(lead(page).sample).toHaveText('2 runs this week');
});

test('every quiet link opens its view, named and focused, and Progress goes back; the palette opens them too', async ({ page, supabase }) => {
  await openProgress(page, supabase, weekRuns());
  await expect(page.locator('#progress-more [data-progress-open]:visible')).toHaveText(['13 runs', 'Keys', 'Practice calendar', 'Standard score']);
  await expect(page.locator('#clear-history')).toBeVisible();

  for (const [name, heading, content] of [['runs', 'Runs', '#run-history'], ['keys', 'Keys', '#key-heatmap'], ['calendar', 'Practice', '#practice-goal'], ['standard', 'Standard score', '#standard-score']]) {
    const link = page.locator(`[data-progress-open="${name}"]`);
    await link.click();
    await expect(page.locator('#progress-detail-heading')).toHaveText(heading);
    await expect(page.locator('#progress-detail-heading')).toBeFocused();
    await expect(page.locator(content)).toBeVisible();
    await expect(page.locator('#progress-overview')).toBeHidden();
    await page.locator('#progress-back').click();
    await expect(link).toBeFocused();
  }

  for (const [label, name] of [['runs and drills', 'runs'], ['keys and pairs', 'keys'], ['practice calendar', 'calendar'], ['your standard score', 'standard']]) {
    await page.keyboard.press('Control+k');
    await page.keyboard.type(label);
    await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText(label);
    await page.keyboard.press('Enter');
    await expect(page.locator('#progress-screen')).toHaveAttribute('data-detail', name);
  }

  // Keys keeps Patterns across runs, the learner's queue, each unit with its drill.
  await openProgressDetail(page, 'keys');
  await expect(page.locator('#training-targets .training-target').first()).toContainText('Practice “');
  await expect(page.locator('#training-targets').getByRole('button', { name: /^Practice “.+” again$/ }).first()).toBeVisible();
});

test('the run list opens on the newest ten, and one button lists every run', async ({ page, supabase }) => {
  const many = Array.from({ length: 14 }, (_, i) => run(14 - i, 50 + i, 95));
  await openProgress(page, supabase, many);
  await openProgressDetail(page, 'runs');
  const rows = page.locator('#run-history .run-row');
  const showAll = page.getByRole('button', { name: 'Show all 14 runs' });
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toContainText('63 wpm');
  await showAll.click();
  await expect(rows.filter({ visible: true })).toHaveCount(14);
  await expect(showAll).toBeHidden();
  await expect(rows.nth(10).locator('summary')).toBeFocused();
  await rows.last().locator('summary').click();
  await expect(rows.last()).toHaveAttribute('open', '');
  await expect(rows.last()).toContainText('50 wpm');
});

test('in cpm the lead, the small chart and the full chart’s point each round their converted median once', async ({ page, supabase }) => {
  await openProgress(page, supabase, [run(10, 60, 95), run(9, 61, 95), run(8, 60, 95), run(1, 66, 95), run(0, 65, 95), run(0, 66, 95)]);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('speed unit · cpm');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('speed unit · cpm');
  await page.keyboard.press('Enter');
  // Medians of 66 and 60 wpm: 330 and 300 cpm, and the change printed is their difference.
  await expect(lead(page).sentence).toHaveText('330 this week, 300 the week before');
  await expect(lead(page).number).toHaveText('+30');
  await expect(page.locator('#lead-figure .lead-unit')).toHaveText('cpm');
  await expect(lead(page).spoken).toHaveText('30 cpm faster than the week before.');
  // Today's median, 65.5 wpm, is 327.5 cpm, printed 328.
  await expect(page.locator('#week-speed .week-chart-value')).toHaveText('328 cpm');
  await openProgressView(page, 'Speed');
  await expect(page.locator('#progress-trend .trend-callout').first()).toHaveText(/^328 today/);
  await expect(page.locator('#progress-trend .trend-dot').last()).toHaveAttribute('aria-label', /: median 328 cpm over 2 runs/);
});

test('Show all lasts until the period, test or condition set changes', async ({ page, supabase }) => {
  const many = [...Array.from({ length: 14 }, (_, i) => run(14 - i, 50 + i, 95)), ...Array.from({ length: 12 }, (_, i) => run(14 - i, 40, 99, { punctuation: true })), run(0, 64, 95)];
  await openProgress(page, supabase, many);
  await openProgressDetail(page, 'runs');
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

test('Clear history and Undo: the overview follows both at once, and a merge from another device redraws it', async ({ page, supabase }) => {
  await openProgress(page, supabase, weekRuns());
  await expect(lead(page).sentence).toHaveText('78 this week, 73 the week before');
  await page.locator('#clear-history').click();
  await expect(page.locator('#confirm-clear')).toBeDisabled();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(page.locator('#progress-empty')).toBeVisible();
  await expect(page.locator('#week-lead')).toBeHidden();
  await expect(page.locator('#week-moved')).toBeHidden();
  await expect(page.locator('#week-charts')).toBeHidden();
  await page.locator('#undo-clear').click();
  await expect(lead(page).sentence).toHaveText('78 this week, 73 the week before');
  await expect(page.locator('#week-movers .mover-unit').first()).toHaveText('ex');

  // Another device saves three faster runs today: this tab pulls them and the lead moves.
  const user = [...supabase.profiles.keys()][0];
  const row = supabase.profiles.get(user);
  supabase.profiles.set(user, { ...row, data: { ...row.data, runs: [...row.data.runs, run(0, 99, 99), run(0, 99, 99), run(0, 99, 99)], updatedAt: new Date(NOW.getTime() + 1000).toISOString() } });
  await page.evaluate(() => { document.activeElement?.blur(); dispatchEvent(new Event('online')); });
  await expect(lead(page).sentence).toHaveText('79 this week, 73 the week before');
  await expect(lead(page).sample).toHaveText('medians of 9 and 7 runs');
});

// Two tabs of one account share the device cache, so each hears the other's saves (followHistory).
test('in another tab, a run, a clear and its undo reach the overview at once, and an open row and keyboard focus stay', async ({ page, context, supabase }) => {
  await openProgress(page, supabase, weekRuns(), { extra: { preferences: { mode: 'words', count: 25, wordList: '1k' } } });
  const other = await context.newPage();
  await other.clock.install({ time: NOW });
  await supabase.attach(other);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  const practice = page.getByRole('button', { name: 'practice calendar', exact: true });
  await practice.focus();

  // A run typed in the other tab: the lead and the practice row count it, and focus stays on the row's button.
  await completePassage(other);
  await expect(other.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(lead(page).sample).toHaveText('medians of 7 and 7 runs');
  await expect(page.getByRole('button', { name: 'practice calendar', exact: true })).toBeFocused();

  // A run row open in the runs view stays open, with focus, while the other tab clears and undoes.
  await openProgressDetail(page, 'runs');
  const row = page.locator('#run-history .run-row').first();
  await row.locator('summary').click();
  await openView(other, 'Progress');
  await other.locator('#clear-history').click();
  await other.locator('#confirm-clear-input').fill('clear');
  await other.locator('#confirm-clear').click();
  await expect(page.locator('#progress-empty')).toBeAttached();
  await expect.poll(() => page.locator('#week-lead').isHidden()).toBe(true);
  await expect(row).toHaveAttribute('open', '');
  await expect(row.locator('summary')).toBeFocused();
  // Back on the overview, the cleared history shows.
  await page.locator('#progress-back').click();
  await expect(page.locator('#progress-empty')).toBeVisible();
  await other.locator('#undo-clear').click();
  await expect(lead(page).sample).toHaveText('medians of 7 and 7 runs');
  await expect(page.locator('#week-movers .mover-unit').first()).toHaveText('ex');
});

// Something on Progress holds focus while the other tab clears. The redraw for an empty history hides or disables
// it, and focus lands where a sighted keyboard user sees it (TOB-448): on the overview, the empty state's heading; in
// the runs view, which stays until it is left, the view's own heading. Never the page's body, and never the page's
// heading, which only a screen reader can see.
const HOLDERS = {
  'a length pill': async (page) => {
    await page.locator('.conditions-disclosure > summary').click();

    return page.getByRole('group', { name: 'Test' }).getByRole('button', { name: '25 words' });
  },
  'the condition-set select': async (page) => {
    await page.locator('.conditions-disclosure > summary').click();

    return page.getByRole('combobox', { name: 'Conditions', exact: true });
  },
  'a period pill': async (page) => page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '7 days' }),
  'the more control': async (page) => page.locator('#more-movers'),
  'the runs link': async (page) => page.locator('#open-runs'),
  'the Keys link': async (page) => page.locator('#progress-more [data-progress-open="keys"]'),
  'Clear history': async (page) => page.locator('#clear-history'),
};

const VIEWS = { 'a length pill': ['overview', 'trends', 'runs'], 'the condition-set select': ['overview', 'runs'] };

async function clearElsewhere(page, context, supabase) {
  const other = await context.newPage();
  await other.clock.install({ time: NOW });
  await supabase.attach(other);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');

  return async () => {
    await openView(other, 'Progress');
    await other.locator('#clear-history').click();
    await other.locator('#confirm-clear-input').fill('clear');
    await other.locator('#confirm-clear').click();
    // The overview has redrawn for an empty history, whether or not a view covers it.
    await expect(page.locator('#clear-history')).toHaveAttribute('hidden', '');

    return other;
  };
}

for (const [name, holder] of Object.entries(HOLDERS)) {
  for (const where of VIEWS[name] || ['overview']) {
    test(`a clear in another tab moves focus from ${name} to where it can be seen, on the ${where}`, async ({ page, context, supabase }) => {
      // Two condition sets at 25 words, so the select has a choice to offer.
      await openProgress(page, supabase, [...weekRuns(), run(1, 60, 95, { punctuation: true })].sort((a, b) => (a.at < b.at ? -1 : 1)),
        { extra: { preferences: { mode: 'words', count: 25, wordList: '1k' } } });
      const clear = await clearElsewhere(page, context, supabase);

      if (where === 'trends') await openProgressView(page, 'Speed');

      if (where === 'runs') await openProgressDetail(page, 'runs');
      const control = await holder(page);
      await control.focus();
      // A keyboard user reaches it with Tab: back past it and on to it again.
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(control).toBeFocused();
      await clear();
      const landing = page.locator(where === 'runs' ? '#progress-detail-heading' : '#progress-empty-title');
      await expect(landing).toBeFocused();
      await expect(landing).toBeVisible();
      await expect(landing).toHaveCSS('outline-style', 'solid');

      if (where === 'runs') await expect(landing).toHaveText('Runs');
    });
  }
}

// Focus the page moves for someone using a mouse lands in the same place without a ring: the ring follows the last
// input, a key or a pointer, the same in every engine (TOB-448).
test('after a click, focus moved by a clear in another tab lands without a ring', async ({ page, context, supabase }) => {
  await openProgress(page, supabase, weekRuns(), { extra: { preferences: { mode: 'words', count: 25, wordList: '1k' } } });
  const clear = await clearElsewhere(page, context, supabase);
  const pill = page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '7 days' });
  await pill.click();
  await expect(pill).toBeFocused();

  // A modifier on its own, as when a shortcut is half pressed, is no keyboard use.
  for (const key of ['Shift', 'Control', 'Alt', 'Meta']) await page.keyboard.press(key);

  await clear();
  await expect(page.locator('#progress-empty-title')).toBeFocused();
  await expect(page.locator('#progress-empty-title')).toHaveCSS('outline-style', 'none');
});

// Focus that wasn't on Progress stays where it was when another tab clears or undoes: a redraw never pulls focus onto
// the page, from the dock or from nothing at all (TOB-448).
test('a clear in another tab leaves focus that was elsewhere where it was', async ({ page, context, supabase }) => {
  await openProgress(page, supabase, weekRuns(), { extra: { preferences: { mode: 'words', count: 25, wordList: '1k' } } });
  const clear = await clearElsewhere(page, context, supabase);
  const dock = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Progress' });
  await dock.focus();
  const other = await clear();
  await expect(dock).toBeFocused();

  await page.evaluate(() => document.activeElement.blur());
  await other.locator('#undo-clear').click();
  await expect(lead(page).sample).toHaveText('medians of 6 and 7 runs');
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

// The full charts keep no rows. A clear from another tab closes them whole, and never leaves blank charts under
// figures of runs that are gone.
test('a clear in another tab closes the full charts onto the empty overview, and its undo brings the week back', async ({ page, context, supabase }) => {
  await openProgress(page, supabase, weekRuns(), { extra: { preferences: { mode: 'words', count: 25, wordList: '1k' } } });
  const other = await context.newPage();
  await other.clock.install({ time: NOW });
  await supabase.attach(other);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  const screen = page.locator('#progress-screen');
  await page.locator('#week-speed button').click();
  await expect(page.locator('#trend-figures')).toHaveText(/^median .* · 13 runs$/);
  const pill = page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '30 days' });
  await pill.focus();

  await openView(other, 'Progress');
  await other.locator('#clear-history').click();
  await other.locator('#confirm-clear-input').fill('clear');
  await other.locator('#confirm-clear').click();
  await expect(screen).toHaveAttribute('data-detail', '');
  await expect(page.locator('#progress-empty')).toBeVisible();
  await expect(page.locator('#progress-detail')).toBeHidden();
  await expect(page.locator('#progress-empty-title')).toBeFocused();

  await other.locator('#undo-clear').click();
  await expect(lead(page).sample).toHaveText('medians of 6 and 7 runs');
  await expect(page.locator('#week-speed svg')).toBeVisible();
  await page.locator('#week-speed button').click();
  await expect(screen).toHaveAttribute('data-detail', 'trends');
  await expect(page.locator('#progress-trend .trend-dot').first()).toBeVisible();
  await expect(page.locator('#trend-figures')).toHaveText(/^median .* · 13 runs$/);
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
  const variants = page.getByRole('combobox', { name: 'Conditions', exact: true });
  await variants.focus();
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

test('across midnight, the lead, the small chart and the full chart move to the new day together', async ({ page, supabase }) => {
  await openProgress(page, supabase, [run(6, 50, 95), run(3, 60, 95), run(0, 70, 95)]);
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '7 days' }).click();
  await expect(lead(page).sample).toHaveText('median of 3 runs');
  await expect(page.locator('#week-speed button')).toHaveAccessibleName(/: 3 days, 3 runs,/);
  await page.clock.fastForward('09:01:00');
  // Saturday Oct 11 is now the week before's: two runs left this week.
  await expect(lead(page).sample).toHaveText('2 runs this week');
  await expect(page.locator('#week-speed button')).toHaveAccessibleName(/: 2 days, 2 runs,/);
  await openProgressView(page, 'Speed');
  await expect(page.locator('#progress-trend .trend-dot')).toHaveCount(2);
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

test('past midnight, crossing the narrow breakpoint first still moves the lead to the new week', async ({ page, supabase }) => {
  await openProgress(page, supabase, [run(6, 50, 95), run(3, 60, 95), run(0, 70, 95)]);
  await expect(lead(page).sample).toHaveText('median of 3 runs');
  await page.clock.setSystemTime(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1, 0, 1));
  await page.setViewportSize({ width: 700, height: 900 });
  await page.clock.runFor(30000);
  await expect(lead(page).sample).toHaveText('2 runs this week');
});

test('All runs from the first run to today, like 7 and 30 days', async ({ page, supabase }) => {
  await openProgress(page, supabase, [run(12, 50, 95), run(6, 60, 95), run(3, 70, 95)]);
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: 'All' }).click();
  await openProgressView(page, 'Speed');
  await expect(page.locator('#progress-trend .trend-dot')).toHaveCount(3);

  const share = await page.locator('#progress-trend svg').evaluate((svg) => {
    const rule = svg.querySelector('.trend-rule');
    const [left, right] = [Number(rule.getAttribute('x1')), Number(rule.getAttribute('x2'))];
    const xs = [...svg.querySelectorAll('.trend-runs circle')].map((dot) => Number(dot.getAttribute('cx')));

    return (Math.max(...xs) - left) / (right - left);
  });

  expect(share).toBeCloseTo(9 / 12, 2);
});

test('with only drills to show, the empty lead stands with the practice row and the calendar, and a clear empties the foot', async ({ page, supabase }) => {
  await openProgress(page, supabase, [{ ...run(1, 50, 95), kind: 'drill' }, { ...run(0, 50, 95), kind: 'drill' }]);
  await expect(page.locator('#progress-empty')).toBeVisible();
  await expect(page.locator('#week-movers .is-practice')).toBeVisible();
  await expect(page.locator('[data-progress-open="runs"]')).toBeHidden();
  await expect(page.locator('[data-progress-open="calendar"]')).toBeVisible();
  await openProgressView(page, 'Practice');
  await expect(page.locator('#practice-goal')).toBeVisible();
  // The calendar reads the period, so it moves there.
  const period = page.getByRole('group', { name: 'Period' });
  await period.getByRole('button', { name: 'All', exact: true }).click();
  await expect(period.getByRole('button', { name: 'All', exact: true })).toBeFocused();
  await page.locator('#progress-back').click();
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(page.locator('#progress-empty')).toBeVisible();
  await expect(page.locator('#progress-more')).toBeHidden();
});

for (const [width, height] of [[1440, 900], [1280, 800], [390, 844], [320, 640]]) {
  test(`the overview holds at ${width}px: at a laptop size the lead and the list fit the first screen, and nothing scrolls sideways`, async ({ page, supabase }, testInfo) => {
    await openProgress(page, supabase, weekRuns(), { width, height });

    for (const theme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await overflow(page), `${theme} at ${width}`).toBeLessThanOrEqual(0);

      if (width >= 1280) {
        const last = await page.locator('#week-movers > li:visible').last().boundingBox();
        expect(last.y + last.height, 'the list ends above the fold').toBeLessThanOrEqual(height);
      }

      await page.locator('.conditions-disclosure > summary').click();
      expect(await overflow(page), `${theme} at ${width}, conditions open`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: shot(testInfo, `progress-${width}-${theme}-conditions.png`) });
      await page.locator('.conditions-disclosure > summary').click();
      await page.screenshot({ path: shot(testInfo, `progress-${width}-${theme}.png`), fullPage: true });
    }
  });
}

// The palette's "progress" goes to Progress's overview, as the dock does from another screen, even from one of its
// own detail views (TOB-448): it never leaves a view open behind a focused page heading.
test('the palette’s progress shows the overview from a detail view', async ({ page, supabase }) => {
  await openProgress(page, supabase, weekRuns());

  for (const name of ['runs', 'keys', 'trends']) {
    if (name === 'trends') await page.locator('#week-speed button').click();
    else await openProgressDetail(page, name);
    await expect(page.locator('#progress-screen')).toHaveAttribute('data-detail', name);
    await page.keyboard.press('Control+k');
    await page.locator('#palette-input').fill('progress');
    await expect(page.locator('#palette-list [aria-selected="true"] .opt-label')).toHaveText('progress');
    await page.keyboard.press('Enter');
    await expect(page.locator('#progress-screen')).toHaveAttribute('data-detail', '');
    await expect(page.locator('#progress-overview')).toBeVisible();
    await expect(page.locator('#progress-detail')).toBeHidden();
    await expect(page.locator('#week-speed svg')).toBeVisible();
    await expect(page.locator('#progress-heading')).toBeFocused();
  }
});

// Under forced colours the charts draw in system colours (TOB-448): a line kept in the theme's green could vanish into
// a high-contrast ground. Each line and its end take the text colour the system forces, on the small charts and the full.
test('under forced colours the small and full charts draw their lines in system colours', async ({ page, supabase }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openProgress(page, supabase, weekRuns());
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);

  // The colour the system forces for text, and each mark's stroke as drawn (a redraw for the synced history can
  // replace a chart while it is read, so each read is retried until it reads a drawn mark).
  const system = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'CanvasText';
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();

    return color;
  });

  const stroke = (selector) => page.locator(selector).first().evaluate((node) => (node.isConnected ? getComputedStyle(node).stroke : ''));

  for (const selector of ['#week-speed .trend-line', '#week-speed .week-chart-end', '#week-accuracy .trend-line']) {
    await expect.poll(() => stroke(selector), selector).toBe(system);
  }

  await page.locator('#week-speed button').click();
  await expect.poll(() => stroke('#progress-trend .trend-line')).toBe(system);
});

test('an id-less historical chart point opens its retained row without inventing a run id', async ({ page, supabase }) => {
  const historical = run(0, 60, 95);
  delete historical.id;
  await openProgress(page, supabase, [historical]);
  await page.locator('#week-speed button').click();
  await page.locator('#progress-trend .trend-dot').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#progress-screen')).toHaveAttribute('data-detail', 'runs');
  const row = page.locator('#run-history > details[open]');
  await expect(row).toHaveCount(1);
  expect(await row.getAttribute('data-run-id')).toBeNull();
  await expect(row.locator('summary')).toBeFocused();
});
