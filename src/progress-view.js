// Presentational only. Charts never participate in scoring or comparisons.
const svgNS = 'http://www.w3.org/2000/svg';
const svgNode = (name, attrs) => {
  const node = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

export function renderTrend(container, runs, onSelect) {
  container.replaceChildren();
  if (!runs.length) return;
  for (const [metric, label] of [['wpm', 'Corrected WPM'], ['accuracy', 'Input accuracy']]) {
    const figure = document.createElement('figure');
    figure.className = 'trend-figure';
    const caption = document.createElement('figcaption');
    caption.textContent = label;
    figure.append(caption);
    container.append(figure);
    const width = Math.max(280, figure.clientWidth || 640);
    const values = runs.map((r) => r.score[metric]);
    const low = Math.max(0, Math.min(...values) - (metric === 'wpm' ? 5 : 2));
    const high = Math.min(metric === 'accuracy' ? 100 : Infinity, Math.max(...values) + (metric === 'wpm' ? 5 : 2));
    const chart = svgNode('svg', { viewBox: `0 0 ${width} 180`, role: 'group', 'aria-label': `${label} across ${runs.length} matching runs. Select a point for details.` });
    const step = runs.length === 1 ? width : (width - 72) / (runs.length - 1);
    const point = (v, i) => [48 + (runs.length === 1 ? (width - 72) / 2 : i * step), 140 - ((v - low) / Math.max(1, high - low)) * 116];
    // A point's hit area is 44px tall and no wider than the gap to its neighbours, so hit areas
    // never overlap and a tap opens the point under it. Points closer than a 44px target are
    // marked dense: each run is also a full-size row in the run history below.
    chart.style.setProperty('--trend-step', `${step}px`);
    if (step < 44) chart.classList.add('trend-dense');
    for (const [v, y] of [[low, 140], [high, 24]]) {
      chart.append(svgNode('line', { x1: 48, x2: width - 24, y1: y, y2: y, class: 'trend-rule' }));
      const text = svgNode('text', { x: 0, y: y + 4, class: 'trend-label' });
      text.textContent = `${Math.round(v)}${metric === 'accuracy' ? '%' : ''}`;
      chart.append(text);
    }
    chart.append(svgNode('polyline', { points: values.map((v, i) => point(v, i).join(',')).join(' '), class: `trend-line trend-${metric}` }));
    runs.forEach((run, i) => {
      const [x, y] = point(values[i], i);
      const date = run.at ? new Date(run.at).toLocaleDateString() : 'Earlier run';
      const dot = svgNode('g', { tabindex: 0, role: 'button', class: `trend-dot trend-${metric}`, 'aria-label': `${date}: ${values[i]} ${metric === 'accuracy' ? 'percent accuracy' : 'WPM'}. View run.` });
      dot.append(svgNode('ellipse', { cx: x, cy: y, rx: Math.min(22, step / 2), ry: 22, class: 'trend-hit' }), svgNode('circle', { cx: x, cy: y, r: 5 }));
      const title = svgNode('title', {});
      title.textContent = dot.getAttribute('aria-label');
      dot.append(title);
      dot.addEventListener('click', () => onSelect(run.id));
      dot.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(run.id); }
      });
      chart.append(dot);
    });
    for (const [run, x, anchor] of [[runs[0], 48, 'start'], [runs.at(-1), width - 24, 'end']]) {
      const dateLabel = svgNode('text', { x, y: 170, 'text-anchor': anchor, class: 'trend-label' });
      dateLabel.textContent = run.at ? new Date(run.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Earlier';
      chart.append(dateLabel);
    }
    figure.append(chart);
  }
}
