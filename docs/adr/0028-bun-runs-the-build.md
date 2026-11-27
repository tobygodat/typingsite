# 0028. Bun runs the build, verify and the shard split

Status: Accepted, 2026-11-26 (TOB-532). Supersedes only "`scripts/build-static.mjs` … still run on `node`" in [0023](0023-bun.md).

## Context

[ADR 0023](0023-bun.md) made Bun the package manager and kept Node as the runtime. It allows a script to move to the Bun runtime once its output is shown to be unchanged: a byte-identical `dist/`, or the same tests with the same results.

Each script was run on the same tree with Bun 1.4.4 and Node 26.12.1 on macOS (TOB-532):

| Script | Comparison | Result |
| --- | --- | --- |
| `scripts/build-static.mjs` | `diff -r` of the two `dist/` trees, and a SHA-256 list of every file | Identical: 44 files, shell `stilltype-shell-79cc06ebc5ad`. Two Node builds are identical too. Mean of 5 builds: Bun 0.81 s, Node 0.97 s. |
| `scripts/verify.mjs` | `--help`, `-h`, an unknown option, `--quick --no-e2e`, and a full `--no-e2e` run | Same output and exit codes (0, 0, 2, 2). Both full runs pass every step, and the unit tests report 767 passed and 0 failed. |
| `scripts/e2e-shards.mjs` | All 12 shard lists, logs and `GITHUB_OUTPUT`, `--refresh` from run 45773860646's 12 reports, and the usage error | Identical bytes and exit codes. |
| `scripts/e2e-scope.mjs` | A local run, a push run, a PR whose HEAD is not a merge commit, and PR merge commits that change only specs, only docs, or `src/` | Identical stdout, stderr, exit code and `GITHUB_OUTPUT`. |
| `scripts/learner-eval-scope.mjs` | Ranges that change `src/`, only docs, only specs, the last 10 master commits, and an unknown revision | Identical stdout, stderr, exit code and `GITHUB_OUTPUT`. |

## Decision

- `bun run build`, `bun run build:dist` and `bun run verify` run their scripts on Bun (`package.json`). Playwright's web server still serves `dist/` with `node server.mjs`.
- CI's e2e jobs split their shards with `bun scripts/e2e-shards.mjs` (`.github/workflows/e2e.yml`). Bun is already installed in those jobs.
- `scripts/e2e-scope.mjs` and `scripts/learner-eval-scope.mjs` stay on Node. Their output is the same on Bun, but each runs before its job installs Bun, and the "Learner eval" job installs Bun only when the evaluation runs.
- Node stays for `server.mjs`, the unit tests (`node --import tsx --test`), the learner evaluation (`node --import tsx`), `supabase/tests/edge-functions.mjs`, `scripts/e2e-flake-rate.mjs` and Playwright. Every job that runs one of them keeps `actions/setup-node`.

The rest of 0023 stands. The required check names, "Build", "Unit and build checks" and "Browser e2e", don't change.

## Consequences

- The hosted "Build" job builds `dist/` on Bun, and the deploy ships those bytes. They match a Node build of the same tree.
- A change to `scripts/build-static.mjs`, Vite or Bun can make the two runtimes' builds differ. To check, build once with `node scripts/build-static.mjs` and once with `bun scripts/build-static.mjs`, and compare the two `dist/` trees with `diff -r`.
- To move `e2e-scope.mjs` or `learner-eval-scope.mjs` to Bun, install Bun before their steps run. The evidence above covers their output.
