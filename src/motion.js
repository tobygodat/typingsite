// Typing-surface motion: a spring-driven caret, line scrolling (or tape steps),
// and an optional ghost pacer. Nothing decorative moves while a run is in
// progress. Everything here is presentational; scoring never reads from it.

import { tapeOffset } from './tape.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const IDLE_AFTER_MS = 800;

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
  const ghost = { cps: 0, start: 0, frame: 0, index: -1, armed: false };

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

  // A re-layout jumps straight to the new position; only steps and line changes use the
  // ~150 ms scroll from the stylesheet.
  function setScroll(transform, instant) {
    if (display.style.transform === transform) return;
    if (!instant) {
      display.style.transform = transform;
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
      setScroll(scrollY ? `translateY(-${scrollY}px)` : '', snapNext);
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

  function placeGhost(index) {
    if (!characters.length) return;
    const target = characters[Math.min(index, characters.length - 1)];
    const hidden = ghostCaret.classList.contains('is-hidden');
    if (index === ghost.index && (target?.isConnected ? !hidden : hidden)) return;
    ghost.index = index;
    options.ensureCharacters?.(index);
    if (!target?.isConnected) {
      ghostCaret.classList.add('is-hidden');
      return;
    }
    const lineHeight = parseFloat(getComputedStyle(display).lineHeight) || 60;
    ghostCaret.classList.remove('is-hidden');
    let { left, top } = offsetIn(target, display);
    if (index >= characters.length) left += target.offsetWidth;
    const row = Math.floor((top + lineHeight * 0.25) / lineHeight) * lineHeight;
    ghostCaret.style.transform = `translate3d(${left}px, ${row}px, 0)`;
  }

  function ghostTick(now) {
    ghost.frame = 0;
    if (!ghost.armed || !ghost.start) return;
    const index = Math.floor(((now - ghost.start) / 1000) * ghost.cps);
    placeGhost(Math.min(index, characters.length));
    if (index < characters.length) ghost.frame = requestAnimationFrame(ghostTick);
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
      setScroll('', true);
      wrap.dataset.blocked = 'false';
      stopGhost();
      ghost.index = -1;
      display.append(ghostCaret, caret);
      ghostCaret.classList.toggle('is-hidden', !ghost.armed);
      if (ghost.armed) requestAnimationFrame(() => placeGhost(0));
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
      arm(cps) {
        ghost.armed = cps > 0;
        ghost.cps = cps;
        ghost.index = -1;
        ghostCaret.classList.toggle('is-hidden', !ghost.armed);
        if (ghost.armed) placeGhost(0);
        else stopGhost();
      },
      run(startTime) {
        if (!ghost.armed || reducedMotion.matches) return;
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
      ghost.index = -1;
      if (!characters.length) return;
      line = -1;
      snapNext = true;
      needsMeasure = true;
      schedule();
    },
  };
}
