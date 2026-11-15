# Progress: what changed

Progress is one page in the Instrument look (TOB-470): the conditions control and the period, four lead cells (this
week's wpm against last week, accuracy, practice minutes, units fixed), two charts of daily medians over a dot for each
run, a year of practice in a calendar with a tip per day, and the newest runs with a crown on each that was a best when
typed, beside Clear history. Runs and drills, the full charts, the practice figures, what was fixed and composing are
each a view one step away with a way back.

## Sub-features

- PW-1: The wpm cell states a change ("+N vs last week") only when both weeks hold at least three runs at the chosen conditions: a gain in green, a drop in coral, no change plain.
- PW-2: Without two weeks to compare, the wpm cell shows this week's median, the week before's or the latest run, and its label says which.
- PW-3: A new guest sees "Nothing to compare yet" with Take a test.
- PW-4: The conditions control opens the length pills and the condition-set select; the cells, charts and lists follow.
- PW-5: The fixed cell counts the units fixed this week and names three; it opens their list, three at a time with "N more".
- PW-6: A chart opens its full chart on the trends view; each link opens its view; Progress goes back, focus on what opened it.
- PW-7: Clear history empties the page to the new-guest state and Undo brings the week back.
- PW-8: The calendar shows a year, the oldest weeks clipped first; hovering, focusing or tapping a day shows its runs, best and minutes.

## How to get to it (user POV)

- Dock → progress (the overview), or Ctrl+K → "progress".
- Ctrl+K → "runs and drills", "practice calendar".
- From the overview: the runs links under the table, "streaks" on the calendar, the fixed cell, a chart.

## Driving it with verify.mjs

Preconditions: `$V doctor` exits 0.

- The Instrument page on a year of history: `$V drive .claude/skills/verify-stilltype/flows/progress-instrument.mjs --width 1350 --height 910`.
  `PROGRESS_STATES=guest,thin,full` picks states, `PROGRESS_NAV=top` puts navigation in the top bar. Shots: guest, thin,
  each period, runs (crowns), the tip by hover and by keyboard, conditions open and at 15 s, each detail view, the clear dialog.

- Every state, dark, at a laptop width: `$V drive .claude/skills/verify-stilltype/flows/progress-week.mjs --width 1280 --height 800`.
  Shots: guest, gain, conditions-open, each detail view (runs, calendar, fixed, trends), cleared, undone, one, practice, quiet, drop,
  flat, week. `run.json` notes each lead and what was fixed ("ol:fixed", "ex:fixed", "qu:fixed" for gain; "qu:fixed" for one; none for
  practice and quiet).
- Phones and light: add `--width 390 --height 844 --mobile` or `--width 320 --height 568 --mobile`, or
  `--scheme light`. Each step checks nothing scrolls sideways.
- One account only: `PROGRESS_ONLY=gain` (or one, practice, quiet, drop, flat, week, guest) before the command.
- Every theme on one sheet: `$V drive .claude/skills/verify-stilltype/flows/progress-week-themes.mjs`.
- Focus after a clear in another tab, on the overview and in the runs view, and the small charts under forced
  colours: `TOB448_ONLY=focus $V drive .claude/skills/verify-stilltype/flows/tob448-follow-ups.mjs` (or `runs-focus`,
  `forced`). Run one part at a time: each signs in its own account.

## Gotchas

- The seeded histories are dated from today, so the weeks fall the same on any day the flow runs.
- The detail views reset when Progress is opened from another screen; a flow that leaves Progress lands on the
  overview again.
- Guests keep history for the tab only: the guest step runs before any sign-in.
