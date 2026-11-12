// How often Train reads a drilled target as "fixed" (isFixed in src/train-path.js) when the drill fixed it and when it
// did nothing, under the rule as written and under a per-run floor (TOB-448). The rule asks for two runs since the
// retest that hold the target's evidence, 20 observations between them and none missed (or a mean slowdown of 20 ms
// or less), with the learner no longer queuing it. A per-run floor counts only runs that hold at least `floor`
// observations each toward the two. Deterministic from its seeds; it measures, and changes nothing.
//
//   node scripts/measure-fixed-floor.mjs [--seeds 12] [--json out.json] [--workers 12]
//
// The world is ADR 0019's season (scripts/evaluate-let-go.mjs): the app's own passages, typed by simulated typists,
// scored and summarized by the app's own code, fitted by the shipped learner on the newest 120 runs. Each typist has a
// planted weak pair in each frequency stratum (common, middle, rare) and a slow pair. After run 19 every planted unit
// the learner queues is drilled, read for what it was queued for; run 20 is its retest. Then, after every run up to 80
// runs past the retest, Train's state is read under each rule. Worlds:
//   fixed      the drill fixes every planted unit from the retest on
//   unchanged  the drill does nothing
//   warm       the retest alone is typed as if fixed (a drill's short-lived lift), every run after it as before
// Like ADR 0019's season it says nothing about whether anyone learns: a typist improves only because the world says so.

import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_POLICY, LEARNER_VARIANTS, SLOW_FLOOR_MS, fitLearner, learnerEvidence, learnerRecommendation } from '../src/learner.js';
import { FIXED_OBSERVATIONS, FIXED_RUNS, isFixed } from '../src/train-path.js';
import { KEYBOARD, SKILLS, START, makeTypist, seeded, typeRun } from './evaluate-learner.mjs';

const DAY_MS = 86_400_000;

export const MEASURE = {
  drill: 20,
  after: 80,
  kept: 120,
  words: [10, 25, 100],
  perDay: 5,
  worlds: ['fixed', 'unchanged', 'warm'],
  floors: [1, 3, 5, 10],
  horizons: [2, 5, 10, 20, 40, 80],
  typists: 2,
};

const STREAM = 23_000_000;
const CELLS = MEASURE.words.flatMap((words) => SKILLS.map((skill) => ({ words, skill: skill.name }))).map((cell, index) => ({ ...cell, index }));

// The rule with a per-run floor: only runs holding at least `floor` observations of the kind count toward FIXED_RUNS.
// A floor of 1 is the rule as written, which isFixed itself decides (checked against it on every read).
function fixedWithFloor(perRun, basis, queued, floor) {
  if (queued) return false;
  const counted = perRun.filter((run) => run.n >= floor).length;
  const n = perRun.reduce((sum, run) => sum + run.n, 0);

  if (counted < FIXED_RUNS || n < FIXED_OBSERVATIONS) return false;

  if (basis === 'slow') return Math.round(perRun.reduce((sum, run) => sum + run.n * run.ms, 0) / n) <= SLOW_FLOOR_MS;

  return perRun.every((run) => run.errors === 0);
}

function season(seed, cell, i, world) {
  const key = (seed * CELLS.length + cell.index) * MEASURE.typists + i;
  const random = seeded(STREAM + key);
  const skill = SKILLS.find((s) => s.name === cell.skill);
  const typist = makeTypist(random, i % 2 ? 'unrelated' : 'mechanics', skill, i, { errorPairsAtPace: true });
  const { drill, after, kept } = MEASURE;
  const total = drill + after + 1;
  const planted = [...typist.planted];

  for (const unit of planted) {
    if (world === 'unchanged') continue;
    unit.until = drill;

    if (world === 'warm') typist.planted.push({ ...unit, from: drill + 1, until: Infinity });
  }

  const runs = Array.from({ length: total }, (_, r) => {
    const at = START + Math.floor(r / MEASURE.perDay) * DAY_MS + (r % MEASURE.perDay) * ((14 * 3_600_000) / MEASURE.perDay);

    return typeRun(typist, random, r, `${key}-${r}`, { count: cell.words, at }).run;
  });

  const fit = (t) => {
    const prefix = runs.slice(Math.max(0, t - kept), t);
    const records = learnerEvidence(prefix, KEYBOARD);
    const queue = learnerRecommendation(fitLearner(records, Date.parse(prefix.at(-1).at) + 60_000, LEARNER_VARIANTS[DEFAULT_POLICY], 'balanced')).queue;

    return { records, queue };
  };

  const before = fit(drill).queue;
  const retest = runs[drill];
  const split = Date.parse(retest.at);

  const targets = planted.flatMap((unit) => {
    const queued = before.find((item) => item.unit === unit.pair);

    return queued ? [{ unit: unit.pair, stratum: unit.stratum, basis: queued.was.basis === 'slow' ? 'slow' : 'errors', first: {} }] : [];
  });

  for (let t = drill + 1; t <= total; t += 1) {
    const { records, queue } = fit(t);
    const queued = new Set(queue.map((item) => item.unit));

    for (const target of targets) {
      const since = records.filter((record) => record.at >= split).map((record) => record.units.find((item) => item.unit === target.unit))
        .filter((item) => item && (target.basis === 'slow' ? item.timed > 0 : item.seen > 0))
        .map((item) => (target.basis === 'slow' ? { n: item.timed, ms: item.slowMs } : { n: item.seen, errors: item.errors }));

      for (const floor of MEASURE.floors) {
        const read = fixedWithFloor(since, target.basis, queued.has(target.unit), floor);

        if (floor === 1) {
          const tally = target.basis === 'slow'
            ? { runs: since.length, intervals: since.reduce((s, r) => s + r.n, 0), ms: since.reduce((s, r) => s + r.n * r.ms, 0) / since.reduce((s, r) => s + r.n, 0) }
            : { runs: since.length, tries: since.reduce((s, r) => s + r.n, 0), errors: since.reduce((s, r) => s + r.errors, 0) };

          if (read !== isFixed({ basis: target.basis, before: null, after: since.length ? tally : null }, queued.has(target.unit))) throw new Error('floor 1 is not the written rule');
        }

        if (read && target.first[floor] === undefined) target.first[floor] = t - drill;
      }
    }
  }

  return targets.map(({ unit, stratum, basis, first }) => ({ seed, words: cell.words, skill: cell.skill, world, unit, stratum, basis, first }));
}

export function task({ seed, cell }) {
  return MEASURE.worlds.flatMap((world) => Array.from({ length: MEASURE.typists }, (_, i) => season(seed, CELLS[cell], i, world)).flat());
}

if (!isMainThread) parentPort.on('message', ({ id, job }) => parentPort.postMessage({ id, result: task(job) }));

async function runAll(seeds, workers) {
  const jobs = seeds.flatMap((seed) => CELLS.map((cell) => ({ seed, cell: cell.index })));
  const results = new Array(jobs.length);
  const pool = Array.from({ length: Math.min(workers, jobs.length) }, () => new Worker(fileURLToPath(import.meta.url)));
  let next = 0;

  await Promise.all(pool.map((worker) => new Promise((resolve, reject) => {
    const give = () => {
      if (next >= jobs.length) {
        worker.terminate();
        resolve();

        return;
      }

      const id = next;
      next += 1;
      worker.once('message', (message) => {
        results[message.id] = message.result;
        give();
      });
      worker.postMessage({ id, job: jobs[id] });
    };

    worker.on('error', reject);
    give();
  })));

  return results.flat();
}

// Share of targets reading fixed within each horizon, and, for the fixed world, the median runs to the first read.
function summarize(rows) {
  const groups = new Map();

  for (const row of rows) {
    const kind = row.basis === 'slow' ? 'slow' : row.stratum;

    for (const label of [`${row.world} · all`, `${row.world} · ${kind}`, `${row.world} · ${row.words} words`, `${row.world} · ${kind} · ${row.words} words`]) {
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(row);
    }
  }

  return [...groups].sort(([a], [b]) => (a < b ? -1 : 1)).map(([label, group]) => ({
    label, targets: group.length,
    floors: Object.fromEntries(MEASURE.floors.map((floor) => {
      const firsts = group.map((row) => row.first[floor]).filter((v) => v !== undefined).sort((a, b) => a - b);

      return [floor, { within: Object.fromEntries(MEASURE.horizons.map((h) => [h, firsts.filter((v) => v <= h).length / group.length])),
        median: firsts.length ? firsts[Math.floor((firsts.length - 1) / 2)] : null }];
    })),
  }));
}

if (isMainThread && process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => {
    const at = process.argv.indexOf(`--${name}`);

    return at < 0 ? fallback : process.argv[at + 1];
  };

  const seeds = Array.from({ length: Number(arg('seeds', 12)) }, (_, i) => 501 + i);
  const started = Date.now();
  const rows = await runAll(seeds, Number(arg('workers', 12)));
  const summary = summarize(rows);
  const pct = (v) => `${(v * 100).toFixed(1)}%`.padStart(6);

  console.log(`${rows.length} drilled targets, ${seeds.length} seeds, ${((Date.now() - started) / 1000).toFixed(0)} s`);
  console.log(`share reading "fixed" within ${MEASURE.horizons.join(' / ')} runs since the retest; median runs to the first read\n`);

  for (const { label, targets, floors } of summary) {
    console.log(`${label} (${targets})`);

    for (const floor of MEASURE.floors) {
      const { within, median } = floors[floor];
      console.log(`  ${floor === 1 ? 'rule as written ' : `floor ${String(floor).padEnd(2)} per run`}  ${MEASURE.horizons.map((h) => pct(within[h])).join(' ')}   median ${median ?? '—'}`);
    }
  }

  const out = arg('json', null);

  if (out) writeFileSync(out, `${JSON.stringify({ measure: MEASURE, seeds, summary }, null, 2)}\n`);
}
