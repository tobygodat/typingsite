# 0024. Twelve Chromium shards that start once dist/ is built

Status: Accepted, 2026-11-16 (TOB-491). Supersedes only the Chromium shard count in [0018](0018-ci-on-hosted-runners.md), [0020](0020-selected-browser-compatibility.md) and [0022](0022-affected-browser-tests-on-prs.md), and, for PR and manual runs, the order that put the browser jobs after the unit job.

## Context

A PR run that tests all of Chromium took about 7.8 minutes (hosted run 43792880638). The unit job took 45s, 32s of it unit tests, and every e2e job waited for it, though the e2e jobs need only `dist/`, which builds in a second. Then six Chromium shards ran 350 to 420s each. The 1,030 tests hold about 5,710s of recorded test time (`scripts/e2e-durations.json`). Six shards of 3 workers each come to about 320s of tests per worker.

Hosted runs on throwaway branches, all of Chromium each time, none of them queued for a runner:

| Shards | Runs | Wall time | Slowest shard's test step |
| --- | --- | --- | --- |
| 6, before | 43792880638 | 469s | 379s |
| 6, early start | 43818378044 | 433s | 371s |
| 8 | 43820946371 | 301s | 244s |
| 10 | 43818381161, 43820949089 | 316s, 272s | 218s, 216s |
| 12 | 43819626996, 43821734089 | 247s, 243s | 191s, 183s |

Every run ran each of the 1,030 tests exactly once and skipped the same 32. The one 10-shard run's 316s includes a 60s browser install on its last shard. Each shard also spends about 40s it can't share: setting up, installing Chromium (12 to 30s) and splitting the tests (4 to 8s).

## Decision

- PRs, master pushes and `browsers=chromium` runs split all of Chromium into 12 shards. `browsers=all` keeps 6 per engine.
- A "Build" job installs the packages, builds `dist/`, uploads it, and decides the run's e2e scope (`scripts/e2e-scope.mjs`). "Unit and build checks" needs it, and runs lint, typecheck and the unit tests against that `dist/`.
- The e2e jobs live in a reusable workflow, `.github/workflows/e2e.yml`, that `ci.yml` calls twice. On a PR or a manual run, "Browser" needs only the build job. On a push to master, "Browser after deploy" needs the deploy, as ADR 0018 set. A job that needs the deploy waits for the unit job even when the deploy is skipped, so one job can't do both.
- The deploy needs the build and the unit job, so master never deploys a commit that failed lint, typecheck or the unit tests.
- The checks are "Build", "Unit and build checks", "Browser / e2e (chromium n/12)", and on master "Browser after deploy / e2e (chromium n/12)" and "Browser after deploy / compat (firefox|webkit)".

## Consequences

- A PR that tests all of Chromium takes about 4 minutes, and its browser jobs start about 15s into the run instead of 47s.
- A failed build fails the run and skips every job after it. A failed unit job fails the run while the browser jobs finish. Nothing gates on a check's name: Entire's merge gate needs every check at the head to pass, and the repo has no branch protection.
- On master the unit job starts after the build, so the deploy starts about 15s later than before.
- A master run holds 14 browser jobs at once, under the 20 GitHub runs at once on the free plan. A master run and a PR run together can pass 20, and the later jobs queue.
- More shards don't make the slowest one shorter by the same share: each pays its setup, install and split again. Workers per shard stay at 3, and WebKit at one ([ADR 0018](0018-ci-on-hosted-runners.md)).
