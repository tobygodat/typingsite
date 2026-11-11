# 0013. The learning core: a per-person estimate of pairs and keys

Status: Accepted, 2026-11-11. TOB-419.

## Context

Train, the results card's Drill action and adaptive mode took their target from a counting rule. It named the letter pair with the highest first-try error rate across recent runs at the same conditions, once the pair had 10 tries and errors or slowness in two runs. It ranked by rate alone, never forgot, and read only runs at the exact conditions. A model could weigh more: how often a pair turns up, hesitation, finger mechanics, fading old runs. This ADR records which of those earned a place, by a rule written before the evidence was seen.

## Decision

`src/learner.js` gives the default policy, `learner@1`, which the evaluation below calls counts-gain. The counting rule stays in the code as the labelled baseline, `counting@1` (`countingRecommendation`). `learner-decay@1` is a named variant, and `DEFAULT_POLICY` picks between them.

- **Evidence.** One record per measured run on one keyboard (input class and layout), from the run summaries the profile already keeps. Per pair it holds tries, first-try errors, and whether the pair's clean intervals were slower than that run's median. Per key it holds tries and first-try errors. Which runs count is `evidenceRun`'s rule, unchanged. Unlike the counting rule, runs of every length and text setting on the same keyboard pool, since they measure the same hands.
- **A pure fold.** `fitLearner(evidence, now, variant)` sorts records by date, then id, keeps one copy of each id, and folds them. It reads no clock, storage or DOM and uses no randomness. The same set of records gives the same model in any order, so devices that merge history agree ([0005](0005-sync-merges-copies.md)). No model state is stored, and nothing needs a keystroke recording ([0006](0006-recordings-stay-on-the-device.md)).
- **Estimates.** A unit's first-try miss rate is `(errors + K × pooled) / (tries + K)`, the mean of a Beta posterior. Pooled is the person's rate over all pairs, or over keys' own tries for a key, and K is 40, chosen on validation typists. Before any evidence the pooled rate is about 3%, and every unit starts level. Every kept run weighs the same. The profile keeps pattern counts on its newest 120 runs.
- **A key's own evidence.** For ranking, a key's tries and misses outside the pairs ending in it that can be named themselves. A miss inside a named "th" is th's, so "h" ranks only on misses elsewhere.
- **Selection by expected gain.** A unit's gain is its English frequency (Zipf-weighted over the 5k list) times its misses per try above the person's typical pair, taken half a standard deviation below the posterior mean so thin evidence ranks lower. That is the extra misses it costs per letter typed. The result is a ranked queue.
- **Naming (`stated`, the one rule).** The model ranks, and people read observed evidence. A unit is named, queued or offered as Next only when its own observations have at least 10 tries (the floor a pair must meet) and a first-try error. A key's own observations are its tries outside the pairs ending in it that pass this rule, and its misses outside those pairs and outside its most-missed other pair. So a key is named only when it is missed beyond any one pair. Misses that all sit in "th" are th's, whether "th" has the tries to be named yet or not. A pair's tries also count as its own, not its key's, when 10 clean intervals pooled across runs were slower than the run's median in most runs that timed them. Slowness alone names nothing, because only ranked units are named and the gain counts misses. Otherwise Train says "General drill". Every count shown is raw. Naming reads no estimate, so it changes nothing the evaluation measures.
- **Reading back.** The comparison and Progress read back a target's own first tries in the retest beside the counts it was chosen on, a key's as well as a pair's. A key has no timing, so it gets no timing line, and Progress never shows a timing line whose runs held no intervals.
- **Text.** Adaptive text (`adaptive@2`) and the leaning general drill (`drill-general-lean@1`) draw half their words from real words holding the top four units, by gain. With no ranked unit, as for a new guest, the general drill is the plain one. Both stay drill-kind: never bests, trend points or baselines.
- **The decay variant.** `learner-decay@1` weighs a record `0.5^(later runs / 10) × 0.5^(age in days / 60)`. The 10 runs were chosen on validation typists; the 60 days are untested, because simulated typists take no breaks.
- **Deleted, after the evaluation.** The feature regression (a logistic prior over finger-map and frequency features from hand-set starting weights) and the hesitation term (a normal posterior over each pair's interval ratio, with a ridge prior over the same features) did not earn their place, and are not little code. Neither did the measured cost of a correction. Without hesitation it scaled every gain alike, so it changed no ranking, and the `corrections` field it added to run summaries is gone too. After the deletion the three policies left reproduce their recorded rows seed for seed.
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

The run that decided is recorded in [`0013-evaluation.json`](0013-evaluation.json), with every variant still in the code. Validation chose K = 40 for the counts-only rate (log loss 0.2079; K = 10 gave 0.2113) and a half-life of 10 runs for the full model (0.2093; 30 runs gave 0.2103). The tables are test seeds 1 to 5: the mean, then the lowest and highest seed. The hesitation term changes no prediction, so the rows that differ only by it predict the same.

| policy | log loss | mechanics | unrelated | drifting | calibration error |
| --- | --- | --- | --- | --- | --- |
| counting@1 | – | – | – | – | – |
| counts-gain | 0.2060 (0.2038–0.2080) | 0.2335 (0.2281–0.2384) | 0.1792 (0.1767–0.1806) | 0.2052 (0.2029–0.2086) | 0.0035 (0.0030–0.0038) |
| +hesitation | 0.2060 (0.2038–0.2080) | 0.2335 (0.2281–0.2384) | 0.1792 (0.1767–0.1806) | 0.2052 (0.2029–0.2086) | 0.0035 (0.0030–0.0038) |
| +decay | 0.2063 (0.2041–0.2084) | 0.2344 (0.2291–0.2394) | 0.1795 (0.1766–0.1812) | 0.2050 (0.2026–0.2084) | 0.0032 (0.0028–0.0035) |
| +features | 0.2096 (0.2076–0.2114) | 0.2358 (0.2306–0.2402) | 0.1832 (0.1810–0.1848) | 0.2100 (0.2075–0.2139) | 0.0137 (0.0134–0.0141) |
| +decay +hesitation | 0.2063 (0.2041–0.2084) | 0.2344 (0.2291–0.2394) | 0.1795 (0.1766–0.1812) | 0.2050 (0.2026–0.2084) | 0.0032 (0.0028–0.0035) |
| +features +hesitation | 0.2096 (0.2076–0.2114) | 0.2358 (0.2306–0.2402) | 0.1832 (0.1810–0.1848) | 0.2100 (0.2075–0.2139) | 0.0137 (0.0134–0.0141) |
| +features +decay | 0.2074 (0.2054–0.2091) | 0.2338 (0.2286–0.2383) | 0.1812 (0.1785–0.1829) | 0.2071 (0.2043–0.2110) | 0.0096 (0.0092–0.0099) |
| full | 0.2074 (0.2054–0.2091) | 0.2338 (0.2286–0.2383) | 0.1812 (0.1785–0.1829) | 0.2071 (0.2043–0.2110) | 0.0096 (0.0092–0.0099) |

| policy | planted@10 | common | middle | rare | planted@40 | common | middle | rare | pick-up | let-go |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| counting@1 | 16% (10%–22%) | 48% (29%–65%) | 1% (0%–4%) | 0% (0%–0%) | 50% (47%–54%) | 70% (63%–73%) | 68% (60%–75%) | 13% (8%–15%) | 21.0 (21.0–21.0) | 13.1 (4.5–21.0) |
| counts-gain | 22% (12%–28%) | 51% (27%–63%) | 14% (6%–25%) | 1% (0%–2%) | 43% (40%–48%) | 80% (73%–88%) | 45% (38%–54%) | 4% (2%–6%) | 16.7 (10.0–21.0) | 18.7 (11.0–21.0) |
| +hesitation | 27% (24%–31%) | 62% (60%–67%) | 19% (10%–27%) | 0% (0%–2%) | 43% (40%–49%) | 84% (79%–90%) | 42% (35%–52%) | 3% (0%–6%) | 17.1 (10.0–21.0) | 17.0 (14.5–21.0) |
| +decay | 24% (15%–28%) | 54% (31%–65%) | 17% (10%–25%) | 2% (0%–4%) | 40% (37%–45%) | 73% (63%–81%) | 45% (35%–50%) | 4% (0%–8%) | 12.9 (6.5–15.5) | 10.8 (3.5–14.5) |
| +features | 20% (12%–27%) | 46% (27%–54%) | 13% (6%–25%) | 1% (0%–2%) | 42% (36%–47%) | 76% (69%–81%) | 44% (35%–60%) | 7% (4%–13%) | 18.6 (12.0–21.0) | 17.3 (4.0–21.0) |
| +decay +hesitation | 26% (23%–28%) | 58% (54%–65%) | 19% (10%–25%) | 1% (0%–4%) | 36% (33%–42%) | 76% (73%–83%) | 29% (23%–40%) | 2% (0%–4%) | 12.4 (6.5–18.5) | 7.0 (5.0–10.0) |
| +features +hesitation | 28% (24%–31%) | 64% (54%–69%) | 18% (10%–25%) | 1% (0%–2%) | 45% (41%–52%) | 84% (79%–92%) | 47% (38%–56%) | 4% (2%–8%) | 16.0 (10.5–21.0) | 19.9 (18.0–21.0) |
| +features +decay | 21% (12%–26%) | 50% (27%–58%) | 11% (6%–21%) | 2% (0%–2%) | 36% (33%–38%) | 69% (63%–73%) | 35% (25%–44%) | 3% (0%–6%) | 15.1 (7.0–18.5) | 9.7 (3.5–15.0) |
| full | 27% (24%–31%) | 62% (54%–71%) | 19% (13%–23%) | 0% (0%–2%) | 38% (35%–43%) | 79% (75%–83%) | 33% (27%–44%) | 2% (0%–6%) | 10.3 (6.0–14.5) | 8.2 (6.0–11.0) |

- **Prediction.** It's a tie. Every variant's log loss range overlaps the counts-only rate's. The feature regression makes calibration worse beyond the spread: 0.0137 alone and 0.0096 in the full model, against 0.0035.
- **Ranking.** Six variants beat `counting@1`. `+hesitation`, `+decay +hesitation`, `+features +hesitation` and the full model do it on planted@10, and `+decay`, `+decay +hesitation`, `+features +decay` and the full model on pick-up. Nothing beats counts-gain on either measure. Counts-gain doesn't beat `counting@1` beyond the spread either: its planted@10 (12–28%) overlaps the counting rule's (10–22%), and so does its pick-up (10–21 runs against 21).
- **Verdict.** Every policy is eligible. `counting@1` is beaten, and counts-gain is the simplest policy nothing beats, so counts-gain is the default. None of the three components earned its place.
- **Strata, outside the rule.** By run 10 no policy finds rare planted pairs (0–2%). By run 40 `counting@1`, which ranks by rate alone, finds more middle pairs than counts-gain beyond the spread (68% against 45%), and counts-gain, which weighs pairs by frequency, finds more common ones (80% against 70%, within the spread).
- **Drift, outside the rule.** Without decay, counts-gain lets go of a fixed pair after a median of 18.7 runs. With the 10-run half-life, `+decay` needs 10.8 and the full model 8.2, within counts-gain's spread (11–21).
- **Two disclosures.** The `features` switch covered the error prior only, so `+hesitation` without features still fitted its hesitation prior over finger-map features. And the first evaluation's "true top pairs" column is gone: those were the pairs with the highest true expected gain, the learner's own objective, so it could only favour the learner.

## Consequences

- A fit on a 120-run history takes a median of 1.5 ms in Node on tobygdesktop (slowest of 30, 2.2 ms). So it runs whenever Train, a result or an adaptive passage needs it, with no cache.
- Changing K, the gain or the naming rule is a new policy version, `learner@2`.
- Adaptive text needs a unit missed above the person's typical rate on the keyboard. Before that, adaptive mode gives the usual passage.
- The default never forgets within the 120 runs a profile keeps. On drifting simulated typists it let go of a fixed pair after a median of 18.7 runs (11 to 21 across seeds, where 21 means not within 20). The decay variant needed 10.8, within that spread, so decay is not the default.
- Limits: the simulator is not people. The frequency table is English only. Keys have no timing of their own. The default names no pair for slowness alone, as the counting rule could. Progress's "patterns across runs" still lists the counting rule's recurring pairs.
