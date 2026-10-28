# 0001. Native browser stack and the learning loop

Status: Accepted, 2026-09-22. The visual-system paragraph is superseded by [0002](0002-afterimage-design-system.md).

Converted from `docs/decisions/2026-09-22-learning-loop.md`, written while implementing the design handoff.

## Context

The app was small, with no framework. The design handoff asked for a full solo loop (practice, drill, retest) and some competition. It also had to decide how far the first stage would go toward a backend.

## Decision

**Keep the existing browser stack.** Use native HTML, CSS and JavaScript modules with no runtime dependencies. The existing app is small enough that a framework would add migration work without solving a current problem. Keep scoring, event replay, text selection and training evidence independent of DOM rendering.

**One typing surface, distinct purposes.** Practice, targeted drills and retests share the stable typing surface. A drill is a complete stage, with its own instructions and target-heavy text. It does not link directly from a result to a retest. Drill scores are excluded from comparable personal bests. A retest restores the baseline conditions and uses unseen text. Small samples and regressions get explicit copy instead of a default success treatment.

**Visual system (superseded by 0002).** Ash remained the visual authority: warm dark surfaces, Geist and Geist Mono, token typography and radii, blue actions and mint success states. The artboards determined composition, not behaviour. The 28px monospace typing target stayed, with optional 22px and 36px sizes. Fonts are bundled locally under the SIL Open Font License.

**Enjoyment and competition.** Keep the Monkeytype-inspired low-friction setup, configurable display and immediate restart. Make the keybr-inspired practice recommendation explain its observed evidence. Add a local, shared-keyboard two-player challenge: both players type the same text in turn and get real results. This is explicitly local play, not a networked room or trusted ranking. Challenge scores do not become the guest's personal best.

Online friend rooms were a separate stage, needing room lifecycle and multi-client validation. This change added no backend, account requirement, paid infrastructure or deployment.

**Validation.** Run the scoring checks and use browser input to complete the solo loop and a two-player challenge. Inspect desktop and mobile layouts, preference persistence, keyboard and error handling, and clear-history confirmation with undo. Record observed outcomes, and claim no learning efficacy or latency budget without evidence.

## Consequences

- No bundler or framework: `server.mjs` serves the checkout as is, and `npm run build` only copies files into `dist/`. This differs from the default stack's Vite, and is kept.
- Scoring stays testable in Node (`tests/`), with no DOM.
- Online races, accounts and deployment came later, in their own changes.
