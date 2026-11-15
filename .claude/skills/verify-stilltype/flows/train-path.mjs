// Train's path (TOB-420), drawn as a queue (TOB-470). A new guest's queue, then an account whose history another
// device synced: six runs that miss "an" and "er" and slow "th", and four earlier drills ("qu" and "ck" fixed since,
// "ol" and "wh" drilled). Shots: the queue, a pace-named target (speed focus), a step ahead chosen and drilled,
// mid-drill and the comparison. Run with --delay 40. train-instrument.mjs shoots every state of the layout.
import { englishFrequency } from '../../../../src/learner.js';
import { CORPUS_VERSION, METRIC_VERSION } from '../../../../src/typing.js';

const conditions = { mode: 'words', count: 10, punctuation: false, numbers: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };

const BACKGROUND = [...englishFrequency().pairs].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([pair]) => pair);
const at = (day) => `2026-11-${String(day).padStart(2, '0')}T12:00:00.000Z`;

// The pairs a history names are typed only in the runs that name them; every other pair is clean at the run's pace.
const NAMED = ['th', 'an', 'er', 'in', 'ou'];

const run = (id, day, rows, missedWords = []) => ({ id, at: at(day), day: at(day).slice(0, 10), kind: 'test', status: 'complete', interrupted: false, fresh: true,
  conditions, textId: id, score: { wpm: 62, accuracy: 96 }, elapsedMs: 25_000, errors: 3, target: null, keys: [], keysVersion: 0, missedWords,
  patterns: [...BACKGROUND.filter((pair) => !NAMED.includes(pair) && !rows.some((row) => row[0] === pair)).map((pair) => [pair, 3, 0, 3, 200, 0]), ...rows] });

const loop = (id, target, after, extra) => ({ id, at: after.at, beforeAttemptId: null, afterAttemptId: after.id, target, recommendationKind: 'targeted',
  policy: 'learner-decay-timing@1', focus: 'balanced', drillCompleted: true, conditions, comparison: { comparable: true, state: 'improved', wpmDelta: 3, accuracyDelta: 1.5 },
  targetTiming: null, targetMisses: null, targetPace: null, drill: { target, duration: 30, wordList: '200' }, ...extra });

export function history() {
  const drilled = { qu: [['qu', 12, 0, 12, 200, 0]], ck: [['ck', 12, 0, 12, 180, -20]], ol: [['ol', 10, 1, 10, 200, 0]], wh: [['wh', 10, 0, 10, 260, 60]] };
  const retests = Object.entries(drilled).map(([unit, rows], i) => run(`retest-${unit}`, 1 + i, rows));
  const after = [5, 6].map((day) => run(`after-${day}`, day, [['qu', 12, 0, 12, 200, 0], ['ck', 12, 0, 12, 190, -10]]));
  const runs = Array.from({ length: 6 }, (_, i) => run(`run-${i}`, 5 + i, [['th', 8, 0, 8, 290, 90], ['an', 8, 3, 8, 200, 0], ['er', 8, 2, 8, 200, 0],
    ['in', 10, i % 2, 10, 200, 0], ['ou', 10, i % 3 ? 0 : 1, 10, 200, 0]], ['another', 'than', 'and', 'other', 'every', 'there']));
  const loops = [
    loop('loop-qu', 'qu', retests[0], { targetBasis: 'errors', targetMisses: { target: 'qu', was: { errors: 6, observations: 22 }, now: { errors: 0, observations: 12 } } }),
    loop('loop-ck', 'ck', retests[1], { targetBasis: 'slow', targetPace: { target: 'ck', was: { slowMs: 70, timed: 24, timedRuns: 2, slowRuns: 2 }, now: { slowMs: -20, timed: 12 } } }),
    loop('loop-ol', 'ol', retests[2], { targetBasis: 'errors', targetMisses: { target: 'ol', was: { errors: 5, observations: 21 }, now: { errors: 1, observations: 10 } } }),
    loop('loop-wh', 'wh', retests[3], { targetBasis: 'slow', targetPace: { target: 'wh', was: { slowMs: 110, timed: 20, timedRuns: 2, slowRuns: 2 }, now: { slowMs: 60, timed: 10 } } }),
  ];

  return { version: 2, preferences: { mode: 'words', count: 10 }, attempts: [], runs: [...retests, ...after, ...runs], loops, seenTextIds: [], bests: {},
    updatedAt: '2026-11-10T12:00:00Z' };
}

export default async ({ page, h, shot, note, check, fake }) => {
  const palette = async (label) => {
    await page.keyboard.press('Control+k');
    await page.locator('#palette-input').fill(label);
    await page.locator('#palette-list [role="option"]', { hasText: label }).first().click();
  };

  const steps = async () => page.locator('.queue-step').evaluateAll((items) => items.map((item) => `${item.dataset.unit ?? item.dataset.key} ${item.className.replace('queue-step ', '')}`));

  await h.openApp();
  await h.openView('Train');
  await h.settle();
  note('guest queue', JSON.stringify(await steps()));
  check((await h.text('#train-heading')) === 'General drill', 'a new guest is offered the general drill');
  check(await page.locator('#start-drill').isVisible(), 'the general drill can be started');
  await shot('guest');

  const user = fake.addUser('path@stilltype.test');
  fake.profiles.set(user.id, { data: history() });
  await h.signIn('path@stilltype.test');
  await h.attr('#account', 'data-sync', 'synced');
  // A run on this device: the baseline the drill's retest is measured against.
  await h.openView('Practice');
  await h.chooseWords(10);
  await h.type(await h.passage());
  await h.attr('body', 'data-view', 'results');
  await h.openView('Train');
  await h.settle();
  note('queue', JSON.stringify(await steps()));
  note('open', await h.text('#train-heading'));
  check((await page.locator('#train-drilled .is-fixed').count()) >= 1, 'a target is fixed');
  check((await page.locator('#train-path .is-ahead').count()) === 3, 'three steps ahead');
  await shot('history');

  await palette('train focus · speed');
  await h.settle();
  note('speed', await h.text('#train-heading'));
  check(await page.locator('#train-words').isHidden(), 'a pace-named target lists no words');
  await shot('pace');
  await palette('train focus · balanced');
  await palette('drill length · 15 seconds');
  await h.settle();

  // A step ahead, chosen, then drilled from its detail.
  const chosen = page.locator('#train-path .is-ahead').first();
  const unit = await chosen.getAttribute('data-unit');
  await chosen.locator('.q-row').hover();
  await shot('ahead-hover');
  await chosen.locator('.q-row').click();
  await page.locator('#start-drill').click();
  await h.attr('#typing-screen', 'data-session', 'drill');
  check((await h.text('#session-title')) === `Practice “${unit}”`, 'the step chosen is the drill');
  await page.locator('#typing-input').focus();
  await page.keyboard.type((await h.passage()).slice(0, 12), { delay: 60 });
  await shot('mid-drill');
  await page.waitForTimeout(15_500);
  await h.attr('#typing-screen', 'data-session', 'retest');
  await h.type(await h.passage());
  await h.attr('body', 'data-view', 'train');
  await h.settle();
  note('after', JSON.stringify(await steps()));
  check(await page.locator('#comparison-panel').isVisible(), 'the comparison shows');
  check((await page.locator('#comparison-unit').textContent()) === unit, 'the step just drilled is the comparison');
  await shot('comparison');
  await page.keyboard.press('Tab');
  note('tab after comparison', await page.evaluate(() => document.activeElement.id || document.activeElement.className));
};
