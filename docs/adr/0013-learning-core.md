# 0013. The learning core: a per-person model of pairs and keys

Status: Accepted, 2026-11-10. TOB-419.

## Context

Train, the results card's Drill action and adaptive mode took their target from a counting rule: the letter pair with the highest first-try error rate across recent runs at the same conditions, once it had 10 tries and errors or slowness in two runs. It ignored hesitation when ranking, never forgot, could not say how sure it was, and said nothing until a pair had been seen ten times, so Train showed "General drill" to almost everyone.

## Decision

`src/learner.js` replaces it as the default policy, `learner@1`. The counting rule stays in the code as the labelled baseline, `counting@1` (`countingRecommendation`), and `DEFAULT_POLICY` switches between them.

- **Evidence.** One record per measured run on one keyboard (input class and layout), from the run summaries the profile already keeps: per pair, tries, first-try errors, clean intervals and the log ratio of the pair's median interval to that run's median. Per key, tries and first-try errors. Which runs count is `evidenceRun`'s rule, unchanged. Unlike the counting rule, runs of every length and text setting on the same keyboard pool, since they measure the same hands. Run summaries gain one field, `corrections`: the count of timed corrections and their median time.
- **A pure fold.** `fitLearner(evidence, now, layout)` sorts records by date, then id, keeps one copy of each id, and folds them. It reads no clock, storage or DOM and uses no randomness. The same set of records gives the same model in any order, so devices that merge history agree ([0005](0005-sync-merges-copies.md)). No model state is stored, and nothing needs a keystroke recording ([0006](0006-recordings-stay-on-the-device.md)).
- **Decay.** A record weighs `0.5^(later runs / 30) × 0.5^(age in days / 60)`. The profile keeps pattern counts on its newest 120 runs, so the oldest weighs 1/16, and the newest 30 runs outweigh the rest: a fixed pair stops leading within a few sessions and a slipping one comes back. Skill keeps for weeks, so a two-month break only halves old evidence.
- **Estimates with uncertainty.** First-try error probability is a Beta posterior over decayed counts, with a prior worth 10 tries (the counting rule's floor) centred on the learned prior below. Hesitation is a normal posterior over the log interval ratio. A run's pair median counts with precision `intervals / (π/2 × 0.3²)`, around a prior with spread 0.15.
- **The learned part.** A regularized logistic regression maps a unit's features to its error prior: same finger, same hand, row distance, key distance, repeated key, English frequency (Zipf-weighted over the 5k list), keys off the home row, ring or pinky finger, and single key. Features come from the layout's finger map and are centred, so the intercept is a typical unit. It is fitted on the device from the person's own decayed evidence, each unit counting at most 10 tries. It uses 12 Newton steps with step halving, deterministic, pulled toward the starting weights (intercept sd 2, others sd 0.2). A ridge regression does the same for hesitation. The starting weights, `START_WEIGHTS`, are a hand-set prior from typing folklore. **They are not trained on anyone**, because there is no data from other people.
- **Selection by expected gain.** A unit's gain is its English frequency times the time it loses per occurrence. That time is errors above the person's typical pair times the measured cost of a correction (at least one clean interval), plus hesitation above the person's median pace. Each is taken half a standard deviation below its posterior mean, so thin evidence ranks lower. A key counts only misses its pairs don't explain. The result is a ranked queue.
- **Honest claims.** The model ranks, and people read observed evidence. The top unit is named only with at least 10 tries and a first-try error, or 10 clean intervals pooled across runs, slower than the run's median in most runs that timed it. Otherwise Train says "General drill", and the drill text leans toward the top four units by gain. Every count shown is raw and undecayed.
- **Text.** Adaptive text (`adaptive@2`) and the leaning general drill (`drill-general-lean@1`) draw half their words from real words holding the top units, by weight. Both stay drill-kind: never bests, trend points or baselines.
- **Versions.** A recommendation carries `policy`, and a saved loop records it.

## Evaluation

`npm run evaluate:learner` simulates typists from a seed, types passages from the app's own generator, and scores the runs with the app's own code. Each typist has hidden per-pair error probabilities and timings, plus three planted weak pairs. Half are "mechanics" typists, whose errors and timing follow finger mechanics with weights of their own. The other half are "unrelated" typists, whose don't, which guards against a simulator that flatters a model built on those features. Each policy predicts the next whole run from the runs before it. At seed 419, with 24 typists per group and 40 runs each:

| group | policy | next-run log loss | calibration error | runs to find 2 of the true top 3 | found by run 10 | named by run 10 | planted pairs by run 10 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mechanics | counting | 0.2716 | 0.0573 | not within 40 | 0% | 38% | 4% |
| mechanics | learner | 0.2393 | 0.0097 | 4 | 71% | 50% | 25% |
| unrelated | counting | 0.2150 | 0.0586 | not within 40 | 8% | 29% | 4% |
| unrelated | learner | 0.1801 | 0.0108 | 4 | 67% | 54% | 33% |

Seeds 1–3 show the same picture, except "named by run 10" on seed 3's mechanics group: 42% against the counting rule's 46%. The true top pairs are those with the highest true expected gain, the quantity the learner is built to find, so that column favours it by definition. The planted pairs are a check that doesn't depend on that definition. `tests/learner.test.js` pins the comparison at seed 419, so a regression fails CI. `--profile <file>` replays a stored profile's runs the same way.

This shows only that, on simulated typists, the learner predicts first-try errors better and finds the hidden weak pairs sooner. It is no evidence that anyone learns faster; that needs the study in `docs/ml-data-evaluation.md`.

## Consequences

- A fit on a 120-run history takes a median of 3 to 4 ms in Node on tobygdesktop (slowest of 30 about 14 ms, measured with another e2e run on the machine), and the first call, which builds the frequency table, 8 ms. So it runs whenever Train, a result or an adaptive passage needs it, with no cache.
- Changing a feature, prior, half-life or the gain is a new policy version, `learner@2`.
- Adaptive text needs at least one measured run on the keyboard; before that, adaptive mode gives the usual passage.
- Limits: the simulator is not people, the frequency table is English only, keys have no timing of their own, and Progress's "patterns across runs" still lists the counting rule's recurring pairs.
