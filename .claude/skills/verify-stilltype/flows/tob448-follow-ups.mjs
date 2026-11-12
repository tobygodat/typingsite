// The visible follow-ups from the Train and Progress rebuilds (TOB-448), one shot each, so a run on master and on the
// branch line up as before and after: Train's since-line, a loop whose drill was interrupted on Train and in Progress's
// runs view, focus after a clear in another tab (overview and runs view), the small charts under forced colours, and
// the palette's ranking and its "progress" from a detail view. TOB448_ONLY=since (or loop, focus, runs-focus, forced,
// palette) runs one part.
import { englishFrequency } from '../../../../src/learner.js';
import { CORPUS_VERSION, METRIC_VERSION } from '../../../../src/typing.js';
import { history as progressHistory } from './progress-week.mjs';

const conditions = { mode: 'words', count: 10, punctuation: false, numbers: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };

const BACKGROUND = [...englishFrequency().pairs].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([pair]) => pair);
const at = (day) => `2026-11-${String(day).padStart(2, '0')}T12:00:00.000Z`;

const run = (id, day, rows) => ({ id, at: at(day), day: at(day).slice(0, 10), kind: 'test', status: 'complete', interrupted: false, fresh: true,
  conditions, textId: id, score: { wpm: 62, accuracy: 96 }, elapsedMs: 25_000, errors: 3, target: null, keys: [], keysVersion: 0, missedWords: [],
  patterns: [...BACKGROUND.filter((pair) => pair !== 'an' && !rows.some((row) => row[0] === pair)).map((pair) => [pair, 3, 0, 3, 200, 0]), ...rows] });

// "an" missed in four runs, drilled, then two runs with three tries of it each, one missed in each: the open step's
// since-line on two runs and six tries.
function sinceHistory() {
  const before = [1, 2, 3, 4].map((day) => run(`b${day}`, day, [['an', 8, 3, 8, 200, 0]]));
  const retest = run('retest', 5, []);
  const after = [6, 7].map((day) => run(`a${day}`, day, [['an', 3, 1, 3, 200, 0]]));
  const loop = { id: 'loop-an', at: retest.at, beforeAttemptId: null, afterAttemptId: retest.id, target: 'an', recommendationKind: 'targeted', targetBasis: 'errors',
    policy: 'learner-decay-timing@1', focus: 'balanced', drillCompleted: true, conditions, comparison: { comparable: true, state: 'improved', wpmDelta: 3, accuracyDelta: 1.5 },
    targetMisses: { target: 'an', was: { errors: 12, observations: 32 }, now: { errors: 0, observations: 0 } }, drill: { target: 'an', duration: 30, wordList: '200' } };

  return { version: 2, preferences: { mode: 'words', count: 10 }, attempts: [], runs: [...before, retest, ...after], loops: [loop], seenTextIds: [], bests: {},
    updatedAt: '2026-11-10T12:00:00Z' };
}

// Progress's week with a gain, and one more loop whose drill on "ex" was interrupted before its retest.
function interruptedHistory() {
  const profile = progressHistory('gain');
  const retest = profile.runs.at(-2);
  const loop = { ...profile.loops[0], id: 'loop-interrupted', at: retest.at, afterAttemptId: retest.id, target: 'ex', drillCompleted: false,
    drill: { target: 'ex', duration: 30, wordList: '1k' }, targetBasis: 'errors', targetMisses: { target: 'ex', was: { errors: 4, observations: 24 }, now: { errors: 0, observations: 14 } }, targetPace: null };

  return { ...profile, loops: [...profile.loops, loop] };
}

export default async ({ page, h, shot, note, fake, url }) => {
  const only = process.env.TOB448_ONLY;
  const part = (name) => !only || only === name;
  let account = 0;

  const signIn = async (data) => {
    account += 1;
    const email = `tob448-${account}@stilltype.test`;
    const user = fake.addUser(email);
    fake.profiles.set(user.id, { data });
    await h.openApp();
    await h.signIn(email);
  };

  // A second tab of the same account, which clears the history.
  const clearElsewhere = async () => {
    const other = await page.context().newPage();
    await fake.attach(other);
    await other.goto(url);
    await other.locator('#account[data-sync="synced"]').waitFor();

    return async () => {
      await other.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Progress' }).click();
      await other.locator('#clear-history').click();
      await other.locator('#confirm-clear-input').fill('clear');
      await other.locator('#confirm-clear').click();
      await page.locator('#clear-history[hidden]').waitFor({ state: 'attached' });
      await page.waitForTimeout(300);
      await other.close();
    };
  };

  const focused = () => page.evaluate(() => {
    const node = document.activeElement;

    return { id: node.id || node.tagName, text: node.textContent.trim().slice(0, 40), ring: getComputedStyle(node).outlineStyle, visible: node.checkVisibility() && !node.closest('.sr-only') && !node.matches('.sr-only') };
  });

  if (part('since')) {
    await signIn(sinceHistory());
    await h.openView('Train');
    await h.settle();
    note('since: open step', await h.text('#train-unit'));
    note('since: evidence', await h.text('#train-evidence'));
    note('since: since-line', await h.text('#train-last'));
    await page.locator('#train-current').evaluate((node) => node.scrollIntoView({ block: 'center' }));
    await shot('since-line');
  }

  if (part('loop')) {
    await signIn(interruptedHistory());
    await h.openView('Train');
    await h.settle();
    note('loop: Train status of ex', await page.locator('#train-path > li[data-unit="ex"] .path-status').textContent().catch(() => 'not behind'));
    await h.openView('Progress');
    await page.locator('[data-progress-open="runs"]').click();
    const row = page.locator('.history-row', { has: page.locator('.history-target', { hasText: /ex|Fresh-text check/ }) }).first();
    await row.locator('summary').click();
    await row.evaluate((node) => node.scrollIntoView({ block: 'center' }));
    note('loop: Progress row', await row.locator('.history-target').textContent());
    note('loop: Progress drill fact', await row.locator('.history-detail').textContent());
    await shot('interrupted-loop-runs');
  }

  if (part('focus')) {
    await signIn(progressHistory('gain'));
    await h.openView('Progress');
    const clear = await clearElsewhere();
    await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '7 days' }).focus();
    await page.keyboard.press('Shift');
    await shot('focus-before-clear');
    await clear();
    note('focus: after a clear in another tab', await focused());
    await shot('focus-after-clear');
  }

  if (part('runs-focus')) {
    await signIn(progressHistory('gain'));
    await h.openView('Progress');
    const clear = await clearElsewhere();
    await page.locator('[data-progress-open="runs"]').click();
    await page.locator('.conditions-disclosure > summary').click();
    await page.getByRole('group', { name: 'Test' }).getByRole('button').first().focus();
    await page.keyboard.press('Shift');
    await clear();
    note('runs-focus: after a clear in another tab', await focused());
    await shot('runs-focus-after-clear');
  }

  if (part('forced')) {
    await page.emulateMedia({ forcedColors: 'active' });
    await signIn(progressHistory('gain'));
    await h.openView('Progress');
    await h.settle();
    note('forced: small speed line stroke', await page.locator('#week-speed .trend-line').evaluate((node) => getComputedStyle(node).stroke));
    await page.locator('#week-charts').evaluate((node) => node.scrollIntoView({ block: 'center' }));
    await shot('forced-colours-overview');
    await page.locator('#week-speed button').click();
    await h.settle();
    await shot('forced-colours-full-chart');
    await page.emulateMedia({ forcedColors: 'none' });
  }

  if (part('palette')) {
    await signIn(progressHistory('gain'));
    await h.openView('Progress');
    await page.locator('[data-progress-open="runs"]').click();
    await page.keyboard.press('Control+k');
    await page.locator('#palette-input').fill('practice c');
    note('palette: top row for "practice c"', await h.text('#palette-list [aria-selected="true"] .opt-text'));
    await shot('palette-practice-c');
    await page.locator('#palette-input').fill('progress');
    await page.keyboard.press('Enter');
    await h.settle();
    note('palette: Progress after "progress" from the runs view', await page.locator('#progress-screen').getAttribute('data-detail'));
    await shot('palette-progress-from-runs');
  }
};
