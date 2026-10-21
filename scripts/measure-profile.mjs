// Account profile size and sync cost at retention's limits: builds worst-case profiles with the app's own
// engine and retention, then measures the JSON, a push's merge, signature and stringify work, and the
// request a push sends. Seeded, so reruns build the same profiles. Run: node scripts/measure-profile.mjs
// (add --json for machine-readable output).
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { mergeAndHold, mergeSynced, sameProfile, stampProfile, storedCopy, syncSignature } from '../src/account.js';
import { boardColumn } from '../src/friends-board.js';
import { MAX_NON_COMPARABLE_RUNS, MAX_PATTERN_RUNS, MAX_PRACTICE_DAYS, MAX_RUN_SUMMARIES, MAX_TRACES, TRACE_BUDGET, dayKey, runRecord } from '../src/insights.js';
import { MAX_COMPOSITIONS, compositionRecord } from '../src/compose.js';
import { LESSONS } from '../src/lessons.js';
import { defaultPreferences, normalizeProfile } from '../src/profile.js';
import { CORPUS_VERSION, METRIC_VERSION, compareAttempts, completeAttempt, conditionKey, createAttempt, makePassage, textId } from '../src/typing.js';

let seed = 0x5eed;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (items) => items[Math.floor(random() * items.length)];
let ids = 0;
const uid = () => {
  ids += 1;
  const hex = (n) => Array.from({ length: n }, () => Math.floor(random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
};

const END = Date.UTC(2026, 9, 21, 18);
const DAY_MS = 86400000;
const iso = (ms) => new Date(ms).toISOString();

const baseConditions = (over = {}) => ({
  mode: 'time', duration: 60, count: null, punctuation: false, numbers: false, quoteLength: null, difficulty: null,
  wordList: 'english-1k', inputClass: 'physical-keyboard', layout: 'qwerty', correctionPolicy: 'relaxed',
  strictSpace: false, quickEnd: true, language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, ...over,
});

// One run typed key by key the way the app records it: a steady pace with jitter, and a mistyped letter
// now and then, fixed with a backspace (continue on error). Time tests stop at their duration.
function typeRun({ kind = 'test', conditions, wpm, errorRate, at, seconds }) {
  const text = makePassage(conditions.mode === 'words' ? 'words' : 'time', conditions.count || 25, conditions.punctuation, random,
    conditions.wordList || 'english-1k', conditions.numbers, seconds);
  const attempt = createAttempt({ id: uid(), text, textId: textId(text), kind, conditions });
  const msPerChar = 60000 / (wpm * 5);
  const limit = conditions.mode === 'time' ? seconds * 1000 : Infinity;
  let t = 0;
  for (let position = 0; position < text.length; position += 1) {
    t += Math.round(msPerChar * (0.55 + random() * 0.9));
    if (t > limit) break;
    if (random() < errorRate) {
      attempt.events.push({ type: 'insert', text: pick('etaoinshrdlu'), position, accepted: true, offsetMs: t });
      t += Math.round(msPerChar * 1.6);
      attempt.events.push({ type: 'delete', count: 1, offsetMs: t });
      t += Math.round(msPerChar);
    }
    attempt.events.push({ type: 'insert', text: text[position], position, accepted: true, offsetMs: t });
  }
  attempt.status = 'running';
  attempt.startedAt = attempt.events[0].offsetMs;
  const done = completeAttempt(attempt, { endedAt: Math.min(t, limit) });
  return { ...done, status: 'complete', interrupted: false, unsupportedInput: false, fresh: true, at };
}

// Test shapes a person who tries everything ends up with a best at: lengths, word lists, punctuation and
// numbers, quote filters, code languages, books, custom lengths, both inputs, every correction policy and
// the strict-space and quick-end rules, a few layouts.
function shapes(count) {
  const keys = new Map();
  const variants = [
    () => ({ mode: 'time', duration: pick([15, 30, 60, 120, 45, 90, 300]), wordList: pick(['english', 'english-1k', 'english-5k', 'english-10k']) }),
    () => ({ mode: 'words', duration: null, count: pick([10, 25, 50, 100, 75, 200]), wordList: pick(['english', 'english-1k', 'english-5k', 'english-10k']) }),
    () => ({ mode: 'quote', duration: null, wordList: null, numbers: false, quoteLength: pick(['any', 'short', 'medium', 'long']), difficulty: pick(['any', 'steady', 'precise', 'long', 'punctuation']) }),
    () => ({ mode: 'code', duration: null, wordList: null, numbers: false, punctuation: true, codeLanguage: pick(['js', 'python', 'rust', 'go', 'c', 'sql']) }),
    () => ({ mode: 'book', duration: null, wordList: null, numbers: false, punctuation: true, book: pick(['alice', 'pride', 'sherlock', 'frankenstein']), bookVersion: 'gutenberg-en-v1' }),
  ];
  while (keys.size < count) {
    const conditions = baseConditions({
      punctuation: random() < 0.4, numbers: random() < 0.3,
      ...pick(variants)(),
      inputClass: random() < 0.85 ? 'physical-keyboard' : 'touch',
      correctionPolicy: pick(['relaxed', 'relaxed', 'mandatory', 'no-backspace', 'fail-word', 'fail-any']),
      strictSpace: random() < 0.2, quickEnd: random() < 0.85, layout: pick(['qwerty', 'qwerty', 'qwerty', 'dvorak', 'colemak']),
    });
    keys.set(conditionKey(conditions), conditions);
  }
  return [...keys.keys()];
}

// A year of practice on three devices with two tabs open on each. `counters`: 'per-tab' gives each of the
// six tabs one counter for the whole year; 'per-load' mints one per tab per day, as the app does (a counter
// lives as long as its page).
function runCounts(days, counters) {
  const counts = {};
  const name = () => uid().slice(0, 8);
  const tabs = counters === 'per-tab' ? Array.from({ length: 6 }, name) : null;
  for (let d = 0; d < days; d += 1) {
    const day = dayKey(iso(END - d * DAY_MS));
    for (let tab = 0; tab < 6; tab += 1) {
      const counter = tabs ? tabs[tab] : name();
      const started = 3 + Math.floor(random() * 30);
      (counts[counter] ||= {})[day] = [started, Math.floor(started * (0.5 + random() * 0.5))];
    }
  }
  return counts;
}

// The profile row at retention's limits. `run`: the test most runs are, which sets how big each trace is.
function buildProfile({ run, days, seen, loops, bestCount, counters }) {
  const comparable = MAX_RUN_SUMMARIES + 20;
  const span = days * DAY_MS;
  const traces = [];
  const runs = [];
  for (let n = 0; n < comparable; n += 1) {
    const at = iso(END - span + Math.round(((n + 1) / comparable) * span) - 3600000);
    const kind = n % 25 === 0 ? 'daily' : n % 9 === 0 ? 'retest' : n % 13 === 0 ? 'drill' : 'test';
    const conditions = kind === 'daily' ? baseConditions({ mode: 'quote', duration: null, wordList: null, punctuation: true, quoteLength: 'medium', difficulty: 'any' }) : baseConditions(run.conditions);
    const attempt = typeRun({ kind, conditions, wpm: run.wpm + Math.round((random() - 0.5) * 20), errorRate: run.errorRate, at, seconds: run.seconds });
    if (kind === 'daily') Object.assign(attempt, { challengeDate: dayKey(at), firstDailyAttempt: true });
    if (n >= comparable - MAX_TRACES) traces.push(attempt);
    runs.push(runRecord(attempt));
  }
  for (let n = 0; n < MAX_NON_COMPARABLE_RUNS; n += 1) {
    const at = iso(END - span + Math.round(((n + 0.5) / MAX_NON_COMPARABLE_RUNS) * span));
    const kind = pick(['custom', 'missed', 'challenge']);
    runs.push(runRecord(typeRun({ kind, conditions: baseConditions({ mode: kind === 'missed' ? 'missed' : kind, duration: null, wordList: null }), wpm: run.wpm, errorRate: run.errorRate, at, seconds: 30 })));
  }
  runs.sort((a, b) => a.at.localeCompare(b.at));

  const practiceDays = {};
  for (let d = 0; d < days; d += 1) practiceDays[dayKey(iso(END - d * DAY_MS))] = 60000 + Math.floor(random() * 3600000);

  const bests = {};
  for (const key of shapes(bestCount)) bests[key] = { wpm: 40 + Math.floor(random() * 120), attemptId: uid(), at: iso(END - Math.floor(random() * span)) };

  const seenTextIds = Array.from({ length: seen }, () => `generated-${Math.floor(random() * 2 ** 32).toString(36)}`);

  const baseline = traces.at(-2);
  const after = traces.at(-1);
  const comparison = compareAttempts({ ...baseline, kind: 'test' }, { ...after, kind: 'retest' });
  const loopList = Array.from({ length: loops }, (_, n) => ({
    id: uid(), at: iso(END - span + Math.round(((n + 1) / loops) * span)), beforeAttemptId: uid(), afterAttemptId: uid(),
    target: pick(['th', 'he', 'in', 'er', 'an']), recommendationKind: 'pair', drillCompleted: true, conditions: after.conditions, comparison,
    targetTiming: { target: 'th', beforeCount: 14, afterCount: 12, deltaMs: -8 },
    drill: { target: 'th', duration: 60, wordList: 'english-1k', textVersion: 'drill-th@1' },
  }));

  const lessons = Object.fromEntries(LESSONS.map((lesson, n) => {
    const result = (offset) => ({ at: iso(END - offset * DAY_MS), wpm: 30 + n, accuracy: 96, inputClass: 'physical-keyboard' });
    return [lesson.id, { tries: 12, last: result(n), passed: result(n + 20) }];
  }));

  const compositions = Array.from({ length: MAX_COMPOSITIONS }, (_, n) => compositionRecord(
    { characters: 900, words: 160, keystrokes: 1100, backspaces: 120, activeMs: 420000, elapsedMs: 600000, wpm: 26, backspaceRate: 11 },
    { id: uid(), at: iso(END - (MAX_COMPOSITIONS - n) * 3 * DAY_MS), promptId: null }));

  // Ten clears over the year, six of them undone, the four standing ones naming records stamped ahead.
  const clears = Array.from({ length: 10 }, (_, n) => `${iso(END - span + (n + 1) * (span / 11))}~${uid().slice(0, 8)}`);
  const standing = clears.filter((_, n) => n % 5 === 2 || n % 5 === 4);
  const stored = normalizeProfile({
    version: 2, profileId: uid(),
    preferences: { ...defaultPreferences, theme: 'midnight', customText: 'The quick brown fox jumps over the lazy dog. '.repeat(60).trim() },
    preferencesAt: Object.fromEntries(Object.keys(defaultPreferences).map((key) => [key, iso(END - Math.floor(random() * span))])),
    attempts: traces, runs, practiceDays, runCounts: runCounts(days, counters), loops: loopList, seenTextIds, bests, lessons, compositions,
    historyClearedAt: standing.at(-1), appliedClears: standing.slice(0, -1), heardClears: [],
    historyClearedIds: standing.flatMap((marker) => Array.from({ length: 8 }, () => [marker, uid()])),
    undoneClears: clears.filter((marker) => !standing.includes(marker)),
  });
  return stampProfile(stored, iso(END));
}

// What another device holds when this one pushes: the same history, plus runs and counts the other lacks
// on each side, so the merge does real work and the result differs from both.
function divergentCopies(profile) {
  const clone = () => JSON.parse(JSON.stringify(profile));
  const local = clone();
  const cloud = clone();
  const extra = (copy, minutes) => {
    const at = iso(END + minutes * 60000);
    const attempt = typeRun({ conditions: copy.attempts.at(-1).conditions, wpm: 100, errorRate: 0.03, at, seconds: copy.attempts.at(-1).conditions.duration || 60 });
    copy.attempts.push(attempt);
    copy.runs.push(runRecord(attempt));
    copy.seenTextIds.push(attempt.textId);
    copy.runCounts[uid().slice(0, 8)] = { [dayKey(at)]: [1, 1] };
    stampProfile(copy, at);
  };
  extra(local, 5);
  extra(cloud, 3);
  return { local: normalizeProfile(local), cloudData: cloud };
}

function time(fn, runs) {
  for (let i = 0; i < 3; i += 1) fn();
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { median: samples[Math.floor(samples.length / 2)], max: samples.at(-1) };
}

const bytes = (text) => Buffer.byteLength(text);
const fieldSizes = (profile) => Object.fromEntries(Object.entries(profile).map(([key, value]) => [key, bytes(JSON.stringify(value) ?? '')]).sort((a, b) => b[1] - a[1]));

function measure(name, options, runs) {
  const profile = buildProfile(options);
  const { local, cloudData } = divergentCopies(profile);
  const at = iso(END + 600000);
  const dailyKey = conditionKey(baseConditions({ mode: 'quote', duration: null, wordList: null, punctuation: true, quoteLength: 'medium', difficulty: 'any' }));
  const row = { user_id: uid(), data: storedCopy(cloudData), updated_at: at, board: boardColumn(cloudData.runs, dailyKey, at) };
  const response = JSON.stringify([row]);
  const theirs = normalizeProfile(JSON.parse(response)[0].data);
  const merged = mergeSynced(local, theirs);
  const stored = storedCopy(merged);
  const body = JSON.stringify({ data: stored, updated_at: at, board: boardColumn(merged.runs, dailyKey, at) });
  const json = JSON.stringify(stored);
  const trace = merged.attempts.at(-1);
  const { summary, events, ...rest } = trace;
  // pushOnce in src/app.js: read the row, merge it in, compare, write, then take the merged copy in and cache it.
  const push = () => {
    const data = normalizeProfile(JSON.parse(response)[0].data);
    const { merged: copy } = mergeAndHold({}, local, data);
    sameProfile(copy, data);
    JSON.stringify({ data: storedCopy(copy), updated_at: at, board: boardColumn(copy.runs, dailyKey, at) });
    const before = syncSignature(local);
    const { merged: absorbed } = mergeAndHold({}, local, copy);
    syncSignature(absorbed) !== before;
    JSON.stringify(storedCopy(absorbed));
    sameProfile(absorbed, copy);
  };
  return {
    name,
    options,
    counts: {
      attempts: merged.attempts.length, runs: merged.runs.length, practiceDays: Object.keys(merged.practiceDays).length,
      runCountCounters: Object.keys(merged.runCounts).length, runCountDays: Object.values(merged.runCounts).reduce((n, days) => n + Object.keys(days).length, 0),
      bests: Object.keys(merged.bests).length, seenTextIds: merged.seenTextIds.length, loops: merged.loops.length,
    },
    sizes: {
      profile: bytes(json),
      profileGzip: gzipSync(json).length,
      pushRequestBody: bytes(body),
      pushResponseBody: bytes(response),
      pushResponseGzip: gzipSync(response).length,
      fields: fieldSizes(stored),
      newestTrace: { total: bytes(JSON.stringify(trace)), events: bytes(JSON.stringify(events)), summary: bytes(JSON.stringify(summary)), rest: bytes(JSON.stringify(rest)), keys: events.length },
      runSummary: { withPatterns: bytes(JSON.stringify(merged.runs.at(-1))), trimmed: bytes(JSON.stringify(merged.runs.find((r) => r.patterns && !r.patterns.length))) },
    },
    ms: {
      parseResponse: time(() => JSON.parse(response), runs),
      normalizeProfile: time(() => normalizeProfile(JSON.parse(response)[0].data), runs),
      mergeSynced: time(() => mergeSynced(local, theirs), runs),
      mergeAndHold: time(() => mergeAndHold({}, local, theirs), runs),
      syncSignature: time(() => syncSignature(merged), runs),
      stringify: time(() => JSON.stringify(storedCopy(merged)), runs),
      push: time(push, runs),
    },
  };
}

const scenarios = [
  ['typical: 30 s tests at 75 wpm', { run: { seconds: 30, wpm: 75, errorRate: 0.04, conditions: { duration: 30 } }, days: 365, seen: 4000, loops: 60, bestCount: 40, counters: 'per-tab' }],
  ['worst: 60 s tests at 120 wpm', { run: { seconds: 60, wpm: 120, errorRate: 0.03, conditions: { duration: 60 } }, days: 365, seen: 20000, loops: 365, bestCount: 400, counters: 'per-load' }],
  ['worst, two years kept', { run: { seconds: 60, wpm: 120, errorRate: 0.03, conditions: { duration: 60 } }, days: MAX_PRACTICE_DAYS, seen: 40000, loops: 730, bestCount: 400, counters: 'per-load' }],
];

const results = scenarios.map(([name, options]) => measure(name, options, 15));
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  const ms = ({ median, max }) => `${median.toFixed(1)} ms (max ${max.toFixed(1)})`;
  console.log(`Limits: ${MAX_RUN_SUMMARIES} runs, ${MAX_PATTERN_RUNS} with patterns, ${MAX_TRACES} traces within ${TRACE_BUDGET.toLocaleString('en')} characters, ${MAX_PRACTICE_DAYS} days. Node ${process.version}.`);
  for (const result of results) {
    console.log(`\n${result.name}`);
    console.log(`  counts   ${Object.entries(result.counts).map(([key, n]) => `${key} ${n}`).join(', ')}`);
    console.log(`  profile  ${kb(result.sizes.profile)} (gzip ${kb(result.sizes.profileGzip)}); push sends ${kb(result.sizes.pushRequestBody)}, reads ${kb(result.sizes.pushResponseBody)} (gzip ${kb(result.sizes.pushResponseGzip)})`);
    console.log(`  fields   ${Object.entries(result.sizes.fields).filter(([, n]) => n > 1024).map(([key, n]) => `${key} ${kb(n)}`).join(', ')}`);
    const t = result.sizes.newestTrace;
    console.log(`  trace    ${kb(t.total)} for ${t.keys} events: events ${kb(t.events)}, summary ${kb(t.summary)}, rest ${kb(t.rest)}`);
    console.log(`  run      ${result.sizes.runSummary.withPatterns} B with patterns, ${result.sizes.runSummary.trimmed} B trimmed`);
    for (const [key, value] of Object.entries(result.ms)) console.log(`  ${key.padEnd(17)} ${ms(value)}`);
  }
}
