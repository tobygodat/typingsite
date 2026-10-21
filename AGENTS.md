## Start here
Read HANDOFF.md first — current state, the work queue, and the decisions already made.
PRODUCT.md holds durable product truth (users, purpose, metric contract, accessibility floor).

## Before asking to merge
CI runs only unit tests and the build on each push; the browser suite does not run automatically,
to save GitHub Actions minutes. Run it locally and report the result in the PR:
`npm test`, `npm run build`, then `npm run test:e2e`. The suite uses `CHROMIUM` when set and
Playwright's own browser otherwise, so without `npx playwright install chromium` point it at a system
build: `CHROMIUM=/usr/bin/chromium` on the desktop, `CHROMIUM=/usr/local/bin/chromium` on cloud
machines (which have no `/usr/bin/chromium`). While iterating, `npm run test:e2e:quick` runs the core practice
loop, layout and chrome specs in a few minutes; it does not replace the full run. On GitHub it
runs only on request (Actions → Browser checks → Run workflow), so do not trigger it yourself
unless asked.

## Design system: Afterimage
The redesign shipped on 22 September 2026 is the binding visual system. Follow DESIGN.md and the
shipped app: the tokens at the top of src/styles.css (dark and light sets; there are no separate
token files) and PRODUCT.md "Brand Commitments". Never invent colours, type sizes, radii,
durations or easings — use the CSS variables, and add a token before using a new value.

- Literata for everything readable, including the passage and numerals. Geist Mono only for small
  measurement labels, conditions and keys.
- Warm near-black (dark) and warm paper (light). The theme follows the system until the user picks
  one. One green accent for action, current state and the caret; the primary button is filled green.
  Coral marks mistyped letters (always with a coral tint behind them) and regressions.
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
