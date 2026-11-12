# Stilltype

A typing-practice web app built around one loop: type a test, see which letter pairs hold you back, drill them, and retest on fresh text under the same conditions.

- Linear: https://linear.app/tobygodat/project/stilltype-6e4e58731700. Every change starts from an issue there.
- Notion: https://app.notion.com/p/401935c51fac81faa435c919f4ffbb5e (eudaimonia/projects/Stilltype).

## Read first

1. The Linear issue you're working on.
2. `docs/ARCHITECTURE.md` for where things live.
3. `docs/CONVENTIONS.md` before you add a file or a test, or run, test or deploy anything.
4. `PRODUCT.md` and `DESIGN.md` before you change anything a user sees.
5. `docs/adr/` before you change a decision recorded there. Supersede an ADR with a new one; never edit an accepted one.

## Before asking to merge

- `npm ci`
- `npm run lint`
- `npm test`
- `npm run build`
- While iterating, run `npm run test:e2e:quick` and `npm run test:e2e:changed` (the specs your branch changed). Set `CHROMIUM` and `E2E_PORT` as `docs/CONVENTIONS.md` says.
- Don't run the full suite locally. Push, and CI runs it once at your head: "Unit and build checks" and the six "Browser e2e (chromium n/6)" shards (all of Chromium) run on GitHub's hosted runners, and must be green at your head. Run `npm run test:e2e` yourself only when CI can't.
- When a change touches input, layout, motion or anything engine-specific, request the selected Firefox/WebKit compatibility set once, when the PR is otherwise ready: `gh workflow run ci.yml --ref <branch> -f browsers=compat`. This does not repeat Chromium. Report that run in the PR. Reserve `browsers=all` for explicit full-engine diagnostics. To chase an untagged failure, run that case alone with `E2E_FULL=1 E2E_BROWSERS=firefox npx playwright test e2e/<spec> -g <case>`.
- One independent checker proves the final head in its own worktree and returns `PASS`, `PASS+NOTES` or `FAIL` with evidence. It cites existing CI runs (`gh run list --workflow=ci.yml --commit <sha>`) without repeating passing suites. For test-policy changes, prove the real selection and execution. For product changes, check the affected cases and drive the flows below. Green CI alone is not the independent verdict.
- Batch findings into that one final proof. Demonstrated in-scope correctness, security or data failures block. Optional tests, wording and unrelated existing flakes are notes. After a fix, check the affected case and its impact. Reopen independent review only for a demonstrated blocker in the changed behavior. Never repeat passing whole suites at the same head.
- Classify retries as product failures, test flakes or infrastructure failures. A retry is not a reason to rerun green CI. Diagnose the specific failure and allow at most one targeted rerun by default. Do not start repeated 20-, 100- or 200-run campaigns without an explicit diagnostic request.
- Drive these flows with `agent-browser` against `npm run dev`, and attach screenshots:
  - **Practice.** Open `/`, pick words 10, and type the passage. The results card shows wpm, accuracy, time and the speed trace, and Run again starts a fresh passage.
  - **Train.** Start Train. It runs a 30-second drill, then a retest on fresh text, and shows the comparison.
  - Any flow your change touches.

## Rules

- **Design.** `DESIGN.md` prescribes no visual system ([ADR 0017](docs/adr/0017-design-note-keeps-floors-only.md)). Hold its floors: contrast, reduced motion, 44px touch targets, the letter being typed kept in view, and no sideways scroll at 320px. New colours, type, layouts, motion and effects are welcome. Show Toby a mockup or a screenshot of any change a user sees before it ships.
- **Tokens.** The tokens at the top of `src/styles.css` are the source of truth. A value used in more than one place becomes a token, and a colour token is set in every theme block.
- **Scoring.** Scoring never reads `src/motion.js` or `src/graph.js`.
- **Historical references.** `design/ash/` and `design/canvas/` are not served, not tested and not binding.
- **Metrics and conditions.** Change a metric definition only with a new version ([ADR 0003](docs/adr/0003-versioned-metric-contract.md)). A new condition must leave existing condition keys byte for byte the same ([ADR 0004](docs/adr/0004-conditions-keys.md)).
- **Data.** Sync merges and never replaces. Keystroke recordings stay on the device. Every foreign key to `auth.users` cascades. See ADRs 0005–0008.
- **Lint.** Don't silence an oxlint rule inline. Turn a rule off in `.oxlintrc.json` with a one-line reason, or fix the code.
- **Work tracking.** Remaining work and known bugs are Linear issues in the Stilltype project, never notes in the repo.
