import type { LearningStore } from './learning-store.js';
import type { PracticeSession, SessionKind } from './practice-session.js';
import type { ProfileSync } from './profile-sync.js';
import type { TrainingMemory, DrillRecommendation } from './training-memory.js';
import type { HistoricalTrace } from './profile-types.js';
import type { Conditions, InputClass } from './typing.js';
import { CORPUS_VERSION, conditionKey, correctionPreference, makeAdaptive, makeDrill, textId } from './typing.js';
import { recurringMissedWords, practiceWordsPassage } from './insights.js';
import type { ConditionLabelSource } from './insights.js';
import { DEFAULT_POLICY } from './learner.js';
import type { Recommendation } from './learner.js';
import { normalizeLayout, layoutLabel } from './layouts.js';
import { isRecord } from './domain-values.js';

export const CODE_DRILL_NOTE = 'A standalone drill. Code runs have no fresh-text retest.';

interface TrainingPolicyPorts {
  conditions(): Conditions;
  inputLayout(input: InputClass): string;
  retainedBaseline(source?: ConditionLabelSource | null): HistoricalTrace | null;
  recommendation(source: ConditionLabelSource): Recommendation;
  reset(kind: SessionKind, options?: { focus?: boolean }): void;
  controls(): void; applyPreferences(): void; manual(open: boolean): void;
  unavailable(reason: string): void; description(text: string): void;
}

function conditionsOf(run: HistoricalTrace | null) {
  const value = run?.conditions;

  if (value === undefined || isRecord(value)) return value;
  throw new TypeError('Historical conditions are not an object');
}

export function createTrainingPolicy(learning: LearningStore, practice: PracticeSession, training: TrainingMemory, sync: ProfileSync, ports: TrainingPolicyPorts) {
function adaptivePassage() {
  if (training.plainNext) {
    training.plainNext = false;

    return null;
  }

  if (!learning.preferences.adaptive || !['time', 'words'].some((mode) => mode === learning.preferences.mode)) return null;
  const { lean, runs } = ports.recommendation(ports.conditions());

  return runs && lean.length ? { ...makeAdaptive(lean, { mode: learning.preferences.mode, count: learning.preferences.count, duration: learning.preferences.duration, punctuation: learning.preferences.punctuation,
    numbers: Boolean(learning.preferences.numbers), wordList: learning.preferences.wordList }), trainFocus: learning.preferences.trainFocus } : null;
}

function startWordPractice(words: string[], { recurring = false } = {}) {
  const text = practiceWordsPassage(words);
  training.words = { id: `missed-${textId(text)}`, text, fresh: false, words, recurring };
  training.context = null;
  training.target = null;
  ports.reset('missed', { focus: true });
}

function practiseRecurringWords() {
  const { words } = recurringMissedWords(learning.profile.runs);

  if (words.length < 2) return;
  training.baseline ||= ports.retainedBaseline();
  startWordPractice(words.map((item) => item.word), { recurring: true });
}

function baselineFor(source: ConditionLabelSource) {
  const key = conditionKey(source);

  return training.baseline?.status === 'complete' && !training.baseline.adaptive && conditionKey(conditionsOf(training.baseline)) === key
    ? training.baseline : ports.retainedBaseline(source);
}

function startAdaptiveRetest() {
  const shown = practice.shownResult;

  if (!shown) throw new Error('No adaptive result to retest');
  const baseline = baselineFor(shown.conditions);

  if (!baseline) {
    training.plainNext = true;
    ports.reset('practice', { focus: true });

    return;
  }

  training.baseline = baseline;
  training.target = null;
  training.context = { target: null, recommendationKind: 'adaptive', policy: DEFAULT_POLICY, focus: shown.trainFocus || learning.preferences.trainFocus, baselineAttemptId: baseline.id, drillCompleted: false };
  startRetest();
}

function startDrill(recommendation: DrillRecommendation) {
  training.target = recommendation.target || null;
  const mismatch = training.baseline ? layoutMismatch(conditionsOf(training.baseline)) : "";

  if (mismatch) training.baseline = null;
  const source = conditionsOf(training.baseline);

  if (source) restoreConditions(source);
  training.context = { recommendation, target: training.target, recommendationKind: recommendation.kind, policy: recommendation.policy || null,
    focus: recommendation.focus || null, baselineAttemptId: training.baseline?.id || null, drillCompleted: false, was: recommendation.was || null,
    retest: learning.preferences.retest };
  const drill = drillPassage();
  training.context.drill = { target: training.target, duration: learning.preferences.drillSeconds, wordList: learning.preferences.wordList, textVersion: drill.textVersion };

  if (drill.lean) training.context.drill.lean = drill.lean;
  ports.manual(false);
  ports.reset('drill', { focus: true });

  // With no baseline, or the retest off, nothing follows the drill, so it says so where the drill describes itself.
  if (!training.baseline || !learning.preferences.retest) ports.description(learning.preferences.mode === 'code' ? CODE_DRILL_NOTE : `Standalone drill.${mismatch ? ` ${mismatch}` : ''}`);
}

function startRetest() {
  if (!training.baseline || training.baseline.status !== 'complete') return;
  const source = conditionsOf(training.baseline);
  const mismatch = layoutMismatch(source);

  if (mismatch) {
    ports.unavailable(mismatch);

    return;
  }

  if (!source) throw new TypeError('The retest baseline has no conditions');
  restoreConditions(source);
  ports.reset('retest', { focus: true });
}

function layoutMismatch(source: ConditionLabelSource | undefined) {
  const layout = normalizeLayout(source?.layout);

  if (source?.inputClass === 'touch' || layout === learning.preferences.layout) return '';

  return `The baseline was typed on ${layoutLabel(layout)}. Switch the keyboard layout back to ${layoutLabel(layout)} to retest it.`;
}

function restoreConditions(source: ConditionLabelSource) {
  sync.commitPreferences();
  const fixedPunctuation = ['code', 'book'].some((mode) => mode === source.mode);
  const prose = !['quote', 'code', 'book'].some((mode) => mode === source.mode);

  // The standard recipe carries its own settings; restoring it must not overwrite the person's.
  if (source.mode === 'standard') learning.preferences = { ...learning.preferences, mode: 'standard' };
  else learning.preferences = {
    ...learning.preferences,
    mode: source.mode,
    duration: source.duration || learning.preferences.duration,
    count: source.count || learning.preferences.count,
    punctuation: fixedPunctuation ? learning.preferences.punctuation : Boolean(source.punctuation),
    numbers: prose ? Boolean(source.numbers) : learning.preferences.numbers,
    quoteLength: source.quoteLength || learning.preferences.quoteLength,
    difficulty: source.difficulty || learning.preferences.difficulty,
    wordList: source.wordList || learning.preferences.wordList,
    codeLanguage: source.codeLanguage || learning.preferences.codeLanguage,
    book: source.book || learning.preferences.book,
    correction: correctionPreference({ correction: source.correctionPolicy, stopOnError: source.correctionPolicy !== 'relaxed' }),
    stopOnError: source.correctionPolicy === 'mandatory',
  };
  learning.livePreferences = JSON.stringify(learning.preferences);
  ports.applyPreferences();
  ports.controls();
}

function practiceTarget(target: string, source: ConditionLabelSource, ranked: Recommendation | null = null) {
  training.baseline = ports.retainedBaseline({ ...source, layout: ports.inputLayout(source.inputClass === 'touch' ? 'touch' : 'physical-keyboard') });
  restoreConditions({ ...source, corpus: CORPUS_VERSION });
  const was = (ranked || ports.recommendation(source)).queue.find((item) => item.unit === target)?.was ?? null;
  startDrill({ kind: 'manual', target, title: `Practice “${target}”`, was, policy: ranked?.policy ?? null, focus: ranked?.focus ?? null });
}

function drillPassage() {
  return makeDrill(training.target, learning.preferences.wordList, training.context?.recommendation?.lean || []);
}

return { restore: restoreConditions, layoutMismatch, startDrill, startRetest, practiceTarget, baselineFor, adaptiveRetest: startAdaptiveRetest, wordPractice: startWordPractice, recurringWords: practiseRecurringWords, adaptivePassage, drillPassage };
}
