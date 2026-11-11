# Architecture

## Overview

Stilltype is a static web app: native HTML, CSS and JavaScript modules with no runtime dependencies and no bundler ([ADR 0001](adr/0001-native-browser-stack-and-learning-loop.md)).

- **Client.** `index.html` holds all markup, and `src/` holds the modules. `sw.js` is the network-first offline shell.
- **Hosting.** The Cloudflare Worker `stilltype` serves `dist/`, a copy of the served files made by `scripts/build-static.mjs` (`wrangler.jsonc`). Locally, `server.mjs` serves the checkout itself.
- **Backend.** Supabase handles auth, the profile row, online races, ghost challenges, the friends board, feature suggestions and theme-generation quotas. The client calls it over `fetch` (REST and RPC), with no SDK. Guests save nothing beyond the tab.
- **Edge Functions.** `supabase/functions/delete-account` deletes an account. `supabase/functions/generate-theme` asks Claude Haiku for a theme. Each keeps its logic in `handler.ts`, which Node tests, and its Deno wiring in `index.ts`.

## What the app does, by screen

- **Practice.** Time, words (presets or custom) and quote, with punctuation, numbers and four word lists. Time and words text is generated like Monkeytype's English (`drawnPassage` in `src/typing.js`): no word equals either of the two before it, punctuation is sentence-aware at Monkeytype's rates, and 1 word in 10 is a number. Adaptive mode (time and words) leans the text toward the learner's top few units, weighted by the time each loses. Its runs are drill-kind, so never a best, trend point or baseline.
- **More.** Code (js, python, go, rust), a standard 60 s test, book pages, compose, custom text, and a 1–8 letter manual drill.
- **Learn to type.** 14 lessons. Only physical-keyboard runs unlock the next one.
- **Results.** Shown on Practice in place of the passage (`body[data-view=results]`). One run card (Paper "Stilltype · Results card", V10): wpm; accuracy, time and consistency; average and best at these conditions; the speed trace; the typed words; practice missed words. Then Run again, Drill "pair" and Watch replay, beside the conditions line.
- **Train** (the path, TOB-420). One line of steps: the targets you have drilled behind you, the one to drill now, and the next three the learner queues, built by `trainPath` (`src/train-path.js`) as a pure function of runs, loops and the recommendation. The learner (`src/learner.js`, [ADR 0013](adr/0013-learning-core.md)) ranks letter pairs and keys by the time each loses, from misses and slowness, over every measured run on this keyboard, older runs fading. The open step is the highest-ranked unit whose observed counts, or for a slow pair its observed timing past 20 ms, can be stated, else a general drill. Either way the drill's text leans toward the top units. Its evidence line, missed words and "since you drilled it" line all read those runs. Its button runs a drill of the chosen length, then a fresh retest at the current settings; the comparison then becomes the newest step behind you and the next queued unit opens. A step ahead can be chosen to drill it. A step behind you is "drilled" after its retest and "fixed" only when the learner no longer queues it and two or more runs since its drill hold 20 observations of the kind it was drilled for, with no first-try miss among them or a mean slowdown of 20 ms or less. Three practice settings shape it, saved and synced as preferences and never test conditions: the train focus (balanced, the evaluated policy; accuracy, ranked by misses only; speed, by slowness only), the drill length (15, 30, 60 or 120 s) and the retest after the drill (off: the drill ends on its own result, nothing is compared and no loop is saved). The counting rule it replaced stays as the labelled baseline policy. Its Back to practice opens the retest's run card. "Patterns across runs" in Progress's keys view lists the same queue, and "words you keep missing" is a palette command.
- **Progress** (what changed, TOB-420). The overview is one value built by `weekChange` (`src/week-change.js`) from runs, loops, practice days, the chosen condition key, the train focus and `now`: the lead (this week's median speed against the week before's, each from at least three runs, at one condition key), what moved it (the pairs and keys whose state changed since the week began, fixed by Train's own rule, or slipping, which is missed more since than before by more than chance explains across every unit read and by more than the week as a whole, ranked by the learner's change in gain, and the practice row), and two small charts over the period. The conditions line under the lead is the control that picks the key. Runs and drills, the full speed, accuracy and consistency charts, keys (heat map, pairs, Patterns across runs), the practice calendar with the daily goal and streaks and runs started, the standard score and composing each open in a detail view one step away.
- **Challenge.** Quick match against another waiting player near your race rating, on the standard setup (30 seconds of the 200 words), with a race rating that only quick matches move ([ADR 0014](adr/0014-quick-match-and-race-rating.md)) and, from 10 rated races, a named rank read from it ([ADR 0016](adr/0016-race-rank.md)). With nobody waiting, it offers your own best recorded run as a ghost race. Online races, by invite, guest link or friends. A race uses the host's practice setup (time, words or quote, length, punctuation, numbers, word set), or what Customize sets for that race. Practice-only setups fall back to a medium quote on 60 s. Also Daily, the friends board and one keyboard. A finished online race shows both results side by side, with the pair's lasting tally (accounts only), a Rematch pick under each result (when both pick, the next race starts on its own), and a Graph / Replay of both racers drawn from their keystroke traces. See `docs/online-races.md`.
- **Ghost races.** A friend races your recorded run within seven days.
- **Inbox and toast.** Invitations and challenges.
- **Settings and palette.** The settings dialog, and the ⌘K / Ctrl-K palette. Each palette group is listed once, in the order of its first command. Monkeytype import.
- **Rules.** Five correction policies, strict space, quick end, minimums, repeat quotes and the pace caret.
- **Display.** Ten themes in a mode (system, dark, light), with a dark and a light pick. Up to five custom themes, from the editor or generated from a short description (20 a day). A background image ([ADR 0010](adr/0010-background-image.md)). Text size, typing and app fonts, word highlight (optionally sliding), one-line tape, wpm or cpm, live metrics, an on-screen keyboard with five layouts and a finger map, focus mode and sounds.
- **Accounts.** Email or Google, sync, clear history with Undo, and account deletion.
- Offline shell, What's new, and anonymous feature suggestions.

`docs/ui-contract.md` describes each screen's behaviour in more detail.

## Code map

In `src/`:

- `app.js`: orchestration: screens, input, preferences, history, palette commands.
- `typing.js`: the engine: passages, replay, metrics, correction rules, `conditionKey`, and the metric versions.
- `corpus.js`, `words.js`: original quotes and drill words; the word lists.
- `code-snippets.js`: code mode's snippets.
- `books.js`, `book-texts.js`: pagination and place. The text is generated by `scripts/build-book-texts.mjs`.
- `lengths.js`: test lengths.
- `quote-filters.js`: quote and book dropdowns.
- `lessons.js`: the beginner path.
- `insights.js`: run summaries (with their timed corrections), retention, patterns, filters, the counting rule's recurring targets, daily text.
- `train-path.js`: Train's path: the steps behind you, open and ahead from the recommendation and the saved loops, the rule for "fixed", and each step's evidence copy.
- `learner.js`: the learning core: evidence from run summaries, per-unit miss rates pulled toward the person's pooled rate, per-pair slowdowns pulled toward none, decay, ranking by time lost, the one naming rule, the training focus, and the recommendation policies, the person's own miss cost among the named variants ([ADR 0013](adr/0013-learning-core.md), [ADR 0015](adr/0015-learner-2.md)).
- `run-counts.js`: runs started and finished.
- `week-change.js`: Progress's overview: the week against the week before, what moved it and the practice row, as one value. Train's `isFixed` decides "fixed" on both pages.
- `progress-view.js`: Progress charts, the overview's two small ones included.
- `graph.js`: the speed graph.
- `replay-view.js`: watch replay.
- `motion.js`: the caret, line scroll, pace and ghost carets, and the sliding word highlight. Presentational only.
- `tape.js`: one-line tape geometry.
- `word-highlight.js`: word highlight.
- `fonts.js`: typing and app font choices. `index.html` applies an account's fonts before first paint.
- `wallpaper.js`: the background image, its look, the dither mask and gradient wash, where its fade ends, the halo, and its settings rows.
- `units.js`: wpm and cpm display.
- `layouts.js`: layout legends and the finger map.
- `sound.js`: typing sounds.
- `keybindings.js`: shortcuts.
- `settings.js`: the settings dialog.
- `custom-themes.js`, `theme-editor.js`: custom themes (tokens, contrast, storage) and their editor.
- `palette.js`: the command palette.
- `monkeytype.js`: Monkeytype import.
- `compose.js`, `compose-view.js`, `compose-caret.js`: composing practice.
- `profile.js`: profile defaults and `normalizeProfile`.
- `account.js`: auth, the profile row, `mergeSynced`, `HISTORY`.
- `online-race.js`, `multiplayer.js`: online races and their RPCs. `quick-match.js`: quick match's standard setup, rating maths, the rank ladder, pairing gap, trace check and queue states, shared with the e2e fake. `quick-match-view.js`: the quick match control. `race-review.js`: a finished race's graph and two-caret replay. `race-options.js`: what a race is set up as, and its passage.
- `ghost-race.js`: ghost challenges.
- `inbox.js`, `race-result.js`: the inbox, toast and race results.
- `friends-board.js`: the friends board and sharing.
- `egg.js`: ↑↑↓↓←→←→ b a.
- `styles.css`, `fonts/`: theme tokens, then layout; the self-hosted fonts.

Elsewhere:

- `index.html`, `sw.js`, `manifest.webmanifest`, `icons/`: markup, offline shell and install files.
- `server.mjs`: the local server. It serves only what the build copies.
- `scripts/`: `build-static.mjs` (the build), `build-book-texts.mjs`, `measure-latency.mjs`, `measure-profile.mjs` and `evaluate-learner.mjs` (`npm run evaluate:learner`: the policies on simulated typists, and ADR 0013's rule v2 that picks the default; `-- --rule 0015` for ADR 0015's; or a stored profile).
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
- **Races and friends.** These live in the private `race_private` schema (`rooms`, `players`, `friends`, `head_to_head`, `challenges`, `board_members`, `board_sharing`, `match_queue`, `ratings`, `rated_results`). They are reached only through the `public.race_action`, `public.challenge_action`, `public.friends_board` and `public.quick_match` RPCs.
- **Other tables.** `public.feature_suggestions` holds anonymous suggestions. `public.theme_generations` holds the daily generation quota (`claim_theme_generation`).
- Every foreign key to `auth.users` cascades ([ADR 0008](adr/0008-account-deletion-cascades.md)).
- `PRODUCT.md` sets the retention limits.

## External services

- **Cloudflare Workers** for hosting (`wrangler.jsonc`).
- **Supabase** project `bicbyljexprkaedakofa` for auth (email and Google), Postgres and Edge Functions.
- **Anthropic API** (Claude Haiku 5.5), called only from the `generate-theme` Edge Function, with the `ANTHROPIC_API_KEY` secret.
- **GitHub Actions** on the self-hosted runner on tobygdesktop, for CI and deploys ([ADR 0012](adr/0012-npm-node-and-the-desktop-runner.md)).
