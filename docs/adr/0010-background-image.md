# 0010. The background image stays on the device and never costs legibility

Status: Accepted, 2026-10-24. Carried over from `HANDOFF.md`'s decisions to preserve.

## Context

People can put a picture behind the app. It must not leak into the account, and it must not make the passage, a mistyped letter or the caret hard to read.

## Decision

- **Storage.** The image stays on the device (IndexedDB, never the profile). It is stored in colour as a WebP of at most 1024 px. One picked before background styles existed is a grey copy, and shows grey until it is picked again. Its style (regular, dither or gradient), blur (0–32 px), opacity (10–100%) and height (0–100%) are device settings stored beside it, never in the profile. They show only once there is an image.
- **Running.** It fades out at the countdown and dims mid-run (`e2e/wallpaper.spec.js`).
- **Style.** Dither is the default and is tinted by CSS from the theme, so blur means nothing there and is disabled.
- **Height.** Height moves where the fade ends on the practice screen. At 0 it ends at the top of the reading band (countdown, passage and controls), and at 100 at the bottom of the screen. Other screens keep 0.
- **No cutout.** Above 0 the picture runs on behind the passage, the hints and the footer, with no hole cut around them (Toby, 2026-10-23: the old cutout looked like a gap).
- **Halo.** Wherever the picture would push a letter, a mistyped letter on its tint, or the caret below the contrast floor, that region (live figures, passage, key hints, footer items) gets `data-halo`. That is a `--wallpaper-halo` stroke in `--ground` under each letter. The floor is WCAG relative luminance at the worst pixel under each region, counting style, tint, blur, opacity, height and the mid-run dim. The caret stays bare (Toby, 2026-10-24: "the caret should stay bare"). The halo comes off where the picture is quiet or the dim makes it unnecessary.
- **Cost.** The halo is worked out from the pixels `wallpaper.js` already drew, whenever the image, look, theme, layout or running state changes, and never per keystroke. Blur, opacity and height are CSS on the layer, so a slider never redraws. The dither mask and gradient wash are drawn once per pick or style, and again only when the screen's size in cells changes.

## Consequences

`e2e/wallpaper.spec.js` checks the floor at full height over the brightest image in every theme, viewport and style. It also checks that nothing is outlined over a quiet image, and that the picture is continuous behind the text (Toby, 2026-10-24: "letters get a black outline or some outline to make sure that there's contrast").
