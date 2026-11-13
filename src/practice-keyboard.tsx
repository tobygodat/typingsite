import { useSyncExternalStore } from 'react';
import { createStore } from './store.js';
import { FINGERS, keyboardRows } from './layouts.js';
import { FingerMap } from './finger-map.js';

interface KeyboardView {
  layout: string; fingers: boolean; visible: boolean;
  lesson: { known: string[]; fresh: string[] } | null;
  target: string | null;
}

export function createPracticeKeyboard() {
  const view = createStore<KeyboardView>({ layout: 'qwerty', fingers: false, visible: false, lesson: null, target: null });
  const active = createStore<string | null>(null);

  return {
    view, active,
    show(next: Omit<KeyboardView, 'target'>) { view.publish({ ...next, target: view.getSnapshot().target }); },
    target(target: string | null) { view.publish({ ...view.getSnapshot(), target }); },
    key(key: string | null) { active.publish(key?.toLowerCase() ?? null); },
  };
}

export type PracticeKeyboardController = ReturnType<typeof createPracticeKeyboard>;

export function PracticeKeyboard({ controller }: { controller: PracticeKeyboardController }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const active = useSyncExternalStore(controller.active.subscribe, controller.active.getSnapshot, controller.active.getSnapshot);

  if (view.lesson) return <FingerMap id="keyboard" known={view.lesson.known} fresh={view.lesson.fresh} active={active} layout={view.layout} fingers={view.fingers} />;

  const targets = new Set((view.target ?? '').toLowerCase());

  return <div id="keyboard" className="keyboard" aria-label="On-screen keyboard" hidden={!view.visible} data-layout={view.layout} data-fingers={String(view.fingers)}>
    {keyboardRows(view.layout).map((keys, index) => <div key={index} className="key-row">{keys.map(({ key: letter, hand, finger, column }) => {
      const label = letter === ' ' ? 'space' : letter;

      return <span key={letter} className={`key${letter === ' ' ? ' space' : ''}${targets.has(letter) ? ' target' : ''}${active === letter ? ' active' : ''}`} data-key={letter} data-hand={hand} data-finger={finger} data-column={column}>{view.fingers ? <><span aria-hidden="true">{label}</span><span className="sr-only">{label}, {hand === 'both' ? 'thumbs' : `${hand} ${finger}`}</span></> : label}</span>;
    })}</div>)}
    {view.fingers && <p className="finger-legend">{FINGERS.map((finger) => <span key={finger} data-finger={finger}>{finger}</span>)}<span>space · thumbs</span></p>}
  </div>;
}

export function LessonKeyboard({ controller, known, fresh }: { controller: PracticeKeyboardController; known: string[]; fresh: string[] }) {
  const active = useSyncExternalStore(controller.active.subscribe, controller.active.getSnapshot, controller.active.getSnapshot);

  return <FingerMap id="lesson-keyboard" known={known} fresh={fresh} active={active} />;
}
