# 0031. Calling a pair or key "slipping" on Progress from day-level variation

Status: Accepted, 2026-11-26. TOB-511. Passed every pre-registered clause on held-out test seeds `601..630`.

Written and accepted as ADR 0028; renumbered 0031 because [ADR 0028](0028-bun-runs-the-build.md) landed on master first and 0029–0030 were taken. Nothing in the rule or verdict changed.

## Context

Progress's weekly overview (`src/week-change.ts`) currently lists only units fixed since the week began. An earlier attempt during TOB-420 (commit `7b078cfd`) also called a unit "slipping" using Fisher's noncentral hypergeometric upper tail on tries pooled across the week, adjusted against the rest of the week's pooled odds ratio (`weekOdds`). Six independent checks found that pooling tries over a week could not separate a real slip from noise, so slipping was removed before TOB-420 landed (`6685025`).

Why pooling tries over a week fails:

1. **Try-level independence fails under day-to-day and run-to-run variation.** Fisher's exact test treats every first try in the week as an independent Bernoulli draw. Under realistic day-level overdispersion (fatigue, cold hands, posture or focus shifts across days), the true variance of a week's excess misses grows quadratically with tries per day (`n²`), whereas binomial variance grows only linearly (`n`). At heavy volume (30,000 words/week), pooled Fisher false-slip rates climb well above 2% (on validation seeds `9101, 9102` below: 7.33% on `heavy-30k`, 4.00% on careless typists, and up to 22.9% under stronger day-level wobble).
2. **Single-day spikes look like week-long slips.** One bad day or sitting on a single pair adds a burst of errors to the pooled weekly count. A pooled-try test cannot tell 15 misses concentrated on one Tuesday from 3 misses across five separate days.
3. **Global pooled odds ratio does not cancel uneven bad days.** When bad days carry variable run counts (bursty days) or when a unit's baseline error rate differs from the global mean, a single week-wide pooled odds ratio does not cancel day-level shifts within each day.

This ADR specifies a day-level variation rule and its decision ceilings before any held-out test seed runs. No threshold or model term is changed after test seeds run.

## The candidate rule: day-level variation with empirical-Bayes dispersion and leave-one-day-out

Pure function of dated `LearnerEvidence[]` on one keyboard, `began` (local midnight starting the 7-day week), and the learner's current queue `queuedNow`. Pace is never called slipping (no within-run spread is recorded).

### 1. Day grouping and readability (`family`)

Dated evidence records (`record.at !== null`) are grouped by `(side, localDay)` where `side` is `'before'` (`record.at < began`) or `'after'` (`record.at >= began`), and `localDay = dayKey(new Date(record.at))`.

A unit `u` (pair of length 2 or key of length 1) is **readable** iff:

- `beforeTries >= FIXED_OBSERVATIONS` (20) across `beforeDays >= minDays` (2) distinct local days before `began`, and
- `afterTries >= FIXED_OBSERVATIONS` (20) across `afterDays >= minDays` (2) distinct local days from `began` on.

`family` is the count of readable units. Because readability inspects only try counts and day counts—never error counts—`family` is independent of how misses fall, preserving Bonferroni validity (`threshold = alpha / family`).

### 2. Within-day background log-odds shift (cancelling uneven bad days)

For each unit `u`, let the reference set on every day `d` be all pairs (`length === 2`) other than `u` (for a key `u`, all pairs on day `d`). Let `b0` be the reference set's pooled miss rate across all dated days (clamped to `[0.002, 0.99]`). On each day `d` where `u` was seen, the reference set's shrunk day rate is:

`b_d = clamp((restErrors_d + 20 * b0) / (restTries_d + 20), 0.002, 0.99)`

and day `d`'s log-odds shift is `delta_d = logit(b_d) - logit(b0)`.

A good week does not make a slip easier to call: let `meanBefore` and `meanAfter` be the try-weighted means of `delta_d` on `'before'` and `'after'` days. If `meanAfter < meanBefore`, add `meanBefore - meanAfter` to every `'after'` day's `delta_d`.

### 3. Profile-MLE day residuals

Under the null hypothesis that unit `u` kept a constant baseline log-odds `theta_u` across all days (shifted only by each day's `delta_d`), solve the monotone 1D equation:

`sum_d n_{d,u} * sigmoid(theta_u + delta_d) = beforeErrors_u + afterErrors_u`

for `theta_u` in `[-12, 12]`. Each day `d` then yields:

- expected misses `mu_d = n_{d,u} * p_d`, where `p_d = sigmoid(theta_u + delta_d)`,
- day excess `x_d = e_{d,u} - mu_d` (unbiased regardless of `n_{d,u}` or `delta_d`), and
- binomial information `v_d = n_{d,u} * p_d * (1 - p_d)`.

Total week excess is `S = sum_{d in After} x_d`.

### 4. Empirical-Bayes day-level overdispersion (estimated from pre-week days)

- **Keyboard-wide prior `tau^2`:** Across all readable pairs (`length === 2`) with `beforeDays >= 3`, fit each pair's pre-week `theta` on its `'before'` days only and compute the method-of-moments day-level overdispersion:
  `tau^2 = max(0, sum((d_B / (d_B - 1)) * x_d^2 - v_d) / sum(v_d^2))`.
  Estimating `tau^2` strictly from `'before'` days prevents multiple co-slipping pairs in `'after'` from inflating `tau^2`.
- **Per-unit moderated dispersion `tau_mod^2`:** For each candidate unit `u` with `df_u = max(0, beforeDays - 1) >= 1`, compute its own pre-week dispersion `tau_u^2` from its `'before'` days and moderate it toward `tau^2` with prior degrees of freedom `priorDf`:
  `tau_mod^2 = max(tau^2, (priorDf * tau^2 + df_u * tau_u^2) / (priorDf + df_u))`.
- **Day-level variance of `S`:** With `V_A = sum_{After} v_d`, `V_B = sum_{Before} v_d`, `w_A = V_B / (V_A + V_B)`, `w_B = V_A / (V_A + V_B)`:
  `V_mod = max((V_A * V_B) / (V_A + V_B), w_A^2 * sum_{After} (v_d + tau_mod^2 * v_d^2) + w_B^2 * sum_{Before} (v_d + tau_mod^2 * v_d^2))`.

### 5. Decision criteria for calling unit `u` "slipping"

Unit `u` is called slipping iff ALL of the following hold:

1. `u` is queued now by the learner (`queuedNow.has(u)`) and readable.
2. Raw miss rate rose: `afterErrors / afterTries > beforeErrors / beforeTries`.
3. Positive adjusted week excess `S > 0` on at least 2 distinct `'after'` days (`count(x_d > 0 in After) >= 2`).
4. Moderated Student-t upper tail passes Bonferroni: `P(T_{priorDf + df_u} >= S / sqrt(V_mod)) < alpha / family`.
5. **Leave-one-day-out (LODO) multi-day guard:** Drop the single `'after'` day with the largest `x_d`, refit `theta` on the remaining `'before'` + `'after'` days, and recompute `S_L` and `V_mod_L` (using the same `tau_mod^2`). Require `S_L > 0` and `S_L / sqrt(V_mod_L) >= lodoZ`.

## Constants chosen on validation seeds only (`9101, 9102`)

`scripts/evaluate-slipping.mjs --validation-only` ran 396 cells (2 seeds × 6 volumes × 3 skills × 11 regimes × 5 weeks/cell = 900 null weeks and 1,080 alternative weeks).

Validation summary (`9101, 9102`):

- `pooled-7b07` baseline: **1.44% [0.85, 2.46] (13/900)** overall null FP, failing badly on `heavy-30k` (**7.33%, 11/150**), careless typists (**4.00%, 12/300**), and `null-single-day-hiccup` (**3.33%, 6/180**).
- All four day-level candidates (`alpha in {0.01, 0.02}`, `priorDf = 16`, `lodoZ in {1.5, 1.8, 2.0}`) achieved **0.00% [0.00, 0.43] (0/900)** null false-slip weeks across every volume, skill, and null regime.
- At `alpha = 0.02, priorDf = 16, lodoZ = 1.8, minDays = 2`: readable planted detection was **40.0%** (`alt-1pair-strong`), **32.0%** (`alt-1pair-moderate`), **35.2%** (`alt-coslip-2`), **36.1%** (`alt-coslip-4`), **18.6%** (`alt-4day-slip`), and **42.6%** (`alt-key-slip`), while `lodoZ = 2.0` trimmed `alt-4day-slip` slightly (17.5%) and `alpha = 0.01` lowered every alternative by 3–5 points without improving null FP.

Selected constants (frozen before any test seed runs):

- `alpha = 0.02`
- `priorDf = 16`
- `lodoZ = 1.8`
- `minDays = 2`

## Pre-registered evaluation protocol (`scripts/evaluate-slipping.mjs --test`)

### Held-out test seeds

Thirty fresh seeds never used in design or validation: **`601..630`**, 2 weeks per `(seed, volume, skill, regime)` cell:

- 6 volumes: `light-10` (1/day, 10w), `light-25` (1/day, 25w, 15% skip), `medium` (4/day, 25w, 10% skip), `heavy-15x100` (15/day, 100w), `heavy-30k` (10/day, 430w ≈ 30,100 words/week), `bursty-week` (3/day before → 9/day this week, 40w, 20% skip). Every simulated history passes through `retainRuns` (120-run pattern cap) as in production.
- 3 skill tiers (`evaluate-learner.mjs` `SKILLS`): `careful` (1%), `average` (3%), `learning`/careless (7%).
- 5 null regimes (**1,080 weeks per regime; 5,400 null weeks total; 900 null weeks per volume; 1,800 null weeks per skill**):
  1. `null-stationary` (no bad days, no overdispersion)
  2. `null-uneven-bad-days` (25% bad days, `+1.0` log-odds × `[0.7, 1.3]`, bursty 2.2× run multiplier)
  3. `null-overdispersed` (uneven bad days + `daySigma = 0.40`, `runSigma = 0.30`)
  4. `null-single-day-hiccup` (uneven bad days + `daySigma = 0.25`, `runSigma = 0.20` + 1 random day this week where a common pair spikes `+2.2` log-odds)
  5. `null-global-bad-week` (uneven bad days + `daySigma = 0.25`, `runSigma = 0.20` + `+0.8` log-odds across every pair all week)
- 6 alternative regimes (**1,080 weeks per regime; 6,480 alternative weeks total**), all on top of uneven bad days (`badDayChance = 0.25`, `badDayShift = 0.9`, `badDayBurst = 1.8`) and overdispersion (`daySigma = 0.25`, `runSigma = 0.20`):
  1. `alt-1pair-strong` (1 pair, `+2.0` log-odds, 7 days)
  2. `alt-1pair-moderate` (1 pair, `+1.5` log-odds, 7 days)
  3. `alt-coslip-2` (2 pairs together, `+1.9` log-odds, 7 days)
  4. `alt-coslip-4` (4 pairs together, `+1.9` log-odds, 7 days)
  5. `alt-4day-slip` (1 pair, `+2.0` log-odds, last 4 days only)
  6. `alt-key-slip` (1 common key, `+1.5` log-odds across all pairs ending in it, 7 days)

### Decision ceilings

The candidate (`day-level-0031`) passes and is implemented as an exported pure function in `src/week-change.ts` iff ALL of these hold on the single held-out test run (`seeds 601..630`):

- **(a) Overall null ceiling:** Pooled over all 5,400 null weeks, the upper end of the 95% Wilson interval for false-slip weeks is **≤ 1.0%**.
- **(b) Every null slice ceiling:** Across EVERY null regime (`n = 1,080`), EVERY volume (`n = 900`), and EVERY skill tier (`n = 1,800`), the point estimate of false-slip weeks is **≤ 1.5%** and the upper end of the 95% Wilson interval is **≤ 2.0%**.
- **(c) Multi-day slip detection:** Among readable planted units on test seeds `601..630`:
  - `alt-1pair-strong`: ≥ **30%** overall and ≥ **50%** on `heavy-30k`;
  - `alt-coslip-2` and `alt-coslip-4`: ≥ **25%** each;
  - `alt-key-slip`: ≥ **30%**;
  - `alt-4day-slip`: ≥ **10%**.
- **(d) Alternative-week specificity:** In every alternative regime, the share of weeks flagging any unaffected (non-planted) unit has 95% Wilson upper bound **≤ 2.5%**.

If any clause fails, `src/week-change.ts` remains slipping-free and the failure is recorded below without moving thresholds.

## Results

The rule above was committed (`dccca014db77d6d30bb4eceb336aaf5199056035`, "Write ADR 0028 slipping decision rule before running test seeds (TOB-511)") before any held-out test seed ran. Held-out test seeds `601..630` ran once (`node --import tsx scripts/evaluate-slipping.mjs --test --json docs/adr/0031-evaluation.json --workers 12`, 5,940 cells, 11,880 simulated weeks: 5,400 null weeks and 6,480 alternative weeks, 84.3 s), and the full record is saved in [`0028-evaluation.json`](0028-evaluation.json).

**`day-level-0031` passes every pre-registered clause.**

### Overall null false-slip rate (5,400 null weeks, 95% Wilson intervals)

| Detector | False-slip weeks | 95% Wilson interval |
| --- | --- | --- |
| `pooled-7b07` (prior pooled Fisher) | 2.59% (140 / 5,400) | [2.20%, 3.05%] |
| **`day-level-0031`** | **0.02% (1 / 5,400)** | **[0.00%, 0.10%]** |

### Null false-slip rate by regime, volume, and skill

| Slice | `n` | `pooled-7b07` | `day-level-0031` | `day-level-0031` 95% Wilson |
| --- | --- | --- | --- | --- |
| `null-stationary` | 1,080 | 0.09% (1) | 0.00% (0) | [0.00%, 0.35%] |
| `null-uneven-bad-days` | 1,080 | 0.19% (2) | 0.00% (0) | [0.00%, 0.35%] |
| `null-overdispersed` | 1,080 | 5.65% (61) | 0.09% (1) | [0.02%, 0.52%] |
| `null-single-day-hiccup` | 1,080 | 4.63% (50) | 0.00% (0) | [0.00%, 0.35%] |
| `null-global-bad-week` | 1,080 | 2.41% (26) | 0.00% (0) | [0.00%, 0.35%] |
| `light-10` | 900 | 0.11% (1) | 0.00% (0) | [0.00%, 0.43%] |
| `light-25` | 900 | 0.00% (0) | 0.00% (0) | [0.00%, 0.43%] |
| `medium` | 900 | 0.22% (2) | 0.11% (1) | [0.02%, 0.63%] |
| `heavy-15x100` | 900 | 0.22% (2) | 0.00% (0) | [0.00%, 0.43%] |
| `heavy-30k` (30,000 words/week) | 900 | **14.78% (133)** | **0.00% (0)** | **[0.00%, 0.43%]** |
| `bursty-week` | 900 | 0.22% (2) | 0.00% (0) | [0.00%, 0.43%] |
| `careful` (1%) | 1,800 | 1.11% (20) | 0.00% (0) | [0.00%, 0.21%] |
| `average` (3%) | 1,800 | 2.50% (45) | 0.00% (0) | [0.00%, 0.21%] |
| `learning` / careless (7%) | 1,800 | 4.17% (75) | 0.06% (1) | [0.01%, 0.31%] |

### Alternative regimes: detection of real multi-day slips (1,080 weeks per regime)

| Regime | `day-level-0031` readable planted | `day-level-0031` on `heavy-30k` | `day-level-0031` all planted | `day-level-0031` extra-false weeks [95% Wilson] | `pooled-7b07` extra-false weeks |
| --- | --- | --- | --- | --- | --- |
| `alt-1pair-strong` | **44.22% (260/588)** | **94.4% (170/180)** | 24.07% (260/1,080) | 0.74% (8/1,080) [0.38%, 1.45%] | 3.24% (35/1,080) |
| `alt-1pair-moderate` | 26.76% (160/598) | — | 14.81% (160/1,080) | 0.09% (1/1,080) [0.02%, 0.52%] | 2.59% (28/1,080) |
| `alt-coslip-2` | **38.31% (431/1,125)** | **90.3% (325/360)** | 19.95% (431/2,160) | 0.46% (5/1,080) [0.20%, 1.08%] | 3.89% (42/1,080) |
| `alt-coslip-4` | **37.69% (822/2,181)** | **85.7% (617/720)** | 19.03% (822/4,320) | 1.02% (11/1,080) [0.57%, 1.81%] | 3.24% (35/1,080) |
| `alt-4day-slip` | **20.49% (125/610)** | **61.7% (111/180)** | 11.57% (125/1,080) | 0.09% (1/1,080) [0.02%, 0.52%] | 1.76% (19/1,080) |
| `alt-key-slip` | **43.08% (383/889)** | **97.8% (176/180)** | 35.46% (383/1,080) | 0.00% (0/1,080) [0.00%, 0.35%] | 0.37% (4/1,080) |

### Clause-by-clause verdict

- **(a) Overall null Wilson upper ≤ 1.0%:** **PASS** — `0.02% [0.00%, 0.10%]` (`1 / 5,400`).
- **(b) Every null regime, volume, and skill slice ≤ 1.5% point and ≤ 2.0% Wilson upper:** **PASS** — highest slice is `medium` at `0.11% [0.02%, 0.63%]` (`1 / 900`); `heavy-30k` is `0.00% [0.00%, 0.43%]` (`0 / 900`), versus `14.78%` for `pooled-7b07`.
- **(c) Readable planted detection:** **PASS** — `alt-1pair-strong` 44.22% overall (≥ 30%) and 94.4% on `heavy-30k` (≥ 50%), `alt-coslip-2` 38.31% (≥ 25%), `alt-coslip-4` 37.69% (≥ 25%), `alt-key-slip` 43.08% (≥ 30%), `alt-4day-slip` 20.49% (≥ 10%).
- **(d) Alternative-week specificity (unaffected units ≤ 2.5% Wilson upper):** **PASS** — highest is `alt-coslip-4` at `1.02% [0.57%, 1.81%]` (`11 / 1,080`).

## Consequences

- `detectSlips`, `weekSlips`, and `SLIP_RULE` are implemented as pure exported functions in `src/week-change.ts` and unit-tested in `tests/week-change.test.js`, including parity with `scripts/evaluate-slipping.mjs`.
- Per `DESIGN.md` ("Show Toby a mockup or a screenshot of any change a user sees before it ships"), Progress's rendered DOM list (`weekChange` / `weekMovers`) is left unchanged in this change; `weekSlips` is ready for UI hookup once the visible presentation is approved.
- Limitations to keep in mind: on light practice (`light-10`, `light-25`), individual pairs rarely reach `FIXED_OBSERVATIONS` (20 tries) on both sides of the week, so light typists see slips primarily on keys (`alt-key-slip`) rather than rare pairs—which is honest, since thin pair counts cannot separate a real slip from noise.

