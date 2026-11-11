// Throwaway generator for the TOB-420 page directions. `node design/directions/build.mjs` rewrites the HTML.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as d from './data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// ── Shell ─────────────────────────────────────────────────────────────────

const dock = (active) => {
  const item = (nav, full, short) => {
    const on = nav === active ? ' is-active" aria-current="page' : '';
    const label = short ? `<span class="nav-label-short">${short}</span> <span class="nav-label-full">${full}</span>` : full;
    return `<button class="nav-item${on}" type="button" data-nav="${nav}">${label}</button>`;
  };
  return `<header class="dock-zone">
      <nav class="dock" aria-label="Main navigation">
        <a class="brand" href="#practice" aria-label="Stilltype practice"><span class="brand-word">stilltype</span><span class="brand-dot" aria-hidden="true">.</span></a>
        <div class="dock-nav glide" data-glide="current">
          <span class="glide-pill" aria-hidden="true"></span>
          ${item('practice', 'practice', 'type')}
          ${item('train', 'train')}
          ${item('progress', 'progress', 'track')}
          ${item('compete', 'challenge', 'race')}
        </div>
        <span class="dock-sep" aria-hidden="true"></span>
        <button class="dock-command dock-settings" type="button" aria-label="Settings">
          <svg class="settings-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>
          <span class="dock-label" aria-hidden="true">settings</span>
        </button>
        <button class="dock-command" type="button" aria-label="Commands">
          <svg class="search-glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
        </button>
      </nav>
    </header>
    <div class="corner">
      <details class="inbox proto-member-only">
        <summary class="corner-trigger" aria-label="Inbox, 2 new">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4.5 7 7.5 6 7.5-6"/></svg>
          <span class="inbox-count num">2</span>
        </summary>
      </details>
      <details class="account" data-state="member">
        <summary class="corner-trigger account-trigger" aria-label="Account">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.9-3.5 3.6-5.5 7-5.5s6.1 2 7 5.5"/></svg>
        </summary>
      </details>
    </div>`;
};

const footer = `<footer class="site-footer">
      <span class="personal-best num proto-member-only">Best · ${d.best.wpm} wpm</span>
      <span class="personal-best proto-guest-only">guest · runs aren’t saved</span>
      <span class="footer-links"><button class="footer-link" type="button">suggest a feature</button><button class="footer-link" type="button">v0.2.0</button></span>
    </footer>`;

const page = ({ file, title, nav, heading, full, empty, after }) => {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <script src="proto.js"></script>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="/src/styles.css">
  <link rel="stylesheet" href="directions.css">
</head>
<body>
  <div class="app-shell">
    ${dock(nav)}
    <main id="main-content">
      <h1 class="sr-only">${heading}</h1>
      <section class="screen d-screen" data-state="full">
${full}
      </section>
      <section class="screen d-screen" data-state="empty" hidden>
${empty}
      </section>${after ? `
      <section class="screen d-screen" data-state="after" hidden>
${after}
      </section>` : ''}
    </main>
    ${footer}
  </div>
</body>
</html>
`;
  writeFileSync(path.join(here, file), html);
};

// ── Pieces ────────────────────────────────────────────────────────────────

const lbl = (text, cls = '') => `<p class="lbl ${cls}">${text}</p>`;
const sub = (text, cls = '') => `<p class="sub ${cls}">${text}</p>`;
const btn = (kind, text, extra = '') => `<button class="btn btn-${kind}" type="button"${extra}>${text}</button>`;
const seg = (set, options, current, label) => `<div class="seg" role="group" aria-label="${label}">${options
  .map(([id, text]) => `<button type="button" class="seg-option${id === current ? ' is-on' : ''}" aria-pressed="${id === current}" data-set="${set}" data-show="${id}">${text}</button>`)
  .join('')}</div>`;
const status = (tone, word) => `<span class="status badge-${tone}"><span class="status-dot" aria-hidden="true"></span>${word}</span>`;
const pct = (n) => `${n}<span class="unit pct">%</span>`;

// Smooth line through the points (Catmull-Rom as cubic Béziers) in a 1000 by 400 box.
const curve = (pts) => {
  if (pts.length < 2) return '';
  let p = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x0, y0] = pts[i - 1] || pts[i];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const [x3, y3] = pts[i + 2] || pts[i + 1];
    const c1 = [x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6];
    const c2 = [x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6];
    p += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  }
  return p;
};

// A chart: SVG for lines (stretched), HTML for dots and words (never stretched).
const chart = ({ values, dots = [], min, max, ticks = [], xs = [], notes = [], bars = false, goal = null, cls = '', label, unit = '' }) => {
  const n = values.length;
  const X = (i) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const Y = (v) => (1 - (v - min) / (max - min)) * 100;
  const pts = values.map((v, i) => (v == null ? null : [X(i) * 10, Y(v) * 4])).filter(Boolean);
  const grid = ticks.map((t) => `<path class="chart-grid" d="M0,${(Y(t) * 4).toFixed(1)} H1000" vector-effect="non-scaling-stroke"/>`).join('');
  const line = bars ? '' : `<path class="chart-line" d="${curve(pts)}" vector-effect="non-scaling-stroke"/>`;
  const goalLine = goal == null ? '' : `<path class="chart-goal" d="M0,${(Y(goal) * 4).toFixed(1)} H1000" vector-effect="non-scaling-stroke"/>`;
  const barEls = bars
    ? values.map((v, i) => `<span class="chart-bar${v >= goal ? ' is-met' : ''}" style="left:${X(i)}%;height:${(100 - Y(v)).toFixed(1)}%"></span>`).join('')
    : '';
  const dotEls = dots.map(({ i, v }) => `<span class="chart-dot" style="left:${X(i).toFixed(2)}%;top:${Y(v).toFixed(2)}%"></span>`).join('');
  const tickEls = ticks.map((t) => `<span class="chart-y num" style="top:${Y(t).toFixed(2)}%">${t}</span>`).join('');
  const xEls = xs.map(([i, text]) => `<span class="chart-x" style="left:${X(i)}%">${text}</span>`).join('');
  const noteEls = notes
    .map(({ i, v, html, anchor = 'start', mark = true, place = 'above' }) => `${mark ? `<span class="chart-mark" style="left:${X(i)}%;top:${Y(v)}%"></span>` : ''}<span class="chart-note is-${anchor} is-${place}" style="left:${X(i)}%;top:${Y(v)}%">${html}</span>`)
    .join('');
  const gutter = notes.some((note) => note.place === 'gutter') ? ' has-gutter' : '';
  return `<div class="chart ${cls}${gutter}" role="img" aria-label="${label}">
  <svg viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">${grid}${goalLine}${line}</svg>
  ${barEls}${dotEls}${tickEls}${xEls}${noteEls}
</div>`;
};

const keyRows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const keyboard = ({ size = 'big', selected = null, empty = false, set = 'kb' }) => `<div class="kb kb-${size}" role="group" aria-label="Keys shaded by first tries missed">
${keyRows
  .map((row) => `  <div class="kb-row">${[...row]
    .map((k) => {
      const [rate, tries] = d.keys[k];
      const heat = empty ? 'none' : d.keyHeat(rate);
      const rateText = !empty && heat > 0 && size === 'big' ? `<span class="kb-rate num">${Math.round(rate)}%</span>` : '';
      const name = empty ? `${k}, no tries yet` : `${k}, ${rate}% of ${tries} first tries missed`;
      if (size === 'big') {
        const on = k === selected;
        return `<button type="button" class="kb-key" data-heat="${heat}" aria-pressed="${on}" data-set="${set}" data-show="${set}-${k}" aria-label="${name}"><span class="kb-letter">${k}</span>${rateText}</button>`;
      }
      return `<span class="kb-key" data-heat="${heat}" aria-label="${name}"><span class="kb-letter">${k}</span></span>`;
    })
    .join('')}</div>`)
  .join('\n')}
</div>`;

const ev = (text) => `<span class="ev num">${text}</span>`;

// ── Data shared by Train directions ──────────────────────────────────────

const t = d.target;
const markPair = (word, pair) => word.replace(pair, `<b>${pair}</b>`);
const hot = Object.entries(d.keys).sort((a, b) => b[1][0] - a[1][0]).slice(0, 3).map(([k]) => k);

// ── T1 Next up ────────────────────────────────────────────────────────────

page({
  file: 'train-1-next-up.html',
  title: 'Train · Next up',
  nav: 'train',
  heading: 'Train',
  full: `<div class="t1">
  <div class="t1-main">
    <p class="t1-pair" aria-label="Next target: the pair ${t.pair}">${t.pair}</p>
    <p class="t1-words" aria-hidden="true">${t.words.map((w) => markPair(w, t.pair)).join(' ')}</p>
    <p class="t1-evidence">${ev(`${t.missed} of ${t.tries}`)} first tries missed · ${ev(`${t.slow} ms`)} slower than your pace</p>
    <div class="actions">${btn('primary', `Drill ${t.pair}`)}${btn('ghost', 'Choose another')}</div>
    ${lbl('30 s drill, then a retest on fresh text · english 1k · 25 words')}
  </div>
  <aside class="t1-side" aria-label="Next targets and recent fixes">
    <ol class="t1-queue">
${d.queue.map((q) => `      <li><button type="button" class="t1-q${q.unsure ? ' is-unsure' : ''}"><span class="t1-q-pair">${q.pair}</span><span class="t1-q-ev num">${q.unsure ? `${q.missed} of ${q.tries} · too few to tell` : `${q.missed} of ${q.tries} · +${q.slow} ms`}</span></button></li>`).join('\n')}
    </ol>
    <ul class="t1-fixed">
${d.fixed.map((f) => `      <li><span class="t1-q-pair">${f.pair}</span><span class="t1-q-ev num"><s>${f.before}</s> → <span class="up">${f.after}</span> ${f.what}</span></li>`).join('\n')}
    </ul>
  </aside>
</div>`,
  empty: `<div class="t1">
  <div class="t1-main">
    <p class="t1-general">General drill</p>
    <p class="t1-words" aria-hidden="true">there other about would which</p>
    <p class="t1-evidence">No pair stands out yet. Two more tests and one will.</p>
    <div class="actions">${btn('primary', 'Start general drill')}${btn('ghost', 'Take a test')}</div>
    ${lbl('30 s drill, then a retest on fresh text')}
  </div>
</div>`,
});

// ── T2 Skill map ──────────────────────────────────────────────────────────

const keyPanel = (k) => {
  const [rate, tries] = d.keys[k];
  const pairs = d.keyPairs[k] || [];
  const list = pairs.length
    ? `<ul class="t2-pairs">${pairs.map(([p, m, n]) => `<li data-heat="${d.pairHeat(m, n)}"><span class="t2-pair">${p}</span><span class="num">${m} of ${n}</span></li>`).join('')}</ul>`
    : '';
  return `<div class="t2-panel" id="t2-${k}" data-panel="t2"${k === 'b' ? '' : ' hidden'}>
    <p class="t2-key"><span class="t2-letter">${k}</span> <span class="num">${rate}%</span> of ${tries} first tries missed</p>
    ${list}
  </div>`;
};

page({
  file: 'train-2-skill-map.html',
  title: 'Train · Skill map',
  nav: 'train',
  heading: 'Train',
  full: `<div class="t2">
  ${keyboard({ selected: 'b', set: 't2' })}
  <div class="t2-detail">
    ${Object.keys(d.keys).map(keyPanel).join('\n    ')}
  </div>
  <div class="actions t2-actions">${btn('primary', `Drill ${hot[0]}, ${hot[1]} and ${hot[2]}`)}${btn('ghost', 'Drill only b')}</div>
</div>`,
  empty: `<div class="t2">
  ${keyboard({ empty: true, set: 't2e' })}
  <div class="t2-detail">${lbl('no tries yet', 't2-none')}</div>
  <div class="actions t2-actions">${btn('primary', 'Start general drill')}${btn('ghost', 'Take a test')}</div>
</div>`,
});

// ── T3 Session ────────────────────────────────────────────────────────────

const steps = (list) => `<ol class="t3-steps">
${list.map((s, i) => `  <li class="t3-step${i === 0 ? ' is-current' : ''}"><span class="t3-node" aria-hidden="true"></span><span class="lbl">${s.len}</span><span class="t3-name">${s.name}</span><span class="t3-ev">${s.ev}</span></li>`).join('\n')}
</ol>`;

const outcomeTone = { improved: 'success', steady: 'neutral', mixed: 'warning' };
const sessionRow = (s, lead) => `<li class="t3-past${lead ? ' is-lead' : ''}">
  <span class="lbl">${s.day.toLowerCase()}</span>
  <span class="t3-past-pair">${s.pair}</span>
  <span class="t3-past-fig num">${s.wpm[0]} → <span class="${s.outcome === 'improved' ? 'up' : s.outcome === 'mixed' ? 'mixed' : ''}">${s.wpm[1]}</span> <span class="unit">wpm</span></span>
  <span class="t3-past-fig num">${s.acc[0]} → <span class="${s.acc[1] > s.acc[0] ? 'up' : ''}">${s.acc[1]}</span><span class="unit pct">%</span></span>
  ${status(outcomeTone[s.outcome], s.outcome)}
</li>`;

page({
  file: 'train-3-session.html',
  title: 'Train · Session',
  nav: 'train',
  heading: 'Train',
  full: `<div class="t3">
  <div class="t3-bar">
    <div class="actions">${btn('primary', 'Start session')}<span class="lbl">about 3 min</span></div>
    <div class="t3-knobs">${seg('t3-len', [['l30', '30 s'], ['l60', '60 s'], ['l90', '90 s']], 'l30', 'Drill length')}${seg('t3-focus', [['fs', 'speed'], ['fa', 'accuracy']], 'fs', 'Focus')}</div>
  </div>
  ${steps([
    { len: '30 s', name: `Drill ${t.pair}`, ev: `${t.missed} of ${t.tries} missed` },
    { len: '25 words', name: 'Retest', ev: 'fresh text' },
    { len: '30 s', name: `Drill ${d.queue[0].pair}`, ev: `${d.queue[0].missed} of ${d.queue[0].tries} missed` },
    { len: '25 words', name: 'Retest', ev: 'fresh text' },
  ])}
  <ol class="t3-history" aria-label="Past sessions">
${d.sessions.map((s, i) => sessionRow(s, i === 0)).join('\n')}
  </ol>
  ${lbl(`retests on fresh text · ${d.conditions}`)}
</div>`,
  empty: `<div class="t3">
  <div class="t3-bar">
    <div class="actions">${btn('primary', 'Start session')}<span class="lbl">about 1 min</span></div>
    <div class="t3-knobs">${seg('t3e-len', [['e30', '30 s'], ['e60', '60 s'], ['e90', '90 s']], 'e30', 'Drill length')}${seg('t3e-focus', [['es', 'speed'], ['ea', 'accuracy']], 'es', 'Focus')}</div>
  </div>
  ${steps([
    { len: '30 s', name: 'General drill', ev: 'common pairs' },
    { len: '25 words', name: 'Retest', ev: 'fresh text' },
  ])}
  ${lbl('your first session sets the baseline', 't3-first')}
</div>`,
});

// ── Progress data ─────────────────────────────────────────────────────────

const w = d.week;
const xs = [[0, d.dayLabel(0)], [14, d.dayLabel(14)], [27, 'today']];
const bestIdx = 23;
const speedChart = (cls = '', compact = false) => chart({
  cls,
  label: `Speed by day, ${d.dayLabel(0)} to today. This week's median ${w.now.wpm} wpm over ${w.now.runs} runs; best ${d.best.wpm} on ${d.best.day}.`,
  values: d.series('wpm'),
  dots: compact ? [] : d.dots('wpm'),
  min: 60,
  max: 95,
  ticks: [60, 70, 80, 90],
  xs,
  notes: compact
    ? [{ i: 27, v: d.series('wpm')[27], html: `<span class="note-fig num">${w.now.wpm}<span class="unit">wpm</span></span>`, place: 'gutter' }]
    : [
        { i: bestIdx, v: d.best.wpm, html: `<span class="note-fig num">${d.best.wpm}</span><span class="sub">best · ${d.best.day}</span>`, anchor: 'end', mark: true },
        { i: 27, v: d.series('wpm')[27], html: `<span class="note-big num">${w.now.wpm}<span class="unit">wpm</span></span><span class="sub">this week, median of ${w.now.runs} runs</span>`, place: 'gutter' },
      ],
});
const accChart = (cls = '', compact = false) => chart({
  cls,
  label: `Accuracy by day. This week's median ${w.now.acc}% over ${w.now.runs} runs.`,
  values: d.series('acc'),
  dots: compact ? [] : d.dots('acc'),
  min: 90,
  max: 100,
  ticks: [90, 95, 100],
  xs,
  notes: compact
    ? [{ i: 27, v: d.series('acc')[27], html: `<span class="note-fig num">${w.now.acc}<span class="unit pct">%</span></span>`, place: 'gutter' }]
    : [{ i: 27, v: d.series('acc')[27], html: `<span class="note-big num">${w.now.acc}<span class="unit pct">%</span></span><span class="sub">this week, median of ${w.now.runs} runs</span>`, place: 'gutter' }],
});
const consChart = () => chart({
  label: `Consistency by day. This week's median ${w.now.cons}%.`,
  values: d.series('cons'),
  dots: d.dots('cons'),
  min: 60,
  max: 90,
  ticks: [60, 70, 80, 90],
  xs,
  notes: [{ i: 27, v: d.series('cons')[27], html: `<span class="note-big num">${w.now.cons}<span class="unit pct">%</span></span><span class="sub">consistency this week, ${w.now.runs} runs</span>`, place: 'gutter' }],
});
const practiceChart = () => chart({
  label: `Practice minutes by day against a ${d.goal} minute goal. ${d.streak} days in a row.`,
  values: d.minutes,
  bars: true,
  goal: d.goal,
  min: 0,
  max: 30,
  ticks: [0, 15, 30],
  xs,
  notes: [{ i: 27, v: 24, html: `<span class="note-big num">${d.streak}<span class="unit">days in a row</span></span><span class="sub">${w.now.minutes} min this week, goal ${d.goal} a day</span>`, anchor: 'end', mark: false }],
});

const runRows = (rows) => rows.map((r) => `<tr><td class="lbl">${r.day.toLowerCase()} · ${r.time}</td><td class="num">${r.wpm}<span class="unit">wpm</span></td><td class="num">${r.acc}<span class="unit pct">%</span></td></tr>`).join('\n');

const filters = (prefix) => `<div class="p-filters">
    ${seg(`${prefix}-period`, [[`${prefix}-7`, '7 days'], [`${prefix}-30`, '30 days'], [`${prefix}-all`, 'all']], `${prefix}-30`, 'Period')}
    <button class="p-cond" type="button" aria-label="Conditions: ${d.conditions}">english 1k · 25 words <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>
  </div>`;

// ── P1 One chart ──────────────────────────────────────────────────────────

page({
  file: 'progress-1-one-chart.html',
  title: 'Progress · One chart',
  nav: 'progress',
  heading: 'Progress',
  full: `<div class="p1">
  <div class="p1-bar">
    ${seg('p1', [['p1-speed', 'Speed'], ['p1-acc', 'Accuracy'], ['p1-cons', 'Consistency'], ['p1-practice', 'Practice']], 'p1-speed', 'Metric')}
    ${filters('p1')}
  </div>
  <div class="p1-stage">
    <div id="p1-speed" data-panel="p1">${speedChart('chart-hero')}</div>
    <div id="p1-acc" data-panel="p1" hidden>${accChart('chart-hero')}</div>
    <div id="p1-cons" data-panel="p1" hidden>${consChart()}</div>
    <div id="p1-practice" data-panel="p1" hidden>${practiceChart()}</div>
  </div>
  <table class="p-runs">
    <caption class="sr-only">Latest runs</caption>
    <tbody>
${runRows(d.recentRuns.slice(0, 8))}
    </tbody>
  </table>
  <div class="actions">${btn('ghost', `All ${d.totalRuns} runs`)}</div>
</div>`,
  empty: `<div class="p1">
  <div class="p1-bar">
    ${seg('p1e', [['p1e-speed', 'Speed'], ['p1e-acc', 'Accuracy'], ['p1e-cons', 'Consistency'], ['p1e-practice', 'Practice']], 'p1e-speed', 'Metric')}
  </div>
  <div class="p1-stage p1-empty">
    ${chart({ cls: 'chart-hero', label: 'No runs yet', values: [], min: 0, max: 100, ticks: [0, 25, 50, 75, 100], xs: [] })}
    <div class="p1-empty-call">${btn('primary', 'Take a test')}${lbl('no runs yet')}</div>
  </div>
</div>`,
});

// ── P2 At a glance ────────────────────────────────────────────────────────

const spark = (key, min, max) => chart({
  cls: 'chart-spark',
  label: `${key} by day`,
  values: d.series(key),
  min,
  max,
  notes: [],
});

const strip = (empty) => `<ol class="p2-strip" aria-label="Practice by day">${d.days
  .map((day) => {
    const m = empty ? 0 : day.minutes;
    const level = m === 0 ? 0 : m >= d.goal ? 4 : m >= 10 ? 3 : m >= 5 ? 2 : 1;
    const met = level === 4 ? ' data-met' : '';
    return `<li data-level="${level}"${met} title="${day.label}: ${m} min"><span class="sr-only">${day.label}: ${m} min</span></li>`;
  })
  .join('')}</ol>`;

const metric = (fig, unit, word, delta, sparkHtml) => `<div class="p2-metric">
    <p class="p2-fig num">${fig}<span class="unit">${unit}</span>${word ? `<span class="p2-word">${word}</span>` : ''}</p>
    ${delta}
    ${sparkHtml}
  </div>`;
const deltaLine = (diff, unit) => `<p class="p2-delta"><span class="up num">${diff}${unit}</span> on last week · ${w.now.runs} and ${w.then.runs} runs</p>`;

page({
  file: 'progress-2-at-a-glance.html',
  title: 'Progress · At a glance',
  nav: 'progress',
  heading: 'Progress',
  full: `<div class="p2">
  ${filters('p2')}
  <div class="p2-row p2-metrics">
  ${metric(w.now.wpm, 'wpm', '', deltaLine(`+${w.now.wpm - w.then.wpm}`, ''), spark('wpm', 60, 95))}
  ${metric(w.now.acc, '%', 'accuracy', deltaLine(`+${(w.now.acc - w.then.acc).toFixed(1)}`, ''), spark('acc', 90, 100))}
  ${metric(w.now.cons, '%', 'consistency', deltaLine(`+${w.now.cons - w.then.cons}`, ''), spark('cons', 60, 90))}
  </div>
  <div class="p2-row p2-habits">
    <div class="p2-practice">
      <p class="p2-fig num">${d.streak}<span class="unit">days in a row</span></p>
      <p class="p2-delta"><span class="num">9 of ${d.goal}</span> min today · <span class="num">${w.now.minutes}</span> this week</p>
      ${strip(false)}
      <p class="lbl p2-strip-ends"><span>${d.dayLabel(0).toLowerCase()}</span><span>today</span></p>
    </div>
    <div class="p2-keys">
      ${keyboard({ size: 'small' })}
      <p class="p2-delta">${hot.map((k) => `<span class="num">${k} ${Math.round(d.keys[k][0])}%</span>`).join(' · ')} of first tries missed</p>
    </div>
  </div>
  <div class="p2-row p2-lists">
    <ol class="p2-sessions" aria-label="Drills and retests">
${d.sessions.map((s) => `      <li><span class="t3-past-pair">${s.pair}</span><span class="num">${s.wpm[0]} → <span class="${s.outcome === 'improved' ? 'up' : s.outcome === 'mixed' ? 'mixed' : ''}">${s.wpm[1]}</span> <span class="unit">wpm</span></span><span class="lbl">${s.day.toLowerCase()}</span></li>`).join('\n')}
    </ol>
    <div class="p2-standard">
      <p class="p2-fig num">${d.standard.wpm}<span class="unit">wpm</span><span class="p2-word">standard</span></p>
      <p class="p2-delta">median of ${d.standard.runs} standard tests</p>
      <div class="actions">${btn('secondary', 'Take the standard test')}${btn('ghost', `All ${d.totalRuns} runs`)}</div>
    </div>
  </div>
</div>`,
  empty: `<div class="p2">
  <div class="actions p2-empty-call">${btn('primary', 'Take a test')}${lbl('every panel fills from your runs')}</div>
  <div class="p2-row p2-metrics">
  ${metric('—', 'wpm', '', '', '<div class="chart chart-spark is-empty"></div>')}
  ${metric('—', '%', 'accuracy', '', '<div class="chart chart-spark is-empty"></div>')}
  ${metric('—', '%', 'consistency', '', '<div class="chart chart-spark is-empty"></div>')}
  </div>
  <div class="p2-row p2-habits">
    <div class="p2-practice">
      <p class="p2-fig num">0<span class="unit">days in a row</span></p>
      ${strip(true)}
    </div>
    <div class="p2-keys">${keyboard({ size: 'small', empty: true })}</div>
  </div>
</div>`,
});

// ── P3 What changed ───────────────────────────────────────────────────────

const moved = [
  { name: d.fixed[0].pair, change: `<s>${d.fixed[0].before}</s> → <span class="up">${d.fixed[0].after}</span> ${d.fixed[0].what}`, tone: 'success', word: 'fixed' },
  { name: d.fixed[1].pair, change: `<s>${d.fixed[1].before}</s> → <span class="up">${d.fixed[1].after}</span> ${d.fixed[1].what}`, tone: 'success', word: 'fixed' },
  { name: d.slipping.pair, change: `${d.slipping.before} → <span class="down">${d.slipping.after}</span> ${d.slipping.what}`, tone: 'danger', word: 'slipping', action: btn('secondary btn-sm', `Drill ${d.slipping.pair}`) },
  { name: 'practice', change: `${w.then.minutes} → ${w.now.minutes} min · ${d.streak} days in a row`, tone: 'neutral', word: 'less', small: true },
];

page({
  file: 'progress-3-what-changed.html',
  title: 'Progress · What changed',
  nav: 'progress',
  heading: 'Progress',
  full: `<div class="p3">
  <div class="p3-lead">
    <p class="p3-delta num"><span class="up">+${w.now.wpm - w.then.wpm}</span><span class="unit">wpm</span></p>
    <div class="p3-context">
      <p class="p3-sentence"><span class="num">${w.now.wpm}</span> this week, <span class="num">${w.then.wpm}</span> the week before</p>
      ${lbl(`medians of ${w.now.runs} and ${w.then.runs} runs · ${d.conditions}`)}
    </div>
  </div>
  <ul class="p3-moved">
${moved.map((m) => `    <li class="${m.small ? 'is-small' : ''}"><span class="p3-name">${m.name}</span><span class="p3-change num">${m.change}</span>${status(m.tone, m.word)}<span class="p3-act">${m.action || ''}</span></li>`).join('\n')}
  </ul>
  <div class="p3-charts">
    <div>${speedChart('chart-mid', true)}</div>
    <div>${accChart('chart-mid', true)}</div>
  </div>
  <div class="actions">${btn('ghost', `All ${d.totalRuns} runs`)}${btn('ghost', 'Keys')}${btn('ghost', 'Practice calendar')}</div>
</div>`,
  empty: `<div class="p3">
  <div class="p3-lead">
    <p class="p3-delta num is-empty">—</p>
    <div class="p3-context">
      <p class="p3-sentence">Nothing to compare yet</p>
      ${lbl('a week of tests shows what moved')}
    </div>
  </div>
  <div class="actions">${btn('primary', 'Take a test')}${btn('ghost', 'Take the standard test')}</div>
</div>`,
});

// ── Challenge data ────────────────────────────────────────────────────────

const tally = (f) => `<span class="num">${f.tally[0]}–${f.tally[1]}</span>`;
const lastLine = (f) => {
  const won = f.last.you > f.last.them;
  return `${won ? 'won' : 'lost'} <span class="num">${f.last.you}–${f.last.them}</span> · ${f.last.day.toLowerCase()}`;
};
const invite = d.friends.find((f) => f.invite);
const ghost = d.friends.find((f) => f.ghost);

// ── C1 People ─────────────────────────────────────────────────────────────

page({
  file: 'challenge-1-people.html',
  title: 'Challenge · People',
  nav: 'compete',
  heading: 'Challenge',
  full: `<ul class="c1">
  <li class="c1-row is-match">
    <span class="c1-who"><span class="c1-name">Quick match</span><span class="c1-last">near ${w.now.wpm} wpm · rating ${d.rating.value}</span></span>
    <span class="c1-acts">${btn('primary', 'Find a race')}</span>
  </li>
${[...d.friends].sort((a, b) => Number(Boolean(b.invite || b.ghost)) - Number(Boolean(a.invite || a.ghost))).map((f) => {
    const ask = f.invite ? `invited you · ${f.invite}` : f.ghost ? `sent a ghost at ${f.ghost.wpm} wpm · ${f.ghost.left}` : '';
    const acts = f.invite ? `${btn('secondary', 'Join')}${btn('ghost', 'Decline')}` : f.ghost ? btn('secondary', 'Race the ghost') : btn('secondary', 'Race');
    return `  <li class="c1-row${ask ? ' is-ask' : ''}">
    <span class="c1-who"><span class="c1-name">${f.name}${f.online ? ' <span class="c1-on" aria-label="online"></span>' : ''}</span><span class="c1-last">${ask || lastLine(f)}</span></span>
    <span class="c1-tally" aria-label="You ${f.tally[0]}, ${f.name.split(' ')[0]} ${f.tally[1]}">${tally(f)}</span>
    <span class="c1-acts">${acts}</span>
  </li>`;
  }).join('\n')}
  <li class="c1-row is-foot">
    <span class="c1-acts">${btn('ghost', 'Add a friend')}${btn('ghost', 'Copy a race link')}</span>
    <span class="c1-acts">${btn('ghost', `Daily passage · #${d.daily.you.rank}`)}${btn('ghost', 'One keyboard')}</span>
  </li>
</ul>`,
  empty: `<ul class="c1">
  <li class="c1-row is-match">
    <span class="c1-who"><span class="c1-name">Quick match</span><span class="c1-last">unranked as a guest</span></span>
    <span class="c1-acts">${btn('primary', 'Find a race')}</span>
  </li>
  <li class="c1-row">
    <span class="c1-who"><span class="c1-name">A friend</span><span class="c1-last">anyone with the link joins</span></span>
    <span class="c1-acts">${btn('secondary', 'Copy a race link')}</span>
  </li>
  <li class="c1-row">
    <span class="c1-who"><span class="c1-name">Daily passage</span><span class="c1-last">${d.daily.players} typed it today</span></span>
    <span class="c1-acts">${btn('secondary', 'Type it')}</span>
  </li>
  <li class="c1-row is-foot">
    <span class="c1-acts">${btn('ghost', 'Sign in to keep friends')}${btn('ghost', 'One keyboard')}</span>
  </li>
</ul>`,
});

// ── C2 Ladder ─────────────────────────────────────────────────────────────

const boardRow = (rank, name, wpm, acc, extra = '') => `<tr class="${name === 'you' ? 'is-you' : ''}"><td class="num c2-rank">${rank}</td><td class="c2-name">${name}</td><td class="num">${wpm}<span class="unit">wpm</span></td><td class="num c2-acc">${acc}<span class="unit pct">%</span></td>${extra}</tr>`;
const friendsBoard = [...d.friends.map((f) => ({ name: f.name, wpm: f.week, rating: f.rating })), { name: 'you', wpm: d.best.wpm, rating: d.rating.value }].sort((a, b) => b.wpm - a.wpm);

page({
  file: 'challenge-2-ladder.html',
  title: 'Challenge · Ladder',
  nav: 'compete',
  heading: 'Challenge',
  full: `<div class="c2">
  <div class="c2-strip">
    <div class="actions">${btn('primary', 'Quick match')}${btn('secondary', 'Race a friend')}${btn('ghost', 'One keyboard')}</div>
    <p class="c2-rating"><span class="num c2-rating-fig">${d.rating.value}</span><span class="sub">rating · <span class="up num">${d.rating.change}</span> over ${d.rating.matches} matches</span></p>
  </div>
  <div class="c2-boards">
    <section class="c2-board" aria-label="Daily passage, ${d.daily.date}">
      <div class="c2-head"><p class="c2-title">${d.daily.date}</p>${lbl(`${d.daily.players} typists · resets 00:00 utc`)}${btn('secondary btn-sm', 'Type it again')}</div>
      <table><tbody>
${d.daily.rows.map(([n, wpm, acc], i) => boardRow(i + 1, n, wpm, acc)).join('\n')}
      </tbody></table>
    </section>
    <section class="c2-board" aria-label="Friends, best this week">
      <div class="c2-head"><p class="c2-title">Friends</p>${lbl('best this week')}</div>
      <table><tbody>
${friendsBoard.map((f, i) => boardRow(i + 1, f.name, f.wpm, '', `<td class="num c2-r">${f.rating}</td>`).replace('<td class="num c2-acc"><span class="unit pct">%</span></td>', '')).join('\n')}
      </tbody></table>
    </section>
  </div>
</div>`,
  empty: `<div class="c2">
  <div class="c2-strip">
    <div class="actions">${btn('primary', 'Quick match')}${btn('secondary', 'Race a friend')}${btn('ghost', 'One keyboard')}</div>
    <p class="c2-rating"><span class="c2-rating-fig is-empty">unrated</span><span class="sub">sign in and play a quick match</span></p>
  </div>
  <div class="c2-boards">
    <section class="c2-board" aria-label="Daily passage, ${d.daily.date}">
      <div class="c2-head"><p class="c2-title">${d.daily.date}</p>${lbl(`${d.daily.players} typists · resets 00:00 utc`)}${btn('secondary btn-sm', 'Type it')}</div>
      <table><tbody>
${d.daily.rows.filter(([n]) => n !== 'you').slice(0, 12).map(([n, wpm, acc], i) => boardRow(i + 1, n, wpm, acc)).join('\n')}
        <tr class="is-you"><td class="num c2-rank">·</td><td class="c2-name">you</td><td class="lbl" colspan="2">not yet today</td></tr>
      </tbody></table>
    </section>
    <section class="c2-board" aria-label="Friends">
      <div class="c2-head"><p class="c2-title">Friends</p></div>
      <div class="c2-signin">${btn('secondary', 'Sign in')}${lbl('friends see your best when you share it')}</div>
    </section>
  </div>
</div>`,
});

// ── C3 One button ─────────────────────────────────────────────────────────

const h2h = d.friends.slice(0, 5).map((f) => `<li><span class="c3-h-name">${f.name.split(' ')[0]}</span><span class="c1-last">${lastLine(f)}</span>${tally(f)}</li>`).join('\n');

page({
  file: 'challenge-3-one-button.html',
  title: 'Challenge · One button',
  nav: 'compete',
  heading: 'Challenge',
  full: `<div class="c3">
  <div class="c3-hero">
    <button class="btn btn-primary c3-race" type="button">Race</button>
    ${sub(`someone near ${w.now.wpm} wpm · rating ${d.rating.value}`)}
    <div class="c3-friends" role="group" aria-label="Race a friend">
      ${d.friends.slice(0, 5).map((f) => `<button class="btn btn-secondary btn-sm" type="button">${f.online ? '<span class="c1-on" aria-label="online"></span>' : ''}${f.name.split(' ')[0]}</button>`).join('')}
      ${btn('ghost btn-sm', 'Link')}
    </div>
    ${invite ? `<p class="c3-invite">${invite.name.split(' ')[0]} invited you · ${invite.invite} ${btn('ghost btn-sm', 'Join')}</p>` : ''}
  </div>
  <div class="c3-below">
    <div class="c3-daily">
      <p class="c3-small-head">Daily passage</p>
      <p class="c3-daily-fig"><span class="num">#${d.daily.you.rank}</span> <span class="sub">of ${d.daily.players} · ${d.daily.you.wpm} wpm · ${d.daily.you.acc}%</span></p>
      ${btn('ghost btn-sm', 'Type it again')}
    </div>
    <ol class="c3-h2h" aria-label="Recent races">
${h2h}
    </ol>
  </div>
</div>`,
  empty: `<div class="c3">
  <div class="c3-hero">
    <button class="btn btn-primary c3-race" type="button">Race</button>
    ${sub('someone near your speed · unranked as a guest')}
    <div class="c3-friends">${btn('secondary btn-sm', 'Copy a link for a friend')}</div>
  </div>
  <div class="c3-below">
    <div class="c3-daily">
      <p class="c3-small-head">Daily passage</p>
      <p class="c3-daily-fig"><span class="sub">${d.daily.players} typed it today</span></p>
      ${btn('ghost btn-sm', 'Type it')}
    </div>
  </div>
</div>`,
});

await import('./train-round-2.mjs').then((m) => m.build({ page, btn, lbl, d }));
console.log('wrote 14 directions');
