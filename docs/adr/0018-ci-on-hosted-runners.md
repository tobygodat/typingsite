# 0018. CI on GitHub's hosted runners

Status: Accepted, 2026-11-11 (TOB-447). Supersedes the CI-runner decision of [0012](0012-npm-node-and-the-desktop-runner.md).

## Context

[ADR 0012](0012-npm-node-and-the-desktop-runner.md) put CI and the master deploy on one self-hosted runner on tobygdesktop, because GitHub-hosted runners were blocked by billing. That runner took one job at a time. An e2e job took about 3.5 minutes but often waited 20 minutes to start. When the desktop was off, no check ran and master did not deploy.

The repo `tobygodat/typingsite` is public as of 2026-11-11. Toby chose to publish it as it is, with no licence for now. Standard hosted runners are free and unmetered on a public repo.

## Decision

- Every job in `.github/workflows/ci.yml` runs on `ubuntu-latest`: "Unit and build checks", "Deploy to Cloudflare" and "Browser e2e".
- "Browser e2e" is a matrix of engine by shard (`--shard=<n>/6`), so each job runs one engine. Six shards over all three engines put WebKit alone in the first two, held to one worker by its cap in `playwright.config.js`, and those took 28 and 33 minutes. Split by engine, each job gets 3 workers on a 4-core runner. Chromium and Firefox jobs take 3 to 7 minutes that way. WebKit jobs run on one worker (`--workers=1` in `ci.yml`). At 3 workers, over two attempts of one run, `e2e/quick-match-settle.spec.js` failed 4 of 4 tries on WebKit and `e2e/pace-caret.spec.js` 2 of 3, because a loaded runner spreads faked keystrokes and caret frames further apart. At one worker both passed. The flag lives in the workflow because it is a fact about the hosted runner, so local runs keep the worker rule in `scripts/e2e-workers.mjs`. A PR runs Chromium's six shards. Master and a `browsers=all` run add six each for Firefox and WebKit, 18 jobs, which fits the 20 jobs GitHub runs at once on the free plan. Each job has its own concurrency group, so a newer push cancels only the same job of an older run. Each job installs its one engine from Playwright with its system deps.
- The deploy still runs only on a push to master, after the unit job, and e2e still runs after it without gating it.
- `browser.yml` is gone. It was the hosted fallback, and `ci.yml` now covers it.
- The desktop runner is retired.
- Workflows from outside contributors need approval before they run, and secret scanning and push protection are on. Both are repo settings. Forks get no secrets, so the unit job no longer skips fork PRs.

The npm, Node, no-bundler, hosting and lint decisions in 0012 stand.

## Consequences

- Checks and deploys run whether or not the desktop is on, and jobs from different PRs no longer queue behind each other.
- A hosted runner has 4 cores where the desktop has 24. A spec that depends on timing can behave differently in CI than locally.
- Ubuntu's WebKit renders some things differently from the desktop's. The Fira Code caret offset in TOB-22 shows on the desktop and not on CI, so `e2e/fonts.spec.js` expects that failure only off CI.
- The code, PRs and Actions logs are public. Nothing secret may go in a log, a commit or a test fixture.
- Local runs on tobygdesktop keep `CHROMIUM` and the worker rule in `scripts/e2e-workers.mjs`. CI uses Playwright's bundled browsers. Chromium runs as the full build (`channel: 'chromium'` in `playwright.config.js`), because the headless shell rounds text runs to whole pixels and overflowed layouts that fit in a real browser.
