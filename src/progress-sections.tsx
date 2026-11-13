import { createTrainingPatterns } from './training-patterns.js';
import { createProgressNavigation } from './progress-navigation.js';
import { createProgressFilters } from './progress-filters.js';
import { createProgressKeys } from './progress-keys.js';
import { createProgressCalendar } from './progress-calendar.js';
import { Fragment, useSyncExternalStore } from 'react';
import { createStore } from './store.js';
import type { CopyPart } from './practice-session.js';
import { Copy } from './results-card.js';
import { formatSpeed, unitText } from './units.js';

export interface RunRowView { id?: string; wpm: number; accuracy: number; date: string; errors?: number; time: string; description: CopyPart[]; textNote: string; passage?: string }

export interface CompositionRowView { id: string; wpm: number | null; backspaceRate: number | null; prompt: string; detail: string }

export interface StandardView { best: number | null; median: number | null; medianLabel: string; conditions: string; empty: boolean; note: CopyPart[] }

export interface LeadView { figure: string | null; spoken: string; sentence: CopyPart[]; sample: string; note: string; state: string; tone: string }

export interface MoverView { unit?: string; before: string; after: string; tail: string; title?: string; status: string; practice?: boolean }

export function createProgressSections() {
  const runs = createStore<{ rows: RunRowView[]; total: number; revision: number }>({ rows: [], total: 0, revision: 0 });
  const composing = createStore<{ rows: CompositionRowView[]; note: string }>({ rows: [], note: '' });
  const standard = createStore<StandardView>({ best: null, median: null, medianLabel: 'median', conditions: '', empty: true, note: [] });
  const lead = createStore<LeadView>({ figure: null, spoken: '', sentence: [], sample: '', note: '', state: 'none', tone: 'none' });
  const movers = createStore<{ rows: MoverView[]; open: boolean; extra: number; shown: number }>({ rows: [], open: false, extra: 0, shown: 0 });
  const overview = createStore({ hasHistory: false, hasProgress: false, links: { runs: false, keys: false, calendar: false, standard: false, compose: false }, runsLabel: 'All runs' });
  const trends = createStore<{ parts: CopyPart[][]; note: string }>({ parts: [], note: '' });
  const charts = createStore({ visible: false });
  const commands = { showAll() {}, calendar() {}, clear() {}, standard() {}, movers() {} };

  return { trends, charts, patterns: createTrainingPatterns(), navigation: createProgressNavigation(), overview, filters: createProgressFilters(), keys: createProgressKeys(), calendar: createProgressCalendar(), runs, composing, standard, lead, movers, commands };
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

export function ProgressStandard({ progress }: { progress: ProgressSections }) {
  const view = useSyncExternalStore(progress.standard.subscribe, progress.standard.getSnapshot, progress.standard.getSnapshot);

  return <div id="standard-score" className={`standard-score${view.empty ? ' is-empty' : ''}`}><dl id="standard-figures" className="standard-figures" hidden={view.empty}><div><dt>best</dt><dd><strong id="standard-best" className="num" data-bare="" data-wpm={view.best ?? undefined}>{view.best === null ? '—' : formatSpeed(view.best, { bare: true })}</strong><span data-speed-unit="" hidden={view.best === null}>{unitText('{unit}')}</span></dd></div><div><dt id="standard-median-label">{view.medianLabel}</dt><dd><strong id="standard-median" className="num" data-bare="" data-wpm={view.median ?? undefined}>{view.median === null ? '—' : formatSpeed(view.median, { bare: true })}</strong><span data-speed-unit="" hidden={view.median === null}>{unitText('{unit}')}</span></dd></div></dl><p id="standard-score-note" className="result-note"><Copy parts={view.note} /></p><p id="standard-score-conditions" className="condition-copy" hidden={view.empty}>{view.conditions}</p><button id="take-standard" onClick={() => progress.commands.standard()} className="btn btn-secondary" type="button">Take the standard test</button></div>;
}

export function ProgressLeadFigures({ progress }: { progress: ProgressSections }) {
  const view = useSyncExternalStore(progress.lead.subscribe, progress.lead.getSnapshot, progress.lead.getSnapshot);

  return <p id="lead-figure" className="lead-figure num focus-landing" aria-describedby="lead-sentence" tabIndex={-1}>{view.figure === null ? <span className="lead-dash"></span> : <><span className="lead-number" aria-hidden={Boolean(view.spoken)}>{view.figure}</span>{view.spoken && <span className="sr-only">{view.spoken}</span>}<span className="lead-unit">{unitText('{unit}')}</span></>}</p>;
}

export function ProgressLeadCopy({ progress, part }: { progress: ProgressSections; part: 'sentence' | 'sample' | 'note' }) {
  const view = useSyncExternalStore(progress.lead.subscribe, progress.lead.getSnapshot, progress.lead.getSnapshot);

  if (part === 'sample') return <span id="lead-sample" className="lead-sample" hidden={!view.sample}>{view.sample}</span>;

  if (part === 'note') return <p id="lead-note" className="lead-note" hidden={!view.note}>{view.note}</p>;

  return <p id="lead-sentence" className="lead-sentence"><Copy parts={view.sentence} /></p>;
}

export function ProgressMovers({ progress }: { progress: ProgressSections }) {
  const view = useSyncExternalStore(progress.movers.subscribe, progress.movers.getSnapshot, progress.movers.getSnapshot);

  return <ol id="week-movers" className="week-movers" aria-label="What changed since last week">{view.rows.map((row, index) => <li key={row.unit ?? 'practice'} className={`mover ${row.practice ? 'is-practice' : 'is-fixed'}`} data-unit={row.unit} hidden={!row.practice && index >= view.shown && !view.open}>{row.practice ? <button type="button" className="mover-unit mover-link" aria-label="practice calendar" onClick={() => progress.commands.calendar()}>practice</button> : <span className="mover-unit">{row.unit}</span>}<p className="mover-change num" title={row.title}><span className="mover-before">{row.before}</span><span className="mover-arrow" aria-hidden="true"> → </span><span className="sr-only"> to </span><span className="mover-after">{row.after}</span>{row.tail && <span className="mover-tail"> {row.tail}</span>}</p><span className={`status mover-status badge-${row.practice ? 'neutral' : 'success'}`}><span className="status-dot" aria-hidden="true"></span>{row.status}</span></li>)}</ol>;
}

export function ProgressMore({ progress }: { progress: ProgressSections }) {
  const view = useSyncExternalStore(progress.overview.subscribe, progress.overview.getSnapshot, progress.overview.getSnapshot);

  return <nav id="progress-more" className="progress-more" aria-label="More progress"><button id="open-runs" className="btn btn-ghost" type="button" data-progress-open="runs" onClick={(event) => progress.navigation.open('runs', { opener: event.currentTarget })} hidden={!view.links.runs}>{view.runsLabel}</button><button className="btn btn-ghost" type="button" data-progress-open="keys" onClick={(event) => progress.navigation.open('keys', { opener: event.currentTarget })} hidden={!view.links.keys}>Keys</button><button className="btn btn-ghost" type="button" data-progress-open="calendar" onClick={(event) => progress.navigation.open('calendar', { opener: event.currentTarget })} hidden={!view.links.calendar}>Practice calendar</button><button className="btn btn-ghost" type="button" data-progress-open="standard" onClick={(event) => progress.navigation.open('standard', { opener: event.currentTarget })} hidden={!view.links.standard}>Standard score</button><button className="btn btn-ghost" type="button" data-progress-open="compose" onClick={(event) => progress.navigation.open('compose', { opener: event.currentTarget })} hidden={!view.links.compose}>Composing</button><button id="clear-history" className="btn btn-ghost danger-text clear-history" type="button" disabled={!view.hasHistory} hidden={!view.hasHistory} onClick={() => progress.commands.clear()}>Clear history</button></nav>;
}

export function ProgressTrendFigures({ progress }: { progress: ProgressSections }) {
  const { parts } = useSyncExternalStore(progress.trends.subscribe, progress.trends.getSnapshot, progress.trends.getSnapshot);

  return <p id="trend-figures" className="trend-figures" hidden={!parts.length}>{parts.map((part, index) => <Fragment key={index}>{index ? ' · ' : ''}<span><Copy parts={part} /></span></Fragment>)}</p>;
}

export function ProgressTrendNote({ progress }: { progress: ProgressSections }) {
  const { note } = useSyncExternalStore(progress.trends.subscribe, progress.trends.getSnapshot, progress.trends.getSnapshot);

  return <p id="progress-trend-note" className="result-note">{note}</p>;
}
