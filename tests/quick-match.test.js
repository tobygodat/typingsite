import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PAIRING, QUEUE_IDLE, RATING, TRACE_CHECK, acceptableGap, expectedScore, kFactor, pickOpponent, queueStep, quickConditions,
  ratingChangeLine, ratingChanges, ratingLine, traceCheck, LONELY_MS } from '../src/quick-match.js';
import { wordList } from '../src/words.js';
import { FakeRaces } from '../e2e/fake-races.js';

const migration = readFileSync(new URL('../supabase/migrations/20261110120000_quick_match.sql', import.meta.url), 'utf8');

test('the migration draws its passage from the same 200 words and sends the same conditions as the browser', () => {
  const words = /\$words\$([\s\S]*?)\$words\$/.exec(migration)[1].trim().split(/\s+/);
  assert.deepEqual(words, wordList('200'));
  const conditions = JSON.parse(/select '(\{"mode":"time".*?\})'::jsonb/.exec(migration)[1]);
  // A new corpus or metric version changes these conditions, so the migration's copy needs a new migration.
  assert.deepEqual(conditions, quickConditions());
  assert.match(migration, /exit when length\(v_text\) \+ length\(v_word\) \+ 1 > 1000;/);
});

test('the migration keeps the same limits as the browser: gap, staleness, K and the trace check', () => {
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
  assert.equal(ratingChangeLine({ rated: true, reason: null, outcome: 'lost', after: 1480, delta: -20, races: 1 }),
    'Race rating 1480 · 1 rated race · provisional (−20)');
  assert.equal(ratingChangeLine({ rated: true, reason: 'forfeit', outcome: 'won', after: 1520, delta: 20, races: 11 }, 'Ada'),
    'Ada left, so the win is yours. Race rating 1520 · 11 rated races (+20)');
  assert.equal(ratingChangeLine({ rated: false, reason: 'intervals' }), 'Not rated: your keys came faster than a person types.');
  assert.equal(ratingChangeLine({ rated: false, reason: 'opponent' }), 'Not rated: the other racer’s run didn’t pass the check.');
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

// Four browsers against the fake service. Each browser's requests go out one at a time, as the view sends
// them; the service handles a request whenever the generator says, and its reply lands later still.
function interleave(seed, steps = 220) {
  const pick = random(seed);
  const realNow = Date.now;
  let clock = 1_000_000;
  Date.now = () => clock;

  try {
    const races = new FakeRaces({ users: new Map() });
    const quick = races.quick;
    const players = ['ada', 'lin', 'kai', 'ola'].map((user) => ({ user, machine: QUEUE_IDLE, chain: [], room: null, polling: false, closed: false, mayEnter: false }));
    const trail = [];

    const call = (player, request) => {
      let answer = null;
      const send = (status, json) => { answer = { status, json }; };

      if (request.rpc === 'quick') quick.handle(player.user, { p_action: request.action, p_data: { displayName: player.user } }, send);
      else races.handle(player.user, { p_action: request.action, p_room_id: request.roomId, p_data: {} }, send);

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
      const step = queueStep(player.machine, { now: clock, ...event });
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

        if (head && !head.answer) head.answer = call(player, head);
      },
      deliver(player) {
        const head = player.chain[0];

        if (!head?.answer) return;
        player.chain.shift();

        if (head.rpc === 'quick') {
          dispatch(player, head.answer.status === 200 ? { type: 'reply', ticket: head.ticket, result: head.answer.json }
            : { type: 'fail', ticket: head.ticket, message: head.answer.json?.message });
        } else if (player.room === head.roomId && ['finished', 'cancelled', 'expired'].includes(head.answer.json?.status)) player.room = null;
      },
      watch(player) { if (player.room && !player.chain.length) player.chain.push({ rpc: 'race', action: 'get', roomId: player.room }); },
      leaveRoom(player) {
        if (!player.room) return;
        player.chain.push({ rpc: 'race', action: 'leave', roomId: player.room });
        player.room = null;
      },
      close(player) { if (pick() < 0.1) Object.assign(player, { closed: true, chain: [], polling: false }); },
    };

    for (let i = 0; i < steps; i += 1) {
      if (pick() < 0.12) {
        clock += Math.floor(pick() * 4000);
        trail.push(`+${clock - 1_000_000}`);

        for (const player of players) if (!player.closed) dispatch(player, { type: 'tick' });
      } else {
        const player = players[Math.floor(pick() * players.length)];
        const names = Object.keys(actions);
        const name = names[Math.floor(pick() * names.length)];

        if (player.closed) continue;
        trail.push(`${player.user}.${name}`);
        actions[name](player);
      }

      const live = [...races.rooms.values()].filter((room) => room.quick && ['countdown', 'racing'].includes(room.status));
      const seats = live.flatMap((room) => room.players.map((p) => p.userId));
      const where = `seed ${seed} after ${trail.slice(-12).join(', ')}`;
      assert.equal(new Set(seats).size, seats.length, `someone is seated in two quick matches (${where})`);

      for (const room of races.rooms.values()) {
        if (!room.quick) continue;
        assert.equal(new Set(room.players.map((p) => p.userId)).size, 2, `a quick room paired someone with themselves (${where})`);

        // Read as the service sees it on its next request.
        races.snapshot(room, null);

        if (room.status === 'racing') assert.ok(room.players.every((p) => p.ready), `a race started with a seat that never came (${where})`);
      }

      for (const user of quick.queue.keys()) assert.ok(!seats.includes(user), `${user} is queued while seated in a quick match (${where})`);

      for (const player of players) {
        if (player.room) assert.ok(races.rooms.get(player.room).players.some((p) => p.userId === player.user), `${player.user} is in someone else's room (${where})`);
      }
    }

    return [...races.rooms.values()].filter((room) => room.quick).length;
  } finally {
    Date.now = realNow;
  }
}

test('generated interleavings of join, poll, leave, timeout and pairing: nobody double-paired, self-paired or stranded', () => {
  let rooms = 0;

  for (let seed = 1; seed <= 400; seed += 1) rooms += interleave(seed);
  // The generator does reach pairings, so the invariants are about real rooms.
  assert.ok(rooms > 200, `only ${rooms} quick rooms opened`);
});

test('the fake rates once per room, changes nothing when unrated, and a forfeit is a rated loss for the leaver', () => {
  const races = new FakeRaces({ users: new Map() });
  const { quick } = races;
  const passage = 'the quick brown fox jumps over the lazy dog';
  const trace = (count, step) => ({ v: 1, k: passage.slice(0, count), t: Array.from({ length: count }, (_, i) => (i ? step : 500)), e: 30000 });

  const room = (id, verdicts) => ({ id, quick: true, passage, duration: 30, players: [
    { slot: 1, userId: 'ada', verdict: verdicts[0], trace: trace(40, 120), wpm: 16, accuracy: 100, correct: 40 },
    { slot: 2, userId: 'lin', verdict: verdicts[1], trace: trace(30, 150), wpm: 12, accuracy: 100, correct: 30 }] });

  const clean = room('a', ['ok', 'ok']);
  quick.rate(clean);
  quick.rate(clean);
  assert.deepEqual([quick.rating('ada'), quick.rating('lin')], [{ rating: 1520, races: 1 }, { rating: 1480, races: 1 }]);
  quick.rate(room('b', ['ok', 'speed']));
  assert.deepEqual([quick.rating('ada'), quick.rating('lin')], [{ rating: 1520, races: 1 }, { rating: 1480, races: 1 }]);
  assert.deepEqual(quick.resultFor(room('b', []), 1), { rated: false, reason: 'opponent', outcome: 'won', before: 1520, after: 1520, delta: 0, races: 1 });
  quick.rate(room('c', [undefined, undefined]), 1);
  assert.equal(quick.resultFor(room('c', []), 1).outcome, 'lost');
  assert.ok(quick.rating('ada').rating < 1520);
});
