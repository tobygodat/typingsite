# Quick match model

`QuickMatch.tla` models quick match the way `supabase/migrations/20261110120000_quick_match.sql` runs it (see [ADR 0014](../../adr/0014-quick-match-and-race-rating.md)). Each tab sends one request at a time, and the service handles each one atomically. Pairing, Stop, polling, the countdown, progress that carries no keystroke record and may land after the race clock, finishing with a run that passes or fails the trace check, the clock and then its grace running out, Leave before and after finishing (a forfeit while the other racer is still in), closing the page, a late finish, and a stranger's request are all actions. A quick match request settles every due race before it reads anything. A race request settles its own room. Each seat's result is a row written once, a forfeit's when it leaves. `Cap` stands for the pair's three rated results a day, set to one so a pair's second room reaches it.

Invariants, checked in every reachable state:

- The queue. Nobody is in two matches, paired with themselves, queued while seated (a racer who left a race still on stays seated in it), racing alone, or entered into a race after pressing Stop.
- The verdict. A seat's verdict is the verdict of its own finish: progress, however late, never decides it (`VerdictIsItsFinish`).
- Settling. A win needs the seat's own checked run. A run that passed beats a seat with none, whatever that seat did. A race no checked run decided has no winner. A forfeit is a loss for a seat that hadn't finished, rated unless the pair is past its cap. One seat rated and the other not is a forfeit's loss alone. A decided result goes unrated only past the cap, and no pair moves ratings in more rooms than the cap. A finished race has both rows, and nothing that started is called off. Right after any quick match request, no due race is unsettled.
- `ResultsStay`, an action property. Once a seat's row is written, no later step changes it, whether it was rated, or the run it was decided on.

`Liveness.cfg` also checks `EveryStartedRaceSettles`. Every race that starts is settled, given that the clock runs out and someone eventually makes a request (weak fairness on the clock, its grace and a stranger's request). Without that second assumption the property fails, as it should, since a race nobody ever asks about stays unsettled in storage while nobody reads a rating either.

## What it leaves out

The model checks who is paired, who wins and which rows are written. It leaves these out, and each is proven elsewhere:

- The 24 hours of the pair cap. `Cap` counts a pair's rated rooms with no clock, so the window never rolls. `supabase/tests/quick-match.sql` plays a fourth race in a day, unrated for both, then rolls the 24 hours on and rates the next one. `tests/quick-match.test.js` plays the same through the fake.
- The Elo numbers. The model records whether a row is rated and who won, not by how much. `tests/quick-match.test.js` pins the arithmetic (20 each way at K 40, a tie moving nothing, K 20 after ten rated races) and its generated-interleavings test replays every rated row against Elo in the order written. `supabase/tests/quick-match.sql` checks the same numbers against the real SQL, both seats summing to zero over the settlement table, and the one-sided case (−13, then −12 and +25).
- The trace rules. A finish in the model passes or fails the check, nothing more. The trace check table (honest, pasted, superhuman, wrong text, empty, missing times, off the clock, unreadable) runs against `race_private.trace_check` in `supabase/tests/quick-match.sql` and against `traceCheck` in `tests/quick-match.test.js`, and a unit test keeps the two sets of limits equal.
- The refusal of a finish before the clock. The model lets a seat finish at any point in the race. The service refuses an unfinished passage that claims to finish before the clock (`supabase/tests/online-races.sql`, `supabase/tests/race-options.sql`), and a passage typed to its end before the clock fails the trace check as `times` (the off-the-clock row of the table above).

## Run it

TLC 2.19 (`tla2tools.jar` 1.7.4) and Java 17 or newer, from this folder:

```sh
java -XX:+UseParallelGC -Xmx12g -cp tla2tools.jar tlc2.TLC -config QuickMatch.cfg -workers 16 -metadir ~/.cache/quick-match-tlc QuickMatch.tla
java -XX:+UseParallelGC -cp tla2tools.jar tlc2.TLC -config Liveness.cfg -workers 4 QuickMatch.tla
```

The safety run keeps over 10 GB of state on disk, so give it a `-metadir` on a real disk, not a tmpfs `/tmp`.

On 11 November 2026 on tobygdesktop:

- `QuickMatch.cfg` (three players, two rooms, two presses each, two requests in flight per tab, a cap of one rated room per pair): 2,271,652,418 states generated, 459,464,137 distinct, search depth 66, no violation, in 21 minutes 8 seconds on 16 workers.
- `Liveness.cfg` (two players, one room): 429,027 states generated, 120,931 distinct, search depth 40, no violation, in 3 seconds.

Three edits to the model, each putting back a rule this model replaced, produce the violation they should, on a two-player, two-room config: progress after the clock deciding a seat's verdict, as `YouFinish` once hid by being one step (`VerdictIsItsFinish`); a forfeit handing the other seat the win whatever its run (`WinNeedsOwnPass`); and no cap on a pair's rated rooms (`PairWithinCap`).
