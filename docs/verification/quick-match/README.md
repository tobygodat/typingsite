# Quick match model

`QuickMatch.tla` models quick match the way `supabase/migrations/20261110120000_quick_match.sql` runs it (see [ADR 0014](../../adr/0014-quick-match-and-race-rating.md)). Each tab sends one request at a time, and the service handles each one atomically. Pairing, Stop, polling, the countdown, finishing with a run that passes or fails the trace check, the clock and its grace running out, Leave before and after finishing, closing the page, a late finish, and a stranger's request are all actions. A quick match request settles every due race before it reads anything. A race request settles its own room.

Invariants, checked in every reachable state:

- The queue. Nobody is in two matches, paired with themselves, queued while seated, racing alone, or entered into a race after pressing Stop.
- Settling. An unrated race had no run that passed. A run that passed beats a seat without one, unless the passing seat forfeited first. A forfeit is a loss for a seat that hadn't finished. A finished race has a result, and a race that started is never left without one. Right after any quick match request, no due race is unsettled.
- `ResultsStay`, an action property. Once a race has a result, no later step changes it, its winner or the runs it was decided on.

`Liveness.cfg` also checks `EveryStartedRaceSettles`. Every race that starts is settled, given that the clock runs out and someone eventually makes a request (weak fairness on the clock and on a stranger's request). Without that second assumption the property fails, as it should, since a race nobody ever asks about stays unsettled in storage while nobody reads a rating either.

## Run it

TLC 2.19 (`tla2tools.jar` 1.7.4) and Java 17 or newer, from this folder:

```sh
java -XX:+UseParallelGC -Xmx8g -cp tla2tools.jar tlc2.TLC -config QuickMatch.cfg -workers 8 QuickMatch.tla
java -XX:+UseParallelGC -cp tla2tools.jar tlc2.TLC -config Liveness.cfg -workers 4 QuickMatch.tla
```

On 11 November 2026 on tobygdesktop:

- `QuickMatch.cfg` (three players, two rooms, two presses each, two requests in flight per tab): 335,838,002 states generated, 69,942,412 distinct, search depth 59, no violation, in 5 minutes 31 seconds on 8 workers.
- `Liveness.cfg` (two players, one room): 145,733 states generated, 42,889 distinct, no violation, in about a second.

Four edits to the model each produce the violation they should: rating a race only when both runs pass (`UnratedOnlyWithoutAPass`), a queue request that doesn't settle first (`QuickRequestSettlesAll`), dropping the stranger's fairness (`EveryStartedRaceSettles`), and asserting that no walkover happens (it does, so the model reaches the case).
