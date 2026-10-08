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
- Account deletion still needs a server side: a Supabase edge function (or SECURITY DEFINER RPC with service role) that verifies the caller's JWT, deletes the profiles row and race/friend rows (or relies on ON DELETE CASCADE), then calls auth.admin.deleteUser(uid). The client then signs out and reuses clearHistory.
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
- A persistent "words you keep missing" list in Training was not built. It's the natural next step. It should work for guests within the tab (in memory, like their runs) and persist only for signed-in users.
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

### From reviewing the PR screenshots
- Run card (PR #22): c/i/e/m reads 51/0/0/0 while first-try errors reads 1 and the word history marks "day" as mistyped. "incorrect" counts the final state, so a corrected mistake disappears from it. Side by side, the two numbers look contradictory. Either define "incorrect" as first-try errors, or label it "left incorrect".
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
- `recurringTargets` (src/insights.js:55) still counts code runs within their own code key, so a drill after a code run may target symbol pairs. Consider excluding code mode from recurring-target evidence.
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
