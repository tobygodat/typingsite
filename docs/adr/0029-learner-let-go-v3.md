# 0029. learner-let-go@3: a drilled target is let go on evidence fixed at its drill

Status: Accepted, 2026-11-26. TOB-511. Both candidates failed the rule below; the default is unchanged.

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

The rule was committed (`aea5944`, "Write learner-let-go@3's decision rule before any code or run (TOB-511)") before any code and before any run. Validation chose the constants on seeds 9001 and 9002 (`4abdeb8`, test updated at `ac2561f`), and the fresh test seeds 501 to 530 ran **once**. The full record is in [`0029-evaluation.json`](0029-evaluation.json). `bun run evaluate:learner -- --rule 0029` reproduces it, and ADR 0013's, 0015's and 0019's records still reproduce.

**Both `learner-let-go@3` and `learner-let-go-misses@3` fail. The default stays `learner-decay-timing@1`, and Train keeps its rule for "fixed".**

### Validation (seeds 9001 and 9002, run after this rule was committed and before any test seed)

`bun run evaluate:learner -- --rule 0029 --validation-only`. Each season row below counts the targets the shipped default queued before their drill, drilled for the kind it queued them for.

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

Two rules gave "none eligible": q0 (every value above the 1% ceiling) and S (no value under 1% for both kinds). Each fell to the rule's stated default, the smallest value, and the constants were fixed as the rule says: **R = 3, q0 = 0.75, H = ln 10³, S = 0.5**. Validation was not repeated with any other choice.

### The season, test seeds 501 to 530

14,996 drilled targets across the four worlds (3,749 per world: 1,485 for misses, 2,264 for pace) were queued before their drill and counted in each arm; 10,924 across the four worlds (2,731 per world) were not queued and are left out, most at 10 words a run. Shares carry their 95% Wilson interval.

| slice | arm | kind | targets | median runs to read fixed | p90 | ≤10 | false let-go | false return | named again | halved read fixed | tries a run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all | normal | misses | 1,485 | 39.0 | 141.0 | 12.7% | **2.4% [1.8, 3.3]** (36/1,485) | 3.1% [2.3, 4.2] (38/1,230) | 17.0 | 32.7% | – |
| all | normal | pace | 2,264 | 31.0 | 141.0 | 13.0% | **2.3% [1.8, 3.0]** (52/2,264) | 0.4% [0.2, 0.7] (7/1,984) | 29.0 | 24.2% | – |
| all | adaptive | misses | 1,485 | 9.0 | 62.0 | 55.4% | **3.6% [2.7, 4.6]** (53/1,485) | 1.3% [0.9, 2.1] (19/1,427) | 81.0 | 46.7% | 13.0 |
| all | adaptive | pace | 2,264 | 18.0 | 141.0 | 32.8% | **1.5% [1.0, 2.04]** (33/2,264) | 0.0% [0.0, 0.2] (0/1,978) | 81.0 | 20.6% | 14.0 |
| all | shipped | misses | 1,485 | 107.0 | 141.0 | 0.5% | 0.7% [0.4, 1.2] (10/1,485) | 54.2% [50.8, 57.5] (467/862) | – | – | – |
| all | shipped | pace | 2,264 | 73.0 | 141.0 | 2.2% | 1.1% [0.7, 1.6] (24/2,264) | 30.5% [28.5, 32.5] (603/1,980) | – | – | – |
| 25 words | normal | misses | 493 | **69.0** | 141.0 | 0.4% | 1.6% [0.8, 3.2] (8/493) | 1.4% [0.6, 3.3] (5/352) | 24.0 | 22.1% | – |
| 25 words | normal | pace | 844 | **40.0** | 141.0 | 1.5% | 3.7% [2.6, 5.2] (31/844) | 0.1% [0.0, 0.8] (1/721) | 38.0 | 24.4% | – |
| 25 words | adaptive | misses | 493 | **18.0** | 71.0 | 28.6% | 3.0% [1.9, 5.0] (15/493) | 0.2% [0.0, 1.2] (1/477) | 81.0 | 38.7% | 6.0 |
| 25 words | adaptive | pace | 844 | **22.0** | 141.0 | 19.7% | 2.4% [1.5, 3.6] (20/844) | 0.0% [0.0, 0.5] (0/742) | 81.0 | 21.9% | 7.0 |
| 25 words | shipped | misses | 493 | 133.0 | 141.0 | 0.0% | 0.4% [0.1, 1.5] (2/493) | 58.7% [52.6, 64.6] (148/252) | – | – | – |
| 25 words | shipped | pace | 844 | 73.0 | 141.0 | 0.5% | 1.7% [1.0, 2.8] (14/844) | 36.4% [33.0, 40.0] (260/714) | – | – | – |
| 100 words | normal | misses | 869 | 24.0 | 108.0 | 21.5% | 2.9% [2.0, 4.2] (25/869) | 4.1% [2.9, 5.7] (33/805) | 13.0 | 40.4% | – |
| 100 words | normal | pace | 1,222 | 19.0 | 141.0 | 23.0% | 1.1% [0.6, 1.8] (13/1,222) | 0.6% [0.3, 1.2] (6/1,090) | 23.0 | 23.8% | – |
| 100 words | adaptive | misses | 869 | 6.0 | 16.0 | 78.1% | 4.1% [3.0, 5.7] (36/869) | 2.1% [1.3, 3.3] (18/862) | 81.0 | 54.4% | 17.0 |
| 100 words | adaptive | pace | 1,222 | 12.0 | 141.0 | 47.2% | 0.8% [0.4, 1.5] (10/1,222) | 0.0% [0.0, 0.4] (0/1,079) | 81.0 | 21.8% | 25.0 |
| 10 words | normal | misses | 123 | 106.0 | 141.0 | 0.0% | 2.4% [0.8, 6.9] (3/123) | 0.0% [0.0, 5.0] (0/73) | 41.0 | 21.1% | – |
| 10 words | normal | pace | 198 | 51.0 | 141.0 | 0.0% | 4.0% [2.1, 7.8] (8/198) | 0.0% [0.0, 2.2] (0/173) | 48.0 | 25.3% | – |
| 10 words | adaptive | misses | 123 | 78.0 | 141.0 | 2.4% | 1.6% [0.4, 5.7] (2/123) | 0.0% [0.0, 4.2] (0/88) | 81.0 | 24.4% | 0.0 |
| 10 words | adaptive | pace | 198 | 58.0 | 141.0 | 0.0% | 1.5% [0.5, 4.4] (3/198) | 0.0% [0.0, 2.4] (0/157) | 81.0 | 7.6% | 0.0 |

Note on `all / adaptive / pace` false let-go: the exact Wilson upper bound is `2.04%` (`0.0204`), which rounds to `2.0%` at one decimal place and exceeds the `2.0%` (`0.02`) ceiling. By skill, misses false let-go is worst for `learning` typists (`3.9%` normal, `5.2%` adaptive) and lowest for `careful` (`1.1%` normal, `1.4%` adaptive); pace false let-go is worst on short runs (`4.0%` at 10 words, `3.7%` at 25 words, vs `1.1%` at 100 words in the normal arm). Bad days shift misses false let-go from `2.1%` to `2.7%` (normal) and `2.8%` to `4.3%` (adaptive).

### The guard world, test seeds 501 to 530

Mean paired differences, candidate − shipped, with 95% t intervals. Log loss, calibration, captured gain at 10 and planted error pairs at 10 are exactly zero in both variants for both candidates.

| variant | candidate | captured@40 (points) | pick-up (runs) | let-go (runs) | slow pick-up (runs) | slow let-go (runs) |
| --- | --- | --- | --- | --- | --- | --- |
| slow | `learner-let-go@3` | **+0.33 [+0.19, +0.48]** better | −0.05 [−0.15, +0.05] tie | **−0.50 [−0.85, −0.15]** better | −0.07 [−0.16, +0.03] tie | −0.30 [−0.65, +0.05] tie |
| slow | `learner-let-go-misses@3` | +0.03 [−0.01, +0.06] tie | 0.00 tie | **−0.33 [−0.64, −0.03]** better | 0.00 tie | 0.00 tie |
| at pace | `learner-let-go@3` | **+0.27 [+0.15, +0.39]** better | 0.00 tie | −0.13 [−0.41, +0.14] tie | −0.03 [−0.10, +0.03] tie | **−0.48 [−0.92, −0.05]** better |
| at pace | `learner-let-go-misses@3` | +0.04 [0.00, +0.09] tie | 0.00 tie | −0.13 [−0.41, +0.14] tie | 0.00 tie | 0.00 tie |

### The decision

- **(a) No harm:** **PASS** for both `learner-let-go@3` and `learner-let-go-misses@3` (really worse on none of ADR 0015's guards in either variant).
- **(b) Runs to read fixed (25 words):**
  - normal misses: **FAIL** — median `69.0` (target ≤ 60)
  - normal pace: **PASS** — median `40.0` (target ≤ 45)
  - adaptive misses: **PASS** — median `18.0` (target ≤ 20)
  - adaptive pace: **PASS** — median `22.0` (target ≤ 40)
- **(c) False let-go ≤ 2% Wilson upper:** **FAIL** in all four cells:
  - normal misses: `3.34%` (36/1,485)
  - normal pace: `3.00%` (52/2,264)
  - adaptive misses: `4.64%` (53/1,485)
  - adaptive pace: `2.04%` (33/2,264)
- **(d) Same-kind false return ≤ 5% Wilson upper:** **PASS** in all four cells:
  - normal misses: `4.21%` (38/1,230)
  - normal pace: `0.73%` (7/1,984)
  - adaptive misses: `2.07%` (19/1,427)
  - adaptive pace: `0.19%` (0/1,978)

Because (c) fails for both misses and pace (and (b) fails for normal misses), neither `learner-let-go@3` nor `learner-let-go-misses@3` passes.

### Why it failed, and what worked

1. **Same-kind returns, fixed typical rate and post-drill retention solved false returns.** False return fell from 26.2% / 30.6% in ADR 0019 (and 54.2% / 30.5% shipped) to 3.1% / 0.4% in the normal arm and 1.3% / 0.0% in the adaptive arm — passing (d) comfortably even at `H = ln 10³`.
2. **Adaptive leaning delivered the speed gain.** At 25 words, adaptive misses reached a median of 18 runs (55.4% within 10 runs across all lengths) and adaptive pace 22 runs, both passing (b). Normal 25-word misses improved from 100 runs (ADR 0019) to 69 runs, still above 60 because 25-word ordinary passages hold too few tries of a single pair.
3. **False let-go for misses failed because `R × p` overshoots some unchanged weak pairs.** A planted error pair adds +1.6 to +2.4 in log-odds above the typist's base rate, while `p` is the raw pooled rate over the 40 runs before the drill (raised by mechanics and other weak pairs, and noisier over 20 pre-drill runs than over 160). For `learning` typists (7% base rate, pooled rate ~9–11%), `3 × p` (~27–33%) can exceed the unchanged pair's true rate, violating Wald's 1% bound (`3.9%` normal, `5.2%` adaptive). Extra tries per run in the adaptive arm let those below-`3p` pairs cross `ln 100` sooner (`3.6%` vs `2.4%`). A null hypothesis anchored to the target's *own* pre-drill rate (or a smaller `R` / log-odds shift rather than a raw multiplier `3 × p`) would avoid putting the "still weak" threshold above the target's actual pre-drill rate.
4. **False let-go for pace failed on short runs because a 1–2 interval run median is noisy.** At 100 words, normal pace false let-go is `1.1% [0.6, 1.8]` (well under 2%); at 25 words it is `3.7%` and at 10 words `4.0%`. When a pair appears only once or twice in a short run, single-interval timing noise (~30% log-SD) frequently puts its run median below the run's overall median even for an unchanged slow pair, so its true `P(slower)` sits below `q0 = 0.75`. Weighting pace steps by interval count (or reading per-interval ratios rather than one unweighted sign per run) is the natural next fix.
5. **Pure-adaptive regression blind spot (`named again = 81.0`).** Once the adaptive arm lets a target go, `adaptiveLean` stops leaning on it. When that target regresses at run 80 in a pure-adaptive season (no normal runs after the retest), the pair rarely reaches `ADAPTIVE_MIN_TRIES = 5` in an adaptive passage, so `adaptivePatterns` drops it and the return walk sees zero post-regression observations. In real usage mixed with normal tests, normal runs provide return evidence, or `adaptivePatterns` could also record any pair that has an active let-go loop regardless of the 5-try threshold.

## Consequences

- `DEFAULT_POLICY` stays `learner-decay-timing@1`, provisional, with no claim about learning (`PRODUCT.md` principle 4).
- `src/train-path.ts` (`isFixed`) is unchanged.
- `learner-let-go@3` and `learner-let-go-misses@3` remain as named, non-default variants in `src/learner.ts`, alongside `letGoV3`, `letGoIndexV3`, `typicalAt`, `queuedFor`, `adaptiveEvidence`, and `adaptiveLean`.
- Every earlier variant (`learner@1`, `learner-decay@1`, `learner-timing@1`, `learner-decay-timing@1`, `learner-own-cost@2`, `learner-let-go@2`, `learner-let-go-misses@2`) reads the newest 120 pattern-carrying runs and computes byte for byte what it did before.
- `retainRuns` keeps the bounded post-drill pattern window (up to 240 runs anchored `TYPICAL_RUNS = 40` runs before the 8th newest retest), `runRecord` records bounded `adaptivePatterns` on completed adaptive runs (never entering normal evidence, bests, trends, or baselines), and profile merges keep the fuller copy deterministically (ADRs 0005 and 0006).
- `bun run evaluate:learner -- --rule 0029` runs the ADR 0029 evaluation (`--rule 0027` is kept as an alias).
