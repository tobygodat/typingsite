# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary, now:** people who already touch type on a physical keyboard, in English, who want to get faster and more accurate and enjoy competing. They arrive knowing roughly what their WPM is and want to know what is holding it back.

**Committed second audience, built after the solo loop is proven:** beginners learning to type, also on a physical keyboard. Confirmed during init, September 2026. This supersedes the MVP spec's deferral of beginner instruction as an audience decision — the teaching path itself is not milestone 1 scope, but no architecture, progress model, or UI may be built that would have to be torn out to serve them.

Everyone is a guest by default: no account, profile stored on the device. Touch entry is scored and labelled on its own and is never compared with physical-keyboard runs.

## Product Purpose

One connected loop: **play → identify weak patterns → practice → measure improvement on fresh text.** Existing typing sites make people switch between a clean test, targeted learning, and competition; this product tries to make the next useful exercise the obvious next step from a result.

Success for milestone 1: a guest completes run → explained recommendation → drill → fresh comparable retest → saved progress, without an account or external service, and understands what each number does and does not mean.

## Positioning

The explained race-to-drill-to-fresh-text loop, held to honest measurement. Every recommendation shows the evidence behind it — error counts, timing against the user's own median, sample size. Every comparison names its text, rule and metric version. Improvement is only ever claimed on text the profile has not seen before.

This is stated in the research as a hypothesis about usability and learning, not a proven outcome and not a claim of novelty. Monkeytype, keybr, TypeRacer and TypeGG are influences and prior art, not features this product claims to have invented; Monkeytype already offers missed-word practice and TypeGG already offers competitive progression. Integration and demonstrable learning are what have to justify the product.

## Operating Context

- Browser on desktop, physical keyboard, single player, no backend. Works offline.
- A run is short (15–120 s) and repeated many times in a sitting; the practice surface is returned to constantly, so its chrome is seen more often than any other screen.
- Practice is a focused, low-interruption moment. Detailed analytics belong after the run, never during it.
- History is local. Clearing it is user-initiated and offers an undo in the moment.
- Typing feel is the product's physical sensation: latency, stability of the text, and how errors read are functional requirements, not polish.

## Capabilities and Constraints

**Shipped today** (first typing-only slice, working title Stilltype):
- Timed and word-count tests, original short passages, optional punctuation, live WPM and accuracy, results, Escape to restart, optional keyboard display, local best with undo on reset.
- Native HTML/CSS/JS modules, no dependencies. `npm run dev` serves on :5173 via `server.mjs`; `npm test` runs `node --test`.
- `src/typing.js` keeps text generation and scoring separate from the UI in `src/app.js`, so scoring can be replayed and tested without the DOM.

**Metric contract** (versioned before any data collection):
- Corrected WPM = correct target characters retained at finish / 5 / elapsed minutes. Elapsed time runs from the first printable input on a monotonic clock and continues when unfocused.
- Input accuracy = correct printable insertions / all printable insertions. Corrections consume time and corrected errors stay in the denominator; backspace is not an insertion.
- First-attempt errors are recorded per target position. A corrected passage must not erase the evidence that a mistake happened.
- Personal skill progress, quote difficulty / performance points, and multiplayer rating are three separate scores. A harder practice exercise must never read as a loss of skill or reduce a race rating.
- Paste is disabled during practice. Interrupted or abandoned attempts cannot masquerade as completed comparable tests.
- Deterministic event replay must reproduce final text, errors, corrections, time and metrics.

**Explicitly undecided:**
- UI framework for later stages. The shipped slice is vanilla; the implementation plan defers framework selection to build kickoff and nothing has been recorded.
- Retention period, identity/sync needs, and participation terms for any shared or model-training data. Local-only practice proceeds without them.
- Whether the beginner path reuses the weak-pattern recommender or needs its own progression model.
- Hosting and deployment target.

**Deferred, not denied:** public matchmaking, seasons, full anti-cheat, learned ranked difficulty, additional languages, rhythm or music mechanics, browser-wide keystroke capture, extension packaging, Zetamac integration, LLM-generated drills. Public ranking requires integrity work before launch.

## Brand Commitments

- **"Stilltype" is a working title**, deliberately not hardened. Keep the wordmark cheap to change; no logotype or name-dependent identity investment until the name is settled.
- **The ash design system (`design/ash/`) is binding for all UI**, per `AGENTS.md`: dark only; depth is tonal, stepping a warm surface ladder rather than borders or shadows; Geist for copy and Geist Mono for data, ids, keys and eyebrows; one saturated blue for actions and focus; mint reserved for success state and never a button fill; danger and warning as ink or 14% tints, never fills; tabular numerals on every metric. Tokens are the source of truth — colours, type sizes and radii are never invented.
- **Voice:** sentence case everywhere, plain and direct, second person, present tense. Buttons are verbs. No emoji, no exclamation marks. Status is a mono pill, not a sticker.

## Evidence on Hand

- `docs/research/typing-platform-brief.md` and the unmodified `.docx` — 16 linked sources, preserved byte for byte.
- `docs/research/summary.md` — findings, differentiation hypothesis, and stated limits of the evidence.
- `docs/mvp-spec.md` — first journey, scope table, scoring contract, milestone 1 acceptance criteria.
- `docs/implementation-plan.md` — staged delivery with exit gates. `docs/ml-data-evaluation.md` — event schema, transparent baseline, model progression, evaluation design.
- `design/ash/` — complete design system export: tokens, component CSS, guideline and component specimens, two reference mocks.
- `.impeccable/critique/2026-09-21T21-47-50Z__index-html.md` — one prior critique snapshot of the shipped page.

**Absences future work must not fabricate:** no users, no usage data, no testimonials, no case studies, no press, no benchmarks, no learning-outcome evidence, no pricing, no deployment. The Reddit sampling is qualitative and not representative. No user study has been run and none is authorized by the research handoff.

## Product Principles

1. **Show the evidence or say nothing.** Every recommendation carries its observed counts and timing; every comparison carries its sample size and conditions. Insufficient data produces a general drill and a plain statement, never a confident guess.
2. **Never compare what is not comparable.** Same mode, length, corpus and metric version — or say so instead of claiming a result. A retest never reuses text the profile has seen.
3. **The typing surface is sacred.** It does not shift as errors, progress or results update; analytics wait until the run is over; nothing blocks practice behind an unlock.
4. **Depth is the proof.** Honest versioned measurement and a real evaluation against a transparent baseline matter more than feature count. If a model does not beat the simple baseline on learning, the baseline stays.
5. **Build nothing the beginner audience would force us to tear out.**

## Accessibility & Inclusion

- Mistyped characters must remain understandable without relying on colour — a non-colour cue is required.
- Restart and every primary action must work from the keyboard; a skip link reaches the typing field directly.
- Detailed analytics must not distract during typing.
- Target p95 input-to-visible-feedback under 50 ms on a named reference desktop and browser, with the measurement method recorded. This is a proposed engineering budget, not an achieved result.
- Unsupported input methods are stated plainly and never silently mis-scored.
