// Asynchronous ghost challenges: one finished run sent to a friend, who races it later against a
// ghost caret replaying the sender's keystrokes. The compact trace below is what the race service
// stores and scores (supabase/migrations/20261009100000_ghost_challenges.sql). The ghost is
// presentational; a challenge run is its own kind and never a best, a trend or training evidence.
import { request, freshSession, loadSession, AuthError } from './account.js';
import { replayAttempt } from './typing.js';

export const TRACE_VERSION = 1;
export const MAX_TRACE_KEYS = 6000;
// The service measures its JSON text, which spaces every array item.
export const MAX_TRACE_BYTES = 65536;
export const MAX_CHALLENGE_TEXT = 4000;
export const CHALLENGE_DAYS = 7;
// Runs a challenge can be made from. Drills are exercises; a ghost race is already a reply.
export const SENDABLE_KINDS = ['test', 'retest', 'daily'];
const DELETE = '\b';
const TIMED = [15, 30, 60, 120];
// A timed challenge keeps enough text for someone typing 400 wpm for the whole clock.
const CHARS_PER_SECOND = 400 * 5 / 60;

// {v, k, t, e}: k is one printable character per insertion and U+0008 per deletion, t the whole
// milliseconds since the previous key, e the end of the run. The clock starts at the first key.
// Blocked keys change nothing, so they are left out. A run that lost focus or used IME is not sent.
export function encodeTrace(attempt) {
  if (!attempt || attempt.interrupted || attempt.unsupportedInput) return null;
  const origin = attempt.startedAt ?? 0;
  let keys = '';
  const steps = [];
  let last = 0;
  for (const event of attempt.events || []) {
    if (event.type === 'focus-lost' || event.type === 'composition') return null;
    let chars;
    if (event.type === 'delete') chars = DELETE.repeat(Math.max(1, event.count || 1));
    else if (event.type === 'insert') {
      // The compact form has no way to say "counted but not kept", so such a run is not encoded.
      if (event.accepted === false || typeof event.text !== 'string' || !/^[ -~]+$/.test(event.text)) return null;
      chars = event.text;
    } else continue;
    const at = Math.max(last, Math.round(event.offsetMs - origin));
    for (const char of chars) {
      keys += char;
      steps.push(at - last);
      last = at;
    }
  }
  if (!keys.length || keys.length > MAX_TRACE_KEYS) return null;
  const trace = { v: TRACE_VERSION, k: keys, t: steps, e: Math.max(last, Math.round((attempt.endedAt ?? last) - origin)) };
  return traceBytes(trace) <= MAX_TRACE_BYTES ? trace : null;
}

export function traceBytes(trace) {
  return JSON.stringify(trace).length + trace.t.length + 8;
}

export function validTrace(trace) {
  return Boolean(trace) && trace.v === TRACE_VERSION && typeof trace.k === 'string' && trace.k.length > 0
    && trace.k.length <= MAX_TRACE_KEYS && /^[ -~\b]+$/.test(trace.k) && Array.isArray(trace.t)
    && trace.t.length === trace.k.length && trace.t.every((step) => Number.isInteger(step) && step >= 0)
    && Number.isInteger(trace.e) && trace.e >= trace.t.reduce((sum, step) => sum + step, 0);
}

// The trace as an attempt the shared replay can score: exactly what the service computes.
export function traceAttempt(trace, text) {
  const events = [];
  let at = 0;
  [...trace.k].forEach((key, index) => {
    at += trace.t[index];
    events.push(key === DELETE ? { type: 'delete', count: 1, offsetMs: at } : { type: 'insert', text: key, accepted: true, offsetMs: at });
  });
  return { text, events, startedAt: 0, endedAt: trace.e, conditions: {} };
}

export function scoreTrace(trace, text, { relaxed = false } = {}) {
  const replay = replayAttempt(traceAttempt(trace, text));
  const correct = [...replay.typed].filter((char, index) => char === text[index]).length;
  return {
    wpm: replay.score.wpm,
    accuracy: replay.score.accuracy,
    elapsedMs: replay.elapsedMs,
    correct,
    finished: replay.typed.length === text.length && (relaxed || replay.typed === text),
  };
}

// Where the sender's caret was after each key: [ms from the first key, characters typed].
export function ghostPoints(trace, textLength) {
  const points = [];
  let at = 0;
  let typed = 0;
  [...trace.k].forEach((key, index) => {
    at += trace.t[index];
    if (key === DELETE) typed = Math.max(0, typed - 1);
    else if (typed < textLength) typed += 1;
    points.push([at, typed]);
  });
  return points;
}

export const challengeDuration = (conditions = {}) => conditions.mode === 'time' && TIMED.includes(conditions.duration) ? conditions.duration : null;

function furthestTyped(attempt) {
  let typed = 0;
  let furthest = 0;
  for (const event of attempt.events || []) {
    if (event.type === 'delete') typed = Math.max(0, typed - Math.max(1, event.count || 1));
    else if (event.type === 'insert' && event.accepted !== false) typed = Math.min(attempt.text.length, typed + event.text.length);
    furthest = Math.max(furthest, typed);
  }
  return furthest;
}

// A word or quote run sends its whole passage. A timed run's passage is far longer than anyone
// types, so it is cut at a word boundary past the sender's furthest point, with room to spare.
export function challengeText(attempt) {
  const duration = challengeDuration(attempt.conditions);
  if (!duration) return attempt.text;
  const limit = Math.max(furthestTyped(attempt), Math.min(Math.ceil(duration * CHARS_PER_SECOND), MAX_CHALLENGE_TEXT - 50));
  const end = attempt.text.indexOf(' ', limit);
  return end < 0 ? attempt.text : attempt.text.slice(0, end);
}

// The payload for one finished run, or null when it cannot be sent.
export function challengePayload(attempt) {
  if (!attempt || attempt.status !== 'complete' || attempt.interrupted || !SENDABLE_KINDS.includes(attempt.kind)) return null;
  const trace = encodeTrace(attempt);
  if (!trace) return null;
  const passage = challengeText(attempt);
  if (passage.length < 10 || passage.length > MAX_CHALLENGE_TEXT || !/^[ -~]+$/.test(passage)) return null;
  const duration = challengeDuration(attempt.conditions);
  const relaxed = attempt.conditions?.correctionPolicy === 'relaxed';
  const score = scoreTrace(trace, passage, { relaxed });
  if (!duration && !score.finished) return null;
  if (duration && trace.e !== duration * 1000) return null;
  return {
    passage,
    duration,
    conditions: { ...attempt.conditions, textId: attempt.textId, sourceKind: attempt.kind },
    trace,
    score,
  };
}

export function describeShape(conditions = {}, duration = null) {
  if (conditions.sourceKind === 'daily') return 'daily';
  if (duration) return `${duration}-second`;
  if (conditions.mode === 'words' && conditions.count) return `${conditions.count}-word`;
  return 'quote';
}

// Who led: a timed race by the correct characters kept on the same clock, a passage by its finish.
export function challengeOutcome({ duration, sender, result }) {
  if (!sender || !result) return null;
  const lead = duration ? result.correct - sender.correct : sender.elapsedMs - result.elapsedMs;
  return lead > 0 ? 'recipient' : lead < 0 ? 'sender' : 'tie';
}

export function offerText(challenge) {
  return `${challenge.name} challenged you to beat their ${describeShape(challenge.conditions, challenge.duration)} run.`;
}

// "Lin raced your 25-word run: Lin finished first · you 72 wpm, Lin 65 wpm."
export function resultText(challenge) {
  const leader = challengeOutcome(challenge);
  if (!leader) return '';
  const shape = describeShape(challenge.conditions, challenge.duration);
  const self = challenge.role === 'received' ? 'recipient' : 'sender';
  const them = challenge.name;
  const mine = self === 'recipient' ? challenge.result.wpm : challenge.sender.wpm;
  const theirs = self === 'recipient' ? challenge.sender.wpm : challenge.result.wpm;
  const verb = challenge.duration ? 'typed further' : 'finished first';
  const who = leader === 'tie' ? 'a tie' : leader === self ? `you ${verb}` : `${them} ${verb}`;
  const subject = self === 'recipient' ? `${them}’s ${shape} run` : `${them} raced your ${shape} run`;
  return `${subject}: ${who} · you ${mine} wpm, ${them} ${theirs} wpm.`;
}

async function call(session, action, id = null, data = {}) {
  if (!session?.user?.id) throw new AuthError('Sign in to send or race a ghost challenge.');
  // A background poll may have rotated the refresh token; the newest stored session wins.
  const stored = loadSession();
  const active = await freshSession(stored?.user?.id === session.user.id ? stored : session);
  try {
    return await request('/rest/v1/rpc/challenge_action', {
      method: 'POST', token: active?.access_token, body: { p_action: action, p_id: id, p_data: data },
    });
  } catch (error) {
    if (error.status === 404 || /schema cache|could not find.*function/i.test(error.message)) {
      throw new AuthError('Ghost races are being set up. Please try again shortly.');
    }
    throw error;
  }
}

export const listChallenges = (session) => session ? call(session, 'list') : Promise.resolve([]);
export const getChallenge = (session, id) => call(session, 'get', id);
export const finishChallenge = (session, id, trace) => call(session, 'finish', id, { trace });
export function sendChallenge(session, { friendId, displayName, payload }) {
  return call(session, 'send', null, { friendId, displayName: displayName.trim(), passage: payload.passage,
    duration: payload.duration, conditions: payload.conditions, trace: payload.trace });
}
