# Handoff — Stilltype

Updated 22 September 2026 after the "Afterimage" redesign and the typing-latency pass. Read `PRODUCT.md`, `AGENTS.md`, `DESIGN.md` and `docs/decisions/2026-09-22-learning-loop.md` before changing behavior or visuals. `DESIGN.md` describes the shipped build; the tokens at the top of `src/styles.css` and the Brand Commitments in `PRODUCT.md` are the implementation source of truth.

## Current state

The app was redesigned on 22 September 2026, away from the former Ash system (`design/ash/`, now historical reference only), then trimmed after a critique (`.impeccable/critique/2026-09-22T19-57-13Z__index-html.md`). It remains native HTML/CSS/JavaScript with no runtime dependencies; accounts (29 September 2026) use Supabase over plain `fetch`. Scoring, replay and the learning loop are unchanged in behaviour.

```sh
npm run dev   # local server on :5173
npm test      # 8 focused scoring/replay/evidence checks
npm run build # static copy of the served files into dist/ (Vercel uses this via vercel.json)
```

Product behaviour:

- Spacious, borderless typing with centered mode/length controls, a stable three-line passage, a solid caret and underlined errors.
- Time, word-count and original quote tests; quote length and descriptive difficulty filters; explicit empty-filter recovery.
- Saved theme, text size, keyboard, live metrics, stop-on-error and focus preferences. Focus mode has an exit and Escape support.
- Per-user sessions. Everyone starts in guest mode: default settings, and nothing is written to storage. The person button (top right; `#account`) offers Create account, Sign in with Google and Sign in with email. Signed-in profiles are cached per user on the device (`stilltype-profile-v2:<user id>`) and synced to Supabase; the newer copy wins on load. Saves only stamp the profile once that first comparison has succeeded (retried when the browser comes back online), so a stale cache can never look newer than the account. Signing out clears that user's device cache unless edits failed to sync. The pre-accounts `stilltype-profile-v2` history is merged into the first account confirmed to have no saved profile; it stays in place if that check fails.
- Versioned deterministic replay, retained first-attempt mistakes, condition-filtered recommendations, sample thresholds and clean pair timing.
- A real one-minute drill stage, automatic or manually selected. Manual drills work without a baseline; a baseline enables the fresh comparable retest.
- Retest comparisons with mixed/regression states, timing sample limits and local progress. Seen quote IDs are recorded when displayed; exhausted retests stop with an explanation.
- Condition-aware bests; drills, challenges and interrupted attempts do not become personal bests.
- Local two-player shared-keyboard challenges with the same passage, hidden handoff and observed results. This is not networked multiplayer.
- Typed history-clear confirmation with immediate Undo.

Shipped visual system (Afterimage):

- **Type.** Literata (variable weight and optical size, self-hosted as woff2 under the OFL in `src/fonts/OFL-literata.txt`, with a serif fallback stack) for everything readable, including the passage and numerals. Geist Mono, self-hosted with the SIL licence under `src/fonts/`, only for small measurement labels, conditions and keys.
- **Colour and theme.** Warm near-black `#0f0f0e` (dark, default when the system prefers dark) and warm paper `#f4f1eb` (light). The theme follows the system until the user picks dark or light in settings (`#theme-select`) or the command palette; an inline script resolves it before first paint. One green accent (dark `#8fd18a`, light `#2e7d4f`) for action, current state and the caret; the primary button is a filled green. Coral for mistyped letters (always with a wavy underline) and regressions; warning for interrupted and mixed results.
- **Surfaces.** Rules and space, not boxes. Opaque raised surfaces for the dock, settings, palette and toasts.
- **Chrome.** A floating dock (top on desktop, bottom on mobile) with practice / train / progress / challenge and a ⌘K / Ctrl-K command palette (views, restart, test shape, punctuation, theme, text size, live metrics, keyboard, stop on error, focus mode, clear history). Settings sit beside Restart below the typing passage. Opening the palette mid-run marks the run interrupted.
- **Results.** A static "run card": wpm, accuracy, first-try errors, time, a one-line metric definition, the conditions line and a speed-over-time line graph (wpm per second over a trailing three seconds, a dotted average, mistakes as coral dots on the line). It replaced the dithered rhythm art on 29 September 2026, which read as decoration rather than data.
- **Ghost pacer (hidden).** ↑↑↓↓←→←→ b a, or typing "ghost" in the palette, toggles a ghost caret that moves at the personal best for the current conditions (or 60 wpm). Presentational only; never scored.

## Motion: still run (22 September 2026)

Nothing decorative moves near the passage while a run is in progress. `src/motion.js` draws a solid spring caret and the optional ghost caret and drives a ~150 ms line scroll; letter states change instantly. After the first keystroke `body[data-running]` fades the rest of the chrome out; pointer movement, finishing or restarting brings it back. Live WPM shows "—" for the first second instead of a first-keystroke spike, and `#live-stats` is no longer a live region; completion is announced once through `#announcement`.

Motion is allowed after the run and in chrome only: fades of 200 ms or less, the gliding selection pill, and the run card's speed graph (`src/graph.js`), which draws in about 450 ms. Every duration scales from `--motion-scale`, which is zero under `prefers-reduced-motion`. `src/motion.js` and `src/graph.js` are presentational; scoring never reads from them. Browser event-to-next-paint timing is recorded in `docs/verification/2026-09-22-latency.md`; physical key-to-display timing remains unmeasured.

Removed on purpose after the critique; do not reintroduce: the streak "heat" glow and caret aura, the letter ink trail (letters landing lit and cooling), the error shake, digit pop-ins and number reels, the word underline/lens sweeping through glyphs, run-card tilt, glare and foil, glass surfaces, the live rhythm strip, and blur reveals on restart and results. The earlier typing-motion exception recorded in `design/ash/DESIGN.md` §6 is retired with Ash.

## Validation

`docs/verification/2026-09-22-browser.md` records browser checks run on the pre-redesign build: the solo run → manual br drill → fresh retest → saved/reloaded progress flow and both players' challenge turns were completed through actual browser input. Tests use a separate 127.0.0.1 origin so the user's localhost profile is not polluted by verification scores. **These checks have not been re-run on the Afterimage build**; re-run them, plus theme switching, the command palette, the ghost pacer, the running-state fade and reduced motion, before calling the redesign verified.

The latency pass separately verified 900 individual practice keys, corrected-error feedback, caret alignment after line trimming, a 100-character local-challenge prefix, ghost-pacer toggle, and dark desktop/light and 320 px dark mobile layouts in Chromium. See `docs/verification/2026-09-22-latency.md`. This does not replace the complete learning-loop browser check above.

## Code map

- `index.html`: markup — dock, settings, command palette, application screens, dialogs and toasts; the pre-paint theme script.
- `src/styles.css`: design tokens at the top (dark and light), then shell and screens. There are no separate token files.
- `src/typing.js`: corpus, metric/event versions, replay, comparison and transparent pattern baseline (engine; unchanged in behaviour by the redesign).
- `src/app.js`: orchestration — screen state, input handling, preferences and theme, history, local challenge, palette commands and the ghost toggle.
- `src/motion.js`: caret, line scroll and ghost pacer (presentational).
- `scripts/measure-latency.mjs`: standalone Chromium browser event-to-paint benchmark for an exclusive desktop session.
- `src/graph.js`: run-card speed graph (SVG) from the attempt's event log (presentational).
- `src/palette.js`: the ⌘K / Ctrl-K command palette.
- `src/account.js`: Supabase Auth (email/password, Google via PKCE), session refresh and the `profiles` row, over `fetch`.
- `supabase/migrations/`: the `profiles` table and its owner-only row-level security, as applied to the `typingsite` project.
- `src/egg.js`: the ↑↑↓↓←→←→ b a key sequence.
- `docs/ui-contract.md`: DOM integration contract.
- `server.mjs` / `scripts/build-static.mjs`: serve / copy exactly `index.html`, `src/*.js`, `src/*.css`, `src/fonts/*.ttf`, `src/fonts/*.woff2` and the `OFL*.txt` licences. `design/`, canvas artboards and project documents are not served or built.

## Decisions to preserve

Afterimage is binding (see `AGENTS.md` and the Brand Commitments in `PRODUCT.md`): Literata for the passage and numerals, Geist Mono for small labels only; dark and light themes that follow the system until the user picks; one green accent for action, current state and the caret; opaque surfaces with no glass or glow; the still-run motion rule. The text-size preference keeps its stored values `22` / `28` / `36` (small / medium / large), mapped to the passage size in `src/styles.css`. Errors retain the non-colour wavy underline. The ghost pacer and speed graph are presentational and never scored. Keep metrics and conditions visible; never turn small-sample timing into a confident weakness or learning claim.

Stop on error is off by default, so mistakes can be typed through; turning it on requires mandatory correction. Live metrics and the on-screen keyboard are also off by default. The selected correction policy is recorded in comparison keys, and retests restore the baseline policy. Do not mix correction policies, quote difficulty/performance points or multiplayer ratings into personal skill progress. Existing unversioned `stilltype-best` data is not imported into comparable bests.

The newest 24 attempt traces are retained per signed-in user (device cache plus the account's `profiles` row); comparison summaries, seen-text IDs and bests remain until history is cleared. Guests keep everything in memory only. Local challenge scores are transient. Nothing is collected beyond the signed-in user's own profile. Storage failures are reported in result copy.

## Remaining work

- Re-run browser verification on the Afterimage build (see Validation).
- `src/fonts/` still holds the Geist sans files (`geist-400/500/600.ttf`), which nothing references now but which are still served and built. Remove them once confirmed unused.
- Repeat the latency benchmark across more desktop browsers and physical devices. The current named Chromium run is recorded in `docs/verification/2026-09-22-latency.md`.
- Broaden physical-device/browser coverage, including assistive technology, actual touch keyboards and IME behavior. Responsive layouts and direct physical-keyboard input were tested on the pre-redesign build; this is not a complete accessibility certification.
- Expand the small original quote corpus and validate difficulty labels. Empty filter combinations are explicit. Generated retests match configured conditions but do not guarantee matched target frequency; target sample limits remain visible.
- Improve progress exploration and define longer-term local retention/sync requirements before expanding data storage.
- Recorded ghosts, daily challenges and networked friend rooms remain later roadmap stages. Online rooms need lifecycle, authoritative validation and multi-client testing. (The hidden ghost pacer is a pace line, not a recorded ghost.)
- The recommender is a transparent baseline, not ML. There are no learning outcome benchmarks, user studies, deployment or public rankings.
- Accounts: Google sign-in needs the Google provider enabled in Supabase (Auth → Providers) with a Google Cloud OAuth client; every origin the app runs on (local dev, the Vercel URL) must be in Auth → URL Configuration → Redirect URLs. Sync is last-writer-wins for the whole profile; merge concurrent edits from two devices if that becomes a real problem.

The critique snapshots before `2026-09-22T19-57-13Z` describe the Ash implementation or the canvas artboards. They remain historical evidence; do not blindly reapply their backlog to the shipped UI. Check the minor observations in the latest critique against the build rather than assuming they are fixed.
