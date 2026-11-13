import { flushSync } from 'react-dom';
import type { LearningStore, ComparisonView } from './learning-store.js';
import type { TrainingMemory, DrillRecommendation } from './training-memory.js';
import type { SealedRun } from './practice-session.js';
import type { HistoricalTrace } from './profile-types.js';
import type { ProfileSync } from './profile-sync.js';
import { compareAttempts, comparable, summarizePatterns } from './typing.js';
import { isRecord } from './domain-values.js';
import { analysisRuns, isComparisonSource, isPatternAttempt } from './domain-history.js';
import { firstTriesAt, conditionParts, evidenceRun } from './insights.js';
import type { ConditionLabelSource } from './insights.js';
import { keyboardOf, paceShift } from './learner.js';
import type { Recommendation, TargetEvidence } from './learner.js';
import { evidenceCopy, missedCopy, sinceCopy, trainPath } from './train-path.js';
import { signedNumber } from './units.js';
import { uid } from './profile.js';

interface TrainingResultPorts {
  conditions(): ConditionLabelSource;
  recommendation(source: ConditionLabelSource): Recommendation;
  baseline(source: ConditionLabelSource): HistoricalTrace | null;
  layoutMismatch(source: ConditionLabelSource | undefined): string;
  practiceTarget(target: string, source: ConditionLabelSource, ranked: Recommendation): void;
  startDrill(recommendation: DrillRecommendation): void;
  history(): void;
}

function conditionsOf(run: HistoricalTrace) {
  const value = run.conditions;

  if (value === undefined || isRecord(value)) return value;
  throw new TypeError('Historical conditions are not an object');
}

function requiredConditions(value: ConditionLabelSource | undefined) {
  if (!value) throw new TypeError('The retest baseline has no conditions');

  return value;
}

function compareBaseline(before: HistoricalTrace | null, after: SealedRun) {
  if (!before || after.stopped) return compareAttempts(null, after);

  if (isComparisonSource(before)) return compareAttempts(before, after);

  if (!comparable({ ...before, conditions: conditionsOf(before) }, after)) return compareAttempts(null, after);
  throw new TypeError('The baseline has neither a score nor a replayable source');
}

function baselineTries(before: HistoricalTrace, target: string | null) {
  if (isPatternAttempt(before)) return firstTriesAt(before, target);

  if (!/^[a-z]$/.test(target || '')) return null;
  throw new TypeError('The baseline has no first-try recording');
}

const COMPARISON_HEADINGS = { improved: 'The retest was stronger.', mixed: 'A mixed result.', regressed: 'The retest was lower.', steady: 'Level with your baseline.' };

export function createTrainingResults(learning: LearningStore, training: TrainingMemory, sync: ProfileSync, ports: TrainingResultPorts) {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function updateComparison(patch: Partial<ComparisonView>) {
  flushSync(() => learning.comparison.publish({ ...learning.comparison.getSnapshot(), ...patch }));
}

function showComparison(heading: string, outcome: string, trained: string | null = null, source: ConditionLabelSource | null = null) {
  updateComparison({ heading, outcome, unit: trained || (training.context?.recommendationKind === 'adaptive' ? 'Adaptive' : training.context?.recommendationKind === 'general' ? 'General drill' : 'Retest') });
  training.after = { trained, source };
  renderTrain({ advance: true });
}

function renderComparison(before: HistoricalTrace | null, after: SealedRun, saved: boolean) {
  const comparison = compareBaseline(before, after);
  const trainedTarget = training.context?.target || training.target;
  updateComparison({ compared: comparison.comparable });
  showComparison(comparison.comparable ? COMPARISON_HEADINGS[comparison.state] : 'Retest complete.', comparison.comparable ? comparison.state : 'unavailable',
    trainedTarget || null, after.conditions);

  // No comparison means none of its numbers: a retest that isn't compared (stopped under a minimum,
  // interrupted, other conditions or repeated text) says why instead. No baseline: a clear from another
  // tab or device removed it while this retest was under way.
  if (!comparison.comparable || !before) {
    const reason = before ? comparison.reason : 'Your history was cleared, so there is no baseline to compare with.';
    updateComparison({ conditions: '', caveat: reason + (saved ? '' : ' Couldn’t save on this device.') });
    ports.history();

    return;
  }

  const beforePattern = summarizePatterns([before]).pairs.find((item) => item.pair === trainedTarget);
  const afterPattern = summarizePatterns([after]).pairs.find((item) => item.pair === trainedTarget);
  // The target's misses on the retest, a pair's or a key's, beside the evidence the drill was chosen on (or,
  // for a target picked by hand, the baseline run's). A pair chosen for its slowness reads back its pace: the
  // retest's clean intervals against the runs it was chosen on.
  const now = firstTriesAt(after, trainedTarget);
  const was: TargetEvidence | null = training.context?.was || baselineTries(before, trainedTarget);

  const pace = was?.basis === 'slow' && afterPattern?.timings.length && afterPattern.slowdownMs !== null
    ? { target: trainedTarget, was: { slowMs: was.slowMs, timed: was.timed, timedRuns: was.timedRuns, slowRuns: was.slowRuns },
      now: { slowMs: afterPattern.slowdownMs, timed: afterPattern.timings.length } } : null;

  const target = was?.basis === 'slow' ? pace ? {
    label: trainedTarget + ' pace', value: paceShift(pace.now.slowMs),
    was: 'over ' + plural(pace.now.timed, 'interval') + ', was ' + paceShift(pace.was.slowMs ?? null) + ' over ' + pace.was.timed,
  } : null : now && was ? { label: trainedTarget + ' missed', value: missedCopy(now), was: 'was ' + missedCopy(was) } : null;

  const parts = conditionParts(after.conditions);
  updateComparison({ target, accuracy: after.summary.score.accuracy, accuracyDelta: signedNumber(comparison.accuracyDelta) + ' pp',
    wpm: after.summary.score.wpm, wpmDelta: comparison.wpmDelta, conditions: ['fresh text', parts.language, parts.length].join(' · ') });
  const enoughTiming = (beforePattern?.timings.length ?? 0) >= 10 && (afterPattern?.timings.length ?? 0) >= 10;

  // A key has no timing of its own.
  const timingSummary = trainedTarget?.length === 1 ? null : { target: trainedTarget, beforeCount: beforePattern?.timings.length || 0,
    afterCount: afterPattern?.timings.length || 0, deltaMs: enoughTiming ? Number(afterPattern?.medianMs) - Number(beforePattern?.medianMs) : null };

  let comparisonSaved = saved;

  if (saved) {
    learning.profile.loops.push({
      id: uid(),
      at: new Date().toISOString(),
      beforeAttemptId: before.id,
      afterAttemptId: after.id,
      target: training.target,
      recommendationKind: training.context?.recommendationKind || 'manual',
      // Which policy and version ranked the target (learner-decay-timing@1, counting@1), or null when it was typed
      // by hand or drilled again from a past loop.
      policy: training.context?.policy ?? null,
      // The training focus it was ranked for (balanced, accuracy, speed), beside the policy.
      focus: training.context?.focus ?? null,
      // What the target was named for, so a slow pair reads back pace even when the retest timed none of it.
      targetBasis: trainedTarget ? (was?.basis === 'slow' ? 'slow' : 'errors') : null,
      drillCompleted: Boolean(training.context?.drillCompleted),
      conditions: after.conditions,
      comparison,
      targetTiming: timingSummary,
      targetMisses: now && was && was.basis !== 'slow' ? { target: trainedTarget, was: { errors: was.errors, observations: was.observations }, now } : null,
      targetPace: pace,
      drill: training.context?.drill || null,
    });
    comparisonSaved = sync.saveProfile();
  }

  updateComparison({ caveat: comparisonSaved ? '' : 'Couldn’t save on this device.' });
  ports.history();
}

function renderTrain({ advance = false, fresh = false } = {}) {
  const after = training.after;
  const source = after?.source || ports.conditions();
  const recommendation = ports.recommendation(source);
  const path = trainPath({ recommendation, loops: learning.profile.loops, runs: learning.profile.runs, keyboard: keyboardOf(source), after });
  const { current } = path;
  const baseline = ports.baseline(source);
  const named = current.kind === 'targeted';
  const next = Boolean(after && named);
  const baselineConditions = baseline ? conditionsOf(baseline) : undefined;
  const retests = learning.preferences.retest && baseline && !ports.layoutMismatch(baselineConditions);
  learning.commands.next = () => { if (current.unit !== null) ports.practiceTarget(current.unit, source, recommendation); };

  learning.commands.target = (unit) => ports.practiceTarget(unit, source, recommendation);
  learning.commands.start = () => {
    training.baseline = baseline;
    ports.startDrill(after ? { ...recommendation, kind: 'general', target: null, title: current.title, was: null } : recommendation);
  };

  const length = retests ? conditionParts(requiredConditions(baselineConditions)).length : '';
  const since = sinceCopy(current.since);
  const previous = learning.train.getSnapshot();
  flushSync(() => learning.train.publish({
    path, named, next, hasComparison: Boolean(after),
    startLabel: named ? 'Drill “' + current.unit + '”' : retests ? 'Drill and retest' : 'Drill',
    starts: learning.preferences.drillSeconds + ' s' + (length ? ', then ' + (baselineConditions?.mode === 'quote' ? 'a ' : '') + length + ' on fresh text' : ''),
    words: named && current.was?.basis !== 'slow' ? evidenceWords(current.unit, source) : [],
    evidence: named ? evidenceCopy(current.was, { all: Boolean(since) }) : '', since,
    fresh, advance, revision: (previous?.revision ?? 0) + 1,
  }));
}

function evidenceWords(target: string | null, source: ConditionLabelSource) {
  const keyboard = keyboardOf(source);
  const words: string[] = [];

  for (const run of analysisRuns(learning.profile.runs).reverse()) {
    if (!evidenceRun(run) || keyboardOf(run.conditions) !== keyboard) continue;

    for (const word of run.missedWords || []) {
      const bare = word.toLowerCase().replace(/[^a-z]/g, '');

      if (bare.includes(String(target)) && !words.includes(bare)) words.push(bare);

      if (words.length === 6) return words;
    }
  }

  return words;
}

return { update: updateComparison, show: showComparison, compare: renderComparison, render: renderTrain, evidenceWords };
}
