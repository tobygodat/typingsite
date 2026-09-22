# typingsite

A typing product exploring one connected loop: **play → identify weak patterns → practice → measure improvement on fresh text**.

The goal is a useful product with substantial engineering and ML depth: Monkeytype-inspired typing feel, keybr-style targeted learning, TypeRacer-style competition, and TypeGG-inspired difficulty and progression. These are influences, not a claim that the combined features are novel.

## Run the typing page

Requires Node.js 20 or newer. No dependencies or install step are needed.

```sh
npm run dev
```

Open http://localhost:5173. Run scoring and text-generation checks with `npm test`.

## Project status

The first typing-only slice is implemented as **Stilltype**, a working title. It includes timed tests, word-count tests, original short passages, optional punctuation, live WPM and accuracy, results, restart via Escape, an optional keyboard display, and the supplied palette. A compact top bar holds the logo and practice settings, with the typing test centered below. A keyboard icon below the test toggles the optional keyboard display. Best WPM is stored locally when browser storage is available; clearing it offers an undo action. Desktop entry focuses the typing field, while touch entry waits for a tap. There are no accounts or backend integrations.

The page uses native HTML/CSS and JavaScript modules. `src/typing.js` separates text generation and scoring from the UI in `src/app.js`. WPM uses correct characters divided by five and elapsed minutes; accuracy includes incorrect attempts even after correction. Timing starts with the first input, continues when unfocused, and uses a monotonic clock. Paste is disabled for practice. The local best is an informal maximum across all modes, not a comparable ranking.

The documents below remain broader planning references; their later milestones are not implemented by this first slice.

## Start here

| Document | Purpose |
| --- | --- |
| [Research summary](docs/research/summary.md) | Findings, differentiation hypothesis, caveats, and original idea |
| [MVP specification](docs/mvp-spec.md) | First user journey, scope, acceptance criteria, essential decisions |
| [Implementation plan](docs/implementation-plan.md) | Staged delivery and validation gates |
| [ML and evaluation plan](docs/ml-data-evaluation.md) | Event data, transparent baseline, modeling, learning evaluation |
| [Full research brief](docs/research/typing-platform-brief.md) | Readable extraction with all 16 linked sources |
| [Original Word brief](docs/research/typing-platform-brief.docx) | Unmodified three-page research artifact |

The documentation is self-contained. Start implementation, when requested, with the solo typing-to-practice loop in milestone 1; add competition after timing, scoring, and progress are trustworthy.

## Design system

UI styles use the supplied dark-only [Ash design system](design/ash/DESIGN.md). `src/styles.css` imports its canonical tokens and component references from `design/ash/styles.css` and `design/ash/components/components.css`. Geist and Geist Mono load through the supplied Google Fonts import, with the system-defined fallbacks when unavailable. The archive specimens are retained as reference assets and are not executed by the app.
