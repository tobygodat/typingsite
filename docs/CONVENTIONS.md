# Conventions

## Run, test, deploy

Node.js 20 or newer (CI uses 24). The app has no runtime dependencies. `npm install` brings in only Playwright and oxlint.

```sh
npm run dev           # http://localhost:5173, served straight from the checkout
npm test              # unit tests in tests/ (node --test)
npm run lint          # oxlint with the anti-slop plugin, warnings fail
npm run build         # copies the served files into dist/
npm run test:e2e:quick    # the core practice loop, layout and chrome specs, in a few minutes
npm run test:e2e:changed  # the specs your branch changed against origin/master
npm run test:e2e:compat   # selected Firefox and WebKit input/rendering cases
npm run test:e2e          # all of Chromium; CI runs this at every PR head, so run it only when CI can't
```

### Browser tests

- **Chromium.** The suite uses `CHROMIUM` when it is set, and Playwright's own browser otherwise. Without `npx playwright install chromium`, point it at a system build: `CHROMIUM=/usr/bin/chromium` on the desktop, `CHROMIUM=/usr/local/bin/chromium` on cloud machines (which have no `/usr/bin/chromium`).
- **Port.** e2e serves on `E2E_PORT` (default 4173) and fakes Supabase, so no account or network is touched. On a shared machine, set your own port, or Playwright reuses another worktree's server.
- **Quick, changed and full runs.** `test:e2e:quick` and `test:e2e:changed` are for iterating. `test:e2e:changed` compares with `origin/master`, so `git fetch origin master` first. The full Chromium run is CI's "Browser e2e", in six shards on hosted runners, 3 to 7 minutes each, once per head. Don't repeat it locally, where it competes with every other run on the desktop.
- **Other engines.** Firefox and WebKit select existing tests tagged `@compat` by default. Keep this set representative of browser-dependent behavior, not a second product matrix. It covers physical typing and corrections, timed finish, paste, composition event order and IME refusal, native dialog keyboard/focus, 320px layout, caret geometry and reduced motion. Playwright cannot start native composition in WebKit; event-order tests simulate it, and physical layouts still need a device check.
- **Compatibility runs.** `npm run test:e2e:compat` runs only the selected Firefox/WebKit cases locally. For input, layout, motion or engine-specific changes, request them once when the PR is otherwise ready with `gh workflow run ci.yml --ref <branch> -f browsers=compat`. This manual run does not repeat Chromium. Report its evidence in the PR.
- **Full diagnostics.** `npm run test:e2e:firefox`, `test:e2e:webkit` and `test:e2e:all` set `E2E_FULL=1` and retain full-engine coverage. Use them only for an explicit diagnosis or when CI cannot provide the needed evidence. To chase an untagged failure, run `E2E_FULL=1 E2E_BROWSERS=firefox npx playwright test e2e/<spec> -g <case>`. Install the engines first with `npx playwright install firefox webkit`.
- **Workers.** A run takes the cores nobody is using when it starts, read from the load average: at most two thirds of the machine (16 on tobygdesktop) and never fewer than 4 (`scripts/e2e-workers.mjs`). Traces are off locally. Leave `--workers` unset. Two runs started in the same second both see an idle machine, so start them a minute apart.
- **Debugging.** Inspect the failing case and its trace. After diagnosis, allow at most one targeted rerun with `--trace=on` by default. Classify retries as product failures, test flakes or infrastructure failures. A retry does not justify rerunning green CI or starting a repeated 20-, 100- or 200-run campaign.
- **Screenshots.** For a quick screenshot or a one-off flow, `.claude/skills/verify-stilltype/scripts/verify.mjs` drives the app in headless Chromium against the fake Supabase.

### CI

`.github/workflows/ci.yml` runs every job on GitHub's hosted `ubuntu-latest` runners ([ADR 0018](adr/0018-ci-on-hosted-runners.md)).

- **Unit job.** Every PR gets "Unit and build checks" (`npm ci`, `npm run lint`, `npm test`, `npm run build`).
- **e2e job.** Then it gets "Browser e2e": all of Chromium, split into six shards, "Browser e2e (chromium 1/6)" to "(chromium 6/6)", each on its own runner with Playwright's bundled browser. The unit job and every shard must be green at the PR head before the independent final proof can approve it. That run is the full-suite evidence for the author and for whoever checks the PR: read it with `gh run list --workflow=ci.yml --commit <sha>` and don't repeat it.
- **On master.** After the deploy, six full Chromium shards and one selected compatibility job per alternate engine run without gating the deploy. WebKit keeps one worker, as recorded in ADR 0018. A new push cancels each job of the ref's older e2e run, but never a deploy.
- **On request.** Manual runs default to `browsers=compat`, which runs only two browser jobs, Firefox and WebKit. `browsers=chromium` runs six full Chromium shards. `browsers=all` explicitly runs the full 18-job diagnostic matrix with `E2E_FULL=1`. Every manual request also runs the unit job and never deploys. It tests the branch as it is, not merged with master as a PR run is. [ADR 0020](adr/0020-selected-browser-compatibility.md) supersedes only ADR 0018's alternate-engine selection.
- **Forks.** A PR from a fork runs only after a maintainer approves it, and gets no secrets.
- **Failures.** A failing job uploads `test-results/` as `e2e-failures-<engine>-<shard>`, with a trace of each retry, kept for 7 days.

### Bounded final proof

One independent checker proves the final head in its own worktree and returns `PASS`, `PASS+NOTES` or `FAIL` with evidence. Cite the passing CI run at that SHA. Prove the changed behavior on the real artifact. For workflow or selection changes, use Playwright's actual test listing and execution output. For product changes, drive the required Practice, Train and affected flows in `AGENTS.md`.

Batch all findings into that proof. Demonstrated in-scope correctness, security or data failures block. Optional tests, wording and unrelated existing flakes are notes. After a fix, check the affected case and its impact rather than repeating a passing whole suite. Reopen independent review only for a demonstrated blocker in the changed behavior. Never repeat passing whole suites at the same head.

### Deploy

- **App.** Every push to master deploys from a hosted runner after the unit job passes (`ci.yml` "Deploy to Cloudflare", repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`). The site is https://stilltype.tobygodat.workers.dev (the Cloudflare Worker `stilltype`, `wrangler.jsonc`).
- **By hand, if CI can't deploy.** On tobylaptop in `~/Projects/typingsite`, run `git pull --ff-only && npm test && npm run build && npx wrangler@4.151.0 deploy`. Then check that live `/`, `src/app.js` and `src/styles.css` match `dist/`.
- **Database.** Supabase project `bicbyljexprkaedakofa` has every file in `supabase/migrations/`. Its history uses other timestamps, so apply a new migration alone (`supabase db query --remote=bicbyljexprkaedakofa --yes -f <file>`), not with `db push`. Deploy the frontend only after its migration is applied.
- **Edge Functions.** `supabase functions deploy delete-account` deploys account deletion, with the default JWT verification. Until it is deployed, Delete my account reports that deletion isn't switched on and deletes nothing. `supabase functions deploy generate-theme` deploys theme generation, which needs the `ANTHROPIC_API_KEY` secret.
- **Vercel.** It is retired. `vercel.json` only turns its deploys off (TOB-221).
- **Release.** Bump the version in `package.json`, its lock and `index.html` (`tests/release.test.js` checks), and rewrite the What's new bullets (six at most).

## Layout and naming

- `docs/ARCHITECTURE.md` has the code map. One module per concern in `src/`, named in kebab case. A module that grows a view gets a `-view.js` sibling (`compose.js`, `compose-view.js`).
- Markup lives in `index.html`.
- Design values come from the tokens at the top of `src/styles.css` (`DESIGN.md`).
- Feature detail lives in each module's comments and its tests, not in separate docs.
- "Shape" means a test's mode and length (`testShapes`, `shapeOf`).

## Errors

- Parse at the boundary. Stored profiles go through `normalizeProfile`, server replies through the module that called them, and the model's theme through `cleanTheme`. Inside, trust the shape.
- A request that stalls fails as unreachable after 15 s (`request` in `src/account.js`). Edits stay on the device, as when offline.
- A slow reply never acts over what the person did since it was sent (`raceContext`).
- A destructive action, like account deletion, changes nothing when it fails, and says so.

## Tests

- Unit tests go in `tests/<module>.test.js` and run in Node with no DOM. Scoring, replay, sync and storage logic belong there.
- Browser behaviour goes in `e2e/<feature>.spec.js`. Specs fake Supabase through `e2e/fake-supabase.js` and its siblings, and never touch the real project.
- Contrast, the service worker, releases and condition keys have guard tests (`contrast`, `sw`, `release`, `typing`). Keep them passing; don't loosen them.
- A flaky spec gets a Linear issue in the Stilltype project, with its engine and failure rate.
