# Session notes: feature sprint, 8 October 2026

These are flags and ideas collected while building the Tier 1–2 features from the feature-opportunities brief. Each feature is its own PR. The notes are grouped by the PR that surfaced them; "Cross-cutting" lists the items that matter most.

## Cross-cutting (read first)
1. **Merge order and conflicts.** PRs #18–#26 and later each touch `src/app.js`, `index.html` and `src/styles.css`, and so does the open PR #17. Merge the small ones first (caps lock #18, restart key #19, export #20). Then merge master into the rest and let CI re-run.
2. **The settings popover is full.** The restart key, pace caret, export, daily goal, error modes and break suggestions all add rows (about 490 px at 1280×800 already). It needs sections (Test · Behaviour · Display · Data) or a sheet before more settings land.
3. **Conditions strings.** `describeConditions` and `describeRun` in src/app.js are chained template strings, duplicated for drills and missed-words practice. A structured conditions builder would make numbers, custom text, code mode and error modes consistent.
4. **Guest preferences reset on reload (a product decision, not a bug).** `loadProfile` returns `emptyProfile()` when signed out, as PRODUCT.md requires (guests use defaults and nothing is saved beyond the tab). Several new settings (restart key, pace caret, daily goal) feel worse because of it. Changing this would mean revising the PRODUCT.md guest contract first.
5. **Results-page action hierarchy.** It can now show Start drill, Skip to retest, Run again, Practice words and Watch replay together. Keep one primary and make the rest quiet.
6. **Screenshot realism and best plausibility.** e2e types instantly, so screenshots and seeded bests show 400–3,800 wpm. Add a fixture that types at a set speed, and consider a plausibility ceiling before a run can become a personal best.
7. **Account deletion** needs a server side (see PR #20 notes) before the privacy page can promise it.

## By source

### From the caps-lock warning work (PR #18)
- The race and online typing fields (`#race-input`, `#online-input`) have no caps-lock warning; the same helpers in src/app.js could be reused there.
- `announce()` (src/app.js:159) overwrites `#announcement`; a caps-lock announcement landing at the same moment as the finish summary could cut it off. A tiny announcement queue would be safer.
- On mobile (≤760px) the right-aligned caps-lock label could crowd the measure row in drill/retest sessions that show a title + description. Check at 390px.
- `.gitignore` has `node_modules/` (directory only); a symlinked node_modules shows as untracked. Use `node_modules` without the slash.

### From the quick-restart work (PR #19)
- Where does focus land after a run finishes? If it lands on a results control, Tab moves focus and Enter clicks that control instead of restarting. Check finishPrimary/switchView focus handling (src/app.js ~771).
- Guest preferences don't survive a reload: loadProfile returns emptyProfile() when signed out (src/app.js:97). This follows PRODUCT.md's guest contract (nothing saved beyond the tab). Persisting guest preferences would be a deliberate product change, not a routine follow-up.
- The restart-hint row is aria-hidden (index.html:219), so screen-reader users never hear which key restarts. Put the chosen key in #input-help.
- Key naming is inconsistent: the restart button tooltip says "Escape" while the hint says "esc" (index.html:212 vs 220).

### From the data-export work (PR #20)
- Account deletion still needs a server side. A Supabase edge function should verify the caller's JWT, then call `auth.admin.deleteUser(uid)` as the one authoritative step. A SQL RPC can't call that admin method. The profile, room, player and friend rows already reference `auth.users` with `ON DELETE CASCADE`, so they go with the user. Don't delete data before the user. Only after deletion succeeds should the client sign out and clear local state (reusing clearHistory), so a failed call never leaves a live account with its data gone.
- `retainRuns` (src/insights.js:22) drops `patterns` beyond the newest 120 runs, so the JSON export carries little pattern data for older runs.
- CSV `kind` column uses internal values (test/retest/drill/race/daily); daily runs need a `challengeDate` column to be distinguishable.
- "Clear history" only appears on the Progress heading (index.html:308) while export lives in settings. A "Your data" section in settings should group export, clear history and (later) delete account.
- The settings popover is getting long (~490px at 1280×800 with export). It needs grouping/sections or tabs before more settings land (pace caret, restart key, daily goal, numbers…).

### From my own screenshot review
- Light theme, settings popover: the "off" toggle switches render a near-black knob on a grey track, which reads as "on" or as disabled rather than a quiet off state. Worth a contrast/affordance pass on the switch component.
- The restart hint only names the chosen key ("tab restart") even though Esc always works too; consider "tab / esc restart".
- The settings popover opens over the passage and covers half of it; with more settings coming it should become a sheet or a grouped panel.

### From the numbers-toggle work (PR #21)
- `describeConditions` (src/app.js:185) chains template strings; quote difficulty sits in the same slot as punctuation/plain. A structured conditions builder would be easier to extend (numbers, custom text, missed words, pace caret…).
- `punctuate()` in src/typing.js places capitals and full stops on a fixed 9-word cycle (`i % 9`), so punctuation mode is predictable. Use the seeded random source like numbers does. (Passage-generation change: version it with the corpus/text-generation version, not the metric version, since scoring and replay don't change.)
- Dark run card: the "Run again" secondary button's bright outline looks heavier than the filled green primary beside it. Design check.
- The mode bar now has four pill groups (index.html:147). A third toggle would need grouping the switches into one pill or moving them into settings.

### From the run-card stats work (PR #22)
- "Extra" characters are almost always 0: the engine is position-based and drops input past the end of the passage (src/typing.js replayAttempt `if (position >= attempt.text.length) break`), and letters typed past a word's end count as incorrect. Consider showing c/i/m instead of c/i/e/m, or add word-aware "extra" tracking in a future metric version.
- A 120s run's word history can hold about 200 words. It's capped at 4 lines and scrolls inside a sticky card. Put it behind a disclosure for long runs.
- The run card now has two metric-note paragraphs. Merge them into one, or into the conditions line.
- Mobile 390px: the fixed bottom dock covers the run card's last line (conditions) when scrolled to the end. results-screen needs more bottom padding.
- The "first-try errors" label wraps to two lines in the 3-column facts grid, so main-row labels sit at uneven heights.

### From the missed-words practice work (PR #23)
- A persistent "words you keep missing" list in Training was not built here. It should work for guests within the tab (in memory, like their runs) and persist only for signed-in users. #58, stacked on #23, builds it (see the #58 notes below).
- From a missed-words or drill result with no baseline there's no direct way back to normal practice except the dock nav (src/app.js ~1785, `run-again`).
- The run card is sticky (src/styles.css:1167, `top: 104px`). At 1280×800 it's taller than the viewport, so the conditions and actions sit below the fold. Shorten the graph or move conditions/actions up.
- The results page now has up to four nearby buttons (Start drill, Skip to retest, Run again, Practice words). It needs an action-hierarchy pass: one primary, the rest quiet.
- `describeRun` (src/app.js ~194) hand-builds drill and missed-words condition strings, duplicating `describeConditions`. A shared helper keeps the wording consistent (same point as the numbers note).

### From the pace-caret work (PR #25)
- Bug fixed in passing: `reset()` in src/motion.js:171 queued a frame that placed the ghost at the start even if the ghost had been switched off since, which could leave a stray ghost caret. It now checks again first.
- "Average" and "last run" pace use every valid run (including drills and dailies) for the same conditions. Consider limiting them to test/retest runs (`trendRun`).
- Under reduced motion the ghost never moves but the "pace N wpm" label still shows. Hide the label then, or add "(static)".
- The pace starts on the first keystroke, not on load. Say so in the setting's help text if people find it confusing.

### From the PWA/offline work (PR #26)
- The other e2e specs now run with service workers blocked (`serviceWorkers: 'block'` in playwright.config.js) so the Supabase `page.route` fake can't be bypassed. Only the PWA spec exercises the worker.
- The offline spec covers a guest only. A signed-in user reloading offline will hit failing Supabase refresh/sync requests; check account.js fails quietly there.
- `#f4f1eb` / `#0f0f0e` are hardcoded in `applyTheme` (src/app.js ~241) and in the manifest. Keep the CSS tokens at the top of src/styles.css as the only source: read the resolved values at runtime (e.g. `getComputedStyle`) and generate the manifest colours from the tokens at build time, rather than adding a JS constant.
- With `node server.mjs` (no build) the cache name stays `stilltype-shell-v1`, so local changes won't show until it's bumped. Builds stamp a content hash.
- No update notice: a new shell takes over on the next load silently. A quiet "Updated — reload" toast is a natural follow-up.
- vercel.json has no `Cache-Control: no-cache` for `/sw.js`. Browsers re-check it anyway, but the header is safer.
- New src modules, fonts or icons must be added to the sw.js precache list (tests/sw.test.js enforces this). The PNG icons have no regeneration script.

### Tooling / repo hygiene
- `.gitignore` has `node_modules/` (with a slash), which doesn't match a symlinked node_modules; four separate agents hit this. Change it to `node_modules`. (Done in the notes PR.)
- The impeccable skill isn't installed for cloud sessions (only the `.impeccable/` config is in the repo). Commit the skill under `.claude/skills/` so cloud agents can use it.
- The "Paper" redesign mockups live only on your laptop. Commit or export them under `design/paper/` as reference material, so a future session can build them as an opt-in proposal theme (like PR #24). They stay non-binding until PRODUCT.md and DESIGN.md adopt them; Afterimage remains the shipped system.
- Hosting check (22:45 UTC): PRs still deploy only to Vercel (Vercel status + Vercel Preview Comments check); there's no Cloudflare config or check. Production `typingsite-toby-godats-projects.vercel.app` is behind Vercel Deployment Protection. `typingsite.vercel.app` is someone else's site. If a custom domain is behind Cloudflare DNS, that couldn't be verified from the sandbox.
- Many open PRs (#18–#26+) each touch src/app.js, index.html and src/styles.css, as does #17. Expect merge conflicts; merge small ones first (caps lock, restart key, export), then re-run CI on the rest.
- The Codex review bot hit its usage limit during this session, so later rounds used independent multi-agent reviews instead (three rounds on #51). #58 and #59 had no Codex review; their fixes came from independent reviews (248906e and 28b8a83 on #58, 174eab3 and 9975de0 on #59).

### From reviewing the PR screenshots
- Run card (PR #22): c/i/e/m reads 51/0/0/0 while first-try errors reads 1 and the word history marks "day" as mistyped. "incorrect" counts the final state, so a corrected mistake disappears from it. Side by side, the two numbers look contradictory. Keep c/i/e/m a partition of the final character state, and keep first-try errors as separate first-attempt evidence (the metric contract). The fix is the label: call it "left incorrect", or drop the field. Don't redefine "incorrect" as first-try errors, which would count a corrected letter twice.
- Several e2e screenshots show impossible speeds (420–2,758 wpm over 0.2–1.5 s) because specs type with no delay. Screenshot helpers should type with a realistic delay (~70 ms/key) so the PR images look like real runs.
- When the results page scrolls, page headings slide under the floating dock and show around it ("First run at these settings" sits clipped behind the dock). Consider a scrim behind the dock, hiding it on scroll-down, or more top padding.
- The theme mocks (PR #24) started as colour/font swaps on the same layout; layout variations were requested afterwards. Review whether each direction is distinct enough.

### From the daily goal / streak work (PR #27)
- e2e can't seed historical runs for guests (the profile is in memory only), so the calendar screenshot shows a single day. A test-only profile seeding hook (e.g. behind a `?e2e` flag served only by the e2e server) would allow realistic visual checks of Progress, streaks and heatmaps.
- "Today" rounds to whole minutes, so short sessions show "0 / 5 min". Consider "<1 min".
- The goal block only appears once a dated run exists. A user who sets a goal before any run sees nothing on Progress; show "Today 0 / 10 min" right after a goal is set.
- Adds a new `--radius-cell` token for calendar squares.

### From the custom-text work (PR #28)
- In custom mode, the word-list setting in the settings popover stays enabled but has no effect (src/app.js `setModeControls`). Grey it out as quote mode does.
- The palette can still mark "quote" as current during a custom run, because the check only reads the saved mode (src/app.js `shape` in `paletteCommands`).
- No "practise this text again" action on custom results, and the retest/drill copy (src/app.js ~861) doesn't mention custom runs.
- The mode-bar selection pill slides for 0.4 s, longer than Afterimage's ≤200 ms chrome-fade rule allows. Fix the transition to use the duration token (scaling to zero under reduced motion) rather than making screenshot specs wait.
- Custom-text cleanup lives in src/app.js with no unit test. Move it to a pure module with tests if it grows (book mode, EPUB import).

### From the watch-replay work (PR #30)
- "Watch replay" shows even for interrupted runs or runs with no events, and then does nothing (`replay-view.js` `open()` returns early). Hide or disable it in those cases. (Follow-up fix candidate.)
- The button sits in the recommendation actions next to `#run-again`, not on the run card; the card has no action slot. Decide where post-run actions live (ties into the action-hierarchy note).
- The replay text is a fixed `--text-lead` size and ignores the passage font-size preference (`body[data-font-size]`).
- The replay dialog has no screen-reader text: the passage is aria-hidden, so only the clock is read. Add a summary ("Replaying: 3 corrections, 1 hesitation…").
- Only tested with "continue on error" runs. Stop-on-error and relaxed (daily) correction policies aren't covered.
- The replay's `stateAt(attempt, t)` (src/typing.js) is the building block for asynchronous ghost challenges (brief #8) and "Race your best". The ghost caret can be driven from a recorded attempt with the same function.

### From the key-heatmap work (PR #31)
- Verified separately: full `e2e/depth.spec.js` plus `e2e/key-heatmap.spec.js` pass 10/10 on the branch (the agent's first run had a 320px overflow it then fixed).
- Patterns only record a–z pairs (src/typing.js:228), so letters mostly typed at word starts (t in "the", q, j, b…) show "not enough samples" even after many keystrokes. Count single-key first attempts directly in `summarizePatterns` (needs a pattern version bump).
- Per-key median interval can't be rebuilt from stored per-pair medians. Store per-key timing in `runRecord` (src/insights.js:18) if wanted.
- "Slow runs" needs ≥10 timed intervals of a pair within one run, which is rare, so the column is mostly "0 of N". Pool slowdowns across runs instead.
- Heat thresholds (>0, ≥4%, ≥8%) are arbitrary constants in `renderKeys` and there's no legend. Add a one-line legend.
- New raw sizes (row offsets 20/40px, 14/28px, 34px mobile key) should become key-size tokens.
- QWERTY only; a layout setting (brief #18) would change this and the on-screen keyboard together.

### From the error-modes work (PR #32)
- src/online-race.js:479 decides blocking with `!== 'relaxed'`. Any new policy would block like stop-on-error there. Switch it to `blocksOnError` from src/typing.js.
- Local challenge races hard-code `correctionPolicy: 'relaxed'` (src/app.js:1205). Fail policies are ignored there, and no-backspace is enforced.
- A failure on the very last character isn't reported, because completion is checked before the fail check. Rare edge case.
- The failed run card still offers "Start drill" / "Skip to retest" as interrupted runs do. Failed runs want a "try again" focus.
- The new 180px correction select (src/styles.css:386) hasn't been checked at 390px.

### From the code-mode work (PR #33)
- src/typing.js rejects `\r`/`\n` in passages (`printable`, ~line 127), so code snippets are joined into one line and lose their shape. Real line-break/Enter support in the engine would let code mode keep indentation-free lines (needs a metric/event version bump).
- `recurringTargets` (src/insights.js:55) can use code runs as evidence within their own condition key. That's fine. Pattern pairs are filtered to `^[a-z]{2}$` (src/typing.js:229), so a symbol pair can never become a target, and `conditionKey` keeps code evidence apart from ordinary practice. No exclusion is needed. (An earlier version of this note suggested one.)
- No palette entries for code mode or its languages yet.
- Required fix: the language buttons reuse `#duration-options` and so render in Geist Mono, but language names are readable text and must be Literata (being fixed on PR #33).
- In quote and code modes the punctuation switch is shown greyed out. Hiding it would read better.

### From the break-notice work (PR #34)
- Personal bests accept physically impossible runs (e.g. thousands of wpm from instant e2e typing, or paste/automation). Every later run then shows "−2191 vs your best". Consider a plausibility ceiling (e.g. >300 wpm or <30 ms median interval → not eligible for best, labelled).
- The notice line has the same size and spacing as the condition copy above it. Give it a rule or more space ("rules and space, not boxes").
- No palette command for "break suggestions" yet.
- At 1280×800 (light), the bottom of the floating dock overlaps the top-right of the run card. Same family as the scrolled-heading note.

### Fix pushed by me after review
- PR #30: "Watch replay" is now hidden when a run recorded no events (it previously opened nothing). Unit tests 33/33; watch-replay, typing and learning-loop e2e 16/16.

### From the review-fix round (Codex findings)
- The palette's "restart test" command still double-resets (`navigate('practice')` then `resetSession`), marking an unseen passage as seen and consuming fresh quotes. The same bug was fixed for the quick-restart key in PR #19; the palette path predates it.
- Screenshots no longer overwrite `docs/screenshots/**` on every e2e run: each spec now writes there only with `SCREENSHOTS=1` (otherwise to Playwright's output dir). Use `SCREENSHOTS=1 npx playwright test <spec>` to regenerate PR images.
- PR #18: the Caps Lock warning moved to Literata at `--text-small` (15px). 12px is a mono label size.
- PR #34 screenshots: the settings popover covers the run-card headline in the "after don't show this" shot.

### From the later review rounds
- **Accessibility floor (on master today):** the shipped light theme's input placeholder measures 3.56:1, because `--muted` `#6b665e` is drawn at 0.8 opacity over `#fbf9f5`. That's below WCAG AA's 4.5:1 for text. PRODUCT.md and DESIGN.md don't state a numeric floor yet; the `light-contrast` PR adds one to DESIGN.md. Drawing it at full opacity in the light theme gives 5.42:1. PR #24 introduces a `--placeholder-opacity` token that makes this a one-line change. Dark passes at 4.61:1.
- PR #19: Tab as the restart key now restarts only from the typing field or when nothing is focused. On "Run again" and every other control, Tab moves focus, and Enter on "Run again" is the quick restart after a run. An earlier version restarted on Tab from "Run again", which trapped forward keyboard navigation on the results screen. Codex also showed that `runActive` is presentational: clicking the active Practice tab clears it mid-run. Guards should read `attempt.status`.
- PR #28: pasted text can carry invisible Unicode format controls (soft hyphen, LRM, bidi isolates, ZWSP) that become untypable targets. Strip `\p{Cf}` wherever outside text enters the engine. The same applies to book mode and composing.
- PR #32: a timer expiring mid-word skipped the fail-on-word check. Every completion path (timer, passage end, race end) needs the same failure gate. One `completeAttempt()` choke point would prevent this whole class of bug.
- PR #34: in-memory session state (the sitting's runs) must be cleared and restored by Clear/Undo like stored history. The same applies to any future in-tab evidence.

### From the overnight review rounds (8–9 October)
- **Touch targets (on master today):** DESIGN.md says "Coarse pointers keep a 44px minimum target", but `.footer-link` is about 32px tall under a coarse pointer and several inline buttons fall outside the `(pointer: coarse)` rule. e2e/layout.spec.js checks only four selectors. The `touch-targets` PR adds a generic sweep test and fixes each gap with the `padding-block` plus negative `margin-block` pattern, so text doesn't shift. The same PR fixes the 320px run-card overflow for three-digit scores that layout.spec.js described as a known defect.
- **Light-theme contrast (on master today):** the PR #24 audit found placeholder 3.56:1, accent on ground 4.48:1 (4.18:1 on the selected palette row), a mistyped letter on its tint 4.17:1 and the ghost caret 2.93:1. The `light-contrast` PR adjusts token values only and adds a unit test that parses the tokens and checks the pairs. These are accessibility failures, so merge it as a fix. It only nudges token values within each hue. Review the new values, since they change shipped colours, but don't treat it as optional.
- **Dialogs and global keys (PR #30):** the global keydown guard listed dialogs one by one, so a new dialog was missed and focus mode swallowed Escape. #30 changes it to `document.querySelector('dialog[open]')`. Any dialog added before #30 merges must still be added to the old list.
- **Results actions read the mutable `attempt` (PR #30):** when `showUnavailableRetest()` returns to the baseline results, `attempt` still holds the hidden drill. #30 adds one `shownResult` record, set only by `showResult()`. #22 (typed-words list), #23 (Practice words) and #19 (Enter from results) should read it too once #30 lands.
- **Font-changing themes (PR #24):** a theme that swaps fonts has to re-measure the carets and the gliding pills after the fonts load. #24 routes every theme change through `applyTheme()` and then `remeasureWhenFontsLoad()`. Any future font preference needs the same path.
- **Retention budgets (PR #28):** `retainRuns` counted every summary toward the 1,000-summary and 120-pattern windows, so many custom runs could evict practice history. #28 exports `NON_COMPARABLE_KINDS` and `comparableKind()`, and gives those kinds their own newest-50 cap. **Merge rule:** when #23 lands, add `missed` to that set. Its records carry no patterns and would otherwise push real evidence out of the 120-run window.
- **Short passages (PR #28):** custom text needs at least 2 words and 10 characters. A run that finishes inside the one-second `RATE_FLOOR_MS` shows "—" instead of a WPM. Trade-off for you: above about 110 wpm, a 10-character text finishes inside a second. A 20-character minimum avoids that but refuses "hello world". The results card on master has no WPM floor at all; only the live readout waits a second.
- **Session-scoped chrome (PR #28):** during a custom session, the footer best, the palette's "current" marks and restart all used to describe the practice settings underneath. They now follow the session on screen. Any new session kind (book mode, composing) needs the same check.
- **Palette ranking (on master today):** every word-list command shares the same keywords, so typing a list's full label still highlights "top 200". An exact or prefix label match should rank first.

### From the round-2 settings PRs (#35–#43)
- **Speed graph width (on master today):** the 320px overflow that layout.spec.js called a known defect was the speed-graph SVG, not the score. `src/graph.js` draws at `Math.round(container.clientWidth)`, so the previous SVG's width fed the next measurement and the graph never shrank. #36 caps it with CSS `max-width`. Measuring `Math.floor(getBoundingClientRect().width)` would fix it at the source. #36 also fixes taps landing on the wrong point in dense Progress charts (14 or more runs at 390px).
- **Coverage gaps:** the touch-target sweep doesn't reach the online guest-join, stage and results views, which need a second browser context. Only Chromium is tested. The ellipse `rx`/`ry` CSS properties need Firefox and WebKit checks once those projects exist.
- **Retention (#39 and #28):** #39 adds a 2.5M-character budget for full traces to `retainTraces` in `src/insights.js`. #28 changes `retainRuns` in the same file to partition summaries by kind. **Merge rule:** keep both, because the trace budget applies to full traces and the partition applies to summaries. #39 changes passage generation only for timed runs longer than 320 s, at 5 words a second. Preset condition keys stay byte-identical.
- **One end-of-run decision (#37, #32, #42):** #37 adds `runPosition`, `atRunEnd` and `minimumStop` so every completion path makes the same end-of-run decision. #32's fail-on-word and fail-on-any gates live separately in `finishPrimary` and `finishRacePlayer`. #42 adds `refusesSpace`, `quickEndApplies`, `awaitingSubmit` and `inputRules`, and changes `passageComplete`. **Merge rules:**
  - #37's `atRunEnd` must use #42's quick-end-aware `passageComplete`.
  - Route #32's failure checks through the same choke point.
  - #32's fail-on-word must treat a space that strict space refuses as a wrong key.
  - Decide whether quick end applies under no-backspace, and whether fail-on-word fires on a held last word.
- **Speed unit (#40):** it touches about 20 files and conflicts broadly, so merge it late. It also makes online-race results always store their text in wpm, whatever the display unit.
- **Repeat quotes (#43):** `trendRun` now requires fresh text, and bests are recomputed through `freshBests`. A best that master set from its exhausted-pool fallback (repeated text) is replaced by the best fresh run. The gate itself is required by PRODUCT.md; only the treatment of existing repeated-text bests needs your sign-off (handoff decision 5). **Merge rule:** #28's `NON_COMPARABLE_KINDS` excludes runs by kind; #43's freshness gate excludes them by text. Keep both, and have `trendRun` check both.
- **Double reset (#43):** `resetSession` now records seen ids through `recordSeenOnDisplay` in a microtask, so a second reset in the same task replaces what gets recorded and doesn't consume a quote. This covers the palette's "restart test" and "word list" commands and master's restart from the result card. Master's palette `navigate('practice')` + `resetSession` line is left alone so #19 can swap in `restartTest()` without a conflict.
- **View jumps (#42):** rule toggles no longer move you off Progress or the challenge screen; master's `resetSession` always switches view. Other settings that reset (word list, #21 numbers, #32 error modes) probably jump the same way. Check when merging.
- **Conditions builder (#42):** `sessionConditions(kind)` and `ruleLimits(ruleSession())` are the start of cross-cutting item 3. The handoff's merge rules list the session kinds to route through them.

### From the round-2 feature PRs (#44–#59)
The handoff carries the migrations, the bugs found on master, the merge rules and the decisions for these PRs. These are the remaining flags, ideas and follow-ups.

**#44 standard test**
- **Dead-key `"`:** on layouts where `"` is a dead key (for example US-International), the browser fires composition, the app treats it as IME input and marks the run interrupted. Those typists can't complete a standard run; quote mode has the same problem on its 7 quotes that contain `"`. Fix it in the shared input layer: accept a dead-key composition that resolves to one printable character. `docs/ui-contract.md` records the limitation.
- **Locked settings:** in standard mode, lock #32's `#correction-select` and its palette commands, and #21's numbers toggle, in `syncLockedSettings` and `fixedText` (`src/app.js`), as stop on error is. Standard stays `correctionPolicy: 'mandatory'`.
- Locked commands disappear from the palette in standard and quote mode, because `src/palette.js` filters out disabled commands. Showing them with a "fixed" hint would explain the lock.
- `tests/typing.test.js` pins the text id of `standardPassage(1)`. When it fails after a generator or word-list change, bump `STANDARD_VERSION` or `CORPUS_VERSION`.
- The Progress headline shows the input class with more completed standard runs (physical keyboard on a tie). The other class is reachable through the Test conditions filter; someone who uses both may want a switch.
- **Sticky run card (on master today):** the `@media (max-height: 720px)` block un-sticks the run card, but the card is about 645–663px tall at `top: 104px`. At viewport heights from 721px to about 767px its foot (the conditions line) is clipped while stuck; #47 found the same. Raise the breakpoint to about 800px, or cap the card with `max-height: calc(100svh - 104px)`. Related: the #23 sticky-card note above.
- **Copy (on master today):** `renderHistory` says "This week: 1 matching runs." Reuse #44's `plural()` helper.

**#45 tape mode**
- Restart, resize and settings re-layouts now jump the passage into place in both layouts. On master a restart slid the new passage in over 150 ms.
- Tape is a display preference, not a condition. One line gives less lookahead (1–2 words at 320px with large text), so it could affect wpm. Making it a condition later needs the default condition key to stay byte-identical.
- Races keep three lines.
- `TAPE_LEAD`, `TAPE_REACH` and `TAPE_BACK` in `src/tape.js` need a feel check on a real keyboard.
- The `.app-shell` workaround, `contain: inline-size`, needs Safari 15.4+ or Firefox 101+.

**#46 keyboard layouts**
- The layout is never restored from a baseline. A baseline on another layout refuses a retest, and its drills run on their own (`layoutMismatch` in `startDrill` and `startRetest`).
- Online races carry no layout; the one-keyboard race uses the host's. Touch runs reset `conditions.layout` to the default, so they keep master's condition key.
- The finger map's cue is a mono finger initial on each key, generated in CSS with `content: x / ""` (Chrome 77+, Firefox 128+, Safari 17.4+). One `--finger-band` token shades alternate fingers.
- `#layout-select` is 128px wide while the other settings selects are 104px, so their left edges don't line up. Widen them all in a follow-up.
- The palette "word list" command calls `navigate('practice')` and then `setWordList`, which can reset twice and mark an unseen quote as seen; #50 found the same. #43's microtask fix covers it (see the #35–#43 section). The layout and book commands reset once.
- The keyboard and finger-map palette commands still appear on phones, where the keyboard is hidden.
- `#keyboard` has an `aria-label` on a div with no role (`index.html:221`), so screen readers don't announce it reliably. Use `role="img"` with a label naming the layout and finger map, or `aria-hidden` plus a text summary.
- The keydown highlight uses `event.key.toLowerCase()`, so it lights the key that carries the produced character, not the physical key. They match when the legend matches the OS layout.
- Idea: a home-row-only finger label mode, or showing the finger for the current target pair in drills. Both use the existing `keyboardRows()` data.
- Merge risk: `e2e/chrome.spec.js` now expects 31 keys, not 27, and the ≤760px block in `src/styles.css` hides `label[for=keyboard-toggle]`.

**#47 race your best**
- A ghost race keeps only its run summary, no trace, so racing repeatedly can't push the best's own trace out of the 24 kept.
- A race on a different input class from the best reads "Race complete · not compared".
- After a race, Train's Start drill and Skip to retest stay on `baselineAttempt`'s conditions. Without a baseline the drill runs on its own at the race's conditions.
- The palette now passes the activating event to every command (`command.run(event)`). Wrap any command that takes optional parameters in an arrow function, or it receives the event. #19's `run: restartTest` takes none, so it's safe.
- **#47 + #25:** expect a text conflict in `src/motion.js` (`ghost.arm` against `run()` and `follow()`). Both fix the same `reset()` bug that re-showed a disarmed ghost; keep one fix. #47's reduced-motion listener restarts the ghost from its recorded start, which fits #25's join-in-progress path.
- **Input class (master-wide fix):** classify every session from the activating event of whatever started it (`startedBy`), or from `(pointer: coarse)` when no hardware-keyboard events arrive.
- **Exhausted quotes (on master today):** a practice run on an exhausted quote filter (`fresh: false`) can still become a best and pattern evidence, against PRODUCT.md's rule that seen text is never fresh evidence. #43 fixes this: it gates bests, trends and pattern evidence on fresh text.
- Ideas: after a race, draw the best's speed series as a muted dotted second line on the run-card graph (`speedSeries` in `src/graph.js` works on any trace). Offer "race this run" from any Progress row whose trace is still kept.

**#48 composing practice**
- Active time counts each gap over 2 s as the average of the shorter gaps instead of dropping it, which overstated bursty writers. Active time can't exceed elapsed time.
- The backspace rate counts every auto-repeat of a held Backspace or Delete.
- While composing, a `resetSession('practice')` from settings, sync, the dock or the ghost toggle waits and keeps you in compose, so no hidden quote is marked seen. Mode buttons, palette test shapes, Run again, drills, retests and the daily end composing.
- **Input rules:** only single-character inserts, line breaks and Backspace or Delete at a collapsed caret count. Cut, line deletes, autocorrect replacements and any key over a selection are refused with a notice; IME composition goes through, marked "not measured". On a phone with predictive text every suggested word is refused, so touch composing works only key by key. Check on a real phone before calling it touch-ready.
- Window blur marks composing interrupted, as it does copy tests. Free writers often tab away to think, so this may feel strict; it's a product call.
- The writing field uses the native caret held solid with `caret-animation: manual` (Chromium 139+). Other browsers still blink it, and DESIGN.md says so.
- To count composing toward #27's goal, read `profile.compositions[].activeMs`.
- The mode group's label changed from "Test mode" to "Practice mode".
- At 1280×800 the result just fits at the medium text size; the large size needs a small scroll.
- Follow-up: the Progress composing list shows the newest 10 of up to 100, with no way to expand it.
- `COMPOSE_VERSION` stays `stilltype-compose-v1` although the active-time rule changed, because v1 has never shipped.
- Tooling: full-page screenshots on mobile draw fixed elements at the scroll offset, so #48's mobile shot is a viewport shot.

**#49 beginner path**
- Lesson runs aren't in `profile.runs`, and `profile.lessons` keeps tries, the last run and the passing run, not elapsed time. To count lessons as practice time, store a per-day time log in `recordLessonRun` (`src/lessons.js`).
- A lesson takes its input class from the tap or click that starts it (`startedBy`, `src/app.js:1329`). After that, any touch while it is prepared or running makes it touch input, wherever the tap lands (one capture listener, `src/app.js:2132`, 0466c96). Restarts keep the class. This replaced the per-path wiring on `#restart-button` and the palette ghost command. The touchscreen-laptop cost is in the handoff's trade-offs.
- When sync adopts an account profile with less lesson progress (history cleared on another device), a waiting lesson it locks is replaced, and one being typed finishes as "not counted" (`adoptProfile`, `src/app.js:1809-1822`, 0466c96).
- Clear history also clears lesson progress (Undo restores it), and the dialog says so. Reviewers may prefer to keep lesson progress separate.
- Layout: the largest text size overflows by about 10px at 1280×721, and a viewport about 650px tall cuts off the thumbs row.
- The finger map lays keys out in straight columns, one finger per column, not staggered. A staggered `FINGER_ROWS` would look closer to a real keyboard.
- The 10k word list has informal words such as "biz" (`src/words.js:363` and `:743`), and the z lesson can pick them.
- The full-accent target edge is 4.48:1 in light now and 5.24:1 after #35.

**#50 book mode**
- The proxy blocked curl to gutenberg.org, so the text came from the same gutenberg.org URLs through a scraping tool. To check it, re-fetch and run `node scripts/build-book-texts.mjs <dir>`; the output is byte-identical for the same inputs.
- Book runs stay out of pattern evidence, keep no trace and take no pattern slot, but they count toward the 1,000-summary cap. A full pass of all four books is 288 pages; exempt them if that matters.
- Edge case: after a non-book run with no baseline, switching to book mode and starting a manual drill from Train uses book conditions (`prefs.mode` stays `book`). A full fix needs a "last practice condition".
- Clearing history resets `profile.books`. A book page already on screen isn't re-rendered, so finishing it sets the place to that page + 1.
- At ≤760px book sessions hide `#session-title` and `#condition-line` visually; assistive technology still reads them.
- Follow-up: a chapter jump. Sherlock's two parts are 135 pages, and today you can only go forward, retry a page or restart a finished book.

**#51 friends board**
- Privacy: rows show only to mutual friends, so adding an email never reveals whether it has an account. For one-way visibility, drop the `exists()` clause in the `mutual` CTE; the one-way section of `supabase/tests/friends-board.sql` then fails by design.
- Rows store no display name; each reader sees their own name for that friend.
- The board shows each person's best daily attempt and the attempt count, as the Daily panel does. "First attempt only" would be stricter.
- Sharing is opt-in and off by default, including for friend pairs that existed before the migration (PRODUCT.md leaves participation terms for shared data undecided). A "share on friends board" switch on the board and a palette command turn it on. Until then nothing is published, and the board shows no rows, yours or friends', with one line saying so. Friends who don't share never appear.
- Turning sharing on before the account check waits for the check and then sends the checked summary. Turning it off before the check goes out at once (f3caecd).
- Retention: only today's daily and this week's practice are kept, and each new day or week replaces the last. Turning sharing off leaves a marker row with no numbers. Deleting the account removes the row (`on delete cascade`). The board says so on screen, and says that each browser reports its own numbers, so they aren't verified (`index.html:496`).
- Stale devices: the row keeps the latest history clear on any device (`clear_id`, `clear_from`), the clear before it (`undo_id`, `undo_from`), the clear the last undo took back (`undone_id`) and the last 20 clears applied (`seen_clears`). A share or publish that names another clear than the stored one is refused; the browser adopts the clear and resends only runs since it. Publishes against an opt-out marker are refused the same way, so a stale device can't revive the row.
- Clear times: a clear sends its id, when it happened and when it was sent, both by the device's clock. The service lays that gap back from its own clock at arrival, never later than now (`supabase/migrations/20261009120000_friends_board.sql:188`). A clear counts its own runs on the device's clock. Every other summary counts runs from the stored clear on the service's clock, using the offset from the latest reply. A wrong device clock doesn't matter; network delay does (handoff trade-offs).
- Clear order: a clear takes effect only if it happened after the stored one. One that happened earlier (it waited offline, or another tab's went first) is answered as done and changes nothing (`:226-229`), so an undo of the newer clear puts back the clear before that one, not the ignored one. A clear repeated after a lost reply is answered as done; one that is still the latest folds its numbers in like a publish.
- Undo names the clear it undoes and the clear before it (`before`). The service refuses it if either doesn't match, so a newer clear wins. A repeated undo is answered as done (`undone_id`).
- Weekly totals stop growing past 1,000 runs in a week, because `retainRuns` drops the oldest runs (about 143 runs a day). The board never goes down, since the server keeps the higher total. Left for you to decide (open review thread); the merge rule is to read #27's per-day archive once #27 lands. That archive keeps time, not run counts.
- Publishing: each tab sends its own summary about 1.5 s after a change and never mid-run. Writes from one tab go out in order, queued changes collapse, and a replace waits for an in-flight publish.
- Kept records: a clear, undo or opt-out the service hasn't confirmed stays in localStorage across reloads, and any tab of the browser may send it, since the service answers a repeat as done (4724e05 dropped tab ownership and Web Locks). Kept clears go out in the order they were made. Another tab's record is picked up through `schedulePublish` after 5 s, so never mid-run (3dea114). An opt-out made in one tab stops the others at once through a `storage` listener. Clear ids fall back to `getRandomValues` where `randomUUID` isn't available (`newId()`, `src/friends-board.js:79`).
- Device keys: `stilltype-board-sharing:<id>`, `stilltype-board-optout:<id>` and `stilltype-board-replace:<id>:<clear id>`. Sign-out removes only the sharing key; an unconfirmed opt-out, clear or undo stays and goes out at the next sign-in on that device. The handoff's #51 and #53 rule covers account deletion.
- The server merges each publish: the later or better daily is kept, and the week keeps the maximum attempts, minutes and runs. A daily from another build replaces. Clear and undo send an explicit `replace`.
- Daily results carry `daily_version` (the daily condition key plus the passage text version). A result from another build reads "another version of the daily · not compared".
- The board doesn't poll. It refreshes on open, on Refresh and after this tab publishes. An open board also reads again once after 00:00 UTC on the service's clock. These automatic reads are quiet in the status line. Sharing turned on in another tab shows at once, and the board only re-reads (3dea114).
- `supabase/tests/friends-board.sql` now makes every RPC call as `authenticated`, or as `anon` when there's no JWT subject (f3caecd). A review finding about a missing EXECUTE grant was wrong (the migration grants it at line 296), but the old test couldn't have caught one; see the handoff's SQL test note.
- The #51 fixer first flagged the profile-sync data loss, now confirmed; see the handoff's "Bugs found on master" and its #51 merge rule.
- **Open, not fixed:** the daily result is dated on the device's clock, and a device more than a day off can get every board write refused. See the handoff's decision 15.
- **On master today:** `#challenge-online` keeps `btn-secondary` while the other mode buttons are `btn-ghost`, so Online always looks bordered.

**#52 still progress line**
- `.impeccable/design.json`'s progress-line entry now says "none".
- #48 avoids the pointer-nudge problem for the composing bar with an unconditional `transition: none`. A separate `data-attempt="running"` state that pointer movement doesn't clear would fix it for every still-run rule.

**#53 account deletion**
- Any 5xx from the delete function, including a gateway 502, 503 or 504 and Supabase's 546, counts as ambiguous and is checked against Auth within the same 30 s deadline. `handler.ts` also re-checks with `admin.getUserById` after `deleteUser` errors.
- If the 30 s timeout fires while the account still exists, the user sees "nothing was deleted". If the function finishes later, the next attempt resolves as deleted.
- Not checked on the real platform: whether Supabase's 404 for an undeployed function carries CORS headers (both cases are handled), and creating the `AFTER DELETE` trigger on `auth.users`.
- The `storage` listener reloads other open tabs as guests after any sign-out, deletion or rejected token refresh. A run in progress in another tab is lost. Tabs frozen in the background (bfcache) weren't tested.
- The light `--danger-soft` change (0.12 to 0.10) is app-wide: it also lightens the coral tint behind mistyped letters and the clear-history hover.
- Product decision: the `invited_id` cascade means deleting an account also deletes rooms someone else hosted and invited it to (`supabase/migrations/20260930085227_online_races.sql:10`).
- An email that another user typed into their friend list stays on their list; it no longer matches an account.
- Opening the delete dialog mid-run marks the run interrupted. The sign-in and create-account dialogs still don't.
- `.field-error` keeps an empty 1.4em row under the confirm input. At 320px the actions stack Cancel above Delete account.
- **Probable bug on master (not run in a browser):** the clear-history label is a direct grid child (`.dialog-content > label`), so its text may split across lines. Wrap it in one `<span>`, as the delete dialog does.
- **On master today:** the account toast's status dot uses `--warning` for every account problem, but `--warning` is reserved for interrupted runs and mixed results. Move the error tone to `--danger`.

**#55 async ghost challenge**
- **List rule:** the service's `list` returns, in order:
  - every open challenge, never cut;
  - every result answered in the last 7 days, never cut;
  - then the newest 50 other rows.
  - The inbox's 30-entry cap applies only to history, so open races and results from the last 7 days always show, and the list scrolls inside the popover at 320px.
- The inbox dedupes ids, and the delivered-results memory keeps only ids the service still lists.
- Retries are safe after a lost reply: each send carries a request id (`unique (sender_id, request_id)`), so a repeat returns the stored challenge and uses no quota; a repeated finish returns the stored result, and the first finish always stands. An older send can't re-enable Send for a newer offer.
- The server can't verify input class, so it trusts the client, as it does for all trace data. The client sends a reply only when it was made on the sender's kind of input.
- Starting a ghost race ends any drill-and-retest cycle in progress, as the daily does.
- The "Name they see" field defaults to the email's local part, so part of the sender's email reaches the friend unless they edit it.
- The inbox orders entries by arrival, not by their `at` time, so a month-old result fetched on a new device lands above newer ones. Toasts are limited to results from the last 24 hours, and an open inbox refreshes its time labels only when reopened.
- A run with an emoji or another astral character can't be sent, and the sender sees no reason. A reply with one shows "A character a ghost race can’t replay, so not sent."
- #55's tests hit master's speed-graph overflow (see the #35–#43 section); #36 fixes it.
- Ideas: list sent and received ghost races on Challenge → Online; keep the reply trace so the sender can watch the friend's run; add a palette command to challenge a friend with this run.

**#58 missed-words list (stacked on #23)**
- **Recording:** each counted run keeps `missedWords`, the words missed on the first try, up to 12 (`MAX_MISSED_WORDS`, `src/insights.js:5`; recorded at `:25` on #58). Counted runs are complete tests, retests and new daily passages, the runs pattern memory reads (`patternRun`, `:50-51`). Word practice, drills, races and interrupted runs keep none. `retainRuns` keeps the field on the newest 120 counted runs only (`:32-44`).
- The list counts only runs on the newest counted run's input class, so touch is never pooled with a physical keyboard. All other test conditions are pooled, and the note under the heading says so (`recurringMissedWords`, `src/insights.js:118`; `renderMissedWords`, `src/app.js:1200` on #58).
- PRODUCT.md's signed-in retention line now lists the missed words (`PRODUCT.md:49` on #58).
- The list's button checks the runs again when pressed (`practiseMissedList`, `src/app.js:873` on #58). If a sync changed them, it redraws the list first and practises the words the runs hold now. With fewer than two left it starts nothing, announces that and moves focus to the heading (28b8a83).
- The guest e2e test no longer checks `#best`: it shows the best for the practice settings, never a word-practice key, so it couldn't fail. The signed-in test's check of the stored bests is the proof (`e2e/missed-words-list.spec.js:116-117`, `:212` on #58).
- **Changes to #23's code:**
  - `startWordPractice` clears `trainingContext` (`src/app.js:854-859` on #58), so a drill's context from earlier doesn't carry into the next retest's record. #23's "Practice words" button now goes through it (`:844`).
  - `resetSession('missed')` with no words to practise starts a normal test (`src/app.js:476`). Clear history empties the practised words (`:1465`), so Run again after a clear starts a normal test.
- **Still flagged from #23:**
  - The retest after word practice records `target` and `recommendationKind` from the active recommendation (`src/app.js:997-998` on #58). `'missed-words'` would be more honest.
  - The slow-word copy is ambiguous for numeric tokens, for example "3 80 wpm" (`src/app.js:841`).
- **Pre-existing:** `adoptProfile` doesn't re-render Train (`src/app.js:1555-1563` on #58, the same on master), so a load sync while Train is open leaves the list stale (over a plain test it moves you to Practice instead). The button's check covers a press; the handoff's #57 + #58 rule covers the rest.
- **No backfill:** summaries stored before #58 carry no missed words, and nothing rebuilds them from the 24 kept traces (`normalizeProfile` makes records from traces only for a profile with no `runs`, `src/app.js:80` on #58). Someone with a long history sees "no runs counted so far" until a new counted run, and no list until two.

**#59 friends bests (stacked on #51)**
- Bests come from the run summaries since the board's clear, the same runs as the week's practice, not from the profile's bests (`summary`, `src/friends-board.js:379-380` on #59). Profile bests are wpm-only and follow the profile's history, not the board's clear.
- Eligible runs: completed, uninterrupted test or retest runs in time, words or quote mode, dated and within the service's limits (`shareableBest`, `src/friends-board.js:41`).
- At most 16 shapes, the keys this build can compare first (`MAX_SHAPES`, `:18`; `shapeBests`, `:54`). A best's date runs from 2026-01-01 to tomorrow on the service's clock (`:21`, `:60`); the service checks the same (`20261009150000_friends_bests.sql:63`).
- `shapeOf` (`src/friends-board.js:104-120`) lists a key only if it has 11 parts, each a value this build writes. The option lists (`TEST_DURATIONS`, `TEST_COUNTS`, `QUOTE_LENGTHS`, `QUOTE_DIFFICULTIES`, `INPUT_CLASSES`, `CORRECTION_POLICIES`) now live in `src/typing.js:311-316`. A unit test checks index.html's quote filters against `QUOTE_LENGTHS` and `QUOTE_DIFFICULTIES`, and its word lists against `wordListIds` (`tests/friends-bests.test.js:159-165`). The handoff's merge rules list the PRs that change the key, and #32's policies.
- **Changes to #51's client:**
  - `learnClock` (`src/friends-board.js:396-398`): a tab whose first request would be a write reads the board once first, so its bests are dated on the service's clock. It runs before a publish (`:568`) and before turning sharing on (`:829`). Side effect: a tab that hasn't heard from the board since loading learns the latest clear from that read, instead of being refused once and retrying.
  - Two #51 e2e tests were adjusted for it. "a clear on one device stays cleared when a tab that missed it publishes" (`e2e/friends-leaderboard.spec.js:604` on #59) now opens the board in the second tab before the clear, so its next write goes without a read. "a clear another tab left is sent from a tab mid-run only once the run is over" (`:1409`) now expects a `board` read before the `replace`.
  - `boardSummary` takes an `offset` and returns `bests`; two `tests/friends-board.test.js` assertions now expect `bests: {}` (`:62`, `:105`).
  - `describeConditions` is now built from `conditionParts` (`src/app.js:190`), which the shape picker also uses.
- The stale-tab test proves pre-clear bests are not resent (`e2e/friends-bests.spec.js:328` on #59).
- **Flags:**
  - `storeAttempt`'s `eligibleBest` (`src/app.js:774` on #59) duplicates `trendRun` (`src/insights.js:28`). A shared helper would keep them from drifting.
  - Ties: profile bests compare wpm only and keep the first run at a speed (`src/app.js:778`). The board breaks a tie by accuracy, then the earlier date (`src/friends-board.js:67`). So on a tie the "You" row can show a different run's accuracy and date from the profile's best.
  - A best older than the newest 1,000 run summaries (`MAX_RUN_SUMMARIES`, `src/insights.js:3`) is no longer sent. Publishes fold, so the service keeps it until the row's bests are rebuilt: by an undo, by sharing turned off and on, or by the 16-shape cut.
  - On desktop the Bests column sits alone in the left half of a second grid row: `.friends-board-lists` has two columns (`src/styles.css:1505`), and one at ≤760px.
  - #51's board screenshots (`docs/screenshots/friends-leaderboard/`) predate the Bests section; #59's are in `docs/screenshots/friends-bests/`.
