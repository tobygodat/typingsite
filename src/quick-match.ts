function validSteps(value: unknown): value is number[] { return Array.isArray(value) && value.every((step: unknown) => typeof step === 'number' && Number.isInteger(step) && step >= 0 && step <= TRACE_CHECK.maxStepMs); }

import { at as indexed, isRecord } from './domain-values.js';
import type { RaceOptions } from './race-options.js';

export interface Rating { rating: number; races: number }

export interface Rank { index: number; name: string; step: string | null }

export interface RatedResult { rated: boolean; reason: string | null; outcome: 'won' | 'lost' | 'tied' | null; after: number; delta: number; races: number }

interface RatingStep { label: string; lo: number; hi: number; next: string | null }

export interface QueuePlayer { user: string; rating: number; seenAt: number; joinedAt: number; last?: string | null }

export type QueueState = { phase: 'idle' | 'joining'; ticket: number } | { phase: 'waiting' | 'lonely'; ticket: number; since: number } | { phase: 'paired'; ticket: number; roomId: string } | { phase: 'failed' | 'unavailable'; ticket: number; message: string };

export type QueueReply = { state: 'paired'; roomId: string; seat?: number; token?: string } | { state: 'waiting' };

export type QueueEvent = { type: 'press' | 'leave' | 'race-best' | 'entered' } | { type: 'keep-waiting' | 'tick'; now: number } | { type: 'reply'; ticket: number; result?: QueueReply; now: number } | { type: 'fail'; ticket: number; unavailable?: boolean; message: string };

export type QueueEffect = { send: 'queue' | 'unqueue'; ticket: number } | { raceBest: true } | { poll: number; ticket: number } | { enter: Extract<QueueReply, { state: 'paired' }> };

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
export const STANDARD = Object.freeze<RaceOptions>({ mode: 'time', duration: 30, punctuation: false, numbers: false, wordList: '200' });
export const quickConditions = () => raceConditions(STANDARD);

export const RATING = Object.freeze({ start: 1500, provisional: 10, newK: 40, settledK: 20 });

// Elo. K is 40 for an account's first ten rated races, so a new rating finds its level quickly, then 20.
export const kFactor = (races: number) => (races < RATING.provisional ? RATING.newK : RATING.settledK);
export const expectedScore = (mine: number, theirs: number) => 1 / (1 + 10 ** ((theirs - mine) / 400));

// Half away from zero, as Postgres rounds numeric, so a pair at the same K moves by equal and opposite amounts.
const roundHalfAway = (value: number) => Math.sign(value) * Math.round(Math.abs(value));

// [a's change, b's change] for one rated race. `a` and `b` are { rating, races }; outcome is a's.
export function ratingChanges(a: Rating, b: Rating, outcome: string) {
  const score = outcome === 'won' ? 1 : outcome === 'lost' ? 0 : 0.5;
  const expected = expectedScore(a.rating, b.rating);

  return [roundHalfAway(kFactor(a.races) * (score - expected)), roundHalfAway(kFactor(b.races) * ((1 - score) - (1 - expected)))];
}

export const provisional = (races: number) => races < RATING.provisional;

// The race rank, read from a settled rating and never stored (docs/adr/0016-race-rank.md). Whisper is under the
// floor and Hurricane from the top; each rank between spans perRank points in three perStep steps, III lowest.
export const RANKS = Object.freeze({
  names: Object.freeze(['Whisper', 'Breeze', 'Gust', 'Gale', 'Tempest', 'Hurricane']),
  steps: Object.freeze(['III', 'II', 'I']),
  floor: 1200,
  perRank: 300,
  perStep: 100,
});

const validRating = (rating: unknown): rating is Rating => isRecord(rating) && Number.isSafeInteger(rating.rating) && Number.isSafeInteger(rating.races);

// { index, name, step } for a rating with at least ten rated races, or null while it is provisional.
export function rankOf(rating: unknown) {
  if (!validRating(rating) || provisional(rating.races)) return null;
  const above = rating.rating - RANKS.floor;
  const index = Math.min(RANKS.names.length - 1, Math.max(0, Math.floor(above / RANKS.perRank) + 1));
  const stepped = index > 0 && index < RANKS.names.length - 1;

  return { index, name: indexed(RANKS.names, index), step: stepped ? indexed(RANKS.steps, Math.floor((above % RANKS.perRank) / RANKS.perStep)) : null };
}

export const rankLabel = (rank: Rank | null) => (rank ? [rank.name, rank.step].filter(Boolean).join(' ') : '');

// No-break spaces keep "Gale II" and the count whole, so a narrow screen never starts a line with "II" or
// "· provisional".
const unbroken = (text: string) => text.replaceAll(' ', '\u00a0');

export function ratingLine(rating: unknown) {
  if (!validRating(rating)) return '';
  const rank = rankOf(rating);
  const count = `${rating.races} rated ${rating.races === 1 ? 'race' : 'races'}${rank ? '' : ' · provisional'}`;

  return rank ? `${unbroken(rankLabel(rank))} · ${rating.rating} · ${unbroken(count)}` : `Race rating ${rating.rating} · ${unbroken(count)}`;
}

// What was wrong with a run that couldn’t be checked, as the results say it after "It" or "Yours".
const RUN_FAULTS: Readonly<Record<string, string>> = Object.freeze({
  'no-trace': 'arrived without its keystroke record',
  unreadable: 'had a keystroke record that couldn’t be read',
  times: 'had key times that don’t fit the race clock',
  intervals: 'had keys closer together than the check allows',
  'wrong-text': 'had a keystroke record that doesn’t match the passage',
  speed: 'was over the speed cap for rated races',
});

const LATE = 'your finish didn’t arrive before the race closed';
const OUTCOME_WORDS = Object.freeze({ won: 'win', lost: 'loss', tied: 'tie' });

export const signed = (delta: number) => (delta < 0 ? `−${-delta}` : `+${delta}`);

// The 100-point step a ranked rating sits in, as the result card's bar draws it: its label, its span and the
// line above it. Whisper has no steps, so its bar runs from WHISPER_BAR up to the floor; Hurricane has no line
// above it, so its bar is always full.
export const WHISPER_BAR = 900;
const TOP = RANKS.floor + (RANKS.names.length - 2) * RANKS.perRank;

function stepOf(rating: Rating) {
  const rank = rankOf(rating);
  const label = rankLabel(rank);

  if (!rank) throw new Error('Ranked bar requires a settled rating');

  if (rank.index === RANKS.names.length - 1) return { label, lo: TOP, hi: TOP, next: null };
  const lo = rank.index === 0 ? WHISPER_BAR : RANKS.floor + (rank.index - 1) * RANKS.perRank + RANKS.steps.indexOf(rank.step ?? '') * RANKS.perStep;
  const hi = rank.index === 0 ? RANKS.floor : lo + RANKS.perStep;

  return { label, lo, hi, next: rankLabel(rankOf({ rating: hi, races: rating.races })) };
}

const along = (rating: number, step: RatingStep) => (step.hi === step.lo ? 1 : Math.min(1, Math.max(0, (rating - step.lo) / (step.hi - step.lo))));

// One stage of the bar: the step it draws, where the fill starts and ends as fractions of it, and how far the
// rating it settles on is from the next line.
const barOf = (step: RatingStep, from: number, to: number, rating: number) => ({ rankLabel: step.label, from, to, next: step.next, toNext: step.next ? step.hi - rating : null });

// One bar within a step. A move to another step plays in two: the old step fills to its end (or empties to its
// start), then the new step opens from empty (or from full).
function barsOf(before: Rating, after: Rating, moved: 'promoted' | 'demoted' | null) {
  const step = stepOf(after);

  if (!moved) return [barOf(step, along(before.rating, step), along(after.rating, step), after.rating)];
  const old = stepOf(before);
  const up = moved === 'promoted';
  const opens = step.hi === step.lo || !up ? 1 : 0;

  return [barOf(old, along(before.rating, old), up ? 1 : 0, before.rating), barOf(step, opens, along(after.rating, step), after.rating)];
}

const capitalised = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

// Why a rated race ended as it did, when the traces didn't simply decide it, and the outcome word that goes with it.
function ratedLead({ reason, outcome }: RatedResult, opponent: string) {
  const leads: Record<string, [string, string]> = {
    forfeit: outcome === 'won' ? ['win', `${opponent} left the race.`] : ['loss', 'you left the race.'],
    'opponent-absent': ['win', `${opponent} didn’t finish.`],
    'opponent-unchecked': ['win', `${opponent}’s run couldn’t be checked.`],
    unfinished: ['loss', `${LATE}.`],
    left: ['loss', 'you left the race.'],
  };

  const lead = leads[reason ?? ''] || (RUN_FAULTS[reason ?? ''] ? ['loss', `your run couldn’t be checked. It ${RUN_FAULTS[reason ?? '']}.`] : [outcome ? OUTCOME_WORDS[outcome] : 'race', null]);

  return { outcome: `Rated ${lead[0]}`, why: lead[1] };
}

// This seat's settled quick match, as the service keeps it: { rated, reason, outcome, after, delta, races }.
// The reason says why it ended the way it did: null when both runs were checked and the traces decided. The
// outcome is null when neither run was checked; a decided result that isn't rated is a repeat pairing.
//
// What the result shows, as one model for the card, its motion and the sentence a screen reader hears:
// { kind: 'unrated', sentence } or { kind: 'provisional' | 'ranked', sentence, label, why, rating: { from, to },
// races, delta, tone, rank, was, moved, bars }. `rank` and `was` are the rank after and before (null while
// provisional), `moved` is 'promoted' or 'demoted' when the rank or step changed, and `bars` is the bar's stages.
export function ratingResult(result: RatedResult | null | undefined, opponent = 'the other racer') {
  if (!result || typeof result !== 'object') return null;
  const { rated, reason, outcome } = result;

  if (!rated && outcome) return { kind: 'unrated', sentence: `Not rated: you and ${opponent} have raced each other too often today.` };

  if (!rated) {
    const messages: Record<string, string> = { unfinished: `${capitalised(LATE)}.`, left: 'You left the race.' };

    const yours = messages[reason ?? '']
      || `Yours ${RUN_FAULTS[reason ?? ''] || 'couldn’t be checked'}.`;

    return { kind: 'unrated', sentence: `Not rated: neither racer finished with a run that could be checked. ${yours}` };
  }

  const lead = ratedLead(result, opponent);
  // `races` is the account's count after this race: a racer can't start another quick match until one settles.
  const after = { rating: result.after, races: result.races };
  const before = { rating: result.after - result.delta, races: result.races - 1 };
  const [was, rank] = [rankOf(before), rankOf(after)];
  // The race that ends the provisional period has no rank before it, so it moves nothing.
  const moved = was && rank && rankLabel(was) !== rankLabel(rank) ? (result.delta > 0 ? 'promoted' : 'demoted') : null;
  const move = moved ? `, ${moved === 'promoted' ? 'up' : 'down'} from ${unbroken(rankLabel(was))}.` : '';
  const named = (value: Rank | null) => value && { ...value, label: rankLabel(value) };

  return {
    kind: rank ? 'ranked' : 'provisional',
    sentence: `${lead.why ? `${lead.outcome}: ${lead.why}` : `${lead.outcome}.`} ${ratingLine(after)} (${signed(result.delta)})${move}`,
    label: moved === 'promoted' ? 'Rank up' : lead.outcome,
    why: lead.why && capitalised(lead.why),
    rating: { from: before.rating, to: after.rating },
    races: after.races,
    delta: result.delta,
    tone: result.delta > 0 ? 'up' : result.delta < 0 ? 'down' : 'even',
    rank: named(rank),
    was: named(was),
    moved,
    bars: rank ? barsOf(before, after, moved) : [],
  };
}

export const ratingChangeLine = (result: RatedResult | null | undefined, opponent?: string) => ratingResult(result, opponent)?.sentence || '';

// Pairing. Two players pair when their ratings are within the gap for the longer of their two waits: 100 at
// once, widening by 10 for every second waited. A player not heard from for 10 seconds leaves the queue.
export const PAIRING = Object.freeze({ baseGap: 100, gapPerSecond: 10, staleMs: 10_000 });
export const acceptableGap = (waitMs: number) => PAIRING.baseGap + PAIRING.gapPerSecond * Math.floor(Math.max(0, waitMs) / 1000);

// Between the same two accounts only the first three rated results in any 24 hours move ratings.
export const REPEAT = Object.freeze({ rated: 3, windowMs: 24 * 3600_000 });

// The waiting player `me` pairs with: anyone in the gap but the racer either of the two last raced (`last`, the
// other racer of each one's latest quick match), then the closest rating, then the longest wait, then the id.
export function pickOpponent(queue: QueuePlayer[], me: QueuePlayer, now: number) {
  const fits = queue.filter((other) => other.user !== me.user && now - other.seenAt <= PAIRING.staleMs
    && Math.abs(other.rating - me.rating) <= acceptableGap(Math.max(now - me.joinedAt, now - other.joinedAt)));

  const recent = (other: QueuePlayer) => Number(other.user === me.last || other.last === me.user);

  fits.sort((a, b) => recent(a) - recent(b) || Math.abs(a.rating - me.rating) - Math.abs(b.rating - me.rating) || a.joinedAt - b.joinedAt
    || (a.user < b.user ? -1 : 1));

  return fits[0] || null;
}

// How a settled quick match's result card reads a seat: its rated result when its run was checked, or unchecked.
// A run that couldn't be checked is never the winner.
export const cardOutcome = (player: { checked?: boolean; outcome?: string | null } | null | undefined) => (player?.checked && player.outcome ? player.outcome : 'unchecked');

// The trace check: whether a finished run could be a person typing this passage. It is a floor, not
// anti-cheat. 20 keys in a row each under 20 ms after the one before is 600 wpm held for four words, which
// key rollover never sustains; 350 wpm is over what any person types for 30 seconds.
export const TRACE_CHECK = Object.freeze({ floorMs: 20, floorRun: 20, maxWpm: 350, maxKeys: 6000, maxEndMs: 600_000, maxStepMs: 999_999 });

// 'ok', or why the run can't be rated. `correct` is what the service settled for the racer.
export function traceCheck(trace: unknown, passage: string, { duration = null, correct }: { duration?: number | null; correct: number }) {
  if (!isRecord(trace)) return 'no-trace';
  const { k: keys, t: steps, e: end } = trace;

  if (trace.v !== 1 || typeof keys !== 'string' || !keys.length || keys.length > TRACE_CHECK.maxKeys || !/^[ -~\b]+$/.test(keys)
    || typeof end !== 'number' || !Number.isInteger(end) || end < 0 || end > TRACE_CHECK.maxEndMs) return 'unreadable';

  if (!validSteps(steps) || steps.length !== keys.length
    || end < steps.reduce((sum, step) => sum + step, 0) || (duration && end !== duration * 1000)) return 'times';
  let run = 0;

  for (let i = 1; i < steps.length; i += 1) {
    run = indexed(steps, i) < TRACE_CHECK.floorMs ? run + 1 : 0;

    if (run >= TRACE_CHECK.floorRun) return 'intervals';
  }

  // The race service's own limit: no more than a hundred keys a second over the run.
  if (keys.length > Math.floor(end / 10) + 20) return 'intervals';
  const score = scoreTrace({ v: 1, k: keys, t: steps, e: end }, passage);

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
export const QUEUE_IDLE = Object.freeze<QueueState>({ phase: 'idle', ticket: 0 });
const QUEUED = new Set(['joining', 'waiting', 'lonely']);
export const queued = (state: QueueState) => QUEUED.has(state.phase);

export function queueStep(state: QueueState, event: QueueEvent) {
  const same = (next: QueueState, effects: QueueEffect[] = []) => ({ state: next, effects });
  const stop = (extra: QueueEffect[] = []) => same({ phase: 'idle', ticket: state.ticket + 1 }, [{ send: 'unqueue', ticket: state.ticket + 1 }, ...extra]);

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
      const next: QueueState = state.phase === 'joining' ? { phase: 'waiting', ticket: state.ticket, since: event.now } : state;

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
