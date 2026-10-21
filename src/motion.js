// Typing-surface motion: a spring-driven caret, line scrolling, and an optional
// ghost caret (the pace caret, or a friend's recorded run in a ghost race) that
// glides through the letters rather than hopping from one to the next.
// Everything here is presentational; scoring never reads from it.

import { tapeOffset } from './tape.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const IDLE_AFTER_MS = 800;
// A recorded run glides into each key over at most this long, so it moves at the
// friend's speed while typing and still waits out their pauses.
const REPLAY_GLIDE_MS = 150;

function spring(stiffness, damping) {
  return { value: 0, target: 0, velocity: 0, stiffness, damping };
}

function stepSpring(s, dt) {
  const force = (s.target - s.value) * s.stiffness - s.velocity * s.damping;
  s.velocity += force * dt;
  s.value += s.velocity * dt;
  if (Math.abs(s.target - s.value) < 0.05 && Math.abs(s.velocity) < 1) {
    s.value = s.target;
    s.velocity = 0;
    return false;
  }
  return true;
}

function snap(s, value) {
  s.value = value;
  s.target = value;
  s.velocity = 0;
}

// Offsets relative to the display, walking up through any positioned ancestors.
function offsetIn(element, display) {
  let left = 0;
  let top = 0;
  for (let node = element; node && node !== display; node = node.offsetParent) {
    left += node.offsetLeft;
    top += node.offsetTop;
  }
  return { left, top };
}

export function createTypingFx(wrap, display, options = {}) {
  const caret = document.createElement('span');
  caret.className = 'caret';
  const bar = document.createElement('span');
  bar.className = 'caret-bar';
  caret.append(bar);
  const ghostCaret = document.createElement('span');
  ghostCaret.className = 'ghost-caret is-hidden';
  for (const node of [caret, ghostCaret]) node.setAttribute('aria-hidden', 'true');
  // A pacer moves at `cps`; a recorded run follows `points`, [ms from the first key, characters typed].
  const ghost = { cps: 0, points: null, cursor: 0, start: 0, frame: 0, spot: null, armed: false };

  const caretX = spring(1400, 70);
  const caretY = spring(1400, 70);
  const springs = [caretX, caretY];

  let characters = [];
  let position = 0;
  let line = 0;
  let frame = 0;
  let lastTime = 0;
  let needsMeasure = false;
  let snapNext = true;
  let idleTimer = 0;
  // Tape mode (one line): the scroll, and what the caret was doing at the last measure.
  let tapeScroll = 0;
  let tapeWord = null;
  let measuredPosition = 0;
  let wasTape = false;

  function setState(state) {
    wrap.dataset.caret = state;
  }

  // Tape mode: a re-layout or restart jumps straight to the new position; only steps use the
  // ~150 ms scroll from the stylesheet.
  function setScroll(transform, instant) {
    if (!instant) {
      if (display.style.transform !== transform) display.style.transform = transform;
      return;
    }
    display.style.transition = 'none';
    display.style.transform = transform;
    display.getBoundingClientRect();
    display.style.transition = '';
  }

  // One line: the caret travels right, and the tape steps by whole words near the right edge.
  function measureTape(x, current, lineHeight, realign) {
    const forward = position > measuredPosition;
    measuredPosition = position;
    const word = current?.parentElement?.classList.contains('word') ? current.parentElement : null;
    const entered = word && (realign || (forward && word !== tapeWord));
    if (word) tapeWord = word;
    let span = null;
    if (entered) {
      const { left } = offsetIn(word, display);
      span = { left, right: left + word.offsetWidth };
    }
    const fade = parseFloat(getComputedStyle(wrap).getPropertyValue('--tape-fade')) || 0;
    tapeScroll = tapeOffset({ offset: tapeScroll, caret: x, word: span, width: display.clientWidth, margin: lineHeight * 0.6, fade, realign });
    const scrolled = String(tapeScroll > 0);
    if (wrap.dataset.tapeScrolled !== scrolled) wrap.dataset.tapeScrolled = scrolled;
    setScroll(tapeScroll ? `translateX(-${tapeScroll}px)` : '', realign);
  }

  function measure() {
    const lineHeight = parseFloat(getComputedStyle(display).lineHeight) || 48;
    const current = characters[position];
    const last = characters[characters.length - 1];
    let x = 0;
    let top = 0;
    if (current) {
      ({ left: x, top } = offsetIn(current, display));
    } else if (last) {
      ({ left: x, top } = offsetIn(last, display));
      x += last.offsetWidth;
    }
    caretX.target = x;
    // Keep the caret in the display's real content coordinates; the display
    // transform below removes the spacer from its visible position. Snap to
    // the row: a space's inline box sits lower than the letters around it.
    caretY.target = Math.floor((top + lineHeight * 0.25) / lineHeight) * lineHeight;

    const tape = Boolean(options.tape?.());
    if (tape !== wasTape) {
      // Switching layouts starts the tape from the beginning of the line; realign places it.
      wasTape = tape;
      tapeScroll = 0;
      tapeWord = null;
      wrap.dataset.tapeScrolled = 'false';
      // Leaving the tape drops its sideways scroll at once; the three lines then scroll as usual.
      if (!tape) setScroll('', true);
    }
    if (tape) measureTape(x, current, lineHeight, snapNext);
    else {
      const spacer = display.querySelector('.passage-spacer');
      const spacerHeight = spacer?.offsetHeight || 0;
      const logicalTop = top - spacerHeight;
      const nextLine = Math.floor((logicalTop + lineHeight * 0.25) / lineHeight);
      if (nextLine !== line) {
        line = nextLine;
      }
      const scrollY = spacerHeight + Math.max(0, line - 1) * lineHeight;
      display.style.transform = scrollY ? `translateY(-${scrollY}px)` : '';
    }
    if (snapNext || reducedMotion.matches) {
      springs.forEach((s) => snap(s, s.target));
      snapNext = false;
    }
  }

  function render() {
    caret.style.transform = `translate3d(${caretX.value}px, ${caretY.value}px, 0)`;
  }

  function tick(time) {
    frame = 0;
    const dt = Math.min(0.034, lastTime ? (time - lastTime) / 1000 : 0.016);
    lastTime = time;
    if (needsMeasure) {
      needsMeasure = false;
      measure();
    }
    let moving = false;
    // Two substeps keep stiff springs stable on slow frames.
    for (let i = 0; i < 2; i += 1) for (const s of springs) moving = stepSpring(s, dt / 2) || moving;
    render();
    if (moving) schedule();
    else lastTime = 0;
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  // Where the ghost sits at `index` (a letter's left edge, or past the last letter), measured
  // once per letter: in between, the frame only moves the caret along that letter's width.
  function ghostSpot(index) {
    if (ghost.spot?.index === index && ghost.spot.target?.isConnected) return ghost.spot;
    options.ensureCharacters?.(index);
    const target = characters[Math.min(index, characters.length - 1)];
    if (!target?.isConnected) return { index, hidden: true };
    const lineHeight = parseFloat(getComputedStyle(display).lineHeight) || 60;
    let { left, top } = offsetIn(target, display);
    const width = target.offsetWidth;
    if (index >= characters.length) left += width;
    const row = Math.floor((top + lineHeight * 0.25) / lineHeight) * lineHeight;
    ghost.spot = { index, target, hidden: false, left, row, width: index >= characters.length ? 0 : width };
    return ghost.spot;
  }

  // `at` is a position in characters, fractional while the ghost is between two letters.
  function placeGhost(at) {
    if (!characters.length) return;
    const clamped = Math.max(0, Math.min(at, characters.length));
    const index = Math.floor(clamped);
    const spot = ghostSpot(index);
    ghostCaret.classList.toggle('is-hidden', spot.hidden);
    if (spot.hidden) return;
    const left = spot.left + (clamped - index) * spot.width;
    ghostCaret.style.transform = `translate3d(${left}px, ${spot.row}px, 0)`;
  }

  // A recorded run's position at `elapsed`: still between keys, gliding into the next one.
  function replayAt(elapsed) {
    const { points } = ghost;
    while (ghost.cursor < points.length && points[ghost.cursor][0] <= elapsed) ghost.cursor += 1;
    const [fromTime, from] = ghost.cursor ? points[ghost.cursor - 1] : [0, 0];
    const next = points[ghost.cursor];
    if (!next || reducedMotion.matches) return from;
    const glide = Math.min(REPLAY_GLIDE_MS, next[0] - fromTime);
    const progress = glide > 0 ? (elapsed - (next[0] - glide)) / glide : 0;
    return progress > 0 ? from + (next[1] - from) * Math.min(1, progress) : from;
  }

  function ghostTick(now) {
    ghost.frame = 0;
    if (!ghost.armed || !ghost.start) return;
    const elapsed = now - ghost.start;
    let at;
    let done;
    if (ghost.points) {
      at = replayAt(elapsed);
      done = ghost.cursor >= ghost.points.length;
    } else {
      // The pacer moves continuously at its speed, so it glides through each letter.
      at = (elapsed / 1000) * ghost.cps;
      done = at >= characters.length;
    }
    placeGhost(at);
    if (!done) ghost.frame = requestAnimationFrame(ghostTick);
  }

  function stopGhost() {
    cancelAnimationFrame(ghost.frame);
    ghost.frame = 0;
    ghost.start = 0;
  }

  return {
    reset(nextCharacters) {
      characters = nextCharacters;
      position = 0;
      line = 0;
      tapeScroll = 0;
      tapeWord = null;
      measuredPosition = 0;
      clearTimeout(idleTimer);
      // Into or out of the tape, the old scroll drops at once: easing it would slide the passage.
      if (wasTape || options.tape?.()) setScroll('', true);
      else display.style.transform = '';
      wrap.dataset.blocked = 'false';
      stopGhost();
      ghost.spot = null;
      ghost.cursor = 0;
      display.append(ghostCaret, caret);
      ghostCaret.classList.toggle('is-hidden', !ghost.armed);
      if (ghost.armed) requestAnimationFrame(() => { if (ghost.armed) placeGhost(0); });
      setState('idle');
      snapNext = true;
      needsMeasure = true;
      schedule();
    },

    // outcome: 'correct' | 'wrong' | 'blocked' | 'delete'. Only position and blocked affect the caret.
    update(nextPosition, _outcome, blocked) {
      position = nextPosition;
      wrap.dataset.blocked = String(Boolean(blocked));
      setState('typing');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => setState('idle'), IDLE_AFTER_MS);
      needsMeasure = true;
      schedule();
    },

    finish() {
      stopGhost();
      ghostCaret.classList.add('is-hidden');
      clearTimeout(idleTimer);
      setState('done');
    },

    // Ghost pacer: moves at a fixed characters-per-second from the first keystroke.
    ghost: {
      // startTime joins a run already in progress: the next frame places the caret where the
      // pace has reached, so it never jumps back to the start.
      arm(cps, startTime = 0) {
        ghost.armed = cps > 0;
        ghost.cps = cps;
        ghost.points = null;
        ghost.cursor = 0;
        ghost.spot = null;
        ghostCaret.removeAttribute('data-replay');
        if (!ghost.armed) {
          stopGhost();
          ghostCaret.classList.add('is-hidden');
        } else if (startTime && !reducedMotion.matches) {
          ghost.start = startTime;
          if (!ghost.frame) ghost.frame = requestAnimationFrame(ghostTick);
        } else {
          placeGhost(0);
        }
      },
      // A friend's recorded run: the ghost glides to where their caret was at each of their keys.
      replay(points) {
        stopGhost();
        ghost.points = points?.length ? points : null;
        ghost.armed = Boolean(ghost.points);
        ghost.cps = 0;
        ghost.cursor = 0;
        ghost.spot = null;
        ghostCaret.toggleAttribute('data-replay', ghost.armed);
        ghostCaret.classList.toggle('is-hidden', !ghost.armed);
        if (ghost.armed) placeGhost(0);
      },
      run(startTime) {
        // The pacer is decoration and stays put under reduced motion. A recorded run is the race
        // itself, so under reduced motion it still steps from key to key, with no glide.
        if (!ghost.armed || (reducedMotion.matches && !ghost.points)) return;
        ghost.start = startTime;
        if (!ghost.frame) ghost.frame = requestAnimationFrame(ghostTick);
      },
      disarm() {
        ghost.armed = false;
        stopGhost();
        ghostCaret.classList.add('is-hidden');
      },
    },

    relayout() {
      ghost.spot = null;
      if (!characters.length) return;
      line = -1;
      snapNext = true;
      needsMeasure = true;
      schedule();
    },
  };
}
