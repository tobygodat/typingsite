# 0026. Obsidian, Ceramic and Slate themes, with Inter as the default font

Status: Accepted, 2026-11-25. Supersedes [0011](0011-offline-shell-and-fonts.md).

## Context

Toby approved the Stilltype v4 studio look. It sets the passage and the app in Inter on a neutral near-black ground with one viridian accent, and on a cool off-white ground in light. [ADR 0011](0011-offline-shell-and-fonts.md) made Literata and Geist Mono the only fonts that load by default and the only fonts the worker precaches. A new default font has to replace that decision, as [ADR 0017](0017-design-note-keeps-floors-only.md) notes.

## Decision

- `sw.js` stays network-first. `bun run build` stamps a new cache name per build. This part of 0011 is unchanged.
- Inter is the default typing font and the default app font (`DEFAULT_FONT` in `src/fonts.ts`). Only Inter and Geist Mono load by default, and only their files are precached (`tests/sw.test.js`). Literata stays a choice for both fonts. Like every other choice, it loads when picked and is cached once used.
- Carets stand on the typing font's measured baseline (`--typing-baseline`). The token's starting value is Inter's, 0.364em, from its hhea ascent and descent. `src/display-preferences.ts` measures the font in use, so no font is assumed to share Inter's metrics.
- The `dark` theme is Obsidian, the `light` theme is Ceramic, and `slate` is a new dark theme. The theme ids stay the same, so a stored pick of `dark` or `light` shows the new look, and every other stored pick is kept. There are 11 built-in themes. Each one holds the contrast floors in `tests/contrast.test.js`.
- Buttons and frame controls press in to 97% while held, and the press is off under reduced motion. A pressed control keeps its resting hit area, so a press held at its edge still clicks it. Hover tints on those controls apply only on a fine pointer that can hover.

## Consequences

- Someone who never picked a font sees Inter after this change. Someone who picked Literata keeps it.
- The precached shell is about 1.39 MB smaller, from 3,310,423 bytes to 1,924,016. Inter's two files are about 100 KB and Literata's are about 790 KB, and the shell precaches each font twice, at `src/fonts/` and at its hashed `assets/` path.
- A new default font still needs its baseline measured and an ADR that supersedes this one.
