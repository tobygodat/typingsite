## Start here
Read HANDOFF.md first — current state, the work queue, and the decisions already made.
PRODUCT.md holds durable product truth (users, purpose, metric contract, accessibility floor).

## Before asking to merge
CI runs only unit tests and the build on each push; the browser suite does not run automatically,
to save GitHub Actions minutes. Run it locally and report the result in the PR:
`npm test`, `npm run build`, then `npm run test:e2e` (`CHROMIUM=/usr/bin/chromium` if Playwright's
own browser isn't installed). On GitHub it runs only on request (Actions → Browser checks → Run
workflow), so do not trigger it yourself unless asked.

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

## Motion: still run
Nothing decorative moves near the passage while a run is in progress: a solid spring caret, instant
letter states, a ~150ms line scroll. The rest of the chrome fades out after the first keystroke
(body[data-running]) and returns on pointer movement, finish or restart. Motion belongs after the
run and in chrome only, kept short (fades ≤200ms; run-card art ~450ms), and scales to zero under
prefers-reduced-motion. HANDOFF.md lists effects removed on purpose; do not bring them back.
src/motion.js and src/graph.js are presentational; scoring never reads from them.

## Historical references
design/ash/ (the former Ash system) and design/canvas/ (earlier redesign artboards) are historical
reference only: not served, not tested and not binding. Do not move the app back toward them
(no blue CTA, no Geist sans, no dark-only rule, no mono status pills; green is no longer
"success only, never a button fill").
