// Typing-surface motion: a spring-driven caret, line scrolling, and an optional
// ghost caret (the hidden pacer, or a friend's recorded run in a ghost race).
// Nothing decorative moves while a run is in progress. Everything here is
// presentational; scoring never reads from it.

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
  // A pacer moves at `cps`; a recorded run follows `points`, [ms from the first key, characters typed].
  const ghost = { cps: 0, points: null, cursor: 0, start: 0, frame: 0, index: -1, armed: false };

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

  function setState(state) {
    wrap.dataset.caret = state;
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
    const spacer = display.querySelector('.passage-spacer');
    const spacerHeight = spacer?.offsetHeight || 0;
    const logicalTop = top - spacerHeight;
    const nextLine = Math.floor((logicalTop + lineHeight * 0.25) / lineHeight);
    caretX.target = x;
    // Keep the caret in the display's real content coordinates; the display
    // transform below removes the spacer from its visible position. Snap to
    // the row: a space's inline box sits lower than the letters around it.
    caretY.target = Math.floor((top + lineHeight * 0.25) / lineHeight) * lineHeight;

    if (nextLine !== line) {
      line = nextLine;
    }
    const scrollY = spacerHeight + Math.max(0, line - 1) * lineHeight;
    display.style.transform = scrollY ? `translateY(-${scrollY}px)` : '';
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
    const elapsed = now - ghost.start;
    let index;
    let done;
    if (ghost.points) {
      while (ghost.cursor < ghost.points.length && ghost.points[ghost.cursor][0] <= elapsed) ghost.cursor += 1;
      index = ghost.cursor ? ghost.points[ghost.cursor - 1][1] : 0;
      done = ghost.cursor >= ghost.points.length;
    } else {
      index = Math.floor((elapsed / 1000) * ghost.cps);
      done = index >= characters.length;
    }
    placeGhost(Math.min(index, characters.length));
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
      clearTimeout(idleTimer);
      display.style.transform = '';
      wrap.dataset.blocked = 'false';
      stopGhost();
      ghost.index = -1;
      ghost.cursor = 0;
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
        ghost.points = null;
        ghost.cursor = 0;
        ghost.index = -1;
        ghostCaret.classList.toggle('is-hidden', !ghost.armed);
        if (ghost.armed) placeGhost(0);
        else stopGhost();
      },
      // A friend's recorded run: the ghost jumps to where their caret was at each of their keys.
      replay(points) {
        stopGhost();
        ghost.points = points?.length ? points : null;
        ghost.armed = Boolean(ghost.points);
        ghost.cps = 0;
        ghost.cursor = 0;
        ghost.index = -1;
        ghostCaret.classList.toggle('is-hidden', !ghost.armed);
        if (ghost.armed) placeGhost(0);
      },
      run(startTime) {
        // The pacer is decoration and stays put under reduced motion. A recorded run is the race
        // itself, so it still steps from key to key, with no transition, like a race progress bar.
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
      ghost.index = -1;
      if (!characters.length) return;
      line = -1;
      snapNext = true;
      needsMeasure = true;
      schedule();
    },
  };
}
