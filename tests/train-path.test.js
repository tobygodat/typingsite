import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, FOCUSES, SLOW_FLOOR_MS, englishFrequency, keyboardOf, recommendFor } from '../src/learner.js';
import { AHEAD_STEPS, FIXED_OBSERVATIONS, FIXED_RUNS, aheadCopy, behindCopy, evidenceCopy, isFixed, sinceCopy, sinceDrilled, trainPath } from '../src/train-path.js';
import { CORPUS_VERSION, METRIC_VERSION } from '../src/typing.js';
import { mergeSynced } from '../src/account.js';
import { seeded } from '../scripts/evaluate-learner.mjs';
import { trainPath as trainPathBefore } from './train-path-reference.js';

const conditions = { mode: 'words', count: 25, punctuation: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };

const KEYBOARD = keyboardOf(conditions);
const NOW = Date.parse('2026-11-10T12:00:00Z');
const day = (n) => new Date(Date.parse('2026-10-01T12:00:00Z') + n * 3_600_000).toISOString();

// A stored run summary with pattern rows: [pair, tries, errors, timed intervals, median ms, ms over the run's median].
const summary = (id, at, patterns) => ({ id, at, kind: 'test', status: 'complete', interrupted: false, fresh: true, conditions, patterns, keys: [], keysVersion: 0 });
const BACKGROUND = [...englishFrequency().pairs].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([pair]) => pair);
const withBackground = (rows) => [...BACKGROUND.filter((pair) => !rows.some((row) => row[0] === pair)).map((pair) => [pair, 3, 0, 3, 200, 0]), ...rows];

// A saved loop on `target`, retested by run `after`, read back as the comparison saves it.
function loop(id, target, after, { basis = 'errors', was = { errors: 6, observations: 22 }, now = { errors: 1, observations: 9 }, pace = null } = {}) {
  return { id, at: after.at, afterAttemptId: after.id, beforeAttemptId: null, target, targetBasis: basis, conditions, comparison: { state: 'improved', comparable: true },
    targetMisses: basis === 'errors' ? { target, was, now } : null, targetPace: basis === 'slow' ? { target, ...pace } : null, recommendationKind: 'targeted' };
}

const recommend = (runs, loops, focus = 'balanced') => recommendFor(DEFAULT_POLICY, { runs, loops, traces: [], source: conditions, now: NOW, focus });
const pathFor = (runs, loops, focus = 'balanced', after = null) => trainPath({ recommendation: recommend(runs, loops, focus), loops, runs, keyboard: KEYBOARD, after });
const units = (steps) => steps.map((step) => step.unit);

// "an" missed on 3 of 8 tries and "er" on 2 of 8 in every run, "th" 90 ms slow, "in" and "ou" missed once in a while.
const history = () => Array.from({ length: 6 }, (_, i) => summary(`h${i}`, day(i), withBackground([
  ['th', 8, 0, 8, 290, 90], ['an', 8, 3, 8, 200, 0], ['er', 8, 2, 8, 200, 0], ['in', 10, i % 2, 10, 200, 0], ['ou', 10, i % 3 ? 0 : 1, 10, 200, 0]])));

test('the open step is the learner’s target and the steps ahead are the next three it queues, in its order', () => {
  const runs = history();

  for (const focus of FOCUSES) {
    const recommendation = recommend(runs, [], focus);
    const path = pathFor(runs, [], focus);
    assert.equal(path.current.unit, recommendation.target, focus);
    assert.equal(path.current.title, recommendation.title, focus);
    assert.deepEqual(path.current.was, recommendation.was, focus);
    assert.deepEqual(units(path.ahead), units(recommendation.queue.slice(1, 1 + AHEAD_STEPS)), focus);
    assert.deepEqual(path.ahead.map((step) => step.was), recommendation.queue.slice(1, 1 + AHEAD_STEPS).map((item) => item.was), focus);
    assert.deepEqual(path.behind, []);
    assert.equal(path.just, null);
  }

  assert.equal(pathFor(runs, []).ahead.length, Math.min(AHEAD_STEPS, recommend(runs, []).queue.length - 1));
});

test('with nothing named the open step is a general drill, stated plainly, with nothing ahead', () => {
  const path = pathFor([], []);
  assert.deepEqual(path.current, { kind: 'general', unit: null, title: 'General drill', was: null, since: null });
  assert.deepEqual(path.ahead, []);
  assert.deepEqual(path.behind, []);
});

test('drilled targets sit behind, newest nearest the open step, each once and never where the learner still shows it', () => {
  const runs = history();
  const queue = units(recommend(runs, []).queue);
  const later = [summary('r1', day(10), withBackground([])), summary('r2', day(11), withBackground([])), summary('r3', day(12), withBackground([]))];
  const all = [...runs, ...later];
  const loops = [loop('l1', 'qu', later[0]), loop('l2', 'ck', later[1]), loop('l3', 'qu', later[2]), loop('l4', queue[0], later[1])];
  const path = pathFor(all, loops);
  // "qu" twice: once, at its newest loop. The open target's own loop stays with it, as its "since you drilled it".
  assert.deepEqual(units(path.behind), ['ck', 'qu']);
  assert.equal(path.behind.at(-1).loopId, 'l3');
  assert.ok(!units(path.behind).includes(path.current.unit));
  assert.notEqual(path.current.since, null);
  // Another keyboard's loops are another path.
  const dvorak = { ...loop('l5', 'zz', later[2]), conditions: { ...conditions, layout: 'dvorak' } };
  assert.deepEqual(units(pathFor(all, [...loops, dvorak]).behind), ['ck', 'qu']);
});

test('while the comparison shows, the step just retested is behind you and the next queued one is open, as Next drills', () => {
  const runs = history();
  const recommendation = recommend(runs, []);
  const [first, second, ...rest] = units(recommendation.queue);
  const path = pathFor(runs, [], 'balanced', { trained: first });
  assert.deepEqual(path.just, { unit: first });
  assert.equal(path.current.unit, second);
  assert.deepEqual(units(path.ahead), rest.slice(0, AHEAD_STEPS));
  assert.ok(!units(path.behind).includes(first));

  // A general drill's retest: the queue's head is open.
  assert.equal(pathFor(runs, [], 'balanced', { trained: null }).current.unit, first);
  // Accuracy queues "an" and "er" here; with "an" just trained only "er" is left, and once that is trained too, a general drill.
  assert.equal(pathFor(runs, [], 'accuracy', { trained: 'an' }).current.unit, 'er');
  const only = recommend(runs, [], 'accuracy');
  const lone = trainPath({ recommendation: { ...only, queue: only.queue.slice(0, 1) }, loops: [], runs, keyboard: KEYBOARD, after: { trained: only.target } });
  assert.equal(lone.current.kind, 'general');
  assert.deepEqual(lone.ahead, []);
});

// Background pairs a person misses now and then, as real runs hold: one in ten of them once a run.
const noisy = (rows) => withBackground(rows).map((row, i) => (rows.some((own) => own[0] === row[0]) || i % 10 ? row : [row[0], 3, 1, 3, 200, 0]));

test('one retest makes a target drilled; it is fixed only once later runs hold 20 clean tries and the learner no longer queues it', () => {
  const before = summary('b0', day(0), noisy([['qu', 12, 2, 12, 200, 0]]));
  const retest = summary('t', day(2), noisy([['qu', 25, 0, 25, 200, 0]]));
  const drilled = [loop('l', 'qu', retest, { was: { errors: 2, observations: 12 }, now: { errors: 0, observations: 25 } })];
  const stepFor = (runs) => pathFor(runs, drilled, 'accuracy').behind.find((step) => step.unit === 'qu');

  // The retest alone, even 25 clean tries, is one run: drilled. The learner lets go of "qu" here, so it is behind.
  assert.equal(stepFor([before, retest]).state, 'drilled');
  assert.deepEqual(behindCopy(stepFor([before, retest])), ['2 of 12 → 0 of 25 missed']);

  // A clean run after it: two runs, 35 tries, no miss, and the learner doesn't queue it: fixed.
  const clean = summary('c', day(3), noisy([['qu', 10, 0, 10, 200, 0]]));
  const fixed = stepFor([before, retest, clean]);
  assert.equal(fixed.state, 'fixed');
  assert.deepEqual(behindCopy(fixed), ['2 of 12 → 0 of 25 missed', '0 of 35 missed since the drill']);

  // The same evidence, while the learner still queues it, or with one miss since, or under 20 tries: drilled.
  const since = sinceDrilled(drilled[0], [before, retest, clean]);
  assert.equal(isFixed(since, false), true);
  assert.equal(isFixed(since, true), false);
  assert.equal(isFixed({ ...since, after: { ...since.after, errors: 1 } }, false), false);
  assert.equal(isFixed({ ...since, after: { ...since.after, tries: 19 } }, false), false);
  assert.equal(isFixed({ ...since, after: { ...since.after, runs: 1 } }, false), false);
  assert.equal(stepFor([before, retest, summary('c', day(3), noisy([['qu', 10, 1, 10, 200, 0]]))]).state, 'drilled');
});

test('a fixed target the learner names again goes back to the open step or ahead, never behind as well', () => {
  const retest = summary('t', day(2), noisy([['he', 25, 0, 25, 200, 0]]));
  const runs = [summary('b0', day(0), noisy([['he', 12, 2, 12, 200, 0]])), retest, summary('c', day(3), noisy([['he', 10, 0, 10, 200, 0]]))];
  const loops = [loop('l', 'he', retest)];
  assert.equal(pathFor(runs, loops, 'accuracy').behind[0].state, 'fixed');

  // Missed again in three later runs: the learner names "he" first again.
  const relapse = [4, 5, 6].map((n) => summary(`x${n}`, day(n), noisy([['he', 12, 6, 12, 200, 0]])));
  const path = pathFor([...runs, ...relapse], loops, 'accuracy');
  assert.equal(path.current.unit, 'he');
  assert.deepEqual(path.behind, []);
  // As the open step it brings its own "since you drilled it" line: 2 of 12 before, 18 of 71 since, in counts as
  // every other line on the path states them (TOB-448).
  assert.equal(sinceCopy(path.current.since), '2 of 12 → 18 of 71 missed since you drilled it');
});

test('a pair drilled for its pace is fixed only on clean intervals at or under the naming floor, read back as pace', () => {
  const at = (id, n, ms) => summary(id, day(n), withBackground([['ck', 12, 0, 12, 200 + ms, ms]]));
  const retest = at('t', 1, 30);
  const loops = [loop('l', 'ck', retest, { basis: 'slow', pace: { was: { slowMs: 90, timed: 12, timedRuns: 1, slowRuns: 1 }, now: { slowMs: 30, timed: 12 } } })];
  const path = (runs) => pathFor(runs, loops, 'speed');

  // Still 50 ms slow across every run: the learner names it, so it is the open step.
  assert.equal(path([at('b', 0, 90), retest, at('c', 2, 30)]).current.unit, 'ck');
  // 30, −40 and −40 since: 17 ms faster on average, and the learner lets go: fixed.
  const fixed = path([at('b', 0, 90), retest, at('c', 2, -40), at('d', 3, -40)]).behind[0];
  assert.equal(fixed.state, 'fixed');
  assert.equal(fixed.basis, 'slow');
  assert.deepEqual(behindCopy(fixed), ['90 ms slower → 30 ms slower', '17 ms faster since the drill, over 36 intervals']);
  // Fast before, slow since: the learner never names it, yet the runs since are 30 ms slow: drilled.
  const fast = [at('b0', -3, -60), at('b1', -2, -60), at('b2', -1, -60)];
  const drilled = path([...fast, retest, at('c', 2, 30)]).behind[0];
  assert.equal(drilled.state, 'drilled');
  assert.deepEqual(behindCopy(drilled), ['90 ms slower → 30 ms slower', '30 ms slower since the drill, over 24 intervals']);
  assert.equal(SLOW_FLOOR_MS, 20);
  assert.equal(FIXED_RUNS, 2);
  assert.equal(FIXED_OBSERVATIONS, 20);
});

test('a run counts toward fixed only when it holds observations of the kind the target was drilled for', () => {
  // "wh" named at 100 ms slow, a retest with 24 clean intervals at pace, then a run that typed "wh" three times but timed
  // none of it (a typo beside the pair each time): one run of pace evidence since the drill, so drilled, not fixed.
  const named = summary('b', day(0), withBackground([['wh', 20, 0, 20, 300, 100]]));
  const retest = summary('t', day(1), withBackground([['wh', 24, 0, 24, 200, 0]]));
  const untimed = summary('u', day(2), withBackground([['wh', 3, 0, 0, null, null]]));
  const loops = [loop('l', 'wh', retest, { basis: 'slow', pace: { was: { slowMs: 100, timed: 20, timedRuns: 1, slowRuns: 1 }, now: { slowMs: 0, timed: 24 } } })];
  const runs = [named, retest, untimed];
  const step = pathFor(runs, loops, 'speed').behind.find((item) => item.unit === 'wh');
  assert.equal(step.state, 'drilled');
  assert.deepEqual(step.since.after, { runs: 1, intervals: 24, ms: 0 });
  assert.deepEqual(behindCopy(step), ['100 ms slower → at your pace']);
  // A second timed run makes it two runs of pace evidence: fixed.
  const timed = summary('v', day(3), withBackground([['wh', 4, 0, 4, 200, 0]]));
  assert.equal(pathFor([...runs, timed], loops, 'speed').behind.find((item) => item.unit === 'wh').state, 'fixed');

  // The same for misses: a run that holds the pair with no first try is no run of miss evidence.
  const missRetest = summary('mt', day(1), noisy([['qu', 25, 0, 25, 200, 0]]));
  const missLoops = [loop('ml', 'qu', missRetest, { was: { errors: 2, observations: 12 }, now: { errors: 0, observations: 25 } })];
  const missRuns = [summary('mb', day(0), noisy([['qu', 12, 2, 12, 200, 0]])), missRetest, summary('mu', day(2), noisy([['qu', 0, 0, 0, null, null]]))];
  assert.equal(sinceDrilled(missLoops[0], missRuns).after.runs, 1);
  assert.equal(pathFor(missRuns, missLoops, 'accuracy').behind.find((item) => item.unit === 'qu').state, 'drilled');
});

test('the open step’s since-line reads the kind of evidence the step is drawn for, not the kind its drill was for', () => {
  // "th" drilled for its misses, now named for its pace: the since-line reports pace, as the evidence beside it does.
  const retest = summary('t', day(3), withBackground([['th', 12, 0, 12, 290, 90]]));
  const runs = [...[0, 1, 2].map((n) => summary(`b${n}`, day(n), withBackground([['th', 12, 0, 12, 290, 90]]))), retest];
  const path = pathFor(runs, [loop('l', 'th', retest)], 'speed');
  assert.equal(path.current.unit, 'th');
  assert.equal(path.current.was.basis, 'slow');
  assert.equal(path.current.since.basis, 'slow');
  assert.equal(sinceCopy(path.current.since), '90 ms slower → 90 ms slower than your pace since you drilled it, over 12 intervals');
});

// A since-line never states a rate it can't support: "19% → 33%" from 2 of 6 tries read as a trend. It gives the
// counts on both sides, and for pace the clean intervals since, so a tiny sample reads as one (TOB-448).
test('the open step’s since-line gives its counts, however few', () => {
  assert.equal(sinceCopy({ basis: 'errors', before: { runs: 4, tries: 31, errors: 6 }, after: { runs: 1, tries: 6, errors: 2 } }),
    '6 of 31 → 2 of 6 missed since you drilled it');
  assert.equal(sinceCopy({ basis: 'errors', before: { runs: 4, tries: 31, errors: 6 }, after: { runs: 3, tries: 1, errors: 0 } }),
    '6 of 31 → 0 of 1 missed since you drilled it');
  assert.equal(sinceCopy({ basis: 'slow', before: { runs: 2, intervals: 30, ms: 80 }, after: { runs: 1, intervals: 1, ms: 5 } }),
    '80 ms slower → 5 ms slower than your pace since you drilled it, over 1 interval');
  assert.equal(sinceCopy({ basis: 'errors', before: null, after: { runs: 1, tries: 6, errors: 2 } }), '');
});

test('a loop saved before the read-back existed shows its before and since figures instead', () => {
  const retest = summary('t', day(2), noisy([['qu', 10, 1, 10, 200, 0]]));
  const runs = [summary('b0', day(0), noisy([['qu', 10, 4, 10, 200, 0]])), retest];
  const old = { ...loop('l', 'qu', retest), targetBasis: undefined, targetMisses: null };
  const step = trainPath({ recommendation: { queue: [], target: null }, loops: [old], runs, keyboard: KEYBOARD }).behind[0];
  assert.deepEqual(behindCopy(step), ['40% → 10% missed since the drill']);
});

// Whether a stored pattern row holds an observation of a kind: a clean interval measured against a pace of at least
// 30 ms (learnerEvidence's floor), or a first try.
const observes = (basis) => (row) => (basis === 'slow' ? row[3] > 0 && row[4] > 0 && row[4] - row[5] >= 30 : row[1] > 0);

// Random histories: runs at random paces with six pairs missed and slowed at random, and loops on those pairs and
// two others, retested by random runs, read back with random figures, faster ones included.
function randomHistory(random, round) {
  const pairs = ['th', 'he', 'in', 'er', 'an', 'ou'];

  const runs = Array.from({ length: 2 + Math.floor(random() * 8) }, (_, i) => {
    const pace = 40 + Math.floor(random() * 460);

    return summary(`m${round}-${i}`, day(i), withBackground([...pairs, 'qu', 'ck'].map((pair) => {
      const n = Math.floor(random() * 12);
      const ms = Math.max(1, Math.round(pace * Math.exp(random() * 1.4 - 0.6)));

      return [pair, n + Math.floor(random() * 3), random() < 0.15 ? Math.floor(random() * 3) : 0, n, n ? ms : null, n ? ms - pace : null];
    })).map((row) => ([...pairs, 'qu', 'ck'].includes(row[0]) ? row : [row[0], 3, 0, 3, pace, 0])));
  });

  const loops = Array.from({ length: Math.floor(random() * 6) }, (_, i) => {
    const target = [...pairs, 'qu', 'ck'][Math.floor(random() * 8)];
    const after = runs[Math.floor(random() * runs.length)];
    const basis = random() < 0.5 ? 'slow' : 'errors';
    const figure = () => Math.round(random() * 200 - 100);

    // A third of retests are long and clean: 24 first tries and clean intervals at the run's pace, enough on their own.
    if (random() < 1 / 3) {
      const pace = after.patterns.find((row) => row[1] === 3 && row[5] === 0)[4];
      after.patterns = after.patterns.map((row) => (row[0] === target ? [target, 24, 0, 24, pace, 0] : row));
    }

    return loop(`l${round}-${i}`, target, after, { basis, was: { errors: 3, observations: 12 }, now: { errors: Math.floor(random() * 3), observations: 8 },
      pace: { was: { slowMs: 25 + Math.abs(figure()), timed: 12, timedRuns: 2, slowRuns: 2 }, now: { slowMs: figure(), timed: 8 } } });
  });

  return { runs, loops };
}

test('across random histories in every focus, the path shows only what the person’s own typing supports', () => {
  const random = seeded(4200);
  let fixedSeen = 0;
  let behindSeen = 0;
  let withoutEvidence = 0;
  let shortOfEvidence = 0;
  let fixedOnOneRun = 0;

  for (let round = 0; round < 200; round += 1) {
    const { runs, loops } = randomHistory(random, round);

    for (const focus of FOCUSES) {
      const recommendation = recommend(runs, loops, focus);
      const queued = new Set(units(recommendation.queue));

      for (const after of [null, { trained: recommendation.target }]) {
        const path = trainPath({ recommendation, loops, runs, keyboard: KEYBOARD, after });
        const shown = [path.current.unit, ...units(path.ahead)].filter(Boolean);
        const where = `round ${round}, ${focus}${after ? ', after' : ''}`;

        // No target is behind and still open or ahead, and each step is one target.
        assert.ok(units(path.behind).every((unit) => !shown.includes(unit) && unit !== path.just?.unit), `${where}: a target behind and ahead`);
        assert.equal(new Set(units(path.behind)).size, path.behind.length, `${where}: a target twice behind`);
        assert.equal(new Set(shown).size, shown.length, `${where}: a target twice ahead`);
        assert.ok(path.ahead.length <= AHEAD_STEPS);

        if (path.current.kind === 'general') assert.deepEqual(path.ahead, [], `${where}: steps ahead of a general drill`);

        // Open and ahead steps carry the learner's observed evidence, of the kind it named them on.
        for (const { unit, was } of [path.current, ...path.ahead].filter((step) => step.unit)) {
          const copy = [aheadCopy(was), evidenceCopy(was), evidenceCopy(was, { all: true })];

          if (focus === 'speed' || was.basis === 'slow') {
            assert.equal(was.basis, 'slow', `${where}: speed showed “${unit}” on misses`);
            assert.ok(Math.round(was.slowMs) > SLOW_FLOOR_MS, `${where}: “${unit}” shown at ${was.slowMs} ms`);
            assert.match(aheadCopy(was), /^\d+ ms slower$/);
            assert.ok(copy.every((line) => !line.includes('missed')), `${where}: “${unit}” named on pace reads misses`);
          } else {
            assert.ok(was.errors > 0 && was.observations >= 10, `${where}: “${unit}” shown without a miss`);
            assert.ok(copy.every((line) => !/\bms\b/.test(line)), `${where}: “${unit}” named on misses reads pace`);
          }
        }

        for (const step of path.behind) {
          behindSeen += 1;
          const lines = [...behindCopy(step), sinceCopy(step.since)];

          // Read back as what it was drilled for, and never a zero or negative amount as slower.
          assert.ok(lines.every((line) => !/-\d|\b0 ms slower/.test(line)), `${where}: ${lines}`);

          if (step.basis === 'slow') assert.ok(lines.every((line) => !line.includes('missed')), `${where}: “${step.unit}” drilled for pace reads misses`);
          else assert.ok(lines.every((line) => !/\bms\b/.test(line)), `${where}: “${step.unit}” drilled for misses reads pace`);

          // The runs since its retest, counted here straight from the pattern rows.
          const drilled = loops.filter((item) => item.target === step.unit).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : 1)).at(-1);
          const split = Date.parse(runs.find((run) => run.id === drilled.afterAttemptId).at);
          const rows = runs.filter((run) => Date.parse(run.at) >= split).map((run) => run.patterns.find((row) => row[0] === step.unit)).filter(Boolean);
          const unobserved = rows.filter((row) => !observes(step.basis)(row)).length;

          if (unobserved) withoutEvidence += 1;

          // Enough runs hold the pair, too few hold its evidence: the case a count of every run would have let through.
          if (rows.length >= FIXED_RUNS && rows.length - unobserved < FIXED_RUNS) shortOfEvidence += 1;

          // ...and of those, one whose one run of evidence alone holds 20 clean observations and that the learner lets go.
          const enough = step.since.after && (step.basis === 'slow' ? step.since.after.intervals >= FIXED_OBSERVATIONS && Math.round(step.since.after.ms) <= SLOW_FLOOR_MS
            : step.since.after.tries >= FIXED_OBSERVATIONS && step.since.after.errors === 0);

          if (rows.length >= FIXED_RUNS && rows.length - unobserved < FIXED_RUNS && enough && !queued.has(step.unit)) fixedOnOneRun += 1;

          if (step.state !== 'fixed') continue;
          fixedSeen += 1;
          // Fixed only under the rule.
          const observed = rows.filter(observes(step.basis));
          assert.ok(!queued.has(step.unit), `${where}: “${step.unit}” fixed while queued`);
          assert.ok(observed.length >= FIXED_RUNS, `${where}: “${step.unit}” fixed on ${observed.length} run of its evidence`);

          if (step.basis === 'slow') {
            const intervals = observed.reduce((sum, row) => sum + row[3], 0);
            assert.ok(intervals >= FIXED_OBSERVATIONS, `${where}: “${step.unit}” fixed on ${intervals} intervals`);
            assert.ok(Math.round(observed.reduce((sum, row) => sum + row[3] * row[5], 0) / intervals) <= SLOW_FLOOR_MS);
          } else {
            assert.ok(observed.reduce((sum, row) => sum + row[1], 0) >= FIXED_OBSERVATIONS, `${where}: “${step.unit}” fixed on few tries`);
            assert.equal(observed.reduce((sum, row) => sum + Math.min(row[1], row[2]), 0), 0, `${where}: “${step.unit}” fixed with a miss`);
          }
        }
      }
    }
  }

  assert.ok(behindSeen > 200, `the generator puts steps behind (${behindSeen})`);
  assert.ok(fixedSeen > 5, `the generator fixes some (${fixedSeen})`);
  // The generator types a drilled pair, after its retest, in runs that hold none of the evidence it was drilled for.
  assert.ok(withoutEvidence > 20, `the generator types drilled pairs without their evidence (${withoutEvidence})`);
  assert.ok(shortOfEvidence > 5, `the generator holds a pair in two runs since but its evidence in one (${shortOfEvidence})`);
  assert.ok(fixedOnOneRun > 5, `the generator lets one run of evidence hold enough to fix it (${fixedOnOneRun})`);
});

test('the path is the same whatever order the history arrives in, and after either merge of two devices’ copies', () => {
  const random = seeded(77);

  const shuffled = (items) => {
    const copy = [...items];

    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
  };

  for (let round = 0; round < 40; round += 1) {
    const { runs, loops } = randomHistory(random, round);

    for (const focus of FOCUSES) {
      const expected = pathFor(runs, loops, focus);
      assert.deepEqual(pathFor(shuffled(runs), shuffled(loops), focus), expected, `round ${round}: shuffled`);

      const base = { version: 2, profileId: 'p', preferences: {}, attempts: [], seenTextIds: [], bests: {} };
      const local = { ...base, runs: runs.slice(0, Math.ceil(runs.length / 2) + 1), loops: loops.slice(0, 3) };
      const cloud = { ...base, runs: runs.slice(Math.floor(runs.length / 2)), loops: loops.slice(2) };
      const [one, other] = [mergeSynced(local, cloud), mergeSynced(cloud, local)];
      assert.deepEqual(pathFor(one.runs, one.loops, focus), expected, `round ${round}: merged local into cloud`);
      assert.deepEqual(pathFor(other.runs, other.loops, focus), expected, `round ${round}: merged cloud into local`);
    }
  }
});

// trainPath reads the runs and the evidence once, not once per loop (TOB-448). Its output is the same as the
// version that rescanned every run per loop (tests/train-path-reference.js), over random histories wider than the
// ones above: several keyboards, duplicate run ids and pattern rows, undated and drill runs, loops with and without
// a retest among the runs, loops with no target, saved twice, and out of date order.
test('the one-pass path is the same as the path that rescanned every run per loop', () => {
  const random = seeded(448);
  const pick = (items) => items[Math.floor(random() * items.length)];
  const keyboards = [conditions, { ...conditions, layout: 'dvorak' }, { ...conditions, inputClass: 'touch' }];
  const pairs = ['th', 'an', 'er', 'in', 'ou', 'qu', 'ck', 'he', 're', 'on'];
  let behindSeen = 0;
  let fixedSeen = 0;
  let sinceSeen = 0;

  for (let round = 0; round < 150; round += 1) {
    const count = Math.floor(random() * 80);

    const runs = Array.from({ length: count }, (_, i) => {
      const rows = pairs.flatMap((pair) => {
        if (random() >= 0.6) return [];
        const tries = Math.floor(random() * 14);
        const timed = random() < 0.7 ? Math.floor(random() * (tries + 1)) : 0;
        const slow = Math.round((random() - 0.3) * 120);

        return [[pair, tries, random() < 0.6 ? 0 : Math.floor(random() * 4), timed, 200 + slow, slow]];
      });

      // A pattern row twice in one run, and a run id twice in the history.
      if (rows.length && random() < 0.1) rows.push([...rows[0].slice(0, 1), 9, 0, 9, 200, 0]);
      const id = random() < 0.08 && i ? `r${Math.floor(random() * i)}` : `r${i}`;
      const at = random() < 0.05 ? null : day(Math.floor(random() * 200));

      return { ...summary(id, at, withBackground(rows)), conditions: pick(keyboards), kind: random() < 0.1 ? 'drill' : 'test' };
    });

    const loops = Array.from({ length: Math.floor(random() * 30) }, (_, i) => {
      const retest = runs.length && random() < 0.8 ? pick(runs) : { id: `missing-${i}`, at: day(Math.floor(random() * 200)) };
      const target = random() < 0.1 ? null : random() < 0.15 ? pick(['e', 't', 'n']) : pick(pairs);
      const basis = random() < 0.4 ? 'slow' : 'errors';

      const made = loop(`l${i}`, target, { id: retest.id, at: retest.at || day(Math.floor(random() * 200)) }, { basis,
        pace: { was: { slowMs: 60, timed: 12, timedRuns: 2, slowRuns: 2 }, now: { slowMs: 10, timed: 8 } } });

      made.conditions = random() < 0.85 ? conditions : pick(keyboards);

      // A loop saved before targetBasis existed.
      if (random() < 0.2) delete made.targetBasis;

      return made;
    });

    // A loop saved twice, and the list out of date order.
    if (loops.length && random() < 0.3) loops.push({ ...loops[0] });
    loops.sort(() => random() - 0.5);

    for (const focus of FOCUSES) {
      const recommendation = recommend(runs, loops, focus);

      for (const keyboard of [KEYBOARD, keyboardOf(keyboards[1])]) {
        for (const after of [null, { trained: recommendation.target }, { trained: null }]) {
          const args = { recommendation, loops, runs, keyboard, after };
          const path = trainPath(args);
          assert.deepEqual(path, trainPathBefore(args), `round ${round}, ${focus}, ${keyboard}`);
          behindSeen += path.behind.length;
          fixedSeen += path.behind.filter((step) => step.state === 'fixed').length;
          sinceSeen += path.current.since ? 1 : 0;
        }
      }
    }
  }

  assert.ok(behindSeen > 500, `the generator puts steps behind (${behindSeen})`);
  assert.ok(fixedSeen > 10, `the generator fixes some (${fixedSeen})`);
  assert.ok(sinceSeen > 50, `the generator gives the open step a since line (${sinceSeen})`);
});
