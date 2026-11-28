---
name: verify-stilltype
description: Drive the real Stilltype typing-practice web app (compiled dist/, served by server.mjs) in headless Chromium against the fake Supabase, and capture screenshots, ARIA snapshots and a run.json as proof. Use to confirm a UI or behaviour change in the browser, to take the usual screenshots (idle practice page, a finished run's results, the "more" menu open, phone 390/320, light theme, settings, signed in), or to script a one-off flow instead of writing a throwaway Playwright file in /tmp.
---

# Verify Stilltype

Everything runs through one script, from the checkout root, after `bun install --frozen-lockfile` in this
checkout:

```sh
V=.claude/skills/verify-stilltype/scripts/verify.mjs
$V            # usage
```

Every browser context gets the in-memory Supabase from `e2e/fake-supabase.js`, so nothing reaches the real
project. Running tests, CI and the final proof are in `AGENTS.md` and `docs/CONVENTIONS.md`, not here.

## Launch

`$V shot …` and `$V drive …` start a private server on a free port and stop it when they exit. For several
commands in a row, start a managed server once:

```sh
$V serve      # runs bun run build, then prints url, pid and log; the port is fixed per checkout (5200–5799)
```

`serve` returns once the server answers with every file in `dist/.serve-manifest.json` byte for byte and is
`node server.mjs` in this checkout. Shots and drives use it while it runs. There is no database or seed: a guest
starts from defaults, and signed-in state lives in each browser context's fake Supabase. The server does not watch
source, so after a source edit run `$V stop` then `$V serve`.

Never drive someone else's server. `bun run dev` (5173) and other worktrees' servers may serve other code, so
`--url` is accepted only when doctor passes for it.

## Doctor

```sh
$V doctor                 # or: $V doctor --url http://127.0.0.1:5173/
```

Read-only. Checks node, Playwright, the Chromium it will use, the checkout and its dirty state, that `dist/`
matches its manifest and is newer than its inputs, that the server serves this checkout's exact build, and that the
evidence folder is writable. Exit 0 means the instance is worth driving. Run it first whenever something looks off.

Chromium is the first that runs of `CHROMIUM`, `/usr/bin/chromium`, `/usr/local/bin/chromium` and Playwright's own
download (`bunx playwright install chromium`). Doctor and `run.json` name the one used.

## Drive

Built-in flows:

| Command | What it does and what it checks |
| --- | --- |
| `$V shot idle` | Practice page at rest. Notes the condition line. |
| `$V shot results` | words → 10, types half the passage (checks `body[data-running="true"]`), finishes, waits for `body[data-view=results]`. Shots ready, mid-run and results. Checks wpm is a number and accuracy is 100. |
| `$V shot more` | Practice rail, then the "more" menu open. Checks the menu fits the viewport and nothing scrolls sideways. |
| `$V shot settings` | Settings on appearance, clicks the other theme in `#theme-select`, checks `html[data-theme]` follows, closes with Escape and checks focus returns to `#settings-trigger`. |
| `$V shot signin` | Guest → account dialog → Sign in with email (fake user `verify@stilltype.test`). Checks member/synced and that the fake stored a profile row. Shots the account menu. |
| `$V shot phone` | idle + more at 390×844 and 320×568, touch, 2× pixels. |
| `$V shot light` | idle + results with the system theme light. |
| `$V shot all` | every flow above, then phone and light (about a minute). |

Options combine with any flow: `--width N --height N`, `--mobile` (touch and a mobile viewport),
`--scheme dark|light` (the emulated system theme, default dark), `--reduced-motion`, `--signed-in` (signs in
through the dialog first), `--seed N|off` (default 20261009, so every run types the same passage), `--delay MS`
(per key, default 100), `--full-page`, `--url URL` and `--out DIR`. Several flows in one command share one
evidence folder: `$V shot idle more --width 390 --height 844 --mobile`.

Every other flow is a file in `flows/`. Each file's header says what it shoots and checks, and the feature map
names each one with its options:

```sh
$V drive .claude/skills/verify-stilltype/flows/palette-theme.mjs --scheme light
```

For anything else, write a flow file instead of a /tmp Playwright script:

```js
// my-flow.mjs: no imports needed; everything arrives in the argument.
export default async ({ page, h, shot, note, check, fake, url }) => {
  await h.openApp();                       // goto / and wait for the passage and fonts
  await h.chooseWords(25);                 // also: h.chooseMore('mode-code' | 'mode-standard' | 'mode-compose' | 'mode-custom' | 'mode-drill' | 'open-lessons')
  await shot('ready');                     // png + ARIA snapshot + state into run.json
  await h.type(await h.passage());         // types the visible passage at --delay
  await h.attr('body', 'data-view', 'results');
  note('wpm', await h.text('#result-wpm'));
  check((await h.text('#result-accuracy')) === '100', 'clean run');   // a false check fails the run
};
```

`h` also has `openView('Practice' | 'Train' | 'Progress' | 'Challenge')` (nudges the mouse first, since the dock
fades during a run), `openSettings(category?)` (appearance, practice, keyboard, sound or shortcuts),
`signIn(email)` (after `fake.addUser(email)`), `settle()` (waits for finite animations, at most 2 s) and
`text(selector)`. Keep a flow worth repeating in `flows/` and name it in the feature map.

Stable handles: the dock is `getByRole('navigation', { name: 'Main navigation' })` with buttons Practice, Train,
Progress, Challenge and Commands (the full word matches at every width); the view is `body[data-view]`, and a run
in progress sets `body[data-running="true"]` (`"false"` otherwise); the passage is `#accessible-passage` and the input `#typing-input`; the rail
is `.practice-rail` with `#mode-time`, `#mode-words`, `#mode-quote`, `#mode-more` / `#mode-more-label` and
`#duration-options [data-length="N"]`; theme is `html[data-theme]`; account is `#account[data-state]` (guest,
member) and `[data-sync]`; the palette is `#palette` / `#palette-input` / `#palette-list [role=option]`; settings
is the modal `#settings-dialog` with `[data-settings-category]` buttons and `#settings-<category>` sections;
Progress's detail views open from `[data-progress-open]`. Each feature file names the handles of its own views.

`docs/screenshots/` is not this skill's evidence: the specs write it only with `SCREENSHOTS=1`.

## Evidence

Every `shot` and `drive` writes one folder that survives reboots and worktree removal:

```
~/.local/share/stilltype-verify/<checkout>-<branch>/<UTC stamp>-<flows>/
  <flow>.<W>x<H>.<scheme>[.touch].<step>.png        what the page looked like
  <flow>.<W>x<H>.<scheme>[.touch].<step>.aria.yml   the accessibility tree at that moment
  run.json                                          url, commit, dirty flag, build, chromium, seed; per run: steps
                                                    with view/theme/running/account, notes, checks, browser
                                                    errors, fake-Supabase request count, off-site requests
  <flow>…failure.png                                only when a run failed
```

Without `--out`, `latest` links to the newest run; `$V list` shows recent ones with pass/fail. The command prints every
screenshot path; open them with Read, and cite them by absolute path. `STILLTYPE_EVIDENCE_DIR` moves the root and
`--out DIR` names one run's folder.

A run fails (exit 1) on a false check, a missing element (15 s timeout), any page or console error (fake-Supabase
4xx noise excepted), or a fake-Supabase handler error.

Proof standards:

- Go through the real user path: click, type and use the keyboard as a person would. Don't call app functions,
  set `localStorage`, or flip `data-*` attributes to reach a state.
- Capture the action and the result: a before shot, the moment of the action, and the end state.
- Check side effects next to what's visible: `run.json` notes the result numbers, the account state and the fake
  backend's stored rows; for guests, `supabase.requests` is 0 and `offsite` is empty.
- The only mock is Supabase, already a network boundary. Everything in the page is the shipped code.
- Say what you didn't cover. A shot at 1280 doesn't prove 320, dark doesn't prove light, and the fake backend
  doesn't prove the real Supabase project or its policies.

## Cleanup

```sh
$V stop       # stops the managed server only if its pid is still node server.mjs in this checkout
```

Private servers and browsers stop with their command. Never kill by name (`pkill node`, `pkill chromium`): other
checkouts run their own. Cleanup never touches the evidence; delete old folders by hand. State (pid file, server
log) lives in `~/.local/state/stilltype-verify/<checkout>-<branch>/`.

## Feature map

`features/README.md` indexes the user-facing features. Read the matching file before verifying a change, and
cover every entry point it lists for the behaviour you changed.

## Gotchas

- Playwright's headless default system theme is light; the script defaults to `--scheme dark`.
- A guest's theme pick lasts only for the tab; on reload a guest follows the system theme again. Signed-in picks
  persist.
- The seed replaces `Math.random`, so quotes, drills and word picks repeat too. Use `--seed off` when variety
  matters.
- Escape restarts a run by default (settings → shortcuts). Don't press it mid-run unless that's the point.
- ARIA snapshots render `<details>` (account, "more") as a bare `group`; read the account state from the
  `run.json` steps. Settings is a modal `<dialog>` and makes the page behind it inert until it closes.
