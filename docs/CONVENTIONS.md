# Conventions

## Run, test, deploy

Node.js 20 or newer (CI uses 24). The app has no runtime dependencies. `npm install` brings in only Playwright and oxlint.

```sh
npm run dev           # http://localhost:5173, served straight from the checkout
npm test              # unit tests in tests/ (node --test)
npm run lint          # oxlint with the anti-slop plugin, warnings fail
npm run build         # copies the served files into dist/
npm run test:e2e      # Playwright, Chromium only
npm run test:e2e:quick  # the core practice loop, layout and chrome specs, in a few minutes
```

### Browser tests

- **Chromium.** The suite uses `CHROMIUM` when it is set, and Playwright's own browser otherwise. Without `npx playwright install chromium`, point it at a system build: `CHROMIUM=/usr/bin/chromium` on the desktop, `CHROMIUM=/usr/local/bin/chromium` on cloud machines (which have no `/usr/bin/chromium`).
- **Port.** e2e serves on `E2E_PORT` (default 4173) and fakes Supabase, so no account or network is touched. On a shared machine, set your own port, or Playwright reuses another worktree's server.
- **Quick and full runs.** `test:e2e:quick` is for iterating. It doesn't replace the full run.
- **Other engines.** When a change touches input, layout, motion or anything engine-specific, also run `npm run test:e2e:firefox` and `npm run test:e2e:webkit`, or all three with `npm run test:e2e:all`. Run them after `npx playwright install firefox webkit`, and report them in the PR. `E2E_BROWSERS` picks the engines, so `E2E_BROWSERS=firefox npx playwright test e2e/<spec>` runs one spec there.
- **Workers.** Locally the suite runs on two thirds of the cores (16 workers on tobygdesktop) with traces off. Leave `--workers` unset, or pass `--workers=8` when `pgrep -f "playwright test"` finds another run on the same machine.
- **Debugging.** Rerun the failing spec with `--trace=on`.
- **Screenshots.** For a quick screenshot or a one-off flow, `.claude/skills/verify-stilltype/scripts/verify.mjs` drives the app in headless Chromium against the fake Supabase.

### CI

`.github/workflows/ci.yml` runs on a self-hosted runner on tobygdesktop (labels `self-hosted, tobygdesktop`), because hosted runners are blocked by billing ([ADR 0012](adr/0012-npm-node-and-the-desktop-runner.md)).

- **Unit job.** Every PR from this repo gets "Unit and build checks" (`npm ci`, `npm run lint`, `npm test`, `npm run build`).
- **e2e job.** Then it gets "Browser e2e" (Chromium, `CHROMIUM=/usr/bin/chromium`). A PR is ready when both are green at its head.
- **On master.** "Browser e2e" runs all three engines after the deploy, and doesn't gate it. A new push cancels the ref's older e2e run, but never a deploy.
- **Forks and the workflow.** PRs from forks never run on the runner. Don't trigger the "Browser checks" workflow (`browser.yml`) unless asked.
- **Load and failures.** The e2e uses 8 workers when another `playwright test` runs on the desktop. Failures upload `test-results/` with a trace of each retry.
- **The runner.** It lives in `~/actions-runner`. Its `.env` sets its own npm cache and `E2E_PORT=4917`. It runs as the systemd user service `actions-runner-typingsite`: `systemctl --user status|stop|start actions-runner-typingsite`.

### Deploy

- **App.** Every push to master deploys from the runner after the unit job passes (`ci.yml` "Deploy to Cloudflare", repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`). The site is https://stilltype.tobygodat.workers.dev (the Cloudflare Worker `stilltype`, `wrangler.jsonc`).
- **By hand, if the runner is down.** On tobylaptop in `~/Projects/typingsite`, run `git pull --ff-only && npm test && npm run build && npx wrangler@4.151.0 deploy`. Then check that live `/`, `src/app.js` and `src/styles.css` match `dist/`.
- **Database.** Supabase project `bicbyljexprkaedakofa` has every file in `supabase/migrations/`. Its history uses other timestamps, so apply a new migration alone (`supabase db query --linked -f <file>`), not with `db push`. Deploy the frontend only after its migration is applied.
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
