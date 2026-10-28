# MVP specification

Status: milestone specification, originally written 21 September 2026. Implementation was authorized on 22 September. Grounded in the [research summary](research/summary.md); `PRODUCT.md` owns audience decisions and the [Linear project](https://linear.app/tobygodat/project/stilltype-6e4e58731700) records the current delivery state.

## User and promise

Start with people who already touch type and want to improve while enjoying competition. After a run, help them understand what slowed them down, practice it immediately, and compare performance on unfamiliar text. Beginners are the committed second audience; their teaching path follows the proven solo loop.

## First milestone journey

1. Choose a curated quote or word test and begin typing immediately.
2. Finish and see accuracy, corrected WPM, and up to two weak patterns with an explanation.
3. Start a roughly one-minute targeted drill, or choose a target manually.
4. Type a fresh, comparable passage containing the selected patterns.
5. See changes in accuracy and timing, with the text/rule context and sample size visible; save the session to one progress view.

This first milestone proves the solo learning loop. Ghosts and friend races later use the same results and recommendations. A single before/after comparison is feedback, not proof of lasting improvement.

## Scope

| Area | Milestone 1 | Subsequent MVP stages |
| --- | --- | --- |
| Play | Stable minimal typing surface; quotes and word tests; instant restart; font/theme controls; keyboard navigation | Personal-best ghosts and daily quotes |
| Train | Explain weak pairs/words; manual targets; varied realistic drills; fresh-text retest | Model recommendations only after baseline evaluation |
| Progress | Local shared profile; mode-aware history; accuracy, timing, target evidence | Account sync when needed for cross-device or social play |
| Compete | No live networking needed for the first milestone | Friend rooms before public matchmaking |
| Difficulty | Quote length and transparent descriptive difficulty filters, including long practice | Versioned quote difficulty and performance points after calibration |

Proposed implementation defaults: English text, desktop physical keyboards, and a guest profile stored on the device. Clearly state unsupported input methods; do not silently mis-score them. These defaults limit the first milestone, not the long-term audience.

## Scoring and feedback contract

Every result carries corpus/text version, language, mode, duration, correction policy, and metric version. Keep **personal skill progress**, **quote difficulty/performance points**, and **multiplayer rating** separate. A harder practice exercise must not reduce a player's race rating or be presented as a loss of skill.

Proposed metric definitions for milestone 1:

- Elapsed time runs from the first printable input to completion or timed cutoff, using a monotonic clock. No solo countdown. A focus interruption marks the run interrupted; restart for a comparable result.
- Corrected WPM = `(correct target characters retained at finish / 5) / elapsed minutes`, including spaces and punctuation. Corrections consume time; retyped characters count once in the final numerator. Zero-time or empty attempts have no WPM result.
- Input accuracy = `correct printable insertions / all printable insertions × 100`, evaluated against the expected position at each insertion. Backspace is not an insertion. Retrying after a correction adds a new attempt; the original error remains in the denominator.
- Record first-attempt errors at each target position separately for training. A corrected final passage must not erase evidence of mistakes.
- Label relaxed/short burst modes separately. Mandatory-correction quote mode blocks advancement until the current error is corrected; future ranked quotes use that rule. Detailed analytics appear after the run.

Version these definitions before collecting data. Do not imply scores are directly equivalent to another site's WPM. The [data plan](ml-data-evaluation.md) defines timing exclusions and recommendation evidence.

## Milestone 1 acceptance criteria

- [ ] A guest can complete run → recommendation → drill → fresh retest → saved progress without an account or external service.
- [ ] The typing surface does not move as errors, progress, or results update. Actual mistaken characters remain understandable with non-color cues. Restart and primary actions work by keyboard; detailed analytics do not distract during typing.
- [ ] Quotes support length/difficulty filtering and a long-text option. Each text has provenance and a version; use original or appropriately licensed content. A retest never repeats text already seen by that profile. If no comparable fresh text exists, say so instead of claiming a valid comparison.
- [ ] Deterministic event replay reproduces final text, errors, corrections, time, and metrics. A 300-character corrected completion over 60 seconds produces 60 corrected WPM; 300 correct plus 10 incorrect insertions produces 300/310 input accuracy even when all errors are fixed.
- [ ] Restart resets attempt state; interrupted/abandoned attempts cannot masquerade as completed comparable tests. Paste, composition, held keys, and focus changes have explicit handling and cannot create unexplained score spikes.
- [ ] Recommendations show observed counts and error/timing evidence, offer manual override, and handle insufficient data with a general drill. No opaque unlock prevents practice.
- [ ] A saved profile survives reload. A user can clear local history. Progress compares compatible modes/text conditions and shows evidence counts; no universal WPM ranking mixes easier tests with harder drills.
- [ ] On a named reference desktop/browser, a documented typing smoke test shows no lost/doubled events and targets a p95 input-to-visible-feedback delay under 50 ms. Record measurement method and device; this is a proposed engineering budget, not an achieved result.

## Deferred scope

Public matchmaking, seasons, full anti-cheat, learned ranked difficulty, extra languages, beginner instruction, rhythm/music mechanics, extension-wide monitoring, Zetamac integration, and LLM-generated drills are outside milestone 1. Public ranking requires additional integrity work before launch.

## Essential unresolved decisions

1. **Initial audience, settled:** English typists using a physical keyboard, with a later beginner path, as recorded in `PRODUCT.md`.
2. **Learning priorities, settled for this build:** complete the solo loop and a local shared-keyboard challenge. Networked friend rooms remain a separate stage.
3. **Before shared data collection:** choose identity/sync needs, an explicit retention period, and participation terms for model training. Local-only practice can proceed without these services.

The existing native browser stack is retained for this build. Hosting remains undecided.
