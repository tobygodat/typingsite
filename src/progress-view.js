// Presentational only. Charts never participate in scoring or comparisons.
import { dayKey, histogram, quantile, runsByDay } from './insights.js';
import { speedValue, unitText } from './units.js';

const svgNS = 'http://www.w3.org/2000/svg';
const svgNode = (name, attrs) => {
  const node = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};
const svgText = (text, attrs) => {
  const node = svgNode('text', attrs);
  node.textContent = text;
  return node;
};

const LEFT = 8;
const RIGHT = 48;
const TOP = 40;
const AXIS = 40;
const CALLOUT_GAP = 8;

// The chart's height: about 2.5 wide to 1 tall, between the --chart-height-min and --chart-height tokens.
function chartHeight(figure, width) {
  const style = getComputedStyle(figure);
  const max = parseFloat(style.getPropertyValue('--chart-height')) || 400;
  const min = parseFloat(style.getPropertyValue('--chart-height-min')) || 240;
  return Math.round(Math.max(min, Math.min(max, width / 2.5)));
}

// Three gridlines a round step apart that hold every value: 40, 60, 80 rather than 47, 63, 79.
// Accuracy never reads past 100%. Values that aren't numbers are left out.
export function gridlines(values, minStep, ceiling) {
  const finite = values.filter(Number.isFinite);
  const low = finite.length ? Math.min(...finite) : 0;
  const high = finite.length ? Math.max(...finite) : 0;
  for (let scale = 1; scale <= 1e12; scale *= 10) {
    for (const step of [1, 2, 5].map((n) => n * scale)) {
      if (step < minStep) continue;
      let base = Math.floor(low / step) * step;
      if (base + 2 * step > ceiling) base = Math.max(0, ceiling - 2 * step);
      if (base <= low && base + 2 * step >= high) return [base, base + step, base + 2 * step];
    }
  }
  return [low, (low + high) / 2, high];
}

// Round values a nice step apart (1, 2 or 5 times a power of ten), about three or four of them, from
// the one at or below the lowest value to the one at or above the highest, so every value sits on the
// scale. A ceiling (100% accuracy) caps the top.
function roundTicks(values, ceiling = Infinity) {
  const [low, high] = [Math.min(...values), Math.max(...values)];
  const span = Math.max(high - low, 1);
  const power = 10 ** Math.floor(Math.log10(span / 3));
  const step = [1, 2, 5, 10].map((n) => n * power).find((n) => span / n <= 4);
  const ticks = [];
  const top = Math.min(ceiling, Math.ceil(high / step) * step);
  for (let v = Math.floor(low / step) * step; v < top + step / 2; v += step) ticks.push(Number(Math.min(v, ceiling).toFixed(6)));
  if (ticks.length === 1) ticks.unshift(Number((ticks[0] - step).toFixed(6)));
  return ticks;
}

const dayDate = (day) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
};
const shortDate = (day) => dayDate(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const latestRun = (runs) => runs.reduce((last, run) => ((run.at || '') >= (last.at || '') ? run : last));
const unitName = () => unitText('{unit}');
// Speeds on the charts read whole, like the figures above them; accuracy keeps one decimal at most.
const shownSpeed = (value) => Math.round(value);
const shownAccuracy = (value) => Number(value.toFixed(1));

// The figure a chart sits in: a caption on the left, an optional legend or subline beside it.
function chartFigure(container, title, { note = '', subline = '', legend = false } = {}) {
  const figure = document.createElement('figure');
  figure.className = 'trend-figure';
  const caption = document.createElement('figcaption');
  caption.append(title);
  if (note) {
    const span = document.createElement('span');
    span.className = 'trend-caption-note';
    span.textContent = note;
    caption.append(' ', span);
  }
  figure.append(caption);
  if (legend) {
    const key = document.createElement('p');
    key.className = 'trend-legend';
    key.setAttribute('aria-hidden', 'true');
    key.innerHTML = '<span class="legend-line"></span>daily median <span class="legend-dot"></span>a run';
    figure.append(key);
  }
  if (subline) {
    const line = document.createElement('p');
    line.className = 'trend-subline';
    line.textContent = subline;
    figure.append(line);
  }
  container.append(figure);
  return figure;
}
const figureWidth = (figure, fallback = 640) => Math.max(280, figure.clientWidth || fallback);

const METRICS = {
  wpm: { title: 'Speed by day', value: (wpm) => speedValue(wpm), run: (run) => speedValue(run.score.wpm), shown: shownSpeed, suffix: '', minStep: () => speedValue(5), ceiling: Infinity },
  accuracy: { title: 'Accuracy by day', value: (accuracy) => accuracy, run: (run) => run.score.accuracy, shown: shownAccuracy, suffix: '%', minStep: () => 1, ceiling: 100 },
};

const boxesOverlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const grow = (box, by) => ({ left: box.left - by, top: box.top - by, right: box.right + by, bottom: box.bottom + by });
// Liang–Barsky: does the segment from a to b pass through the box?
function segmentCrosses([x1, y1], [x2, y2], box) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let from = 0;
  let to = 1;
  for (const [p, q] of [[-dx, x1 - box.left], [dx, box.right - x1], [-dy, y1 - box.top], [dy, box.bottom - y1]]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) from = Math.max(from, t);
    else to = Math.min(to, t);
    if (from > to) return false;
  }
  return true;
}

// Where each callout goes: the first spot round its point, nearest first, whose box clears every dot, every
// segment of the line, the callouts already placed and the chart's edges by `gap`. Each callout is
// { x, y, width, height } (its point and its text's size); dots are { x, y, r }; segments are [[x, y], [x, y]].
// Returns the boxes { left, top, right, bottom }. With no clear spot, the one with the fewest collisions wins.
export function placeCallouts(callouts, { dots = [], segments = [], bounds, gap = CALLOUT_GAP }) {
  const placed = [];
  const collisions = (box) => {
    const clear = grow(box, gap);
    return dots.filter((d) => boxesOverlap(clear, { left: d.x - d.r, top: d.y - d.r, right: d.x + d.r, bottom: d.y + d.r })).length
      + segments.filter(([a, b]) => segmentCrosses(a, b, clear)).length
      + placed.filter((other) => boxesOverlap(clear, other)).length;
  };
  const inside = (box) => box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom;
  for (const { x, y, width, height } of callouts) {
    const spots = [];
    for (const d of [10, 18, 28, 40, 56, 76, 100, 130]) {
      const above = y - d - height;
      const below = y + d;
      const beside = y - height / 2;
      spots.push(
        [x - width / 2, above], [x - width - d / 2, above], [x + d / 2, above],
        [x - width / 2, below], [x - width - d / 2, below], [x + d / 2, below],
        [x - width - d, beside], [x + d, beside],
      );
    }
    let best = null;
    for (const [left, top] of spots) {
      const box = { left, top, right: left + width, bottom: top + height };
      if (!inside(box)) continue;
      const hits = collisions(box);
      if (!best || hits < best.hits) best = { box, hits };
      if (!hits) break;
    }
    const box = best?.box || { left: Math.max(bounds.left, Math.min(x - width / 2, bounds.right - width)), top: bounds.top, right: 0, bottom: bounds.top + height };
    box.right = box.left + width;
    placed.push(box);
  }
  return placed;
}

// A callout's text, sized by the browser where it can measure (an SVG in the page), placed by placeCallouts.
function measureText(chart, text) {
  const node = svgText(text, { x: 0, y: 0, class: 'trend-callout', 'aria-hidden': 'true' });
  chart.append(node);
  let box = null;
  try { box = node.getBBox(); } catch { box = null; }
  if (!box?.width) box = { x: 0, y: -14, width: text.length * 7, height: 18 };
  return { node, box };
}

// One point per day: that day's median of the selected runs, drawn as a line over every run as a faint
// dot. Speed is saved in wpm and drawn in the chosen display unit (wpm or cpm). A point opens the day's
// most recent run.
export function renderTrend(container, runs, onSelect, metric = 'wpm', today = new Date()) {
  container.replaceChildren();
  const days = runsByDay(runs);
  if (!days.length) return;
  const spec = METRICS[metric];
  const unit = metric === 'wpm' ? unitName() : 'percent accuracy';
  // The speed axis is bare numbers, so its unit stays visible; accuracy's axis carries its own %.
  const figure = chartFigure(container, spec.title, { note: metric === 'wpm' ? unit : '', legend: true });
  const width = figureWidth(figure);
  const height = chartHeight(figure, width);
  const bottom = height - AXIS;
  const values = days.map((day) => spec.value(day[metric]));
  const dots = days.flatMap((day) => day.runs.map(spec.run));
  const lines = gridlines(values, spec.minStep(), spec.ceiling);
  const low = Math.min(lines[0], ...dots);
  const high = Math.max(lines[2], ...dots);
  const runCount = dots.length;
  const chart = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'group',
    'aria-label': `${spec.title}: the median of each day's runs, ${days.length} ${days.length === 1 ? 'day' : 'days'} and ${runCount} ${runCount === 1 ? 'run' : 'runs'}. Select a point for that day's latest run.` });
  const plot = width - LEFT - RIGHT;
  const step = days.length === 1 ? plot : plot / (days.length - 1);
  const xOf = (i) => LEFT + (days.length === 1 ? plot / 2 : i * step);
  const yOf = (v) => (high === low ? (TOP + bottom) / 2 : bottom - ((v - low) / (high - low)) * (bottom - TOP));
  // A point's hit area is 44px tall and no wider than the gap to its neighbours, so hit areas
  // never overlap and a tap opens the point under it. Points closer than a 44px target are
  // marked dense: each run is also a full-size row in the run history below.
  chart.style.setProperty('--trend-step', `${step}px`);
  if (step < 44) chart.classList.add('trend-dense');
  for (const v of lines) {
    const y = yOf(v);
    chart.append(svgNode('line', { x1: LEFT, x2: width - RIGHT, y1: y, y2: y, class: 'trend-rule' }),
      svgText(`${v}${spec.suffix}`, { x: width - RIGHT + 12, y: y + 4, class: 'trend-label' }));
  }
  const runDots = svgNode('g', { class: 'trend-runs', 'aria-hidden': 'true' });
  const dotMarks = [];
  days.forEach((day, i) => {
    for (const run of day.runs) {
      const [cx, cy] = [xOf(i), yOf(spec.run(run))];
      runDots.append(svgNode('circle', { cx, cy, r: 2.5 }));
      dotMarks.push({ x: cx, y: cy, r: 2.5 });
    }
  });
  chart.append(runDots);
  const points = values.map((v, i) => [xOf(i), yOf(v)]);
  chart.append(svgNode('polyline', { points: points.map((p) => p.join(',')).join(' '), class: `trend-line trend-${metric}` }));
  // The best day, ties going to the most recent, is named at its point, and so is the latest day.
  const best = values.reduce((top, v, i) => (v >= values[top] ? i : top), 0);
  const last = days.length - 1;
  days.forEach((day, i) => {
    const [x, y] = points[i];
    const shown = Number(values[i].toFixed(1));
    const label = `${dayDate(day.day).toLocaleDateString()}: median ${shown} ${unit} over ${day.runs.length} ${day.runs.length === 1 ? 'run' : 'runs'}${i === best ? ', the best day' : ''}. View the latest run.`;
    const marks = [i === best && 'trend-best-dot', i === last && 'trend-last-dot'].filter(Boolean).join(' ');
    const dot = svgNode('g', { tabindex: 0, role: 'button', class: `trend-dot trend-${metric}${marks ? ` ${marks}` : ''}`, 'aria-label': label });
    dot.append(svgNode('ellipse', { cx: x, cy: y, rx: Math.min(22, step / 2), ry: 22, class: 'trend-hit' }), svgNode('circle', { cx: x, cy: y, r: i === last ? 4 : 3 }));
    const tip = svgNode('title', {});
    tip.textContent = label;
    dot.append(tip);
    const open = () => onSelect(latestRun(day.runs).id);
    dot.addEventListener('click', open);
    dot.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
    });
    chart.append(dot);
  });
  figure.append(chart);
  const named = (i) => `${spec.shown(values[i])}${spec.suffix}`;
  const isToday = days[last].day === dayKey(today);
  const callouts = [[last, `${named(last)} ${isToday ? 'today' : `on ${shortDate(days[last].day)}`}${best === last && days.length > 1 ? ', best day' : ''}`]];
  if (best !== last) callouts.push([best, `${named(best)} on ${shortDate(days[best].day)}`]);
  const texts = callouts.map(([i, text]) => ({ i, ...measureText(chart, text) }));
  const boxes = placeCallouts(texts.map(({ i, box }) => ({ x: points[i][0], y: points[i][1], width: box.width, height: box.height })), {
    dots: [...dotMarks, ...points.map(([x, y]) => ({ x, y, r: 4 }))],
    segments: points.slice(1).map((point, i) => [points[i], point]),
    bounds: { left: 0, top: 0, right: width - RIGHT, bottom },
  });
  texts.forEach(({ node, box }, n) => {
    node.setAttribute('x', String(boxes[n].left - box.x));
    node.setAttribute('y', String(boxes[n].top - box.y));
  });
  // The first and last days, and the middle one where the chart is wide enough to keep three dates apart.
  const ends = days.length === 1 ? [[0, 'middle']] : [[0, 'start'], [last, 'end']];
  if (days.length >= 5 && width >= 480) ends.push([Math.round(last / 2), 'middle']);
  for (const [i, textAnchor] of ends) chart.append(svgText(shortDate(days[i].day), { x: textAnchor === 'start' ? LEFT : textAnchor === 'end' ? width - RIGHT : xOf(i), y: height - 6, 'text-anchor': textAnchor, class: 'trend-label' }));
}

const SPREAD_HEIGHT = 200;
const SPREAD_TOP = 24;
const SPREAD_BOTTOM = 170;

// How the selected runs spread: a histogram of speeds in 2 wpm bins (10 cpm), the median as a line and
// the middle half of the runs as a band behind it; and each run's speed against its accuracy. Descriptive
// only: no fitted line and no claim about what moves what.
export function renderSpread(container, runs) {
  container.replaceChildren();
  const speeds = runs.map((run) => run.score.wpm);
  if (!speeds.length) return;
  const unit = unitName();
  const [q1, mid, q3] = [0.25, 0.5, 0.75].map((p) => quantile(speeds, p));
  const spread = speeds.length >= 4
    ? `Half your runs fall between ${shownSpeed(speedValue(q1))} and ${shownSpeed(speedValue(q3))} ${unit}.`
    : `${speeds.length} ${speeds.length === 1 ? 'run' : 'runs'} so far; the middle half shows from 4.`;
  const left = chartFigure(container, 'How your runs spread', { subline: spread });
  const right = chartFigure(container, 'Speed against accuracy', { subline: 'Each dot is a run.' });
  drawHistogram(left, speeds, { q1, mid, q3, unit });
  drawScatter(right, runs, unit);
}

function drawHistogram(figure, speeds, { q1, mid, q3, unit }) {
  const width = figureWidth(figure, 480);
  const bins = histogram(speeds, 2);
  const lo = bins[0].from;
  const hi = bins.at(-1).from + 2;
  const xOf = (wpm) => ((wpm - lo) / (hi - lo)) * width;
  const tallest = Math.max(...bins.map((bin) => bin.count));
  const yOf = (count) => SPREAD_BOTTOM - (count / tallest) * (SPREAD_BOTTOM - SPREAD_TOP - 8);
  const range = (wpm) => shownSpeed(speedValue(wpm));
  const chart = svgNode('svg', { viewBox: `0 0 ${width} ${SPREAD_HEIGHT}`, role: 'img',
    'aria-label': `${speeds.length} ${speeds.length === 1 ? 'run' : 'runs'} by speed, from ${range(Math.min(...speeds))} to ${range(Math.max(...speeds))} ${unit}. Median ${Number(speedValue(mid).toFixed(1))} ${unit}${speeds.length >= 4 ? `; half the runs between ${range(q1)} and ${range(q3)} ${unit}` : ''}.` });
  if (speeds.length >= 4) {
    chart.append(svgNode('rect', { x: xOf(q1), y: SPREAD_TOP, width: Math.max(1, xOf(q3) - xOf(q1)), height: SPREAD_BOTTOM - SPREAD_TOP, class: 'spread-band' }));
    for (const edge of [q1, q3]) chart.append(svgNode('line', { x1: xOf(edge), x2: xOf(edge), y1: SPREAD_TOP, y2: SPREAD_BOTTOM, class: 'spread-band-edge' }));
  }
  const barWidth = width / bins.length;
  for (const bin of bins) {
    if (!bin.count) continue;
    chart.append(svgNode('rect', { x: xOf(bin.from) + 1, y: yOf(bin.count), width: Math.max(1, barWidth - 2), height: SPREAD_BOTTOM - yOf(bin.count), class: 'spread-bar' }));
  }
  chart.append(svgNode('line', { x1: 0, x2: width, y1: SPREAD_BOTTOM, y2: SPREAD_BOTTOM, class: 'trend-rule' }));
  const midX = xOf(mid);
  chart.append(svgNode('line', { x1: midX, x2: midX, y1: SPREAD_TOP - 6, y2: SPREAD_BOTTOM, class: 'spread-median' }),
    svgText(`median ${Number(speedValue(mid).toFixed(1))}`, { x: midX > width - 120 ? midX - 6 : midX + 6, y: SPREAD_TOP - 8, 'text-anchor': midX > width - 120 ? 'end' : 'start', class: 'trend-callout' }));
  // Edges every 10 wpm from the lowest, or every bin when there are only a few, and always the last
  // edge, named with the unit; an interior edge too close to it gives way.
  const every = bins.length <= 6 ? 1 : 5;
  const endLabel = `${range(hi)} ${unit}`;
  const endWidth = endLabel.length * 8;
  bins.forEach((bin, i) => {
    if (i % every || xOf(bin.from) > width - endWidth - 24) return;
    chart.append(svgText(String(range(bin.from)), { x: xOf(bin.from), y: SPREAD_HEIGHT - 6, 'text-anchor': i ? 'middle' : 'start', class: 'trend-label' }));
  });
  chart.append(svgText(endLabel, { x: width, y: SPREAD_HEIGHT - 6, 'text-anchor': 'end', class: 'trend-label' }));
  // Bar height is a count of runs: the tallest bar's count names its height.
  chart.append(svgNode('line', { x1: 0, x2: width, y1: yOf(tallest), y2: yOf(tallest), class: 'trend-rule spread-count-rule' }),
    svgText(`${tallest} ${tallest === 1 ? 'run' : 'runs'}`, { x: 0, y: yOf(tallest) - 6, class: 'trend-label' }));
  figure.append(chart);
}

function drawScatter(figure, runs, unit) {
  const width = figureWidth(figure, 480);
  const left = 44;
  const xs = runs.map((run) => speedValue(run.score.wpm));
  const ys = runs.map((run) => run.score.accuracy);
  const xLines = roundTicks(xs);
  const yLines = roundTicks(ys, 100);
  const [xLo, xHi] = [xLines[0], xLines.at(-1)];
  const [yLo, yHi] = [yLines[0], yLines.at(-1)];
  const xOf = (v) => left + 6 + ((v - xLo) / (xHi - xLo || 1)) * (width - left - 12);
  const yOf = (v) => SPREAD_BOTTOM - 6 - ((v - yLo) / (yHi - yLo || 1)) * (SPREAD_BOTTOM - SPREAD_TOP - 12);
  const chart = svgNode('svg', { viewBox: `0 0 ${width} ${SPREAD_HEIGHT}`, role: 'img',
    'aria-label': `Speed against accuracy for ${runs.length} ${runs.length === 1 ? 'run' : 'runs'}: speed from ${shownSpeed(Math.min(...xs))} to ${shownSpeed(Math.max(...xs))} ${unit}, accuracy from ${shownAccuracy(Math.min(...ys))}% to ${shownAccuracy(Math.max(...ys))}%.` });
  for (const v of yLines) {
    const y = yOf(v);
    chart.append(svgNode('line', { x1: left, x2: width, y1: y, y2: y, class: 'trend-rule' }), svgText(`${v}%`, { x: 0, y: y + 4, class: 'trend-label' }));
  }
  for (const v of xLines) chart.append(svgText(String(v), { x: xOf(v), y: SPREAD_HEIGHT - 6, 'text-anchor': 'middle', class: 'trend-label' }));
  const dots = svgNode('g', { class: 'scatter-runs' });
  runs.forEach((run, i) => dots.append(svgNode('circle', { cx: xOf(xs[i]), cy: yOf(ys[i]), r: 3 })));
  chart.append(dots);
  figure.append(chart);
}

const STRIP_HEIGHT = 96;
const STRIP_TOP = 8;
const STRIP_BOTTOM = 70;

// Completed runs of every kind on each day of the period, oldest first.
export function renderRunsPerDay(container, perDay) {
  container.replaceChildren();
  if (!perDay.length) return;
  const figure = chartFigure(container, 'Runs per day');
  const width = figureWidth(figure);
  const most = Math.max(1, ...perDay.map((d) => d.runs));
  const total = perDay.reduce((sum, d) => sum + d.runs, 0);
  const active = perDay.filter((d) => d.runs).length;
  const step = width / perDay.length;
  const chart = svgNode('svg', { viewBox: `0 0 ${width} ${STRIP_HEIGHT}`, role: 'img',
    'aria-label': `Runs per day from ${shortDate(perDay[0].day)} to ${shortDate(perDay.at(-1).day)}: ${total} ${total === 1 ? 'run' : 'runs'} on ${active} ${active === 1 ? 'day' : 'days'}, at most ${most} in a day.` });
  perDay.forEach((d, i) => {
    if (!d.runs) return;
    const height = (d.runs / most) * (STRIP_BOTTOM - STRIP_TOP);
    chart.append(svgNode('rect', { x: i * step + Math.min(2, step * 0.1), y: STRIP_BOTTOM - height, width: Math.max(1, step - Math.min(4, step * 0.2)), height, class: 'strip-bar' }));
  });
  chart.append(svgNode('line', { x1: 0, x2: width, y1: STRIP_BOTTOM, y2: STRIP_BOTTOM, class: 'trend-rule' }));
  const ends = perDay.length === 1 ? [[perDay[0], width / 2, 'middle']] : [[perDay[0], 0, 'start'], [perDay.at(-1), width, 'end']];
  for (const [d, x, anchor] of ends) chart.append(svgText(shortDate(d.day), { x, y: STRIP_HEIGHT - 6, 'text-anchor': anchor, class: 'trend-label' }));
  figure.append(chart);
}

// Month names over the calendar's week columns (`days` start on a Sunday), each at the first column
// whose week starts in it. The first column is named only when its month has room before the next.
export function monthLabels(days) {
  const months = [];
  for (let i = 0; i < days.length; i += 7) months.push(dayDate(days[i]));
  return months.map((day, col) => {
    const starts = col ? months[col - 1].getMonth() !== day.getMonth() : months[1]?.getMonth() === day.getMonth();
    return starts ? day.toLocaleDateString(undefined, { month: 'short' }) : '';
  });
}
