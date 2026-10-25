# Handoff — Stilltype

Updated 23 October 2026 at master b3893d7. Read this first, then `PRODUCT.md`, `DESIGN.md` and `AGENTS.md`. Feature detail lives in each module's comments and tests.

## What it is

A typing-practice web app built around one loop: type a test, see which letter pairs hold you back, drill them, retest on fresh text under the same conditions. Native HTML, CSS and JavaScript, no runtime dependencies. Accounts, sync and online races use Supabase over `fetch`. Guests save nothing beyond the tab.

## Run, test, deploy

```sh
npm run dev       # http://localhost:5173
npm test          # unit tests in tests/
npm run build     # copies the served files into dist/
npm run test:e2e  # Playwright in Chromium; test:e2e:firefox, :webkit, :all; :quick while iterating
```

- e2e serves on `E2E_PORT` (default 4173) and fakes Supabase. On a shared machine set your own port, or Playwright reuses another worktree's server.
- CI: `ci.yml` runs on a self-hosted runner on tobygdesktop (labels `self-hosted, tobygdesktop`), because hosted runners are blocked by billing. Every PR from this repo gets the "Unit and build checks" check (`npm ci`, `npm test`, `npm run build`); a PR is ready when it is green at its head. PRs from forks never run there. The runner lives in `~/actions-runner` (its `.env` sets its own npm cache and `E2E_PORT=4917`) as the systemd user service `actions-runner-typingsite`: `systemctl --user status|stop|start actions-runner-typingsite`. The browser suite still runs only locally.
- Deploy: every push to master deploys from the same runner after the checks pass (`ci.yml` "Deploy to Cloudflare", repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`). By hand if the runner is down, on tobylaptop in `~/Projects/typingsite`: `git pull --ff-only && npm test && npm run build && npx wrangler@4.151.0 deploy`, then check live `/`, `src/app.js` and `src/styles.css` match `dist/`. Site: https://stilltype.tobygodat.workers.dev (Cloudflare Worker `stilltype`, `wrangler.jsonc`).
- Supabase project `bicbyljexprkaedakofa` has every file in `supabase/migrations/`. Its history uses other timestamps, so apply a new migration alone (`supabase db query --linked -f <file>`), not with `db push`. `supabase functions deploy delete-account` deploys account deletion; `supabase functions deploy generate-theme` deploys theme generation (needs the `ANTHROPIC_API_KEY` secret).
- Release: bump the version in `package.json`, its lock and `index.html` (`tests/release.test.js` checks), and rewrite the What's new bullets (six at most).

## Features

- Practice: time, words (presets or custom) and quote, with punctuation, numbers and four word lists. Adaptive (time and words) leans the text toward the pairs you keep missing; its runs are drill-kind, so never a best, trend point or baseline.
- More: code (js, python, go, rust), standard 60 s test, book pages, compose, custom text, a 1–8 letter manual drill.
- Learn to type: 14 lessons; only physical-keyboard runs unlock the next.
- Results: on Practice, in place of the passage (`body[data-view=results]`): run card, Run again / Drill “pair” / Watch replay, speed graph, typed words, practice missed words.
- Train (Direction D): one button. It plans for the current settings from saved history (recurring pair, else the newest traces, else a general drill), runs a 30-second drill, then a fresh retest, and shows the comparison on Train; its Back to practice opens the retest's own run card. "Patterns across runs" lives on Progress; "words you keep missing" is a palette command.
- Progress: period and length filters, figures, speed / accuracy / consistency / practice / keys tabs, daily goal and streaks, runs started.
- Challenge: online races (invite or guest link, friends, Race again), Daily, friends board, one keyboard.
- Ghost races: a friend races your recorded run within seven days.
- Inbox and toast for invitations and challenges.
- Settings dialog, ⌘K / Ctrl-K palette (each group listed once, in the order of its first command; `e2e/palette-alignment.spec.js` holds its rows centred and its columns aligned), Monkeytype import.
- Rules: five correction policies, strict space, quick end, minimums, repeat quotes, pace caret.
- Display: ten themes in a mode (system, dark, light) with a dark and a light pick, up to five custom themes (editor, or generated from a short description by Claude Haiku 5.5, 20 a day), a background image (regular, dither or gradient, with blur, opacity and height), text size, typing and app fonts, word highlight (optionally sliding between words), one-line tape, wpm or cpm, live metrics, keyboard with five layouts and a finger map, focus mode, sounds.
- Accounts: email or Google, sync, clear history with Undo, account deletion.
- Offline shell, What's new, anonymous feature suggestions.

## Code map

`index.html` holds all markup. In `src/`:

- `app.js`: orchestration: screens, input, preferences, history, palette commands.
- `typing.js`: engine: passages, replay, metrics, correction rules, `conditionKey`.
- `corpus.js`, `words.js`: original quotes and drill words; the word lists.
- `code-snippets.js`: code mode's snippets.
- `books.js`, `book-texts.js`: pagination and place; text generated by `scripts/build-book-texts.mjs`.
- `lengths.js`: test lengths.
- `quote-filters.js`: quote and book dropdowns.
- `lessons.js`: the beginner path.
- `insights.js`: run summaries, retention, patterns, filters, targets, daily text.
- `run-counts.js`: runs started and finished.
- `progress-view.js`: Progress charts.
- `graph.js`: speed graph.
- `replay-view.js`: watch replay.
- `motion.js`: caret, line scroll, pace and ghost carets, and the sliding word highlight.
- `tape.js`: one-line tape geometry.
- `word-highlight.js`: word highlight.
- `fonts.js`: typing and app font choices; `index.html` applies an account's before first paint.
- `wallpaper.js`: background image: the device-only copy and its look (style, blur, opacity, height), the dither mask and gradient wash, where its fade ends, its settings rows.
- `units.js`: wpm and cpm display.
- `layouts.js`: layout legends, finger map.
- `sound.js`: typing sounds.
- `keybindings.js`: shortcuts.
- `settings.js`: settings dialog.
- `custom-themes.js`, `theme-editor.js`: custom themes (tokens, contrast, storage) and their editor; generation is `supabase/functions/generate-theme`.
- `palette.js`: command palette.
- `monkeytype.js`: Monkeytype import.
- `compose.js`, `compose-view.js`, `compose-caret.js`: composing practice.
- `profile.js`: profile defaults and `normalizeProfile`.
- `account.js`: auth, the profile row, `mergeSynced`, `HISTORY`.
- `online-race.js`, `multiplayer.js`: online races and their RPCs.
- `ghost-race.js`: ghost challenges.
- `inbox.js`, `race-result.js`: inbox, toast, race results.
- `friends-board.js`: friends board and sharing.
- `egg.js`: ↑↑↓↓←→←→ b a.
- `styles.css`, `fonts/`: theme tokens, then layout; the fonts.

Also `sw.js` (offline shell), `docs/` (specs, `online-races.md`, verification records) and `.claude/skills/verify-stilltype`. `design/` is historical.

## Decisions to preserve

- Metric contract: defined in `PRODUCT.md`, versioned by `METRIC_VERSION`, `EVENT_VERSION` and `CORPUS_VERSION` in `src/typing.js`. Change a definition only with a new version. A corpus bump drops every prose best, so code snippets stay outside it.
- Conditions keys: `conditionKey` decides what is the same test. A new condition joins only away from its default, so existing keys stay byte for byte (tested). Display settings and minimums never join. Speeds are stored in wpm.
- Repeated text, drills, challenges, interrupted and touch runs never mix with practice bests. Bests saved before repeat quotes stay as saved (toby).
- Sync: copies merge, never replace; see `mergeSynced` in `src/account.js` and `tests/sync.test.js`.
- Keystroke recordings stay on the device (toby): the account row holds the rest (`rowCopy`), so a run recorded elsewhere can't be a retest baseline.
- From 2026-12-01 (`CONDITION_SETS_FROM`) the row and the device cache store each conditions set once (`conditionSets`); builds before #94 can't read that, so move the date if #94 ships late. Read stored copies through `normalizeProfile`, never `data.runs[i].conditions`.
- Composing stores numbers, never text.
- Every foreign key to `auth.users` must cascade (`supabase/tests/account-deletion.sql`).
- Less is more (toby): no eyebrows, taglines or helper copy (DESIGN.md Don'ts).
- Motion is fluid (AGENTS.md): `--dur-*` tokens only, never moving the letters being read, zero under reduced motion; scoring never reads it.
- Every theme holds 4.5:1 text and 3:1 non-text contrast (`tests/contrast.test.js`). Custom themes are the exception: the editor notes contrast under AA at the token but never blocks a save.
- Custom themes are stored as JSON text (`customThemes`), so older builds compare them by value and never restamp them. A custom theme joins the dark or light pick by its background's luminance. The theme-generation prompt is never logged or stored.
- The background image stays on the device (IndexedDB, never the profile), fades out at the countdown and dims mid-run (`e2e/wallpaper.spec.js`). It is stored in colour (a WebP at most 1024 px); one picked before background styles is a grey copy and shows grey until re-picked. Its style (regular, dither, gradient), blur (0–32 px), opacity (10–100%) and height (0–100%) are device settings stored beside it, never in the profile, and show only once there is an image. Dither, the default, is tinted by CSS from the theme; blur means nothing there and is disabled. Height moves where the fade ends on the practice screen, from the top of the reading band (countdown, passage and controls) at 0 to the bottom of the screen at 100; other screens keep 0. Above 0 the picture runs on behind the passage, the hints and the footer with no hole cut around them (Toby, 2026-10-23: the old cutout looked like a gap). Wherever the picture would take a letter, a mistyped letter on its tint or the caret below the contrast floor (WCAG relative luminance, the worst pixel under each region, counting style, tint, blur, opacity, height and the mid-run dim), that region (live figures, passage, key hints, footer items) gets `data-halo`: a `--wallpaper-halo` stroke in `--ground` under each letter and a ring round the caret. It is worked out from the pixels `wallpaper.js` already drew, when the image, look, theme, layout or running state changes, never per keystroke, and comes off where the picture is quiet or the dim makes it unnecessary. The e2e spec checks the floor at full height over the brightest image in every theme, viewport and style, that nothing is outlined over a quiet image, and that the picture is continuous behind the text (Toby, 2026-10-24: "letters get a black outline or some outline to make sure that there's contrast"). Blur, opacity and height are CSS on the layer, so a slider never redraws; the dither mask and gradient wash are drawn once per pick or style and again only when the screen's size in cells changes.
- The practice rail never moves between modes (`e2e/layout.spec.js`).
- A slow reply never acts over what the person did since (`raceContext`).
- Layouts are labels; people remap in the OS.
- `sw.js` stays network-first: cache-first ran new HTML against old JS.
- Only Literata and Geist Mono load by default: other fonts load when picked and are never precached (`tests/sw.test.js`). Carets stand on the typing font's measured baseline (`--typing-baseline`), not on Literata's metrics.

## Remaining work and known issues

- WebKit tape flake: "trimming and remounting passed words moves nothing on the line" (`e2e/tape-mode.spec.js`) fails about 1 in 3 WebKit runs: words shift 2–11 px for one keystroke. Needs real Safari.
- Real devices: Safari, touch keyboards, assistive technology and IME. Accent keys are only simulated (`e2e/dead-keys.spec.js`): check Safari, Windows Chrome, Linux IBus and macOS press-and-hold. Latency is measured only in Chromium.
- Leaked-password protection is off: Supabase offers it only on Pro. toby to decide.
- Signing out with everything sent also deletes this device's recordings. toby to decide whether to keep them.
- The worst-case profile row is about 2 MB, 1.5 MB from 2026-12-01, sent whole on every push (`scripts/measure-profile.mjs`). Don't grow retention.
- Vercel is retired (`vercel.json` turns off its deploys); toby can delete the project.
- Not built: public matchmaking, rankings, anti-cheat. The recommender is a baseline, not ML.
