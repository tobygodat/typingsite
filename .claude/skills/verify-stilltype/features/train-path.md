# Train's path

A person opens Train and sees one line of steps: the targets they have drilled behind them (a ring when drilled, a
disc once fixed), the one to drill now (a larger ring, its target large, its evidence, missed words and one green
button under it), and the next three the learner queues, quiet, on a dashed line. After a drill and its retest,
the comparison is the newest step behind them and the next target is open. There is no visible page heading.

## Sub-features

- `path-empty`: a new guest sees one open step, "General drill", and three empty places on the line.
- `path-history`: with history, the steps behind (`#train-path > .is-behind`, `.is-drilled` or `.is-fixed`), the open step (`#train-current`, `#train-unit`, `#train-evidence`, `#train-words`, `#start-drill`, `#train-starts`) and up to three ahead (`.is-ahead`).
- `path-focus`: the train focus (settings or Ctrl+K → "train focus · …") changes the open target and the steps ahead.
- `path-ahead`: choosing a step ahead (`.path-choose`) starts a drill of that target.
- `path-after`: after the retest, `#comparison-panel` is the newest step behind, `#comparison-status` has focus, and the open step's button is `#comparison-next` ("Next: “…”").
- `path-scroll`: from 901px, a path wider than six steps scrolls along its line and takes keyboard focus; up to 900px the line runs down the page with the two newest steps behind shown.
- `path-general`: after one short run, the open step is the general drill with nothing ahead.

## How to get to it (user POV)

- Choose "train" in the dock, or Ctrl+K → "train".
- Finish a drill's retest: Train opens on the comparison.
- The results card's "Drill “…”" and Progress's "Practice “…” again" start the same drills the path offers.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` exits 0.
- A fresh context: the flow signs in its own account and seeds its history through the fake Supabase, as another device's sync would.

- **The whole path.** Run `$V drive .claude/skills/verify-stilltype/flows/train-path.mjs --delay 40` at
  `--width 1440 --height 900`, `--width 1280 --height 800`, and `--width 390 --height 844 --mobile --full-page` and
  `--width 320 --height 568 --mobile --full-page`, each with `--scheme dark` and `--scheme light`. Shots: `guest`
  (`path-empty`), `history` (four steps behind, two of them fixed, "th" open, three ahead), `pace` (speed focus,
  a pace-named target with no word list), `ahead-hover`, `mid-drill` (the step chosen ahead, drilling), `comparison`
  (`path-after`). `run.json` notes each path's step classes and checks the fixed count, the three steps ahead, the
  drill's title and the comparison's unit.
- **Themes.** Run `$V drive .claude/skills/verify-stilltype/flows/train-path-themes.mjs --delay 40`. One shot of the
  path with history per built-in theme, each picked in settings → appearance; contrast is guarded by
  `tests/contrast.test.js`.

## Gotchas

- The drill only retests when there is a baseline at the same conditions in this tab. The flow types one 10-word
  run after signing in for that; without it the drill stands alone and no comparison opens.
- A drilled target usually stays named after one retest: the learner remembers a lot. It then comes back as the
  open step on the next visit, not behind you. A path grows as targets leave the learner's top four.
- The mid-drill shot waits out a 15-second drill in real time (the flow sets the drill length from the palette).
