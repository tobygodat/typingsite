// Ghost challenges for the fake Supabase, shared by independent browser contexts. It mirrors the
// rules of race_private.challenge_action (friend-only recipients, seven-day expiry, one reply, scores
// recomputed from each trace, a repeated send or finish answered with what is stored);
// supabase/tests/ghost-challenges.sql checks the real thing.
import { randomUUID } from 'node:crypto';
import { scoreTrace, validTrace } from '../src/ghost-race.js';

const DAY = 86400000;
// Rows listed beyond every open challenge and every result from the last week.
const HISTORY = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class FakeChallenges {
  constructor(auth) {
    this.auth = auth;
    this.rows = new Map();
    // With `held` set to an array, a send's reply waits until a test calls the release pushed onto it.
    this.held = null;
    // Each action named here once more does its write and then loses its reply, as when a connection
    // drops after the database commits.
    this.lost = new Set();
  }

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

  // Adds a challenge directly, as if `sender` had sent it, for tests that start on the recipient. An
  // earlier `createdAt` backdates it; `answered` gives it a reply an hour later, scored like the sender's.
  seed(sender, recipient, { name, label = 'Friend', passage, conditions = {}, duration = null, trace, createdAt = Date.now(), answered = false, requestId = randomUUID() }) {
    const sent = this.score(passage, trace, duration, conditions);
    const row = { id: randomUUID(), requestId, senderId: sender, recipientId: recipient, senderName: name, recipientName: label,
      passage, conditions, duration, trace, sender: sent, result: answered ? { ...sent } : null,
      createdAt: new Date(createdAt).toISOString(), expiresAt: new Date(createdAt + 7 * DAY).toISOString(),
      completedAt: answered ? new Date(createdAt + DAY / 24).toISOString() : null };
    this.rows.set(row.id, row);
    return row;
  }

  // As the service lists them: every open challenge (0), every result from the last week (1), then the
  // newest fifty others (2), newest first within each.
  list(caller) {
    const now = Date.now();
    const tier = (row) => (!row.result && now < Date.parse(row.expiresAt) ? 0 : row.result && now - Date.parse(row.completedAt) < 7 * DAY ? 1 : 2);
    let older = 0;
    return [...this.rows.values()].filter((row) => row.senderId === caller || row.recipientId === caller)
      .sort((a, b) => tier(a) - tier(b) || Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .filter((row) => tier(row) < 2 || ++older <= HISTORY).map((row) => this.view(row, caller));
  }

  handle(caller, { p_action: action, p_id: id, p_data: data = {} }, reply, drop) {
    const failure = (message) => reply(400, { message });
    // A write's reply, unless the test has it lost or held.
    const answer = (json) => {
      if (this.lost.delete(action)) return drop();
      if (action === 'send' && this.held) return new Promise((release) => this.held.push(release)).then(() => reply(200, json));
      return reply(200, json);
    };
    if (!caller) return reply(401, { message: 'permission denied for function challenge_action' });
    try {
      if (action === 'send') {
        if (typeof data.requestId !== 'string' || !UUID.test(data.requestId)) return failure('Invalid challenge request.');
        const repeat = [...this.rows.values()].find((row) => row.senderId === caller && row.requestId === data.requestId);
        if (repeat) return answer(this.view(repeat, caller));
        const friend = (this.auth.races.friends.get(caller) || []).find((value) => value.id === data.friendId);
        if (!friend) return failure('That friend is no longer on your list.');
        const recipient = friend.friendId || [...this.auth.users.values()].find((user) => user.email === friend.email)?.id || null;
        const name = (data.displayName || '').trim();
        if (!name || name.length > 40) return failure('Use a name of 1 to 40 characters.');
        if (typeof data.passage !== 'string' || data.passage.length < 10 || data.passage.length > 4000 || /[^ -~]/.test(data.passage)) {
          return failure('This run’s text can’t be sent as a challenge.');
        }
        const row = this.seed(caller, recipient, { name, label: friend.name, passage: data.passage,
          conditions: data.conditions || {}, duration: data.duration || null, trace: data.trace, requestId: data.requestId });
        return answer(this.view(row, caller));
      }
      if (action === 'list') return reply(200, this.list(caller));
      const row = this.rows.get(id);
      if (action === 'get') {
        if (!row || (row.senderId !== caller && row.recipientId !== caller)) return failure('That ghost race is unavailable.');
        return reply(200, { ...this.view(row, caller), passage: row.passage, trace: row.trace });
      }
      if (action === 'finish') {
        if (!row || row.recipientId !== caller) return failure('That ghost race is unavailable.');
        if (row.result) return answer(this.view(row, caller));
        if (Date.now() >= Date.parse(row.expiresAt)) return failure('This ghost race expired before your run arrived.');
        row.result = this.score(row.passage, data.trace, row.duration, row.conditions);
        row.completedAt = new Date().toISOString();
        return answer(this.view(row, caller));
      }
      return failure('Unknown challenge action.');
    } catch (error) {
      return failure(error.message);
    }
  }
}
