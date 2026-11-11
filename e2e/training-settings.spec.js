import { CORPUS_VERSION, METRIC_VERSION } from '../src/typing.js';
import { DEFAULT_POLICY, englishFrequency } from '../src/learner.js';
import { LESSONS } from '../src/lessons.js';
import { test, expect, openApp, passageText, chooseWords, chooseMore, completePassage, openView, openSettings, closeSettings, chooseSetting, signInWithEmail, typeInto } from './fixtures.js';

const checked = (page, id) => page.locator(`#${id} input:checked`);

async function runPalette(page, label) {
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill(label);
  await page.locator('#palette-list [role="option"]', { hasText: label }).first().click();
}

// Starts the drill's clock with a few keys, then runs it on by `seconds`.
async function runDrillFor(page, seconds) {
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await typeInto(page, (await passageText(page)).slice(0, 4));
  await page.clock.fastForward(seconds * 1000);
}

// Six measured runs in which "th" is never missed but typed 90 ms slower than the run's pace, and "an" is
// missed on 3 of its 8 first tries a run at pace: the learner ranks "th" on slowness and "an" on misses.
const conditions = { mode: 'words', count: 25, punctuation: false, numbers: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };

const BACKGROUND = [...englishFrequency().pairs].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([pair]) => pair);
const ROWS = [['th', 8, 0, 8, 290, 90], ['an', 8, 3, 8, 200, 0]];

const focusRuns = () => Array.from({ length: 6 }, (_, i) => ({ id: `focus-${i}`, at: `2026-11-0${i + 1}T12:00:00.000Z`, day: `2026-11-0${i + 1}`, kind: 'test', status: 'complete',
  interrupted: false, fresh: true, conditions, textId: `focus-${i}`, score: { wpm: 60, accuracy: 96 }, elapsedMs: 25_000, errors: 3, target: null, patterns: [...BACKGROUND.filter((pair) => !ROWS.some((row) => row[0] === pair)).map((pair) => [pair, 3, 0, 3, 200, 0]), ...ROWS],
  keys: [], keysVersion: 0 }));

const SLOW_TH = '90 ms slower than your pace, in 6 of 6 runs that timed it (48 clean intervals)';
const MISSED_AN = '18 of 48 missed in 6 runs';

test('the three training settings are chosen in the settings dialog, saved and synced with the other preferences', async ({ page, supabase }) => {
  const user = supabase.addUser('train-settings@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openSettings(page, 'practice');
  await expect(page.locator('#train-focus-label')).toHaveText('train focus');
  await expect(checked(page, 'train-focus')).toHaveValue('balanced');
  await expect(checked(page, 'drill-length')).toHaveValue('30');
  await expect(checked(page, 'retest-toggle')).toHaveValue('true');

  await chooseSetting(page, 'train-focus', 'speed');
  await chooseSetting(page, 'drill-length', '60');
  await chooseSetting(page, 'retest-toggle', 'false');
  await closeSettings(page);
  await expect.poll(() => supabase.profileFor(user.email)?.preferences).toMatchObject({ trainFocus: 'speed', drillSeconds: 60, retest: false });

  await openView(page, 'Train');
  await expect(page.locator('#start-drill')).toHaveText('Drill');

  await page.reload();
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await openSettings(page, 'practice');
  await expect(checked(page, 'train-focus')).toHaveValue('speed');
  await expect(checked(page, 'drill-length')).toHaveValue('60');
  await expect(checked(page, 'retest-toggle')).toHaveValue('false');
});

test('the palette sets the focus, the drill length and the retest, and the settings dialog shows them', async ({ page }) => {
  await openApp(page);
  await runPalette(page, 'train focus · accuracy');
  await runPalette(page, 'drill length · 120 seconds');
  await runPalette(page, 'retest after drill');
  await openSettings(page, 'practice');
  await expect(checked(page, 'train-focus')).toHaveValue('accuracy');
  await expect(checked(page, 'drill-length')).toHaveValue('120');
  await expect(checked(page, 'retest-toggle')).toHaveValue('false');
  await closeSettings(page);

  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('retest after drill');
  await expect(page.locator('#palette-list [role="option"]', { hasText: 'retest after drill' })).toContainText('off');
  await page.keyboard.press('Escape');
  await openView(page, 'Train');
  await expect(page.locator('#start-drill')).toHaveText('Drill');
});

test('a 15-second drill is retested after 15 seconds, and a 120-second drill runs past 60', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await chooseSetting(page, 'drill-length', '15');
  await closeSettings(page);
  await openView(page, 'Train');
  await page.locator('#start-drill').click();
  await expect(page.locator('#session-kicker')).toHaveText('drill · 15 s');
  await runDrillFor(page, 15);
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();

  await chooseSetting(page, 'drill-length', '120');
  await closeSettings(page);
  await openView(page, 'Train');
  await page.locator('#start-drill').click();
  await expect(page.locator('#session-kicker')).toHaveText('drill · 120 s');
  await runDrillFor(page, 60);
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await page.clock.fastForward(60_000);
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
});

test('with the retest off, Train runs the drill and stops: nothing is compared and no loop is saved', async ({ page, supabase }) => {
  const user = supabase.addUser('no-retest@stilltype.test');
  await page.clock.install();
  await openApp(page);
  await signInWithEmail(page, user.email);
  await chooseWords(page, 10);
  await completePassage(page);
  await chooseSetting(page, 'retest-toggle', 'false');
  await closeSettings(page);
  await expect(page.locator('#result-drill')).toHaveText('Drill');
  await openView(page, 'Train');
  await expect(page.locator('#start-drill')).toHaveText('Drill');
  await page.locator('#start-drill').click();
  await expect(page.locator('#session-description')).toHaveText('Standalone drill.');
  await runDrillFor(page, 30);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#comparison-panel')).toBeHidden();
  await expect.poll(() => supabase.profileFor(user.email)?.runs?.map((run) => run.kind)).toEqual(['test', 'drill']);
  expect(supabase.profileFor(user.email).loops).toEqual([]);
  await openView(page, 'Progress');
  await expect(page.locator('#history-list')).toBeHidden();
});

test('each focus names its own target on the same history, and Patterns across runs agrees with Train', async ({ page, supabase }) => {
  const user = supabase.addUser('focus@stilltype.test');
  supabase.profiles.set(user.id, { data: { version: 2, preferences: { mode: 'words', count: 25 }, attempts: [], runs: focusRuns(), loops: [], seenTextIds: [], bests: {},
    updatedAt: '2026-11-06T12:00:00Z' } });

  await openApp(page);
  await signInWithEmail(page, user.email);

  for (const [focus, target, evidence] of [['balanced', 'th', SLOW_TH], ['accuracy', 'an', MISSED_AN], ['speed', 'th', SLOW_TH]]) {
    await chooseSetting(page, 'train-focus', focus);
    await closeSettings(page);
    await openView(page, 'Train');
    await expect(page.locator('#train-heading')).toHaveText(`Practice “${target}”`);
    await expect(page.locator('#train-evidence')).toHaveText(evidence);

    // Progress lists the same queue, its first row the target Train names, with the same evidence line.
    await openView(page, 'Progress');
    const first = page.locator('#training-targets .training-target').first();
    await expect(first.locator('h3')).toHaveText(`Practice “${target}”`);
    await expect(first.locator('p').first()).toHaveText(evidence);
    await expect(page.locator('#training-targets')).not.toContainText('slower than your median');
  }

  // Accuracy queues only units named on their misses; speed only pairs named on their pace.
  await chooseSetting(page, 'train-focus', 'accuracy');
  await closeSettings(page);
  await openView(page, 'Progress');
  await expect(page.locator('#training-targets h3')).toHaveText(['Practice “an”']);
  await page.locator('#training-targets').getByRole('button', { name: 'Practice “an” again' }).click();
  await expect(page.locator('#session-title')).toHaveText('Practice “an”');
});

test('a loop records the focus its target was ranked for, beside the policy', async ({ page, supabase }) => {
  const user = supabase.addUser('focus-loop@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, user.email);
  await chooseSetting(page, 'train-focus', 'accuracy');
  await closeSettings(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await page.clock.install();
  await openView(page, 'Train');
  await page.locator('#start-drill').click();
  await runDrillFor(page, 30);
  await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect.poll(() => supabase.profileFor(user.email)?.loops?.at(-1)).toMatchObject({ policy: DEFAULT_POLICY, focus: 'accuracy', drill: { duration: 30 } });
});

// The focus history signed in on this page: its results card, Train and comparison read the cloud's runs.
async function signInWithHistory(page, supabase, email, runs = focusRuns()) {
  const user = supabase.addUser(email);
  supabase.profiles.set(user.id, { data: { version: 2, preferences: { mode: 'words', count: 25 }, attempts: [], runs, loops: [], seenTextIds: [], bests: {},
    updatedAt: '2026-11-06T12:00:00Z' } });
  await openApp(page);
  await signInWithEmail(page, email);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');

  return user;
}

// A drill already on screen, run out, then its retest typed: the comparison opens on Train.
async function drillAndRetest(page, seconds = 30) {
  await runDrillFor(page, seconds);
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();
}

for (const [from, to, before, after] of [['balanced', 'accuracy', 'th', 'an'], ['accuracy', 'speed', 'an', 'th']]) {
  test(`the results card follows a change from ${from} to ${to} made while it shows, and its drill records ${to}`, async ({ page, supabase }) => {
    const user = await signInWithHistory(page, supabase, `card-${to}@stilltype.test`);
    await chooseSetting(page, 'train-focus', from);
    await closeSettings(page);
    await chooseWords(page, 10);
    await completePassage(page);
    await expect(page.locator('#result-drill')).toHaveText(`Drill “${before}”`);

    await runPalette(page, `train focus · ${to}`);
    await expect(page.locator('#result-drill')).toHaveText(`Drill “${after}”`);
    await page.clock.install();
    await page.locator('#result-drill').click();
    await expect(page.locator('#session-title')).toHaveText(`Practice “${after}”`);
    await drillAndRetest(page);
    await expect.poll(() => supabase.profileFor(user.email)?.loops?.at(-1)).toMatchObject({ target: after, focus: to, policy: DEFAULT_POLICY, recommendationKind: 'targeted' });
  });
}

test('the comparison’s Next follows a focus change made while it shows, and its drill records the focus that queued it', async ({ page, supabase }) => {
  const user = await signInWithHistory(page, supabase, 'next-focus@stilltype.test');
  await chooseSetting(page, 'train-focus', 'accuracy');
  await closeSettings(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await page.clock.install();
  await openView(page, 'Train');
  await expect(page.locator('#train-heading')).toHaveText('Practice “an”');
  await page.locator('#start-drill').click();
  await drillAndRetest(page);
  // Accuracy queues only "an", which was just trained.
  await expect(page.locator('#comparison-next')).toBeHidden();

  await runPalette(page, 'train focus · speed');
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect(page.locator('#comparison-next')).toHaveText('Next: “th”');
  await page.locator('#comparison-next').click();
  await expect(page.locator('#session-title')).toHaveText('Practice “th”');
  await drillAndRetest(page);
  await expect.poll(() => supabase.profileFor(user.email)?.loops?.at(-1)).toMatchObject({ target: 'th', focus: 'speed', policy: DEFAULT_POLICY, recommendationKind: 'manual' });
});

test('a retest’s own card, reached with Back to practice, follows a focus change made on the comparison', async ({ page, supabase }) => {
  const user = await signInWithHistory(page, supabase, 'back-focus@stilltype.test');
  await chooseSetting(page, 'train-focus', 'accuracy');
  await closeSettings(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await expect(page.locator('#result-drill')).toHaveText('Drill “an”');
  await page.clock.install();
  await page.locator('#result-drill').click();
  await drillAndRetest(page);

  await runPalette(page, 'train focus · speed');
  await page.locator('#comparison-back').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-drill')).toHaveText('Drill “th”');
  await page.locator('#result-drill').click();
  await expect(page.locator('#session-title')).toHaveText('Practice “th”');
  await drillAndRetest(page);
  await expect.poll(() => supabase.profileFor(user.email)?.loops?.at(-1)).toMatchObject({ target: 'th', focus: 'speed', policy: DEFAULT_POLICY });
});

test('an adaptive run’s loop records the focus that chose its words, not one picked afterwards', async ({ page, supabase }) => {
  const user = await signInWithHistory(page, supabase, 'adaptive-focus@stilltype.test');
  await chooseSetting(page, 'train-focus', 'speed');
  await closeSettings(page);
  // A normal run at these settings is the baseline the adaptive run's retest is compared with.
  await completePassage(page);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await page.locator('#adaptive-switch').click();
  await expect(page.locator('#adaptive-toggle')).toBeChecked();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await completePassage(page);
  await expect(page.locator('#result-drill')).toHaveText('Retest on fresh text');

  await runPalette(page, 'train focus · accuracy');
  await page.locator('#result-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect.poll(() => supabase.profileFor(user.email)?.loops?.at(-1)).toMatchObject({ recommendationKind: 'adaptive', focus: 'speed', policy: DEFAULT_POLICY });
});

for (const focus of ['balanced', 'accuracy', 'speed']) {
  test(`typing "train focus · ${focus}" in full and pressing Enter sets ${focus}`, async ({ page }) => {
    await openApp(page);
    // Start from another focus, so the command has something to change.
    await runPalette(page, `train focus · ${focus === 'speed' ? 'accuracy' : 'speed'}`);
    await page.keyboard.press('Control+k');
    await page.locator('#palette-input').fill(`train focus · ${focus}`);
    await page.keyboard.press('Enter');
    await openSettings(page, 'practice');
    await expect(checked(page, 'train-focus')).toHaveValue(focus);
  });
}

test('an adaptive passage nobody has started is drawn again for a focus chosen on another screen or another device', async ({ page, browser, supabase }) => {
  const user = await signInWithHistory(page, supabase, 'adaptive-waiting@stilltype.test');
  await chooseSetting(page, 'train-focus', 'speed');
  await closeSettings(page);
  // A normal run at these settings is the baseline an adaptive run's retest is compared with.
  await completePassage(page);
  await page.locator('#adaptive-switch').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  const forSpeed = await passageText(page);

  await openView(page, 'Train');
  await runPalette(page, 'train focus · accuracy');
  await openView(page, 'Practice');
  await expect.poll(() => passageText(page)).not.toBe(forSpeed);
  const forAccuracy = await passageText(page);

  const context = await browser.newContext();
  const phone = await context.newPage();
  await supabase.attach(phone);

  try {
    await openApp(phone);
    await signInWithEmail(phone, user.email);
    await chooseSetting(phone, 'train-focus', 'speed');
    await closeSettings(phone);
    await expect.poll(() => supabase.profileFor(user.email)?.preferences?.trainFocus).toBe('speed');
    await page.evaluate(() => dispatchEvent(new Event('online')));
    await expect.poll(() => passageText(page)).not.toBe(forAccuracy);
  } finally {
    await context.close();
  }

  // The passage typed is the one drawn for the focus in force, and its loop says so.
  await completePassage(page);
  await page.locator('#result-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await completePassage(page);
  await expect.poll(() => supabase.profileFor(user.email)?.loops?.at(-1)).toMatchObject({ recommendationKind: 'adaptive', focus: 'speed' });
});

test('a failed drill whose history another device cleared while it waited shows its card and can be tried again', async ({ page, browser, supabase }) => {
  const user = supabase.addUser('cleared-drill@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, user.email);
  await chooseSetting(page, 'correction-select', 'fail-word');
  await closeSettings(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await expect.poll(() => supabase.profileFor(user.email)?.runs?.length).toBe(1);
  await page.locator('#result-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');

  const context = await browser.newContext();
  const phone = await context.newPage();
  await supabase.attach(phone);

  try {
    await openApp(phone);
    await signInWithEmail(phone, user.email);
    await expect(phone.locator('#account')).toHaveAttribute('data-sync', 'synced');
    await openView(phone, 'Progress');
    await expect(phone.locator('#clear-history')).toBeEnabled();
    await phone.locator('#clear-history').click();
    await phone.locator('#confirm-clear-input').fill('clear');
    await phone.locator('#confirm-clear').click();
    await expect.poll(() => supabase.profileFor(user.email)?.historyClearedAt, { intervals: [100] }).toBeTruthy();
  } finally {
    await context.close();
  }

  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(page.locator('#best')).toHaveText('No best yet');

  const text = await passageText(page);
  await typeInto(page, `${text[0] === 'x' ? 'z' : 'x'} `);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-drill')).toHaveText('Try drill again');
  await page.locator('#result-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
});

test('a drill waiting when another device clears history still runs the length it shows and records', async ({ page, browser, supabase }) => {
  const user = supabase.addUser('cleared-length@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, user.email);
  await chooseSetting(page, 'drill-length', '60');
  await closeSettings(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await expect.poll(() => supabase.profileFor(user.email)?.runs?.length).toBe(1);
  await page.locator('#result-drill').click();
  await expect(page.locator('#session-kicker')).toHaveText('drill · 60 s');
  // The setting changes under the waiting drill, which keeps the length it was drawn with.
  await runPalette(page, 'drill length · 15 seconds');
  await expect(page.locator('#session-kicker')).toHaveText('drill · 60 s');

  const context = await browser.newContext();
  const phone = await context.newPage();
  await supabase.attach(phone);

  try {
    await openApp(phone);
    await signInWithEmail(phone, user.email);
    await expect(phone.locator('#account')).toHaveAttribute('data-sync', 'synced');
    await openView(phone, 'Progress');
    await expect(phone.locator('#clear-history')).toBeEnabled();
    await phone.locator('#clear-history').click();
    await phone.locator('#confirm-clear-input').fill('clear');
    await phone.locator('#confirm-clear').click();
    await expect.poll(() => supabase.profileFor(user.email)?.historyClearedAt, { intervals: [100] }).toBeTruthy();
  } finally {
    await context.close();
  }

  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(page.locator('#best')).toHaveText('No best yet');
  await expect(page.locator('#session-kicker')).toHaveText('drill · 60 s');

  await page.clock.install();
  await typeInto(page, (await passageText(page)).slice(0, 4));
  await page.clock.fastForward(20_000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await page.clock.fastForward(41_000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect.poll(() => supabase.profileFor(user.email)?.runs?.at(-1)).toMatchObject({ kind: 'drill', drillSeconds: 60, elapsedMs: 60_000 });
});

test('the plain passage that follows an adaptive run is kept when the focus changes', async ({ page, supabase }) => {
  await signInWithHistory(page, supabase, 'plain-next@stilltype.test');
  await page.locator('#adaptive-switch').click();
  await expect(page.locator('#adaptive-toggle')).toBeChecked();
  await expect(page.locator('#condition-line')).toContainText('adaptive');
  await completePassage(page);
  // With no normal run at these settings to compare with, the retest is a plain test that can become the baseline.
  await expect(page.locator('#result-drill')).toHaveText('Retest');
  await page.locator('#result-drill').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#condition-line')).not.toContainText('adaptive');
  const plain = await passageText(page);

  await runPalette(page, 'train focus · accuracy');
  await expect(page.locator('#condition-line')).not.toContainText('adaptive');
  expect(await passageText(page)).toBe(plain);
});

test('the lessons’ hand-off states the drill length chosen in the settings dialog while it shows', async ({ page, supabase }) => {
  const user = supabase.addUser('handoff-length@stilltype.test');
  const record = { wpm: 20, accuracy: 97, at: '2026-10-01T18:10:00Z' };
  const lessons = Object.fromEntries(LESSONS.map((lesson) => [lesson.id, { tries: 1, last: record, passed: record }]));
  supabase.profiles.set(user.id, { data: { version: 2, preferences: { mode: 'words', count: 10 }, attempts: [], runs: [], loops: [], seenTextIds: [], bests: {}, lessons,
    updatedAt: '2026-10-08T12:00:00Z' } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await chooseMore(page, 'open-lessons');
  await expect(page.locator('[data-screen="learn"]')).toContainText('a 30-second drill');

  // Read once, at once: the change itself redraws the screen. A later save or sync would too, so a retried read proves nothing.
  await chooseSetting(page, 'drill-length', '120');
  expect(await page.locator('[data-screen="learn"]').textContent()).toContain('a 120-second drill');
});

test('a focus chosen on another device updates the results card, Train and the comparison open here', async ({ page, browser, supabase }) => {
  const user = await signInWithHistory(page, supabase, 'focus-sync@stilltype.test');
  const context = await browser.newContext();
  const phone = await context.newPage();
  await supabase.attach(phone);
  // A returning connection reads the account again, as when the phone's change reaches this device.
  const hear = () => page.evaluate(() => dispatchEvent(new Event('online')));

  const chooseOnPhone = async (focus) => {
    await chooseSetting(phone, 'train-focus', focus);
    await closeSettings(phone);
    await expect.poll(() => supabase.profileFor(user.email)?.preferences?.trainFocus).toBe(focus);
    await hear();
  };

  try {
    await openApp(phone);
    await signInWithEmail(phone, user.email);
    await chooseWords(page, 10);
    await completePassage(page);
    await expect(page.locator('#result-drill')).toHaveText('Drill “th”');

    await chooseOnPhone('accuracy');
    await expect(page.locator('#result-drill')).toHaveText('Drill “an”');

    await openView(page, 'Train');
    await expect(page.locator('#train-heading')).toHaveText('Practice “an”');
    await chooseOnPhone('speed');
    await expect(page.locator('#train-heading')).toHaveText('Practice “th”');

    await page.clock.install();
    await page.locator('#start-drill').click();
    await drillAndRetest(page);
    // Speed queues only "th", which was just trained.
    await expect(page.locator('#comparison-next')).toBeHidden();
    await chooseOnPhone('accuracy');
    await expect(page.locator('#comparison-panel')).toBeVisible();
    await expect(page.locator('#comparison-next')).toHaveText('Next: “an”');
  } finally {
    await context.close();
  }
});

// The same history, its runs having missed "another", "think", "than" and "and" on the first try. Where in each
// word the miss fell isn't kept, so no letter of them is coral: "an" in the text colour, the rest muted, and for
// "th", named for its pace, no words at all.
for (const scheme of ['dark', 'light']) {
  test(`Train marks no unmistyped letter in coral, for a target named for its pace or its misses (${scheme})`, async ({ page, supabase }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const runs = focusRuns().map((run) => ({ ...run, missedWords: ['another', 'think', 'than', 'and'] }));
    await signInWithHistory(page, supabase, `marks-${scheme}@stilltype.test`, runs);

    const colour = (value) => page.evaluate((css) => {
      const probe = document.body.appendChild(document.createElement('span'));
      probe.style.color = css;
      const computed = getComputedStyle(probe).color;
      probe.remove();

      return computed;
    }, value);

    const [danger, text, muted] = [await colour('var(--danger)'), await colour('var(--text)'), await colour('var(--muted)')];

    await openView(page, 'Train');
    await expect(page.locator('#train-heading')).toHaveText('Practice “th”');
    await expect(page.locator('#train-evidence')).toHaveText(SLOW_TH);
    await expect(page.locator('#train-words')).toBeHidden();
    await expect(page.locator('#train-words b')).toHaveCount(0);

    await chooseSetting(page, 'train-focus', 'accuracy');
    await closeSettings(page);
    await expect(page.locator('#train-heading')).toHaveText('Practice “an”');
    await expect(page.locator('#train-words span')).toHaveText(['another', 'than', 'and']);
    const marks = page.locator('#train-words b');
    await expect(marks).toHaveText(['an', 'an', 'an']);

    for (const mark of await marks.all()) {
      await expect(mark).not.toHaveCSS('color', danger);
      await expect(mark).toHaveCSS('color', text);
    }

    await expect(page.locator('#train-words span').first()).toHaveCSS('color', muted);
  });
}
