import { completeAttempt, failureAtEnd, minimumStop, passageComplete, replayAttempt } from './typing.js';
import type { Attempt, MinimumFailure, Replay } from './typing.js';
import { createRunCounter } from './run-counts.js';
import type { RunTicket } from './run-counts.js';
import { dayKey } from './insights.js';
import type { PracticeSession, SealedRun } from './practice-session.js';
import type { LearningStore } from './learning-store.js';
import type { ProfileSync } from './profile-sync.js';

export function markEndFailure(attempt: Attempt) {
  if (attempt.interrupted) return;
  const failed = failureAtEnd(attempt.conditions.correctionPolicy, attempt.text, replayAttempt(attempt).typed);

  if (!failed) return;
  attempt.interrupted = true;
  attempt.failed = failed;
}

interface RunPorts { durationMs(): number | null; tick(): void; startFx(stamp: number): void; started(): void }

export function createPracticeRun(practice: PracticeSession, learning: LearningStore, sync: ProfileSync) {
  const counter = createRunCounter();
  let ticket: RunTicket | null = null;
  let countsUnsaved = false;
  let ticker = 0;
  let ports: RunPorts | null = null;

  function stopClock() { clearInterval(ticker); ticker = 0; }

  function position(replay: Replay, elapsedMs: number) {
    const attempt = practice.attempt;

    if (!attempt) throw new Error('No practice attempt');
    const submitted = attempt.events.some((event) => event.type === 'submit');

    return { elapsedMs, durationMs: ports?.durationMs() ?? null, finished: submitted || passageComplete(attempt, replay.typed) };
  }

  return {
    stopClock, position,
    configure(next: RunPorts) { ports = next; },
    start(stamp: number) {
      if (practice.startTime !== null) return;
      const attempt = practice.attempt;

      if (!attempt) throw new Error('No practice attempt');
      practice.startTime = stamp;
      attempt.status = 'running';
      attempt.startedAt = 0;
      ticker = window.setInterval(() => ports?.tick(), 100);
      ports?.startFx(stamp);
      const counted = counter.start(learning.profile.runCounts, dayKey(new Date()));
      learning.profile.runCounts = counted.counts;
      ticket = counted.ticket;
      countsUnsaved = true;
      ports?.started();
    },
    seal(endedAt: number, stop: MinimumFailure | null = null) {
      const attempt = practice.attempt;

      if (!attempt || attempt.status !== 'running') return null;
      markEndFailure(attempt);
      const clean = !attempt.interrupted && !attempt.unsupportedInput;
      const final = completeAttempt(attempt, { endedAt });
      const stopped = clean ? stop || minimumStop(attempt.minimums ?? null, final.summary, position(final.summary, endedAt)) : null;
      const valid = clean && !stopped;
      const completed: SealedRun = { ...final, status: valid ? 'complete' : 'interrupted' };

      if (stopped) completed.stopped = stopped;
      completed.interrupted = attempt.interrupted;
      completed.unsupportedInput = attempt.unsupportedInput;
      completed.fresh = attempt.fresh;

      if (attempt.failed) completed.failed = attempt.failed;

      if (valid && ticket) learning.profile.runCounts = counter.finish(learning.profile.runCounts, ticket);
      ticket = null;
      practice.attempt = completed;

      return { completed, valid };
    },
    markCountsSaved() { countsUnsaved = false; },
    saveCounts() { return countsUnsaved && sync.saveProfile(); },
    dispose: stopClock,
  };
}

export type PracticeRun = ReturnType<typeof createPracticeRun>;
