# 0017. learner-let-go@2: a drilled target is let go on the evidence since its drill

Status: Proposed, 2026-11-11. TOB-419.

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

Not yet run.
