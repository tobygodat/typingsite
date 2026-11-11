// ADR 0017's decision rule: learner-let-go@2, which lets a drilled target go on the evidence since its drill, against
// the shipped learner-decay-timing@1. Deterministic from its seeds: the work is split across worker threads by seed and
// cell, and every result is put back in seed and cell order before anything is summed.
//
//   npm run evaluate:learner -- --rule 0017 [--json out.json] [--workers 12]
//   npm run evaluate:learner -- --rule 0017 --validation-only
//
// Two simulators. The guard world is ADR 0015's, with drills saved at run 20, scored on ADR 0015's measures. The season
// is months of practice, light and heavy, careful and careless, with and without bad days, in which a drill fixes a
// target, does nothing, half works, or works and later wears off. It says nothing about whether anyone learns faster:
// a simulated typist gets better after a drill only because the season says so.

import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DECAY_TIMING_POLICY, DEFAULT_POLICY, LET_GO, LET_GO_MISSES_POLICY, LET_GO_POLICY, LEARNER_VARIANTS, drillSplit, drilledTargets, fitLearner, learnerEvidence,
  learnerRecommendation, letGo, letGoIndex, recommendFor } from '../src/learner.js';
import { trainPath } from '../src/train-path.js';
import { CONDITIONS, KEYBOARD, MEASURES, RULE_0015, RUN_MS, SHIPPED, SKILLS, START, VALIDATION_SEEDS, fixed, learnerPolicy, makeTypist, mean, median, paired, percent,
  score, seeded, signed, simulate, table, typeRun } from './evaluate-learner.mjs';

const DAY_MS = 86_400_000;

export const RULE_0017 = {
  testSeeds: Array.from({ length: 30 }, (_, i) => 301 + i),
  weakRatio: [3, 4, 6, 8],
  slowShare: [0.75, 0.85, 0.95],
  returnOdds: [1e3, 1e4, 1e5],
  // The drill is between runs 19 and 20; run 20 is its retest.
  drill: 20,
  regress: 80,
  runs: 160,
  kept: 120,
  words: [10, 25, 100],
  perDay: [1, 5, 15],
  badDays: [false, true],
  badDayChance: 0.2,
  badDayShift: 0.7,
  typists: 2,
  worlds: ['fixed', 'unchanged', 'halved', 'regress'],
  validationCeiling: { letGo: 0.01, return: 0.025 },
  ceilings: { letGo: 0.02, return: 0.05 },
  targets: { errors: 10, slow: 15 },
};

const KINDS = ['errors', 'slow'];
const NEVER = RULE_0017.runs - RULE_0017.drill + 1;
const NEVER_AGAIN = RULE_0017.runs - RULE_0017.regress + 1;

export const CELLS = RULE_0017.words.flatMap((words) => RULE_0017.perDay.flatMap((perDay) => RULE_0017.badDays.flatMap((badDays) => SKILLS.map((skill) => ({ words, perDay, badDays, skill: skill.name })))))
  .map((cell, index) => ({ ...cell, index }));

const SEASON_STREAM = 17_000_000;

// The policy each name runs, at its constants.
const shippedPolicy = { name: 'shipped', policy: DECAY_TIMING_POLICY, constants: SHIPPED };
const letGoConstants = (k) => ({ ...SHIPPED, letGoOdds: LET_GO.letGoOdds, ...k });
const candidate = (name, k, policy = LET_GO_POLICY) => ({ name, policy, constants: letGoConstants(k) });

// One typist's season in one world: 160 runs, the drill of its planted error pair and planted slow pair after run 19,
// and what each policy queues, and Train reads as fixed, after every run from the retest on.
function season(seed, cell, i, world, policies) {
  const key = (seed * CELLS.length + cell.index) * RULE_0017.typists + i;
  const random = seeded(SEASON_STREAM + key);
  const skill = SKILLS.find((s) => s.name === cell.skill);
  const typist = makeTypist(random, i % 2 ? 'unrelated' : 'mechanics', skill, i, { errorPairsAtPace: true });
  const error = typist.planted.find((p) => p.stratum === (seeded(2 * SEASON_STREAM + key)() < 0.5 ? 'common' : 'middle'));
  const slow = typist.planted.find((p) => p.stratum === 'slow');
  const { drill, regress, runs: total, kept } = RULE_0017;

  for (const planted of [error, slow]) {
    if (world === 'unchanged') continue;
    planted.until = drill;

    if (world === 'halved') typist.planted.push({ ...planted, from: drill, until: Infinity, error: planted.error / 2, slow: planted.slow / 2 });

    if (world === 'regress') typist.planted.push({ ...planted, from: regress, until: Infinity });
  }

  const days = seeded(3 * SEASON_STREAM + key);
  const bad = Array.from({ length: Math.ceil(total / cell.perDay) }, () => cell.badDays && days() < RULE_0017.badDayChance);

  const runs = Array.from({ length: total }, (_, r) => {
    const day = Math.floor(r / cell.perDay);
    const at = START + day * DAY_MS + (r % cell.perDay) * ((14 * 3_600_000) / cell.perDay);

    return typeRun(typist, random, r, `${key}-${r}`, { count: cell.words, at, shift: bad[day] ? RULE_0017.badDayShift : 0 }).run;
  });

  // The fit after the first t runs, of which the profile keeps pattern evidence on the newest `kept`.
  const evidenceAt = (t) => {
    const prefix = runs.slice(Math.max(0, t - kept), t);

    return { records: learnerEvidence(prefix, KEYBOARD), now: Date.parse(prefix.at(-1).at) + 60_000 };
  };

  const queueOf = ({ records, now }, policy, loops = []) => learnerRecommendation(fitLearner(records, now, { ...LEARNER_VARIANTS[policy.policy], ...policy.constants }, 'balanced', loops)).queue;

  // Only targets the shipped default queued before the drill count, drilled for what it queued them for.
  const before = queueOf(evidenceAt(drill), shippedPolicy);
  const retest = runs[drill];

  const targets = [error, slow].flatMap((planted) => {
    const queued = before.find((item) => item.unit === planted.pair);

    return queued ? [{ unit: planted.pair, planted: planted.stratum === 'slow' ? 'slow' : 'errors', kind: queued.was.basis === 'slow' ? 'slow' : 'errors' }] : [];
  });

  const loops = targets.map((target) => ({ id: `drill-${key}-${target.unit}`, at: new Date(Date.parse(retest.at) + 1000).toISOString(), afterAttemptId: retest.id,
    target: target.unit, targetBasis: target.kind, conditions: retest.conditions }));

  const series = targets.map(() => Object.fromEntries(policies.map((p) => [p.name, { queued: [], fixed: [] }])));

  const drills = [...drilledTargets(loops, KEYBOARD).values()];

  for (let t = drill + 1; t <= total; t += 1) {
    const evidence = evidenceAt(t);
    const index = letGoIndex(evidence.records);

    for (const policy of policies) {
      const queued = new Set(queueOf(evidence, policy, drills).map((item) => item.unit));
      const k = { ...LET_GO, ...policy.constants };

      targets.forEach((target, n) => {
        const out = !queued.has(target.unit);
        series[n][policy.name].queued.push(!out);
        series[n][policy.name].fixed.push(out && letGo(index, target.unit, target.kind, drillSplit(loops[n], index), k));
      });
    }
  }

  return { counted: targets.length, uncounted: 2 - targets.length, targets: targets.map((target, n) => ({ ...target, world, results: Object.fromEntries(policies.map((p) => [p.name, measures(series[n][p.name], world)])) })) };
}

// A target's measures from its series, entry 0 being the fit after the retest.
function measures({ queued, fixed: read }, world) {
  const first = (list, value) => {
    const at = list.indexOf(value);

    return at < 0 ? NEVER : at + 1;
  };

  const firstFixed = read.indexOf(true);
  const atRegress = RULE_0017.regress - RULE_0017.drill - 1;
  let namedAgain = null;

  if (world === 'regress' && read[atRegress]) {
    const back = queued.slice(atRegress + 1).indexOf(true);
    namedAgain = back < 0 ? NEVER_AGAIN : back + 1;
  }

  return { runsToFixed: first(read, true), runsOut: first(queued, false), everFixed: firstFixed >= 0,
    returned: firstFixed >= 0 && read.slice(firstFixed).includes(false), namedAgain };
}

// The work for one seed and one cell: both typists in each world asked for.
export function seasonTask({ seed, cell, worlds, policies }) {
  const at = CELLS[cell];

  return worlds.flatMap((world) => Array.from({ length: RULE_0017.typists }, (_, i) => {
    const { counted, uncounted, targets } = season(seed, at, i, world, policies);

    return { seed, cell, i, world, counted, uncounted, targets };
  }));
}

// The guard world: ADR 0015's simulator, both variants, with loops saved at run 20 as the app saves them after a retest.
// Stationary typists drill their common planted error pair, which the drill leaves as weak; drifting typists drill their
// fixed error pair and fixed slow pair, fixed from run 20.
function guardTask({ seed, variant, policies }) {
  const population = simulate(seed, { world: RULE_0015.worlds[variant] }).map((entry) => {
    const { typist, history } = entry;
    const pairs = typist.group === 'drifting' ? [[typist.fixed, 'errors'], [typist.fixedSlow, 'slow']] : [[typist.planted.find((p) => p.stratum === 'common').pair, 'errors']];
    const drill = RULE_0017.drill;
    const queue = recommendFor(DECAY_TIMING_POLICY, { runs: history.slice(0, drill).map((h) => h.run), source: CONDITIONS, now: START + drill * RUN_MS }).queue;

    const retest = history[drill].run;

    const loops = pairs.map(([pair, planted]) => {
      const queued = queue.find((item) => item.unit === pair);

      return { id: `drill-${retest.id}-${pair}`, at: new Date(Date.parse(retest.at) + 1000).toISOString(), afterAttemptId: retest.id, target: pair,
        targetBasis: queued ? (queued.was.basis === 'slow' ? 'slow' : 'errors') : planted, conditions: CONDITIONS, run: drill };
    });

    return { ...entry, loops };
  });

  return { seed, variant, scores: Object.fromEntries(policies.map((p) => [p.name, score(population, learnerPolicy(p.policy, p.constants))])) };
}

const TASKS = { season: seasonTask, guard: guardTask };

if (!isMainThread) {
  parentPort.on('message', ({ id, kind, task }) => parentPort.postMessage({ id, result: TASKS[kind](task) }));
}

// Runs tasks on `workers` threads and returns their results in task order.
async function pool(kind, tasks, workers) {
  const results = new Array(tasks.length);
  let next = 0;
  const threads = Array.from({ length: Math.min(workers, tasks.length) }, () => new Worker(fileURLToPath(import.meta.url)));

  await Promise.all(threads.map((thread) => new Promise((resolve, reject) => {
    const send = () => {
      if (next >= tasks.length) {
        thread.terminate().then(resolve);

        return;
      }

      const id = next;
      next += 1;
      thread.postMessage({ id, kind, task: tasks[id] });
    };

    thread.on('message', ({ id, result }) => {
      results[id] = result;
      send();
    });

    thread.on('error', reject);
    send();
  })));

  return results;
}

// A 95% Wilson interval for k of n.
export function wilson(k, n) {
  if (!n) return { share: null, low: null, high: null, k, n };
  const z = 1.96;
  const p = k / n;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);

  return { share: p, low: centre - half, high: centre + half, k, n };
}

const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
};

// Every season measure for one policy, over the targets that pass `where`.
export function summarize(rows, policy, where = () => true) {
  const targets = rows.flatMap((row) => row.targets.map((target) => ({ ...target, cell: CELLS[row.cell] }))).filter(where);
  const read = (world, kind) => targets.filter((t) => t.world === world && t.kind === kind).map((t) => t.results[policy]);

  return Object.fromEntries(KINDS.map((kind) => {
    const fixedWorld = read('fixed', kind);
    const toFixed = fixedWorld.map((r) => r.runsToFixed);
    const everFixed = fixedWorld.filter((r) => r.everFixed);
    const again = read('regress', kind).map((r) => r.namedAgain).filter((v) => v !== null);

    return [kind, {
      targets: fixedWorld.length,
      runsToFixed: { median: median(toFixed), p90: quantile(toFixed, 0.9), within10: mean(toFixed.map((v) => (v <= 10 ? 1 : 0))), within20: mean(toFixed.map((v) => (v <= 20 ? 1 : 0))) },
      runsOut: { median: median(fixedWorld.map((r) => r.runsOut)), p90: quantile(fixedWorld.map((r) => r.runsOut), 0.9) },
      falseLetGo: wilson(read('unchanged', kind).filter((r) => r.everFixed).length, read('unchanged', kind).length),
      halvedLetGo: wilson(read('halved', kind).filter((r) => r.everFixed).length, read('halved', kind).length),
      unchangedOut: wilson(read('unchanged', kind).filter((r) => r.runsOut < NEVER).length, read('unchanged', kind).length),
      falseReturn: wilson(everFixed.filter((r) => r.returned).length, everFixed.length),
      namedAgain: { median: again.length ? median(again) : null, p90: quantile(again, 0.9), n: again.length },
    }];
  }));
}

const seasonTasks = (seeds, worlds, policies) => seeds.flatMap((seed) => CELLS.map((cell) => ({ seed, cell: cell.index, worlds, policies })));

// The constants, on validation seeds only (ADR 0017): R and q0 by false let-go and runs to read fixed, then H by
// false return and how soon a target that slipped again is named again.
export async function validate0017(workers) {
  const grid = RULE_0017.weakRatio.map((weakRatio, i) => candidate(`R${weakRatio} q${RULE_0017.slowShare[Math.min(i, RULE_0017.slowShare.length - 1)]}`,
    { weakRatio, slowShare: RULE_0017.slowShare[Math.min(i, RULE_0017.slowShare.length - 1)], returnOdds: 1e4 }));

  const first = await pool('season', seasonTasks(VALIDATION_SEEDS, ['fixed', 'unchanged'], grid), workers);
  const at25 = (t) => t.cell.words === 25;

  const pick = (kind, values, read) => {
    const rows = values.map((value) => {
      const policy = grid.find((p) => read(p.constants) === value).name;
      const all = summarize(first, policy)[kind];

      return { value, falseLetGo: all.falseLetGo.share, runsToFixed: summarize(first, policy, at25)[kind].runsToFixed.median };
    });

    const eligible = rows.filter((row) => row.falseLetGo <= RULE_0017.validationCeiling.letGo);
    const chosen = eligible.length ? eligible.reduce((a, b) => (b.runsToFixed < a.runsToFixed ? b : a)).value : Math.min(...values);

    return { rows, chosen };
  };

  const weak = pick('errors', RULE_0017.weakRatio, (k) => k.weakRatio);
  const slow = pick('slow', RULE_0017.slowShare, (k) => k.slowShare);
  const back = RULE_0017.returnOdds.map((returnOdds) => candidate(`H${returnOdds}`, { weakRatio: weak.chosen, slowShare: slow.chosen, returnOdds }));
  const second = await pool('season', seasonTasks(VALIDATION_SEEDS, ['fixed', 'regress'], back), workers);

  const returns = RULE_0017.returnOdds.map((returnOdds) => {
    const s = summarize(second, `H${returnOdds}`);
    const again = second.flatMap((row) => row.targets.filter((t) => t.world === 'regress').map((t) => t.results[`H${returnOdds}`].namedAgain)).filter((v) => v !== null);

    return { returnOdds, falseReturn: Object.fromEntries(KINDS.map((kind) => [kind, s[kind].falseReturn.share])), namedAgain: again.length ? median(again) : null };
  });

  const eligible = returns.filter((row) => KINDS.every((kind) => (row.falseReturn[kind] ?? 0) <= RULE_0017.validationCeiling.return));

  const returnOdds = eligible.length ? eligible.reduce((a, b) => (b.namedAgain < a.namedAgain || (b.namedAgain === a.namedAgain && b.returnOdds > a.returnOdds) ? b : a)).returnOdds
    : Math.max(...RULE_0017.returnOdds);

  return { weakRatio: weak, slowShare: slow, returnOdds: { rows: returns, chosen: returnOdds }, constants: { weakRatio: weak.chosen, slowShare: slow.chosen, returnOdds } };
}

const reallyWorse = (result, a, b, measure) => {
  const d = paired(result, a, b, measure);

  return Boolean(d) && (MEASURES[measure] ? d.low > 0 : d.high < 0);
};

// ADR 0017's decision, from the guard world's per-seed scores and the season's targets.
export function decide0017(guard, seasonSummary) {
  const harm = (name) => Object.keys(RULE_0015.worlds).flatMap((v) => RULE_0015.guards.filter((m) => reallyWorse(guard[v], name, 'shipped', m)).map((m) => `${v} ${m}`));

  const clauses = (kind) => {
    const s = seasonSummary.candidate;

    return {
      [`b ${kind}`]: s.at25[kind].runsToFixed.median <= RULE_0017.targets[kind],
      [`c ${kind}`]: s.all[kind].falseLetGo.high <= RULE_0017.ceilings.letGo,
      [`d ${kind}`]: s.all[kind].falseReturn.high <= RULE_0017.ceilings.return,
    };
  };

  const a = { candidate: harm('candidate'), misses: harm('misses') };
  const misses = clauses('errors');
  const pace = clauses('slow');
  const full = a.candidate.length === 0 && Object.values(misses).every(Boolean) && Object.values(pace).every(Boolean);
  const missesOnly = !full && a.misses.length === 0 && Object.values(misses).every(Boolean);

  return { a, clauses: { ...misses, ...pace }, default: full ? LET_GO_POLICY : missesOnly ? LET_GO_MISSES_POLICY : DECAY_TIMING_POLICY };
}

// Train's open step on the TOB-419 history: a pair missed in some runs, drilled, then typed cleanly; how many clean
// runs until each policy stops naming it and Train reads it fixed. Each missed run holds 9 tries of "th" with 2 misses
// and each clean run 9 clean tries, beside a background of 60 frequent pairs, 3 tries each, one try in 30 missed. That
// background gives the measured table within a few runs under learner-decay-timing@1.
export function heldScenario() {
  const background = ['he', 'in', 'er', 'an', 're', 'on', 'at', 'en', 'nd', 'ti', 'es', 'or', 'te', 'of', 'ed', 'is', 'it', 'al', 'ar', 'st', 'to', 'nt', 'ng', 'se',
    'ha', 'as', 'ou', 'io', 'le', 've', 'co', 'me', 'de', 'hi', 'ri', 'ro', 'ic', 'ne', 'ea', 'ra', 'ce', 'li', 'ch', 'll', 'be', 'ma', 'si', 'om', 'ur', 'ca', 'el', 'ta',
    'la', 'ns', 'di', 'fo', 'ho', 'pe', 'ec', 'pr'];

  const run = (n, perDay, missed) => ({ id: `held-${n}`, at: new Date(START + Math.floor(n / perDay) * DAY_MS + (n % perDay) * 3_600_000).toISOString(), kind: 'test',
    status: 'complete', interrupted: false, fresh: true, conditions: CONDITIONS, keys: [], keysVersion: 0,
    patterns: [['th', 9, missed ? 2 : 0, 7, 200, 0], ...background.map((pair, i) => [pair, 3, (i + n) % 30 === 0 ? 1 : 0, 3, 200, 0])] });

  const rows = [];

  for (const missedRuns of [4, 20]) {
    for (const perDay of [1, 5]) {
      const row = { missedRuns, perDay };

      for (const policy of [DECAY_TIMING_POLICY, LET_GO_POLICY]) {
        const runs = Array.from({ length: missedRuns }, (_, n) => run(n, perDay, true));
        const loops = [];
        let named = null;
        let fixedAt = null;

        for (let clean = 1; clean <= 200 && (named === null || fixedAt === null); clean += 1) {
          runs.push(run(runs.length, perDay, false));
          const retest = runs[missedRuns];

          if (clean === 1) loops.push({ id: 'held-loop', at: new Date(Date.parse(retest.at) + 1000).toISOString(), afterAttemptId: retest.id, target: 'th', targetBasis: 'errors', conditions: CONDITIONS });
          const now = Date.parse(runs.at(-1).at) + 60_000;
          const recommendation = recommendFor(policy, { runs: runs.slice(-RULE_0017.kept), loops, source: CONDITIONS, now });
          const queued = recommendation.queue.some((item) => item.unit === 'th');

          if (!queued && named === null) named = clean;
          const path = trainPath({ recommendation, loops, runs: runs.slice(-RULE_0017.kept), keyboard: KEYBOARD });

          if (fixedAt === null && path.behind.some((step) => step.unit === 'th' && step.state === 'fixed')) fixedAt = clean;
        }

        row[policy] = { cleanRunsUntilNotNamed: named, cleanRunsUntilFixed: fixedAt };
      }

      rows.push(row);
    }
  }

  return rows;
}

// How long a fit takes on a full history: 1,000 measured runs, every one holding pattern evidence (more than a profile
// keeps), and 200 loops on 100 targets.
export function fitTime0017() {
  const random = seeded(4190);
  const typist = makeTypist(random, 'mechanics', SKILLS[1]);
  const runs = Array.from({ length: 1000 }, (_, r) => typeRun(typist, random, r, `fit-${r}`).run);
  const pairs = [...new Set(runs.flatMap((run) => run.patterns.map((row) => row[0])))].slice(0, 100);

  const loops = Array.from({ length: 200 }, (_, n) => ({ id: `fit-loop-${n}`, at: runs[100 + n * 4].at, afterAttemptId: runs[100 + n * 4].id, target: pairs[n % pairs.length],
    targetBasis: n % 3 ? 'errors' : 'slow', conditions: CONDITIONS }));

  const now = Date.parse(runs.at(-1).at) + 60_000;

  const time = (fn) => {
    fn();

    const times = Array.from({ length: 15 }, () => {
      const started = performance.now();
      fn();

      return performance.now() - started;
    });

    return { median: median(times), max: Math.max(...times) };
  };

  return Object.fromEntries([DECAY_TIMING_POLICY, LET_GO_POLICY].map((policy) => [policy, {
    recommendation: time(() => recommendFor(policy, { runs, loops, source: CONDITIONS, now })),
    trainPath: time(() => trainPath({ recommendation: recommendFor(policy, { runs, loops, source: CONDITIONS, now }), loops, runs, keyboard: KEYBOARD })),
  }]));
}

export async function rule0017({ workers = 12 } = {}) {
  const validation = await validate0017(workers);
  const chosen = validation.constants;
  const policies = [shippedPolicy, candidate('candidate', chosen)];
  const guardPolicies = [...policies, candidate('misses', chosen, LET_GO_MISSES_POLICY)];
  const seeds = RULE_0017.testSeeds;
  const rows = await pool('season', seasonTasks(seeds, RULE_0017.worlds, policies), workers);
  const guardRows = await pool('guard', seeds.flatMap((seed) => Object.keys(RULE_0015.worlds).map((variant) => ({ seed, variant, policies: guardPolicies }))), workers);

  const guard = Object.fromEntries(Object.keys(RULE_0015.worlds).map((variant) => [variant, { seeds, perSeed: guardRows.filter((row) => row.variant === variant).map((row) => row.scores) }]));

  const seasonSummary = Object.fromEntries(policies.map((p) => [p.name, {
    all: summarize(rows, p.name),
    at25: summarize(rows, p.name, (t) => t.cell.words === 25),
    byCell: CELLS.map((cell) => ({ cell, ...summarize(rows, p.name, (t) => t.cell.index === cell.index) })),
    byWords: Object.fromEntries(RULE_0017.words.map((w) => [w, summarize(rows, p.name, (t) => t.cell.words === w)])),
    byPerDay: Object.fromEntries(RULE_0017.perDay.map((d) => [d, summarize(rows, p.name, (t) => t.cell.perDay === d)])),
    bySkill: Object.fromEntries(SKILLS.map((s) => [s.name, summarize(rows, p.name, (t) => t.cell.skill === s.name)])),
    byBadDays: Object.fromEntries(RULE_0017.badDays.map((b) => [b ? 'bad days' : 'no bad days', summarize(rows, p.name, (t) => t.cell.badDays === b)])),
  }]));

  const counted = rows.reduce((sum, row) => sum + row.counted, 0);
  const uncounted = rows.reduce((sum, row) => sum + row.uncounted, 0);

  const guardMeans = Object.fromEntries(Object.entries(guard).map(([variant, result]) => [variant, Object.fromEntries(guardPolicies.map((p) => [p.name,
    Object.fromEntries([...RULE_0015.guards, 'slowPickUp', 'slowLetGo'].map((m) => [m, mean(result.perSeed.map((seed) => seed[p.name][m]))]))]))]));

  const guardDiffs = Object.fromEntries(Object.entries(guard).map(([variant, result]) => [variant, Object.fromEntries(['candidate', 'misses'].map((name) => [name,
    Object.fromEntries([...RULE_0015.guards, 'slowPickUp', 'slowLetGo'].map((m) => [m, paired(result, name, 'shipped', m)]))]))]));

  return { rule: '0017', validation, constants: chosen, seeds, targets: { counted, uncounted }, season: seasonSummary, guard: { means: guardMeans, differences: guardDiffs, perSeed: guard },
    decision: decide0017(guard, seasonSummary), held: heldScenario() };
}

const runs1 = (v) => (v === null ? '–' : fixed(1)(v));
const share = (w) => (w.share === null ? '–' : `${percent(w.share)} [${percent(w.low)}, ${percent(w.high)}] (${w.k}/${w.n})`);

export function report0017(record) {
  const { validation, season: s, guard, decision, held } = record;
  const kindName = { errors: 'misses', slow: 'pace' };

  const seasonRows = (label, read) => ['candidate', 'shipped'].flatMap((policy) => KINDS.map((kind) => {
    const m = read(s[policy])[kind];

    return [label, policy, kindName[kind], String(m.targets), runs1(m.runsToFixed.median), runs1(m.runsToFixed.p90), percent(m.runsToFixed.within10 ?? 0), runs1(m.runsOut.median),
      share(m.falseLetGo), share(m.falseReturn), runs1(m.namedAgain.median), share(m.halvedLetGo)];
  }));

  const header = ['slice', 'policy', 'kind', 'targets', 'to fixed', 'p90', '≤10', 'out of queue', 'false let-go', 'false return', 'named again', 'halved read fixed'];
  const diff = (d) => (d ? `${signed(4)(d.mean)} [${signed(4)(d.low)}, ${signed(4)(d.high)}]` : '–');

  return [
    `ADR 0017. Validation (seeds ${VALIDATION_SEEDS.join(', ')}).`,
    `R: ${validation.weakRatio.rows.map((r) => `${r.value}: false let-go ${percent(r.falseLetGo)}, to fixed at 25 words ${r.runsToFixed}`).join('; ')}. Chosen ${validation.weakRatio.chosen}.`,
    `q0: ${validation.slowShare.rows.map((r) => `${r.value}: false let-go ${percent(r.falseLetGo)}, to fixed at 25 words ${r.runsToFixed}`).join('; ')}. Chosen ${validation.slowShare.chosen}.`,
    `H: ${validation.returnOdds.rows.map((r) => `${r.returnOdds}: false return misses ${percent(r.falseReturn.errors ?? 0)}, pace ${percent(r.falseReturn.slow ?? 0)}, named again ${r.namedAgain}`).join('; ')}. Chosen ${validation.returnOdds.chosen}.`,
    '',
    `Season, test seeds ${record.seeds[0]} to ${record.seeds.at(-1)}: ${record.targets.counted} drilled targets counted, ${record.targets.uncounted} not queued before the drill.`,
    table(header, [...seasonRows('all', (p) => p.all), ...seasonRows('25 words', (p) => p.at25),
      ...RULE_0017.words.flatMap((w) => seasonRows(`${w} words`, (p) => p.byWords[w])), ...RULE_0017.perDay.flatMap((d) => seasonRows(`${d} a day`, (p) => p.byPerDay[d])),
      ...SKILLS.flatMap((sk) => seasonRows(sk.name, (p) => p.bySkill[sk.name])), ...['no bad days', 'bad days'].flatMap((b) => seasonRows(b, (p) => p.byBadDays[b]))]),
    '',
    'Guard world, test seeds, paired differences A − shipped, mean [95% t interval].',
    table(['variant', 'A', ...[...RULE_0015.guards, 'slowPickUp', 'slowLetGo']], Object.entries(guard.differences).flatMap(([variant, byName]) => Object.entries(byName)
      .map(([name, d]) => [variant, name, ...[...RULE_0015.guards, 'slowPickUp', 'slowLetGo'].map((m) => diff(d[m]))]))),
    '',
    'TOB-419 history: clean runs until "th" is no longer named, and until Train reads it fixed.',
    table(['missed in', 'a day', 'shipped: not named', 'shipped: fixed', 'let-go: not named', 'let-go: fixed'], held.map((row) => [String(row.missedRuns), String(row.perDay),
      ...[DECAY_TIMING_POLICY, LET_GO_POLICY].flatMap((p) => [String(row[p].cleanRunsUntilNotNamed ?? '>200'), String(row[p].cleanRunsUntilFixed ?? '>200')])])),
    '',
    `Decision: (a) candidate ${decision.a.candidate.length ? `really worse on ${decision.a.candidate.join(', ')}` : 'really worse on none'}, misses-only ${decision.a.misses.length ? `really worse on ${decision.a.misses.join(', ')}` : 'really worse on none'}.`,
    `Clauses: ${Object.entries(decision.clauses).map(([k, v]) => `${k} ${v ? 'pass' : 'FAIL'}`).join(', ')}.`,
    `Default by ADR 0017: ${decision.default}. The app's DEFAULT_POLICY: ${DEFAULT_POLICY}.`,
  ].join('\n');
}

export async function main(option) {
  const workers = Number(option('workers', 12));

  if (process.argv.includes('--validation-only')) {
    console.log(JSON.stringify(await validate0017(workers), null, 1));

    return;
  }

  const record = await rule0017({ workers });
  console.log(report0017(record));
  const json = option('json', null);

  if (json) writeFileSync(json, `${JSON.stringify(record, null, 1)}\n`);
  const times = fitTime0017();
  console.log(`\nFit on 1,000 runs and 200 loops: ${Object.entries(times).map(([p, t]) => `${p} recommendation median ${t.recommendation.median.toFixed(1)} ms (slowest ${t.recommendation.max.toFixed(1)}), Train's path ${t.trainPath.median.toFixed(1)} ms (slowest ${t.trainPath.max.toFixed(1)})`).join('; ')}`);
}
