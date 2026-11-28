# Command palette

Ctrl+K (⌘K on macOS) opens a dialog with a search field over every command: go to a view, restart, change
the test shape, toggle punctuation, switch theme or text size, layouts, pace caret, focus mode, history and
account commands. Typing filters the list; Enter runs the highlighted command and closes the palette. It
opens and closes on the key's own frame, with no motion. A query that describes a look ("vibe warm kyoto matcha",
or two words no command names) offers "generate theme · …": a member wears the result in place with its contrast
read out, Enter saves it as a custom theme and Escape puts the old theme back; a guest is sent to sign in.

## Sub-features

- `palette-open` opens `#palette` with focus in `#palette-input` from the keyboard or the dock's search button.
- `palette-filter` narrows `#palette-list [role=option]` as the person types; "No matches" when nothing fits.
- `palette-run` runs the highlighted command with Enter or a click and closes the dialog.
- `palette-close` closes with Escape and returns focus, in the same task as the key.
- `palette-theme` generates a theme from the query (`#palette-theme[data-status]`: generating, ready, failed),
  wears it, reads its contrast in `#palette-contrast`, and saves it on Enter.

## How to get to it (user POV)

- Press Mod+K (Ctrl+K, ⌘K on macOS) outside a text field; the binding is configurable under settings → shortcuts.
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
  the next, the hints end at the esc key, and no group label repeats. `PALETTE_ALL=1` repeats it in all eleven themes
  and the three app fonts. `e2e/palette.spec.js` asserts the same in the suite.
- **Dock entry.** In a flow file, click
  `page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Commands' })` and
  wait for `#palette-input`. Shoot the open dialog.
- **No matches.** In a flow file, fill `#palette-input` with "zzzz" and wait for `#palette-empty` to be visible.
- **Instant, themes and the rank pill.** `$V drive .claude/skills/verify-stilltype/flows/rank-pill-and-palette.mjs`
  times ten Ctrl+K and Escape cycles, generates a theme as a guest (sign in, no requests) and as a member (worn,
  contrast read, reverted, saved), checks the inked mode and length rows within 1px, and opens and dismisses a
  member's rank card. Add `--width 320 --height 568 --mobile`, `--scheme light` or `--reduced-motion`.
- Every label's prefixes typed into the palette, each ranking its own label first:
  `$V drive .claude/skills/verify-stilltype/flows/palette-prefix-scan.mjs`. "practice c" and the palette's "progress"
  from a detail view: `TOB448_ONLY=palette $V drive .claude/skills/verify-stilltype/flows/tob448-follow-ups.mjs`.

## Gotchas

- Opening the palette mid-run takes that run out of comparisons; open it before typing unless that is
  what you're checking.
- Commands toggle: running `punctuation` twice turns it back off. Check the state after each run.
- The train group sets the training settings: "train focus · balanced|accuracy|speed", "drill length · N seconds"
  and the "retest after drill" toggle. They are preferences, so running one never restarts the passage.
- Some commands appear only signed in (`sign out`, `delete account…`) or only in context (`next lesson · …`).
- A two-word query no command names outright also lists "generate theme · <query>" last, so match the option
  you mean, not any text in `#palette-list`.
- Keyboard-only flows must press Ctrl+K while focus is on the page, not inside a text field that swallows it.
