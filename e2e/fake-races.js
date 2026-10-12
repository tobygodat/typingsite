// Shared by independent browser contexts. Production authorization/state is separately
// exercised against the migration; this adapter drives the real UI without network calls.
import { randomUUID } from 'node:crypto';

export class FakeRaces {
  constructor(auth) {
    this.auth = auth;
    this.rooms = new Map();
    this.friends = new Map();
    // As in FakeChallenges: with `held` set to an array, a successful reply to an action named in `holding`
    // waits until a test calls the release pushed onto it. The action itself is already done.
    this.held = null;
    this.holding = new Set();
  }

  friendList(owner) {
    return (this.friends.get(owner) || []).map(({ id, name, email, friendId }) => ({ id, name, account: Boolean(friendId), ...(email ? { email } : {}) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  rematchState(room) {
    const next = this.rooms.get(room.rematchId);
    return { rematchExpiresAt: next?.expiresAt || null,
      rematchOpen: Boolean(next) && next.status === 'waiting' && Date.now() < Date.parse(next.expiresAt) };
  }

  snapshot(room, slot) {
    const now = Date.now();
    if (now >= Date.parse(room.expiresAt) && !['finished', 'cancelled'].includes(room.status)) room.status = 'expired';
    if (room.status === 'countdown' && now >= Date.parse(room.startAt)) room.status = 'racing';
    if (room.status === 'racing' && (room.players.every((p) => p.finished) || now >= Date.parse(room.startAt) + room.duration * 1000)) room.status = 'finished';
    return {
      id: room.id, status: room.status, passage: room.passage, conditions: room.conditions,
      duration: room.duration, startAt: room.startAt, expiresAt: room.expiresAt,
      serverNow: new Date(now).toISOString(), selfSlot: slot, inviteKind: room.inviteKind,
      rematchOf: room.rematchOf || null, rematchId: room.rematchId || null, rematchSlot: room.rematchSlot || null,
      rematchBy: room.players.find((p) => p.slot === room.rematchSlot)?.name || null,
      ...this.rematchState(room),
      players: room.players.map(({ userId, guestToken, typed, sequence, keystrokes, errors, lastSeen, ...player }) => ({
        ...player, connected: now - lastSeen < 10000, account: Boolean(userId),
        friend: Boolean(userId) && (this.friends.get(room.players.find((p) => p.slot === slot)?.userId) || []).some((f) => f.friendId === userId),
        ...(player.slot === slot ? { typed, sequence, keystrokes, errors } : {}),
      })),
    };
  }

  player(slot, name, userId, guestToken) {
    return { slot, name, userId, guestToken, ready: false, progress: 0, finished: false, lastSeen: Date.now(),
      wpm: 0, accuracy: 100, elapsed: 0, sequence: 0, typed: '', keystrokes: 0, errors: 0 };
  }

  handle(caller, { p_action: action, p_room_id: id, p_data: data = {}, p_guest_token: guestToken }, send) {
    const reply = (status, json) => (status === 200 && this.held && this.holding.has(action)
      ? new Promise((release) => this.held.push(release)).then(() => send(status, json)) : send(status, json));
    const failure = (message) => reply(400, { message });
    if (action === 'invites') return reply(200, [...this.rooms.values()]
      .filter((room) => room.invitedUser === caller && caller && room.status === 'waiting' && Date.parse(room.expiresAt) > Date.now()
        && !room.players.some((p) => p.userId === caller && p.lastSeen > 0))
      .map((room) => ({ id: room.id, hostName: room.players.find((p) => p.userId !== caller).name, createdAt: room.createdAt,
        expiresAt: room.expiresAt, rematch: Boolean(room.rematchOf) })));
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
        id: randomUUID(), passage: data.passage, conditions: data.conditions, duration: 60,
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
      if (player) { player.lastSeen = Date.now(); return reply(200, { room: this.snapshot(room, player.slot), roomId: id, guestToken: player.guestToken }); }
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
      const open = this.rooms.get(room.rematchId);
      if (open && ['waiting', 'countdown', 'racing'].includes(open.status)) {
        open.players.find((p) => p.slot === player.slot).lastSeen = Date.now();
        return reply(200, { room: this.snapshot(open, player.slot), roomId: open.id, guestToken: player.guestToken });
      }
      const other = room.players.find((p) => p.slot !== player.slot);
      const next = {
        id: randomUUID(), passage: data.passage, conditions: data.conditions, duration: 60,
        status: 'waiting', startAt: null, createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
        invitedUser: other.userId || null, inviteKind: room.inviteKind, inviteToken: null, rematchOf: room.id,
        players: room.players.map((p) => ({ ...this.player(p.slot, p.name, p.userId, p.guestToken), lastSeen: p.slot === player.slot ? Date.now() : 0 })),
      };
      this.rooms.set(next.id, next);
      Object.assign(room, { rematchId: next.id, rematchSlot: player.slot });
      return reply(200, { room: this.snapshot(next, player.slot), roomId: next.id, guestToken: player.guestToken });
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
    if (action === 'leave') { room.status = 'cancelled'; return reply(200, this.snapshot(room, player.slot)); }
    if (action === 'ready' && room.status === 'waiting') {
      player.ready = data.ready;
      if (room.players.length === 2 && room.players.every((p) => p.ready)) {
        room.startAt = new Date(Date.now() + 5000).toISOString();
        room.status = 'countdown';
      }
    }
    if (action === 'progress' && room.status === 'racing' && !player.finished && data.sequence > player.sequence) {
      player.sequence = data.sequence;
      player.typed = data.typed;
      const correct = [...data.typed].filter((char, i) => char === room.passage[i]).length;
      player.progress = Math.round(correct / room.passage.length * 100);
      player.keystrokes = data.keystrokes;
      player.errors = data.errors;
      player.elapsed = Math.max(0.001, (Date.now() - Date.parse(room.startAt)) / 1000);
      player.wpm = Math.round(correct / 5 / (player.elapsed / 60));
      player.accuracy = data.keystrokes ? Math.round((data.keystrokes - data.errors) / data.keystrokes * 100) : 100;
      player.finished = Boolean(data.finished && data.typed === room.passage);
    }
    return reply(200, this.snapshot(room, player.slot));
  }
}
