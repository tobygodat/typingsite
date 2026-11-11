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

### Decision rule

Written on 11 November 2026, before the evaluation below was rerun, and not changed after seeing its results.

`npm run evaluate:learner` simulates typists, types passages from the app's own generator, and scores the runs with the app's own code.

- **Typists.** Three groups of 24 (8 per skill level), each typing 40 runs of 25 words. "Mechanics" typists' errors and timing follow finger mechanics with weights of their own. "Unrelated" typists' don't, which guards against a simulator that flatters a model built on those features. Each typist in these two groups has three planted weak pairs, one from each frequency stratum of the pairs the app's passages hold: common (ranks 1–30), middle (31–90) and rare (91 on). "Drifting" typists have one common weak pair that is fixed after run 20, and another common pair that starts slipping then.
- **Split.** Every constant chosen below is chosen on validation seeds 9001 and 9002 and judged on test seeds 1 to 5, so no typist is in both.
- **Policies.**
  - `counting@1`, as the app runs it: the recurring pairs at these conditions, else the newest 20 traces' target (`countingRecommendation`). It ranks and predicts nothing.
  - The counts-only rate: a pair's `(errors + K × pooled) / (tries + K)`, where pooled is the person's rate over all pairs. No decay, no features. K comes from {2, 5, 10, 20, 40, 80}, by log loss on the validation typists. Its expected-gain ranking, counts-gain, is the simplest ranking baseline.
  - The learner with any of its three components turned off: the feature regression (off: the prior is the person's pooled rate, worth K tries), decay (off: every run weighs 1) and the hesitation term (off: the gain counts errors only). With all three off it is counts-gain. `HALF_LIFE_RUNS` comes from {10, 15, 20, 30, 60}, by the full model's log loss on the validation typists.
- **Measures.** Prediction is the log loss of each next run's first tries, as a mean over the typists of all three groups. Calibration error is reported beside it. Ranking reads the policy's top four units, which adaptive text and a leaning drill draw on. Planted@10 is the share of planted pairs in the top four after 10 runs (also reported per stratum, and after 40 runs). Pick-up is how many runs after the change the slipping pair needs to enter the top four and stay there. Let-go is how many runs the fixed pair needs to leave it and stay out (both as a median over drifting typists; 21 means not within 20).
- **Spread.** Each measure is computed per test seed. The tables show the mean and the lowest and highest seed. A beats B on a measure when the two ranges don't overlap and A's is the better one. Otherwise they match.
- **The rule.** A beats B on ranking when it beats B on planted@10 or on pick-up, and B beats A on neither. A learner variant is eligible when its log loss is not worse than the counts-only rate's beyond the spread. `counting@1` is eligible. The default is the simplest eligible policy that no eligible policy beats on ranking. Simplest means `counting@1`, then counts-gain, then fewer learner components; between equally simple policies, the higher mean planted@10. So if no learner variant beats `counting@1` on ranking, `counting@1` stays the default. A component outside the default has not earned its place. It stays as a named policy variant if that costs little code, and is deleted otherwise, and the result is recorded here.
- **Before there are users** (`PRODUCT.md` principle 4). Until the learning study in `docs/ml-data-evaluation.md` can run, a policy becomes the default only by this rule. The promotion is provisional, and the study stays the bar for any claim about learning.
- **No learning-speed result.** A simulated typist improves after a drill only as the simulator says it does, so a simulated learning result would restate that assumption. The evaluation reports none.

### Results

Filled in from the rerun.

## Consequences

- A fit on a 120-run history takes a median of 3 to 4 ms in Node on tobygdesktop (slowest of 30 about 14 ms, measured with another e2e run on the machine), and the first call, which builds the frequency table, 8 ms. So it runs whenever Train, a result or an adaptive passage needs it, with no cache.
- Changing a feature, prior, half-life or the gain is a new policy version, `learner@2`.
- Adaptive text needs at least one measured run on the keyboard; before that, adaptive mode gives the usual passage.
- Limits: the simulator is not people, the frequency table is English only, keys have no timing of their own, and Progress's "patterns across runs" still lists the counting rule's recurring pairs.
