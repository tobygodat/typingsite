# 0005. Sync merges copies, never replaces them

Status: Accepted, 2026-10-23.

## Context

A signed-in profile lives in several tabs and devices at once, and in one account row. Last-write-wins would lose runs typed in one tab while another saved.

## Decision

Copies of a profile merge and never replace each other. `mergeSynced` in `src/account.js` is the one merge, and `tests/sync.test.js` covers it. A slow reply never acts over what the person did since it was sent (`raceContext` in `src/app.js`).

## Consequences

Every new profile field needs a merge rule and a sync test.
