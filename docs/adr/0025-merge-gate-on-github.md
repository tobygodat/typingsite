# 0025. GitHub gates merges to master

Status: Accepted, 2026-11-16 (TOB-491).

## Context

Merges to master went through Entire trails: `entire trail create`, `entire trail ci-pr`, then `entire trail merge`. Pushes went through Entire's mirror of the GitHub repo. In practice only one of the trail's gates blocked, the one that requires named CI checks to pass. GitHub can enforce that itself, at no cost on a public repo.

The trail's list of required checks lived in Entire's web settings, which agents can't read or change. When [ADR 0024](0024-shorter-browser-run.md) renamed the browser checks, that list kept waiting on the old names, and nothing in the repo showed it.

## Decision

- A GitHub ruleset named `master` protects the default branch. It requires "Build", "Unit and build checks" and "Browser e2e", all from GitHub Actions (app id 15368), so a commit status with the same name can't satisfy them. Every change goes through a PR, merges are squash-only, and nobody can bypass the ruleset. The branch can't be deleted or force-pushed.
- The ruleset doesn't require a branch to be up to date with master, as the trail gate didn't.
- GitHub counts a skipped job's check as passing. "Browser e2e" always runs and fails unless the build, the unit job and the event's browser jobs succeeded, so a skipped job can't pass the gate.
- PRs open with `gh pr create` and merge with `gh pr merge --squash`, only on Toby's word. `origin` points at GitHub again.
- Entire still records agent sessions as checkpoints, and Brain and Graph are unchanged. Only the merge path and the push remote move.

## Consequences

- Agents can read the required checks with `gh api repos/tobygodat/typingsite/rulesets` and see a PR's state with `gh pr checks <n> --required`.
- Adding or renaming one of the three required jobs means editing the ruleset in the same change.
- Entire may still post an "Entire Gates" check on PRs. It isn't required, so it doesn't block a merge.
- Nobody, Toby included, can push straight to master or merge past a red required check without first editing the ruleset.
