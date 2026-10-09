// Ghost challenges for the fake Supabase, shared by independent browser contexts. It mirrors the
// rules of race_private.challenge_action (friend-only recipients, seven-day expiry, one reply, scores
// recomputed from each trace); supabase/tests/ghost-challenges.sql checks the real thing.
import { randomUUID } from 'node:crypto';
import { scoreTrace, validTrace } from '../src/ghost-race.js';

const DAY = 86400000;

export class FakeChallenges {
  constructor(auth) { this.auth = auth; this.rows = new Map(); }

  view(row, viewer) {
    const sent = row.senderId === viewer;
    return {
      id: row.id, role: sent ? 'sent' : 'received', name: sent ? row.recipientName : row.senderName,
      status: row.result ? 'done' : Date.now() >= Date.parse(row.expiresAt) ? 'expired' : 'open',
      conditions: row.conditions, duration: row.duration, sender: row.sender, result: row.result,
      createdAt: row.createdAt, expiresAt: row.expiresAt, completedAt: row.completedAt,
    };
  }

  score(passage, trace, duration, conditions) {
    if (!validTrace(trace)) throw new Error('That run could not be read.');
    if (duration && trace.e !== duration * 1000) throw new Error('That run is outside the challenge limits.');
    const { finished, ...score } = scoreTrace(trace, passage, { relaxed: conditions?.correctionPolicy === 'relaxed' });
    if (!duration && !finished) throw new Error('Finish the run before sending it.');
    return score;
  }

  // Adds a challenge directly, as if `sender` had sent it, for tests that start on the recipient.
  seed(sender, recipient, { name, label = 'Friend', passage, conditions = {}, duration = null, trace }) {
    const row = { id: randomUUID(), senderId: sender, recipientId: recipient, senderName: name, recipientName: label,
      passage, conditions, duration, trace, sender: this.score(passage, trace, duration, conditions), result: null,
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * DAY).toISOString(), completedAt: null };
    this.rows.set(row.id, row);
    return row;
  }

  handle(caller, { p_action: action, p_id: id, p_data: data = {} }, reply) {
    const failure = (message) => reply(400, { message });
    if (!caller) return reply(401, { message: 'permission denied for function challenge_action' });
    try {
      if (action === 'send') {
        const friend = (this.auth.races.friends.get(caller) || []).find((value) => value.id === data.friendId);
        if (!friend) return failure('That friend is no longer on your list.');
        const recipient = friend.friendId || [...this.auth.users.values()].find((user) => user.email === friend.email)?.id || null;
        const name = (data.displayName || '').trim();
        if (!name || name.length > 40) return failure('Use a name of 1 to 40 characters.');
        if (typeof data.passage !== 'string' || data.passage.length < 10 || data.passage.length > 4000 || /[^ -~]/.test(data.passage)) {
          return failure('This run’s text can’t be sent as a challenge.');
        }
        const row = this.seed(caller, recipient, { name, label: friend.name, passage: data.passage,
          conditions: data.conditions || {}, duration: data.duration || null, trace: data.trace });
        return reply(200, this.view(row, caller));
      }
      if (action === 'list') {
        return reply(200, [...this.rows.values()].filter((row) => row.senderId === caller || row.recipientId === caller)
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 50).map((row) => this.view(row, caller)));
      }
      const row = this.rows.get(id);
      if (action === 'get') {
        if (!row || (row.senderId !== caller && row.recipientId !== caller)) return failure('That ghost race is unavailable.');
        return reply(200, { ...this.view(row, caller), passage: row.passage, trace: row.trace });
      }
      if (action === 'finish') {
        if (!row || row.recipientId !== caller) return failure('That ghost race is unavailable.');
        if (row.result) return failure('You have already raced this run.');
        if (Date.now() >= Date.parse(row.expiresAt)) return failure('This ghost race expired before your run arrived.');
        row.result = this.score(row.passage, data.trace, row.duration, row.conditions);
        row.completedAt = new Date().toISOString();
        return reply(200, this.view(row, caller));
      }
      return failure('Unknown challenge action.');
    } catch (error) {
      return failure(error.message);
    }
  }
}
