# 0015. learner@2: what a miss costs, and how fast the learner forgets

Status: Accepted, 2026-11-11. TOB-419.

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

## Results

The rule was committed before any code or run (commit "Write learner@2's decision rule before any code or run"), the code before any test seed ran, and the test seeds ran once. The run is `npm run evaluate:learner -- --rule 0015`, deterministic from its seeds, and is recorded in [`0015-evaluation.json`](0015-evaluation.json) with every seed's scores. Rule v2's record, [`0013-evaluation-v2.json`](0013-evaluation-v2.json), still reproduces byte for byte.

**Neither question passed. The default stays `learner-decay-timing@1`, unchanged.**

### Validation

- **C.** Cost error was 0.108 at C = 1, 5 and 10 (a tie), 0.137 at 20, 0.198 at 40 and 0.283 at 80, so C = 1.
- **Half-life**, at A's choice (the shipped default). Means over both seeds and both variants:

| half-life | captured@10 | captured@40 | let-go | pick-up | eligible |
| --- | --- | --- | --- | --- | --- |
| 10 runs | 61.4% | 67.2% | 4.25 | 18.63 | no (captured@40) |
| 20 runs | 61.3% | 68.8% | 5.75 | 19.25 | yes, chosen |
| 30 runs | 61.1% | 68.2% | 6.75 | 19.88 | yes |
| 60 runs (shipped) | 61.5% | 67.5% | 7.75 | 20.13 | no (captured@40) |

### Question A: own cost, against the shipped default

Means over test seeds 201 to 230. Cost error is how far the miss cost the policy uses is from the typist's own (mean |ln| ratio).

| variant | policy | log loss | captured@10 | captured@40 | planted error@10 | pick-up | let-go | slow pick-up | slow let-go | cost error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| slow | shipped | 0.2059 | 67.9% | 76.2% | 27.6% | 16.9 | 14.6 | 20.6 | 8.0 | 0.587 |
| slow | own cost | 0.2059 | 67.5% | 76.9% | 27.7% | 16.3 | 15.4 | 20.8 | 7.5 | 0.107 |
| at pace | shipped | 0.2059 | 58.0% | 69.3% | 7.2% | 21.0 | 0.1 | 19.9 | 9.1 | 0.587 |
| at pace | own cost | 0.2059 | 59.2% | 72.4% | 8.7% | 21.0 | 1.5 | 20.5 | 8.7 | 0.109 |

Mean paired differences, own cost − shipped, with 95% t intervals. Bold marks a real difference. Captured and planted are in points, the rest in runs.

| variant | log loss, calibration | captured@10 | captured@40 | planted error@10 | pick-up | let-go | slow pick-up | slow let-go |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| slow | 0 (no prediction changes) | **−0.41 [−0.77, −0.04]** worse | **+0.67 [+0.33, +1.02]** better | +0.12 [−0.30, +0.53] tie | −0.63 [−1.35, +0.08] tie | +0.83 [−0.30, +1.97] tie | +0.18 [−0.08, +0.45] tie | **−0.55 [−0.92, −0.18]** better |
| at pace | 0 (no prediction changes) | **+1.18 [+0.75, +1.61]** better | **+3.08 [+2.47, +3.70]** better | **+1.53 [+1.12, +1.94]** better | −0.03 [−0.10, +0.04] tie | **+1.40 [+0.29, +2.51]** worse | **+0.58 [+0.10, +1.07]** worse | **−0.43 [−0.80, −0.06]** better |

**A: stays out.** On the simulator the candidate's miss cost is within about 11% of each typist's own (cost error 0.107 against 0.587 for a fixed two intervals). The simulator makes each correction from the same cost the measurement reads, so recovering it is close to automatic. That proves the code path, and says nothing about real typing. It is really better on captured gain at 40 runs in both variants and at 10 runs at pace. But it is really worse on captured gain at 10 runs in the slow variant, by 0.4 points, and on let-go at pace, by 1.4 runs, so by the rule it does not replace the default. It stays in the code as the named variant `learner-own-cost@2` (`OWN_COST_POLICY`, about ten lines), with the run summaries' correction field, so this run can be repeated and real typists' corrections are on hand for the study.

### Question B: a 20-run half-life, against 60

| variant | log loss, ×10⁻⁴ | calibration, ×10⁻⁴ | captured@10 | captured@40 | planted error@10 | pick-up | let-go | slow pick-up | slow let-go |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| slow | **+1.01 [+0.93, +1.10]** worse | −0.17 [−0.89, +0.55] tie | −0.17 [−0.44, +0.09] tie | **+0.85 [+0.48, +1.22]** better | −0.30 [−0.70, +0.09] tie | **−2.72 [−3.34, −2.10]** better | **−3.75 [−4.50, −3.00]** better | **−1.90 [−2.66, −1.14]** better | **−1.78 [−2.23, −1.33]** better |
| at pace | **+1.01 [+0.93, +1.10]** worse | −0.17 [−0.89, +0.55] tie | −0.04 [−0.29, +0.20] tie | **+0.65 [+0.25, +1.06]** better | −0.19 [−0.41, +0.04] tie | 0.00 [0.00, 0.00] tie | −0.12 [−0.30, +0.07] tie | **−2.70 [−3.38, −2.02]** better | **−1.95 [−2.49, −1.41]** better |

**B: stays out.** A 20-run half-life lets go of a fixed error pair 3.8 runs sooner and picks up a slipping one 2.7 runs sooner in the slow variant, lets go of and picks up slow pairs about 2 runs sooner in both, and captures more at 40 runs. It is really worse on log loss in both variants, by 0.0001 (0.2059 to 0.2060), so by the rule the half-life stays 60 runs.

### What each focus trades

Described, deciding nothing: the default, ranked for each focus, on the same test seeds.

| variant | focus | captured@10 | captured@40 | planted error@10 | planted error@40 | middle@40 | slow-only@10 | slow-only@40 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| slow | balanced | 67.9% | 76.2% | 27.6% | 38.4% | 29.9% | 40.7% | 50.0% |
| slow | accuracy | 37.5% | 55.9% | 23.4% | 43.4% | 42.4% | 2.1% | 1.3% |
| slow | speed | 68.0% | 72.3% | 26.2% | 33.3% | 24.1% | 43.5% | 52.2% |
| at pace | balanced | 58.0% | 69.3% | 7.2% | 13.4% | 2.4% | 43.5% | 53.9% |
| at pace | accuracy | 32.9% | 48.8% | 23.4% | 43.3% | 42.3% | 2.1% | 1.3% |
| at pace | speed | 56.3% | 61.8% | 3.2% | 2.9% | 0.6% | 46.7% | 57.2% |

- **Accuracy** holds the most missed pairs: 43% of planted error pairs in its top four at 40 runs, against 38% balanced (13% when missed pairs are at pace), and 42% of the middle-frequency ones against 30%. It gives up about 20 to 30 points of the time lost the simulator counts, because it ignores slowness, and it finds almost no slow-only pair.
- **Speed** holds slightly more slow-only pairs than balanced and about as much time lost at 10 runs, less at 40. When missed pairs are at pace it holds almost none of them (3%).
- **Balanced** holds the most time lost overall. When missed pairs are at the typist's pace, it holds few of them (7% at 10 runs), as ADR 0013's sensitivity run found.

### Two faults in the rule

The rule was applied as written. Two faults showed in its results:

1. **B could not pass on prediction.** ADR 0013 chose the 60-run half-life as the one with the lowest log loss on validation typists. Any other half-life predicts slightly worse almost by construction, and thirty paired seeds call a 0.0001 change in log loss real. So the log-loss guard decided B before the run. A guard with a margin of practical equivalence (for example, no worse than 0.001) would have let the forgetting measures decide.
2. **No guard has a margin.** "Really worse on none" with tight paired intervals lets small losses outweigh larger gains. A had two losses: 0.4 points of captured gain at 10 runs with missed pairs slow, and 1.40 runs later to let go of a fixed pair with missed pairs at pace. Against them it gained 3.1 points of captured gain at 40 runs at pace. That is the rule's intent (do no harm), but it means small, real costs block changes whose gains are larger. A margin on captured gain alone would excuse only the first loss, and the let-go loss would still keep A out.

Neither changes the result recorded here. A later rule that adds margins would be judged on fresh seeds.

## Consequences

- The default is unchanged: `learner-decay-timing@1`, a miss priced at two intervals, half weight 60 runs back. It is still provisional, and makes no claim that anyone learns faster.
- The timing term is still in by product call. ADR 0015's simulator, with each typist's own miss cost from 1 to 8 intervals, did not change that: the default captured 67.9% of the time lost at 10 runs with missed pairs slow and 58.0% at pace.
- People choose the trade themselves with the training focus. Balanced is the evaluated policy; accuracy and speed rank by one part of it. Each names a unit only on its own evidence of the kind it ranks on.
- Run summaries record their timed corrections (`[count, median ms]`). Older summaries stay valid and add none.
- A fit on a 120-run history takes a median of 1.9 ms in Node on tobygdesktop (slowest of 30, 3.0 ms), so it still never runs on a keystroke.
- Patterns across runs on Progress reads the learner's queue, as Train does, and no longer shows the counting rule's list.
