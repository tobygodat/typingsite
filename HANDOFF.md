# Handoff — Stilltype

Updated 30 September 2026 (online multiplayer, progress exploration, recurring training, corpus v5 and daily challenge). Read `PRODUCT.md`, `AGENTS.md`, `DESIGN.md` and `docs/decisions/2026-09-22-learning-loop.md` before changing behavior or visuals. `DESIGN.md` describes the shipped build; the tokens at the top of `src/styles.css` and the Brand Commitments in `PRODUCT.md` are the implementation source of truth.

## Current state

The app was redesigned on 22 September 2026, away from the former Ash system (`design/ash/`, now historical reference only), then trimmed after a critique (`.impeccable/critique/2026-09-22T19-57-13Z__index-html.md`). It remains native HTML/CSS/JavaScript with no runtime dependencies; accounts (29 September 2026) and feature suggestions use Supabase over plain `fetch`. Scoring, replay and the learning loop are unchanged in behaviour.

```sh
npm run dev   # local server on :5173
npm test      # node unit checks: scoring, replay, evidence and accounts
npm run build # static copy of the served files into dist/ (Vercel uses this via vercel.json)
npm run test:e2e # Playwright browser verification in e2e/ (needs npm install and a Chromium)
```

Product behaviour:

- Spacious, borderless typing with centered mode/length controls, a stable three-line passage, a solid caret and tinted errors.
- Time and word-count tests draw from a chosen common-word list — top 200 (default, Monkeytype's default "english" list), 1k, 5k or 10k — set in settings or the palette (`src/words.js`; current corpus version v5). The word list is part of the test conditions, so bests and retests never mix lists. Original quote tests; quote length and descriptive difficulty filters; explicit empty-filter recovery.
- Saved theme, text size, word list, keyboard, live metrics, stop-on-error and focus preferences. Focus mode has an exit and Escape support.
- Per-user sessions. Everyone starts in guest mode: default settings, and nothing is written to storage. The person button (top right; `#account`) offers Create account, Sign in with Google and Sign in with email. Signed-in profiles are cached per user on the device (`stilltype-profile-v2:<user id>`) and synced to Supabase; the newer copy wins on load. Saves only stamp the profile once that first comparison has succeeded (retried when the browser comes back online), so a stale cache can never look newer than the account. Signing out clears that user's device cache unless edits failed to sync. The pre-accounts `stilltype-profile-v2` history is merged into the first account confirmed to have no saved profile; it stays in place if that check fails.
- Versioned deterministic replay, retained first-attempt mistakes, condition-filtered recommendations, sample thresholds and clean pair timing.
- A real one-minute drill stage, automatic or manually selected. Manual drills work without a baseline; a baseline enables the fresh comparable retest.
- Retest comparisons with mixed/regression states and timing sample limits. Progress now filters exact conditions and periods (7 / 30 days / all), plots WPM and accuracy, reports weekly medians only when both weeks have evidence, and opens run/comparison details. Old undated runs appear only in All saved runs. The newest 1,000 compact summaries outlive the 24 full traces.
- Training remembers recurring pairs through compact counts for the newest 120 runs, grouped by exact conditions. A target needs at least ten observations and errors or slow intervals across two runs. Target rows show last practice and fresh observations after the immediate retest; ten later observations enable a revisit label. Existing targets and comparison rows can start another drill. A retained compatible current-corpus baseline enables a retest; otherwise the drill explicitly stands alone.
- Corpus v5 has 39 original quotes, with at least three fresh choices in each of nine length/difficulty buckets, and expanded real-word drills with 1,600 words available for the full minute. Labels remain descriptive. Retests preserve baseline conditions and normal text selection; they are not biased toward the trained target. Seen quote IDs are recorded when displayed; exhausted retests stop with an explanation.
- Daily challenge under Daily on the Challenge screen and in the palette: UTC date chooses from a frozen 14-text pool, reset at midnight UTC, fixed relaxed correction. Practice settings are preserved. The run captures its date at start, labels repeats conservatively once displayed, retains completed personal results and excludes interrupted results, and stays out of practice bests and trends. Touch and physical-keyboard daily results stay distinct. Date-specific first attempts and stable passage identity are separate: when the pool cycles after 14 days, old text never becomes fresh training evidence. A daily result can still open a drill and fresh quote retest.
- Condition-aware bests; drills, challenges and interrupted attempts do not become personal bests.
- Online two-player challenges via Supabase: account invitations in the Challenge inbox or a shareable guest link, ready states, a synchronized countdown, live progress, reconnection and observed results. Hosts sign in; invited guests need no account. Original shared-keyboard challenges remain under One keyboard.
- Friends, Race again and the inbox (7 October 2026): a private per-account friend list (saved from an email invite or added after a race) with one-click Challenge; Race again on any closed two-player race, keeping both seats; an envelope inbox beside the account button and an 18-second top-right toast for incoming challenges and rematches. See `docs/online-races.md`.
- Typed history-clear confirmation with immediate Undo.
- Composing practice (9 October 2026): "compose" in the practice mode bar (or "composing practice" in the palette) swaps the passage for a neutral prompt and a free-typing field with no target text. It ends on Done, Ctrl/⌘+Enter or after 60 s from the first key. It reports free-typing speed (characters in the final text ÷ 5 per minute of active typing, each gap over 2 s counted as the average shorter gap) and backspace rate (backspace and delete keystrokes, held repeats included, ÷ all keystrokes) as their own measure: never compared with copy tests, never a best, kept out of runs, trends, retests and recurring evidence. Only the numbers are stored (`profile.compositions`, newest 100); the text never leaves the field, and the UI says so in one line. Progress lists recent sessions in their own section. Paste, drop, undo and multi-character inserts are refused; IME, focus loss, the palette or leaving mid-way mean it isn't saved.

Shipped visual system (Afterimage):

- **Type.** Literata (variable weight and optical size, self-hosted as woff2 under the OFL in `src/fonts/OFL-literata.txt`, with a serif fallback stack) for everything readable, including the passage and numerals. Geist Mono, self-hosted with the SIL licence under `src/fonts/`, only for small measurement labels, conditions and keys.
- **Colour and theme.** Warm near-black `#0f0f0e` (dark, default when the system prefers dark) and warm paper `#f4f1eb` (light). The theme follows the system until the user picks dark or light in settings (`#theme-select`) or the command palette; an inline script resolves it before first paint. One green accent (dark `#8fd18a`, light `#2e7d4f`) for action, current state and the caret; the primary button is a filled green. Coral for mistyped letters (always with a tint) and regressions; warning for interrupted and mixed results.
- **Surfaces.** Rules and space, not boxes. Opaque raised surfaces for the dock, settings, palette and toasts.
- **Chrome.** A floating dock (top on desktop, bottom on mobile) with practice / train / progress / challenge and a ⌘K / Ctrl-K command palette (views, restart, test shape, punctuation, word list, theme, text size, live metrics, keyboard, stop on error, focus mode, clear history, suggest a feature). Settings are a labelled control in the dock (icon only below 900 px, where the label would collide with the account button), so they are findable from every screen; the popover opens below the dock on desktop and above it on mobile. Opening the palette mid-run marks the run interrupted.
- **Results.** A static "run card": wpm, accuracy, first-try errors, time, a one-line metric definition, the conditions line and a speed-over-time line graph (wpm per second over a trailing three seconds, a dotted average, mistakes as coral dots on the line). It replaced the dithered rhythm art on 29 September 2026, which read as decoration rather than data.
- **Ghost pacer (hidden).** ↑↑↓↓←→←→ b a, or typing "ghost" in the palette, toggles a ghost caret that moves at the personal best for the current conditions (or 60 wpm). Presentational only; never scored.

## Motion: still run (22 September 2026)

Nothing decorative moves near the passage while a run is in progress. `src/motion.js` draws a solid spring caret and the optional ghost caret and drives a ~150 ms line scroll; letter states change instantly. After the first keystroke `body[data-running]` fades the rest of the chrome out; pointer movement, finishing or restarting brings it back. Live WPM shows "—" for the first second instead of a first-keystroke spike, and `#live-stats` is no longer a live region; completion is announced once through `#announcement`.

Motion is allowed after the run and in chrome only: fades of 200 ms or less, the gliding selection pill, and the run card's speed graph (`src/graph.js`), which draws in about 450 ms. Every duration scales from `--motion-scale`, which is zero under `prefers-reduced-motion`. `src/motion.js` and `src/graph.js` are presentational; scoring never reads from them. Browser event-to-next-paint timing is recorded in `docs/verification/2026-09-22-latency.md`; physical key-to-display timing remains unmeasured.

Removed on purpose after the critique; do not reintroduce: the streak "heat" glow and caret aura, the letter ink trail (letters landing lit and cooling), the error shake, digit pop-ins and number reels, the word underline/lens sweeping through glyphs, run-card tilt, glare and foil, glass surfaces, the live rhythm strip, and blur reveals on restart and results. The earlier typing-motion exception recorded in `design/ash/DESIGN.md` §6 is retired with Ash.

## Validation

Progress/training/daily integration (30 September): 30 Node checks, static build (21 files), and 57/57 Chromium scenarios pass after rebasing on online multiplayer. Daily uses a separate Challenge selector; online room cancellation restores that selector. GitHub Actions runs the same suites. See `docs/verification/2026-09-30-depth.md`.

Online multiplayer (30 September): build and four Node test files pass; all 48 Chromium scenarios verified across the full regression run and a final targeted rerun. Seven new scenarios cover independent player contexts, account invites, guest links, reload/reconnect, occupied/expired links and narrow layouts. Transaction-wrapped database authorization and lifecycle checks passed against the applied migration. See `docs/online-races.md` and `supabase/tests/online-races.sql`.

The browser verification is now a Playwright suite in `e2e/` (`npm run test:e2e`; see README for the Chromium it needs). It serves the app on `127.0.0.1:4173`, fakes Supabase in memory (`e2e/fake-supabase.js`), and fails on any page or console error. It covers the pre-redesign checks from `docs/verification/2026-09-22-browser.md` (solo run → manual br drill → fresh retest → saved progress, the local challenge, filters, clear/undo, paste and interruption) plus theme switching, the command palette, the ghost pacer, the running-state fade, reduced motion, accounts and responsive layout. The first run on the Afterimage build (29 September 2026, 41/41 in Chromium 152) is recorded in `docs/verification/2026-09-29-browser.md`, with one known narrow-screen defect and one intermittent test hang.

The latency pass separately verified 900 individual practice keys, corrected-error feedback, caret alignment after line trimming, a 100-character local-challenge prefix, ghost-pacer toggle, and dark desktop/light and 320 px dark mobile layouts in Chromium. See `docs/verification/2026-09-22-latency.md`. This does not replace the complete learning-loop browser check above.

## Code map

- `index.html`: markup — dock, settings, command palette, application screens, dialogs and toasts; the pre-paint theme script.
- `src/styles.css`: design tokens at the top (dark and light), then shell and screens. There are no separate token files.
- `src/words.js`: the 200 (Monkeytype's default english, verbatim apart from "I" stored as "i") / 1k / 5k / 10k common-word lists for generated passages and drills. The 5k and 10k lists are cleaned web-frequency lists (see the file header); keep them filtered.
- `src/typing.js`: corpus, metric/event versions, replay, comparison and transparent pattern baseline (engine; unchanged in behaviour by the redesign).
- `src/corpus.js`: additional original quotes and real-word drill vocabulary (corpus v5).
- `src/insights.js`: compact run summaries, bounded pattern memory, condition/period filters, weekly medians, recurring targets and frozen daily text selection.
- `src/progress-view.js`: keyboard-accessible WPM/accuracy charts; presentational only.
- `src/compose.js`: composing practice measurement (active time, free-typing speed, backspace rate), the prompt pool and the numbers-only stored record; `src/compose-view.js` drives the composing form on the practice screen.
- `src/app.js`: orchestration — screen state, input handling, preferences and theme, history, local challenge, palette commands and the ghost toggle.
- `src/motion.js`: caret, line scroll and ghost pacer (presentational).
- `e2e/`: Playwright browser verification (`playwright.config.js`); `e2e/fake-supabase.js` stands in for Supabase.
- `scripts/measure-latency.mjs`: standalone Chromium browser event-to-paint benchmark for an exclusive desktop session.
- `src/graph.js`: run-card speed graph (SVG) from the attempt's event log (presentational).
- `src/palette.js`: the ⌘K / Ctrl-K command palette.
- `src/online-race.js`: online lobby, friend list, invitations, synchronized race surface, transient results and Race again.
- `src/inbox.js`: the envelope inbox, invitation polling and the challenge toast.
- `src/multiplayer.js`: race RPC transport, link handling and tab-scoped reconnect credentials.
- `src/account.js`: Supabase Auth (email/password, Google via PKCE), session refresh and the `profiles` row, over `fetch`.
- `supabase/migrations/`: the `profiles` table and its owner-only row-level security, as applied to the `typingsite` project.
- `src/egg.js`: the ↑↑↓↓←→←→ b a key sequence.
- `docs/ui-contract.md`: DOM integration contract.
- `server.mjs` / `scripts/build-static.mjs`: serve / copy exactly `index.html`, `src/*.js`, `src/*.css`, `src/fonts/*.ttf`, `src/fonts/*.woff2` and the `OFL*.txt` licences. `design/`, canvas artboards and project documents are not served or built.

## Decisions to preserve

Afterimage is binding (see `AGENTS.md` and the Brand Commitments in `PRODUCT.md`): Literata for the passage and numerals, Geist Mono for small labels only; dark and light themes that follow the system until the user picks; one green accent for action, current state and the caret; opaque surfaces with no glass or glow; the still-run motion rule. The text-size preference keeps its stored values `22` / `28` / `36` (small / medium / large), mapped to the passage size in `src/styles.css`. Errors retain the non-colour tint; the wavy underline was removed on 29 September 2026. The ghost pacer and speed graph are presentational and never scored. Keep metrics and conditions visible; never turn small-sample timing into a confident weakness or learning claim.

Stop on error is off by default, so mistakes can be typed through; turning it on requires mandatory correction. Live metrics and the on-screen keyboard are also off by default. The selected correction policy is recorded in comparison keys, and retests restore the baseline policy. Do not mix correction policies, quote difficulty/performance points or multiplayer ratings into personal skill progress. Existing unversioned `stilltype-best` data is not imported into comparable bests.

The newest 24 attempt traces and 1,000 compact run summaries (including drills, interrupted and daily runs) are retained per signed-in user; pattern counts remain only on the newest 120 summaries. Comparison summaries, seen-text IDs and bests remain until history is cleared. Everything uses the existing device cache and account `profiles.data` JSON, without a schema change. Old profiles derive available summaries from retained traces; missing dates and older comparison snapshots are labelled rather than fabricated. Clear/Undo covers all new history. Guests keep everything in memory only. Local two-player scores are transient. Online races store room state, chosen names, current typed text and score counters on the race service; guest reconnect credentials stay in sessionStorage for that tab. Online results never enter the profile. Composing practice stores numbers only (`profile.compositions`, newest 100, rebuilt from known fields on load) and never the text; it is not a run kind, so bests, trends, retests, recurring targets, and run-based counts such as a daily goal or break notice leave it out. The footer's "suggest a feature" dialog inserts text and current view anonymously, never linked to an account; that table accepts inserts only and nobody can read it back through the public API. Storage failures are reported in result copy.

## Remaining work

- The 30 September change adds an 80 px narrow numeral token below 360 px to fix the run-card overflow. Continue checking large scores when changing result typography.
- GitHub Actions runs unit, static build and Chromium browser checks on PRs and master pushes. Add Firefox/WebKit projects to broaden coverage.
- Repeat the latency benchmark across more desktop browsers and physical devices. The current named Chromium run is recorded in `docs/verification/2026-09-22-latency.md`.
- Broaden physical-device/browser coverage, including assistive technology, actual touch keyboards and IME behavior. Responsive layouts and direct physical-keyboard input were tested on the pre-redesign build; this is not a complete accessibility certification.
- Validate the expanded original corpus's descriptive difficulty labels. Generated retests match configured conditions but do not guarantee matched target frequency; target sample limits remain visible.
- Run/pattern retention is now explicit (1,000 / 120); evaluate account payload size and concurrent-device merges before expanding it further.
- Recorded ghosts and public matchmaking remain later roadmap stages. Private friend rooms now have lifecycle enforcement, server timing and multi-client testing; full anti-cheat and rankings remain deferred. (The hidden ghost pacer is a pace line, not a recorded ghost.)
- The recommender is a transparent baseline, not ML. There are no learning outcome benchmarks, user studies, deployment or public rankings.
- Accounts: Google sign-in needs the Google provider enabled in Supabase (Auth → Providers) with a Google Cloud OAuth client; every origin the app runs on (local dev, the Vercel URL) must be in Auth → URL Configuration → Redirect URLs. Sync is last-writer-wins for the whole profile; merge concurrent edits from two devices if that becomes a real problem.

The critique snapshots before `2026-09-22T19-57-13Z` describe the Ash implementation or the canvas artboards. They remain historical evidence; do not blindly reapply their backlog to the shipped UI. Check the minor observations in the latest critique against the build rather than assuming they are fixed.
