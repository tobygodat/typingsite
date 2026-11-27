import test from 'node:test';
import assert from 'node:assert/strict';
import { BASELINE_POLICY, DEFAULT_POLICY, basisOf, keyboardOf, recommendFor } from '../src/learner.js';
import { basisOf as pathBasisOf, sinceCopy, trainPath } from '../src/train-path.js';
import { analysisLoops } from '../src/domain-history.js';
import { CORPUS_VERSION, METRIC_VERSION } from '../src/typing.js';

const conditions = { mode: 'words', count: 25, punctuation: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };

const day = (n) => new Date(Date.parse('2026-10-01T12:00:00Z') + n * 3_600_000).toISOString();
const summary = (id, at, patterns) => ({ id, at, kind: 'test', status: 'complete', interrupted: false, fresh: true, conditions, patterns, keys: [], keysVersion: 0 });

// A loop drilled for slowness whose retest timed none of the pair: it saves no pace.
const slowLoop = { id: 'l', at: day(3), afterAttemptId: 't', beforeAttemptId: null, target: 'th', targetBasis: 'slow', conditions,
  comparison: { state: 'improved', comparable: true }, targetMisses: null, targetPace: null, recommendationKind: 'targeted' };

test('a loop drilled for slowness stays slow when its retest timed none of the pair', () => {
  assert.equal(basisOf(slowLoop), 'slow');
  assert.equal(pathBasisOf(slowLoop), 'slow');
  // Only a loop saved before targetBasis existed reads its basis from the saved pace.
  assert.equal(basisOf({ ...slowLoop, targetBasis: undefined }), 'errors');
  assert.equal(analysisLoops([JSON.parse(JSON.stringify(slowLoop))]).length, 1, 'targetBasis and a null pace survive storage');

  const runs = [summary('b0', day(0), [['th', 8, 3, 8, 290, 90]]), summary('t', day(3), [['th', 8, 0, 0, 0, 0]]), summary('a1', day(4), [['th', 8, 0, 8, 290, 90]])];
  const step = trainPath({ recommendation: { queue: [], target: null }, loops: [slowLoop], runs, keyboard: keyboardOf(conditions) }).behind[0];
  assert.equal(step.basis, 'slow');
  assert.equal(step.retest, null);
  assert.match(sinceCopy(step.since), /slower/);
  assert.doesNotMatch(sinceCopy(step.since), /missed/);
});

// loops = [] has been recommendFor's default since e4f3679 (TOB-419); the app always passes loops. Without them
// the counting rule has no drills to skip and returns what it returns with an empty list.
test('recommendFor reads a missing loops key as no loops, for every policy', () => {
  const runs = [0, 1, 2].map((n) => summary(`r${n}`, day(n), [['th', 8, 3, 8, 200, 0]]));

  for (const policy of [BASELINE_POLICY, DEFAULT_POLICY]) {
    const args = { runs, traces: [], source: conditions, now: Date.parse('2026-11-10T12:00:00Z') };
    assert.deepEqual(recommendFor(policy, args), recommendFor(policy, { ...args, loops: [] }), policy);
  }
});
