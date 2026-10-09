---
name: Stilltype
description: Focused typing practice in Literata on warm near-black or warm paper, one green, and a static print of every run.
colors:
  ground: "#0f0f0e"
  ground-2: "#151514"
  raised: "#1c1b1a"
  raised-2: "rgba(255, 255, 255, 0.085)"
  text: "#ece8e1"
  muted: "#a39e96"
  hairline: "rgba(255, 255, 255, 0.075)"
  hairline-strong: "rgba(255, 255, 255, 0.15)"
  outline: "#7d7972"
  accent: "#8fd18a"
  accent-ink: "#0f1a0e"
  accent-soft: "rgba(143, 209, 138, 0.13)"
  danger: "#ff8a6b"
  danger-soft: "rgba(255, 138, 107, 0.16)"
  warning: "#e0b565"
  selection: "#34322e"
  ghost: "#b9c3ff"
  card-top: "#1f1e1c"
  card-bottom: "#121211"
  ground-light: "#f4f1eb"
  ground-2-light: "#ece8e0"
  raised-light: "#fbf9f5"
  raised-2-light: "rgba(27, 26, 25, 0.07)"
  text-light: "#1b1a19"
  muted-light: "#6b665e"
  hairline-light: "rgba(27, 26, 25, 0.1)"
  hairline-strong-light: "rgba(27, 26, 25, 0.2)"
  outline-light: "#857f75"
  accent-light: "#2e7d4f"
  accent-ink-light: "#fbf9f5"
  accent-soft-light: "rgba(46, 125, 79, 0.11)"
  danger-light: "#b4432c"
  danger-soft-light: "rgba(180, 67, 44, 0.12)"
  warning-light: "#8a5a00"
  selection-light: "#e3dccf"
  ghost-light: "#4f5bc4"
  card-top-light: "#fffdf9"
  card-bottom-light: "#efeae1"
typography:
  numeral:
    fontFamily: "Literata, Iowan Old Style, Palatino Linotype, Palatino, Book Antiqua, Georgia, serif"
    fontSize: "132px"
    fontWeight: 300
    lineHeight: 0.9
    letterSpacing: "-0.04em"
    fontFeature: "tnum, lnum"
  display:
    fontFamily: "Literata, Iowan Old Style, Palatino Linotype, Palatino, Book Antiqua, Georgia, serif"
    fontSize: "48px"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  live-stat:
    fontFamily: "Literata, Iowan Old Style, Palatino Linotype, Palatino, Book Antiqua, Georgia, serif"
    fontSize: "48px"
    fontWeight: 300
    lineHeight: 1
    letterSpacing: "-0.035em"
    fontFeature: "tnum, lnum"
  passage:
    fontFamily: "Literata, Iowan Old Style, Palatino Linotype, Palatino, Book Antiqua, Georgia, serif"
    fontSize: "36px"
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: "-0.004em"
  title:
    fontFamily: "Literata, Iowan Old Style, Palatino Linotype, Palatino, Book Antiqua, Georgia, serif"
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  lead:
    fontFamily: "Literata, Iowan Old Style, Palatino Linotype, Palatino, Book Antiqua, Georgia, serif"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "Literata, Iowan Old Style, Palatino Linotype, Palatino, Book Antiqua, Georgia, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
  small:
    fontFamily: "Literata, Iowan Old Style, Palatino Linotype, Palatino, Book Antiqua, Georgia, serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.04em"
rounded:
  sm: "6px"
  md: "10px"
  control: "12px"
  lg: "16px"
  xl: "22px"
  full: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
  "14": "56px"
  "16": "64px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "0 20px"
    height: "44px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 20px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.raised-2}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "0 20px"
    height: "44px"
  button-ghost-hover:
    backgroundColor: "{colors.raised-2}"
    textColor: "{colors.text}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "0 20px"
    height: "44px"
  button-danger-hover:
    backgroundColor: "{colors.danger-soft}"
  input:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "44px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "44px"
  nav-item-active:
    textColor: "{colors.text}"
  segmented-option:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    padding: "0 15px"
    height: "36px"
  dock:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    padding: "6px 6px 6px 20px"
    height: "58px"
  run-card:
    backgroundColor: "{colors.card-top}"
    textColor: "{colors.text}"
    rounded: "{rounded.xl}"
    padding: "22px"
  toast:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "6px 6px 6px 18px"
---

# Design System: Stilltype

## Overview

**Creative North Star: "Afterimage"**

The typing passage is the screen. Everything readable is set in one book face, Literata, on a warm near-black ground (or warm paper in light), so a passage reads like a page and a result reads like a print rather than a dashboard. One green carries every meaning of "act here" or "you are here": the caret, the primary button, the current selection and the timer. Content sits on hairline rules and open space. Boxes are kept for the few things that really are objects: the floating dock, the settings popover, the command palette, dialogs, toasts, and the run card.

Motion is governed by "still run". While a run is in progress, nothing decorative moves near the passage. The caret is a solid spring-driven bar, letter states change instantly, lines scroll in about 150 ms, and the chrome fades out after the first keystroke. Motion belongs to chrome and to the time after a run: short fades, one gliding selection pill, and the run card's speed graph drawing once in about 450 ms. Every duration comes from one scale that drops to zero under reduced motion.

Density is low and deliberate. The practice screen centres the passage with the numbers above it and a small set of controls. Results, progress and challenge are single editorial columns separated by rules. The name "Stilltype" is a working title, so the wordmark stays a cheap italic word plus a green full stop.

**Key Characteristics:**
- Literata for everything readable, including the passage and every numeral; Geist Mono only for small measurement labels, conditions and keys.
- Dark (default) and light theme sets; the theme follows the system until the user picks one.
- One green accent; coral for mistyped letters and regressions; amber for interrupted and mixed results.
- Rules and space instead of boxes; opaque raised surfaces with a single soft float shadow; no glass, no glow.
- Still run: the passage area stays motionless apart from the caret and line scroll.
- Results are a static print: a run card with a plain speed-over-time graph drawn from the real keystrokes.

## Colors

A warm, low-chroma neutral ramp with one green and one coral. The palette is defined twice, once for dark (`:root`, `[data-theme="dark"]`) and once for light (`[data-theme="light"]`), with identical token names. Frontmatter keys ending in `-light` are the light-theme values of the same token.

### Primary
- **Afterimage Green** (accent): the only action and current-state colour. It fills the primary button, colours the caret, the timer, the progress line, the selected palette dot, the pressed on-screen key, improved comparison figures and the evidence counts on the recommendation. Focus rings on inputs use its soft tint (accent-soft). Text on a green fill uses accent-ink.

### Secondary
- **Ember Coral** (danger): mistyped letters, the blocked caret, regressions, destructive actions and field errors. It is always paired with a second cue (a tint or a word) and never used alone.
- **Lamp Amber** (warning): interrupted runs and mixed comparison outcomes only.

### Tertiary
- **Ghost Periwinkle** (ghost): used only for the hidden ghost pacer: its caret, its palette entry and its toast mark. It never appears anywhere else.

### Neutral
- **Warm Near-Black / Warm Paper** (ground): the page.
- **Deep Ground** (ground-2): a quieter second ground.
- **Raised Stock** (raised): opaque surfaces: dock, settings popover, palette, dialog, toasts, inputs.
- **Raised Wash** (raised-2): the translucent hover and selection wash under nav items, ghost buttons, the gliding pill and the palette highlight.
- **Bone** (text): primary text and correctly typed letters.
- **Pumice** (muted): untyped passage letters, secondary copy, labels and inactive navigation.
- **Hairline / Strong Hairline**: rules between sections and rows (hairline), and the borders of raised surfaces, keys and secondary buttons (hairline-strong).
- **Field Outline** (outline): input borders.
- **Card Stock** (card-top to card-bottom): the run card's 165-degree gradient, a subtle paper-stock sheen that sits only on that card.

### Named Rules
**The One Green Rule.** Green means "act here" or "you are here" and nothing else. There is exactly one filled-green control per view: the primary button. Secondary controls get a neutral focus ring, so they never read as a second primary.

**The Two-Cue Rule.** Coral never carries meaning alone. A mistyped letter is coral text with a coral tint behind it; a mistyped space shows the tint at full line height.

**The Tokens-Only Rule.** Every colour comes from a CSS variable defined in both theme blocks. Add a token to both themes before using a new value.

## Typography

**Display Font:** Literata (self-hosted variable woff2, weights 300–700, roman and italic, optical sizing on), falling back to Iowan Old Style, Palatino and Georgia.
**Body Font:** Literata, the same stack.
**Label/Mono Font:** Geist Mono (self-hosted, 400 and 500), falling back to ui-monospace.

**Character:** A book face used for everything a person reads, including large light numerals, beside a small mono voice that only ever measures. The serif makes the passage feel like prose; the mono makes conditions and keys feel like instrument readings.

### Hierarchy
- **Numeral** (300, 132px, 0.9, -0.04em; 112px under 760px): the WPM figure on the run card. Tabular lining figures.
- **Display** (400, 48px, 1.05–1.08, -0.025em; 38px under 760px): screen headings on practice sessions and results.
- **Live stat** (300, 48px, 1, -0.035em; 40px under 760px): the live WPM, accuracy and timer, baseline-aligned with a mono unit.
- **Passage** (400, 36px at the default "medium" setting, line height 1.75, -0.004em, ligatures off): the typing text. The settings give 29px, 36px or 44px on desktop, and 22px, 26px or 32px under 760px. Three lines are visible, with the top and bottom edges faded by a mask.
- **Title** (400, 30px, 1.2, -0.015em): section headings (comparison, recommendation, empty states, challenge panels).
- **Body** (400, 17px, 1.6): running copy, capped at 56–60ch.
- **Small** (400, 15px): notes, help lines, toasts, and settings labels. Italic Literata marks quiet asides (input help, metric note, "versus", empty palette).
- **Label** (Geist Mono 500 or 400, 12px, 0.02–0.04em, lowercase): measurement units, conditions lines, facts labels, dates, palette group names, key legends, the footer.

Weights in use are 300 (large numerals), 400 (headings and text), 500 (buttons, wordmark) and 600 (primary button, settings row labels). Headings are regular weight, never bold.

### Named Rules
**The Book-Face Numerals Rule.** Every metric is set in Literata with tabular lining figures (`.num`). Geist Mono sets only the unit or label beside it, never the number.

**The Measuring Mono Rule.** Geist Mono appears at 12–13px for labels, conditions and keys. It is never used for headings, body copy or buttons.

**The Lowercase Chrome Rule.** Chrome labels (dock, settings, palette, mono labels) are lowercase. Headings and buttons use sentence case. Nothing is uppercase.

## Layout

A single centred column, `min(1080px, 100% - 48px)` wide (100% - 32px under 760px), in a three-row grid of dock, screen and footer. Screens open with 56px top padding (32px on mobile).

- **Practice:** the passage block is vertically centred in the viewport. Above it, a centred row of segmented controls; then a measure row of numbers (and, for drills and retests, the heading block) closed by a hairline rule; then the three-line passage, a 2px progress line, and a footer of help text and actions. A mono shortcut row and an optional on-screen keyboard sit below.
- **Results:** a two-column grid (run card 320–400px, copy fluid, 64px gap). The run card is sticky at 104px from the top. Under 900px it stacks, with the card centred at up to 420px, and it stops sticking when the viewport is shorter than 720px.
- **Progress / Challenge:** heading row, then hairline-separated rows on fixed column grids that collapse to two columns under 900px and 760px.
- **Spacing:** a 4px-based scale (4, 8, 12, 16, 24, 32, 40, 56, 64). Section breaks are 32px of padding above a hairline rule. Row padding is 12px (evidence) or 24px (history, race results).
- **Breakpoints:** 900px (results and tables stack), 760px (dock moves to the bottom, keyboard and shortcuts hidden, type steps down), 360px (nav tightens), max-height 720px (run card un-sticks). Coarse pointers keep a 44px minimum target, checked for every visible control by `e2e/touch-targets.spec.js`; text-sized controls (the footer link, plain disclosures) reach it with a transparent `::after`, so neither the text nor the focus ring moves.

### Named Rules
**The Rules-Not-Boxes Rule.** Sections are separated by a 1px hairline and space, never by a card. If a region is not a floating object or the run card, it has no background and no border box.

**The Step-Back Rule.** While a run is in progress (`body[data-running="true"]`), the dock, controls, shortcuts and footer fade to zero opacity and stop taking pointer input unless they hold focus. Only the passage and the numbers remain.

## Elevation & Depth

The page is flat. Depth appears only where an object floats over the page: the dock, the settings popover, the palette, the clear-history dialog, the challenge handoff card and toasts. These are opaque raised stock with a strong hairline border and one shared soft shadow. There is no backdrop blur and no translucency on surfaces. Modal backdrops are a flat dim (black at 42–50% in dark, warm brown at 22% in light). Keycaps (`kbd`, on-screen keys) get physical depth from a thicker bottom border (2px and 3px). This is the key's own material, not a shadow style.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35)` dark; `0 8px 24px rgba(70, 56, 30, 0.12)` light): every floating surface, and only those.
- **Switch thumb** (`box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3)`): the toggle knob only.

### Named Rules
**The Opaque Float Rule.** A surface that floats is opaque raised stock plus the float shadow. It has no glass, no blur behind it and no coloured glow.

## Shapes

Softly rounded, never pill-shaped except for switches and dots. Controls (buttons, inputs, nav items, icon buttons, segmented frames, the gliding pill and palette rows) use a 12px corner, and segment buttons inside a segmented frame use 10px. Popovers, toasts and the dock use 16px; the palette, dialog and run card 22px. Switches, dots, the caret bar and the 2px lines (progress, ghost) take the full round. Letter tints use 6px and keycaps 10px. Every corner comes from the `--radius-*` tokens; there are no raw radii. Borders are always 1px hairlines. The only drawn geometry is the chevron on the "drill something else" disclosure (a rotated 1.5px corner) and the line icons (19px, 1.6 stroke, round caps).

## Components

### Buttons
Quiet and confident: one filled green button, and everything else recedes.
- **Shape:** gently rounded (12px), 44px tall (34px for the small size), 16px Literata at weight 500.
- **Primary:** accent fill, accent-ink text, weight 600. On hover, the fill mixes 12% toward the text colour.
- **Secondary:** transparent with a strong hairline border; raised-wash fill on hover.
- **Ghost:** muted text, no border; text brightens and gains the raised wash on hover.
- **Danger:** coral text with a 40% coral border; coral tint on hover. A ghost button with coral text is used for quiet destructive actions.
- **Press / Disabled:** scale 0.98 on press, over 150ms; 38% opacity when disabled.
- **Focus:** a neutral 2px ring in the text colour, 3px offset, on every control.

### Segmented controls and the gliding pill
Mode and length pickers are a 14px frame with a hairline border, holding 36px Literata options (13px Geist Mono for numeric lengths). The selected option's text turns to the text colour, and a raised-wash pill glides under it with a transform-only 200ms slide. The same pill marks the current dock item. The palette highlight glides the same way, vertically, in 150ms.

### Inputs / Fields
- **Style:** raised fill, 1px outline border, 12px corners, 44px tall, 16px text.
- **Focus:** the border turns accent and gains a 3px accent-soft ring.
- **Error:** a coral border (`aria-invalid`) and a 14px coral message below.
- **Switch:** a 38×22 track (hairline-strong, accent when on) with a text-coloured knob that slides 16px.

### Navigation (the dock)
A floating, opaque 58px bar with 18px corners, sticky at the top on desktop and fixed to the bottom under 760px (62px, full width, with safe-area padding). It holds the italic wordmark and green full stop, four lowercase nav items (muted, text colour on hover and when active, with the gliding pill), a hairline separator, a labelled settings control (icon and lowercase "settings"; icon only below 900px, so the centred dock clears the account button) and the ⌘K / Ctrl-K palette trigger, shown as a search icon at every width. The account button sits apart from the dock, top right. The settings popover is a 340px raised panel of 52px rows, anchored to the dock's right edge: below it on desktop, above it on mobile.

The footer holds the personal best, the guest note and a quiet "suggest a feature" link (mono label, hairline underline). It opens a dialog of the same raised stock as the clear-history dialog: a sentence-case heading, a note on what is stored, a textarea with a mono character count, and Cancel / Send suggestion (filled green). Success closes it and shows a toast; failure keeps the text and explains in coral below the field.

### Status words
A 7px dot in the current colour, followed by a lowercase 12px mono word, coloured by meaning (accent, warning, danger, muted). These are never boxed.

### Progress, recurring patterns and daily challenge

Progress keeps the editorial column: condition/period fields, two charts, run rows, then drill/retest rows, all separated by space and rules. Corrected WPM uses the green line; accuracy uses the neutral text line. Axis labels show each chart's scale. Chart points have 44px hit areas (48px on coarse pointers, where the axis labels let taps through), narrowed to the gap between neighbouring points when runs are dense so a tap always opens the point under it; the run rows below are the full-size equivalent. Points have keyboard activation and accessible labels that open the corresponding run. Charts stack on mobile and redraw at the available width. Run and comparison disclosures expose their details without adding cards.

The training memory section sits below the existing drill actions. Pair headings and counts use Literata; each row offers a neutral bordered button to practice the target again. Sample counts, matching conditions, last practice and later fresh observations stay adjacent to the target.

Challenge opens with the daily passage and its one filled-green action, followed by the shared-keyboard section with a neutral Start button. The daily date/reset uses the existing condition label; result history uses hairline-separated rows. First and repeat attempts, previously displayed passages and input classes are written explicitly.

Below 360px, the run-card WPM uses `--text-numeral-narrow` (80px); the existing mobile size is now `--text-numeral-mobile` (112px).

### Typing zone (signature)
Three passage lines are visible, with 12–16px mask fades at the top and bottom. Untyped letters are muted, correct letters are text-coloured, and wrong letters are coral with a tint (no underline). The caret is a 3px accent bar driven by a stiff spring (stiffness 1400, damping 70). It breathes (opacity to 0.25 over 1300ms) only while idle, drops to 35% when unfocused, turns coral when blocked, and disappears at the finish. Line changes translate the passage over 150ms. The optional ghost pacer is a 2px periwinkle bar at 70% opacity.

### Run card (signature)
A static print: 22px corners, 22px padding, a strong hairline border, and the card-stock gradient. From top to bottom it holds a mono date stamp, the 16:9 speed graph (an SVG line chart: a 2px accent line of wpm per second, averaged over a trailing three seconds; a dotted muted line at the final wpm; coral dots on the line where mistakes happened; hairline gridlines at 0, half and top with 12px mono labels, and a mono time axis), a one-line mono legend, which draws once over about 450ms (`--dur-develop`), the numeral WPM with a mono unit, a three-column facts list (mono labels, 24px Literata values), an italic 13px metric note, and the mono conditions line. It does not tilt, shine or animate after the graph has drawn.

### Command palette
A 600px opaque raised panel with 22px corners over a flat dim. It has a 62px search row (19px input) and 46px option rows with a 6px state dot (accent when selected). Mono group labels and mono hints sit on the right. It enters and exits with a 4px lift and fade over 150ms.

### Toasts
Opaque raised pills of 16px radius at the bottom centre, with a status dot and 15px text, rising 6px over 200ms.

## Do's and Don'ts

### Do:
- **Do** take every colour, size, radius, duration and easing from the CSS variables at the top of `src/styles.css`, and define new colour tokens in both the dark and light blocks.
- **Do** set every readable word and every number in Literata, with tabular lining figures on metrics. Keep Geist Mono to 12–13px labels, conditions and keys.
- **Do** keep exactly one filled-green primary action per view. All other actions are secondary, ghost or danger.
- **Do** separate sections with a 1px hairline and 32px of space.
- **Do** pair coral with a second cue: a tint or a word.
- **Do** drive every duration from the `--dur-*` scale (80, 150, 200, 250, 350ms × `--motion-scale`) with the `--ease-out` curve (`cubic-bezier(0.22, 1, 0.36, 1)`), so reduced motion takes them all to zero.
- **Do** keep chrome fades at 200ms or less, and animate the selection pill by transform only.
- **Do** keep chrome labels lowercase and headings and buttons in sentence case.

### Don't:
- **Don't** move anything decorative near the passage while a run is in progress. Letter states change instantly; only the caret spring and the ~150ms line scroll move.
- **Don't** reintroduce the effects removed after the critique: a streak glow or caret aura, a letter ink trail (letters landing lit and cooling), an error shake, digit pop-ins or number reels, a word underline or lens sweeping through the glyphs, run-card tilt, glare or foil, glass surfaces, a live rhythm strip, or blur reveals on restart and results.
- **Don't** use backdrop-filter, translucent surfaces or coloured glows. Floating surfaces are opaque raised stock with the one float shadow. (The challenge handoff's blurred passage veil is a concealment device that hides the next player's text. It is not a reveal effect and must not spread elsewhere.)
- **Don't** add kickers or eyebrows above headings, and don't use uppercase tracked labels.
- **Don't** add a second accent. Periwinkle belongs to the ghost pacer alone, and amber to interrupted and mixed results alone.
- **Don't** box ordinary sections as cards. The run card is the one card.
- **Don't** move the app back toward the retired Ash system: no blue call to action, no Geist sans, no dark-only rule, no mono status pills.
- **Don't** invest in the wordmark. "Stilltype" is a working title, and the brand stays an italic word and a green full stop.
