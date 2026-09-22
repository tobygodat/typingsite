# Stilltype

Focused typing, explained practice, and friendly local competition. The product connects **play → identify weak patterns → practice → retest on fresh text**. Monkeytype, keybr and TypeGG are influences, not a novelty claim.

## Run locally

Node.js 20 or newer; no dependency installation needed.

```sh
npm run dev
npm test
npm run build   # static build in dist/, used by Vercel
```

Open [localhost:5173](http://localhost:5173). Everything runs in the browser with local persistence. Fonts are bundled; the app has no external runtime service.

## Use it

1. Pick time, words or quote. Typing starts the clock; Backspace corrects mistakes and Escape restarts. Errors must be corrected before advancing.
2. Finish a run to see corrected WPM, input accuracy and observed pattern evidence. Small samples get a general drill, not a confident diagnosis.
3. Start the one-minute drill, or enter your own target. Manual drills also work before a baseline exists.
4. With a baseline, the drill opens an unseen retest under the original conditions. Results show changes, sample limits and whether the comparison is valid. A depleted quote pool does not reuse a quote as a fresh retest.
5. Open Progress for saved comparisons. Clear local history requires typing `clear` and offers an immediate Undo.

The settings control changes passage size, live metrics, the keyboard display and focus mode. Preferences survive reload. Focus mode has an explicit exit; Escape also leaves it.

Challenge supports two players taking turns on the same keyboard. Both receive the same original passage, hidden during handoff. Challenge scores stay separate from personal progress and bests. Online rooms are future work.

## Measurement and implementation

Corrected WPM counts correct retained characters divided by five and elapsed minutes. Input accuracy counts correct printable insertions out of all printable insertions, preserving errors after correction. First-attempt errors and clean pair timings are retained separately. Timing uses a monotonic clock; interruptions exclude a run from comparable results. See [PRODUCT.md](PRODUCT.md) for the contract.

The app uses native HTML/CSS/JavaScript. [Ash](design/ash/DESIGN.md) supplies the dark palette, typography, geometry and component rules. The canvas artboards remain reference material, not served code.

- [Current handoff](HANDOFF.md)
- [Implementation decision](docs/decisions/2026-09-22-learning-loop.md)
- [Browser verification](docs/verification/2026-09-22-browser.md)
- [MVP specification](docs/mvp-spec.md)
- [Staged roadmap](docs/implementation-plan.md)
- [Research summary](docs/research/summary.md)
- [ML evaluation plan](docs/ml-data-evaluation.md)

There is no learned recommender, online matchmaking, account service or deployment. An immediate retest is feedback, not proof of lasting learning.
