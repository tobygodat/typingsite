# 0013. Quick match, a race rating, and a trace check before rating

Status: Accepted, 2026-11-10 (TOB-421).

## Context

A race needed a friend who was online and an invitation, so someone with no friends on Stilltype had nobody to race and nothing to climb. `PRODUCT.md` deferred public matchmaking and ranking until integrity work came first, and keeps three separate scores: skill progress, quote difficulty and a race rating.

## Decision

**Pairing.** A signed-in player presses Quick match and asks the service about once a second (`public.quick_match`, `queue`). The request pairs the asker with the waiting player whose rating is closest, within a gap of 100 points plus 10 for every second the longer of the two has waited. Two players at the same rating pair at once. Two players 400 apart pair after 30 seconds. Every queue request holds one transaction lock, so two requests never pair at once. `race_private.match_queue` holds one row per account (its primary key). Nobody is paired with themselves, paired twice, or queued while seated in a live quick match. A player not heard from for 10 seconds leaves the queue.

**The room.** A pair becomes an ordinary two-player room (`rooms.quick`), counting down at once, so the shared countdown, live progress, results, review, rematch and tally all work as they already do. The standard setup is fixed: a 30-second timed race on the 200 most common English words, with no punctuation or numbers, under stop on error. The service draws the passage itself, so neither racer picks the text. A seat counts as there once its browser asks the race about the room. A room whose other seat never came is called off at the start, so nobody races someone who isn't there. Leaving the queue calls off a room the seat never came to. That covers a "paired" reply that lands after Stop. The browser ignores such a reply, and its Stop request reaches the service after it (`queueStep` in `src/quick-match.js`).

**Nobody waiting.** After 20 seconds the control says nobody else is looking. It offers to keep waiting or to race your own fastest recorded run on the standard setup with the ghost caret, labelled as your own recording. Only the device's own recording is used. Other people's recordings stay on their devices ([ADR 0006](0006-recordings-stay-on-the-device.md)).

**Rating.** We use Elo, because one number per account that a reader can check by hand fits a site this size. Glicko's rating deviation is more than it needs. Everyone starts at 1500. K is 40 for an account's first 10 rated races, so a new rating finds its level fast, and 20 after that. The rating is called provisional below 10 rated races and is always shown with its count. A win scores 1, a tie 0.5 and a loss 0. The change is K × (score − expected), rounded half away from zero, so two racers at the same K move by equal and opposite amounts. Only a finished quick match moves the rating. Practice, the daily, ghost races, invited races and rematches never do. The rating touches no best, trend, training evidence or quote difficulty.

**Who decides.** The service decides the result from the two keystroke traces, as ghost races and the tally already do. It writes each seat's row in `race_private.rated_results` once per room. Calling it again for that room changes nothing.

**Trace check.** Each racer's first finished trace gets a verdict (`race_private.trace_check`, mirrored by `traceCheck`). A match is rated only when both verdicts are `ok`. Otherwise both rows are unrated with a reason, and the race result still shows. The limits, in both places and kept equal by `tests/quick-match.test.js`:

| Verdict | Rule | Why |
| --- | --- | --- |
| `no-trace` | A finish with no trace. | Without the keys, nothing can be checked. A reload mid-race sends none. |
| `unreadable` | Not the v1 format, over 6000 keys, keys outside printable ASCII and backspace, or an end over 10 minutes. | These are the ghost challenge limits. |
| `times` | Not one whole, non-negative time per key, steps over 999999 ms, an end before the last key, or an end off the 30-second clock. | Missing, negative or reordered times can't be a run on the race clock. |
| `intervals` | 20 keys in a row each under 20 ms after the one before, or over 100 keys a second over the run. | 20 ms is 600 wpm. Key rollover gives short pairs and triples. Twenty in a row is four words at 600 wpm, which is what a paste or a script gives. 100 keys a second is the race service's existing limit. |
| `wrong-text` | The trace doesn't replay to the correct characters the service settled. | The keys are for some other text. |
| `speed` | Over 350 wpm. | A judgment, not a measurement: it is set well above the speeds the fastest typists post on short common-word tests, so an honest run doesn't reach it. |

This is a floor, not anti-cheat. A trace is browser data, and a careful script can pass every rule here.

**Forfeit and disconnect.** Leaving a quick match after its start (Leave race while it is racing) is a forfeit. It is rated as a loss for the leaver and a win for the other racer, whatever their traces. Leaving during the countdown calls the race off, unrated. A disconnect is a seat that stops sending without leaving. It is told apart by that missing leave. Its seat is held through the grace period as in any race, and it can come back and finish. A seat that never finishes is finalized from its last progress, and the match is unrated (`unfinished`), because a dropped connection is not a choice.

**What a stranger sees.** The other racer's race name (1 to 40 characters, as every race uses), the race itself, and the results. Never an email, an account id, a friend list or history. A name filled in from the account's email is sent as "Racer". The first press on a device says what the other racer sees. Quick match is opt-in by pressing it. After the race, either racer can add the other through the existing friends list, which never reveals an email or id.

## Consequences

- Every new table cascades from `auth.users` ([ADR 0008](0008-account-deletion-cascades.md)). A rated result keeps no id of the other racer, so it goes with its own account only.
- A racer can void a match they are losing by closing the tab, since a disconnect is unrated. Abandonment penalties are deferred until there is data on how often it happens.
- Changing a limit, K, the gap or the standard setup means a new migration and the same change in `src/quick-match.js`. The unit test fails until both agree.
- Deferred: the daily leaderboard (the next TOB-421 pull request), seasons, abandonment penalties, full anti-cheat, rating decay, and a count of players online.
