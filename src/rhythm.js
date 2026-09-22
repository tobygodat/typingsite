// Rhythm art: keystroke timing drawn as ordered-dither columns on a canvas.
// Presentational only. Scoring never reads from here; it reads the event log.

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const CELL = 4; // CSS pixels per dither cell
const DEVELOP_MS = 450;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// 60 ms between keys draws a full column; 700 ms or more draws a stub.
export function speedFromInterval(ms) {
  if (ms === null || ms === undefined) return 0.55;
  return Math.max(0.08, Math.min(1, 1 - (ms - 60) / 640));
}

function colors(canvas) {
  const style = getComputedStyle(canvas);
  return {
    hit: style.getPropertyValue('--rhythm-hit').trim() || '#8fd18a',
    miss: style.getPropertyValue('--rhythm-miss').trim() || '#ff7a59',
    rest: style.getPropertyValue('--rhythm-rest').trim() || '#34322f',
  };
}

function setup(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, cols: Math.floor(rect.width / CELL), rows: Math.floor(rect.height / CELL), width: rect.width, height: rect.height };
}

// One column: dense at the baseline, thinning towards its crest.
function paintColumn(ctx, c, rows, speed, color) {
  const height = Math.max(1, Math.round(speed * rows));
  ctx.fillStyle = color;
  for (let r = 0; r < height; r += 1) {
    const y = rows - 1 - r;
    const intensity = 1 - (r / height) * 0.86;
    if (intensity > (BAYER[y % 4][c % 4] + 0.5) / 16) ctx.fillRect(c * CELL, y * CELL, CELL - 1, CELL - 1);
  }
}

function paintRest(ctx, c, rows, color) {
  if (c % 2) return;
  ctx.fillStyle = color;
  ctx.fillRect(c * CELL, (rows - 1) * CELL, CELL - 1, CELL - 1);
}

// The whole run as one print: every keystroke gets a column, in order.
export function keystrokesFrom(attempt) {
  const strokes = [];
  let previous = null;
  for (const event of attempt?.events || []) {
    if (event.type !== 'insert' && event.type !== 'blocked-insert') continue;
    const correct = event.type === 'insert' && attempt.text[event.position] === event.text;
    strokes.push({ interval: previous === null ? null : event.offsetMs - previous, correct });
    previous = event.offsetMs;
  }
  return strokes;
}

export function renderRunArt(canvas, attempt, { animate = true } = {}) {
  const grid = setup(canvas);
  if (!grid) return;
  const palette = colors(canvas);
  const strokes = keystrokesFrom(attempt);
  const columns = [];
  let smooth = null;
  strokes.forEach((stroke, index) => {
    const raw = speedFromInterval(stroke.interval);
    smooth = smooth === null ? raw : smooth + (raw - smooth) * 0.35;
    const c = Math.min(grid.cols - 1, Math.floor((index / Math.max(1, strokes.length)) * grid.cols));
    const prev = columns[c];
    columns[c] = { speed: prev ? Math.max(prev.speed, smooth) : smooth, miss: Boolean(prev?.miss) || !stroke.correct };
  });
  for (let c = 1; c < grid.cols; c += 1) if (!columns[c] && columns[c - 1]) columns[c] = { speed: columns[c - 1].speed * 0.92, miss: false };

  const draw = (upTo) => {
    grid.ctx.clearRect(0, 0, grid.width, grid.height);
    for (let c = 0; c < grid.cols; c += 1) {
      const column = columns[c];
      if (!column || c > upTo) paintRest(grid.ctx, c, grid.rows, palette.rest);
      else paintColumn(grid.ctx, c, grid.rows, column.speed, column.miss ? palette.miss : palette.hit);
    }
  };

  // A short left-to-right develop, like a print coming out; skipped for reduced motion.
  if (!animate || reducedMotion.matches || !strokes.length) { draw(grid.cols); return; }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / DEVELOP_MS);
    draw(Math.floor((1 - (1 - t) ** 3) * grid.cols));
    if (t < 1 && canvas.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
