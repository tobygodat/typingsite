---
name: verify-stilltype
description: Drive the real Stilltype typing-practice web app (compiled dist/, served by server.mjs) in headless Chromium and capture screenshots, ARIA snapshots and a run.json as proof. Use to confirm a UI or behaviour change in the browser, to take the usual screenshots (idle practice page, a finished run's results, the "more" menu open, phone 390/320, light theme, settings, signed in), or to script a one-off flow instead of writing a throwaway Playwright file in /tmp. Uses hosted CI for full suites and local targeted runs for iteration.
---

# Verify Stilltype

Stilltype builds with Vite into `dist/`. `server.mjs` serves only the emitted files listed in
`dist/.serve-manifest.json`, including hashed JavaScript and CSS, fonts and the PWA files.
Everything an agent needs is one script:

```sh
V=.claude/skills/verify-stilltype/scripts/verify.mjs   # run from the checkout root
$V                                                     # usage
```

It loads Playwright from this checkout's `node_modules`, or the main checkout's when this is a worktree
without one. Browser commands register this checkout's `tsx/esm/api` loader before importing the fake backend
and custom flows, so `.js` import specifiers resolve converted TypeScript modules. Run `npm ci` in this
checkout first for the build and loader dependencies. It drives the first Chromium that runs
(see Chromium below), and always attaches the in-memory Supabase from `e2e/fake-supabase.js`, so nothing reaches the real project.

## Launch

You usually don't need to. `$V shot …` and `$V drive …` start a private server on a free port, use it, and
kill it when they exit (including on failure or Ctrl-C). Each new managed or private server runs
`npm run build` before starting, including the TypeScript check. A failed build stops the launch.

For several commands in a row, or to look at the app yourself, start a managed server:

```sh
$V serve      # prints url, pid and log; port is fixed per checkout (5200–5799), e.g. http://127.0.0.1:5524/
```

Ready means usable. `serve` returns only once every emitted file in the manifest comes back byte-identical
to this checkout's `dist/`, with the expected `X-Stilltype-Build` version. It also verifies that the local
listener runs `server.mjs` in this checkout, using Linux `/proc` and `lsof`. There is no database, migration
or seed. A guest starts from defaults and writes nothing; signed-in state comes from the fake Supabase
in each browser context. Shots and drives use the managed server automatically while it runs, after the
same artifact check. Source edits need a rebuild.
Run `$V stop` then `$V serve` to rebuild and restart. Calling `serve` with an existing managed server
checks it without rebuilding. Stop it first if its build is stale.

Don't drive someone else's server. `npm run dev` (5173) and other worktrees' servers (5175, …) may be
running and serving other code; `--url` is only accepted when doctor passes for it.

## Chromium

`$V` uses the first of these whose `--version` runs, so it works on the desktop and on cloud machines with
nothing set:

1. `CHROMIUM`, when set (a path that doesn't run is skipped, and doctor names it).
2. `/usr/bin/chromium` (the desktop).
3. `/usr/local/bin/chromium` (cloud machines, where it links to Google Chrome).
4. Playwright's own download, after `npx playwright install chromium`.

`$V doctor` prints which one it picked and what it skipped; `run.json` records it as `chromium`. If none
runs, `shot` and `drive` stop and say so.

## Doctor

```sh
$V doctor                 # or: $V doctor --url http://127.0.0.1:5173/
```

Read-only. Reports node, the Playwright version and where it came from, the Chromium it picked (and any it
skipped), the checkout's branch,
commit and dirty state, the emitted build version and file count, whether the server (managed, or `--url`)
serves this checkout's exact compiled bytes and version, and that the evidence folder is writable. Exit 0 means it's worth driving. Run it first whenever something looks
off. Doctor never builds. Missing output, bytes that disagree with the manifest version, or a build input
newer than the manifest fail the build check. The timestamp check catches newer source edits; it does not
prove reproducibility. A server with another working directory, different emitted bytes or a different
version fails the server check. Stop using that URL and rebuild this checkout before retrying.

## Drive

Built-in flows, one command each. Options combine with any flow.

| Command | What it does and what it checks |
| --- | --- |
| `$V shot idle` | Practice page at rest. Notes the condition line. |
| `$V shot results` | words → 10, screenshot, types half the passage (checks `body[data-running]`), screenshot, finishes, waits for `body[data-view=results]`, screenshot the run card. Checks wpm is a number and accuracy is 100. |
| `$V shot more` | Practice rail, then the "more" menu open. Checks the menu fits the viewport and nothing scrolls sideways. |
| `$V shot settings` | Opens the settings dialog (`#settings-trigger` → `#settings-dialog[open]`) on appearance, clicks the other theme's radio in `#theme-select`, checks `html[data-theme]` follows, then closes with Escape and checks focus returns to the dock button. |
| `$V shot signin` | Guest → account dialog → Sign in with email (fake user `verify@stilltype.test`) → checks member/synced and that the fake backend stored a profile row. Screenshots the account menu. |
| `$V shot phone` | idle + more at 390×844 and 320×568, touch, 2× pixels. |
| `$V shot light` | idle + results with the system theme light. |
| `$V shot all` | every flow above, then phone and light (about a minute). |

Options: `--width N --height N`, `--mobile` (touch + mobile viewport), `--scheme dark|light` (the emulated
system theme; default dark), `--reduced-motion`, `--signed-in` (signs in through the dialog before the flow),
`--seed N|off` (default 20261009, so every run shows the same passage and before/after shots line up),
`--delay MS` (per key, default 100: a 10-word run then lasts over the 3 s consistency needs),
`--full-page`, `--url URL`, `--out DIR`. Several flows in one command share one evidence folder:
`$V shot idle more --width 390 --height 844 --mobile`.

For anything else, write a flow file instead of a /tmp Playwright script, and run it with the same evidence
handling:

```sh
$V drive .claude/skills/verify-stilltype/flows/palette-theme.mjs
$V drive .claude/skills/verify-stilltype/flows/code-run.mjs --scheme light
$V drive .claude/skills/verify-stilltype/flows/challenge-chrome.mjs --width 320 --height 568 --mobile
$V drive .claude/skills/verify-stilltype/flows/book-run.mjs --width 390 --height 844 --mobile
$V drive .claude/skills/verify-stilltype/flows/themes.mjs        # every theme: settings, mid-run, results
$V drive .claude/skills/verify-stilltype/flows/theme-modes.mjs   # system mode: a dark and a light pick, both schemes
$V drive .claude/skills/verify-stilltype/flows/custom-theme.mjs --signed-in   # custom theme editor and generate
$V drive .claude/skills/verify-stilltype/flows/fonts.mjs --delay 30   # every typing font: caret, tape, pace caret measured
$V drive .claude/skills/verify-stilltype/flows/wallpaper.mjs     # background image: settings without/with one, each style idle, dimmed mid-run
$V drive .claude/skills/verify-stilltype/flows/online-rematch.mjs --full-page   # two accounts race: results, graph, replay, each Rematch state, a rematch joined late through to its graph and replay
$V drive .claude/skills/verify-stilltype/flows/online-review-wait.mjs --full-page   # a result whose other racer's keystrokes never came: waiting in Graph and Replay's place, then saying they never came
$V drive .claude/skills/verify-stilltype/flows/challenge-people.mjs   # Challenge's people list: every row state, forced colours, an invitation arriving, Race setup, Race into the room
$V drive .claude/skills/verify-stilltype/flows/challenge-people-dismiss.mjs   # Dismiss with a double tap of Enter: focus shown on a row, never an action; with no row left, on Quick match's heading
$V drive .claude/skills/verify-stilltype/flows/challenge-people-states.mjs   # guest, empty list, quick match searching, Add a friend, daily and One keyboard and Back, a guest joining by link
$V drive .claude/skills/verify-stilltype/flows/challenge-options.mjs   # Race setup: the practice setup, then changed with Match practice offered
$V drive .claude/skills/verify-stilltype/flows/quick-match.mjs   # two strangers matched and raced: the rated win and loss, Add to friends
$V drive .claude/skills/verify-stilltype/flows/quick-match-abandon.mjs   # one racer closes the page: the other's rated win, the leaver's loss on return
$V drive .claude/skills/verify-stilltype/flows/quick-match-unchecked.mjs   # both runs fail the trace check: unrated, and why
$V drive .claude/skills/verify-stilltype/flows/quick-match-alone.mjs   # nobody waiting: keep waiting, or race your own best run
$V drive .claude/skills/verify-stilltype/flows/quick-match-waiting-drill.mjs   # a quick match while a drill or retest waits: Train and Practice after it, beside a no-match control
$V drive .claude/skills/verify-stilltype/flows/quick-match-settle.mjs   # both racers' results: rated, pasted, forfeit, both leave, a fourth race in a day, typed to the end
$V drive .claude/skills/verify-stilltype/flows/quick-match-latency.mjs   # one racer's requests delayed 0 to 600 ms: both honest runs checked, the faster wins
$V drive .claude/skills/verify-stilltype/flows/quick-match-ranked.mjs   # ranked accounts: the rank on the rating line, and the rank card for a promotion (mid-way and settled), a win and a loss inside a step, and a provisional win
```

```js
// my-flow.mjs: no imports needed; everything arrives in the argument.
export default async ({ page, h, shot, note, check, fake, url }) => {
  await h.openApp();                       // goto / and wait for the passage and fonts
  await h.chooseWords(25);                 // also: h.chooseMore('mode-code' | 'mode-standard' | 'mode-compose' | 'mode-custom' | 'open-lessons')
  await shot('ready');                     // png + ARIA snapshot + state into run.json
  await h.type(await h.passage());         // types the visible passage at --delay
  await h.attr('body', 'data-view', 'results');
  note('wpm', await h.text('#result-wpm'));
  check((await h.text('#result-accuracy')) === '100', 'clean run');   // a false check fails the run
};
```

`h` also has `openView('Practice' | 'Train' | 'Progress' | 'Challenge')` (nudges the mouse first, since the
dock fades during a run), `openSettings(category?)` (opens the settings dialog and, if given, shows one of
appearance, practice, keyboard, sound or shortcuts), `signIn(email)` (after `fake.addUser(email)`), `settle()` (waits
for finite animations, at most 2 s) and `text(selector)`. Keep a flow worth repeating in
`.claude/skills/verify-stilltype/flows/` and add it to the feature map.

Stable handles: the dock is `getByRole('navigation', { name: 'Main navigation' })` with buttons Practice,
Train, Progress, Challenge, Commands (below 360px the names are "type practice", "train", "track progress",
"race challenge"; the default substring match on the full word finds them at every width); Challenge is
`#challenge-people` (quick match `#quick-match`, rows `#people-list .people-row[data-state]`, foot links `#people-add`,
`#people-race-link`, `#people-setup`, `#open-daily`, `#open-local`) and its views `#people-add-view`,
`#people-setup-view`, `#challenge-daily-view`, `#challenge-local-view` (`[data-challenge-back]` returns); key hints carry `.key-hint` and hide under `--mobile`; the practice rail is `.practice-rail` with `#mode-time`, `#mode-words`,
`#mode-quote`, `#mode-more` / `#mode-more-label`, `#duration-options [data-length="N"]`, the book mode's
`#book-options` (its dropdown is the combobox named "book", the page number `#book-page`) and
`#punctuation-switch`; the passage is `#accessible-passage` and input `#typing-input`; the view is
`body[data-view]` (practice, results, progress, compete), a run in progress sets `body[data-running]`; theme is
`html[data-theme]`; account is `#account[data-state]` (guest, member) and `[data-sync]`; the palette is
`#palette` / `#palette-input` / `#palette-list [role=option]`; settings is the modal `#settings-dialog`
(opened by `#settings-trigger`) with category buttons `[data-settings-category]`, sections `#settings-<category>`,
and radio-group fieldsets such as `#theme-select input[value=…]` (system, dark, light) and `#dark-theme` /
`#light-theme` (each mode's pick).

Running tests is separate from driving the app. In a worktree, run `npm ci` first. Set a private
`E2E_PORT` and use `CHROMIUM=/usr/bin/chromium` on the desktop or `/usr/local/bin/chromium` in the cloud.
Run `npm run test:e2e:quick` and the changed specs while iterating, with the load-based worker default.
The full Chromium suite runs once per PR head in hosted CI. Cite that run with
`gh run list --workflow=ci.yml --commit <sha>` instead of repeating it locally or on the desktop.
Before asking to merge, run dependency install, lint, unit tests and build as `AGENTS.md` requires.

For input, layout, motion or engine-specific changes, request the selected `@compat` Firefox/WebKit set
once with `gh workflow run ci.yml --ref <branch> -f browsers=compat`. It does not repeat Chromium.
`npm run test:e2e:compat` runs that set locally. Full alternate-engine suites remain explicit diagnostics
through `browsers=all`, or `test:e2e:firefox`, `test:e2e:webkit` and `test:e2e:all`, which set `E2E_FULL=1`.
To diagnose an untagged case, use `E2E_FULL=1 E2E_BROWSERS=firefox npx playwright test e2e/<spec> -g <case>`.

One independent checker proves the final head in its own worktree and returns `PASS`, `PASS+NOTES` or
`FAIL` with evidence. Keep real-artifact proof and batch findings into this one final check. Demonstrated
in-scope correctness, security or data failures block. Optional tests, wording and unrelated existing
flakes are notes. After a fix, check the affected case and its impact. Reopen independent review only for
a demonstrated blocker in the changed behavior. Never repeat passing whole suites at the same head.
For test-policy changes, prove actual selection and execution. Product changes still need the Practice,
Train and affected flows from `AGENTS.md`.

Classify retries as product failures, test flakes or infrastructure failures. A retry does not justify
rerunning green CI. Diagnose the specific failure and allow at most one targeted rerun by default.
Repeated 20-, 100- or 200-run campaigns need an explicit diagnostic request.

The screenshots committed under `docs/screenshots/` are a different thing from this skill's evidence. They
come from the specs' screenshot tests, which write there only when `SCREENSHOTS=1` is set. Refresh them
locally (`SCREENSHOTS=1 CHROMIUM=/usr/bin/chromium npx playwright test e2e/<spec>`).

## Evidence

Every `shot` and `drive` writes one folder that survives reboots and worktree removal:

```
~/.local/share/stilltype-verify/<checkout>-<branch>/<UTC stamp>-<flows>/
  <flow>.<W>x<H>.<scheme>[.touch].<step>.png        what the page looked like
  <flow>.<W>x<H>.<scheme>[.touch].<step>.aria.yml   the accessibility tree at that moment
  run.json                                          url, commit, dirty flag, seed; per run: steps with
                                                    view/theme/running/account, notes, checks, browser
                                                    errors, fake-Supabase request count, off-site requests
  <flow>…failure.png                                only when a run failed
```

`latest` in the same folder links to the newest run; `$V list` shows recent ones with pass/fail. The command
prints every screenshot path; open them with Read to look, and link them in a PR or reply by absolute path.
`STILLTYPE_EVIDENCE_DIR` moves the root; `--out DIR` names one run's folder.

A run fails (exit 1) on a false check, a missing element (15 s timeout), any page error or console error
(fake-Supabase 4xx noise excepted, as in `e2e/fixtures.js`), or a fake-Supabase handler error.

Proof standards:

- Go through the real user path: click, type and use the keyboard as a person would. Don't call app
  functions, set `localStorage`, or flip `data-*` attributes to reach a state.
- Capture the action and the result: a before shot, the moment of the action (mid-run, menu open), and the
  end state. One final screenshot is not proof.
- Check side effects next to what's visible: `run.json` notes the result numbers, the account state, the fake
  backend's stored profile; for guests, `supabase.requests` must be 0 and `offsite` empty.
- The only mock is Supabase, which is already a network boundary (`src/account.js` talks to it over `fetch`).
  Everything in the page is the shipped code.
- Say what you didn't cover. A shot at 1280 doesn't prove 320; a dark shot doesn't prove light; the fake
  backend doesn't prove the real Supabase project or its policies.

## Cleanup

```sh
$V stop       # stops the managed server only if its pid is still node server.mjs in this checkout
```

Private servers from `shot`/`drive` stop on their own. Browsers are per-command and closed at the end. Never
kill by name (`pkill node`, `pkill chromium`): other checkouts and sessions run their own servers and
browsers. Cleanup never touches `~/.local/share/stilltype-verify/`; delete old evidence folders by hand.
State (pid file, server log) lives in `~/.local/state/stilltype-verify/<checkout>-<branch>/`.

## Feature map

`features/README.md` indexes the user-facing features with recipes for each. Read the matching file before
verifying a change, and cover every entry point it lists.

## Gotchas

- `server.mjs` serves `dist/` without watching source files. Use `$V stop` then `$V serve` after source edits.
  Doctor checks the current output and never refreshes it.
- Playwright's headless default system theme is light; the script defaults to `--scheme dark`, the theme
  most people see. Pass `--scheme light` for the light set.
- Guests' theme pick lasts only for the tab; on reload a guest follows the system again (the inline script in
  `index.html`). Signed-in picks persist.
- The seed replaces `Math.random`, so quotes, drills and word picks repeat too. Use `--seed off` when the
  variety matters.
- Escape restarts a run by default, and Enter restarts before or after one (settings → keybindings). Don't
  press them mid-run unless that's the point.
- ARIA snapshots render `<details>` (account, "more") as a bare `group`; read the account state from
  `run.json` steps. Settings is a modal `<dialog>`, not a `<details>`, and makes the page behind it inert
  until it closes.
- `/usr/bin/chromium` is a wrapper that adds the desktop's flags (Wayland, extensions); headless runs are fine
  with it.
