# 0002. Afterimage replaces Ash as the design system

Status: Accepted, 2026-09-22. Supersedes the visual-system paragraph of [0001](0001-native-browser-stack-and-learning-loop.md).

## Context

The app first followed the Ash system: Geist sans, dark only, a blue call to action, and green kept for success. The 22 September 2026 redesign replaced it with Afterimage.

## Decision

Afterimage, as described in `DESIGN.md` and the tokens at the top of `src/styles.css`, is the binding visual system. Literata is used for everything readable, on warm near-black or warm paper. There is one green accent, which also fills the primary button. Rules and space are used instead of boxes, and motion is fluid.

`design/ash/` and `design/canvas/` stay in the repo as historical reference only. They are not served, not tested and not binding.

## Consequences

- No blue call to action, no Geist sans, no dark-only rule, and no mono status pills. Green is no longer "success only, never a button fill".
- New colours, sizes, radii, durations and easings become tokens before they are used.
