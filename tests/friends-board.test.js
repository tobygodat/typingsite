import test from 'node:test';
import assert from 'node:assert/strict';
import { CORPUS_VERSION, METRIC_VERSION, conditionKey } from '../src/typing.js';
import { boardSummary, dailyOrder, dailyVersion, practiceTime, publishSummary, readBoard, weekOrder, weekStart } from '../src/friends-board.js';
import { dailyPassage } from '../src/insights.js';

const daily = { mode: 'quote', duration: null, count: null, punctuation: true, quoteLength: 'medium', difficulty: 'any',
  wordList: null, inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };
const dailyKey = conditionKey(daily);
const words = { ...daily, mode: 'words', count: 25, quoteLength: null, difficulty: null, wordList: '200', punctuation: false };
// Friday 9 October 2026, 15:00 UTC: the week began on Monday 5 October.
const now = new Date('2026-10-09T15:00:00Z');
const run = (id, overrides = {}) => ({ id, at: '2026-10-09T12:00:00Z', status: 'complete', kind: 'test', interrupted: false,
  conditions: words, score: { wpm: 70, accuracy: 97 }, elapsedMs: 30000, challengeDate: null, ...overrides });
const dailyRun = (id, wpm, accuracy, overrides = {}) => run(id, { kind: 'daily', conditions: daily, challengeDate: '2026-10-09',
  score: { wpm, accuracy }, elapsedMs: 41000, ...overrides });
const session = { user: { id: 'ada' }, access_token: 'account-token', expires_at: 9999999999 };

test('weeks start on Monday 00:00 UTC, whatever the local day', () => {
  assert.equal(weekStart(now), '2026-10-05');
  assert.equal(weekStart(new Date('2026-10-05T00:00:00Z')), '2026-10-05');
  assert.equal(weekStart(new Date('2026-10-04T23:59:59Z')), '2026-09-28');
  assert.equal(weekStart(new Date('2026-10-11T23:59:59Z')), '2026-10-05');
});

test('the daily result is today’s best completed physical-keyboard attempt, with the attempt count', () => {
  const runs = [
    dailyRun('first', 64, 98),
    dailyRun('second', 78, 95),
    dailyRun('tie-on-speed', 78, 97),
    dailyRun('interrupted', 120, 99, { interrupted: true }),
    dailyRun('unfinished', 118, 99, { status: 'interrupted' }),
    dailyRun('touch', 115, 99, { conditions: { ...daily, inputClass: 'touch' } }),
    dailyRun('yesterday', 110, 99, { challengeDate: '2026-10-08', at: '2026-10-08T12:00:00Z' }),
    dailyRun('impossible', 900, 100),
    run('practice', { score: { wpm: 130, accuracy: 100 } }),
  ];
  assert.deepEqual(boardSummary(runs, dailyKey, now).daily, { date: '2026-10-09', version: dailyVersion(dailyKey, now), wpm: 78, accuracy: 97, attempts: 3 });
  assert.equal(boardSummary([run('practice')], dailyKey, now).daily, null);
});

test('a daily result carries its version: the conditions key (corpus and metric version) and the passage', () => {
  const version = dailyVersion(dailyKey, now);
  assert.equal(version, `${dailyKey}|${dailyPassage(now).textVersion}`);
  assert.ok(version.includes(METRIC_VERSION) && version.includes(CORPUS_VERSION));
  assert.match(version, /^[ -~]{1,200}$/, 'the service accepts printable ASCII up to 200 characters');
  assert.notEqual(dailyVersion(conditionKey({ ...daily, metricVersion: 'stilltype-metrics-v0' }), now), version);
  assert.notEqual(dailyVersion(dailyKey, new Date('2026-10-10T15:00:00Z')), version, 'another day is another passage');
});

test('practice time counts completed, uninterrupted runs since Monday, and nothing undated', () => {
  const runs = [
    run('today', { elapsedMs: 30000 }),
    run('monday', { at: '2026-10-05T00:00:00Z', elapsedMs: 60000, kind: 'drill' }),
    dailyRun('daily', 80, 96, { elapsedMs: 45400 }),
    run('sunday', { at: '2026-10-04T23:59:59Z', elapsedMs: 120000 }),
    run('interrupted', { interrupted: true, elapsedMs: 9000 }),
    run('abandoned', { status: 'interrupted', elapsedMs: 9000 }),
    run('undated', { at: null, elapsedMs: 9000 }),
  ];
  assert.deepEqual(boardSummary(runs, dailyKey, now).week, { start: '2026-10-05', seconds: 135, runs: 3 });
  assert.deepEqual(boardSummary([], dailyKey, now), { daily: null, week: { start: '2026-10-05', seconds: 0, runs: 0 } });
});

test('practice time reads in seconds, then minutes, and never rounds up', () => {
  assert.deepEqual(practiceTime(0), { value: '0', unit: 'min' });
  assert.deepEqual(practiceTime(45), { value: '45', unit: 's' });
  assert.deepEqual(practiceTime(599), { value: '9.9', unit: 'min' });
  assert.deepEqual(practiceTime(600), { value: '10', unit: 'min' });
  assert.deepEqual(practiceTime(2459), { value: '40', unit: 'min' });
});

test('board order: fastest daily first, accuracy breaks a tie, nobody-yet last; most practice first', () => {
  const rows = [
    { self: true, daily: { wpm: 72, accuracy: 96, attempts: 1 }, week: { seconds: 300, runs: 4 } },
    { name: 'Lin', daily: { wpm: 72, accuracy: 98, attempts: 2 }, week: { seconds: 2400, runs: 30 } },
    { name: 'Sam', daily: null, week: null },
    { name: 'Kai', daily: { wpm: 88, accuracy: 94, attempts: 1 }, week: { seconds: 0, runs: 0 } },
    { name: 'Ana', daily: null, week: { seconds: 300, runs: 2 } },
  ];
  assert.deepEqual(dailyOrder(rows).map((row) => row.name || 'you'), ['Kai', 'Lin', 'you', 'Ana', 'Sam']);
  assert.deepEqual(weekOrder(rows).map((row) => row.name || 'you'), ['Lin', 'you', 'Ana', 'Kai', 'Sam']);
});

test('the board sends only the signed-in summary, as that account', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, headers: options.headers, data: JSON.parse(options.body) });
    return new Response(JSON.stringify({ date: '2026-10-09', weekStart: '2026-10-05', rows: [] }));
  };
  try {
    const summary = boardSummary([dailyRun('daily', 80, 96)], dailyKey, now);
    await publishSummary(session, summary);
    await readBoard(session);
    await publishSummary(session, boardSummary([], dailyKey, now), { replace: true });
    assert.match(calls[0].url, /\/rest\/v1\/rpc\/friends_board$/);
    assert.equal(calls[0].headers.Authorization, 'Bearer account-token');
    assert.deepEqual(calls[0].data, { p_action: 'publish', p_data: summary });
    assert.deepEqual(Object.keys(calls[0].data.p_data.daily).sort(), ['accuracy', 'attempts', 'date', 'version', 'wpm']);
    assert.deepEqual(calls[1].data, { p_action: 'board', p_data: {} });
    // A history clear or undo replaces the stored summary instead of being folded into it.
    assert.deepEqual(calls[2].data, { p_action: 'replace', p_data: { daily: null, week: { start: '2026-10-05', seconds: 0, runs: 0 } } });
  } finally { globalThis.fetch = original; }
});

test('a service without the board migration says it is being set up', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Could not find the function public.friends_board(p_action, p_data) in the schema cache' }), { status: 404 });
  try {
    await assert.rejects(readBoard(session), /being set up/);
  } finally { globalThis.fetch = original; }
});
