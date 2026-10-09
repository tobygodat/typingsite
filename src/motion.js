// Typing-surface motion: a spring-driven caret, line scrolling, and an optional
// ghost caret (the pacer, or a recorded best being raced). Nothing decorative moves
// while a run is in progress. Everything here is presentational; scoring never reads from it.

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
  const ghost = { cps: 0, track: null, start: 0, frame: 0, index: -1, armed: false };

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
    // A recorded ghost could only jump under reduced motion, so it is hidden there (the pacer
    // instead stands still).
    if (ghost.track && reducedMotion.matches) {
      ghostCaret.classList.add('is-hidden');
      return;
    }
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
    const index = ghost.track ? ghost.track.at(elapsed) : Math.floor((elapsed / 1000) * ghost.cps);
    placeGhost(Math.min(index, characters.length));
    // A recorded ghost stops where its run stopped; the pacer stops at the end of the text.
    if (ghost.track ? elapsed < ghost.track.endMs : index < characters.length) ghost.frame = requestAnimationFrame(ghostTick);
  }

  function stopGhost() {
    cancelAnimationFrame(ghost.frame);
    ghost.frame = 0;
    ghost.start = 0;
  }

  // Reduced motion can change during a run. Turned on, the ghost stops at once and a recorded one
  // hides; turned off, it comes back where its run has reached (at the start before the first key).
  reducedMotion.addEventListener('change', () => {
    if (!ghost.armed || wrap.dataset.caret === 'done') return;
    if (reducedMotion.matches) {
      cancelAnimationFrame(ghost.frame);
      ghost.frame = 0;
      if (ghost.track) ghostCaret.classList.add('is-hidden');
    } else if (ghost.start) {
      if (!ghost.frame) ghost.frame = requestAnimationFrame(ghostTick);
    } else placeGhost(0);
  });

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
      display.append(ghostCaret, caret);
      ghostCaret.classList.toggle('is-hidden', !ghost.armed);
      // Checked again when the frame runs: the caller usually re-arms or disarms right after reset.
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
      arm(cps) {
        ghost.armed = cps > 0;
        ghost.cps = cps;
        ghost.track = null;
        ghost.index = -1;
        ghostCaret.classList.remove('is-recorded');
        ghostCaret.classList.toggle('is-hidden', !ghost.armed);
        if (ghost.armed) placeGhost(0);
        else stopGhost();
      },
      // A recorded ghost: track.at(ms) is its caret position that long after the first keystroke.
      // It steps letter to letter with no easing and is drawn at full opacity (3:1 on both grounds).
      // Under reduced motion it couldn't move, so it is hidden there, also when the setting changes
      // mid-race (the pacer instead stands still at the start).
      follow(track) {
        ghost.armed = Boolean(track);
        ghost.cps = 0;
        ghost.track = track || null;
        ghost.index = -1;
        ghostCaret.classList.toggle('is-recorded', ghost.armed);
        ghostCaret.classList.toggle('is-hidden', !ghost.armed);
        if (ghost.armed) placeGhost(0);
        else stopGhost();
      },
      // The clock starts under reduced motion too, so the ghost can rejoin its run if that is turned off.
      run(startTime) {
        if (!ghost.armed) return;
        ghost.start = startTime;
        if (!ghost.frame && !reducedMotion.matches) ghost.frame = requestAnimationFrame(ghostTick);
      },
      disarm() {
        ghost.armed = false;
        ghost.track = null;
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
