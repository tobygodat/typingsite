# UI contract

This document is the integration contract between the static interface in `index.html` and the behavior in `src/app.js`. The app is a single document with one shared typing surface so practice, targeted drill, and fresh-text retest preserve the same geometry and input behavior.

## Screen model

- `body[data-view]` is one of `practice`, `results`, `progress`, or `compete`.
- Only the matching `[data-screen]` is visible. Navigation buttons use `[data-nav]` with the same values and set `aria-current="page"` on the active item.
- `#typing-screen` is the shared typing surface. Its `data-session` value is one of `practice`, `drill`, or `retest`; `body[data-session]` mirrors it for styling.
- Results, progress, and challenge use `#results-screen`, `#progress-screen`, and `#compete-screen`.
- Buttons with `[data-action]` expose intent for delegated event handlers. All navigation and state changes happen without a page reload.

## Shared typing surface

Required IDs: `typing-screen`, `typing-form`, `typing-input`, `text-display`, `accessible-passage`, `live-stats`, `live-wpm`, `live-accuracy`, `timer`, `timer-unit`, `timer-label`, `progress-track`, `progress-bar`, `typing-status`, `session-kicker`, `session-title`, `session-description`, `condition-line`, `input-help`, `restart-button`, and `announcement`.

`#text-display` receives `.word > .char` spans. Character state classes are `.correct`, `.wrong`, and `.current`. `.wrong` always has a non-colour underline. The display has a fixed three-line height; live metric updates must not change its geometry.

`#typing-input` is the real focus target and remains visually transparent over the displayed text. `#progress-track` has `role="progressbar"`; keep `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and `aria-valuetext` current. `#live-stats` is `aria-live="polite"` and should be updated at a restrained cadence.

Practice mode controls are `#mode-time`, `#mode-words`, `#mode-quote`, `#duration-options`, `#punctuation-toggle`, `#quote-options`, `#quote-length`, and `#quote-difficulty`. Generated length buttons belong in `#duration-options` and use `aria-pressed`.

Preferences are `#font-size` (`22`, `28`, `36`), `#live-toggle`, `#keyboard-toggle`, `#focus-toggle`, and `#exit-focus`. Apply font size as `body[data-font-size]`; live metrics as `body[data-live-metrics]`; keyboard as `body[data-keyboard]`; focus mode as `body[data-focus-mode]`. The generated keyboard belongs in `#keyboard`. Escape or `#exit-focus` exits focus mode before applying the ordinary Escape restart behavior.

## Completed run and recommendation

Required IDs: `result-wpm`, `result-accuracy`, `result-errors`, `result-time`, `result-delta`, `result-comparison-note`, `recommendation-title`, `recommendation-evidence`, `recommendation-meta`, `recommendation-list`, `start-drill`, `skip-to-retest`, `manual-target`, `manual-target-input`, `apply-manual-target`, and `run-again`.

`#recommendation-evidence` must name observed evidence (error count and/or timing against the user's own median). When evidence is insufficient, say so directly and offer a general drill. `#recommendation-meta` states approximate drill time and that the retest uses a fresh comparable passage. Never render a confident weak-pattern claim without recorded observations.

The manual target form accepts a short letter pair or word. Validation appears in `#manual-target-error`; invalid state uses `aria-invalid="true"` and visible recovery copy.

## Drill and retest

`#start-drill` changes the shared typing surface to `data-session="drill"`; the page uses the same input and text display with target-heavy generated text. `#skip-to-retest` and drill completion change it to `data-session="retest"`; the passage must be fresh and the condition line must say whether comparison is valid.

Retest outcome IDs are `#comparison-panel`, `#comparison-status`, `#comparison-accuracy`, `#comparison-timing`, `#comparison-wpm`, `#comparison-sample`, and `#comparison-caveat`. The panel supports `data-outcome="improved|mixed|regressed|insufficient|unavailable"`. Mint appears only for `improved`. Regression uses plain danger ink and explanatory copy. Insufficient samples and incomparable conditions state that no claim can be made.

## Local challenge

Required IDs: `compete-setup`, `player-one-name`, `player-two-name`, `start-local-race`, `race-stage`, `race-player`, `race-status`, `race-handoff`, `start-next-player`, `race-text-display`, `race-accessible-passage`, `race-input`, `race-progress`, `race-leaderboard`, and `race-again`.

The two players type the same original passage sequentially on one keyboard. Mirror that passage into `#race-accessible-passage`; `#race-input` includes it in `aria-describedby`. Before player two starts, `#race-handoff` hides the passage and asks the players to hand over the keyboard. Do not show online presence, ratings, or fabricated opponents. The result compares corrected WPM, input accuracy, and elapsed time from the two observed attempts.

## Progress and local history

Required IDs: `history-list`, `progress-empty`, `clear-history`, `clear-dialog`, `confirm-clear-input`, `confirm-clear`, `cancel-clear`, `undo-clear`, and `history-feedback`.

`#progress-empty` is visible when no completed loop exists and links back to Practice. History rows state mode, text/corpus conditions, metric version, and sample counts. `#clear-history` opens the typed-confirm dialog. The confirm button stays disabled until the exact word `clear` is entered. After clearing, show `#undo-clear` in the toast for five seconds.

## Accessibility and sizing

All controls are reachable by keyboard and use one Ash focus ring. Mobile interactive targets are at least 44 px. The skip link targets `#typing-input`. Status updates use `#announcement`. Unsupported composition, paste, touch-only input, and focus interruption are announced and displayed in `#input-help`; interrupted attempts are never stored as comparable results.
