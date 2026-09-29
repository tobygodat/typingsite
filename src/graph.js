// Speed graph: the run's typing speed over time, with mistakes marked, as an SVG line chart.
// Presentational only. Scoring never reads from here; it reads the event log.

const SVG = 'http://www.w3.org/2000/svg';
const WINDOW_MS = 3000; // speed is averaged over the trailing three seconds, so single pauses don't spike
const MAX_POINTS = 60;
const PAD = { top: 10, right: 6, bottom: 22, left: 34 };

// Seconds per drawn point: one per second up to a minute, then coarser so a long run stays readable.
function stepMs(durationMs) {
  return Math.max(1, Math.ceil(durationMs / 1000 / MAX_POINTS)) * 1000;
}

// Speed points (wpm from correct keystrokes) and mistake counts per point, times in seconds from the first key.
// Keys are counted in one-second slots so the three-second window holds however coarse the drawn points are.
export function speedSeries(attempt) {
  const events = (attempt?.events || []).filter((event) => event.type === 'insert' || event.type === 'blocked-insert');
  if (!events.length) return { points: [], durationS: 0 };
  const start = attempt.startedAt ?? events[0].offsetMs;
  const end = Math.max(attempt.endedAt ?? 0, events[events.length - 1].offsetMs);
  const durationMs = Math.max(1, end - start);
  const slots = Math.max(1, Math.ceil(durationMs / 1000));
  const correct = new Array(slots).fill(0);
  const misses = new Array(slots).fill(0);

  for (const event of events) {
    const slot = Math.min(slots - 1, Math.floor(Math.max(0, event.offsetMs - start) / 1000));
    const hit = event.type === 'insert' && event.accepted !== false && attempt.text?.[event.position] === event.text;
    if (hit) correct[slot] += 1;
    else misses[slot] += 1;
  }

  const step = stepMs(durationMs) / 1000;
  const points = [];
  for (let last = step - 1; last - step + 1 < slots; last += step) {
    const index = Math.min(slots - 1, last);
    const t = Math.min(durationMs, (index + 1) * 1000);
    const from = Math.max(0, Math.ceil((t - WINDOW_MS) / 1000));
    let chars = 0;
    for (let slot = from; slot <= index; slot += 1) chars += correct[slot];
    let missed = 0;
    for (let slot = last - step + 1; slot <= index; slot += 1) missed += misses[slot];
    const windowMs = t - from * 1000;
    points.push({ t: t / 1000, wpm: windowMs > 0 ? Math.round(chars / 5 / (windowMs / 60000)) : 0, misses: missed });
  }
  return { points, durationS: durationMs / 1000 };
}

// A round top for the y axis, so the gridline labels read as plain numbers.
function niceMax(value) {
  const target = Math.max(20, value * 1.1);
  const step = [10, 20, 25, 50, 100].find((s) => target / s <= 4) || 100;
  return Math.ceil(target / step) * step;
}

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

const seconds = (value) => `${Number.isInteger(value) ? value : value.toFixed(1)}s`;

export function describeSeries({ points }, averageWpm) {
  if (!points.length) return 'No keystrokes to graph.';
  const speeds = points.map((point) => point.wpm);
  const misses = points.reduce((sum, point) => sum + point.misses, 0);
  return `Speed over time: average ${averageWpm} wpm, peak ${Math.max(...speeds)}, lowest ${Math.min(...speeds)}. `
    + `${misses} ${misses === 1 ? 'mistake' : 'mistakes'} marked.`;
}

export function renderSpeedGraph(container, attempt, { animate = true } = {}) {
  const width = Math.round(container.clientWidth);
  const height = Math.round(container.clientHeight);
  container.replaceChildren();
  if (!width || !height) return;

  const series = speedSeries(attempt);
  const average = attempt?.summary?.score?.wpm ?? 0;
  container.setAttribute('aria-label', describeSeries(series, average));
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true' });
  if (animate) svg.classList.add('is-drawing');
  container.append(svg);

  const { points, durationS } = series;
  const top = niceMax(Math.max(average, ...points.map((point) => point.wpm)));
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (t) => PAD.left + (durationS ? (t / durationS) * plotW : 0);
  const y = (wpm) => PAD.top + plotH - (Math.min(wpm, top) / top) * plotH;

  // Three gridlines (0, half, top) labelled on the left; the time axis labelled underneath.
  for (const value of [0, top / 2, top]) {
    svg.append(el('line', { class: value ? 'graph-grid' : 'graph-axis', x1: PAD.left, x2: width - PAD.right, y1: y(value), y2: y(value) }));
    svg.append(el('text', { class: 'graph-label', x: PAD.left - 8, y: y(value), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, Math.round(value)));
  }
  const ticks = durationS ? [0, durationS / 2, durationS] : [0];
  ticks.forEach((t, index) => {
    const anchor = index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle';
    svg.append(el('text', { class: 'graph-label', x: x(t), y: height - 4, 'text-anchor': anchor }, seconds(Math.round(t * 10) / 10)));
  });
  if (!points.length) return;

  svg.append(el('line', { class: 'graph-average', x1: PAD.left, x2: width - PAD.right, y1: y(average), y2: y(average) }));

  const coords = points.map((point) => [x(point.t), y(point.wpm)]);
  if (coords.length === 1) coords.unshift([PAD.left, coords[0][1]]);
  const d = coords.map(([px, py], index) => `${index ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  svg.append(el('path', { class: 'graph-line', d, pathLength: 1 }));

  // Mistakes sit on the line where they happened, so a slip and the dip after it read together.
  for (const point of points) {
    if (!point.misses) continue;
    const r = Math.min(5, 3 + (point.misses - 1) * 0.75);
    svg.append(el('circle', { class: 'graph-miss', cx: x(point.t).toFixed(1), cy: y(point.wpm).toFixed(1), r }));
  }
}
