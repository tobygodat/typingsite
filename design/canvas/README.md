# Redesign canvas — reference copy

Snapshot of the Claude Design canvas "Stilltype landing redesign" (canvas version `1790045198-74b4`, 22 September 2026). It is **design reference, not application code** — nothing here is served, imported, or tested by the app.

The live canvas is a private Claude artifact at `https://claude.ai/artifact/BAMhpxFSnmbesLYFCyCqwo`. Only its owner can open it, which is why this copy exists: the direction has to be readable without it.

## The artboards

| File | Board | Size | Loop step |
| --- | --- | --- | --- |
| `Main.dc.html` | 01 · Practice | 1280×800 | play |
| `Results.dc.html` | 02 · Results | 1280×800 | identify |
| `Retest.dc.html` | 03 · Retest and progress | 1280×800 | measure |
| `Mobile.dc.html` | Mobile · practice | 390×844 | play, on touch |

`canvas.json` is the canvas index: frame positions, titles, and the record of the ash design system copied into the canvas.

## Reading the format

These are `.dc.html` files for the Design canvas runtime, not shippable pages:

- The visible UI is the markup inside `<x-dc>`.
- Design tokens are declared in `<helmet><style>` — each artboard inlines the full ash token set because the canvas does not serve `tokens.css`.
- Layout is inline styles. That is the canvas format's requirement (the properties panel edits inline styles), not a recommendation for the app.
- Component classes (`.btn`, `.badge`, `.tab`, `.tag`, `.kbd`, `.switch`, `.opt`, `.card`) come from ash's `components/bundle.css`, which the canvas serves at `ds/ash/components/bundle.css`. The repo's own copy of that CSS is `design/ash/components/components.css`.
- The trailing `<script type="text/x-dc">` block is canvas plumbing.
- `<script src="./support.js">` is the canvas runtime and is not present here.

To view one locally, serve this directory with `design/ash/components/components.css` available at `ds/ash/components/bundle.css`, add `x-dc{display:block} helmet{display:none}` and ignore the missing `support.js`.

## Status

Reviewed at 21/40 on 22 September 2026. The findings, including five that are visible in these files, are in `.impeccable/critique/2026-09-22T03-14-22Z__design-canvas-stilltype-landing-redesign.md`. Two are visible as artifacts in the markup itself: the empty `<span><br></span>` eyebrow above the keyboard heatmap in `Results.dc.html`, and 60 px of orphaned spacers in `Retest.dc.html` where a caption was deleted. Port the direction, not those defects.
