// Scores learner versions on real typing: the participants of the public 136M Keystrokes dataset, as the app's own
// run records (scripts/keystrokes-to-runs.mjs). For each participant, in the order typed, a version is fitted on
// their first k runs and predicts run k + 1. See docs/adr/0026-starting-view-from-public-keystrokes.md, which
// fixes the measures, the bands of k and the rule this serves.
//
//   bun run evaluate:start -- --runs <dir> --split validation [--limit 500] [--json out.json]
//   bun run evaluate:start -- --runs <dir> --split test --judge       (the test participants, read once, by the rule)
//
// What it shows: how well a version predicts and ranks a real person's next sentences in one sitting. It says
// nothing about practice over weeks, drills or forgetting, and nothing about whether anyone learns faster.

import { createReadStream, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';
import { DEFAULT_POLICY, LEAN_UNITS, LEARNER_VARIANTS, MISS_INTERVALS, fitLearner, learnerEvidence, learnerRecommendation } from '../src/learner.js';
import { calibration, seeded, timingRows } from './evaluate-learner.mjs';

export const KEYBOARD = 'physical-keyboard:qwerty';
export const BANDS = [{ name: '0', from: 0, to: 0 }, { name: '1-2', from: 1, to: 2 }, { name: '3-5', from: 3, to: 5 }, { name: '6-9', from: 6, to: 9 }, { name: '10-14', from: 10, to: 14 }];
export const RESAMPLES = 2000;
export const BOOTSTRAP_SEED = 513;
export const MEASURES = ['logLoss', 'paceError', 'captured', 'namedTopFour'];

const MS_PER_MINUTE = 60_000;
const CHARS_PER_WORD = 5;
const PROBABILITY_FLOOR = 1e-6;
const INTERVAL_LOW = 0.025;
const INTERVAL_HIGH = 0.975;

export const bandOf = (k) => BANDS.findIndex((band) => k >= band.from && k <= band.to);

// The versions compared. S0 is the shipped learner; ADR 0026's candidates are added here as they are built.
export const VERSIONS = [{ name: 'S0', variant: LEARNER_VARIANTS[DEFAULT_POLICY] }];

// The time each unit loses in a set of runs, in ms (ADR 0026, "captured share"). A pair loses its first-try misses
// at MISS_INTERVALS of the run's own interval each, plus its timed tries at its median less the run's median. A
// key loses only the misses outside a pair, at the start of a word. A unit that gains time loses none.
export function timeLost(runs) {
  const lost = new Map();
  const add = (unit, ms) => lost.set(unit, (lost.get(unit) ?? 0) + ms);

  for (const run of runs) {
    const interval = run.score?.wpm > 0 ? MS_PER_MINUTE / CHARS_PER_WORD / run.score.wpm : 0;
    const inPairs = new Map();

    for (const [pair, seen, errors, timed, , slowdownMs] of run.patterns ?? []) {
      add(pair, errors * MISS_INTERVALS * interval + (timed > 0 && slowdownMs !== null ? timed * slowdownMs : 0));
      const key = pair.charAt(1);
      const counted = inPairs.get(key) ?? { seen: 0, errors: 0 };
      inPairs.set(key, { seen: counted.seen + seen, errors: counted.errors + errors });
    }

    for (const [key, , errors] of run.keys ?? []) add(key, Math.max(0, errors - (inPairs.get(key)?.errors ?? 0)) * MISS_INTERVALS * interval);
  }

  return new Map([...lost].filter(([, ms]) => ms > 0));
}

// The share of the time lost that `units` hold, of what the best `units.length` (at most LEAN_UNITS) would hold.
// Null when nothing was lost.
export function capturedShare(units, lost) {
  const best = [...lost.values()].sort((a, b) => b - a).slice(0, LEAN_UNITS).reduce((sum, ms) => sum + ms, 0);

  return best > 0 ? units.slice(0, LEAN_UNITS).reduce((sum, unit) => sum + (lost.get(unit) ?? 0), 0) / best : null;
}

const topFour = (lost) => new Set([...lost].sort((a, b) => b[1] - a[1]).slice(0, LEAN_UNITS).map(([unit]) => unit));

// One participant under one version: for every k, the version fitted on the first k runs, read against run k + 1
// and against every run after k. Returns one row per k.
export function replayParticipant(runs, variant) {
  const rows = [];

  for (let k = 0; k < runs.length; k += 1) {
    const next = runs[k];
    const model = fitLearner(learnerEvidence(runs.slice(0, k), KEYBOARD), Date.parse(next.at), variant);
    const byUnit = new Map(model.units.map((estimate) => [estimate.unit, estimate]));
    const recommendation = learnerRecommendation(model);
    const predictions = [];
    let loss = 0;
    let tries = 0;

    for (const [pair, seen, errors] of next.patterns ?? []) {
      const p = Math.min(1 - PROBABILITY_FLOOR, Math.max(PROBABILITY_FLOOR, byUnit.get(pair)?.error.mean ?? model.errorRate));
      loss -= errors * Math.log(p) + (seen - errors) * Math.log(1 - p);
      tries += seen;
      predictions.push({ p, n: seen, e: errors });
    }

    let paceError = 0;
    let timed = 0;

    for (const [pair, n, ratio] of timingRows(next)) {
      paceError += n * Math.abs((byUnit.get(pair)?.slowdown ?? 0) - ratio);
      timed += n;
    }

    const lost = timeLost(runs.slice(k));

    rows.push({ k, loss, tries, predictions, paceError, timed, captured: capturedShare(recommendation.lean.map((item) => item.unit), lost),
      named: recommendation.target === null ? null : topFour(lost).has(recommendation.target) });
  }

  return rows;
}

// One participant's rows as one figure per band and measure, null where the band holds nothing to measure.
export function participantBands(rows) {
  return BANDS.map((_, band) => {
    const inBand = rows.filter((row) => bandOf(row.k) === band);
    const sum = (field) => inBand.reduce((total, row) => total + row[field], 0);
    const meanOf = (values) => (values.length ? values.reduce((total, value) => total + value, 0) / values.length : null);
    const tries = sum('tries');
    const timed = sum('timed');

    return { logLoss: tries ? sum('loss') / tries : null, paceError: timed ? sum('paceError') / timed : null,
      captured: meanOf(inBand.map((row) => row.captured).filter((value) => value !== null)),
      namedTopFour: meanOf(inBand.map((row) => row.named).filter((value) => value !== null).map(Number)) };
  });
}

// The mean of `values` with a 95% bootstrap interval over participants. Nulls are participants with nothing to
// measure in that band and are left out.
export function bootstrap(values, random) {
  const present = values.filter((value) => value !== null);

  if (!present.length) return { n: 0, mean: null, low: null, high: null };
  const mean = present.reduce((total, value) => total + value, 0) / present.length;

  const means = Array.from({ length: RESAMPLES }, () => {
    let total = 0;

    for (let i = 0; i < present.length; i += 1) total += present[Math.floor(random() * present.length)];

    return total / present.length;
  }).sort((a, b) => a - b);

  return { n: present.length, mean, low: means[Math.floor(INTERVAL_LOW * RESAMPLES)], high: means[Math.ceil(INTERVAL_HIGH * RESAMPLES) - 1] };
}

async function* participants(path, limit) {
  let read = 0;

  for await (const line of createInterface({ input: createReadStream(path).pipe(createGunzip()) })) {
    if (read >= limit) return;
    read += 1;
    yield JSON.parse(line);
  }
}

// Every version over every participant of a split: each measure per band as a mean with its interval, each
// candidate's paired difference from S0, and the pooled calibration error.
export async function evaluate(path, { versions = VERSIONS, limit = Infinity } = {}) {
  const figures = versions.map(() => []);
  const pooled = versions.map(() => BANDS.map(() => []));
  let count = 0;

  for await (const { runs } of participants(path, limit)) {
    count += 1;

    versions.forEach(({ variant }, index) => {
      const rows = replayParticipant(runs, variant);
      figures[index].push(participantBands(rows));

      for (const row of rows) pooled[index][bandOf(row.k)].push(...row.predictions);
    });
  }

  const random = seeded(BOOTSTRAP_SEED);
  const summary = (values) => bootstrap(values, random);

  return { participants: count, bands: BANDS.map((band) => band.name), versions: versions.map(({ name }, index) => ({
    name,
    measures: Object.fromEntries(MEASURES.map((measure) => [measure, BANDS.map((_, band) => summary(figures[index].map((bands) => bands[band][measure])))])),
    calibration: BANDS.map((_, band) => (pooled[index][band].length ? calibration(pooled[index][band]) : null)),
    againstS0: index === 0 ? null : Object.fromEntries(MEASURES.map((measure) => [measure, BANDS.map((_, band) => summary(figures[index].map((bands, person) => {
      const mine = bands[band][measure];
      const base = figures[0][person][band][measure];

      return mine === null || base === null ? null : mine - base;
    })))])),
  })) };
}

const FORMATS = { logLoss: (v) => v.toFixed(4), paceError: (v) => v.toFixed(4), captured: (v) => `${(100 * v).toFixed(1)}%`, namedTopFour: (v) => `${(100 * v).toFixed(1)}%` };
const cell = (format, { mean, low, high }) => (mean === null ? 'n/a' : `${format(mean)} [${format(low)}, ${format(high)}]`);

export function report(record) {
  const lines = [`${record.participants} participants. Mean over participants [95% bootstrap interval], by runs seen before the predicted run.`, ''];

  for (const version of record.versions) {
    lines.push(`${version.name}`, `| measure | ${record.bands.join(' | ')} |`, `| --- | ${record.bands.map(() => '---').join(' | ')} |`);

    for (const measure of MEASURES) lines.push(`| ${measure} | ${version.measures[measure].map((figure) => cell(FORMATS[measure], figure)).join(' | ')} |`);
    lines.push(`| calibration error | ${version.calibration.map((value) => (value === null ? 'n/a' : value.toFixed(4))).join(' | ')} |`,
      `| participants | ${version.measures.logLoss.map((figure) => figure.n).join(' | ')} |`, '');
  }

  return lines.join('\n');
}

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);

  return index === -1 ? fallback : process.argv[index + 1];
}

async function main() {
  const runs = option('runs', null);
  const split = option('split', 'validation');

  if (!runs) throw new Error('usage: --runs <dir of runs-<split>.jsonl.gz> [--split train|validation|test] [--limit n] [--json out.json]');

  if (split === 'test' && !process.argv.includes('--judge')) throw new Error('ADR 0026 reads the test participants once, after the constants are fixed: pass --judge to do that.');
  const record = { split, ...await evaluate(join(runs, `runs-${split}.jsonl.gz`), { limit: Number(option('limit', Infinity)) }) };
  const json = option('json', null);

  if (json) writeFileSync(json, `${JSON.stringify(record, null, 2)}\n`);
  console.log(report(record));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
