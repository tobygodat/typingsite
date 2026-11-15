# Train

A person opens Train and sees two parts (TOB-470): the queue, one row per step still to do (its number, the unit,
"slow" or "missed", and what it costs in speed), with the drilled steps folded under it ("drilled N" and the speed
they won back), and the chosen step's detail beside it (under it up to 900px): what it is, its drill's first words,
its button with the drill and retest lengths, three measures, the learner's evidence line, and for a pair one dot per
timed run against the pace. After a drill and its retest, the step just retested is chosen with its comparison, the
fold opens, and the next target is the open step. There is no visible page heading.

## Sub-features

- `queue-empty`: a new guest sees one row, "General drill", and its plain detail: the drill's first words and "Drill".
- `queue-history`: with history, the open step (`#train-current`, `#train-unit`), up to three ahead (`#train-path > .is-ahead`), each with `.q-why` and `.q-cost`, and the open step's detail (`.train-step-unit`, `.train-preview`, `#start-drill`, `#train-starts`, `.train-cells`, `#train-evidence`, `#train-words`, `.timing-plot`).
- `queue-fold`: `#train-drilled-toggle` opens `#train-drilled`: each step drilled (`.is-drilled` with a ring, `.is-fixed` with a check, `.q-state`) and what it won back. Choosing one shows won back, its misses or pace now and before, its read-back lines, and "Drill “…” again".
- `queue-focus`: the train focus (settings or Ctrl+K → "train focus · …") changes the open target, the steps ahead and the basis each is costed on.
- `queue-choose`: choosing a row (`.q-row[aria-pressed]`) shows that step; its `#start-drill` drills it.
- `queue-after`: after the retest, `#comparison-panel` shows in the detail of the step just retested (`#train-drilled > .is-just`), `#comparison-status` has focus, and the open step's button is `#comparison-next` ("Next: “…”").
- `queue-general`: after one short run, the open step is the general drill with nothing ahead.
- `queue-follows`: a clear, its undo or a run in another tab of the same account redraws Train here (`followHistory`), keeping focus, the fold and the chosen step.
- `queue-cost`: `src/train-cost.ts` gives each figure; in cpm every cost and won back reads five times its wpm.

## How to get to it (user POV)

- Choose "train" in the dock, or Ctrl+K → "train".
- Finish a drill's retest: Train opens on the comparison.
- The results card's "Drill “…”" and Progress's "Practice “…” again" start the same drills the queue offers.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` exits 0.
- A fresh context: the flow signs in its own account and seeds its history through the fake Supabase, as another device's sync would.

- **Every state.** Run `$V drive .claude/skills/verify-stilltype/flows/train-instrument.mjs --delay 40` at
  `--width 1350 --height 910`, again with `TRAIN_NAV=top`, and at `--width 390 --height 844 --mobile --full-page` and
  `--width 320 --height 568 --mobile --full-page`, with `--scheme light` once. Shots: `guest`, `general` (one short
  run), `queue-slow` ("th" open with its timings), `missed` ("an" chosen), `drilled-open` (the fold with a fixed and a
  drilled step), `drilled-chosen`, `mid-drill` and `comparison`.
- **The queue.** Run `$V drive .claude/skills/verify-stilltype/flows/train-path.mjs --delay 40`. Shots: `guest`,
  `history`, `pace` (speed focus), `ahead-hover`, `mid-drill` (the step chosen ahead, drilling), `comparison`.
- **Themes.** Run `$V drive .claude/skills/verify-stilltype/flows/train-path-themes.mjs --delay 40`. One shot of the
  queue with history per built-in theme, each picked in settings → appearance; contrast is guarded by
  `tests/contrast.test.js`.
- A drill left waiting while Train, Progress and Challenge open, then Practice, still the drill:
  `$V drive .claude/skills/verify-stilltype/flows/train-waiting-drill.mjs`.
- The open step's Drill button clear of the dock on first view, 44px, nothing sideways:
  `$V drive .claude/skills/verify-stilltype/flows/train-drill-dock.mjs --width 320 --height 568 --mobile`.
- The since-line in counts, and a loop whose drill was interrupted, on Train and in Progress's runs view:
  `TOB448_ONLY=since $V drive .claude/skills/verify-stilltype/flows/tob448-follow-ups.mjs` (or `loop`).

## Gotchas

- The drill only retests when there is a baseline at the same conditions in this tab. The flow types one 10-word
  run after signing in for that; without it the drill stands alone and no comparison opens.
- A drilled target usually stays named after one retest: the learner remembers a lot (34 to 111 clean runs on TOB-419's measure). `learner-let-go@2`, which lets one go sooner, failed ADR 0019's rule and is not the default, so a clean pair stays the open step for a long time in the browser too. It then comes back as the
  open step on the next visit, not in the fold. The fold grows as targets leave the learner's queue.
- The mid-drill shot waits out a 15-second drill in real time (the flow sets the drill length from the palette).
