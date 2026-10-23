# Practice controls

One short rail above the passage holds the mode (time, words, quote, and "more"), the length pills
(including custom), the punctuation switch and, for time and words, the adaptive switch. "more" opens a small
menu with code, standard, book, compose, custom, drill (a 1–8 letter manual drill) and learn to type; picking one renames "more" to that mode and slides the pill under it.
Book mode puts a book dropdown and the page number where the lengths go.

## Sub-features

- `rail-modes` switches time / words / quote with `#mode-time`, `#mode-words`, `#mode-quote`.
- `rail-lengths` picks a length in `#duration-options [data-length="N"]`, or "custom" for any 5–600 s or 5–500 words.
- `rail-punctuation` toggles `#punctuation-switch`; the condition line says plain or punctuation.
- `rail-adaptive` toggles `#adaptive-switch` (time and words only); the next passage leans on the pairs you keep missing, and its run is not counted toward bests.
- `more-drill` opens the manual drill form `#manual-target` under the rail from "drill" (`#mode-drill`); `Drill it` starts a drill of those letters.
- `more-open` opens `.mode-more-menu` from `#mode-more-label`; Escape or a click elsewhere closes it without restarting.
- `more-choose` picks code, standard, book, compose or custom; `#mode-more-label` reads the chosen mode and `#mode-more[data-active]` is set.
- `book-pick` chooses a book from the combobox named "book" in `#book-options`; `#book-page` reads that book's next page ("page 1").
- `more-lessons` opens the learn-to-type path from "learn to type" (`#open-lessons`).
- `rail-phone` keeps the rail and the open menu on screen at 390 and 320 px with no sideways scroll.

## How to get to it (user POV)

- Click the rail controls above the passage on the practice view.
- Ctrl+K → `time · N seconds`, `words · N words`, `quote`, `punctuation`, `custom time…` / `custom words…`,
  `standard test · 60 seconds`, `book`, `composing practice`, `custom text`, `learn to type`.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` exits 0.
- Guest on the practice view, time · 30 selected.

- **Menu open, desktop.** Click "more". Run `$V shot more`. `rail.png` shows "more" with a chevron;
  `more-open.png` shows the menu below it. `run.json` notes the menu as
  `["code","standard","book","compose","custom","learn to type"]` and checks it stays on screen.
- **Menu open, phones.** Run `$V shot phone`. Four runs (idle and more at 390×844 and 320×568, touch); every
  `more` run passes "menu stays on screen" and "no horizontal scroll".
- **Choose a mode from more.** Run `$V drive .claude/skills/verify-stilltype/flows/code-run.mjs`. Checks
  "more" is renamed to "code", the condition line reads `code · python`, and the run card conditions name
  python after the snippet is typed.
- **Book mode.** Run `$V drive .claude/skills/verify-stilltype/flows/book-run.mjs` (and again with
  `--width 390 --height 844 --mobile`). Checks "more" is renamed to "book", the page reads page 1, Pride and
  Prejudice starts at its first line, the run card conditions start `page 1 · pride and prejudice`, and
  "Next page" moves on to page 2.
- **Words and lengths.** In a flow file, `await h.chooseWords(25)` clicks words, then the 25 pill, and waits
  for the condition line to read `25 words`. Shoot before and after.
- **Escape closes without restarting.** In a flow file: note `await h.passage()`, click `#mode-more-label`,
  focus `#mode-code`, press Escape, then `check` that `#mode-more` has no `open` attribute and the passage
  text is unchanged.

## Gotchas

- `#mode-more` is a `<details>`: check its `open` attribute, not the menu's visibility, to know whether it is open.
- The ARIA snapshot shows the "more" summary as `group: more`, not a button.
- Picking time, words or quote after a "more" mode resets the label to "more"; assert the label after each pick.
- At 320 px the open menu covers the length row on purpose; "covered" alone isn't a bug. The spec checks
  that each menu item is the topmost element under its own centre.
- Compose has no passage: there is no `#text-display .char` and typing goes to `#compose-input`.
