// ADR 0029's decision rule: learner-let-go@3, which lets a drilled target go on evidence fixed at its drill, against the
// shipped learner-decay-timing@1. Deterministic from its seeds: the work is split across worker threads by seed and
// cell, and every result is put back in seed and cell order before anything is summed.
//
//   bun run evaluate:learner -- --rule 0029 [--json out.json] [--workers 12]   (or node scripts/evaluate-let-go-v3.mjs ...)
//   bun run evaluate:learner -- --rule 0029 --validation-only
//   bun run evaluate:learner -- --rule 0029 --check   (validation only, exits 1 when a check below fails)
//
// The season is ADR 0019's, in two arms. In the normal arm every run after the retest is a normal run. In the adaptive arm
// every run after it is an adaptive passage, drawn from the candidate's own adaptive lean after the run before. The guard
// world is ADR 0015's, scored as ADR 0019 scored it. None of it says whether anyone learns faster.

import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DECAY_TIMING_POLICY, DEFAULT_POLICY, LET_GO, LET_GO_3, LET_GO_3_POLICY, LET_GO_MISSES_3_POLICY, LEARNER_VARIANTS, adaptiveEvidence, adaptiveLean, drillSplit, drilledTargets, fitLearner,
  learnerEvidence, learnerRecommendation, letGo, letGoIndex, letGoV3, letGoIndexV3, recommendFor } from '../src/learner.js';
import { retainRuns } from '../src/insights.js';
import { makeAdaptive } from '../src/typing.js';
import { CONDITIONS, KEYBOARD, MEASURES, RULE_0015, RUN_MS, SHIPPED, SKILLS, START, VALIDATION_SEEDS, fixed, learnerPolicy, makeTypist, mean, median, paired, percent,
  score, seeded, signed, simulate, table, typeRun } from './evaluate-learner.mjs';

const DAY_MS = 86_400_000;

export const RULE_0029 = {
  testSeeds: Array.from({ length: 30 }, (_, i) => 501 + i),
  weakRatio: [3, 4, 6, 8],
  slowShare: [0.75, 0.85, 0.95],
  returnOdds: [1e3, 1e4, 1e5],
  drillLeanShare: [0.5, 0.75, 0.9],
  drill: 20,
  regress: 80,
  runs: 160,
  words: [10, 25, 100],
  perDay: [1, 5, 15],
  badDays: [false, true],
  badDayChance: 0.2,
  badDayShift: 0.7,
  typists: 2,
  worlds: ['fixed', 'unchanged', 'halved', 'regress'],
  validationCeiling: { letGo: 0.01, return: 0.025 },
  ceilings: { letGo: 0.02, return: 0.05 },
  targets: { normal: { errors: 60, slow: 45 }, adaptive: { errors: 20, slow: 40 } },
};

const KINDS = ['errors', 'slow'];
const ARMS = ['normal', 'adaptive'];
const NEVER = RULE_0029.runs - RULE_0029.drill + 1;
const NEVER_AGAIN = RULE_0029.runs - RULE_0029.regress + 1;
const SEASON_STREAM = 17_000_000;

// SKILLS is imported from the shared simulator; the cells are ADR 0019's.
export const CELLS = RULE_0029.words.flatMap((words) => RULE_0029.perDay.flatMap((perDay) => RULE_0029.badDays.flatMap((badDays) => SKILLS.map((skill) => ({ words, perDay, badDays, skill: skill.name })))))
  .map((cell, index) => ({ ...cell, index }));

const candidateConstants = (k) => ({ ...SHIPPED, ...LET_GO_3, ...k });
const candidate = (name, k, policy = LET_GO_3_POLICY) => ({ name, policy, constants: candidateConstants(k) });
const shippedConstants = { ...SHIPPED };

// A target's measures from its series (entry 0 is the fit after the retest). `fixed` is let go and not queued for the kind.
function measures({ queued, fixed: read }, world) {
  const first = (list, value) => {
    const at = list.indexOf(value);

    return at < 0 ? NEVER : at + 1;
  };

  const firstFixed = read.indexOf(true);
  const atRegress = RULE_0029.regress - RULE_0029.drill - 1;
  let namedAgain = null;

  if (world === 'regress' && read[atRegress]) {
    const back = queued.slice(atRegress + 1).indexOf(true);
    namedAgain = back < 0 ? NEVER_AGAIN : back + 1;
  }

  return { runsToFixed: first(read, true), everFixed: firstFixed >= 0, returned: firstFixed >= 0 && read.slice(firstFixed).includes(false), namedAgain };
}

// The first tries of the drilled pair in each adaptive run typed while the target was not yet read fixed (run j is typed
// after state j), or in every run when it never was.
const triesBefore = (tries, read) => {
  const at = read.indexOf(true);

  return at < 0 ? tries : tries.slice(0, at);
};

// One typist's season in one world, one arm of `normal` and `adaptive`, and for the normal arm optionally the shipped
// default beside it. Returns the typist's counted targets and each one's measures.
function season(seed, cell, i, world, arm, k, withShipped) {
  const key = (seed * CELLS.length + cell.index) * RULE_0029.typists + i;
  const random = seeded(SEASON_STREAM + key);
  const skill = SKILLS.find((s) => s.name === cell.skill);
  const typist = makeTypist(random, i % 2 ? 'unrelated' : 'mechanics', skill, i, { errorPairsAtPace: true });
  const error = typist.planted.find((p) => p.stratum === (seeded(2 * SEASON_STREAM + key)() < 0.5 ? 'common' : 'middle'));
  const slow = typist.planted.find((p) => p.stratum === 'slow');
  const { drill, regress, runs: total } = RULE_0029;

  for (const planted of [error, slow]) {
    if (world === 'unchanged') continue;
    planted.until = drill;

    if (world === 'halved') typist.planted.push({ ...planted, from: drill, until: Infinity, error: planted.error / 2, slow: planted.slow / 2 });

    if (world === 'regress') typist.planted.push({ ...planted, from: regress, until: Infinity });
  }

  const days = seeded(3 * SEASON_STREAM + key);
  const bad = Array.from({ length: Math.ceil(total / cell.perDay) }, () => cell.badDays && days() < RULE_0029.badDayChance);
  const drawn = seeded(6 * SEASON_STREAM + key);
  const dayOf = (r) => Math.floor(r / cell.perDay);
  const atOf = (r) => START + dayOf(r) * DAY_MS + (r % cell.perDay) * ((14 * 3_600_000) / cell.perDay);

  const typeAt = (r, options = {}) => {
    const { run } = typeRun(typist, random, r, `${key}-${r}`, { count: cell.words, at: atOf(r), shift: bad[dayOf(r)] ? RULE_0029.badDayShift : 0, ...options });

    return r === drill ? { ...run, kind: 'retest' } : run;
  };

  const shipped = { ...LEARNER_VARIANTS[DECAY_TIMING_POLICY], ...shippedConstants };
  const v3 = { ...LEARNER_VARIANTS[LET_GO_3_POLICY], ...candidateConstants(k) };
  const twenty = Array.from({ length: drill + 1 }, (_, r) => typeAt(r));
  const nowOf = (runs) => Date.parse(runs.at(-1).at) + 60_000;

  // The fit after the first t runs, as the app keeps them: the shipped default reads the newest 120, the candidate the
  // window that keeps its drills.
  const queueOf = (records, now, variant, loops, extra = []) => learnerRecommendation(fitLearner(records, now, variant, 'balanced', loops, extra)).queue;

  const before = queueOf(learnerEvidence(twenty.slice(0, drill), KEYBOARD), nowOf(twenty.slice(0, drill)), shipped, []);
  const retest = twenty[drill];

  const targets = [error, slow].flatMap((planted) => {
    const queued = before.find((item) => item.unit === planted.pair);

    return queued ? [{ unit: planted.pair, planted: planted.stratum === 'slow' ? 'slow' : 'errors', kind: queued.was.basis === 'slow' ? 'slow' : 'errors' }] : [];
  });

  const loops = targets.map((target) => ({ id: `drill-${key}-${target.unit}`, at: new Date(Date.parse(retest.at) + 1000).toISOString(), afterAttemptId: retest.id,
    target: target.unit, targetBasis: target.kind, conditions: retest.conditions }));

  const drills = [...drilledTargets(loops, KEYBOARD).values()];
  const queuedKind = (queue, target) => queue.some((item) => item.unit === target.unit && (item.was.basis === 'slow') === (target.kind === 'slow'));
  const blank = () => targets.map(() => ({ queued: [], fixed: [], tries: [] }));
  const series = { normal: blank(), adaptive: blank(), shipped: blank() };
  const runs = [...twenty];
  const tries = targets.map(() => []);

  for (let t = drill + 1; t <= total; t += 1) {
    const kept = retainRuns(runs);
    const records = learnerEvidence(kept, KEYBOARD);
    const now = nowOf(runs);

    if (arm === 'normal') {
      const index = letGoIndexV3(records, adaptiveEvidence(kept, KEYBOARD));
      const queue = queueOf(records, now, v3, drills);

      targets.forEach((target, n) => {
        const out = !queuedKind(queue, target);
        series.normal[n].queued.push(!out);
        series.normal[n].fixed.push(out && letGoV3(index, target.unit, target.kind, drillSplit(loops[n], index), { ...LET_GO_3, ...v3 }));
      });

      if (withShipped) {
        const old = learnerEvidence(retainRuns(runs, { drills: false }), KEYBOARD);
        const oldIndex = letGoIndex(old);
        const oldQueue = new Set(queueOf(old, now, shipped, []).map((item) => item.unit));

        targets.forEach((target, n) => {
          series.shipped[n].queued.push(oldQueue.has(target.unit));
          series.shipped[n].fixed.push(!oldQueue.has(target.unit) && letGo(oldIndex, target.unit, target.kind, drillSplit(loops[n], oldIndex), LET_GO));
        });
      }

      if (t < total) runs.push(typeAt(t));
    } else {
      const adaptive = adaptiveEvidence(kept, KEYBOARD);
      const index = letGoIndexV3(records, adaptive);
      const model = fitLearner(records, now, v3, 'balanced', drills, adaptive);
      const recommendation = learnerRecommendation(model);

      targets.forEach((target, n) => {
        const out = !queuedKind(recommendation.queue, target);
        series.adaptive[n].queued.push(!out);
        series.adaptive[n].fixed.push(out && letGoV3(index, target.unit, target.kind, drillSplit(loops[n], index), { ...LET_GO_3, ...v3 }));
      });

      if (t < total) {
        const lean = adaptiveLean(model, recommendation.lean, drills, v3.drillLeanShare);
        const passage = makeAdaptive(lean, { mode: 'words', count: cell.words, random: drawn });
        const run = typeAt(t, passage ? { text: passage.text, adaptive: true } : {});
        runs.push(run);

        targets.forEach((target, n) => {
          const row = (run.adaptivePatterns || []).find((r) => r[0] === target.unit);
          tries[n].push(row ? row[1] : 0);
        });
      }
    }
  }

  const armsRun = arm === 'normal' ? (withShipped ? ['normal', 'shipped'] : ['normal']) : ['adaptive'];

  const results = (n) => Object.fromEntries(armsRun.map((name) => {
    const measured = measures(series[name][n], world);

    if (name === 'adaptive') measured.tries = median(triesBefore(tries[n], series.adaptive[n].fixed));

    return [name, measured];
  }));

  return { counted: targets.length, uncounted: 2 - targets.length, targets: targets.map((target, n) => ({ ...target, world, results: results(n) })) };
}

// The work for one seed and one cell: both typists in each world asked for, each arm asked for.
export function seasonTask({ seed, cell, worlds, arms = ARMS, k, shipped = false }) {
  const at = CELLS[cell];

  return arms.flatMap((arm) => worlds.flatMap((world) => Array.from({ length: RULE_0029.typists }, (_, i) => {
    const { counted, uncounted, targets } = season(seed, at, i, world, arm, k, shipped && arm === 'normal' && (world === 'fixed' || world === 'unchanged'));

    return { seed, cell, i, world, arm, counted, uncounted, targets };
  })));
}

// The guard world, as ADR 0019 ran it, for the candidates of this rule.
function guardTask({ seed, variant, policies }) {
  const population = simulate(seed, { world: RULE_0015.worlds[variant] }).map((entry) => {
    const { typist, history } = entry;
    const pairs = typist.group === 'drifting' ? [[typist.fixed, 'errors'], [typist.fixedSlow, 'slow']] : [[typist.planted.find((p) => p.stratum === 'common').pair, 'errors']];
    const drill = RULE_0029.drill;
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
  const threads = Array.from({ length: Math.min(workers, tasks.length) }, () => new Worker(import.meta.filename));

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

// One pool at a time: every grid point gets all the workers.
async function serial(items, fn) {
  const results = [];

  for (const item of items) results.push(await fn(item));

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

// Every season measure for one arm, over the targets that pass `where`.
export function summarize(rows, arm, where = () => true) {
  const targets = rows.flatMap((row) => row.targets.map((target) => ({ ...target, cell: CELLS[row.cell] }))).filter(where);
  const read = (world, kind) => targets.filter((t) => t.world === world && t.kind === kind && t.results[arm]).map((t) => t.results[arm]);

  return Object.fromEntries(KINDS.map((kind) => {
    const fixedWorld = read('fixed', kind);
    const toFixed = fixedWorld.map((r) => r.runsToFixed);
    const everFixed = fixedWorld.filter((r) => r.everFixed);
    const again = read('regress', kind).map((r) => r.namedAgain).filter((v) => v !== null);
    const tries = fixedWorld.map((r) => r.tries).filter((v) => v !== undefined && v !== null);

    return [kind, {
      targets: fixedWorld.length,
      runsToFixed: { median: median(toFixed), p90: quantile(toFixed, 0.9), within10: mean(toFixed.map((v) => (v <= 10 ? 1 : 0))), within20: mean(toFixed.map((v) => (v <= 20 ? 1 : 0))) },
      falseLetGo: wilson(read('unchanged', kind).filter((r) => r.everFixed).length, read('unchanged', kind).length),
      halvedLetGo: wilson(read('halved', kind).filter((r) => r.everFixed).length, read('halved', kind).length),
      falseReturn: wilson(everFixed.filter((r) => r.returned).length, everFixed.length),
      namedAgain: { median: again.length ? median(again) : null, p90: quantile(again, 0.9), n: again.length },
      triesPerRun: tries.length ? median(tries) : null,
    }];
  }));
}

const seasonTasks = (seeds, worlds, arms, k, shipped = false) => seeds.flatMap((seed) => CELLS.map((cell) => ({ seed, cell: cell.index, worlds, arms, k, shipped })));

// The constants, on validation seeds only (ADR 0029): R and q0 by false let-go and runs to read fixed, then H by same-kind
// false return and how soon a target that slipped again is named again, then the drill lean share on the adaptive arm.
export async function validate0029(workers) {
  const at25 = (t) => t.cell.words === 25;
  const pairing = (i) => RULE_0029.slowShare[Math.min(i, RULE_0029.slowShare.length - 1)];
  const grid = RULE_0029.weakRatio.map((weakRatio, i) => ({ weakRatio, slowShare: pairing(i), returnOdds: 1e4 }));

  // One pass per grid point, since the season takes its constants per task.
  const first = await serial(grid, async (k) => (await pool('season', seasonTasks(VALIDATION_SEEDS, ['fixed', 'unchanged'], ['normal'], k), workers)).flat());

  const pick = (kind, values, read) => {
    const rows = values.map((value) => {
      const index = grid.findIndex((k) => read(k) === value);
      const rowsAt = first[index];

      return { value, falseLetGo: summarize(rowsAt, 'normal')[kind].falseLetGo.share, runsToFixed: summarize(rowsAt, 'normal', at25)[kind].runsToFixed.median };
    });

    const eligible = rows.filter((row) => Number.isFinite(row.falseLetGo) && row.falseLetGo <= RULE_0029.validationCeiling.letGo);
    const chosen = eligible.length ? eligible.reduce((a, b) => (b.runsToFixed < a.runsToFixed ? b : a)).value : Math.min(...values);

    return { rows, chosen };
  };

  // R and q0 each come from the grid point that holds them: R3 with q0 0.75, R4 with 0.85, R6 and R8 with 0.95, as ADR 0019 paired them,
  // so a value of one is read where the other is its partner. That is the same two-column reading ADR 0019 used.
  const weak = pick('errors', RULE_0029.weakRatio, (k) => k.weakRatio);
  const slow = pick('slow', RULE_0029.slowShare, (k) => k.slowShare);

  const back = await serial(RULE_0029.returnOdds, async (returnOdds) => (await pool('season', seasonTasks(VALIDATION_SEEDS, ['fixed', 'regress'], ['normal'], { weakRatio: weak.chosen, slowShare: slow.chosen, returnOdds }), workers)).flat());

  const returns = RULE_0029.returnOdds.map((returnOdds, i) => {
    const rows = back[i];
    const s = summarize(rows, 'normal');
    const again = rows.flatMap((row) => row.targets.filter((t) => t.world === 'regress').map((t) => t.results.normal.namedAgain)).filter((v) => v !== null);

    return { returnOdds, falseReturn: Object.fromEntries(KINDS.map((kind) => [kind, s[kind].falseReturn.share])), namedAgain: again.length ? median(again) : null };
  });

  const eligible = returns.filter((row) => KINDS.every((kind) => Number.isFinite(row.falseReturn[kind]) && row.falseReturn[kind] <= RULE_0029.validationCeiling.return));

  const returnOdds = eligible.length ? eligible.reduce((a, b) => (b.namedAgain < a.namedAgain || (b.namedAgain === a.namedAgain && b.returnOdds > a.returnOdds) ? b : a)).returnOdds
    : Math.max(...RULE_0029.returnOdds);

  const chosen = { weakRatio: weak.chosen, slowShare: slow.chosen, returnOdds };

  const lean = await serial(RULE_0029.drillLeanShare, async (drillLeanShare) => (await pool('season', seasonTasks(VALIDATION_SEEDS, ['fixed', 'unchanged'], ['adaptive'], { ...chosen, drillLeanShare }), workers)).flat());

  const shares = RULE_0029.drillLeanShare.map((value, i) => {
    const all = summarize(lean[i], 'adaptive');
    const at = summarize(lean[i], 'adaptive', at25);

    return { value, falseLetGo: Object.fromEntries(KINDS.map((kind) => [kind, all[kind].falseLetGo.share])), runsToFixed: at.errors.runsToFixed.median, runsToFixedPace: at.slow.runsToFixed.median, tries: Object.fromEntries(KINDS.map((kind) => [kind, at[kind].triesPerRun])) };
  });

  const open = shares.filter((row) => KINDS.every((kind) => Number.isFinite(row.falseLetGo[kind]) && row.falseLetGo[kind] <= RULE_0029.validationCeiling.letGo));
  const drillLeanShare = open.length ? open.reduce((a, b) => (b.runsToFixed < a.runsToFixed ? b : a)).value : Math.min(...RULE_0029.drillLeanShare);

  return { weakRatio: weak, slowShare: slow, returnOdds: { rows: returns, chosen: returnOdds }, drillLeanShare: { rows: shares, chosen: drillLeanShare }, constants: { ...chosen, drillLeanShare } };
}

// CI-style check: the shipped constants are the ones validation picks, at the recorded false let-go.
export function check0029(validation) {
  const c = validation.constants;

  return [{ label: 'R chosen', ok: c.weakRatio === LET_GO_3.weakRatio, detail: `${c.weakRatio}, shipped ${LET_GO_3.weakRatio}` },
    { label: 'q0 chosen', ok: c.slowShare === LET_GO_3.slowShare, detail: `${c.slowShare}, shipped ${LET_GO_3.slowShare}` },
    { label: 'H chosen', ok: c.returnOdds === LET_GO_3.returnOdds, detail: `${c.returnOdds}, shipped ${LET_GO_3.returnOdds}` },
    { label: 'lean share chosen', ok: c.drillLeanShare === LEARNER_VARIANTS[LET_GO_3_POLICY].drillLeanShare, detail: `${c.drillLeanShare}, shipped ${LEARNER_VARIANTS[LET_GO_3_POLICY].drillLeanShare}` }];
}

const reallyWorse = (result, a, b, measure) => {
  const d = paired(result, a, b, measure);

  return Boolean(d) && (MEASURES[measure] ? d.low > 0 : d.high < 0);
};

// ADR 0029's decision, from the guard world's per-seed scores and the season's targets.
export function decide0029(guard, summary) {
  const harm = (name) => Object.keys(RULE_0015.worlds).flatMap((v) => RULE_0015.guards.filter((m) => reallyWorse(guard[v], name, 'shipped', m)).map((m) => `${v} ${m}`));

  const clauses = (kind) => Object.fromEntries(ARMS.flatMap((arm) => [
    [`b ${arm} ${kind}`, summary.at25[arm][kind].runsToFixed.median <= RULE_0029.targets[arm][kind]],
    [`c ${arm} ${kind}`, summary.all[arm][kind].falseLetGo.high <= RULE_0029.ceilings.letGo],
    [`d ${arm} ${kind}`, summary.all[arm][kind].falseReturn.high <= RULE_0029.ceilings.return],
  ]));

  const a = { candidate: harm('candidate'), misses: harm('misses') };
  const misses = clauses('errors');
  const pace = clauses('slow');
  const full = a.candidate.length === 0 && Object.values(misses).every(Boolean) && Object.values(pace).every(Boolean);
  const missesOnly = !full && a.misses.length === 0 && Object.values(misses).every(Boolean);

  return { a, clauses: { ...misses, ...pace }, default: full ? LET_GO_3_POLICY : missesOnly ? LET_GO_MISSES_3_POLICY : DECAY_TIMING_POLICY };
}

export async function rule0029({ workers = 12 } = {}) {
  const validation = await validate0029(workers);
  const chosen = validation.constants;
  const seeds = RULE_0029.testSeeds;
  const rows = (await pool('season', seasonTasks(seeds, RULE_0029.worlds, ARMS, chosen, true), workers)).flat();
  const guardPolicies = [candidate('candidate', chosen), candidate('misses', chosen, LET_GO_MISSES_3_POLICY), { name: 'shipped', policy: DECAY_TIMING_POLICY, constants: SHIPPED }];
  const guardRows = await pool('guard', seeds.flatMap((seed) => Object.keys(RULE_0015.worlds).map((variant) => ({ seed, variant, policies: guardPolicies }))), workers);

  const guard = Object.fromEntries(Object.keys(RULE_0015.worlds).map((variant) => [variant, { seeds, perSeed: guardRows.filter((row) => row.variant === variant).map((row) => row.scores) }]));

  const slices = {
    all: (arm) => summarize(rows, arm),
    at25: (arm) => summarize(rows, arm, (t) => t.cell.words === 25),
  };

  const arms = [...ARMS, 'shipped'];

  const season = {
    all: Object.fromEntries(arms.map((arm) => [arm, slices.all(arm)])),
    at25: Object.fromEntries(arms.map((arm) => [arm, slices.at25(arm)])),
    byWords: Object.fromEntries(RULE_0029.words.map((w) => [w, Object.fromEntries(arms.map((arm) => [arm, summarize(rows, arm, (t) => t.cell.words === w)]))])),
    byPerDay: Object.fromEntries(RULE_0029.perDay.map((d) => [d, Object.fromEntries(arms.map((arm) => [arm, summarize(rows, arm, (t) => t.cell.perDay === d)]))])),
    bySkill: Object.fromEntries(SKILLS.map((s) => [s.name, Object.fromEntries(arms.map((arm) => [arm, summarize(rows, arm, (t) => t.cell.skill === s.name)]))])),
    byBadDays: Object.fromEntries(RULE_0029.badDays.map((b) => [b ? 'bad days' : 'no bad days', Object.fromEntries(arms.map((arm) => [arm, summarize(rows, arm, (t) => t.cell.badDays === b)]))])),
    byCell: CELLS.map((cell) => ({ cell, ...Object.fromEntries(arms.map((arm) => [arm, summarize(rows, arm, (t) => t.cell.index === cell.index)])) })),
  };

  const counted = (arm) => rows.filter((row) => row.arm === arm).reduce((sum, row) => sum + row.counted, 0);
  const uncounted = (arm) => rows.filter((row) => row.arm === arm).reduce((sum, row) => sum + row.uncounted, 0);
  const measuresList = [...RULE_0015.guards, 'slowPickUp', 'slowLetGo'];

  const guardMeans = Object.fromEntries(Object.entries(guard).map(([variant, result]) => [variant, Object.fromEntries(guardPolicies.map((p) => [p.name,
    Object.fromEntries(measuresList.map((m) => [m, mean(result.perSeed.map((seed) => seed[p.name][m]))]))]))]));

  const guardDiffs = Object.fromEntries(Object.entries(guard).map(([variant, result]) => [variant, Object.fromEntries(['candidate', 'misses'].map((name) => [name,
    Object.fromEntries(measuresList.map((m) => [m, paired(result, name, 'shipped', m)]))]))]));

  return { rule: '0029', validation, constants: chosen, seeds, targets: { normal: { counted: counted('normal'), uncounted: uncounted('normal') }, adaptive: { counted: counted('adaptive'), uncounted: uncounted('adaptive') } },
    season, guard: { means: guardMeans, differences: guardDiffs, perSeed: guard }, decision: decide0029(guard, season) };
}

const runs1 = (v) => (v === null || v === undefined ? '–' : fixed(1)(v));
const share = (w) => (w.share === null ? '–' : `${percent(w.share)} [${percent(w.low)}, ${percent(w.high)}] (${w.k}/${w.n})`);

export function report0029(record) {
  const { validation, season: s, guard, decision } = record;
  const kindName = { errors: 'misses', slow: 'pace' };

  const seasonRows = (label, read) => ['normal', 'adaptive', 'shipped'].flatMap((arm) => KINDS.flatMap((kind) => {
    const m = read(arm)?.[kind];

    return m && m.targets ? [[label, arm, kindName[kind], String(m.targets), runs1(m.runsToFixed.median), runs1(m.runsToFixed.p90), percent(m.runsToFixed.within10 ?? 0), share(m.falseLetGo), share(m.falseReturn),
      runs1(m.namedAgain.median), share(m.halvedLetGo), runs1(m.triesPerRun)]] : [];
  }));

  const header = ['slice', 'arm', 'kind', 'targets', 'to fixed', 'p90', '≤10', 'false let-go', 'false return', 'named again', 'halved read fixed', 'tries a run'];
  const diff = (d) => (d ? `${signed(4)(d.mean)} [${signed(4)(d.low)}, ${signed(4)(d.high)}]` : '–');

  return [
    `ADR 0029. Validation (seeds ${VALIDATION_SEEDS.join(', ')}).`,
    `R: ${validation.weakRatio.rows.map((r) => `${r.value}: false let-go ${percent(r.falseLetGo)}, to fixed at 25 words ${r.runsToFixed}`).join('; ')}. Chosen ${validation.weakRatio.chosen}.`,
    `q0: ${validation.slowShare.rows.map((r) => `${r.value}: false let-go ${percent(r.falseLetGo)}, to fixed at 25 words ${r.runsToFixed}`).join('; ')}. Chosen ${validation.slowShare.chosen}.`,
    `H: ${validation.returnOdds.rows.map((r) => `${r.returnOdds}: false return misses ${percent(r.falseReturn.errors ?? 0)}, pace ${percent(r.falseReturn.slow ?? 0)}, named again ${r.namedAgain}`).join('; ')}. Chosen ${validation.returnOdds.chosen}.`,
    `S: ${validation.drillLeanShare.rows.map((r) => `${r.value}: false let-go misses ${percent(r.falseLetGo.errors ?? 0)}, pace ${percent(r.falseLetGo.slow ?? 0)}, to fixed at 25 words ${r.runsToFixed} (pace ${r.runsToFixedPace}), tries a run ${runs1(r.tries.errors)}/${runs1(r.tries.slow)}`).join('; ')}. Chosen ${validation.drillLeanShare.chosen}.`,
    '',
    `Season, test seeds ${record.seeds[0]} to ${record.seeds.at(-1)}: normal arm ${record.targets.normal.counted} drilled targets counted (${record.targets.normal.uncounted} not queued before the drill), adaptive arm ${record.targets.adaptive.counted} (${record.targets.adaptive.uncounted}).`,
    table(header, [...seasonRows('all', (a) => s.all[a]), ...seasonRows('25 words', (a) => s.at25[a]),
      ...RULE_0029.words.flatMap((w) => seasonRows(`${w} words`, (a) => s.byWords[w][a])), ...RULE_0029.perDay.flatMap((d) => seasonRows(`${d} a day`, (a) => s.byPerDay[d][a])),
      ...SKILLS.flatMap((sk) => seasonRows(sk.name, (a) => s.bySkill[sk.name][a])), ...['no bad days', 'bad days'].flatMap((b) => seasonRows(b, (a) => s.byBadDays[b][a]))]),
    '',
    'Guard world, test seeds, paired differences A − shipped, mean [95% t interval].',
    table(['variant', 'A', ...RULE_0015.guards, 'slowPickUp', 'slowLetGo'], Object.entries(guard.differences).flatMap(([variant, byName]) => Object.entries(byName)
      .map(([name, d]) => [variant, name, ...[...RULE_0015.guards, 'slowPickUp', 'slowLetGo'].map((m) => diff(d[m]))]))),
    '',
    `Decision: (a) candidate ${decision.a.candidate.length ? `really worse on ${decision.a.candidate.join(', ')}` : 'really worse on none'}, misses-only ${decision.a.misses.length ? `really worse on ${decision.a.misses.join(', ')}` : 'really worse on none'}.`,
    `Clauses: ${Object.entries(decision.clauses).map(([k, v]) => `${k} ${v ? 'pass' : 'FAIL'}`).join(', ')}.`,
    `Default by ADR 0029: ${decision.default}. The app's DEFAULT_POLICY: ${DEFAULT_POLICY}.`,
  ].join('\n');
}

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);

  return at > 0 ? process.argv[at + 1] : fallback;
}

async function main() {
  const workers = Number(option('workers', 12));

  if (!Number.isSafeInteger(workers) || workers < 1) {
    console.error('--workers must be a positive integer');
    process.exitCode = 2;

    return;
  }

  if (process.argv.includes('--check')) {
    const rows = check0029(await validate0029(workers));

    for (const row of rows) console.log(`${row.ok ? 'pass' : 'FAIL'}  ${row.label}: ${row.detail}`);
    process.exitCode = rows.every((row) => row.ok) ? 0 : 1;

    return;
  }

  if (process.argv.includes('--validation-only')) {
    console.log(JSON.stringify(await validate0029(workers), null, 1));

    return;
  }

  const record = await rule0029({ workers });
  console.log(report0029(record));
  const json = option('json', null);

  if (json) writeFileSync(json, `${JSON.stringify(record, null, 1)}\n`);
}

if (isMainThread && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
