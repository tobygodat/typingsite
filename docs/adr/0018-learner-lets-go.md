# 0018. learner-let-go@2: a drilled target is let go on the evidence since its drill

Status: Accepted, 2026-11-11. TOB-419. The candidate failed the rule below; the default is unchanged.

Written and committed as ADR 0017; renumbered 0018 when [ADR 0017](0017-design-note-keeps-floors-only.md) landed on master first. Nothing else in the rule changed.

## Context

Train draws a path: the targets you have drilled behind you, one open step, the next few ahead (`src/train-path.js`). A step moves behind you and reads "fixed" only once the learner stops naming it. Under the default, `learner-decay-timing@1` ([ADR 0013](0013-learning-core.md), kept by [ADR 0015](0015-learner-2.md)), that takes far too long, because every older run still counts at its decayed weight. Measured on TOB-419, with each missed run holding 9 tries and 2 misses and each clean run 9 clean tries:

| Missed in | One run a day | Five runs a day |
| --- | --- | --- |
| 4 runs | 34 clean runs until it is no longer named | 40 |
| 20 runs | 80 clean runs | 111 |

An independent check drilled "th", typed twelve clean 100-word runs, and "th" was still the open step.

Letting go is a claim. Last week a status word on Progress failed four independent checks because it fired on thin evidence, then on evidence that looked fine per pair but was noise across many pairs. Many drilled targets are judged over many weeks, so a small chance per look adds up. This ADR writes the mechanism and the rule that judges it before any judging seed runs. It is not changed after its results are seen.

## The candidate: `learner-let-go@2`

`learner-decay-timing@1`, unchanged in every constant (K = 40, half weight 60 runs and 60 days back, timing shrinkage 5, a miss at two intervals), with one addition: a drilled target is let go when the evidence since its drill passes a sequential test. Units never drilled are ranked exactly as before.

### What it reads

- **Evidence**: the same records as now (`learnerEvidence`, one per measured run on the keyboard).
- **Drills**: the saved loops on the keyboard (`keyboardOf(loop.conditions)`). Fields read: `id`, `at`, `target`, `afterAttemptId`, `targetBasis`, `targetPace` and `conditions`. A loop without a target is ignored. Each target keeps its newest loop, by date and then id, so duplicates and arrival order change nothing. The loop's kind is `targetBasis`; a loop saved before that field reads a saved pace as slowness, else misses (`basisOf`, as Train reads it today).
- **The split**: the date of the evidence record whose id is the loop's `afterAttemptId` (its retest). If that record is gone, the loop's own `at`. A loop with neither date splits nothing and lets nothing go. Evidence from the split on is "since the drill", the retest included, as Train counts it today.

It stays a pure fold over records, drills and `now`. Nothing in the test reads `now`.

### The test, for a target drilled for its misses

The person's typical rate p is their raw pooled first-try miss rate over every pair in the evidence, floored at 1%. "Fixed" is a miss rate of p; "still weak" is R × p, capped at 0.5. Each record since the drill adds its log likelihood ratio to a walk Λ: `misses × ln(p / Rp) + clean tries × ln((1 − p) / (1 − Rp))`. Λ starts at 0 and is held between −A and A.

### The test, for a pair drilled for its pace

No spread is recorded for pace, only each run's median for the pair against the run's median. So the test reads one fact per run, whether the pair was slower than the person's pace in that run (`slow`), and assumes nothing about spread. "Fixed" is slower in half the runs (a pair at the person's pace is as likely slower as not); "still slow" is slower in q0 of them. Each run since the drill that timed the pair adds `ln(0.5 / q0)` if it was slower, else `ln(0.5 / (1 − q0))`. The claim is about which side of the person's median the pair falls, not about how many ms it loses.

### Let go, and coming back

- **Let go** at the first record where Λ ≥ A and the evidence since the drill holds at least 2 runs and 20 observations of the kind drilled (Train's floors today, `FIXED_RUNS` and `FIXED_OBSERVATIONS`). A = ln 100. By Wald's bound, a target whose true rate is R × p or worse is let go by luck with a chance of about 1 in 100 over its whole future, however many runs are read.
- **Coming back.** Once let go, a second statistic S starts at 0 and adds the opposite ratio, held at no less than 0 (a CUSUM). The target comes back when S ≥ H. Then Λ starts again at 0 from the next record. A drilled-for-misses target never comes back on fewer than ⌈H / ln R⌉ misses net of clean tries, so never on one typo.
- **What letting go does.** The learner sets that part of the target's gain to zero: its misses part for a target drilled for its misses, its slowness part for one drilled for its pace. The rest of its gain, and every other unit, is ranked as before. So a let-go target leaves the queue and the drill's lean, unless its other kind of evidence still names it.

### One rule, three readers

`letGo` in `src/learner.js` is the only definition. The learner calls it in its fold. Train's "fixed" is `letGo` and not queued, for the target's newest loop. Progress's "fixed" rows, when they land, read the same function. A property test over random histories, in every focus, checks that no unit is ever fixed on Train and queued by the learner, or let go by the learner and shown drilled on Train while it is out of the queue.

## Decision rule

### Seeds

Validation seeds 9001 and 9002 choose every constant. Test seeds 301 to 330, thirty never used before, run once, after the constants are fixed and this rule is committed.

### Constants, chosen on validation seeds only

A = ln 100 is fixed by the ceiling below, not tuned.

1. **R** from {3, 4, 6, 8}. Eligible when the false let-go of targets drilled for misses (season, unchanged world, pooled) is at most 1%, half the ceiling. Among the eligible, the fewest median runs to read fixed (season, fixed world, 25-word runs). A tie goes to the smaller R.
2. **q0** from {0.75, 0.85, 0.95}, by the same two measures for pairs drilled for pace. A tie goes to the smaller q0.
3. **H** from {ln 10³, ln 10⁴, ln 10⁵}, at the chosen R and q0. Eligible when the false return of each kind (season, fixed world) is at most 2.5%, half its ceiling. Among the eligible, the fewest median runs until a target that slipped again is named again (season, regress world, both kinds pooled). A tie goes to the larger H. If none is eligible, the largest.

R and q0 do not depend on H, because a target is first read fixed before any return can happen.

### Simulator 1: the guard world

ADR 0015's simulator, unchanged: three groups of 24 typists (8 per skill), 40 runs of 25 words, each typist's own miss cost drawn from 1 to 8 intervals, in its two variants (missed pairs slow, missed pairs at pace). Added: loops, saved as the app saves them after a retest at run 20.

- Each mechanics and unrelated typist drills its common planted error pair at run 20. The drill does nothing: the pair stays as weak as before.
- Each drifting typist drills its fixed error pair and its fixed slow pair at run 20, the run they are fixed from.

A loop's kind is what the shipped default named the target for, fitted on the runs before the drill, or the planted kind when it was not named.

### Simulator 2: the season

Practice for months, light and heavy. One cell for each of: words a run {10, 25, 100}; runs a day {1, 5, 15}; skill {careful, average, learning}, where learning is the careless typist (7% base miss rate); bad days {no, yes}. 54 cells, two typists per cell per world per seed, mechanics and unrelated by turn.

- **Each typist** has one planted error pair (common or middle frequency, at even odds, missed as ADR 0013's planted pairs and typed at pace) and one planted slow-only pair (common or middle, ADR 0013's). It types 20 runs, drills both at the end of run 19 and retests on run 20, then types 140 more: 160 in all. The profile keeps pattern evidence on its newest 120 runs, as the app does, so the fit reads only those.
- **Bad days.** Each day is bad with a chance of 1 in 5, from a stream of its own. On a bad day every first-try miss has 0.7 more log odds (about twice the odds), for every pair and key.
- **Worlds.** *Fixed*: from run 20 the planted weakness is gone. *Unchanged*: the drill did nothing. *Halved*: from run 20 the weakness is half its planted size, in log odds or log slowness. *Regress*: fixed from run 20 to run 79, weak again from run 80.
- **Which targets count.** A drilled target counts only when the shipped default queued it on the 20 runs before the drill. Its kind is what it was queued for. The others are reported as a count.

### Measures

Over counted targets, per kind (misses, pace):

- **Runs to read fixed** (fixed world): runs from the retest on until Train reads it fixed (`letGo` and not queued). 141 means not in the season. Reported as median, 90th percentile, and the share within 10 and within 20 runs.
- **False let-go** (unchanged world): the share read fixed at any run of the season.
- **False return** (fixed world): the share read fixed and later not fixed in the season.
- **Named again** (regress world): runs after run 80 until it is queued again, for targets read fixed at run 79.
- **Reported, deciding nothing**: the halved world's share read fixed; runs until out of the queue under both policies (Toby's measure); the same under `learner-decay-timing@1`; every measure by cell.

Shares get a 95% Wilson interval.

### Decision

`learner-let-go@2` becomes the default when all of these hold:

- **(a) No harm on the existing measures.** Against `learner-decay-timing@1` on the guard world, test seeds, it is really worse on none of ADR 0015's guards in either variant: log loss, calibration, captured gain at 10 and at 40, planted error pairs at 10, pick-up, let-go. "Really worse" is ADR 0013's: a 95% paired t interval over the thirty seeds that excludes zero on the worse side. No margin, as ADR 0013 and 0015 used. Letting go changes no prediction, so the log-loss guard cannot decide this before it runs (ADR 0015's fault 1).
- **(b) Let go in a fair number of runs.** At 25 words a run, pooled over runs a day, skills and bad days, the median runs to read fixed is at most 10 for targets drilled for misses and at most 15 for pairs drilled for pace. Ten 25-word runs is about five minutes of typing, one sitting; a person who drilled a pair and typed it cleanly for a sitting would call that fair, against the 34 to 111 runs measured above. Pace gets more because its test reads one fact a run, and its floor of 20 clean intervals takes several runs for a pair that turns up once or twice in 25 words.
- **(c) False let-go at most 2%**, for each kind: the upper end of the 95% Wilson interval of the unchanged world's share, pooled over all 54 cells. A person drills a few targets a week. At 2% each, someone who drills 50 targets over a season sees one or none read fixed while unchanged, and that one comes back on evidence.
- **(d) False return at most 5%**, for each kind: the upper end of the Wilson interval, fixed world, pooled. A false return names a fixed target again, a nudge to drill it once more rather than a false claim, so its ceiling is looser than (c)'s.

**Ties and mixed results.** A tie on a guard passes (a). If (a) and every clause for misses pass and a clause for pace fails, `learner-let-go-misses@2`, the same policy with pace targets never let go, is judged in the same run by (a) and the clauses for misses, and becomes the default if it passes. Otherwise the default stays `learner-decay-timing@1`, each candidate stays as a named, non-default version if it costs a few lines, no threshold moves, and this ADR says what failed.

**Train's "fixed".** Train's fixed reads the same `letGo` whichever policy is the default. Under `learner-decay-timing@1` the target stays queued, so it reads fixed only once that learner lets it go.

### Still provisional

`PRODUCT.md` principle 4 holds. Until the learning study in `docs/ml-data-evaluation.md` can run, a promotion by this rule is provisional, on simulated typists, and claims nothing about learning. A simulated typist gets better after a drill only because the season world says so.

## Results

The rule was committed (commit "Write learner-let-go@2's decision rule before any code or run") before any code and before any run. Validation chose the constants, the test seeds ran once, and the run is recorded in [`0018-evaluation.json`](0018-evaluation.json). `npm run evaluate:learner -- --rule 0018` reproduces it byte for byte, and ADR 0013's and 0015's records still reproduce byte for byte.

**Disclosure.** Before the judging run, a unit test I wrote ran four season cells of test seed 301 (25 words, five a day, average and careless typists) under placeholder constants (R = 4, q0 = 0.85, H = 10⁴), and I saw its nine targets' results. No constant was chosen from them, the constants below come from validation alone, and the test now uses seed 9001.

**learner-let-go@2 fails. The default stays `learner-decay-timing@1`, and Train keeps its rule for "fixed".**

### Validation

| R | false let-go | median runs to read fixed, 25 words |
| --- | --- | --- |
| 3 (chosen) | 0.9% | 74 |
| 4 | 3.8% | 48 |
| 6 | 17.0% | 33 |
| 8 | 31.1% | 26 |

| q0 | false let-go | median runs to read fixed, 25 words |
| --- | --- | --- |
| 0.75 (chosen) | 0.6% | 40.5 |
| 0.85 | 3.9% | 29 |
| 0.95 | 8.4% | 28.5 |

Every H gave the same false return (28.4% for misses, 22.4% for pace), above the 2.5% that makes one eligible, so the rule took the largest, H = ln 10⁵. Named again took a median of 27, 34 and 39 runs for 10³, 10⁴ and 10⁵.

### The season, test seeds 301 to 330

3,725 drilled targets per world were queued before their drill and counted (1,500 for misses, 2,225 for pace); 2,755 per world were not queued and are left out, most of them at 10 words a run, where 20 runs hold too little to name anything. Shares carry their 95% Wilson interval.

| slice | policy | kind | median runs to read fixed | within 10 | runs until out of the queue | false let-go | false return | named again | halved world read fixed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all | let-go | misses | 56 | 8.4% | 29 | 2.3% [1.6, 3.2] | 26.2% [23.6, 29.0] | 24 | 31.4% |
| all | let-go | pace | 33 | 12.9% | 27 | 0.7% [0.4, 1.2] | 30.6% [28.6, 32.7] | 41 | 25.9% |
| all | shipped | misses | 97 | 0.2% | 56.5 | 0.5% [0.2, 1.0] | 54.7% [51.6, 57.8] | 7 | 16.1% |
| all | shipped | pace | 77 | 2.0% | 69 | 0.8% [0.5, 1.3] | 30.7% [28.7, 32.8] | 30 | 21.6% |
| 25 words | let-go | misses | **100** | 0.2% | 35 | 0.8% [0.3, 2.1] | 34.8% [29.4, 40.5] | 35 | 22.5% |
| 25 words | let-go | pace | **42** | 1.1% | 34 | 0.8% [0.4, 1.7] | 32.3% [29.0, 35.9] | 57 | 25.7% |
| 100 words | let-go | misses | 35 | 14.1% | 26 | 3.0% [2.1, 4.4] | 21.3% [18.4, 24.5] | 20 | 38.2% |
| 100 words | let-go | pace | 20 | 23.0% | 20 | 0.4% [0.2, 1.0] | 30.1% [27.4, 32.9] | 34 | 25.7% |
| 10 words | let-go | misses | 112 | 0.0% | 28 | 2.3% [0.8, 6.6] | 39.2% [28.9, 50.6] | 66 | 17.7% |

For the shipped policy, "read fixed" uses the same let-go test, so its columns show how long the shipped learner keeps a target queued. The record has every cell, and the slices by runs a day, skill and bad days. Runs a day and bad days barely move any figure: the false let-go for misses is 2.2% without bad days and 2.3% with them. Careless typists are let go falsely most often (3.7% [2.5, 5.6] for misses) and careful ones least (1.0%).

### The guard world, test seeds 301 to 330

Mean paired differences, let-go − shipped, with 95% t intervals. Every other guard (log loss, calibration, captured gain at 10, planted error pairs at 10, pick-up) is exactly zero in both variants.

| variant | captured@40 (points) | let-go (runs) | slow let-go (runs) |
| --- | --- | --- | --- |
| slow | **+0.17 [+0.10, +0.24]** better | −0.23 [−0.65, +0.19] tie | **−0.28 [−0.52, −0.04]** better |
| at pace | **+0.25 [+0.12, +0.37]** better | 0.00 tie | **−0.47 [−0.78, −0.15]** better |

`learner-let-go-misses@2` is likewise really worse on nothing (captured@40 at pace +0.10 [+0.02, +0.17]).

### The TOB-419 history

Clean runs until "th" is no longer named, after the measured history (each missed run 9 tries with 2 misses, each clean run 9 clean tries, beside a background missed one try in 30; that background gives the measured table within a few runs):

| missed in | a day | shipped | let-go |
| --- | --- | --- | --- |
| 4 runs | 1 | 33 | 21 |
| 4 runs | 5 | 41 | 21 |
| 20 runs | 1 | 80 | 15 |
| 20 runs | 5 | 103 | 15 |

### The decision

- (a) passes: really worse on no guard in either variant, for both candidates.
- (b) fails for both kinds: a median of 100 runs at 25 words for misses (target 10) and 42 for pace (target 15).
- (c) fails for misses (upper end 3.2%, ceiling 2%) and passes for pace (1.2%).
- (d) fails for both kinds: 26% and 31% of the targets read fixed are later not fixed, against a 5% ceiling.

The misses-only fallback needs every clause for misses, so it fails too. Both stay in the code as named, non-default versions, `learner-let-go@2` and `learner-let-go-misses@2`, so the run can be repeated.

### Why it failed

1. **The tries a run holds bound any honest claim.** At 25 words a drilled pair gets one to three first tries a run. Telling a rate of p from 3p at odds of 100 to 1 takes about 50 to 150 clean tries, so 50 to 100 runs. Only at 100 words does the median come near (35 runs). Targets stated in runs at 25 words could not be met by a test this strict. A looser R lets go sooner and falsely more often: on validation, R = 6 needed 33 runs and let 17% of unchanged targets go.
2. **False return was the other kind, not the return walk.** False return is the same at every H. The three targets inspected on validation seed 9001 that read fixed and then not were each still let go for the kind drilled, and queued again for the other kind: a pair let go for its misses and then named for its own slowness (its mechanics make it slow), or a slow pair named for its misses, going in and out of the queue at the naming floor. The rule counts that as a return, as written. The shipped learner flaps the same way (30.7% for pace).
3. **The let-go itself can flicker.** On validation seed 9001, 14 of the 111 fixed-world targets let go for the kind drilled were later not let go for a run or more (counted on the evidence the record leaves out, by the test's `detail` option). Seven did so while the retest was still in the kept window. The likely cause (inferred) is that the walk is recomputed each time with the person's current typical rate, so a walk that had just reached the mark can fall short when the rate moves. Seven did so only after the retest left the 120 runs that keep pattern evidence, when the walk starts again later.
4. **Still weak was below 3 × typical for some typists** (inferred, not measured directly). The planted pairs are weak against the typist's base rate, while "still weak" is 3 times the pooled rate, which other weak pairs and the finger mechanics raise. Where an unchanged pair sits below that, Wald's bound does not hold, which would explain 2.3% against the 1% it promises; it is worst where tries are many (100 words, careless typists).

### What to try next

- Give the claim more evidence per run, not a weaker test: after a drill, let the next fresh runs lean toward the drilled pair (as adaptive text does, but on measured runs), so each run holds ten or more of its first tries. That is a product call about Practice's text.
- Fix the walk's typical rate at the drill, from the evidence before its split, so new runs cannot move a crossing; and keep pattern evidence for the runs since each kept drill, so the walk never restarts.
- Decide what the other kind means: a target let go for its misses and then named for its pace is a new step, or the let-go drops both parts.
- Judge any of these by a new rule on fresh seeds, with the run targets stated for the evidence a run holds.

### Train's "fixed"

The rule said Train's fixed would read `letGo` whichever policy is the default. With the candidate failing its own error measures, that is not done: under the shipped default it would make "fixed" rarer while nothing is let go sooner. Train keeps its rule ([ADR 0013](0013-learning-core.md) and the UI contract: not queued, and two runs since the drill with 20 clean observations), and `src/train-path.js` is unchanged. A version that passes would have Train read `letGo` too, as "let go and not queued". A test holds the let-go rule's floors, loop choice and reading of a loop's kind equal to Train's.

## Consequences

- The default is unchanged: `learner-decay-timing@1`, provisional, with no claim about learning (`PRODUCT.md` principle 4). The measured hold (34 to 111 clean runs) stands.
- `learner-let-go@2` and `learner-let-go-misses@2` are named variants. The learner's fold takes the drilled targets on the keyboard (`drilledTargets`), which only these variants read; every earlier version computes exactly what it did (a pinned test, written against master first).
- A fit on 1,000 runs, every one holding pattern evidence, and 200 loops takes a median of 13.4 ms for the shipped default and 16.4 ms for `learner-let-go@2` in Node on tobygdesktop, under load from other runs (slowest of 15: 17.5 and 22.2 ms).
