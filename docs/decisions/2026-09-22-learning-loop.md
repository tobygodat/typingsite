# Learning loop and frontend direction

Accepted 22 September 2026, while implementing the design handoff.

## Keep the existing browser stack

Use native HTML, CSS and JavaScript modules with no runtime dependencies. The existing app is small enough that a framework would add migration work without solving a current problem. Keep scoring, event replay, text selection and training evidence independent of DOM rendering.

## One typing surface, distinct purposes

Practice, targeted drills and retests share the stable typing surface. A drill is a complete stage, with its own instructions and target-heavy text; it does not link directly from a result to a retest. Drill scores are excluded from comparable personal bests. A retest restores the baseline conditions and uses unseen text. Small samples and regressions receive explicit copy instead of a default success treatment.

Ash remains the visual authority: warm dark surfaces, Geist and Geist Mono, token typography and radii, blue actions and mint success states. The artboards determine composition, not application behavior. The deliberate 28px monospace typing-target treatment remains; optional sizes use the existing 22px and 36px tokens. Fonts are bundled locally under the SIL Open Font License.

## Enjoyment and competition

Keep the Monkeytype-inspired low-friction setup, configurable display and immediate restart, and make the keybr-inspired practice recommendation explain its observed evidence. Add a local, shared-keyboard two-player challenge: both players type the same text in turn and receive real results. This is explicitly local play, not a networked room or trusted ranking. Challenge scores do not become the guest's personal best.

Online friend rooms remain a separate stage requiring room lifecycle and multi-client validation. There is no backend, account requirement, paid infrastructure or deployment in this change.

## Validation

Run the existing scoring checks and use browser input to complete the solo learning loop and a two-player challenge. Inspect desktop and mobile layouts, preference persistence, keyboard/error handling, and clear-history confirmation with undo. Record observed outcomes in the verification report; do not claim learning efficacy or a measured latency budget without evidence.
