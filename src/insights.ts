import { lookup } from './domain-values.js';
import { analysisRuns, analysisLoops, isScoredRun } from './domain-history.js';
import type { PatternAttempt } from './domain-history.js';
import type { AnalysisRun, ScoredRun, HistoricalRecord } from './profile-types.js';
import { at as indexed, entry, isRecord } from './domain-values.js';

interface RetentionRun { kind?: string; status?: string; interrupted?: boolean; fresh?: boolean; patterns?: unknown[]; keys?: unknown[]; corrections?: unknown; missedWords?: unknown }

export interface PracticeRecord extends RetentionRun { id?: unknown; at?: string | null; day?: string | null; elapsedMs?: number }

interface DailyRecord { kind?: string; at?: string | null; id?: unknown; challengeDate?: string | null; firstDailyAttempt?: boolean }

interface Window { from?: string | null; to?: string | null }

interface ShapeVariant { key: string; conditions: Conditions | HistoricalRecord; count: number; last: number }

interface Shape { id: string; mode: unknown; size: string; variants: Map<string, ShapeVariant> }

interface RecurringPair { pair: string; observations: number; errors: number; runs: number; errorRuns: number; slowRuns: number; lastAt: string | null }

interface KeyTotal { key: string; samples: number; errors: number }

interface PairTotal { pair: string; samples: number; errors: number; slowRuns: number; timedRuns: number; runs: number }

import type { Attempt, Conditions, Replay } from './typing.js';
import type { RunRecord, KeyCounts } from './profile-types.js';

export type { RunRecord, KeyCounts, PatternCounts } from './profile-types.js';

import { DEFAULT_LAYOUT, isDefaultLayout, layoutLabel } from './layouts.js';
import { DEFAULT_CODE_LANGUAGE } from './code-snippets.js';
import { bookName } from './books.js';
import { LENGTHS } from './lengths.js';
import { CORPUS_VERSION, METRIC_VERSION, conditionKey, inputRules, printable, replayAttempt, summarizePatterns, textId } from './typing.js';

export const MAX_RUN_SUMMARIES = 1000;
export const MAX_PATTERN_RUNS = 120;
export const MAX_TRACES = 24;

// Characters of JSON for the full traces together. One 600 s trace at 130 wpm is about 1.5 million,
// and a browser allows about 5 million per site, so long custom-time runs keep fewer traces than 24.
export const TRACE_BUDGET = 2_500_000;

// Per-letter first-attempt counts saved with each run. Summaries without this version predate
// them and fall back to pair-derived counts, which miss letters at the start of a word.
export const KEY_COUNTS_VERSION = 1;

// [letter, tries, first-try errors] for every a–z first attempt, whatever came before it.
function keyCounts(replay: Replay) {
  const keys = new Map<string, KeyCounts>();

  for (const first of replay.firstAttempts) {
    const letter = (first.expected || '').toLowerCase();

    if (!/^[a-z]$/.test(letter)) continue;
    const k: KeyCounts = keys.get(letter) || [letter, 0, 0];
    k[1] += 1;

    if (!first.correct) k[2] += 1;
    keys.set(letter, k);
  }

  return [...keys.values()];
}

// A pair's or a letter's first tries in one run, { errors, observations }, or null when the run holds none.
export function firstTriesAt(attempt: PatternAttempt, target: string | null) {
  if (/^[a-z]$/.test(target || '')) {
    const counts = keyCounts(attempt.summary || replayAttempt(attempt)).find(([key]) => key === target);

    return counts ? { errors: counts[2], observations: counts[1] } : null;
  }

  const pair = summarizePatterns([attempt]).pairs.find((item) => item.pair === target);

  return pair ? { errors: pair.errors, observations: pair.observations } : null;
}

// A correction that takes longer than this was a pause, not a correction, and is left out.
const MAX_CORRECTION_MS = 5000;

// [first-try errors timed, their median correction time in ms] (ADR 0015). A correction runs from the kept
// keystroke before the wrong first try to the right letter kept at its position: the wrong key, any letters
// typed past it and deleted, and the right key. An error never put right, or with no kept keystroke before
// it, isn't timed. Positions follow replayAttempt's rules, so the times are of the text it scores.
export function correctionTimes(attempt: Attempt): [number, number | null] {
  const keptAt: number[] = [];
  const pending = new Map<number, number>();
  const costs: number[] = [];
  const firstTried = new Set();

  for (const event of attempt.events || []) {
    if (event.type === 'delete') {
      keptAt.splice(Math.max(0, keptAt.length - Math.max(1, event.count || 1)));
      continue;
    }

    if (event.type !== 'insert' || !printable(event.text)) continue;

    for (const char of event.text) {
      const position = typeof event.position === 'number' && Number.isInteger(event.position) ? event.position : keptAt.length;

      if (position >= attempt.text.length) break;
      const correct = char === attempt.text[position];

      if (!firstTried.has(position)) {
        firstTried.add(position);

        if (!correct && position > 0 && keptAt.length === position) pending.set(position, indexed(keptAt, position - 1));
      } else if (correct && pending.has(position) && event.accepted !== false) {
        const ms = event.offsetMs - (pending.get(position) ?? NaN);
        pending.delete(position);

        if (ms > 0 && ms <= MAX_CORRECTION_MS) costs.push(ms);
      }

      if (event.accepted !== false) keptAt.push(event.offsetMs);
    }
  }

  if (!costs.length) return [0, null];
  costs.sort((a, b) => a - b);
  const mid = costs.length >> 1;

  return [costs.length, Math.round(costs.length % 2 ? indexed(costs, mid) : (indexed(costs, mid - 1) + indexed(costs, mid)) / 2)];
}

export const MAX_MISSED_WORDS = 12;

// Run kinds that are never compared, used as a baseline or mined for patterns (custom text, missed-word
// practice, and a ghost race against a friend's recorded run). They keep no trace or pattern evidence and
// are retained on their own small budget, so they can never push comparable history out of the summary and
// pattern windows. Extend this set for any other kind like that.
export const NON_COMPARABLE_KINDS = new Set(['custom', 'missed', 'challenge']);
export const MAX_NON_COMPARABLE_RUNS = 50;
export const comparableKind = (kind: unknown) => typeof kind !== 'string' || !NON_COMPARABLE_KINDS.has(kind);

// Run kinds that measure typing on ordinary text at the run's own conditions: practice tests, retests and daily
// runs. Only these can be evidence (see evidenceRun). Narrower than comparableKind, which only splits retention
// budgets and so includes drills: their synthetic, target-heavy text is never measured.
const MEASURED_KINDS = new Set(['test', 'retest', 'daily']);
export const measuredKind = (kind: unknown) => typeof kind === 'string' && MEASURED_KINDS.has(kind);

export function runRecord(attempt: Attempt, at = attempt.at || null) {
  const replay = attempt.summary || replayAttempt(attempt);

  const base: Omit<RunRecord, 'score' | 'elapsedMs' | 'errors' | 'target'> = {
    id: attempt.id, at, kind: attempt.kind, status: attempt.status,
    // The calendar day where the run happened, so a later reader in another zone keeps the same day.
    day: at ? dayKey(at) : null,
    conditions: attempt.conditions, textId: attempt.textId, fresh: attempt.fresh,
    interrupted: Boolean(attempt.interrupted || attempt.unsupportedInput || attempt.stopped),
  };

  // Practice minimums are labelled on the run, not keyed into its conditions.
  if (attempt.minimums) base.minimums = attempt.minimums;

  if (attempt.stopped) base.stopped = attempt.stopped;

  const record: RunRecord = Object.assign(base, {
    score: replay.score, elapsedMs: replay.elapsedMs,
    errors: replay.firstAttempts.filter((item) => !item.correct).length,
    target: attempt.target || null, challengeDate: attempt.challengeDate || null,
    firstDailyAttempt: attempt.firstDailyAttempt,
  });

  // Adaptive practice is drill-kind: kept apart from bests, trends, baselines and pattern evidence.
  if (attempt.adaptive) record.adaptive = true;

  // A drill's length, from the drill length setting. Drills saved without it ran 30 seconds.
  if (attempt.drillSeconds) record.drillSeconds = attempt.drillSeconds;

  // Pattern counts only feed recurring targets, which never read custom text or missed-word practice.
  if (!comparableKind(attempt.kind)) return record;
  const evidence = summarizePatterns([attempt]);
  // Keep counts and each run's measured median, rather than another keystroke log.
  record.patterns = evidence.pairs.map((p) => [p.pair, p.observations, p.errors, p.timings.length, p.medianMs, p.slowdownMs]);
  // Same eligibility as patterns (no drills, races, repeated dailies or non-comparable kinds).
  record.keys = evidence.attemptCount ? keyCounts(replay) : [];
  record.keysVersion = KEY_COUNTS_VERSION;

  if (evidence.attemptCount && attempt.events) record.corrections = correctionTimes(attempt);

  // The words missed on the first try, for "words you keep missing": only from runs pattern memory
  // reads, so a run without the field (older, trimmed or not eligible) is no evidence either way. A code
  // snippet's tokens are not words to practise, so code runs record none.
  if (evidenceRun(record) && record.conditions?.mode !== 'code') record.missedWords = missedAndSlowWords(attempt, 0).missed.slice(0, MAX_MISSED_WORDS);

  return record;
}

// Pattern counts, key counts or correction times on a summary: what the pattern window keeps or removes.
const carriesCounts = (run: RetentionRun) => Boolean(run.patterns?.length || run.keys?.length || 'corrections' in run);

// Comparable runs keep the newest 1,000 summaries. Pattern counts, key counts and correction times (which the
// learner reads only beside the counts) stay on the newest 120 of them that carry any, so a drill between tests,
// which carries none, takes no place, as with missed words below. Other kinds keep their newest 50. Order stays
// chronological.
// Missed words stay only on the newest 120 runs the list counts, so the profile stays small. Counting those
// from the end means drills between them never push counted runs out of the list's window (word practice and
// custom text are on their own budget anyway).
export function retainRuns<T extends RetentionRun>(runs: T[]) {
  const comparable = runs.filter((run) => comparableKind(run.kind));
  const other = runs.filter((run) => !comparableKind(run.kind));
  const kept = new Set([...comparable.slice(-MAX_RUN_SUMMARIES), ...other.slice(-MAX_NON_COMPARABLE_RUNS)]);
  const withPatterns = new Set(comparable.filter((run) => kept.has(run) && carriesCounts(run)).slice(-MAX_PATTERN_RUNS));
  const withWords = new Set(comparable.filter((run) => kept.has(run) && missedWordsRun(run)).slice(-MAX_PATTERN_RUNS));

  return runs.flatMap((run) => {
    if (!kept.has(run)) return [];
    const trimPatterns = comparableKind(run.kind) && carriesCounts(run) && !withPatterns.has(run);
    const trimWords = 'missedWords' in run && !withWords.has(run);

    if (!trimPatterns && !trimWords) return [run];
    // Drop missed words rather than empty them: an empty list would read as a run with no misses.
    const { missedWords, ...rest } = run;

    const trimmed = { ...(trimWords ? rest : run) };

    if (trimPatterns) {
      Object.assign(trimmed, { patterns: [], keys: [] });
      delete trimmed.corrections;
    }

    return [trimmed];
  });
}

const traceSizes = new WeakMap<object, number>();

function traceSize(trace: unknown) {
  if (!trace || typeof trace !== 'object') return JSON.stringify(trace ?? null).length;

  if (!traceSizes.has(trace)) traceSizes.set(trace, JSON.stringify(trace).length);

  return traceSizes.get(trace) ?? 0;
}

// The newest full traces, at most MAX_TRACES and within TRACE_BUDGET. A run loses only its trace: bests,
// trends and recurring evidence read the compact summaries. A trace over the whole budget on its own (ten
// minutes past ~215 wpm, or a key held down) is never kept, even the newest, so the cache stays bounded.
export function retainTraces<T>(traces: T[], { max = MAX_TRACES, budget = TRACE_BUDGET } = {}) {
  const kept: T[] = [];
  let total = 0;

  for (let i = traces.length - 1; i >= 0 && kept.length < max; i -= 1) {
    const trace = indexed(traces, i);
    const size = traceSize(trace);

    if (size > budget) continue;

    if (total + size > budget) break;
    total += size;
    kept.push(trace);
  }

  return kept.reverse();
}

export const validRun = <T>(run: T): run is T & HistoricalRecord & { status: 'complete' } => isRecord(run) && run.status === 'complete' && !run.interrupted;

// Completed practice runs and retests, listed in Progress whatever their text. A non-comparable kind (custom
// text) is never one, whatever kind list it might later share.
export const practiceRun = <T>(run: T): run is T & HistoricalRecord & { status: 'complete'; kind: 'test' | 'retest' } => isRecord(run) && validRun(run) && comparableKind(run.kind) && (run.kind === 'test' || run.kind === 'retest');

// Two exclusions meet here: by kind (comparableKind, above) and by text, since only fresh text counts toward
// bests, trends and weekly medians: repeated text (fresh: false) flatters a score. Bests are judged only as
// they are set: one stored before repeat quotes (perhaps by an exhausted pool's fallback) stays as it is.
export const trendRun = <T>(run: T): run is T & HistoricalRecord & { status: 'complete'; kind: 'test' | 'retest' } => isRecord(run) && practiceRun(run) && run.fresh !== false;

// A run that may set a personal best: a trend run that isn't code. Code runs are their own condition and
// never set a best. Saving a run and merging two copies both ask this, so they can't disagree.
export const bestRun = (run: unknown) => isRecord(run) && trendRun(run) && (!isRecord(run.conditions) || run.conditions.mode !== 'code');

// The best earlier completed run on this exact passage and conditions: the score a repeat chases.
// It is derived from saved summaries and never becomes a personal best.
export function passageBest(inputRuns: readonly unknown[], run: AnalysisRun) {
  const runs = analysisRuns(inputRuns);
  const key = conditionKey(run.conditions);

  return runs.filter(isScoredRun).filter((r) => r.id !== run.id && r.textId === run.textId && practiceRun(r) && conditionKey(r.conditions) === key)
    .reduce<ScoredRun | null>((best, r) => (!best || r.score.wpm > best.score.wpm ? r : best), null);
}

// A run that counts as evidence about the person's typing: complete, uninterrupted and of a measured kind, and
// never on repeated text (a daily passage shown before, a repeated quote or an exhausted pool's fallback: known
// text counts its pairs and words again). Recurring patterns, missed words to practise and the words you keep
// missing all read only these; drills, races, word practice and custom text never count. Works on a stored run
// summary or a just-finished attempt.
export const evidenceRun = (run: unknown) => isRecord(run) && validRun(run) && measuredKind(run.kind) && run.fresh !== false;

// The runs "words you keep missing" counts: those pattern memory reads that recorded missed words.
const missedWordsRun = (run: RetentionRun) => evidenceRun(run) && Array.isArray(run.missedWords);
const inputClassOf = (run: AnalysisRun | undefined) => run?.conditions?.inputClass || 'physical-keyboard';

// The runs at one condition key, inside a window of local days when given one (a Progress period's
// periodWindow). Undated runs fall in no window with a first day.
export function filterRuns<T>(inputRuns: readonly T[], key: string, { from = null, to = null }: Window = {}) {
  const runs = analysisRuns(inputRuns);

  return runs.filter((run) => {
    const day = runDay(run);

    return (!key || conditionKey(run.conditions) === key) && (day ? (!from || day >= from) && (!to || day <= to) : !from);
  });
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 ? indexed(sorted, mid) : (indexed(sorted, mid - 1) + indexed(sorted, mid)) / 2;
}

export function weeklyChange(inputRuns: readonly unknown[], key: string, date = new Date()) {
  const runs = analysisRuns(inputRuns);
  const eligible = runs.filter(isScoredRun).filter(trendRun);
  const fortnight = filterRuns(eligible, key, periodWindow(14, date));
  const current = filterRuns(fortnight, key, periodWindow(7, date)).filter(isScoredRun);
  const ids = new Set(current.map((r) => r.id));
  const previous = fortnight.filter(isScoredRun).filter((r) => !ids.has(r.id));

  return { current, previous,
    wpm: current.length && previous.length ? (median(current.map((r) => r.score.wpm)) ?? 0) - (median(previous.map((r) => r.score.wpm)) ?? 0) : null,
    accuracy: current.length && previous.length ? (median(current.map((r) => r.score.accuracy)) ?? 0) - (median(previous.map((r) => r.score.accuracy)) ?? 0) : null,
  };
}

// The runs a Progress view selects, one entry per local calendar day, oldest first. Each day carries its
// runs in the order given, and the medians of their speed and accuracy. Undated runs have no day and are left out.
export function runsByDay(inputRuns: readonly unknown[]) {
  const runs = analysisRuns(inputRuns);
  const days = new Map<string, ScoredRun[]>();

  for (const run of runs.filter(isScoredRun)) {
    const day = runDay(run);

    if (!day) continue;

    if (!days.has(day)) days.set(day, []);
    entry(days, day).push(run);
  }

  return [...days.keys()].sort().map((day) => {
    const list = entry(days, day);

    return { day, runs: list, wpm: median(list.map((run) => run.score.wpm)), accuracy: median(list.map((run) => run.score.accuracy)) };
  });
}

// The figures above the Progress charts: medians over every selected run, and the fastest of them.
// A tie for fastest goes to the most recent run.
export function periodStats(inputRuns: readonly unknown[]) {
  const runs = inputRuns.filter(isScoredRun);

  if (!runs.length) return { count: 0, wpm: null, accuracy: null, best: null };

  const best = runs.reduce((top, run) => (run.score.wpm > top.score.wpm
    || (run.score.wpm === top.score.wpm && (run.at || '') >= (top.at || '')) ? run : top));

  return { count: runs.length, wpm: median(runs.map((run) => run.score.wpm)), accuracy: median(runs.map((run) => run.score.accuracy)), best };
}

// The value a share p of the sorted values falls below, interpolating between neighbours (so the 0.5
// quantile is the median).
export function quantile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * p;
  const below = Math.floor(at);

  return indexed(sorted, below) + (indexed(sorted, Math.min(below + 1, sorted.length - 1)) - indexed(sorted, below)) * (at - below);
}

// Values counted into bins `width` wide on round edges, lowest first, empty bins between kept.
export function histogram(values: number[], width: number) {
  if (!values.length) return [];
  const first = Math.floor(Math.min(...values) / width);
  const bins = Array.from({ length: Math.floor(Math.max(...values) / width) - first + 1 }, (_, i) => ({ from: (first + i) * width, count: 0 }));

  for (const value of values) indexed(bins, Math.floor(value / width) - first).count += 1;

  return bins;
}

// The test lengths someone has history at, each holding the exact condition sets (comparison keys)
// run at that length, most used first. A length is the mode and its size; everything else that
// enters the key (text, word list, input, correction, corpus, metric) tells its variants apart, and
// runs are only ever compared within one variant. Word counts first, then times, shortest first,
// then quotes, the standard test, code, books and anything else. Where someone has run a word count or a
// time, that mode's preset lengths without runs stay in place with no variants, so the row keeps its shape.
const SHAPE_ORDER = ['words', 'time', 'quote', 'standard', 'code', 'book'];

export function shapeOf(conditions: Conditions | HistoricalRecord = {}) {
  const size = conditions.mode === 'words' ? conditions.count : conditions.mode === 'time' ? conditions.duration
    : conditions.mode === 'quote' ? conditions.quoteLength || 'any' : conditions.mode === 'code' ? conditions.codeLanguage || 'js'
      : conditions.mode === 'standard' ? conditions.recipe || '' : conditions.mode === 'book' ? conditions.book || '' : '';

  return `${conditions.mode}:${size}`;
}

export function testShapes(inputSources: readonly unknown[]) {
  const sources = analysisRuns(inputSources);
  const shapes = new Map<string, Shape>();
  sources.forEach((source, order) => {
    const id = shapeOf(source.conditions);

    if (!shapes.has(id)) shapes.set(id, { id, mode: source.conditions?.mode, size: id.slice(id.indexOf(':') + 1), variants: new Map() });
    const key = conditionKey(source.conditions);
    const variants = entry(shapes, id).variants;

    if (!variants.has(key)) variants.set(key, { key, conditions: source.conditions ?? {}, count: 0, last: 0 });
    Object.assign(entry(variants, key), { count: entry(variants, key).count + 1, last: order });
  });

  for (const mode of Object.keys(LENGTHS)) {
    if (![...shapes.values()].some((shape) => shape.mode === mode)) continue;

    for (const size of lookup(LENGTHS, mode)?.presets ?? []) {
      const id = `${mode}:${size}`;

      if (!shapes.has(id)) shapes.set(id, { id, mode, size: String(size), variants: new Map() });
    }
  }

  const rank = (mode: unknown) => (typeof mode === 'string' && SHAPE_ORDER.includes(mode) ? SHAPE_ORDER.indexOf(mode) : SHAPE_ORDER.length);

  return [...shapes.values()]
    .map((shape) => ({ ...shape, variants: [...shape.variants.values()].sort((a, b) => b.count - a.count || b.last - a.last) }))
    .sort((a, b) => rank(a.mode) - rank(b.mode) || (Number(a.size) || 0) - (Number(b.size) || 0) || (a.id < b.id ? -1 : 1));
}

export const CORRECTION_LABELS = { relaxed: 'continue on error', mandatory: 'stop on error', 'no-backspace': 'no backspace', 'fail-word': 'fail on word error', 'fail-any': 'fail on any error' } satisfies Record<string, string>;

export function correctionLabel(policy: unknown) {
  return lookup(CORRECTION_LABELS, String(policy || 'mandatory')) || 'stop on error';
}

// Every part of a condition key (conditionKey), named as people read it, in the order a conditions line
// reads. Some parts are on the line only away from their default (`shown`), but name a condition set in
// either state when sets differ by them. A quote ignores the punctuation setting its key keeps, so the
// line names it only beside a quote set that differs by it.
function conditionText(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('A textual condition field is not text.');

  return value;
}

const version = (id: unknown) => conditionText(id).replace(/^.*-(v\d+)$/, '$1');

export type ConditionLabelSource = Conditions | HistoricalRecord;

const LENGTH_TEXT = {
  words: (c) => `${c.count} words`,
  time: (c) => `${c.duration} s`,
  quote: (c) => `${c.quoteLength || 'any'} quote`,
  code: (c) => `code · ${c.codeLanguage || DEFAULT_CODE_LANGUAGE}`,
  book: (c) => bookName(c.book),
  standard: (c) => `${conditionText(c.recipe || '').replace('-', ' ')} · ${c.duration} s`,
} satisfies Partial<Record<string, (c: ConditionLabelSource) => string>>;

interface ConditionPart { name: string; text: (c: ConditionLabelSource) => unknown; shown?: (c: ConditionLabelSource) => boolean }

const CONDITION_PARTS: ConditionPart[] = [
  { name: 'language', text: (c) => (c.wordList ? `english ${c.wordList}` : 'english') },
  { name: 'length', text: (c) => lookup(LENGTH_TEXT, String(c.mode ?? ''))?.(c) ?? c.mode },
  { name: 'text', text: (c) => (c.mode === 'quote' ? c.difficulty || 'any difficulty' : `${c.punctuation ? 'punctuation' : 'plain'}${c.numbers ? ' · numbers' : ''}`) },
  { name: 'setting', text: (c) => (c.mode === 'quote' ? `punctuation setting ${c.punctuation ? 'on' : 'off'}` : ''), shown: () => false },
  { name: 'input', text: (c) => (c.inputClass === 'touch' ? 'touch input' : 'physical keyboard') },
  { name: 'layout', text: (c) => layoutLabel(c.layout || DEFAULT_LAYOUT), shown: (c) => !isDefaultLayout(c.layout) },
  { name: 'correction', text: (c) => correctionLabel(c.correctionPolicy) },
  { name: 'strictSpace', text: (c) => (inputRules(c).includes('strict-space') ? 'strict space' : 'no strict space'), shown: (c) => inputRules(c).includes('strict-space') },
  { name: 'quickEnd', text: (c) => (inputRules(c).includes('quick-end-off') ? 'quick end off' : 'quick end'), shown: (c) => inputRules(c).includes('quick-end-off') },
  { name: 'corpus', text: (c) => `corpus ${version(c.corpus || CORPUS_VERSION)}`, shown: () => false },
  { name: 'metric', text: (c) => `metric ${version(c.metricVersion || METRIC_VERSION)}`, shown: () => false },
];

// The parts a conditions line shows, by name, in reading order. Beside other condition sets (`sets`, as
// the condition pills list them), a part shown only away from its default is shown whenever they differ
// by it, so the line names what its pill does.
export function conditionParts(conditions: ConditionLabelSource, sets: readonly ConditionLabelSource[] = []) {
  const differs = (part: ConditionPart) => sets.some((other) => part.text(other) !== part.text(conditions));

  return Object.fromEntries(CONDITION_PARTS.flatMap((part) => {
    const shown = part.shown ? part.shown(conditions) || differs(part) : part.text(conditions);

    return shown ? [[part.name, part.text(conditions)]] : [];
  }));
}

// Names for the condition sets at one length: each set's reading of every part the sets disagree on
// ("plain", "plain · numbers"), so a set's name never depends on how often it was run.
export function conditionLabels(sets: readonly ConditionLabelSource[]) {
  const texts = sets.map((conditions) => CONDITION_PARTS.map((part) => part.text(conditions)));
  const differs = CONDITION_PARTS.map((_, i) => new Set(texts.map((values) => values[i])).size > 1);

  return texts.map((values) => values.filter((_, i) => differs[i]).join(' · '));
}

// The first and last local calendar days of a Progress period, inclusive: "7 days" is today and the six
// days before. Every period ends today, so a run saved on a day still ahead here (a device in a timezone
// ahead) waits until its day comes. All saved runs start on `first`, the oldest day there is (no lower
// bound without one), and never after today.
export function periodWindow(days: string | number, date = new Date(), first: string | null = null) {
  const to = dayKey(date);
  const from = days === 'all' ? first : dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - Number(days) + 1));

  return { from: from && from > to ? to : from, to };
}

// The local calendar days a Progress period covers, oldest first: its whole window, or today alone for
// all saved runs with no first day.
export function periodDays(days: string | number, date = new Date(), first: string | null = null) {
  const { from, to } = periodWindow(days, date, first);
  const list = [];

  for (const day = new Date(`${from ?? to}T00:00:00`); dayKey(day) <= to; day.setDate(day.getDate() + 1)) list.push(dayKey(day));

  return list;
}

// Practice over the given days: days with any practice, the longest run of days meeting the goal (any
// practice when it's off, as practiceStreak counts), minutes typed, and completed runs of every kind per day.
export function practiceStats(byDay: Record<string, number>, inputRuns: readonly unknown[], days: string[], goal = 0) {
  const runs = analysisRuns(inputRuns);
  const met = (day: string) => (goal ? (byDay[day] || 0) >= goal : (byDay[day] || 0) > 0);
  let longest = 0;
  let streak = 0;

  for (const day of days) {
    streak = met(day) ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }

  const counts = new Map(days.map((day) => [day, 0]));

  for (const run of runs) {
    const day = runDay(run);

    if (validRun(run) && day !== null && counts.has(day)) counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  return {
    active: days.filter((day) => (byDay[day] || 0) > 0).length,
    longest,
    minutes: days.reduce((sum, day) => sum + (byDay[day] || 0), 0),
    runsPerDay: [...counts].map(([day, count]) => ({ day, runs: count })),
  };
}

const STANDARD_RECENT_RUNS = 10;
export const STANDARD_MIN_RUNS = 3;

// The standard score headline: the best at one standard key, plus the median wpm of the most recent
// completed runs there. Below three runs there is no median, so one run can't stand in for a score.
// Only comparable kinds count: a custom run is never a standard run, whatever conditions it carries.
export function standardScore(inputRuns: readonly unknown[], key: string, best: number | null = null) {
  const runs = analysisRuns(inputRuns);
  const eligible = runs.filter(isScoredRun).filter((run) => comparableKind(run.kind) && trendRun(run) && conditionKey(run.conditions) === key);
  const recent = eligible.slice(-STANDARD_RECENT_RUNS);
  const settled = recent.length >= STANDARD_MIN_RUNS;

  return {
    total: eligible.length,
    recent: recent.length,
    best: best ?? (eligible.length ? Math.max(...eligible.map((run) => run.score.wpm)) : null),
    median: settled ? median(recent.map((run) => run.score.wpm)) : null,
    settled,
  };
}

// Which input class heads the standard score, given standardScore for each. Totals count only runs
// still in the kept summaries, while bests outlive them, so totals alone can't stand for lifetime
// practice. Physical keyboard is the default. Touch heads only when the keyboard has nothing at all,
// or once touch has a settled median from more kept runs, so one touch run can't replace a keyboard score.
export function standardInputClass(keyboard: ReturnType<typeof standardScore>, touch: ReturnType<typeof standardScore>) {
  const keyboardEmpty = !keyboard.total && keyboard.best === null;
  const touchHasScore = touch.total > 0 || touch.best !== null;

  if (keyboardEmpty && touchHasScore) return 'touch';

  return touch.settled && touch.total > keyboard.total ? 'touch' : 'physical-keyboard';
}

export function recurringTargets(inputRuns: readonly unknown[], inputLoops: readonly unknown[], compatibleConditions?: Conditions | HistoricalRecord) {
  const runs = analysisRuns(inputRuns);
  const loops = analysisLoops(inputLoops);
  const key = conditionKey(compatibleConditions);
  const eligible = runs.filter((r) => evidenceRun(r) && conditionKey(r.conditions) === key).slice(-MAX_PATTERN_RUNS);
  const pairs = new Map<string, RecurringPair>();

  for (const run of eligible) {
    for (const [pair, observations, errors, timingCount, medianMs, slowdownMs] of run.patterns || []) {
      const p = pairs.get(pair) || { pair, observations: 0, errors: 0, runs: 0, errorRuns: 0, slowRuns: 0, lastAt: null };
      p.observations += observations;
      p.errors += errors;
      p.runs += 1;

      if (errors) p.errorRuns += 1;

      if (timingCount >= 10 && (slowdownMs ?? 0) > 0 && medianMs !== null) p.slowRuns += 1;
      p.lastAt = run.at ?? null;
      pairs.set(pair, p);
    }
  }

  return [...pairs.values()]
    .flatMap((p) => {
      if (!(p.observations >= 10 && (p.errorRuns >= 2 || p.slowRuns >= 2))) return [];
      const checks = loops.filter((l) => l.target === p.pair && conditionKey(l.conditions) === key);
      const lastCheck = checks.at(-1);

      const drilled = runs.filter((r) => r.kind === 'drill' && validRun(r) && r.target === p.pair
        && conditionKey(r.conditions) === key);

      const lastPracticed = [drilled.at(-1)?.at, lastCheck?.drillCompleted ? lastCheck.at : null].filter(Boolean).sort().at(-1) || null;
      const laterRuns = eligible.filter((r) => lastPracticed && (r.at ?? '') > lastPracticed && r.fresh !== false);
      const laterObservations = laterRuns.reduce((n, r) => n + (r.patterns?.find((v) => v[0] === p.pair)?.[1] || 0), 0);

      return [{ ...p, lastPracticed, lastCheck, laterObservations, laterRuns: laterRuns.length,
        review: Boolean(lastPracticed && laterObservations >= 10) }];
    })
    .sort((a, b) => Number(b.review) - Number(a.review) || b.errors / b.observations - a.errors / a.observations
      || b.slowRuns - a.slowRuns || a.pair.localeCompare(b.pair));
}

// Daily practice goal: minutes practised per local calendar day, from the run summaries and the archive.
export const DAILY_GOALS = [0, 5, 10, 15, 30];

export function dayKey(value: string | number | Date) {
  const d = new Date(value);

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The day recorded with the run; older summaries without one fall back to their timestamp here.
export function runDay(run: { day?: string | null; at?: string | null }) {
  if (run.day && DAY.test(run.day)) return run.day;
  const key = run.at ? dayKey(run.at) : '';

  return DAY.test(key) ? key : null;
}

// Interrupted runs keep their clock going after focus is lost, so only valid runs count as practice.
function addRunTime(totals: Record<string, number>, runs: readonly PracticeRecord[]) {
  for (const run of runs) {
    const key = runDay(run);

    if (!validRun(run) || !key || !((run.elapsedMs ?? 0) > 0)) continue;
    totals[key] = (totals[key] || 0) + (run.elapsedMs ?? 0);
  }

  return totals;
}

// Runs that retention drops leave their time behind as whole milliseconds per day, so the calendar
// and streak outlive the run summaries. Only the newest MAX_PRACTICE_DAYS practised days are kept.
export const MAX_PRACTICE_DAYS = 730;

export function validPracticeDays(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(Object.entries(value).flatMap(([key, ms]) => DAY.test(key) && typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? [[key, ms]] : []));
}

// Custom runs are real practice, so their time counts toward the goal like any other kind (it is a time total,
// not a comparison), and a custom run that falls outside its own 50-run budget leaves its time here too.
export function retainHistory<T extends PracticeRecord>(runs: T[], practiceDays: Record<string, number> = {}) {
  const keptRuns = retainRuns(runs);
  const retainedIds = new Set(keptRuns.map((run) => run.id));
  const days = addRunTime({ ...practiceDays }, runs.filter((run) => !retainedIds.has(run.id)));
  const kept = Object.keys(days).sort().slice(-MAX_PRACTICE_DAYS);

  return { runs: keptRuns, practiceDays: Object.fromEntries(kept.map((key) => [key, Math.round(days[key] ?? 0)])) };
}

// Completed learning activities that keep no copy-run summary (lessons and composing) put their
// actual practice time straight into the same bounded archive. Composing supplies active time.
export function recordPracticeTime(practiceDays: unknown, at: string, elapsedMs: number) {
  const days = validPracticeDays(practiceDays);
  const day = dayKey(at);

  if (!DAY.test(day) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return days;
  days[day] = (days[day] || 0) + elapsedMs;

  return retainHistory([], days).practiceDays;
}

// The archive when two copies of a profile meet, given their merged runs (de-duplicated by id). An archived
// day holds the time of runs that are gone, so it can't be matched by run id, and two copies of one person's
// history archive the same runs: adding the archives would count those runs twice, and so would keeping one
// side's archive beside runs the other side still keeps as summaries. What each copy says of a day (its archive
// plus its own runs that day) is time really practised, and so is the merged runs' time. The day keeps the
// largest of those, so no run counts twice; its archive is that total less the merged runs' time, which the
// calendar adds back. An empty copy (a new account) takes the other's archive as it is. The trade-off:
// different runs that two copies never shared, archived on the same day, count as the larger day, not the sum.
export function mergePracticeDays(a: { practiceDays?: unknown; runs?: PracticeRecord[] }, b: { practiceDays?: unknown; runs?: PracticeRecord[] }, runs: readonly PracticeRecord[]) {
  const own = (side: { practiceDays?: unknown }) => validPracticeDays(side.practiceDays);
  const total = (side: { practiceDays?: unknown; runs?: PracticeRecord[] }) => addRunTime(own(side), Array.isArray(side.runs) ? side.runs : []);
  const [first, second, merged] = [total(a), total(b), addRunTime({}, runs)];
  const days: Record<string, number> = {};

  for (const key of [...new Set([...Object.keys(own(a)), ...Object.keys(own(b))])].sort()) {
    const rest = Math.round(Math.max(first[key] || 0, second[key] || 0) - (merged[key] || 0));

    if (rest > 0) days[key] = rest;
  }

  return days;
}

export function minutesByDay(runs: readonly unknown[], practiceDays: Record<string, number> = {}) {
  const totals = addRunTime({ ...practiceDays }, analysisRuns(runs));

  for (const key of Object.keys(totals)) totals[key] = (totals[key] ?? 0) / 60000;

  return totals;
}

// Whole minutes rounded down, so a day short of the goal never reads as meeting it.
export const goalMinutes = (minutes: number | null | undefined) => (minutes != null && minutes > 0 && minutes < 1 ? '<1' : String(Math.floor(minutes || 0)));

// Consecutive days meeting the goal (or with any practice when the goal is off), ending today.
// An unfinished today does not break the streak until the day is over.
export function practiceStreak(byDay: Record<string, number>, goal = 0, date = new Date()) {
  const met = (d: Date) => (goal ? (byDay[dayKey(d)] || 0) >= goal : (byDay[dayKey(d)] || 0) > 0);
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (!met(day)) day.setDate(day.getDate() - 1);
  let streak = 0;

  while (met(day)) { streak += 1; day.setDate(day.getDate() - 1); }

  return streak;
}

// 0 = no practice, 1–4 = increasing share of the goal (10 minutes when the goal is off).
export function practiceLevel(minutes: number, goal = 0) {
  if (!(minutes > 0)) return 0;
  const ratio = minutes / (goal || 10);

  return ratio < 0.5 ? 1 : ratio < 1 ? 2 : ratio < 2 ? 3 : 4;
}

// Words missed on the first try in at least two of the newest 120 runs that recorded missed words,
// on one input class (the newest such run's: touch is never pooled with a physical keyboard) and
// across all other test conditions. `runs` is how many runs were counted, so a row can say "missed
// in 3 of the last 41 runs". Ranked by the number of runs missed in, then the most recent miss (by
// run order, since older summaries can lack a date).
// One word across runs: lower case, without punctuation before or after it (inner marks, as in "9:30"
// or "don't", stay). A token that is all punctuation keeps itself.
const missedWordKey = (word: string) => word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') || word;

export function recurringMissedWords(inputRuns: readonly unknown[], limit = 8) {
  const runs = analysisRuns(inputRuns);
  const recent = runs.filter(missedWordsRun).slice(-MAX_PATTERN_RUNS);
  const inputClass = inputClassOf(recent.at(-1));
  const counted = recent.filter((run) => inputClassOf(run) === inputClass);
  // Counted as one word whatever its case or the punctuation around it ("The", "the", "the,"), and
  // practised as most recently written: a run's first form of it, from the newest run that missed it.
  const words = new Map<string, { word: string; runs: number; lastIndex: number }>();
  counted.forEach((run, index) => {
    const seen = new Set();

    for (const written of run.missedWords ?? []) {
      const key = missedWordKey(written);

      if (seen.has(key)) continue;
      seen.add(key);
      const item = words.get(key) || { word: written, runs: 0, lastIndex: -1 };
      item.runs += 1;
      item.lastIndex = index;
      item.word = written;
      words.set(key, item);
    }
  });

  const recurring = [...words.values()].filter((item) => item.runs >= 2)
    .sort((a, b) => b.runs - a.runs || b.lastIndex - a.lastIndex || a.word.localeCompare(b.word));

  return { runs: counted.length, inputClass, recurring: recurring.length, words: recurring.slice(0, limit) };
}

// The seen-text id that marks a day's challenge as attempted (the passage itself has its own id).
export const dailyChallengeId = (day: string) => `daily-${day}-v1`;

// Only the earliest attempt at a day's challenge (by date, then id, the order every copy sorts by) can
// be its first attempt. Two devices that each tried the day before either held the other's copy both
// label their own try first; once their runs meet, the later one becomes a repeat. Flags are only
// ever cleared, never set, so a label stays conservative. Returns the records, changed ones copied.
export function settleDailyFirsts<T extends DailyRecord>(records: T[]) {
  const earliest = new Map<string, T>();
  const before = (a: DailyRecord, b: DailyRecord) => (a.at || '') < (b.at || '') || ((a.at || '') === (b.at || '') && String(a.id) < String(b.id));

  for (const record of records) {
    if (record?.kind !== 'daily' || !record.challengeDate) continue;
    const held = earliest.get(record.challengeDate);

    if (!held || before(record, held)) earliest.set(record.challengeDate, record);
  }

  return records.map((record) => (record?.kind === 'daily' && record.firstDailyAttempt
    && earliest.get(record.challengeDate ?? '') !== record ? { ...record, firstDailyAttempt: false } : record));
}

// Stable UTC selection from a frozen text pool: preferences and seen history never change it.
export function dailyPassage(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  const index = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
  const text = indexed(DAILY_TEXTS, ((index % DAILY_TEXTS.length) + DAILY_TEXTS.length) % DAILY_TEXTS.length);

  return { id: dailyChallengeId(day), sourceTextId: `daily-${textId(text)}`, textVersion: `daily-${textId(text)}@1`, day, text, difficulty: 'steady',
    resetAt: new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString() };
}

const DAILY_TEXTS = [
  'The station clock was a minute slow, but nobody waiting on the platform seemed to mind. A porter moved a trolley past the benches. Somewhere beyond the tracks, a door opened and the smell of fresh bread drifted into the morning air.',
  'We carried the table outside before the rain arrived. There was just enough room beneath the old apple tree for six chairs and a bowl of pears. When the first drops fell, someone opened an umbrella over the bread and everyone laughed.',
  'A good question can change the shape of an afternoon. You set aside the answer you expected, look again at the evidence, and find a detail that had escaped you. The work becomes more interesting as soon as you allow yourself to be surprised.',
  'The bicycle had spent winter behind a stack of boxes. We brushed the dust from its frame, filled the tires, and tightened the loose bell. By noon it was carrying a basket of groceries down the same street where it had once carried schoolbooks.',
  'At the edge of the garden, a narrow gate opened onto a path we had never noticed. It followed the wall for a while, then turned toward a field. We walked until the houses disappeared behind the trees and the wind became the loudest thing around us.',
  'The first draft left plenty of room for improvement. That was useful: a rough page gave us something real to discuss. We moved a paragraph, removed a repeated sentence, and found that the clearest idea had been hiding near the end all along.',
  'Every shelf in the shop told a different story. There were maps folded along old creases, cups with painted handles, and a box of keys without locks. The owner knew where most things came from, but enjoyed letting visitors imagine the rest.',
  'After lunch, the river changed color as clouds crossed the sun. Small boats moved between the bridges, leaving trails that widened and vanished. We sat on the steps with our coats beside us, watching an ordinary afternoon become something we would remember.',
  'Someone had written the recipe on the back of an envelope. The quantities were vague, and the final instruction simply said to wait. We measured what we could, trusted the rest, and learned more from the smell of the oven than from the faded ink.',
  'The workshop window faced a quiet courtyard. Each morning, light reached the same corner of the bench before moving across the tools. Over the years, that small patch of sun had marked the beginning of more useful work than any clock on the wall.',
  'A shelf of unfinished projects can feel like a record of failure. Look more closely and it becomes a record of questions: what would happen if this piece were lighter, that seam stronger, or the whole idea simpler? Sometimes the next attempt begins with an old one.',
  'We reached the hill before sunset and found a place among the tall grass. Below us, lights appeared in scattered windows. There was nothing to solve and nowhere else to be. For a few minutes, watching the day end was enough to fill our attention.',
  'The letter arrived without an explanation for its long journey. Its corners were soft, and the stamp had almost faded. Inside was a short account of a summer by the sea, written by someone who had thought an ordinary day was worth sharing.',
  'When the power returned, we left the candles burning for a little longer. The room looked familiar again, but conversation had found a different pace. Nobody reached for a screen until the last story was finished and the kettle began to sing.',
];

// Stilltype rule: no confident per-key or per-pair claim below this many first attempts.
export const MIN_PATTERN_SAMPLES = 10;

const directKeys = (run: AnalysisRun) => run.keysVersion === KEY_COUNTS_VERSION && Array.isArray(run.keys) ? run.keys : null;

// Compact run memory → per-key and per-pair totals. A key's miss rate is first-attempt errors on
// that letter over its tries. Older summaries without per-letter counts fall back to their pairs
// (a pair's first attempt is a try at its second letter), so they only count letters typed after
// another letter; pairDerivedRuns says how many runs that applies to. Non-comparable kinds (custom text) and
// repeated text are never mined, even if a record carries counts (a run on an exhausted pool saved them before
// repeat quotes).
export function keyAnalysis(inputRuns: readonly unknown[], limit = 8) {
  const runs = analysisRuns(inputRuns);

  const recent = runs.filter((r) => comparableKind(r.kind) && validRun(r) && r.fresh !== false
    && ((r.patterns || []).length || directKeys(r)?.length))
    .slice(-MAX_PATTERN_RUNS);

  const keys = new Map<string, KeyTotal>();
  const pairs = new Map<string, PairTotal>();
  let pairDerivedRuns = 0;

  const addKey = (key: string, samples: number, errors: number) => {
    const k = keys.get(key) || { key, samples: 0, errors: 0 };
    k.samples += samples;
    k.errors += errors;
    keys.set(key, k);
  };

  for (const run of recent) {
    const direct = directKeys(run);

    if (direct) for (const [key, samples, errors] of direct) addKey(key, samples, errors);
    else pairDerivedRuns += 1;

    for (const [pair, observations, errors, timingCount, medianMs, slowdownMs] of run.patterns || []) {
      if (!direct) addKey(pair.charAt(1), observations, errors);
      const p = pairs.get(pair) || { pair, samples: 0, errors: 0, slowRuns: 0, timedRuns: 0, runs: 0 };
      p.samples += observations;
      p.errors += errors;
      p.runs += 1;
      // Only runs with enough clean intervals can say slow or not; the rest stay unknown.
      const timed = timingCount >= MIN_PATTERN_SAMPLES && medianMs !== null && slowdownMs !== null;

      if (timed) p.timedRuns += 1;

      if (timed && (slowdownMs ?? 0) > 0) p.slowRuns += 1;
      pairs.set(pair, p);
    }
  }

  const rate = <T extends { samples: number; errors: number }>(v: T) => ({ ...v, missRate: v.samples ? v.errors / v.samples : 0, enough: v.samples >= MIN_PATTERN_SAMPLES });

  return {
    runs: recent.length,
    pairDerivedRuns,
    keys: Object.fromEntries([...keys.values()].map((k) => [k.key, rate(k)])),
    pairs: [...pairs.values()].flatMap((v) => {
      const p = rate(v);

      return p.enough && (p.errors > 0 || p.slowRuns > 0) ? [p] : [];
    })
      .sort((a, b) => b.missRate - a.missRate || b.slowRuns - a.slowRuns || b.samples - a.samples || a.pair.localeCompare(b.pair))
      .slice(0, limit),
  };
}

// The bare word: a word without the punctuation around it, lowercased ("Table," → "table").
// Punctuation inside stays ("9:30", "don't"), so no merged, made-up tokens. `same[k]` is true where
// the bare word keeps the written character at k unchanged (not a dropped comma, not a capital), and
// `lead` is where the bare word starts in `raw`.
function bareWord(raw: string) {
  const lead = raw.search(/[\p{L}\p{N}]/u);
  const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
  const same = Array.from({ length: raw.length }, (_, k) => lead >= 0 && k >= lead && word[k - lead] === raw[k]);

  return { word, same, lead };
}

// The token that practises these misses: the bare word when every miss was on a character it keeps
// as typed, else the word as written ("table," for a missed comma, "The" for a missed capital). A
// miss on the space after the word goes with the character before it, since the practice passage
// puts a space after every word: "the" for "The ", "table," for "table, ".
function missedToken(raw: string, misses: number[]) {
  const { word, same } = bareWord(raw);

  return word && misses.every((k) => same[Math.min(k, raw.length - 1)]) ? word : raw;
}

// When each letter kept at the finish was typed, mirroring replayAttempt's kept text: a mistyped
// and corrected space times the next word from the space that stayed, not the one deleted.
function keptOffsets(attempt: Attempt) {
  const times: number[] = [];

  for (const event of attempt.events || []) {
    if (event.type === 'delete') {
      times.splice(Math.max(0, times.length - Math.max(1, event.count || 1)));
      continue;
    }

    if (event.type !== 'insert' || !printable(event.text)) continue;

    for (const _char of event.text) {
      const position = typeof event.position === 'number' && Number.isInteger(event.position) ? event.position : times.length;

      if (position >= attempt.text.length) break;

      if (event.accepted !== false) times.push(event.offsetMs);
    }
  }

  return times;
}

// Missed words had any wrong first try, counting the space after the word as the run card's word
// history does (the last word has none). The slowest are this run's slowest clean words by per-word
// wpm: one timing each, so they carry their speed and the run's median for comparison, not a verdict.
// Clean means right on every first try and still right at the finish, the spaces after it included,
// as the run card's word list reads it. With continue on error, a right letter can be deleted and
// replaced by a wrong one: its first try stays right, so the word isn't a first-try miss, but it isn't
// clean either, and its kept keystrokes would time the wrong letter, so it is left out of the timing.
//
// Per-word pace, one rule for every word: each counted character's interval is the time since the
// previous kept keystroke, and wpm = (counted characters / 5) / (sum of their intervals). A word
// counts only the characters its bare word keeps as written, so "table," is timed on t-a-b-l-e (the
// comma's interval is left out) and "The" on h-e, matching what is reported and drilled. A dropped
// leading quote takes the next interval with it, so '"the' is timed on h-e too: the drill never types
// the quote-to-t step. The run's first character has no previous keystroke, so it is never counted: a
// first word is timed from its second letter, and a word left with no counted characters (a one-letter
// first word) isn't timed.
export function missedAndSlowWords(attempt: Attempt, slowLimit = 5) {
  const replay = attempt.summary || replayAttempt(attempt);
  const first = new Map(replay.firstAttempts.map((item) => [item.position, item]));
  const kept = keptOffsets(attempt);
  const { typed } = replay;
  const missed: string[] = [];
  const timed: { word: string; wpm: number }[] = [];
  let start = 0;

  for (const raw of attempt.text.split(' ')) {
    const end = start + raw.length;
    const { word, same, lead } = bareWord(raw);
    const tries: import('./typing.js').FirstAttempt[] = [];

    for (let i = start; i < end; i += 1) { const tried = first.get(i);

 if (tried) tries.push(tried); }

    const misses = tries.flatMap((item) => (item.correct ? [] : [item.position - start]));

    // The spaces after a word are part of typing it: a wrong first try there marks the word.
    for (let i = end; raw && attempt.text[i] === ' '; i += 1) if (first.get(i)?.correct === false) misses.push(i - start);
    // Still right at the finish: the word as typed, and each space after it that was typed.
    let right = typed.slice(start, end) === raw;

    for (let i = end; right && raw && attempt.text[i] === ' ' && i < typed.length; i += 1) right = typed[i] === ' ';

    if (misses.length) {
      const token = missedToken(raw, misses);

      if (!missed.includes(token)) missed.push(token);
    } else if (word && tries.length === raw.length && right) {
      let count = 0;
      let ms = 0;

      for (let k = 0; k < raw.length; k += 1) {
        if (!same[k] || (k === lead && k > 0) || start + k === 0) continue;
        count += 1;
        ms += indexed(kept, start + k) - indexed(kept, start + k - 1);
      }

      if (count && ms > 0) timed.push({ word, wpm: (count / 5) / (ms / 60000) });
    }

    start = end + 1;
  }

  timed.sort((a, b) => a.wpm - b.wpm);
  const slow: { word: string; wpm: number }[] = [];

  for (const item of timed) {
    if (slow.length >= slowLimit) break;

    if (!missed.includes(item.word) && !slow.some((s) => s.word === item.word)) slow.push({ word: item.word, wpm: Math.round(item.wpm) });
  }

  const mid = timed.length >> 1;
  const medianWpm = !timed.length ? null : Math.round(timed.length % 2 ? indexed(timed, mid).wpm : (indexed(timed, mid - 1).wpm + indexed(timed, mid).wpm) / 2);

  return { missed, slow, timedCount: timed.length, medianWpm };
}

// What a word-practice passage asks for beyond plain letters, as test conditions: punctuation is any
// character that isn't a letter, digit or space (a capital is a letter, so "The" alone isn't punctuation),
// and numbers is any digit, which is never punctuation.
export function practiceTextConditions(text: string) {
  return { punctuation: /[^\p{L}\p{N} ]/u.test(text), numbers: /\p{N}/u.test(text) };
}

// Deterministic: the same words always build the same practice passage. It grows past `length`
// when there are more words, so every word offered is in it.
export function practiceWordsPassage(words: string[], length = 40) {
  if (!words.length) return '';
  length = Math.max(length, words.length);
  let seed = 2166136261;

  for (const char of words.join(' ')) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;

  const random = () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const out: string[] = [];

  while (out.length < length) {
    const round = [...words];

    for (let i = round.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [round[i], round[j]] = [indexed(round, j), indexed(round, i)];
    }

    // Avoid the same word twice in a row across rounds.
    if (round.length > 1 && round[0] === out.at(-1)) { const first = round.shift();

 if (first !== undefined) round.push(first); }

    out.push(...round);
  }

  return out.slice(0, length).join(' ');
}
