import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createStore } from './store.js';
import { renderText } from './passage-view.js';
import type { CompactTrace } from './network-race.js';
// An online race's results, looked at again: both racers' speed on one graph, or the passage replayed with
// both carets moving in real time. Drawn from the two keystroke traces the service keeps once the race is
// finished, on the race clock, which both traces start from the shared start. Presentational only: the
// results above come from the service's scores, never from here.
import { renderDuelGraph } from './graph.js';
import { createTypingFx } from './motion.js';
import { ghostPoints, traceAttempt } from './ghost-race.js';
import { replayCursor } from './typing.js';



function nameTag(caret: Element | null, name: string) {
  if (!caret) return;
  let tag = caret.querySelector('.caret-tag');

  if (!tag) {
    tag = document.createElement('span');
    tag.className = 'caret-tag';
    tag.append(document.createElement('span'));
    caret.append(tag);
  }

  if (tag.firstElementChild) tag.firstElementChild.textContent = name;
}

interface RaceReviewData { text: string; name: string; attempts: [ReturnType<typeof traceAttempt<string>>, ReturnType<typeof traceAttempt<string>>]; points: ReturnType<typeof ghostPoints>; length: number; cursors: ReturnType<typeof replayCursor>[] }

interface ReviewHost { graph: HTMLDivElement; display: HTMLDivElement; wrap: HTMLDivElement }

export function createRaceReview() {
  const snapshot = createStore({ visible: false, view: 'graph', playing: false, speed: 1, name: '' });
  let host: ReviewHost | null = null;
  let textView: ReturnType<typeof renderText> | null = null;
  let fx: ReturnType<typeof createTypingFx> | null = null;
  let race: RaceReviewData | null = null;
  let view = 'graph';
  let position = 0;
  let speed = 1;
  let playing = false;
  let frame = 0;
  let lastNow = 0;
  let lit = 0;

  function drawGraph(animate: boolean) {
    if (host && race && view === 'graph') renderDuelGraph(host.graph, race.attempts, { animate });
  }

  // Letters either racer has reached read in the text colour, the rest stay muted. Your caret springs to
  // where you were; theirs glides along their keys, as a ghost race's does.
  function draw() {
    if (!race || !textView || !fx) return;
    const mine = race.cursors[0]?.(position).length ?? 0;
    const theirs = race.cursors[1]?.(position).length ?? 0;
    const leader = Math.max(mine, theirs);
    textView.ensureForward(leader);

    for (let index = Math.min(lit, leader); index < Math.max(lit, leader); index += 1) {
      const character = textView.characters[index];

      if (character) character.className = index < leader ? 'char correct' : 'char';
    }

    lit = leader;
    fx.update(mine, 'correct', false);
    fx.ghost.seek(position);
    flushSync(() => snapshot.publish({ visible: true, view, playing, speed, name: race?.name ?? '' }));
  }

  function tick(now: number) {
    if (!race) return;
    position = Math.min(race.length, position + (now - lastNow) * speed);
    lastNow = now;

    if (position >= race.length) playing = false;
    draw();

    if (playing) frame = requestAnimationFrame(tick);
  }

  function play() {
    if (!race) return;

    if (position >= race.length) position = 0;
    playing = true;
    lastNow = performance.now();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(tick);
    draw();
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(frame);

    if (race && view === 'replay') draw();
  }

  function mount() {
    if (!host || !race || !fx) return;
    const display = host.display;
    textView = renderText(display, race.text);
    textView.characters[0]?.classList.remove('current');
    lit = 0;
    fx.reset(textView.characters);
    fx.ghost.replay(race.points);
    nameTag(display.querySelector('.caret'), 'You');
    nameTag(display.querySelector('.ghost-caret'), race.name);
  }

  function select(next: 'graph' | 'replay') {
    if (!race) return;
    view = next;

    flushSync(() => snapshot.publish({ visible: true, view, playing, speed, name: race?.name ?? '' }));

    if (next === 'graph') {
      pause();
      drawGraph(true);

      return;
    }

    mount();
    // Reduced motion: the finished frame, still; Play stays an explicit choice, as in the solo replay.
    position = matchMedia('(prefers-reduced-motion: reduce)').matches ? race.length : 0;

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) pause();
    else play();
  }


  return {
    snapshot,
    attach(next: ReviewHost) {
      host = next;
      fx = createTypingFx(next.wrap, next.display, { ensureCharacters: (index) => textView?.ensureForward(index) });
      const observer = new ResizeObserver(() => drawGraph(false));
      observer.observe(next.graph);
      const resize = () => { if (race && view === 'replay') fx?.relayout(); };

      addEventListener('resize', resize);

      return () => { cancelAnimationFrame(frame); playing = false; observer.disconnect(); removeEventListener('resize', resize); fx?.dispose(); fx = null; textView = null;

 if (host === next) host = null; };
    },
    select,
    toggle() { if (playing) pause(); else play(); },
    speed() { speed = speed === 1 ? 2 : 1; flushSync(() => snapshot.publish({ ...snapshot.getSnapshot(), speed })); },
    restart() { position = 0; play(); },
    dispose() { playing = false; cancelAnimationFrame(frame); fx?.dispose(); },
    // Both traces are on the race clock: [ms since the previous key], starting at the shared start.
    show({ text, mine, theirs, name }: { text: string; mine: CompactTrace; theirs: CompactTrace; name: string }) {
      race = { text, name, attempts: [traceAttempt(mine, text), traceAttempt(theirs, text)],
        points: ghostPoints(theirs, text.length), length: Math.max(mine.e, theirs.e), cursors: [] };
      race.cursors = race.attempts.map(replayCursor);
      select('graph');
    },
    hide() {
      pause();
      race = null;
      flushSync(() => snapshot.publish({ ...snapshot.getSnapshot(), visible: false }));
    },
  };
}

export type RaceReviewController = ReturnType<typeof createRaceReview>;

export function RaceReview({ controller }: { controller: RaceReviewController }) {
  const view = useSyncExternalStore(controller.snapshot.subscribe, controller.snapshot.getSnapshot, controller.snapshot.getSnapshot);
  const graph = useRef<HTMLDivElement>(null);
  const display = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (graph.current && display.current && wrap.current) return controller.attach({ graph: graph.current, display: display.current, wrap: wrap.current }); }, [controller]);

  return <div id="online-review" className="duel-review" hidden={!view.visible}>
    <div className="segmented duel-toggle" role="group" aria-label="Race view"><button id="online-show-graph" type="button" aria-pressed={view.view === 'graph'} onClick={() => controller.select('graph')}>Graph</button><button id="online-show-replay" type="button" aria-pressed={view.view === 'replay'} onClick={() => controller.select('replay')}>Replay</button></div>
    <div ref={graph} id="online-duel-graph" className="duel-graph speed-graph" role="img" hidden={view.view !== 'graph'} aria-label={`Speed over time, you and ${view.name}`}></div>
    <div id="online-duel-replay" className="duel-replay" hidden={view.view !== 'replay'}><div ref={wrap} className="duel-replay-wrap"><div ref={display} id="online-replay-display" aria-hidden="true"></div></div><div className="duel-replay-controls"><button id="online-replay-toggle" className="btn btn-secondary" type="button" onClick={() => controller.toggle()}>{view.playing ? 'Pause' : 'Play'}</button><button id="online-replay-speed" className="btn btn-ghost" type="button" aria-label={`Playback speed ${view.speed}×`} onClick={() => controller.speed()}>{view.speed}×</button><button id="online-replay-restart" className="btn btn-ghost" type="button" onClick={() => controller.restart()}>Restart</button></div></div>
  </div>;
}
