# Handoff — Stilltype

Written 22 September 2026, at the end of a design session. For the next agent picking this up (Codex or otherwise).

## Read these first, in this order

1. `PRODUCT.md` — durable product truth. Users, purpose, positioning, the metric contract, principles, accessibility floor. Captured with the owner; do not contradict it, and do not re-interview on anything it already settles.
2. `AGENTS.md` + `design/ash/DESIGN.md` — the ash design system is **binding** for all UI. Tokens are the source of truth; colours, type sizes and radii are never invented.
3. `docs/mvp-spec.md` — milestone 1 journey, scope table, scoring contract, acceptance criteria.
4. `.impeccable/critique/2026-09-22T03-14-22Z__design-canvas-stilltype-landing-redesign.md` — the design review of the proposed redesign, scored 21/40, with the P0/P1 backlog. This is the work queue.
5. `design/canvas/` — the redesign itself, as reference artboards, with a README explaining the format.

## Where the project actually stands

**Shipped and working** (`index.html`, `src/`, `tests/`): the first typing-only slice. Timed and word-count tests, original short passages, optional punctuation, live WPM and accuracy, results, Escape to restart, an optional keyboard display, local best with undo on reset. Vanilla HTML/CSS/JS modules, zero dependencies. `src/typing.js` keeps text generation and scoring out of the DOM so scoring can be tested and replayed; `src/app.js` is the UI.

```sh
npm run dev   # node server.mjs, serves on :5173
npm test      # node --test over tests/typing.test.js
```

**Designed but not built**: the three-screen loop — Practice → Results → Retest, plus a mobile practice surface — in `design/canvas/`. The running page at `:5173` is still the **pre-redesign** layout. Porting the canvas direction into `index.html` and `src/styles.css` is the main outstanding piece of work.

**Not started**: the drill itself, any recommender, any persistence beyond local best, all competition features, anything ML.

## The gap that matters most

The canvas is a four-step loop — *play → identify → practice → measure* — rendered as three screens. **There is no drill board.** `Start drill` on Results links straight to Retest. Before building, decide what the drill screen is: almost certainly the Practice surface with generated target-heavy text and something that makes clear the user is drilling, not being tested. That decision is not made and not recorded anywhere.

## Design decisions already made (preserve these)

- **The typing surface is the composition.** Chrome at the edges, test vertically centred with real empty space around it, no card frame. Settings are one centred pill at the top: `time / words / quote · 15 30 60 120 · punctuation`. This follows Monkeytype and keybr deliberately, at the owner's direction.
- **Passage type is Geist Mono at 28px/1.9**, against ash's "never mono for prose" rule. The justification is that a typing target is per-character data and fixed advance widths are what keep the surface from reflowing as errors appear — an explicit acceptance criterion. Keep the deviation or raise it, but know it was deliberate.
- **Error treatment**: mistyped character in `--text-danger` ink **plus a 2px underline** at 5–6px offset. The underline is the non-colour cue the accessibility floor requires; do not drop it for a colour-only treatment.
- **Caret** is a solid 2px `--primary` bar, not blinking. ash allows one ambient animation (the pulsing in-flight status dot) and nothing else.
- **Colour discipline**: blue for actions, focus and in-flight progress; mint strictly for success state and never a button fill; danger as ink or tint, never a fill.
- **Honesty is UI, not footnotes.** `12 attempts · too few to call`, `harder text · kept out of your best`, `26 attempts before · 24 after` — the caveat is typographically equal to the number it qualifies. This is the product's positioning rendered as interface; it is the best work on the canvas. Do not demote these to tooltips.
- Every screen states its own conditions in an 11px mono line (`english · common words · corpus v3`).

## The backlog, in priority order

From the critique. Full detail and measured evidence in the snapshot file.

1. **[P0] Results makes a recommendation it never explains.** Between the metrics and `Start drill` there is no sentence connecting evidence to target. The product's entire positioning is the *explained* loop. Fix: one sentence naming the evidence (`br is costing you the most — 7 first-attempt errors, and 340 ms before the r against your 210 ms median`), plus the subline that already exists on the mobile `.next` card (`about 1 min, then a fresh 30 s passage`).
2. **[P1] No deltas, and no failure states anywhere.** Results shows `94` with no comparison to `best 96 wpm`. There is no empty state, no interrupted-run state, no unsupported-input state, and no regression state — when a drill fails (`71% → 68%`) the design's only vocabulary for change is a mint success badge.
3. **[P1] Measured accessibility failures.** The wordmark's blue full stop is 3.85:1 on the panel (needs 4.5) on every board. Five mobile targets are under 44px: the wordmark link (64.5×16) and the four mode chips (28px tall). Two different focus indicators share one tab order — the ash ring on `.btn`/`.switch`, the browser default on `.tab`/`.nav`/links. The live metric row has no `aria-live` and the progress rail has no `role="progressbar"`. Two controls on Practice share the accessible name "Practice settings".
4. **[P1] `Clear local history` is unguarded** and permanently on the practice surface. ash requires a typed confirm for destructive actions; `PRODUCT.md` requires an undo in the moment. Neither exists.
5. **[P2] The keyboard heatmap does not encode what it claims.** Measured: adjacent severity steps are 1.20:1, 1.21:1, 1.26:1; base to hottest is 1.82:1. A one-error key is visually identical to a clean one. Tints also run to 34% against ash's 14% cap. It duplicates the bigram bars directly below it. Cutting it is a legitimate answer.

Two defects are visible in the committed artboards and should not be ported: the empty `<span><br></span>` eyebrow above the heatmap in `Results.dc.html`, and 60px of orphaned spacers in `Retest.dc.html`.

## Constraints that will bite

- **The metric contract is versioned and must not drift.** Corrected WPM, input accuracy, first-attempt error retention, and the rule that personal progress / quote difficulty / multiplayer rating stay three separate scores. `PRODUCT.md` has the definitions; `docs/mvp-spec.md` has the worked examples (300 corrected characters over 60 s produces 60 WPM; 300 correct plus 10 incorrect insertions produces 300/310 accuracy even after every error is fixed).
- **Beginners are a committed second audience**, to be served after the solo loop is proven. The standing constraint: build nothing that would have to be torn out for them. The critique flags one piece of latent debt already — Results has no vertical room for the teaching sentence a beginner path would need.
- **No framework is chosen.** The shipped slice is vanilla and the implementation plan defers the choice. If you introduce one, record the decision; do not let it arrive as a side effect of a UI task.
- **No users, no usage data, no benchmarks, no deployment.** `PRODUCT.md` lists these absences explicitly so future work does not fabricate them. The research is qualitative Reddit sampling and is not representative.

## Repository state

Initial commit, branch `master`, **no remote configured** — nothing has been pushed anywhere. Add a remote before expecting `git push` to work.

`.impeccable/` holds two critique snapshots: one for `index.html` from an earlier session, and the canvas review described above. `$impeccable polish` reads the latter as its backlog.
