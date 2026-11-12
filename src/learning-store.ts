import type { SyncedProfile } from './profile-copy.js';
import type { CopyPart } from './practice-session.js';
import type { Preferences, HydratedProfile } from './profile-types.js';
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
  id: string;
  date: string;
  title: string;
  conditions: string;
  accuracy: string;
  delta: number;
  state: string;
  facts: { label: string; parts: CopyPart[] }[];
  notes: string[];
  target: string | null;
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
  let state: { profile: SyncedProfile<HydratedProfile>; preferences: Preferences; livePreferences: string } | null = null;
  const train = createStore<TrainView | null>(null);
  const comparison = createStore<ComparisonView>({ heading: 'Retest complete.', outcome: 'insufficient', unit: '', compared: true, target: null, accuracy: null, accuracyDelta: '—', wpm: null, wpmDelta: null, conditions: '', caveat: '' });
  const loops = createStore<LoopView[]>([]);
  const commands = { start() {}, next() {}, target(unit: string) { void unit; }, loopTarget(id: string) { void id; }, back() {} };

  function current() {
    if (!state) throw new Error('Learning was read before initialization');

    return state;
  }

  return {
    train,
    comparison,
    loops,
    commands,
    initialize(profile: SyncedProfile<HydratedProfile>, preferences: Preferences) { state = { profile, preferences, livePreferences: JSON.stringify(preferences) }; },
    get profile() { return current().profile; },
    set profile(profile: SyncedProfile<HydratedProfile>) { current().profile = profile; },
    get preferences() { return current().preferences; },
    set preferences(preferences: Preferences) { current().preferences = preferences; },
    get livePreferences() { return current().livePreferences; },
    set livePreferences(value: string) { current().livePreferences = value; },
  };
}

export type LearningStore = ReturnType<typeof createLearningStore>;
