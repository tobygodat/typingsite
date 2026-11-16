# Conventions

## Run, test, deploy

Use Bun 1.4.2 and Node.js 24, as CI does, or a supported newer Node. Bun installs the packages and runs the scripts ([ADR 0023](adr/0023-bun.md)); Node still runs `server.mjs`, the build, the unit tests and Playwright. Run `bun install --frozen-lockfile` to install the pinned React, Effect, TypeScript and Vite stack, Playwright and oxlint from `bun.lock`.

```sh
bun run dev           # build, then serve dist/ at http://localhost:5173
bun run test          # build, then unit tests in tests/ through tsx
bun run typecheck     # strict client and worker checks
bun run lint          # oxlint's correctness, suspicious, perf and pedantic rules plus anti-slop, warnings fail
bun run build         # strict typecheck, then compile and precache dist/
bun run build:dist    # compile and precache dist/ without the typecheck (CI, Playwright)
bun run test:unit     # unit tests against the dist/ already built (CI)
bun run test:e2e:quick    # the core practice loop, layout and chrome specs, in a few minutes
bun run test:e2e:changed  # the specs your branch changed against origin/master
bun run test:e2e:compat   # selected Firefox and WebKit input/rendering cases
bun run test:e2e          # all of Chromium; CI runs it on master and on PRs it affects, so run it only when CI can't
```

Lint leaves oxlint's `style`, `restriction` and `nursery` categories off: they hold preferences, opt-in bans and unstable rules. `.oxlintrc.json` gives the reason for each rule turned off in the categories it runs.

`bun run dev` builds once before starting the server. After changing source, restart it to rebuild. `bun run start` serves an existing build. Use `bun run test`, not `bun test`, which is Bun's own test runner and skips the build. Playwright compiles its own `dist/` (`bun run build:dist`, no typecheck) before starting its server, unless `E2E_PREBUILT=1` tells it to serve the `dist/` already there, as CI does.

### Browser tests

- **Chromium.** The suite uses `CHROMIUM` when it is set, and Playwright's own browser otherwise. Without `bunx playwright install chromium`, point it at a system build: `CHROMIUM=/usr/bin/chromium` on the desktop, `CHROMIUM=/usr/local/bin/chromium` on cloud machines (which have no `/usr/bin/chromium`).
- **Port.** e2e serves on `E2E_PORT` (default 4173) and fakes Supabase, so no account or network is touched. On a shared machine, set your own port, or Playwright reuses another worktree's server.
- **Quick, changed and full runs.** `test:e2e:quick` and `test:e2e:changed` are for iterating. `test:e2e:changed` compares with `origin/master`, so `git fetch origin master` first. The full Chromium run is CI's "Browser" jobs, in 12 shards on hosted runners, 3 to 4 minutes each, once per head that can affect it. Don't repeat it locally, where it competes with every other run on the desktop.
- **Other engines.** Firefox and WebKit select existing tests tagged `@compat` by default. Keep this set representative of browser-dependent behavior, not a second product matrix. It covers physical typing and corrections, timed finish, paste, composition event order and IME refusal, native dialog keyboard/focus, 320px layout, caret geometry and reduced motion. Playwright cannot start native composition in WebKit; event-order tests simulate it, and physical layouts still need a device check.
- **Compatibility runs.** `bun run test:e2e:compat` runs only the selected Firefox/WebKit cases locally. For input, layout, motion or engine-specific changes, request them once when the PR is otherwise ready with `gh workflow run ci.yml --ref <branch> -f browsers=compat`. This manual run does not repeat Chromium. Report its evidence in the PR.
- **Full diagnostics.** `bun run test:e2e:firefox`, `test:e2e:webkit` and `test:e2e:all` set `E2E_FULL=1` and retain full-engine coverage. Use them only for an explicit diagnosis or when CI cannot provide the needed evidence. To chase an untagged failure, run `E2E_FULL=1 E2E_BROWSERS=firefox bunx playwright test e2e/<spec> -g <case>`. Install the engines first with `bunx playwright install firefox webkit`.
- **Workers.** A run takes the cores nobody is using when it starts, read from the load average: at most two thirds of the machine (16 on tobygdesktop) and never fewer than 4 (`scripts/e2e-workers.mjs`). Traces are off locally. Leave `--workers` unset. Two runs started in the same second both see an idle machine, so start them a minute apart.
- **Debugging.** Inspect the failing case and its trace. After diagnosis, allow at most one targeted rerun with `--trace=on` by default. Classify retries as product failures, test flakes or infrastructure failures. A retry does not justify rerunning green CI or starting a repeated 20-, 100- or 200-run campaign.
- **Screenshots.** For a quick screenshot or a one-off flow, `.claude/skills/verify-stilltype/scripts/verify.mjs` drives the app in headless Chromium against the fake Supabase.

### CI

`.github/workflows/ci.yml` runs every job on GitHub's hosted `ubuntu-latest` runners ([ADR 0018](adr/0018-ci-on-hosted-runners.md)).

- **Build and unit jobs.** Every run starts with "Build" (`bun install --frozen-lockfile`, `bun run build:dist`), which builds once and uploads `dist/` as the run's `dist` artifact. "Unit and build checks" then runs `bun run lint`, `bun run typecheck` and `bun run test:unit` against that artifact. The e2e jobs and the deploy download it instead of building, so the deploy ships the bytes the run tested. The e2e jobs need only "Build", so on a PR they start while the unit job runs ([ADR 0024](adr/0024-shorter-browser-run.md)).
- **Affected tests.** The build job also decides which browser tests the run needs (`scripts/e2e-scope.mjs`, [ADR 0022](adr/0022-affected-browser-tests-on-prs.md)) and logs why. On a PR it reads the files the merge commit changes against the base. A PR that changes only `docs/`, root `*.md` files, `tests/`, `design/`, `supabase/`, `.entire/`, `.claude/`, `.agents/` or `scripts/e2e-durations.json` runs no browser tests. A PR that changes only those and `e2e/*.spec.js` files runs only the specs it changes. Anything else, a file no rule names, every master push and every manual run test everything. Each e2e job still reports under its name; a job with nothing to run logs why and passes.
- **e2e jobs.** Then it gets "Browser", from `.github/workflows/e2e.yml`: the selected Chromium tests, all of them unless the PR's scope says otherwise, split into 12 shards, "Browser / e2e (chromium 1/12)" to "(chromium 12/12)", each on its own runner with Playwright's bundled browser. `scripts/e2e-shards.mjs` splits the tests by their recorded hosted durations (`scripts/e2e-durations.json`) rather than Playwright's equal counts in file order, writes the job's share to a `--test-list` file, and stops the job if that list could drop or repeat a test. A full run's shard is never empty; a spec-only PR with fewer tests than shards leaves some shards with nothing to run. A test with no recorded duration counts as the median one. To run a CI shard locally: `node scripts/e2e-shards.mjs 2/12 /tmp/shard.txt && bunx playwright test --test-list /tmp/shard.txt`. "Browser e2e" then sums up the run: it passes only when the build, the unit job and every shard of this run passed. The build and unit jobs and every shard must be green at the PR head before the independent final proof can approve it. That run is the e2e evidence for the author and for whoever checks the PR: read it with `gh run list --workflow=ci.yml --commit <sha>` and don't repeat it.
- **On master.** After the deploy, "Browser after deploy" runs 12 full Chromium shards and one selected compatibility job per alternate engine without gating the deploy. WebKit keeps one worker, as recorded in ADR 0018. It runs whether or not the unit job passed. A new push cancels each job of the ref's older e2e run, but never a deploy, and an older run whose unit job it cancelled starts no browser jobs.
- **On request.** Manual runs default to `browsers=compat`, which runs only two browser jobs, Firefox and WebKit. `browsers=chromium` runs 12 full Chromium shards. `browsers=all` explicitly runs the full 18-job diagnostic matrix, 6 shards per engine, with `E2E_FULL=1`. Every manual request also runs the build and unit jobs and never deploys. Its gated jobs report as "Build (manual)", "Unit and build checks (manual)" and "Browser e2e (manual)", so the `master` ruleset ignores them. It tests the branch as it is, not merged with master as a PR run is. [ADR 0020](adr/0020-selected-browser-compatibility.md) supersedes only ADR 0018's alternate-engine selection, and [ADR 0024](adr/0024-shorter-browser-run.md) the Chromium shard count.
- **Forks.** A PR from a fork runs only after a maintainer approves it, and gets no secrets.
- **Failures.** A failing job uploads `test-results/` as `e2e-failures-<engine>-<shard>`, with a trace of each retry, kept for 7 days.
- **Durations.** Every e2e job uploads its Playwright JSON report as `e2e-timings-<engine>-<total>-<shard>`, kept for 7 days. When new or changed specs leave the shards uneven, refresh the durations from a green Chromium run: `gh run download <run> -p 'e2e-timings-chromium-*' -D /tmp/timings && node scripts/e2e-shards.mjs --refresh /tmp/timings`, and commit `scripts/e2e-durations.json`.

### Pull requests

`origin` and `gh` are both GitHub (`https://github.com/tobygodat/typingsite`). `entire` is Entire's old mirror and `entire-native` the retired native Entire repo, both kept for history; don't push to them. Merging moved from Entire trails back to GitHub ([ADR 0025](adr/0025-merge-gate-on-github.md)).

- **Open one.** Push your issue branch to `origin`, then `gh pr create --title "<title> (TOB-n)" --body "<PR body>"`. `ci.yml` runs on PRs and master pushes.
- **Required checks.** The `master` ruleset (`gh api repos/tobygodat/typingsite/rulesets`) requires "Build", "Unit and build checks" and "Browser e2e" from GitHub Actions, a PR for every change, and squash merges. Nobody can bypass it, and only Toby changes it. On a PR or push run, "Browser e2e" passes only when the build, the unit job and that run's browser jobs passed, so changing the shard count leaves the ruleset alone ([ADR 0024](adr/0024-shorter-browser-run.md)). Adding or renaming one of those three jobs means editing the ruleset in the same change. A manual run reports "(manual)" names, which the ruleset ignores, so it can't stand in for a PR run. A full run takes about 4 minutes, and a PR that changes no app file passes the shards at once. Firefox/WebKit compat is still requested by hand and isn't required. Entire may still post an "Entire Gates" check; it isn't required, so ignore it.
- **Merge.** Only on Toby's word: `gh pr checks <n> --required` must be all green, then `gh pr merge <n> --squash`. A merge to master deploys.
- **Sessions and memory.** Claude Code sessions are saved as checkpoints in the private `tobygodat/typingsite-checkpoints` repo, never in this public one. Codex sessions are saved too once `.codex/hooks.json` is on master and you have approved the hooks in Codex (`/hooks`); `entire status` says whether they are active. Brain memories are public, so never save secrets or personal data with `entire brain remember`.

### Bounded final proof

One independent checker proves the final head in its own worktree and returns `PASS`, `PASS+NOTES` or `FAIL` with evidence. Cite the passing CI run at that SHA, and the scope its build job logged: a PR run covers only the specs its changes can affect, and a master run covers everything. Prove the changed behavior on the real artifact. For workflow or selection changes, use Playwright's actual test listing and execution output. For product changes, drive the required Practice, Train and affected flows in `AGENTS.md`.

Batch all findings into that proof. Demonstrated in-scope correctness, security or data failures block. Optional tests, wording and unrelated existing flakes are notes. After a fix, check the affected case and its impact rather than repeating a passing whole suite. Reopen independent review only for a demonstrated blocker in the changed behavior. Never repeat passing whole suites at the same head.

### Deploy

- **App.** Every push to master deploys from a hosted runner after the build and unit jobs pass (`ci.yml` "Deploy to Cloudflare", repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`). The site is https://stilltype.tobygodat.workers.dev (the Cloudflare Worker `stilltype`, `wrangler.jsonc`).
- **By hand, if CI can't deploy.** On tobylaptop in `~/Projects/typingsite`, run `git pull --ff-only && bun install --frozen-lockfile && bun run test && bun run build && bunx wrangler@4.151.0 deploy`. Then check that live `/` and its emitted script and stylesheet URLs match the files in `dist/`.
- **Database.** Supabase project `bicbyljexprkaedakofa` has every file in `supabase/migrations/`. Its history uses other timestamps, so apply a new migration alone (`supabase db query --remote=bicbyljexprkaedakofa --yes -f <file>`), not with `db push`. Deploy the frontend only after its migration is applied.
- **Edge Functions.** `supabase functions deploy delete-account` deploys account deletion, with the default JWT verification. Until it is deployed, Delete my account reports that deletion isn't switched on and deletes nothing. `supabase functions deploy generate-theme` deploys theme generation, which needs the `ANTHROPIC_API_KEY` secret.
- **Vercel.** It is retired. `vercel.json` only turns its deploys off (TOB-221).
- **Release.** Bump the version in `package.json` and the React footer (`tests/release.test.js` checks), and rewrite the What's new bullets (six at most).

## Layout and naming

- `docs/ARCHITECTURE.md` has the code map. One module per concern in `src/`, named in kebab case. Browser modules use `.ts`; React components use `.tsx`. Keep `.js` import specifiers so Vite and the Node tsx loader resolve the same graph. All maintained browser sources are strict-checked TypeScript; the client configuration does not allow JavaScript imports. The worker is checked separately with worker globals. View components use the screen or feature name (`compose.ts`, `compose-view.tsx`).
- React owns screen, list, control and dialog markup. Native typing, graph and canvas hosts own only their ref subtrees. Never clear or replace React children imperatively.
- `index.html` contains the document shell and the prepaint marker. The build inlines checked `src/prepaint.ts` before CSS.
- Keep keystroke recording and immediate input feedback synchronous. Publish cached view snapshots afterward. Effects own async lifetimes and release native leases; cleanup does not finish a run.
- Raw JSON enters as `unknown`. Hydrated profiles retain incomplete historical records; narrow at their consumer instead of inventing current records.
- Design values come from the tokens at the top of `src/styles.css` (`DESIGN.md`).
- Feature detail lives in each module's comments and its tests, not in separate docs.
- "Shape" means a test's mode and length (`testShapes`, `shapeOf`).

## Errors

- Parse at the boundary. Stored profiles go through `normalizeProfile`, server replies through the module that called them, and the model's theme through `cleanTheme`. Inside, trust the shape.
- A request that stalls fails as unreachable after 15 s (`request` in `src/network.ts`). Edits stay on the device, as when offline.
- A slow reply never acts over what the person did since it was sent (`raceContext`).
- A destructive action, like account deletion, changes nothing when it fails, and says so.

## Tests

- Unit tests go in `tests/<module>.test.js` and run in Node through `tsx`, with no DOM. Scoring, replay, sync and storage logic belong there.
- Browser behaviour goes in `e2e/<feature>.spec.js`. Specs fake Supabase through `e2e/fake-supabase.js` and its siblings, and never touch the real project.
- The worker precache is generated from emitted assets, including required chunks and default fonts.
- Contrast, the service worker, releases and condition keys have guard tests (`contrast`, `sw`, `release`, `typing`). Keep them passing; don't loosen them.
- A flaky spec gets a Linear issue in the Stilltype project, with its engine and failure rate.
