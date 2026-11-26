// Simulation and evaluation harness for ADR 0028: Progress's "slipping" rule from day-level variation (TOB-511).
// Deterministic from its seeds. Validation seeds (9101, 9102) choose design and thresholds before ADR 0028 is
// committed; held-out test seeds (601..630) run once after the rule is committed.
//
//   node --import tsx scripts/evaluate-slipping.mjs --validation-only [--workers 8]
//   node --import tsx scripts/evaluate-slipping.mjs --test [--json docs/adr/0028-evaluation.json] [--workers 8]

import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CORPUS_VERSION, METRIC_VERSION, makePassage } from '../src/typing.js';
import { dayKey, retainRuns } from '../src/insights.js';
import { DEFAULT_POLICY, LEARNER_VARIANTS, englishFrequency, fitLearner, keyboardOf, learnerEvidence, learnerRecommendation } from '../src/learner.js';
import { FIXED_OBSERVATIONS, FIXED_RUNS } from '../src/train-path.js';
import { weekStart } from '../src/week-change.js';
import { SKILLS, gaussian, logit, pairsByFrequency, seeded, sigmoid } from './evaluate-learner.mjs';

const CONDITIONS = {
  mode: 'words', count: 25, punctuation: false, numbers: false, wordList: '200', inputClass: 'physical-keyboard',
  correctionPolicy: 'relaxed', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty',
};

const KEYBOARD = keyboardOf(CONDITIONS);

// Local calendar reference: Wednesday noon, 21-day history (14 days before `began`, 7 days in this week).
const NOW_DATE = new Date(2026, 10, 11, 12, 0, 0);
const NOW = NOW_DATE.getTime();
const BEGAN = weekStart(NOW_DATE);
const HISTORY_DAYS = 21;

export const VALIDATION_SEEDS = [9101, 9102];
export const TEST_SEEDS = Array.from({ length: 30 }, (_, i) => 601 + i);

// Volume shapes from light (1 run/day, 10-25 words) to heavy (30,000 words/week), plus bursty.
// Note: heavy-30k uses 10 runs/day × 430 words (≈30,100 words/week) so 70 runs/week leaves ~50 runs (5 days)
// before `began` inside Stilltype's 120-run pattern cap, while heavy-15x100 tests 15 runs/day × 100 words
// (≈10,500 words/week, heavily pushing the 120-run cap to ~15 pre-week runs).
export const VOLUMES = [
  { name: 'light-10', perDay: 1, words: 10, burst: 1, skip: 0 },
  { name: 'light-25', perDay: 1, words: 25, burst: 1, skip: 0.15 },
  { name: 'medium', perDay: 4, words: 25, burst: 1, skip: 0.1 },
  { name: 'heavy-15x100', perDay: 15, words: 100, burst: 1, skip: 0 },
  { name: 'heavy-30k', perDay: 10, words: 430, burst: 1, skip: 0 },
  { name: 'bursty-week', perDay: 3, words: 40, burst: 3, skip: 0.2 },
];

// Null regimes (NO true multi-day slip; any reported slip is a false-slip week) and Alternative regimes (real slips).
export const REGIMES = [
  { name: 'null-stationary', kind: 'null', badDayChance: 0, badDayShift: 0, badDayBurst: 1, daySigma: 0, runSigma: 0, hiccup: false, globalBadWeek: 0 },
  { name: 'null-uneven-bad-days', kind: 'null', badDayChance: 0.25, badDayShift: 1.0, badDayBurst: 2.2, daySigma: 0, runSigma: 0, hiccup: false, globalBadWeek: 0 },
  { name: 'null-overdispersed', kind: 'null', badDayChance: 0.25, badDayShift: 0.9, badDayBurst: 1.8, daySigma: 0.40, runSigma: 0.30, hiccup: false, globalBadWeek: 0 },
  { name: 'null-single-day-hiccup', kind: 'null', badDayChance: 0.20, badDayShift: 0.8, badDayBurst: 1.5, daySigma: 0.25, runSigma: 0.20, hiccup: true, globalBadWeek: 0 },
  { name: 'null-global-bad-week', kind: 'null', badDayChance: 0.20, badDayShift: 0.8, badDayBurst: 1.5, daySigma: 0.25, runSigma: 0.20, hiccup: false, globalBadWeek: 0.8 },
  { name: 'alt-1pair-strong', kind: 'alt', badDayChance: 0.25, badDayShift: 0.9, badDayBurst: 1.8, daySigma: 0.25, runSigma: 0.20, slipPairs: 1, slipShift: 2.0, slipDays: 7 },
  { name: 'alt-1pair-moderate', kind: 'alt', badDayChance: 0.25, badDayShift: 0.9, badDayBurst: 1.8, daySigma: 0.25, runSigma: 0.20, slipPairs: 1, slipShift: 1.5, slipDays: 7 },
  { name: 'alt-coslip-2', kind: 'alt', badDayChance: 0.25, badDayShift: 0.9, badDayBurst: 1.8, daySigma: 0.25, runSigma: 0.20, slipPairs: 2, slipShift: 1.9, slipDays: 7 },
  { name: 'alt-coslip-4', kind: 'alt', badDayChance: 0.25, badDayShift: 0.9, badDayBurst: 1.8, daySigma: 0.25, runSigma: 0.20, slipPairs: 4, slipShift: 1.9, slipDays: 7 },
  { name: 'alt-4day-slip', kind: 'alt', badDayChance: 0.25, badDayShift: 0.9, badDayBurst: 1.8, daySigma: 0.25, runSigma: 0.20, slipPairs: 1, slipShift: 2.0, slipDays: 4 },
  { name: 'alt-key-slip', kind: 'alt', badDayChance: 0.25, badDayShift: 0.9, badDayBurst: 1.8, daySigma: 0.25, runSigma: 0.20, slipKey: true, slipShift: 1.5, slipDays: 7 },
];

const ALL_PAIRS = pairsByFrequency();
const COMMON_PAIRS = ALL_PAIRS.slice(0, 30);
const MIDDLE_PAIRS = ALL_PAIRS.slice(30, 80);
const COMMON_KEYS = [...englishFrequency().keys].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k);

// Fast passage typing using Stilltype's own makePassage, producing exact summary patterns + keys (coupled as in typing.ts)
// and retaining the newest MAX_PATTERN_RUNS runs as the app does.
function simulateWeek(seed, volume, skill, regime) {
  const random = seeded(seed);
  const baseLogit = logit(skill.errorRate);
  const pairBase = new Map(ALL_PAIRS.map((pair) => [pair, baseLogit + 0.35 * gaussian(random)]));
  const keyBase = new Map([...englishFrequency().keys.keys()].map((k) => [k, baseLogit + 0.25 * gaussian(random)]));

  const planted = [];

  if (regime.slipPairs) {
    const pool = [...COMMON_PAIRS, ...MIDDLE_PAIRS.slice(0, 20)];

    while (planted.length < regime.slipPairs) {
      const candidate = pool[Math.floor(random() * (planted.length === 0 ? COMMON_PAIRS.length : pool.length))];

      if (!planted.includes(candidate)) planted.push(candidate);
    }
  } else if (regime.slipKey) {
    planted.push(COMMON_KEYS[Math.floor(random() * COMMON_KEYS.length)]);
  }

  const hiccupPair = regime.hiccup ? COMMON_PAIRS[Math.floor(random() * COMMON_PAIRS.length)] : null;
  const hiccupDay = regime.hiccup ? Math.floor(random() * 7) : -1;

  const runs = [];
  const plantedSet = new Set(planted);
  const plantedKey = regime.slipKey ? planted[0] : null;

  for (let back = HISTORY_DAYS - 1; back >= 0; back -= 1) {
    const inThisWeek = back <= 6;

    if (volume.skip > 0 && random() < volume.skip && back !== 0) continue;
    const isBadDay = regime.badDayChance > 0 && random() < regime.badDayChance;
    const dayShift = (isBadDay ? regime.badDayShift * (0.7 + 0.6 * random()) : 0) + (inThisWeek ? (regime.globalBadWeek || 0) : 0);

    let expectedRuns = volume.perDay * (inThisWeek ? volume.burst : 1);

    if (isBadDay && regime.badDayBurst > 1) expectedRuns *= random() < 0.6 ? regime.badDayBurst : 0.7;
    const nRuns = Math.max(1, Math.round(expectedRuns * (0.7 + 0.6 * random())));

    const dayWobble = new Map();

    if (regime.daySigma > 0) {
      for (const pair of ALL_PAIRS) dayWobble.set(pair, regime.daySigma * gaussian(random));
    }

    const slipActiveToday = inThisWeek && back < (regime.slipDays || 0);
    const hiccupToday = inThisWeek && back === hiccupDay;

    for (let r = 0; r < nRuns; r += 1) {
      const when = new Date(2026, 10, 11 - back, 8 + Math.floor((r / Math.max(1, nRuns)) * 12), (r * 7) % 60);

      if (when.getTime() > NOW) continue;
      const text = makePassage('words', volume.words, false, random, CONDITIONS.wordList);
      const pairCounts = new Map();
      const keyCounts = new Map();
      const runWobble = regime.runSigma > 0 ? new Map() : null;

      for (let i = 0; i < text.length; i += 1) {
        const char = text[i];

        if (!/[a-z]/.test(char)) continue;
        const pair = i > 0 && /^[a-z]$/.test(text[i - 1]) ? text.slice(i - 1, i + 1) : null;
        let eta = (pair ? (pairBase.get(pair) ?? baseLogit) : (keyBase.get(char) ?? baseLogit)) + dayShift;

        if (pair && regime.daySigma > 0) eta += dayWobble.get(pair) ?? 0;

        if (pair && runWobble) {
          if (!runWobble.has(pair)) runWobble.set(pair, regime.runSigma * gaussian(random));
          eta += runWobble.get(pair);
        }

        if (slipActiveToday && pair && plantedSet.has(pair)) eta += regime.slipShift;

        if (slipActiveToday && plantedKey && char === plantedKey) eta += regime.slipShift;

        if (hiccupToday && pair === hiccupPair) eta += 2.2;

        const miss = random() < sigmoid(eta) ? 1 : 0;

        if (pair) {
          const cur = pairCounts.get(pair) || [0, 0];
          cur[0] += 1;
          cur[1] += miss;
          pairCounts.set(pair, cur);
        }

        const kcur = keyCounts.get(char) || [0, 0];
        kcur[0] += 1;
        kcur[1] += miss;
        keyCounts.set(char, kcur);
      }

      const patterns = [...pairCounts.entries()].map(([pair, [seen, errors]]) => [pair, seen, errors, seen, 200, 0]);
      const keys = [...keyCounts.entries()].map(([k, [seen, errors]]) => [k, seen, errors]);

      runs.push({
        id: `s${seed}-${runs.length}`, at: when.toISOString(), day: dayKey(when), kind: 'test', status: 'complete', interrupted: false, fresh: true,
        conditions: { ...CONDITIONS, count: volume.words }, elapsedMs: volume.words * 1000, score: { wpm: 70, accuracy: 96 }, patterns, keys, keysVersion: 1,
      });
    }
  }

  return { runs: retainRuns(runs), planted, plantedKey };
}

// --- Baseline from commit 7b078cfd (pooled tries + Fisher noncentral hypergeometric vs week odds) ---
function chanceOfRise7b07(before, after, odds = 1) {
  const [misses, clean] = [before.errors + after.errors, before.tries + after.tries - before.errors - after.errors];
  const [lo, hi] = [Math.max(0, after.tries - clean), Math.min(misses, after.tries)];

  if (after.errors <= lo) return 1;

  if (after.errors > hi) return 0;
  const logOdds = Math.log(odds);
  const logs = [0];

  for (let k = lo + 1; k <= hi; k += 1) {
    logs.push(logs.at(-1) + Math.log(((misses - k + 1) * (after.tries - k + 1)) / (k * (clean - after.tries + k))) + logOdds);
  }

  const peak = Math.max(...logs);
  const weights = logs.map((value) => Math.exp(value - peak));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const tail = weights.slice(after.errors - lo).reduce((sum, weight) => sum + weight, 0);

  return Math.min(1, tail / total);
}

export function detectSlips7b07(records, began, queuedNow) {
  const tallies = new Map();
  const pairs = { before: { tries: 0, errors: 0 }, after: { tries: 0, errors: 0 } };

  for (const record of records) {
    if (record.at === null) continue;
    const side = record.at < began ? 'before' : 'after';

    for (const { unit, seen, errors } of record.units) {
      if (!(seen > 0)) continue;
      const t = tallies.get(unit) || { before: { tries: 0, errors: 0, runs: 0 }, after: { tries: 0, errors: 0, runs: 0 } };
      t[side].tries += seen;
      t[side].errors += errors;
      t[side].runs += 1;
      tallies.set(unit, t);

      if (unit.length === 2) { pairs[side].tries += seen; pairs[side].errors += errors; }
    }
  }

  const readable = ({ before, after }) => before.tries >= FIXED_OBSERVATIONS && after.tries >= FIXED_OBSERVATIONS && after.runs >= FIXED_RUNS;
  const family = [...tallies.values()].filter(readable).length;

  if (!family) return [];
  const slipped = [];

  for (const [unit, { before, after }] of tallies) {
    if (!queuedNow.has(unit) || !readable({ before, after })) continue;

    if (!(after.errors / after.tries > before.errors / before.tries)) continue;
    const own = unit.length === 2 ? { before, after } : { before: { tries: 0, errors: 0 }, after: { tries: 0, errors: 0 } };
    const was = { tries: pairs.before.tries - own.before.tries, errors: pairs.before.errors - own.before.errors };
    const now = { tries: pairs.after.tries - own.after.tries, errors: pairs.after.errors - own.after.errors };
    const pooled = (was.errors + now.errors) / Math.max(1, was.tries + now.tries);
    const rate = (s) => (s.errors + FIXED_OBSERVATIONS * pooled) / (s.tries + FIXED_OBSERVATIONS);
    const odds = pooled > 0 ? Math.max(1, (rate(now) / (1 - rate(now))) / (rate(was) / (1 - rate(was)))) : 1;

    if (chanceOfRise7b07(before, after, odds) < 0.02 / family) slipped.push(unit);
  }

  return slipped;
}

// --- Candidate Day-Level Variation Slip Rule (Before-Dispersion Moderated Score + Leave-One-Day-Out) ---
function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);

  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806
    + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));

  return x >= 0 ? r : 2 - r;
}

const normalUpperTail = (z) => (z <= 0 ? 1 : 0.5 * erfc(z / Math.SQRT2));

function logGamma(z) {
  const g = 7;

  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];

  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  let x = c[0];
  const zm = z - 1;

  for (let i = 1; i < g + 2; i += 1) x += c[i] / (zm + i);
  const t = zm + g + 0.5;

  return 0.5 * Math.log(2 * Math.PI) + (zm + 0.5) * Math.log(t) - t + Math.log(x);
}

function betacf(a, b, x) {
  const maxIter = 200;
  const eps = 3e-12;
  const fpmin = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);

  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= maxIter; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;

    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;

    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    h *= d * c;
    aa = -((a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;

    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;

    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const del = d * c;
    h *= del;

    if (Math.abs(del - 1) < eps) break;
  }

  return h;
}

function tUpperTail(t, df) {
  if (!(t > 0)) return 1;

  if (!Number.isFinite(df) || df > 1e5) return normalUpperTail(t);
  const x = df / (df + t * t);
  const a = df / 2;
  const b = 0.5;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  const ib = x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;

  return 0.5 * ib;
}

const clampRate = (p) => Math.min(0.99, Math.max(0.002, p));

function solveProfileTheta(days, totalErrors) {
  const totalTries = days.reduce((s, d) => s + d.seen, 0);

  if (totalErrors <= 0) return -12;

  if (totalErrors >= totalTries) return 12;
  let lo = -12;
  let hi = 12;
  let theta = logit(clampRate(totalErrors / totalTries));

  for (let iter = 0; iter < 16; iter += 1) {
    let f = -totalErrors;
    let df = 0;

    for (const d of days) {
      const p = sigmoid(theta + d.delta);
      f += d.seen * p;
      df += d.seen * p * (1 - p);
    }

    if (Math.abs(f) < 1e-9) break;

    if (f > 0) hi = theta;
    else lo = theta;
    const next = df > 1e-12 ? theta - f / df : (lo + hi) / 2;
    theta = next > lo && next < hi ? next : (lo + hi) / 2;
  }

  return theta;
}

export function detectSlipsDayLevel(records, began, queuedNow, params) {
  const { alpha = 0.02, priorDf = 16, lodoZ = 1.8, minDays = 2 } = params;

  const dayMap = new Map();

  for (const record of records) {
    if (record.at === null) continue;
    const side = record.at < began ? 'before' : 'after';
    const key = `${side}:${dayKey(new Date(record.at))}`;
    let day = dayMap.get(key);

    if (!day) {
      day = { key, side, pairTries: 0, pairErrors: 0, units: new Map() };
      dayMap.set(key, day);
    }

    for (const { unit, seen, errors } of record.units) {
      if (!(seen > 0)) continue;
      const cur = day.units.get(unit) || { seen: 0, errors: 0 };
      cur.seen += seen;
      cur.errors += errors;
      day.units.set(unit, cur);

      if (unit.length === 2) {
        day.pairTries += seen;
        day.pairErrors += errors;
      }
    }
  }

  const allDays = [...dayMap.values()];

  if (!allDays.length) return { slipped: [], readable: new Set() };

  const unitDays = new Map();
  let totalPairTries = 0;
  let totalPairErrors = 0;

  for (const day of allDays) {
    totalPairTries += day.pairTries;
    totalPairErrors += day.pairErrors;

    for (const [unit, counts] of day.units) {
      let entry = unitDays.get(unit);

      if (!entry) {
        entry = { beforeTries: 0, beforeErrors: 0, beforeDays: 0, afterTries: 0, afterErrors: 0, afterDays: 0, days: [] };
        unitDays.set(unit, entry);
      }

      if (day.side === 'before') { entry.beforeTries += counts.seen; entry.beforeErrors += counts.errors; entry.beforeDays += 1; }
      else { entry.afterTries += counts.seen; entry.afterErrors += counts.errors; entry.afterDays += 1; }

      entry.days.push({ day, side: day.side, seen: counts.seen, errors: counts.errors });
    }
  }

  const isReadable = (e) => e.beforeTries >= FIXED_OBSERVATIONS && e.afterTries >= FIXED_OBSERVATIONS && e.beforeDays >= minDays && e.afterDays >= minDays;
  const readableUnits = [...unitDays.entries()].filter(([, e]) => isReadable(e));
  const readableSet = new Set(readableUnits.map(([u]) => u));
  const family = readableUnits.length;

  if (!family) return { slipped: [], readable: readableSet };

  const dayShiftsFor = (unit, entry) => {
    const restTotalTries = unit.length === 2 ? totalPairTries - (entry.beforeTries + entry.afterTries) : totalPairTries;
    const restTotalErrors = unit.length === 2 ? totalPairErrors - (entry.beforeErrors + entry.afterErrors) : totalPairErrors;
    const b0 = clampRate(restTotalErrors / Math.max(1, restTotalTries));
    const logitB0 = logit(b0);

    const raw = entry.days.map((d) => {
      const ownT = unit.length === 2 ? d.seen : 0;
      const ownE = unit.length === 2 ? d.errors : 0;
      const rT = Math.max(0, d.day.pairTries - ownT);
      const rE = Math.max(0, d.day.pairErrors - ownE);
      const bd = clampRate((rE + FIXED_OBSERVATIONS * b0) / (rT + FIXED_OBSERVATIONS));

      return { ...d, delta: logit(bd) - logitB0 };
    });

    const wMean = (side) => {
      const part = raw.filter((d) => d.side === side);
      const w = part.reduce((s, d) => s + d.seen, 0);

      return w > 0 ? part.reduce((s, d) => s + d.seen * d.delta, 0) / w : 0;
    };

    const bump = Math.max(0, wMean('before') - wMean('after'));

    return bump > 0 ? raw.map((d) => (d.side === 'after' ? { ...d, delta: d.delta + bump } : d)) : raw;
  };

  // Estimate keyboard-wide day-level overdispersion tau^2 from BEFORE days (pairs only, uncontaminated by slips).
  let num = 0;
  let den = 0;

  for (const [unit, entry] of readableUnits) {
    if (unit.length !== 2 || entry.beforeDays < 3) continue;
    const shifts = dayShiftsFor(unit, entry).filter((d) => d.side === 'before');
    const theta = solveProfileTheta(shifts, entry.beforeErrors);
    const dfCorr = shifts.length / Math.max(1, shifts.length - 1);

    for (const d of shifts) {
      const p = sigmoid(theta + d.delta);
      const v = d.seen * p * (1 - p);
      const x = d.errors - d.seen * p;
      num += dfCorr * x * x - v;
      den += v * v;
    }
  }

  const tau2 = den > 0 ? Math.max(0, num / den) : 0;
  const threshold = alpha / family;
  const slipped = [];

  for (const [unit, entry] of readableUnits) {
    if (queuedNow && !queuedNow.has(unit)) continue;

    if (!(entry.afterErrors / entry.afterTries > entry.beforeErrors / entry.beforeTries)) continue;
    const shifts = dayShiftsFor(unit, entry);
    const theta = solveProfileTheta(shifts, entry.beforeErrors + entry.afterErrors);

    const afterDays = [];
    const beforeDays = [];
    let S = 0;
    let VA = 0;
    let VB = 0;

    for (const d of shifts) {
      const p = sigmoid(theta + d.delta);
      const v = d.seen * p * (1 - p);
      const x = d.errors - d.seen * p;

      if (d.side === 'after') { S += x; VA += v; afterDays.push({ ...d, x, v }); }
      else { VB += v; beforeDays.push({ ...d, x, v }); }
    }

    if (!(S > 0) || !(VA > 0) || !(VB > 0)) continue;

    if (afterDays.filter((d) => d.x > 0).length < 2) continue;

    // Unit's own BEFORE-day dispersion, moderated toward keyboard-wide tau^2 with prior df `priorDf`.
    const dB = beforeDays.length;
    const dfU = Math.max(0, dB - 1);
    let tau2Mod = tau2;

    if (dfU >= 1) {
      const thetaB = solveProfileTheta(beforeDays, entry.beforeErrors);
      const corrB = dB / dfU;
      let numU = 0;
      let denU = 0;

      for (const d of beforeDays) {
        const p = sigmoid(thetaB + d.delta);
        const v = d.seen * p * (1 - p);
        const x = d.errors - d.seen * p;
        numU += corrB * x * x - v;
        denU += v * v;
      }

      const tau2U = denU > 0 ? Math.max(0, numU / denU) : 0;
      tau2Mod = Math.max(tau2, (priorDf * tau2 + dfU * tau2U) / (priorDf + dfU));
    }

    const Vtot = VA + VB;
    const wA = VB / Vtot;
    const wB = VA / Vtot;
    const Vbinom = (VA * VB) / Vtot;
    const VAmod = afterDays.reduce((s, d) => s + d.v + tau2Mod * d.v * d.v, 0);
    const VBmod = beforeDays.reduce((s, d) => s + d.v + tau2Mod * d.v * d.v, 0);
    const Vmod = Math.max(Vbinom, wA * wA * VAmod + wB * wB * VBmod);

    if (!(tUpperTail(S / Math.sqrt(Vmod), priorDf + dfU) < threshold)) continue;

    // Leave-one-day-out guard: drop the single after-day with largest excess x_d; remaining after-days must hold z >= lodoZ.
    if (lodoZ > 0) {
      let worstIdx = 0;

      for (let i = 1; i < afterDays.length; i += 1) {
        if (afterDays[i].x > afterDays[worstIdx].x) worstIdx = i;
      }

      const keepDays = [...beforeDays, ...afterDays.filter((_, i) => i !== worstIdx)];
      const keepErrors = keepDays.reduce((s, d) => s + d.errors, 0);
      const thL = solveProfileTheta(keepDays, keepErrors);
      let SL = 0;
      let VAL = 0;
      let VBL = 0;
      let VALm = 0;
      let VBLm = 0;

      for (const d of keepDays) {
        const p = sigmoid(thL + d.delta);
        const v = d.seen * p * (1 - p);
        const x = d.errors - d.seen * p;
        const vm = v + tau2Mod * v * v;

        if (d.side === 'after') { SL += x; VAL += v; VALm += vm; }
        else { VBL += v; VBLm += vm; }
      }

      if (!(SL > 0) || !(VAL > 0) || !(VBL > 0)) continue;
      const VtL = VAL + VBL;
      const wAL = VBL / VtL;
      const wBL = VAL / VtL;
      const VmL = Math.max((VAL * VBL) / VtL, wAL * wAL * VALm + wBL * wBL * VBLm);

      if (SL / Math.sqrt(VmL) < lodoZ) continue;
    }

    slipped.push(unit);
  }

  return { slipped, readable: readableSet };
}

function evalCell({ seed, volume, skill, regime, detectors, weeksPerCell }) {
  const results = Object.fromEntries(detectors.map((d) => [d.name, {
    weeks: 0, falseSlipWeeks: 0, plantedDetected: 0, plantedTotal: 0, readablePlantedDetected: 0, readablePlantedTotal: 0, extraFalseWeeks: 0,
  }]));

  const variant = LEARNER_VARIANTS[DEFAULT_POLICY];

  for (let w = 0; w < weeksPerCell; w += 1) {
    const runSeed = seed * 100_003 + volume.index * 1009 + skill.index * 97 + regime.index * 13 + w * 7919;
    const { runs, planted, plantedKey } = simulateWeek(runSeed, volume, skill, regime);
    const records = learnerEvidence(runs, KEYBOARD);
    const modelNow = fitLearner(records, NOW, variant, 'balanced');
    const queuedNow = new Set(learnerRecommendation(modelNow).queue.map((item) => item.unit));
    const plantedSet = new Set(planted);
    const affected = (u) => plantedSet.has(u) || Boolean(plantedKey && u.length === 2 && u.charAt(1) === plantedKey);

    for (const det of detectors) {
      const outObj = det.kind === '7b07' ? { slipped: detectSlips7b07(records, BEGAN, queuedNow), readable: null } : detectSlipsDayLevel(records, BEGAN, queuedNow, det.params);
      const out = outObj.slipped;
      const r = results[det.name];
      r.weeks += 1;

      if (regime.kind === 'null') {
        if (out.length > 0) r.falseSlipWeeks += 1;
      } else {
        const hits = out.filter((u) => plantedSet.has(u)).length;
        const extras = out.filter((u) => !affected(u)).length;
        r.plantedDetected += hits;
        r.plantedTotal += planted.length;

        if (outObj.readable) {
          for (const p of planted) {
            if (outObj.readable.has(p)) {
              r.readablePlantedTotal += 1;

              if (out.includes(p)) r.readablePlantedDetected += 1;
            }
          }
        }

        if (extras > 0) r.extraFalseWeeks += 1;
      }
    }
  }

  return { volume: volume.name, skill: skill.name, regime: regime.name, kind: regime.kind, results };
}

if (!isMainThread) {
  parentPort.on('message', ({ id, task }) => parentPort.postMessage({ id, result: evalCell(task) }));
}

async function runPool(tasks, workers) {
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
      thread.postMessage({ id, task: tasks[id] });
    };

    thread.on('message', ({ id, result }) => { results[id] = result; send(); });
    thread.on('error', reject);
    send();
  })));

  return results;
}

export function wilson(k, n) {
  if (!n) return { share: null, low: null, high: null, k, n };
  const z = 1.96;
  const p = k / n;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);

  return { share: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half), k, n };
}

export const VALIDATION_CANDIDATES = [
  { name: 'pooled-7b07', kind: '7b07' },
  { name: 'day-a02-d16-l15', kind: 'day', params: { alpha: 0.02, priorDf: 16, lodoZ: 1.5, minDays: 2 } },
  { name: 'day-a02-d16-l18', kind: 'day', params: { alpha: 0.02, priorDf: 16, lodoZ: 1.8, minDays: 2 } },
  { name: 'day-a02-d16-l20', kind: 'day', params: { alpha: 0.02, priorDf: 16, lodoZ: 2.0, minDays: 2 } },
  { name: 'day-a01-d16-l18', kind: 'day', params: { alpha: 0.01, priorDf: 16, lodoZ: 1.8, minDays: 2 } },
];

// Chosen on validation seeds 9101, 9102 before running held-out test seeds 601..630 (ADR 0028).
export const ADR_0028_PARAMS = { alpha: 0.02, priorDf: 16, lodoZ: 1.8, minDays: 2 };

export const TEST_DETECTORS = [
  { name: 'pooled-7b07', kind: '7b07' },
  { name: 'day-level-0028', kind: 'day', params: ADR_0028_PARAMS },
];

async function main() {
  const args = process.argv.slice(2);
  const validationOnly = args.includes('--validation-only');
  const workersIdx = args.indexOf('--workers');
  const workers = workersIdx >= 0 ? Number(args[workersIdx + 1]) : 8;
  const jsonIdx = args.indexOf('--json');
  const jsonPath = jsonIdx >= 0 ? args[jsonIdx + 1] : null;

  const seeds = validationOnly ? VALIDATION_SEEDS : TEST_SEEDS;
  const weeksPerCell = validationOnly ? 5 : 2; // validation: 10 weeks/cell (180/regime); test: 60 weeks/cell (1,080/regime, 5,400 null weeks!)
  const detectors = validationOnly ? VALIDATION_CANDIDATES : TEST_DETECTORS;

  const indexedVols = VOLUMES.map((v, index) => ({ ...v, index }));
  const indexedSkills = SKILLS.map((s, index) => ({ ...s, index }));
  const indexedRegimes = REGIMES.map((r, index) => ({ ...r, index }));

  const tasks = [];

  for (const seed of seeds) {
    for (const volume of indexedVols) {
      for (const skill of indexedSkills) {
        for (const regime of indexedRegimes) {
          tasks.push({ seed, volume, skill, regime, detectors, weeksPerCell });
        }
      }
    }
  }

  const start = Date.now();
  const rows = await runPool(tasks, workers);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Ran ${tasks.length} cells (${validationOnly ? 'VALIDATION' : 'TEST'}, seeds=${seeds.length}, weeks/cell=${weeksPerCell}) in ${elapsed}s`);

  const sumInto = (target, stats) => {
    for (const k of Object.keys(target)) target[k] += stats[k];
  };

  const blank = () => ({ weeks: 0, falseSlipWeeks: 0, plantedDetected: 0, plantedTotal: 0, readablePlantedDetected: 0, readablePlantedTotal: 0, extraFalseWeeks: 0 });
  const byRegime = {};
  const byVolNull = {};
  const bySkillNull = {};
  const byRegimeVolNull = {};
  const byRegimeVolAlt = {};
  const overallNull = {};

  for (const row of rows) {
    byRegime[row.regime] ??= { kind: row.kind, dets: {} };

    for (const [dName, stats] of Object.entries(row.results)) {
      byRegime[row.regime].dets[dName] ??= blank();
      sumInto(byRegime[row.regime].dets[dName], stats);

      if (row.kind === 'null') {
        overallNull[dName] ??= blank();
        sumInto(overallNull[dName], stats);
        byVolNull[row.volume] ??= {};
        byVolNull[row.volume][dName] ??= blank();
        sumInto(byVolNull[row.volume][dName], stats);
        bySkillNull[row.skill] ??= {};
        bySkillNull[row.skill][dName] ??= blank();
        sumInto(bySkillNull[row.skill][dName], stats);
        const rv = `${row.regime}::${row.volume}`;
        byRegimeVolNull[rv] ??= {};
        byRegimeVolNull[rv][dName] ??= blank();
        sumInto(byRegimeVolNull[rv][dName], stats);
      } else {
        const rv = `${row.regime}::${row.volume}`;
        byRegimeVolAlt[rv] ??= {};
        byRegimeVolAlt[rv][dName] ??= blank();
        sumInto(byRegimeVolAlt[rv][dName], stats);
      }
    }
  }

  const pct = (k, n) => (n ? `${((100 * k) / n).toFixed(2)}% (${k}/${n})` : '—');

  const pctW = (k, n) => {
    const w = wilson(k, n);

    return n ? `${(100 * w.share).toFixed(2)}% [${(100 * w.low).toFixed(2)}, ${(100 * w.high).toFixed(2)}] (${k}/${n})` : '—';
  };

  console.log('\n=== OVERALL NULL ===');

  for (const d of detectors) {
    const b = overallNull[d.name];
    console.log(d.name.padEnd(20), pctW(b.falseSlipWeeks, b.weeks));
  }

  console.log('\n=== BY REGIME ===');

  for (const [rName, info] of Object.entries(byRegime)) {
    const cols = detectors.map((d) => {
      const b = info.dets[d.name];

      if (info.kind === 'null') return `${d.name}:FP=${pct(b.falseSlipWeeks, b.weeks)}`;

      const read = b.readablePlantedTotal ? ` read=${pct(b.readablePlantedDetected, b.readablePlantedTotal)}` : '';

      return `${d.name}:all=${pct(b.plantedDetected, b.plantedTotal)}${read} ext=${pct(b.extraFalseWeeks, b.weeks)}`;
    });

    console.log(rName.padEnd(23), cols.join(' | '));
  }

  console.log('\n=== NULL BY VOLUME ===');

  for (const [vName, dets] of Object.entries(byVolNull)) {
    console.log(vName.padEnd(13), detectors.map((d) => `${d.name}:${pct(dets[d.name].falseSlipWeeks, dets[d.name].weeks)}`).join(' | '));
  }

  console.log('\n=== NULL BY SKILL ===');

  for (const [sName, dets] of Object.entries(bySkillNull)) {
    console.log(sName.padEnd(10), detectors.map((d) => `${d.name}:${pct(dets[d.name].falseSlipWeeks, dets[d.name].weeks)}`).join(' | '));
  }

  if (jsonPath) {
    const record = {
      mode: validationOnly ? 'validation' : 'test',
      seeds,
      weeksPerCell,
      params: ADR_0028_PARAMS,
      overallNull: Object.fromEntries(Object.entries(overallNull).map(([k, v]) => [k, { ...v, wilson: wilson(v.falseSlipWeeks, v.weeks) }])),
      byRegime,
      byVolNull,
      bySkillNull,
      byRegimeVolNull,
      byRegimeVolAlt,
    };

    writeFileSync(jsonPath, JSON.stringify(record, null, 2));
  }
}

if (isMainThread && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
