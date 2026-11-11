import { makeDrill } from '../src/typing.js';
import { LEARNER_POLICY, fitLearner, learnerEvidence, learnerRecommendation } from '../src/learner.js';
import { test, expect, openApp, passageText, chooseWords, completePassage, finishDrill, openView, signInWithEmail } from './fixtures.js';

// Types the passage with a wrong first try on the second letter of every "th", then the right letter.
async function typeMissingTh(page) {
  const text = await passageText(page);
  await page.locator('#typing-input').focus();
  let from = 0;

  for (let at = text.indexOf('th') + 1; at > 0; at = text.indexOf('th', at) + 1) {
    await page.keyboard.type(text.slice(from, at));
    await page.keyboard.type('x');
    await page.keyboard.press('Backspace');
    from = at;
  }

  await page.keyboard.type(text.slice(from));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');

  return text;
}

test('a brand-new guest gets a general drill that leans toward the units the prior ranks highest', async ({ page }) => {
  await openApp(page);
  await openView(page, 'Train');
  await expect(page.locator('#train-heading')).toHaveText('General drill');
  await expect(page.locator('#train-evidence')).toBeHidden();
  await page.locator('#start-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#session-title')).toHaveText('General drill');

  // With no history the model is its hand-set prior alone, the same on every device.
  const { lean } = learnerRecommendation(fitLearner([], Date.now(), 'qwerty'));
  expect(lean.length).toBeGreaterThan(0);
  const drill = await passageText(page);
  expect(drill).toBe(makeDrill(null, '200', lean).text);
  expect(drill).not.toBe(makeDrill(null, '200').text);
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
    await typeMissingTh(page);
    await page.locator('#run-again').click();
    await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  }

  await expect.poll(() => profile()?.runs?.length).toBe(2);
  // What the learner makes of exactly these runs, worked out here from the saved summaries.
  const expected = learnerRecommendation(fitLearner(learnerEvidence(profile().runs, 'physical-keyboard:qwerty'), Date.now(), 'qwerty'));
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
  await expect.poll(() => profile()?.loops?.at(-1)?.policy).toBe(LEARNER_POLICY);
  expect(profile().loops.at(-1).target).toBe('th');
  expect(profile().loops.at(-1).recommendationKind).toBe('targeted');
});
