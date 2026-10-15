import { conditionKey, replayAttempt, summarizePatterns, textId } from './typing.js';

export const MAX_RUN_SUMMARIES = 1000;
export const MAX_PATTERN_RUNS = 120;

// Run kinds that are never compared, used as a baseline or mined for patterns (custom text). They keep no
// trace or pattern evidence and are retained on their own small budget, so they can never push comparable
// history out of the summary and pattern windows. Extend this set for any other kind like that.
export const NON_COMPARABLE_KINDS = new Set(['custom']);
export const MAX_NON_COMPARABLE_RUNS = 50;
export const comparableKind = (kind) => !NON_COMPARABLE_KINDS.has(kind);

export function runRecord(attempt, at = attempt.at || null) {
  const replay = attempt.summary || replayAttempt(attempt);
  const record = {
    id: attempt.id, at, kind: attempt.kind, status: attempt.status,
    conditions: attempt.conditions, textId: attempt.textId, fresh: attempt.fresh,
    interrupted: Boolean(attempt.interrupted || attempt.unsupportedInput),
    score: replay.score, elapsedMs: replay.elapsedMs,
    errors: replay.firstAttempts.filter((item) => !item.correct).length,
    target: attempt.target || null, challengeDate: attempt.challengeDate || null,
    firstDailyAttempt: attempt.firstDailyAttempt,
  };
  if (!comparableKind(attempt.kind)) return record;
  // Keep counts and each run's measured median, rather than another keystroke log.
  record.patterns = summarizePatterns([attempt]).pairs.map((p) => [p.pair, p.observations, p.errors, p.timings.length, p.medianMs, p.slowdownMs]);
  return record;
}

// Comparable runs keep the newest 1,000 summaries, the newest 120 with pattern evidence; other kinds keep their
// newest 50. Order stays chronological, and a profile with only comparable runs is retained exactly as before.
export function retainRuns(runs) {
  const comparable = runs.filter((run) => comparableKind(run.kind));
  const other = runs.filter((run) => !comparableKind(run.kind));
  const kept = new Set([...comparable.slice(-MAX_RUN_SUMMARIES), ...other.slice(-MAX_NON_COMPARABLE_RUNS)]);
  const withPatterns = new Set(comparable.slice(-MAX_PATTERN_RUNS));
  return runs.filter((run) => kept.has(run))
    .map((run) => (comparableKind(run.kind) && !withPatterns.has(run) ? { ...run, patterns: [] } : run));
}

export const validRun = (run) => run.status === 'complete' && !run.interrupted;
export const trendRun = (run) => validRun(run) && ['test', 'retest'].includes(run.kind);

export function filterRuns(runs, key, days = 'all', date = new Date()) {
  const cutoff = days === 'all' ? null : date.getTime() - Number(days) * 86400000;
  return runs.filter((run) => (!key || conditionKey(run.conditions) === key)
    && (cutoff === null || (run.at && new Date(run.at).getTime() >= cutoff)));
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function weeklyChange(runs, key, date = new Date()) {
  const eligible = runs.filter(trendRun);
  const fortnight = filterRuns(eligible, key, 14, date);
  const current = filterRuns(fortnight, key, 7, date);
  const ids = new Set(current.map((r) => r.id));
  const previous = fortnight.filter((r) => !ids.has(r.id));
  return { current, previous,
    wpm: current.length && previous.length ? median(current.map((r) => r.score.wpm)) - median(previous.map((r) => r.score.wpm)) : null,
    accuracy: current.length && previous.length ? median(current.map((r) => r.score.accuracy)) - median(previous.map((r) => r.score.accuracy)) : null,
  };
}

export const STANDARD_RECENT_RUNS = 10;
export const STANDARD_MIN_RUNS = 3;

// The standard score headline: the best at one standard key, plus the median wpm of the most recent
// completed runs there. Below three runs there is no median, so one run can't stand in for a score.
// Only comparable kinds count: a custom run is never a standard run, whatever conditions it carries.
export function standardScore(runs, key, best = null) {
  const eligible = runs.filter((run) => comparableKind(run.kind) && trendRun(run) && conditionKey(run.conditions) === key);
  const recent = eligible.slice(-STANDARD_RECENT_RUNS);
  const settled = recent.length >= STANDARD_MIN_RUNS;
  return {
    total: eligible.length,
    recent: recent.length,
    best: best ?? (eligible.length ? Math.max(...eligible.map((run) => run.score.wpm)) : null),
    median: settled ? median(recent.map((run) => run.score.wpm)) : null,
    settled,
  };
}

// Which input class heads the standard score, given standardScore for each. Totals count only runs
// still in the kept summaries, while bests outlive them, so totals alone can't stand for lifetime
// practice. Physical keyboard is the default. Touch heads only when the keyboard has nothing at all,
// or once touch has a settled median from more kept runs, so one touch run can't replace a keyboard score.
export function standardInputClass(keyboard, touch) {
  const keyboardEmpty = !keyboard.total && keyboard.best === null;
  const touchHasScore = touch.total > 0 || touch.best !== null;
  if (keyboardEmpty && touchHasScore) return 'touch';
  return touch.settled && touch.total > keyboard.total ? 'touch' : 'physical-keyboard';
}

export function recurringTargets(runs, loops, compatibleConditions) {
  const key = conditionKey(compatibleConditions);
  const eligible = runs.filter((r) => validRun(r) && ['test', 'retest', 'daily'].includes(r.kind)
    && (r.kind !== 'daily' || r.fresh !== false)
    && conditionKey(r.conditions) === key).slice(-MAX_PATTERN_RUNS);
  const pairs = new Map();
  for (const run of eligible) {
    for (const [pair, observations, errors, timingCount, medianMs, slowdownMs] of run.patterns || []) {
      const p = pairs.get(pair) || { pair, observations: 0, errors: 0, runs: 0, errorRuns: 0, slowRuns: 0, lastAt: null };
      p.observations += observations;
      p.errors += errors;
      p.runs += 1;
      if (errors) p.errorRuns += 1;
      if (timingCount >= 10 && slowdownMs > 0 && medianMs !== null) p.slowRuns += 1;
      p.lastAt = run.at;
      pairs.set(pair, p);
    }
  }
  return [...pairs.values()].filter((p) => p.observations >= 10 && (p.errorRuns >= 2 || p.slowRuns >= 2))
    .map((p) => {
      const checks = loops.filter((l) => l.target === p.pair && conditionKey(l.conditions) === key);
      const lastCheck = checks.at(-1);
      const drilled = runs.filter((r) => r.kind === 'drill' && validRun(r) && r.target === p.pair
        && conditionKey(r.conditions) === key);
      const lastPracticed = [drilled.at(-1)?.at, lastCheck?.drillCompleted ? lastCheck.at : null].filter(Boolean).sort().at(-1) || null;
      const laterRuns = eligible.filter((r) => lastPracticed && r.at > lastPracticed && r.fresh !== false);
      const laterObservations = laterRuns.reduce((n, r) => n + (r.patterns?.find((v) => v[0] === p.pair)?.[1] || 0), 0);
      return { ...p, lastPracticed, lastCheck, laterObservations, laterRuns: laterRuns.length,
        review: Boolean(lastPracticed && laterObservations >= 10) };
    })
    .sort((a, b) => Number(b.review) - Number(a.review) || b.errors / b.observations - a.errors / a.observations
      || b.slowRuns - a.slowRuns || a.pair.localeCompare(b.pair));
}

// The seen-text id that marks a day's challenge as attempted (the passage itself has its own id).
export const dailyChallengeId = (day) => `daily-${day}-v1`;

// Only the earliest attempt at a day's challenge (by date, then id, the order every copy sorts by) can
// be its first attempt. Two devices that each tried the day before either held the other's copy both
// label their own try first; once their runs meet, the later one becomes a repeat. Flags are only
// ever cleared, never set, so a label stays conservative. Returns the records, changed ones copied.
export function settleDailyFirsts(records) {
  const earliest = new Map();
  const before = (a, b) => (a.at || '') < (b.at || '') || ((a.at || '') === (b.at || '') && String(a.id) < String(b.id));
  for (const record of records) {
    if (record?.kind !== 'daily' || !record.challengeDate) continue;
    const held = earliest.get(record.challengeDate);
    if (!held || before(record, held)) earliest.set(record.challengeDate, record);
  }
  return records.map((record) => (record?.kind === 'daily' && record.firstDailyAttempt
    && earliest.get(record.challengeDate) !== record ? { ...record, firstDailyAttempt: false } : record));
}

// Stable UTC selection from a frozen text pool: preferences and seen history never change it.
export function dailyPassage(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  const index = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
  const text = DAILY_TEXTS[((index % DAILY_TEXTS.length) + DAILY_TEXTS.length) % DAILY_TEXTS.length];
  return { id: dailyChallengeId(day), sourceTextId: `daily-${textId(text)}`, textVersion: `daily-${textId(text)}@1`, day, text, difficulty: 'steady',
    resetAt: new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString() };
}

const DAILY_TEXTS = [
  'The station clock was a minute slow, but nobody waiting on the platform seemed to mind. A porter moved a trolley past the benches. Somewhere beyond the tracks, a door opened and the smell of fresh bread drifted into the morning air.',
  'We carried the table outside before the rain arrived. There was just enough room beneath the old apple tree for six chairs and a bowl of pears. When the first drops fell, someone opened an umbrella over the bread and everyone laughed.',
  'A good question can change the shape of an afternoon. You set aside the answer you expected, look again at the evidence, and find a detail that had escaped you. The work becomes more interesting as soon as you allow yourself to be surprised.',
  'The bicycle had spent winter behind a stack of boxes. We brushed the dust from its frame, filled the tires, and tightened the loose bell. By noon it was carrying a basket of groceries down the same street where it had once carried schoolbooks.',
  'At the edge of the garden, a narrow gate opened onto a path we had never noticed. It followed the wall for a while, then turned toward a field. We walked until the houses disappeared behind the trees and the wind became the loudest thing around us.',
  'The first draft left plenty of room for improvement. That was useful: a rough page gave us something real to discuss. We moved a paragraph, removed a repeated sentence, and found that the clearest idea had been hiding near the end all along.',
  'Every shelf in the shop told a different story. There were maps folded along old creases, cups with painted handles, and a box of keys without locks. The owner knew where most things came from, but enjoyed letting visitors imagine the rest.',
  'After lunch, the river changed color as clouds crossed the sun. Small boats moved between the bridges, leaving trails that widened and vanished. We sat on the steps with our coats beside us, watching an ordinary afternoon become something we would remember.',
  'Someone had written the recipe on the back of an envelope. The quantities were vague, and the final instruction simply said to wait. We measured what we could, trusted the rest, and learned more from the smell of the oven than from the faded ink.',
  'The workshop window faced a quiet courtyard. Each morning, light reached the same corner of the bench before moving across the tools. Over the years, that small patch of sun had marked the beginning of more useful work than any clock on the wall.',
  'A shelf of unfinished projects can feel like a record of failure. Look more closely and it becomes a record of questions: what would happen if this piece were lighter, that seam stronger, or the whole idea simpler? Sometimes the next attempt begins with an old one.',
  'We reached the hill before sunset and found a place among the tall grass. Below us, lights appeared in scattered windows. There was nothing to solve and nowhere else to be. For a few minutes, watching the day end was enough to fill our attention.',
  'The letter arrived without an explanation for its long journey. Its corners were soft, and the stamp had almost faded. Inside was a short account of a summer by the sea, written by someone who had thought an ordinary day was worth sharing.',
  'When the power returned, we left the candles burning for a little longer. The room looked familiar again, but conversation had found a different pace. Nobody reached for a screen until the last story was finished and the kettle began to sing.',
];
