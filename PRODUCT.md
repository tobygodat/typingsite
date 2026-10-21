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
- A run is short (15–120 s presets; a custom time or word count allows 5–600 s or 5–500 words) and repeated many times in a sitting; the practice surface is returned to constantly, so its chrome is seen more often than any other screen.
- Practice is a focused, low-interruption moment. Detailed analytics belong after the run, never during it.
- History is local. Clearing it is user-initiated and offers an undo in the moment.
- Typing feel is the product's physical sensation: latency, stability of the text, and how errors read are functional requirements, not polish.

## Capabilities and Constraints

**Shipped today** (Stilltype, working title):
- A complete guest loop: timed/word/quote test (preset or custom length), observed recommendation or manual target, one-minute drill, unseen comparable retest, and saved local progress.
- Quote length/difficulty filters, optional punctuation, corrected WPM (or CPM, display only) and input accuracy, first-attempt error retention, keyboard display with layout legends and an optional finger map, text size, word highlight, one-line tape, live-metric, correction-policy (free, stop on error, no backspace, fail on word error, fail on any error) and focus preferences.
- Private online two-player races with account invitations, guest links, a shared server countdown, live progress and unranked results. A signed-in account hosts; guests can join without an account. Shared-keyboard challenges remain available.
- Composing practice: a neutral prompt and a free-typing field with no target text, ending on Done or after 60 s. Free-typing speed and backspace rate are their own measure, never compared with copy tests and never a best. Only the numbers are kept; the writing itself is never stored.
- Asynchronous ghost races: after a finished practice, retest or daily run, a signed-in user can send it to someone on their friend list. Within seven days the friend races the same text against a ghost caret replaying the sender's recorded keystrokes; both see who led and both wpm in their inbox. The lead goes to more correct characters per minute: the earlier finish under stop on error, never a quick finish full of mistakes, and on a timed run more correct text kept. The service recomputes every score from its keystroke trace. Ghost race runs are their own kind: never bests, trends or training evidence.
- Daily passage shared by UTC date, reset at midnight, from a frozen pool of 14 original texts. Fixed continue-on-error rule, saved personal results and labelled repeat attempts. A first attempt on a new day can still be a previously displayed passage; returning texts keep their identity and do not become fresh training evidence. Daily scores stay separate from personal practice bests and trends.
- Progress with condition/period filters, keyboard-accessible WPM and accuracy charts, weekly medians with sample counts, expandable run/comparison details and actions to practice an old target again.
- Recurring pattern counts across recent matching runs, last-practice information and later fresh observations for revisits. No confident target from a single sparse run.
- Corpus v5: 39 original quotes, at least three in each length/difficulty bucket, plus expanded real-word targeted drills. Difficulty labels remain descriptive, not calibrated.
- Condition-aware personal bests, guarded history deletion with immediate undo, explicit insufficient-evidence and interrupted states.
- A beginner path ("learn to type"): 14 lessons that add keys a few at a time with a finger map, real words from the common-word lists (labelled key pairs where none exist yet), unlocking on one run at 95% accuracy and a gentle speed, then a hand-off to the training loop. Only a physical-keyboard run passes a lesson; a touch run is labelled "touch input" and never unlocks. A lesson passes on the numbers it shows (whole-percent input accuracy and whole wpm, rounded as everywhere else), so 94.5% shown as 95% passes and 94.4% shown as 94% does not; a result never reads "95% · not met". Lessons never count as bests, trends or retests.
- Self-serve account deletion behind a typed confirmation: the server deletes the account and everything keyed to it first, and only then does the device sign out and clear its copy. A failure changes nothing and says so. There is no undo.
- Native HTML/CSS/JS modules with no runtime dependencies. `npm run dev` serves on :5173; `npm test` runs the engine checks. Literata (OFL, `src/fonts/OFL-literata.txt`) and Geist Mono are self-hosted in `src/fonts/`.
- Signed-in retention: newest 24 full attempt traces (within a 2.5 million character trace budget, skipping oversized traces), 1,000 compact run summaries (custom text and word practice keep their newest 50 apart, with no trace), pattern counts on the newest 120 summaries and first-try missed words (up to 12 a run) on the newest 120 runs that count toward "words you keep missing"; comparison summaries remain until cleared. Clear/Undo includes daily history. Guests retain everything only in memory for the tab. Older records keep unknown dates and missing score snapshots explicit.
- `src/typing.js` owns corpus selection, scoring, replay and pattern evidence; `src/app.js` owns UI orchestration and local persistence.

**Metric contract** (versioned before any data collection):
- Corrected WPM = correct target characters retained at finish / 5 / elapsed minutes. The optional CPM display is that WPM × 5; storage, scoring, comparisons and condition keys stay in WPM. Elapsed time runs from the first printable input on a monotonic clock and continues when unfocused.
- Online race elapsed time starts at the shared server start, including any delay before a player’s first key. Online results are separate from solo skill measurements and rankings.
- Input accuracy = correct printable insertions / all printable insertions. Corrections consume time and corrected errors stay in the denominator; backspace is not an insertion.
- Composing (compose v1, a separate measure): free-typing wpm = characters in the final text / 5 / active minutes, where active time sums the gaps between keys and counts any gap over 2 s as the average of the gaps of 2 s or less (so the key after a pause has a time of its own); no speed under 5 s of active typing. Backspace rate = backspace and delete keystrokes, each auto-repeat of a held key included and a word deleted with Ctrl/⌥ counted once / all keystrokes that changed the text. Cut, line deletes and keys over a selection are refused: Backspace and Delete remove one character (one grapheme) and a Ctrl/⌥ word delete at most one word. The scored text is the one the counted keys built: any change to the field that isn't exactly one counted key (IME, autocorrect, assistive text, an edit the browser applies after a refusal) marks the session as unsupported input, with no rates and nothing saved. Never compared with copy-test wpm or used as a best.
- An accent (dead) key sequence counts as the characters it commits: one, or the mark and the letter when they don't combine. Only a composition an accent key opened is scored (its `Dead` keydown, or a lone accent mark shown first), and only for what a Latin keyboard types (a Latin letter, or a digit, punctuation mark, symbol or space no other script owns). Any other composition is IME composition and is not scored, even when it commits one letter, as is an accent menu that changes letters already typed; a held key's repeats never count, nor does the letter that commits a mark a held accent key left pending. Every key of a commit is scored before the passage can end: on the last letter, a key the commit carries past the end (the h of `"h`) counts as a mistake against that letter and is not kept, and one that is that letter (`""` on a closing `"`) adds nothing, as a plain key after the end would not. On Windows, which can send the mark and that key as two inputs, the mark waits for the key's input and the two are scored together. A commit made before a timed run's limit counts, even when the key that ended it arrives after the limit.
- First-attempt errors are recorded per target position. A corrected passage must not erase the evidence that a mistake happened.
- Personal skill progress, quote difficulty / performance points, and multiplayer rating are three separate scores. A harder practice exercise must never read as a loss of skill or reduce a race rating.
- Paste is disabled during practice. Interrupted or abandoned attempts cannot masquerade as completed comparable tests.
- Deterministic event replay must reproduce final text, errors, corrections, time and metrics.

**Explicitly undecided:**
- A framework for later stages. This milestone deliberately retains native modules; see `docs/decisions/2026-09-22-learning-loop.md`.
- Retention period, identity/sync needs, and participation terms for any shared or model-training data. Local-only practice proceeds without them.
- Whether the beginner path should later feed its own evidence into the recommender. Today lessons use their own key-introduction progression and hand off to the weak-pattern recommender once every letter is in.
- Hosting and deployment target.

**Deferred, not denied:** public matchmaking, seasons, full anti-cheat, learned ranked difficulty, additional languages, rhythm or music mechanics, browser-wide keystroke capture, extension packaging, Zetamac integration, LLM-generated drills. Public ranking requires integrity work before launch.

## Brand Commitments

- **"Stilltype" is a working title**, deliberately not hardened. Keep the wordmark cheap to change; no logotype or name-dependent identity investment until the name is settled.
- **The Afterimage system, as shipped on 22 September 2026, is binding for all UI**, per `AGENTS.md`. `DESIGN.md` describes it; the tokens at the top of `src/styles.css` are the implementation source of truth. Colours, type sizes, radii and durations are never invented. The former Ash system (`design/ash/`) is historical reference and no longer binding.
- **Type:** Literata (variable weight and optical size, self-hosted under the OFL, with a serif fallback stack) for everything readable, including the typing passage and every numeral. Geist Mono, self-hosted, only for small measurement labels, conditions and keys. Tabular lining numerals on every metric.
- **Colour:** a warm near-black ground (`#0f0f0e`) in dark and warm paper (`#f4f1eb`) in light. Eight more themes can be picked: paper, shadcn, terminal, soft, midnight, swiss, e-ink and nord. The theme follows the system (dark or light) until the user picks one in settings or the command palette; it is a display preference, never a test condition, and syncs like any setting. Every theme is the same token set with the same roles: one accent means action, current state and the caret, and fills the primary button. It is green in dark (`#8fd18a`), light (`#217245`), paper, shadcn, terminal and nord; soft (violet), midnight (amber), swiss (black) and e-ink (grey) take their own. Danger (coral in dark and light) marks mistyped letters, always with a tint behind them as the non-colour cue, and regressions. Warning marks interrupted and mixed results. Every theme holds the same contrast floor.
- **Surfaces:** rules and space, not boxes. The dock, settings, command palette and toasts are opaque raised surfaces: no glass, no glow. A floating dock (top on desktop, bottom on mobile) holds practice, train, progress and challenge, plus a labelled settings control and a ⌘K / Ctrl-K command palette. A quiet "suggest a feature" link sits in the footer.
- **Fluid motion:** motion is welcome during a run as well as after it, wherever it helps someone follow their speed, position or progress. The caret is spring-driven, the pace caret glides through the letters at its speed, a ghost race glides between the friend's keys, and lines scroll in about 150 ms. Letter states change at once so the passage stays readable. The rest of the chrome fades out after the first keystroke and returns on pointer movement, finish or restart. After the run: short fades, a gliding selection pill, and the run card's speed graph drawing in about 450 ms. Everything scales to zero under `prefers-reduced-motion`.
- **The run card is a print:** WPM, accuracy, first-try errors, time, a one-line metric definition, the conditions line, and a speed-over-time line graph drawn from the real keystrokes, with mistakes marked in coral. The graph is presentational; scoring never reads from it.
- **The pace caret is never scored.** Settings (or the palette) set it to the personal best, the average of the last ten comparable runs, the last run or a custom speed; ↑↑↓↓←→←→ b a, or typing "ghost" in the palette, toggles it at the personal best. With no runs it moves at 60 wpm. It glides continuously at that speed and stays put under reduced motion. It is presentational only.
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
