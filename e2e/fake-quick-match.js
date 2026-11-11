// public.quick_match as the migration answers it (supabase/migrations/20261110120000_quick_match.sql), over the
// fake's race rooms, so two browser contexts can be matched. Pairing, the trace check and the rating maths come
// from src/quick-match.js, which tests/quick-match.test.js keeps equal to the migration.
import { randomUUID } from 'node:crypto';
import { scoreTrace } from '../src/ghost-race.js';
import { racePassage } from '../src/race-options.js';
import { PAIRING, RATING, pickOpponent, quickConditions, ratingChanges, traceCheck } from '../src/quick-match.js';

const LIVE = ['countdown', 'racing'];

export class FakeQuickMatch {
  constructor(races) {
    this.races = races;
    this.queue = new Map();
    this.ratings = new Map();
    // Each settled quick room's rows, by room id: [{ user, outcome, rated, reason, before, after, delta }].
    this.results = new Map();
    // Set, the project has no quick_match function yet: the platform answers 404.
    this.missing = false;
    // The race clock of the next quick rooms, shortened by tests that don't need the standard 30 seconds.
    this.duration = 30;
    this.countdownMs = 5000;
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

  // This seat's settled result, as the snapshot carries it.
  resultFor(room, slot) {
    const user = room.players.find((p) => p.slot === slot)?.userId;
    const row = (this.results.get(room.id) || []).find((entry) => entry.user === user);

    if (!row) return null;
    const { outcome, rated, reason, before, after, delta } = row;

    return { rated, reason, outcome, before, after, delta, races: this.rating(user).races };
  }

  // As race_private.keep_trace for a quick room: the first finished trace's verdict stands, and none is taken
  // once the room is settled.
  check(room, player, trace) {
    if (room.quick && player.finished && player.verdict === undefined && !this.results.has(room.id)) {
      player.verdict = traceCheck(trace, room.passage, { duration: room.duration, correct: player.correct });
    }
  }

  // As race_private.rate: once per room. A forfeit is a rated loss for the seat that left; otherwise a seat
  // counts only with a finished run whose trace passed. Both: the traces decide. One: it wins. Neither: unrated.
  rate(room, forfeit = null) {
    if (!room.quick || this.results.has(room.id)) return;
    const [one, two] = [1, 2].map((slot) => room.players.find((p) => p.slot === slot));

    if (!one?.userId || !two?.userId) return;
    let rated = true;
    let why;
    let outcome;

    if (forfeit) {
      why = ['forfeit', 'forfeit'];
      outcome = forfeit === 1 ? 'lost' : 'won';
    } else {
      why = [one.verdict ?? 'unfinished', two.verdict ?? 'unfinished'];
      const passed = why.map((reason) => reason === 'ok');
      const ahead = (a, b) => a.wpm - b.wpm || a.accuracy - b.accuracy;
      const by = (diff) => (diff > 0 ? 'won' : diff < 0 ? 'lost' : 'tied');

      if (passed[0] && passed[1]) {
        outcome = by(ahead(...[one, two].map((p) => scoreTrace(p.trace, room.passage))));
        why = [null, null];
      } else if (passed[0] || passed[1]) {
        outcome = passed[0] ? 'won' : 'lost';
        const winner = passed[0] ? 0 : 1;
        why[winner] = why[1 - winner] === 'unfinished' ? 'opponent-absent' : 'opponent-unchecked';
      } else {
        rated = false;
        outcome = by(ahead(one, two));
      }
    }

    const [r1, r2] = [one, two].map((p) => this.rating(p.userId));
    const [d1, d2] = rated ? ratingChanges(r1, r2, outcome) : [0, 0];
    const flip = { won: 'lost', lost: 'won', tied: 'tied' };

    const rows = [[one, r1, d1, outcome, why[0]], [two, r2, d2, flip[outcome], why[1]]].map(([player, before, delta, result, reason]) => {
      if (rated) this.ratings.set(player.userId, { rating: before.rating + delta, races: before.races + 1 });

      return { user: player.userId, outcome: result, rated, reason, before: before.rating, after: before.rating + delta, delta };
    });

    this.results.set(room.id, rows);
  }

  // The last settled quick match of an account, as 'rating' returns it.
  last(user) {
    const settled = [...this.results].filter(([, rows]) => rows.some((row) => row.user === user));

    if (!settled.length) return null;
    const [roomId, rows] = settled.at(-1);
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

      return send(200, { state: 'paired', roomId: live.id, room: this.races.snapshot(live, slot) });
    }

    const name = String(data.displayName || '').trim();

    if (!name || name.length > 40) return send(400, { message: 'Use a racer name of 1 to 40 characters.' });
    const me = { user: caller, name, rating: mine.rating, joinedAt: this.queue.get(caller)?.joinedAt ?? now, seenAt: now };
    this.queue.set(caller, me);
    const them = pickOpponent([...this.queue.values()], me, now);

    if (!them) return send(200, { state: 'waiting', rating: mine.rating, races: mine.races, waitedMs: now - me.joinedAt });
    this.queue.delete(caller);
    this.queue.delete(them.user);
    const conditions = { ...quickConditions(), duration: this.duration };

    const room = {
      id: randomUUID(), passage: racePassage(conditions).text, conditions, duration: this.duration, quick: true,
      status: 'countdown', startAt: new Date(now + this.countdownMs).toISOString(), createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 15 * 60000).toISOString(), invitedUser: caller, inviteKind: 'account', inviteToken: null,
      players: [{ ...this.races.player(1, them.name, them.user), lastSeen: them.seenAt }, this.races.player(2, name, caller)],
    };

    this.races.rooms.set(room.id, room);

    return send(200, { state: 'paired', roomId: room.id, room: this.races.snapshot(room, 2) });
  }
}
