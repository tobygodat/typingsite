# ash

A dark-only, tonal, minimalist design system for developer tools, data-dense dashboards and mobile-first consumer apps. Named for its warm charcoal neutrals. Mint green is reserved for success state, a saturated blue for primary actions, coral and amber for danger and warning.

**Sources**
- Palette supplied by the user as a screenshot (`uploads/pasted-1790025299520-0.png`): text, muted, faint, outline, selection, accent, danger, warning, scrim.
- Inspiration compiled from https://github.com/voltagent/awesome-design-md — Linear (ultra-minimal precision), Vercel (monochrome discipline), Resend (dark + monospace accents), Supabase (dark green, code-first), Warp (block-based chrome), Notion (warm minimalism, soft tonal surfaces).
- No logo, product copy or codebase was provided. The wordmark is plain type.

## Content fundamentals

- **Sentence case, everywhere.** "Save changes", "3 open issues", "Environment variables". Never Title Case, never ALL CAPS in sans (uppercase is reserved for mono eyebrows).
- **Plain and direct.** Say what happens: "Deploy failed. Check the build log." Not "Oops! Something went wrong."
- **Second person, present tense.** "You can roll back from the deployments list." Avoid "we".
- **No emoji, no exclamation marks.** Status is a mono pill (`● ready`), not a sticker.
- **Numbers and identifiers are mono.** `dpl_8f3a2c9e · 41.2s`. Timestamps relative where possible ("2 min ago").
- **Buttons are verbs.** Deploy, Cancel, Save changes, Delete. Destructive verbs use danger text on a neutral surface, never a red fill.

## Visual foundations

**Color.** Nine given colors + a five-step warm surface ladder (#141311 → #33312D). Text is `#E8E5DF`, secondary `#A39E96`; `faint #6F6B65` is decorative only (dividers, disabled glyphs) — never for copy that must be read. Primary `#0075DE` (saturated blue, white text) is for one filled CTA per view; its lighter sibling `#4DA3F5` is for links and focus rings on dark — it exists so actions never share a color with status. Mint `#8FD18A` is success state only; never a button fill. The wordmark is "ash" with a primary-blue full stop. Danger `#E8907C` and warning `#E0B565` appear as full-opacity ink or 14% soft tints; never as filled buttons.

**Depth is tonal, not bordered.** Surfaces separate by stepping one rung up the ladder. Hairline borders (`--border-hairline`, outline at 22%) are allowed only on inputs and as the 1px ring inside popover/dialog shadows. Shadows exist only on floating layers (popover, dialog). Cards have no shadow and no border.

**Type.** Geist (sans) for all copy; Geist Mono for data, ids, keys, shortcuts and uppercase eyebrows — never for body prose. UI default 14px, reading 16px, mobile default 16px. Headings ≥22px carry −0.02em tracking. Weights 400/500/600 only.

**Spacing.** 4px base. Default control height 32px; 28px compact rows in tables; 44px minimum hit target on touch. Sidebar 240px; content max 1200px; reading max 68ch.

**Radius.** Soft: 4 (chips, checkboxes), 6 (buttons, inputs, menu rows), 8 (cards, popovers), 12 (sheets, mobile cards), pill for status and switches.

**Numbers.** All metrics, durations and counts use `font-variant-numeric: tabular-nums` so columns don't jitter.

**Rows are links.** In tables and lists the whole row is the target (cursor pointer, hover overlay, inset 2px blue focus ring); the row's one contextual action (Redeploy / Retry / Cancel) is a 28px icon button revealed on hover or focus, right-aligned. In-flight status dots pulse (1.2s, opacity 1 → .35) — the only ambient animation in the system.

**Interaction.** Hover = +4% light overlay or one surface step up; pressed = +8% or surface-4. No scale transforms. Focus = 2px canvas gap + 2px primary (blue) ring. Selection `#4A463F`.

**Motion.** 120ms hover/press, 180ms reveal/collapse, 260ms dialogs. `ease-out cubic-bezier(.2,0,0,1)`. Fades and short translates (≤8px). No bounces, no springs.

**Backgrounds & imagery.** Flat surface colors only — no gradients, no textures, no full-bleed photos. Blur and scrim (55% black) only behind dialogs and sheets.

**Layout.** Block-based: a panel (sidebar/toolbar) on surface-1, content on canvas, cards on surface-2. Fixed sidebar on desktop; bottom tab bar on mobile.

## Iconography

No icon set was supplied. Recommended: **Lucide** (1.5px stroke at 16px, 1.75px at 20px) via CDN — matches Geist's weight and the Linear/Vercel references. Icons take the text color of their row (`--text-secondary` at rest, `--text-primary` on hover/active). No emoji. Unicode `●` is used inside status pills; `⌘` `⇧` in shortcut chips.

## Intentional additions

- Surface ladder (`--ash-surface-0..4`) — derived from the supplied panel colors so the tonal (borderless) depth model has real steps.
- `--ash-primary #0075DE` + `--ash-primary-text #4DA3F5` + hover/pressed — added so CTAs are distinct from the green "ready" status. Mint stays for success only.

## Index

- `styles.css` — entry point; imports everything in `tokens/`.
- `tokens/colors.css` · `typography.css` · `spacing.css` · `radius.css` · `motion.css` · `fonts.css`
- `guidelines/` — 14 specimen cards (Colors, Surfaces, Type, Spacing, Motion, Brand).
- `tokens/code.css` — syntax, log-level, diff and ANSI colours (Tokyo Night–derived, warm-tuned).
- `components/` — 10 core component cards (Button, Input, Select, Checkbox/Radio, Switch, Badge, Card, Tabs, Tooltip) + `components.css`, a class-based reference implementation of all of them.
- `Deployments Mock.dc.html` — example dashboard screen (desktop) with live overlays.
- `Deployments Mobile.dc.html` — the same screen at phone width in an iPhone frame.
- `DESIGN.md` — portable single-file summary of the whole system (awesome-design-md format).
- `SKILL.md` — agent skill wrapper.
- Overlays built: Dialog, Toast, Dropdown menu, Command palette (`components/`).

## Mobile

- No sidebar: a 4-item bottom tab bar (82px incl. safe area, 90% canvas + blur) carries navigation. Wordmark centred in the top bar; page title and everything below it left-aligned — controls share the list's reading edge.
- Type scales up one step: body 15, title 26. Mono metadata stays 12.
- List rows collapse to **status dot + two lines** (title / mono meta); the status pill appears only in detail. Rows ≥44px, chevron in tertiary.
- Filters are the segmented control, left-aligned, horizontally scrollable.
- Row tap → **bottom sheet** on surface-3, radius 16 top, drag handle, one 48px primary action, secondary actions at 44px side by side (Delete stays danger-text on surface-4).
- Stats: two per row max.

## Code & log palette

`tokens/code.css`. Hues borrowed from Tokyo Night, re-tuned ~5° warmer and lower chroma so they sit on our warm surfaces instead of its blue-black. Surfaces and borders are **not** borrowed — neutrals stay warm. Rules: comments/timestamps/gutters are always tertiary; the value is primary; syntax colour never dominates a line. Log levels: debug tertiary, info cyan, warn yellow, error red with a 10–12% red tint on the whole line. Diff add/remove = green/red at 12%, hunk headers cyan. ANSI 16 derived from the same set. Specimens: `guidelines/code-*.html`; live use: the Logs view in the mock.

## Component rules

- **Button**: one `primary` per view. `secondary` (surface-3) is the default. `ghost` only inside dense chrome (toolbars, table rows). `danger` is coral text on surface-3 — never a red fill. Heights 28/32/40; icons 16px, 8px gap.
- **Input/Select**: surface-2 fill with a hairline border — the one place borders are allowed. Hover → outline strong; focus → blue border + 3px `--primary-soft` glow. Error → danger border + danger hint text. Mono font for keys/ids.
- **Checkbox/Radio/Switch**: 16px controls (switch 32×18); checked = primary blue with white mark. Labels are clickable. In settings, switches sit right-aligned in 40px rows (44px on touch).
- **Badge**: status pills are mono, pill radius, 14% tint + full-opacity dot/text. Tags are sans, 4px radius, surface-3. Counts are plain mono text, not badges.
- **Card**: surface-2, radius 8, 16–18px padding, no border, no shadow. Header row (title + status), body, right-aligned actions.
- **Tabs**: underline style for page sections (2px text-colored bar); segmented (surface-2 track, surface-4 thumb) for view toggles.
- **Dialog**: surface-3 on a 60% canvas scrim, radius 12, max 420px, 20–22px padding. Title 14/500, body secondary. Actions right-aligned, Cancel first. Destructive confirms name the noun and require typed confirmation; the danger button stays disabled until it matches.
- **Toast**: bottom-right stack, surface-3 + popover shadow, 8px status dot (no icon), title + one-line detail, ≤1 action. 5s auto-dismiss, paused on hover; in-flight toasts pulse their dot and show a mono timer.
- **Dropdown menu**: 220px, 4px padding, 32px items with 16px icons; kbd hints right in mono; groups get a mono-caps header; the danger item is always last after a hairline. Opens 120ms ease-out with 4px translate; closes instantly.
- **Command palette**: ⌘K, 520px, 48px borderless input, grouped results with the matched substring bolded (600) inline — never split or recoloured, footer kbd legend. Empty state is one line of text.
- **Tooltip**: surface-3 + popover shadow, 12px caption, optional `kbd`. 300ms delay, 120ms fade, ≤8px translate.
