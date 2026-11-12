import { AccountMenu, AccountDialog, AccountGuestNote } from './account-view.js';
import type { AccountSession } from './account-session.js';
import type { ThemeEditorController } from './theme-editor.js';
import type { WallpaperController } from './wallpaper.js';
import { ReplayDialog } from './replay-view.js';
import type { ChallengeStore } from './challenge-store.js';
import type { QuoteFiltersController } from './quote-filters.js';
import { ComposeSurface } from './compose-view.js';
import type { ComposeController } from './compose-view.js';
import type { SettingsController } from './settings.js';
import { Palette } from './palette.js';
import type { PaletteController } from './palette.js';
import type { LearningStore } from './learning-store.js';
import { TrainScreen } from './train-screen.js';
import { LearnScreen } from './learn-screen.js';
import { ProgressScreen } from './progress-screen.js';
import { ChallengeScreen } from './challenge-screen.js';
import { ReleaseDialog } from './release-dialog.js';
import { SettingsDialog } from './settings-dialog.js';
import { PracticeControls } from './practice-controls.js';
import { TypingSurface } from './typing-surface.js';
import type { PracticeSession } from './practice-session.js';
import { ResultsCard } from './results-card.js';

export function App({ practice, learning, palette, settings, compose, quoteFilters, challenge, themeEditor, wallpaper, accounts }: { practice: PracticeSession; learning: LearningStore; palette: PaletteController; settings: SettingsController; compose: ComposeController; quoteFilters: QuoteFiltersController; challenge: ChallengeStore; themeEditor: ThemeEditorController; wallpaper: WallpaperController; accounts: AccountSession }) {
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
      <AccountMenu controller={accounts} />
    </div>

    <main id="main-content">
      <section id="typing-screen" className="screen typing-screen" data-screen="practice" data-session="practice" aria-labelledby="session-title">
        <PracticeControls practice={practice} quoteFilters={quoteFilters} />

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

        <ComposeSurface compose={compose} />

        <div className="shortcut-row key-hint" aria-hidden="true">
          <span className="compose-shortcut"><kbd className="mod-key">ctrl</kbd><kbd>enter</kbd> done</span>
          <span className="practice-shortcut"><kbd id="restart-key-hint" className="restart-key-hint">esc</kbd> restart</span>
          <span className="compose-shortcut"><kbd className="restart-key-hint">esc</kbd> start over</span>
          <span><kbd className="command-key">mod+k</kbd> commands</span>
        </div>
      </section>

      <TrainScreen learning={learning} />

      <LearnScreen learning={learning} />

      <ProgressScreen learning={learning} />

      <ChallengeScreen challenge={challenge} />
    </main>

    <footer className="site-footer">
      <span id="best" className="personal-best num">No best yet</span>
      <AccountGuestNote controller={accounts} />
      <span className="footer-links">
        <button id="suggest-trigger" className="footer-link" type="button" aria-haspopup="dialog" aria-controls="suggest-dialog">suggest a feature</button>
        <button id="release-trigger" className="footer-link" type="button" aria-haspopup="dialog" aria-controls="release-dialog" aria-label="What’s new in v0.5.0">v0.5.0</button>
      </span>
    </footer>
  </div>

  <button id="exit-focus" className="btn btn-secondary exit-focus" type="button"><kbd id="exit-focus-hint" className="key-hint">esc</kbd> exit focus</button>

  <Palette palette={palette} />

  <ReplayDialog controller={practice.replay} />

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

  <AccountDialog controller={accounts} />

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

  <ReleaseDialog />

  <SettingsDialog controller={settings} themeEditor={themeEditor} wallpaper={wallpaper} accounts={accounts} />

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
