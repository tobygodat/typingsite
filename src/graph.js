// Speed graph: the run's typing speed over time, with mistakes marked, as an SVG line chart.
// Presentational only. Scoring never reads from here; it reads the event log.
import { CHARS_PER_WORD } from './typing.js';
import { formatSpeed, speedValue } from './units.js';

const SVG = 'http://www.w3.org/2000/svg';
const WINDOW_MS = 3000; // speed is averaged over the trailing three seconds, so single pauses don't spike
const MAX_POINTS = 60;
const PAD = { top: 10, right: 6, bottom: 22, left: 34 };

// Seconds per drawn point: one per second up to a minute, then coarser so a long run stays readable.
function stepMs(durationMs) {
  return Math.max(1, Math.ceil(durationMs / 1000 / MAX_POINTS)) * 1000;
}

// Speed points (wpm from correct keystrokes) and mistake counts per point, times in seconds from the first key.
// Speed at each point is measured over exactly the trailing three seconds of keystroke timestamps,
// however coarse the drawn points are; mistakes are summed per drawn point.
export function speedSeries(attempt) {
  const all = attempt?.events || [];
  const events = all.filter((event) => event.type === 'insert' || event.type === 'blocked-insert');
  if (!events.length) return { points: [], durationS: 0 };
  const start = attempt.startedAt ?? events[0].offsetMs;
  const end = Math.max(attempt.endedAt ?? 0, events[events.length - 1].offsetMs);
  const durationMs = Math.max(1, end - start);
  const step = stepMs(durationMs);
  const count = Math.max(1, Math.ceil(durationMs / step));
  const misses = new Array(count).fill(0);

  // Like the wpm figure, speed counts only correct characters still there at the finish:
  // a correct key that is later deleted is taken back out.
  const kept = [];
  for (const event of all) {
    if (event.type === 'delete') {
      kept.splice(Math.max(0, kept.length - Math.max(1, event.count || 1)));
      continue;
    }
    if (event.type !== 'insert' && event.type !== 'blocked-insert') continue;
    const at = Math.max(0, event.offsetMs - start);
    const accepted = event.type === 'insert' && event.accepted !== false;
    const hit = accepted && attempt.text?.[event.position] === event.text;
    if (!hit) misses[Math.min(count - 1, Math.floor(at / step))] += 1;
    if (accepted) kept.push({ at, hit });
  }
  const hits = kept.filter((key) => key.hit).map((key) => key.at);

  const points = misses.map((missed, index) => {
    const t = Math.min(durationMs, (index + 1) * step);
    const from = t - WINDOW_MS;
    const chars = hits.filter((at) => at <= t && (from < 0 || at > from)).length;
    const windowMs = Math.min(WINDOW_MS, t);
    return { t: t / 1000, wpm: Math.round(chars / CHARS_PER_WORD / (windowMs / 60000)), misses: missed };
  });
  return { points, durationS: durationMs / 1000 };
}

// A round top for the y axis, so the gridline labels read as plain numbers in either unit.
function niceMax(value) {
  const target = Math.max(20, value * 1.1);
  const step = [10, 20, 25, 50, 100, 200, 250].find((s) => target / s <= 4) || 250;
  return Math.ceil(target / step) * step;
}

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

const seconds = (value) => `${Number.isInteger(value) ? value : value.toFixed(1)}s`;

// Points are in wpm; the summary reads them in the chosen display unit.
export function describeSeries({ points }, averageWpm, unit) {
  if (!points.length) return 'No keystrokes to graph.';
  const speeds = points.map((point) => point.wpm);
  const misses = points.reduce((sum, point) => sum + point.misses, 0);
  return `Speed over time: average ${formatSpeed(averageWpm, {}, unit)}, peak ${formatSpeed(Math.max(...speeds), {}, unit)}, lowest ${formatSpeed(Math.min(...speeds), {}, unit)}. `
    + `${misses} ${misses === 1 ? 'mistake' : 'mistakes'} marked.`;
}

// The chart's frame at the container's pixel size: three gridlines (0, half, top) labelled on the left
// and the time axis labelled underneath. Returns the svg and the scales the lines are drawn on.
function plot(container, { durationS, top, animate }) {
  const width = Math.round(container.clientWidth);
  const height = Math.round(container.clientHeight);
  container.replaceChildren();
  if (!width || !height) return null;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true' });
  if (animate) svg.classList.add('is-drawing');
  container.append(svg);
  // Four-digit cpm labels need a little more room than the usual two or three digits.
  const left = String(top).length > 3 ? PAD.left + 8 : PAD.left;
  const right = width - PAD.right;
  const plotW = right - left;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (t) => left + (durationS ? (t / durationS) * plotW : 0);
  const y = (speed) => PAD.top + plotH - (Math.min(speed, top) / top) * plotH;
  for (const value of [0, top / 2, top]) {
    svg.append(el('line', { class: value ? 'graph-grid' : 'graph-axis', x1: left, x2: right, y1: y(value), y2: y(value) }));
    svg.append(el('text', { class: 'graph-label', x: left - 8, y: y(value), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, Math.round(value)));
  }
  const ticks = durationS ? [0, durationS / 2, durationS] : [0];
  ticks.forEach((t, index) => {
    const anchor = index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle';
    svg.append(el('text', { class: 'graph-label', x: x(t), y: height - 4, 'text-anchor': anchor }, seconds(Math.round(t * 10) / 10)));
  });
  return { svg, x, y, left, right };
}

// Straight segments, or with smooth a Catmull-Rom curve through every point, so the mistake dots stay on it.
function line({ svg, x, y, left }, points, className, { smooth = false } = {}) {
  const coords = points.map((point) => [x(point.t), y(point.speed)]);
  if (coords.length === 1) coords.unshift([left, coords[0][1]]);
  const at = ([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`;
  const d = coords.map((point, index) => {
    if (!index) return `M${at(point)}`;
    if (!smooth) return `L${at(point)}`;
    const from = coords[index - 1];
    const before = coords[index - 2] || from;
    const after = coords[index + 1] || point;
    const out = [0, 1].map((axis) => from[axis] + (point[axis] - before[axis]) / 6);
    const into = [0, 1].map((axis) => point[axis] - (after[axis] - from[axis]) / 6);
    return `C${at(out)} ${at(into)} ${at(point)}`;
  }).join(' ');
  svg.append(el('path', { class: className, d, pathLength: 1 }));
}

// Speed points in the display unit, so the gridline labels are round numbers in that unit.
const inUnit = (points) => points.map((point) => ({ ...point, speed: speedValue(point.wpm) }));

// The run card's trace: the full width with no speed axis, so the line spans the run's own range (a
// fifth of the average at least, so a steady run reads as steady) with an eighth of the plot clear above
// and below. A hairline floor, and the time at the start, middle and end underneath.
const TRACE_LABELS = 24;
function trace(container, { durationS, low, high, animate }) {
  const width = Math.round(container.clientWidth);
  const height = Math.round(container.clientHeight);
  container.replaceChildren();
  if (!width || !height) return null;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true' });
  if (animate) svg.classList.add('is-drawing');
  container.append(svg);
  const floor = height - TRACE_LABELS;
  const middle = (low + high) / 2;
  const span = Math.max(high - low, middle / 5, 1);
  const x = (t) => (durationS ? (t / durationS) * width : 0);
  const y = (speed) => floor * (7 / 8 - ((speed - middle) / span + 0.5) * (3 / 4));
  svg.append(el('line', { class: 'graph-axis', x1: 0, x2: width, y1: floor - 0.5, y2: floor - 0.5 }));
  const ticks = durationS ? [0, durationS / 2, durationS] : [0];
  ticks.forEach((t, index) => {
    svg.append(el('text', { class: 'graph-label', x: x(t), y: height - 4, 'text-anchor': index && index === ticks.length - 1 ? 'end' : 'start' }, seconds(Math.round(t * 10) / 10)));
  });
  return { svg, x, y, left: 0, right: width };
}

export function renderSpeedGraph(container, attempt, { animate = true } = {}) {
  const series = speedSeries(attempt);
  const averageWpm = attempt?.summary?.score?.wpm ?? 0;
  // Described even while hidden and undrawn, so the label always reads in the unit on screen.
  container.setAttribute('aria-label', describeSeries(series, averageWpm));
  const points = inUnit(series.points);
  const average = speedValue(averageWpm);
  const speeds = [average, ...points.map((point) => point.speed)];
  const chart = trace(container, { durationS: series.durationS, low: Math.min(...speeds), high: Math.max(...speeds), animate });
  if (!chart || !points.length) return;
  const { svg, y, left, right } = chart;
  svg.append(el('line', { class: 'graph-average', x1: left, x2: right, y1: y(average), y2: y(average) }));
  line(chart, points, 'graph-line', { smooth: true });

  // Mistakes sit on the line where they happened, so a slip and the dip after it read together.
  for (const point of points) {
    if (!point.misses) continue;
    svg.append(el('circle', { class: 'graph-miss', cx: chart.x(point.t).toFixed(1), cy: y(point.speed).toFixed(1), r: 4 }));
  }
}

// An online race: both racers' speed on one chart over the race clock, which both traces start from the
// shared start, so the two lines compare directly. Yours is the accent, theirs the text colour.
export function renderDuelGraph(container, [mine, theirs], { animate = true } = {}) {
  const series = [mine, theirs].map(speedSeries);
  const [ours, others] = series.map((each) => inUnit(each.points));
  const top = niceMax(Math.max(0, ...ours.map((point) => point.speed), ...others.map((point) => point.speed)));
  const chart = plot(container, { durationS: Math.max(...series.map((each) => each.durationS)), top, animate });
  if (!chart) return;
  if (others.length) line(chart, others, 'graph-line graph-line-theirs');
  if (ours.length) line(chart, ours, 'graph-line');
}
