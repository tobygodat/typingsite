// public.quick_match as the migration answers it (supabase/migrations/20261110120000_quick_match.sql), over the
// fake's race rooms, so two browser contexts can be matched. Pairing, the trace check and the rating maths come
// from src/quick-match.js, which tests/quick-match.test.js keeps equal to the migration.
import { randomUUID } from 'node:crypto';
import { scoreTrace } from '../src/ghost-race.js';
import { wordList } from '../src/words.js';
import { PAIRING, RATING, REPEAT, pickOpponent, quickConditions, ratingChanges, traceCheck } from '../src/quick-match.js';

const LIVE = ['countdown', 'racing'];

// As race_private.quick_passage: the 200 words drawn at random, none equal to either of the two before, cut at a
// word's end to at most 1000 characters.
export function quickPassage(random = Math.random) {
  const words = wordList('200');
  const picked = [];
  let length = -1;

  for (;;) {
    const word = words[Math.floor(random() * words.length)];

    if (picked.slice(-2).includes(word)) continue;

    if (length + word.length + 1 > 1000) return picked.join(' ');
    picked.push(word);
    length += word.length + 1;
  }
}

export class FakeQuickMatch {
  constructor(races) {
    this.races = races;
    this.queue = new Map();
    this.ratings = new Map();
    // Each quick room's rows, by room id, one per seat once that seat is settled (a forfeit's first):
    // [{ user, outcome, rated, reason, before, after, delta, at }].
    this.results = new Map();
    // Set, the project has no quick_match function yet: the platform answers 404.
    this.missing = false;
    // The race clock of the next quick rooms, shortened by tests that don't need the standard 30 seconds.
    this.duration = 30;
    this.countdownMs = 5000;
    // The pair's rated results in 24 hours before the next stands unrated, lowered by the model test so pairs reach it.
    this.repeatLimit = REPEAT.rated;
    this.held = null;
  }

  // Holds the reply to the next 'queue' request: the service acts on it at once, and the answer comes back
  // only once the test calls the returned release.
  holdNextQueue() {
    let release;
    this.held = new Promise((resolve) => { release = resolve; });

    return () => release();
  }

  rating(user) { return this.ratings.get(user) || { rating: RATING.start, races: 0 }; }

  liveRoom(user) {
    return [...this.races.rooms.values()].find((room) => room.quick && LIVE.includes(room.status)
      && Date.now() < Date.parse(room.expiresAt) && room.players.some((p) => p.userId === user)) || null;
  }

  // As race_private.last_opponent: the other racer of the account's latest quick match.
  lastOpponent(user) {
    const rooms = [...this.races.rooms.values()].filter((room) => room.quick && room.players.some((p) => p.userId === user));

    return rooms.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).at(-1)?.players.find((p) => p.userId !== user)?.userId ?? null;
  }

  row(room, user) { return (this.results.get(room.id) || []).find((entry) => entry.user === user) || null; }

  // This seat's settled result, as the snapshot carries it.
  resultFor(room, slot) {
    const user = room.players.find((p) => p.slot === slot)?.userId;
    const row = this.row(room, user);

    if (!row) return null;
    const { outcome, rated, reason, before, after, delta } = row;

    return { rated, reason, outcome, before, after, delta, races: this.rating(user).races };
  }

  // As race_private.keep_trace for a quick room: the first finished trace's verdict stands, and none is taken
  // once the seat's result is written.
  check(room, player, trace) {
    if (room.quick && player.finished && player.verdict === undefined && !this.row(room, player.userId)) {
      player.verdict = traceCheck(trace, room.passage, { duration: room.duration, correct: player.correct });
    }
  }

  // The pair's rated results in the 24 hours before now, other than this room's.
  pairRated(room, users) {
    const now = Date.now();

    return [...this.results].filter(([id, rows]) => id !== room.id && rows.some((row) => row.rated && now - row.at < REPEAT.windowMs)
      && users.every((user) => this.races.rooms.get(id)?.players.some((p) => p.userId === user))).length;
  }

  // As race_private.rate: each seat's row once. With `forfeit`, the slot that left after the start before finishing
  // while the other was still in the race, only that seat's rated loss, now. Otherwise every seat still without
  // a row: a seat counts only with a finished run whose trace passed. Both: the traces decide. One: it wins. Neither:
  // no winner, unrated. Each change comes from the two ratings before the race; past the pair's three rated results
  // in 24 hours, the result stands unrated.
  rate(room, forfeit = null) {
    if (!room.quick) return;
    const seats = [1, 2].map((slot) => room.players.find((p) => p.slot === slot));

    if (!seats[0]?.userId || !seats[1]?.userId || seats[0].userId === seats[1].userId) return;
    const rows = seats.map((p) => this.row(room, p.userId));

    if (rows.every(Boolean)) return;
    const before = seats.map((p, i) => (rows[i] ? { rating: rows[i].before, races: this.rating(p.userId).races } : this.rating(p.userId)));
    const pass = seats.map((p) => p.verdict === 'ok');
    const left = rows.map((row) => row?.reason === 'forfeit');
    room.repeat ??= this.pairRated(room, seats.map((p) => p.userId)) >= this.repeatLimit;
    const ahead = (a, b) => a.wpm - b.wpm || a.accuracy - b.accuracy;
    const flip = { won: 'lost', lost: 'won', tied: 'tied' };

    seats.forEach((seat, i) => {
      if (rows[i] || (forfeit && seat.slot !== forfeit)) return;
      const them = 1 - i;
      let outcome = null;
      let reason;

      if (forfeit) [outcome, reason] = ['lost', 'forfeit'];
      else if (pass[i] && pass[them]) {
        const diff = ahead(...[seat, seats[them]].map((p) => scoreTrace(p.trace, room.passage)));
        [outcome, reason] = [diff > 0 ? 'won' : diff < 0 ? 'lost' : 'tied', null];
      } else if (pass[i]) [outcome, reason] = ['won', left[them] ? 'forfeit' : seats[them].verdict === undefined ? 'opponent-absent' : 'opponent-unchecked'];
      else [outcome, reason] = [pass[them] ? 'lost' : null, seat.verdict ?? 'unfinished'];

      const rated = Boolean(outcome) && !room.repeat;
      // ratingChanges takes seat 1's outcome, as the migration takes seat 1's expectation.
      const delta = rated ? ratingChanges(before[0], before[1], i === 0 ? outcome : flip[outcome])[i] : 0;
      const mine = this.rating(seat.userId);

      if (rated) this.ratings.set(seat.userId, { rating: mine.rating + delta, races: mine.races + 1 });
      const list = this.results.get(room.id) || [];
      list.push({ user: seat.userId, outcome, rated, reason, before: before[i].rating, after: before[i].rating + delta, delta, at: Date.now() });
      this.results.set(room.id, list);
    });
  }

  // The last settled quick match of an account, as 'rating' returns it.
  last(user) {
    const settled = [...this.results].filter(([, rows]) => rows.some((row) => row.user === user));

    if (!settled.length) return null;
    const at = ([, rows]) => rows.find((row) => row.user === user).at;
    const [roomId, rows] = settled.sort((a, b) => at(a) - at(b)).at(-1);
    const { outcome, rated, reason, before, after, delta } = rows.find((row) => row.user === user);

    return { roomId, rated, reason, outcome, before, after, delta, races: this.rating(user).races };
  }

  forget(user) {
    this.queue.delete(user);
    this.ratings.delete(user);

    for (const [id, rows] of this.results) this.results.set(id, rows.filter((row) => row.user !== user));
  }

  handle(caller, { p_action: action, p_data: data = {} }, reply) {
    const held = action === 'queue' ? this.held : null;

    if (held) this.held = null;
    const send = held ? (status, json) => held.then(() => reply(status, json)) : reply;

    if (this.missing) return send(404, { code: 'PGRST202', message: 'Could not find the function public.quick_match(p_action, p_data) in the schema cache' });

    if (!caller) return send(400, { message: 'Sign in to race someone new.' });

    if (!['rating', 'queue', 'unqueue'].includes(action)) return send(400, { message: 'Unknown quick match action.' });
    const now = Date.now();
    // As race_private.settle_due: every quick match whose clock and grace have run out, before anything is read.
    this.races.settleDue();
    const mine = this.rating(caller);
    const last = this.last(caller);

    if (action === 'rating') return send(200, last ? { ...mine, last } : mine);

    for (const [user, row] of this.queue) if (now - row.seenAt > PAIRING.staleMs) this.queue.delete(user);
    const live = this.liveRoom(caller);
    const slot = live?.players.find((p) => p.userId === caller).slot;

    if (action === 'unqueue') {
      this.queue.delete(caller);

      if (live && !live.players.find((p) => p.slot === slot).ready) live.status = 'cancelled';

      return send(200, { state: 'idle' });
    }

    if (live) {
      this.queue.delete(caller);

      // A race this seat left goes on until it settles, and the seat waits to be paired again.
      if (live.players.find((p) => p.slot === slot).left) return send(200, { state: 'waiting', rating: mine.rating, races: mine.races, waitedMs: 0 });

      return send(200, { state: 'paired', roomId: live.id, room: this.races.snapshot(live, slot) });
    }

    const name = String(data.displayName || '').trim();

    if (!name || name.length > 40) return send(400, { message: 'Use a racer name of 1 to 40 characters.' });
    const me = { user: caller, name, rating: mine.rating, joinedAt: this.queue.get(caller)?.joinedAt ?? now, seenAt: now };
    this.queue.set(caller, me);
    const them = pickOpponent([...this.queue.values()].map((row) => ({ ...row, last: this.lastOpponent(row.user) })), me, now);

    if (!them) return send(200, { state: 'waiting', rating: mine.rating, races: mine.races, waitedMs: now - me.joinedAt });
    this.queue.delete(caller);
    this.queue.delete(them.user);
    const conditions = { ...quickConditions(), duration: this.duration };

    const room = {
      id: randomUUID(), passage: quickPassage(), conditions, duration: this.duration, quick: true,
      status: 'countdown', startAt: new Date(now + this.countdownMs).toISOString(), createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 15 * 60000).toISOString(), invitedUser: caller, inviteKind: 'account', inviteToken: null,
      players: [{ ...this.races.player(1, them.name, them.user), lastSeen: them.seenAt }, this.races.player(2, name, caller)],
    };

    this.races.rooms.set(room.id, room);

    return send(200, { state: 'paired', roomId: room.id, room: this.races.snapshot(room, 2) });
  }
}
