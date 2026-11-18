# 0026. learner-start@3: a starting view trained on public keystrokes

Status: Proposed, 2026-11-17. TOB-513. The rule below is written before any model is fitted. Toby accepted its thresholds on 2026-11-18. Its amendments are dated, each was made before any candidate was fitted, and it is not changed after a candidate's results are seen.

## Context

The learner knows nothing about a new person. `learner-decay-timing@1` ([ADR 0013](0013-learning-core.md)) pulls every pair's first-try miss rate toward the person's own pooled rate and every pair's pace toward the person's own pace, so before the evidence arrives every pair looks the same. A prior built by hand from keyboard geometry made calibration worse in ADR 0013 and was deleted. Every learner result so far is on simulated typists.

Aalto University's 136M Keystrokes dataset (Dhakal, Feit, Kristensson and Oulasvirta, CHI 2018) holds the key-by-key log of 168,594 volunteers who each typed 15 English sentences in a browser. A model fitted to it can say which pairs tend to be missed or slow for a typist of a given speed. This ADR asks one question: does starting from that view, in place of "every pair is the same", predict a real person's next run better in their first runs, without hurting later ones?

### What this supersedes

[ADR 0013](0013-learning-core.md) and `docs/ml-data-evaluation.md` say no population data is involved. Toby decided on 2026-11-17 that a model may be fitted to **public** data. Nothing from Stilltype's own users is collected, shared or trained on by this ADR (that is TOB-514, undecided). Recordings stay on the device ([ADR 0006](0006-recordings-stay-on-the-device.md)).

### Licence

The dataset's `readme.txt` says: "You are free to use this data for non-commercial use in your own research or projects with attribution to the authors." Stilltype is free and has no paid tier. The raw data is never committed or redistributed. The shipped file holds fitted coefficients only. `docs/ml-data-evaluation.md` and the app's credits cite the paper. If Stilltype ever charges money, the authors are asked first.

### Disclosure

Before this rule was written I read the dataset's `readme.txt`, counted `metadata_participants.txt` by layout, keyboard type and native language, and read the first 45 keystroke rows of participant 100001. Participants 100001, 3, 5 and 7, the only ones whose rows I have seen, all fall in the training split below.

### Amended on 2026-11-18, before any model was fitted

Building the pipeline showed three things the rule above had not allowed for. Each was found on training participants only, in the 30 files matching `1000*_keystrokes.txt`, and no model had been fitted and no validation or test participant's keystrokes read. The pipeline's printed report did show me drop counts for the 5 validation and test participants among those 30.

- **`LETTER` is unreliable.** It is sometimes empty, sometimes the wrong character for a letter key (a comma logged for key code 77), and sometimes the backspace control character. Read as written, 20 of 375 sentences had no typing key at all. So a key is now read from its key code where the two can disagree. The replay check still decides whether a reading was right.
- **A slip left in the submitted text moves every later position.** The app compares each try with the letter at its position, so one omitted letter makes the rest of the sentence read as misses. The app shows a wrong letter at once and the dataset's test did not. So a sentence now counts only when what was submitted is the sentence. First tries that were wrong and then corrected are still counted, which is what the learner reads.
- **The log itself loses keystrokes.** About 3 in 10 sentences in those files fail the replay check, most because a key the participant must have pressed is not in the log. They are dropped, as the rule already said. This lowers how many participants reach 10 sentences, and the report states the count.

The pipeline also reports the share of wrong first tries that sit in a run of three or more in a row. Those are a slip that was corrected late, not three misses, and they are the remaining way this data differs from typing in the app.

### What the pipeline kept

The full conversion ran once, on 2026-11-18, in 85 seconds. Its report gives the same counts for every split, so I have seen the validation and test participants' drop counts, first-try miss rate and shifted share below. No model existed when I did.

| split | participants on QWERTY, full or laptop | kept (10 or more sentences) | runs | sentences failing the replay check | sentences not typed as shown | first-try miss rate | misses in a run of 3 or more |
| --- | --- | --- | --- | --- | --- | --- | --- |
| train | 129,737 | 58,057 (44.7%) | 679,880 | 23.5% | 19.7% | 3.27% | 24.8% |
| validation | 16,153 | 7,242 (44.8%) | 84,817 | 23.6% | 19.6% | 3.33% | 24.9% |
| test | 16,166 | 7,148 (44.2%) | 83,782 | 23.8% | 19.7% | 3.21% | 24.4% |

6,537 participants were on another layout or keyboard, and 360 rows could not be read. A kept participant has 11.7 runs at the mean, so the last band of k (10 to 14) holds fewer people than the first. A quarter of the wrong first tries are late-corrected slips, which inflates every pair's miss rate about evenly and is the main caution on the miss half of the model.

## The data

### Who is kept

Participants whose metadata says `qwerty` and a `full` or `laptop` keyboard: 162,057 of 168,594. Every native language is kept, because the app's users are not all native English speakers. A participant is kept when at least 10 of their sentences pass the replay check below.

### One sentence becomes one run, by the app's own code

Each sentence is turned into the app's attempt record and read by `replayAttempt` and `runRecord`, the code that reads a real Stilltype run. No miss or interval is defined a second time ([ADR 0003](0003-versioned-metric-contract.md)).

- The text is `SENTENCE`. Offsets are `PRESS_TIME` minus the sentence's first press.
- A key whose `LETTER` is one printable character is an `insert` at the end of what is typed. `BKSP` is a `delete` of one. Every other key (`SHIFT`, `CAPS_LOCK`, arrows and the rest) adds no event.
- **Reading a key (amended, see below).** A letter key (`KEYCODE` 65 to 90) is read from its key code, with its case from `LETTER` when that names the same letter and from a held Shift otherwise. `KEYCODE` 8 is a backspace whatever `LETTER` holds. A key logged with no `LETTER` is read from a short US QWERTY table of its key code.
- **Replay check.** A sentence is kept only when the replayed text equals `USER_INPUT`. This drops sentences edited with the mouse, a selection, arrow keys or a word delete, where positions cannot be recovered, and sentences whose log is missing a keystroke. The pipeline reports how many are dropped and why.
- **The sentence was typed (amended, see below).** A sentence is kept only when `USER_INPUT` equals `SENTENCE`.
- Runs are ordered by their first press. The keyboard is `physical-keyboard:qwerty`. The run kind is one the learner counts as evidence.

The learner reads a–z pairs and keys only, so capitals, digits and punctuation in the sentences add no units, as in the app.

### Splits

By participant, never by keystroke: `sha256(PARTICIPANT_ID) mod 100`. 0 to 79 is training, 80 to 89 validation, 90 to 99 test. Validation chooses every constant and the model. Test participants are read once, after the constants are fixed and committed.

## The candidate: `learner-start@3`

`learner-decay-timing@1`, unchanged in every constant, with two changes to what a unit is pulled toward.

- **Misses.** Today a unit's miss rate is its own counts plus 40 tries at the person's pooled rate p. The candidate uses `Km` tries at `sigmoid(logit(p) + a(unit, person))`. With no evidence at all, p is the training participants' pooled rate.
- **Pace.** Today a pair's slowdown is pulled toward none with the weight of 5 intervals. The candidate pulls it toward `b(unit, person)`, a log ratio to the person's pace, with the weight of `Kt` intervals.

`a` and `b` come from the fitted model. `person` is at most two numbers the learner already has: the person's pace and their pooled miss rate. Before the first run both are the training participants' medians.

Ranking, decay, the frequency table, the miss cost and the focus are unchanged.

**Naming is unchanged.** A unit is named, on Train or anywhere else, only from the person's own observed counts or timing (`PRODUCT.md` principle 1, `stated` in `src/learner.ts`). The starting view moves the ranking and what adaptive text leans toward. It is never shown as evidence.

### The models compared, fixed now

- **S0, none.** The shipped learner.
- **S1, a table.** One `a` and one `b` per unit: the training participants' mean log odds of a miss and mean log slowdown for that unit, each relative to the participant's own, pulled toward zero for rare units by a strength chosen on validation.
- **S2, a regression.** An L2-regularized logistic regression for `a` and a ridge regression for `b`, over features of the unit (hand, finger, row and column of each key on QWERTY, same finger, same hand, row jump, English frequency of the pair and of each letter) and their products with the person's log pace and logit of pooled miss rate. Regularization is chosen on validation.
- **Reported, not shippable: S3**, gradient-boosted trees over S2's features. It shows whether S2 leaves a gap. It cannot be chosen by this rule.

S1 and S2 ship as one static JSON file read by plain TypeScript. Models are fitted in Python (`ml/`, pinned with `uv`) on the run summaries the pipeline writes. Every judged number comes from the TypeScript evaluation running the app's own learner, so a difference between the Python fit and the shipped arithmetic cannot hide.

### Constants, chosen on validation participants only

1. `Km` from {10, 20, 40, 80} and `Kt` from {2, 5, 10, 20}, per model, by the lowest log loss and the lowest pace error in bands 0 and 1–2 below.
2. S1's shrink strength and S2's regularization, by the same measures.
3. **The model.** S2 is the candidate only when its log loss in bands 0 and 1–2 beats S1's by more than the log-loss margin below. Otherwise S1 is, because it is simpler to read and to ship.

## Measures

For each participant, in run order, the learner is fitted on their first k runs and predicts run k + 1, for k = 0 to the run before their last. Results are grouped in bands of k: **0**, **1–2**, **3–5**, **6–9**, **10–14**.

- **Log loss** of first-try misses on a–z tries in the predicted run, and **calibration error** in ten equal-count bins, both computed as `scripts/evaluate-learner.mjs` computes them today.
- **Pace error**: the mean absolute error, in log ratio, between each timed pair's predicted and observed interval over the run's median.
- **Captured share.** The time a unit loses in a set of runs is its misses times the miss cost times the person's interval, plus the sum over its timed intervals of the interval less the run's median, floored at zero. For each participant and k, the share is the time lost in all runs after k by the learner's top four units, over the time lost there by the best four in hindsight. This is noisy for one person and is read only as a mean over participants.
- **Named top-four rate**: how often the unit Train would name after k runs is in the hindsight top four. Reported, deciding nothing, because naming is unchanged by design.

Each comparison is the mean per-participant difference, candidate minus S0, with a 95% bootstrap interval over participants (2,000 resamples, seed 513). Slices are reported and decide nothing: native English or not, full or laptop keyboard, and thirds of typing speed.

### Margins

ADR 0015 found that a rule with no margin lets a trivial loss block a real gain. With about 16,000 test participants every interval will be narrow, so each guard has a margin stated here.

- Log loss: 0.5% of S0's log loss in that band.
- Calibration error: 0.002.
- Pace error: 0.5% of S0's in that band.
- Captured share: 0.5 points.

"Worse" below means the interval lies wholly beyond the margin on the worse side. "Better" means the interval lies wholly beyond zero on the better side.

## Decision

`learner-start@3` becomes the default when all of these hold on the test participants.

- **(a) It predicts the first runs better.** Log loss is better in band 0 and in band 1–2.
- **(b) It ranks the first runs better.** Captured share is better in band 1–2 by at least 2 points at the mean. Band 0 is reported only: with no evidence the shipped learner ranks every person the same, and nothing can be named yet, so a gain there is not one a person sees.
- **(c) It does not hurt later.** In bands 3–5, 6–9 and 10–14 it is worse on none of log loss, calibration error, pace error and captured share.
- **(d) It does not break forgetting.** On ADR 0015's guard world, test seeds 401 to 430 (never used), with the prior switched on: pick-up and let-go are each no more than 1.0 run slower at the mean than S0. The simulator plants weak pairs without regard to the keyboard, so it cannot reward the starting view. It can only show whether the view makes the learner slow to follow a person who differs from it. Log loss and captured gain on the simulator are reported and decide nothing, for the same reason.
- **(e) It is cheap.** The shipped file adds at most 30 KB gzipped. A recommendation on 1,000 runs and 200 loops is at most 2 ms slower at the median than S0 on the same machine.
- **(f) Every earlier version computes exactly what it did**, by the pinned test.

**Mixed results.** If (a) and (c) to (f) hold and (b) fails, the candidate stays a named, non-default version and this ADR says so. If the miss half passes and the pace half is worse in (c), `learner-start-misses@3`, the same with the pace pull left at none, is judged in the same run by the same clauses and becomes the default if it passes. If the pace half passes and the miss half fails (a) or is worse in (c), `learner-start-pace@3`, the same with the miss pull left at the person's own rate, is judged the same way, with pace error standing in for log loss in (a) (added 2026-11-18 with Toby's agreement, because a quarter of the recorded misses are late-corrected slips and the miss half is the noisier one). Otherwise the default stays `learner-decay-timing@1`, no threshold moves, and this ADR says what failed.

### Reported, deciding nothing

- Toby's exported history (TOB-511), n = 1: the same measures for S0 and the candidate.
- How many sentences and participants each filter drops.
- S3's measures beside S2's.

### What a pass would and would not show

A pass shows that, for people like the dataset's volunteers typing one sitting of sentences, the learner predicts and ranks better in its first runs. It does not show that anyone learns faster (`PRODUCT.md` principle 4 holds, and the learning study in `docs/ml-data-evaluation.md` has not run). The dataset is one sitting per person, so it says nothing about weeks of practice, drills or forgetting. The volunteers chose to take a typing test in 2016 on a site for measuring speed, and are not a sample of Stilltype's users.

## Amended on 2026-11-18, with the evaluation harness, before any candidate was fitted

`bun run evaluate:start` (`scripts/evaluate-start.mjs`) computes the measures. Building it settled three details and found one thing about the shipped learner. I had run it for S0 only, on 400 training participants and then on every validation participant, when these were written.

- **Captured share reads medians.** A run record keeps each pair's median clean interval and the run's, not every interval. So a pair's time lost to slowness is its timed tries times its median less the run's median. A key loses only its misses outside a pair. A miss costs two of the run's own intervals (12,000 ms over its wpm).
- **Calibration error is one pooled figure a band**, as `evaluate-learner.mjs` computes it, with no interval. Its guard compares the two pooled figures against the 0.002 margin.
- **The test split needs `--judge`**, so it cannot be read by accident.
- **The shipped learner predicts worse after one run than after none.** Its pooled rate is the person's own misses over their own tries, with nothing behind it. After one clean sentence that rate is exactly zero, so every pair is predicted never to be missed, and the next miss costs the most a prediction can. On validation its log loss is 0.146 with no runs and 0.270 after one or two.

That last point changes what a fair comparison is. Any pull on the pooled rate would fix it, with no knowledge of which pairs are hard. So a third comparator is added, and a clause:

- **S0r, the rate alone.** The shipped learner with one change: the person's pooled rate is their misses plus `Kr` tries at the training participants' pooled rate. No unit differs from another before the evidence. `Kr` is chosen on validation from {20, 50, 100, 200, 400} by log loss in bands 0 and 1–2. S1 and S2 use the same pull on the pooled rate, with the same `Kr`.
- **(a2) The view of each pair must earn its place.** In band 1–2 the candidate's log loss or its captured share is better than S0r's. If it is not, and S0r passes (a) and (c) to (f) against S0, then `learner-start-rate@3` (S0r) becomes the default and the per-pair model stays a named variant.

### The shipped learner on the validation participants

7,242 participants (5,414 reach the last band). Mean over participants with a 95% bootstrap interval, by runs seen before the predicted run.

| measure | 0 | 1–2 | 3–5 | 6–9 | 10–14 |
| --- | --- | --- | --- | --- | --- |
| log loss | 0.1460 [0.1417, 0.1503] | 0.2704 [0.2628, 0.2784] | 0.1885 [0.1846, 0.1926] | 0.1617 [0.1591, 0.1647] | 0.1550 [0.1506, 0.1596] |
| pace error | 0.3303 [0.3281, 0.3323] | 0.3276 [0.3260, 0.3293] | 0.3243 [0.3227, 0.3258] | 0.3194 [0.3180, 0.3209] | 0.3125 [0.3105, 0.3145] |
| captured share | 0.0% | 16.3% [16.0, 16.6] | 16.1% [15.8, 16.4] | 12.6% [12.3, 12.8] | 8.3% [8.1, 8.7] |
| named in the top four | none named | 4.0% [1.8, 6.6] | 5.2% [4.5, 6.0] | 4.3% [3.8, 4.7] | 2.7% [2.3, 3.1] |
| calibration error | 0.0019 | 0.0291 | 0.0150 | 0.0102 | 0.0074 |

With no runs the shipped learner leans on nothing, so its captured share is zero there. Captured share falls in the later bands because fewer runs are left to count time lost in, so the best four in hindsight are set by fewer tries. That affects every version alike, and the rule reads paired differences.

## Results

In progress. The test participants have not been read.

### Validation: the rate alone (S0r)

`fitLearner` takes a starting view (`StartingView` in `src/learner.ts`); a version without one computes exactly what it did. The training participants' pooled first-try miss rate is 3.40% for a pair (16,553,241 tries) and 3.86% for a key at the start of a word (5,326,707 tries).

Log loss on the 7,242 validation participants, by runs seen, with the pooled calibration error in band 1–2:

| version | 0 | 1–2 | 3–5 | 6–9 | 10–14 | calibration, 1–2 |
| --- | --- | --- | --- | --- | --- | --- |
| S0 | 0.14596 | 0.27042 | 0.18847 | 0.16174 | 0.15498 | 0.0291 |
| S0r, `Kr` = 20 | 0.14595 | 0.14617 | 0.15242 | 0.15197 | 0.15136 | 0.0145 |
| S0r, `Kr` = 50 | 0.14595 | 0.14264 | 0.14998 | 0.15064 | 0.15057 | 0.0073 |
| S0r, `Kr` = 100 | 0.14595 | 0.14171 | 0.14909 | 0.14995 | 0.15009 | 0.0024 |
| **S0r, `Kr` = 200** | 0.14595 | **0.14161** | 0.14902 | 0.14981 | 0.14998 | 0.0020 |
| S0r, `Kr` = 400 | 0.14595 | 0.14182 | 0.14945 | 0.15021 | 0.15035 | 0.0038 |

**`Kr` = 200**, the lowest log loss in band 1–2 (band 0 is the same for all). Against S0 it is lower by 0.129 [0.123, 0.135] in band 1–2 and lower in every later band. Captured share and pace error do not move, as they should not: the rate alone says nothing about which pair is hard. So nearly half of the shipped learner's log loss after one or two runs was the zero pooled rate, and the per-pair models are now judged against 0.1416, not 0.2704.

### The per-pair models

Not fitted.
