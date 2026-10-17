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

const HEIGHT = 220;
const TOP = 40;
const BOTTOM = 180;
const LEFT = 8;
const RIGHT = 48;

// Three gridlines a round step apart that hold every value: 40, 60, 80 rather than 47, 63, 79.
// Accuracy never reads past 100%.
function gridlines(values, minStep, ceiling) {
  const low = Math.min(...values);
  const high = Math.max(...values);
  for (let scale = 1; ; scale *= 10) {
    for (const step of [1, 2, 5].map((n) => n * scale)) {
      if (step < minStep) continue;
      let base = Math.floor(low / step) * step;
      if (base + 2 * step > ceiling) base = Math.max(0, ceiling - 2 * step);
      if (base <= low && base + 2 * step >= high) return [base, base + step, base + 2 * step];
    }
  }
}

// Round values a nice step apart (1, 2 or 5 times a power of ten) inside the values' own range, about three of them.
function roundTicks(values) {
  const [low, high] = [Math.min(...values), Math.max(...values)];
  const span = Math.max(high - low, 1);
  const power = 10 ** Math.floor(Math.log10(span / 3));
  const step = [1, 2, 5, 10].map((n) => n * power).find((n) => span / n <= 4);
  const ticks = [];
  for (let v = Math.ceil(low / step) * step; v <= high; v += step) ticks.push(Number(v.toFixed(6)));
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
const figureWidth = (figure, fallback = 640) => Math.max(260, figure.clientWidth || fallback);

const METRICS = {
  wpm: { title: 'Speed by day', value: (wpm) => speedValue(wpm), run: (run) => speedValue(run.score.wpm), shown: shownSpeed, suffix: '', minStep: () => speedValue(5), ceiling: Infinity },
  accuracy: { title: 'Accuracy by day', value: (accuracy) => accuracy, run: (run) => run.score.accuracy, shown: shownAccuracy, suffix: '%', minStep: () => 1, ceiling: 100 },
};

// One point per day: that day's median of the selected runs, drawn as a line over every run as a faint
// dot. Speed is saved in wpm and drawn in the chosen display unit (wpm or cpm). A point opens the day's
// most recent run.
export function renderTrend(container, runs, onSelect, metric = 'wpm', today = new Date()) {
  container.replaceChildren();
  const days = runsByDay(runs);
  if (!days.length) return;
  const spec = METRICS[metric];
  const unit = metric === 'wpm' ? unitName().toUpperCase() : 'percent accuracy';
  // The speed axis is bare numbers, so its unit stays visible; accuracy's axis carries its own %.
  const figure = chartFigure(container, spec.title, { note: metric === 'wpm' ? unit : '', legend: true });
  const width = figureWidth(figure);
  const values = days.map((day) => spec.value(day[metric]));
  const dots = days.flatMap((day) => day.runs.map(spec.run));
  const lines = gridlines(values, spec.minStep(), spec.ceiling);
  const low = Math.min(lines[0], ...dots);
  const high = Math.max(lines[2], ...dots);
  const runCount = dots.length;
  const chart = svgNode('svg', { viewBox: `0 0 ${width} ${HEIGHT}`, role: 'group',
    'aria-label': `${spec.title}: the median of each day's runs, ${days.length} ${days.length === 1 ? 'day' : 'days'} and ${runCount} ${runCount === 1 ? 'run' : 'runs'}. Select a point for that day's latest run.` });
  const plot = width - LEFT - RIGHT;
  const step = days.length === 1 ? plot : plot / (days.length - 1);
  const xOf = (i) => LEFT + (days.length === 1 ? plot / 2 : i * step);
  const yOf = (v) => (high === low ? (TOP + BOTTOM) / 2 : BOTTOM - ((v - low) / (high - low)) * (BOTTOM - TOP));
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
  days.forEach((day, i) => {
    for (const run of day.runs) runDots.append(svgNode('circle', { cx: xOf(i), cy: yOf(spec.run(run)), r: 2.5 }));
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
  const named = (i) => `${spec.shown(values[i])}${spec.suffix}`;
  const isToday = days[last].day === dayKey(today);
  const anchorAt = (x) => (x < LEFT + 60 ? 'start' : x > width - RIGHT - 60 ? 'end' : 'middle');
  const [lastX, lastY] = points[last];
  const lastText = `${named(last)} ${isToday ? 'today' : `on ${shortDate(days[last].day)}`}${best === last && days.length > 1 ? ', best day' : ''}`;
  // The latest day's name sits on the side of its point away from the line coming into it.
  const below = last > 0 && points[last - 1][1] < lastY && lastY + 24 < BOTTOM + 16;
  chart.append(svgText(lastText, { x: lastX - 10, y: below ? lastY + 20 : lastY - 10, 'text-anchor': 'end', class: 'trend-callout', 'aria-hidden': 'true' }));
  if (best !== last) {
    const [bestX, bestY] = points[best];
    // Close to the latest day's label, the best day's rises clear of it.
    const crowded = lastX - bestX < 140 && Math.abs(lastY - bestY) < 18;
    chart.append(svgText(`${named(best)} on ${shortDate(days[best].day)}`, { x: bestX, y: Math.max(14, Math.min(bestY, crowded ? lastY : bestY) - (crowded ? 28 : 12)),
      'text-anchor': anchorAt(bestX), class: 'trend-callout', 'aria-hidden': 'true' }));
  }
  const ends = days.length === 1 ? [[days[0], points[0][0], 'middle']] : [[days[0], LEFT, 'start'], [days.at(-1), width - RIGHT, 'end']];
  for (const [day, x, textAnchor] of ends) chart.append(svgText(shortDate(day.day), { x, y: HEIGHT - 6, 'text-anchor': textAnchor, class: 'trend-label' }));
  figure.append(chart);
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
  if (speeds.length >= 4) chart.append(svgNode('rect', { x: xOf(q1), y: SPREAD_TOP, width: Math.max(1, xOf(q3) - xOf(q1)), height: SPREAD_BOTTOM - SPREAD_TOP, class: 'spread-band' }));
  const barWidth = width / bins.length;
  for (const bin of bins) {
    if (!bin.count) continue;
    chart.append(svgNode('rect', { x: xOf(bin.from) + 1, y: yOf(bin.count), width: Math.max(1, barWidth - 2), height: SPREAD_BOTTOM - yOf(bin.count), class: 'spread-bar' }));
  }
  chart.append(svgNode('line', { x1: 0, x2: width, y1: SPREAD_BOTTOM, y2: SPREAD_BOTTOM, class: 'trend-rule' }));
  const midX = xOf(mid);
  chart.append(svgNode('line', { x1: midX, x2: midX, y1: SPREAD_TOP - 6, y2: SPREAD_BOTTOM, class: 'spread-median' }),
    svgText(`median ${Number(speedValue(mid).toFixed(1))}`, { x: midX > width - 120 ? midX - 6 : midX + 6, y: SPREAD_TOP - 8, 'text-anchor': midX > width - 120 ? 'end' : 'start', class: 'trend-callout' }));
  // Edges every 10 wpm from the lowest, or every bin when there are only a few.
  const every = bins.length <= 6 ? 1 : 5;
  bins.forEach((bin, i) => {
    if (i % every) return;
    chart.append(svgText(String(range(bin.from)), { x: xOf(bin.from), y: SPREAD_HEIGHT - 6, 'text-anchor': i ? 'middle' : 'start', class: 'trend-label' }));
  });
  if (bins.length % every === 0) chart.append(svgText(String(range(hi)), { x: width, y: SPREAD_HEIGHT - 6, 'text-anchor': 'end', class: 'trend-label' }));
  figure.append(chart);
}

function drawScatter(figure, runs, unit) {
  const width = figureWidth(figure, 480);
  const left = 44;
  const xs = runs.map((run) => speedValue(run.score.wpm));
  const ys = runs.map((run) => run.score.accuracy);
  const xLines = roundTicks(xs);
  const yLines = roundTicks(ys).filter((v) => v <= 100);
  const pad = (values) => Math.max(1, (Math.max(...values) - Math.min(...values)) * 0.05);
  const [xLo, xHi] = [Math.min(...xs) - pad(xs), Math.max(...xs) + pad(xs)];
  const [yLo, yHi] = [Math.min(...ys) - pad(ys), Math.min(100, Math.max(...ys) + pad(ys))];
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
