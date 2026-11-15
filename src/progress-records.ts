import { analysisRuns, isScoredRun } from './domain-history.js';
import { bestRun, runDay, validRun } from './insights.js';
import { conditionKey } from './typing.js';

// The runs that were a personal best when they were typed: walking the kept runs oldest first, each run that may set
// a best (bestRun, the rule saving a run uses) and is faster than every earlier one at its condition key. A tie is
// not a new best, as when a run is saved. History keeps the newest MAX_RUN_SUMMARIES runs, so this is the best among
// the runs still kept when it was typed: a best that aged out is not counted against a later run.
export function personalBests(runs: readonly unknown[]) {
  const fastest = new Map<string, number>();
  const marked = new Set<unknown>();

  for (const run of analysisRuns(runs)) {
    if (!bestRun(run) || !isScoredRun(run)) continue;
    const key = conditionKey(run.conditions);
    const before = fastest.get(key);

    if (before !== undefined && run.score.wpm <= before) continue;
    fastest.set(key, run.score.wpm);
    marked.add(run);
  }

  return marked;
}

// Each day's kept runs for the practice calendar: how many finished (the count the practice figures use) and the
// fastest that may set a best, at any conditions. A day with no such run has no best.
export function dayRecords(runs: readonly unknown[]) {
  const days = new Map<string, { runs: number; best: number | null }>();

  for (const run of analysisRuns(runs)) {
    const day = runDay(run);

    if (day === null || !validRun(run)) continue;
    const record = days.get(day) ?? { runs: 0, best: null };
    record.runs += 1;

    if (bestRun(run) && isScoredRun(run)) record.best = Math.max(record.best ?? 0, run.score.wpm);
    days.set(day, record);
  }

  return days;
}
