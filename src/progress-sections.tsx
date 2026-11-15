import { createProgressNavigation } from './progress-navigation.js';
import { createProgressFilters } from './progress-filters.js';
import { createProgressCalendar } from './progress-calendar.js';
import { Fragment, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { createStore } from './store.js';
import type { CopyPart } from './practice-session.js';
import { Copy } from './results-card.js';
import { unitText } from './units.js';
import type { ProgressDetail } from './progress-filters.js';

export interface RunRowView { id?: string; wpm: number; accuracy: number; date: string; errors?: number; time: string; description: CopyPart[]; textNote: string; passage?: string | number | boolean | null }

export interface RunTableRow { key: string; wpm: number; accuracy: string; day: string; kind: string; best: boolean }

export interface CompositionRowView { id: string; wpm: number | null; backspaceRate: number | null; prompt: string; detail: string }

// The lead cells: this week's median speed against the week before's, and accuracy beside it. `week` names which
// week the figures are (or the latest run when neither week has a median); `change` is the difference of the two
// whole medians, in the note.
export interface LeadView { week: string; figure: string | null; change: string | null; spoken: string; sentence: CopyPart[]; sample: string; note: string; state: string; tone: string;
  accuracy: string | null; accuracyChange: string | null }

export interface MoverView { unit: string; before: string; after: string; tail: string; title: string; status: string }

export interface PracticeCellView { minutes: string; note: string }

export function createProgressSections() {
  const runs = createStore<{ rows: RunRowView[]; total: number; revision: number }>({ rows: [], total: 0, revision: 0 });
  const table = createStore<{ rows: RunTableRow[]; empty: string }>({ rows: [], empty: '' });
  const composing = createStore<{ rows: CompositionRowView[]; note: string }>({ rows: [], note: '' });
  const lead = createStore<LeadView>({ week: '', figure: null, change: null, spoken: '', sentence: [], sample: '', note: '', state: 'none', tone: 'none', accuracy: null, accuracyChange: null });
  const movers = createStore<{ rows: MoverView[]; open: boolean; extra: number; shown: number; practice: PracticeCellView }>({ rows: [], open: false, extra: 0, shown: 0, practice: { minutes: '0', note: '' } });
  const overview = createStore({ hasHistory: false, hasProgress: false, links: { runs: false, calendar: false, compose: false, fixed: false }, runsLabel: 'All runs' });
  const trends = createStore<{ parts: CopyPart[][]; note: string }>({ parts: [], note: '' });
  const charts = createStore({ visible: false, runs: 0 });
  const commands = { showAll() {}, clear() {}, movers() {} };

  return { trends, charts, navigation: createProgressNavigation(), overview, filters: createProgressFilters(), calendar: createProgressCalendar(), runs, table, composing, lead, movers, commands };
}

export type ProgressSections = ReturnType<typeof createProgressSections>;

export function ProgressRunRows({ progress }: { progress: ProgressSections }) {
  const view = useSyncExternalStore(progress.runs.subscribe, progress.runs.getSnapshot, progress.runs.getSnapshot);

  return <><div id="run-history" className="run-history">{view.rows.map((run, index) => <details key={`${view.revision}:${run.id ?? index}`} className="run-row" data-run-id={run.id}><summary className="run-summary"><strong className="num"><Copy parts={[{ kind: 'speed', wpm: run.wpm }, ` · ${run.accuracy}%`]} /></strong><span>{run.date}</span></summary><div className="run-detail"><dl><div><dt>first-try errors</dt><dd className="num">{run.errors}</dd></div><div><dt>time</dt><dd className="num">{run.time}</dd></div></dl><p><Copy parts={run.description} /></p><p>{run.textNote}</p>{run.passage !== undefined && <details><summary>View passage</summary><p>{run.passage}</p></details>}</div></details>)}</div><button id="show-all-runs" className="btn btn-secondary btn-sm show-all-runs" type="button" hidden={view.rows.length === view.total} onClick={() => progress.commands.showAll()}>Show all {view.total} runs</button></>;
}

export function ProgressCompositions({ progress }: { progress: ProgressSections }) {
  const view = useSyncExternalStore(progress.composing.subscribe, progress.composing.getSnapshot, progress.composing.getSnapshot);

  return <><p id="compose-history-note" className="result-note">{view.note}</p><div id="compose-history-list">{view.rows.map((item) => <article key={item.id} className="compose-row"><div className="compose-row-main"><strong className="num">{item.wpm === null ? <data value="">—</data> : <Copy parts={[{ kind: 'speed', wpm: item.wpm }]} />}</strong><span className="num">{String(item.backspaceRate)}% backspace rate</span></div><p>{item.prompt}</p><p className="condition-copy">{item.detail}</p></article>)}</div></>;
}

const sign = (change: string | null) => (change === null ? '' : change);

function Cell({ id, label, figure, unit, note, open, children }: { id?: string; label: ReactNode; figure: ReactNode; unit?: string; note?: ReactNode; open?: { detail: ProgressDetail; name: string; onOpen(detail: ProgressDetail, opener: HTMLElement): void }; children?: ReactNode }) {
  const body = <><span className="cell-label">{label}</span><span className="cell-value"><b className="cell-figure">{figure}</b>{unit && <i className="cell-unit">{unit}</i>}</span>{note && <span className="cell-note">{note}</span>}{children}</>;

  if (open) return <button id={id} className="cell cell-link" type="button" data-progress-open={open.detail} aria-label={open.name} onClick={(event) => open.onOpen(open.detail, event.currentTarget)}>{body}</button>;

  return <div id={id} className="cell">{body}</div>;
}

// The four lead cells: speed and accuracy for the week, minutes practised, and the units fixed since it began, which
// opens their list one step away.
export function ProgressCells({ progress }: { progress: ProgressSections }) {
  const lead = useSyncExternalStore(progress.lead.subscribe, progress.lead.getSnapshot, progress.lead.getSnapshot);
  const movers = useSyncExternalStore(progress.movers.subscribe, progress.movers.getSnapshot, progress.movers.getSnapshot);
  const overview = useSyncExternalStore(progress.overview.subscribe, progress.overview.getSnapshot, progress.overview.getSnapshot);
  const open = (detail: ProgressDetail, opener: HTMLElement) => progress.navigation.open(detail, { opener });
  const fixed = movers.rows.map((row) => row.unit);
  const shownUnits = fixed.slice(0, 3).join(' · ') + (fixed.length > 3 ? ` +${fixed.length - 3}` : '');
  const label = unitText('{unit}') + (lead.week ? ` · ${lead.week}` : '');

  return <div id="week-cells" className="cells week-cells">
    <div id="week-lead" className="cell lead-cell" data-state={lead.state} data-tone={lead.tone}>
      <span className="cell-label" id="lead-label">{label}</span>
      <p id="lead-figure" className="cell-value focus-landing" aria-describedby="lead-label lead-sentence" tabIndex={-1}>{lead.figure === null ? <b className="cell-figure lead-dash">–</b> : <b className="cell-figure lead-number">{lead.figure}</b>}</p>
      <p id="lead-note" className="cell-note lead-note" hidden={!lead.note && lead.change === null}>{lead.change !== null && <><span className="lead-change" aria-hidden="true">{sign(lead.change)}</span><span aria-hidden="true"> vs last week</span>{lead.spoken && <span className="sr-only">{lead.spoken}</span>}</>}{lead.note}</p>
      <p id="lead-sentence" className="sr-only"><Copy parts={lead.sentence} />{lead.sample && <>, <span id="lead-sample">{lead.sample}</span></>}</p>
    </div>
    <Cell id="lead-accuracy" label="accuracy" figure={lead.accuracy ?? '–'} unit={lead.accuracy === null ? undefined : '%'} note={lead.accuracyChange === null ? undefined : `${lead.accuracyChange} vs last week`} />
    <Cell id="lead-practice" label="practice" figure={movers.practice.minutes} unit="min" note={movers.practice.note || undefined} />
    <Cell id="lead-fixed" label="fixed" figure={String(fixed.length)} note={shownUnits || undefined}
      open={overview.links.fixed ? { detail: 'fixed', name: `fixed, ${fixed.length} this week: ${fixed.join(', ')}. Open what changed.`, onOpen: open } : undefined} />
  </div>;
}

export function ProgressMovers({ progress }: { progress: ProgressSections }) {
  const view = useSyncExternalStore(progress.movers.subscribe, progress.movers.getSnapshot, progress.movers.getSnapshot);

  return <ol id="week-movers" className="week-movers" aria-label="What changed since last week">{view.rows.map((row, index) => <li key={row.unit} className="mover is-fixed" data-unit={row.unit} hidden={index >= view.shown && !view.open}><span className="mover-unit">{row.unit}</span><p className="mover-change num" title={row.title}><span className="mover-before">{row.before}</span><span className="mover-arrow" aria-hidden="true"> → </span><span className="sr-only"> to </span><span className="mover-after">{row.after}</span>{row.tail && <span className="mover-tail"> {row.tail}</span>}</p><span className="status mover-status badge-success"><span className="status-dot" aria-hidden="true"></span>{row.status}</span></li>)}</ol>;
}

const crown = <svg className="pb-icon" viewBox="0 0 16 16" aria-hidden="true"><path className="pb-crown" d="M2.6 11.6 2 5.2l3.4 2.7L8 3.4l2.6 4.5L14 5.2l-.6 6.4z" /><path className="pb-base" d="M3 13.6h10" /></svg>;

// The newest runs at these conditions in the period, speed first, with a crown on each one that was a personal best
// when it was typed. Clear history sits with them, and the full list with each run's details is one step away.
export function ProgressRunsPanel({ progress }: { progress: ProgressSections }) {
  const table = useSyncExternalStore(progress.table.subscribe, progress.table.getSnapshot, progress.table.getSnapshot);
  const view = useSyncExternalStore(progress.overview.subscribe, progress.overview.getSnapshot, progress.overview.getSnapshot);
  const open = (detail: ProgressDetail) => (event: { currentTarget: HTMLElement }) => progress.navigation.open(detail, { opener: event.currentTarget });

  return <section id="progress-runs" className="panel runs-panel" aria-labelledby="runs-title" hidden={!view.hasHistory}>
    <header className="panel-head"><h2 id="runs-title" className="panel-title">runs</h2><button id="clear-history" className="quiet-action clear-history" type="button" disabled={!view.hasHistory} hidden={!view.hasHistory} onClick={() => progress.commands.clear()}>Clear history</button></header>
    {table.rows.length > 0 && <table id="runs-table" className="runs-table">
      <thead><tr><th scope="col">{unitText('{unit}')}</th><th scope="col">accuracy</th><th scope="col">when</th><th scope="col">kind</th></tr></thead>
      <tbody>{table.rows.map((row) => <tr key={row.key} data-run-id={row.key}><td className="runs-speed"><Copy parts={[{ kind: 'speed', wpm: row.wpm, bare: true }]} />{row.best && <span className="pb" title="A personal best when you typed it">{crown}<span className="sr-only">, personal best</span></span>}</td><td className="runs-accuracy">{row.accuracy}</td><td>{row.day}</td><td>{row.kind}</td></tr>)}</tbody>
    </table>}
    {!table.rows.length && table.empty && <p className="runs-empty">{table.empty}</p>}
    <nav id="progress-more" className="progress-more" aria-label="More progress"><button id="open-runs" className="quiet-action" type="button" data-progress-open="runs" onClick={open('runs')} hidden={!view.links.runs}>{view.runsLabel}</button><button className="quiet-action" type="button" data-progress-open="compose" onClick={open('compose')} hidden={!view.links.compose}>Composing</button></nav>
  </section>;
}

export function ProgressTrendFigures({ progress }: { progress: ProgressSections }) {
  const { parts } = useSyncExternalStore(progress.trends.subscribe, progress.trends.getSnapshot, progress.trends.getSnapshot);

  return <p id="trend-figures" className="trend-figures" hidden={!parts.length}>{parts.map((part, index) => <Fragment key={index}>{index ? ' · ' : ''}<span><Copy parts={part} /></span></Fragment>)}</p>;
}

export function ProgressTrendNote({ progress }: { progress: ProgressSections }) {
  const { note } = useSyncExternalStore(progress.trends.subscribe, progress.trends.getSnapshot, progress.trends.getSnapshot);

  return <p id="progress-trend-note" className="result-note">{note}</p>;
}
