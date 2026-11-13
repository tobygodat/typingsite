import { flushSync } from 'react-dom';
import { createPracticeKeyboard } from './practice-keyboard.js';
import { createReplayView } from './replay-view.js';
import type { Attempt, Replay } from './typing.js';
import type { Preferences } from './profile-types.js';
import { createStore } from './store.js';

export type SessionKind = 'practice' | 'custom' | 'drill' | 'retest' | 'daily' | 'lesson' | 'challenge' | 'missed';

export type SealedRun = Omit<Attempt, 'status'> & { status: 'complete' | 'interrupted'; summary: Replay };

export interface SpeedPart {
  kind: 'speed';
  wpm: number;
  bare?: boolean;
  signed?: boolean;
  whole?: boolean;
}

export type CopyPart = string | SpeedPart;

export interface ResultWord {
  word: string;
  wrong: boolean;
  wpm: number | null;
}

export interface ResultView {
  id: string;
  counted: boolean;
  wpm: number | null;
  accuracy: number;
  seconds: string;
  consistency: number | null;
  accuracyTitle: string;
  standing: CopyPart[];
  headline: CopyPart[];
  conditions: CopyPart[];
  note: CopyPart[];
  words: ResultWord[];
  practiceWords: string[];
  drillLabel: string;
  againLabel: string;
  replay: boolean;
  graph: boolean;
}

interface PracticeIntroView {
  kind: SessionKind; kicker: string; title: string; description: string; conditions: CopyPart[];
  best: CopyPart[]; caps: boolean | null; pace: CopyPart[]; paceVisible: boolean; egg: CopyPart[];
}

export interface PracticeControlsView {
  visible: boolean;
  minimums: CopyPart[];
  minimumVisible: boolean;
  bookPage: number;
  mode: unknown;
  lengthMode: 'time' | 'words';
  lengthValue: unknown;
  duration: unknown;
  count: unknown;
  punctuation: boolean;
  adaptive: boolean;
  custom: boolean;
  customOpen: boolean;
  manualOpen: boolean;
  composing: boolean;
  codeLanguage: unknown;
  standardRecipe: string;
}

export interface PracticeCommands {
  chooseMode(mode: Preferences['mode']): void;
  chooseLength(length: number): void;
  chooseLanguage(language: string): void;
  punctuation(on: boolean): void;
  adaptive(on: boolean): void;
  compose(): void;
  custom(): void;
  manual(): void;
  lessons(): void;
}

export interface ResultCommands {
  runAgain(): void;
  drill(): void;
  practiceWords(): void;
  watchReplay(): void;
  resultKeyDown(event: KeyboardEvent): void;
  resultKeyUp(event: KeyboardEvent): void;
  headingKeyDown(event: KeyboardEvent): void;
}

interface NativePolicy { attach(input: HTMLTextAreaElement, type: 'primary'): () => void }

export function createPracticeSession() {
  let nativePolicy: NativePolicy | null = null;
  let nativeInput: HTMLTextAreaElement | null = null;
  let detachNative: (() => void) | null = null;
  let current: Attempt | null = null;
  let origin: number | null = null;
  let purpose: SessionKind = 'practice';
  let displayed: SealedRun | null = null;
  const intro = createStore<PracticeIntroView>({ kind: 'practice', kicker: 'open practice', title: 'Practice', description: '', conditions: ['english · common words · 30 s'], best: ['No best yet'], caps: null, pace: [], paceVisible: false, egg: [] });
  const presentIntro = (patch: Partial<Omit<PracticeIntroView, 'kind'>>) => flushSync(() => intro.publish({ ...intro.getSnapshot(), ...patch }));
  const result = createStore<ResultView | null>(null);
  const controls = createStore<PracticeControlsView>({ visible: true, minimums: [], minimumVisible: false, bookPage: 1, mode: 'time', lengthMode: 'time', lengthValue: 30, duration: 30, count: 25, punctuation: false, adaptive: false, custom: false, customOpen: false, manualOpen: false, composing: false, codeLanguage: 'js', standardRecipe: '' });
  const choices: PracticeCommands = { chooseMode() {}, chooseLength() {}, chooseLanguage() {}, punctuation() {}, adaptive() {}, compose() {}, custom() {}, manual() {}, lessons() {} };

  const commands: ResultCommands = {
    runAgain() {}, drill() {}, practiceWords() {}, watchReplay() {},
    resultKeyDown() {}, resultKeyUp() {}, headingKeyDown() {},
  };

  return {
    result, intro, presentIntro,
    keyboard: createPracticeKeyboard(),
    replay: createReplayView(),
    attachPrimary(input: HTMLTextAreaElement) {
      detachNative?.();
      nativeInput = input;
      detachNative = nativePolicy?.attach(input, 'primary') ?? null;

      return () => {
        if (nativeInput !== input) return;
        detachNative?.();
        detachNative = null;
        nativeInput = null;
      };
    },
    connectNative(policy: NativePolicy) {
      detachNative?.();
      nativePolicy = policy;
      detachNative = nativeInput ? policy.attach(nativeInput, 'primary') : null;
    },
    controls,
    commands,
    choices,
    get attempt() { return current; },
    set attempt(run: Attempt | null) { current = run; },
    get startTime() { return origin; },
    set startTime(value: number | null) { origin = value; },
    get sessionKind() { return purpose; },
    set sessionKind(value: SessionKind) {
      if (purpose === value) return;
      purpose = value;
      flushSync(() => intro.publish({ ...intro.getSnapshot(), kind: value }));
    },
    get shownResult() { return displayed; },
    set shownResult(run: SealedRun | null) { displayed = run; },
  };
}

export type PracticeSession = ReturnType<typeof createPracticeSession>;
