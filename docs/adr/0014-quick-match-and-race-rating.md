# 0014. Quick match, a race rating, and a trace check before rating

Status: Accepted, 2026-11-10 (TOB-421).

## Context

A race needed a friend who was online and an invitation, so someone with no friends on Stilltype had nobody to race and nothing to climb. `PRODUCT.md` deferred public matchmaking and ranking until integrity work came first, and keeps three separate scores: skill progress, quote difficulty and a race rating.

## Decision

**Pairing.** A signed-in player presses Quick match and asks the service about once a second (`public.quick_match`, `queue`). The request pairs the asker with the waiting player whose rating is closest, within a gap of 100 points plus 10 for every second the longer of the two has waited. Two players at the same rating pair at once. Two players 400 apart pair after 30 seconds. Every queue request holds one transaction lock, so two requests never pair at once. `race_private.match_queue` holds one row per account (its primary key). Nobody is paired with themselves, paired twice, or queued while seated in a live quick match. A player not heard from for 10 seconds leaves the queue.

**The room.** A pair becomes an ordinary two-player room (`rooms.quick`), counting down at once, so the shared countdown, live progress, results, review, rematch and tally all work as they already do. The standard setup is fixed: a 30-second timed race on the 200 most common English words, with no punctuation or numbers, under stop on error. The service draws the passage itself, so neither racer picks the text. A seat counts as there once its browser asks the race about the room. A room whose other seat never came is called off at the start, so nobody races someone who isn't there. Leaving the queue calls off a room the seat never came to. That covers a "paired" reply that lands after Stop. The browser ignores such a reply, and its Stop request reaches the service after it (`queueStep` in `src/quick-match.js`).

**Nobody waiting.** After 20 seconds the control says nobody else is looking. It offers to keep waiting or to race your own fastest recorded run on the standard setup with the ghost caret, labelled as your own recording. Only the device's own recording is used. Other people's recordings stay on their devices ([ADR 0006](0006-recordings-stay-on-the-device.md)).

**Rating.** We use Elo, because one number per account that a reader can check by hand fits a site this size. Glicko's rating deviation is more than it needs. Everyone starts at 1500. K is 40 for an account's first 10 rated races, so a new rating finds its level fast, and 20 after that. The rating is called provisional below 10 rated races and is always shown with its count. A win scores 1, a tie 0.5 and a loss 0. The change is K × (score − expected), rounded half away from zero, so two racers at the same K move by equal and opposite amounts. Only a finished quick match moves the rating. Practice, the daily, ghost races, invited races and rematches never do. The rating touches no best, trend, training evidence or quote difficulty.

**Who decides.** The service decides the result from the two keystroke traces, as ghost races and the tally already do. It writes each seat's row in `race_private.rated_results` once per room. Calling it again for that room changes nothing.

**Settling a started race.** Once the shared start time has passed, nothing a racer does or fails to do on their own side avoids a loss or voids the other racer's win. A seat counts only with a finished run whose trace passes the check below.

- Both count: the traces decide, more wpm and then more accuracy, rated.
- One counts: it wins and the other loses, rated, whatever the other seat sent, didn't send or did. The winner reads "Rated win: Lin didn’t finish." or "Rated win: Lin’s run couldn’t be checked.", and the other racer reads "Rated loss: your finish didn’t arrive before the race closed." or "Rated loss: your run couldn’t be checked." with what the check found.
- Neither counts: unrated, and each racer reads why, "Not rated: neither racer finished with a run that could be checked." The race result still shows.
- Leave race after the start, before finishing, is a forfeit: a rated loss for the leaver and a rated win for the other, whatever their traces. A seat that has finished has its run in, so its Leave just leaves and the clock settles the race. Leaving during the countdown calls the race off, unrated.

The rule is in one place on each side, `race_private.rate` and the fake's `rate` in `e2e/fake-quick-match.js`. The settlement table in `supabase/tests/quick-match.sql` runs every case against the real SQL, and `tests/quick-match.test.js` plays the same rows through the fake and requires the same result.

**When it settles.** At once when both seats have finished. Otherwise ten seconds after the 30-second race clock ends, 45 seconds after the pairing. Every seat still racing is then finished on its last progress, and a seat with no checked run counts as absent. Ten seconds is the grace every race already gives the last progress (`race_private.advance`). A tab sends progress every 650 ms and retries a failed send at once, so ten seconds covers about fifteen sends and a short dropout. It is also how long the service already waits before it shows a seat as disconnected or drops a queued player. A longer grace keeps the winner waiting on a racer who has gone, and a shorter one turns a slow link's last packet into a loss.

**Which request settles it.** The first of these, each of which settles every due quick match before it reads anything:

- A request about the room from either seat. The staying racer's tab asks every 650 ms while it is open, so the win lands within a second of the grace ending.
- Any quick match request from anyone (`race_private.settle_due`). Every searching tab asks once a second, and opening the Online tab reads the rating, so a racer who closed the page and comes back sees the result first.
- Anyone opening a race room (`race_private.open_room`), before it deletes old rooms.

A race can't stay unsettled where it matters. Every rating anyone reads or is paired on comes from a quick match request or that room's own snapshot, and each runs the settle first. A room is deleted only by `open_room` or by pairing, both after the settle, and a result outlives its room. While nobody makes any request, nobody reads a rating either. The first request settles everything due. Settling is idempotent. The rows are written once under the room's row lock. `settle_due` skips a room another request holds, because that request is settling it or rolls back and leaves it for the next one. A replayed request, a second settle, or a finish that arrives after the race closed finds the rows and changes nothing, and a late finish's reply carries the settled result.

**Trace check.** Each racer's first finished trace gets a verdict (`race_private.trace_check`, mirrored by `traceCheck`). No verdict is taken once the room is settled. The limits, in both places and kept equal by `tests/quick-match.test.js`:

| Verdict | Rule | Why |
| --- | --- | --- |
| `no-trace` | A finish with no trace. | Without the keys, nothing can be checked. A reload mid-race sends none. |
| `unreadable` | Not the v1 format, over 6000 keys, keys outside printable ASCII and backspace, or an end over 10 minutes. | These are the ghost challenge limits. |
| `times` | Not one whole, non-negative time per key, steps over 999999 ms, an end before the last key, or an end off the 30-second clock. | Missing, negative or reordered times can't be a run on the race clock. |
| `intervals` | 20 keys in a row each under 20 ms after the one before, or over 100 keys a second over the run. | 20 ms is 600 wpm. Key rollover gives short pairs and triples. Twenty in a row is four words at 600 wpm, which is what a paste or a script gives. 100 keys a second is the race service's existing limit. |
| `wrong-text` | The trace doesn't replay to the correct characters the service settled. | The keys are for some other text. |
| `speed` | Over 350 wpm. | A judgment, not a measurement: it is set well above the speeds the fastest typists post on short common-word tests, so an honest run doesn't reach it. |

This is a floor, not anti-cheat. A trace is browser data, and a careful script can pass every rule here.

**What it costs an honest racer.** A real disconnect that outlasts the grace, or closing the page, after the start is a rated loss, as in other rated games. A reload after the start resumes the race, but the browser no longer has the keys from before the reload, so it sends no trace and that run counts only when the other doesn't either. A false positive on the check costs that racer the race. For a person each rule is out of reach:

- `no-trace` and `unreadable` describe the browser's record, not the typing. A 30-second run at 350 wpm is under 900 keys against a limit of 6000. The online race already turns an accent key into a stand-in letter and ignores a dead key's composition, so an honest record stays printable ASCII.
- `times` checks the browser's own clock. The race page stops recording at the 30-second mark and writes that end itself.
- `intervals` needs twenty gaps in a row each under 20 ms, which is 600 wpm held for four words. A person at 200 wpm averages 60 ms a key. Rollover gives a short pair or triple, and twenty in a row is what a paste or a script produces. A hundred keys a second over the run is 1200 wpm.
- `wrong-text` replays the keys against the progress the same browser sent. An honest run replays to exactly what it reported.
- `speed` is the one judgment. 350 wpm on 30 seconds of common words is set above what the fastest typists post on short tests, and it is the rule most worth revisiting if a real run ever trips it.

**What a stranger sees.** The other racer's race name (1 to 40 characters, as every race uses), the race itself, and the results. Never an email, an account id, a friend list or history. A name filled in from the account's email is sent as "Racer". The first press on a device says what the other racer sees. Quick match is opt-in by pressing it. After the race, either racer can add the other through the existing friends list, which never reveals an email or id.

## Consequences

- Every new table cascades from `auth.users` ([ADR 0008](0008-account-deletion-cascades.md)). A rated result keeps no id of the other racer, so it goes with its own account only.
- Closing the tab, dropping the connection or sending a run that fails the check after the start is a rated loss against a run that passes. Nobody can avoid a loss or void a win that way.
- Deleting an account deletes its rooms and results ([ADR 0008](0008-account-deletion-cascades.md)), so a race the deleted account was in is never rated and the other racer gets no win. The deleted rating goes with it.
- Changing a limit, K, the gap or the standard setup means a new migration and the same change in `src/quick-match.js`. The unit test fails until both agree.
- Deferred: the daily leaderboard (the next TOB-421 pull request), seasons, full anti-cheat, rating decay, and a count of players online.
