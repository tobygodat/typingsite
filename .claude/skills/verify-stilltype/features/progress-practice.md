# Progress practice figures

Progress → Practice calendar shows the practice calendar and, under it, the practice figures: active days, longest
streak, current streak, time typing and runs started (with how many finished beside the numeral).

## Sub-features

- PP-1: Runs started counts every run whose first key was typed: finished, restarted, abandoned or failed.
- PP-2: "N finished" beside the numeral counts only runs that reached their end as counted runs.
- PP-3: Five figures to a row from 1001 px; four, then two at 760 px and below. A unit too wide drops under its numeral.

## How to get to it (user POV)

- Dock → progress → "Practice calendar" at the foot of the overview, or the "practice" label on the practice row.
- Ctrl+K → "practice calendar".

## Driving it with verify.mjs

Preconditions: `$V doctor` exits 0.

- Finish one run, restart one with Escape, abandon one for Progress, open Practice:
  `$V drive .claude/skills/verify-stilltype/flows/progress-runs-started.mjs` (add `--scheme light` for the
  light set). `run.json` notes "practice figures": Runs started 3, 1 finished.
- Widest likely values (999 started, 412 finished, 999 min) from a seeded account row, at any width:
  `$V drive .claude/skills/verify-stilltype/flows/progress-figures-fit.mjs --width 1001`. Checks that no figure
  runs past its column; `run.json` notes the column count, rows and which units wrapped under their numeral.

## Gotchas

- The "Practice calendar" link is hidden until there is some practice time, so a fresh guest needs at least one
  finished or interrupted run before the figures show.
- A guest's counts last for the tab only; reloading starts again from zero.
