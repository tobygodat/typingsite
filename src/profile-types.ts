import type { Attempt, Conditions, InputClass, Score } from './typing.js';

export type RunCounts = Record<string, Record<string, [started: number, finished: number]>>;

export interface LessonScore extends Score { at: string | null; inputClass: string }

export type LessonProgress = Record<string, { tries: number; last: LessonScore | null; passed: LessonScore | null }>;

export interface CompositionRecord { id: string; at: string | null; version: string; promptId: string | null; inputClass: 'touch' | 'physical-keyboard'; endedBy: 'time' | 'done'; characters: number; words: number; keystrokes: number; backspaces: number; activeMs: number; elapsedMs: number; wpm: number | null; backspaceRate: number | null }

export type KeyCounts = [letter: string, tries: number, errors: number];

export type PatternCounts = [pair: string, observations: number, errors: number, timings: number, medianMs: number | null, slowdownMs: number | null];

export interface RunRecord {
  id: string; at: string | null; kind: Attempt['kind']; status: Attempt['status']; conditions: Conditions; textId: Attempt['textId'];
  day?: string | null; fresh?: boolean; interrupted: boolean; score: Score; elapsedMs: number; errors: number;
  target: string | null; challengeDate?: string | null; firstDailyAttempt?: boolean; adaptive?: boolean; drillSeconds?: number;
  minimums?: unknown; stopped?: NonNullable<ReturnType<typeof import('./typing.js').minimumStop>>; patterns?: PatternCounts[]; keys?: KeyCounts[]; keysVersion?: number;
  corrections?: [number, number | null]; missedWords?: string[];
}

export interface Preferences {
  mode: 'time' | 'words' | 'quote' | 'standard' | 'code' | 'book' | 'custom';
  duration: number; count: number; customDuration: number | null; customCount: number | null;
  punctuation: boolean; numbers: boolean; adaptive: boolean; quoteLength: string; difficulty: string;
  wordList: string; speedUnit: 'wpm' | 'cpm'; codeLanguage: string; book: string; repeatQuotes: boolean;
  layout: string; fingerMap: boolean; fontSize: string; typingFont: string; appFont: string;
  wordHighlight: string; wordHighlightSlide: boolean; tape: boolean; liveMetrics: boolean; keyboard: boolean;
  stopOnError: boolean; correction: import('./typing.js').CorrectionPolicy; strictSpace: boolean; quickEnd: boolean;
  focusMode: boolean; sound: string; soundVolume: number; minAccuracy: number; minWpm: number;
  keybindings: ReturnType<typeof import('./keybindings.js').normalizeKeybindings>;
  theme: string; darkTheme: string; lightTheme: string; customThemes: string; dailyGoal: number;
  customText: string; customOrder: string; paceCaret: string; paceWpm: number; trainFocus: string;
  drillSeconds: number; retest: boolean;
}

export interface Best { wpm: number; accuracy?: number; attemptId: string; at: string | null; conditions?: Conditions }

export interface TargetCounts { errors: number; observations: number }

export interface TargetPace { slowMs: number; timed?: number; timedRuns?: number; slowRuns?: number }

export interface TrainingLoop {
  id: string; at: string; conditions: Conditions; target: string | null; beforeAttemptId: string; afterAttemptId: string;
  drillAttemptId?: string; drillCompleted?: boolean; targetBasis?: 'errors' | 'slow';
  targetMisses?: { target?: string; was: TargetCounts; now: TargetCounts } | null;
  targetPace?: { target?: string; was: TargetPace; now: TargetPace } | null;
  comparison?: import('./typing.js').AttemptComparison;
  minimums?: unknown; inputClass?: InputClass;
}

export type Profile = {
  version: 2; profileId: string; preferences: Partial<Preferences>; preferencesAt?: Record<string, string>;
  attempts: Attempt[]; runs: RunRecord[]; practiceDays: Record<string, number>; runCounts: RunCounts;
  loops: TrainingLoop[]; seenTextIds: string[]; bests: Record<string, Best>; lessons: LessonProgress;
  historyClearedAt?: string; appliedClears?: string[]; heardClears?: string[]; historyClearedIds?: [string, string][]; undoneClears?: string[]; legacyClearedAt?: string; mergeStamp?: string;
  compositions: CompositionRecord[]; updatedAt?: string; clearedAt?: string; resetAt?: string;
};

export type LoopRecord = TrainingLoop;

export interface ProfileCopy {
  [key: string]: unknown;
  version?: unknown; profileId?: unknown; preferences?: Record<string, unknown>;
  preferencesAt?: Record<string, unknown>; attempts?: Record<string, unknown>[]; runs?: Record<string, unknown>[];
  loops?: Record<string, unknown>[]; bests?: Record<string, unknown>; seenTextIds?: unknown[];
  practiceDays?: Record<string, unknown>; runCounts?: unknown; lessons?: unknown; compositions?: unknown;
}

export interface StoredProfileCopy extends ProfileCopy { conditionSets?: unknown }

export type CloudProfileData = Omit<Profile, 'attempts'>;

export interface HistoricalRecord { [key: string]: unknown }

type UnvalidatedPreferenceKey = 'mode' | 'punctuation' | 'numbers' | 'quoteLength' | 'difficulty' | 'fontSize' | 'liveMetrics' | 'keyboard' | 'focusMode' | 'theme';

export type PreferencesInUse = HistoricalRecord & Omit<Preferences, UnvalidatedPreferenceKey>;

export type ActivePreferences = HistoricalRecord & Omit<Preferences, UnvalidatedPreferenceKey | 'duration' | 'count' | 'wordList' | 'codeLanguage' | 'book'>;


export type HistoricalTrace = Attempt | HistoricalRecord;

export type HistoricalRun = RunRecord | HistoricalRecord;

export type HistoricalLoop = TrainingLoop | HistoricalRecord;

export type HistoricalBest = Best | (HistoricalRecord & { wpm: number });

export interface HydratedProfile {
  [key: string]: unknown;
  version: 2;
  profileId: unknown;
  preferences: Partial<Preferences> | HistoricalRecord;
  preferencesAt?: Record<string, unknown>;
  attempts: HistoricalTrace[];
  runs: HistoricalRun[];
  practiceDays: Record<string, number>;
  runCounts: RunCounts;
  loops: HistoricalLoop[];
  seenTextIds: string[];
  bests: Record<string, HistoricalBest>;
  lessons: LessonProgress;
  compositions: CompositionRecord[];
}

export type AnalysisRun = Partial<Omit<RunRecord, 'kind' | 'status' | 'conditions' | 'minimums' | 'stopped'>> & {
  kind?: string; status?: string; conditions?: Conditions | HistoricalRecord; minimums?: unknown; stopped?: unknown;
};

export type ScoredRun = AnalysisRun & { score: Score };

export type AnalysisLoop = Partial<Omit<TrainingLoop, 'beforeAttemptId' | 'conditions' | 'comparison' | 'minimums' | 'inputClass' | 'targetPace' | 'targetMisses' | 'at'>> & {
  beforeAttemptId?: string | null; at?: string | null; conditions?: Conditions | HistoricalRecord; comparison?: unknown; minimums?: unknown; inputClass?: unknown;
  targetPace?: TrainingLoop['targetPace'] | null; targetMisses?: TrainingLoop['targetMisses'] | null;
};
