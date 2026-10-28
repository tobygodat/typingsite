# 0006. Keystroke recordings stay on the device

Status: Accepted, 2026-10-23. Carried over from `HANDOFF.md`'s decisions to preserve; the sign-out rule is Toby's call on TOB-144.

## Context

Full keystroke traces are most of a profile's size, and they are the most personal part of it.

## Decision

- The account row holds everything except the keystroke recordings (`rowCopy` in `src/account.js`). Recordings stay in the device cache.
- A run recorded on another device therefore can't be a retest baseline.
- Signing out deletes the recordings saved on this device, even when everything else has been sent (Toby, 2026-10-23, TOB-144).
- Composing practice stores numbers only, never the text.

## Consequences

Replays and retest baselines are per device. The row stays smaller, though it is still sent whole (TOB-219).
