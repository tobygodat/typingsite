# Races

Quick match finds a stranger at a similar race rating, counts down, and races both on one passage under the standard
30-second setup. The results show both runs, the rating change in one sentence (or why the race is not rated), a rank
card for a rated race, Graph and Replay, Rematch and Add to friends. A race between friends from Challenge's list ends
on the same results with a running tally.

## Sub-features

- `qm-search`: Find a race (`#quick-match [data-quick="toggle"]`) searches; a guest is asked to sign in; with nobody waiting after 20 s, an account with a recorded 30-second run on this device is offered that run as a ghost.
- `qm-rated`: a finished rated race states the win or loss in `#online-rating-change` and shows `#online-rank-card` with the rank, the change and the steps to the next rank; a provisional rating has no rank.
- `qm-unrated`: a run whose keys can't be checked, a pasted run, a fourth race in a day between one pair, or a forfeit each read as unrated or rated with the reason, accusing nobody.
- `qm-leave`: a racer who closes the page loses after a ten-second grace; the one who stays wins, and the leaver is told on return.
- `qm-latency`: a slow link's late progress never turns an honest faster run into a loss.
- `race-results`: both runs, Graph and Replay, each Rematch state (you, they, both, they left), and a rematch joined after its countdown.
- `race-late`: keystrokes that never reach the service hold Graph and Replay's place, then say they never came; a key whose progress lands after the clock is named as not counted.
- `qm-train`: a quick match started while a drill or retest waits leaves Train and Practice offering it afterwards.

## How to get to it (user POV)

- Dock → challenge → Find a race (signed in, with a second account searching).
- Dock → challenge → a friend's Race, or Join on an invitation.
- Results → Rematch, Add to friends, Graph, Replay; Leave closes the race.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` exits 0.
- Each flow signs in its own accounts in separate browser contexts on one fake Supabase, which plays the race
  service.
- In the `quick-match*` flows other than `-ranked` and `-alone`, `QUICK_MATCH_OTHER=<dir>` also saves the second
  racer's shots.

- **Matched and raced.** `$V drive .claude/skills/verify-stilltype/flows/quick-match.mjs`: searching, matched,
  both results with the rating change, Add to friends.
- **Rank card.** `$V drive .claude/skills/verify-stilltype/flows/quick-match-ranked.mjs`: a promotion mid-way and
  settled, a win and a loss inside a step, a provisional win. `run.json` notes each card's text.
- **How races settle.** `$V drive .claude/skills/verify-stilltype/flows/quick-match-settle.mjs`: rated, pasted,
  forfeit, both leave, a fourth race in a day, typed to the end (`QUICK_MATCH_CASES` takes a comma-separated subset of
  `rated,paster,forfeit,both-leave,repeat,to-the-end`; all take about two minutes). `quick-match-unchecked.mjs` is both runs unchecked; `quick-match-abandon.mjs` one racer closing the page.
- **Nobody waiting.** `$V drive .claude/skills/verify-stilltype/flows/quick-match-alone.mjs`.
- **Slow link.** `$V drive .claude/skills/verify-stilltype/flows/quick-match-latency.mjs` (`QUICK_MATCH_LATENCIES`,
  `QUICK_MATCH_RUNS` and `QUICK_MATCH_SECONDS` size the sweep; the default takes several minutes).
- **With Train waiting.** `$V drive .claude/skills/verify-stilltype/flows/quick-match-waiting-drill.mjs`.
- **Results and Rematch.** `$V drive .claude/skills/verify-stilltype/flows/online-rematch.mjs --full-page`.
- **Keystrokes that never came.** `$V drive .claude/skills/verify-stilltype/flows/online-review-wait.mjs --full-page`.
- **Late progress.** `$V drive .claude/skills/verify-stilltype/flows/online-late-progress.mjs --full-page`: the
  uncounted key's notice while the other racer races, then on the results.

## Gotchas

- The trace check reads real keystroke timings. Under heavy load a paste-speed run can arrive spread out enough to
  pass it (seen once in `quick-match-unchecked.mjs`); rerun that flow once before calling it a product failure.
- The fake is not the real race service or its database rules (`supabase/tests/race-service.mjs` covers those).
