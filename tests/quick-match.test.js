import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PAIRING, QUEUE_IDLE, RATING, REPEAT, TRACE_CHECK, acceptableGap, cardOutcome, expectedScore, kFactor, pickOpponent, queueStep,
  quickConditions, ratingChangeLine as changeLine, ratingChanges, ratingLine as rawLine, traceCheck, LONELY_MS } from '../src/quick-match.js';
import { wordList } from '../src/words.js';
import { FakeRaces } from '../e2e/fake-races.js';
import { quickPassage } from '../e2e/fake-quick-match.js';

// The rating line keeps its count and "provisional" together with no-break spaces; the assertions read it plain.
const plain = (text) => text.replaceAll('\u00a0', ' ');
const ratingLine = (...args) => plain(rawLine(...args));
const ratingChangeLine = (...args) => plain(changeLine(...args));

const migration = readFileSync(new URL('../supabase/migrations/20261110120000_quick_match.sql', import.meta.url), 'utf8');
const sqlTests = readFileSync(new URL('../supabase/tests/quick-match.sql', import.meta.url), 'utf8');

test('the migration draws its passage from the same 200 words and sends the same conditions as the browser', () => {
  const words = /\$words\$([\s\S]*?)\$words\$/.exec(migration)[1].trim().split(/\s+/);
  assert.deepEqual(words, wordList('200'));
  // The list's own line breaks are trimmed before it is split, as the SQL reads it, so no word is empty.
  assert.match(migration, /\$words\$, E' \\n'\), '\\s\+'\);/);
  const conditions = JSON.parse(/select '(\{"mode":"time".*?\})'::jsonb/.exec(migration)[1]);
  // A new corpus or metric version changes these conditions, so the migration's copy needs a new migration.
  assert.deepEqual(conditions, quickConditions());
  assert.match(migration, /exit when length\(v_text\) \+ length\(v_word\) \+ 1 > 1000;/);
});

test('the fake draws quick passages the way the service does: 2000 draws, single spaces, the 200 words, past what 350 wpm reaches', () => {
  const words = new Set(wordList('200'));
  const lengths = [];

  for (let draw = 0; draw < 2000; draw += 1) {
    const text = quickPassage();
    const split = text.split(' ');
    assert.ok(!/^ | $| {2}/.test(text) && /^[a-z ]+$/.test(text), `a malformed passage: ${JSON.stringify(text.slice(0, 60))}`);
    assert.ok(split.every((word, i) => words.has(word) && word !== split[i - 1] && word !== split[i - 2]), 'a word outside the list or repeating one of the two before');
    lengths.push(text.length);
  }

  // 350 wpm for 30 seconds is 875 characters, so a checked run never reaches the end of the passage.
  assert.ok(Math.min(...lengths) >= 991 && Math.max(...lengths) <= 1000, `lengths ${Math.min(...lengths)} to ${Math.max(...lengths)}`);
  assert.ok(TRACE_CHECK.maxWpm * 5 * (30 / 60) < Math.min(...lengths));
});

test('the migration keeps the same limits as the browser: gap, staleness, K, repeat pairings and the trace check', () => {
  assert.match(migration, /o\.settled_at > v_now - interval '24 hours'\) >= 3/);
  assert.deepEqual([REPEAT.rated, REPEAT.windowMs], [3, 24 * 3600_000]);
  assert.match(migration, /abs\(q\.rating - v_me\.rating\) <= 100 \+ 10 \* floor/);
  assert.deepEqual([PAIRING.baseGap, PAIRING.gapPerSecond, PAIRING.staleMs], [100, 10, 10_000]);
  assert.match(migration, /seen_at < v_now - interval '10 seconds'/);
  assert.match(migration, /select case when p_rated < 10 then 40 else 20 end/);
  assert.deepEqual([RATING.provisional, RATING.newK, RATING.settledK, RATING.start], [10, 40, 20, 1500]);
  assert.match(migration, /rating integer not null default 1500/);
  assert.match(migration, /when \(v_times->>i\)::integer < 20 then v_run \+ 1/);
  assert.match(migration, /if v_run >= 20 then return 'intervals'/);
  assert.match(migration, /> 350 then return 'speed'/);
  assert.deepEqual([TRACE_CHECK.floorMs, TRACE_CHECK.floorRun, TRACE_CHECK.maxWpm], [20, 20, 350]);
});

test('Elo: equal ratings at K 40 move 20 each way, a tie moves nothing, and K drops to 20 after ten rated races', () => {
  const fresh = { rating: 1500, races: 0 };
  assert.deepEqual(ratingChanges(fresh, fresh, 'won'), [20, -20]);
  assert.deepEqual(ratingChanges(fresh, fresh, 'tied'), [0, 0]);
  // The numbers supabase/tests/quick-match.sql pins: 1900 with 12 races beats 1500 with none.
  assert.deepEqual(ratingChanges({ rating: 1900, races: 12 }, fresh, 'won'), [2, -4]);
  assert.deepEqual(ratingChanges({ rating: 1500, races: 9 }, { rating: 1500, races: 10 }, 'lost'), [-20, 10]);
  assert.equal(kFactor(9), 40);
  assert.equal(kFactor(10), 20);

  for (let gap = -800; gap <= 800; gap += 37) {
    for (const outcome of ['won', 'lost', 'tied']) {
      const [a, b] = ratingChanges({ rating: 1500 + gap, races: 3 }, { rating: 1500, races: 5 }, outcome);
      assert.equal(a + b, 0, `same K is zero-sum at ${gap} ${outcome}`);
      const score = { won: 1, lost: 0, tied: 0.5 }[outcome];
      assert.ok(Math.abs(a - 40 * (score - expectedScore(1500 + gap, 1500))) <= 0.5, 'within rounding of K × (S − E)');
    }
  }
});

test('the rating line says the count and whether the rating is provisional', () => {
  assert.equal(ratingLine({ rating: 1500, races: 0 }), 'Race rating 1500 · 0 rated races · provisional');
  assert.equal(ratingLine({ rating: 1520, races: 1 }), 'Race rating 1520 · 1 rated race · provisional');
  assert.equal(ratingLine({ rating: 1612, races: 10 }), 'Race rating 1612 · 10 rated races');
  assert.equal(ratingLine(null), '');
  // On a narrow screen the line breaks only before the count, never before "provisional".
  assert.equal(rawLine({ rating: 1500, races: 0 }), 'Race rating 1500 · 0\u00a0rated\u00a0races\u00a0·\u00a0provisional');
  const rated = (reason, outcome, delta) => ({ rated: true, reason, outcome, after: 1500 + delta, delta, races: 1 });
  const line = 'Race rating 1520 · 1 rated race · provisional (+20)';
  assert.equal(ratingChangeLine(rated(null, 'lost', -20)), 'Rated loss. Race rating 1480 · 1 rated race · provisional (−20)');
  assert.equal(ratingChangeLine({ rated: true, reason: 'forfeit', outcome: 'won', after: 1520, delta: 20, races: 11 }, 'Ada'),
    'Rated win: Ada left the race. Race rating 1520 · 11 rated races (+20)');
  assert.equal(ratingChangeLine(rated('forfeit', 'lost', -20)), 'Rated loss: you left the race. Race rating 1480 · 1 rated race · provisional (−20)');
  // The racer who stayed is told the win is rated and why; the racer who left is told the loss is and why.
  assert.equal(ratingChangeLine(rated('opponent-absent', 'won', 20), 'Lin'), `Rated win: Lin didn’t finish. ${line}`);
  assert.equal(ratingChangeLine(rated('opponent-unchecked', 'won', 20), 'Lin'), `Rated win: Lin’s run couldn’t be checked. ${line}`);
  assert.equal(ratingChangeLine(rated('unfinished', 'lost', -20)),
    'Rated loss: your finish didn’t arrive before the race closed. Race rating 1480 · 1 rated race · provisional (−20)');
  assert.equal(ratingChangeLine(rated('intervals', 'lost', -20)),
    'Rated loss: your run couldn’t be checked. It had keys closer together than the check allows. Race rating 1480 · 1 rated race · provisional (−20)');
  assert.equal(ratingChangeLine({ rated: false, reason: 'no-trace' }),
    'Not rated: neither racer finished with a run that could be checked. Yours arrived without its keystroke record.');
  assert.equal(ratingChangeLine({ rated: false, reason: 'unfinished', outcome: null }),
    'Not rated: neither racer finished with a run that could be checked. Your finish didn’t arrive before the race closed.');
  // A decided result that isn't rated is a repeat pairing, said to both racers.
  assert.equal(ratingChangeLine({ rated: false, reason: null, outcome: 'won', after: 1520, delta: 0, races: 3 }, 'Lin'),
    'Not rated: you and Lin have raced each other too often today.');
  assert.equal(ratingChangeLine({ rated: false, reason: 'intervals', outcome: 'lost', after: 1480, delta: 0, races: 3 }, 'Lin'),
    'Not rated: you and Lin have raced each other too often today.');
  // A result card reads a seat's rated result only when its run was checked.
  assert.deepEqual([{ checked: true, outcome: 'won' }, { checked: false, outcome: 'won' }, { checked: false, outcome: null }, { checked: true, outcome: 'tied' }, {}]
    .map(cardOutcome), ['won', 'unchecked', 'unchecked', 'tied', 'unchecked']);

  // No reason a check gives reads as an accusation: each says what the run had, never what the racer did.
  for (const reason of ['no-trace', 'unreadable', 'times', 'intervals', 'wrong-text', 'speed']) {
    assert.doesNotMatch(ratingChangeLine(rated(reason, 'lost', -20)), /cheat|script|bot|paste|person|human|fake/i, reason);
  }
});

test('pairing takes the closest rating within a gap that widens with the longer wait, never yourself or a stale player', () => {
  assert.equal(acceptableGap(0), 100);
  assert.equal(acceptableGap(31_400), 410);
  const now = 100_000;
  const me = { user: 'me', rating: 1500, joinedAt: now, seenAt: now };

  const queue = [me, { user: 'far', rating: 1900, joinedAt: now, seenAt: now }, { user: 'near', rating: 1560, joinedAt: now, seenAt: now },
    { user: 'nearer', rating: 1470, joinedAt: now - 1000, seenAt: now - 11_000 }];

  assert.equal(pickOpponent(queue, me, now).user, 'near');
  assert.equal(pickOpponent([me], me, now), null);
  // Anyone else in range comes before the racer either of the two last raced; with nobody else, that racer.
  assert.equal(pickOpponent(queue, { ...me, last: 'near' }, now).user, 'near');
  const pair = [me, { user: 'lin', rating: 1500, joinedAt: now, seenAt: now, last: 'me' }, { user: 'kai', rating: 1590, joinedAt: now, seenAt: now }];
  assert.equal(pickOpponent(pair, me, now).user, 'kai');
  assert.equal(pickOpponent(pair, { ...me, last: 'lin' }, now).user, 'kai');
  assert.equal(pickOpponent(pair.slice(0, 2), { ...me, last: 'lin' }, now).user, 'lin');
  queue[1].joinedAt = now - 31_000;
  assert.equal(pickOpponent(queue.filter((row) => row.user !== 'near'), me, now).user, 'far');
});

// The trace check's table, the same one supabase/tests/quick-match.sql pins for race_private.trace_check.
test('the trace check table: honest, pasted, superhuman, wrong text, empty, missing times, off the clock, unreadable', () => {
  const passage = 'the quick brown fox jumps over the lazy dog and then the fox runs back home again';
  const steps = (count, at) => Array.from({ length: count }, (_, i) => at(i + 1));
  const long = `${passage} `.repeat(13).slice(0, 1000);

  const cases = [
    ['honest', { v: 1, k: passage, t: steps(passage.length, (n) => (n === 1 ? 400 : n % 7 === 0 ? 15 : 45 + (n % 30))), e: 30000 }, passage, passage.length, 'ok'],
    ['pasted', { v: 1, k: passage, t: steps(passage.length, (n) => (n === 1 ? 400 : 0)), e: 30000 }, passage, passage.length, 'intervals'],
    ['superhuman', { v: 1, k: long, t: steps(1000, (n) => (n === 1 ? 0 : 30)), e: 30000 }, long, 1000, 'speed'],
    ['wrong-text', { v: 1, k: passage.toUpperCase(), t: steps(passage.length, () => 60), e: 30000 }, passage, passage.length, 'wrong-text'],
    ['empty', null, passage, 0, 'no-trace'],
    ['missing-times', { v: 1, k: passage, t: [60, 60], e: 30000 }, passage, passage.length, 'times'],
    ['off-clock', { v: 1, k: passage, t: steps(passage.length, () => 60), e: 29000 }, passage, passage.length, 'times'],
    ['unreadable', { v: 2, k: passage, t: [], e: 30000 }, passage, passage.length, 'unreadable'],
  ];

  for (const [name, trace, text, correct, verdict] of cases) assert.equal(traceCheck(trace, text, { duration: 30, correct }), verdict, name);
});

test('the queue: a reply to anything but the current request changes nothing, so a late pairing never enters a race', () => {
  let step = queueStep(QUEUE_IDLE, { type: 'press', now: 0 });
  assert.equal(step.state.phase, 'joining');
  assert.deepEqual(step.effects, [{ send: 'queue', ticket: 1 }]);
  step = queueStep(step.state, { type: 'reply', ticket: 1, result: { state: 'waiting' }, now: 100 });
  assert.equal(step.state.phase, 'waiting');
  assert.deepEqual(step.effects, [{ poll: 1000, ticket: 1 }]);
  const waiting = step.state;
  assert.equal(queueStep(waiting, { type: 'tick', now: 100 + LONELY_MS - 1 }).state.phase, 'waiting');
  const lonely = queueStep(waiting, { type: 'tick', now: 100 + LONELY_MS }).state;
  assert.equal(lonely.phase, 'lonely');
  assert.equal(queueStep(lonely, { type: 'keep-waiting', now: 50_000 }).state.since, 50_000);
  const best = queueStep(lonely, { type: 'race-best' });
  assert.deepEqual([best.state.phase, best.effects], ['idle', [{ send: 'unqueue', ticket: 2 }, { raceBest: true }]]);
  const stopped = queueStep(waiting, { type: 'press', now: 200 });
  assert.equal(stopped.state.phase, 'idle');
  const late = queueStep(stopped.state, { type: 'reply', ticket: 1, result: { state: 'paired', roomId: 'r' } });
  assert.deepEqual([late.state, late.effects], [stopped.state, []]);
  const paired = queueStep(waiting, { type: 'reply', ticket: 1, result: { state: 'paired', roomId: 'r' } });
  assert.deepEqual(paired.effects, [{ enter: { state: 'paired', roomId: 'r' } }]);
  assert.equal(queueStep(paired.state, { type: 'entered' }).state.phase, 'idle');
  const missing = queueStep(queueStep(QUEUE_IDLE, { type: 'press' }).state, { type: 'fail', ticket: 1, unavailable: true, message: 'set up' });
  assert.equal(missing.state.phase, 'unavailable');
  assert.equal(queueStep(waiting, { type: 'fail', ticket: 1, message: 'offline' }).state.phase, 'waiting');
});

// A seeded generator, so a failing interleaving can be replayed from its seed.
function random(seed) {
  let value = seed >>> 0;

  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The settlement table in supabase/tests/quick-match.sql, played through the e2e fake the same way: fresh accounts,
// both seats arrive, the start passes, each seat plays its kind, and only a stranger's request after the clock
// and its grace settles what is left. The fake and the SQL must write the same line for every row.
const SETTLEMENT = [...(/-- settlement table begins([\s\S]*?)-- settlement table ends/.exec(sqlTests)[1]
  .matchAll(/\('([\w-]+)', '([\w-]+)', '([^']+)'\)/g))].map(([, one, two, expected]) => ({ one, two, expected }));

function withClock(run) {
  const realNow = Date.now;
  const clock = { now: 1_000_000 };
  Date.now = () => clock.now;

  try { return run(clock); } finally { Date.now = realNow; }
}

const call = (races, user, rpc, action, roomId, data = {}) => {
  let answer = null;
  const send = (status, json) => { answer = { status, json }; };

  if (rpc === 'quick') races.quick.handle(user, { p_action: action, p_data: { displayName: user, ...data } }, send);
  else races.handle(user, { p_action: action, p_room_id: roomId, p_data: data }, send);

  return answer;
};

// As pg_temp.trace_of: the passage's first `count` letters, a key every `step` ms after one at 500 ms, ending on the clock.
const traceOf = (passage, count, step, end = 30_000) => ({ v: 1, k: passage.slice(0, count), t: Array.from({ length: count }, (_, i) => (i ? step : 500)), e: end });

// As pg_temp.seat.
function playSeat(races, room, user, kind) {
  if (kind === 'absent') return;
  const count = { slow: 200, bare: 200, pasted: 300 }[kind] ?? 245;
  const trace = kind === 'bare' ? null : kind === 'pasted' ? traceOf(room.passage, 300, 0) : kind === 'slow' ? traceOf(room.passage, 200, 148) : traceOf(room.passage, 245, 120);

  if (kind === 'late') call(races, user, 'race', 'progress', room.id, { typed: room.passage.slice(0, 240), keystrokes: 240, errors: 0, finished: false, sequence: 1 });

  if (kind !== 'leaves') {
    call(races, user, 'race', 'progress', room.id, { typed: room.passage.slice(0, count), keystrokes: count, errors: 0, finished: true, sequence: 2, trace });
  }

  if (kind === 'leaves' || kind === 'done-leaves') call(races, user, 'race', 'leave', room.id);
}

// As pg_temp.settled.
const settledLine = (races, room) => {
  const rows = races.quick.results.get(room.id);

  if (!rows) return null;
  const bySlot = [...room.players].sort((a, b) => a.slot - b.slot).flatMap((p) => rows.filter((row) => row.user === p.userId));
  const label = bySlot.every((row) => row.rated) ? 'rated' : bySlot.some((row) => row.rated) ? 'mixed' : 'unrated';

  return `${label}: ${bySlot.map((row) => `${row.outcome ?? 'none'} ${row.reason ?? '-'} ${row.delta > 0 ? '+' : ''}${row.delta}`).join(', ')}`;
};

test('the fake settles every row of the SQL settlement table the same way as the migration', () => {
  assert.equal(SETTLEMENT.length, 21);

  for (const { one, two, expected } of SETTLEMENT) {
    withClock((clock) => {
      const races = new FakeRaces({ users: new Map() });
      assert.equal(call(races, 'one', 'quick', 'queue').json.state, 'waiting');
      const room = races.rooms.get(call(races, 'two', 'quick', 'queue').json.roomId);
      call(races, 'one', 'race', 'get', room.id);
      call(races, 'two', 'race', 'get', room.id);
      clock.now = Date.parse(room.startAt) + 31_000;
      playSeat(races, room, 'one', one);
      playSeat(races, room, 'two', two);
      call(races, 'stranger', 'quick', 'rating');

      if ([one, two].includes('absent')) {
        assert.ok((races.quick.results.get(room.id) || []).every((row) => row.reason === 'forfeit'), `${one} ${two} settled inside its grace period`);
      }

      clock.now = Date.parse(room.startAt) + 41_000;
      call(races, 'stranger', 'quick', 'rating');
      assert.equal(settledLine(races, room), expected, `${one} against ${two}`);
      // The one record of who won: the tally and both cards read the rated result.
      const snap = call(races, 'one', 'race', 'get', room.id).json;
      const winner = room.players.find((p) => races.quick.row(room, p.userId)?.outcome === 'won');
      assert.deepEqual(snap.tally, !winner ? [0, 0] : winner.userId === 'one' ? [1, 0] : [0, 1], `${one} against ${two}: the tally`);
      assert.deepEqual(snap.players.map((p) => p.outcome ?? null), [1, 2].map((slot) => races.quick.row(room, room.players.find((p) => p.slot === slot).userId).outcome));
      assert.ok(snap.players.every((p) => cardOutcome(p) !== 'won' || p.checked), `${one} against ${two}: an unchecked run is marked the winner`);
    });
  }
});

test('a racer who closes the page mid-race loses, rated, without asking again; a late finish changes nothing', () => {
  withClock((clock) => {
    const races = new FakeRaces({ users: new Map() });
    call(races, 'sam', 'quick', 'queue');
    const room = races.rooms.get(call(races, 'kai', 'quick', 'queue').json.roomId);
    call(races, 'sam', 'race', 'get', room.id);
    call(races, 'kai', 'race', 'get', room.id);
    clock.now = Date.parse(room.startAt) + 31_000;
    playSeat(races, room, 'sam', 'fast');
    // Sam's page stays open and asks about the room; ten seconds after the clock, that settles it.
    clock.now = Date.parse(room.startAt) + 40_000;
    const won = call(races, 'sam', 'race', 'get', room.id).json;
    assert.deepEqual([won.status, won.rating.outcome, won.rating.reason, won.rating.delta], ['finished', 'won', 'opponent-absent', 20]);
    // Kai comes back on a new page: the rating read says how it ended, until a page shows that room's result.
    const back = call(races, 'kai', 'quick', 'rating').json;
    assert.deepEqual(back, { rating: 1480, races: 1, last: { roomId: room.id, rated: true, reason: 'unfinished', outcome: 'lost', before: 1500, after: 1480, delta: -20, races: 1 } });
    assert.equal(ratingChangeLine(back.last), 'Rated loss: your finish didn’t arrive before the race closed. Race rating 1480 · 1 rated race · provisional (−20)');

    // A passing finish from Kai's old page, arriving now, is told how the race ended and moves nothing.
    const late = call(races, 'kai', 'race', 'progress', room.id, { typed: room.passage.slice(0, 245), keystrokes: 245, errors: 0, finished: true, sequence: 9,
      trace: traceOf(room.passage, 245, 120) }).json;

    assert.deepEqual([late.rating.outcome, late.rating.reason], ['lost', 'unfinished']);
    assert.equal(settledLine(races, room), 'rated: won opponent-absent +20, lost unfinished -20');
    assert.deepEqual([races.quick.rating('sam'), races.quick.rating('kai')], [{ rating: 1520, races: 1 }, { rating: 1480, races: 1 }]);
    assert.equal(room.players.find((p) => p.userId === 'kai').verdict, undefined);
  });
});

// Two accounts that pair, arrive and see the start pass, as pg_temp.pair and the table loop do.
function startRace(races, clock, one, two, at = 31_000) {
  call(races, one, 'quick', 'queue');
  const room = races.rooms.get(call(races, two, 'quick', 'queue').json.roomId);
  call(races, one, 'race', 'get', room.id);
  call(races, two, 'race', 'get', room.id);
  clock.now = Date.parse(room.startAt) + at;

  return room;
}

const settle = (races, clock, room) => {
  clock.now = Math.max(clock.now, Date.parse(room.startAt) + 41_000);
  call(races, 'stranger', 'quick', 'rating');
};

test('the fake agrees with the SQL: repeat pairings, the last opponent passed over, forfeits between two accounts, the one-sided arithmetic', () => {
  withClock((clock) => {
    const races = new FakeRaces({ users: new Map() });
    const { quick } = races;
    // Only the first three rated results between the same pair in 24 hours move ratings; the fourth still has its
    // result, for the cards and the tally, unrated for both.
    let room;

    for (let i = 1; i <= 4; i += 1) {
      room = startRace(races, clock, 'pia', 'quinn');
      playSeat(races, room, 'pia', i % 2 ? 'fast' : 'slow');
      playSeat(races, room, 'quinn', i % 2 ? 'slow' : 'fast');
    }

    assert.equal(settledLine(races, room), 'unrated: lost - 0, won - 0');
    assert.equal(ratingChangeLine(call(races, 'quinn', 'race', 'get', room.id).json.rating, 'Pia'), 'Not rated: you and Pia have raced each other too often today.');
    assert.deepEqual(call(races, 'quinn', 'race', 'get', room.id).json.tally, [2, 2]);
    // A day on, the next counts again.
    clock.now += REPEAT.windowMs;
    room = startRace(races, clock, 'pia', 'quinn');
    playSeat(races, room, 'pia', 'fast');
    playSeat(races, room, 'quinn', 'slow');
    assert.ok(quick.row(room, 'quinn').rated);

    // Pairing passes over the racer either last raced while anyone else is in range.
    call(races, 'quinn', 'quick', 'queue');
    call(races, 'rio', 'quick', 'unqueue');
    quick.queue.set('rio', { user: 'rio', name: 'rio', rating: quick.rating('pia').rating + 50, joinedAt: clock.now, seenAt: clock.now });
    const paired = races.rooms.get(call(races, 'pia', 'quick', 'queue').json.roomId);
    assert.deepEqual(paired.players.map((p) => p.userId), ['rio', 'pia']);
    call(races, 'pia', 'quick', 'unqueue');
    quick.queue.clear();

    // One person with two accounts: Alt forfeits right after each start while Main never types. Main stays at 1500,
    // Alt falls 20, 19 and 18, and from the fourth, past the pair's three, not even Alt moves.
    for (let i = 1; i <= 4; i += 1) {
      room = startRace(races, clock, 'main', 'alt', 1000);
      call(races, 'alt', 'race', 'leave', room.id);
      // Alt asks to race again at once: it waits, still seated in the race it left.
      assert.deepEqual(call(races, 'alt', 'quick', 'queue').json.state, 'waiting');
      assert.ok(!quick.queue.has('alt'));
      settle(races, clock, room);
    }

    assert.equal(settledLine(races, room), 'unrated: none unfinished 0, lost forfeit 0');
    assert.deepEqual([quick.rating('main'), quick.rating('alt')], [{ rating: 1500, races: 0 }, { rating: 1443, races: 3 }]);

    // The one-sided arithmetic, as the SQL pins it: X at 1600 with 12 rated races (K 20) leaves against Y at 1500
    // with none (K 40): −13 for X and nothing for Y. X leaves again and Y finishes a checked run: −12 and +25.
    quick.ratings.set('x', { rating: 1600, races: 12 });
    quick.ratings.set('y', { rating: 1500, races: 0 });
    const lines = [];

    for (let i = 1; i <= 2; i += 1) {
      room = startRace(races, clock, 'x', 'y');
      call(races, 'x', 'race', 'leave', room.id);

      if (i === 2) playSeat(races, room, 'y', 'slow');
      settle(races, clock, room);
      lines.push(settledLine(races, room));
    }

    assert.deepEqual(lines, ['mixed: lost forfeit -13, none unfinished 0', 'rated: lost forfeit -12, won forfeit +25']);
    assert.deepEqual([quick.rating('x'), quick.rating('y')], [{ rating: 1575, races: 14 }, { rating: 1525, races: 1 }]);
  });
});

// Browsers against the fake service on a five-second race clock. Each browser's requests go out one at a
// time, as the view sends them; the service handles a request whenever the generator says, and its reply lands
// later still. A browser in a race sends progress with no keystroke record, which may land after the clock, and
// then its finish: a run that passes, one that can't be checked, or none. Or it leaves, or closes its page; a
// closed page may come back later and read its rating.
const MODEL_DURATION = 5;

// How often the generator picks each browser action: requests move far more often than people press.
const WEIGHTS = { press: 1, keep: 1, best: 0.5, timer: 3, process: 5, deliver: 5, watch: 2, progress: 2, finish: 4, leaveRoom: 0.1, close: 0.6 };
const VERDICT_OF = { pass: 'ok', fail: 'intervals', none: 'no-trace' };

function interleave(seed, names, steps = 1200) {
  const pick = random(seed);

  return withClock((clock) => {
    clock.now = 1_000_000;
    const races = new FakeRaces({ users: new Map() });
    const { quick } = races;
    quick.duration = MODEL_DURATION;

    // Two browsers keep meeting each other, so their pair runs past a limit of one rated result a day.
    if (names.length === 2) quick.repeatLimit = 1;
    const players = names.map((user) => ({ user, machine: QUEUE_IDLE, chain: [], room: null, polling: false, closed: false, mayEnter: false, sequence: 0 }));
    const trail = [];
    const firstSeen = new Map();
    let quickServed = false;
    let late = 0;
    let afterClock = 0;

    const send = (player, request) => {
      if (request.rpc === 'quick') {
        quickServed = true;

        return call(races, player.user, 'quick', request.action);
      }

      const room = races.rooms.get(request.roomId);
      const seat = room?.players.find((p) => p.userId === player.user);
      const open = room?.status === 'racing' && !seat.finished && clock.now < Date.parse(room.startAt) + (room.duration + 10) * 1000;
      // A finish that reaches the race while this seat is still in it: its own record decides the seat's verdict.
      const deciding = request.action === 'progress' && request.data.finished && open && !quick.row(room, player.user);

      if (request.action === 'progress' && request.data.finished && quick.row(room, player.user)) late += 1;

      if (request.action === 'progress' && !request.data.finished && open && clock.now >= Date.parse(room.startAt) + room.duration * 1000) afterClock += 1;
      const answer = call(races, player.user, 'race', request.action, request.roomId, request.data);

      if (deciding) assert.equal(seat.verdict, VERDICT_OF[request.kind], `a finish's own record did not decide the verdict (seed ${seed}: ${trail.slice(-14).join(', ')})`);

      return answer;
    };

    const run = (player, effects) => {
      for (const effect of effects) {
        if (effect.send) player.chain.push({ rpc: 'quick', action: effect.send, ticket: effect.ticket });

        if (effect.poll) player.polling = effect.ticket;

        if (effect.enter) {
          assert.ok(player.mayEnter, `${player.user} entered a race after stopping (seed ${seed}: ${trail.join(', ')})`);
          player.room = effect.enter.roomId;
          player.machine = queueStep(player.machine, { type: 'entered' }).state;
          player.chain.push({ rpc: 'race', action: 'get', roomId: player.room });
        }
      }
    };

    const dispatch = (player, event) => {
      const step = queueStep(player.machine, { now: clock.now, ...event });
      player.machine = step.state;
      run(player, step.effects);
    };

    const actions = {
      press(player) { if (!player.room) { player.mayEnter = !['joining', 'waiting', 'lonely'].includes(player.machine.phase); dispatch(player, { type: 'press' }); } },
      keep(player) { dispatch(player, { type: 'keep-waiting' }); },
      best(player) { if (player.machine.phase === 'lonely') player.mayEnter = false; dispatch(player, { type: 'race-best' }); },
      timer(player) {
        if (player.polling && player.polling === player.machine.ticket) {
          player.polling = false;
          player.chain.push({ rpc: 'quick', action: 'queue', ticket: player.machine.ticket });
        }
      },
      process(player) {
        const head = player.chain[0];

        if (head && !head.answer) head.answer = send(player, head);
      },
      deliver(player) {
        const head = player.chain[0];

        if (!head?.answer) return;
        player.chain.shift();

        if (head.rpc === 'quick' && head.action === 'rating') return;

        if (head.rpc === 'quick') {
          dispatch(player, head.answer.status === 200 ? { type: 'reply', ticket: head.ticket, result: head.answer.json }
            : { type: 'fail', ticket: head.ticket, message: head.answer.json?.message });
        } else if (player.room === head.roomId && ['finished', 'cancelled', 'expired'].includes(head.answer.json?.status)) player.room = null;
      },
      watch(player) { if (player.room && !player.chain.length) player.chain.push({ rpc: 'race', action: 'get', roomId: player.room }); },
      // Progress with no keystroke record, as the browser sends it while typing; on a slow link it lands after the clock.
      progress(player) {
        const room = races.rooms.get(player.room);

        if (!room || player.chain.length || clock.now < Date.parse(room.startAt)) return;
        player.sequence += 1;
        player.chain.push({ rpc: 'race', action: 'progress', roomId: room.id,
          data: { typed: room.passage.slice(0, 20), keystrokes: 20, errors: 0, finished: false, sequence: player.sequence } });
      },
      // A finish on the room's passage, sent when the browser's race clock ends: a run that passes, one whose
      // keys all came at once, or none (a page reloaded mid-race).
      finish(player) {
        const room = races.rooms.get(player.room);

        if (!room || clock.now < Date.parse(room.startAt) + room.duration * 1000) return;
        const roll = pick();
        const kind = roll < 0.65 ? 'pass' : roll < 0.85 ? 'fail' : 'none';
        const trace = { pass: traceOf(room.passage, 30, 120, MODEL_DURATION * 1000), fail: traceOf(room.passage, 30, 0, MODEL_DURATION * 1000), none: null }[kind];
        player.sequence += 1;
        player.chain.push({ rpc: 'race', action: 'progress', roomId: room.id, kind,
          data: { typed: room.passage.slice(0, 30), keystrokes: 30, errors: 0, finished: true, sequence: player.sequence, trace } });
      },
      leaveRoom(player) {
        if (!player.room) return;
        player.chain.push({ rpc: 'race', action: 'leave', roomId: player.room });
        player.room = null;
      },
      // Closing the page: what it had sent may still arrive, but nothing else will.
      close(player) { if (pick() < 0.15) Object.assign(player, { closed: true, polling: false, room: null, machine: QUEUE_IDLE }); },
    };

    const check = () => {
      const where = `seed ${seed} after ${trail.slice(-14).join(', ')}`;
      const live = [...races.rooms.values()].filter((room) => room.quick && ['countdown', 'racing'].includes(room.status));
      const seats = live.flatMap((room) => room.players.map((p) => p.userId));
      assert.equal(new Set(seats).size, seats.length, `someone is seated in two quick matches (${where})`);

      for (const room of races.rooms.values()) {
        if (!room.quick) continue;
        assert.equal(new Set(room.players.map((p) => p.userId)).size, 2, `a quick room paired someone with themselves (${where})`);

        if (room.status === 'racing') assert.ok(room.players.every((p) => p.ready), `a race started with a seat that never came (${where})`);
      }

      for (const user of quick.queue.keys()) assert.ok(!seats.includes(user), `${user} is queued while seated in a quick match (${where})`);

      for (const player of players) {
        if (player.room) assert.ok(races.rooms.get(player.room).players.some((p) => p.userId === player.user), `${player.user} is in someone else's room (${where})`);
      }

      // A quick match request settles every race past its clock and grace before it answers.
      if (quickServed) {
        const due = live.filter((room) => clock.now >= Date.parse(room.startAt) + (room.duration + 10) * 1000);
        assert.deepEqual(due.map((room) => room.id), [], `a quick match request left a finished race unsettled (${where})`);
        quickServed = false;
      }

      // Settled is settled: no later request, finish or replay changes a seat's result once it is written.
      for (const [id, rows] of quick.results) {
        for (const row of rows) {
          const key = `${id}:${row.user}`;
          const text = JSON.stringify(row);

          if (!firstSeen.has(key)) firstSeen.set(key, text);
          assert.equal(text, firstSeen.get(key), `a settled result changed (${where})`);
        }
      }
    };

    for (let i = 0; i < steps; i += 1) {
      if (pick() < 0.05) {
        clock.now += Math.floor(pick() * (pick() < 0.25 ? 15_000 : 2000));
        trail.push(`+${clock.now - 1_000_000}`);

        for (const player of players) if (!player.closed) dispatch(player, { type: 'tick' });
      } else {
        const player = players[Math.floor(pick() * players.length)];
        let roll = pick() * Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);
        const name = Object.keys(WEIGHTS).find((key) => (roll -= WEIGHTS[key]) < 0) || 'process';

        if (player.closed) {
          // A closed page that comes back opens the Online tab, which reads the rating.
          if (name === 'press' && pick() < 0.3) {
            Object.assign(player, { closed: false, chain: [{ rpc: 'quick', action: 'rating' }] });
            trail.push(`${player.user}.returns`);
          }

          if (name === 'process') actions.process(player);
          continue;
        }

        trail.push(`${player.user}.${name}`);
        actions[name](player);
      }

      check();
    }

    // Long after everyone stopped, one stranger opens the Online tab: every race that started is settled.
    clock.now += 60_000;
    call(races, 'stranger', 'quick', 'rating');
    const rooms = [...races.rooms.values()].filter((room) => room.quick);
    const started = rooms.filter((room) => !['countdown', 'cancelled'].includes(room.status) || quick.results.has(room.id));

    for (const room of rooms.filter((r) => r.status !== 'cancelled' || quick.results.has(r.id))) {
      assert.equal(quick.results.get(room.id)?.length, 2, `a race that started was never settled (seed ${seed}, ${room.status})`);
    }

    // Every row against the ratings at the time it was written, replayed in order. A win needs the seat's own
    // checked run. A result is unrated only when neither run was checked (no winner) or the pair had already moved
    // ratings three times that day. Each change is Elo from the two ratings before the race. A race both seats were
    // rated in sums to zero at the same K; a race only one seat was rated in is a forfeit's loss alone. And each
    // rating is 1500 plus its changes.
    const at = new Map();
    const now = (user) => at.get(user) || { rating: RATING.start, races: 0 };
    const rows = [...quick.results].flatMap(([id, list]) => list.map((row) => ({ ...row, id }))).sort((a, b) => a.at - b.at);
    const flip = { won: 'lost', lost: 'won', tied: 'tied' };
    const counted = new Map();
    let oneSided = 0;
    let repeats = 0;

    for (const row of rows) {
      const room = races.rooms.get(row.id);
      const seat = room.players.find((p) => p.userId === row.user);
      const other = room.players.find((p) => p.userId !== row.user);
      const theirs = quick.row(room, other.userId);
      const where = `seed ${seed}, room ${row.id.slice(0, 8)}`;
      assert.equal(row.before, now(row.user).rating, `a row was not rated from the rating it had (${where})`);

      if (row.outcome === 'won') assert.equal(seat.verdict, 'ok', `a seat won without its own checked run (${where})`);

      if (!row.rated && row.outcome) {
        assert.ok(room.repeat, `a decided result was left unrated outside the repeat limit (${where})`);
        repeats += 1;
      }

      if (!row.outcome) assert.ok(seat.verdict !== 'ok' && other.verdict !== 'ok', `a race with a checked run had no winner (${where})`);

      if (row.rated) {
        const pair = [seat.slot === 1 ? row : theirs, seat.slot === 1 ? theirs : row];
        const [one, two] = [1, 2].map((slot) => room.players.find((p) => p.slot === slot).userId);
        const outcomeOne = seat.slot === 1 ? row.outcome : flip[row.outcome];
        const changes = ratingChanges({ rating: pair[0].before, races: now(one).races }, { rating: pair[1].before, races: now(two).races }, outcomeOne);
        assert.equal(row.delta, changes[seat.slot - 1], `a rated row did not follow Elo (${where})`);
        quick.row(room, row.user).k = kFactor(now(row.user).races);
        at.set(row.user, { rating: row.before + row.delta, races: now(row.user).races + 1 });
        const key = [one, two].sort().join(':');
        counted.set(key, new Set([...(counted.get(key) || []), row.id]));
      }
    }

    for (const list of quick.results.values()) {
      const rated = list.filter((row) => row.rated);

      if (rated.length === 2 && rated[0].k === rated[1].k) assert.equal(rated[0].delta + rated[1].delta, 0, `a same-K race did not sum to zero (seed ${seed})`);

      if (rated.length === 1) {
        assert.ok(rated[0].reason === 'forfeit' && rated[0].outcome === 'lost' && rated[0].delta <= 0, `one seat alone was rated, not a forfeit's loss (seed ${seed})`);
        oneSided += 1;
      }
    }

    for (const rooms of counted.values()) assert.ok(rooms.size <= quick.repeatLimit, `a pair moved ratings more than its limit in a day (seed ${seed})`);

    for (const user of quick.ratings.keys()) assert.deepEqual(quick.rating(user), now(user), `${user}'s rating is not the sum of its changes (seed ${seed})`);

    const settled = [...quick.results.values()].map((list) => list.find((row) => row.rated && !row.reason) ? 'decided' : list.some((row) => row.rated) ? 'walkover' : 'unrated');

    return { rooms: rooms.length, started: started.length, decided: settled.filter((kind) => kind === 'decided').length,
      walkover: settled.filter((kind) => kind === 'walkover').length, unrated: settled.filter((kind) => kind === 'unrated').length, late, afterClock, oneSided, repeats };
  });
}

test('generated interleavings of pairing, racing, failed traces, abandoning, returning and late finishes', () => {
  const totals = { rooms: 0, started: 0, decided: 0, walkover: 0, unrated: 0, late: 0, afterClock: 0, oneSided: 0, repeats: 0 };

  // Four browsers, and then two, who keep meeting each other and run past their pair's limit.
  for (let seed = 1; seed <= 600; seed += 1) {
    const result = interleave(seed, seed <= 400 ? ['ada', 'lin', 'kai', 'ola'] : ['ada', 'lin']);

    for (const key of Object.keys(totals)) totals[key] += result[key];
  }


  // The generator reaches real races of every kind, so the invariants are about them.
  assert.ok(totals.rooms > 200, `only ${totals.rooms} quick rooms opened`);
  assert.ok(totals.started > 50, `only ${totals.started} races started`);
  assert.ok(totals.decided > 5, `only ${totals.decided} races were decided by two passing runs`);
  assert.ok(totals.walkover > 10, `only ${totals.walkover} races were rated against a run that didn't count or a forfeit`);
  assert.ok(totals.unrated > 5, `only ${totals.unrated} races were left unrated`);
  assert.ok(totals.late > 10, `only ${totals.late} finishes arrived after their race was settled`);
  assert.ok(totals.afterClock > 20, `only ${totals.afterClock} progress packets landed after the clock before their finish`);
  assert.ok(totals.oneSided > 5, `only ${totals.oneSided} races were a forfeit's loss alone`);
  assert.ok(totals.repeats > 5, `only ${totals.repeats} results were past the pair's three a day`);
});
