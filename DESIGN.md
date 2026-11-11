# Design

Stilltype has no fixed visual system ([ADR 0016](docs/adr/0016-design-note-keeps-floors-only.md)). This note says where the look lives and which floors every change holds. Everything else is open.

## Where the look lives

The tokens at the top of `src/styles.css` are the source of truth for colours, type, spacing, radii and motion. A value used in more than one place becomes a token. Set a colour token in every theme block, or `tests/contrast.test.js` fails.

## Floors

These protect the people who use the app. Every change holds all of them.

- **Contrast.** In every built-in theme, text holds 4.5:1 and carets, focus rings and input outlines hold 3:1, which is WCAG AA (`tests/contrast.test.js`).
- **Reduced motion.** Everything animated has a reduced-motion path. CSS durations multiply by `--motion-scale`, which is 0 under `prefers-reduced-motion`, and motion driven from JavaScript checks the same media query.
- **Touch targets.** A control is at least 44px on a coarse pointer. `e2e/touch-targets.spec.js` measures every visible control and lists the two exceptions.
- **The letter being typed.** During a run, the letter someone is typing stays in view and clear of the edge fades, whatever else moves (`e2e/tape-mode.spec.js`).
- **Narrow screens.** The page never scrolls sideways at 320px (`e2e/layout.spec.js`).
- **Scoring.** Scoring never reads presentational code (`src/motion.js`, `src/graph.js`).

## Everything else is open

New colours, type, layouts, motion and effects are welcome. Show Toby a mockup or a screenshot of any change a user sees before it ships.
