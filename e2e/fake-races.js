// Shared by independent browser contexts. Production authorization/state is separately
// exercised against the migration; this adapter drives the real UI without network calls.
import { randomUUID } from 'node:crypto';
import { scoreTrace, validTrace } from '../src/ghost-race.js';

export class FakeRaces {
  constructor(auth) {
    this.auth = auth;
    this.rooms = new Map();
    this.friends = new Map();
    this.holds = new Map();
    // As in FakeChallenges: with `held` set to an array, a successful reply to an action named in `holding`
    // waits until a test calls the release pushed onto it. The action itself is already done.
    this.held = null;
    this.holding = new Set();
    // Set, the service keeps no traces, as for a race from before them.
    this.dropTraces = false;
    // Each pair of accounts' wins, keyed by the two ids in order: [first's wins, second's wins].
    this.tallies = new Map();
  }

  // As race_private.settle: a finished race between two accounts adds the winner's win (a tie, nothing).
  settle(room) {
    const [one, two] = [1, 2].map((slot) => room.players.find((p) => p.slot === slot));

    if (!one?.userId || !two?.userId) return;
    const key = [one.userId, two.userId].sort().join(':');
    const wins = this.tallies.get(key) || [0, 0];
    const ahead = one.wpm - two.wpm || one.accuracy - two.accuracy;
    const winner = ahead > 0 ? one : ahead < 0 ? two : null;

    if (winner) wins[key.startsWith(winner.userId) ? 0 : 1] += 1;
    this.tallies.set(key, wins);
  }

  tally(room, slot) {
    const me = room.players.find((p) => p.slot === slot);
    const them = room.players.find((p) => p.slot !== slot);

    if (room.status !== 'finished' || !me?.userId || !them?.userId) return null;
    const key = [me.userId, them.userId].sort().join(':');
    const wins = this.tallies.get(key);

    if (!wins) return null;

    return key.startsWith(me.userId) ? [...wins] : [wins[1], wins[0]];
  }

  // As race_private.keep_trace: once, from a finished racer, and only a trace that replays to the result.
  keepTrace(room, player, trace) {
    if (this.dropTraces || !player.finished || player.trace || !validTrace(trace)) return;

    if (scoreTrace(trace, room.passage, { relaxed: true }).correct !== player.correct) return;
    player.trace = trace;
  }

  // Holds the reply to the next request with this action: the service applies it on arrival, and the
  // answer comes back only once the test calls the returned release, while later requests go through.
  hold(action) {
    let release;
    this.holds.set(action, new Promise((resolve) => { release = resolve; }));

    return () => release();
  }

  friendList(owner) {
    return (this.friends.get(owner) || []).map(({ id, name, email, friendId }) => {
      const friend = { id, name, account: Boolean(friendId) };

      if (email) friend.email = email;

      return friend;
    })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  snapshot(room, slot) {
    const now = Date.now();

    if (now >= Date.parse(room.expiresAt) && !['finished', 'cancelled'].includes(room.status)) room.status = 'expired';

    if (room.status === 'countdown' && now >= Date.parse(room.startAt)) room.status = 'racing';

    // As race_action: ten seconds' grace after the clock for the last progress.
    if (room.status === 'racing' && (room.players.every((p) => p.finished) || now >= Date.parse(room.startAt) + (room.duration + 10) * 1000)) {
      room.status = 'finished';
      this.settle(room);
    }

    return {
      id: room.id, status: room.status, passage: room.passage, conditions: room.conditions,
      duration: room.duration, startAt: room.startAt, expiresAt: room.expiresAt,
      serverNow: new Date(now).toISOString(), selfSlot: slot, inviteKind: room.inviteKind,
      rematchOf: room.rematchOf || null, rematchId: room.rematchId || null, tally: this.tally(room, slot),
      players: room.players.map(({ userId, guestToken, typed, sequence, keystrokes, errors, lastSeen, correct, trace, ...player }) => {
        const seen = {
          ...player, connected: now - lastSeen < 10000, account: Boolean(userId),
          friend: Boolean(userId) && (this.friends.get(room.players.find((p) => p.slot === slot)?.userId) || []).some((f) => f.friendId === userId),
        };

        if (player.slot === slot) Object.assign(seen, { typed, sequence, keystrokes, errors });

        return seen;
      }),
    };
  }

  player(slot, name, userId, guestToken) {
    return { slot, name, userId, guestToken, ready: false, progress: 0, finished: false, lastSeen: Date.now(),
      wpm: 0, accuracy: 100, elapsed: 0, sequence: 0, typed: '', keystrokes: 0, errors: 0, correct: 0,
      rematch: false, left: false, trace: null };
  }

  handle(caller, { p_action: action, p_room_id: id, p_data: data = {}, p_guest_token: guestToken }, send) {
    // Two ways to hold a reply: hold(action) for the next request with it, or held/holding (see constructor).
    const once = this.holds.get(action);
    this.holds.delete(action);

    const answer = (status, json) => (status === 200 && this.held && this.holding.has(action)
      ? new Promise((release) => this.held.push(release)).then(() => send(status, json)) : send(status, json));

    const reply = once ? async (status, json) => {
      await once;

      return answer(status, json);
    } : answer;

    const failure = (message) => reply(400, { message });

    if (action === 'invites') return reply(200, [...this.rooms.values()]
      .flatMap((room) => (room.invitedUser === caller && caller && room.status === 'waiting' && Date.parse(room.expiresAt) > Date.now()
        && !room.players.some((p) => p.userId === caller && p.lastSeen > 0)
        ? [{ id: room.id, hostName: room.players.find((p) => p.userId !== caller).name, createdAt: room.createdAt,
          expiresAt: room.expiresAt, rematch: Boolean(room.rematchOf) }]
        : [])));

    if (['friends', 'befriend', 'unfriend'].includes(action) && !id) {
      if (!caller) return failure('Sign in to keep a friend list.');
      const list = this.friends.get(caller) || [];

      if (action === 'befriend') {
        const email = (data.email || '').trim().toLowerCase();
        const existing = list.find((f) => f.email === email);

        if (existing) existing.name = data.name || existing.name;
        else list.push({ id: randomUUID(), email, name: data.name || email.split('@')[0] });
      }

      this.friends.set(caller, action === 'unfriend' ? list.filter((f) => f.id !== data.friendId) : list);

      return reply(200, this.friendList(caller));
    }

    if (action === 'create') {
      if (!caller) return failure('Sign in to host a race.');
      let email = (data.inviteEmail || '').trim().toLowerCase();
      let invitedUser = null;

      if (data.friendId) {
        const friend = (this.friends.get(caller) || []).find((f) => f.id === data.friendId);

        if (!friend) return failure('That friend is no longer on your list.');
        email = friend.email || '';
        invitedUser = friend.friendId || null;
      }

      if (email) invitedUser = [...this.auth.users.values()].find((user) => user.email === email)?.id || 'unknown';

      const room = {
        id: randomUUID(), passage: data.passage, conditions: data.conditions, duration: data.conditions?.duration ?? 60,
        status: 'waiting', startAt: null, createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
        invitedUser, inviteKind: invitedUser ? 'account' : 'guest',
        inviteToken: invitedUser ? null : randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
        players: [this.player(1, data.displayName, caller)],
      };

      this.rooms.set(room.id, room);

      return reply(200, { room: this.snapshot(room, 1), roomId: room.id, inviteToken: room.inviteToken });
    }

    const room = this.rooms.get(id);

    if (!room) return failure('This race is unavailable or has expired.');
    this.snapshot(room, null);
    let player = room.players.find((p) => (caller && p.userId === caller) || (guestToken && p.guestToken === guestToken));

    if (action === 'join') {
      if (player) {
        player.lastSeen = Date.now();

        return reply(200, { room: this.snapshot(room, player.slot), roomId: id, guestToken: player.guestToken });
      }

      if (room.status !== 'waiting') return failure('This race is no longer accepting players.');

      if (room.invitedUser ? room.invitedUser !== caller : room.inviteToken !== data.inviteToken) return failure('This invite is unavailable.');

      if (room.players.length === 2) return failure('This race is full.');
      const token = caller ? null : data.guestToken || randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
      player = this.player(2, data.displayName, caller, token);
      room.players.push(player);

      return reply(200, { room: this.snapshot(room, 2), roomId: id, guestToken: token });
    }

    if (!player) return failure('This race is unavailable.');
    player.lastSeen = Date.now();

    if (action === 'rematch') {
      if (!['finished', 'cancelled', 'expired'].includes(room.status)) return failure('Finish this race before starting another.');

      if (room.players.length < 2) return failure('Nobody joined this race, so there is no one to race again.');
      // As race_action: once the next room is open, asking moves this seat to it.
      const open = this.rooms.get(room.rematchId);

      if (open && ['waiting', 'countdown', 'racing'].includes(open.status)) {
        open.players.find((p) => p.slot === player.slot).lastSeen = Date.now();

        return reply(200, { room: this.snapshot(open, player.slot), roomId: open.id, guestToken: player.guestToken });
      }

      if (open) for (const p of room.players) p.rematch = false;

      if (typeof (data.want ?? true) !== 'boolean') return failure('Invalid rematch choice.');
      const other = room.players.find((p) => p.slot !== player.slot);

      if (data.want === false) player.rematch = false;
      else {
        if (other.left) return failure(`${other.name} has left this race.`);
        Object.assign(player, { rematch: true, left: false });

        if (other.rematch) {
          // Both picked: the next room opens for the same seats, already counting down.
          const next = {
            id: randomUUID(), passage: data.passage, conditions: data.conditions, duration: data.conditions?.duration ?? 60,
            status: 'countdown', startAt: new Date(Date.now() + 5000).toISOString(), createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
            invitedUser: other.userId || null, inviteKind: room.inviteKind, inviteToken: null, rematchOf: room.id,
            players: room.players.map((p) => ({ ...this.player(p.slot, p.name, p.userId, p.guestToken), ready: true })),
          };

          this.rooms.set(next.id, next);
          room.rematchId = next.id;
        }
      }

      return reply(200, { room: this.snapshot(room, player.slot), roomId: room.id, guestToken: player.guestToken });
    }

    if (action === 'traces') {
      if (room.status !== 'finished') return failure('This race has not finished.');

      return reply(200, { traces: room.players.map(({ slot, trace }) => ({ slot, trace })).sort((a, b) => a.slot - b.slot) });
    }

    if (action === 'befriend') {
      const other = room.players.find((p) => p.slot !== player.slot);

      if (!caller) return failure('Sign in to keep a friend list.');

      if (!other?.userId) return failure('Only racers with an account can be added as friends.');
      const list = this.friends.get(caller) || [];
      const existing = list.find((f) => f.friendId === other.userId);

      if (existing) existing.name = other.name;
      else list.push({ id: randomUUID(), friendId: other.userId, name: other.name });
      this.friends.set(caller, list);

      return reply(200, this.friendList(caller));
    }

    if (action === 'leave') {
      // A closed race marks the seat as left, which ends the other's rematch choice.
      if (['finished', 'cancelled', 'expired'].includes(room.status)) Object.assign(player, { left: true, rematch: false });
      else room.status = 'cancelled';

      return reply(200, this.snapshot(room, player.slot));
    }

    if (action === 'ready' && room.status === 'waiting') {
      player.ready = data.ready;

      if (room.players.length === 2 && room.players.every((p) => p.ready)) {
        room.startAt = new Date(Date.now() + 5000).toISOString();
        room.status = 'countdown';
      }
    }

    if (action === 'progress' && (room.status === 'finished' || player.finished)) this.keepTrace(room, player, data.trace);

    if (action === 'progress' && room.status === 'racing' && !player.finished && data.sequence > player.sequence) {
      // As race_action checks them: printable ASCII text, and counters that match it.
      const correct = [...data.typed].filter((char, i) => char === room.passage[i]).length;

      if (/[^ -~]/.test(data.typed) || data.typed.length > room.passage.length || data.keystrokes < data.typed.length
        || data.errors > data.keystrokes) return failure('Typing progress is outside the race limits.');

      if (data.errors < data.typed.length - correct || correct > data.keystrokes - data.errors) return failure('Typing counters do not match the submitted text.');
      player.sequence = data.sequence;
      player.typed = data.typed;
      player.progress = Math.round(correct / room.passage.length * 100);
      player.keystrokes = data.keystrokes;
      player.errors = data.errors;
      player.elapsed = Math.min(room.duration, Math.max(0.001, (Date.now() - Date.parse(room.startAt)) / 1000));
      player.wpm = Math.round(correct / 5 / (player.elapsed / 60));
      player.accuracy = data.keystrokes ? Math.round((data.keystrokes - data.errors) / data.keystrokes * 100) : 100;
      player.correct = correct;
      player.finished = Boolean(data.finished && data.typed === room.passage) || player.elapsed >= room.duration;

      if (player.finished) this.keepTrace(room, player, data.trace);

      if (room.players.every((p) => p.finished)) {
        room.status = 'finished';
        this.settle(room);
      }
    }

    return reply(200, this.snapshot(room, player.slot));
  }
}
