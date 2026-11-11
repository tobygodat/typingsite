// Round two of the Train directions (T4–T8), written by build.mjs into the same folder. Throwaway.

const say = (n) => `<span class="num">${n}</span>`;

export function build({ page, btn, lbl, d }) {
  const t = d.target;
  const r = d.retest;
  const [ce, ex, un] = d.queue;
  const evidence = {
    br: `${say(`${t.missed} of ${t.tries}`)} first tries missed · ${say(4)} runs`,
    ce: `${say(`${ce.missed} of ${ce.tries}`)} first tries missed · ${say(3)} runs`,
  };
  const since = `<s class="num">${r.missed.before[0]} of ${r.missed.before[1]}</s> → <span class="up num">${r.missed.after[0]} of ${r.missed.after[1]}</span> missed`;
  const compare = `${say(r.wpm[0])} → <span class="up num">${r.wpm[1]}</span><span class="unit">wpm</span> <span class="t-dot">·</span> ${say(r.acc[0].toFixed(1))} → <span class="up num">${r.acc[1].toFixed(1)}</span><span class="unit pct">%</span>`;

  // ── The real typing surface, static ────────────────────────────────────
  const passage = (text, label) => {
    const words = text.split(' ');
    const html = words
      .map((w, i) => `<span class="word">${[...w].map((c) => `<span class="char">${c}</span>`).join('')}</span>${i < words.length - 1 ? '<span class="char"> </span>' : ''}`)
      .join('');
    return `<div class="typing-wrap t-wrap" data-caret="idle" role="img" aria-label="${label}">
      <div class="t-text"><span class="caret" aria-hidden="true"><span class="caret-bar"></span></span>${html}</div>
    </div>`;
  };
  const live = `<div class="live-stats" aria-label="Ready, 30 seconds">
      <div class="live-stat timer-stat"><strong class="num">30</strong><span>s</span></div>
      <div class="live-stat"><strong class="num">—</strong><span>wpm</span></div>
      <div class="live-stat"><strong class="num">—</strong><span>%</span></div>
    </div>`;
  // Drill and retest as two lengths of one line: 30 s, then about 20 s of fresh text.
  const steps = `<div class="t-steps" role="progressbar" aria-label="Drill, then retest" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <span class="progress-line t-step-drill"><span class="t-fill"></span></span><span class="progress-line t-step-retest"></span>
    </div>`;
  const keys = `<div class="typing-footer t-keys">
      <p class="lbl"><kbd>tab</kbd> another target <span class="t-gap"></span><kbd>esc</kbd> restart</p>
      <button class="icon-control" type="button" aria-label="Restart"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7"/></svg></button>
    </div>`;
  const receipt = (extra = '') => `<div class="t-receipt">
      <span class="t-receipt-pair">${r.pair}</span>
      <span class="t-receipt-fig">${since}</span>
      <span class="t-receipt-fig">${compare}</span>
      ${extra}
    </div>`;

  // ── T4 Just type ───────────────────────────────────────────────────────
  const t4Head = (pair, ev, cond) => `<div class="measure-row t4-measure">
      <div class="t4-target">
        <p class="t4-line"><span class="t4-pair">${pair}</span><span class="t4-ev">${ev}</span></p>
        ${lbl(cond)}
      </div>
      ${live}
    </div>`;
  const cond = '30 s · then 25 words on fresh text · english 1k';

  page({
    file: 'train-4-just-type.html',
    title: 'Train · Just type',
    nav: 'train',
    heading: 'Train',
    full: `<div class="t-surface">
    ${t4Head('br', evidence.br, cond)}
    ${passage(d.drillPassage.br, 'Drill passage for br')}
    ${steps}
    ${keys}
  </div>`,
    empty: `<div class="t-surface">
    ${t4Head('common words', '', '30 s · then 25 words on fresh text')}
    ${passage(d.drillPassage.general, 'General drill passage')}
    ${steps}
    ${keys}
  </div>`,
    after: `<div class="t-surface">
    ${receipt(lbl(`retest · 25 words · against your last ${r.baselineRuns}`, 't-receipt-cond'))}
    ${t4Head('ce', evidence.ce, cond)}
    ${passage(d.drillPassage.ce, 'Drill passage for ce')}
    ${steps}
    ${keys}
  </div>`,
  });

  // ── T5 Path ────────────────────────────────────────────────────────────
  const stop = (kind, pair, line, line2 = '') => `<li class="t5-stop is-${kind}">
      <span class="t5-node" aria-hidden="true"></span>
      <span class="t5-pair">${pair}</span>
      ${line ? `<span class="t5-ev">${line}</span>` : ''}${line2 ? `<span class="t5-ev">${line2}</span>` : ''}
    </li>`;
  const fixedStops = d.fixed.map((f) => stop('fixed', f.pair, `<s class="num">${f.before}</s> → <span class="up num">${f.after}</span>`));
  const open = (pair, ev, words) => `<div class="t5-open">
      <p class="t5-open-ev">${ev}</p>
      <p class="t5-words" aria-hidden="true">${words.map((w) => w.replace(pair, `<b>${pair}</b>`)).join(' ')}</p>
      <div class="actions">${btn('primary', pair.length === 2 ? `Drill ${pair}` : 'Start general drill')}${lbl('30 s, then 25 words on fresh text')}</div>
    </div>`;
  const path = (stops, now) => `<ol class="t5-path" aria-label="Targets">
    ${stops.join('\n    ')}
  </ol>`;

  page({
    file: 'train-5-path.html',
    title: 'Train · Path',
    nav: 'train',
    heading: 'Train',
    full: `<div class="t5" style="--now:3">
  ${path([
    ...fixedStops,
    stop('now', 'br', ''),
    stop('ahead', ce.pair, `<span class="num">${ce.missed} of ${ce.tries}</span> missed`),
    stop('ahead', ex.pair, `<span class="num">${ex.slow} ms</span> slower`),
    stop('ahead', un.pair, `<span class="num">${un.missed} of ${un.tries}</span> missed`),
  ], 3)}
  ${open('br', evidence.br, t.words)}
</div>`,
    empty: `<div class="t5" style="--now:1">
  ${path([
    stop('now', 'common words', ''),
    stop('ahead', '', ''),
    stop('ahead', '', ''),
    stop('ahead', '', ''),
  ], 1)}
  <div class="t5-open">
    <p class="t5-words" aria-hidden="true">the there other about would which</p>
    <div class="actions">${btn('primary', 'Start general drill')}${lbl('30 s, then 25 words on fresh text')}</div>
  </div>
</div>`,
    after: `<div class="t5" style="--now:4">
  ${path([
    ...fixedStops,
    stop('drilled', 'br', since, compare),
    stop('now', ce.pair, ''),
    stop('ahead', ex.pair, `<span class="num">${ex.slow} ms</span> slower`),
    stop('ahead', un.pair, `<span class="num">${un.missed} of ${un.tries}</span> missed`),
  ], 4)}
  ${open('ce', evidence.ce, ['once', 'place', 'center', 'voice', 'certain'])}
</div>`,
  });

  // ── T6 The reach ───────────────────────────────────────────────────────
  const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const board = ({ reach = '', home = false }) => `<div class="keyboard t6-board" data-fingers="true" ${reach ? `data-reach="${reach}"` : ''} role="img" aria-label="${reach ? `${reach[0]} and ${reach[1]}, both ${d.fingers[reach[0]][0]} ${d.fingers[reach[0]][1]}` : 'Keyboard with a finger for each key'}">
    ${rows.map((row) => `<div class="key-row">${[...row].map((k) => {
      const [hand, finger, col] = d.fingers[k];
      const on = reach.includes(k) || (home && (k === 'f' || k === 'j'));
      return `<span class="key${on ? ' is-reach' : ''}" data-key="${k}" data-hand="${hand}" data-finger="${finger}" data-column="${col}">${k}</span>`;
    }).join('')}</div>`).join('\n    ')}
    <svg class="reach-line" aria-hidden="true"></svg>
  </div>`;
  const why = (pair) => {
    const [hand, finger] = d.fingers[pair[0]];
    return `Both on your ${hand} ${finger} finger`;
  };

  page({
    file: 'train-6-the-reach.html',
    title: 'Train · The reach',
    nav: 'train',
    heading: 'Train',
    full: `<div class="t6">
  ${board({ reach: 'br' })}
  <div class="t6-text">
    <p class="t6-pair">br</p>
    <p class="t6-why">${why('br')}</p>
    <p class="t6-ev">${evidence.br}</p>
    <div class="actions">${btn('primary', 'Drill br')}${btn('ghost', 'Another pair')}</div>
  </div>
</div>`,
    empty: `<div class="t6">
  ${board({ home: true })}
  <div class="t6-text">
    <p class="t6-pair is-general">General drill</p>
    <p class="t6-ev">${lbl('30 s · common words')}</p>
    <div class="actions">${btn('primary', 'Start general drill')}</div>
  </div>
</div>`,
    after: `<div class="t6">
  ${board({ reach: 'ce' })}
  <div class="t6-text">
    ${receipt()}
    <p class="t6-pair">ce</p>
    <p class="t6-why">${why('ce')}</p>
    <p class="t6-ev">${evidence.ce}</p>
    <div class="actions">${btn('primary', 'Drill ce')}${btn('ghost', 'Another pair')}</div>
  </div>
</div>`,
  });

  // ── T7 Today ───────────────────────────────────────────────────────────
  const minutes = (done, next = true) => `<ol class="t7-minutes" role="img" aria-label="${done} of ${d.goal} minutes today">${Array.from({ length: d.goal }, (_, i) => `<li class="${i < done ? 'is-done' : i === done && next ? 'is-next' : ''}"></li>`).join('')}</ol>`;
  const week = (empty) => `<ol class="t7-week" aria-hidden="true">${d.days.slice(21).map((day) => `<li class="${empty ? '' : day.minutes >= d.goal ? 'is-met' : day.minutes ? 'is-some' : ''}${day.i === 27 ? ' is-today' : ''}"></li>`).join('')}</ol>`;
  const lead = (done, streakHtml) => `<div class="t7-lead">
    <p class="t7-fig num">${done}<span class="unit">of ${d.goal} min</span></p>
    ${streakHtml}
  </div>`;
  const streak = (empty = false) => `<div class="t7-streak">${week(empty)}${empty ? '' : `<p class="sub"><span class="num">${d.streak}</span> days in a row</p>`}</div>`;
  const row = (name, ev, len, action, cls = '') => `<li class="t7-row ${cls}">
      <span class="t7-name">${name}</span>
      <span class="t7-ev">${ev}</span>
      <span class="t7-len lbl">${len}</span>
      <span class="t7-act">${action}</span>
    </li>`;

  page({
    file: 'train-7-today.html',
    title: 'Train · Today',
    nav: 'train',
    heading: 'Train',
    full: `<div class="t7">
  ${lead(d.today.minutes, streak())}
  ${minutes(d.today.minutes)}
  <ol class="t7-rows">
    ${row('br', evidence.br, '1 min', btn('primary', 'Drill br'), 'is-next')}
    ${row(ce.pair, `${say(`${ce.missed} of ${ce.tries}`)} first tries missed`, '1 min', btn('secondary', `Drill ${ce.pair}`))}
    ${row(ex.pair, `${say(`${ex.slow} ms`)} slower than your pace`, '1 min', btn('secondary', `Drill ${ex.pair}`))}
  </ol>
</div>`,
    empty: `<div class="t7">
  ${lead(0, streak(true))}
  ${minutes(0)}
  <ol class="t7-rows">
    ${row('General drill', 'common words', '1 min', btn('primary', 'Start general drill'), 'is-next is-general')}
    ${row('Test', '', '25 words', btn('ghost', 'Take a test'))}
  </ol>
</div>`,
    after: `<div class="t7">
  ${lead(d.today.afterDrill, streak())}
  ${minutes(d.today.afterDrill)}
  <ol class="t7-rows">
    ${row('br', `${since} <span class="t-dot">·</span> ${compare}`, 'just now', '', 'is-done')}
    ${row(ce.pair, evidence.ce, '1 min', btn('primary', `Drill ${ce.pair}`), 'is-next')}
    ${row(ex.pair, `${say(`${ex.slow} ms`)} slower than your pace`, '1 min', btn('secondary', `Drill ${ex.pair}`))}
  </ol>
</div>`,
  });

  // ── T8 Warm-up (hybrid: T4's surface, T6's keys, T7's minutes) ─────────
  const caps = (pair) => `<span class="t8-caps" aria-label="${pair}, ${d.fingers[pair[0]][0]} ${d.fingers[pair[0]][1]} finger for both">${[...pair].map((k) => `<span class="t8-cap" data-finger="${d.fingers[k][1]}">${k}</span>`).join('')}</span>`;
  const t8Head = (pairHtml, ev, done) => `<div class="measure-row t8-measure">
      <div class="t4-target">
        <p class="t4-line">${pairHtml}<span class="t4-ev">${ev}</span></p>
        ${lbl(cond)}
      </div>
      ${live}
      <div class="t8-day" role="img" aria-label="${done} of ${d.goal} minutes today">${Array.from({ length: d.goal }, (_, i) => `<span class="${i < done ? 'is-done' : ''}"></span>`).join('')}</div>
    </div>`;
  const dayNote = (done, streakDays) => `<p class="lbl t8-note">${done} of ${d.goal} min today${streakDays ? ` · ${streakDays} days in a row` : ''}</p>`;
  const t8Keys = (done, streakDays) => `<div class="typing-footer t-keys">
      ${dayNote(done, streakDays)}
      <p class="lbl"><kbd>tab</kbd> another target <span class="t-gap"></span><kbd>esc</kbd> restart</p>
    </div>`;

  page({
    file: 'train-8-warm-up.html',
    title: 'Train · Warm-up',
    nav: 'train',
    heading: 'Train',
    full: `<div class="t-surface">
    ${t8Head(caps('br'), evidence.br, d.today.minutes)}
    ${passage(d.drillPassage.br, 'Drill passage for br')}
    ${steps}
    ${t8Keys(d.today.minutes, d.streak)}
  </div>`,
    empty: `<div class="t-surface">
    ${t8Head('<span class="t4-pair">common words</span>', '', 0)}
    ${passage(d.drillPassage.general, 'General drill passage')}
    ${steps}
    ${t8Keys(0, 0)}
  </div>`,
    after: `<div class="t-surface">
    ${receipt(lbl(`retest · 25 words · against your last ${r.baselineRuns}`, 't-receipt-cond'))}
    ${t8Head(caps('ce'), evidence.ce, d.today.afterDrill)}
    ${passage(d.drillPassage.ce, 'Drill passage for ce')}
    ${steps}
    ${t8Keys(d.today.afterDrill, d.streak)}
  </div>`,
  });
}
