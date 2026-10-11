# Product versions and What’s new

`src/release.js` is the canonical product version and the concise user-facing notes for the app artifact. The footer and dialog read the same module. Private npm package metadata mirrors the version; a Node test prevents drift. The static build copies these modules unchanged and includes them in the hashed offline shell.

## Proposed versus deployed

This PR proposes **0.2.0**; it does not establish that production runs 0.2.0. The previous private package value, 0.1.0, was not a verified production release identifier. A preview shows the version of its own artifact. A live site shows the version bundled in that deployment; an offline visitor may still have an older cached artifact. A PR, merge, Git tag or build alone is not evidence of deployment. Verify the footer on the actual production URL after an explicitly authorized deployment, and record its commit and deployment URL in the release record. This feature does not deploy or create tags.

## Maintain substantive releases

For each substantive feature PR, include a short proposed user-facing bullet and a version impact in its PR description. Before the next release, the release owner reconciles these against the final included commits, updates `src/release.js` and the matching version in `package.json` / `package-lock.json`, and runs the checks. Use patch for fixes, minor for backward-compatible product additions and major for breaking product changes. While pre-1.0, use minor for substantial changes to existing behavior. Several PRs may share one planned release; do not bump for every internal refactor or docs-only PR.

The panel shows the current release’s additions/changes, not a sprint log. Use short sentences a typist can understand. Include only changes in that artifact: merged base changes plus the feature proposed by the PR. Reconcile again if master moves or scope changes. Never copy unmerged feature claims, held PRs, implementation chores or aspirational roadmap items. Keep older release details in Git history or a separate release record so the panel stays concise.

The proposed 0.2.0 bullets describe the pace cursor (PR25), offline/installable app (PR26), and this footer panel. PR19 and PR21 need their own bullets only if included in the eventual release. PR23/24/27/28 and docs-only PR29 are excluded.

## Checks

Run `npm test`, `npm run build` and `npm run test:e2e`. Check keyboard opening, Close / Escape / backdrop dismissal, restored focus, repeated opening, interaction inside the panel, dark/light themes, narrow and short screens, and offline loading. New served modules must be in `sw.js`’s shell list. Any deployment verification is a separate authorized action.
