# Handoff — Stilltype

Updated 22 September 2026 after implementing the design handoff. Read `PRODUCT.md`, `design/ash/DESIGN.md`, and `docs/decisions/2026-09-22-learning-loop.md` before changing behavior or visuals.

## Current state

The redesign is application code now, not just canvas artboards. The app remains native HTML/CSS/JavaScript with no runtime dependencies or backend.

```sh
npm run dev   # local server on :5173
npm test      # 8 focused scoring/replay/evidence checks
```

Implemented:

- Spacious, borderless typing with centered mode/length controls, stable three-line text, solid caret and underlined errors.
- Time, word-count and original quote tests; quote length and descriptive difficulty filters; explicit empty-filter recovery.
- Saved text size, keyboard, live metrics and focus preferences. Focus mode has an exit and Escape support.
- Versioned deterministic replay, retained first-attempt mistakes, condition-filtered recommendations, sample thresholds and clean pair timing.
- A real one-minute drill stage, automatic or manually selected. Manual drills work without a baseline; a baseline enables the fresh comparable retest.
- Retest comparisons with mixed/regression states, timing sample limits and local progress. Seen quote IDs are recorded when displayed; exhausted retests stop with an explanation.
- Condition-aware bests; drills, challenges and interrupted attempts do not become personal bests.
- Local two-player shared-keyboard challenges with the same passage, hidden handoff and observed results. This is not networked multiplayer.
- Typed history-clear confirmation with immediate Undo.
- Locally bundled Geist/Geist Mono with the SIL license under `src/fonts/`.

## Validation

Read `docs/verification/2026-09-22-browser.md` for the browser checks and limits. The solo run → manual br drill → fresh retest → saved/reloaded progress flow and both players' challenge turns were completed through actual browser input. Tests use a separate 127.0.0.1 origin so the user's localhost profile is not polluted by verification scores.

## Code map

- `index.html`: application screens and accessible controls.
- `src/styles.css`: application composition using canonical Ash tokens/components.
- `src/typing.js`: corpus, metric/event versions, replay, comparison and transparent pattern baseline.
- `src/app.js`: screen state, input handling, preferences, history and local challenge.
- `docs/ui-contract.md`: DOM integration contract.
- `server.mjs`: explicit app/font/design-CSS asset serving; canvas artboards and project documents are not served.

## Decisions to preserve

Ash remains dark-only with warm tonal surfaces, blue actions/focus and mint for success. The typing target deliberately uses Geist Mono at 28px/1.9, with 22/36px token-based preferences. Errors retain the non-colour underline. Keep metrics and conditions visible; never turn small-sample timing into a confident weakness or learning claim.

This build uses mandatory correction and records that policy in comparison keys. Do not mix future relaxed scoring, quote difficulty/performance points or multiplayer ratings into personal skill progress. Existing unversioned `stilltype-best` data is not imported into comparable bests.

The newest 24 attempt traces are retained in local storage; comparison summaries, seen-text IDs and bests remain until history is cleared. Local challenge scores are transient. There is no cloud collection. Storage failures are reported in result copy.

## Remaining work

- Validate the proposed p95 input-to-visible-feedback budget on a named reference browser with instrumentation; no latency result is claimed yet.
- Broaden physical-device/browser coverage, including assistive technology, actual touch keyboards and IME behavior. Responsive layouts and direct physical-keyboard input were tested; this is not a complete accessibility certification.
- Expand the small original quote corpus and validate difficulty labels. Empty filter combinations are explicit. Generated retests match configured conditions but do not guarantee matched target frequency; target sample limits remain visible.
- Improve progress exploration and define longer-term local retention/sync requirements before expanding data storage.
- Recorded ghosts, daily challenges and networked friend rooms remain later roadmap stages. Online rooms need lifecycle, authoritative validation and multi-client testing.
- The recommender is a transparent baseline, not ML. There are no learning outcome benchmarks, user studies, accounts, deployment or public rankings.

The old critique snapshots describe the former implementation/reference artboards. They remain historical evidence; do not blindly reapply their backlog to the shipped UI.
