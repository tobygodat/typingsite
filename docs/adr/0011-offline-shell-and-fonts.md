# 0011. A network-first offline shell, and only two fonts by default

Status: Accepted, 2026-10-23. Carried over from `HANDOFF.md`'s decisions to preserve.

## Context

The app works offline through `sw.js`. A cache-first worker once ran new HTML against old JavaScript. People can also pick other typing and app fonts.

## Decision

- `sw.js` stays network-first. `npm run build` stamps a new cache name per build.
- Only Literata and Geist Mono load by default. Other fonts load when picked and are never precached (`tests/sw.test.js`).
- Carets stand on the typing font's measured baseline (`--typing-baseline`), not on Literata's metrics.

## Consequences

The first paint stays light whatever fonts exist. A new font must be measured, not assumed to share Literata's metrics.
