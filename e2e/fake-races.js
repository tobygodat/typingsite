// Shared by independent browser contexts. Production authorization/state is separately
// exercised against the migration; this adapter drives the real UI without network calls.
import { randomUUID } from 'node:crypto';

export class FakeRaces {
  constructor(auth) { this.auth = auth; this.rooms = new Map(); }

  snapshot(room, slot) {
    const now = Date.now();
    if (now >= Date.parse(room.expiresAt) && !['finished', 'cancelled'].includes(room.status)) room.status = 'expired';
    if (room.status === 'countdown' && now >= Date.parse(room.startAt)) room.status = 'racing';
    if (room.status === 'racing' && (room.players.every((p) => p.finished) || now >= Date.parse(room.startAt) + room.duration * 1000)) room.status = 'finished';
    return {
      id: room.id, status: room.status, passage: room.passage, conditions: room.conditions,
      duration: room.duration, startAt: room.startAt, expiresAt: room.expiresAt,
      serverNow: new Date(now).toISOString(), selfSlot: slot,
      players: room.players.map(({ userId, guestToken, typed, sequence, keystrokes, errors, ...player }) => ({
        ...player, ...(player.slot === slot ? { typed, sequence, keystrokes, errors } : {}),
      })),
    };
  }

  player(slot, name, userId, guestToken) {
    return { slot, name, userId, guestToken, ready: false, progress: 0, finished: false,
      wpm: 0, accuracy: 100, elapsed: 0, sequence: 0, typed: '', keystrokes: 0, errors: 0 };
  }

  handle(caller, { p_action: action, p_room_id: id, p_data: data = {}, p_guest_token: guestToken }, reply) {
    const failure = (message) => reply(400, { message });
    if (action === 'invites') return reply(200, [...this.rooms.values()]
      .filter((room) => room.invitedUser === caller && caller && room.status === 'waiting' && Date.parse(room.expiresAt) > Date.now())
      .map((room) => ({ id: room.id, hostName: room.players[0].name, createdAt: room.createdAt, expiresAt: room.expiresAt })));
    if (action === 'create') {
      if (!caller) return failure('Sign in to host a race.');
      const email = (data.inviteEmail || '').trim().toLowerCase();
      const room = {
        id: randomUUID(), passage: data.passage, conditions: data.conditions, duration: 60,
        status: 'waiting', startAt: null, createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
        invitedUser: email ? this.auth.users.get(email)?.id || 'unknown' : null,
        inviteToken: email ? null : randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
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
      if (player) return reply(200, { room: this.snapshot(room, player.slot), roomId: id, guestToken: player.guestToken });
      if (room.status !== 'waiting') return failure('This race is no longer accepting players.');
      if (room.invitedUser ? room.invitedUser !== caller : room.inviteToken !== data.inviteToken) return failure('This invite is unavailable.');
      if (room.players.length === 2) return failure('This race is full.');
      const token = caller ? null : data.guestToken || randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
      player = this.player(2, data.displayName, caller, token);
      room.players.push(player);
      return reply(200, { room: this.snapshot(room, 2), roomId: id, guestToken: token });
    }
    if (!player) return failure('This race is unavailable.');
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
