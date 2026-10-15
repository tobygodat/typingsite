// Asynchronous ghost challenges: one finished run sent to a friend, who races it later against a
// ghost caret replaying the sender's keystrokes. The compact trace below is what the race service
// stores and scores (supabase/migrations/20261009100000_ghost_challenges.sql). The ghost is
// presentational; a challenge run is its own kind and never a best, a trend or training evidence.
import { request, freshSession, loadSession, AuthError } from './account.js';
import { METRIC_VERSION, quoteCorpus, replayAttempt, textId } from './typing.js';
import { wordListIds } from './words.js';
import { comparableKind } from './insights.js';

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

// A character outside printable ASCII never matches a challenge passage, so it is sent as an ASCII
// stand-in that differs from the letter expected there: the replay keeps the same length and errors.
const standIn = (expected) => (expected === '~' ? '^' : '~');
// An emoji or other astral character fills two places in the replay, which one key can't stand for.
const ASTRAL = /[\u{10000}-\u{10FFFF}]/u;

// {v, k, t, e}: k is one printable character per insertion and U+0008 per deletion, t the whole
// milliseconds since the previous key, e the end of the run. The clock starts at the first key.
// Blocked keys change nothing, so they are left out. A run that lost focus or used IME is not sent.
export function encodeTrace(attempt) {
  if (!attempt || attempt.interrupted || attempt.unsupportedInput) return null;
  const origin = attempt.startedAt ?? 0;
  const text = attempt.text || '';
  let keys = '';
  const steps = [];
  let last = 0;
  let typed = 0;
  for (const event of attempt.events || []) {
    if (event.type === 'focus-lost' || event.type === 'composition') return null;
    let chars;
    if (event.type === 'delete') chars = DELETE.repeat(Math.max(1, event.count || 1));
    else if (event.type === 'insert') {
      // The compact form has no way to say "counted but not kept", so such a run is not encoded.
      if (event.accepted === false || typeof event.text !== 'string' || !event.text || /[\r\n]/.test(event.text) || ASTRAL.test(event.text)) return null;
      chars = event.text;
    } else continue;
    const at = Math.max(last, Math.round(event.offsetMs - origin));
    for (const char of chars) {
      let key = char;
      if (event.type === 'delete') typed = Math.max(0, typed - 1);
      else {
        if (!/^[ -~]$/.test(char)) {
          if (char === text[typed]) return null;
          key = standIn(text[typed]);
        }
        if (typed < text.length) typed += 1;
      }
      keys += key;
      steps.push(at - last);
      last = at;
    }
  }
  if (!keys.length || keys.length > MAX_TRACE_KEYS) return null;
  const trace = { v: TRACE_VERSION, k: keys, t: steps, e: Math.max(last, Math.round((attempt.endedAt ?? last) - origin)) };
  return traceBytes(trace) <= MAX_TRACE_BYTES ? trace : null;
}

// Why a finished, uninterrupted run has no trace: a character it can't stand in for, or its size.
export const traceTrouble = (attempt) => ((attempt?.events || []).some((event) => event.type === 'insert' && ASTRAL.test(event.text || ''))
  ? 'character' : 'length');

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

// Every test condition a challenge may carry, with the values this app sends and can set up again. The
// service refuses any other (supabase/migrations/20261009100000_ghost_challenges.sql); a received row is
// still checked here, since its conditions come from another browser and are copied into this one's run.
const oneOf = (...values) => (value) => values.includes(value);
const orNull = (rule) => (value) => value === null || rule(value);
const isBoolean = (value) => typeof value === 'boolean';
const CONDITION_RULES = {
  mode: oneOf('time', 'words', 'quote'),
  // Checked against the challenge's own clock in challengeConditions.
  duration: orNull((value) => TIMED.includes(value)),
  count: orNull((value) => Number.isInteger(value) && value >= 1 && value <= 1000),
  punctuation: isBoolean,
  numbers: isBoolean,
  quoteLength: orNull(oneOf('any', 'short', 'medium', 'long')),
  difficulty: orNull(oneOf('any', 'gentle', 'steady', 'precise')),
  wordList: orNull(oneOf(...wordListIds)),
  inputClass: oneOf('physical-keyboard', 'touch'),
  correctionPolicy: oneOf('mandatory', 'relaxed'),
  language: oneOf('en'),
  corpus: (value) => typeof value === 'string' && value.length <= 40 && /^[a-z0-9]+(-[a-z0-9]+)*-v\d{1,3}$/.test(value),
  // Every score here is metric v1, so a run claiming another metric can't be compared.
  metricVersion: oneOf(METRIC_VERSION),
  textId: (value) => typeof value === 'string' && /^[ -~]{1,120}$/.test(value),
  sourceKind: oneOf(...SENDABLE_KINDS),
};

// A challenge's conditions as this app can race them, or null when they can't be: a key it doesn't know
// or a value it doesn't send means the run can't be set up the same way, so it is refused, not guessed.
// A timed run says so, on the challenge's own clock (`duration`); any other run has no clock.
export function challengeConditions(conditions, duration = null) {
  if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) return null;
  if (duration !== null && !TIMED.includes(duration)) return null;
  const known = Object.entries(conditions).every(([key, value]) => Object.hasOwn(CONDITION_RULES, key) && CONDITION_RULES[key](value));
  if (!known || (conditions.mode === 'time') !== (duration !== null) || (conditions.duration ?? null) !== duration) return null;
  return { ...conditions };
}

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

// The payload for one finished run, or null when it cannot be sent. A run that is never compared (custom
// text, or any other non-comparable kind) is never a ghost to race, whatever SENDABLE_KINDS says.
export function challengePayload(attempt) {
  if (!attempt || attempt.status !== 'complete' || attempt.interrupted || !comparableKind(attempt.kind)
    || !SENDABLE_KINDS.includes(attempt.kind)) return null;
  const trace = encodeTrace(attempt);
  if (!trace) return null;
  const passage = challengeText(attempt);
  if (passage.length < 10 || passage.length > MAX_CHALLENGE_TEXT || !/^[ -~]+$/.test(passage)) return null;
  const duration = challengeDuration(attempt.conditions);
  // Only conditions the service accepts and a friend's app can set up again.
  const source = { ...attempt.conditions, textId: attempt.textId, sourceKind: attempt.kind };
  if (source.strictSpace === false) delete source.strictSpace;
  if (source.quickEnd === true) delete source.quickEnd;
  if (source.layout === 'qwerty') delete source.layout;
  const conditions = challengeConditions(source, duration);
  if (!conditions) return null;
  const relaxed = attempt.conditions?.correctionPolicy === 'relaxed';
  const score = scoreTrace(trace, passage, { relaxed });
  if (!duration && !score.finished) return null;
  if (duration && trace.e !== duration * 1000) return null;
  return { passage, duration, conditions, trace, score };
}

export function describeShape(conditions = {}, duration = null) {
  if (conditions.sourceKind === 'daily') return 'daily';
  if (duration) return `${duration}-second`;
  if (conditions.mode === 'words' && conditions.count) return `${conditions.count}-word`;
  return 'quote';
}

// The id the recipient files the passage under, worked out from the text itself. The sender's own
// id is never trusted, so a ghost race can't mark other text as seen or file a quote under a new id.
export function challengeTextId(passage, conditions = {}) {
  const quote = quoteCorpus.find((item) => item.text === passage);
  if (quote) return quote.id;
  return conditions?.sourceKind === 'daily' ? `daily-${textId(passage)}` : textId(passage);
}

// Who led: more correct characters kept per minute. On a timed race both clocks match, so that is the
// text kept; under stop on error both runs end on the exact text, so it is the earlier finish; under
// continue on error a quick finish full of mistakes doesn't beat a clean one.
export function challengeOutcome({ sender, result }) {
  if (!sender || !result) return null;
  const pace = (score) => (score.elapsedMs > 0 ? score.correct / score.elapsedMs : 0);
  const lead = pace(result) - pace(sender);
  return lead > 0 ? 'recipient' : lead < 0 ? 'sender' : 'tie';
}

// How the leader led, in words true of this race: a passage leader who also ended sooner finished
// first; one who ended later kept more correct text per minute.
export function leadVerb({ duration, sender, result }, leader) {
  if (duration) return 'typed further';
  const [lead, other] = leader === 'recipient' ? [result, sender] : [sender, result];
  return lead.elapsedMs < other.elapsedMs ? 'finished first' : 'typed faster';
}

export function outcomeRule({ duration, conditions }) {
  if (duration) return `Same ${duration} s clock: more correct text kept leads.`;
  return conditions?.correctionPolicy === 'relaxed' ? 'More correct characters per minute leads.' : 'The earlier finish leads.';
}

// "25-word " for a listed challenge, or nothing when its conditions can't be read: no shape is claimed then.
function shapeOf(challenge) {
  const conditions = challengeConditions(challenge.conditions, challenge.duration ?? null);
  return conditions ? `${describeShape(conditions, challenge.duration)} ` : '';
}

export function offerText(challenge) {
  return `${challenge.name} challenged you to beat their ${shapeOf(challenge)}run.`;
}

// "Lin raced your 25-word run: Lin finished first · you 72 wpm, Lin 65 wpm."
export function resultText(challenge) {
  const leader = challengeOutcome(challenge);
  if (!leader) return '';
  const shape = shapeOf(challenge);
  const self = challenge.role === 'received' ? 'recipient' : 'sender';
  const them = challenge.name;
  const mine = self === 'recipient' ? challenge.result.wpm : challenge.sender.wpm;
  const theirs = self === 'recipient' ? challenge.sender.wpm : challenge.result.wpm;
  const verb = leader === 'tie' ? '' : leadVerb(challenge, leader);
  const who = leader === 'tie' ? 'a tie' : leader === self ? `you ${verb}` : `${them} ${verb}`;
  const subject = self === 'recipient' ? `${them}’s ${shape}run` : `${them} raced your ${shape}run`;
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
// `requestId` is made once per run and friend and repeated on a retry, so a send whose reply was
// lost is stored once; finishing again likewise returns the result already stored.
export function sendChallenge(session, { friendId, displayName, payload, requestId }) {
  return call(session, 'send', null, { requestId, friendId, displayName: displayName.trim(), passage: payload.passage,
    duration: payload.duration, conditions: payload.conditions, trace: payload.trace });
}

// Whether two scores of a ghost race are the same run's.
export const sameScore = (a, b) => Boolean(a && b) && ['wpm', 'accuracy', 'elapsedMs', 'correct'].every((key) => a[key] === b[key]);
