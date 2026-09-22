# ash — DESIGN.md

Dark-only, tonal, minimalist system for developer tools and data-dense dashboards. Named for its warm charcoal neutrals. Mint green for success state, one saturated blue for primary actions.

## 1. Visual theme & atmosphere
Quiet, precise, warm. Depth comes from stepping surface tone, not borders or shadows. Nothing glows, nothing bounces — except the typing zone (§6). Monospace carries data and metadata; sans carries everything you read. Feels like Linear's precision on Notion's warmth, with Resend's mono accents.

## 2. Color palette
Base (given)
- text `#E8E5DF` · muted `#A39E96` · faint `#6F6B65` (decorative only) · outline `#7D7972` · selection `#4A463F`
- primary `#0075DE` (CTA fill, white text) · link/focus blue `#4DA3F5`
- mint/success `#8FD18A` · danger `#E8907C` · warning `#E0B565` · scrim rgba(0,0,0,.55)

Surface ladder (derived, warm)
- 0 canvas `#141311` · 1 panel `#1A1917` · 2 card/input `#22211E` · 3 raised/menu `#2A2926` · 4 pressed `#33312D`

Rules
- One primary-blue fill per view. Mint is state, never a button. Danger/warning are ink or 14% tints, never fills.
- Hairline border (outline @22%) only on inputs and as the 1px ring inside popover shadows.
- Hover +4% light overlay or one ladder step; pressed +8%. Focus: 2px canvas gap + 2px `#4DA3F5`.

Code palette (Tokyo Night hues, warm-tuned): keyword `#B49AE6` function `#7FA6F0` property `#7FC9F0` string `#A3C97A` number `#F0A06E` type `#DEB273` error `#EE7E8E` teal `#7CD3C2` comment `#6F6B65`. Log levels: debug tertiary, info cyan, warn yellow, error red with 10–12% line tint. Diff add/del at 12%.

## 3. Typography
- Sans: Geist. Mono: Geist Mono (data, ids, keys, shortcuts, uppercase eyebrows — never prose).
- Scale: 12 / 13 / 14 (UI default) / 16 (reading, mobile) / 18 / 22 / 28 / 36. Weights 400/500/600.
- Headings ≥22px: −0.02em. Eyebrows: 11px mono, uppercase, +0.04em, muted.
- Sentence case everywhere. Tabular numerals on every metric.

## 4. Spacing, layout & shape
- 4px base. Controls 28 / 32 (default) / 40; 44 touch minimum. Sidebar 240; content max 1200; reading 68ch.
- Radius: 4 chips · 6 buttons/inputs/menu rows · 8 cards/popovers · 12 dialogs/sheets · pill for status & switches.
- Layout is block-based: panel on surface-1, content on canvas, cards on surface-2. Fixed sidebar desktop; bottom tab bar mobile.

## 5. Components
- **Button** primary (blue) / secondary (surface-3, default) / ghost (dense chrome) / danger (coral text on surface-3). 32px, 13/500, icons 16 @ 8 gap.
- **Input/Select** surface-2 + hairline; focus blue border + 3px 14% glow; error coral border + hint.
- **Checkbox/Radio/Switch** 16px (switch 32×18), checked = blue with white mark.
- **Badge** status pill: mono 12, 14% tint, full-opacity dot + text. Tag: sans, radius 4, surface-3.
- **Card** surface-2, radius 8, 16–18 padding, no border/shadow.
- **Tabs** underline (2px text-colour bar) for sections; segmented (surface-2 track, surface-4 thumb) for view toggles.
- **Tooltip** surface-3 + popover shadow, 12px, 300ms delay.
- **Dialog** surface-3 on 60% scrim, radius 12, max 420, Cancel left, destructive confirms typed.
- **Toast** bottom-right, 8px status dot (no icon), ≤1 action, 5s.
- **Menu** 220px, 32px rows, mono kbd right, danger item last after hairline.
- **Command palette** ⌘K, 520px, 48px borderless input, grouped results with match bolded inline.
- **List row** whole row is the target; one contextual action revealed on hover; building dots pulse (the only ambient motion).
- **Mobile** dot + two-line rows, bottom sheet with 48px primary action, wordmark centred but content left-aligned.

## 6. Motion
120ms hover/press · 180ms reveal · 260ms dialogs. `cubic-bezier(.2,0,0,1)`. Fades and ≤8px translates. No springs, no scale.

**Exception: the typing zone** (the passage in practice, drill, retest and local challenge; `src/motion.js` + the typing block in `src/styles.css`). Agreed September 2026 so that typing feels smooth and lighthearted. Nowhere else may use it.
- Caret: a 3px pill in focus blue with a soft glow. It moves on a near-critically damped spring, breathes while idle, turns danger and wobbles once when you mistype. It dims when the input loses focus.
- Word lens: a surface-2 pill behind the word being typed, gliding between words on a spring.
- Letters: a correct letter lights up in the caret colour in place, then cools to ink over 620ms. Letters never move vertically. At speed this leaves a comet tail behind the caret. Misses flash a stronger danger tint, then rest at the 14% tint and keep the underline.
- Heat: `--heat` (0–1) follows the current clean streak (full at 40). It shifts the caret, lens, light and progress bar from focus blue toward mint and brightens a radial light under the caret. This is the only gradient in ash. There is never a streak number during a run.
- Lines scroll with `cubic-bezier(.16,1,.3,1)` over 460ms behind a 12px edge mask. New passages fade in word by word, staggered at most 250ms. Input is never delayed.
- Reduced motion: the springs snap, and there is no wobble, rise or breathing. Colour state changes remain.

## 7. Voice
Sentence case, plain, second person, present tense. Buttons are verbs. No emoji, no exclamation marks. Status is a mono pill, not a sticker.

## 8. Don'ts
Gradients · textures · photos · red-filled buttons · mint on buttons · Title Case · borders on cards · shadows on anything that isn't floating · syntax colour on more than ~60% of a line.

Files: `styles.css` → `tokens/*`; `components/components.css`; specimens in `guidelines/` and `components/`; mocks `Deployments Mock.dc.html`, `Deployments Mobile.dc.html`.
