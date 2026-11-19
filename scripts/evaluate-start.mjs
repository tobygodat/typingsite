// Scores learner versions on real typing: the participants of the public 136M Keystrokes dataset, as the app's own
// run records (scripts/keystrokes-to-runs.mjs). For each participant, in the order typed, a version is fitted on
// their first k runs and predicts run k + 1. See docs/adr/0026-starting-view-from-public-keystrokes.md, which
// fixes the measures, the bands of k and the rule this serves.
//
//   bun run evaluate:start -- --runs <dir> --split validation [--limit 500] [--json out.json] [--views views.json]
//   bun run evaluate:start -- --runs <dir> --split test --judge --metadata metadata_participants.txt
//                                                    (the test participants, read once, by the rule)
//
// --views names a JSON list of { name, start }: each is the shipped learner with that starting view (StartingView in
// src/learner.ts), scored beside S0 and against it. --versions names learner versions in LEARNER_VARIANTS to score
// instead. --judge scores the four versions ADR 0026 names and prints its clauses (a), (a2), (b) and (c);
// (d), (e) and (f) are not read from this data. --metadata adds the slices the ADR reports.
//
// What it shows: how well a version predicts and ranks a real person's next sentences in one sitting. It says
// nothing about practice over weeks, drills or forgetting, and nothing about whether anyone learns faster.

import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';
import { DEFAULT_POLICY, LEAN_UNITS, LEARNER_VARIANTS, MISS_INTERVALS, START_MISSES_POLICY, START_PACE_POLICY, START_POLICY, START_RATE_POLICY, fitLearner, learnerEvidence,
  learnerRecommendation } from '../src/learner.js';
import { calibration, seeded, timingRows } from './evaluate-learner.mjs';

export const KEYBOARD = 'physical-keyboard:qwerty';
export const BANDS = [{ name: '0', from: 0, to: 0 }, { name: '1-2', from: 1, to: 2 }, { name: '3-5', from: 3, to: 5 }, { name: '6-9', from: 6, to: 9 }, { name: '10-14', from: 10, to: 14 }];
export const RESAMPLES = 2000;
export const BOOTSTRAP_SEED = 513;
export const MEASURES = ['logLoss', 'paceError', 'captured', 'namedTopFour'];
export const JUDGED = [START_RATE_POLICY, START_POLICY, START_MISSES_POLICY, START_PACE_POLICY];

// ADR 0026's margins. A guard fails only when the interval lies wholly beyond its margin on the worse side.
export const MARGINS = { logLoss: { ofS0: 0.005 }, paceError: { ofS0: 0.005 }, captured: { flat: 0.005 }, calibration: { flat: 0.002 } };
export const CAPTURED_GAIN = 0.02;
const HIGHER_IS_BETTER = new Set(['captured']);
const FIRST_BANDS = [0, 1];
const LATER_BANDS = [2, 3, 4];
const SLICED = ['logLoss', 'paceError', 'captured'];

const MS_PER_MINUTE = 60_000;
const CHARS_PER_WORD = 5;
const PROBABILITY_FLOOR = 1e-6;
const INTERVAL_LOW = 0.025;
const INTERVAL_HIGH = 0.975;

export const bandOf = (k) => BANDS.findIndex((band) => k >= band.from && k <= band.to);

// The versions compared: S0, the shipped learner, then the shipped learner with each starting view given.
export const versionsOf = (views = []) => [{ name: 'S0', variant: LEARNER_VARIANTS[DEFAULT_POLICY] },
  ...views.map(({ name, start }) => ({ name, variant: { ...LEARNER_VARIANTS[DEFAULT_POLICY], policy: name, start } }))];

// S0 and the named learner versions, each under its own name.
export const namedVersions = (names) => [{ name: 'S0', variant: LEARNER_VARIANTS[DEFAULT_POLICY] }, ...names.map((name) => {
  if (!LEARNER_VARIANTS[name]) throw new Error(`no learner version named ${name}`);

  return { name, variant: LEARNER_VARIANTS[name] };
})];

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

// A participant's slices from the dataset's metadata (ADR 0026: reported, deciding nothing).
export function slicesOf(metadata) {
  const [header, ...lines] = metadata.split('\n');
  const names = header.trim().split('\t');
  const at = (name) => names.indexOf(name);

  return new Map(lines.map((line) => {
    const fields = line.split('\t');

    return [fields[at('PARTICIPANT_ID')], [fields[at('NATIVE_LANGUAGE')] === 'en' ? 'native English' : 'not native English', `${fields[at('KEYBOARD_TYPE')]} keyboard`]];
  }));
}

const meanWpm = (runs) => runs.reduce((sum, run) => sum + (run.score?.wpm ?? 0), 0) / runs.length;

// Each participant's third of typing speed, by their mean wpm over the runs kept.
function speedThirds(speeds) {
  const sorted = [...speeds].sort((a, b) => a - b);
  const [slow, fast] = [sorted[Math.floor(sorted.length / 3)], sorted[Math.floor((2 * sorted.length) / 3)]];

  return speeds.map((wpm) => (wpm < slow ? 'slowest third' : wpm < fast ? 'middle third' : 'fastest third'));
}

// Every version over every participant of a split: each measure per band as a mean with its interval, the pooled
// calibration error, and each version's paired difference from S0 and from each version named in `bases`. With
// `slices` (participant id to labels), the difference from S0 within each slice as well.
export async function evaluate(path, { versions = versionsOf(), limit = Infinity, bases = [], slices = null } = {}) {
  const figures = versions.map(() => []);
  const pooled = versions.map(() => BANDS.map(() => []));
  const labels = [];
  const speeds = [];

  for await (const { id, runs } of participants(path, limit)) {
    labels.push(slices?.get(String(id)) ?? []);
    speeds.push(meanWpm(runs));

    versions.forEach(({ variant }, index) => {
      const rows = replayParticipant(runs, variant);
      figures[index].push(participantBands(rows));

      for (const row of rows) pooled[index][bandOf(row.k)].push(...row.predictions);
    });
  }

  const random = seeded(BOOTSTRAP_SEED);
  const summary = (values) => bootstrap(values, random);

  const less = (index, base, measures, keep = () => true) => Object.fromEntries(measures.map((measure) => [measure, BANDS.map((_, band) => summary(figures[index].map((bands, person) => {
    const mine = bands[band][measure];
    const theirs = figures[base][person][band][measure];

    return mine === null || theirs === null || !keep(person) ? null : mine - theirs;
  })))]));

  const baseIndexes = [0, ...versions.flatMap((version, index) => (index > 0 && bases.includes(version.name) ? [index] : []))];

  const record = { participants: labels.length, bands: BANDS.map((band) => band.name), versions: versions.map(({ name }, index) => ({
    name,
    measures: Object.fromEntries(MEASURES.map((measure) => [measure, BANDS.map((_, band) => summary(figures[index].map((bands) => bands[band][measure])))])),
    calibration: BANDS.map((_, band) => (pooled[index][band].length ? calibration(pooled[index][band]) : null)),
    against: Object.fromEntries(baseIndexes.flatMap((base) => (base < index ? [[versions[base].name, less(index, base, MEASURES)]] : []))),
  })) };

  if (slices) {
    const thirds = speedThirds(speeds);
    const all = labels.map((own, person) => [...own, thirds[person]]);

    record.slices = [...new Set(all.flat())].sort().map((label) => ({ label, participants: all.filter((own) => own.includes(label)).length,
      lessS0: Object.fromEntries(versions.slice(1).map(({ name }, at) => [name, less(at + 1, 0, SLICED, (person) => all[person].includes(label))])) }));
  }

  return record;
}

const beyond = ({ low, high }, margin, higherIsBetter) => (higherIsBetter ? high < -margin : low > margin);
const better = ({ low, high }, higherIsBetter) => (higherIsBetter ? low > 0 : high < 0);
const marginOf = (measure, s0, band) => MARGINS[measure].flat ?? MARGINS[measure].ofS0 * s0.measures[measure][band].mean;

// ADR 0026's clauses that this data decides, for one judged version. `first` is the measure clause (a) reads: log
// loss, or pace error for the pace-only version. "Better" is an interval wholly on the better side of zero;
// "worse" is one wholly beyond the margin on the worse side.
export function judge(record, name, first = 'logLoss') {
  const s0 = record.versions[0];
  const version = record.versions.find((item) => item.name === name);
  const lessS0 = version.against.S0;
  const lessRate = version.against[START_RATE_POLICY];
  const a = FIRST_BANDS.every((band) => better(lessS0[first][band], false));
  const a2 = lessRate ? better(lessRate.logLoss[1], false) || better(lessRate.captured[1], true) : null;
  const b = better(lessS0.captured[1], true) && lessS0.captured[1].mean >= CAPTURED_GAIN;

  const worse = LATER_BANDS.flatMap((band) => [
    ...['logLoss', 'paceError', 'captured'].filter((measure) => beyond(lessS0[measure][band], marginOf(measure, s0, band), HIGHER_IS_BETTER.has(measure))),
    ...(version.calibration[band] - s0.calibration[band] > MARGINS.calibration.flat ? ['calibration'] : []),
  ].map((measure) => `${measure} in ${record.bands[band]}`));

  return { name, a, a2, b, c: worse.length === 0, worse };
}

const FORMATS = { logLoss: (v) => v.toFixed(4), paceError: (v) => v.toFixed(4), captured: (v) => `${(100 * v).toFixed(1)}%`, namedTopFour: (v) => `${(100 * v).toFixed(1)}%` };
const signed = (format) => (v) => `${v > 0 ? '+' : ''}${format(v)}`;
const SIGNED = Object.fromEntries(Object.entries(FORMATS).map(([measure, format]) => [measure, signed(format)]));
const cell = (format, { mean, low, high }) => (mean === null ? 'n/a' : `${format(mean)} [${format(low)}, ${format(high)}]`);

export function report(record) {
  const lines = [`${record.participants} participants. Mean over participants [95% bootstrap interval], by runs seen before the predicted run.`, ''];

  for (const version of record.versions) {
    lines.push(`${version.name}`, `| measure | ${record.bands.join(' | ')} |`, `| --- | ${record.bands.map(() => '---').join(' | ')} |`);

    for (const measure of MEASURES) lines.push(`| ${measure} | ${version.measures[measure].map((figure) => cell(FORMATS[measure], figure)).join(' | ')} |`);
    lines.push(`| calibration error | ${version.calibration.map((value) => (value === null ? 'n/a' : value.toFixed(4))).join(' | ')} |`,
      `| participants | ${version.measures.logLoss.map((figure) => figure.n).join(' | ')} |`, '');

    for (const [base, less] of Object.entries(version.against)) {
      lines.push(`${version.name} less ${base}`, `| measure | ${record.bands.join(' | ')} |`, `| --- | ${record.bands.map(() => '---').join(' | ')} |`);

      for (const measure of MEASURES) lines.push(`| ${measure} | ${less[measure].map((figure) => cell(SIGNED[measure], figure)).join(' | ')} |`);
      lines.push('');
    }
  }

  for (const slice of record.slices ?? []) {
    lines.push(`${slice.label} (${slice.participants} participants), less S0`, `| version, measure | ${record.bands.join(' | ')} |`, `| --- | ${record.bands.map(() => '---').join(' | ')} |`);

    for (const [name, less] of Object.entries(slice.lessS0)) {
      for (const measure of SLICED) lines.push(`| ${name}, ${measure} | ${less[measure].map((figure) => cell(SIGNED[measure], figure)).join(' | ')} |`);
    }

    lines.push('');
  }

  for (const verdict of record.verdicts ?? []) {
    const word = (pass) => (pass === null ? 'n/a' : pass ? 'holds' : 'fails');

    lines.push(`${verdict.name}: (a) ${word(verdict.a)}, (a2) ${word(verdict.a2)}, (b) ${word(verdict.b)}, (c) ${word(verdict.c)}${verdict.worse.length ? ` (worse: ${verdict.worse.join(', ')})` : ''}`);
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
  const judged = process.argv.includes('--judge');
  const views = option('views', null);
  const named = judged ? JUDGED : option('versions', '').split(',').filter(Boolean);
  const versions = named.length ? namedVersions(named) : versionsOf(views ? JSON.parse(readFileSync(views, 'utf8')) : []);
  const metadata = option('metadata', null);

  const record = { split, ...await evaluate(join(runs, `runs-${split}.jsonl.gz`), { versions, limit: Number(option('limit', Infinity)),
    bases: [START_RATE_POLICY], slices: metadata ? slicesOf(readFileSync(metadata, 'utf8')) : null }) };

  if (judged) record.verdicts = JUDGED.map((name) => judge(record, name, name === START_PACE_POLICY ? 'paceError' : 'logLoss'));
  const json = option('json', null);

  if (json) writeFileSync(json, `${JSON.stringify(record, null, 2)}\n`);
  console.log(report(record));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
