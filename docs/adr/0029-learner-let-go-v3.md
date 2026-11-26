# 0029. learner-let-go@3: a drilled target is let go on evidence fixed at its drill

Status: Proposed, 2026-11-26. TOB-511. This file holds the rule and its decision clauses. Results are added below only after the test seeds run, and nothing above "Results" changes after that.

Written and committed as ADR 0027 (`aea5944`); renumbered 0029 because `0026-architectural-tokens-and-default-inter.md` and `0027-fluid-word-flow-and-spring-caret.md` already existed on master and `0028` is used by the Progress slipping rule (`0028-progress-slipping-rule.md`). Nothing else in the rule changed. [ADR 0019](0019-learner-lets-go.md) is accepted and is not edited.

## Context

[ADR 0019](0019-learner-lets-go.md) failed its rule: `learner-let-go@2` and `learner-let-go-misses@2` stay named, non-default versions. It named four causes and three things to try next. This ADR tries all three, in one candidate, judged on fresh seeds:

1. **The walk's typical rate moved.** `learner-let-go@2` reads the person's pooled miss rate from all the evidence it holds, so every new run can move a crossing, and a let-go target could fall back below the line.
2. **The walk restarted.** The profile keeps pattern evidence on the newest 120 runs. When a retest left that window, the evidence since the drill lost its start. 7 of the 14 flickering let-gos on validation seed 9001 were of that kind.
3. **"Returned" counted the other kind.** A target let go for its misses and then named for its pace (or the reverse) was scored as a false return. Toby decided on 2026-11-17: **it is a new step.** The let-go drops only the part that was drilled, and Train shows the other kind as a new step.
4. **A normal 25-word run holds too little.** A drilled pair gets 1 to 3 first tries a run, so a claim at 100 to 1 takes 50 to 100 runs. Toby decided on 2026-11-11 that practice text changes only inside the adaptive choice. This ADR tries that choice, and nothing else.

## The candidate: `learner-let-go@3`

`learner-let-go@2` with five changes. Every constant not named below keeps its ADR 0019 meaning, and `A = ln 100`. Every earlier variant (`learner@1`, `learner-decay@1`, `learner-timing@1`, `learner-decay-timing@1`, `learner-own-cost@2`, `learner-let-go@2`, `learner-let-go-misses@2`) computes byte for byte what it did, and the ADR 0013, 0015 and 0019 records reproduce.

### 1. The typical rate is fixed at the drill

For a drill split at time `s`, the typical rate `p` is the raw first-try miss rate over every pair in the newest `TYPICAL_RUNS = 40` evidence records dated before `s`, floored at 1%. With no record before `s` it is the floor. Nothing dated at or after `s` enters `p`, so no later run moves a crossing. The pace walk reads no rate.

### 2. Pattern evidence is kept for the runs since each kept drill

`retainRuns` (`src/insights.ts`) keeps pattern counts on the newest 120 runs that carry any, as before, and now also on every carrying run from `TYPICAL_RUNS` runs before the `KEPT_RETESTS = 8`th newest retest on, at most `MAX_DRILL_WINDOW = 240` carrying runs in all. It reads only the runs, so merging two copies of a profile keeps the same runs on both (ADR 0005), and it keeps counts only, never a keystroke recording (ADR 0006). A run still holds the same fields, so a copy with fewer runs kept is a prefix of one with more, and a run dropped from the window loses its pattern counts and nothing else, as today.

A walk whose evidence no longer reaches back to its split (the oldest kept run is newer than the split and the window is full) reads **not let go**. That is the one cost: a target drilled more than about 200 runs ago is named again on what remains. It is stated here and not measured, because no season below runs that long.

The older variants must not see the longer window, so `recommendFor` trims their input to the newest 120 pattern-carrying runs, as the profile held before. A test pins that a profile with 240 kept runs gives them exactly what its newest 120 gave.

### 3. A return counts only for the kind drilled

A target drilled for its misses is let go on misses and comes back when its misses are named again; being named for its pace is a new step. The reverse holds for a pair drilled for its pace. `letGo` already drops only the drilled part of the gain. What changes is what reads it:

- The new `queuedFor(queue, unit, basis)` is true when the unit is queued **for that kind** (a queue item whose `was.basis` is `'slow'` is a pace item, any other is a misses item).
- Train's "fixed" is `letGo(...) && !queuedFor(queue, unit, kind drilled)`. A target drilled for its misses, let go, and then queued for its pace reads fixed behind, and its pace is a new open or ahead step.
- A property test checks, over random histories in every focus, that no unit is both fixed on Train and queued for the same kind by the learner.

### 4. Adaptive runs count as evidence of letting go, and lean harder toward drilled pairs

Only inside the adaptive choice. Non-adaptive practice, the retest, the test text and the drill text are unchanged.

- **Evidence.** A completed adaptive run is drill-kind. It never counts as a best, a trend point, a baseline, or evidence of the normal fit. It now also keeps `adaptivePatterns`: the 6-field pattern rows (the same shape as `patterns`) of up to 8 pairs it typed at least 5 first tries of, most tries first. They enter only the let-go walk, as one more run each, in date order with the normal runs. `runRecord` computes them from the attempt as `summarizePatterns` does for a test. They are trimmed with the pattern window.
- **Lean.** For an adaptive passage only, the recommendation's `lean` is rebuilt: the units of the newest `LEAN_DRILLED = 2` drilled targets that are not let go (for the kind drilled) share `DRILL_LEAN_SHARE` of the weight, equally, and the learner's own lean units share the rest in their own proportions. With no such target, the lean is exactly what it was. The share is chosen on validation, from {0.5, 0.75, 0.9}.

What an adaptive run holds: about half of its words hold a lean unit, so a 25-word run has about 12 of them. With two drilled targets sharing `S`, each drilled pair gets about `12 × S / 2` first tries a run: 3 at `S = 0.5`, 4.5 at 0.75, 5.4 at 0.9. One drilled target gets twice that. A normal 25-word run gives a drilled pair 1 to 3. The run targets below are stated for each.

### 5. The test, unchanged in form

For misses, `p` fixed as in (1), "still weak" is `R × p` capped at 0.5, and the walk is held between −A and A. For pace, one fact a run (slower than the person's median or not) with `q0`, as ADR 0019. Floors: 2 runs and 20 observations of the kind drilled, adaptive runs included. The return walk is ADR 0019's CUSUM with `H`, and a return is read only for the kind drilled (3).

## Decision rule

### Seeds

Validation seeds 9001 and 9002 choose every constant. Test seeds 501 to 530, thirty that no ADR before this one used (ADR 0013 used 101 to 130, ADR 0015 its own, ADR 0019 301 to 330, ADR 0026 its own), run **once**, after this rule and the constants are committed. Nothing in the test is read from a test seed before then.

### Constants, chosen on validation seeds only

1. **R** from {3, 4, 6, 8}, on the normal-run arm. Eligible when false let-go for misses is at most 1% (season, unchanged world, pooled). Among the eligible, the fewest median runs to read fixed (25-word runs). A tie goes to the smaller. With none eligible, 3.
2. **q0** from {0.75, 0.85, 0.95}, the same way for pace.
3. **H** from {ln 10³, ln 10⁴, ln 10⁵}, at those R and q0, on the normal arm. Eligible when same-kind false return of each kind is at most 2.5%. Among the eligible, the fewest median runs until a target that slipped again is named again (regress world, kinds pooled). A tie goes to the larger. With none eligible, the largest.
4. **S** (`DRILL_LEAN_SHARE`) from {0.5, 0.75, 0.9}, at those R, q0 and H, on the adaptive arm. Eligible when false let-go is at most 1% for each kind. Among the eligible, the fewest median runs to read fixed for misses at 25 words. A tie goes to the smaller. With none eligible, 0.5.

### Simulators

- **The guard world** is ADR 0015's and ADR 0019's, unchanged: three groups of 24 typists, 40 runs of 25 words, miss cost 1 to 8 intervals, its two variants, with loops saved after a retest at run 20 and each loop's kind what the shipped default named the target for.
- **The season** is ADR 0019's: 54 cells (words a run {10, 25, 100}; runs a day {1, 5, 15}; skill {careful, average, learning}; bad days {no, yes}), two typists a cell a world a seed, one planted error pair and one planted slow pair, drilled after run 19 and retested at run 20 (kind `retest`), 160 runs, worlds *fixed*, *unchanged*, *halved*, *regress* (weak again from run 80). The profile keeps pattern evidence as `retainRuns` now does, 120 runs plus the drill window, and the older variants see the newest 120. Which targets count: only those the shipped default queued on the 20 runs before the drill, drilled for the kind it queued them for.
- **Two arms.** *Normal*: every run after the retest is a normal run of the cell's length. *Adaptive*: every run after the retest is an adaptive passage of the cell's length, made by `makeAdaptive` from the candidate's own adaptive lean after the previous run, typed by the same typist. Both arms run the candidate; the shipped default runs only in the normal arm, because it leans nowhere else.

### Measures

Per kind (misses, pace), over counted targets, per arm: **runs to read fixed** (fixed world: runs from the retest until `letGo` and not queued for the kind; 141 means not in the season; median, 90th percentile, share within 10 and 20); **false let-go** (unchanged world, share ever read fixed); **false return** (fixed world, share read fixed and later not, for the kind drilled only); **named again** (regress world, runs after run 80 until queued for the kind again, for targets read fixed at run 79). Reported, deciding nothing: the halved world's share read fixed; the other kind's later queueing; the median first tries of the drilled pair a run, in each arm; every measure by cell; ADR 0019's measures (false return counting the other kind) for comparison with `learner-let-go@2` on the same seeds. Shares carry a 95% Wilson interval.

### Decision

`learner-let-go@3` becomes the policy Train's "fixed" reads, and `DEFAULT_POLICY` becomes `learner-let-go@3`, only when **all** hold:

- **(a) No harm.** Against `learner-decay-timing@1` on the guard world, test seeds, it is really worse on none of ADR 0015's guards in either variant (ADR 0013's "really worse": a 95% paired t interval over the thirty seeds that excludes zero on the worse side; no margin; a tie passes).
- **(b) Let go in runs the evidence allows.** Medians of runs to read fixed, 25 words a run:

  | arm | misses | pace |
  | --- | --- | --- |
  | normal | at most 60 | at most 45 |
  | adaptive | at most 20 | at most 40 |

  Why these numbers: a 100-to-1 claim needs about 61 clean first tries at `R = 3` and a typical rate of 3.5% (each clean try adds `ln(0.965 / 0.895) = 0.075` against `ln 100 = 4.6`). A normal run gives 1 to 3 tries, so about 30 runs with no miss and more with one: 60 leaves room for misses. An adaptive run gives about 4 per drilled pair: 15 runs, 20 with room. Pace reads one fact a run whatever the run holds, and a fixed pair is slower in half of them, so the walk drifts up by about 0.14 a run (`0.5 ln 2 − 0.5 ln 1.5`) and needs about 32 runs at `q0 = 0.75`: 45 and 40 leave room, and the adaptive arm is not expected to do better there.
- **(c) False let-go at most 2%**, each kind, in each arm: the upper end of the Wilson interval, unchanged world, 54 cells pooled.
- **(d) False return at most 5%**, each kind, in each arm: the upper end of the Wilson interval, fixed world, pooled, the kind drilled only.

**Mixed results.** If (a) and every clause for misses pass and a clause for pace fails, `learner-let-go-misses@3` (pace targets never let go) is judged by (a) and the clauses for misses, and becomes the policy if it passes. If a clause holds only in one arm, the policy does not become the default, and this ADR says which arm failed. Otherwise `DEFAULT_POLICY` and Train's `isFixed` stay as they are, both variants stay as named versions, no threshold moves, and this ADR says what failed.

**Train's "fixed".** When the rule passes, `isFixed` reads `letGo` and `queuedFor` (3). When it fails, `src/train-path.ts` is unchanged in behaviour (`queuedFor` may be exported and tested without Train reading it).

### Still provisional

`PRODUCT.md` principle 4 holds. A promotion is provisional, on simulated typists, and claims nothing about learning.

## Results

### Validation (seeds 9001 and 9002, run after this rule was committed and before any test seed)

`bun run evaluate:learner -- --rule 0027 --validation-only`. Each season row below counts the targets the shipped default queued before their drill, drilled for the kind it queued them for.

| R | false let-go, misses | median runs to read fixed, 25 words |
| --- | --- | --- |
| 3 (chosen) | 0.0% | 61 |
| 4 | 4.7% | 42 |
| 6 | 20.8% | 29 |
| 8 | 33.0% | 25 |

| q0 | false let-go, pace | median runs to read fixed, 25 words |
| --- | --- | --- |
| 0.75 (chosen, none eligible: the rule takes the smallest) | 1.95% | 38.5 |
| 0.85 | 6.5% | 28 |
| 0.95 | 14.9% | 28 |

| H | false return, misses | false return, pace | named again (median runs) |
| --- | --- | --- | --- |
| ln 10³ (chosen) | 1.1% | 0.8% | 29 |
| ln 10⁴ | 1.1% | 0.8% | 34.5 |
| ln 10⁵ | 1.1% | 0.0% | 41 |

| S | false let-go misses / pace | median runs to read fixed, 25 words (misses / pace) | median first tries of the drilled pair a run (misses / pace) |
| --- | --- | --- | --- |
| 0.5 (chosen, none eligible: the rule takes the smallest) | 2.8% / 1.3% | 21 / 22.5 | 5 / 7 |
| 0.75 | 2.8% / 1.9% | 14 / 19 | 7 / 9 |
| 0.9 | 0.9% / 1.3% | 10 / 14 | 8 / 10.75 |

Two rules gave "none eligible": q0 (every value above the 1% ceiling) and S (no value under 1% for both kinds). Each fell to the rule's stated default, the smallest value, and the constants were fixed as the rule says: **R = 3, q0 = 0.75, H = ln 10³, S = 0.5**. Validation was not repeated with any other choice. A reader can see that S = 0.9 would have cleared the misses ceiling and would have read fixed in about half the runs; the rule committed above did not let validation pick it, and the test below runs S = 0.5.

Test results: not yet run.

## Consequences

To be written with the results.
