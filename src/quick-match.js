// Quick match: a signed-in player waits for another at a close race rating, and the service turns the
// pair into an ordinary two-player race room on the standard setup. The service pairs, checks the traces
// and rates (supabase/migrations/20261110120000_quick_match.sql, docs/adr/0014-quick-match-and-race-rating.md).
// This module holds what the browser and the e2e fake share with it: the standard setup, the rating maths,
// the pairing gap, the trace check and the browser's queue states. Every number here has a twin in the
// migration, and tests/quick-match.test.js reads the migration to keep them equal.
import { raceConditions } from './race-options.js';
import { scoreTrace } from './ghost-race.js';

// The one setup every quick match races: 30 seconds of the 200 most common words, no punctuation or numbers,
// stop on error as every online race.
export const STANDARD = Object.freeze({ mode: 'time', duration: 30, punctuation: false, numbers: false, wordList: '200' });
export const quickConditions = () => raceConditions(STANDARD);

export const RATING = Object.freeze({ start: 1500, provisional: 10, newK: 40, settledK: 20 });

// Elo. K is 40 for an account's first ten rated races, so a new rating finds its level quickly, then 20.
export const kFactor = (races) => (races < RATING.provisional ? RATING.newK : RATING.settledK);
export const expectedScore = (mine, theirs) => 1 / (1 + 10 ** ((theirs - mine) / 400));

// Half away from zero, as Postgres rounds numeric, so a pair at the same K moves by equal and opposite amounts.
const roundHalfAway = (value) => Math.sign(value) * Math.round(Math.abs(value));

// [a's change, b's change] for one rated race. `a` and `b` are { rating, races }; outcome is a's.
export function ratingChanges(a, b, outcome) {
  const score = outcome === 'won' ? 1 : outcome === 'lost' ? 0 : 0.5;
  const expected = expectedScore(a.rating, b.rating);

  return [roundHalfAway(kFactor(a.races) * (score - expected)), roundHalfAway(kFactor(b.races) * ((1 - score) - (1 - expected)))];
}

export const provisional = (races) => races < RATING.provisional;

// The count and "provisional" stay on one line (no-break spaces), so a narrow screen never starts a line with
// "· provisional".
export function ratingLine(rating) {
  if (!rating || !Number.isSafeInteger(rating.rating) || !Number.isSafeInteger(rating.races)) return '';
  const count = `${rating.races} rated ${rating.races === 1 ? 'race' : 'races'}${provisional(rating.races) ? ' · provisional' : ''}`;

  return `Race rating ${rating.rating} · ${count.replaceAll(' ', '\u00a0')}`;
}

// What was wrong with a run that couldn’t be checked, as the results say it after "It" or "Yours".
const RUN_FAULTS = Object.freeze({
  'no-trace': 'arrived without its keystroke record',
  unreadable: 'had a keystroke record that couldn’t be read',
  times: 'had key times that don’t fit the race clock',
  intervals: 'had keys closer together than the check allows',
  'wrong-text': 'had a keystroke record that doesn’t match the passage',
  speed: 'was over the speed cap for rated races',
});

const LATE = 'your finish didn’t arrive before the race closed';
const OUTCOME_WORDS = Object.freeze({ won: 'win', lost: 'loss', tied: 'tie' });

const signed = (delta) => (delta < 0 ? `−${-delta}` : `+${delta}`);

// This seat's settled quick match, as the service keeps it: { rated, reason, outcome, after, delta, races }.
// The reason says why it ended the way it did: null when both runs were checked and the traces decided. The
// outcome is null when neither run was checked; a decided result that isn't rated is a repeat pairing.
export function ratingChangeLine(result, opponent = 'the other racer') {
  if (!result || typeof result !== 'object') return '';
  const { rated, reason, outcome } = result;

  if (!rated && outcome) return `Not rated: you and ${opponent} have raced each other too often today.`;

  if (!rated) {
    const yours = reason === 'unfinished' ? `${LATE[0].toUpperCase()}${LATE.slice(1)}.` : `Yours ${RUN_FAULTS[reason] || 'couldn’t be checked'}.`;

    return `Not rated: neither racer finished with a run that could be checked. ${yours}`;
  }

  const lead = {
    forfeit: outcome === 'won' ? `Rated win: ${opponent} left the race.` : 'Rated loss: you left the race.',
    'opponent-absent': `Rated win: ${opponent} didn’t finish.`,
    'opponent-unchecked': `Rated win: ${opponent}’s run couldn’t be checked.`,
    unfinished: `Rated loss: ${LATE}.`,
  }[reason] || (RUN_FAULTS[reason] ? `Rated loss: your run couldn’t be checked. It ${RUN_FAULTS[reason]}.` : `Rated ${OUTCOME_WORDS[outcome] || 'race'}.`);

  return `${lead} ${ratingLine({ rating: result.after, races: result.races })} (${signed(result.delta)})`;
}

// Pairing. Two players pair when their ratings are within the gap for the longer of their two waits: 100 at
// once, widening by 10 for every second waited. A player not heard from for 10 seconds leaves the queue.
export const PAIRING = Object.freeze({ baseGap: 100, gapPerSecond: 10, staleMs: 10_000 });
export const acceptableGap = (waitMs) => PAIRING.baseGap + PAIRING.gapPerSecond * Math.floor(Math.max(0, waitMs) / 1000);

// Between the same two accounts only the first three rated results in any 24 hours move ratings.
export const REPEAT = Object.freeze({ rated: 3, windowMs: 24 * 3600_000 });

// The waiting player `me` pairs with: anyone in the gap but the racer either of the two last raced (`last`, the
// other racer of each one's latest quick match), then the closest rating, then the longest wait, then the id.
export function pickOpponent(queue, me, now) {
  const fits = queue.filter((other) => other.user !== me.user && now - other.seenAt <= PAIRING.staleMs
    && Math.abs(other.rating - me.rating) <= acceptableGap(Math.max(now - me.joinedAt, now - other.joinedAt)));

  const recent = (other) => Number(other.user === me.last || other.last === me.user);

  fits.sort((a, b) => recent(a) - recent(b) || Math.abs(a.rating - me.rating) - Math.abs(b.rating - me.rating) || a.joinedAt - b.joinedAt
    || (a.user < b.user ? -1 : 1));

  return fits[0] || null;
}

// How a settled quick match's result card reads a seat: its rated result when its run was checked, or unchecked.
// A run that couldn't be checked is never the winner.
export const cardOutcome = (player) => (player?.checked && player.outcome ? player.outcome : 'unchecked');

// The trace check: whether a finished run could be a person typing this passage. It is a floor, not
// anti-cheat. 20 keys in a row each under 20 ms after the one before is 600 wpm held for four words, which
// key rollover never sustains; 350 wpm is over what any person types for 30 seconds.
export const TRACE_CHECK = Object.freeze({ floorMs: 20, floorRun: 20, maxWpm: 350, maxKeys: 6000, maxEndMs: 600_000, maxStepMs: 999_999 });

// 'ok', or why the run can't be rated. `correct` is what the service settled for the racer.
export function traceCheck(trace, passage, { duration = null, correct }) {
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) return 'no-trace';
  const { k: keys, t: steps, e: end } = trace;

  if (trace.v !== 1 || typeof keys !== 'string' || !keys.length || keys.length > TRACE_CHECK.maxKeys || !/^[ -~\b]+$/.test(keys)
    || !Number.isInteger(end) || end < 0 || end > TRACE_CHECK.maxEndMs) return 'unreadable';

  if (!Array.isArray(steps) || steps.length !== keys.length
    || !steps.every((step) => Number.isInteger(step) && step >= 0 && step <= TRACE_CHECK.maxStepMs)
    || end < steps.reduce((sum, step) => sum + step, 0) || (duration && end !== duration * 1000)) return 'times';
  let run = 0;

  for (let i = 1; i < steps.length; i += 1) {
    run = steps[i] < TRACE_CHECK.floorMs ? run + 1 : 0;

    if (run >= TRACE_CHECK.floorRun) return 'intervals';
  }

  // The race service's own limit: no more than a hundred keys a second over the run.
  if (keys.length > Math.floor(end / 10) + 20) return 'intervals';
  const score = scoreTrace(trace, passage);

  if (score.correct !== correct) return 'wrong-text';

  return score.wpm > TRACE_CHECK.maxWpm ? 'speed' : 'ok';
}

// The browser's side of the queue, as states and the effects each event asks for. The view runs the
// effects: `send` goes through one chain, so this tab's queue requests reach the service in order, and a
// reply carries the ticket of the request it answers. A reply to anything but the current ticket is late
// and changes nothing, so a "paired" that lands after Stop never drops the person into a race; the Stop's
// own request, sent after it, calls the unstarted race off on the service.
//   idle ─press→ joining ─waiting→ waiting ─20 s→ lonely ─keep waiting→ waiting
//   joining | waiting | lonely ─paired→ paired ─entered→ idle
//   joining | waiting | lonely ─press, race best or leave→ idle
//   joining ─fails→ failed (or unavailable before the migration); press from either starts again.
export const LONELY_MS = 20_000;
export const POLL_MS = 1000;
export const QUEUE_IDLE = Object.freeze({ phase: 'idle', ticket: 0 });
const QUEUED = new Set(['joining', 'waiting', 'lonely']);
export const queued = (state) => QUEUED.has(state.phase);

export function queueStep(state, event) {
  const same = (next, effects = []) => ({ state: next, effects });
  const stop = (extra = []) => same({ phase: 'idle', ticket: state.ticket + 1 }, [{ send: 'unqueue', ticket: state.ticket + 1 }, ...extra]);

  switch (event.type) {
    case 'press':
      if (queued(state)) return stop();

      if (state.phase === 'paired') return same(state);

      return same({ phase: 'joining', ticket: state.ticket + 1 }, [{ send: 'queue', ticket: state.ticket + 1 }]);
    case 'leave':
      return queued(state) ? stop() : same(state);
    case 'race-best':
      return state.phase === 'lonely' ? stop([{ raceBest: true }]) : same(state);
    case 'keep-waiting':
      return state.phase === 'lonely' ? same({ ...state, phase: 'waiting', since: event.now }) : same(state);
    case 'tick':
      return state.phase === 'waiting' && event.now - state.since >= LONELY_MS ? same({ ...state, phase: 'lonely' }) : same(state);
    case 'entered':
      return state.phase === 'paired' ? same({ phase: 'idle', ticket: state.ticket }) : same(state);
    case 'reply': {
      if (event.ticket !== state.ticket || !queued(state)) return same(state);
      const { result } = event;

      if (result?.state === 'paired') return same({ phase: 'paired', ticket: state.ticket, roomId: result.roomId }, [{ enter: result }]);

      if (result?.state !== 'waiting') return same(state);
      const next = state.phase === 'joining' ? { phase: 'waiting', ticket: state.ticket, since: event.now } : state;

      return same(next, [{ poll: POLL_MS, ticket: state.ticket }]);
    }

    case 'fail':
      if (event.ticket !== state.ticket || !queued(state)) return same(state);

      if (event.unavailable) return same({ phase: 'unavailable', ticket: state.ticket, message: event.message });

      // A dropped poll while waiting keeps the place and tries again; a first request that fails says why.
      if (state.phase !== 'joining') return same(state, [{ poll: POLL_MS, ticket: state.ticket }]);

      return same({ phase: 'failed', ticket: state.ticket, message: event.message });
    default:
      return same(state);
  }
}
