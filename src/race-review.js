// An online race's results, looked at again: both racers' speed on one graph, or the passage replayed with
// both carets moving in real time. Drawn from the two keystroke traces the service keeps once the race is
// finished, on the race clock, which both traces start from the shared start. Presentational only: the
// results above come from the service's scores, never from here.
import { renderDuelGraph } from './graph.js';
import { createTypingFx } from './motion.js';
import { ghostPoints, traceAttempt } from './ghost-race.js';
import { replayCursor } from './typing.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const $ = (id) => document.getElementById(id);

function nameTag(caret, name) {
  let tag = caret.querySelector('.caret-tag');

  if (!tag) {
    tag = document.createElement('span');
    tag.className = 'caret-tag';
    tag.append(document.createElement('span'));
    caret.append(tag);
  }

  tag.firstElementChild.textContent = name;
}

export function createRaceReview({ renderText }) {
  const root = $('online-review');
  const graph = $('online-duel-graph');
  const replay = $('online-duel-replay');
  const display = $('online-replay-display');
  const toggle = $('online-replay-toggle');
  const speedButton = $('online-replay-speed');
  const views = { graph: $('online-show-graph'), replay: $('online-show-replay') };
  let textView = null;
  const fx = createTypingFx(display.parentElement, display, { ensureCharacters: (index) => textView?.ensureForward(index) });
  let race = null;
  let view = 'graph';
  let position = 0;
  let speed = 1;
  let playing = false;
  let frame = 0;
  let lastNow = 0;
  let lit = 0;

  function drawGraph(animate) {
    if (race && view === 'graph') renderDuelGraph(graph, race.attempts, { animate });
  }

  // Letters either racer has reached read in the text colour, the rest stay muted. Your caret springs to
  // where you were; theirs glides along their keys, as a ghost race's does.
  function draw() {
    const [mine, theirs] = race.cursors.map((typedAt) => typedAt(position).length);
    const leader = Math.max(mine, theirs);
    textView.ensureForward(leader);

    for (let index = Math.min(lit, leader); index < Math.max(lit, leader); index += 1) {
      textView.characters[index].className = index < leader ? 'char correct' : 'char';
    }

    lit = leader;
    fx.update(mine, 'correct', false);
    fx.ghost.seek(position);
    const label = playing ? 'Pause' : 'Play';

    if (toggle.textContent !== label) toggle.textContent = label;
  }

  function tick(now) {
    position = Math.min(race.length, position + (now - lastNow) * speed);
    lastNow = now;

    if (position >= race.length) playing = false;
    draw();

    if (playing) frame = requestAnimationFrame(tick);
  }

  function play() {
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
    textView = renderText(display, race.text);
    textView.characters[0]?.classList.remove('current');
    lit = 0;
    fx.reset(textView.characters);
    fx.ghost.replay(race.points);
    nameTag(display.querySelector('.caret'), 'You');
    nameTag(display.querySelector('.ghost-caret'), race.name);
  }

  function select(next) {
    view = next;

    for (const [name, button] of Object.entries(views)) button.setAttribute('aria-pressed', String(name === next));
    graph.hidden = next !== 'graph';
    replay.hidden = next !== 'replay';

    if (next === 'graph') {
      pause();
      drawGraph(true);

      return;
    }

    mount();
    // Reduced motion: the finished frame, still; Play stays an explicit choice, as in the solo replay.
    position = reducedMotion.matches ? race.length : 0;

    if (reducedMotion.matches) pause();
    else play();
  }

  views.graph.addEventListener('click', () => { if (race && view !== 'graph') select('graph'); });
  views.replay.addEventListener('click', () => { if (race && view !== 'replay') select('replay'); });
  toggle.addEventListener('click', () => (playing ? pause() : play()));
  speedButton.addEventListener('click', () => {
    speed = speed === 1 ? 2 : 1;
    speedButton.textContent = `${speed}×`;
    speedButton.setAttribute('aria-label', `Playback speed ${speed}×`);
  });
  $('online-replay-restart').addEventListener('click', () => { position = 0; play(); });
  // Drawn at the graph's pixel size, so a new width draws it again.
  new ResizeObserver(() => drawGraph(false)).observe(graph);
  addEventListener('resize', () => { if (race && view === 'replay') fx.relayout(); });

  return {
    // Both traces are on the race clock: [ms since the previous key], starting at the shared start.
    show({ text, mine, theirs, name }) {
      race = { text, name, attempts: [traceAttempt(mine, text), traceAttempt(theirs, text)],
        points: ghostPoints(theirs, text.length), length: Math.max(mine.e, theirs.e) };
      race.cursors = race.attempts.map(replayCursor);
      graph.setAttribute('aria-label', `Speed over time, you and ${name}`);
      root.hidden = false;
      select('graph');
    },
    hide() {
      pause();
      race = null;
      root.hidden = true;
    },
  };
}
