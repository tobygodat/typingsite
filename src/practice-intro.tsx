import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { PracticeSession } from './practice-session.js';
import { Copy } from './results-card.js';
import { unitText } from './units.js';

export function NativeTypingStatus() {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;

    if (!host || host.hasChildNodes()) return;
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    dot.setAttribute('aria-hidden', 'true');
    host.append(dot, 'Ready');
  }, []);

  return <span ref={ref} id="typing-status" className="status" role="status"></span>;
}

export function NativeLiveStats({ practice }: { practice: PracticeSession }) {
  const ref = useRef<HTMLDivElement>(null);
  const intro = useSyncExternalStore(practice.intro.subscribe, practice.intro.getSnapshot, practice.intro.getSnapshot);
  useLayoutEffect(() => {
    const host = ref.current;

    if (!host) return;

    for (const [id, text] of [['timer', '30'], ['timer-unit', 's'], ['timer-label', 'remaining'], ['live-wpm', '—'], ['live-accuracy', '—']]) {
      const node = id ? document.getElementById(id) : null;

      if (node && !node.hasChildNodes()) node.textContent = text ?? '';
    }

    const unit = host.querySelector<HTMLElement>('[data-speed-unit]');

    if (unit && !unit.hasChildNodes()) unit.textContent = unitText('{unit}');
  }, []);

  return <div ref={ref} id="live-stats" className="live-stats"><div className="live-stat timer-stat"><strong id="timer" className="num"></strong><span id="timer-unit"></span><small id="timer-label" className="sr-only"></small></div><div className="live-stat"><strong id="live-wpm" className="num" data-bare=""></strong><span data-speed-unit=""></span></div><div className="live-stat"><strong id="live-accuracy" className="num"></strong><span>%<span className="sr-only"> input accuracy</span></span></div><small id="pace-label" className="pace-label" hidden={!intro.paceVisible}><Copy parts={intro.pace} /></small></div>;
}

export function PracticeIntro({ practice }: { practice: PracticeSession }) {
  const intro = useSyncExternalStore(practice.intro.subscribe, practice.intro.getSnapshot, practice.intro.getSnapshot);

  return <><div className="session-intro"><div className="session-line"><NativeTypingStatus /><span id="session-kicker" className="session-kicker">{intro.kicker}</span></div><h1 id="session-title">{intro.title}</h1><p id="session-description">{intro.description}</p><p id="condition-line"><Copy parts={intro.conditions} /></p></div><NativeLiveStats practice={practice} /><p id="caps-warning" className="caps-warning" aria-hidden="true" data-on={intro.caps === null ? undefined : String(intro.caps)}>Caps Lock is on</p></>;
}

export function PracticeBest({ practice }: { practice: PracticeSession }) {
  const intro = useSyncExternalStore(practice.intro.subscribe, practice.intro.getSnapshot, practice.intro.getSnapshot);

  return <span id="best" className="personal-best num"><Copy parts={intro.best} /></span>;
}

export function PracticeEgg({ practice }: { practice: PracticeSession }) {
  const intro = useSyncExternalStore(practice.intro.subscribe, practice.intro.getSnapshot, practice.intro.getSnapshot);

  return <span id="egg-feedback"><Copy parts={intro.egg} /></span>;
}
