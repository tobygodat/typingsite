import { createProgressSections } from './progress-sections.js';
import type { SyncedProfile } from './profile-copy.js';
import type { CopyPart } from './practice-session.js';
import type { ActivePreferences, HydratedProfile } from './profile-types.js';
import type { trainPath } from './train-path.js';
import { createStore } from './store.js';

export interface TrainView {
  path: ReturnType<typeof trainPath>;
  named: boolean;
  next: boolean;
  hasComparison: boolean;
  startLabel: string;
  starts: string;
  evidence: string;
  since: string;
  words: string[];
  fresh: boolean;
  advance: boolean;
  revision: number;
}

export interface LoopView {
  id?: string;
  date: string;
  title: string;
  conditions: string;
  accuracy: string;
  delta: unknown;
  state: string;
  tone: 'success' | 'danger' | 'neutral';
  facts: { label: string; parts: CopyPart[] }[];
  notes: CopyPart[][];
  target: string | null;
}

export interface LessonFactView { label: string; speedUnit?: boolean; value: CopyPart[]; need: CopyPart[]; met: boolean | null }

export interface LessonRowView { id: string; index: number; keys: string[]; fingers: string; state: 'passed' | 'next' | 'locked'; numbers: CopyPart[]; action: string; actionLabel: string }

export interface LessonView {
  status: { label: string; tone: string } | null;
  heading: CopyPart[];
  copy: string;
  meta: CopyPart[];
  facts: LessonFactView[];
  primary: string;
  secondary: string;
  known: string[];
  fresh: string[];
  caption: string;
  saveNote: string;
  rows: LessonRowView[];
}

export interface ComparisonView {
  heading: string;
  outcome: string;
  unit: string;
  compared: boolean;
  target: { label: string; value: string; was: string } | null;
  accuracy: number | null;
  accuracyDelta: string;
  wpm: number | null;
  wpmDelta: number | null;
  conditions: string;
  caveat: string;
}

export function createLearningStore() {
  let state: { profile: SyncedProfile<HydratedProfile>; preferences: ActivePreferences; livePreferences: string } | null = null;
  const train = createStore<TrainView | null>(null);
  const comparison = createStore<ComparisonView>({ heading: 'Retest complete.', outcome: 'insufficient', unit: '', compared: true, target: null, accuracy: null, accuracyDelta: '—', wpm: null, wpmDelta: null, conditions: '', caveat: '' });
  const loops = createStore<LoopView[]>([]);
  const lessons = createStore<LessonView | null>(null);
  const commands = { practice() {}, openLessons() {}, start() {}, next() {}, target(unit: string) { void unit; }, loopTarget(id: string | undefined) { void id; }, back() {}, lessonPrimary() {}, lessonSecondary() {}, lesson(index: number) { void index; } };

  function current() {
    if (!state) throw new Error('Learning was read before initialization');

    return state;
  }

  return {
    progress: createProgressSections(),
    train,
    comparison,
    loops,
    lessons,
    commands,
    initialize(profile: SyncedProfile<HydratedProfile>, preferences: ActivePreferences) { state = { profile, preferences, livePreferences: JSON.stringify(preferences) }; },
    get profile() { return current().profile; },
    set profile(profile: SyncedProfile<HydratedProfile>) { current().profile = profile; },
    get preferences() { return current().preferences; },
    set preferences(preferences: ActivePreferences) { current().preferences = preferences; },
    get livePreferences() { return current().livePreferences; },
    set livePreferences(value: string) { current().livePreferences = value; },
  };
}

export type LearningStore = ReturnType<typeof createLearningStore>;
