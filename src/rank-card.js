// The rated result card: a settled quick match drawn from ratingResult's model (src/quick-match.js). The rank's
// emblem, its name, the rating counting to where it settled, the change, one bar for the step, and soft wind
// behind it all. Presentational only: scoring and the rating maths never import this. The card is decoration for
// sighted readers; the status sentence beside it carries everything to a screen reader.
//
// Every colour the card draws is here, one table for the ranks and one for the card itself, and none follow the
// theme's accent. The card's own colour scheme does follow the theme: each colour is written as light-dark(), so a
// light theme gets the paper card and a dark theme the dark one (tests/rank-card.test.js checks every pair).
import { signed } from './quick-match.js';

// Each rank's mark, drawn in the emblem's 132-unit box. `a` carries text and the bright end of each gradient, `b`
// the other end, the tint behind the card and the wind. The light card deepens both so they hold their contrast on
// paper. `wind` is the trails behind the card: how many across a card 420 wide, how fast, how much they curl.
// `sway` is the seconds the mark takes to drift across and back.
export const RANK_LOOKS = Object.freeze({
  Whisper: {
    mark: '<path d="M38 76 H80 a13 13 0 1 0 -13 -13"/>',
    dark: { a: '#d9dee0', b: '#8c979d' }, light: { a: '#4e5659', b: '#5f696d' },
    wind: { trails: 14, speed: 0.25, curl: 0.2 }, sway: 20,
  },
  Breeze: {
    mark: '<path d="M46 88 C44 62, 62 44, 90 42 C92 68, 74 88, 46 88 Z"/><path d="M46 88 L76 56"/>',
    dark: { a: '#b9f2d0', b: '#3fae86' }, light: { a: '#25664e', b: '#2a755a' },
    wind: { trails: 34, speed: 0.5, curl: 0.4 }, sway: 16,
  },
  Gust: {
    mark: '<path d="M38 54 H76 a8 8 0 1 0 -8 -8"/><path d="M38 67 H86 a8 8 0 1 1 -8 8"/><path d="M38 80 H60"/>',
    dark: { a: '#a9e9f5', b: '#419ec6' }, light: { a: '#25607a', b: '#2a6f8c' },
    wind: { trails: 56, speed: 0.8, curl: 0.6 }, sway: 12,
  },
  Gale: {
    mark: '<path d="M46 40 V96"/><path d="M46 44 C58 36, 68 54, 92 44 L88 68 C70 76, 58 60, 46 68 Z"/>',
    dark: { a: '#8ff3ff', b: '#2aa7c9' }, light: { a: '#196175', b: '#1c7087' },
    wind: { trails: 80, speed: 1.15, curl: 0.8 }, sway: 9,
  },
  Tempest: {
    mark: '<path d="M48 66 H86 a11 11 0 0 0 0 -22 a16 16 0 0 0 -30 -4 a13 13 0 0 0 -8 26 Z"/><path d="M70 72 L60 86 H71 L64 100"/>',
    dark: { a: '#c7b8ff', b: '#948ae2' }, light: { a: '#423885', b: '#6456c9' },
    wind: { trails: 110, speed: 1.6, curl: 1.1 }, sway: 6,
  },
  Hurricane: {
    mark: '<circle cx="66" cy="66" r="6"/><path d="M66 49 a17 17 0 0 1 17 17"/><path d="M66 83 a17 17 0 0 1 -17 -17"/>'
      + '<path d="M90 52 a28 28 0 0 1 -12 39"/><path d="M42 80 a28 28 0 0 1 12 -39"/>',
    dark: { a: '#ffd9a8', b: '#e17442' }, light: { a: '#8b4525', b: '#a0502b' },
    wind: { trails: 150, speed: 2.2, curl: 1.5 }, sway: 4,
  },
});

// A provisional result has no rank yet: a neutral card with no emblem, no bar and no wind.
export const PROVISIONAL_LOOK = Object.freeze({ dark: { a: '#e6e2dc', b: '#99948e' }, light: { a: '#595651', b: '#6d6964' } });

// The card itself on each scheme. The ground is a glow from the top, `tint` of the rank's `b` over `base`, falling
// through `mid` to `edge`. `hull` fills the emblem's hexagon and `track` is the bar's empty part. `trail` is how
// opaque the wind is.
export const CARD = Object.freeze({
  dark: {
    base: '#0b0f11', mid: '#0d1214', edge: '#0a0c0d', tint: 0.26, ink: '#eef6f7', soft: 'rgba(238, 246, 247, 0.62)',
    hull: 'rgba(0, 0, 0, 0.35)', track: 'rgba(255, 255, 255, 0.09)', gain: '#ffffff', up: '#86f0a8', down: '#ff8a6b', trail: 0.22,
  },
  light: {
    base: '#fbf9f5', mid: '#f6f3ed', edge: '#f1ede5', tint: 0.22, ink: '#1b1a19', soft: 'rgba(27, 26, 25, 0.7)',
    hull: 'rgba(255, 255, 255, 0.6)', track: 'rgba(27, 26, 25, 0.1)', gain: '#1b1a19', up: '#1c623b', down: '#9a3420', trail: 0.2,
  },
});

// One timeline for the card, in ms. CSS reads the bar's from a custom property set here, so the two never drift.
export const TIMING = Object.freeze({ count: 1100, countDelay: 500, bar: 1000, barDelay: 700, stagePause: 400 });

const rgb = (hex) => hex.match(/[0-9a-f]{2}/gi).map((pair) => parseInt(pair, 16));
const mixed = (x, y, share) => rgb(x).map((value, i) => Math.round(value * share + rgb(y)[i] * (1 - share)));
const css = ([r, g, b], alpha = 1) => (alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`);

// Every colour the card draws on one scheme, as CSS colours.
export function cardColours(look, scheme) {
  const card = CARD[scheme];
  const { a, b } = look[scheme];
  const trail = scheme === 'dark' ? mixed(a, b, 0.5) : rgb(b);

  return {
    a, b, top: css(mixed(b, card.base, card.tint)), mid: card.mid, edge: card.edge, ink: card.ink, soft: card.soft, hull: card.hull,
    track: card.track, gain: card.gain, up: card.up, down: card.down, glow: css(rgb(b), 0.5), trail: css(trail, card.trail),
  };
}

// The wind. Trails drift across the card and fade, kept clear of every line of text, the emblem and the bar: each
// segment's opacity falls to nothing over FEATHER px as it nears one. A win blows left to right, a loss back.
const WIND = Object.freeze({ width: 420, feather: 24, pad: 4, fade: 0.035, line: 1.2, stillFrames: 260, remeasure: 30 });

function textBox(element) {
  if (!element.matches('[data-rc-text]')) return element.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(element);

  return range.getBoundingClientRect();
}

function startWind(canvas, card, { wind, direction, still }) {
  const ctx = canvas.getContext('2d');

  if (!ctx) return () => {};

  let width = 0;
  let height = 0;
  let dots = [];
  let keepClear = [];
  let colour = '';
  let frame = 0;
  let raf = 0;
  let onScreen = true;

  const measure = () => {
    const box = canvas.getBoundingClientRect();
    keepClear = [...card.querySelectorAll('[data-rc-clear]')].flatMap((element) => {
      const rect = element.offsetParent ? textBox(element) : null;

      return rect?.width && rect.height ? [{ left: rect.left - box.left - WIND.pad, right: rect.right - box.left + WIND.pad,
        top: rect.top - box.top - WIND.pad, bottom: rect.bottom - box.top + WIND.pad }] : [];
    });
    colour = getComputedStyle(canvas).color;
  };

  const clearance = (x, y) => {
    let nearest = WIND.feather;

    for (const rect of keepClear) {
      const dx = Math.max(rect.left - x, 0, x - rect.right);
      const dy = Math.max(rect.top - y, 0, y - rect.bottom);
      nearest = Math.min(nearest, Math.hypot(dx, dy));
    }

    return nearest / WIND.feather;
  };

  const seed = () => ({ x: Math.random() * width, y: Math.random() * height, pace: 0.5 + Math.random() });

  const step = (time) => {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0, 0, 0, ${WIND.fade})`;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = colour;
    ctx.lineWidth = WIND.line;
    ctx.lineCap = 'round';

    for (const dot of dots) {
      const turn = (Math.sin(dot.x * 0.008 + time * 0.0002) + Math.cos(dot.y * 0.012 - time * 0.00015)) * wind.curl;
      const x = dot.x + direction * Math.cos(turn * 0.5) * dot.pace * wind.speed;
      const y = dot.y + Math.sin(turn) * dot.pace * wind.speed * 0.5;
      const alpha = Math.min(clearance(dot.x, dot.y), clearance(x, y));

      if (alpha > 0) {
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(dot.x, dot.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      Object.assign(dot, { x, y });

      if (x > width + 4 || x < -4 || y < -4 || y > height + 4) Object.assign(dot, { x: direction > 0 ? -2 : width + 2, y: Math.random() * height });
    }

    ctx.globalAlpha = 1;
  };

  const resize = () => {
    const ratio = Math.min(2, devicePixelRatio || 1);
    [width, height] = [canvas.clientWidth, canvas.clientHeight];
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    dots = Array.from({ length: Math.max(1, Math.round((wind.trails * width) / WIND.width)) }, seed);
    measure();

    if (still) for (let i = 0; i < WIND.stillFrames; i += 1) step(i * 16);
  };

  const tick = (time) => {
    frame += 1;

    if (frame % WIND.remeasure === 0) measure();
    step(time);
    raf = requestAnimationFrame(tick);
  };

  // Runs only while the card is on screen and the tab is showing.
  const sync = () => {
    const run = !still && onScreen && !document.hidden;

    if (run && !raf) raf = requestAnimationFrame(tick);
    else if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
  };

  const sizes = new ResizeObserver(() => resize());
  const sight = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; sync(); });
  sizes.observe(canvas);
  sight.observe(card);
  document.addEventListener('visibilitychange', sync);

  return () => {
    cancelAnimationFrame(raf);
    raf = 0;
    sizes.disconnect();
    sight.disconnect();
    document.removeEventListener('visibilitychange', sync);
  };
}

let gradients = 0;

// The card in `slot`, built from `template`. show(model) replaces whatever was there and plays it once; clear()
// empties the slot and stops everything the last card started.
export function createRankCard(slot, template) {
  let stop = () => {};

  function clear() {
    stop();
    slot.replaceChildren();
    slot.hidden = true;
  }

  function show(model) {
    clear();

    if (!model || model.kind === 'unrated') return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const card = template.content.firstElementChild.cloneNode(true);
    const part = (name) => card.querySelector(`[data-rc="${name}"]`);
    const ranked = model.kind === 'ranked';
    const look = ranked ? RANK_LOOKS[model.rank.name] : PROVISIONAL_LOOK;
    const [light, dark] = [cardColours(look, 'light'), cardColours(look, 'dark')];
    const timers = [];
    const later = (ms, run) => timers.push(setTimeout(run, ms));
    let counting = 0;

    for (const name of Object.keys(dark)) card.style.setProperty(`--rc-${name}`, `light-dark(${light[name]}, ${dark[name]})`);
    card.style.setProperty('--rc-bar', `${TIMING.bar}ms`);
    Object.assign(card.dataset, { kind: model.kind, tone: model.tone, motion: still ? 'still' : 'moving' });

    if (ranked) card.style.setProperty('--rc-sway', `${look.sway}s`);
    part('label').textContent = model.label;
    part('emblem').hidden = !ranked;
    part('rank').hidden = !ranked;
    part('bar').hidden = !ranked;
    part('ends').hidden = !ranked;
    part('from').hidden = !model.moved;
    part('count').hidden = ranked;
    part('why').hidden = !model.why;
    part('why').textContent = model.why || '';
    part('delta').textContent = signed(model.delta);
    part('count').textContent = `${model.races} rated ${model.races === 1 ? 'race' : 'races'} · provisional`;

    if (ranked) {
      const id = `rank-card-gradient-${gradients += 1}`;
      card.querySelector('linearGradient').id = id;
      card.querySelectorAll('[data-rc-stroke]').forEach((shape) => shape.setAttribute('stroke', `url(#${id})`));
      part('mark').innerHTML = look.mark;
      part('step').textContent = model.rank.step || '';
      part('rank').textContent = model.rank.label;
      part('from').textContent = model.moved ? `${model.moved === 'promoted' ? 'promoted' : 'down'} from ${model.was.label}` : '';
    }

    const rating = part('rating');
    const fill = card.querySelector('.rc-fill');
    const change = card.querySelector('.rc-change');
    const [left, right] = part('ends').children;

    // One stage of the bar, before its change plays or after. A gain is laid on the end of the fill; a loss
    // pulls the fill back and leaves the lost stretch behind it.
    const draw = (bar, done) => {
      const gain = bar.to >= bar.from;
      const [lo, hi] = [Math.min(bar.from, bar.to), Math.max(bar.from, bar.to)];
      fill.style.transform = `translateX(${((done && !gain ? bar.to : bar.from) - 1) * 100}%)`;
      Object.assign(change.style, { left: `${lo * 100}%`, width: `${(hi - lo) * 100}%`, transform: `scaleX(${done ? 1 : 0})` });
      change.dataset.change = gain ? 'gain' : 'loss';
      left.textContent = bar.rankLabel;
      right.textContent = bar.next ? `${bar.toNext} to ${bar.next}` : '';
    };

    const stage = (index) => {
      card.querySelector('.rc-bar').dataset.reset = '';
      draw(model.bars[index], false);
      fill.getBoundingClientRect();
      delete card.querySelector('.rc-bar').dataset.reset;
      later(index ? TIMING.stagePause : TIMING.barDelay, () => {
        draw(model.bars[index], true);

        if (index + 1 < model.bars.length) later(TIMING.bar + TIMING.stagePause, () => stage(index + 1));
      });
    };

    slot.append(card);
    slot.hidden = false;

    if (still) {
      rating.textContent = String(model.rating.to);

      if (ranked) draw(model.bars.at(-1), true);
    } else {
      rating.textContent = String(model.rating.from);
      const start = performance.now() + TIMING.countDelay;

      const count = (now) => {
        const t = Math.min(1, Math.max(0, (now - start) / TIMING.count));
        rating.textContent = String(Math.round(model.rating.from + (model.rating.to - model.rating.from) * (1 - (1 - t) ** 3)));
        counting = t < 1 ? requestAnimationFrame(count) : 0;
      };

      counting = requestAnimationFrame(count);

      if (ranked) stage(0);
    }

    const calm = ranked ? startWind(card.querySelector('canvas'), card, { wind: look.wind, direction: model.tone === 'down' ? -1 : 1, still }) : () => {};

    stop = () => {
      timers.forEach(clearTimeout);
      cancelAnimationFrame(counting);
      calm();
    };
  }

  return { show, clear };
}
