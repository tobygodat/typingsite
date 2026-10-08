# Session notes: feature sprint, 8 October 2026

These are flags and ideas collected while building the Tier 1–2 features from the feature-opportunities brief. Each feature is its own PR. The notes are grouped by the PR that surfaced them; "Cross-cutting" lists the items that matter most.

## Cross-cutting (read first)
1. **Merge order and conflicts.** PRs #18–#26 and later each touch `src/app.js`, `index.html` and `src/styles.css`, and so does the open PR #17. Merge the small ones first (caps lock #18, restart key #19, export #20). Then merge master into the rest and let CI re-run.
2. **The settings popover is full.** The restart key, pace caret, export, daily goal, error modes and break suggestions all add rows (about 490 px at 1280×800 already). It needs sections (Test · Behaviour · Display · Data) or a sheet before more settings land.
3. **Conditions strings.** `describeConditions` and `describeRun` in src/app.js are chained template strings, duplicated for drills and missed-words practice. A structured conditions builder would make numbers, custom text, code mode and error modes consistent.
4. **Guest preferences don't persist.** `loadProfile` returns `emptyProfile()` when signed out, so every setting resets on reload. Keep preferences (not history) for guests in localStorage.
5. **Results-page action hierarchy.** It can now show Start drill, Skip to retest, Run again, Practice words and Watch replay together. Keep one primary and make the rest quiet.
6. **Account deletion** needs a server side (see PR #20 notes) before the privacy page can promise it.

## By source

### From the caps-lock warning work (PR #18)
- The race and online typing fields (`#race-input`, `#online-input`) have no caps-lock warning; the same helpers in src/app.js could be reused there.
- `announce()` (src/app.js:159) overwrites `#announcement`; a caps-lock announcement landing at the same moment as the finish summary could cut it off. A tiny announcement queue would be safer.
- On mobile (≤760px) the right-aligned caps-lock label could crowd the measure row in drill/retest sessions that show a title + description. Check at 390px.
- `.gitignore` has `node_modules/` (directory only); a symlinked node_modules shows as untracked. Use `node_modules` without the slash.

### From the quick-restart work (PR #19)
- Where does focus land after a run finishes? If it lands on a results control, Tab moves focus and Enter clicks that control instead of restarting. Check finishPrimary/switchView focus handling (src/app.js ~771).
- Guest preferences don't survive a reload: loadProfile returns emptyProfile() when signed out (src/app.js:97). Every preference behaves this way today, but people expect settings to stick. Consider persisting preferences (not history) for guests.
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
- `punctuate()` in src/typing.js places capitals and full stops on a fixed 9-word cycle (`i % 9`), so punctuation mode is predictable. Use the seeded random source like numbers does. (Engine change: needs a corpus/metric version bump.)
- Dark run card: the "Run again" secondary button's bright outline looks heavier than the filled green primary beside it. Design check.
- The mode bar now has four pill groups (index.html:147). A third toggle would need grouping the switches into one pill or moving them into settings.

### From the run-card stats work (PR #22)
- "Extra" characters are almost always 0: the engine is position-based and drops input past the end of the passage (src/typing.js replayAttempt `if (position >= attempt.text.length) break`), and letters typed past a word's end count as incorrect. Consider showing c/i/m instead of c/i/e/m, or add word-aware "extra" tracking in a future metric version.
- A 120s run's word history can hold about 200 words. It's capped at 4 lines and scrolls inside a sticky card. Put it behind a disclosure for long runs.
- The run card now has two metric-note paragraphs. Merge them into one, or into the conditions line.
- Mobile 390px: the fixed bottom dock covers the run card's last line (conditions) when scrolled to the end. results-screen needs more bottom padding.
- The "first-try errors" label wraps to two lines in the 3-column facts grid, so main-row labels sit at uneven heights.

### From the missed-words practice work (PR #23)
- A persistent "words you keep missing" list in Training was not built. It's the natural next step (and only meaningful for signed-in users, since guests aren't stored).
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
- `#f4f1eb` / `#0f0f0e` are hardcoded in `applyTheme` (src/app.js ~241) and in the manifest. Derive them from the tokens via a shared constant.
- With `node server.mjs` (no build) the cache name stays `stilltype-shell-v1`, so local changes won't show until it's bumped. Builds stamp a content hash.
- No update notice: a new shell takes over on the next load silently. A quiet "Updated — reload" toast is a natural follow-up.
- vercel.json has no `Cache-Control: no-cache` for `/sw.js`. Browsers re-check it anyway, but the header is safer.
- New src modules, fonts or icons must be added to the sw.js precache list (tests/sw.test.js enforces this). The PNG icons have no regeneration script.

### Tooling / repo hygiene
- `.gitignore` has `node_modules/` (with a slash), which doesn't match a symlinked node_modules; four separate agents hit this. Change it to `node_modules`. (Done in the notes PR.)
- The impeccable skill isn't installed for cloud sessions (only the `.impeccable/` config is in the repo). Commit the skill under `.claude/skills/` so cloud agents can use it.
- The "Paper" redesign mockups live only on your laptop. Commit or export them under `design/paper/` so future sessions can build from them.
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
