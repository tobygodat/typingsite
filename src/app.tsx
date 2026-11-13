import { GhostResult } from './ghost-result.js';
import { GhostOffer } from './ghost-offer.js';
import { useSyncExternalStore } from 'react';
import { bindingLabel, ariaShortcuts } from './keybindings.js';
import { CustomTextEditor, ManualTargetEditor } from './practice-editors.js';
import { PracticeKeyboard } from './practice-keyboard.js';
import { HistoryClearDialog, HistoryToast } from './history-clear.js';
import { ImportDialog } from './import-dialog.js';
import { SuggestionDialog, SuggestionToast } from './suggestion-dialog.js';
import { Inbox, ChallengeToast } from './inbox-view.js';
import { DeleteAccountDialog } from './account-deletion.js';
import type { Application } from './application.js';
import { AccountMenu, AccountDialog, AccountGuestNote, AccountToast } from './account-view.js';
import { ReplayDialog } from './replay-view.js';
import { ComposeSurface } from './compose-view.js';
import { Palette } from './palette.js';
import { TrainScreen } from './train-screen.js';
import { LearnScreen } from './learn-screen.js';
import { ProgressScreen } from './progress-screen.js';
import { ChallengeScreen } from './challenge-screen.js';
import { ReleaseDialog } from './release-dialog.js';
import { SettingsDialog } from './settings-dialog.js';
import { PracticeControls } from './practice-controls.js';
import { TypingSurface } from './typing-surface.js';
import { ResultsCard } from './results-card.js';

export function App({ practice, learning, palette, settings, compose, quoteFilters, themeEditor, wallpaper, accounts, deletion, inbox, friendsBoard, suggestion, importing, release, historyClear, onlineRace, editors, lengthEditor, challenge, navigation, ghostOffer, ghostResult }: Application) {
  const view = useSyncExternalStore(navigation.view.subscribe, navigation.view.getSnapshot, navigation.view.getSnapshot);
  const shown = view.screen === 'results' ? 'practice' : view.screen;
  const restartLabel = bindingLabel(view.keys.restart);

  return <>
  <a className="skip-link" href="#typing-input" onClick={(event) => { event.preventDefault(); navigation.skip(); }}>Skip to typing</a>
  <div id="wallpaper" className="wallpaper" hidden></div>

  <div className="app-shell">
    <header className="dock-zone">
      <nav className="dock" aria-label="Main navigation">
        <a className={shown === 'practice' ? 'brand is-active' : 'brand'} href="#practice" data-nav="practice" aria-label="Stilltype practice" aria-current={shown === 'practice' ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigation.go('practice'); }}><span className="brand-word">stilltype</span><span className="brand-dot" aria-hidden="true">.</span></a>

        <div className="dock-nav glide" data-glide="current">
          <span className="glide-pill" aria-hidden="true"></span>
          <button className={shown === 'practice' ? 'nav-item is-active' : 'nav-item'} type="button" data-nav="practice" aria-current={shown === 'practice' ? 'page' : undefined} onClick={() => navigation.go('practice')}><span className="nav-label-short">type</span> <span className="nav-label-full">practice</span></button>
          <button className={shown === 'train' ? 'nav-item is-active' : 'nav-item'} type="button" data-nav="train" aria-current={shown === 'train' ? 'page' : undefined} onClick={() => navigation.go('train')}>train</button>
          <button className={shown === 'progress' ? 'nav-item is-active' : 'nav-item'} type="button" data-nav="progress" aria-current={shown === 'progress' ? 'page' : undefined} onClick={() => navigation.go('progress')}><span className="nav-label-short">track</span> <span className="nav-label-full">progress</span></button>
          <button className={shown === 'compete' ? 'nav-item is-active' : 'nav-item'} type="button" data-nav="compete" aria-current={shown === 'compete' ? 'page' : undefined} onClick={() => navigation.go('compete')}><span className="nav-label-short">race</span> <span className="nav-label-full">challenge</span></button>
        </div>

        <span className="dock-sep" aria-hidden="true"></span>

        <button id="settings-trigger" onClick={() => settings.open()} className="dock-command dock-settings" type="button" aria-label="Settings" aria-haspopup="dialog" aria-controls="settings-dialog">
            <svg className="settings-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>
            <span className="dock-label" aria-hidden="true">settings</span>
        </button>

        <button id="palette-trigger" className="dock-command" type="button" aria-label="Commands" aria-haspopup="dialog" aria-controls="palette" aria-keyshortcuts={ariaShortcuts(view.keys.commands) || undefined} onClick={() => palette.open()}>
          <svg className="search-glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
        </button>
      </nav>
    </header>

    <div className="corner">
      <Inbox controller={inbox} />
      <AccountMenu controller={accounts} />
    </div>

    <main id="main-content">
      <section id="typing-screen" className="screen typing-screen" data-screen="practice" data-session="practice" aria-labelledby="session-title" hidden={shown !== 'practice'}>
        <PracticeControls practice={practice} quoteFilters={quoteFilters} lengthEditor={lengthEditor} />

        <CustomTextEditor controller={editors} />
        <ManualTargetEditor controller={editors} />

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

          <PracticeKeyboard controller={practice.keyboard} />

          <div className="typing-footer">
            <div className="input-help-slot">
              <p id="input-help"></p>
              <span id="input-help-reserve" aria-hidden="true"></span>
            </div>
            <div className="typing-actions">
              <button id="restart-button" className="icon-control" type="button" title={view.keys.restart ? `Restart test (${restartLabel})` : 'Restart test'} aria-label="Restart test" aria-keyshortcuts={ariaShortcuts(view.keys.restart) || undefined} onClick={() => navigation.restart()}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7" /></svg>
              </button>
            </div>
          </div>
        </form>

        <div id="practice-result" className="results-layout practice-result">
          <ResultsCard practice={practice} />

          <div id="result-more" className="result-more">
            <GhostResult controller={ghostResult} />
            <GhostOffer controller={ghostOffer} />
          </div>
        </div>

        <ComposeSurface compose={compose} />

        <div className="shortcut-row key-hint" aria-hidden="true">
          <span className="compose-shortcut"><kbd className="mod-key">{view.mac ? '⌘' : 'ctrl'}</kbd><kbd>enter</kbd> done</span>
          <span className="practice-shortcut"><kbd id="restart-key-hint" className="restart-key-hint">{restartLabel}</kbd> restart</span>
          <span className="compose-shortcut"><kbd className="restart-key-hint">{restartLabel}</kbd> start over</span>
          <span><kbd className="command-key">{bindingLabel(view.keys.commands)}</kbd> commands</span>
        </div>
      </section>

      <TrainScreen learning={learning} visible={shown === 'train'} />

      <LearnScreen keyboard={practice.keyboard} learning={learning} visible={shown === 'learn'} />

      <ProgressScreen learning={learning} visible={shown === 'progress'} />

      <ChallengeScreen onlineRace={onlineRace} friendsBoard={friendsBoard} local={challenge.local} daily={challenge.daily} visible={shown === 'compete'} />
    </main>

    <footer className="site-footer">
      <span id="best" className="personal-best num">No best yet</span>
      <AccountGuestNote controller={accounts} />
      <span className="footer-links">
        <button id="suggest-trigger" className="footer-link" type="button" aria-haspopup="dialog" aria-controls="suggest-dialog" onClick={() => suggestion.open()}>suggest a feature</button>
        <button id="release-trigger" className="footer-link" type="button" aria-haspopup="dialog" aria-controls="release-dialog" aria-label="What’s new in v0.5.0" onClick={() => release.open()}>v0.5.0</button>
      </span>
    </footer>
  </div>

  <button id="exit-focus" className="btn btn-secondary exit-focus" type="button" onClick={() => navigation.exitFocus()} aria-keyshortcuts={ariaShortcuts(view.keys.exitFocus) || undefined}><kbd id="exit-focus-hint" className="key-hint">{bindingLabel(view.keys.exitFocus)}</kbd> exit focus</button>

  <Palette palette={palette} />

  <ReplayDialog controller={practice.replay} />

  <HistoryClearDialog controller={historyClear} />

  <DeleteAccountDialog controller={deletion} />

  <AccountDialog controller={accounts} />

  <SuggestionDialog controller={suggestion} />

  <ReleaseDialog controller={release} />

  <SettingsDialog controller={settings} themeEditor={themeEditor} wallpaper={wallpaper} accounts={accounts} importing={importing} />

  <ImportDialog controller={importing} />

  <HistoryToast controller={historyClear} />

  <AccountToast controller={accounts} />

  <div id="egg-toast" className="toast egg-toast" role="status" hidden>
    <span className="ghost-mark" aria-hidden="true"></span>
    <span id="egg-feedback"></span>
  </div>

  <SuggestionToast controller={suggestion} />

  <ChallengeToast controller={inbox} />

  <div id="announcement" className="sr-only" role="status" aria-live="polite"></div>

  </>;
}
