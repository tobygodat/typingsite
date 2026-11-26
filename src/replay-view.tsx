import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createStore } from './store.js';
import type { SealedRun } from './practice-session.js';
// Watch replay: plays a finished attempt's event log back in real time inside a dialog.
// Presentational only. The typed text and extras come from replayFlow, which applies the events exactly
// as the scoring replay does, so the last frame matches the scored run. Each frame applies only
// the events that came due and classifies only the mounted letters. Letter states are instant
// and the caret jumps (no spring).
// Like the live passage, only a short stretch is mounted and three lines show: a timed run's
// 1,600-word passage costs no more to draw than a ten-word one.
import { RATE_FLOOR_MS, replayFlow, replayScoreAt, replaySpan } from './typing.js';
import { MISSED, type WordFlowState } from './word-flow.js';
import { formatSpeed, unitText } from './units.js';



// Letters mounted from the top visible line: well over three lines at any dialog width.
const MOUNTED = 480;

interface ReplayView { playing: boolean; speed: number; clock: string; wpm: number | null; accuracy: string; errors: number; state: string }

export function createReplayView() {
  const view = createStore<ReplayView>({ playing: false, speed: 1, clock: '0.0', wpm: null, accuracy: '—', errors: 0, state: 'paused' });
  let dialog: HTMLDialogElement | null = null;
  let display: HTMLElement | null = null;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  let attempt: SealedRun | null = null;
  let span = { start: 0, end: 0 };
  let flowAt: (t: number) => Pick<WordFlowState, 'typed' | 'extras'> = () => ({ typed: '', extras: new Map() });
  let first = 0; // text index of the first mounted letter, always the start of a line
  let chars: HTMLSpanElement[] = []; // chars[i] shows text index first + i
  let lines: number[] = []; // text index where each mounted line starts
  let position = 0;
  let speed = 1;
  let playing = false;
  let frame = 0;
  let lastNow = 0;
  let drawn: string[] = [];
  // Letters typed past a word's end (fluid word flow), by that word's end, drawn before its space.
  let extraNodes = new Map<number, HTMLSpanElement[]>();
  let misses: number[] = []; // attempt-clock offsets of the run's first-try misses
  let scored: { second: number; due: number; position: number } | null = null; // the replay second, misses due and position the stats were last computed at

  const length = () => span.end - span.start;

  function mount(from: number) {
    if (!attempt || !display) return;
    const { text } = attempt;
    const end = Math.min(text.length, from + MOUNTED);
    first = from;
    // At the end of the passage, one trailing empty span holds the caret after the last letter.
    chars = Array.from({ length: end - from + (end === text.length ? 1 : 0) }, (_, offset) => {
      const node = document.createElement('span');
      node.className = 'char';
      node.textContent = text[from + offset] ?? '';

      return node;
    });
    display.replaceChildren(...chars);
    drawn = [];
    extraNodes = new Map();
    measureLines();
  }

  function measureLines() {
    lines = [];
    let top = -Infinity;
    chars.forEach((node, offset) => {
      if (node.offsetTop > top + 1) {
        lines.push(first + offset);
        top = node.offsetTop;
      }
    });
  }

  // Keeps the caret on the first or second of the three visible lines by remounting from an
  // earlier line start. Wrapping is greedy, so text mounted from a line start breaks exactly
  // as the whole passage would and the lines never reflow.
  function follow(caret: number) {
    if (caret < first) mount(0);

    const lineAt = () => { let found = -1; lines.forEach((start, index) => { if (start <= caret) found = index; });

 return found; };

    let line = lineAt();

    while (line >= 2) {
      const start = lines[line - 1];

      if (start === undefined) break;
      mount(start);
      line = lineAt();
    }
  }

  // Like practice's readout, the numbers change once per replay second (no rate before RATE_FLOOR_MS),
  // and the last frame shows the exact final score, the run card's. A first-try miss coming due also
  // refreshes accuracy and errors, on the frame its letter turns coral; wpm waits for the second.
  function drawStats() {
    if (!attempt) return;
    const done = position >= length();
    const second = done ? Infinity : Math.floor(position / 1000);
    const due = misses.filter((offsetMs) => offsetMs <= span.start + position).length;
    const advances = !scored || scored.second !== second || position < scored.position;

    if (!advances && scored?.due === due) return;
    scored = { second, due, position };
    const { wpm, accuracy, errors, elapsedMs } = replayScoreAt(attempt, span.start + position);
    const rated = done || elapsedMs >= RATE_FLOOR_MS;

    const current = view.getSnapshot();
    view.publish({ ...current, wpm: advances ? rated ? wpm : null : current.wpm, accuracy: rated ? String(accuracy) : '—', errors });
  }

  function showExtras(extras: ReadonlyMap<number, string>) {
    let changed = false;

    for (const [end, nodes] of extraNodes) {
      if (extras.get(end) === nodes.map((node) => node.textContent).join('')) continue;

      for (const node of nodes) node.remove();
      extraNodes.delete(end);
      changed = true;
    }

    for (const [end, letters] of extras) {
      const before = chars[end - first];

      if (extraNodes.has(end) || !before || end <= first) continue;
      const nodes = [...letters].map((letter) => Object.assign(document.createElement('span'), { className: 'char extra', textContent: letter }));

      before.before(...nodes);
      extraNodes.set(end, nodes);
      changed = true;
    }

    if (changed) measureLines();
  }

  function draw() {
    if (!attempt || !dialog) return;
    const text = attempt.text;
    const { typed, extras } = flowAt(span.start + position);
    const caret = typed.length;
    // Extras can move a line break, so the caret's line is found again once they are drawn.
    follow(caret);
    showExtras(extras);
    follow(caret);
    showExtras(extras);
    chars.forEach((node, offset) => {
      const index = first + offset;
      const letter = index < caret ? (typed[index] === text[index] ? ' correct' : typed[index] === MISSED ? ' missed' : ' wrong') : '';
      const name = `char${letter}${index === caret ? ' is-caret' : ''}`;

      if (drawn[offset] !== name) node.className = drawn[offset] = name;
    });
    flushSync(() => {
      drawStats();
      view.publish({ ...view.getSnapshot(), clock: (position / 1000).toFixed(1), playing, speed, state: playing ? 'playing' : position >= length() ? 'done' : 'paused' });
    });
  }

  function tick(now: number) {
    position = Math.min(length(), position + (now - lastNow) * speed);
    lastNow = now;

    if (position >= length()) playing = false;
    draw();

    if (playing) frame = requestAnimationFrame(tick);
  }

  function play() {
    if (position >= length()) position = 0;

    if (!attempt || !dialog) return;
    playing = true;
    lastNow = performance.now();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(tick);
    draw();
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(frame);

    if (attempt) draw();
  }


  return {
    view,
    attach(node: HTMLDialogElement, passage: HTMLElement) {
      dialog = node; display = passage;
      const resize = () => { if (node.open && attempt) { mount(0); draw(); } };

      addEventListener('resize', resize);

      return () => { cancelAnimationFrame(frame); playing = false; removeEventListener('resize', resize);

 if (dialog === node) { dialog = null; display = null; } };
    },
    toggle() { if (playing) pause(); else play(); },
    speed() { speed = speed === 1 ? 2 : 1; flushSync(() => view.publish({ ...view.getSnapshot(), speed })); },
    restart() { position = 0; play(); },
    close() { dialog?.close(); },
    pause,
    dispose() { playing = false; cancelAnimationFrame(frame); },
    open(finished: SealedRun | null) {
      if (!finished?.events?.length || !dialog) return;
      attempt = finished;
      span = replaySpan(finished);
      flowAt = replayFlow(finished);
      misses = finished.summary.firstAttempts.filter((entry) => !entry.correct).map((missed) => missed.offsetMs);
      position = 0;
      scored = null;
      // Open first: mounting measures where the lines break.
      dialog.showModal();
      mount(0);

      // Reduced motion: open on the finished frame, still; Play remains an explicit choice.
      if (reduced()) {
        position = length();
        pause();
      } else {
        play();
      }
    },
  };
}

export type ReplayController = ReturnType<typeof createReplayView>;

export function ReplayDialog({ controller }: { controller: ReplayController }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const passage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (dialog.current && passage.current) return controller.attach(dialog.current, passage.current); }, [controller]);
  const speed = view.wpm === null ? '—' : formatSpeed(view.wpm, { bare: true });

  return <dialog ref={dialog} id="replay-dialog" aria-labelledby="replay-title" data-state={view.state} onClose={() => controller.pause()}>
    <div className="dialog-content"><header className="replay-head"><h2 id="replay-title">Replay</h2><div className="replay-readout">
      <span id="replay-stats-label" className="sr-only">{view.wpm === null ? `— ${unitText('{unit}')}` : formatSpeed(view.wpm)}, {view.accuracy}% accuracy, {view.errors} {view.errors === 1 ? 'error' : 'errors'}</span>
      <span className="replay-stat" aria-hidden="true"><span id="replay-wpm" className="replay-stat-value" data-bare="" data-wpm={view.wpm ?? undefined}>{speed}</span><span id="replay-speed-unit" data-speed-unit="">{unitText('{unit}')}</span></span>
      <span className="replay-stat" aria-hidden="true"><span id="replay-accuracy" className="replay-stat-value">{view.accuracy}</span><span>%</span></span>
      <span className="replay-stat" aria-hidden="true"><span id="replay-errors" className="replay-stat-value">{view.errors}</span><span id="replay-errors-unit">{view.errors === 1 ? 'error' : 'errors'}</span></span>
      <span className="replay-stat"><span id="replay-clock" className="replay-stat-value">{view.clock}</span><span>s</span></span>
    </div></header><div ref={passage} id="replay-text" className="replay-text" aria-hidden="true"></div>
    <div className="dialog-actions"><button id="replay-toggle" className="btn btn-secondary" type="button" onClick={() => controller.toggle()}>{view.playing ? 'Pause' : 'Play'}</button><button id="replay-speed" className="btn btn-ghost" type="button" aria-label={`Playback speed ${view.speed}×`} onClick={() => controller.speed()}>{view.speed}×</button><button id="replay-restart" className="btn btn-ghost" type="button" onClick={() => controller.restart()}>Restart</button><button id="replay-close" className="btn btn-ghost" type="button" onClick={() => controller.close()}>Close</button></div></div>
  </dialog>;
}
