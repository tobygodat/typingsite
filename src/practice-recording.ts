import { conditionKey } from './typing.js';
import { bestRun, comparableKind, dailyChallengeId, passageBest, runRecord, settleDailyFirsts } from './insights.js';
import type { HistoricalBest } from './profile-types.js';
import type { LearningStore } from './learning-store.js';
import type { SealedRun } from './practice-session.js';
import type { ProfileSync } from './profile-sync.js';

export function createPracticeRecording(learning: LearningStore, sync: ProfileSync) {
  let bestBefore: HistoricalBest | null = null;
  let passageBefore: ReturnType<typeof passageBest> = null;
  let showBest = () => {};

  return {
    configure(onSaved: () => void) { showBest = onSaved; },
    get bestBefore() { return bestBefore; },
    get passageBefore() { return passageBefore; },
    store(completed: SealedRun) {
      completed.at = new Date().toISOString();

      if (completed.kind === 'daily' && settleDailyFirsts([...learning.profile.runs, completed]).at(-1)?.firstDailyAttempt === false) completed.firstDailyAttempt = false;
      const key = conditionKey(completed.conditions);
      const score = completed.summary.score;
      const eligibleBest = bestRun(completed);
      bestBefore = learning.profile.bests[key] || null;
      passageBefore = completed.fresh === false && comparableKind(completed.kind) ? passageBest(learning.profile.runs, completed) : null;

      if (comparableKind(completed.kind)) learning.profile.attempts.push(completed);
      learning.profile.runs.push(runRecord(completed));
      const previous = learning.profile.bests[key];

      if (eligibleBest && (!previous || score.wpm > previous.wpm)) learning.profile.bests[key] = { wpm: score.wpm, attemptId: completed.id, at: new Date().toISOString() };

      if (completed.kind !== 'drill') {
        for (const id of [completed.textId, completed.kind === 'daily' ? dailyChallengeId(String(completed.challengeDate)) : null]) {
          if (id && !learning.profile.seenTextIds.includes(id)) learning.profile.seenTextIds.push(id);
        }
      }

      const saved = sync.saveProfile();
      showBest();

      return saved;
    },
  };
}

export type PracticeRecording = ReturnType<typeof createPracticeRecording>;
