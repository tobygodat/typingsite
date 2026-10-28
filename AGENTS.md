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
- `npm run test:e2e:quick` while iterating, then `npm run test:e2e`. Set `CHROMIUM` and `E2E_PORT` as `docs/CONVENTIONS.md` says.
- When a change touches input, layout, motion or anything engine-specific, also run `npm run test:e2e:firefox` and `npm run test:e2e:webkit` by hand, and report both in the PR.
- "Unit and build checks" and "Browser e2e" run on the self-hosted runner on tobygdesktop, and must be green at your head. Don't trigger the "Browser checks" workflow unless asked.
- Drive these flows with `agent-browser` against `npm run dev`, and attach screenshots:
  - **Practice.** Open `/`, pick words 10, and type the passage. The results card shows wpm, accuracy, time and the speed trace, and Run again starts a fresh passage.
  - **Train.** Start Train. It runs a 30-second drill, then a retest on fresh text, and shows the comparison.
  - Any flow your change touches.

## Rules

- **Afterimage is the binding design system** ([ADR 0002](docs/adr/0002-afterimage-design-system.md)). Follow `DESIGN.md` and the tokens at the top of `src/styles.css`. Never invent colours, type sizes, radii, durations or easings. Add a token before using a new value.
  - Literata for everything readable, including the passage and numerals. Geist Mono only for small measurement labels, conditions and keys.
  - One green accent for action, current state and the caret (other themes keep the role in their own colour). The primary button is filled green. Coral marks mistyped letters (always on a coral tint) and regressions.
  - Rules and space, not boxes. Dock, settings, palette and toasts are opaque raised surfaces: no glass, no glow.
- **Motion is fluid** (`DESIGN.md` Motion). Use transform and opacity only, never move or hide the letters being read, scale to zero under reduced motion, and use `--dur-*` tokens only. Scoring never reads `src/motion.js` or `src/graph.js`.
- **Less is more.** No eyebrows, taglines or helper copy (`DESIGN.md` Don'ts).
- **Historical references.** `design/ash/` and `design/canvas/` are not served, not tested and not binding. Don't move the app back toward them: no blue call to action, no Geist sans, no dark-only rule, no mono status pills.
- **Metrics and conditions.** Change a metric definition only with a new version ([ADR 0003](docs/adr/0003-versioned-metric-contract.md)). A new condition must leave existing condition keys byte for byte the same ([ADR 0004](docs/adr/0004-conditions-keys.md)).
- **Data.** Sync merges and never replaces. Keystroke recordings stay on the device. Every foreign key to `auth.users` cascades. See ADRs 0005–0008.
- **Lint.** Don't silence an oxlint rule inline. Turn a rule off in `.oxlintrc.json` with a one-line reason, or fix the code.
- **Work tracking.** Remaining work and known bugs are Linear issues in the Stilltype project, never notes in the repo.
