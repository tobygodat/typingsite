# Progress: what changed

Progress opens on one question: what changed since last week, and what moved it. A large figure gives the change in
speed against the week before, with the two medians beside it and a conditions line that is also the control that
changes them. Under it, the pairs and keys fixed this week, and practice; then two small charts; then
quiet links to runs and drills, keys, the practice calendar, the standard score and composing, each a view one step
away with a way back.

## Sub-features

- PW-1: The lead states a change only when both weeks hold at least three runs at the chosen conditions: a gain in green, a drop in coral, no change plain.
- PW-2: Without two weeks to compare, the lead shows this week's median, the week before's or the latest run, and says when a change can show.
- PW-3: A new guest sees "Nothing to compare yet" with Take a test and Take the standard test.
- PW-4: The conditions line opens the length pills and the condition-set select; the lead, charts and lists follow.
- PW-5: The list shows units fixed this week (the word "fixed"), three at a time with "N more" for the rest, then practice (more, less, same). One fixed unit lists alone with practice; nothing fixed lists practice alone; with neither, there is no list. A named unit is drilled from Patterns across runs in Keys.
- PW-6: A small chart opens its full chart on the trends view; each link opens its view; Progress goes back, focus on what opened it.
- PW-7: Clear history empties the page to the new-guest state and Undo brings the week back.

## How to get to it (user POV)

- Dock → progress (the overview), or Ctrl+K → "progress".
- Ctrl+K → "runs and drills", "keys and pairs", "practice calendar", "your standard score".
- From the overview: the runs, keys, practice calendar, standard score and composing links; a small chart; the "practice" label on the practice row.

## Driving it with verify.mjs

Preconditions: `$V doctor` exits 0.

- Every state, dark, at a laptop width: `$V drive .claude/skills/verify-stilltype/flows/progress-week.mjs --width 1280 --height 800`.
  Shots: guest, gain, conditions-open, each detail view, cleared, undone, drill, one, practice, quiet, drop, flat, week. `run.json`
  notes each lead and its movers ("ol:fixed", "ex:fixed", "qu:fixed", "practice:less" for gain; "qu:fixed", "practice:less" for one; "practice:less" for practice; none for quiet).
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
