import type { HistoricalTrace } from './profile-types.js';
import type { Recommendation, TargetEvidence } from './learner.js';
import type { ConditionLabelSource } from './insights.js';
import type { makeDrill, WeightedUnit } from './typing.js';

export type DrillRecommendation = Pick<Recommendation, 'kind' | 'target' | 'title'> & Partial<Pick<Recommendation, 'reason' | 'was' | 'lean' | 'queue' | 'runs'>> & { policy?: string | null; focus?: string | null };

interface DrillContext {
  target: string | null; recommendationKind: string; policy: string | null; focus?: string | null;
  baselineAttemptId: unknown; drillCompleted: boolean; retest?: boolean; recommendation?: DrillRecommendation;
  was?: TargetEvidence | null;
  drill?: { target: string | null; duration: number; wordList: string; textVersion: ReturnType<typeof makeDrill>['textVersion']; lean?: WeightedUnit[] };
}

export interface TrainingMemory {
    baseline: HistoricalTrace | null;
    target: string | null;
    context: DrillContext | null;
    after: { trained: string | null; source: ConditionLabelSource | null } | null;
    words: { id: string; text: string; fresh: boolean; words: string[]; recurring: boolean } | null;
    plainNext: boolean;
}

export function createTrainingMemory() {
  const state: TrainingMemory = { baseline: null, target: null, context: null, after: null, words: null, plainNext: false };

  return state;
}

