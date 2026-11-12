# 0020. Selected browser compatibility checks

Status: Accepted, 2026-11-12 (TOB-437). Supersedes only the full alternate-engine selection in [0018](0018-ci-on-hosted-runners.md).

## Context

Full Firefox and WebKit runs duplicate the product matrix already checked in Chromium. Manual compatibility requests also repeat Chromium at a head that CI has checked. The operator wants bounded input and rendering coverage while retaining every test for diagnosis.

## Decision

Chromium keeps the full suite in six hosted shards per PR head. Master adds one Firefox and one WebKit job containing existing tests tagged `@compat`. Non-Chromium Playwright projects select that tag unless `E2E_FULL=1`.

Manual runs default to `browsers=compat`, which runs only the two alternate-engine compatibility jobs and the unit job. `browsers=chromium` retains six full Chromium shards. `browsers=all` retains all 18 full-engine shards. The explicit full-engine npm scripts set `E2E_FULL=1`.

Select representative browser-dependent cases for typing, composition event order, native dialog keyboard and focus, narrow layout, caret geometry and reduced motion. Specific bug specs remain in full Chromium coverage, and all tests remain available in full alternate-engine diagnostics. Do not duplicate tests or maintain another runner.

## Consequences

Routine alternate-engine checks cover representative browser behavior rather than every product path. An untagged alternate-engine failure needs an explicit full selection or a targeted `E2E_FULL=1` run. Hosted runners, worker limits, deployment ordering and all other ADR 0018 decisions stand.
