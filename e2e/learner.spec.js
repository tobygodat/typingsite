import { makeDrill } from '../src/typing.js';
import { DEFAULT_POLICY, SLOW_FLOOR_MS, fitLearner, learnerEvidence, learnerRecommendation, paceShift } from '../src/learner.js';
import { test, expect, openApp, passageText, chooseWords, completePassage, finishDrill, openView, signInWithEmail } from './fixtures.js';

// Types the passage with a wrong first try, then the right letter, at every position `missed` picks.
async function typeMissing(page, missed) {
  const text = await passageText(page);
  await page.locator('#typing-input').focus();
  let from = 0;

  for (let at = 0; at < text.length; at += 1) {
    if (!missed(text, at)) continue;
    await page.keyboard.type(text.slice(from, at));
    await page.keyboard.type(text[at] === 'x' ? 'z' : 'x');
    await page.keyboard.press('Backspace');
    from = at;
  }

  await page.keyboard.type(text.slice(from));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');

  return text;
}

// The second letter of every "th"; the first letter of every word starting with "w".
const secondOfTh = (text, at) => text.slice(at - 1, at + 1) === 'th';
const wordStartW = (text, at) => text[at] === 'w' && (at === 0 || text[at - 1] === ' ');

test('a brand-new guest gets the plain general drill: with no evidence nothing ranks', async ({ page }) => {
  await openApp(page);
  await openView(page, 'Train');
  await expect(page.locator('#train-heading')).toHaveText('General drill');
  await expect(page.locator('#train-evidence')).toBeHidden();
  await page.locator('#start-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#session-title')).toHaveText('General drill');
  expect(learnerRecommendation(fitLearner([], Date.now())).lean).toEqual([]);
  expect(await passageText(page)).toBe(makeDrill(null, '200').text);
});

test('after one clean run, Train is a general drill, then a fresh retest and the comparison', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  const baseline = await completePassage(page);
  await expect(page.locator('#result-drill')).toHaveText('Drill and retest');
  await openView(page, 'Train');
  await expect(page.locator('#train-heading')).toHaveText('General drill');
  await page.locator('#start-drill').click();
  await finishDrill(page);
  const retest = await completePassage(page);
  expect(retest).not.toBe(baseline);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect(page.locator('#comparison-panel')).toHaveAttribute('data-outcome', /^(improved|mixed|regressed|steady)$/);
});

// Fixed passages, so the runs hold enough tries at "th" to be stated.
const seedRandom = () => {
  let seed = 20261110;
  Math.random = () => {
    seed = (seed * 16807) % 2147483647;

    return (seed - 1) / 2147483646;
  };
};

test('a pair missed in every run is named with its observed counts, drilled, retested and recorded with its policy', async ({ page, supabase }) => {
  const user = supabase.addUser('learner@stilltype.test');
  const profile = () => supabase.profileFor(user.email);
  await page.addInitScript(seedRandom);
  await openApp(page);
  await signInWithEmail(page, user.email);
  await chooseWords(page, 100);

  for (let run = 0; run < 2; run += 1) {
    await typeMissing(page, secondOfTh);
    await page.locator('#run-again').click();
    await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  }

  await expect.poll(() => profile()?.runs?.length).toBe(2);
  // What the learner makes of exactly these runs, worked out here from the saved summaries.
  const expected = learnerRecommendation(fitLearner(learnerEvidence(profile().runs, 'physical-keyboard:qwerty'), Date.now()));
  expect(expected.target).toBe('th');
  expect(expected.was.runs).toBe(2);
  expect(expected.was.observations).toBeGreaterThanOrEqual(10);
  expect(expected.was.errors).toBe(expected.was.observations);

  await openView(page, 'Train');
  await expect(page.locator('#train-heading')).toHaveText('Practice “th”');
  await expect(page.locator('#train-evidence')).toHaveText(`${expected.was.errors} of ${expected.was.observations} missed in 2 runs`);
  await page.locator('#start-drill').click();
  await expect(page.locator('#session-title')).toHaveText('Practice “th”');
  expect((await passageText(page)).split(' ').every((word) => word.includes('th'))).toBe(true);
  await finishDrill(page);
  await expect(page.locator('#condition-line')).toContainText('100 words');
  await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect(page.locator('#comparison-target-label')).toHaveText('th missed');
  await expect(page.locator('#comparison-target-was')).toHaveText(`was ${expected.was.errors} of ${expected.was.observations}`);
  await expect.poll(() => profile()?.loops?.at(-1)?.policy).toBe(DEFAULT_POLICY);
  expect(profile().loops.at(-1).target).toBe('th');
  expect(profile().loops.at(-1).recommendationKind).toBe('targeted');

  // Named for its misses, so Progress reads back its misses, as the comparison did, and not its clean intervals.
  const now = await page.locator('#comparison-target').textContent();
  await openView(page, 'Progress');
  await expect(page.locator('.history-conditions').first()).toContainText(`th missed ${now}, was ${expected.was.errors} of ${expected.was.observations}`);
  await expect(page.locator('.history-conditions').first()).not.toContainText('before');
});

// A seeded Math.random from `start`, so the passages are fixed.
const seedFrom = (start) => {
  let seed = start;
  Math.random = () => {
    seed = (seed * 16807) % 2147483647;

    return (seed - 1) / 2147483646;
  };
};

// The reproduction from the second TOB-419 check: "he" ranks first on four slow intervals, too few to name, and
// "th" below it is missed on most first tries. Train names "th", the highest-ranked unit it can name.
test('Train names the highest-ranked unit it can name when a thin slow pair ranks above it', async ({ page, supabase }) => {
  test.setTimeout(90_000);
  const user = supabase.addUser('learner-thin@stilltype.test');
  const profile = () => supabase.profileFor(user.email);
  await page.addInitScript(seedFrom, 7);
  await openApp(page);
  await signInWithEmail(page, user.email);
  await chooseWords(page, 100);

  // Every "th" missed on its second letter, and a 400 ms pause before the "e" of every "he" outside "the".
  const text = await passageText(page);
  await page.locator('#typing-input').focus();
  let from = 0;

  for (let at = 1; at < text.length; at += 1) {
    const th = text.slice(at - 1, at + 1) === 'th';
    const he = text.slice(at - 1, at + 1) === 'he' && text[at - 2] !== 't';

    if (!th && !he) continue;
    await page.keyboard.type(text.slice(from, at), { delay: 40 });

    if (th) {
      await page.keyboard.type('x');
      await page.keyboard.press('Backspace');
    } else await page.waitForTimeout(400);
    from = at;
  }

  await page.keyboard.type(text.slice(from), { delay: 40 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');

  await expect.poll(() => profile()?.runs?.length).toBe(1);
  const model = fitLearner(learnerEvidence(profile().runs, 'physical-keyboard:qwerty'), Date.now());
  const top = model.units[0];
  expect([top.unit, top.basis]).toEqual(['he', 'slow']);
  expect(top.observed.timed).toBeLessThan(10);
  const th = model.units.find((e) => e.unit === 'th').observed;
  expect(th.errors).toBeGreaterThan(0);
  expect(th.seen).toBeGreaterThanOrEqual(10);

  const named = `Practice “th”`;
  await expect(page.locator('#result-drill')).toHaveText('Drill “th”');
  await openView(page, 'Train');
  await expect(page.locator('#train-heading')).toHaveText(named);
  await expect(page.locator('#train-evidence')).toHaveText(`${th.errors} of ${th.seen} missed in 1 run`);
  await page.locator('#start-drill').click();
  await expect(page.locator('#session-title')).toHaveText(named);
});

// Types the passage cleanly at `pace` ms a key, with the second letter of every `pair` `pairMs` after the first.
// Playwright waits its delay after every key, the last included, so the pair's first letter goes on its own.
async function typePaced(page, pair, pace, pairMs) {
  const text = await passageText(page);
  await page.locator('#typing-input').focus();
  let from = 0;

  for (let at = text.indexOf(pair) + 1; at > 0; at = text.indexOf(pair, at) + 1) {
    await page.keyboard.type(text.slice(from, at - 1), { delay: pace });
    await page.keyboard.type(text[at - 1]);
    await page.waitForTimeout(pairMs);
    from = at;
  }

  await page.keyboard.type(text.slice(from), { delay: pace });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
}

// The reproduction from the second TOB-419 check, shortened: two runs at 60 ms a key with "th" 20 ms late, then
// one at 300 ms a key with "th" 200 ms early. "th" ranks on its slowness (its mean log ratio is above none) while
// its mean in ms, the figure the page prints, is near zero or faster (about −12 ms in Chromium, +1 in WebKit).
// The earlier rule named it "slower" either way; it is never named now.
test('a pair whose printed slowdown is not past the floor is never named for slowness', async ({ page, supabase }) => {
  test.setTimeout(150_000);
  const user = supabase.addUser('learner-faster@stilltype.test');
  const profile = () => supabase.profileFor(user.email);
  await page.addInitScript(seedFrom, 2026);
  await openApp(page);
  await signInWithEmail(page, user.email);

  for (const [words, pace, pairMs] of [[50, 60, 80], [50, 60, 80], [25, 300, 100]]) {
    if (await page.locator('#run-again').isVisible()) {
      await page.locator('#run-again').click();
      await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
    }

    await chooseWords(page, words);
    await typePaced(page, 'th', pace, pairMs);
  }

  await expect.poll(() => profile()?.runs?.length).toBe(3);
  const th = fitLearner(learnerEvidence(profile().runs, 'physical-keyboard:qwerty'), Date.now()).units.find((e) => e.unit === 'th');
  expect(th.basis).toBe('slow');
  expect(th.observed.timed).toBeGreaterThanOrEqual(10);
  expect(th.observed.slowRuns).toBe(2);
  expect(Math.round(th.observed.slowMs)).toBeLessThanOrEqual(SLOW_FLOOR_MS);

  await openView(page, 'Train');
  await expect(page.locator('#train-heading')).toHaveText('General drill');
  await expect(page.locator('#train-next')).not.toContainText(/-\d+ ms|\b0 ms slower/);
  await expect(page.locator('#train-evidence')).toBeHidden();
});

// The reproduction from the TOB-419 check: every miss on "h" is inside "th", so "h" is no weakness of its own.
test('a key missed only inside a named pair is never queued or offered as Next', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 100);

  for (let run = 0; run < 3; run += 1) {
    if (run) {
      await page.locator('#run-again').click();
      await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
    }

    await typeMissing(page, secondOfTh);
  }

  await openView(page, 'Train');
  await expect(page.locator('#train-heading')).toHaveText('Practice “th”');
  await page.locator('#start-drill').click();
  await finishDrill(page);
  await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect(page.locator('#comparison-target-label')).toHaveText('th missed');
  // The queue holds only "th", just drilled, so there is no Next: never "h".
  await expect(page.locator('#comparison-next')).toBeHidden();
  await expect(page.locator('#comparison-panel')).not.toContainText('“h”');
});

test('a key missed beyond its pairs is named, drilled and read back with its own counts', async ({ page, supabase }) => {
  const user = supabase.addUser('learner-key@stilltype.test');
  const profile = () => supabase.profileFor(user.email);
  await page.addInitScript(seedRandom);
  await openApp(page);
  await signInWithEmail(page, user.email);
  await chooseWords(page, 100);

  for (let run = 0; run < 2; run += 1) {
    await typeMissing(page, wordStartW);
    await page.locator('#run-again').click();
    await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  }

  await expect.poll(() => profile()?.runs?.length).toBe(2);
  // A miss at the start of a word is in no pair, so "w" is missed beyond every pair ending in it.
  const expected = learnerRecommendation(fitLearner(learnerEvidence(profile().runs, 'physical-keyboard:qwerty'), Date.now()));
  expect(expected.target).toBe('w');
  expect(expected.was.errors).toBeGreaterThan(0);

  await openView(page, 'Train');
  await expect(page.locator('#train-heading')).toHaveText('Practice “w”');
  await expect(page.locator('#train-evidence')).toHaveText(`${expected.was.errors} of ${expected.was.observations} missed in 2 runs`);
  await page.locator('#start-drill').click();
  await finishDrill(page);
  await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect(page.locator('#comparison-target-label')).toHaveText('w missed');
  await expect(page.locator('#comparison-target-was')).toHaveText(`was ${expected.was.errors} of ${expected.was.observations}`);
  await expect(page.locator('#comparison-target')).toHaveText(/^0 of [1-9]\d*$/);
  await expect(page.locator('#comparison-next')).not.toHaveText('Next: “w”');

  await expect.poll(() => profile()?.loops?.at(-1)?.targetMisses?.target).toBe('w');
  const loop = profile().loops.at(-1);
  expect(loop.targetTiming).toBeNull();
  expect(loop.targetMisses.was).toEqual({ errors: expected.was.errors, observations: expected.was.observations });
  const now = `${loop.targetMisses.now.errors} of ${loop.targetMisses.now.observations}`;
  await expect(page.locator('#comparison-target')).toHaveText(now);

  await openView(page, 'Progress');
  await expect(page.locator('.history-target').first()).toHaveText('“w” drill and retest');
  await expect(page.locator('.history-conditions').first()).toContainText(`w missed ${now}, was ${expected.was.errors} of ${expected.was.observations}`);
  await expect(page.locator('.history-conditions').first()).not.toContainText('before');
});

// Types the passage at a human pace, never missing, with a pause before the second letter of every `pair`.
async function typeSlowAt(page, pair, pauseMs) {
  const text = await passageText(page);
  await page.locator('#typing-input').focus();
  let from = 0;

  for (let at = text.indexOf(pair) + 1; at > 0; at = text.indexOf(pair, at) + 1) {
    await page.keyboard.type(text.slice(from, at), { delay: 40 });
    await page.waitForTimeout(pauseMs);
    from = at;
  }

  await page.keyboard.type(text.slice(from), { delay: 40 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
}

test('a pair typed slowly but never missed is named on its observed timing, drilled and read back', async ({ page, supabase }) => {
  test.setTimeout(120_000);
  const user = supabase.addUser('learner-slow@stilltype.test');
  const profile = () => supabase.profileFor(user.email);
  await page.addInitScript(seedRandom);
  await openApp(page);
  await signInWithEmail(page, user.email);
  await chooseWords(page, 100);

  for (let run = 0; run < 2; run += 1) {
    await typeSlowAt(page, 'th', 150);
    await page.locator('#run-again').click();
    await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  }

  await expect.poll(() => profile()?.runs?.length).toBe(2);
  const expected = learnerRecommendation(fitLearner(learnerEvidence(profile().runs, 'physical-keyboard:qwerty'), Date.now()));
  expect(expected.target).toBe('th');
  expect(expected.was).toMatchObject({ basis: 'slow', errors: 0, slowRuns: 2, timedRuns: 2 });
  expect(expected.was.timed).toBeGreaterThanOrEqual(10);
  expect(expected.was.slowMs).toBeGreaterThan(100);

  await openView(page, 'Train');
  await expect(page.locator('#train-heading')).toHaveText('Practice “th”');
  const pace = `${Math.round(expected.was.slowMs)} ms slower than your pace, in 2 of 2 runs that timed it (${expected.was.timed} clean intervals)`;
  await expect(page.locator('#train-evidence')).toHaveText(pace);
  await page.locator('#start-drill').click();
  expect((await passageText(page)).split(' ').every((word) => word.includes('th'))).toBe(true);
  await finishDrill(page);
  // The retest at an even human pace, so its intervals are timed and Train's "since you drilled it" line has both sides.
  await page.locator('#typing-input').focus();
  await page.keyboard.type(await passageText(page), { delay: 40 });
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect(page.locator('#comparison-target-label')).toHaveText('th pace');

  await expect.poll(() => profile()?.loops?.at(-1)?.targetPace?.target).toBe('th');
  const loop = profile().loops.at(-1);
  expect(loop.targetPace.was).toEqual({ slowMs: expected.was.slowMs, timed: expected.was.timed, timedRuns: 2, slowRuns: 2 });
  const now = paceShift(loop.targetPace.now.slowMs);
  const was = `${Math.round(expected.was.slowMs)} ms slower`;
  await expect(page.locator('#comparison-target')).toHaveText(now);
  await expect(page.locator('#comparison-target-was')).toHaveText(new RegExp(`^over \\d+ intervals?, was ${was} over ${expected.was.timed}$`));

  await openView(page, 'Progress');
  await expect(page.locator('.history-target').first()).toHaveText('“th” drill and retest');
  await expect(page.locator('.history-conditions').first()).toContainText(`th ${now} over`);
  await expect(page.locator('.history-conditions').first()).toContainText(`was ${was} over ${expected.was.timed}`);
  // Named for its slowness, so Progress reads back its pace and never its misses.
  await expect(page.locator('.history-conditions').first()).not.toContainText('missed');
  expect(loop.targetMisses).toBeNull();

  // Train's "since you drilled it" line reads the same figure, and says faster in words, never a negative.
  await openView(page, 'Train');
  await expect(page.locator('#train-last')).toHaveText(/^\d+ ms slower → (at your pace|\d+ ms (slower|faster) than your pace) since you drilled it$/);
});
