# Architecture

## Overview

Stilltype is a static web app built with React, strict TypeScript and Effect. Vite compiles its browser modules ([ADR 0021](adr/0021-react-typescript-effect.md)).

- **Client.** `index.html` holds the document shell. `src/prepaint.ts` is bundled inline before CSS to apply saved appearance. `src/main.tsx` mounts React; screen components subscribe to typed stores. `src/sw.ts` builds the network-first offline shell.
- **Hosting.** The Cloudflare Worker `stilltype` serves `dist/`, emitted by `scripts/build-static.mjs` (`wrangler.jsonc`). Locally, `server.mjs` serves that same compiled artifact through its build inventory. Source modules are not served.
- **Backend.** Supabase handles auth, the profile row, online races, ghost challenges, the friends board, feature suggestions and theme-generation quotas. The client calls it over `fetch` (REST and RPC), with no SDK. Guests save nothing beyond the tab.
- **Edge Functions.** `supabase/functions/delete-account` deletes an account. `supabase/functions/generate-theme` asks Claude Haiku for a theme. Each keeps its logic in `handler.ts`, which Node tests, and its Deno wiring in `index.ts`.

## What the app does, by screen

- **Practice.** Time, words (presets or custom) and quote, with punctuation, numbers and four word lists. Time and words text is generated like Monkeytype's English (`drawnPassage` in `src/typing.ts`): no word equals either of the two before it, punctuation is sentence-aware at Monkeytype's rates, and 1 word in 10 is a number. Adaptive mode (time and words) leans the text toward the learner's top few units, weighted by the time each loses. Its runs are drill-kind, so never a best, trend point or baseline.
- **More.** Code (js, python, go, rust), a standard 60 s test, book pages, compose, custom text, and a 1–8 letter manual drill.
- **Learn to type.** 14 lessons. Only physical-keyboard runs unlock the next one.
- **Results.** Shown on Practice in place of the passage (`body[data-view=results]`). One run card (the Instrument look, TOB-470): wpm with its change against the average before this run, accuracy with the words missed, time with the words typed, consistency with the trace's slowest to fastest point; a speed panel with the trace; a typed panel with the words and practice missed words. Then Run again, Drill "pair" and Watch replay, beside the average and best at these conditions and the conditions line. `recentAverage` (`src/insights.ts`) is the one average the card, Practice's avg · best readout and the pace caret read.
- **Train** (the queue, TOB-470, on the path of TOB-420). A queue panel: the one to drill now and the next three the learner queues, each with what it costs in speed, and the targets you have drilled folded under it with what each won back; beside it the chosen step's detail, with its drill's first words, its measures and, for a pair, one dot per timed run against the pace. The steps are built by `trainPath` (`src/train-path.ts`) as a pure function of runs, loops and the recommendation, and their figures by `trainFigures` (`src/train-cost.ts`) from the learner's own fit, never as a ranking of their own. The learner (`src/learner.ts`, [ADR 0013](adr/0013-learning-core.md)) ranks letter pairs and keys by the time each loses, from misses and slowness, over every measured run on this keyboard, older runs fading. The open step is the highest-ranked unit whose observed counts, or for a slow pair its observed timing past 20 ms, can be stated, else a general drill. Either way the drill's text leans toward the top units. Its evidence line, missed words and "since you drilled it" line all read those runs. Its button runs a drill of the chosen length, then a fresh retest at the current settings; the comparison then becomes the newest step behind you and the next queued unit opens. A step ahead can be chosen to drill it. A step behind you is "drilled" after its retest and "fixed" only when the learner no longer queues it and two or more runs since its drill hold 20 observations of the kind it was drilled for, with no first-try miss among them or a mean slowdown of 20 ms or less. The learner holds a drilled target long (34 to 111 clean runs, TOB-419); a variant that lets one go on the evidence since its drill failed [ADR 0019](adr/0019-learner-lets-go.md)'s rule, so this is unchanged. Three practice settings shape it, saved and synced as preferences and never test conditions: the train focus (balanced, the evaluated policy; accuracy, ranked by misses only; speed, by slowness only), the drill length (15, 30, 60 or 120 s) and the retest after the drill (off: the drill ends on its own result, nothing is compared and no loop is saved). The counting rule it replaced stays as the labelled baseline policy. Its Back to practice opens the retest's run card. "Words you keep missing" is a palette command.
- **Progress** (what changed, TOB-420; the Instrument look, TOB-470). One page. The conditions control (which picks the condition key) and the period (7 days, 30 days, all; the charts and lists, never the lead). Four lead cells from one value built by `weekChange` (`src/week-change.ts`) from runs, loops, practice days, the chosen condition key, the train focus and `now`: this week's median speed against the week before's (each from at least three runs, at one condition key), its median accuracy, minutes practised, and the units fixed since the week began by Train's own rule, which opens their list. Two charts of daily medians over a dot for each run, each opening the full speed, accuracy and consistency charts. A year of practice in a calendar, levels by minutes against the daily goal, with a tip naming a day's kept runs and best speed. The newest runs in a table, a crown on each that was a personal best when typed (`personalBests`, `src/progress-records.ts`), and Clear history. Runs and drills, the practice figures (streaks, time typing, runs started), what was fixed and composing each open in a detail view one step away.
- **Challenge** (the people you race, TOB-420). No visible heading. Two panels, quick match and friends, then three tiles. Quick match shows the race rating as a figure and a gauge toward a rank: Find a race pairs you with another waiting player near your race rating, on the standard setup (30 seconds of the 200 words), with a race rating that only quick matches move ([ADR 0014](adr/0014-quick-match-and-race-rating.md)) and, from 10 rated races, a named rank read from it ([ADR 0016](adr/0016-race-rank.md)), with a rank card for each rated result; with nobody waiting, it offers your own best recorded run as a ghost race. The friends panel has one row per person you race, built by `peopleRows` (`src/challenge-people.ts`) as a pure function of your friend list, open invitations, ghost challenges, the service's links between them (`public.race_people`) and the invitations dismissed on this device: the newest thing between you, the pair's tally, and one action (Join, Race the ghost or Race). Its head opens Race setup (the race name, and the mode, length and punctuation races use until Match practice) and Add a friend (and Remove). The tiles are Race by link, Daily passage (with the friends board) and One keyboard; each view opens one step away, in a panel. A race uses the race setup; practice-only setups fall back to a medium quote on 60 s. A finished online race shows both results side by side, with the pair's lasting tally (accounts only), a Rematch pick under each result (when both pick, the next race starts on its own), and a Graph / Replay of both racers drawn from their keystroke traces. See `docs/online-races.md`.
- **Ghost races.** A friend races your recorded run within seven days.
- **Inbox and toast.** Invitations and challenges.
- **Settings and palette.** The settings dialog, and the ⌘K / Ctrl-K palette. Each palette group is listed once, in the order of its first command. Monkeytype import.
- **Rules.** Five correction policies, strict space, quick end, minimums, repeat quotes and the pace caret.
- **Display.** Ten themes in a mode (system, dark, light), with a dark and a light pick. Up to five custom themes, from the editor or generated from a short description (20 a day). A background image ([ADR 0010](adr/0010-background-image.md)). Navigation in a side bar that hides, or a top bar (a bar at the bottom on a phone). Text size, typing and app fonts, word highlight (optionally sliding), one-line tape, wpm or cpm, live metrics, an on-screen keyboard with five layouts and a finger map, focus mode and sounds.
- **Accounts.** Email or Google, sync, clear history with Undo, account deletion, and Export my data (a file of this device's copy).
- Offline shell, What's new, and anonymous feature suggestions.

`docs/ui-contract.md` describes each screen's behaviour in more detail.

## Code map

In `src/`:

- `main.tsx`, `application.ts`, `app.tsx`: stable owner construction, application mounting and the React screen tree. `application-host.ts` attaches the checked native hosts, configures feature ports and disposes page resources; `application-elements.ts` checks their actual element tags. `run-copy.ts` presents run, lesson, rule and minimum labels. `navigation.ts` owns the current screen, shortcut labels and the frame's state (`html[data-navigation]`, `html[data-side-bar]`); `side-bar.ts` keeps whether the side bar is hidden on the device. Native typing hosts remain mounted when a screen is hidden.
- `store.ts`, `practice-session.ts`, `learning-store.ts`, `challenge-store.ts`: cached view subscriptions and long-lived session, profile and Challenge ownership.
- `input.ts`, `typing-host.ts`, `passage-view.ts`, `typing-surface.tsx`: synchronous scored input, composition and passage hosts. Input records timestamps and paints before publishing a React view. `practice-run.ts` owns the primary clock and sealing; `practice-recording.ts` saves run summaries and bests. `input-presentation.ts` projects live scored text, timers and notices. `session-rules.ts` reads the active test and drill timing rules; `practice-conditions.ts` builds conditions without rewriting raw restored fields.
- `settings-dialog.tsx`, `release-dialog.tsx`, `results-card.tsx`, `practice-controls.tsx`: actual dialog, result and control markup. `practice-editors.tsx` and `custom-length.tsx` own the custom text, manual target and length forms. `practice-keyboard.tsx` and `finger-map.tsx` render keyboard feedback. `practice-intro.tsx` owns session copy, pace and best readouts; native live-stat leaf hosts keep their synchronous updates.
- `async-runtime.ts`, `network.ts`, `network-race.ts`: scoped Effect execution, cancellable HTTP and decoded RPC contracts.
- `profile-copy.ts`, `profile-types.ts`, `domain-history.ts`: raw storage codecs, current versus hydrated profile contracts, and historical-record guards. `profile-sync.ts` owns the serial push queue, conditional writes, pulls and cache reconciliation.
- `typing.ts`: the engine: passages, replay, metrics, correction rules, `conditionKey`, and the metric versions. `recorded-text.ts` reads malformed retained text lazily at the same points as the original replay.
- `corpus.ts`, `words.ts`: original quotes and drill words; the word lists.
- `code-snippets.ts`: code mode's snippets.
- `books.ts`, `book-texts.ts`: pagination and place. The text is generated by `scripts/build-book-texts.mjs`.
- `lengths.ts`: test lengths.
- `quote-filters.tsx`: quote and book dropdowns.
- `lessons.ts`: the beginner path.
- `insights.ts`: run summaries (with their timed corrections), retention, patterns, filters, the counting rule's recurring targets, daily text.
- `training-memory.ts`, `training-policy.ts`, `training-results.ts`: the retained historical baseline, drill/retest transitions and Train comparison projections. `history-selection.ts` selects retained baselines and follows history clears. `loop-history.ts` projects raw loop metadata and binds actions to the displayed row.
- `train-path.ts`: Train's path: the steps behind you, open and ahead from the recommendation and the saved loops, the rule for "fixed", and each step's evidence copy.
- `train-cost.ts`: Train's figures: each step's cost in speed from the learner's gain, how often it comes up, its pace against the person's and one dot per timed run, and what each drilled step won back. `train-screen.tsx` draws the queue, the fold and the chosen step.
- `learner.ts`: the learning core: evidence from run summaries, per-unit miss rates pulled toward the person's pooled rate, per-pair slowdowns pulled toward none, decay, ranking by time lost, the one naming rule, the training focus, and the recommendation policies, the person's own miss cost and letting go of drilled targets (`letGo`, a sequential test on the evidence since a drill) among the named variants ([ADR 0013](adr/0013-learning-core.md), [ADR 0015](adr/0015-learner-2.md), [ADR 0019](adr/0019-learner-lets-go.md)).
- `learner-start.ts`: the starting view the `learner-start*@3` versions read: a population miss rate and, per pair and key, what public typing says about its miss rate and pace. Generated by `ml/ship.py` and never edited. No default version reads it ([ADR 0026](adr/0026-starting-view-from-public-keystrokes.md)).
- `run-counts.ts`: runs started and finished.
- `week-change.ts`: Progress's overview: the week against the week before, what moved it and the practice row, as one value. Train's `isFixed` decides "fixed" on both pages.
- `progress-screen.tsx`, `progress-sections.tsx`, `progress-calendar.tsx`, `progress-filters.tsx`: Progress markup and interactions. `progress-view.ts` owns leased chart hosts. `progress-practice.ts` projects calendar, streak, run-count and composing figures. `progress-records.ts` marks the runs that were a best when typed and counts each day's kept runs. `progress-navigation.ts`, `progress-history.ts` and `progress-figures.ts` own detail navigation, retained run selection and coordinated chart/figure updates.
- `graph.ts`: the speed graph.
- `replay-view.tsx`: watch replay.
- `motion.ts`: the caret, line scroll, pace and ghost carets, and the sliding word highlight. Presentational only.
- `tape.ts`: one-line tape geometry.
- `word-highlight.ts`: word highlight.
- `caret-glide.ts`: how long the Smooth caret glides between letters.
- `display-preferences.ts`, `control-glide.ts`: synchronous appearance application and geometry for explicit native control hosts.
- `fonts.ts`: typing and app font choices. `prepaint.ts` applies an account's fonts before first paint.
- `wallpaper.ts`, `wallpaper-image.ts`, `wallpaper-layer.ts`, `wallpaper-settings.tsx`: background-image state, scoped device codecs, native geometry/halo and React settings controls.
- `units.ts`: wpm and cpm display. `displayed-units.ts` publishes the display unit to React and reformats only native live-stat hosts; `pace-controls.tsx` retains an edit’s entry unit until settlement.
- `layouts.ts`: layout legends and the finger map.
- `sound.ts`: typing sounds.
- `keybindings.ts`: shortcuts.
- `settings.ts`: the settings dialog.
- `custom-themes.ts`, `theme-editor.tsx`: custom themes (tokens, contrast, storage) and their editor.
- `palette.tsx`: the command palette.
- `monkeytype.ts`: Monkeytype import.
- `compose.ts`, `compose-view.tsx`, `compose-caret.ts`: composing practice.
- `profile.ts`: profile defaults and `normalizeProfile`.
- `account.ts`: auth, the profile row, `mergeSynced`, `HISTORY`. `account-session.ts` owns session identity and epoch; `account-transitions.ts` owns sign-in, explicit sign-out and cross-tab marker transitions. `account-view.tsx` owns authentication controls.
- `online-race.ts`, `online-race-view.tsx`, `multiplayer.ts`: online race state, React controls and their RPCs. `local-race.tsx` owns the one-keyboard race; `daily-challenge.tsx` owns the daily passage controls. `challenge-people.ts`: the people list as one pure function of the race records and `now` (rows, their states, the order, each line's copy). `challenge-people-view.tsx`: draws it, keeping rows that don't change and keyboard focus. `quick-match.ts`: quick match's standard setup, rating maths, the rank ladder, the result card's model (`ratingResult`), the gauge's (`ratingGauge`), pairing gap, trace check and queue states, shared with the e2e fake. `quick-match-view.tsx`: the quick match panel. `challenge-tiles.tsx`: the three tiles under it. `rank-card.tsx`: the rated result card, its colours and its wind. Presentational only. `race-review.tsx`: a finished race's graph and two-caret replay. `race-options.ts`: what a race is set up as, and its passage. `rematch-conditions.ts` forwards retained rematch conditions without a new eligibility filter.
- `ghost-race.ts`: ghost codecs and RPCs. `ghost-launch.ts` owns request context and retained own-best selection; `ghost-offer.tsx` and `ghost-result.tsx` own send/retry state and actual controls.
- `inbox.ts`, `inbox-view.tsx`, `race-result.ts`: the scoped inbox controller, React inbox and toast, and race results.
- `friends-board.ts`, `friends-board-view.tsx`: sharing state, scoped board requests and React board controls.
- `egg.ts`: ↑↑↓↓←→←→ b a.
- `styles.css`, `fonts/`: theme tokens, then layout; the self-hosted fonts.

Elsewhere:

- `index.html`, `src/sw.ts`, `manifest.webmanifest`, `icons/`: document shell, offline worker and install files.
- `server.mjs`: the local server. It serves only files in the generated build inventory.
- `ml/`: the Python that fits the starting view on the public dataset (`extract.py`, `fit.py`, `trees.py`, `views.py`, `ship.py`), pinned with `uv`. Nothing in it ships or runs in the app: it writes `src/learner-start.ts`.
- `scripts/`: `build-static.mjs` (the build), `build-book-texts.mjs`, `measure-latency.mjs`, `measure-profile.mjs`, `measure-fixed-floor.mjs` (how often Train reads "fixed" with and without a per-run floor, on simulated seasons; `docs/verification/2026-11-12-fixed-floor.md`) and `evaluate-learner.mjs` (`bun run evaluate:learner`: the policies on simulated typists, and ADR 0013's rule v2 that picks the default; `-- --rule 0015` for ADR 0015's; `-- --rule 0019` for ADR 0019's, which runs `evaluate-let-go.mjs` on worker threads; or a stored profile), `keystrokes-to-runs.mjs` (`bun run keystrokes:runs`: the public 136M Keystrokes dataset as the app's run records, through the app's own replay) and `evaluate-start.mjs` (`bun run evaluate:start`: learner versions on those real participants, ADR 0026's rule with `-- --judge`, and its simulator and cost guards with `-- --guard`).
- `tests/`: Node unit tests. `e2e/`: Playwright specs with a fake Supabase (`e2e/fake-supabase.js`).
- `supabase/`: migrations, Edge Functions and SQL tests.
- `tools/oxlint/anti-slop/`: the vendored lint plugin.
- `.claude/skills/verify-stilltype/`: a script that drives the app in headless Chromium for screenshots.
- `design/`: historical design references, not served ([ADR 0002](adr/0002-afterimage-design-system.md)).
- `docs/`: this file, conventions, ADRs, the UI contract, online races, specs, research and verification records.

## Data

- **Guest.** Everything lives in memory for the tab.
- **Signed in, on the device.** `localStorage` holds the profile cache (`storedCopy`), including keystroke recordings. IndexedDB holds the background image and its look.
- **Signed in, in Supabase.** `public.profiles` holds one row per user: the profile without its recordings (`rowCopy`, [ADR 0006](adr/0006-recordings-stay-on-the-device.md)). Tabs and devices merge their copies ([ADR 0005](adr/0005-sync-merges-copies.md)). The row is sent whole on each push (TOB-219).
- **Races and friends.** These live in the private `race_private` schema (`rooms`, `players`, `friends`, `head_to_head`, `challenges`, `board_members`, `board_sharing`, `match_queue`, `ratings`, `rated_results`). They are reached only through the `public.race_action`, `public.challenge_action`, `public.friends_board`, `public.quick_match` and `public.race_people` RPCs. `race_people` only reads: it ties the caller's open invitations and ghost challenges to their own friend rows saved from a race, and returns each such friend's tally.
- **Other tables.** `public.feature_suggestions` holds anonymous suggestions. `public.theme_generations` holds the daily generation quota (`claim_theme_generation`).
- Every foreign key to `auth.users` cascades ([ADR 0008](adr/0008-account-deletion-cascades.md)).
- `PRODUCT.md` sets the retention limits.

## External services

- **Cloudflare Workers** for hosting (`wrangler.jsonc`).
- **Supabase** project `bicbyljexprkaedakofa` for auth (email and Google), Postgres and Edge Functions.
- **Anthropic API** (Claude Haiku 5.5), called only from the `generate-theme` Edge Function, with the `ANTHROPIC_API_KEY` secret.
- **GitHub Actions** on GitHub's hosted runners, for CI and deploys ([ADR 0018](adr/0018-ci-on-hosted-runners.md)).
