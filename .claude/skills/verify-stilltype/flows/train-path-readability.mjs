// Train's path, read closely (TOB-420): the status word on each step behind you, a long before → after figure in a
// narrow column, many steps behind with the start of the line fading, a pair drilled for its pace that one later run
// typed but never timed (still "drilled"), and the path under forced colours beside the same path without.
import { englishFrequency } from '../../../../src/learner.js';
import { CORPUS_VERSION, METRIC_VERSION } from '../../../../src/typing.js';
import { history } from './train-path.mjs';

const conditions = { mode: 'words', count: 10, punctuation: false, numbers: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };

const BACKGROUND = [...englishFrequency().pairs].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([pair]) => pair);
const at = (day) => `2026-11-${String(day).padStart(2, '0')}T12:00:00.000Z`;

const run = (id, day, rows) => ({ id, at: at(day), day: at(day).slice(0, 10), kind: 'test', status: 'complete', interrupted: false, fresh: true,
  conditions, textId: id, score: { wpm: 62, accuracy: 96 }, elapsedMs: 25_000, errors: 0, target: null, keys: [], keysVersion: 0, missedWords: [],
  patterns: [...BACKGROUND.filter((pair) => !rows.some((row) => row[0] === pair)).map((pair) => [pair, 3, 0, 3, 200, 0]), ...rows] });

const loop = (id, target, after, extra) => ({ id, at: after.at, beforeAttemptId: null, afterAttemptId: after.id, target, recommendationKind: 'targeted',
  policy: 'learner-decay-timing@1', focus: 'speed', drillCompleted: true, conditions, comparison: { comparable: true, state: 'improved', wpmDelta: 3, accuracyDelta: 1.5 },
  targetTiming: null, targetMisses: null, targetPace: null, drill: { target, duration: 30, wordList: '200' }, ...extra });

// The checker's case: "wh" named at 100 ms slow, a retest with 24 clean intervals at pace, then a run that typed "wh"
// three times with a typo beside it each time, so none of it was timed.
function untimed() {
  const retest = run('retest-wh', 2, [['wh', 24, 0, 24, 200, 0]]);
  const runs = [run('slow-wh', 1, [['wh', 20, 0, 20, 300, 100]]), retest, run('typo-wh', 3, [['wh', 3, 0, 0, null, null]])];
  const loops = [loop('loop-wh', 'wh', retest, { targetBasis: 'slow', targetPace: { target: 'wh', was: { slowMs: 100, timed: 20, timedRuns: 1, slowRuns: 1 }, now: { slowMs: 0, timed: 24 } } })];

  return { version: 2, preferences: { mode: 'words', count: 10, trainFocus: 'speed' }, attempts: [], runs, loops, seenTextIds: [], bests: {}, updatedAt: '2026-11-10T12:00:00Z' };
}

// Ten drills behind you: the synced history's four and six more, each retested clean.
function long() {
  const data = history();
  const more = ['sp', 'ly', 'ge', 'bo', 'pr', 'gr'].map((unit, i) => [unit, run(`retest-${unit}`, 1 + (i % 4), [[unit, 12, 0, 12, 200, 0]])]);
  data.runs.push(...more.map(([, retest]) => retest));
  data.loops.push(...more.map(([unit, retest]) => loop(`loop-${unit}`, unit, retest, { focus: 'balanced', targetBasis: 'errors',
    targetMisses: { target: unit, was: { errors: 5, observations: 20 }, now: { errors: 0, observations: 12 } } })));

  return data;
}

export default async ({ page, h, shot, note, check, fake }) => {
  const wide = page.viewportSize().width > 900;
  const account = async (email, data) => {
    const user = fake.addUser(email);
    fake.profiles.set(user.id, { data });
    await h.openApp();
    await h.signIn(email);
    await h.attr('#account', 'data-sync', 'synced');
    await h.openView('Train');
    await h.settle();
  };

  const behind = () => page.locator('#train-path > .is-behind:not(#comparison-panel)').evaluateAll((items) => items.map((item) => ({
    unit: item.querySelector('.path-unit').firstChild.textContent,
    status: item.querySelector('.path-status')?.textContent,
    lines: [...item.querySelectorAll('.path-line')].map((line) => ({ text: line.textContent, rows: Math.round(line.getBoundingClientRect().height / parseFloat(getComputedStyle(line).lineHeight)) })),
  })));

  await account('path-read@stilltype.test', history());
  const steps = await behind();
  note('behind', JSON.stringify(steps));
  check(steps.every((step) => step.status === (step.unit === 'qu' || step.unit === 'ck' ? 'fixed' : 'drilled')), 'each step behind you says drilled or fixed in a word');
  // "ck" reads back "70 ms slower → 20 ms faster": in a column it wraps only between its halves.
  const ck = steps.find((step) => step.unit === 'ck');
  const halves = await page.locator('#train-path > [data-unit="ck"] .path-line').first().evaluate((line) => [...line.querySelectorAll('.path-figure')].map((figure) => figure.getClientRects().length));
  check(halves.every((rects) => rects === 1), `each half of “${ck.lines[0].text}” stays on one line`);
  note('ck read-back rows', String(ck.lines[0].rows));
  // Lines in neighbouring columns keep a gutter between them.
  if (wide) {
    const gap = await page.locator('#train-path > .is-behind:not([hidden])').evaluateAll((items) => items.slice(0, -1).map((item, i) => {
      const right = Math.max(...[...item.querySelectorAll('.path-line, .path-unit')].map((node) => node.getBoundingClientRect().right));

      return items[i + 1].getBoundingClientRect().left - right;
    }));
    note('gutters', JSON.stringify(gap.map(Math.round)));
    check(gap.every((space) => space >= 16), 'a 16px gutter at least between columns');
  }
  await shot('status');

  // Forced colours: the same path in system colours, beside the shot above.
  await page.emulateMedia({ forcedColors: 'active' });
  await h.settle();
  await shot('forced');
  await page.emulateMedia({ forcedColors: 'none' });

  // Ten steps behind you: the line opens at its end and the start fades, as more lies behind it.
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await account('path-long@stilltype.test', long());
  if (wide) {
    check(await page.locator('#train-path').evaluate((list) => list.hasAttribute('data-more-behind')), 'the start of the line fades while steps lie behind it');
    check(!(await page.locator('#train-path').evaluate((list) => list.hasAttribute('data-more-ahead'))), 'the end does not fade at the end');
  }
  await shot('long');
  if (wide) {
    await page.locator('#train-path').evaluate((list) => { list.scrollLeft = list.scrollWidth / 2; });
    await h.settle();
    check(await page.locator('#train-path').evaluate((list) => list.hasAttribute('data-more-behind') && list.hasAttribute('data-more-ahead')), 'scrolled halfway, both edges fade');
    await shot('long-middle');
  }

  // The checker's "wh": drilled, since only one run since its drill timed it.
  await page.evaluate(() => localStorage.clear());
  await account('path-wh@stilltype.test', untimed());
  const wh = (await behind()).find((step) => step.unit === 'wh');
  note('wh', JSON.stringify(wh));
  check(wh?.status === 'drilled', '“wh” reads drilled: its retest is its only run of timed evidence');
  await shot('wh');
};
