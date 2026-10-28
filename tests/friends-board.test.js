import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { CORPUS_VERSION, METRIC_VERSION, conditionKey } from '../src/typing.js';
import { BOARD_V, boardColumn, boardCurrent, boardSummary, dailyOrder, dailyVersion, nextRead, practiceTime, readBoard, readDue, readSharing, sharingValue, startSharing, stopSharing, versionOf, weekOrder, weekStart } from '../src/friends-board.js';
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

test('each day’s daily result is its best completed physical-keyboard attempt, with the attempt count', () => {
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

  assert.deepEqual(boardSummary(runs, dailyKey).days, {
    '2026-10-09': { version: dailyVersion(dailyKey, now), wpm: 78, accuracy: 97, attempts: 3 },
    '2026-10-08': { version: dailyVersion(dailyKey, new Date('2026-10-08T00:00:00Z')), wpm: 110, accuracy: 99, attempts: 1 },
  });
  assert.deepEqual(boardSummary([run('practice')], dailyKey).days, {});
});

test('a daily result carries its version: the conditions key (corpus and metric version) and the passage', () => {
  const version = dailyVersion(dailyKey, now);
  assert.equal(version, `${dailyKey}|${dailyPassage(now).textVersion}`);
  assert.ok(version.includes(METRIC_VERSION) && version.includes(CORPUS_VERSION));
  assert.match(version, /^[ -~]{1,200}$/, 'the service accepts printable ASCII up to 200 characters');
  assert.notEqual(dailyVersion(conditionKey({ ...daily, metricVersion: 'stilltype-metrics-v0' }), now), version);
  assert.notEqual(dailyVersion(dailyKey, new Date('2026-10-10T15:00:00Z')), version, 'another day is another passage');
});

test('practice time counts completed, uninterrupted runs in the week (from Monday 00:00 UTC) each was run, and nothing undated', () => {
  const runs = [
    run('today', { elapsedMs: 30000 }),
    run('monday', { at: '2026-10-05T00:00:00Z', elapsedMs: 60000, kind: 'drill' }),
    dailyRun('daily', 80, 96, { elapsedMs: 45400 }),
    run('sunday', { at: '2026-10-04T23:59:59Z', elapsedMs: 120000 }),
    run('interrupted', { interrupted: true, elapsedMs: 9000 }),
    run('abandoned', { status: 'interrupted', elapsedMs: 9000 }),
    run('undated', { at: null, elapsedMs: 9000 }),
  ];

  assert.deepEqual(boardSummary(runs, dailyKey).weeks, { '2026-10-05': { seconds: 135, runs: 3 }, '2026-09-28': { seconds: 120, runs: 1 } });
  assert.deepEqual(boardSummary([], dailyKey), { days: {}, weeks: {}, bests: {} });
});

test('practice time is the week’s whole completed seconds: the runs’ time summed, then floored, never rounded up', () => {
  // 59.5 s of practice is 59 completed seconds, not a minute.
  assert.deepEqual(boardSummary([run('a', { elapsedMs: 29750 }), run('b', { elapsedMs: 29750 })], dailyKey).weeks,
    { '2026-10-05': { seconds: 59, runs: 2 } });
  assert.deepEqual(practiceTime(boardSummary([run('a', { elapsedMs: 59999.9 })], dailyKey).weeks['2026-10-05'].seconds), { value: '59', unit: 's' });
  // Floored once, after summing: three runs of 20.6 s are 61 seconds, not 3 × 20.
  assert.deepEqual(boardSummary(['a', 'b', 'c'].map((id) => run(id, { elapsedMs: 20600 })), dailyKey).weeks,
    { '2026-10-05': { seconds: 61, runs: 3 } });
});

test('custom-text runs count in neither the daily nor practice time, as Progress counts none of them', () => {
  const custom = { ...words, mode: 'custom', count: null, wordList: null, customOrder: 'as-written' };

  const runs = [
    run('today', { elapsedMs: 30000 }),
    dailyRun('daily', 80, 96, { elapsedMs: 45000 }),
    run('custom', { kind: 'custom', conditions: custom, elapsedMs: 90000, score: { wpm: 150, accuracy: 100 } }),
    run('custom-as-daily', { kind: 'custom', conditions: daily, challengeDate: '2026-10-09', elapsedMs: 40000, score: { wpm: 150, accuracy: 100 } }),
    run('custom-only-week', { kind: 'custom', conditions: custom, at: '2026-09-29T12:00:00Z', elapsedMs: 50000 }),
  ];

  const summary = boardSummary(runs, dailyKey);
  assert.deepEqual(summary.weeks, { '2026-10-05': { seconds: 75, runs: 2 } });
  assert.deepEqual(summary.days, { '2026-10-09': { version: dailyVersion(dailyKey, now), wpm: 80, accuracy: 96, attempts: 1 } });
});

test('each run counts in its own day and week, whatever the writing device’s clock says', () => {
  // Monday 12 October: a phone with a correct clock played Monday's daily at 00:05 UTC and practised.
  const monday = new Date('2026-10-12T00:05:00Z');

  const runs = [
    dailyRun('monday-daily', 82, 97, { challengeDate: '2026-10-12', at: '2026-10-12T00:04:00Z' }),
    run('sunday-practice', { at: '2026-10-11T22:00:00Z', elapsedMs: 600000 }),
  ];

  const expected = {
    days: { '2026-10-12': { version: dailyVersion(dailyKey, monday), wpm: 82, accuracy: 97, attempts: 1 } },
    weeks: { '2026-10-12': { seconds: 41, runs: 1 }, '2026-10-05': { seconds: 600, runs: 1 } },
  };

  // A laptop ten minutes slow (still Sunday) and one ten minutes fast write the same summary as the
  // phone: the service, on Monday, finds Monday's daily and this week's practice in each.
  for (const clock of ['2026-10-11T23:58:00Z', '2026-10-12T00:08:00Z', '2026-10-12T00:18:00Z']) {
    mock.timers.enable({ apis: ['Date'], now: Date.parse(clock) });

    try {
      assert.equal(new Date().toISOString(), new Date(clock).toISOString());
      const { days, weeks } = boardSummary(runs, dailyKey);
      assert.deepEqual({ days, weeks }, expected, clock);
    } finally { mock.timers.reset(); }
  }
});

test('a summary keeps only the latest two days and weeks', () => {
  const runs = ['2026-10-07', '2026-10-08', '2026-10-09'].map((day, index) => dailyRun(`daily-${day}`, 70 + index, 97,
    { challengeDate: day, at: `${day}T12:00:00Z` }));

  runs.push(run('older', { at: '2026-09-23T12:00:00Z' }), run('last-week', { at: '2026-10-01T12:00:00Z' }));
  const summary = boardSummary(runs, dailyKey);
  assert.deepEqual(Object.keys(summary.days), ['2026-10-09', '2026-10-08']);
  assert.deepEqual(Object.keys(summary.weeks), ['2026-10-05', '2026-09-28']);
  assert.deepEqual(summary.weeks['2026-10-05'], { seconds: 123, runs: 3 });
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

test('the board sends no numbers: reading, sharing (with only the sharing version it read) and stopping (with only the opt-out’s id), as the signed-in account', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, headers: options.headers, data: JSON.parse(options.body) });

    return new Response(JSON.stringify({ date: '2026-10-09', weekStart: '2026-10-05', sharing: true, sharingVersion: 3, nextDay: 32400, rows: [] }));
  };

  try {
    const read = await readBoard(session);
    await startSharing(session, versionOf(read));
    await stopSharing(session, 'mgm1k2-abc123');
    // Without an id it goes without one (the board itself always sends the kept id): a new opt-out.
    await stopSharing(session, null);
    assert.match(calls[0].url, /\/rest\/v1\/rpc\/friends_board$/);
    assert.equal(calls[0].headers.Authorization, 'Bearer account-token');
    assert.deepEqual(calls.map((call) => call.data), [
      { p_action: 'board', p_data: {} },
      { p_action: 'share', p_data: { version: 3 } },
      { p_action: 'unshare', p_data: { id: 'mgm1k2-abc123' } },
      { p_action: 'unshare', p_data: {} },
    ]);
  } finally { globalThis.fetch = original; }
});

test('a reply’s sharing version is a whole number, or none', () => {
  assert.equal(versionOf({ sharingVersion: 0 }), 0);
  assert.equal(versionOf({ sharingVersion: 41 }), 41);

  for (const value of [undefined, null, -1, 1.5, '3', Number.MAX_SAFE_INTEGER + 2, NaN]) assert.equal(versionOf({ sharingVersion: value }), null);
  assert.equal(versionOf(null), null);
});

test('a device keeps whether the account shares with the version that said so, in one value its tabs adopt together', () => {
  assert.equal(sharingValue(true, 7), '1:7');
  assert.equal(sharingValue(false, 0), '0:0');
  assert.equal(sharingValue(false, null), '0', 'an opt-out not confirmed yet has no version');

  for (const [value, version] of [[true, 7], [false, 0], [false, null], [true, Number.MAX_SAFE_INTEGER]]) {
    assert.deepEqual(readSharing(sharingValue(value, version)), { sharing: value, version });
  }

  // Kept by a build before the version: the state, and no version, so a share reads the board first.
  assert.deepEqual(readSharing('1'), { sharing: true, version: null });
  assert.deepEqual(readSharing('0'), { sharing: false, version: null });

  for (const junk of [null, undefined, '', 'true', '2', '1:', '1:-1', '1:1.5', '1:x', '0:9007199254740993', '0:12345678901234567', ' 1:3', '1:3 ']) {
    assert.deepEqual(readSharing(junk), { sharing: null, version: null });
  }
});

test('the profile row’s board column is the summary of its runs, stamped with the write', () => {
  const at = '2026-10-09T15:00:00.123Z';
  const runs = [dailyRun('daily', 80, 96, { challengeDate: new Date().toISOString().slice(0, 10), at: new Date().toISOString() })];
  const column = boardColumn(runs, dailyKey, at);
  assert.equal(column.v, BOARD_V);
  assert.equal(column.at, at);
  assert.deepEqual({ days: column.days, weeks: column.weeks, bests: column.bests }, boardSummary(runs, dailyKey));
  assert.deepEqual(Object.keys(column).sort(), ['at', 'bests', 'days', 'v', 'weeks']);
  // Small enough for the column's 16 KB check by a wide margin.
  assert.ok(JSON.stringify(column).length < 1024);
});

test('a row’s summary is current only while it is stamped with the row’s own updated_at, in this build’s shape', () => {
  const at = '2026-10-09T15:00:00.123Z';
  const board = boardColumn([], dailyKey, at);
  assert.equal(boardCurrent({ updated_at: at, board }), true);
  // The service writes timestamps back with an offset and microseconds; the same moment still matches.
  assert.equal(boardCurrent({ updated_at: '2026-10-09T15:00:00.123+00:00', board }), true);
  assert.equal(boardCurrent({ updated_at: '2026-10-09T17:00:00.123+02:00', board }), true);
  // A later save that left the column alone (an older build), no column, or a column from before `v`.
  assert.equal(boardCurrent({ updated_at: '2026-10-09T15:00:01.000Z', board }), false);
  assert.equal(boardCurrent({ updated_at: at, board: null }), false);
  assert.equal(boardCurrent({ updated_at: at }), false);
  assert.equal(boardCurrent(null), false);
  assert.equal(boardCurrent({ updated_at: at, board: { ...board, v: undefined } }), false);
  assert.equal(boardCurrent({ updated_at: at, board: { ...board, v: BOARD_V - 1 } }), false);
  assert.equal(boardCurrent({ updated_at: at, board: { ...board, at: 'yesterday' } }), false);
});

test('the next day’s read comes nextDay seconds after the reply arrived, by either clock, and never without one', () => {
  assert.deepEqual(nextRead({ nextDay: 30 }, 1000, 50), { wall: 31000, mono: 30050 });
  assert.deepEqual(nextRead({ nextDay: 0 }, 1000, 50), { wall: 1000, mono: 50 });
  assert.equal(nextRead({}, 1000, 50), null);
  assert.equal(nextRead(null, 1000, 50), null);
  assert.equal(nextRead({ nextDay: '30' }, 1000, 50), null);
  // With no board read yet, a read is due.
  assert.equal(readDue(null, 0, 0), true);
});

test('setting the clock back while the board is open doesn’t hold the midnight read back', () => {
  // Read at 22:00 UTC on the service, on a device whose clock is three hours fast (01:00): two hours to go.
  const hour = 3600000;
  const fast = Date.parse('2026-10-10T01:00:00Z');
  const at = nextRead({ nextDay: 7200 }, fast, 1000);
  // The clock is then corrected back to 22:00. Just before the service's midnight, nothing is due.
  const corrected = (elapsed) => fast - 3 * hour + elapsed;
  assert.equal(readDue(at, corrected(2 * hour - 1000), 1000 + 2 * hour - 1000), false);
  // At the service's midnight the page's monotonic clock has passed two hours: the read is due, though
  // the wall clock reads only 00:00 against a deadline of 03:00.
  assert.equal(readDue(at, corrected(2 * hour), 1000 + 2 * hour), true);
  // And a monotonic clock paused while the device slept leaves the wall clock to say so.
  assert.equal(readDue(at, fast + 2 * hour, 1000 + hour), true);
});

test('a service without the board migration says it is being set up', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Could not find the function public.friends_board(p_action, p_data) in the schema cache' }), { status: 404 });

  try {
    await assert.rejects(readBoard(session), /being set up/);
  } finally { globalThis.fetch = original; }
});
