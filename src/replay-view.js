// Watch replay: plays a finished attempt's event log back in real time inside a dialog.
// Presentational only. Letter states come from stateAt (the scoring replay), so the last frame
// matches the scored run exactly. Letter states are instant and the caret jumps (no spring).
// Like the live passage, only a short stretch is mounted and three lines show: a timed run's
// 1,600-word passage costs no more to draw than a ten-word one.
import { replaySpan, stateAt } from './typing.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// Letters mounted from the top visible line: well over three lines at any dialog width.
const MOUNTED = 480;

export function createReplayView(dialog) {
  const display = dialog.querySelector('#replay-text');
  const clock = dialog.querySelector('#replay-clock');
  const toggle = dialog.querySelector('#replay-toggle');
  const speedButton = dialog.querySelector('#replay-speed');
  let attempt = null;
  let span = { start: 0, end: 0 };
  let first = 0; // text index of the first mounted letter, always the start of a line
  let chars = []; // chars[i] shows text index first + i
  let lines = []; // text index where each mounted line starts
  let position = 0;
  let speed = 1;
  let playing = false;
  let frame = 0;
  let lastNow = 0;
  let drawn = [];

  const length = () => span.end - span.start;

  function mount(from) {
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
    lines = [];
    let top = -Infinity;
    chars.forEach((node, offset) => {
      if (node.offsetTop > top + 1) {
        lines.push(from + offset);
        top = node.offsetTop;
      }
    });
  }

  // Keeps the caret on the first or second of the three visible lines by remounting from an
  // earlier line start. Wrapping is greedy, so text mounted from a line start breaks exactly
  // as the whole passage would and the lines never reflow.
  function follow(caret) {
    if (caret < first) mount(0);
    let line = lines.findLastIndex((start) => start <= caret);
    while (line >= 2) {
      mount(lines[line - 1]);
      line = lines.findLastIndex((start) => start <= caret);
    }
  }

  function draw() {
    const state = stateAt(attempt, span.start + position);
    follow(state.caret);
    chars.forEach((node, offset) => {
      const index = first + offset;
      const letter = state.letters[index] || '';
      const name = `char${letter ? ` ${letter}` : ''}${index === state.caret ? ' is-caret' : ''}`;
      if (drawn[offset] !== name) node.className = drawn[offset] = name;
    });
    clock.textContent = (position / 1000).toFixed(1);
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
  // A new width rewraps the lines, so find the line starts again from the top.
  addEventListener('resize', () => {
    if (!dialog.open || !attempt) return;
    mount(0);
    draw();
  });

  return {
    open(finished) {
      if (!finished?.events?.length) return;
      attempt = finished;
      span = replaySpan(finished);
      position = 0;
      // Open first: mounting measures where the lines break.
      dialog.showModal();
      mount(0);
      // Reduced motion: open on the finished frame, still; Play remains an explicit choice.
      if (reducedMotion.matches) {
        position = length();
        pause();
      } else {
        play();
      }
    },
  };
}
