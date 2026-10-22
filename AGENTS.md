## Start here
Read HANDOFF.md first — current state, the work queue, and the decisions already made.
PRODUCT.md holds durable product truth (users, purpose, metric contract, accessibility floor).

## Before asking to merge
GitHub Actions is off for now, so CI runs on tobygdesktop (see HANDOFF.md) and the browser suite
runs only locally. Run it and report the result in the PR:
`npm test`, `npm run build`, then `npm run test:e2e`. The suite uses `CHROMIUM` when set and
Playwright's own browser otherwise, so without `npx playwright install chromium` point it at a system
build: `CHROMIUM=/usr/bin/chromium` on the desktop, `CHROMIUM=/usr/local/bin/chromium` on cloud
machines (which have no `/usr/bin/chromium`). While iterating, `npm run test:e2e:quick` runs the core practice
loop, layout and chrome specs in a few minutes; it does not replace the full run. Do not
trigger the GitHub Browser checks workflow unless asked. `npm run test:e2e` is Chromium only. When a change touches input, layout, motion or
anything engine-specific, also run `npm run test:e2e:firefox` and `npm run test:e2e:webkit`, or both
with Chromium as `npm run test:e2e:all` (after `npx playwright install firefox webkit`; the
`E2E_BROWSERS` variable picks the engines, so `E2E_BROWSERS=firefox npx playwright test e2e/<spec>`
runs one spec there).

## Design system: Afterimage
The redesign shipped on 22 September 2026 is the binding visual system. Follow DESIGN.md and the
shipped app: the tokens at the top of src/styles.css (one set per theme: dark, light and eight more;
there are no separate token files) and PRODUCT.md "Brand Commitments". Never invent colours, type
sizes, radii, durations or easings — use the CSS variables, and add a token before using a new value.

- Literata for everything readable, including the passage and numerals. Geist Mono only for small
  measurement labels, conditions and keys.
- Warm near-black (dark) and warm paper (light). The theme follows the system until the user picks
  one. One green accent for action, current state and the caret; the primary button is filled green.
  Coral marks mistyped letters (always with a coral tint behind them) and regressions.
  The eight other themes keep these roles in their own tokens; soft, midnight, swiss and e-ink use
  their own accent colour, and swiss and e-ink their own mistake colour (always with its tint).
- Rules and space, not boxes. Dock, settings, palette and toasts are opaque raised surfaces:
  no glass, no glow.

## Motion: fluid
Motion is welcome, on the typing surface during a run as well as in chrome and after it, wherever it
makes speed, position or progress easier to follow: the spring caret, the pace caret gliding at its
speed, a ghost race gliding between a friend's keys, the line scroll. Nothing has to stay rigid or
static. Keep it smooth (transform and opacity, one animation frame at a time), never let it move or
hide the letters someone is reading, and scale it to zero under prefers-reduced-motion. The chrome
still fades out after the first keystroke (body[data-running]) and returns on pointer movement,
finish or restart. Durations come from the --dur-* tokens; add a token before using a new one.
src/motion.js and src/graph.js are presentational; scoring never reads from them.

## Historical references
design/ash/ (the former Ash system) and design/canvas/ (earlier redesign artboards) are historical
reference only: not served, not tested and not binding. Do not move the app back toward them
(no blue CTA, no Geist sans, no dark-only rule, no mono status pills; green is no longer
"success only, never a button fill").
