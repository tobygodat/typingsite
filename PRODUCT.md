# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary, now:** people who already touch type on a physical keyboard, in English, who want to get faster and more accurate and enjoy competing. They arrive knowing roughly what their WPM is and want to know what is holding it back.

**Committed second audience, built after the solo loop is proven:** beginners learning to type, also on a physical keyboard. Confirmed during init, September 2026. This supersedes the MVP spec's deferral of beginner instruction as an audience decision — the teaching path itself is not milestone 1 scope, but no architecture, progress model, or UI may be built that would have to be torn out to serve them.

Everyone starts as a guest: default settings, and nothing is saved beyond the tab. Creating an account (email and password, or Google) keeps settings, runs and progress per person and syncs them across devices. Touch entry is scored and labelled on its own and is never compared with physical-keyboard runs.

## Product Purpose

One connected loop: **play → identify weak patterns → practice → measure improvement on fresh text.** Existing typing sites make people switch between a clean test, targeted learning, and competition; this product tries to make the next useful exercise the obvious next step from a result.

Success for milestone 1: a guest completes run → explained recommendation → drill → fresh comparable retest → progress (kept for the tab as a guest, saved once signed in), and understands what each number does and does not mean.

## Positioning

The explained race-to-drill-to-fresh-text loop, held to honest measurement. Every recommendation shows the evidence behind it — error counts, timing against the user's own median, sample size. Every comparison names its text, rule and metric version. Improvement is only ever claimed on text the profile has not seen before.

This is stated in the research as a hypothesis about usability and learning, not a proven outcome and not a claim of novelty. Monkeytype, keybr, TypeRacer and TypeGG are influences and prior art, not features this product claims to have invented; Monkeytype already offers missed-word practice and TypeGG already offers competitive progression. Integration and demonstrable learning are what have to justify the product.

## Operating Context

- Browser on desktop, physical keyboard, solo practice and private two-player online races. Practice works offline and without an account; signed-in profiles sync through Supabase, and a feature suggestion (text and current view only, never linked to an account) is sent only when the visitor presses Send.
- A run is short (15–120 s) and repeated many times in a sitting; the practice surface is returned to constantly, so its chrome is seen more often than any other screen.
- Practice is a focused, low-interruption moment. Detailed analytics belong after the run, never during it.
- History is local. Clearing it is user-initiated and offers an undo in the moment.
- Typing feel is the product's physical sensation: latency, stability of the text, and how errors read are functional requirements, not polish.

## Capabilities and Constraints

**Shipped today** (Stilltype, working title):
- A complete guest loop: timed/word/quote test, observed recommendation or manual target, one-minute drill, unseen comparable retest, and saved local progress.
- Quote length/difficulty filters, optional punctuation, corrected WPM and input accuracy, first-attempt error retention, keyboard display, text size, live-metric, stop-on-error and focus preferences.
- Private online two-player races with account invitations, guest links, a shared server countdown, live progress and unranked results. A signed-in account hosts; guests can join without an account. Shared-keyboard challenges remain available.
- Daily passage shared by UTC date, reset at midnight, from a frozen pool of 14 original texts. Fixed continue-on-error rule, saved personal results and labelled repeat attempts. A first attempt on a new day can still be a previously displayed passage; returning texts keep their identity and do not become fresh training evidence. Daily scores stay separate from personal practice bests and trends.
- Progress with condition/period filters, keyboard-accessible WPM and accuracy charts, weekly medians with sample counts, expandable run/comparison details and actions to practice an old target again.
- Recurring pattern counts across recent matching runs, last-practice information and later fresh observations for revisits. No confident target from a single sparse run.
- Corpus v5: 39 original quotes, at least three in each length/difficulty bucket, plus expanded real-word targeted drills. Difficulty labels remain descriptive, not calibrated.
- Condition-aware personal bests, guarded history deletion with immediate undo, explicit insufficient-evidence and interrupted states.
- Native HTML/CSS/JS modules with no runtime dependencies. `npm run dev` serves on :5173; `npm test` runs the engine checks. Literata (OFL, `src/fonts/OFL-literata.txt`) and Geist Mono are self-hosted in `src/fonts/`.
- Signed-in retention: newest 24 full attempt traces, 1,000 compact run summaries and pattern counts on the newest 120 summaries; comparison summaries remain until cleared. Clear/Undo includes daily history. Guests retain everything only in memory for the tab. Older records keep unknown dates and missing score snapshots explicit.
- `src/typing.js` owns corpus selection, scoring, replay and pattern evidence; `src/app.js` owns UI orchestration and local persistence.

**Metric contract** (versioned before any data collection):
- Corrected WPM = correct target characters retained at finish / 5 / elapsed minutes. Elapsed time runs from the first printable input on a monotonic clock and continues when unfocused.
- Online race elapsed time starts at the shared server start, including any delay before a player’s first key. Online results are separate from solo skill measurements and rankings.
- Input accuracy = correct printable insertions / all printable insertions. Corrections consume time and corrected errors stay in the denominator; backspace is not an insertion.
- An accent (dead) key sequence counts as the characters it commits: one, or the mark and the letter when they don't combine. IME composition is not scored.
- First-attempt errors are recorded per target position. A corrected passage must not erase the evidence that a mistake happened.
- Personal skill progress, quote difficulty / performance points, and multiplayer rating are three separate scores. A harder practice exercise must never read as a loss of skill or reduce a race rating.
- Paste is disabled during practice. Interrupted or abandoned attempts cannot masquerade as completed comparable tests.
- Deterministic event replay must reproduce final text, errors, corrections, time and metrics.

**Explicitly undecided:**
- A framework for later stages. This milestone deliberately retains native modules; see `docs/decisions/2026-09-22-learning-loop.md`.
- Retention period, identity/sync needs, and participation terms for any shared or model-training data. Local-only practice proceeds without them.
- Whether the beginner path reuses the weak-pattern recommender or needs its own progression model.
- Hosting and deployment target.

**Deferred, not denied:** public matchmaking, seasons, full anti-cheat, learned ranked difficulty, additional languages, rhythm or music mechanics, browser-wide keystroke capture, extension packaging, Zetamac integration, LLM-generated drills. Public ranking requires integrity work before launch.

## Brand Commitments

- **"Stilltype" is a working title**, deliberately not hardened. Keep the wordmark cheap to change; no logotype or name-dependent identity investment until the name is settled.
- **The Afterimage system, as shipped on 22 September 2026, is binding for all UI**, per `AGENTS.md`. `DESIGN.md` describes it; the tokens at the top of `src/styles.css` are the implementation source of truth. Colours, type sizes, radii and durations are never invented. The former Ash system (`design/ash/`) is historical reference and no longer binding.
- **Type:** Literata (variable weight and optical size, self-hosted under the OFL, with a serif fallback stack) for everything readable, including the typing passage and every numeral. Geist Mono, self-hosted, only for small measurement labels, conditions and keys. Tabular lining numerals on every metric.
- **Colour:** a warm near-black ground (`#0f0f0e`) in dark and warm paper (`#f4f1eb`) in light. The theme follows the system until the user picks dark or light in settings or the command palette. One green accent (dark `#8fd18a`, light `#2e7d4f`) means action, current state and the caret; the primary button is a filled green. Coral (danger) marks mistyped letters, always with a coral tint behind them as the non-colour cue, and regressions. Warning marks interrupted and mixed results.
- **Surfaces:** rules and space, not boxes. The dock, settings, command palette and toasts are opaque raised surfaces: no glass, no glow. A floating dock (top on desktop, bottom on mobile) holds practice, train, progress and challenge, plus a labelled settings control and a ⌘K / Ctrl-K command palette. A quiet "suggest a feature" link sits in the footer.
- **Still run:** nothing decorative moves near the passage while typing. The caret is solid and spring-driven, letter states change instantly, and lines scroll in about 150 ms. The rest of the chrome fades out after the first keystroke and returns on pointer movement, finish or restart. Motion belongs after the run and in chrome only: fades of 200 ms or less, a gliding selection pill, and the run card's speed graph drawing in about 450 ms. Everything scales to zero under `prefers-reduced-motion`.
- **The run card is a static print:** WPM, accuracy, first-try errors, time, a one-line metric definition, the conditions line, and a speed-over-time line graph drawn from the real keystrokes, with mistakes marked in coral. The graph is presentational; scoring never reads from it.
- **The ghost pacer is a hidden extra, never scored.** ↑↑↓↓←→←→ b a, or typing "ghost" in the command palette, toggles a pacer caret that moves at the personal best for the current conditions (or 60 wpm). It is presentational only.
- **Voice:** plain and direct, second person, present tense. Buttons are verbs. No emoji, no exclamation marks. Interface labels in chrome (dock, settings, palette) are lowercase; headings and buttons use sentence case. Say each measurement caveat once, briefly, next to the number it qualifies.

## Evidence on Hand

- `docs/research/typing-platform-brief.md` and the unmodified `.docx` — 16 linked sources, preserved byte for byte.
- `docs/research/summary.md` — findings, differentiation hypothesis, and stated limits of the evidence.
- `docs/mvp-spec.md` — first journey, scope table, scoring contract, milestone 1 acceptance criteria.
- `docs/implementation-plan.md` — staged delivery with exit gates. `docs/ml-data-evaluation.md` — event schema, transparent baseline, model progression, evaluation design.
- `design/ash/` — the former Ash design system export: tokens, component CSS, guideline and component specimens, two reference mocks. Historical reference since the 22 September 2026 redesign; not binding.
- `.impeccable/critique/2026-09-21T21-47-50Z__index-html.md` — critique snapshot of the pre-redesign (Ash) page.
- `.impeccable/critique/2026-09-22T19-57-13Z__index-html.md` — critique of the Afterimage redesign that led to the still-run trim.

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
- Target p95 input-to-visible-feedback under 50 ms on a named reference desktop and browser, with the measurement method recorded. The Afterimage bounded-renderer build measured 32 ms browser event-to-next-paint p95 in the Codex in-app Chromium browser on an Intel Core Ultra 7 155H; see `docs/verification/2026-09-22-latency.md` for method and limits.
- Unsupported input methods are stated plainly and never silently mis-scored.
