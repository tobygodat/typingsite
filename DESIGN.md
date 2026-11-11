---
name: Stilltype
description: Focused typing practice in Literata on warm near-black or warm paper, one green, a caret that glides, and a print of every run.
colors:
  ground: "#0f0f0e"
  ground-2: "#151514"
  raised: "#1c1b1a"
  raised-2: "rgba(255, 255, 255, 0.085)"
  text: "#ece8e1"
  muted: "#a39e96"
  placeholder: "rgba(163, 158, 150, 0.8)"
  hairline: "rgba(255, 255, 255, 0.075)"
  hairline-strong: "rgba(255, 255, 255, 0.15)"
  outline: "#7d7972"
  accent: "#8fd18a"
  accent-ink: "#0f1a0e"
  accent-soft: "rgba(143, 209, 138, 0.13)"
  practice-level-1: "rgba(143, 209, 138, 0.3)"
  practice-level-2: "rgba(143, 209, 138, 0.55)"
  practice-level-3: "rgba(143, 209, 138, 0.8)"
  danger: "#ff8a6b"
  danger-soft: "rgba(255, 138, 107, 0.16)"
  heat-1: "rgba(255, 138, 107, 0.18)"
  heat-2: "rgba(255, 138, 107, 0.36)"
  heat-3: "rgba(255, 138, 107, 0.56)"
  warning: "#e0b565"
  selection: "#34322e"
  word-highlight: "rgba(236, 232, 225, 0.05)"
  ghost: "#b9c3ff"
  card-top: "#1f1e1c"
  card-bottom: "#121211"
  ground-light: "#f4f1eb"
  ground-2-light: "#ece8e0"
  raised-light: "#fbf9f5"
  raised-2-light: "rgba(27, 26, 25, 0.07)"
  text-light: "#1b1a19"
  muted-light: "#6b665e"
  placeholder-light: "rgba(107, 102, 94, 0.92)"
  hairline-light: "rgba(27, 26, 25, 0.1)"
  hairline-strong-light: "rgba(27, 26, 25, 0.2)"
  outline-light: "#857f75"
  accent-light: "#217245"
  accent-ink-light: "#fbf9f5"
  accent-soft-light: "rgba(46, 125, 79, 0.11)"
  practice-level-1-light: "rgba(46, 125, 79, 0.3)"
  practice-level-2-light: "rgba(46, 125, 79, 0.55)"
  practice-level-3-light: "rgba(46, 125, 79, 0.8)"
  danger-light: "#ad3d26"
  danger-soft-light: "rgba(180, 67, 44, 0.12)"
  heat-1-light: "rgba(180, 67, 44, 0.08)"
  heat-2-light: "rgba(180, 67, 44, 0.24)"
  heat-3-light: "rgba(180, 67, 44, 0.44)"
  warning-light: "#8a5a00"
  selection-light: "#e3dccf"
  word-highlight-light: "rgba(27, 26, 25, 0.05)"
  ghost-light: "#434db5"
  card-top-light: "#fffdf9"
  card-bottom-light: "#efeae1"
  finger-band: "rgba(255, 255, 255, 0.1)"
  finger-band-light: "rgba(27, 26, 25, 0.05)"
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
  cell: "2px"
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
  # The run print: one 900px card on card stock holding the score, the trace, the words and the actions.
  run-card:
    backgroundColor: "{colors.card-top}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "32px"
  toast:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "6px 6px 6px 18px"
  # Train's path: one 2px line of nodes. Behind you a 16px accent ring (drilled) or disc (fixed) on a solid accent
  # line; the open step a 24px accent ring holding a dot; ahead a 12px outline ring on a dashed hairline-strong line.
  path-node-behind:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.text}"
    rounded: "{rounded.full}"
    size: "16px"
  path-node-fixed:
    backgroundColor: "{colors.accent}"
    rounded: "{rounded.full}"
    size: "16px"
  path-node-current:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.text}"
    rounded: "{rounded.full}"
    size: "24px"
  path-node-ahead:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.muted}"
    rounded: "{rounded.full}"
    size: "12px"
---

# Design System: Stilltype

## Overview

**Creative North Star: "Afterimage"**

The typing passage is the screen. Everything readable is set in one book face, Literata, on a warm near-black ground (or warm paper in light), so a passage reads like a page and a result reads like a print rather than a dashboard. One green carries every meaning of "act here" or "you are here": the caret, the primary button, the current selection and the timer. Content sits on hairline rules and open space. Boxes are kept for the few things that really are objects: the floating dock, the settings dialog, the command palette, dialogs, toasts, and the run card.

Motion is fluid. It is welcome on the typing surface during a run as well as in chrome and after it, wherever it makes speed, position or progress easier to follow: the caret is a spring-driven bar, the pace caret glides through the letters at its speed, a ghost race glides from one of a friend's keys to the next, and lines scroll in about 150 ms. Nothing is required to stay rigid or static. Letter states still change at once so the passage stays readable, and the chrome fades out after the first keystroke. After a run there are short fades, one gliding selection pill, and the run card's speed graph drawing in about 450 ms. Every duration comes from one scale that drops to zero under reduced motion.

Density is low and deliberate. The practice screen centres the passage with the numbers above it and a small set of controls. Results, progress and challenge are single editorial columns separated by rules. The name "Stilltype" is a working title, so the wordmark stays a cheap italic word plus a green full stop.

**Key Characteristics:**
- Literata for everything readable, including the passage and every numeral; Geist Mono only for small measurement labels, conditions and keys. A person may pick another typing font (the passage) and app font (everything else Literata sets) in settings; Geist Mono stays.
- Dark (default) and light theme sets, plus eight more a person can pick (paper, shadcn, terminal, soft, midnight, swiss, e-ink, nord); four are dark and six light, and the theme follows the system, between a dark and a light pick, until the user sets a mode.
- One green accent; coral for mistyped letters and regressions; amber for interrupted and mixed results.
- Rules and space instead of boxes; opaque raised surfaces with a single soft float shadow; no glass, no glow.
- Fluid motion: carets glide, lines scroll, and motion may live on the typing surface when it helps someone follow the run.
- Results are a print: a run card with a plain speed-over-time graph drawn from the real keystrokes.

## Colors

A warm, low-chroma neutral ramp with one green and one coral. The palette is defined once per theme, with identical token names: dark (`:root`, `[data-theme="dark"]`), light (`[data-theme="light"]`) and the eight others (`[data-theme="paper"]` … `[data-theme="nord"]`). Frontmatter keys ending in `-light` are the light-theme values of the same token; the other themes' values live only in `src/styles.css`. Every theme holds a contrast floor against what is behind it, translucent washes and mistyped-letter tints included (`tests/contrast.test.js`): text at least 4.5:1, and the caret, the ghost caret, the text-coloured focus ring, the accent border of a focused input and input outlines at least 3:1. Disabled controls, the blurred challenge-handoff veil, the dimmed idle and unfocused caret, and the caret over a background image raised behind it are deliberate exceptions. A background image the person raises behind the passage is never cut out around the text; wherever it would take the letters, a mistyped letter on its tint or the caret below the floor, that region (the passage, the live figures, the hints, the footer) gets a thin outline in the ground colour (`--wallpaper-halo`, a stroke under each letter), so the letters' floor holds at any height.

### Primary
- **Afterimage Green** (accent): the only action and current-state colour. It fills the primary button, colours the caret, the timer, the progress line, Train's path behind you and its open step, the selected palette dot, the pressed on-screen key, improved comparison figures and the evidence counts on the recommendation. Focus rings on inputs use its soft tint (accent-soft). Text on a green fill uses accent-ink. The practice calendar on Progress steps it at 30%, 55% and 80% (practice-level-1 to 3) and then full accent; days without practice sit on the hairline, and days that met the goal also carry a small accent-ink centre dot so they never rest on colour alone.

### Secondary
- **Ember Coral** (danger): mistyped letters, the blocked caret, regressions, destructive actions and field errors. It is always paired with a second cue (a tint or a word) and never used alone. Three coral heat tints (heat-1 to heat-3) shade only the Progress key heatmap, where each shaded key also prints its miss rate and a legend names the steps.
- **Lamp Amber** (warning): interrupted runs and mixed comparison outcomes only.

### Tertiary
- **Ghost Periwinkle** (ghost): used only for ghost carets — the hidden ghost pacer (its caret, its palette entry and its toast mark) and a friend's recorded run in a ghost race. It never appears anywhere else.

### Neutral
- **Warm Near-Black / Warm Paper** (ground): the page.
- **Deep Ground** (ground-2): a quieter second ground.
- **Raised Stock** (raised): opaque surfaces: dock, settings dialog, palette, dialog, toasts, inputs.
- **Raised Wash** (raised-2): the translucent hover and selection wash under nav items, ghost buttons, the gliding pill and the palette highlight.
- **Bone** (text): primary text and correctly typed letters.
- **Pumice** (muted): untyped passage letters, secondary copy, labels and inactive navigation.
- **Placeholder**: input placeholder text, a translucent muted (80% in dark, 92% in light) so it stays quieter than typed text.
- **Word Wash** (word-highlight): the optional current/next-word tint, the text colour at 5% (`color-mix(in oklab, var(--text) 5%, transparent)`).
- **Hairline / Strong Hairline**: rules between sections and rows (hairline), and the borders of raised surfaces, keys and secondary buttons (hairline-strong).
- **Field Outline** (outline): input borders.
- **Card Stock** (card-top to card-bottom): the run card's top-to-bottom gradient, a subtle paper-stock sheen that sits only on that card.

### Named Rules
**The One Green Rule.** Green means "act here" or "you are here" and nothing else. There is exactly one filled-green control per view: the primary button. Secondary controls get a neutral focus ring, so they never read as a second primary.

**The Two-Cue Rule.** Coral never carries meaning alone. A mistyped letter is coral text with a coral tint behind it; a mistyped space shows the tint at full line height.

**The Tokens-Only Rule.** Every colour comes from a CSS variable defined in every theme block. Add a token to every theme before using a new value; `tests/contrast.test.js` fails when one theme sets a token the others don't.

### Other themes
Eight more token sets, same names, same roles, same type, radii and motion. Each changes colour only.
- **paper**: bright warm paper, ink text, a deeper letterpress green.
- **shadcn**: white and zinc neutrals with a green-700 accent.
- **terminal**: green-black ground, phosphor-green text, a bright green caret.
- **soft**: lavender ground with a violet accent.
- **midnight**: near-black with dimmed text and an amber accent, for late sessions.
- **swiss**: black on white; the accent is black and red is kept for mistakes.
- **e-ink**: greyscale; the accent is dark grey, and a mistake is marked by its grey tint rather than a hue.
- **nord**: Nord's blue-grey polar night with its aurora green as the accent.

Where a theme's accent is not green (soft, midnight, swiss, e-ink) it still means only "act here" or "you are here", and the One Green Rule applies to it.

## Typography

**Display Font:** Literata (self-hosted variable woff2, weights 300–700, roman and italic, optical sizing on), falling back to Iowan Old Style, Palatino and Georgia.
**Body Font:** Literata, the same stack.
**Label/Mono Font:** Geist Mono (self-hosted, 400 and 500), falling back to ui-monospace.
**Chosen fonts:** settings → appearance offer a typing font (`--font-typing`: the passage, compose field, replay and settings sample; Source Serif 4, Inter, JetBrains Mono, IBM Plex Mono, Roboto Mono or Fira Code) and an app font (`--font-app`: Source Serif 4 or Inter) in place of Literata. Sizes, weights and the rules below still apply; Geist Mono never changes.

**Character:** A book face used for everything a person reads, including large light numerals, beside a small mono voice that only ever measures. The serif makes the passage feel like prose; the mono makes conditions and keys feel like instrument readings.

### Hierarchy
- **Numeral** (400, 132px, 0.76, -0.035em; 112px under 760px): the WPM figure on the run card, with its unit in italic lead-size Literata. Tabular lining figures.
- **Display** (400, 48px, 1.05–1.08, -0.025em; 38px under 760px): screen headings on practice sessions and results.
- **Live stat** (300, 48px, 1, -0.035em; 40px under 760px; `--text-title` (30px) up to 374px, so a four-digit cpm beside a word count fits the column; up to 430px the three figures spread across the column with at least 8px between them, as a drill's do, instead of practice's 32px gaps): the live WPM, accuracy and timer, baseline-aligned with its unit in muted body-size Literata.
- **Passage** (400, 36px at the default "medium" setting, line height 1.75, -0.004em, ligatures off): the typing text. The settings give 29px, 36px or 44px on desktop, and 22px, 26px or 32px under 760px. Three lines are visible (one with the one-line tape), with the top and bottom edges faded by a mask (side fades on the tape).
- **Title** (400, 30px, 1.2, -0.015em): section headings (comparison, recommendation, empty states, challenge panels).
- **Body** (400, 17px, 1.6): running copy, capped at 56–60ch.
- **Small** (400, 15px): notes, help lines, toasts, and settings labels. Italic Literata marks quiet asides (input help, metric note, empty palette).
- **Label** (Geist Mono 500 or 400, 12px, 0.02–0.04em, lowercase): conditions lines, facts labels, dates, palette group names, key legends, the footer.

Weights in use are 300 (large numerals), 400 (headings and text), 500 (buttons, wordmark) and 600 (primary button, settings row labels). Headings are regular weight, never bold.

### Named Rules
**The Book-Face Numerals Rule.** Every metric is set in Literata with tabular lining figures (`.num`), and so is the unit beside it (wpm, s, %, /10): muted, body size (17px; 14px beside a 20px figure), on the numeral's baseline. Geist Mono sets only labels that don't sit on a numeral (facts labels, conditions, keys), never a number or its unit.

**The Measuring Mono Rule.** Geist Mono appears at 12–13px for labels, conditions and keys. It is never used for headings, body copy or buttons.

**The Lowercase Chrome Rule.** Chrome labels (dock, settings, palette, mono labels) are lowercase. Headings and buttons use sentence case. Nothing is uppercase.

## Layout

A single centred column, `min(1080px, 100% - 48px)` wide (100% - 32px under 760px), in a three-row grid of dock, screen and footer. Screens open with 56px top padding (32px on mobile).

- **Practice:** the screen starts where open practice's block, centred under the dock, would start (`--practice-block`, 510px at the default text size; 24px under the top on phones), and every mode and session keeps that top, so switching modes never moves the rail. At the top, a centred row of segmented controls (from 901px one hairline rail, see Segmented controls); lengths, quote filters, code languages and the standard test's mono recipe take turns in one place: from 761px the recipe hangs in the 32px under the controls, and on phones it takes the lengths' row at the lengths' height, so time, words, quote, code and standard all start the passage on the same line. Compose and custom text put their own heading above the passage, so their passage sits lower; then a measure row of numbers (and, for drills and retests, the heading block) closed by a hairline rule; then the three-line passage (or the one-line tape), a 2px progress line, and a footer of help text and actions. A mono shortcut row and an optional on-screen keyboard sit below.
- **Results:** the delta headline spans the top. From 901px, below it, one wide run print in a single card frame: the score (numeral, facts, notes) on the left and the trace (speed graph, words, practice offer) on the right. Below the print, two equal columns with a 64px gap: the drill (comparison, recommendation and its actions, "Drill something else", the ghost offer) on the left and the history (patterns, missed words) on the right. Up to 900px it is one column in the order headline, score, drill, trace, history, so the drill sits near the top; the score and the trace are each a card on the same stock. The print scrolls with the page. The DOM follows the phone order, so on desktop the keyboard reads the left column (score, drill) before the right (trace, history); that order is deliberate. How raw, consistency and c/i/e/m are counted sits behind a quiet disclosure under the conditions line.
- **Progress / Challenge:** heading row, then hairline-separated rows on fixed column grids that collapse to two columns under 900px and 760px.
- **Spacing:** a 4px-based scale (4, 8, 12, 16, 24, 32, 40, 56, 64). Section breaks are 32px of padding above a hairline rule. Row padding is 12px (evidence) or 24px (history, race results).
- **Breakpoints:** 900px (tables stack), 760px (dock moves to the bottom, keyboard and shortcuts hidden, type steps down), 360px (the dock's nav items switch to short verbs, see Navigation; run-card stat values step down to 20px and the character breakdown takes its own row). Any coarse pointer keeps a 44px minimum target (`any-pointer: coarse`, so a touchscreen laptop whose primary pointer is its trackpad counts too), checked for every visible control by `e2e/touch-targets.spec.js` and on a hybrid desktop by `e2e/touch-targets-hybrid.spec.js`; text-sized controls (the footer link, plain disclosures) reach it with a transparent `::after`, so neither the text nor the focus ring moves. Key hints (`.key-hint`: the shortcut row, the one-keyboard race's "esc restarts.", the `esc` cap on settings close, focus mode's exit button and the palette search) name keys a touch-only device doesn't have, so they hide when a coarse pointer is the only one (`(any-pointer: coarse) and (not (any-pointer: fine))`); a touchscreen laptop or a tablet with a keyboard case still shows them. `e2e/chrome-labels-hints.spec.js` checks both.

### Named Rules
**The Rules-Not-Boxes Rule.** Sections are separated by a 1px hairline and space, never by a card. If a region is not a floating object or the run print, it has no background and no border box. On a phone the print's score and trace are two cards on the same stock.

**The Step-Back Rule.** While a run is in progress (`body[data-running="true"]`), the dock, controls, shortcuts and footer fade to zero opacity and stop taking pointer input unless they hold focus. Only the passage and the numbers remain.

## Elevation & Depth

The page is flat. Depth appears only where an object floats over the page: the dock, the settings dialog, the palette, the clear-history dialog, the challenge handoff card and toasts. These are opaque raised stock with a strong hairline border and one shared soft shadow. There is no backdrop blur and no translucency on surfaces. Modal backdrops are a flat dim (black at 42–50% in dark, warm brown at 22% in light). Keycaps (`kbd`, on-screen keys) get physical depth from a thicker bottom border (2px and 3px). This is the key's own material, not a shadow style.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35)` dark; `0 8px 24px rgba(70, 56, 30, 0.12)` light): every floating surface, and only those.
- **Switch thumb** (`box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3)`): the toggle knob only.

### Named Rules
**The Opaque Float Rule.** A surface that floats is opaque raised stock plus the float shadow. It has no glass, no blur behind it and no coloured glow.

## Shapes

Softly rounded, never pill-shaped except for switches and dots. Controls (buttons, inputs, nav items, icon buttons, segmented frames, the gliding pill and palette rows) use a 12px corner, and segment buttons inside a segmented frame use 10px. Popovers, toasts and the dock use 16px; the palette, dialog and run card 22px. Switches, dots, the caret bar and the 2px lines (progress, ghost) take the full round. Word tints use 6px corners and keycaps 10px. Error tints have square corners so adjacent mistyped letters and spaces form one continuous band. Every corner comes from the `--radius-*` tokens; there are no raw radii. Borders are always 1px hairlines. The only drawn geometry is the chevron on the "drill something else" disclosure (a rotated 1.5px corner), the line icons (19px, 1.6 stroke, round caps), and Train's path: a 2px line with round nodes (see Train's path).

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
Mode and length pickers are a 14px frame with a hairline border, holding 36px Literata options (13px Geist Mono for numeric lengths). The selected option's text turns to the text colour, and a raised-wash pill glides under it with a transform-only 200ms slide. The same pill marks the current dock item. From 901px the mode, length and punctuation groups share one rail instead of three frames: a single hairline frame with 12px corners, the groups divided by short 16px hairline rules; narrower, the rail dissolves and each group keeps its own frame. The modes show time, words and quote, then "more" with the disclosure chevron: a 16px raised popover holding code, standard, book, compose and custom, and "learn to type" under a hairline rule. Once a mode inside it is chosen, "more" takes that mode's name and the pill glides under it. Book mode puts its book in a quote-filter dropdown where the lengths go, with the page number ("page 12") muted beside it. On phones the popover hangs from the right edge of "more". The palette highlight glides the same way, vertically, in 150ms.

### Inputs / Fields
- **Style:** raised fill, 1px outline border, 12px corners, 44px tall, 16px text.
- **Focus:** the border turns accent and gains a 3px accent-soft ring. The accent border is the focus cue and holds 3:1; the accent-soft ring is a supplementary tint (about 1.15:1) and is not relied on for contrast.
- **Error:** a coral border (`aria-invalid`) and a 14px coral message below.
- **Switch:** a 38×22 track (hairline-strong, accent when on) with a text-coloured knob that slides 16px.
- **Range (sound volume, background blur, opacity and height):** 104px wide: a 4px outline-coloured track, an accent fill and a 16px accent thumb. Volume shows its value as a small muted Literata percentage to its left; the background sliders show none, because the background behind the dialog is the value. Volume is always shown, at 38% opacity and disabled while sound is off, so the settings dialog never changes height; background blur is disabled the same way for dither, where it means nothing.

### Navigation (the dock)
A floating, opaque 58px bar with 18px corners, sticky at the top on desktop and fixed to the bottom under 760px (62px, full width, with safe-area padding). It holds the italic wordmark and green full stop, four lowercase nav items (muted, text colour on hover and when active, with the gliding pill), a hairline separator, a labelled settings control (icon and lowercase "settings"; icon only below 900px, so the centred dock clears the account button) and the ⌘K / Ctrl-K palette trigger, shown as a search icon at every width. The account button sits apart from the dock, top right. Below 360px the full words don't fit beside settings and commands at the nav's size (even 12px overflows the 320px dock), so the nav items show short verbs: type / train / track / race. Each accessible name starts with the visible word and keeps the full one after it ("type practice", "track progress", "race challenge"; train is the same at every width), so voice control can say what it sees (WCAG 2.5.3, label in name) and the name still matches the palette and headings. From 360px the name is the visible word alone. Settings opens a centred native modal dialog, up to 1080px wide and 704px tall. A persistent 216px sidebar holds appearance, practice, keyboard, sound and shortcuts, with Import Monkeytype settings below. The header and footer stay in place while the category content scrolls. Discrete preferences use native radio groups styled as inline selectors, with a green underline and soft tint on the selected option. Appearance includes a live sample passage. Changes apply as chosen; Done is the only filled-green action. Below 760px the navigation wraps across the top and preference rows stack. Escape, Close and Done restore focus to the opener; Escape cancels shortcut recording first.

The footer holds the personal best, the guest note and a quiet "suggest a feature" link (mono label, hairline underline). It opens a dialog of the same raised stock as the clear-history dialog: a sentence-case heading, a note on what is stored, a textarea with a mono character count, and Cancel / Send suggestion (filled green). Success closes it and shows a toast; failure keeps the text and explains in coral below the field.

### Status words
A 7px dot in the current colour, followed by a lowercase 12px mono word, coloured by meaning (accent, warning, danger, muted). These are never boxed.

### Progress, recurring patterns and daily challenge

Progress keeps the editorial column: condition/period fields, two charts, run rows, then drill/retest rows, all separated by space and rules. Corrected WPM uses the green line; accuracy uses the neutral text line. Axis labels show each chart's scale. Chart points have 44px hit areas (48px when any pointer is coarse, where the axis labels let taps through), narrowed to the gap between neighbouring points when runs are dense so a tap always opens the point under it; the run rows below are the full-size equivalent. Points have keyboard activation and accessible labels that open the corresponding run. Charts stack on mobile and redraw at the available width. Run and comparison disclosures expose their details without adding cards.

The training memory section sits below the existing drill actions. Pair headings and counts use Literata; each row offers a neutral bordered button to practice the target again. Sample counts, matching conditions, last practice and later fresh observations stay adjacent to the target.

Challenge opens with a row of small ghost-button tabs (Online, Daily, Friends, One keyboard); only the pressed one takes the green text and outline, on every challenge screen including the one-keyboard results. Challenge opens with the daily passage and its one filled-green action, followed by the shared-keyboard section with a neutral Start button. The daily date/reset uses the existing condition label; result history uses hairline-separated rows. First and repeat attempts, previously displayed passages and input classes are written explicitly.

The optional on-screen keyboard shows the thirty main keys with a real row stagger (home a quarter key in, bottom three quarters) and a space bar, labelled for the chosen layout. Its finger map puts a small mono initial (i, m, r, p) in the corner of each key for the finger that types it, so it reads without telling shades apart and survives forced colours; a faint neutral band (`--finger-band`, never a hue) sits behind alternate fingers (index, ring) so neighbouring fingers stay apart. Letters keep their muted/text colours, so drill targets still stand out, and muted text on the band stays at 4.5:1 or more in every theme. The two hands sit a little apart, and a mono legend repeats the initials. Screen readers hear each key as one phrase ("f, left index") from visually hidden text, only while the map is on. Colemak-DH follows its ANSI angle mod. Below 760px the keyboard and both of its settings rows are hidden.

Below 360px, the run-card WPM uses `--text-numeral-narrow` (80px); the existing mobile size is now `--text-numeral-mobile` (112px).

### Typing zone (signature)
Three passage lines are visible, with 12–16px mask fades at the top and bottom. Untyped letters are muted, correct letters are text-coloured, and wrong letters are coral with a tint (no underline). The caret is a 3px accent bar driven by a stiff spring (stiffness 1400, damping 70). It breathes (opacity to 0.25 over 1300ms) only while idle, drops to 35% when unfocused, turns coral when blocked, and disappears at the finish. Line changes translate the passage over 150ms. The optional ghost pacer is a 2px periwinkle bar at 70% opacity; in a ghost race the same bar, at full opacity because it is the opponent, replays a friend's recorded keystrokes, stepping from key to key with no transition. The word highlight setting (off by default) tints the current or the next word with `--word-highlight`, the text colour at 5%: neutral, so it never reads as green or coral, and faint enough that muted letters keep 4.5:1. It moves with the caret from word to word at once, with no transition of its own, and is not the retired underline that swept through the glyphs; the tint sits on the word's letters and skips a miss, so a miss keeps exactly its own coral tint. Its slide option (off by default) draws the tint as one shape behind the letters that glides to the next word over 150ms on transforms (the line-scroll easing), snaps when the word is on another line, and jumps under reduced motion; a miss paints its coral over it. It shows on every passage typed against a text (practice, drills, retests, daily, standard, lessons, custom text, ghost, one-keyboard and online races); watch replay and composing practice have no current word and never show it.

The one-line tape (a setting, off by default) shows a single line with 12–16px side fades instead; the left fade appears once typed text has moved under it. The line holds while the caret travels right, and when the caret starts a word past 70% of the width, the line steps once so that word sits a tenth of the way in (further on a narrow screen or with large text, so the space and last letter before it stay clear of the left fade), with the same 150ms translate. A word longer than the line steps inside the word, a chunk at a time, never letter by letter. Backspacing steps back before the letter left of the caret reaches the left fade. Under reduced motion every step is instant. The caret and the pace caret both ride on the line, so each keeps gliding at its own speed through a step; a pace caret ahead of the visible stretch runs on under the right fade and comes back into view at the next step. The word highlight tints the same words as on three lines. The tape covers every practice passage, code included (a code snippet is typed as one run of tokens, never line by line); races keep three lines: a ghost race, so the friend's caret stays in view however far ahead or behind it is, and one-keyboard and online races. The geometry is in `src/tape.js`.

### Composing practice
"compose" sits in the "more" menu with the rarer modes. The passage block becomes a prompt at title size with a mono conditions line, the green countdown on the right and a ghost "Another prompt" that steps back while writing. The writing field is open, like the passage: no fill and no border, Literata at the passage size, three lines tall and scrolling inside with no scrollbar, with the field’s own accent caret held solid (`caret-animation: manual`) and a muted italic placeholder. Where `caret-animation` isn’t supported, the native caret turns transparent (it still edits, selects and composes) and `src/compose-caret.js` draws a solid 2px accent bar, as tall as the letters, at the collapsed selection, measured from a hidden mirror of the field and kept whole inside it; where a line wraps it stands on the line the last key or click left it on, as the browser’s own caret does. It jumps with each key, click, scroll or re-wrap, never glides, fades or blinks, and shows only while the field is focused, nothing is selected and the session isn’t finished. The time line sits under it, then a one-line privacy note, the green Done and the start-over icon after it, so Tab from the field reaches Done first. The result follows on the same page: a lead-size heading, four facts in the live-stat style (48px light Literata with Literata units, mono labels), an italic metric definition, the saved note and one green "Write another". The finished writing and the clock turn muted, and the field leaves the tab order. Nothing in it animates. It has no spring caret: a free-typing field has no letter positions for one to glide between.

### Run card (signature)
One static print, `--result-card` (900px) wide and centred under the rail: 16px corners, 32px padding, a hairline border and the card-stock gradient, with 32px between its rows. The top row holds the numeral WPM and its italic unit on the left; on the right one row of accuracy, time and consistency (12px mono labels over 24px Literata values, units muted), and under it one muted line, "average N · best N" (the last ten counted runs at these conditions, and the best), once a second counted run exists there. Then the full-width speed trace, `--result-trace` tall: a 2px accent line of wpm per second (averaged over a trailing three seconds, drawn as a smooth curve through the points and fitted to the run's own range, with no speed axis), a dotted muted line at the final wpm, coral dots ringed in card-top where mistakes happened, a hairline floor and mono times at the start, middle and end; it draws once over about 450ms (`--dur-develop`). Then the words typed in body-size Literata, mistyped ones in coral on their tint, and "Practice these N words" as a green line of text. Last, under a hairline: Run again (filled green), the drill and Watch replay, with the mono conditions line right-aligned beside them. Accuracy's tooltip holds first-try errors and the final c/i/e/m; consistency's says how it is counted. Under 760px the card stacks (facts under the score, the conditions under the actions) with 24px padding, and 16px under 360px; Run again takes the card's width and the drill and the replay share the row under it (one each under 360px). When a run finishes, the page scrolls to show the whole card 24px clear of the bottom edge; when the card is taller than the room under the dock, it shows the score down to the action row instead, so the actions never rest on the edge or hide behind a phone's dock. It does not tilt, shine or animate after the trace has drawn.

### Train's path (signature)
Train has no visible heading: the dock names the page, and a visually hidden heading names the open step for assistive technology. The page is one line of steps, the targets you have drilled behind you, the one to drill now, and the next three the learner queues, with the open step's details under the line. The line visibly gets longer as targets are drilled and leave the queue; it carries no points, badges, levels or scores.

- **States.** Behind you: a 16px accent ring when drilled, a 16px accent disc once fixed, the target at title size in the text colour, its before → after figures in small Literata (the first in the text colour, a "since" line muted), on a solid 2px accent line. The open step: a 24px accent ring holding an 8px dot, the target at display size, on the line where it turns dashed. Ahead: a 12px outline ring, the target at title size and its evidence in muted small Literata, on a dashed 2px hairline-strong line (8px dashes, 4px gaps). A general drill runs on to three empty 12px rings, drawn and not announced.
- **Without colour.** Position (left of or above the open step is behind), node shape and size (disc, ring, ringed dot, small ring) and the line (solid, dashed) tell the states apart, so the path reads in e-ink and forced colours.
- **Details.** Under a hairline, from the open step's column to the end: its evidence at lead size, its "since you drilled it" line muted, the person's missed words that hold a target named for its misses at title size (the target in the text colour, the rest muted, never coral), then its one filled-green button with a mono line saying what it starts.
- **After a retest.** The comparison is the newest step behind you, two columns wide: the outcome sentence after a 7px status dot (accent improved, warning mixed, danger lower, muted otherwise), three rows of mono label, figure and muted change, the mono conditions line and any caveat. Then the next step is open, with Next and a ghost Back to practice.
- **Layout.** From 901px the steps sit in columns, six to a screen; more scroll sideways along the line, which opens at its end and is a tab stop only while it scrolls. Up to 900px the line runs down the left of the page, nodes centred in a 24px column, the open step's details under its target, the two newest steps behind you shown with the line fading in from above when there are more.
- **Motion.** As a retest's comparison opens, the steps slide one column left and the open step's details fade up 8px, over `--dur-fast` with `--ease-out`, transform and opacity only (on phones only the open step fades up). Nothing moves under reduced motion. A step ahead brightens its target on hover over `--dur-quick`.

### Learn to type and the finger map
The learn screen is an editorial column like Progress: the page heading, then the current lesson (or the last lesson result) beside the finger map, then hairline-separated lesson rows with keys as `kbd` caps, the fingers in words, a status word (passed in green, next in green, locked muted) and Literata numbers. The current block holds the screen's one filled-green action. A lesson result lists accuracy, wpm, first-try errors and time as Literata numbers under mono labels; each target sits under its number with a status word, "met" (green) or "not met" (muted). Nothing about a missed target is coral: it isn't an error or a regression.

The finger map is the on-screen keyboard split into two hands, with each column labelled underneath by its finger (pinky, ring, middle, index) over a strong hairline rule, and the space bar labelled "thumbs". Learned keys read in the text colour, keys not yet learned stay muted, and the current lesson's keys get a full green edge (the caption points at it, so it keeps 3:1 against the ground in every theme). Finger names wider than their column overflow evenly on both sides. It shows on the learn screen and under the passage for the whole of a lesson, whatever the keyboard setting; from 901px wide a lesson reserves two passage lines (its passage is about 60 characters), so the finger names and thumbs row stay above the fold at 721px tall, and the lesson's description keeps only the short key-pair label; under 760px the keys shrink to the column and the finger names shorten to a letter, with a one-line legend. Its accessible name lists every finger's keys. The entry point is "learn to type" at the foot of the practice controls' "more" menu, plus first-run links on Train and Progress; there is no banner.

### Command palette
A 600px opaque raised panel with 22px corners over a flat dim. It has a 62px search row (19px input) and 46px option rows with a 6px state dot (accent when selected), mono group labels above each group and mono hints on the right. Content keeps 20px from both sides of the panel (the highlight's 8px inset plus the row's 12px padding): the search icon, group labels and dots start on that edge, the search text and option labels share a second edge past the dot and a 16px gap, and the hints end where the esc key does. Labels and hints are centred on their lowercase letters (`text-box: trim-both ex alphabetic`), so they sit in the middle of the row in every app font. Each group appears once, in the order of its first command. It enters and exits with a 4px lift and fade over 150ms.

### Toasts
Opaque raised pills of 16px radius at the bottom centre, with a status dot and 15px text, rising 6px over 200ms.

## Motion

Motion is fluid. It is welcome on the typing surface during a run, as well as in chrome and after it, wherever it makes speed, position or progress easier to follow. Examples are the spring caret, the pace caret gliding at its speed, a ghost race gliding between a friend's keys, and the line scroll. Nothing has to stay rigid or static. The chrome still fades out after the first keystroke (`body[data-running]`), and comes back on pointer movement, finish or restart. `src/motion.js` and `src/graph.js` are presentational, and scoring never reads from them.

### Named Rules
- **The Smooth Rule.** Animate transform and opacity, one animation frame at a time.
- **The Reading Rule.** Motion never moves or hides the letters someone is reading.
- **The Token Rule.** Durations come from the `--dur-*` tokens. Add a token before using a new one.
- **The Reduced Motion Rule.** Everything scales to zero under `prefers-reduced-motion`.

## Do's and Don'ts

### Do:
- **Do** take every colour, size, radius, duration and easing from the CSS variables at the top of `src/styles.css`, and define new colour tokens in every theme block.
- **Do** set every readable word and every number in Literata, with tabular lining figures on metrics. Keep Geist Mono to 12–13px labels, conditions and keys.
- **Do** keep exactly one filled-green primary action per view. All other actions are secondary, ghost or danger.
- **Do** separate sections with a 1px hairline and 32px of space.
- **Do** pair coral with a second cue: a tint or a word.
- **Do** drive every duration from the `--dur-*` scale (80, 150, 200, 250, 350ms × `--motion-scale`) with the `--ease-out` curve (`cubic-bezier(0.22, 1, 0.36, 1)`), so reduced motion takes them all to zero.
- **Do** keep chrome fades at 200ms or less, and animate the selection pill by transform only.
- **Do** keep chrome labels lowercase and headings and buttons in sentence case.

### Don't:
- **Don't** move anything decorative near the passage while a run is in progress. Letter states change instantly; only the caret spring and the ~150ms line scroll (or tape step) move.
- **Don't** reintroduce the effects removed after the critique: a streak glow or caret aura, a letter ink trail (letters landing lit and cooling), an error shake, digit pop-ins or number reels, a word underline or lens sweeping through the glyphs, run-card tilt, glare or foil, glass surfaces, a live rhythm strip, or blur reveals on restart and results.
- **Don't** use backdrop-filter, translucent surfaces or coloured glows. Floating surfaces are opaque raised stock with the one float shadow. (The challenge handoff's blurred passage veil is a concealment device that hides the next player's text. It is not a reveal effect and must not spread elsewhere.)
- **Don't** add kickers or eyebrows above headings, and don't use uppercase tracked labels.
- **Don't** add taglines or descriptions under headings (settings categories and Learn to type included), helper sentences, notes that restate what's on screen, or fine print. A page heading names the page (Challenge, like Progress), except Train, which the dock names and which shows its path instead; a line of copy stays only when someone needs it to act or to stay safe, in the fewest words, at the point of decision (the friends board's share switch says who sees your row).
- **Don't** add a second accent. Periwinkle belongs to ghost carets alone, and amber to interrupted and mixed results alone.
- **Don't** box ordinary sections as cards. The run card is the one card.
- **Don't** move the app back toward the retired Ash system: no blue call to action, no Geist sans, no dark-only rule, no mono status pills.
- **Don't** invest in the wordmark. "Stilltype" is a working title, and the brand stays an italic word and a green full stop.
