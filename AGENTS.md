## Start here
Read HANDOFF.md first — current state, the work queue, and the decisions already made.
PRODUCT.md holds durable product truth (users, purpose, metric contract, accessibility floor).

## Design system
Follow design/ash/DESIGN.md for all UI. Tokens are in design/ash/styles.css (imports tokens/*.css);
reference component CSS in design/ash/components/components.css. Never invent colours,
type sizes or radii — use the CSS variables. Dark-only.

design/canvas/ holds the proposed redesign as reference artboards; it is design reference,
not application code, and nothing there is served or tested.
