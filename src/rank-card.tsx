import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createStore } from './store.js';

type RatingModel = ReturnType<typeof ratingResult>;

type CardModel = Extract<NonNullable<RatingModel>, { rating: { from: number; to: number } }>;

// The rated result card: a settled quick match drawn from ratingResult's model (src/quick-match.js). The rank's
// emblem, its name, the rating counting to where it settled, the change, one bar for the step, and soft wind
// behind it all. Presentational only: scoring and the rating maths never import this. The card is decoration for
// sighted readers; the status sentence beside it carries everything to a screen reader.
//
// Every colour the card draws is here, one table for the ranks and one for the card itself, and none follow the
// theme's accent. The card's own colour scheme does follow the theme: each colour is written as light-dark(), so a
// light theme gets the paper card and a dark theme the dark one (tests/rank-card.test.js checks every pair).
import { signed, ratingResult } from './quick-match.js';

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

const rgb = (hex: string) => (hex.match(/[0-9a-f]{2}/gi) ?? []).map((pair) => parseInt(pair, 16));
const mixed = (x: string, y: string, share: number) => rgb(x).map((value, i) => Math.round(value * share + (rgb(y)[i] ?? 0) * (1 - share)));
const css = ([r, g, b]: number[], alpha = 1) => (alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`);

// Every colour the card draws on one scheme, as CSS colours.
export function cardColours(look: typeof PROVISIONAL_LOOK, scheme: 'dark' | 'light') {
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

function textBox(element: HTMLElement) {
  if (!element.matches('[data-rc-text]')) return element.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(element);

  return range.getBoundingClientRect();
}

function startWind(canvas: HTMLCanvasElement, card: HTMLElement, { wind, direction, still }: { wind: { trails: number; speed: number; curl: number }; direction: number; still: boolean }) {
  const ctx = canvas.getContext('2d');

  if (!ctx) return () => {};

  let width = 0;
  let height = 0;
  let dots: { x: number; y: number; pace: number }[] = [];
  let keepClear: { left: number; right: number; top: number; bottom: number }[] = [];
  let colour = '';
  let frame = 0;
  let raf = 0;
  let onScreen = true;

  const measure = () => {
    const box = canvas.getBoundingClientRect();
    keepClear = [...card.querySelectorAll<HTMLElement>('[data-rc-clear]')].flatMap((element) => {
      const rect = element.offsetParent ? textBox(element) : null;

      return rect?.width && rect.height ? [{ left: rect.left - box.left - WIND.pad, right: rect.right - box.left + WIND.pad,
        top: rect.top - box.top - WIND.pad, bottom: rect.bottom - box.top + WIND.pad }] : [];
    });
    colour = getComputedStyle(canvas).color;
  };

  const clearance = (x: number, y: number) => {
    let nearest: number = WIND.feather;

    for (const rect of keepClear) {
      const dx = Math.max(rect.left - x, 0, x - rect.right);
      const dy = Math.max(rect.top - y, 0, y - rect.bottom);
      nearest = Math.min(nearest, Math.hypot(dx, dy));
    }

    return nearest / WIND.feather;
  };

  const seed = () => ({ x: Math.random() * width, y: Math.random() * height, pace: 0.5 + Math.random() });

  const step = (time: number) => {
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

  const tick = (time: number) => {
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
  const sight = new IntersectionObserver(([entry]) => { onScreen = entry?.isIntersecting ?? false; sync(); });
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

function rankedLook(name: string) {
  const entry = Object.entries(RANK_LOOKS).find(([rank]) => rank === name);

  if (!entry) throw new Error(`Unknown rank ${name}`);

  return entry[1];
}

let gradients = 0;

function playCard(card: HTMLElement, model: CardModel) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ranked = model.rank ? rankedLook(model.rank.name) : null;
  const look = ranked ?? PROVISIONAL_LOOK;
  const light = cardColours(look, 'light');
  const dark = cardColours(look, 'dark');
  const timers: number[] = [];
  const later = (milliseconds: number, run: () => void) => timers.push(window.setTimeout(run, milliseconds));
  let counting = 0;

  const part = (name: string) => {
    const node = card.querySelector<HTMLElement>(`[data-rc="${name}"]`);

    if (!node) throw new Error(`Missing rank-card part ${name}`);

    return node;
  };

  for (const [name, value] of Object.entries(dark)) {
    const counterpart = Object.entries(light).find(([key]) => key === name)?.[1];
    card.style.setProperty(`--rc-${name}`, `light-dark(${counterpart}, ${value})`);
  }

  card.style.setProperty('--rc-bar', `${TIMING.bar}ms`);
  card.dataset.motion = still ? 'still' : 'moving';

  if (ranked) card.style.setProperty('--rc-sway', `${ranked.sway}s`);

  if (ranked) {
    const gradient = card.querySelector('linearGradient');

    if (!gradient) throw new Error('Missing rank-card gradient');
    const id = `rank-card-gradient-${gradients += 1}`;
    gradient.id = id;
    card.querySelectorAll('[data-rc-stroke]').forEach((shape) => shape.setAttribute('stroke', `url(#${id})`));
  }

  const rating = part('rating');
  const fill = card.querySelector<HTMLElement>('.rc-fill');
  const change = card.querySelector<HTMLElement>('.rc-change');
  const [left, right] = part('ends').children;

  if (!fill || !change || !left || !right) throw new Error('Missing rank-card bar');

  function draw(bar: CardModel['bars'][number], done: boolean) {
    if (!fill || !change || !left || !right) return;
    const gain = bar.to >= bar.from;
    const [lo, hi] = [Math.min(bar.from, bar.to), Math.max(bar.from, bar.to)];
    fill.style.transform = `translateX(${((done && !gain ? bar.to : bar.from) - 1) * 100}%)`;
    Object.assign(change.style, { left: `${lo * 100}%`, width: `${(hi - lo) * 100}%`, transform: `scaleX(${done ? 1 : 0})` });
    change.dataset.change = gain ? 'gain' : 'loss';
    left.textContent = bar.rankLabel;
    right.textContent = bar.next ? `${bar.toNext} to ${bar.next}` : '';
  }

  function stage(index: number) {
    const bar = model.bars[index];

    if (!bar) throw new Error('Missing rank-card stage');
    const root = part('bar');
    root.dataset.reset = '';
    draw(bar, false);
    fill?.getBoundingClientRect();
    delete root.dataset.reset;
    later(index ? TIMING.stagePause : TIMING.barDelay, () => {
      draw(bar, true);

      if (index + 1 < model.bars.length) later(TIMING.bar + TIMING.stagePause, () => stage(index + 1));
    });
  }

  if (still) {
    rating.textContent = String(model.rating.to);
    const bar = model.bars.at(-1);

    if (ranked && bar) draw(bar, true);
  } else {
    rating.textContent = String(model.rating.from);
    const start = performance.now() + TIMING.countDelay;

    const count = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / TIMING.count));
      rating.textContent = String(Math.round(model.rating.from + (model.rating.to - model.rating.from) * (1 - (1 - t) ** 3)));
      counting = t < 1 ? requestAnimationFrame(count) : 0;
    };

    counting = requestAnimationFrame(count);

    if (ranked) stage(0);
  }

  const canvas = card.querySelector('canvas');
  const calm = ranked && canvas ? startWind(canvas, card, { wind: ranked.wind, direction: model.tone === 'down' ? -1 : 1, still }) : () => {};

  return () => {
    timers.forEach(clearTimeout);
    cancelAnimationFrame(counting);
    calm();
  };
}

export function createRankCard() {
  const view = createStore<CardModel | null>(null);

  return {
    view,
    show(model: RatingModel) { flushSync(() => view.publish(model && model.rating !== undefined ? model : null)); },
    clear() { flushSync(() => view.publish(null)); },
  };
}

export type RankCardController = ReturnType<typeof createRankCard>;

export function RankCard({ controller }: { controller: RankCardController }) {
  const model = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const card = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (model && card.current) return playCard(card.current, model);
  }, [model]);
  const ranked = model?.rank ? rankedLook(model.rank.name) : null;

  return <div id="online-rank-card" className="rank-card-slot" aria-hidden="true" hidden={!model}>{model && <div ref={card} className="rank-card" data-kind={model.kind} data-tone={model.tone}>
    <canvas className="rc-wind"></canvas>
    <div className="rc-body">
      <p className="rc-label" data-rc="label" data-rc-clear="" data-rc-text="">{model.label}</p>
      <div className="rc-emblem" data-rc="emblem" data-rc-clear="" hidden={!ranked}>
        <svg viewBox="0 0 132 132" focusable="false">
          <defs><linearGradient gradientUnits="userSpaceOnUse" x1="14" y1="6" x2="118" y2="126"><stop className="rc-stop-a" offset="0" /><stop className="rc-stop-b" offset="1" /></linearGradient></defs>
          <polygon className="rc-hull" points="66,6 118,36 118,96 66,126 14,96 14,36" strokeWidth="4" data-rc-stroke="" />
          <g className="rc-mark" data-rc="mark" fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" data-rc-stroke="" dangerouslySetInnerHTML={{ __html: ranked?.mark ?? '' }}></g>
          <text className="rc-step" data-rc="step" x="66" y="118" textAnchor="middle" fontSize="13">{model.rank?.step ?? ''}</text>
        </svg>
      </div>
      <p className="rc-rank" data-rc="rank" data-rc-clear="" data-rc-text="" hidden={!ranked}>{model.rank?.label}</p>
      <p className="rc-from" data-rc="from" data-rc-clear="" data-rc-text="" hidden={!model.moved}>{model.moved ? `${model.moved === 'promoted' ? 'promoted' : 'down'} from ${model.was?.label}` : ''}</p>
      <p className="rc-nums" data-rc-clear="" data-rc-text=""><span className="rc-rating num" data-rc="rating">{model.rating.from}</span><span className="rc-delta num" data-rc="delta">{signed(model.delta)}</span></p>
      <p className="rc-count" data-rc="count" data-rc-clear="" data-rc-text="" hidden={Boolean(ranked)}>{model.races} rated {model.races === 1 ? 'race' : 'races'} · provisional</p>
      <div className="rc-bar" data-rc="bar" data-rc-clear="" hidden={!ranked}><span className="rc-fill"></span><span className="rc-change"></span></div>
      <p className="rc-ends" data-rc="ends" data-rc-clear="" data-rc-text="" hidden={!ranked}><span></span><span></span></p>
      <p className="rc-why" data-rc="why" data-rc-clear="" data-rc-text="" hidden={!model.why}>{model.why || ''}</p>
    </div>
  </div>}</div>;
}
