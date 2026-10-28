# 0007. Condition sets are stored once per profile

Status: Accepted, 2026-10-23. Carried over from `HANDOFF.md`'s decisions to preserve.

## Context

Every run repeated its full conditions object, which made the profile row and the device cache much larger (TOB-137).

## Decision

From 2026-12-01 (`CONDITION_SETS_FROM`), the row and the device cache store each conditions set once (`conditionSets`). Builds before #94 can't read that format, so the date moves if #94 ships late. Stored copies are read through `normalizeProfile`, never through `data.runs[i].conditions`.

## Consequences

Code that reads a run's conditions goes through `normalizeProfile`.
