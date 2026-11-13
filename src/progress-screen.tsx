import { PROGRESS_DETAILS } from './progress-navigation.js';
import { useSyncExternalStore } from 'react';
import { ProgressFilters, ProgressPeriodControl } from './progress-filters.js';
import { ProgressKeys } from './progress-keys.js';
import { PracticeProgress } from './progress-calendar.js';
import { ProgressRunRows, ProgressCompositions, ProgressStandard, ProgressLeadFigures, ProgressLeadCopy, ProgressMovers, ProgressMore } from './progress-sections.js';
import type { LearningStore } from './learning-store.js';
import { HistoryLoops } from './history-loops.js';

export function ProgressScreen({ learning, visible = false }: { learning: LearningStore; visible?: boolean }) {
  const progress = learning.progress;
  const navigation = progress.navigation;
  const { detail, tab } = useSyncExternalStore(navigation.view.subscribe, navigation.view.getSnapshot, navigation.view.getSnapshot);
  const overview = useSyncExternalStore(progress.overview.subscribe, progress.overview.getSnapshot, progress.overview.getSnapshot);
  const lead = useSyncExternalStore(progress.lead.subscribe, progress.lead.getSnapshot, progress.lead.getSnapshot);
  const movers = useSyncExternalStore(progress.movers.subscribe, progress.movers.getSnapshot, progress.movers.getSnapshot);
  const filtersInDetail = ['runs', 'trends', 'keys'].includes(detail);
  const periodInDetail = filtersInDetail || detail === 'calendar';

  return (
<section id="progress-screen" className="screen progress-screen" data-screen="progress" data-detail={detail} aria-labelledby="progress-heading" hidden={!visible}>
        <h1 id="progress-heading" className="sr-only" tabIndex={-1}>Progress</h1>

        <div id="progress-overview" className="progress-overview" hidden={Boolean(detail)}>
          <div id="week-lead" className="week-lead" data-state={lead.state} data-tone={lead.tone} hidden={!overview.hasProgress}>
            <ProgressLeadFigures progress={learning.progress} />
            <div className="lead-context">
              <ProgressLeadCopy progress={learning.progress} part="sentence" />
              <div id="lead-meta" className="lead-meta">{!filtersInDetail && <ProgressFilters progress={learning.progress} />}</div>
              <ProgressLeadCopy progress={learning.progress} part="note" />
            </div>
          </div>

          <div id="progress-empty" className="progress-empty" hidden={overview.hasProgress}>
            <div className="week-lead" data-state="empty">
              <p className="lead-figure" aria-hidden="true"><span className="lead-dash"></span></p>
              <div className="lead-context">
                <h2 id="progress-empty-title" className="lead-sentence focus-landing" tabIndex={-1}>Nothing to compare yet</h2>
              </div>
            </div>
            <div className="empty-actions">
              <button className="btn btn-primary" type="button" data-action="go-practice" onClick={() => learning.commands.practice()}>Take a test</button>
              <button id="empty-standard" onClick={() => progress.commands.standard()} className="btn btn-ghost" type="button">Take the standard test</button>
            </div>
            <p className="first-run-learn">New to typing? <button className="quiet-link" type="button" data-action="open-lessons" onClick={() => learning.commands.openLessons()}>Learn to type</button>.</p>
          </div>

          <div id="week-moved" className="week-moved" hidden={!movers.rows.length}>
            <ProgressMovers progress={learning.progress} />
            <button id="more-movers" className="quiet-link more-movers" type="button" aria-expanded={movers.open} aria-controls="week-movers" hidden={movers.extra < 1} onClick={() => progress.commands.movers()}>{movers.extra < 1 ? '' : movers.open ? 'Fewer' : `${movers.extra} more`}</button>
          </div>

          <div id="week-charts" className="week-charts" hidden>
            <div className="week-charts-head">
              {!periodInDetail && <ProgressPeriodControl progress={learning.progress} />}
            </div>
            <div className="week-chart-pair">
              <div id="week-speed" className="week-chart-slot"></div>
              <div id="week-accuracy" className="week-chart-slot"></div>
            </div>
          </div>

          <ProgressMore progress={learning.progress} />
        </div>

        <div id="progress-detail" className="progress-detail" hidden={!detail}>
          <div className="detail-head">
            <button id="progress-back" onClick={() => navigation.close()} className="btn btn-ghost btn-sm detail-back" type="button"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>Progress</button>
            <h2 id="progress-detail-heading" className="detail-heading focus-landing" tabIndex={-1}>{PROGRESS_DETAILS[detail]}</h2>
            <div id="detail-filters" className="detail-filters">{filtersInDetail && <ProgressFilters progress={learning.progress} />}{periodInDetail && <ProgressPeriodControl progress={learning.progress} />}</div>
          </div>

          <section id="detail-runs" className="detail-panel" data-panel="runs" aria-labelledby="progress-detail-heading" hidden={detail !== 'runs'}>
            <ProgressRunRows progress={learning.progress} />
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
            <p id="trend-figures" className="trend-figures" hidden></p>
            <p id="progress-trend-note" className="result-note"></p>
          </section>

          <section id="detail-keys" className="detail-panel" data-panel="keys" aria-labelledby="progress-detail-heading" hidden={detail !== 'keys'}>
            <ProgressKeys controller={learning.progress.keys} />
            <section className="training-memory" aria-labelledby="training-memory-heading">
              <h3 id="training-memory-heading">Patterns across runs</h3>
              <div className="filter-field">
                <select id="training-conditions" className="input" aria-label="Test conditions"></select>
              </div>
              <p id="training-memory-note" className="result-note"></p>
              <div id="training-targets"></div>
            </section>
          </section>

          <section id="detail-calendar" className="detail-panel" data-panel="calendar" aria-labelledby="progress-detail-heading" hidden={detail !== 'calendar'}>
            <PracticeProgress controller={learning.progress.calendar} />
          </section>

          <section id="detail-standard" className="detail-panel" data-panel="standard" aria-labelledby="progress-detail-heading" hidden={detail !== 'standard'}>
            <ProgressStandard progress={learning.progress} />
          </section>

          <section id="compose-history" className="detail-panel compose-history" data-panel="compose" aria-labelledby="progress-detail-heading" hidden={detail !== 'compose'}>
            <ProgressCompositions progress={learning.progress} />
          </section>
        </div>


      </section>
  );
}
