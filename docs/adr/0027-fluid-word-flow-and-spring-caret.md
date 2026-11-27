# 0027. Fluid word flow and the spring caret

Status: Accepted, 2026-11-25.

## Context

Practice types a passage letter by letter. A space typed mid-word takes that letter's place, and a letter typed where the passage has a space takes the space's place, so one slip can leave the rest of the line misaligned. Typists who come from word-based trainers expect a space to end the word they are in, extra letters to stay on that word, and Backspace to leave a finished, correct word alone.

The caret glides over a fixed CSS duration. Each key restarts the transition from rest, so a fast burst moves in steps rather than one motion.

[ADR 0003](0003-versioned-metric-contract.md) requires a new version for any change to how a run is recorded or scored. [ADR 0004](0004-conditions-keys.md) requires that existing condition keys stay byte for byte the same.

## Decision

### Word flow

- `wordFlow` is a practice preference: `fluid` (the default) or `linear`. A profile that never chose a word flow and has saved runs or bests, none of them fluid, types `linear` (`historyWordFlow` in `src/profile.ts`). This keeps an existing account's bests, averages and Train baselines. The value is read each time and never stored, so synced copies stay as they were. A new profile, a guest, and any profile that has typed a fluid run get `fluid`. A run is fluid only when its conditions say `wordFlow: 'fluid'` and `wordFlowApplies` holds: a time, words, quote, book, custom or missed-words run with free correction (`relaxed`) and no strict space. Online races, quick matches, one-keyboard races, the standard test, lessons, code, the daily passage, strict space and every other correction policy stay linear, whatever the preference says.
- `src/word-flow.ts` holds the rules as a pure state machine (`WordFlowState`, `createWordFlow`, `applyWordFlowKey`, `applyWordFlowDelete`, `applyWordFlowDeleteWord`). It imports nothing.
  - A space mid-word moves to the next word. The letters it skipped stand in the kept text as a private-use mark (`MISSED`) and are shown as missed.
  - A space at a word's first letter does nothing and starts nothing.
  - Letters typed past a word's end stay on that word, up to `WORD_FLOW_MAX_EXTRA` (8). They never take a passage position.
  - Backspace at a word's first letter goes back into the previous word only if that word has a skipped or wrong letter, or extras.
  - Word delete (`deleteWordBackward`: Option+Backspace on macOS, Ctrl+Backspace elsewhere) clears the current word and its extras. At a word's first letter, it takes the previous word whole, under the same rule as Backspace. A linear run deletes back to the previous space instead, and an online race keeps its one-letter delete.
- A fluid run records `eventVersion: 'stilltype-word-flow-events-v1'` and three event types that linear runs never record:
  - `skip { position, count }`: a space at `position` that skipped `count` letters.
  - `extra { text, position }`: a letter past the word that ends at `position`.
  - `delete-extra { count }`: extras removed at the caret.
  - Letters, normal spaces and Backspace into kept text use the existing `insert` and `delete` events.
- The live input records the steps the state machine returns, and replay applies the same steps, so `replayAttempt`, `replayCursor` and `replayFlow` give the live state at every recorded moment.
- Scoring keeps `stilltype-metrics-v1`. A skip and an extra each count as one keystroke and one first-try error at their position. Repeated extras at one position each count as a separate keystroke error, and they share one first-try entry for that position. Skipped letters are never correct. Extras still standing at the finish count as extra characters on the run card. Speed counts correct letters at their passage positions, as before.
- `inputRules` appends `word-flow` for a fluid run, after `strict-space` and `quick-end-off`. Fluid runs therefore key apart from linear ones, and their bests never mix. A linear run adds nothing, so every existing key is unchanged (`tests/typing.test.js`).
- A retest keeps its baseline's word flow, as it keeps strict space and quick end.
- A fluid run's ghost trace records a skip as a wrong key at each letter it skipped, then its space, and leaves out extras and their deletes. Replayed in order, the trace walks the run's caret path and counts the same correct letters, so a ghost race's outcome and speed match the run. The friend races under linear word flow, as every race does. The trace's accuracy counts each skipped letter as a miss, so it can read lower than the run card's.

### Caret motion

- `typingMotion` is `spring` (the default), `smooth` or `instant`. A profile that stored `smooth` or `instant` keeps it. `caretGlide` sets the Smooth duration only.
- The spring follows the caret's target with its velocity carried from key to key. It is critically damped (natural frequency 38 per second) and stepped by its exact closed-form solution, so every frame rate and every dropped frame follow the same curve and it cannot diverge. It snaps on a line change, a restart and a re-layout, so it never moves diagonally. Its frame loop stops once the caret is within 0.1 px of the target and moves under 2 px per second, or 300 ms after the target last changed, whichever comes first. Under `prefers-reduced-motion: reduce`, it lands on each letter at once.
- Scoring (`src/typing.ts`, `src/word-flow.ts`) never reads `src/motion.ts` or `src/caret-glide.ts`.

### Code mode

- Every passage sets `font-variant-ligatures: none` and `font-feature-settings: "liga" 0, "calt" 0`. A code passage (`#text-display[data-passage="code"]`) also turns `dlig` off. Operators such as `<=`, `=>`, `!==` and `->` show as the characters typed.

## Consequences

- A new person types fluid runs. An existing account stays linear until it chooses fluid. Its fluid bests then start apart from its linear bests at the same shape, and Progress names the two sets "fluid words" and "linear words".
- Online races, quick matches and the standard test record exactly what they recorded before, so the race trace check and the standard test's comparisons are unaffected.
- The speed graph (`src/graph.ts`) does not read `skip`, `extra` or `delete-extra` events. On a fluid run, its trace can drift slightly from the scored run after Backspace returns into a skipped word, and the graph does not mark skips or extras as mistakes. Scoring, accuracy, the run card, replay and pair timings read the events in full.
- e2e specs that test letter-position geometry choose linear word flow explicitly (`chooseLinearWordFlow` in `e2e/fixtures.js`). `e2e/word-flow.spec.js` covers fluid behaviour.
- A change to these rules needs a new event version and an ADR that supersedes this one.
