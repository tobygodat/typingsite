import { flushSync } from 'react-dom';
import { at as indexed, hasKey, isRecord } from './domain-values.js';
import { isScoredRun } from './domain-history.js';
import type { AnalysisRun, HistoricalRun, HistoricalLoop, HistoricalTrace, ScoredRun } from './profile-types.js';
import { bookName } from './books.js';
import { dayKey, filterRuns, minutesByDay, periodWindow, practiceRun, shapeOf, testShapes, conditionLabels } from './insights.js';
import type { ConditionLabelSource } from './insights.js';
import { lessonsStarted } from './lessons.js';
import { renderRunsPerDay, renderSpread, renderTrend, renderWeekChart } from './progress-view.js';
import { weekChange } from './week-change.js';
import { createProgressFigures } from './progress-figures.js';
import { copyParts } from './native-copy.js';
import type { NativeCopy } from './native-copy.js';
import type { LearningStore } from './learning-store.js';
import type { RunRowView } from './progress-sections.js';
import type { ProgressPeriod } from './progress-filters.js';
import type { createPracticeProgress } from './progress-practice.js';

type ListedRun = HistoricalRun & AnalysisRun;

interface ConditionCarrier { conditions?: unknown }

interface ProgressHistoryPorts {
  describe(source?: ConditionLabelSource, sets?: readonly ConditionLabelSource[]): string;
  describeRun(run: ScoredRun): NativeCopy;
  date(at: AnalysisRun['at']): string;
  loops(loops: readonly (HistoricalLoop & AnalysisRun)[]): void;
  focusShown(target: HTMLElement, options?: { scroll?: boolean }): void;
}

function host(id: string) {
  const element = document.getElementById(id);

  if (!element) throw new Error(`Missing progress host ${id}`);

  return element;
}

function conditionsOf(record: ConditionCarrier) {
  if (record.conditions === undefined || isRecord(record.conditions)) return record.conditions;
  throw new TypeError('Historical conditions are not an object');
}

function passageOf(trace: HistoricalTrace | undefined) {
  const text = trace?.text;

  if (text === undefined || text === null || typeof text === 'string' || typeof text === 'number' || typeof text === 'boolean') return text;
  throw new TypeError('A displayed historical passage must be text');
}

function requireScore(run: AnalysisRun) {
  if (!isScoredRun(run)) throw new TypeError('A spread point requires its score');

  return run;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const shapeLabel = (shape: ReturnType<typeof testShapes>[number]) => {
  if (shape.mode === 'words') return { text: `${shape.size} words` };

  if (shape.mode === 'time') return { text: `${shape.size} s`, label: `${shape.size} seconds` };

  if (shape.mode === 'quote') return { text: `${shape.size} quote` };

  if (shape.mode === 'code') return { text: `code · ${shape.size}` };

  if (shape.mode === 'book') return { text: bookName(shape.size) };

  return { text: shape.mode === null || shape.mode === undefined ? '' : String(shape.mode) };
};

export function createProgressHistory(learning: LearningStore, practiceProgress: ReturnType<typeof createPracticeProgress>, ports: ProgressHistoryPorts) {
  const $ = host;
  const progressState = learning.progress.navigation.state;
  const { renderLead, renderMovers, renderTrendFigures } = createProgressFigures(learning);
  const openProgressDetail = learning.progress.navigation.open;
  const showProgressDetail = learning.progress.navigation.showDetail;
  const openTrend = learning.progress.navigation.openTrend;
  const shownProgressView = () => progressState.view;
  const RECENT_RUNS = 10;
  const coarsePointer = matchMedia('(pointer: coarse)');
  let heatRuns: readonly unknown[] = [];
  let listedRuns: ListedRun[] = [];
  let historyDay = '';
  let progressRuns: ReturnType<typeof weekChange>['charts']['runs'] = [];
  let progressTrendNote = '';
  let progressWindow: ReturnType<typeof periodWindow> | null = null;
  let progressWeek: ReturnType<typeof weekChange> | null = null;
  const focusShown = ports.focusShown;

  const landProgressFocus = (options?: { scroll?: boolean }) => focusShown(learning.progress.navigation.view.getSnapshot().detail ? $('progress-detail-heading')
    : learning.profile.runs.some(practiceRun) || learning.profile.loops.length ? $('lead-figure') : $('progress-empty-title'), options);

  function renderKeys(runs: readonly unknown[]) { heatRuns = runs; learning.progress.keys.show(runs, coarsePointer.matches); }

  learning.progress.navigation.configure({ history: renderHistory, draw: drawProgressView, focusShown, landFocus: landProgressFocus });

  function openHistoryRun(id: string | undefined) {
    const active = document.activeElement;

    if (progressState.detail !== 'runs') openProgressDetail('runs', { opener: active instanceof HTMLElement || active instanceof SVGElement ? active : null, focus: false });
    const find = () => [...$('run-history').querySelectorAll<HTMLDetailsElement>(':scope > details')].find((item) => item.dataset.runId === id);

    if (!find() && listedRuns.some((run) => run.id === id)) showAllRuns();
    const row = find();

    if (row) { row.open = true; row.scrollIntoView({ block: 'center', behavior: 'instant' }); row.querySelector('summary')?.focus(); }
  }

  function chooseProgress(choice: { key?: string; period?: ProgressPeriod }) {
    if (Object.entries(choice).every(([name, value]) => (name === 'key' ? progressState.key : progressState.period) === value)) return;
    Object.assign(progressState, choice, { allRuns: false });
    renderHistory();
  }

  function renderRunRows() {
    const shown = progressState.allRuns ? listedRuns : listedRuns.slice(0, RECENT_RUNS);
    const previous = learning.progress.runs.getSnapshot();
    flushSync(() => learning.progress.runs.publish({ rows: shown.map(runRow), total: listedRuns.length, revision: previous.revision + 1 }));
  }

  function showAllRuns() {
    progressState.allRuns = true;
    const previous = learning.progress.runs.getSnapshot();
    flushSync(() => learning.progress.runs.publish({ ...previous, rows: listedRuns.map(runRow) }));
  }

  function renderTestPills(shapes: ReturnType<typeof testShapes>) {
    const selected = shapes.find((shape) => shape.variants.some((variant) => variant.key === progressState.key));
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && active.closest('#progress-tests') ? { ...active.dataset } : null;
    const variants = selected?.variants || [];
    const labels = conditionLabels(variants.map((variant) => variant.conditions));
    const tests = shapes.map((shape) => ({ id: shape.id, mode: shape.mode, ...shapeLabel(shape), key: shape.variants[0]?.key, selected: shape === selected, disabled: !shape.variants.length }));
    const previous = learning.progress.filters.view.getSnapshot();
    flushSync(() => learning.progress.filters.view.publish({ ...previous, tests, variants: variants.map((variant, i) => ({ key: variant.key, label: indexed(labels, i) })), key: progressState.key, period: progressState.period }));

    if (focused) {
      const pill = [...$('progress-tests').querySelectorAll<HTMLButtonElement>(':scope > button')].find((node) => node.dataset.shape === focused.shape && !node.disabled && node.isConnected);

      if (pill?.checkVisibility()) pill.focus({ preventScroll: true }); else landProgressFocus();
    }
  }

  function runRow(run: ListedRun): RunRowView {
    if (!isScoredRun(run)) throw new TypeError('A listed run requires its score');
    const trace = learning.profile.attempts.find((a) => a.id === run.id);

    return { id: run.id, wpm: run.score.wpm, accuracy: run.score.accuracy,
      date: ports.date(run.at) + (run.kind === 'retest' ? ' · retest' : run.conditions?.mode === 'standard' ? ' · standard' : '') + (run.fresh === false ? ' · repeated text' : ''),
      errors: run.errors, time: (Number(run.elapsedMs) / 1000).toFixed(1) + ' s', description: copyParts(ports.describeRun(run)),
      textNote: 'Text: ' + run.textId + ' · ' + (run.fresh === false ? 'previously displayed' : 'fresh when displayed'), passage: passageOf(trace) };
  }

  function renderHistory() {
    // One moment for the whole page, so the week, every figure, chart and list read the same days.
    const date = new Date();
    const { source, key, span, runRows, loops } = renderOverview(date);
    practiceProgress.standard();
    learning.progress.patterns.refresh();
    practiceProgress.goal(date);
    renderKeys(source ? filterRuns(learning.profile.runs, key, span) : []);
    listedRuns = [...runRows].reverse();
    renderRunRows();
    ports.loops(loops);
    practiceProgress.composing();
    showProgressDetail();
  }

  function renderOverview(date: Date) {
    historyDay = dayKey(date);
    const listed = learning.profile.runs.filter(practiceRun);
    const hasProgress = listed.length > 0 || learning.profile.loops.length > 0;
    const hasHistory = hasAnyHistory();
    // Conditions never mix: the lead, the charts and every list read one exact condition set. A length opens on its
    // most used set; with no choice yet, on the length of the newest run.
    const shapes = testShapes([...listed, ...learning.profile.loops]);
    const variants = shapes.flatMap((shape) => shape.variants);

    // An emptied history keeps the choice, so undoing a clear comes back to the conditions that were showing.
    if (variants.length && !variants.some((variant) => variant.key === progressState.key)) {
      const newest = listed.at(-1) || learning.profile.loops.at(-1);
      progressState.key = (newest && shapes.find((shape) => shape.id === shapeOf(conditionsOf(newest)))?.variants[0]?.key) || variants[0]?.key || '';
      progressState.allRuns = false;
    }

    renderTestPills(shapes);
    const source = variants.find((variant) => variant.key === progressState.key)?.conditions;
    const key = source ? progressState.key : '';
    const period = progressState.period;

    const siblings = shapes.find((shape) => shape.variants.some((variant) => variant.key === key))?.variants.map((variant) => variant.conditions);
    flushSync(() => learning.progress.filters.view.publish({ ...learning.progress.filters.view.getSnapshot(), hasSource: Boolean(source), conditions: source ? ports.describe(source, siblings) : '' }));

    const week = weekChange({ runs: learning.profile.runs, loops: learning.profile.loops, practiceDays: learning.profile.practiceDays, key, conditions: source || null,
      focus: learning.preferences.trainFocus, goal: learning.preferences.dailyGoal, period, now: date.getTime() });

    progressWeek = week;
    renderLead(week.lead);
    renderMovers(week);
    progressRuns = week.charts.runs;
    progressWindow = week.charts.window;

    // What the charts can't show: an empty period, or runs listed that aren't drawn.
    const span = periodWindow(period, date);
    const runRows = source ? filterRuns(listed, key, span) : [];
    const repeats = runRows.length - progressRuns.length;
    const repeatCopy = repeats ? `${repeats} repeated-text ${repeats === 1 ? 'run' : 'runs'} not charted.` : '';
    progressTrendNote = progressRuns.length
      ? [progressRuns.some((r) => !r.at) ? 'Undated runs not charted.' : '', repeatCopy].filter(Boolean).join(' ')
      : runRows.length ? `No fresh-text runs in this period. ${repeatCopy}` : 'No runs in this period.';
    flushSync(() => learning.progress.charts.publish({ visible: Boolean(progressRuns.length) }));

    // Everything else, one step away.
    const byDay = minutesByDay(learning.profile.runs, learning.profile.practiceDays);
    const loops = source ? filterRuns(learning.profile.loops, key, span).reverse() : [];
    const links = { runs: hasProgress, keys: hasProgress, calendar: Object.keys(byDay).length > 0, standard: hasHistory, compose: learning.profile.compositions.length > 0 };

    flushSync(() => learning.progress.overview.publish({ hasHistory, hasProgress, links,
      runsLabel: runRows.length || loops.length ? `${plural(runRows.length, 'run')}${loops.length ? ` and ${plural(loops.length, 'drill')}` : ''}` : 'Runs' }));

    // The full charts are opened from a small chart, not a link, and stay open through their own filters.
    if (progressState.detail && !{ ...links, trends: hasProgress }[progressState.detail]) progressState.detail = '';

    return { source, key, span, runRows, loops };
  }

  function renderWeek() {
    const open = progressState.detail;
    const focused = $('progress-screen').contains(document.activeElement) ? document.activeElement : null;
    renderOverview(new Date());

    // The full charts keep no rows, so when a clear from another tab leaves them nothing to draw they close whole,
    // back to the overview. A view of rows stays as it is until it is left.
    if (open === 'trends' && !progressState.detail) {
      showProgressDetail();
    } else {
      // The full charts follow at once too, unless focus is on one of their points, which a redraw would drop: then
      // they wait, whole, for the view's next drawing.
      const held = ['progress-trend', 'accuracy-trend', 'progress-spread'].some((id) => $(id).contains(document.activeElement));

      if (!progressState.detail || (progressState.detail === 'trends' && !held)) drawProgressView();
    }

    // Focus that was on the page and now rests on nothing, or on something hidden or disabled, lands where Progress
    // lands it (progressLanding), never on the body. Focus that wasn't on the page stays where it was. A row drawn again
    // has already taken its focus back (renderMovers).
    const now = document.activeElement;
    const lost = focused && (!now || now === document.body || ('disabled' in now && Boolean(now.disabled)) || Boolean(now.closest('[hidden]')));

    if (lost) landProgressFocus();
  }

  function drawProgressView() {
    const detail = progressState.detail;
    const view = detail === 'trends' ? shownProgressView() : '';
    const overview = !detail && !$('week-charts').hidden && document.body.dataset.view === 'progress';

    const draw = {
      'week-speed': () => renderWeekChart($('week-speed'), progressRuns, 'wpm', { period: progressWindow, onOpen: () => openTrend('speed') }),
      'week-accuracy': () => renderWeekChart($('week-accuracy'), progressRuns, 'accuracy', { period: progressWindow, onOpen: () => openTrend('accuracy') }),
      'progress-trend': () => renderTrend($('progress-trend'), progressRuns, openHistoryRun, 'wpm', { period: progressWindow }),
      'accuracy-trend': () => renderTrend($('accuracy-trend'), progressRuns, openHistoryRun, 'accuracy', { period: progressWindow }),
      'progress-spread': () => renderSpread($('progress-spread'), progressRuns.map(requireScore)),
      'practice-runs': () => renderRunsPerDay($('practice-runs'), practiceProgress.runsPerDay),
    };

    const shown = { 'week-speed': overview, 'week-accuracy': overview, 'progress-trend': view === 'speed', 'accuracy-trend': view === 'accuracy',
      'progress-spread': view === 'consistency', 'practice-runs': detail === 'calendar' && !$('practice-goal').hidden };

    for (const [id, render] of Object.entries(draw)) {
      if (hasKey(shown, id) && shown[id]) render();
      else $(id).replaceChildren();
    }

    // The figures and the note under the full charts are drawn with them, so the three never tell of different runs.
    if (detail === 'trends') {
      renderTrendFigures(progressRuns, progressTrendNote);
    }
  }


  function hasAnyHistory() {
    return learning.profile.runs.length > 0 || learning.profile.attempts.length > 0 || learning.profile.loops.length > 0 || learning.profile.compositions.length > 0
      || lessonsStarted(learning.profile.lessons) || Object.keys(learning.profile.practiceDays).length > 0 || Object.keys(learning.profile.runCounts).length > 0;
  }

  return {
    renderHistory, renderWeek, drawProgressView, chooseProgress, openHistoryRun, hasAnyHistory,
    showAll() {
      showAllRuns();
      $('run-history').querySelectorAll<HTMLDetailsElement>(':scope > details')[RECENT_RUNS]?.querySelector('summary')?.focus();
    },
    get day() { return historyDay; },
    relabelLead() { if (progressWeek) renderLead(progressWeek.lead); },
    movers() { if (progressWeek) { progressState.moversOpen = !progressState.moversOpen; renderMovers(progressWeek); } },
    refreshKeys() { renderKeys(heatRuns); },
  };
}
