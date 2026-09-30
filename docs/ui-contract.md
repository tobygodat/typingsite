# UI contract

This document is the integration contract between the static interface in `index.html` and the behavior in `src/app.js` (with `src/motion.js`, `src/graph.js`, `src/palette.js` and `src/egg.js`). The app is a single document with one shared typing surface so practice, targeted drill, and fresh-text retest preserve the same geometry and input behavior.

## Screen model

- `body[data-view]` is one of `practice`, `results`, `progress`, or `compete`.
- Only the matching `[data-screen]` is visible. Navigation controls use `[data-nav]` with the same values and set `aria-current="page"` (and `.is-active`) on the active item. The dock labels them practice, train, progress and challenge; the brand link also navigates to practice.
- `#typing-screen` is the shared typing surface. Its `data-session` value is one of `practice`, `drill`, or `retest`; `body[data-session]` mirrors it for styling.
- Results, progress, and challenge use `#results-screen`, `#progress-screen`, and `#compete-screen`.
- `body[data-running]` is present from the first keystroke of a run until it finishes or restarts. While it is set, chrome other than the passage and its measure row fades out; pointer movement, finishing or restarting brings it back. It never changes the passage geometry.
- Buttons with `[data-action]` expose intent for delegated event handlers. All navigation and state changes happen without a page reload.

## Theme

`html[data-theme]` is `dark` or `light`. An inline script in `<head>` resolves it before first paint from `preferences.theme` in the `stilltype-profile-v2` profile, falling back to `prefers-color-scheme`. The stored preference is `system`, `dark` or `light`; `system` follows the OS and updates when it changes. `meta[name="theme-color"]` is kept in step with the resolved theme.

## Dock, settings and command palette

The dock (`nav.dock` in `.dock-zone`) holds the brand link, the `.dock-nav` view buttons, the settings popover (`details.preferences`, whose `summary.dock-settings` shows an icon and the label "settings") and `#palette-trigger`. The popover is positioned against the dock: below it on desktop, above it on mobile. Restart (`#restart-button`) stays in the typing footer.

Selection pills: a `.glide` container with `data-glide="current"` follows `aria-current`; `data-glide="pressed"` follows `aria-pressed`. Its `.glide-pill` is aria-hidden decoration; state always lives in the ARIA attributes and `.is-active`.

Settings are `#theme-select` (`system`, `dark`, `light`), `#font-size` (`22`, `28`, `36`), `#live-toggle`, `#keyboard-toggle`, `#stop-on-error-toggle`, and `#focus-toggle`; `#exit-focus` sits outside the dock. Apply theme as `html[data-theme]`; font size as `body[data-font-size]`; live metrics as `body[data-live-metrics]`; keyboard as `body[data-keyboard]`; focus mode as `body[data-focus-mode]`. Stop on error defaults on; turning it off permits advancement after mistakes. Changing the correction policy starts a new practice run. The policy is stored in run conditions, keeping bests and comparisons separate. The generated keyboard belongs in `#keyboard`. Escape or `#exit-focus` exits focus mode before applying the ordinary Escape restart behavior.

The command palette is `dialog#palette`. `#palette-input` is a combobox controlling `#palette-list` (a listbox rebuilt from the app's commands on every keystroke, so hints show current state); `#palette-empty` shows when nothing matches; `.palette-highlight` is aria-hidden. Ctrl-K / ⌘K and `#palette-trigger` open it; Escape closes it and returns focus. Opening it closes settings, and opening it during a run marks that run interrupted.

## Shared typing surface

Required IDs: `typing-screen`, `typing-form`, `typing-input`, `typing-wrap`, `text-display`, `accessible-passage`, `live-stats`, `live-wpm`, `live-accuracy`, `timer`, `timer-unit`, `timer-label`, `progress-track`, `progress-bar`, `typing-status`, `session-kicker`, `session-title`, `session-description`, `condition-line`, `input-help`, `restart-button`, and `announcement`.

`#text-display` receives `.word > .char` spans. Character state classes are `.correct`, `.wrong`, and `.current`; they change instantly, without transition. `.wrong` always has a non-colour tint; on a space it is painted at full line height so the row keeps an even band. Under `forced-colors: active` it switches to the system `Mark` / `MarkText` highlight so the mark survives the forced palette. The display has a fixed three-line height; live metric updates must not change its geometry. `src/motion.js` inserts only two aria-hidden elements into the display after each render, `.caret` and `.ghost-caret`, drives the ~150 ms line scroll, and sets `data-caret` / `data-blocked` on `#typing-wrap`.

`#typing-input` is the real focus target and remains visually transparent over the displayed text. `#progress-track` is a thin line with `role="progressbar"`; keep `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and `aria-valuetext` current. `#progress-bar` fills from its `--progress` custom property (0–1), not its width.

`#live-stats` is plain text and is not a live region; update it at a restrained cadence. Completion is announced once through `#announcement`.

Practice mode controls are `#mode-time`, `#mode-words`, `#mode-quote`, `#duration-options`, `#punctuation-toggle`, `#quote-options`, `#quote-length`, and `#quote-difficulty`. Generated length buttons belong in `#duration-options` and use `aria-pressed`.

`#best` in the footer shows the personal best for the current conditions, or states that there is none. `#suggest-trigger` beside it (and the palette command "suggest a feature…") opens `dialog#suggest-dialog`: `#suggest-text` (max 1000 characters, counted in `#suggest-count`), errors in `#suggest-error`, a hidden honeypot `#suggest-website`, and `#send-suggest`, which inserts `{ body, view }` into the Supabase `feature_suggestions` table through `sendSuggestion` in `src/account.js`, always as the anonymous role (a filled honeypot sends nothing). Success closes the dialog and shows `#suggest-toast`; failure keeps the text. Opening it mid-run marks the run interrupted, like the palette.

## Completed run and recommendation

`#results-heading` contains `#result-delta`, the one-line headline for the run. `#result-comparison-note` stays empty except for interrupted-run and storage messages.

The run card is `#run-card`: `#run-card-stamp` (date, time and session kind), `#speed-graph` (an SVG speed-over-time graph drawn by `src/graph.js` from the attempt's keystrokes, mistakes in coral; `role="img"` with a text summary in its `aria-label`; presentational only) and its legend, `#result-wpm`, `#result-accuracy`, `#result-errors`, `#result-time`, a one-line metric definition, and `#result-conditions`. The card is a static print: numbers are set directly, with no tilt, reels or count-up.

Recommendation IDs are `recommendation-title`, `recommendation-evidence`, `recommendation-list`, `recommendation-meta`, `start-drill`, `skip-to-retest`, and `run-again`.

`#recommendation-evidence` must name observed evidence (error count and/or timing against the user's own median). When evidence is insufficient, say so directly and offer a general drill. `#recommendation-meta` states approximate drill time and that the retest uses a fresh comparable passage. Never render a confident weak-pattern claim without recorded observations.

The manual target lives in `details.manual-panel` (summary `#manual-heading`): `#manual-target` form, `#manual-target-input`, and `#apply-manual-target`. It accepts a short letter pair or word. Validation appears in `#manual-target-error`; invalid state uses `aria-invalid="true"` and visible recovery copy.

## Drill and retest

`#start-drill` changes the shared typing surface to `data-session="drill"`; the page uses the same input and text display with target-heavy generated text. `#skip-to-retest` and drill completion change it to `data-session="retest"`; the passage must be fresh and the condition line must say whether comparison is valid.

Retest outcome IDs are `#comparison-panel`, `#comparison-status`, `#comparison-accuracy`, `#comparison-timing`, `#comparison-wpm`, `#comparison-sample`, and `#comparison-caveat`. The panel supports `data-outcome="improved|mixed|regressed|steady|insufficient|unavailable"`. The green accent appears only for `improved`; `mixed` uses warning. Regression uses plain coral (danger) ink and explanatory copy. Insufficient samples and incomparable conditions state that no claim can be made.

## Online challenge

Challenge defaults to `#online-challenge`; `#challenge-online`, `#challenge-daily` and `#challenge-local` select online, daily or shared-keyboard play with `aria-pressed`. `src/online-race.js` owns online state and uses the same text renderer and caret effects as practice.

Hosts use `#online-name`, optional `#online-invite-email` and `#create-online-race`. Guests are offered `#online-signin` to host. Account invitations appear in `#online-invites` with `[data-accept-invite]` buttons. A fragment invitation opens `#online-guest-join` with `#online-guest-name` and `#join-online-race`.

`#online-room` contains `#online-room-status`, `#online-connection`, `#online-players`, `#online-ready` and `#online-leave`. A guest room exposes the copyable `#online-guest-link` and `#copy-race-link`; account rooms instead show generic delivery copy in `#online-account-invite-status`. Each player has a labelled progressbar with no decorative animation.

`#online-stage` contains `#online-countdown`, `#online-timer`, `#online-text-display`, `#online-accessible-passage` and `#online-input`. Input remains disabled until the shared start and after completion; paste, key repeat and composition are refused. `#online-results`, `#online-winner` and `#online-result-rows` display server results, with `#online-again` to return to setup. Leaving ends an active room; transient network failures retry without freeing the seat.

Room credentials and pending guest invites use expiring tab-scoped sessionStorage; guest run history remains unsaved. Online scores do not enter solo progress or bests. See [online race behavior and verification](online-races.md).

## Daily challenge

`#daily-challenge` contains `#daily-date`, `#start-daily`, `#daily-status` and `#daily-history-panel`. Daily uses the primary typing surface with `data-session="daily"`, fixed quote conditions and continue-on-error. Its UTC date is captured at start. Saved completed scores distinguish first/repeat attempts and fresh/previously displayed text. Daily scores stay out of practice trends and bests. Daily and One keyboard selectors are disabled while an online room is active.

## Local challenge

Required IDs: `compete-setup`, `player-one-name`, `player-two-name`, `start-local-race`, `race-stage`, `race-player`, `race-status`, `race-handoff`, `handoff-name`, `handoff-veil`, `start-next-player`, `race-text-display`, `race-accessible-passage`, `race-input`, `race-help`, `race-progress`, `race-leaderboard`, `race-winner`, `race-results`, and `race-again`.

The two players type the same original passage sequentially on one keyboard, using the correction policy captured when the challenge starts. Mirror that passage into `#race-accessible-passage`; `#race-input` includes it in `aria-describedby`. `#race-progress` is a progressbar whose first child fills from `--progress`. Before player two starts, `#race-handoff` hides the passage and asks the players to hand over the keyboard; `#handoff-name` names the next player, and `#handoff-veil` is aria-hidden decoration that must keep the passage illegible. Do not show online presence, ratings, or fabricated opponents. The result compares corrected WPM, input accuracy, and elapsed time from the two observed attempts.

## Progress and local history

Required IDs: `history-list`, `history-row-template`, `progress-empty`, `clear-history`, `clear-dialog`, `confirm-clear-input`, `confirm-clear`, `cancel-clear`, `history-toast`, `undo-clear`, and `history-feedback`.

`#progress-empty` is visible when no completed loop exists and links back to Practice. History rows state mode, text/corpus conditions, metric version, and sample counts. `#clear-history` opens the typed-confirm dialog. The confirm button stays disabled until the exact word `clear` is entered. After clearing, show `#undo-clear` in `#history-toast` for five seconds.

## Accounts

Required IDs: `account`, `account-trigger`, `account-guest`, `account-create`, `account-google`, `account-signin`, `account-member`, `account-email`, `account-sync`, `account-signout`, `account-dialog`, `account-form`, `account-dialog-title`, `account-dialog-copy`, `account-dialog-google`, `account-email-input`, `account-password`, `account-error`, `account-switch`, `account-cancel`, `account-submit`, `account-confirm`, `account-confirm-email`, `account-confirm-done`, `account-toast`, `account-feedback`, and `guest-note`.

`#account` is a `details` menu fixed top right (it scrolls with the page on mobile, where the dock is at the bottom) and fades with the chrome while a run is in progress. `#account[data-state]` is `guest` or `member`; `#account[data-sync]` is `guest`, `syncing`, `synced`, `offline` or `expired`. Guests see the three sign-in choices and `#guest-note` in the footer; nothing is written to storage for them. Email sign-up that needs confirmation shows `#account-confirm` instead of the form. Signing in or out reloads the page as the new user.

## Ghost pacer

`src/egg.js` listens for ↑↑↓↓←→←→ b a; typing `ghost` in the palette offers the same toggle. `body[data-ghost]` is `on` or `off`. When on, `.ghost-caret` moves at the personal best for the current conditions (or 60 wpm). `#egg-toast` / `#egg-feedback` confirm the change and it is announced. The ghost is presentational only and never scored.

## Accessibility and sizing

All controls are reachable by keyboard and use one focus ring (the accent outline). Mobile interactive targets are at least 44 px. The skip link targets `#typing-input`. Status updates use `#announcement`. Unsupported composition, paste, touch-only input, and focus interruption are announced and displayed in `#input-help`; interrupted attempts are never stored as comparable results. All motion scales to zero under `prefers-reduced-motion`.
