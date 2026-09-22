# Staged implementation plan

Status: staged roadmap, originally written 21 September 2026. Implementation was authorized on 22 September; the repository now contains a native browser application. See [the implementation decision](decisions/2026-09-22-learning-loop.md) and `HANDOFF.md` for the current delivery state. Hosting and online multiplayer remain future work.

## Architecture direction

Start with a browser application and local persistence. Keep the typing state machine, event schema, scoring, text selection, and recommendation logic separate from UI rendering. Those modules should support deterministic replay so later multiplayer, offline analysis, and model evaluation share the same metric definitions.

Keep the existing native HTML/CSS/JavaScript modules for this milestone, as recorded in the implementation decision. Avoid committing to hosting, account services, or an ML service before the corresponding stage needs them.

Proposed module boundaries: `typing` owns input/state/replay; `metrics` owns versioned scoring; `corpus` owns texts and comparability; `training` owns recommendations and drills; `profile` owns history/persistence; `ui` owns interaction and display. Introduce `competition` when ghosts and rooms are added. These are conceptual boundaries, not directories already created.

## Stage 0 — Fix the contracts

Settle the essential audience/scope choices in the [MVP spec](mvp-spec.md). Record the selected stack in a short architecture decision. Define input handling, scoring fixtures, event versions, and corpus metadata before wiring the UI. Select original/licensed texts with enough variety for held-out retests.

**Exit:** one reproducible event trace has an agreed expected score, a run state diagram covers start/restart/finish/interruption, and text provenance and comparable fresh-text selection are defined. No backend needed.

## Stage 1 — Deliver the complete solo loop

Build in small vertical slices:

1. Typing surface, quotes/word tests, correction behavior, restart, and deterministic event capture.
2. Results, mode labels, quote filters, and local profile persistence.
3. Transparent weak-pattern recommender, manual targets, realistic drills, and fresh-text retest.
4. Shared progress view, input/accessibility handling, clear-history control, and performance polish.

**Exit:** every [milestone 1 acceptance criterion](mvp-spec.md#milestone-1-acceptance-criteria) is met. Verify metrics with replay fixtures and a small end-to-end test covering the whole journey and reload. Manually inspect focus, error cues, typing stability, and latency on the stated browser/device matrix. Test correction loops, timer boundaries, insufficient data, and missing comparable passages because they affect trust in the product.

## Stage 2 — Add repeatable competition

Add personal-best ghosts and daily quote challenges. Label ghosts as recordings. Make ghost playback use the same text/rule/metric versions as the current run. Keep any local score display distinct from a trusted public leaderboard. Add transparent quote difficulty descriptions; calibrate numerical difficulty before introducing performance points.

**Exit:** a saved run replays reproducibly; daily content and reset timezone are explicit; incompatible recordings cannot be compared; these modes feed the same training profile. If shared scores are introduced, add server validation and identity then.

## Stage 3 — Add private friend rooms

Introduce a small service for room lifecycle, shared quote/rule versions, start coordination, authoritative completion validation, and persisted results. Design for reconnection, duplicate messages, late joins, disconnects, and abandoned rooms. Limit room access and validate untrusted client messages. Recorded opponents remain visibly distinct from live players.

**Exit:** multi-client tests cover synchronized starts, result agreement, reconnect behavior, and room cleanup. Instrument latency and failure rates; show network delay without changing local input feel. Server validation reduces obvious score manipulation but does not establish complete anti-cheat. Public ranked play remains deferred.

## Stage 4 — Evaluate personalization

Use the [ML/data/evaluation plan](ml-data-evaluation.md). Collect consented data only when retention and deletion are implemented. Compare prediction models against the transparent baseline on future sessions and held-out users, then test practice benefit on novel passages with equal practice time and delayed follow-up.

**Exit:** a reproducible evaluation report states sample sizes, splits, uncertainty, limitations, and whether the model beat the baseline on learning outcomes. Keep or discard the model based on those results. This stage can overlap stages 2–3 once reliable event capture exists; it does not depend on multiplayer.

## Stage 5 — Expand only with evidence

Consider public matchmaking when concurrent participation supports acceptable queues. Add abuse controls, stronger integrity checks, stable ranked scoring, observability, and recovery before public ranking. Seasons, more languages, richer personalization, and beginner learning are separate expansions.

**Exit:** each expansion has a measured user need and operational plan. Do not infer a public launch decision from completion of a private MVP.

## Deliverables that support career depth

Retain an architecture decision log, replay fixtures, a measured performance report, a multiplayer reliability write-up, and an honest model/evaluation report. A demo should show one complete learning loop and explain what the evidence does and does not establish. These artifacts support a stronger project story than a long feature list or an unnecessary LLM integration.
