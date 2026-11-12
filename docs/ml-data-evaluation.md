# ML data and evaluation plan

Status: proposed, 21 September 2026. The first model is `learner-decay-timing@1` (Model progression). The ML task is to predict where a typist will struggle and select useful practice. Prediction quality and actual learning benefit are separate outcomes; both must be evaluated.

## Data contract

Capture events only while the product's typing surface is active. Do not monitor other applications, browser pages, or unrelated fields. Start with local data. Shared training datasets require explicit participation, a defined retention period, and deletion support before collection begins.

| Record | Minimum fields and purpose |
| --- | --- |
| Text | Text ID/version, content, provenance/license, language, length, corpus, descriptive difficulty features; identifies what was typed and whether a retest is fresh |
| Attempt | Local/pseudonymous profile ID, attempt/session IDs, text version, mode, correction policy, metric/event versions, start/end/status, interruption flags; keeps comparisons reproducible |
| Input event | Ordered sequence number, monotonic offset from start, insert/delete/composition/focus type, expected position, actual inserted character inside the typing surface, correctness; reconstructs mistakes and corrections |
| Pattern summary | Pair/word, first-attempt counts/errors, valid timing samples, median timing, recency, source attempt IDs; supports explainable recommendations |
| Recommendation | Targets, candidate text IDs, evidence counts, baseline/model version, reason, selected drill, manual override; records what was suggested and actually used |
| Evaluation assignment | Study/group ID, assignment time, practice duration, pre/post/delayed text IDs, outcomes and completion status; separates treatment from outcome |

Persist final summaries and bounded local event history; choose a concrete retention duration before shipping. Clearing history removes local attempts and derived profiles. Before adding cloud storage, define equivalent deletion of events, derived features, and future training eligibility. Record keyboard/layout changes only when supplied by the user; do not infer finger use from timing.

## Transparent baseline first

Use first-attempt errors at expected positions, preserving them after correction. Attribute pairs to their expected adjacent characters. Use timing between consecutive correct first-attempt insertions for hesitation estimates; exclude correction intervals, focus interruptions, composition events, and long pauses from pair timing while retaining flags and counts. Corrections still consume run time in WPM. Timing is behavioral evidence, not a diagnosis of finger technique.

Proposed starting policy, to tune and version using pilot data:

1. Use the latest 20 completed, compatible attempts for recent evidence. Retain longer history for progress views.
2. Require at least 10 first-attempt pair observations for an error-rate target or 10 valid intervals for a timing target. Report the count; otherwise show “more data needed.” Treat gaps over 2 seconds as pauses for the baseline timing calculation, not as evidence of slow finger movement.
3. Select the pair with the highest first-attempt error rate; optionally add the distinct pair with the largest median timing slowdown relative to that user's typical valid pair timing. Break ties by evidence count, then a stable pair order. Do not use tiny samples to claim certainty.
4. Select varied realistic text with enough occurrences of the targets, an appropriate estimated duration, and manageable surrounding difficulty. Explain the target with actual evidence. For a cold start, offer general practice or manual selection.

Include word-level counts and correction burden in feedback; the pair policy is the initial automated selector. Preserve manual choice and log overrides. Reserve separate passages for assessment, matching length, punctuation, vocabulary, and target frequency as closely as the corpus allows. Label residual differences and never reuse a drill as its own transfer test.

## Model progression

First train simple supervised models: a regularized classifier for first-attempt error probability and a timing regressor for valid pair intervals or completion time. Inputs can include text patterns, word length/frequency features, punctuation, position, recent user error/timing summaries, and evidence counts. Compute all user-history features from data available before the predicted attempt.

Compare these against population-only estimates, recent-user estimates, and the weak-pair baseline. Consider richer models only if the simpler models leave a measured gap. For recommendations, prefer text with useful target coverage and moderate predicted difficulty, while controlling practice duration and repetition. Predicting the hardest text does not mean finding the most useful exercise.

### The first model: learner-decay-timing@1

The first model is `src/learner.js` ([ADR 0013](adr/0013-learning-core.md)), the default policy from v0.3.0, with the weak-pair baseline above kept as `counting@1`. It is a per-person fold over the compact run summaries, run on the device, with older runs fading (half weight 60 runs back). Each pair's and key's first-try miss rate is its own counts pulled toward the person's pooled rate (a Beta posterior worth 40 tries), and each pair's slowdown is its clean intervals against the person's pace, pooled across runs and pulled toward none. A key counts only misses outside the pairs ending in it that can be named. Targets are ranked by the time each loses per letter typed (excess misses, plus slowness priced at two intervals a miss, times English frequency, discounted by uncertainty), and named only from observed counts or, for a pair ranked on its slowness, observed timing more than 20 ms slower than the person's pace. As in the baseline above, timing is part of the policy. No population data, cloud training or shared dataset is involved.

`npm run evaluate:learner` is its offline evaluation, on simulated typists from the app's own text generator. Splits are chronological by whole run. Constants are chosen on two validation seeds, and thirty test seeds no earlier run used are run once. Every typist has planted weak pairs from three frequency strata and a pair that is accurate but slow, and drifting typists have weak and slow pairs that are fixed or slip midway. It reports next-run log loss and calibration error, captured gain (the simulator's true time lost in each policy's top four, as a share of the best four), planted pairs found by stratum, and how soon each policy picks up a slipping pair and lets go of a fixed one. Each comparison is a paired difference over the thirty seeds with a 95% t interval. A rule written before the run (rule v2, which amended rule v1 after v1's results were seen) picked the default. A regularized logistic prior over finger-map features made calibration worse in v1 and stays deleted. The timing term and decay each changed log loss by 0.00002 or less. The timing term held 23 to 33 percentage points more of the true time lost in the top four, on simulations whose true time lost counts slowness. It passed the rule's guards only because the simulator's missed pairs are also slow; with them at the typist's pace it pushed missed pairs out of the top four and failed them, so it is in by product call, not by evidence. Decay let go of fixed pairs 1.3 to 2.6 runs sooner and picked up a slipping error pair 1.6 runs sooner. That is a result on simulations, and the learning and retention evaluation below has not run.

[ADR 0015](adr/0015-learner-2.md) asked two more questions by a rule written before its run, on a simulator where each typist's correction costs 1 to 8 intervals. Pricing a miss at the person's own measured correction cost (`learner-own-cost@2`) estimated that cost within about 11%. That holds on the simulator, which makes each correction from the same cost the measurement reads, so it proves the code path and says nothing about real typing. The variant captured up to 3 points more of the time lost at 40 runs, and was really worse on captured gain at 10 runs in one variant and on let-go in the other, so it stays a named variant. A 20-run half-life let go of fixed pairs and picked up slipping ones 2 to 4 runs sooner, and was really worse on log loss by 0.0001, so the half-life stays 60 runs. The default is unchanged. People choose the trade between slow and missed pairs with the training focus: balanced is the evaluated policy, accuracy ranks by misses only and speed by slowness only, and each names a unit only on its own evidence of that kind.

[ADR 0019](adr/0019-learner-lets-go.md) asked whether a drilled target can be let go on the evidence since its drill, by a sequential test: for misses, a likelihood ratio between the person's typical rate and three times it; for pace, which records no spread, whether each run had the pair slower than the person's pace. It was judged by a rule written first, on a guard world (ADR 0015's simulator with drills) and on simulated seasons of 160 runs across 10 to 100 words a run, 1 to 15 runs a day, three skill levels and bad days. It harmed nothing the earlier rules guard. It failed on what it was for: at 25 words a fixed target took a median of 100 runs to let go for misses and 42 for pace, 2.3% of still-weak targets were let go for misses (ceiling 2%), and about 30% of let-go targets were named again, mostly for their other kind. So `learner-let-go@2` is a named variant and the default is unchanged. The binding limit is how many first tries of the pair a run holds.

Do not use a personalized prediction to silently change ranked quote difficulty. Freeze and version public difficulty/performance scoring separately; multiplayer rating measures competitive results, not the recommender's confidence.

## Prediction evaluation

- Split chronologically by complete session for returning-user prediction. Never randomly split individual keystrokes across training and test sets.
- Hold out entire users for generalization. Report cold-start users separately from held-out users given a fixed earlier calibration history.
- Hold out text/quote families as an additional generalization check; report repeated versus novel passages separately. Fit preprocessing and tune models only on training/validation partitions.
- Measure error-probability log loss, calibration, and a class-imbalance-aware metric such as precision–recall AUC; measure timing MAE and median absolute error. Report per-user aggregates, sample sizes, and uncertainty so prolific users do not dominate.

No offline prediction metric by itself establishes learning benefit.

## Learning and retention evaluation

Once an authorized pilot can run, use comparable unseen pretests, equal practice time, unseen immediate post-tests, and an unseen delayed retest. A proposed delayed interval is seven days; record actual elapsed time. Counterbalance assessment forms and record prior exposure. Avoid a crossover design that ignores carryover from learning.

First compare the baseline with generic practice. Later compare the model with the baseline, keeping duration, correction policy, UI, and assessment difficulty comparable. Randomize at user level and stratify by initial ability where feasible. Choose sample size and a minimum meaningful effect from pilot variance before examining treatment results.

Primary proposed outcome: change in corrected WPM on novel passages, with input accuracy as a guardrail. Also report first-attempt target error rate, valid target timing, drill uptake/completion, and return usage. Report effect sizes, uncertainty, missing follow-ups, and attrition by group. Track both assigned and completed practice; do not analyze only successful finishers and claim a general benefit.

Promote the model only if it improves learning relative to the baseline without an unacceptable accuracy loss, using thresholds specified before the study. Until this study can run, a policy becomes the default only by the rule in [ADR 0013](adr/0013-learning-core.md), on simulated typists. That promotion is provisional and supports no claim about learning. Small samples support a pilot conclusion, not a causal marketing claim. Improvement on memorized quotes, leaderboard position, or prediction accuracy alone is insufficient. Transfer to everyday writing needs a separate assessment.

## Product hypothesis checks

Track the complete funnel: completed run → recommendation viewed → drill started/completed → fresh retest → later return. Pair it with an authorized usability study asking whether people understand the recommendation and comparison. This tests the integration hypothesis independently of ML. Failure to start a drill is a workflow signal; failure to outperform equal-time practice is a learning signal.

The first portfolio report should publish methods and aggregate results, including null findings and limitations, without exposing raw participant typing traces. No learning result exists yet; the only model result is the simulated evaluation above.
