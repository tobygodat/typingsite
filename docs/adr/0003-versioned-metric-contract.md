# 0003. The metric contract is versioned

Status: Accepted, 2026-10-23. Carried over from `HANDOFF.md`'s decisions to preserve.

## Context

Bests, trends and retests compare runs saved months apart. A silent change to how wpm, accuracy or the corpus is defined would make old and new runs look comparable when they aren't.

## Decision

`PRODUCT.md` defines the metrics. `METRIC_VERSION`, `EVENT_VERSION` and `CORPUS_VERSION` in `src/typing.js` version them. A definition changes only with a new version.

## Consequences

- A corpus bump drops every prose best. Code snippets stay outside the corpus version so a corpus bump doesn't touch them.
- Runs from different versions are never compared.
