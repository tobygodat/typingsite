# Practice run

A person lands on the practice page with a three-line passage and a waiting caret, types it, sees the chrome
fade while they type, and lands on the run card: wpm, accuracy, first-try errors, time, raw wpm,
consistency, final c/i/e/m, a speed-over-time graph and the conditions line.

## Sub-features

- `run-idle` shows the passage, the countdown or word count, and the rail before any key.
- `run-shape` picks the test shape (time 15/30/60/120, words 10/25/50/100, quote) before typing.
- `run-typing` starts on the first key; correct letters fill, mistyped letters turn coral with a tint.
- `run-chrome-fade` fades the dock and rail while `body[data-running]` is set; pointer movement brings them back.
- `run-results` switches to `body[data-view=results]` with the run card and the train panel beside it.
- `run-restart` restarts with Escape or the restart button (`#restart-button`) and draws a new passage.

## How to get to it (user POV)

- Open the site: the practice view is the default (`/`).
- Click the passage or use the "Skip to typing" link, then type.
- From another view, choose "practice" in the dock, or Ctrl+K → "practice" (go to).
- Ctrl+K → "restart test", Escape, or the restart icon below the passage to start over.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` exits 0.
- Guest, default settings, seeded passage.

- **Idle page.** Open the app. Run `$V shot idle`. `idle.png` shows the dock, the rail with time · 30
  pressed, "30 s" in green and three lines of passage; `run.json` notes `conditions` starting
  `english 200 · 30 s`.
- **Full run.** Pick words · 10 and type the passage. Run `$V shot results`. Three shots: `ready` (words 10
  pressed), `mid-run` (half the letters filled, dock and rail faded, check `body[data-running]` passed),
  `results` (run card). `run.json` notes the result: wpm about 120 at the default `--delay 100`, accuracy
  100, first-try errors 0, `46/0/0/0` for the seeded passage, consistency a number.
- **Light theme run.** Run `$V shot results --scheme light`. Same checks; the run card sits on warm paper.
- **Phone run.** Run `$V shot results --width 390 --height 844 --mobile`. The dock sits at the bottom, the run card
  fills the width, and the train panel follows below the fold (add `--full-page` to capture it).
- **Restart.** Drive it: in a flow file, type a few letters with `h.type('ab')`, press
  `page.keyboard.press('Escape')`, then `check` that `#accessible-passage` text changed and
  `body[data-running]` is gone.

## Gotchas

- The seeded passage is identical across runs, so "a new passage after restart" only shows with `--seed off`
  or within one page (each restart draws the next seeded words).
- Typing faster than about 3 s total leaves consistency at "—"; keep `--delay` at 100 or more for a
  10-word run.
- Clicking dock buttons mid-run does nothing until the mouse moves (the dock has no pointer events while
  faded). Use `h.openView(label)`, which nudges the mouse first.
- A time test ends on the clock, not the passage. Use words or quote for a run that finishes when typing does.
- Guests see "guest · runs aren't saved"; the run card still appears, but Progress stays empty after a reload.
