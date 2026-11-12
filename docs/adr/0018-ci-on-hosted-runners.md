# 0018. CI on GitHub's hosted runners

Status: Accepted, 2026-11-11 (TOB-447). Supersedes the CI-runner decision of [0012](0012-npm-node-and-the-desktop-runner.md).

## Context

[ADR 0012](0012-npm-node-and-the-desktop-runner.md) put CI and the master deploy on one self-hosted runner on tobygdesktop, because GitHub-hosted runners were blocked by billing. That runner took one job at a time. An e2e job took about 3.5 minutes but often waited 20 minutes to start. When the desktop was off, no check ran and master did not deploy.

The repo `tobygodat/typingsite` is public as of 2026-11-11. Toby chose to publish it as it is, with no licence for now. Standard hosted runners are free and unmetered on a public repo.

## Decision

- Every job in `.github/workflows/ci.yml` runs on `ubuntu-latest`: "Unit and build checks", "Deploy to Cloudflare" and "Browser e2e".
- "Browser e2e" is split into shards with a matrix (`--shard=<n>/6`). Each shard has its own concurrency group, so a newer push cancels only the same shard of an older run. Each shard installs Playwright's own browsers with their system deps.
- The deploy still runs only on a push to master, after the unit job, and e2e still runs after it without gating it.
- `browser.yml` is gone. It was the hosted fallback, and `ci.yml` now covers it.
- The desktop runner is retired.
- Workflows from outside contributors need approval before they run, and secret scanning and push protection are on. Both are repo settings. Forks get no secrets, so the unit job no longer skips fork PRs.

The npm, Node, no-bundler, hosting and lint decisions in 0012 stand.

## Consequences

- Checks and deploys run whether or not the desktop is on, and jobs from different PRs no longer queue behind each other.
- A hosted runner has 4 cores where the desktop has 24. A spec that depends on timing can behave differently in CI than locally.
- The code, PRs and Actions logs are public. Nothing secret may go in a log, a commit or a test fixture.
- Local runs on tobygdesktop keep `CHROMIUM` and the worker rule in `scripts/e2e-workers.mjs`. CI uses Playwright's bundled browsers. Chromium runs as the full build (`channel: 'chromium'` in `playwright.config.js`), because the headless shell rounds text runs to whole pixels and overflowed layouts that fit in a real browser.
