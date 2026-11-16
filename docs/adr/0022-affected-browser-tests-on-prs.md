# 0022. Affected browser tests on PRs

Status: Accepted, 2026-11-16 (TOB-491). Supersedes only "Chromium keeps the full suite in six hosted shards per PR head" in [0020](0020-selected-browser-compatibility.md).

## Context

Every PR ran all of Chromium, about 1,030 tests over six hosted shards, even when it changed only a doc, a unit test or one e2e spec. Those files can't change what the e2e jobs serve or run: the build reads only `src/`, `index.html`, `manifest.webmanifest` and `icons/`, the specs import only `e2e/`, `src/` and `scripts/`, and e2e fakes Supabase.

## Decision

- The unit job decides once per run which browser tests the run needs (`scripts/e2e-scope.mjs`), from the files a PR's merge commit changes against its base. An ordered rule table gives each file one effect: no browser test, its own spec, or everything. A file no rule names runs everything.
- A PR whose changes can't reach the app or the e2e harness runs no browser tests. A PR that changes only e2e specs runs only those specs, split across the six shards by recorded duration. Any other PR runs all of Chromium.
- Master pushes and manual runs always run everything. If the changed files can't be listed, the run tests everything.
- The six Chromium checks keep their names and still report on every PR. A job with nothing to run says why in its log and passes.

## Consequences

- A docs or unit-test PR is green after the unit job. A spec-only PR waits for its own specs only.
- A PR's green checks no longer always mean all of Chromium passed at its head. Master's run after the merge still tests everything.
- A new kind of file that can't affect e2e needs a rule in `scripts/e2e-scope.mjs`. Until it has one, it runs everything.
