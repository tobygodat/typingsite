# 0016. A named rank on the race rating

Status: Accepted, 2026-11-11 (TOB-429).

## Context

[ADR 0014](0014-quick-match-and-race-rating.md) gave quick match an Elo race rating, shown as "Race rating 1840 · 23 rated races". A bare number gives a racer nothing to climb toward: 1840 reads the same as 1790 unless you know where the lines are.

## Decision

**The ladder.** A rating with 10 or more rated races reads as one of six wind ranks, lowest first:

| Rank | Rating | Steps |
| --- | --- | --- |
| Whisper | under 1200 | none |
| Breeze | 1200 to 1499 | III, II, I |
| Gust | 1500 to 1799 | III, II, I |
| Gale | 1800 to 2099 | III, II, I |
| Tempest | 2100 to 2399 | III, II, I |
| Hurricane | 2400 and up | none |

Each rank between Whisper and Hurricane spans 300 points in three 100-point steps, III the lowest hundred and I the highest. So 1500 is Gust III, 1699 is Gust II, 1799 is Gust I and 1800 is Gale III. Everyone starts at 1500, so a new account that holds its level lands in Gust III. The table, its floor of 1200 and its 300- and 100-point spans are `RANKS` in `src/quick-match.js`, and `rankOf` reads it.

**What the racer reads.** The rating line leads with the rank: "Gale III · 1840 · 23 rated races". A rated result that changes the rank or the step says so at its end: "Rated win. Gale III · 1808 · 23 rated races (+16), up from Gust I." The state before the race is the rating less the change, with one rated race fewer. A racer can't start another quick match until one settles (ADR 0014), so the count the service returns with a settled race is the count after it.

**Derived, not stored.** The rank is a pure function of the rating and its count. Nothing new is written, there is no migration, and the service, the e2e fake and Elo are unchanged. A stored rank could disagree with the rating it came from, and moving a boundary would need a backfill. Derived, a new ladder is one table edit and every rating reads it at once.

**None while provisional.** Below 10 rated races the line stays "Race rating 1500 · 0 rated races · provisional". K is 40 there, so a rating swings 20 points a race and would cross steps and ranks on noise. A rank shown then would mostly report the first few results. The race that ends the provisional period gives a rank and says nothing about movement, since there was no rank before it.

**Only your own.** The rank is on your rating line and your own result line. The other racer's rank, like their rating, is never shown. [PRODUCT.md](../../PRODUCT.md) keeps the race rating out of public ranking until integrity work allows one.

## Deferred

- Demotion protection: a loss that crosses a line moves you down at once.
- Seasons and resets.
- Decay for a rating not raced in a while.
- Showing a rank to anyone else, in a room, a friend list or a leaderboard.

## Consequences

The rank changes only what the rating line and the rated result line say. Any later change to the ladder supersedes this ADR and edits `RANKS`. Nothing stored needs to move.
