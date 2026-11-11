# ML data and evaluation plan

Status: proposed, 21 September 2026. The first model shipped on 10 November 2026 (Model progression). The ML task is to predict where a typist will struggle and select useful practice. Prediction quality and actual learning benefit are separate outcomes; both must be evaluated.

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

### Shipped: learner@1 (November 2026)

The first model is `src/learner.js` ([ADR 0013](adr/0013-learning-core.md)), the default policy since v0.3.0, with the weak-pair baseline above kept as `counting@1`. It is a per-person fold over the compact run summaries, run on the device. Each pair and key gets a decayed Beta posterior for first-try errors and a normal posterior for hesitation (log interval ratio to the person's median). Their priors come from a regularized logistic classifier and a ridge timing regressor over finger-map and frequency features, fitted on the person's own evidence from hand-set starting weights. Targets are ranked by expected time lost per occurrence times English frequency, discounted by uncertainty, and named only from observed counts. Run summaries now also keep the median time of each run's corrections (`corrections`). No population data, cloud training or shared dataset is involved.

`npm run evaluate:learner` is its offline prediction evaluation, on simulated typists from the app's own text generator. Splits are chronological by whole run. It reports next-run log loss by history length, calibration error, and how soon each policy's ranking holds the true top pairs and the planted weak pairs. Typists whose weak pairs ignore finger mechanics are reported apart. `--profile` replays a stored profile. On simulated typists the learner beats the baseline on every one of these (ADR 0013 has the table). That is a prediction result on simulations, not a learning result: the learning and retention evaluation below has not run.

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

Promote the model only if it improves learning relative to the baseline without an unacceptable accuracy loss, using thresholds specified before the study. Small samples support a pilot conclusion, not a causal marketing claim. Improvement on memorized quotes, leaderboard position, or prediction accuracy alone is insufficient. Transfer to everyday writing needs a separate assessment.

## Product hypothesis checks

Track the complete funnel: completed run → recommendation viewed → drill started/completed → fresh retest → later return. Pair it with an authorized usability study asking whether people understand the recommendation and comparison. This tests the integration hypothesis independently of ML. Failure to start a drill is a workflow signal; failure to outperform equal-time practice is a learning signal.

The first portfolio report should publish methods and aggregate results, including null findings and limitations, without exposing raw participant typing traces. No learning result exists yet; the only model result is the simulated prediction evaluation above.
