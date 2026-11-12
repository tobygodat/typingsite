import { PracticeControls } from './practice-controls.js';
import { TypingSurface } from './typing-surface.js';
import type { PracticeSession } from './practice-session.js';
import { ResultsCard } from './results-card.js';

export function App({ practice }: { practice: PracticeSession }) {
  return <>
  <a className="skip-link" href="#typing-input">Skip to typing</a>
  <div id="wallpaper" className="wallpaper" hidden></div>

  <div className="app-shell">
    <header className="dock-zone">
      <nav className="dock" aria-label="Main navigation">
        <a className="brand" href="#practice" data-nav="practice" aria-label="Stilltype practice"><span className="brand-word">stilltype</span><span className="brand-dot" aria-hidden="true">.</span></a>

        <div className="dock-nav glide" data-glide="current">
          <span className="glide-pill" aria-hidden="true"></span>
          <button className="nav-item is-active" type="button" data-nav="practice" aria-current="page"><span className="nav-label-short">type</span> <span className="nav-label-full">practice</span></button>
          <button className="nav-item" type="button" data-nav="train">train</button>
          <button className="nav-item" type="button" data-nav="progress"><span className="nav-label-short">track</span> <span className="nav-label-full">progress</span></button>
          <button className="nav-item" type="button" data-nav="compete"><span className="nav-label-short">race</span> <span className="nav-label-full">challenge</span></button>
        </div>

        <span className="dock-sep" aria-hidden="true"></span>

        <button id="settings-trigger" className="dock-command dock-settings" type="button" aria-label="Settings" aria-haspopup="dialog" aria-controls="settings-dialog">
            <svg className="settings-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>
            <span className="dock-label" aria-hidden="true">settings</span>
        </button>

        <button id="palette-trigger" className="dock-command" type="button" aria-label="Commands" aria-haspopup="dialog" aria-controls="palette" aria-keyshortcuts="Control+K Meta+K">
          <svg className="search-glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
        </button>
      </nav>
    </header>

    <div className="corner">
      <details id="inbox" className="inbox" hidden>
        <summary id="inbox-trigger" className="corner-trigger" aria-label="Inbox">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4.5 7 7.5 6 7.5-6" /></svg>
          <span id="inbox-count" className="inbox-count num" hidden></span>
        </summary>
        <div className="corner-popover inbox-popover">
          <div className="inbox-heading"><p className="account-kicker">inbox</p><button id="inbox-clear" className="btn btn-ghost btn-sm" type="button" hidden>Clear</button></div>
          <p id="inbox-empty" className="account-lede">Nothing here yet.</p>
          <ul id="inbox-list" className="inbox-list"></ul>
        </div>
      </details>
      <details id="account" className="account" data-state="guest">
        <summary id="account-trigger" className="corner-trigger account-trigger" aria-label="Account, guest mode">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.9-3.5 3.6-5.5 7-5.5s6.1 2 7 5.5" /></svg>
        </summary>
        <div className="corner-popover">
          <div id="account-guest" className="account-section">
            <p className="account-lede">Guest mode: nothing is kept once you leave.</p>
            <div className="account-actions">
              <button id="account-create" className="btn btn-primary" type="button">Create account</button>
              <button id="account-google" className="btn btn-secondary" type="button">Sign in with Google</button>
              <button id="account-signin" className="btn btn-ghost btn-sm" type="button">Sign in with email</button>
            </div>
          </div>
          <div id="account-member" className="account-section" hidden>
            <p id="account-email" className="account-email"></p>
            <p className="account-sync status" role="status"><span className="status-dot" aria-hidden="true"></span><span id="account-sync"></span></p>
            <div className="account-actions account-member-actions">
              <button id="account-signout" className="btn btn-ghost btn-sm" type="button">Sign out</button>
              <button id="account-export" className="btn btn-ghost btn-sm" type="button">Export my data</button>
              <button id="account-delete" className="btn btn-ghost btn-sm danger-text" type="button">Delete my account</button>
            </div>
          </div>
        </div>
      </details>
    </div>

    <main id="main-content">
      <section id="typing-screen" className="screen typing-screen" data-screen="practice" data-session="practice" aria-labelledby="session-title">
        <PracticeControls practice={practice} />

        <div id="custom-options" className="custom-options" role="group" aria-label="Custom text" hidden>
          <label htmlFor="custom-text" className="custom-label">your text
            <span id="custom-count" className="custom-count">0 / 3,000</span>
          </label>
          <textarea id="custom-text" className="input custom-textarea" rows={4} spellCheck={false} placeholder="Paste or type any passage" aria-describedby="custom-count custom-error"></textarea>
          <div className="custom-actions">
            <label htmlFor="custom-order">order
              <select id="custom-order" className="input select">
                <option value="as-written" selected>as written</option>
                <option value="shuffled">shuffled words</option>
                <option value="random">random words</option>
              </select>
            </label>
            <button id="custom-use" className="btn btn-primary btn-sm" type="button">Use this text</button>
          </div>
          <p id="custom-error" className="field-error" role="alert"></p>
        </div>

        <form id="manual-target" className="custom-options manual-target" noValidate hidden>
          <label htmlFor="manual-target-input" className="sr-only">Letters to drill</label>
          <div className="input-action">
            <input id="manual-target-input" className="input" type="text" maxLength={16} placeholder="letters, e.g. br" aria-describedby="manual-target-error" />
            <button id="apply-manual-target" className="btn btn-secondary" type="submit">Drill it</button>
          </div>
          <p id="manual-target-error" className="field-error" role="alert"></p>
        </form>

        <form id="typing-form" className="typing-form" autoComplete="off">
          <div className="measure-row">
            <div className="session-intro">
              <div className="session-line">
                <span id="typing-status" className="status" role="status"><span className="status-dot" aria-hidden="true"></span>Ready</span>
                <span id="session-kicker" className="session-kicker">open practice</span>
              </div>
              <h1 id="session-title">Practice</h1>
              <p id="session-description"></p>
              <p id="condition-line">english · common words · 30 s</p>
            </div>
            <div id="live-stats" className="live-stats">
              <div className="live-stat timer-stat">
                <strong id="timer" className="num">30</strong><span id="timer-unit">s</span>
                <small id="timer-label" className="sr-only">remaining</small>
              </div>
              <div className="live-stat">
                <strong id="live-wpm" className="num" data-bare="">—</strong><span data-speed-unit="">wpm</span>
              </div>
              <div className="live-stat">
                <strong id="live-accuracy" className="num">—</strong><span>%<span className="sr-only"> input accuracy</span></span>
              </div>
              <small id="pace-label" className="pace-label" hidden></small>
            </div>
            <p id="caps-warning" className="caps-warning" aria-hidden="true">Caps Lock is on</p>
          </div>

          <TypingSurface practice={practice} />

          <div id="progress-track" className="progress-line" role="progressbar" aria-label="Test progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} aria-valuetext="Not started">
            <span id="progress-bar"></span>
          </div>

          <div id="keyboard" className="keyboard" aria-label="On-screen keyboard" hidden></div>

          <div className="typing-footer">
            <div className="input-help-slot">
              <p id="input-help"></p>
              <span id="input-help-reserve" aria-hidden="true"></span>
            </div>
            <div className="typing-actions">
              <button id="restart-button" className="icon-control" type="button" title="Restart test (Escape)" aria-label="Restart test">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7" /></svg>
              </button>
            </div>
          </div>
        </form>

        <div id="practice-result" className="results-layout practice-result">
          <ResultsCard practice={practice} />

          <div id="result-more" className="result-more">
            <article id="ghost-result" className="comparison-panel ghost-result" aria-labelledby="ghost-result-heading" hidden>
              <h2 id="ghost-result-heading">Ghost race</h2>
              <div id="ghost-result-rows" className="race-results"></div>
              <p id="ghost-result-rule" className="ghost-result-rule"></p>
              <p id="ghost-result-status"></p>
              <button id="ghost-result-action" className="btn btn-secondary" type="button" hidden>Race again</button>
            </article>
            <details id="ghost-offer" className="manual-panel ghost-offer" hidden>
              <summary>Challenge a friend with this run</summary>
              <p className="ghost-offer-copy">They race your keystrokes on this text within 7 days.</p>
              <div id="ghost-offer-empty" hidden>
                <p className="ghost-offer-copy">Your friend list is empty.</p>
                <button id="ghost-offer-friends" className="btn btn-ghost btn-sm" type="button">Add a friend</button>
              </div>
              <form id="ghost-offer-form" className="ghost-offer-form" noValidate>
                <label className="filter-field" htmlFor="ghost-friend">Friend
                  <select id="ghost-friend" className="input"></select>
                </label>
                <label className="filter-field" htmlFor="ghost-name">Name they see
                  <input id="ghost-name" className="input" type="text" maxLength={24} autoComplete="nickname" placeholder="Name" />
                </label>
                <button id="send-ghost" className="btn btn-secondary" type="submit">Send challenge</button>
              </form>
              <p id="ghost-offer-status" className="result-note" role="status"></p>
              <p id="ghost-offer-error" className="field-error" role="alert"></p>
            </details>
          </div>
        </div>

        <form id="compose-form" className="compose-form" autoComplete="off" noValidate hidden>
          <div className="measure-row compose-measure">
            <div className="compose-intro">
              <p className="sr-only">Composing practice. Write in response to the prompt; there is no text to copy.</p>
              <h1 id="compose-prompt" className="compose-prompt"></h1>
              <p id="compose-conditions" className="condition-copy"></p>
            </div>
            <div className="compose-side">
              <button id="compose-another" className="btn btn-ghost btn-sm compose-another" type="button">Another prompt</button>
              <div className="live-stat timer-stat">
                <strong id="compose-timer" className="num">60</strong><span>s</span>
                <small className="sr-only">remaining</small>
              </div>
            </div>
          </div>

          <div className="compose-wrap">
            <label className="sr-only" htmlFor="compose-input">Your answer to the prompt</label>
            <textarea id="compose-input" aria-describedby="compose-prompt compose-hint compose-privacy" maxLength={2000} spellCheck={false} autoCapitalize="sentences" autoComplete="off" autoCorrect="off" placeholder="Start typing. The minute starts with your first key."></textarea>
            <span id="compose-hint" className="sr-only">Up to 60 seconds from your first key. Press Control+Enter or Done to finish. Escape starts over.</span>
          </div>

          <div id="compose-progress" className="progress-line" role="progressbar" aria-label="Composing time used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} aria-valuetext="Not started">
            <span id="compose-progress-bar"></span>
          </div>

          <div id="compose-footer" className="typing-footer compose-footer">
            <div className="compose-notes">
              <p id="compose-help" className="compose-help"></p>
              <p id="compose-privacy" className="compose-privacy"></p>
            </div>
            
            <div className="typing-actions">
              <button id="compose-done" className="btn btn-primary" type="button" aria-keyshortcuts="Control+Enter Meta+Enter" disabled>Done</button>
              <button id="compose-restart" className="icon-control" type="button" title="Start over (Escape)" aria-label="Start over">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7" /></svg>
              </button>
            </div>
          </div>

          <section id="compose-result" className="compose-result" aria-labelledby="compose-result-heading" hidden>
            <h2 id="compose-result-heading"></h2>
            <dl className="compose-facts">
              <div><dt>free-typing speed</dt><dd><strong id="compose-wpm" className="num" data-bare="">—</strong><span data-speed-unit="">wpm</span></dd></div>
              <div><dt>backspace rate</dt><dd><strong id="compose-backspace" className="num">—</strong><span>%</span></dd></div>
              <div><dt>active typing</dt><dd><strong id="compose-active" className="num">—</strong><span>s</span></dd></div>
              <div><dt>characters</dt><dd><strong id="compose-characters" className="num">—</strong></dd></div>
            </dl>
            <p id="compose-definition" className="metric-note"></p>
            <div className="compose-result-foot">
              <p id="compose-saved" className="compose-saved"></p>
              <div className="compose-result-actions">
                <button id="compose-retry" className="btn btn-ghost" type="button">Retry this prompt</button>
                <button id="compose-next" className="btn btn-primary" type="button">Write another</button>
              </div>
            </div>
          </section>
        </form>

        <div className="shortcut-row key-hint" aria-hidden="true">
          <span className="compose-shortcut"><kbd className="mod-key">ctrl</kbd><kbd>enter</kbd> done</span>
          <span className="practice-shortcut"><kbd id="restart-key-hint" className="restart-key-hint">esc</kbd> restart</span>
          <span className="compose-shortcut"><kbd className="restart-key-hint">esc</kbd> start over</span>
          <span><kbd className="command-key">mod+k</kbd> commands</span>
        </div>
      </section>

      <section id="train-screen" className="screen train-screen" data-screen="train" aria-labelledby="train-heading" hidden>
        <h1 id="train-heading" className="sr-only" tabIndex={-1}>General drill</h1>
        
        <ol id="train-path" className="train-path" aria-label="Path">
          <li id="comparison-panel" className="path-step is-behind is-just" data-outcome="insufficient" hidden>
            <div className="path-head"><span className="path-node" aria-hidden="true"></span><span id="comparison-unit" className="path-unit"></span></div>
            <h2 id="comparison-status" tabIndex={-1}>Retest complete.</h2>
            <dl className="comparison-rows">
              <div id="comparison-target-row"><dt id="comparison-target-label">missed</dt><dd><strong id="comparison-target" className="num">—</strong><span id="comparison-target-was"></span></dd></div>
              <div><dt>accuracy</dt><dd><strong className="num"><span id="comparison-accuracy-now">—</span><b>%</b></strong><span id="comparison-accuracy" className="num">—</span></dd></div>
              <div><dt data-speed-unit="">wpm</dt><dd><strong id="comparison-wpm-now" className="num" data-bare="">—</strong><span id="comparison-wpm" className="num" data-bare="" data-signed="">—</span></dd></div>
            </dl>
            <p id="comparison-conditions" className="condition-copy"></p>
            <p id="comparison-caveat"></p>
          </li>
          <li id="train-current" className="path-step is-current" aria-current="step">
            <div className="path-head"><span className="path-node" aria-hidden="true"></span><span id="train-unit" className="path-unit">General drill</span></div>
            <div id="train-next" className="train-open">
              <p id="train-evidence" className="train-evidence" hidden></p>
              <p id="train-last" className="train-last" hidden></p>
              <p id="train-words" className="train-words" hidden></p>
              <div className="train-actions">
                <button id="start-drill" className="btn btn-primary" type="button" data-action="start-drill">Drill and retest</button>
                <button id="comparison-next" className="btn btn-primary" type="button" hidden>Next</button>
                <span id="train-starts" className="condition-copy"></span>
                <button id="comparison-back" className="btn btn-ghost" type="button" hidden>Back to practice</button>
              </div>
            </div>
          </li>
        </ol>
      </section>

      <section id="learn-screen" className="screen" data-screen="learn" aria-labelledby="learn-heading" hidden>
        <header className="section-heading page-heading">
          <h1 id="learn-heading">Learn to type</h1>
        </header>

        <div className="learn-layout">
          <section id="lesson-current" className="lesson-current" aria-labelledby="lesson-current-heading">
            <p id="lesson-status" className="status" hidden><span className="status-dot" aria-hidden="true"></span><span id="lesson-status-word"></span></p>
            <h2 id="lesson-current-heading">Lesson 1</h2>
            <p id="lesson-current-copy"></p>
            <dl id="lesson-facts" className="lesson-facts" hidden></dl>
            <p id="lesson-current-meta" className="condition-copy"></p>
            <div className="lesson-actions">
              <button id="lesson-primary" className="btn btn-primary" type="button">Start lesson 1</button>
              <button id="lesson-secondary" className="btn btn-ghost" type="button" hidden></button>
            </div>
          </section>

          <figure className="finger-figure">
            <div id="lesson-keyboard" className="keyboard"></div>
            <figcaption className="finger-caption">
              <span id="finger-caption-keys"></span>
            </figcaption>
          </figure>
        </div>

        <section className="lesson-list-section" aria-labelledby="lesson-list-heading">
          <h2 id="lesson-list-heading">Lessons</h2>
          <p id="lesson-save-note" className="result-note"></p>
          <ol id="lesson-list" className="lesson-list"></ol>
        </section>
      </section>

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
              <p id="history-empty" className="result-note" hidden>None in this period.</p>
              <div id="history-list" className="history-list" aria-live="polite" hidden></div>
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

        <template id="history-row-template">
          <details className="history-row">
            <summary className="history-summary">
            <div className="history-main">
              <span className="history-date"></span>
              <strong className="history-target"></strong>
              <small className="history-conditions"></small>
            </div>
            <div className="history-measure"><span>Accuracy</span><strong className="history-accuracy num"></strong></div>
            <div className="history-measure"><span>Target timing</span><strong className="history-timing num"></strong></div>
            <span className="history-status status"></span>
            </summary>
            <div className="history-detail"></div>
          </details>
        </template>
      </section>

      <section id="compete-screen" className="screen" data-screen="compete" aria-labelledby="compete-heading" hidden>
        <h1 id="compete-heading" className="sr-only" tabIndex={-1}>Challenge</h1>
        <p id="online-error" className="field-error" role="alert"></p>

        <div id="challenge-people" className="people">
          <section id="quick-match" className="quick-match" aria-labelledby="quick-match-heading">
            <div className="quick-match-head">
              <h2 id="quick-match-heading" tabIndex={-1}>Quick match</h2>
              <p className="quick-match-rating num" data-quick-part="rating" hidden></p>
              <p className="quick-match-rating" data-guest="">Sign in to be matched.</p>
            </div>
            <button className="btn btn-primary quick-match-go" type="button" data-quick="toggle" data-quick-part="toggle">Find a race</button>
            <p className="online-copy quick-match-status" role="status" data-quick-part="status"></p>
            <div className="online-actions quick-match-lonely" data-quick-part="lonely" hidden>
              <button className="btn btn-ghost btn-sm" type="button" data-quick="keep">Keep waiting</button>
              <button className="btn btn-ghost btn-sm" type="button" data-quick="best" data-quick-part="best">Race your best run</button>
            </div>
          </section>
          <ul id="people-list" className="people-list" aria-label="People you race"></ul>
          <p id="people-status" className="online-copy people-status" role="status"></p>
          <div className="people-foot">
            <div className="people-foot-group">
              <button id="people-add" className="people-link" type="button" data-signed-in="">Add a friend</button>
              <button id="people-race-link" className="people-link" type="button" data-signed-in="">Copy a race link</button>
              <button id="people-setup" className="people-link people-setup-link" type="button" data-signed-in="">Race setup <span id="people-setup-conditions" className="people-conditions"></span></button>
              <button id="online-signin" className="people-link" type="button" data-guest="">Sign in to keep friends</button>
            </div>
            <div className="people-foot-group">
              <button id="open-daily" className="people-link" type="button">Daily passage</button>
              <button id="open-local" className="people-link" type="button">One keyboard</button>
            </div>
          </div>
        </div>

        <section id="people-add-view" className="challenge-view" aria-labelledby="people-add-heading" hidden>
          <button className="btn btn-ghost btn-sm challenge-back" type="button" data-challenge-back="" aria-label="Back to challenge">Back</button>
          <h2 id="people-add-heading" tabIndex={-1}>Add a friend</h2>
          <form id="online-setup" className="online-setup">
            <div className="player-field">
              <label htmlFor="online-invite-email">Their account email</label>
              <input id="online-invite-email" className="input" type="email" maxLength={254} required autoComplete="off" placeholder="name@example.com" />
            </div>
            <div className="online-setup-actions">
              <button id="add-friend" className="btn btn-primary" type="submit">Add friend</button>
              <button id="create-online-race" className="btn btn-ghost" type="button">Race once</button>
            </div>
          </form>
          <ul id="online-friend-list" className="online-friend-list" aria-label="Your friends"></ul>
        </section>

        <section id="people-setup-view" className="challenge-view" aria-labelledby="people-setup-heading" hidden>
          <button className="btn btn-ghost btn-sm challenge-back" type="button" data-challenge-back="" aria-label="Back to challenge">Back</button>
          <h2 id="people-setup-heading" tabIndex={-1}>Race setup</h2>
          <div className="player-field online-name-field">
            <label htmlFor="online-name">Your race name</label>
            <input id="online-name" className="input" type="text" maxLength={24} autoComplete="nickname" placeholder="Name" />
          </div>
          <div id="online-options" className="online-options" role="group" aria-label="Race options"></div>
          <div className="online-actions">
            <button id="online-setup-done" className="btn btn-primary" type="button">Done</button>
            <button id="online-customize-reset" className="btn btn-ghost" type="button" hidden>Match practice</button>
          </div>
        </section>

        <div id="online-challenge">
          <form id="online-guest-join" className="online-join" hidden>
            <h2>You’re invited to race.</h2>
            <div className="player-field"><label htmlFor="online-guest-name">Your race name</label><input id="online-guest-name" className="input" type="text" maxLength={24} required autoComplete="nickname" placeholder="Name" /></div>
            <div className="online-actions"><button id="join-online-race" className="btn btn-primary" type="submit">Join race</button><button id="dismiss-race-invite" className="btn btn-ghost" type="button">Cancel</button></div>
          </form>
          <section id="online-room" className="online-room" aria-labelledby="online-room-heading" hidden>
            <div className="online-section-heading"><h2 id="online-room-heading">Your race</h2><button id="online-leave" className="btn btn-ghost btn-sm" type="button">Leave race</button></div>
            <p id="online-room-conditions" className="condition-copy"></p>
            <p id="online-room-status" className="online-copy" role="status"></p>
            <p id="online-rating-change" className="online-copy" role="status" hidden></p>
            <div id="online-rank-card" className="rank-card-slot" aria-hidden="true" hidden></div>
            <template id="rank-card-template">
              <div className="rank-card">
                <canvas className="rc-wind"></canvas>
                <div className="rc-body">
                  <p className="rc-label" data-rc="label" data-rc-clear="" data-rc-text=""></p>
                  <div className="rc-emblem" data-rc="emblem" data-rc-clear="">
                    <svg viewBox="0 0 132 132" focusable="false">
                      <defs><linearGradient gradientUnits="userSpaceOnUse" x1="14" y1="6" x2="118" y2="126"><stop className="rc-stop-a" offset="0" /><stop className="rc-stop-b" offset="1" /></linearGradient></defs>
                      <polygon className="rc-hull" points="66,6 118,36 118,96 66,126 14,96 14,36" strokeWidth="4" data-rc-stroke="" />
                      <g className="rc-mark" data-rc="mark" fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" data-rc-stroke=""></g>
                      <text className="rc-step" data-rc="step" x="66" y="118" textAnchor="middle" fontSize="13"></text>
                    </svg>
                  </div>
                  <p className="rc-rank" data-rc="rank" data-rc-clear="" data-rc-text=""></p>
                  <p className="rc-from" data-rc="from" data-rc-clear="" data-rc-text=""></p>
                  <p className="rc-nums" data-rc-clear="" data-rc-text=""><span className="rc-rating num" data-rc="rating"></span><span className="rc-delta num" data-rc="delta"></span></p>
                  <p className="rc-count" data-rc="count" data-rc-clear="" data-rc-text=""></p>
                  <div className="rc-bar" data-rc="bar" data-rc-clear=""><span className="rc-fill"></span><span className="rc-change"></span></div>
                  <p className="rc-ends" data-rc="ends" data-rc-clear="" data-rc-text=""><span></span><span></span></p>
                  <p className="rc-why" data-rc="why" data-rc-clear="" data-rc-text=""></p>
                </div>
              </div>
            </template>
            <p id="online-connection" className="online-copy" role="status"></p>
            <p id="online-account-invite-status" className="online-copy" role="status" hidden></p>
            <div id="online-share" className="online-share" hidden>
              <label htmlFor="online-guest-link">Guest invitation link</label>
              <div className="online-link-row"><input id="online-guest-link" className="input" type="text" readOnly /><button id="copy-race-link" className="btn btn-secondary" type="button">Copy link</button></div>
              <p id="online-invite-sent" className="online-copy"></p>
            </div>
            <div id="online-players" className="online-players"></div>
            <button id="online-ready" className="btn btn-primary" type="button">Ready to race</button>
            <div id="online-stage" hidden>
              <p id="online-countdown" className="online-countdown num" role="status"></p>
              <p id="online-timer" className="panel-label num"></p>
              <div className="online-typing-wrap">
                <div id="online-text-display" aria-hidden="true"></div>
                <textarea id="online-input" aria-label="Online race typing input" aria-describedby="online-help online-accessible-passage" rows={1} spellCheck={false} autoCapitalize="off" autoComplete="off" autoCorrect="off" disabled></textarea>
                <span id="online-accessible-passage" className="sr-only"></span>
              </div>
              <p id="online-help" className="online-copy">Paste and key repeat are off.</p>
            </div>
            <section id="online-results" className="race-duel" hidden aria-label="Race results">
              <div className="duel-scores">
                <div id="online-duel-mine" className="duel-side">
                  <h3 className="duel-name">You</h3>
                  <p className="duel-speed"><strong className="duel-wpm num" data-bare=""></strong><span className="duel-unit" data-speed-unit="">wpm</span></p>
                  <p className="duel-accuracy num"></p>
                  <div className="duel-choice"><button id="online-rematch" className="btn btn-primary duel-rematch" type="button" aria-pressed="false"><svg className="duel-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>Rematch</button></div>
                </div>
                <div className="duel-middle">
                  <p id="online-tally" className="duel-tally num" hidden><span></span><span aria-hidden="true">–</span><span></span></p>
                  <p id="online-starting" className="duel-starting" role="status" hidden>Starting</p>
                </div>
                <div id="online-duel-theirs" className="duel-side">
                  <h3 className="duel-name"></h3>
                  <p className="duel-speed"><strong className="duel-wpm num" data-bare=""></strong><span className="duel-unit" data-speed-unit="">wpm</span></p>
                  <p className="duel-accuracy num"></p>
                  <div className="duel-choice"><p id="online-their-rematch" className="duel-their-rematch" role="status"><svg className="duel-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg><span></span></p></div>
                </div>
              </div>
              <div id="online-review" className="duel-review" hidden>
                <div className="segmented duel-toggle" role="group" aria-label="Race view">
                  <button id="online-show-graph" type="button" aria-pressed="true">Graph</button>
                  <button id="online-show-replay" type="button" aria-pressed="false">Replay</button>
                </div>
                <div id="online-duel-graph" className="duel-graph speed-graph" role="img"></div>
                <div id="online-duel-replay" className="duel-replay" hidden>
                  <div className="duel-replay-wrap"><div id="online-replay-display" aria-hidden="true"></div></div>
                  <div className="duel-replay-controls">
                    <button id="online-replay-toggle" className="btn btn-secondary" type="button">Play</button>
                    <button id="online-replay-speed" className="btn btn-ghost" type="button" aria-label="Playback speed 1×">1×</button>
                    <button id="online-replay-restart" className="btn btn-ghost" type="button">Restart</button>
                  </div>
                </div>
              </div>
              <div id="online-review-wait" className="duel-review duel-review-wait" hidden><p id="online-review-note" className="duel-review-note"></p></div>
            </section>
            <div id="online-after" className="online-after" hidden>
              <div className="online-actions">
                <button id="online-befriend" className="btn btn-ghost" type="button" hidden>Add to friends</button>
              </div>
            </div>
          </section>
        </div>

        <section id="challenge-daily-view" className="challenge-view" aria-label="Daily passage" hidden>
          <button className="btn btn-ghost btn-sm challenge-back" type="button" data-challenge-back="" aria-label="Back to challenge">Back</button>
        <section id="daily-challenge" className="daily-challenge" aria-labelledby="daily-heading">
          <div className="daily-heading">
            <div><h2 id="daily-heading" tabIndex={-1}>Daily passage</h2><p id="daily-date" className="condition-copy"></p></div>
            <button id="start-daily" className="btn btn-primary" type="button">Start daily challenge</button>
          </div>
          <p id="daily-status" className="result-note" aria-live="polite"></p>
          <details id="daily-history-panel" hidden><summary>Your daily results</summary><div id="daily-history"></div></details>
        </section>

        <section id="friends-board" className="friends-board" aria-labelledby="friends-board-heading">
          <div className="online-section-heading">
            <h2 id="friends-board-heading" tabIndex={-1}>Friends board</h2>
            <button id="refresh-friends-board" className="btn btn-ghost btn-sm" type="button" hidden>Refresh</button>
          </div>
          <div id="friends-board-guest" className="friends-board-guest">
            <button id="friends-board-signin" className="btn btn-secondary" type="button">Sign in</button>
          </div>
          <div id="friends-board-share" className="friends-board-share" hidden>
            <label className="compact-switch" htmlFor="share-board">
              <input id="share-board" className="switch" type="checkbox" />
              <span>share on friends board</span>
            </label>
            <p id="friends-board-off" className="friends-board-off">Share to see friends’ rows. Only friends who added you back see yours.</p>
          </div>
          <p id="friends-board-status" className="online-copy" role="status"></p>
          <div id="friends-board-lists" className="friends-board-lists" hidden>
            <section className="board-column" aria-labelledby="board-daily-heading">
              <h3 id="board-daily-heading">Today’s daily</h3>
              <p id="board-daily-meta" className="condition-copy"></p>
              <ol id="board-daily" className="board-list" role="list"></ol>
            </section>
            <section className="board-column" aria-labelledby="board-week-heading">
              <h3 id="board-week-heading">This week’s practice</h3>
              <ol id="board-week" className="board-list" role="list"></ol>
            </section>
            <section className="board-column board-bests" aria-labelledby="board-bests-heading">
              <h3 id="board-bests-heading">Bests</h3>
              <div id="board-shape-field" className="filter-field board-shape">
                <select id="board-shape" className="input select" aria-label="Test conditions"></select>
              </div>
              <p id="board-bests-meta" className="condition-copy"></p>
              <ol id="board-bests" className="board-list" role="list"></ol>
              <p id="board-bests-none" className="friends-board-note" hidden>No bests yet.</p>
            </section>
          </div>
          <div id="friends-board-empty" className="friends-board-empty" hidden>
            <p>Nobody else yet. Friends appear once you’ve added each other.</p>
            <button id="friends-board-online" className="btn btn-secondary btn-sm" type="button">Add a friend</button>
          </div>
        </section>

        </section>

        <section id="challenge-local-view" className="challenge-view" aria-labelledby="local-heading" hidden>
          <button className="btn btn-ghost btn-sm challenge-back" type="button" data-challenge-back="" aria-label="Back to challenge">Back</button>
          <h2 id="local-heading" tabIndex={-1}>One keyboard</h2>
        <div id="local-challenge">
        <form id="compete-setup" className="challenge-setup">
          <div className="player-field">
            <label htmlFor="player-one-name">Player 1</label>
            <input id="player-one-name" className="input" type="text" maxLength={24} placeholder="Name" autoComplete="off" />
          </div>
          <div className="player-field">
            <label htmlFor="player-two-name">Player 2</label>
            <input id="player-two-name" className="input" type="text" maxLength={24} placeholder="Name" autoComplete="off" />
          </div>
          <button id="start-local-race" className="btn btn-secondary" type="submit">Start</button>
        </form>

        <div id="race-stage" className="race-stage" hidden>
          <div className="race-stage-heading">
            <div>
              <h2><span id="race-player">Player one</span>’s turn</h2>
            </div>
          </div>
          <div id="race-progress" className="progress-track" role="progressbar" aria-label="Challenge progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}><span></span></div>
          <div className="race-typing-wrap">
            <div id="race-text-display" aria-hidden="true"></div>
            <textarea id="race-input" aria-label="Challenge typing input" aria-describedby="race-help race-accessible-passage" rows={1} spellCheck={false} autoCapitalize="off" autoComplete="off" autoCorrect="off"></textarea>
            <span id="race-accessible-passage" className="sr-only"></span>
          </div>
          <p id="race-help"><span className="key-hint">esc restarts.</span></p>
        </div>

        <div id="race-handoff" className="handoff-panel" hidden>
          <div id="handoff-veil" className="handoff-veil" aria-hidden="true"></div>
          <div className="handoff-copy">
            <h2>Pass the keyboard to <span id="handoff-name">player 2</span>.</h2>
            <button id="start-next-player" className="btn btn-primary" type="button">Reveal passage</button>
          </div>
        </div>

        <div id="race-leaderboard" className="race-leaderboard" hidden aria-live="polite">
          <div className="race-result-heading">
            <h2 id="race-winner">Two observed runs</h2>
            <button id="race-again" className="btn btn-secondary" type="button">Play again</button>
          </div>
          <div id="race-results" className="race-results"></div>
          <p>Not counted in your progress.</p>
        </div>
        </div>
        </section>
      </section>
    </main>

    <footer className="site-footer">
      <span id="best" className="personal-best num">No best yet</span>
      <span id="guest-note" className="guest-note">guest · runs aren’t saved</span>
      <span className="footer-links">
        <button id="suggest-trigger" className="footer-link" type="button" aria-haspopup="dialog" aria-controls="suggest-dialog">suggest a feature</button>
        <button id="release-trigger" className="footer-link" type="button" aria-haspopup="dialog" aria-controls="release-dialog" aria-label="What’s new in v0.5.0">v0.5.0</button>
      </span>
    </footer>
  </div>

  <button id="exit-focus" className="btn btn-secondary exit-focus" type="button"><kbd id="exit-focus-hint" className="key-hint">esc</kbd> exit focus</button>

  <dialog id="palette" className="palette" aria-label="Command palette">
    <div className="palette-box">
      <div className="palette-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
        <input id="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" autoComplete="off" spellCheck={false} placeholder="Search commands" />
        <kbd className="key-hint">esc</kbd>
      </div>
      <div className="palette-scroll">
        <span className="palette-highlight" aria-hidden="true"></span>
        <ul id="palette-list" role="listbox" aria-label="Commands"></ul>
        <p id="palette-empty" className="palette-empty" hidden>No matches</p>
      </div>
    </div>
  </dialog>

  <dialog id="replay-dialog" aria-labelledby="replay-title">
    <div className="dialog-content">
      <header className="replay-head">
        <h2 id="replay-title">Replay</h2>
        <div className="replay-readout">
          <span id="replay-stats-label" className="sr-only"></span>
          <span className="replay-stat" aria-hidden="true"><span id="replay-wpm" className="replay-stat-value" data-bare="">—</span><span id="replay-speed-unit" data-speed-unit="">wpm</span></span>
          <span className="replay-stat" aria-hidden="true"><span id="replay-accuracy" className="replay-stat-value">—</span><span>%</span></span>
          <span className="replay-stat" aria-hidden="true"><span id="replay-errors" className="replay-stat-value">0</span><span id="replay-errors-unit">errors</span></span>
          <span className="replay-stat"><span id="replay-clock" className="replay-stat-value">0.0</span><span>s</span></span>
        </div>
      </header>
      <div id="replay-text" className="replay-text" aria-hidden="true"></div>
      <div className="dialog-actions">
        <button id="replay-toggle" className="btn btn-secondary" type="button">Pause</button>
        <button id="replay-speed" className="btn btn-ghost" type="button" aria-label="Playback speed 1×">1×</button>
        <button id="replay-restart" className="btn btn-ghost" type="button">Restart</button>
        <button id="replay-close" className="btn btn-ghost" type="button">Close</button>
      </div>
    </div>
  </dialog>

  <dialog id="clear-dialog" aria-labelledby="clear-dialog-title">
    <form method="dialog" className="dialog-content">
      <div>
        <h2 id="clear-dialog-title">Clear your practice history?</h2>
        <p>Runs, drills, comparisons, composing numbers and lesson progress will be removed.</p>
      </div>
      <label htmlFor="confirm-clear-input">Type <strong>clear</strong> to confirm
        <input id="confirm-clear-input" className="input" type="text" autoComplete="off" />
      </label>
      <div className="dialog-actions">
        <button id="cancel-clear" className="btn btn-ghost" defaultValue="cancel">Cancel</button>
        <button id="confirm-clear" className="btn btn-danger" type="button" disabled>Clear history</button>
      </div>
    </form>
  </dialog>

  <dialog id="delete-account-dialog" aria-labelledby="delete-account-title" aria-describedby="delete-account-copy">
    <form id="delete-account-form" className="dialog-content" noValidate>
      <div>
        <h2 id="delete-account-title">Delete your account?</h2>
        <p id="delete-account-copy">This deletes your account for good, with everything saved to it: settings, runs and progress, daily results, your friend list and your online races. You can’t undo it.</p>
      </div>
      <div className="account-fields">
        <label htmlFor="confirm-delete-input"><span>Type <strong>delete</strong> to confirm</span>
          <input id="confirm-delete-input" className="input" type="text" autoComplete="off" spellCheck={false} autoCapitalize="off" aria-describedby="delete-account-error" />
        </label>
        <p id="delete-account-error" className="field-error" role="alert"></p>
        <p id="delete-account-status" className="sr-only" role="status"></p>
      </div>
      <div className="dialog-actions">
        <button id="cancel-delete-account" className="btn btn-ghost" type="button">Cancel</button>
        <button id="confirm-delete-account" className="btn btn-danger" type="submit" disabled>Delete account</button>
      </div>
    </form>
  </dialog>

  <dialog id="account-dialog" aria-labelledby="account-dialog-title">
    <form id="account-form" className="dialog-content" noValidate>
      <div>
        <h2 id="account-dialog-title">Create an account</h2>
        <p id="account-dialog-copy"></p>
      </div>
      <button id="account-dialog-google" className="btn btn-secondary" type="button">Sign in with Google</button>
      <p className="account-or" aria-hidden="true"><span>or with email</span></p>
      <div className="account-fields">
        <label htmlFor="account-email-input">Email
          <input id="account-email-input" className="input" type="email" autoComplete="email" spellCheck={false} autoCapitalize="off" aria-describedby="account-error" />
        </label>
        <label htmlFor="account-password">Password
          <input id="account-password" className="input" type="password" autoComplete="new-password" aria-describedby="account-error" />
        </label>
        <p id="account-error" className="field-error" role="alert"></p>
      </div>
      <div className="dialog-actions account-dialog-actions">
        <button id="account-switch" className="btn btn-ghost btn-sm" type="button">Sign in instead</button>
        <span className="account-dialog-end">
          <button id="account-cancel" className="btn btn-ghost" type="button">Cancel</button>
          <button id="account-submit" className="btn btn-primary" type="submit">Create account</button>
        </span>
      </div>
    </form>
    <div id="account-confirm" className="dialog-content" hidden>
      <div>
        <h2>Check your email.</h2>
        <p>We sent a confirmation link to <strong id="account-confirm-email"></strong>. Open it in this browser to finish signing in.</p>
      </div>
      <div className="dialog-actions">
        <button id="account-confirm-done" className="btn btn-primary" type="button">Done</button>
      </div>
    </div>
  </dialog>

  <dialog id="suggest-dialog" aria-labelledby="suggest-dialog-title">
    <form id="suggest-form" className="dialog-content" noValidate>
      <div>
        <h2 id="suggest-dialog-title">Suggest a feature</h2>
        <p>Only your words and the screen you sent them from are saved.</p>
      </div>
      <label htmlFor="suggest-text">Your suggestion
        <textarea id="suggest-text" className="input textarea" rows={5} maxLength={1000} aria-describedby="suggest-count suggest-error"></textarea>
      </label>
      <div className="suggest-meta">
        <p id="suggest-error" className="field-error" role="alert"></p>
        <span id="suggest-count" className="suggest-count">0 / 1000</span>
      </div>
      <div className="suggest-trap" aria-hidden="true">
        <label htmlFor="suggest-website">Leave this empty</label>
        <input id="suggest-website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="dialog-actions">
        <button id="cancel-suggest" className="btn btn-ghost" type="button">Cancel</button>
        <button id="send-suggest" className="btn btn-primary" type="submit" disabled>Send suggestion</button>
      </div>
    </form>
  </dialog>

  <dialog id="release-dialog" aria-labelledby="release-title">
    <header className="settings-header">
      <h2 id="release-title">v0.5.0</h2>
      <button id="release-close" type="button" aria-label="Close"><span>esc</span><span aria-hidden="true">×</span></button>
    </header>
    <ul className="release-notes">
      <li>After 10 rated races your race rating carries a rank, from Whisper through Breeze, Gust, Gale and Tempest to Hurricane, and each rated result shows it on a card.</li>
      <li>Quick match races someone near your rating, or your own best run when nobody is waiting.</li>
      <li>Your race rating moves only on quick matches, never your practice.</li>
      <li>In settings, choose Train’s focus, a drill of 15 to 120 seconds, and whether a retest follows.</li>
      <li>Train estimates from your tests on fresh text which letters and pairs cost most.</li>
      <li>Race a friend live with an invite or a link.</li>
    </ul>
  </dialog>

  <dialog id="settings-dialog" aria-labelledby="settings-title">
    <header className="settings-header">
      <h2 id="settings-title">Settings</h2>
      <button id="settings-close" type="button" aria-label="Close settings"><span className="key-hint">esc</span><span aria-hidden="true">×</span></button>
    </header>
    <div className="settings-body">
      <nav className="settings-nav" aria-label="Settings categories">
        <button type="button" data-settings-category="appearance" aria-controls="settings-appearance" aria-current="true">appearance</button>
        <button type="button" data-settings-category="practice" aria-controls="settings-practice">practice</button>
        <button type="button" data-settings-category="keyboard" aria-controls="settings-keyboard">keyboard</button>
        <button type="button" data-settings-category="sound" aria-controls="settings-sound">sound</button>
        <button type="button" data-settings-category="shortcuts" aria-controls="settings-shortcuts">shortcuts</button>
        <button id="import-trigger" className="settings-import" type="button" aria-haspopup="dialog" aria-controls="import-dialog">Import Monkeytype settings</button>
      </nav>
      <div className="settings-content">
        <section id="settings-appearance" className="settings-category" aria-labelledby="settings-appearance-title">
          <div className="settings-intro"><h3 id="settings-appearance-title">Appearance</h3></div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="theme-select-label">theme</strong></div>
            <fieldset className="setting-options" id="theme-select" aria-labelledby="theme-select-label">
              <label className="setting-option"><input type="radio" name="theme-select" defaultValue="system" defaultChecked /><span>system</span></label>
              <label className="setting-option"><input type="radio" name="theme-select" defaultValue="dark" /><span>dark</span></label>
              <label className="setting-option"><input type="radio" name="theme-select" defaultValue="light" /><span>light</span></label>
              <button className="setting-action" id="theme-new" type="button" aria-controls="theme-editor" aria-expanded="false">new</button>
              <button className="setting-action" id="theme-edit" type="button" aria-controls="theme-editor" aria-expanded="false" hidden>edit</button>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="dark-theme-label">dark theme</strong></div>
            <fieldset className="setting-options" id="dark-theme" aria-labelledby="dark-theme-label">
              <label className="setting-option"><input type="radio" name="dark-theme" defaultValue="dark" defaultChecked /><span>dark</span></label>
              <label className="setting-option"><input type="radio" name="dark-theme" defaultValue="terminal" /><span>terminal</span></label>
              <label className="setting-option"><input type="radio" name="dark-theme" defaultValue="midnight" /><span>midnight</span></label>
              <label className="setting-option"><input type="radio" name="dark-theme" defaultValue="nord" /><span>nord</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="light-theme-label">light theme</strong></div>
            <fieldset className="setting-options" id="light-theme" aria-labelledby="light-theme-label">
              <label className="setting-option"><input type="radio" name="light-theme" defaultValue="light" defaultChecked /><span>light</span></label>
              <label className="setting-option"><input type="radio" name="light-theme" defaultValue="paper" /><span>paper</span></label>
              <label className="setting-option"><input type="radio" name="light-theme" defaultValue="shadcn" /><span>shadcn</span></label>
              <label className="setting-option"><input type="radio" name="light-theme" defaultValue="soft" /><span>soft</span></label>
              <label className="setting-option"><input type="radio" name="light-theme" defaultValue="swiss" /><span>swiss</span></label>
              <label className="setting-option"><input type="radio" name="light-theme" defaultValue="e-ink" /><span>e-ink</span></label>
            </fieldset>
          </div>
          <form id="theme-editor" className="theme-editor" aria-label="Custom theme" noValidate hidden>
            <input className="input" id="theme-name" type="text" maxLength={40} autoComplete="off" aria-label="Theme name" />
            <div className="theme-vibe">
              <input className="input" id="theme-vibe" type="text" maxLength={120} autoComplete="off" placeholder="describe a vibe" aria-label="Describe a vibe" />
              <button className="btn btn-ghost" id="theme-generate" type="button">generate</button>
            </div>
            <p id="theme-generate-status" className="theme-status" role="status" aria-live="polite"></p>
            <div id="theme-key-colors" className="theme-colors"></div>
            <details className="theme-more">
              <summary>more colours</summary>
              <div id="theme-more-colors" className="theme-colors"></div>
            </details>
            <div className="theme-editor-actions">
              <button className="btn btn-ghost" id="theme-delete" type="button">delete</button>
              <button className="btn btn-ghost" id="theme-cancel" type="button">cancel</button>
              <button className="btn btn-primary" id="theme-save" type="submit">save</button>
            </div>
          </form>
          <div className="preference-row">
            <div className="preference-copy"><strong id="wallpaper-label">background</strong><small id="wallpaper-error" className="preference-note" hidden>can’t read that file</small></div>
            <div className="setting-options" role="group" aria-labelledby="wallpaper-label" aria-describedby="wallpaper-error">
              <label className="setting-option"><input id="wallpaper-file" type="file" accept="image/*" /><span>choose…</span></label>
              <button id="wallpaper-remove" className="setting-option" type="button" hidden><span>remove</span></button>
            </div>
          </div>
          <div className="preference-row" hidden>
            <div className="preference-copy"><strong id="wallpaper-style-label">style</strong></div>
            <fieldset className="setting-options" id="wallpaper-style" aria-labelledby="wallpaper-label wallpaper-style-label">
              <label className="setting-option"><input type="radio" name="wallpaper-style" defaultValue="regular" /><span>regular</span></label>
              <label className="setting-option"><input type="radio" name="wallpaper-style" defaultValue="dither" defaultChecked /><span>dither</span></label>
              <label className="setting-option"><input type="radio" name="wallpaper-style" defaultValue="gradient" /><span>gradient</span></label>
            </fieldset>
          </div>
          <label className="preference-row" htmlFor="wallpaper-blur" hidden>
            <span className="preference-copy"><strong>blur</strong></span>
            <span className="preference-range"><input className="range" id="wallpaper-blur" type="range" min="0" max="32" step="2" defaultValue="0" /></span>
          </label>
          <label className="preference-row" htmlFor="wallpaper-opacity" hidden>
            <span className="preference-copy"><strong>opacity</strong></span>
            <span className="preference-range"><input className="range" id="wallpaper-opacity" type="range" min="10" max="100" step="5" defaultValue="100" /></span>
          </label>
          <label className="preference-row" htmlFor="wallpaper-reach" hidden>
            <span className="preference-copy"><strong>height</strong></span>
            <span className="preference-range"><input className="range" id="wallpaper-reach" type="range" min="0" max="100" step="5" defaultValue="0" /></span>
          </label>
          <div className="preference-row">
            <div className="preference-copy"><strong id="font-size-label">text size</strong></div>
            <fieldset className="setting-options" id="font-size" aria-labelledby="font-size-label">
              <label className="setting-option"><input type="radio" name="font-size" defaultValue="22" /><span>small</span></label>
              <label className="setting-option"><input type="radio" name="font-size" defaultValue="28" defaultChecked /><span>medium</span></label>
              <label className="setting-option"><input type="radio" name="font-size" defaultValue="36" /><span>large</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="word-highlight-label">word highlight</strong></div>
            <fieldset className="setting-options" id="word-highlight" aria-labelledby="word-highlight-label">
              <label className="setting-option"><input type="radio" name="word-highlight" defaultValue="off" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="word-highlight" defaultValue="current" /><span>this word</span></label>
              <label className="setting-option"><input type="radio" name="word-highlight" defaultValue="next" /><span>next word</span></label>
            </fieldset>
          </div>
          <div className="preference-row" hidden>
            <div className="preference-copy"><strong id="word-highlight-slide-label">slide</strong></div>
            <fieldset className="setting-options" id="word-highlight-slide" aria-labelledby="word-highlight-label word-highlight-slide-label">
              <label className="setting-option"><input type="radio" name="word-highlight-slide" defaultValue="false" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="word-highlight-slide" defaultValue="true" /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="tape-toggle-label">one-line tape</strong></div>
            <fieldset className="setting-options" id="tape-toggle" aria-labelledby="tape-toggle-label">
              <label className="setting-option"><input type="radio" name="tape-toggle" defaultValue="false" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="tape-toggle" defaultValue="true" /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="typing-font-label">typing font</strong></div>
            <fieldset className="setting-options" id="typing-font" aria-labelledby="typing-font-label">
              <label className="setting-option"><input type="radio" name="typing-font" defaultValue="literata" defaultChecked /><span>literata</span></label>
              <label className="setting-option"><input type="radio" name="typing-font" defaultValue="source-serif" /><span>source serif</span></label>
              <label className="setting-option"><input type="radio" name="typing-font" defaultValue="inter" /><span>inter</span></label>
              <label className="setting-option"><input type="radio" name="typing-font" defaultValue="jetbrains-mono" /><span>jetbrains mono</span></label>
              <label className="setting-option"><input type="radio" name="typing-font" defaultValue="ibm-plex-mono" /><span>ibm plex mono</span></label>
              <label className="setting-option"><input type="radio" name="typing-font" defaultValue="roboto-mono" /><span>roboto mono</span></label>
              <label className="setting-option"><input type="radio" name="typing-font" defaultValue="fira-code" /><span>fira code</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="app-font-label">app font</strong></div>
            <fieldset className="setting-options" id="app-font" aria-labelledby="app-font-label">
              <label className="setting-option"><input type="radio" name="app-font" defaultValue="literata" defaultChecked /><span>literata</span></label>
              <label className="setting-option"><input type="radio" name="app-font" defaultValue="source-serif" /><span>source serif</span></label>
              <label className="setting-option"><input type="radio" name="app-font" defaultValue="inter" /><span>inter</span></label>
            </fieldset>
          </div>
          <div className="settings-preview" aria-label="Passage preview">
            <p id="settings-preview-passage"><span>Find</span> <span>a</span> <span>little</span> <span>room</span> <span>for</span> <span>thought.</span></p>
          </div>
        </section>
        <section id="settings-practice" className="settings-category" aria-labelledby="settings-practice-title" hidden>
          <div className="settings-intro"><h3 id="settings-practice-title">Practice</h3></div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="word-list-label">word list</strong><small id="word-list-lock" className="preference-lock" hidden>fixed for standard</small></div>
            <fieldset className="setting-options" id="word-list" aria-labelledby="word-list-label" aria-describedby="word-list-lock">
              <label className="setting-option"><input type="radio" name="word-list" defaultValue="200" defaultChecked /><span>top 200</span></label>
              <label className="setting-option"><input type="radio" name="word-list" defaultValue="1k" /><span>top 1k</span></label>
              <label className="setting-option"><input type="radio" name="word-list" defaultValue="5k" /><span>top 5k</span></label>
              <label className="setting-option"><input type="radio" name="word-list" defaultValue="10k" /><span>top 10k</span></label>
              <label className="setting-option" hidden><input type="radio" name="word-list" defaultValue="standard" disabled /><span>1k–10k</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="numbers-toggle-label">numbers</strong><small id="numbers-toggle-lock" className="preference-lock" hidden>fixed for standard</small></div>
            <fieldset className="setting-options" id="numbers-toggle" aria-labelledby="numbers-toggle-label" aria-describedby="numbers-toggle-lock">
              <label className="setting-option"><input type="radio" name="numbers-toggle" defaultValue="false" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="numbers-toggle" defaultValue="true" /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="repeat-quotes-toggle-label">repeat quotes</strong></div>
            <fieldset className="setting-options" id="repeat-quotes-toggle" aria-labelledby="repeat-quotes-toggle-label">
              <label className="setting-option"><input type="radio" name="repeat-quotes-toggle" defaultValue="false" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="repeat-quotes-toggle" defaultValue="true" /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row preference-row-wide">
            <div className="preference-copy"><strong id="correction-select-label">correction</strong><small id="correction-select-lock" className="preference-lock" hidden>fixed for standard</small></div>
            <fieldset className="setting-options" id="correction-select" aria-labelledby="correction-select-label" aria-describedby="correction-select-lock">
              <label className="setting-option"><input type="radio" name="correction-select" defaultValue="relaxed" defaultChecked /><span>free</span></label>
              <label className="setting-option"><input type="radio" name="correction-select" defaultValue="mandatory" /><span>stop on error</span></label>
              <label className="setting-option"><input type="radio" name="correction-select" defaultValue="no-backspace" /><span>no backspace</span></label>
              <label className="setting-option"><input type="radio" name="correction-select" defaultValue="fail-word" /><span>fail on word error</span></label>
              <label className="setting-option"><input type="radio" name="correction-select" defaultValue="fail-any" /><span>fail on any error</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="strict-space-toggle-label">strict space</strong><small className="preference-note" id="rules-note" hidden></small></div>
            <fieldset className="setting-options" id="strict-space-toggle" aria-labelledby="strict-space-toggle-label" aria-describedby="rules-note">
              <label className="setting-option"><input type="radio" name="strict-space-toggle" defaultValue="false" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="strict-space-toggle" defaultValue="true" /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="quick-end-toggle-label">quick end</strong><small className="preference-note" id="quick-end-note" hidden></small></div>
            <fieldset className="setting-options" id="quick-end-toggle" aria-labelledby="quick-end-toggle-label" aria-describedby="quick-end-note rules-note">
              <label className="setting-option"><input type="radio" name="quick-end-toggle" defaultValue="false" /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="quick-end-toggle" defaultValue="true" defaultChecked /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="min-accuracy-label">minimum accuracy</strong></div>
            <fieldset className="setting-options" id="min-accuracy" aria-labelledby="min-accuracy-label">
              <label className="setting-option"><input type="radio" name="min-accuracy" defaultValue="0" defaultChecked /><span>any %</span></label>
              <label className="setting-option"><input type="radio" name="min-accuracy" defaultValue="80" /><span>80%</span></label>
              <label className="setting-option"><input type="radio" name="min-accuracy" defaultValue="90" /><span>90%</span></label>
              <label className="setting-option"><input type="radio" name="min-accuracy" defaultValue="95" /><span>95%</span></label>
              <label className="setting-option"><input type="radio" name="min-accuracy" defaultValue="98" /><span>98%</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="min-wpm-label">minimum speed</strong></div>
            <fieldset className="setting-options" id="min-wpm" aria-labelledby="min-wpm-label">
              <label className="setting-option"><input type="radio" name="min-wpm" defaultValue="0" defaultChecked /><span data-speed-unit="any {unit}">any wpm</span></label>
              <label className="setting-option"><input type="radio" name="min-wpm" defaultValue="20" /><span data-wpm="20">20 wpm</span></label>
              <label className="setting-option"><input type="radio" name="min-wpm" defaultValue="30" /><span data-wpm="30">30 wpm</span></label>
              <label className="setting-option"><input type="radio" name="min-wpm" defaultValue="40" /><span data-wpm="40">40 wpm</span></label>
              <label className="setting-option"><input type="radio" name="min-wpm" defaultValue="60" /><span data-wpm="60">60 wpm</span></label>
              <label className="setting-option"><input type="radio" name="min-wpm" defaultValue="80" /><span data-wpm="80">80 wpm</span></label>
              <label className="setting-option"><input type="radio" name="min-wpm" defaultValue="100" /><span data-wpm="100">100 wpm</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="pace-select-label">pace caret</strong><small id="pace-note" className="pace-note"></small></div>
            <fieldset className="setting-options" id="pace-select" aria-labelledby="pace-select-label" aria-describedby="pace-note">
              <label className="setting-option"><input type="radio" name="pace-select" defaultValue="off" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="pace-select" defaultValue="best" /><span>personal best</span></label>
              <label className="setting-option"><input type="radio" name="pace-select" defaultValue="average" /><span>average</span></label>
              <label className="setting-option"><input type="radio" name="pace-select" defaultValue="last" /><span>last run</span></label>
              <label className="setting-option"><input type="radio" name="pace-select" defaultValue="custom" /><span>custom</span></label>
            </fieldset>
          </div>
          <label id="pace-custom" className="preference-row" htmlFor="pace-wpm" hidden>
            <span className="preference-copy"><strong>custom pace</strong><small id="pace-range" className="pace-note">10–300 wpm</small></span>
            <input className="input pace-wpm num" id="pace-wpm" type="number" min="10" max="300" step="1" defaultValue="80" inputMode="numeric" data-unit="wpm" aria-describedby="pace-range" />
          </label>
          <div className="preference-row">
            <div className="preference-copy"><strong id="speed-unit-label">speed unit</strong></div>
            <fieldset className="setting-options" id="speed-unit" aria-labelledby="speed-unit-label">
              <label className="setting-option"><input type="radio" name="speed-unit" defaultValue="wpm" defaultChecked /><span>wpm</span></label>
              <label className="setting-option"><input type="radio" name="speed-unit" defaultValue="cpm" /><span>cpm</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="daily-goal-label">daily goal</strong></div>
            <fieldset className="setting-options" id="daily-goal" aria-labelledby="daily-goal-label">
              <label className="setting-option"><input type="radio" name="daily-goal" defaultValue="0" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="daily-goal" defaultValue="5" /><span>5 min</span></label>
              <label className="setting-option"><input type="radio" name="daily-goal" defaultValue="10" /><span>10 min</span></label>
              <label className="setting-option"><input type="radio" name="daily-goal" defaultValue="15" /><span>15 min</span></label>
              <label className="setting-option"><input type="radio" name="daily-goal" defaultValue="30" /><span>30 min</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="train-focus-label">train focus</strong></div>
            <fieldset className="setting-options" id="train-focus" aria-labelledby="train-focus-label">
              <label className="setting-option"><input type="radio" name="train-focus" defaultValue="balanced" defaultChecked /><span>balanced</span></label>
              <label className="setting-option"><input type="radio" name="train-focus" defaultValue="accuracy" /><span>accuracy</span></label>
              <label className="setting-option"><input type="radio" name="train-focus" defaultValue="speed" /><span>speed</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="drill-length-label">drill length</strong></div>
            <fieldset className="setting-options" id="drill-length" aria-labelledby="drill-length-label">
              <label className="setting-option"><input type="radio" name="drill-length" defaultValue="15" /><span>15 s</span></label>
              <label className="setting-option"><input type="radio" name="drill-length" defaultValue="30" defaultChecked /><span>30 s</span></label>
              <label className="setting-option"><input type="radio" name="drill-length" defaultValue="60" /><span>60 s</span></label>
              <label className="setting-option"><input type="radio" name="drill-length" defaultValue="120" /><span>120 s</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="retest-toggle-label">retest after drill</strong></div>
            <fieldset className="setting-options" id="retest-toggle" aria-labelledby="retest-toggle-label">
              <label className="setting-option"><input type="radio" name="retest-toggle" defaultValue="false" /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="retest-toggle" defaultValue="true" defaultChecked /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="live-toggle-label" data-speed-unit="live {unit} and accuracy">live wpm and accuracy</strong></div>
            <fieldset className="setting-options" id="live-toggle" aria-labelledby="live-toggle-label">
              <label className="setting-option"><input type="radio" name="live-toggle" defaultValue="false" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="live-toggle" defaultValue="true" /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="focus-toggle-label">focus mode</strong></div>
            <fieldset className="setting-options" id="focus-toggle" aria-labelledby="focus-toggle-label">
              <label className="setting-option"><input type="radio" name="focus-toggle" defaultValue="false" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="focus-toggle" defaultValue="true" /><span>on</span></label>
            </fieldset>
          </div>
        </section>
        <section id="settings-keyboard" className="settings-category" aria-labelledby="settings-keyboard-title" hidden>
          <div className="settings-intro"><h3 id="settings-keyboard-title">Keyboard</h3></div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="layout-select-label">keyboard layout</strong><small id="layout-note" className="preference-note">Doesn’t remap keys; set the layout in your system.</small></div>
            <fieldset className="setting-options" id="layout-select" aria-labelledby="layout-select-label" aria-describedby="layout-note">
              <label className="setting-option"><input type="radio" name="layout-select" defaultValue="qwerty" defaultChecked /><span>qwerty</span></label>
              <label className="setting-option"><input type="radio" name="layout-select" defaultValue="dvorak" /><span>dvorak</span></label>
              <label className="setting-option"><input type="radio" name="layout-select" defaultValue="colemak" /><span>colemak</span></label>
              <label className="setting-option"><input type="radio" name="layout-select" defaultValue="colemak-dh" /><span>colemak-dh</span></label>
              <label className="setting-option"><input type="radio" name="layout-select" defaultValue="workman" /><span>workman</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="keyboard-toggle-label">keyboard</strong></div>
            <fieldset className="setting-options" id="keyboard-toggle" aria-labelledby="keyboard-toggle-label">
              <label className="setting-option"><input type="radio" name="keyboard-toggle" defaultValue="false" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="keyboard-toggle" defaultValue="true" /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row" id="finger-row">
            <div className="preference-copy"><strong id="finger-toggle-label">finger map</strong><small id="finger-note" className="preference-note">Turn on the keyboard to show its finger map.</small></div>
            <fieldset className="setting-options" id="finger-toggle" aria-labelledby="finger-toggle-label" aria-describedby="finger-note">
              <label className="setting-option"><input type="radio" name="finger-toggle" defaultValue="false" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="finger-toggle" defaultValue="true" /><span>on</span></label>
            </fieldset>
          </div>
        </section>
        <section id="settings-sound" className="settings-category" aria-labelledby="settings-sound-title" hidden>
          <div className="settings-intro"><h3 id="settings-sound-title">Sound</h3></div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="sound-select-label">sound</strong></div>
            <fieldset className="setting-options" id="sound-select" aria-labelledby="sound-select-label">
              <label className="setting-option"><input type="radio" name="sound-select" defaultValue="off" defaultChecked /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="sound-select" defaultValue="clicks" /><span>clicks</span></label>
              <label className="setting-option"><input type="radio" name="sound-select" defaultValue="clicks-errors" /><span>clicks + error tick</span></label>
            </fieldset>
          </div>
          <label className="preference-row" id="sound-volume-row" htmlFor="sound-volume">
            <span className="preference-copy"><strong>volume</strong></span>
            <span className="preference-range">
              <span id="sound-volume-value" className="preference-value num" aria-hidden="true">50%</span>
              <input className="range" id="sound-volume" type="range" min="0" max="100" step="5" defaultValue="50" aria-valuetext="50%" disabled />
            </span>
          </label>
        </section>
        <section id="settings-shortcuts" className="settings-category keybindings-category" aria-labelledby="settings-shortcuts-title" hidden>
          <div className="settings-intro"><h3 id="settings-shortcuts-title">Shortcuts</h3></div>
          <p id="keybindings-help">Mod means Ctrl or ⌘. Leave blank to disable.</p>
          <form id="keybindings-form">
            <div className="keybinding-row">
              <label htmlFor="keybinding-restart">restart test / local challenge</label>
              <div className="keybinding-controls">
                <input className="input" id="keybinding-restart" name="restart" type="text" spellCheck={false} autoComplete="off" autoCapitalize="off" aria-describedby="keybindings-help keybinding-restart-error" />
                <button className="btn btn-secondary btn-sm" type="button" data-record="restart" aria-label="Record restart test / local challenge binding" aria-pressed="false">Record</button>
              </div>
              <p className="keybinding-error" id="keybinding-restart-error"></p>
            </div>
            <div className="keybinding-row">
              <label htmlFor="keybinding-commands">commands</label>
              <div className="keybinding-controls">
                <input className="input" id="keybinding-commands" name="commands" type="text" spellCheck={false} autoComplete="off" autoCapitalize="off" aria-describedby="keybindings-help keybinding-commands-error" />
                <button className="btn btn-secondary btn-sm" type="button" data-record="commands" aria-label="Record commands binding" aria-pressed="false">Record</button>
              </div>
              <p className="keybinding-error" id="keybinding-commands-error"></p>
            </div>
            <div className="keybinding-row">
              <label htmlFor="keybinding-exitFocus">exit focus mode</label>
              <div className="keybinding-controls">
                <input className="input" id="keybinding-exitFocus" name="exitFocus" type="text" spellCheck={false} autoComplete="off" autoCapitalize="off" aria-describedby="keybindings-help keybinding-exitFocus-error" />
                <button className="btn btn-secondary btn-sm" type="button" data-record="exitFocus" aria-label="Record exit focus mode binding" aria-pressed="false">Record</button>
              </div>
              <p className="keybinding-error" id="keybinding-exitFocus-error"></p>
            </div>
            <div className="keybinding-actions">
              <button className="btn btn-ghost btn-sm" type="button" data-reset-bindings="">Reset defaults</button>
            </div>
            <p id="keybindings-status" role="status" aria-live="polite"></p>
          </form>

        </section>
      </div>
    </div>
    <footer className="settings-footer">
      <p id="settings-saved">Guest settings last for this tab.</p>
      <button id="settings-done" className="btn btn-primary" type="button">Done</button>
    </footer>
  </dialog>

  <dialog id="import-dialog" aria-labelledby="import-dialog-title">
    <form id="import-form" className="dialog-content" noValidate>
      <div>
        <h2 id="import-dialog-title">Import Monkeytype settings</h2>
        <p>In Monkeytype: settings → danger zone → import/export settings → export. Paste it here or choose its file.</p>
      </div>
      <label htmlFor="import-text">Monkeytype settings
        <textarea id="import-text" className="input textarea import-text" rows={6} spellCheck={false} autoComplete="off" autoCapitalize="off" placeholder="{ &quot;mode&quot;: &quot;time&quot;, &quot;time&quot;: 30, … }" aria-describedby="import-error"></textarea>
      </label>
      <div className="import-meta">
        <p id="import-error" className="field-error" role="alert"></p>
        <button id="import-choose" className="btn btn-ghost btn-sm" type="button">Choose a file</button>
        <input id="import-file" type="file" accept=".json,.txt,application/json,text/plain" hidden />
      </div>
      <div className="dialog-actions">
        <button id="cancel-import" className="btn btn-ghost" type="button">Cancel</button>
        <button id="confirm-import" className="btn btn-primary" type="submit" disabled>Import settings</button>
      </div>
    </form>
    <div id="import-report" className="dialog-content" hidden>
      <div>
        <h2 id="import-report-title" tabIndex={-1}>Settings imported</h2>
        <p id="import-summary"></p>
      </div>
      <section className="import-group" aria-labelledby="import-mapped-title">
        <h3 id="import-mapped-title" className="account-kicker">brought over</h3>
        <ul id="import-mapped" className="import-rows"></ul>
      </section>
      <section id="import-skipped-group" className="import-group" aria-labelledby="import-skipped-title">
        <h3 id="import-skipped-title" className="account-kicker">left as they were</h3>
        <ul id="import-skipped" className="import-rows"></ul>
      </section>
      <div className="dialog-actions">
        <button id="import-done" className="btn btn-primary" type="button">Done</button>
      </div>
    </div>
  </dialog>

  <div id="history-toast" className="toast" role="status" hidden>
    <span className="status-dot" aria-hidden="true"></span>
    <span id="history-feedback">Local history cleared.</span>
    <button id="undo-clear" className="btn btn-ghost btn-sm" type="button">Undo</button>
  </div>

  <div id="account-toast" className="toast account-toast" role="status" hidden>
    <span className="status-dot" aria-hidden="true"></span>
    <span id="account-feedback"></span>
  </div>

  <div id="egg-toast" className="toast egg-toast" role="status" hidden>
    <span className="ghost-mark" aria-hidden="true"></span>
    <span id="egg-feedback"></span>
  </div>

  <div id="suggest-toast" className="toast" role="status" hidden>
    <span className="status-dot" aria-hidden="true"></span>
    <span>Suggestion sent. Thank you.</span>
  </div>

  <aside id="challenge-toast" className="toast challenge-toast" aria-label="Race notification" hidden>
    <span className="status-dot" aria-hidden="true"></span>
    <span id="challenge-toast-text"></span>
    <button id="challenge-toast-action" className="btn btn-secondary btn-sm" type="button">Join</button>
    <button id="challenge-toast-close" className="btn btn-ghost btn-sm toast-close" type="button" aria-label="Dismiss">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
    </button>
  </aside>

  <div id="announcement" className="sr-only" role="status" aria-live="polite"></div>

  </>;
}
