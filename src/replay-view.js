// Watch replay: plays a finished attempt's event log back in real time inside a dialog.
// Presentational only. Letter states come from stateAt (the scoring replay), so the last frame
// matches the scored run exactly. Letter states are instant and the caret jumps (no spring).
import { replaySpan, stateAt } from './typing.js';

export function createReplayView(dialog) {
  const display = dialog.querySelector('#replay-text');
  const clock = dialog.querySelector('#replay-clock');
  const toggle = dialog.querySelector('#replay-toggle');
  const speedButton = dialog.querySelector('#replay-speed');
  let attempt = null;
  let span = { start: 0, end: 0 };
  let chars = [];
  let position = 0;
  let speed = 1;
  let playing = false;
  let frame = 0;
  let lastNow = 0;
  let drawn = [];

  const length = () => span.end - span.start;

  function build() {
    display.textContent = '';
    // One trailing empty span holds the caret once the last letter is typed.
    chars = [...attempt.text, ''].map((letter) => {
      const node = document.createElement('span');
      node.className = 'char';
      node.textContent = letter;
      display.append(node);
      return node;
    });
    drawn = [];
  }

  function draw() {
    const state = stateAt(attempt, span.start + position);
    chars.forEach((node, index) => {
      const letter = state.letters[index] || '';
      const name = `char${letter ? ` ${letter}` : ''}${index === state.caret ? ' is-caret' : ''}`;
      if (drawn[index] !== name) node.className = drawn[index] = name;
    });
    clock.textContent = `${(position / 1000).toFixed(1)} s`;
    toggle.textContent = playing ? 'Pause' : 'Play';
    dialog.dataset.state = playing ? 'playing' : position >= length() ? 'done' : 'paused';
  }

  function tick(now) {
    position = Math.min(length(), position + (now - lastNow) * speed);
    lastNow = now;
    if (position >= length()) playing = false;
    draw();
    if (playing) frame = requestAnimationFrame(tick);
  }

  function play() {
    if (position >= length()) position = 0;
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

  toggle.addEventListener('click', () => (playing ? pause() : play()));
  speedButton.addEventListener('click', () => {
    speed = speed === 1 ? 2 : 1;
    speedButton.textContent = `${speed}×`;
    speedButton.setAttribute('aria-label', `Playback speed ${speed}×`);
  });
  dialog.querySelector('#replay-restart').addEventListener('click', () => { position = 0; play(); });
  dialog.querySelector('#replay-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', pause);

  return {
    open(finished) {
      if (!finished?.events?.length) return;
      attempt = finished;
      span = replaySpan(finished);
      position = 0;
      build();
      dialog.showModal();
      play();
    },
  };
}
