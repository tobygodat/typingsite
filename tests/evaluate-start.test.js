import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, LEARNER_VARIANTS, START_MISSES_POLICY, START_PACE_POLICY, START_POLICY, START_RATE_POLICY } from '../src/learner.js';
import { BANDS, JUDGED, MEASURES, bandOf, bootstrap, capturedShare, judge, namedVersions, participantBands, replayParticipant, slicesOf, timeLost } from '../scripts/evaluate-start.mjs';
import { parseRow, sentenceRun } from '../scripts/keystrokes-to-runs.mjs';
import { seeded } from '../scripts/evaluate-learner.mjs';

const START = 1_473_275_372_000;
const STEP_MS = 120;
const SENTENCE = 'the then they them there';
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);

// A run of SENTENCE typed at an even pace, with "th" missed and corrected on its first `misses` words.
function typedRun(index, misses = 0) {
  const keys = [];
  let word = 0;

  for (const char of SENTENCE) {
    if (char === 'h' && word < misses) keys.push('j', 'BKSP');

    if (char === ' ') word += 1;
    keys.push(char);
  }

  const rows = keys.map((key, at) => {
    const press = START + index * 60_000 + at * STEP_MS;
    const code = key === 'BKSP' ? 8 : key === ' ' ? 32 : key.toUpperCase().charCodeAt(0);

    return parseRow(['7', String(index), SENTENCE, SENTENCE, at, press, press + 80, key, code].join('\t'));
  });

  return sentenceRun(rows).run;
}

test('each count of runs seen falls in one band, and fifteen runs fill them all', () => {
  assert.deepEqual(Array.from({ length: 15 }, (_, k) => BANDS[bandOf(k)].name),
    ['0', '1-2', '1-2', '3-5', '3-5', '3-5', '6-9', '6-9', '6-9', '6-9', '10-14', '10-14', '10-14', '10-14', '10-14']);
});

test('a missed pair loses two of the run’s intervals a miss, and a pair typed slower than the run loses the difference', () => {
  const run = { score: { wpm: 60 }, patterns: [['th', 5, 2, 0, null, null], ['he', 4, 0, 3, 250, 50], ['er', 2, 0, 2, 150, -50]], keys: [] };
  const lost = timeLost([run]);

  close(lost.get('th'), 2 * 2 * 200);
  close(lost.get('he'), 3 * 50);
  assert.equal(lost.has('er'), false);
});

test('a key loses only its misses outside the pairs that end in it', () => {
  const run = { score: { wpm: 60 }, patterns: [['th', 5, 1, 0, null, null]], keys: [['h', 6, 1], ['t', 6, 2]] };
  const lost = timeLost([run]);

  assert.equal(lost.has('h'), false);
  close(lost.get('t'), 2 * 2 * 200);
});

test('captured share is what the chosen units lost over what the best four lost', () => {
  const lost = new Map([['th', 400], ['he', 300], ['in', 200], ['er', 100], ['an', 50]]);

  close(capturedShare(['th', 'he', 'in', 'er'], lost), 1);
  close(capturedShare(['an', 'th'], lost), 450 / 1000);
  assert.equal(capturedShare([], lost), 0);
  assert.equal(capturedShare(['th'], new Map()), null);
});

test('a version is asked about each run from the runs before it only', () => {
  const runs = [typedRun(0, 3), typedRun(1, 3), typedRun(2, 0)];
  const rows = replayParticipant(runs, LEARNER_VARIANTS[DEFAULT_POLICY]);
  const shuffledFuture = replayParticipant([runs[0], runs[1], typedRun(2, 4)], LEARNER_VARIANTS[DEFAULT_POLICY]);

  assert.deepEqual(rows.map((row) => row.k), [0, 1, 2]);
  assert.deepEqual(rows[1].predictions.map((item) => item.p), shuffledFuture[1].predictions.map((item) => item.p));
});

test('a learner that has seen a pair missed predicts it missed more often than one that has seen nothing', () => {
  const rows = replayParticipant([typedRun(0, 4), typedRun(1, 4), typedRun(2, 4)], LEARNER_VARIANTS[DEFAULT_POLICY]);
  const predicted = (row) => row.predictions[0].p;

  assert.ok(predicted(rows[2]) > predicted(rows[0]), `${predicted(rows[2])} is not above ${predicted(rows[0])}`);
});

test('a participant’s rows are weighted by tries within a band, and an empty band is null', () => {
  const row = (k, loss, tries) => ({ k, loss, tries, predictions: [], paceError: 0, timed: 0, captured: null, named: null });
  const bands = participantBands([row(1, 2, 10), row(2, 4, 30)]);

  assert.equal(bands[0].logLoss, null);
  close(bands[1].logLoss, 6 / 40);
  assert.equal(bands[1].paceError, null);
  assert.equal(bands[1].captured, null);
});

test('the bootstrap interval holds the mean, leaves nulls out and repeats from its seed', () => {
  const values = [0.1, 0.2, null, 0.3, 0.4, 0.5];
  const first = bootstrap(values, seeded(513));

  assert.equal(first.n, 5);
  close(first.mean, 0.3);
  assert.ok(first.low < 0.3 && first.high > 0.3 && first.low >= 0.1 && first.high <= 0.5);
  assert.deepEqual(first, bootstrap(values, seeded(513)));
  assert.deepEqual(bootstrap([null], seeded(1)), { n: 0, mean: null, low: null, high: null });
});

const figure = (mean, half = 0.001) => ({ n: 100, mean, low: mean - half, high: mean + half });
const flat = (value) => BANDS.map(() => figure(value));

// A record of S0, the rate-only version and one judged version, whose differences from S0 are `less`.
function judged(less, lessRate, calibration = BANDS.map(() => 0.002)) {
  const measures = { logLoss: flat(0.15), paceError: flat(0.32), captured: flat(0.16), namedTopFour: flat(0.04) };
  const all = (overrides) => Object.fromEntries(MEASURES.map((measure) => [measure, overrides[measure] ?? flat(0)]));

  return { bands: BANDS.map((band) => band.name), versions: [{ name: 'S0', measures, calibration: BANDS.map(() => 0.002), against: {} },
    { name: START_POLICY, measures, calibration, against: { S0: all(less), [START_RATE_POLICY]: all(lessRate) } }] };
}

const passing = { logLoss: flat(-0.002), captured: flat(0.03) };

test('a version that predicts and ranks the first runs better, and beats the rate alone, holds every clause', () => {
  assert.deepEqual(judge(judged(passing, { logLoss: flat(-0.002) }), START_POLICY), { name: START_POLICY, a: true, a2: true, b: true, c: true, worse: [] });
});

test('clause (a) needs log loss better in both first bands, and reads pace error for the pace-only version', () => {
  const oneBand = { ...passing, logLoss: [figure(0), ...flat(-0.002).slice(1)] };

  assert.equal(judge(judged(oneBand, {}), START_POLICY).a, false);
  assert.equal(judge(judged({ ...oneBand, paceError: flat(-0.01) }, {}), START_POLICY, 'paceError').a, true);
});

test('clause (a2) fails when the version beats the rate alone on neither log loss nor captured share', () => {
  assert.equal(judge(judged(passing, {}), START_POLICY).a2, false);
  assert.equal(judge(judged(passing, { captured: flat(0.01) }), START_POLICY).a2, true);
});

test('clause (b) needs two points of captured share at the mean, not only an interval above zero', () => {
  assert.equal(judge(judged({ ...passing, captured: flat(0.015) }, {}), START_POLICY).b, false);
});

test('clause (c) fails only when a later band is worse past its margin', () => {
  const within = { ...passing, logLoss: [figure(-0.002), figure(-0.002), figure(0.0015), figure(0), figure(0)] };
  const past = { ...passing, logLoss: [figure(-0.002), figure(-0.002), figure(0.003), figure(0), figure(0)], captured: [figure(0.03), figure(0.03), figure(0), figure(-0.02), figure(0)] };

  assert.equal(judge(judged(within, {}), START_POLICY).c, true);
  assert.deepEqual(judge(judged(past, {}), START_POLICY).worse, ['logLoss in 3-5', 'captured in 6-9']);
  assert.deepEqual(judge(judged(passing, {}, [0.002, 0.002, 0.002, 0.002, 0.0045]), START_POLICY).worse, ['calibration in 10-14']);
});

test('the judged versions are the four ADR 0026 names, each scored under its own name beside S0', () => {
  assert.deepEqual(namedVersions(JUDGED).map((version) => version.name), ['S0', START_RATE_POLICY, START_POLICY, START_MISSES_POLICY, START_PACE_POLICY]);
  assert.throws(() => namedVersions(['learner-nothing@9']), /no learner version/);
});

test('a participant is sliced by native language and keyboard from the metadata', () => {
  const slices = slicesOf('PARTICIPANT_ID\tLAYOUT\tNATIVE_LANGUAGE\tKEYBOARD_TYPE\n7\tqwerty\ten\tfull\n9\tqwerty\tde\tlaptop');

  assert.deepEqual(slices.get('7'), ['native English', 'full keyboard']);
  assert.deepEqual(slices.get('9'), ['not native English', 'laptop keyboard']);
});
