# Challenge views, dock labels and key hints

Challenge's foot links open the daily passage (with the friends board) and One keyboard in the list's place,
each with Back to the list. The dock shows practice / train / progress / challenge, or the short verbs type / train / track /
race below 360px. Each accessible name starts with the visible word. Key hints such as "esc restarts." in the
one-keyboard race and the `esc` cap on settings close show only when a fine pointer (mouse, trackpad) is
available.

## Sub-features

- `challenge-views`: `#open-daily` and `#open-local` each show their view (`#challenge-daily-view`, `#challenge-local-view`) with one filled button, and Back returns to `#challenge-people` with focus on the link.
- `dock-label-in-name`: each `.nav-item`'s visible word is the start of its ARIA name. Below 360px: "type practice", "train", "track progress", "race challenge". From 360px: the visible word alone.
- `key-hints-touch`: `.key-hint` elements (shortcut row, `#race-help`'s restart hint, the `esc` in `#settings-close`, `#exit-focus-hint`, the palette search's `esc`) are hidden when a coarse pointer is the only one, and shown otherwise.

## How to get to it (user POV)

- Dock → challenge, then Daily passage and Back. One keyboard → two names → Start, then type both turns.
- Any screen at 320px wide (the dock sits at the bottom).
- Dock → settings (the close button sits top right of the dialog). Dock → search icon (palette).

## Driving it with verify.mjs

Preconditions:

- `$V doctor` exits 0.
- Guest, emulated system theme dark or light.

- **Desktop, fine pointer.** Run
  `$V drive .claude/skills/verify-stilltype/flows/challenge-chrome.mjs` (add `--scheme light` for the
  light set). `daily.png` shows the daily passage with the friends board, and `run.json` checks Back returns focus. `race.png`
  shows "esc restarts." under the passage, and `settings.png` shows "esc ×". `run.json` notes the dock's visible words against their names, the race help and the pointer media.
- **Phone, touch only.** Run the same flow with `--width 320 --height 568 --mobile`. The dock reads type /
  train / track / race, `race.png` has no restart hint, and `settings.png` shows "×" alone. `run.json`
  notes `pointer: { coarse: true, fine: false }`.

## Gotchas

- `--mobile` gives Chromium a coarse pointer and no fine one. The hybrid case (touchscreen laptop) needs
  Blink's pointer launch flags, as `e2e/touch-targets-hybrid.spec.js` does. The flow doesn't cover it.
- The flow types both turns at 5 ms a key, so the race's wpm figures are meaningless.
- Match dock buttons by the full word (`getByRole('button', { name: 'Progress' })`): the name match is a
  case-insensitive substring, so it finds "track progress" at 320px too.
