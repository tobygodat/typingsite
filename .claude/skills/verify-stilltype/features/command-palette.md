# Command palette

Ctrl+K (⌘K on macOS) opens a dialog with a search field over every command: go to a view, restart, change
the test shape, toggle punctuation, switch theme or text size, layouts, pace caret, focus mode, history and
account commands. Typing filters the list; Enter runs the highlighted command and closes the palette.

## Sub-features

- `palette-open` opens `#palette` with focus in `#palette-input` from the keyboard or the dock's search button.
- `palette-filter` narrows `#palette-list [role=option]` as the person types; "No matches" when nothing fits.
- `palette-run` runs the highlighted command with Enter or a click and closes the dialog.
- `palette-close` closes with Escape and returns focus.

## How to get to it (user POV)

- Press Ctrl+K anywhere (the binding is configurable under settings → keybindings).
- Click the search icon at the end of the dock (ARIA name "Commands").

## Driving it with verify.mjs

Preconditions:

- `$V doctor` exits 0.
- Guest on the practice view, emulated system theme dark.

- **Filter and run.** Press Ctrl+K, type "theme light", press Enter. Run
  `$V drive .claude/skills/verify-stilltype/flows/palette-theme.mjs`. `palette-filtered.png` shows the
  dialog with `theme · light` listed; `light.png` shows the page repainted light with the palette closed.
  `run.json` notes the options and passes both checks.
- **Alignment.** `$V drive .claude/skills/verify-stilltype/flows/palette-align.mjs --signed-in` walks the
  selection through every row with ArrowDown and checks the highlight sits on the row, the label, dot and hint are
  centred in it within 1px, the search icon, group labels and dots share one left edge, the search text and labels
  the next, the hints end at the esc key, and no group label repeats. `PALETTE_ALL=1` repeats it in all ten themes
  and the three app fonts. `e2e/palette-alignment.spec.js` asserts the same in the suite.
- **Dock entry.** In a flow file, click
  `page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Commands' })` and
  wait for `#palette-input`. Shoot the open dialog.
- **No matches.** In a flow file, fill `#palette-input` with "zzzz" and wait for `#palette-empty` to be visible.

## Gotchas

- Opening the palette mid-run takes that run out of comparisons; open it before typing unless that is
  what you're checking.
- Commands toggle: running `punctuation` twice turns it back off. Check the state after each run.
- The train group sets the training settings: "train focus · balanced|accuracy|speed", "drill length · N seconds"
  and the "retest after drill" toggle. They are preferences, so running one never restarts the passage.
- Some commands appear only signed in (`sign out`, `delete account…`) or only in context (`next lesson · …`).
- Keyboard-only flows must press Ctrl+K while focus is on the page, not inside a text field that swallows it.
