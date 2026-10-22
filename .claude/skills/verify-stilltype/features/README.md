# Stilltype verification map

This directory is the maintained source for verifying Stilltype's user-facing behaviour. Read this index,
then use the matching feature file as the recipe. `V` below is
`.claude/skills/verify-stilltype/scripts/verify.mjs`, run from the checkout root.

## Baseline preconditions

- `$V doctor` exits 0. Its server line says the URL serves this checkout, or that `shot` will start a
  private server.
- Each run gets a fresh browser context: a guest with default settings (time · 30 s, english 200, no
  punctuation), nothing in storage, and an empty fake Supabase.
- The passage is seeded (`--seed 20261009`), so the same words appear on every run unless `--seed off`.
- The emulated system theme is dark unless `--scheme light`.
- Never drive a server `$V doctor --url` rejects.

## Driving conventions

- Prefer a built-in flow (`$V shot <flow>`); otherwise a flow file run with `$V drive <file>`. Never a /tmp
  Playwright script: its evidence doesn't land in the evidence folder.
- Reach every state through the UI: clicks, typing, Ctrl+K. No `page.evaluate` writes, no `localStorage`
  seeding, no calls into `src/`.
- Use the stable handles named in each feature file (ids, ARIA names, `data-*` state attributes).
- Commands are literal; keep the quoted names and flags as written.
- The fake Supabase is the only mock. Sign in through the account dialog (`--signed-in` or `h.signIn`).

## Proof and skip reporting

- A proof is the evidence folder `$V` prints: screenshots of the action and the end state, an ARIA snapshot
  for each, and `run.json` with status `passed`, the checks that ran and zero browser errors.
- Cite the feature ID, entry point, viewport and scheme with each artifact (the file names carry the last two).
- For guest flows, `supabase.requests` is 0 and `offsite` is empty in `run.json`.
- If an entry point can't be reached, report the command you ran and the unmet precondition. Don't report it
  as verified through a different entry point.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing what the user sees. It then has
exactly four H2 sections in this order:

1. `Sub-features`: short IDs, one line for each behaviour.
2. `How to get to it (user POV)`: every user entry point.
3. `Driving it with verify.mjs`: starts with `Preconditions:`, then labelled bullets that pair each user
   action with an exact command and the observable result.
4. `Gotchas`: traps that waste or invalidate a run.

Keep implementation details out: name user paths, stable handles, required state, commands and observable
proof.

## Features

- [Practice run](./practice-run.md): the idle passage, typing a run, the chrome fading, and the run card after it.
- [Practice controls](./practice-controls.md): the one-row rail of modes, lengths and punctuation, and the "more" menu, at desktop and phone widths.
- [Theme and settings](./theme-and-settings.md): the settings dialog, the theme radios, following the system theme, and the background image.
- [Command palette](./command-palette.md): Ctrl+K, filtering, and running a command such as `theme · light`.
- [Accounts](./accounts.md): guest mode, signing in with email against the fake Supabase, and the account menu.
- [Challenge tabs, dock labels and key hints](./challenge-and-chrome-labels.md): one selected challenge tab, label-in-name for the dock's short verbs at 320px, and key hints hidden on touch-only devices.
- [Progress practice figures](./progress-practice.md): the Practice tab's figures, runs started included.
