import { makeDrill } from '../src/typing.js';
import { DEFAULT_POLICY, fitLearner, learnerEvidence, learnerRecommendation } from '../src/learner.js';
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
  await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect(page.locator('#comparison-target-label')).toHaveText('th pace');

  await expect.poll(() => profile()?.loops?.at(-1)?.targetPace?.target).toBe('th');
  const loop = profile().loops.at(-1);
  expect(loop.targetPace.was).toEqual({ slowMs: expected.was.slowMs, timed: expected.was.timed, timedRuns: 2, slowRuns: 2 });
  const now = `${Math.abs(loop.targetPace.now.slowMs)} ms ${loop.targetPace.now.slowMs < 0 ? 'faster' : 'slower'}`;
  const was = `${Math.round(expected.was.slowMs)} ms slower`;
  await expect(page.locator('#comparison-target')).toHaveText(now);
  await expect(page.locator('#comparison-target-was')).toHaveText(new RegExp(`^over \\d+ intervals?, was ${was} over ${expected.was.timed}$`));

  await openView(page, 'Progress');
  await expect(page.locator('.history-target').first()).toHaveText('“th” drill and retest');
  await expect(page.locator('.history-conditions').first()).toContainText(`th ${now} over`);
  await expect(page.locator('.history-conditions').first()).toContainText(`was ${was} over ${expected.was.timed}`);
});
