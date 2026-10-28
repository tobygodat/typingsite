// The friends board rides profile saves: each write carries the summary of exactly the copy it writes,
// stamped with that write (src/account.js, src/friends-board.js). These replay the three ways the board's
// own clear protocol went wrong (a run stamped by a fast clock, a held reply around clear and undo, and a
// late reply read as clock skew) against a stand-in for the profiles API, and check the column fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CORPUS_VERSION, METRIC_VERSION, conditionKey } from '../src/typing.js';
import * as account from '../src/account.js';
import * as board from '../src/friends-board.js';

const { boardColumn, boardCurrent, boardSummary, nextRead, utcDay, weekStart } = board;
const { insertCloudProfile, repairBoard, updateCloudProfile } = account;

const words = { mode: 'words', duration: null, count: 25, punctuation: false, quoteLength: null, difficulty: null, wordList: '200',
  inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };

const dailyKey = conditionKey({ ...words, mode: 'quote', count: null, punctuation: true, quoteLength: 'medium', difficulty: 'any', wordList: null });
const session = { user: { id: 'ada' }, access_token: 'account-token', expires_at: 9999999999 };
const MINUTE = 60000;

// A time `offset` from now, kept inside this UTC week so the runs always count as this week's.
function thisWeek(offset) {
  const monday = Date.parse(`${weekStart()}T00:00:00Z`);

  return new Date(Math.min(Math.max(Date.now() + offset, monday + MINUTE), monday + 7 * 86400000 - MINUTE)).toISOString();
}

const run = (id, at) => ({ id, at, status: 'complete', kind: 'test', interrupted: false, conditions: words,
  score: { wpm: 70, accuracy: 97 }, elapsedMs: 30000, challengeDate: null });

const copy = (runs) => ({ version: 2, runs });
const boardOf = (data) => (at) => boardColumn(data.runs, dailyKey, at);

// A save as the app makes one (src/app.js pushOnce): a write conditional on the row's version as read, or
// the first row. `api` is the stand-in in use; without one (a stubbed fetch), the first row.
let currentApi = null;

function save(data, options = {}) {
  const board = 'board' in options ? options.board : boardOf(data);
  const row = currentApi?.rows.get('ada');

  return row ? updateCloudProfile(session, data, row.updated_at, { board }) : insertCloudProfile(session, data, { board });
}

// The profiles API as src/account.js speaks to it: an insert that ignores an existing row, and a PATCH
// filtered on updated_at that changes only the row at that version, each answering with the rows written
// (return=representation) or nothing (return=minimal). `holdFirst` holds the reply to the first write
// (stored on arrival), as a slow connection can.
function profilesApi({ holdFirst = false } = {}) {
  const rows = new Map();
  const requests = [];
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let holding = holdFirst;

  const fetch = async (url, options) => {
    const { pathname, searchParams } = new URL(url);
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ method: options.method, pathname, updatedAt: searchParams.get('updated_at'), body });

    const answer = async (written, status) => {
      if (holding) { holding = false; await held; }

      if (!/return=representation/.test(options.headers?.Prefer || '')) return new Response(null, { status: status === 201 ? 201 : 204 });

      return new Response(JSON.stringify(written.map((row) => ({ updated_at: row.updated_at }))), { status });
    };

    if (options.method === 'POST' && pathname === '/rest/v1/profiles') {
      if (rows.has(body.user_id)) return answer([], 201);
      rows.set(body.user_id, { ...body });

      return answer([rows.get(body.user_id)], 201);
    }

    if (options.method === 'PATCH' && pathname === '/rest/v1/profiles') {
      const row = rows.get(searchParams.get('user_id').replace(/^eq\./, ''));
      const matches = row && Date.parse(row.updated_at) === Date.parse(searchParams.get('updated_at').replace(/^eq\./, ''));

      if (matches) Object.assign(row, body);

      return answer(matches ? [row] : [], 200);
    }

    return new Response(JSON.stringify({ message: 'unexpected' }), { status: 404 });
  };

  return { fetch, rows, requests, release };
}

async function withApi(api, task) {
  const original = globalThis.fetch;
  globalThis.fetch = api.fetch;
  currentApi = api;

  try { return await task(); } finally { globalThis.fetch = original; currentApi = null; }
}

// Today's and this week's parts of a summary, as the service picks them.
const parts = (summary) => ({ daily: summary.days[utcDay()] ?? null, week: summary.weeks[weekStart()] ?? null });

// What a reader is shown of a row, as the service shows it: the summary only while it describes the row.
const shown = (row) => (boardCurrent(row) ? parts(row.board) : null);

// What Progress shows from the same row.
const progress = (row) => parts(boardSummary(row.data.runs, dailyKey));

// This week's run count a reader is shown (none yet reads as 0).
const weekRuns = (row) => shown(row)?.week?.runs ?? 0;

test('finding 1: a pre-clear run stamped by a fast clock comes back on the board only with the history Progress shows', async () => {
  const api = profilesApi();
  // Made on a device whose clock runs forty minutes fast, synced, and loaded by a correctly timed device.
  const fast = run('fast-clock', thisWeek(40 * MINUTE));
  const before = copy([run('earlier', thisWeek(-2 * 60 * MINUTE)), fast]);
  await withApi(api, async () => {
    // Another device clears: the row and its summary are empty.
    await save(copy([]));
    assert.equal(shown(api.rows.get('ada')).week, null);
    // The correctly timed device then makes a run after the clear: only that run counts, whatever the
    // stamps of runs it no longer holds.
    await save(copy([run('after-clear', thisWeek(MINUTE))]));
    assert.equal(weekRuns(api.rows.get('ada')), 1);
    // A stale device that still holds the pre-clear history saves it back (last writer wins on master):
    // the board then shows exactly that history, no more and no fewer runs than Progress.
    await save(before);
  });
  const row = api.rows.get('ada');
  assert.deepEqual(shown(row), progress(row));
  assert.equal(weekRuns(row), 2);
  assert.equal(row.board.at, row.updated_at);
  // Nothing on the client weighs a run's stamp against a clock any more.
  assert.equal(board.runsSince, undefined);
});

test('finding 2: clear and undo twice with the first save’s reply held, and the board ends on the restored totals', async () => {
  const api = profilesApi({ holdFirst: true });
  const full = copy([run('a', thisWeek(-3 * MINUTE)), run('b', thisWeek(-2 * MINUTE)), run('c', thisWeek(-MINUTE))]);
  const cleared = copy([]);

  const saves = await withApi(api, async () => {
    const first = save(cleared);
    // The first clear's reply is still on its way when the undo, the second clear and its undo are saved.
    const later = [];

    for (const data of [full, cleared, full]) later.push(await save(data));
    api.release();

    return [await first, ...later];
  });

  const row = api.rows.get('ada');
  assert.equal(saves.length, 4);
  assert.deepEqual(shown(row), progress(row));
  assert.equal(weekRuns(row), 3);
  assert.deepEqual(row.data, full);
  // Each write carried the summary of its own copy, stamped with that write; nothing was kept on the
  // device to settle later.
  const writes = api.requests.filter((request) => request.body?.data);
  assert.deepEqual(writes.map((request) => request.body.board.weeks[weekStart()]?.runs ?? 0), [0, 3, 0, 3]);

  for (const write of writes) assert.equal(write.body.board.at, write.body.updated_at);
});

test('finding 3: a board reply ten seconds late only moves the next read later, and a run after another device’s clear counts', async () => {
  // The service builds a reply at 23:59:50 UTC (ten seconds to midnight); it arrives ten seconds late on a
  // device whose clock reads five minutes behind.
  const built = Date.parse('2026-10-09T23:59:50Z');
  const midnight = Date.parse('2026-10-10T00:00:00Z');
  const behind = 5 * MINUTE;
  const arrived = built + 10000 - behind;
  const at = nextRead({ nextDay: 10, date: '2026-10-09' }, arrived, 0);
  // The read comes ten seconds after the reply arrived, which in real time is after the service's
  // midnight (by the time the reply took), never before it, whatever this device's clock says.
  assert.equal(at.wall - arrived, 10000);
  assert.equal(at.wall + behind - midnight, 10000);
  assert.equal(at.mono, 10000);
  // Meanwhile another device clears and makes one run: its save carries that run, and the late reply has
  // nothing to weigh it against.
  const api = profilesApi();
  await withApi(api, async () => {
    await save(copy([run('before-clear', thisWeek(-MINUTE))]));
    await save(copy([run('after-clear', thisWeek(1000))]));
  });
  const row = api.rows.get('ada');
  assert.equal(weekRuns(row), 1);
  assert.deepEqual(row.data.runs.map((r) => r.id), ['after-clear']);
});

test('a repair writes only the summary, and only while the row is still the version it was counted from', async () => {
  const api = profilesApi();
  const data = copy([run('a', thisWeek(-MINUTE))]);
  await withApi(api, async () => {
    // An older build saved the row without a summary.
    await save(data, { board: undefined });
    const row = api.rows.get('ada');
    assert.equal(row.board, undefined);
    assert.equal(shown(row), null);
    const stamp = row.updated_at.replace('Z', '+00:00');
    // A repair counted from another version changes nothing.
    assert.equal(await repairBoard(session, boardColumn([], dailyKey, '2026-01-01T00:00:00.000Z'), '2026-01-01T00:00:00.000Z'), true);
    assert.equal(api.rows.get('ada').board, undefined);
    // One counted from this version (in the API's own format, offset included) is taken.
    assert.equal(await repairBoard(session, boardColumn(data.runs, dailyKey, stamp), stamp), true);
  });
  const patch = api.requests.at(-1);
  assert.equal(patch.method, 'PATCH');
  assert.deepEqual(Object.keys(patch.body), ['board']);
  // The stamp's offset survives the query string as a plus sign, not a space.
  assert.match(patch.updatedAt, /^eq\.\d{4}-\d{2}-\d{2}T[\d:.]+\+00:00$/);
  const row = api.rows.get('ada');
  assert.deepEqual(shown(row), progress(row));
});

test('a write refused for another reason still fails, board or not', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: '42501', message: 'new row violates row-level security policy for table "profiles"' }), { status: 403 });

  try {
    await assert.rejects(save(copy([])), /row-level security/);
  } finally { globalThis.fetch = original; }
});

test('a stale copy writes nothing, and the row keeps the summary of the version it holds', async () => {
  const api = profilesApi();
  const older = copy([run('a', thisWeek(-2 * MINUTE))]);
  const newer = copy([run('a', thisWeek(-2 * MINUTE)), run('b', thisWeek(-MINUTE))]);
  await withApi(api, async () => {
    await save(older);
    const seen = api.rows.get('ada').updated_at;
    await save(newer);
    // A device that read the row before the newer save writes against that version: nothing matches.
    assert.equal(await updateCloudProfile(session, older, seen, { board: boardOf(older) }), null);
  });
  const row = api.rows.get('ada');
  assert.deepEqual(row.data, newer);
  assert.equal(weekRuns(row), 2);
  assert.equal(row.board.at, row.updated_at);
});

// Last: once the column is refused, this module leaves it out for the rest of the page load.
test('a project without the board column keeps syncing: the write goes again without it, and later ones leave it out', async () => {
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    bodies.push({ method: options.method, body });

    if (body && 'board' in body) {
      return new Response(JSON.stringify({ code: 'PGRST204', details: null, hint: null, message: 'Could not find the \'board\' column of \'profiles\' in the schema cache' }), { status: 400 });
    }

    return new Response(null, { status: 201 });
  };

  try {
    await save(copy([run('a', thisWeek(-MINUTE))]));
    assert.equal(bodies.length, 2);
    assert.ok('board' in bodies[0].body);
    assert.equal('board' in bodies[1].body, false);
    const at = bodies[1].body.updated_at;
    assert.equal(bodies[0].body.board.at, at);
    await save(copy([]));
    assert.equal(bodies.length, 3);
    assert.equal('board' in bodies[2].body, false);
    assert.equal(await repairBoard(session, boardColumn([], dailyKey, at), at), false);
    assert.equal(bodies.length, 3);
  } finally { globalThis.fetch = original; }
});
