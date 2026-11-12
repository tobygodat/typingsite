# A per-run floor for "fixed" (TOB-448)

Train calls a drilled target fixed when the learner no longer queues it and at least two runs since its retest hold
its evidence: 20 observations between them, with no miss, or a mean slowdown of 20 ms or less (`isFixed`). One run of
those two can hold a single try, so "fixed" can rest on one long retest and one try. This measures whether a floor on
each counted run would cut false reads without much delay for real ones. It changed nothing: the rule stands.

## Method

`node scripts/measure-fixed-floor.mjs --seeds 40 --workers 10 --json docs/verification/2026-11-12-fixed-floor.json`

ADR 0019's season world: the app's passages typed by simulated typists, scored by the app's code and fitted by the
shipped learner on the newest 120 runs. Each typist drills every planted unit the learner queues after run 19 (a weak
pair in each frequency stratum and a slow pair); run 20 is the retest. After each of the next 80 runs, Train's state is
read under the rule as written and with a floor of 3, 5 or 10 observations on each counted run. Run lengths of 10, 25
and 100 words, three skills, two typists, 40 seeds: 1,359 drilled targets in each world. The worlds: the drill fixes
the unit (fixed), does nothing (unchanged), or lifts only the retest (warm). The script checks the floor of 1 against
`isFixed` on every read.

## Share reading "fixed" within 10 / 20 / 40 / 80 runs of the retest

| world | rule | 10 | 20 | 40 | 80 |
| --- | --- | --- | --- | --- | --- |
| fixed | as written | 1.8% | 10.6% | 23.5% | 30.5% |
| fixed | floor 3 | 1.8% | 9.6% | 19.3% | 24.6% |
| fixed | floor 5 | 1.3% | 4.6% | 8.8% | 11.8% |
| fixed | floor 10 | 0.3% | 0.4% | 1.2% | 1.8% |
| unchanged | as written | 0.1% | 0.5% | 1.3% | 1.6% |
| unchanged | floor 3 | 0.1% | 0.5% | 0.7% | 1.2% |
| unchanged | floor 5 | 0.1% | 0.2% | 0.2% | 0.4% |
| unchanged | floor 10 | 0% | 0% | 0% | 0% |
| warm | as written | 0.1% | 0.7% | 1.4% | 1.8% |
| warm | floor 3 | 0.1% | 0.6% | 0.9% | 1.3% |
| warm | floor 5 | 0.1% | 0.2% | 0.2% | 0.4% |

Within 2 runs no world reads "fixed" under any rule. Within 5, the unchanged and warm worlds still read none, and only
where the drill worked do a few: 0.44% of targets under the rule as written or a floor of 3 or 5 (1.88% of common pairs
at 100 words), 0.07% with a floor of 10. The learner keeps a drilled target queued for longer than most of that, so on
these numbers it is the queue, more than the run count, that holds back a read on one long retest. Split by run length
and stratum, in the JSON.

## Reading

Weighing the two worlds equally, every floor costs more real reads than the false ones it removes. A floor of 3
removes 0.4 points of false reads after 80 runs and 5.9 points of real ones; a floor of 5 removes 1.2 and 18.7. The rule as written is about 19 real reads to
one false; a floor of 3 is about 20 to one, at a fifth fewer real reads. So the floor isn't adopted.

What the conclusion assumes and leaves out:

- It weighs a drill that works and a drill that does nothing as equally likely, setting the share of real reads lost
  against the share of false reads removed. If drills mostly do nothing, a false "fixed" is the commoner error and a floor
  is worth more than these numbers make it look; if they mostly work, it is worth less. Nobody has measured which.
- The world is simulated: typists improve only because the world says so. A drill fixes a unit completely and at once,
  or not at all; the half-working and wearing-off drills of ADR 0019's season aren't run here.
- The warm world's lift (the retest alone typed as if fixed) is an assumption, not a measurement of anyone's typing.
- Practice runs one length a season (10, 25 or 100 words), five runs a day, with no bad days, no mixed lengths and no
  breaks; keyboards, layouts and the speed or accuracy focus other than balanced aren't varied.
- Only targets the shipped learner queued before the drill are drilled: a target typed in by hand, or one chosen from
  the steps ahead that the learner ranks low, isn't, and that is where a thin "fixed" would most often show.
