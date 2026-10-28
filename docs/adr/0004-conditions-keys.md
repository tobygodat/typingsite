# 0004. Condition keys decide what counts as the same test

Status: Accepted, 2026-10-23. Carried over from `HANDOFF.md`'s decisions to preserve.

## Context

Bests, averages and retest baselines only make sense between runs typed under the same conditions. Every new setting raises the question of whether it changes the test.

## Decision

- `conditionKey` in `src/typing.js` decides what counts as the same test.
- A new condition joins the key only away from its default, so existing keys stay byte for byte the same. This is tested.
- Display settings and minimums never join the key.
- Speeds are stored in wpm. CPM is display only.
- Repeated text, drills, challenges, interrupted runs and touch runs never mix with practice bests. Bests saved before repeat quotes existed stay as saved (Toby's call).
- Keyboard layouts relabel the on-screen keyboard and join the key. They don't remap keys, since people remap in their OS.

## Consequences

Adding a condition means a default that leaves old keys alone, and a test that proves they are unchanged.
