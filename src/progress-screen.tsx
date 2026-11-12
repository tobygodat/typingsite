import type { LearningStore } from './learning-store.js';
import { HistoryLoops } from './history-loops.js';

export function ProgressScreen({ learning }: { learning: LearningStore }) {
  return (
<section id="progress-screen" className="screen progress-screen" data-screen="progress" data-detail="" aria-labelledby="progress-heading" hidden>
        <h1 id="progress-heading" className="sr-only" tabIndex={-1}>Progress</h1>

        <div id="progress-overview" className="progress-overview">
          <div id="week-lead" className="week-lead" data-state="none">
            <p id="lead-figure" className="lead-figure num focus-landing" aria-describedby="lead-sentence" tabIndex={-1}></p>
            <div className="lead-context">
              <p id="lead-sentence" className="lead-sentence"></p>
              <div id="lead-meta" className="lead-meta">
                <div id="progress-filters" className="progress-filters">
                  <details className="conditions-disclosure">
                    <summary><span id="lead-sample" className="lead-sample"></span><span className="sr-only">conditions: </span><span id="progress-conditions" className="progress-conditions"></span></summary>
                    <div className="conditions-panel">
                      <div id="progress-tests" className="pill-row" role="group" aria-label="Test"></div>
                      <select id="progress-variants" className="select variant-select" aria-label="Conditions" hidden></select>
                    </div>
                  </details>
                </div>
              </div>
              <p id="lead-note" className="lead-note"></p>
            </div>
          </div>

          <div id="progress-empty" className="progress-empty" hidden>
            <div className="week-lead" data-state="empty">
              <p className="lead-figure" aria-hidden="true"><span className="lead-dash"></span></p>
              <div className="lead-context">
                <h2 id="progress-empty-title" className="lead-sentence focus-landing" tabIndex={-1}>Nothing to compare yet</h2>
              </div>
            </div>
            <div className="empty-actions">
              <button className="btn btn-primary" type="button" data-action="go-practice">Take a test</button>
              <button id="empty-standard" className="btn btn-ghost" type="button">Take the standard test</button>
            </div>
            <p className="first-run-learn">New to typing? <button className="quiet-link" type="button" data-action="open-lessons">Learn to type</button>.</p>
          </div>

          <div id="week-moved" className="week-moved" hidden>
            <ol id="week-movers" className="week-movers" aria-label="What changed since last week"></ol>
            <button id="more-movers" className="quiet-link more-movers" type="button" aria-expanded="false" aria-controls="week-movers" hidden></button>
          </div>

          <div id="week-charts" className="week-charts" hidden>
            <div className="week-charts-head">
              <div id="progress-period" className="pill-row period-row" role="group" aria-label="Period">
                <button className="pill" type="button" data-period="7" aria-pressed="false">7 days</button>
                <button className="pill" type="button" data-period="30" aria-pressed="true">30 days</button>
                <button className="pill" type="button" data-period="all" aria-pressed="false">All</button>
              </div>
            </div>
            <div className="week-chart-pair">
              <div id="week-speed" className="week-chart-slot"></div>
              <div id="week-accuracy" className="week-chart-slot"></div>
            </div>
          </div>

          <nav id="progress-more" className="progress-more" aria-label="More progress">
            <button id="open-runs" className="btn btn-ghost" type="button" data-progress-open="runs" hidden>All runs</button>
            <button className="btn btn-ghost" type="button" data-progress-open="keys" hidden>Keys</button>
            <button className="btn btn-ghost" type="button" data-progress-open="calendar" hidden>Practice calendar</button>
            <button className="btn btn-ghost" type="button" data-progress-open="standard">Standard score</button>
            <button className="btn btn-ghost" type="button" data-progress-open="compose" hidden>Composing</button>
            <button id="clear-history" className="btn btn-ghost danger-text clear-history" type="button" disabled hidden>Clear history</button>
          </nav>
        </div>

        <div id="progress-detail" className="progress-detail" hidden>
          <div className="detail-head">
            <button id="progress-back" className="btn btn-ghost btn-sm detail-back" type="button"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>Progress</button>
            <h2 id="progress-detail-heading" className="detail-heading focus-landing" tabIndex={-1}></h2>
            <div id="detail-filters" className="detail-filters"></div>
          </div>

          <section id="detail-runs" className="detail-panel" data-panel="runs" aria-labelledby="progress-detail-heading" hidden>
            <div id="run-history" className="run-history"></div>
            <button id="show-all-runs" className="btn btn-secondary btn-sm show-all-runs" type="button" hidden>Show all runs</button>
            <section className="progress-section" aria-labelledby="comparison-history-heading">
              <h3 id="comparison-history-heading">Drills and retests</h3>
              <HistoryLoops learning={learning} />
            </section>
          </section>

          <section id="detail-trends" className="detail-panel" data-panel="trends" aria-labelledby="progress-detail-heading" hidden>
            <div id="progress-tabs" className="pill-row view-tabs" role="tablist" aria-label="Chart">
              <button id="tab-speed" className="pill view-pill" type="button" role="tab" data-view-tab="speed" aria-controls="view-speed" aria-selected="true">Speed</button>
              <button id="tab-accuracy" className="pill view-pill" type="button" role="tab" data-view-tab="accuracy" aria-controls="view-accuracy" aria-selected="false" tabIndex={-1}>Accuracy</button>
              <button id="tab-consistency" className="pill view-pill" type="button" role="tab" data-view-tab="consistency" aria-controls="view-consistency" aria-selected="false" tabIndex={-1}>Consistency</button>
            </div>
            <div id="view-speed" className="view-panel" role="tabpanel" aria-labelledby="tab-speed">
              <div id="progress-trend" className="progress-trend"></div>
            </div>
            <div id="view-accuracy" className="view-panel" role="tabpanel" aria-labelledby="tab-accuracy" hidden>
              <div id="accuracy-trend" className="progress-trend"></div>
            </div>
            <div id="view-consistency" className="view-panel" role="tabpanel" aria-labelledby="tab-consistency" tabIndex={0} hidden>
              <div id="progress-spread" className="progress-spread"></div>
            </div>
            <p id="trend-figures" className="trend-figures" hidden></p>
            <p id="progress-trend-note" className="result-note"></p>
          </section>

          <section id="detail-keys" className="detail-panel" data-panel="keys" aria-labelledby="progress-detail-heading" hidden>
            <p id="key-note" className="result-note"></p>
            <div id="keys-layout" className="keys-layout">
              <div className="keys-map">
                <div id="key-heatmap" className="keyboard key-heatmap" role="grid" aria-label="Miss rate by key. Arrow keys move between keys."></div>
                <ul id="heat-legend" className="heat-legend" aria-hidden="true"></ul>
                <label id="key-select-field" className="filter-field key-select-field" htmlFor="key-select" hidden>Key
                  <select id="key-select" className="input"></select>
                </label>
                <p id="key-detail" className="result-note key-detail"></p>
              </div>
              <div className="keys-pairs">
                <h3 className="pairs-heading">Pairs to watch</h3>
                <p id="pairs-empty" className="result-note" hidden>Not enough data yet.</p>
                <table id="pairs-table" className="pairs-table" hidden>
                  <thead><tr><th scope="col">pair</th><th scope="col">error rate</th><th scope="col">slow runs</th><th scope="col">samples</th></tr></thead>
                  <tbody></tbody>
                </table>
              </div>
            </div>
            <section className="training-memory" aria-labelledby="training-memory-heading">
              <h3 id="training-memory-heading">Patterns across runs</h3>
              <div className="filter-field">
                <select id="training-conditions" className="input" aria-label="Test conditions"></select>
              </div>
              <p id="training-memory-note" className="result-note"></p>
              <div id="training-targets"></div>
            </section>
          </section>

          <section id="detail-calendar" className="detail-panel" data-panel="calendar" aria-labelledby="progress-detail-heading" hidden>
            <div id="practice-goal" className="practice-goal" hidden>
              <div className="practice-layout">
                <div className="practice-calendar">
                  <div className="goal-chart">
                    <div id="goal-months" className="goal-months" aria-hidden="true"></div>
                    <div className="goal-weekdays" aria-hidden="true"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>
                    <div id="goal-calendar" className="goal-calendar" role="group"></div>
                  </div>
                  <p className="goal-legend" aria-hidden="true">less <span data-level="0"></span><span data-level="1"></span><span data-level="2"></span><span data-level="3"></span><span data-level="4"></span> more practice</p>
                  <div className="goal-day-picker"><label className="sr-only" htmlFor="goal-day-select">Practice day</label><select id="goal-day-select" className="input select"></select></div>
                  <p id="goal-caption" className="goal-caption" aria-hidden="true"></p>
                </div>
                <dl id="practice-stats" className="progress-stats practice-stats"></dl>
              </div>
              <div id="practice-runs" className="practice-runs"></div>
            </div>
          </section>

          <section id="detail-standard" className="detail-panel" data-panel="standard" aria-labelledby="progress-detail-heading" hidden>
            <div id="standard-score" className="standard-score">
              <dl id="standard-figures" className="standard-figures">
                <div><dt>best</dt><dd><strong id="standard-best" className="num" data-bare="">—</strong><span data-speed-unit="">wpm</span></dd></div>
                <div><dt id="standard-median-label">median</dt><dd><strong id="standard-median" className="num" data-bare="">—</strong><span data-speed-unit="">wpm</span></dd></div>
              </dl>
              <p id="standard-score-note" className="result-note"></p>
              <p id="standard-score-conditions" className="condition-copy"></p>
              <button id="take-standard" className="btn btn-secondary" type="button">Take the standard test</button>
            </div>
          </section>

          <section id="compose-history" className="detail-panel compose-history" data-panel="compose" aria-labelledby="progress-detail-heading" hidden>
            <p id="compose-history-note" className="result-note"></p>
            <div id="compose-history-list"></div>
          </section>
        </div>


      </section>
  );
}
