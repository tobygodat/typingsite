# 0015. learner@2: what a miss costs, and how fast the learner forgets

Status: Proposed, 2026-11-11. TOB-419.

## Context

[ADR 0013](0013-learning-core.md) made `learner-decay-timing@1` the default. It ranks each letter pair and key by English frequency times time lost: first-try misses priced at an assumed two clean intervals each, plus slowness against the person's pace. Its evaluation left two questions open.

- **What a miss costs.** Whether a slow pair or a missed pair costs a typist more depends on what a correction costs, and the simulator assumed it. With missed pairs at the typist's pace, timing pushed missed pairs out of the top four. At a miss cost of eight intervals, rule v2 would have picked another policy. Timing is in by product call, not by evidence.
- **How fast it forgets.** The 60-run half-life was chosen by prediction log loss, at the edge of its grid, which favours remembering. A common pair missed for 25 runs and then clean for 38 still leads a rarer pair missed every time for 30.

This ADR writes the rule that settles both, before any test seed runs. It is not changed after its results are seen.

## Decision rule

Rule v2's protocol is used unchanged where it can be: the same three typist groups of 24 (8 per skill level), 40 runs of 25 words each, the same measures, validation seeds 9001 and 9002 only for constants, and per-seed paired differences with 95% t intervals over thirty test seeds. "Really" better or worse means the interval excludes zero on that side.

### Seeds

Test seeds 201 to 230, thirty never used before. Every constant below is chosen on validation seeds 9001 and 9002 only.

### The simulator: each typist's own correction cost

Each typist gets a hidden true miss cost, m clean intervals, drawn log-uniformly from 1 to 8 (m = 8^u, u even on [0, 1)). It is drawn from a stream of its own, seeded by the seed and the typist's place in the population, so every other random draw is the same as in the shipped simulator. A typist's correction keys are 1 + m: after a wrong first try, the right letter follows m × the typist's median interval later (times the shipped simulator's noise), so the traces' corrections take that long. True time lost uses each typist's own m: a unit's missed time is its first-try error rate above the typical rate × m × the typist's median interval. Everything else in rule v2's true time lost is unchanged.

The simulator runs in two variants, on the same seeds:

- **slow**: planted missed pairs are also typed slowly, as in the shipped simulator.
- **at pace**: planted missed pairs are typed at the typist's pace, as in ADR 0013's sensitivity run.

The shipped default, `learner-decay-timing@1`, is rerun on both.

### Question A: should a miss cost what it costs this person?

**The measurement.** Each counted run's summary records its timed corrections, `[count, median ms]`, as the first learner prototype did. A correction runs from the kept keystroke before a wrong first try to the right letter kept at its position. One longer than 5 s is a pause and is left out, and an error never put right is not timed. Old summaries without the field stay valid and add no corrections.

**The candidate.** `learner-decay-timing@1` with one change: the cost of a miss, in clean intervals, is the person's own. A run's correction ratio is its median correction over its median interval (the run's pace, from its pattern rows). The pooled ratio is the geometric mean over runs, weighted by the run's decay weight × its timed corrections. The cost is the pooled ratio − 1 (the right letter's own interval is not lost), floored at 1. Until the person has at least C timed corrections (raw, undecayed) on the keyboard, the cost is 2, as now. A run typed faster than 30 ms a key is untimed, as for timing, and adds no corrections.

**Its constant.** C comes from {1, 5, 10, 20, 40, 80}, by cost error on the validation seeds: the mean over typists of |ln(the cost the candidate uses after t runs / the typist's true m)|, averaged over t = 10 and t = 40, then over both seeds and both variants. A tie goes to the smaller C.

**The decision.** The candidate replaces the default if, against the shipped default on the same new simulator:

- it is really better on captured gain at 10 or at 40 runs in at least one variant, and
- it is really worse on none of these, in either variant: log loss, calibration, captured gain at 10, captured gain at 40, planted error pairs at 10, pick-up, let-go.

Pick-up and let-go are rule v2's, for error pairs. The slow pick-up and let-go columns are reported and decide nothing. Otherwise the candidate stays out. It is deleted, unless keeping it as a named variant costs a few lines.

### Question B: should the half-life be chosen for forgetting?

Decided after A, at whatever A chose (the candidate with its C, or the shipped default).

**The constant.** On the validation seeds, both variants, each half-life h in {10, 20, 30, 60} runs is scored at A's choice. Its measures are means over both seeds and both variants. A half-life is eligible when its captured gain at 10 and its captured gain at 40 are each within one percentage point of the best half-life's on that measure. Among the eligible, the one with the lowest let-go + pick-up (error pairs, in runs) is chosen. A tie goes to the longer half-life. The 60 days stay untested.

**The decision.** If validation chooses 60, nothing changes. Otherwise, on the test seeds, the chosen half-life replaces 60 if it is really better on let-go or on pick-up in at least one variant, and really worse on none of the same guards as A in either variant: log loss, calibration, captured gain at 10, captured gain at 40, planted error pairs at 10, pick-up, let-go.

### Names

Whatever wins becomes the default as a version-2 policy whose name says what it is:

- A wins, B does not: `learner-own-cost@2`.
- B wins at h runs, A does not: `learner-forget-h@2` (for example `learner-forget-20@2`).
- Both win: `learner-own-cost-forget-h@2`.
- Neither wins: the default stays `learner-decay-timing@1`, and this ADR says so.

`learner-decay-timing@1` stays in the code as a named variant either way, so the comparison can be rerun. The deciding run's JSON is committed beside ADR 0013's records.

### Reported, deciding nothing

- **Focus.** The training focus (balanced, accuracy, speed) is the person's choice, not a policy rule. For the default after A and B, the run reports captured gain at 10 and 40 and planted pairs by stratum for the accuracy and speed focuses, in both variants, so this ADR can say what each focus trades.
- **No learning-speed result.** A simulated typist improves after a drill only as the simulator says it does. The run reports none.

### Still provisional

`PRODUCT.md` principle 4 holds. Until the learning study in `docs/ml-data-evaluation.md` can run, a promotion by this rule is provisional and makes no claim that anyone learns faster.
