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

### Decision rule v1

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

### Results v1

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

### Decision rule v2

Written on 11 November 2026, after v1's table above was seen. It amends v1, which had four faults:

1. **It left out letting go.** TOB-419 required, before any evaluation ran, that the learner forgets: a pair that was fixed stops being drilled, and a pair that slips comes back. v1 judged ranking only on planted pairs and pick-up, so the default it chose never forgets within the 120 runs a profile keeps.
2. **It compared unpaired ranges over five seeds.** Every policy types the same simulated typists on a seed, so the right test is the per-seed paired difference. Lowest-to-highest overlap across five seeds can call almost nothing a win.
3. **Its only ranking target was a planted pair in the top four.** Ranking by expected gain puts a rare pair low on purpose, so that measure penalises what the product is for. The product's objective is time lost, and v1 measured none.
4. **No simulated typist had a pair that is accurate but slow.** So a timing term could not show what it is for. The counting rule can name a pair for slowness alone, and `docs/ml-data-evaluation.md` puts timing in the baseline policy.

Because v2 was written after v1's results were seen, it is judged only on seeds no earlier run used. It is not changed after its results are seen.

- **Seeds.** Validation seeds 9001 and 9002 choose every constant. Test seeds 101 to 130, thirty never used before, are run once with the chosen constants.
- **Typists.** v1's three groups of 24 (8 per skill level), 40 runs of 25 words each, with v1's mechanics. Added to every typist: one planted slow-only pair. Its first-try error rate is the typist's base rate exactly (no mechanics pull, no noise), and its median interval is 1.5 to 2 times the typist's pace (a log ratio drawn evenly from 0.4 to 0.7; at pace otherwise). It is drawn from the common or the middle stratum, at even odds, and differs from the typist's other planted pairs. A drifting typist's slow-only pair is common and becomes fast (at pace) at run 20, and another common pair becomes slow the same way from run 20. So a drifting typist has one weak error pair and one slow-only pair at any time.
- **Candidates.**
  - `counting@1`, as the app runs it (v1).
  - Counts-gain, `learner@1` (v1). K from {2, 5, 10, 20, 40, 80}, by counts-gain's log loss on the validation seeds.
  - Counts-gain with decay, `learner-decay@1` (v1's weights). The half-life in runs from {10, 15, 20, 30, 60}, by this policy's log loss on the validation seeds. The 60 days stay untested.
  - Counts-gain with a plain timing term, `learner-timing@1`. A run's timing for a pair is r, the log of the pair's median clean interval over that run's median, from n clean intervals. The pair's slowdown pools across runs and shrinks toward none: h = Σ w·n·r / (Σ w·n + S), where w is the run's weight (1 without decay). There are no features and no regression. S comes from {5, 10, 20, 40, 80}, by the next run's timing error on the validation seeds: the squared difference between h and the next run's r, weighted by n, as a mean per typist. The gain adds time lost to slowness to time lost to errors, in units of one miss per letter typed: frequency × (misses above the typical pair per try, as in counts-gain, + max(0, e^h − 1) / 2). A miss is taken to cost two clean intervals, a wrong key and then the right one. That is the old correction default, not fitted. The simulator's miss costs 1.5, 2 or 2.5 intervals by skill level, so this constant sits near the simulator by construction.
  - Counts-gain with both, `learner-decay-timing@1`, at the same constants.
- **Measures, all per test seed.**
  - Prediction: log loss and calibration error on the next run's first tries (v1).
  - Captured gain at 10 and at 40 runs: over all 72 typists, the mean of the true time lost of the policy's top four units as a share of the true time lost of the best possible four. True time lost uses the simulator's hidden state at the run after the fit (run 10, run 40) and one formula for every policy. A unit's time lost per letter typed is its share of the letters in the app's passages (a pair's occurrences, or a key's word-initial ones, where the simulator uses a key's own rate) × (max(0, its first-try error rate − the typist's typical rate) × the typist's miss cost + max(0, its median interval − the typist's pace)). The typical rate is the letter-weighted mean first-try error rate, the miss cost is the simulator's (correction keys − 1) × the typist's median interval, and the pace is the median interval over pair occurrences. A policy with fewer than four units scores its units against the best four.
  - Planted at 10 and at 40, on mechanics and unrelated typists: the share of planted pairs in the top four, by stratum (common, middle, rare error pairs), with the slow-only pairs as their own stratum. "Planted error pairs" is the three error strata together.
  - Pick-up and let-go on drifting typists, for the error pairs and for the slow pairs, as v1 defines them (a median over drifting typists; 21 means not within 20).
- **Test.** For two policies and a measure, take the thirty per-seed differences. A difference is real when the 95% t interval of its mean, mean ± 2.045 × sd / √30 (29 degrees of freedom), excludes zero. Every mean difference is reported with its interval.
- **Decision.**
  1. **Timing**, a capability the counting rule has, not something evidence has to win. The default includes the timing term when counts-gain with timing is not really worse than counts-gain, and counts-gain with both is not really worse than counts-gain with decay, on log loss, calibration, captured gain at 10 or at 40, or planted error pairs at 10. A policy with no timing term finds no slow-only pair by construction, and its number says so; it is not a discovery.
  2. **Decay**, a requirement from the issue, not something evidence has to win. With timing as step 1 set it, compare the policy with decay against the same policy without it. The default includes decay when it is really better on error pick-up or error let-go (or, with timing, slow pick-up or slow let-go), and not really worse on log loss, calibration, or captured gain at 10 or at 40. If it is really worse on one of those, the default has no decay, the constants are not retuned on the test seeds, and this ADR says the requirement is unmet and why.
  3. **The baseline.** The learner policy from steps 1 and 2 replaces `counting@1` as the default only if it is not really worse than `counting@1` on captured gain at 10 and at 40. If it is really worse on either, `counting@1` stays the default.
  4. **Simplest.** Steps 1 and 2 leave one learner policy, and step 3 picks between it and `counting@1`, so the simplicity clause decides only what stays in the code. A component the default does not use is deleted, unless keeping it as a named variant costs a line or two. `counting@1` stays in the code as the labelled baseline either way.
- **Still provisional** (`PRODUCT.md` principle 4). Until the learning study in `docs/ml-data-evaluation.md` can run, the promotion makes no claim about learning, and no simulated learning-speed result is reported (v1).

## Consequences

- A fit on a 120-run history takes a median of 1.5 ms in Node on tobygdesktop (slowest of 30, 2.2 ms). So it runs whenever Train, a result or an adaptive passage needs it, with no cache.
- Changing K, the gain or the naming rule is a new policy version, `learner@2`.
- Adaptive text needs a unit missed above the person's typical rate on the keyboard. Before that, adaptive mode gives the usual passage.
- The default never forgets within the 120 runs a profile keeps. On drifting simulated typists it let go of a fixed pair after a median of 18.7 runs (11 to 21 across seeds, where 21 means not within 20). The decay variant needed 10.8, within that spread, so decay is not the default.
- Limits: the simulator is not people. The frequency table is English only. Keys have no timing of their own. The default names no pair for slowness alone, as the counting rule could. Progress's "patterns across runs" still lists the counting rule's recurring pairs.
