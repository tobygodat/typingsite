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
5. Open Progress for saved comparisons. Clear local history requires typing `clear` and offers an immediate Undo.

Press ⌘K (Ctrl-K on Windows and Linux) for commands: go to a view, restart, change the test mode or length, toggle punctuation, switch theme or text size, toggle live metrics, the keyboard or focus mode, and clear local history. Opening it mid-run takes that run out of comparisons.

The settings control changes theme (system, dark or light), passage size, live metrics, the keyboard display and focus mode. Preferences survive reload. Focus mode has an explicit exit; Escape also leaves it.

Challenge opens online play. Sign in to host, enter a race name, then either enter another account’s email for an in-app invitation or leave it blank to create a guest link. The recipient opens Challenge to accept an account invitation; a guest opens the link and chooses a name without signing up. Both players press Ready, then share a five-second countdown and a race of up to one minute. Progress and final results update across devices. Account invitations are delivered inside the app, not by email.

A guest link admits one opponent. After joining, a separate tab-scoped credential lets that guest reconnect without allowing someone else with the invitation link to take their seat. Leaving closes the room for both players. These are friendly, unranked races; scores never enter personal progress or bests. Choose **One keyboard** for the original local challenge.

The backend migration is in `supabase/migrations/20260930085227_online_races.sql`; deploy it to the Supabase project configured in `src/account.js` before serving the updated frontend. It provides one `race_action` RPC over protected private tables, so static hosting needs no WebSocket server or new runtime dependency. See [online race implementation and verification](docs/online-races.md).

## Measurement and implementation

Corrected WPM counts correct retained characters divided by five and elapsed minutes. Input accuracy counts correct printable insertions out of all printable insertions, preserving errors after correction. First-attempt errors and clean pair timings are retained separately. Timing uses a monotonic clock; interruptions exclude a run from comparable results. See [PRODUCT.md](PRODUCT.md) for the contract.

The app uses native HTML/CSS/JavaScript. Its visual system, Afterimage (Literata on warm near-black or paper, one green accent, a still typing surface), is set by the tokens at the top of `src/styles.css` and summarised in [PRODUCT.md](PRODUCT.md); `DESIGN.md` will be written from the shipped build. The former Ash system (`design/ash/`) and the canvas artboards remain historical reference, not served code.

- [Current handoff](HANDOFF.md)
- [Implementation decision](docs/decisions/2026-09-22-learning-loop.md)
- [Browser verification](docs/verification/2026-09-29-browser.md)
- [MVP specification](docs/mvp-spec.md)
- [Staged roadmap](docs/implementation-plan.md)
- [Research summary](docs/research/summary.md)
- [ML evaluation plan](docs/ml-data-evaluation.md)

Accounts use Supabase Auth (email/password and Google) with one row-level-secured profile per user; guests save nothing. There is no learned recommender or public matchmaking. An immediate retest is feedback, not proof of lasting learning.
