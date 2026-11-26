import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, LEARNER_VARIANTS, START_MISSES_POLICY, START_PACE_POLICY, START_POLICY, START_RATE_POLICY } from '../src/learner.js';
import { BANDS, GUARD_MEASURES, PROFILE_BANDS, PROFILE_VERSIONS, evaluateRuns, profileReport, JUDGED, MEASURES, SIZE_LIMIT_BYTES, bandOf, bootstrap, capturedShare, cost, guardReport, judge, namedVersions, participantBands, replayParticipant, slicesOf,
  timeLost } from '../scripts/evaluate-start.mjs';
import { parseRow, sentenceRun } from '../scripts/keystrokes-to-runs.mjs';
import { calibration, evaluateProfile, seeded } from '../scripts/evaluate-learner.mjs';

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

test('the cost check times every version on the same history and reads the shipped table’s size', () => {
  const costs = cost([START_POLICY]);

  assert.ok(costs.gzipBytes > 0 && costs.gzipBytes <= SIZE_LIMIT_BYTES);
  assert.ok(costs.defaultMs > 0);
  assert.deepEqual(costs.versions.map((version) => version.name), [START_POLICY]);
});

test('the guard report says which versions hold clause (d) and clause (e)', () => {
  const figure = { mean: 2, low: 1.2, high: 2.8 };
  const measures = Object.fromEntries(GUARD_MEASURES.map((measure) => [measure, figure]));

  const text = guardReport({ guard: [{ name: START_POLICY, worlds: { slow: measures }, d: false }],
    cost: { gzipBytes: 3282, defaultMs: 15, versions: [{ name: START_POLICY, ms: 15.1, e: true }] } });

  assert.match(text, /learner-start@3: \(d\) fails/);
  assert.match(text, /\+2\.000 \[1\.200, 2\.800\]/);
  assert.match(text, /learner-start@3: 15\.10 ms, \(e\) holds/);
});

const profileRuns = Array.from({ length: 13 }, (_, index) => typedRun(index, index % 3 === 0 ? 3 : 0));
const profileOf = (runs) => ({ version: 2, runs });

test("a profile is scored on its eligible runs, oldest first, by the same replay and measures as a participant's", async () => {
  const shuffled = [8, 2, 11, 0, 5, 12, 1, 9, 3, 7, 10, 4, 6].map((at) => profileRuns[at]);
  const profile = await evaluateProfile(profileOf(shuffled), {});
  assert.equal(profile.runs, 13);
  assert.equal(profile.keyboard, 'physical-keyboard:qwerty');
  assert.deepEqual(profile.versions.map((version) => version.name), PROFILE_VERSIONS);
  assert.deepEqual(profile.versions, evaluateRuns(profileRuns, profile.keyboard));

  for (const { name, overall } of profile.versions) {
    const rows = replayParticipant(profileRuns, LEARNER_VARIANTS[name]);
    const [all] = participantBands(rows, [{ name: 'all', from: 0, to: Infinity }]);
    assert.equal(overall.runs, 13);
    close(overall.logLoss, all.logLoss);
    close(overall.paceError, all.paceError);
    close(overall.captured, all.captured);
    close(overall.calibration, calibration(rows.flatMap((row) => row.predictions)));
  }
});

test('a profile reads its bands as 0, 1-2, 3-5, 6-9 and 10 or more, and every run falls in one', async () => {
  const { versions } = await evaluateProfile(profileOf(profileRuns), {});

  for (const { bands, overall } of versions) {
    assert.deepEqual(bands.map((band) => band.band), ['0', '1-2', '3-5', '6-9', '10+']);
    assert.deepEqual(bands.map((band) => band.runs), [1, 2, 3, 4, 3]);
    assert.equal(bands.reduce((sum, band) => sum + band.runs, 0), overall.runs);
  }

  assert.equal(PROFILE_BANDS.length, 5);
});

test("a profile's start-view versions differ from the default only where a start view can act", async () => {
  const { versions } = await evaluateProfile(profileOf(profileRuns), {});
  const byName = Object.fromEntries(versions.map((version) => [version.name, version]));

  assert.notEqual(byName[START_RATE_POLICY].bands[0].logLoss, byName[DEFAULT_POLICY].bands[0].logLoss);
  assert.ok(Object.values(byName).every(({ overall }) => Number.isFinite(overall.logLoss) && overall.calibration >= 0));
});

test('a profile with no eligible runs, or an unknown version, is reported plainly', async () => {
  assert.deepEqual((await evaluateProfile(profileOf([]), {})).versions, []);
  assert.throws(() => evaluateRuns(profileRuns, 'physical-keyboard:qwerty', ['learner-nope@1']), /no learner version named/);
});

test('the profile report shows the four measures per version, overall and per band', async () => {
  const text = profileReport((await evaluateProfile(profileOf(profileRuns), {})).versions);

  for (const name of PROFILE_VERSIONS) assert.ok(text.includes(`${name}\n| runs seen | predicted runs | log loss | calibration | pace error | captured |`));

  for (const band of ['all', '0', '1-2', '3-5', '6-9', '10+']) assert.ok(text.includes(`| ${band} | `));
});
