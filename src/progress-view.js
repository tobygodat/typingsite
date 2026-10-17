// Presentational only. Charts never participate in scoring or comparisons.
import { runsByDay } from './insights.js';
import { speedValue, unitText } from './units.js';

const svgNS = 'http://www.w3.org/2000/svg';
const svgNode = (name, attrs) => {
  const node = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

const HEIGHT = 180;
const TOP = 24;
const BOTTOM = 140;
const LEFT = 48;
const RIGHT = 24;

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

const dayDate = (day) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
};
const shortDate = (day) => dayDate(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const latestRun = (runs) => runs.reduce((last, run) => ((run.at || '') >= (last.at || '') ? run : last));

// One point per day: that day's median of the selected runs. Speed is saved in wpm and drawn in the
// chosen display unit (wpm or cpm). A point opens the day's most recent run.
export function renderTrend(container, runs, onSelect) {
  container.replaceChildren();
  const days = runsByDay(runs);
  if (!days.length) return;
  const unitLabel = unitText('{unit}').toUpperCase();
  const charts = [
    { metric: 'wpm', title: 'Speed by day', unit: unitLabel, suffix: '', value: (day) => speedValue(day.wpm), minStep: speedValue(5), ceiling: Infinity, area: true },
    { metric: 'accuracy', title: 'Accuracy by day', unit: 'percent accuracy', suffix: '%', value: (day) => day.accuracy, minStep: 1, ceiling: 100, area: false },
  ];
  for (const { metric, title, unit, suffix, value, minStep, ceiling, area } of charts) {
    const figure = document.createElement('figure');
    figure.className = 'trend-figure';
    const caption = document.createElement('figcaption');
    const note = document.createElement('span');
    note.className = 'trend-caption-note';
    note.textContent = metric === 'wpm' ? `daily median, corrected ${unitLabel}` : 'daily median, input accuracy';
    caption.append(title, ' ', note);
    figure.append(caption);
    container.append(figure);
    const width = Math.max(280, figure.clientWidth || 640);
    const values = days.map(value);
    const lines = gridlines(values, minStep, ceiling);
    const [low, , high] = lines;
    const runCount = days.reduce((n, day) => n + day.runs.length, 0);
    const chart = svgNode('svg', { viewBox: `0 0 ${width} ${HEIGHT}`, role: 'group',
      'aria-label': `${title}: the median of each day's runs, ${days.length} ${days.length === 1 ? 'day' : 'days'} and ${runCount} ${runCount === 1 ? 'run' : 'runs'}. Select a point for that day's latest run.` });
    const step = days.length === 1 ? width : (width - LEFT - RIGHT) / (days.length - 1);
    const yOf = (v) => BOTTOM - ((v - low) / (high - low)) * (BOTTOM - TOP);
    const point = (v, i) => [LEFT + (days.length === 1 ? (width - LEFT - RIGHT) / 2 : i * step), yOf(v)];
    // A point's hit area is 44px tall and no wider than the gap to its neighbours, so hit areas
    // never overlap and a tap opens the point under it. Points closer than a 44px target are
    // marked dense: each run is also a full-size row in the run history below.
    chart.style.setProperty('--trend-step', `${step}px`);
    if (step < 44) chart.classList.add('trend-dense');
    for (const v of lines) {
      const y = yOf(v);
      chart.append(svgNode('line', { x1: LEFT, x2: width - RIGHT, y1: y, y2: y, class: 'trend-rule' }));
      const text = svgNode('text', { x: 0, y: y + 4, class: 'trend-label' });
      text.textContent = `${v}${suffix}`;
      chart.append(text);
    }
    const points = values.map((v, i) => point(v, i));
    if (area && points.length > 1) {
      const outline = [[points[0][0], BOTTOM], ...points, [points.at(-1)[0], BOTTOM]];
      chart.append(svgNode('polygon', { points: outline.map((p) => p.join(',')).join(' '), class: 'trend-area' }));
    }
    chart.append(svgNode('polyline', { points: points.map((p) => p.join(',')).join(' '), class: `trend-line trend-${metric}` }));
    // The best day, ties going to the most recent, is named at its point.
    const best = values.reduce((top, v, i) => (v >= values[top] ? i : top), 0);
    days.forEach((day, i) => {
      const [x, y] = points[i];
      const shown = Number(values[i].toFixed(1));
      const label = `${dayDate(day.day).toLocaleDateString()}: median ${shown} ${unit} over ${day.runs.length} ${day.runs.length === 1 ? 'run' : 'runs'}${i === best ? ', the best day' : ''}. View the latest run.`;
      const dot = svgNode('g', { tabindex: 0, role: 'button', class: `trend-dot trend-${metric}${i === best ? ' trend-best-dot' : ''}`, 'aria-label': label });
      dot.append(svgNode('ellipse', { cx: x, cy: y, rx: Math.min(22, step / 2), ry: 22, class: 'trend-hit' }), svgNode('circle', { cx: x, cy: y, r: i === best ? 5 : 3 }));
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
    const [bestX, bestY] = points[best];
    const anchor = bestX < LEFT + 60 ? 'start' : bestX > width - RIGHT - 60 ? 'end' : 'middle';
    const bestLabel = svgNode('text', { x: bestX, y: bestY - 12, 'text-anchor': anchor, class: 'trend-label trend-best', 'aria-hidden': 'true' });
    bestLabel.textContent = `${Number(values[best].toFixed(1))}${suffix}, best day`;
    chart.append(bestLabel);
    const ends = days.length === 1 ? [[days[0], points[0][0], 'middle']] : [[days[0], LEFT, 'start'], [days.at(-1), width - RIGHT, 'end']];
    for (const [day, x, textAnchor] of ends) {
      const dateLabel = svgNode('text', { x, y: 170, 'text-anchor': textAnchor, class: 'trend-label' });
      dateLabel.textContent = shortDate(day.day);
      chart.append(dateLabel);
    }
    figure.append(chart);
  }
}
