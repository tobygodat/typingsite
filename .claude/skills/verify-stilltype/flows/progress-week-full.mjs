// Progress on a full history (TOB-420): 1,000 runs over 120 days, the newest 120 with pattern counts, and 200 drills.
// Times the dock's Progress click, which draws the whole page before it returns, and the layout after it; ten times,
// going to Practice in between. run.json notes each time and their median.
import { englishFrequency } from '../../../../src/learner.js';
import { CORPUS_VERSION, METRIC_VERSION } from '../../../../src/typing.js';

const conditions = { mode: 'words', count: 25, punctuation: false, numbers: false, wordList: '1k', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };
const PAIRS = [...englishFrequency().pairs].sort((a, b) => b[1] - a[1]).slice(0, 120).map(([pair]) => pair);
const KEYS = 'abcdefghijklmnopqrstuvwxyz';

export function fullHistory() {
  const now = Date.now();
  const runs = Array.from({ length: 1000 }, (_, i) => {
    const at = new Date(now - (1000 - i) * 120 * 86_400_000 / 1000);
    const patterned = i >= 880;

    return { id: `full-${i}`, at: at.toISOString(), day: `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`,
      kind: 'test', status: 'complete', interrupted: false, fresh: true, conditions, textId: `full-${i}`, score: { wpm: 60 + (i % 23), accuracy: 93 + (i % 7) },
      elapsedMs: 22_000, errors: 2, target: null, keysVersion: patterned ? 1 : 0,
      keys: patterned ? [...KEYS].map((key, k) => [key, 20, (i + k) % 9 ? 0 : 1]) : [],
      patterns: patterned ? PAIRS.map((pair, p) => [pair, 6, (i + p) % 11 ? 0 : 1, 6, 200 + ((i + p) % 7) * 10, ((i + p) % 7) * 10 - 20]) : [] };
  });
  const loops = Array.from({ length: 200 }, (_, i) => {
    const after = runs[800 + i];

    return { id: `loop-${i}`, at: after.at, beforeAttemptId: null, afterAttemptId: after.id, target: PAIRS[i % 40], recommendationKind: 'targeted', targetBasis: 'errors',
      policy: 'learner-decay-timing@1', focus: 'balanced', drillCompleted: true, conditions, comparison: { comparable: true, state: 'improved', wpmDelta: 1, accuracyDelta: 0.5 },
      targetMisses: { target: PAIRS[i % 40], was: { errors: 3, observations: 20 }, now: { errors: 1, observations: 18 } }, targetPace: null, targetTiming: null,
      drill: { target: PAIRS[i % 40], duration: 30, wordList: '1k' } };
  });

  return { version: 2, preferences: { mode: 'words', count: 25, wordList: '1k' }, attempts: [], runs, loops, seenTextIds: [], bests: {}, updatedAt: new Date().toISOString() };
}

export default async ({ page, h, shot, note, check, fake }) => {
  const user = fake.addUser('full@stilltype.test');
  fake.profiles.set(user.id, { data: fullHistory() });
  await h.openApp();
  await h.signIn('full@stilltype.test');
  await h.attr('#account', 'data-sync', 'synced');
  const times = [];

  for (let i = 0; i < 10; i += 1) {
    await h.openView('Practice');
    times.push(await page.evaluate(() => {
      const start = performance.now();
      document.querySelector('[data-nav="progress"]').click();
      const drawn = performance.now();
      void document.documentElement.offsetHeight;

      return { render: Math.round(drawn - start), layout: Math.round(performance.now() - drawn) };
    }));
  }

  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  note('progress open (ms)', JSON.stringify(times));
  note('median render + layout (ms)', `${median(times.map((t) => t.render))} + ${median(times.map((t) => t.layout))}`);
  check(await page.locator('#week-lead').isVisible(), 'the lead shows');
  await h.settle();
  await shot('full');
};
