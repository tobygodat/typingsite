// Race your best: a run on the exact text of your best at these conditions, with a ghost caret that
// replays that run's recorded keystroke positions over time. Pure functions only. The ghost caret is
// drawn by src/motion.js and is never scored; the race result compares two replays of event logs.
import { conditionKey, replayAttempt } from './typing.js';

export const GHOST_RACE = 'ghost-race';

const hasInput = (trace) => (trace?.events || []).some((event) => event.type === 'insert');

// The best for these conditions, and its trace when the newest kept traces still hold it.
// reason: 'no-best' (nothing to race) or 'no-trace' (the best's keystrokes are no longer kept).
export function raceableBest(profile, key) {
  const best = key ? profile?.bests?.[key] : null;
  if (!best) return { available: false, reason: 'no-best', best: null, trace: null };
  const trace = (profile.attempts || []).find((attempt) => attempt.id === best.attemptId);
  if (!trace?.text || !hasInput(trace) || trace.status !== 'complete' || conditionKey(trace.conditions) !== key) {
    return { available: false, reason: 'no-trace', best, trace: null };
  }
  return { available: true, reason: null, best, trace };
}

// Where the best's caret stood after each keystroke, in ms from its first key. Mirrors replayAttempt:
// accepted inserts move it on, deletes move it back, and blocked or refused keys leave it in place.
export function ghostTrack(trace) {
  const events = trace?.events || [];
  const origin = trace?.startedAt ?? events.find((event) => event.type === 'insert')?.offsetMs ?? 0;
  const length = trace?.text?.length || 0;
  const points = [];
  let position = 0;
  for (const event of events) {
    if (event.type === 'delete') {
      position = Math.max(0, position - Math.max(1, event.count || 1));
    } else if (event.type === 'insert' && typeof event.text === 'string' && event.text && !/[\r\n]/u.test(event.text)) {
      for (const _char of event.text) {
        const at = Number.isInteger(event.position) ? event.position : position;
        if (at >= length) break;
        if (event.accepted !== false) position += 1;
      }
    } else continue;
    points.push({ t: Math.max(0, event.offsetMs - origin), position });
  }
  const last = points.at(-1)?.t ?? 0;
  return { points, endMs: Math.max(last, (trace?.endedAt ?? last) - origin) };
}

// The ghost's caret position at a moment of the race, counted from the racer's first key.
export function ghostPosition(track, ms) {
  let low = 0;
  let high = track.points.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (track.points[mid].t <= ms) { found = mid; low = mid + 1; } else high = mid - 1;
  }
  return found < 0 ? 0 : track.points[found].position;
}

// The race against the best, from both event logs. Interrupted races get no comparison, and a
// race on other conditions (touch against a keyboard best) is never compared.
export function raceOutcome(bestTrace, race) {
  if (!race || race.status !== 'complete' || race.interrupted) return null;
  if (!bestTrace || race.text !== bestTrace.text || conditionKey(race.conditions) !== conditionKey(bestTrace.conditions)) {
    return { comparable: false };
  }
  const best = bestTrace.summary || replayAttempt(bestTrace);
  const mine = race.summary || replayAttempt(race);
  const shared = {
    comparable: true,
    wpm: mine.score.wpm, bestWpm: best.score.wpm,
    accuracy: mine.score.accuracy, bestAccuracy: best.score.accuracy,
  };
  // A timed race ends on the same clock for both, so the gap is how far each caret got.
  if (race.conditions.mode === 'time') {
    return { ...shared, measure: 'distance', aheadChars: mine.typed.length - best.typed.length, durationS: race.conditions.duration };
  }
  // Otherwise both typed the whole passage, so the gap is time to the finish (0.1 s steps).
  return { ...shared, measure: 'time', aheadMs: Math.round((best.elapsedMs - mine.elapsedMs) / 100) * 100 };
}

export function raceHeadline(outcome) {
  if (!outcome) return 'Interrupted · not counted';
  if (!outcome.comparable) return 'Race complete · not compared';
  if (outcome.measure === 'distance') {
    const n = Math.abs(outcome.aheadChars);
    if (!n) return `Level with your best at ${outcome.durationS} s`;
    return `${n} ${n === 1 ? 'character' : 'characters'} ${outcome.aheadChars > 0 ? 'ahead of' : 'behind'} your best at ${outcome.durationS} s`;
  }
  if (!outcome.aheadMs) return 'Finished level with your best';
  return `Finished ${(Math.abs(outcome.aheadMs) / 1000).toFixed(1)} s ${outcome.aheadMs > 0 ? 'ahead of' : 'behind'} your best`;
}

export function raceDetail(outcome) {
  if (!outcome) return '';
  if (!outcome.comparable) return 'Your input or conditions differed from your best’s, so the two aren’t compared.';
  return `${outcome.wpm} vs ${outcome.bestWpm} wpm · ${outcome.accuracy}% vs ${outcome.bestAccuracy}% accuracy, same passage and conditions.`;
}
