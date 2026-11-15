import { PROGRESS_DETAILS } from './progress-navigation.js';
import { useSyncExternalStore } from 'react';
import { ProgressFilters, ProgressPeriodControl } from './progress-filters.js';
import { PracticeCalendarPanel, ProgressPracticeFigures } from './progress-calendar.js';
import { ProgressRunRows, ProgressCompositions, ProgressCells, ProgressMovers, ProgressRunsPanel, ProgressTrendFigures, ProgressTrendNote } from './progress-sections.js';
import type { LearningStore } from './learning-store.js';
import { HistoryLoops } from './history-loops.js';
import { unitText } from './units.js';

// Progress in the Instrument look (TOB-470): the conditions and the period, four lead cells, two charts, the practice
// calendar and the newest runs, on one page. Everything else is a detail view one step away.
export function ProgressScreen({ learning, visible = false }: { learning: LearningStore; visible?: boolean }) {
  const progress = learning.progress;
  const navigation = progress.navigation;
  const { detail, tab } = useSyncExternalStore(navigation.view.subscribe, navigation.view.getSnapshot, navigation.view.getSnapshot);
  const overview = useSyncExternalStore(progress.overview.subscribe, progress.overview.getSnapshot, progress.overview.getSnapshot);
  const movers = useSyncExternalStore(progress.movers.subscribe, progress.movers.getSnapshot, progress.movers.getSnapshot);
  const charts = useSyncExternalStore(progress.charts.subscribe, progress.charts.getSnapshot, progress.charts.getSnapshot);
  const filtersInDetail = ['runs', 'trends'].includes(detail);
  const periodInDetail = filtersInDetail || detail === 'calendar';

  return (
<section id="progress-screen" className="screen progress-screen" data-screen="progress" data-detail={detail} aria-labelledby="progress-heading" hidden={!visible}>
        <h1 id="progress-heading" className="sr-only" tabIndex={-1}>Progress</h1>

        <div id="progress-overview" className="progress-overview" hidden={Boolean(detail)}>
          <div className="progress-toolbar" hidden={!overview.hasProgress}>
            {!filtersInDetail && <ProgressFilters progress={progress} />}
            {!periodInDetail && <ProgressPeriodControl progress={progress} />}
          </div>

          <div hidden={!overview.hasProgress}><ProgressCells progress={progress} /></div>

          <div id="progress-empty" className="panel progress-empty" hidden={overview.hasProgress}>
            <h2 id="progress-empty-title" className="empty-title focus-landing" tabIndex={-1}>Nothing to compare yet</h2>
            <div className="empty-actions">
              <button className="btn btn-primary" type="button" data-action="go-practice" onClick={() => learning.commands.practice()}>Take a test</button>
            </div>
            <p className="first-run-learn">New to typing? <button className="quiet-link" type="button" data-action="open-lessons" onClick={() => learning.commands.openLessons()}>Learn to type</button>.</p>
          </div>

          <div id="week-charts" className="week-charts" hidden={!charts.visible}>
            <section className="panel chart-panel" aria-labelledby="week-speed-title">
              <header className="panel-head"><h2 id="week-speed-title" className="panel-title">{unitText('{unit}')}</h2><span id="week-speed-runs" className="panel-count">{charts.runs} {charts.runs === 1 ? 'run' : 'runs'}</span></header>
              <div id="week-speed" className="week-chart-slot"></div>
            </section>
            <section className="panel chart-panel" aria-labelledby="week-accuracy-title">
              <header className="panel-head"><h2 id="week-accuracy-title" className="panel-title">accuracy %</h2></header>
              <div id="week-accuracy" className="week-chart-slot"></div>
            </section>
          </div>

          <PracticeCalendarPanel controller={progress.calendar} onOpen={(opener) => navigation.open('calendar', { opener })} />

          <ProgressRunsPanel progress={progress} />
        </div>

        <div id="progress-detail" className="progress-detail" hidden={!detail}>
          <div className="detail-head">
            <button id="progress-back" onClick={() => navigation.close()} className="btn btn-ghost btn-sm detail-back" type="button"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>Progress</button>
            <h2 id="progress-detail-heading" className="detail-heading focus-landing" tabIndex={-1}>{PROGRESS_DETAILS[detail]}</h2>
            <div id="detail-filters" className="detail-filters">{filtersInDetail && <ProgressFilters progress={progress} />}{periodInDetail && <ProgressPeriodControl progress={progress} />}</div>
          </div>

          <section id="detail-runs" className="detail-panel" data-panel="runs" aria-labelledby="progress-detail-heading" hidden={detail !== 'runs'}>
            <ProgressRunRows progress={progress} />
            <section className="progress-section" aria-labelledby="comparison-history-heading">
              <h3 id="comparison-history-heading">Drills and retests</h3>
              <HistoryLoops learning={learning} />
            </section>
          </section>

          <section id="detail-trends" className="detail-panel" data-panel="trends" aria-labelledby="progress-detail-heading" hidden={detail !== 'trends'}>
            <div id="progress-tabs" onKeyDown={(event) => navigation.move(event)} className="pill-row view-tabs" role="tablist" aria-label="Chart">
              <button id="tab-speed" className="pill view-pill" type="button" role="tab" data-view-tab="speed" aria-controls="view-speed" aria-selected={tab === 'speed'} tabIndex={tab === 'speed' ? 0 : -1} onClick={() => navigation.showView('speed')}>Speed</button>
              <button id="tab-accuracy" className="pill view-pill" type="button" role="tab" data-view-tab="accuracy" aria-controls="view-accuracy" aria-selected={tab === 'accuracy'} tabIndex={tab === 'accuracy' ? 0 : -1} onClick={() => navigation.showView('accuracy')}>Accuracy</button>
              <button id="tab-consistency" className="pill view-pill" type="button" role="tab" data-view-tab="consistency" aria-controls="view-consistency" aria-selected={tab === 'consistency'} tabIndex={tab === 'consistency' ? 0 : -1} onClick={() => navigation.showView('consistency')}>Consistency</button>
            </div>
            <div id="view-speed" className="view-panel" role="tabpanel" aria-labelledby="tab-speed" hidden={tab !== 'speed'}>
              <div id="progress-trend" className="progress-trend"></div>
            </div>
            <div id="view-accuracy" className="view-panel" role="tabpanel" aria-labelledby="tab-accuracy" hidden={tab !== 'accuracy'}>
              <div id="accuracy-trend" className="progress-trend"></div>
            </div>
            <div id="view-consistency" className="view-panel" role="tabpanel" aria-labelledby="tab-consistency" tabIndex={0} hidden={tab !== 'consistency'}>
              <div id="progress-spread" className="progress-spread"></div>
            </div>
            <ProgressTrendFigures progress={progress} />
            <ProgressTrendNote progress={progress} />
          </section>

          <section id="detail-calendar" className="detail-panel" data-panel="calendar" aria-labelledby="progress-detail-heading" hidden={detail !== 'calendar'}>
            <ProgressPracticeFigures controller={progress.calendar} />
            <div id="practice-runs" className="practice-runs"></div>
          </section>

          <section id="detail-fixed" className="detail-panel" data-panel="fixed" aria-labelledby="progress-detail-heading" hidden={detail !== 'fixed'}>
            <div id="week-moved" className="week-moved" hidden={!movers.rows.length}>
              <ProgressMovers progress={progress} />
              <button id="more-movers" className="quiet-link more-movers" type="button" aria-expanded={movers.open} aria-controls="week-movers" hidden={movers.extra < 1} onClick={() => progress.commands.movers()}>{movers.extra < 1 ? '' : movers.open ? 'Fewer' : `${movers.extra} more`}</button>
            </div>
          </section>

          <section id="compose-history" className="detail-panel compose-history" data-panel="compose" aria-labelledby="progress-detail-heading" hidden={detail !== 'compose'}>
            <ProgressCompositions progress={progress} />
          </section>
        </div>
      </section>
  );
}
