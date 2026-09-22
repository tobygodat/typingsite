// Typing-surface motion: a spring-driven caret, a word lens that glides to the
// word being typed, and a light whose warmth follows the current clean streak.
// Everything here is presentational; scoring never reads from it.

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const STREAK_FOR_FULL_HEAT = 40;
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

// Offsets relative to the display, even while an entering word is its own offsetParent.
function offsetIn(element, display) {
  let left = 0;
  let top = 0;
  for (let node = element; node && node !== display; node = node.offsetParent) {
    left += node.offsetLeft;
    top += node.offsetTop;
  }
  return { left, top };
}

export function createTypingFx(wrap, display) {
  const scope = wrap.parentElement;
  scope.classList.add('fx-scope');

  const light = document.createElement('span');
  light.className = 'caret-light';
  const lens = document.createElement('span');
  lens.className = 'word-lens';
  const caret = document.createElement('span');
  caret.className = 'caret';
  const bar = document.createElement('span');
  bar.className = 'caret-bar';
  caret.append(bar);
  for (const node of [light, lens, caret]) node.setAttribute('aria-hidden', 'true');

  const caretX = spring(1400, 70);
  const caretY = spring(900, 60);
  const lensX = spring(520, 42);
  const lensW = spring(520, 42);
  const lensY = spring(520, 46);
  const springs = [caretX, caretY, lensX, lensW, lensY];

  let characters = [];
  let position = 0;
  let line = 0;
  let streak = 0;
  let heat = 0;
  let appliedHeat = -1;
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
    const nextLine = Math.floor((top + lineHeight * 0.25) / lineHeight);
    const y = nextLine * lineHeight;

    let word = current?.parentElement?.classList.contains('word') ? current.parentElement : current?.nextElementSibling;
    if (word && !word.classList.contains('word')) word = null;
    lens.classList.toggle('is-hidden', !word);
    if (word) {
      const pad = parseFloat(getComputedStyle(display).fontSize) * 0.28;
      const box = offsetIn(word, display);
      lensX.target = box.left - pad;
      lensW.target = word.offsetWidth + pad * 2;
      lensY.target = Math.floor((box.top + lineHeight * 0.25) / lineHeight) * lineHeight;
    }
    caretX.target = x;
    caretY.target = y;

    if (nextLine !== line) {
      line = nextLine;
      display.style.transform = line > 1 ? `translateY(-${(line - 1) * lineHeight}px)` : '';
    }
    if (snapNext || reducedMotion.matches) {
      springs.forEach((s) => snap(s, s.target));
      snapNext = false;
    }
  }

  function render() {
    caret.style.transform = `translate3d(${caretX.value}px, ${caretY.value}px, 0)`;
    light.style.transform = `translate3d(${caretX.value}px, ${caretY.value}px, 0)`;
    lens.style.transform = `translate3d(${lensX.value}px, ${lensY.value}px, 0)`;
    lens.style.width = `${Math.max(0, lensW.value)}px`;
    // --heat is inherited by every letter, so write it in coarse steps; CSS transitions smooth the gaps.
    const steppedHeat = Math.round(heat * 20) / 20;
    if (steppedHeat !== appliedHeat) {
      scope.style.setProperty('--heat', String(steppedHeat));
      appliedHeat = steppedHeat;
    }
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
    const targetHeat = Math.min(1, streak / STREAK_FOR_FULL_HEAT);
    const rate = targetHeat > heat ? 1.6 : 5;
    heat += (targetHeat - heat) * Math.min(1, dt * rate);
    if (Math.abs(targetHeat - heat) < 0.004) heat = targetHeat;
    else moving = true;
    render();
    if (moving) schedule();
    else lastTime = 0;
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  function nudge(element) {
    if (!element || reducedMotion.matches) return;
    element.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(-1.5px)' }, { transform: 'translateX(0)' }],
      { duration: 260, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    );
  }

  return {
    reset(nextCharacters) {
      characters = nextCharacters;
      position = 0;
      line = 0;
      streak = 0;
      heat = 0;
      clearTimeout(idleTimer);
      display.style.transform = '';
      wrap.dataset.blocked = 'false';
      display.prepend(light, lens);
      display.append(caret);
      setState('idle');
      snapNext = true;
      needsMeasure = true;
      schedule();
    },

    // outcome: 'correct' | 'wrong' | 'blocked' | 'delete'
    update(nextPosition, outcome, blocked) {
      position = nextPosition;
      if (outcome === 'correct') streak += 1;
      else if (outcome === 'wrong' || outcome === 'blocked') streak = 0;
      wrap.dataset.blocked = String(blocked);
      if (outcome === 'wrong' || outcome === 'blocked') {
        nudge(bar);
        nudge(characters[nextPosition - 1]);
      }
      setState('typing');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => setState('idle'), IDLE_AFTER_MS);
      needsMeasure = true;
      schedule();
    },

    finish() {
      clearTimeout(idleTimer);
      setState('done');
      streak = 0;
      schedule();
    },

    relayout() {
      if (!characters.length) return;
      line = -1;
      snapNext = true;
      needsMeasure = true;
      schedule();
    },
  };
}
