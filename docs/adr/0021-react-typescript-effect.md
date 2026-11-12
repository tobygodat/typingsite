# 0021. React screens, typed domain owners and Effect lifetimes

Status: Accepted, 2026-11-12. Supersedes the native-stack decision in [0001](0001-native-browser-stack-and-learning-loop.md).

## Context

Stilltype has grown from the small app described in ADR 0001 to practice, training, progress, accounts and multiplayer races. Its page controller mixes rendering, synchronous input, profile persistence and asynchronous work. Toby chose React, TypeScript and Effect to make those responsibilities explicit while preserving the product.

## Decision

Use React for the actual screen, control, list and dialog markup. Keep long-lived practice sessions and canonical profiles in typed domain owners. React subscribes to cached immutable views. A displayed result is distinct from the next prepared session. Showing prepared work and choosing a new test remain separate operations.

Keep native typing input synchronous. One host owns the uncontrolled textarea, character nodes, caret and geometry. It records and paints before notifying React. Host cleanup releases resources without completing or replacing a run. Scoring, metric versions, condition keys and learning calculations remain independent of rendering and Effect.

Use Effect for asynchronous requests and their lifetimes. Cancellation reaches the actual fetch and body read. Keep identity and room-generation checks, serialized synchronization, merge-only profile writes and uncertain-write reconciliation. Cancellation does not imply that a remote mutation rolled back. Local cache persistence remains synchronous.

Compile the client with Vite and check maintained browser source with strict TypeScript. Keep JavaScript tests and Node utilities where conversion adds no benefit; run them against the converted implementation. Check the worker separately with worker globals. Deno Edge Functions retain their environment.

Serve the emitted production artifact through the restricted static server. Generate the serving inventory and offline precache from build output. Preserve network-first updates, navigation cached as `/`, default-font precaching, optional-font caching on use and uncached cross-origin requests.

## Consequences

- A runtime framework and compilation replace direct serving of source modules.
- Domain and asynchronous lifetimes survive screen visibility changes.
- Native input and React must have disjoint DOM ownership.
- Browser tests discover emitted assets instead of depending on original source URLs.
- This decision changes no scoring definition, stored profile version, network protocol or visual design.
