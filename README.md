# Stilltype

Focused typing, explained practice, and friendly online and local competition. The product connects **play → identify weak patterns → practice → retest on fresh text**. Monkeytype, keybr and TypeGG are influences, not a novelty claim.

## Run locally

Node.js 20 or newer. The app itself has no dependencies; `npm install` is only needed for the browser tests.

```sh
npm run dev
npm test
npm run build   # static build in dist/, used by Vercel
npm run test:e2e   # Playwright browser verification (e2e/), after npm install
```

The browser tests need a Chromium: run `npx playwright install chromium` once, or point `CHROMIUM` at a system build (`CHROMIUM=/usr/bin/chromium npm run test:e2e`). They serve the app on `127.0.0.1:4173` and fake Supabase, so no account or network is touched.

Open [localhost:5173](http://localhost:5173). The interface and solo practice run in the browser. Accounts and online races use Supabase. Fonts are bundled: Literata (OFL, `src/fonts/OFL-literata.txt`) and Geist Mono.

## Use it

1. Pick time, words or quote. Typing starts the clock; Backspace corrects mistakes and Escape restarts. Errors must be corrected before advancing.
2. Finish a run to see corrected WPM, input accuracy and observed pattern evidence. Small samples get a general drill, not a confident diagnosis.
3. Start the one-minute drill, or enter your own target. Manual drills also work before a baseline exists.
4. With a baseline, the drill opens an unseen retest under the original conditions. Results show changes, sample limits and whether the comparison is valid. A depleted quote pool does not reuse a quote as a fresh retest.
5. Open Progress for WPM and accuracy trends, weekly medians, run details and expandable comparisons. Filter by exact test conditions and the last 7 days, 30 days or all saved runs. Select a chart point to open its run. Comparisons include before/after scores, the drill, and timing sample counts, with an action to practice the target again.

Train also shows recurring letter pairs across recent matching runs. Each target names its error counts, observed runs, last practice and any fresh observations since its last retest. A retained compatible run supplies the baseline when you choose an old target; otherwise the drill is standalone and says so.

Clear history requires typing `clear` and offers an immediate Undo. It includes daily results. Signed-in accounts retain 1,000 compact run summaries and pattern counts for the newest 120 runs, alongside 24 full attempt traces. Comparisons remain until cleared. Guests keep this history only for the tab.

Signed in, **Delete my account** in the account menu (or "delete account…" in the command palette) requires typing `delete`. The server deletes the account first, and its profile, race rooms, race seats and friend rows go with it; only then does this device sign out and clear that account's cache. If anything fails, including a server that hasn't been set up for it yet, the dialog says so and nothing changes. There is no undo. Feature suggestions were never linked to an account, so they stay.

Press ⌘K (Ctrl-K on Windows and Linux) for commands: go to a view, restart, change the test mode or length, toggle punctuation, switch theme or text size, toggle live metrics, the keyboard or focus mode, and clear local history; signed in, also sign out or delete the account. Opening it mid-run takes that run out of comparisons.

The settings control changes theme (system, dark or light), passage size, live metrics, the keyboard display and focus mode. Preferences survive reload. Focus mode has an explicit exit; Escape also leaves it.

Choose **Daily** in Challenge for a passage shared by every visitor, selected by the UTC date from a frozen pool of 14 original texts. It resets at midnight UTC and uses the same continue-on-error rule for everyone. The daily run leaves your practice settings intact. Results label first and repeat attempts, show a personal daily best for matching physical-keyboard conditions, and sync to a signed-in account. When a passage returns after 14 days, it keeps its identity and is labelled previously displayed; a first attempt today does not make old text fresh training evidence. Daily scores stay separate from practice trends and bests; a result can still lead into a drill and fresh quote retest.

Challenge opens **Online** play. Sign in to host, enter a race name, then either enter another account’s email for an in-app invitation or leave it blank to create a guest link. The recipient opens Challenge to accept an account invitation; a guest opens the link and chooses a name without signing up. Both players press Ready, then share a five-second countdown and a race of up to one minute. Progress and final results update across devices. Account invitations are delivered inside the app, not by email.

A guest link admits one opponent. After joining, a separate tab-scoped credential lets that guest reconnect without allowing someone else with the invitation link to take their seat. Leaving closes the room for both players. These are friendly, unranked races; scores never enter personal progress or bests. Choose **One keyboard** for the original local challenge.

The backend migration is in `supabase/migrations/20260930085227_online_races.sql`; deploy it to the Supabase project configured in `src/account.js` before serving the updated frontend. It provides one `race_action` RPC over protected private tables, so static hosting needs no WebSocket server or new runtime dependency. See [online race implementation and verification](docs/online-races.md).

Account deletion runs in the Edge Function `supabase/functions/delete-account/`. Deploy it with `supabase functions deploy delete-account`, keeping the default JWT verification. Apply `supabase/migrations/20261009140000_forget_deleted_race_opener.sql` with it (`supabase db push`): every foreign key to `auth.users` already cascades, and that migration clears the one user id kept as text, the quota key on rooms. `supabase/tests/account-deletion.sql` checks both. Until it is deployed, Delete my account reports that deletion isn't switched on yet and deletes nothing.

GitHub Actions runs unit tests, the static build and Chromium browser checks on pull requests and pushes to `master`. Browser failure traces are retained for seven days.

## Measurement and implementation

Corrected WPM counts correct retained characters divided by five and elapsed minutes. Input accuracy counts correct printable insertions out of all printable insertions, preserving errors after correction. First-attempt errors and clean pair timings are retained separately. Timing uses a monotonic clock; interruptions exclude a run from comparable results. See [PRODUCT.md](PRODUCT.md) for the contract.

The app uses native HTML/CSS/JavaScript. Its visual system, Afterimage (Literata on warm near-black or paper, one green accent, a still typing surface), is set by the tokens at the top of `src/styles.css` and described in [DESIGN.md](DESIGN.md). Corpus v5 has 39 original quotes, at least three in every length/difficulty bucket, plus a broader real-word drill vocabulary. Difficulty labels describe the text; they are not calibrated performance scores. The former Ash system (`design/ash/`) and the canvas artboards remain historical reference, not served code.

- [Current handoff](HANDOFF.md)
- [Implementation decision](docs/decisions/2026-09-22-learning-loop.md)
- [Browser verification](docs/verification/2026-09-29-browser.md)
- [MVP specification](docs/mvp-spec.md)
- [Staged roadmap](docs/implementation-plan.md)
- [Research summary](docs/research/summary.md)
- [ML evaluation plan](docs/ml-data-evaluation.md)

Accounts use Supabase Auth (email/password and Google) with one row-level-secured profile per user; guests save nothing, and members can delete their account and everything saved to it themselves. There is no learned recommender or public matchmaking. An immediate retest is feedback, not proof of lasting learning.
