import { conditionKey, standardConditions } from '../src/typing.js';
import { test, expect, openApp, openView, openSettings, completePassage, passageText, typeInto, signInWithEmail } from './fixtures.js';

// Committed docs images are refreshed only with SCREENSHOTS=1; normal runs write to the test output.
const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/standard-test/${name}` : testInfo.outputPath(name));

const CONDITIONS = 'standard v1 · 60 s · 1k–10k mix · physical keyboard · stop on error · corpus v5 · metric v1';
const RECIPE = 'standard v1 · 60 s · english 1k–10k mix · punctuation, numbers, one quote';
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const screenOverflow = (page) => page.locator('#typing-screen').evaluate((node) => node.scrollWidth - node.clientWidth);

// Settings, with the collapsed test content category (word list and numbers) open.
async function openTestContent(page) {
  await openSettings(page);
  const category = page.locator('#test-content-settings');
  if (!(await category.evaluate((node) => node.open))) await category.locator('summary').click();
  await expect(page.locator('#word-list')).toBeVisible();
}

// Saved standard runs at realistic speeds, one a day up to yesterday, plus an interrupted one that must not count.
function seededProfile(speeds) {
  const conditions = standardConditions();
  const runs = speeds.map((wpm, i) => ({ id: `standard-${i}`, at: new Date(Date.now() - (speeds.length - i) * 86400000).toISOString(), kind: 'test',
    status: 'complete', conditions, textId: `standard-v1-seed${i}`, fresh: true, interrupted: false,
    score: { wpm, accuracy: 96 + (i % 3) }, elapsedMs: 60000, errors: 2 + (i % 4), target: null, challengeDate: null, patterns: [] }));
  runs.push({ ...runs.at(-1), id: 'standard-interrupted', status: 'interrupted', interrupted: true, score: { wpm: 91, accuracy: 99 } });
  const best = runs.filter((run) => run.status === 'complete').sort((a, b) => b.score.wpm - a.score.wpm)[0];
  return { version: 2, preferences: {}, attempts: [], runs, loops: [], seenTextIds: runs.map((run) => run.textId),
    bests: { [conditionKey(conditions)]: { wpm: best.score.wpm, attemptId: best.id, at: best.at } }, updatedAt: new Date().toISOString() };
}

// Types the passage at a steady human pace, with one corrected slip, and stops short of the time
// limit so no stray key lands on the results screen.
async function typeForAMinute(page, text) {
  await page.locator('#typing-input').focus();
  const delay = 95;
  let at = 0;
  while (at < text.length) {
    if (at > 0 && Number(await page.locator('#timer').textContent()) <= 2) break;
    if (at === 120) {
      await page.keyboard.type(text[at] === 'q' ? 'w' : 'q', { delay });
      await page.keyboard.press('Backspace', { delay });
    }
    await page.keyboard.type(text.slice(at, at + 6), { delay });
    at += 6;
  }
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results', { timeout: 15_000 });
  // The speed graph draws in after the run; capture it once it has settled.
  await settle(page);
}

// Waits out finite animations and transitions (the graph drawing in, a theme change's background fade).
const settle = (page) => page.waitForFunction(() => document.getAnimations()
  .every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity));

test('standard mode shows its recipe, locks the settings that would change it, and draws fresh text', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-standard').click();
  await expect(page.locator('#mode-standard')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#condition-line')).toHaveText(CONDITIONS);
  await expect(page.locator('#standard-recipe')).toHaveText(`${RECIPE} · stop on error`);
  // One line: the lock notes live in settings, beside the locked controls.
  await expect(page.locator('#standard-options p')).toHaveCount(1);
  await expect(page.locator('#duration-options')).toBeHidden();
  await expect(page.locator('#punctuation-toggle')).toBeDisabled();
  await expect(page.locator('#punctuation-toggle')).toBeChecked();
  await expect(page.locator('#timer')).toHaveText('60');
  const first = await passageText(page);
  expect(first.split('"')).toHaveLength(3);
  expect(first).toMatch(/\d/);

  await openTestContent(page);
  await expect(page.locator('#word-list')).toBeDisabled();
  await expect(page.locator('#word-list')).toHaveValue('standard');
  // The recipe always has numbers; the numbers switch shows that and stays locked.
  await expect(page.locator('#numbers-toggle')).toBeDisabled();
  await expect(page.locator('#numbers-toggle')).toBeChecked();
  await expect(page.locator('#stop-on-error-toggle')).toBeDisabled();
  await expect(page.locator('#stop-on-error-toggle')).toBeChecked();
  await expect(page.getByRole('combobox', { name: 'word list fixed for standard' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'numbers fixed for standard' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'stop on error fixed for standard' })).toBeChecked();
  await page.keyboard.press('Escape');

  // Correction is required: a miss blocks the next letter.
  const miss = first[0] === 'x' ? 'z' : 'x';
  await typeInto(page, miss + first[1]);
  await expect(page.locator('#input-help')).toHaveText('Fix the underlined letter.');
  await expect(page.locator('#typing-input')).toHaveValue(miss);

  // A restart is a fresh seed, not the same text again.
  await page.keyboard.press('Escape');
  await expect.poll(() => passageText(page)).not.toBe(first);

  // Leaving the standard test brings the person's own settings back untouched.
  await page.locator('#mode-time').click();
  await expect(page.locator('#standard-options')).toBeHidden();
  await expect(page.locator('#punctuation-toggle')).toBeEnabled();
  await expect(page.locator('#punctuation-toggle')).not.toBeChecked();
  await expect(page.locator('#condition-line')).toContainText('english 200 · 30 s · plain · physical keyboard · continue on error');
  await openTestContent(page);
  await expect(page.locator('#word-list')).toHaveValue('200');
  await expect(page.locator('#numbers-toggle')).toBeEnabled();
  await expect(page.locator('#numbers-toggle')).not.toBeChecked();
  await expect(page.locator('#stop-on-error-toggle')).toBeEnabled();
  await expect(page.locator('#stop-on-error-toggle')).not.toBeChecked();
  await expect(page.locator('.preference-lock').first()).toBeHidden();
  // The recipe's word-list value leaves with it, so type-ahead can't pick it in another mode.
  await expect(page.locator('#word-list option[value="standard"]')).toHaveCount(0);
  await page.locator('#word-list').focus();
  await page.keyboard.press('1');
  await expect(page.locator('#word-list')).toHaveValue('200');
  await expect(page.locator('#condition-line')).toContainText('english 200 · 30 s');
});

test('a standard run keeps its own best, apart from a time test, and starts the Progress headline', async ({ page }, testInfo) => {
  await page.clock.install();
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await page.locator('#mode-standard').click();
  // 300 correct characters over the full minute: 60 wpm.
  await typeInto(page, (await passageText(page)).slice(0, 300));
  await page.clock.fastForward(60_000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-wpm')).toHaveText('60');
  await expect(page.locator('#result-conditions')).toHaveText(CONDITIONS);
  // Two lines, like other conditions, so the sticky run card grows no taller.
  expect((await page.locator('#result-conditions').boundingBox()).height).toBeLessThanOrEqual(36.5);
  await expect(page.locator('#run-card-stamp')).toContainText('standard');
  await expect(page.locator('#best')).toHaveText('Best · 60 wpm');
  await expect(page.locator('#recommendation-meta')).toContainText('fresh standard retest');

  // A time test of the same length, with punctuation and stop on error, is still a different condition.
  await openView(page, 'Practice');
  await page.locator('#mode-time').click();
  await page.locator('#duration-options [data-length="60"]').click();
  await page.locator('#punctuation-toggle').check();
  await openSettings(page);
  await page.locator('#stop-on-error-toggle').check();
  await expect(page.locator('#best')).toHaveText('No best yet');

  await openView(page, 'Progress');
  await expect(page.locator('#standard-best')).toHaveText('60');
  await expect(page.locator('#standard-median')).toHaveText('—');
  await expect(page.locator('#standard-median + span')).toBeHidden();
  await expect(page.locator('#standard-median-label')).toHaveText('median');
  await expect(page.locator('#standard-score-note')).toHaveText('1 standard run kept. The median appears after 3, so a single fast or slow run can’t set your score.');
  await expect(page.locator('#standard-score-conditions')).toHaveText(`${RECIPE} · physical keyboard · stop on error · corpus v5 · metric v1`);
  expect((await page.locator('#progress-conditions option').allTextContents()).filter((label) => label.startsWith('standard v1'))).toHaveLength(1);
  await expect(page.locator('#run-history .run-row').first()).toContainText('standard');
  await page.screenshot({ path: shot(testInfo, 'progress-first-run-dark.png') });
});

test('a fresh-text retest of a standard run draws a new standard passage and compares like with like', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await page.locator('#mode-standard').click();
  const baseline = await passageText(page);
  await typeInto(page, baseline.slice(0, 300));
  await page.clock.fastForward(60_000);
  await page.locator('#skip-to-retest').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await expect(page.locator('#condition-line')).toHaveText(CONDITIONS);
  await expect(page.locator('#timer')).toHaveText('60');
  const retest = await passageText(page);
  expect(retest).not.toBe(baseline);
  await typeInto(page, retest.slice(0, 320));
  await page.clock.fastForward(60_000);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect(page.locator('#comparison-wpm')).toHaveText('+4 wpm');
  // The person's own settings were never rewritten by the recipe.
  await openView(page, 'Practice');
  await page.locator('#mode-time').click();
  await expect(page.locator('#condition-line')).toContainText('english 200 · 30 s · plain · physical keyboard · continue on error');
});

test('standard mode, its run card and its Progress headline fit a 320px screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.clock.install();
  await openApp(page);
  expect(await screenOverflow(page)).toBeLessThanOrEqual(0);
  await page.locator('#mode-standard').click();
  await expect(page.locator('#standard-options')).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  // The four mode buttons fit the column, so the passage keeps both 16px gutters.
  expect(await screenOverflow(page)).toBeLessThanOrEqual(0);
  const passage = await page.locator('#text-display').boundingBox();
  expect(passage.x + passage.width).toBeLessThanOrEqual(304);
  await typeInto(page, (await passageText(page)).slice(0, 300));
  await page.clock.fastForward(60_000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await openView(page, 'Progress');
  await expect(page.locator('#standard-best')).toHaveText('60');
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  for (const id of ['#take-standard', '#standard-score-note', '#standard-score-conditions']) {
    const box = await page.locator(id).boundingBox();
    expect(box.x + box.width, id).toBeLessThanOrEqual(320);
  }
});

test('Progress shows the standard best and the median of recent runs with its count', async ({ page, supabase }) => {
  await page.clock.install({ time: new Date('2026-10-08T12:00:00Z') });
  const user = supabase.addUser('standard@stilltype.test');
  // The newest completed run was on touch input: one touch run doesn't take over the keyboard score.
  const data = seededProfile([58, 63, 61, 66, 64]);
  data.runs.push({ ...data.runs[0], id: 'standard-touch', at: new Date().toISOString(), conditions: standardConditions('touch'), score: { wpm: 41, accuracy: 95 } });
  supabase.profiles.set(user.id, { data });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Progress');
  await expect(page.locator('#standard-best')).toHaveText('66');
  await expect(page.locator('#standard-median')).toHaveText('63');
  await expect(page.locator('#standard-median-label')).toHaveText('median of last 5 runs');
  await expect(page.locator('#standard-score-note')).toHaveText('5 completed standard runs kept. Interrupted runs don’t count. Your touch best is 41 wpm.');
  await expect(page.locator('#standard-score-conditions')).toContainText('physical keyboard');
  // With history, the standard score still heads the page, above the filters.
  await expect(page.locator('#progress-empty')).toBeHidden();
  const standard = await page.locator('#standard-score').boundingBox();
  expect(standard.y + standard.height).toBeLessThanOrEqual((await page.locator('.progress-filters').boundingBox()).y);

  await page.locator('#take-standard').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#mode-standard')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#typing-input')).toBeFocused();
  await expect(page.locator('#best')).toHaveText('Best · 66 wpm');
});

const NO_STANDARD_RUNS = 'No standard runs yet. Every one is fresh text from the same fixed recipe, so the scores stay comparable.';

// The standard score heads Progress on its own: with no practice history it sits above the empty state.
async function expectStandardAboveEmptyState(page) {
  await expect(page.locator('#progress-empty')).toBeVisible();
  await expect(page.locator('#progress-content')).toBeHidden();
  await expect(page.locator('#standard-score')).toBeVisible();
  await expect(page.locator('#standard-best')).toHaveText('—');
  await expect(page.locator('#standard-median')).toHaveText('—');
  await expect(page.locator('#standard-score-note')).toHaveText(NO_STANDARD_RUNS);
  await expect(page.locator('#take-standard')).toBeVisible();
  const standard = await page.locator('#standard-score').boundingBox();
  const empty = await page.locator('#progress-empty').boundingBox();
  expect(standard.y + standard.height).toBeLessThanOrEqual(empty.y);
}

test('a fresh profile can find and start the standard test from Progress', async ({ page }, testInfo) => {
  await openApp(page);
  await openView(page, 'Progress');
  await expectStandardAboveEmptyState(page);
  // One filled action: the empty state's primary button. The standard test stays secondary.
  await expect(page.locator('#progress-screen .btn-primary:visible')).toHaveCount(1);
  await expect(page.locator('#take-standard')).toHaveClass(/btn-secondary/);

  for (const [width, height] of [[1280, 800], [320, 568]]) {
    await page.setViewportSize({ width, height });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    for (const id of ['#take-standard', '#standard-score-note', '#progress-empty .btn-primary']) {
      const box = await page.locator(id).boundingBox();
      expect(box.x + box.width, id).toBeLessThanOrEqual(width);
    }
    for (const theme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.mouse.move(0, 0);
      await page.evaluate(() => window.scrollTo(0, 0));
      await settle(page);
      if (width > 320) {
        await page.screenshot({ path: shot(testInfo, `progress-fresh-${theme}.png`) });
        continue;
      }
      // At 320px the empty state is below the fold: one shot from the top, one where the two meet.
      await page.screenshot({ path: shot(testInfo, `progress-fresh-320-${theme}.png`) });
      await page.locator('#standard-score-note').evaluate((node) => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 16));
      await page.screenshot({ path: shot(testInfo, `progress-fresh-320-empty-${theme}.png`) });
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.locator('#take-standard').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#mode-standard')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#condition-line')).toHaveText(CONDITIONS);
  await expect(page.locator('#typing-input')).toBeFocused();
});

test('a profile with only an interrupted standard run still shows the standard score on Progress', async ({ page, supabase }) => {
  const user = supabase.addUser('interrupted@stilltype.test');
  const data = seededProfile([60]);
  data.runs = data.runs.filter((run) => run.interrupted);
  data.seenTextIds = data.runs.map((run) => run.textId);
  data.bests = {};
  supabase.profiles.set(user.id, { data });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Progress');
  await expectStandardAboveEmptyState(page);
  // There is history to clear, even though none of it counts.
  await expect(page.locator('#clear-history')).toBeVisible();
  await page.locator('#take-standard').click();
  await expect(page.locator('#mode-standard')).toHaveAttribute('aria-pressed', 'true');
});

test('a standard best that outlives its runs in the kept history says so, not "no runs yet"', async ({ page, supabase }) => {
  const user = supabase.addUser('aged@stilltype.test');
  // Bests stay until history is cleared, but only the newest 1,000 run summaries are kept: here every
  // standard run has aged out and only a newer time test remains.
  const data = seededProfile([62, 66, 64]);
  data.runs = [{ ...data.runs[0], id: 'time-30', at: new Date().toISOString(), textId: 'generated-time-30',
    conditions: { ...standardConditions(), mode: 'time', duration: 30, recipe: undefined, wordList: '200', correctionPolicy: 'relaxed' },
    score: { wpm: 58, accuracy: 97 } }];
  supabase.profiles.set(user.id, { data });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Progress');
  await expect(page.locator('#standard-best')).toHaveText('66');
  await expect(page.locator('#standard-best + span')).toBeVisible();
  await expect(page.locator('#standard-median')).toHaveText('—');
  await expect(page.locator('#standard-median + span')).toBeHidden();
  await expect(page.locator('#standard-median-label')).toHaveText('median');
  await expect(page.locator('#standard-score-note')).toHaveText(AGED_OUT);
});

// Run summaries are pruned to the newest 1,000 but bests are not, so kept run counts can't stand in for
// lifetime counts when choosing which input class heads Progress.
const AGED_OUT = 'Your best is kept, but your standard runs are older than the newest 1,000 runs that Progress keeps, so the median waits for 3 new ones.';
const OLDER_BEST = 'Your best comes from a run older than the newest 1,000 runs that Progress keeps.';
const TOUCH_KEY = conditionKey(standardConditions('touch'));
const touchRun = (wpm, i, base) => ({ ...base, id: `standard-touch-${i}`, at: new Date(Date.now() - (3 - i) * 3600000).toISOString(),
  textId: `standard-v1-touch${i}`, conditions: standardConditions('touch'), score: { wpm, accuracy: 95 } });

async function openProgressAs(page, supabase, email, data) {
  const user = supabase.addUser(email);
  data.seenTextIds = data.runs.map((run) => run.textId);
  supabase.profiles.set(user.id, { data });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Progress');
}

test('when only some standard runs are kept, the note counts kept runs and says the best is older', async ({ page, supabase }) => {
  // Two standard runs, then 999 newer comparable runs (daily challenges, which stay off Progress): keeping
  // the newest 1,000 summaries drops the first standard run, the 66 wpm best, while the best itself stays.
  const data = seededProfile([66, 60]);
  const [first, second] = data.runs;
  const daily = Array.from({ length: 999 }, (_, i) => ({ ...second, id: `daily-${i}`, kind: 'daily', textId: `daily-${i}`,
    at: new Date(Date.now() - (999 - i) * 60000).toISOString(), challengeDate: '2026-10-01', firstDailyAttempt: i === 0,
    conditions: { ...standardConditions(), mode: 'time', duration: 30, recipe: undefined, wordList: '200', correctionPolicy: 'relaxed' },
    score: { wpm: 58, accuracy: 97 } }));
  data.runs = [first, second, ...daily];
  await openProgressAs(page, supabase, 'partly-aged@stilltype.test', data);
  await expect(page.locator('#standard-best')).toHaveText('66');
  await expect(page.locator('#standard-median')).toHaveText('—');
  await expect(page.locator('#standard-score-note')).not.toContainText('so far');
  await expect(page.locator('#standard-score-note')).toHaveText(`1 standard run kept. ${OLDER_BEST} The median appears after 3, so a single fast or slow run can’t set your score.`);
  // The longest note still wraps inside a 320px screen.
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  const note = await page.locator('#standard-score-note').boundingBox();
  expect(note.x + note.width).toBeLessThanOrEqual(320);
});

test('a kept keyboard best stays the headline over one newer touch run, and the touch best is named', async ({ page, supabase }) => {
  // Every keyboard standard run has aged out of the kept summaries; one touch run is newer.
  const data = seededProfile([62, 66, 64]);
  data.runs = [touchRun(48, 0, data.runs[0])];
  data.bests[TOUCH_KEY] = { wpm: 48, attemptId: data.runs[0].id, at: data.runs[0].at };
  await openProgressAs(page, supabase, 'kept-keyboard@stilltype.test', data);
  await expect(page.locator('#standard-best')).toHaveText('66');
  await expect(page.locator('#standard-median')).toHaveText('—');
  await expect(page.locator('#standard-score-conditions')).toContainText('physical keyboard');
  await expect(page.locator('#standard-score-note')).toHaveText(`${AGED_OUT} Your touch best is 48 wpm.`);
});

test('a touch best is the headline when it is the only standard best, even with no runs left', async ({ page, supabase }) => {
  const data = seededProfile([60]);
  data.runs = [{ ...data.runs[0], id: 'time-30', textId: 'generated-time-30',
    conditions: { ...standardConditions(), mode: 'time', duration: 30, recipe: undefined, wordList: '200', correctionPolicy: 'relaxed' } }];
  data.bests = { [TOUCH_KEY]: { wpm: 47, attemptId: 'standard-touch-old', at: data.runs[0].at } };
  await openProgressAs(page, supabase, 'touch-best@stilltype.test', data);
  await expect(page.locator('#standard-best')).toHaveText('47');
  await expect(page.locator('#standard-score-conditions')).toContainText('touch input');
  await expect(page.locator('#standard-score-note')).toHaveText(AGED_OUT);
});

test('a settled touch score with more kept runs heads Progress, and the keyboard best is named', async ({ page, supabase }) => {
  // One keyboard run is still kept; the keyboard best of 82 came from runs that have aged out.
  const data = seededProfile([70]);
  data.runs.push(...[44, 48, 46].map((wpm, i) => touchRun(wpm, i, data.runs[0])));
  data.bests[conditionKey(standardConditions())].wpm = 82;
  data.bests[TOUCH_KEY] = { wpm: 48, attemptId: 'standard-touch-1', at: data.runs.at(-2).at };
  await openProgressAs(page, supabase, 'settled-touch@stilltype.test', data);
  await expect(page.locator('#standard-best')).toHaveText('48');
  await expect(page.locator('#standard-median')).toHaveText('46');
  await expect(page.locator('#standard-median-label')).toHaveText('median of last 3 runs');
  await expect(page.locator('#standard-score-conditions')).toContainText('touch input');
  await expect(page.locator('#standard-score-note')).toHaveText('3 completed standard runs kept. Interrupted runs don’t count. Your physical keyboard best is 82 wpm.');
});

test('the palette starts the standard test and leaves out the settings it locks', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('standard');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('standard test · 60 seconds');
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('#mode-standard')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#typing-input')).toBeFocused();

  await page.keyboard.press('Control+k');
  const labels = await page.locator('#palette-list .opt-label').allTextContents();
  expect(labels).toContain('standard test · 60 seconds');
  expect(labels.filter((label) => /^(punctuation|stop on error|word list)/.test(label))).toEqual([]);
  await page.keyboard.type('standard');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-hint')).toHaveText('current');
});

test('a custom passage over standard keeps its own condition and never reaches the standard score', async ({ page }) => {
  const text = 'the quick brown fox jumps over the lazy dog';
  await openApp(page);
  await page.locator('#mode-standard').click();
  await page.locator('#mode-custom').click();
  await expect(page.locator('#custom-options')).toBeVisible();
  await expect(page.locator('#standard-options')).toBeHidden();
  await expect(page.locator('#mode-standard')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#custom-text').fill(text);
  await page.locator('#custom-use').click();

  // The custom run is built on the person's own settings, not the recipe: no recipe in its key, and the
  // default correction rule, which the settings show unlocked.
  await expect(page.locator('#condition-line')).toContainText('custom text');
  await expect(page.locator('#condition-line')).toContainText('continue on error');
  await expect(page.locator('#standard-options')).toBeHidden();
  await expect(page.locator('#best')).toHaveText('Not counted');
  await openSettings(page);
  await expect(page.locator('#stop-on-error-toggle')).toBeEnabled();
  await expect(page.locator('#stop-on-error-toggle')).not.toBeChecked();
  await expect(page.locator('.preference-lock').first()).toBeHidden();
  await page.keyboard.press('Escape');

  await typeInto(page, text);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-conditions')).toContainText('custom text');
  await expect(page.locator('#result-conditions')).not.toContainText('standard');
  await expect(page.locator('#run-card-stamp')).toContainText('custom');

  await openView(page, 'Progress');
  await expect(page.locator('#standard-best')).toHaveText('—');
  await expect(page.locator('#standard-score-note')).toHaveText(NO_STANDARD_RUNS);

  // Standard again closes the custom passage and locks the recipe's settings.
  await openView(page, 'Practice');
  await page.locator('#mode-standard').click();
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#mode-standard')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#condition-line')).toHaveText(CONDITIONS);
  await expect(page.locator('#best')).toHaveText('No best yet');
  await openSettings(page);
  await expect(page.locator('#stop-on-error-toggle')).toBeDisabled();
  await expect(page.locator('#stop-on-error-toggle')).toBeChecked();
});

test('the daily challenge keeps its own conditions while standard is selected', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
  await openApp(page);
  await page.locator('#mode-standard').click();
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await page.locator('#start-daily').click();
  await expect(page.locator('#condition-line')).not.toContainText('standard');
  await expect(page.locator('#condition-line')).toContainText('continue on error');
  await completePassage(page);
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await expect(page.locator('#daily-status')).toContainText('1 attempt');
});

test('screenshots', async ({ page, supabase }, testInfo) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const user = supabase.addUser('shots@stilltype.test');
  supabase.profiles.set(user.id, { data: seededProfile([54, 58, 57, 61, 59, 63, 62, 66]) });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await signInWithEmail(page, user.email);

  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    await openView(page, 'Progress');
    await expect(page.locator('#standard-median')).toHaveText('60');
    await page.mouse.move(0, 0);
    await page.screenshot({ path: shot(testInfo, `progress-${theme}.png`) });
  }

  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    await openView(page, 'Practice');
    await page.locator('#mode-standard').click();
    await expect(page.locator('#standard-options')).toBeVisible();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: shot(testInfo, `practice-${theme}.png`) });
  }

  await page.emulateMedia({ colorScheme: 'dark' });
  await openTestContent(page);
  await page.screenshot({ path: shot(testInfo, 'settings-locked-dark.png') });
  await page.keyboard.press('Escape');

  await page.locator('#typing-input').focus();
  await page.keyboard.press('Escape');
  await typeForAMinute(page, await passageText(page));
  const wpm = Number(await page.locator('#result-wpm').textContent());
  expect(wpm).toBeGreaterThanOrEqual(30);
  expect(wpm).toBeLessThanOrEqual(110);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: shot(testInfo, 'run-card-dark.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await openView(page, 'Practice');
  await expect(page.locator('#mode-standard')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: shot(testInfo, 'practice-mobile-dark.png') });
});
