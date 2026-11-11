# 0016. The design document keeps floors only

Status: Accepted, 2026-11-11 (TOB-431). Supersedes [0002](0002-afterimage-design-system.md).

## Context

[ADR 0002](0002-afterimage-design-system.md) made Afterimage the binding visual system. `DESIGN.md` grew to 454 lines that described every component and banned glows, counting numbers, badges, boxed cards, a second accent colour, eyebrows and helper copy. Toby found that the document limits what the app can try. He asked to scrap it and keep it as lean as possible.

## Decision

`DESIGN.md` no longer prescribes a visual system. It keeps three things:

- Where the look lives. The tokens at the top of `src/styles.css` are the source of truth, and a value used in more than one place becomes a token.
- The floors that protect the people who use the app: contrast in every built-in theme, a reduced-motion path for everything animated, 44px touch targets on coarse pointers, the letter being typed kept in view during a run, no sideways scroll at 320px, and scoring that never reads presentational code.
- One statement that everything else is open. Toby sees a mockup or a screenshot of any change a user sees before it ships.

The Afterimage name, the palette tables, the component descriptions, the named rules and the Do's and Don'ts are gone from `DESIGN.md`. The app looks the same after this change. The CSS and its tokens did not change.

## Consequences

- Agents may propose and build new visual ideas: new colours, type, layouts, motion and effects. The bans in ADR 0002 and the old `DESIGN.md` no longer apply.
- Consistency now depends on Toby's review of each visible change, not on a rulebook.
- The floors are checked by tests where a test exists (`tests/contrast.test.js`, `e2e/touch-targets.spec.js`, `e2e/tape-mode.spec.js`, `e2e/layout.spec.js`). No test checks that scoring stays clear of `src/motion.js` and `src/graph.js`.
- `design/ash/` and `design/canvas/` stay historical. They are not served, not tested and not binding.
- ADRs [0009](0009-custom-themes.md), [0010](0010-background-image.md) and [0011](0011-offline-shell-and-fonts.md) stand. A new default font still follows 0011.
