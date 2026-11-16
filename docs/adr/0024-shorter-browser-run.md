# 0024. Twelve Chromium shards that start once dist/ is built

Status: Accepted, 2026-11-16 (TOB-491). Supersedes only the Chromium shard count in [0018](0018-ci-on-hosted-runners.md), [0020](0020-selected-browser-compatibility.md) and [0022](0022-affected-browser-tests-on-prs.md), and the order that put the browser jobs after the unit job: on PR and manual runs they start once `dist/` is built, and on master they no longer wait for the unit job to pass.

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
- On master, "Browser after deploy" runs whether or not the unit job passed, where the old workflow skipped the browser jobs after a failed unit job. That is more coverage, not less. It still skips them when a newer push cancelled the unit job, because that push's run tests master again.
- A "Browser e2e" job needs the build, the unit job and both browser calls, and always runs. It passes only when the build, the unit job and the browser call for this event (on a push "Browser after deploy", otherwise "Browser") all succeeded. A skipped, failed or cancelled one fails it.
- The gate keeps the latest check of each name at a commit, and a manual run on a PR branch reports on the PR head. So on a manual run the build, unit and summary jobs are named "Build (manual)", "Unit and build checks (manual)" and "Browser e2e (manual)". A manual run can't replace a PR run's gated checks, and a compat run's green summary, which ran no Chromium, can't hide a red shard.
- Entire's merge gate requires checks by name. The list lives in Entire's trail gate settings, not in this repo, and it names "Build", "Unit and build checks" and "Browser e2e". The summary job keeps that list the same when the shard count changes.
- The checks on a PR or push are "Build", "Unit and build checks", "Browser e2e", "Browser / e2e (chromium n/12)", and on master "Browser after deploy / e2e (chromium n/12)" and "Browser after deploy / compat (firefox|webkit)".

## Consequences

- A PR that tests all of Chromium takes about 4 minutes, and its browser jobs start about 15s into the run instead of 47s.
- A failed build fails the run and skips every job after it. A failed unit job fails the run while the browser jobs finish. The repo has no branch protection.
- Changing the shard count again changes only the shard checks' names, which the gate doesn't list. Adding or renaming "Build", "Unit and build checks" or "Browser e2e" means editing the gate list in Entire by hand.
- On master the unit job starts after the build, so the deploy starts about 15s later than before.
- A master run holds 14 browser jobs at once, under the 20 GitHub runs at once on the free plan. A master run and a PR run together can pass 20, and the later jobs queue.
- More shards don't make the slowest one shorter by the same share: each pays its setup, install and split again. Workers per shard stay at 3, and WebKit at one ([ADR 0018](0018-ci-on-hosted-runners.md)).
