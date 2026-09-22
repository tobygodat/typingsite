---
target: the canvas
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:/home/tobygodat/Documents/ai-agents/typingsite/design/canvas/stilltype-landing-redesign"
timestamp: 2026-09-22T03-14-22Z
slug: design-canvas-stilltype-landing-redesign
---
Method: dual-agent (A: ade48acf922d0facc · B: afb30ff1284748a11)

# Critique — Stilltype design canvas (4 artboards)

Target: the Design canvas artifact (Main / Results / Retest / Mobile `.dc.html`), assessed at canvas version 1790045198-74b4. Mode: Operate.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | `18` on Practice unlabelled (elapsed or remaining?); 2px rail track invisible (#22211E on #141311); no aria-live on metrics, no role=progressbar. |
| 2 | Match System / Real World | 2 | Mint `+21 points` means percentage points, colliding with PRODUCT.md's three other "points" scores. Nav `Train` points at a result. |
| 3 | User Control and Freedom | 2 | `Clear local history` unguarded on Practice and Retest — no typed confirm (ash), no undo (PRODUCT.md). No path back to a different target from Retest. |
| 4 | Consistency and Standards | 2 | key tints 22%/34% vs ash's 14% cap; `.key-n` 10px off-scale; 3 nav items desktop vs 4 mobile; `wpm` vs `corrected wpm`; two focus indicators in one tab order. |
| 5 | Error Prevention | 2 | Strong on measurement error, nothing on destructive error. |
| 6 | Recognition Rather Than Recall | 2 | Reading `94` requires recalling `best 96 wpm` 700px away; 1-error keys are 1.20:1 against clean keys. |
| 7 | Flexibility and Efficiency | 2 | Mac-only ⌘K for an undesigned palette; `Choose target` has no destination. |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained and on-brand, but passage at 41% height with ~150px/~140px dead canvas and account chrome on the sacred surface. |
| 9 | Error Recovery | 1 | No error, empty, interrupted or regression state authored anywhere. |
| 10 | Help and Documentation | 2 | `corrected wpm`, `first-attempt errors`, `br` never defined, against a success criterion of "understands what each number means". |
| **Total** | | **21/40** | **Needs work** — all ten applied (Operate) |

## Design Specificity Verdict

Split, and split the wrong way. Typing-specific work is concentrated on Retest, the least-visited screen: `br delay before r 340 ms → 250 ms`, `12 attempts · too few to call`, `corrected wpm 94 → 92 · harder text · kept out of your best`, the comparability eyebrow, the danger-ink-plus-underline error cue.

Category-interchangeable: the 52px header; Retest's session table with `ses_7b30d1` as the leading 124px column; the 36px KPI pair on Results; and the typing surface itself (28px Geist Mono at 1.9, grey-ahead/bright-behind = the Monkeytype convention). The product is named for stillness and the surface expresses none.

Deterministic scan: 7 findings / 2 rules / exit 2 — `cramped-padding` ×1, `overused-font` ×6, all false positives. CLI ran blind to bundle.css (missing ds/ tree in the copied source dir). Browser overlay injected on all four boards; console reported Geist Mono at 52%/84%/75% of text on the desktop boards and cramped-padding on Mobile's `.tabs.seg`.

False positives dismissed: `overused-font` is inverted — Geist/Geist Mono are mandated by the binding ash system; `cramped-padding` fires on `.tabs.seg`'s designed 2px gutter.

## Overall Impression

The honest-measurement thesis is genuinely rendered as interface, then spent on the wrong screen. Results — the emotional valley and highest-stakes moment — has two bare numbers, a red keyboard, and one hedge as its only sentence. Biggest opportunity: Results shows evidence and makes a recommendation but never connects them with a sentence, which is the entire positioning.

## What's Working

1. Retest's comparison rows are the thesis as interface; the caveat is typographically equal to the number.
2. The eyebrow provenance lines are load-bearing at 6.97:1 contrast and almost no visual weight.
3. The typing surface holds still — zero overflow, zero clipping at exactly 1280×800.

## Priority Issues

[P0] Results makes a recommendation it never explains. Fix: an 18px sentence under the metric pair naming the evidence, plus Mobile's `.next` subline on `Start drill`. → $impeccable clarify

[P1] The valley is unauthored: no deltas on the Results metrics, and no empty, interrupted, unsupported-input or regression states anywhere. Fix: mono delta rows using Retest's `−90 ms` treatment; author the four missing states. → $impeccable harden / $impeccable onboard

[P1] Measured accessibility failures: wordmark full stop 3.85:1 on all four boards; five Mobile targets under 44px (wordmark link 64.5×16, four mode chips 28px); two focus indicators in one tab order; no aria-live on the metric row; duplicate accessible name "Practice settings". → $impeccable audit

[P1] `Clear local history` unguarded on the sacred surface, no typed confirm, no undo. Fix: move into the gear menu after a hairline; typed-confirm dialog; 5s undo toast. → $impeccable harden

[P2] The heatmap doesn't encode what it claims: adjacent ramp steps measure 1.20:1 / 1.21:1 / 1.26:1, base-to-hottest 1.82:1; tints run to 34% vs ash's 14% cap; the eyebrow above it is an empty `<br>` span; the bigram bars restate the finding. Fix: cut it and reclaim ~250px for the P0 sentence, or single 14% tint + numeral in every hit key + severity in a bottom rule. → $impeccable distill

## Persona Red Flags

Speed-scanner: never learns why `br`; `Run again` is a 28px button in the corner; `ses_4f21c8` sits where their delta belongs.
Keyboard/screen-reader: no aria-live; bare div rail; heatmap announces "r4"; two controls named "Practice settings"; Mac-only ⌘K.
Competitive touch typist: no personal-best moment, no trend, no comparison against `best 96 wpm`.
Beginner (committed second audience): every term undefined; heatmap teaches no technique; `15 30 60 120` unitless and changes meaning in words mode; Results has no room for a teaching sentence — layout debt.

## Minor Observations

- Retest annotation column ragged: 205px spread from flex-grow spacers; arrows 31px spread; two content widths (592 vs 760).
- Mobile passage clips 2px (scrollHeight 122 vs clientHeight 120).
- No viewport meta in any artboard.
- Retest carries 60px of unexplained gap where a caption was deleted.
- Mobile puts `30 s` (a value) among three modes.
- Mobile `Keep typing` is a 48px primary inside an actively-typing card.
- Mobile omits accuracy; the metric set changes by breakpoint.
- Caret `margin: 0 -1px` sits flush against the danger-underlined `l`.
- Live accuracy to one decimal contradicts "analytics wait until the run is over".
- Three controls lead nowhere: `Choose target`, both header icon buttons.

## Questions to Consider

1. Why did the product's character get spent on the rarest surface?
2. `Start drill` leads to Retest — the drill has no board. A four-step loop with three screens.
3. What does Retest look like at 71% → 64%?
4. Point at one pixel of the typing surface that expresses stillness and isn't the Monkeytype default.
