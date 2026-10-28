# 0012. npm and Node, and CI on a self-hosted runner

Status: Accepted, 2026-10-27.

## Context

Toby's project standard (TGstack `new-project`) defaults a web app to bun, Vite, Cloudflare Workers and Supabase. Stilltype predates it. It uses npm and Node, has no bundler, and runs CI on a self-hosted runner because GitHub-hosted runners are blocked by billing (TOB-147).

## Decision

- Keep npm (`package-lock.json`) and Node (`node --test`, `server.mjs`) instead of bun. The app has no runtime dependencies, so a switch would buy little.
- Keep no bundler instead of Vite (see [0001](0001-native-browser-stack-and-learning-loop.md)).
- Hosting already matches the standard: a Cloudflare Worker serving `dist/` (`wrangler.jsonc`), with Supabase for data and auth.
- CI and the master deploy run on the self-hosted runner on tobygdesktop (`.github/workflows/ci.yml`). Fork PRs never run there.
- Lint is oxlint with the anti-slop plugin, as the standard asks.

## Consequences

- Commands in `AGENTS.md` and `docs/CONVENTIONS.md` are npm scripts.
- When the desktop runner is down, checks don't run and master doesn't deploy. `docs/CONVENTIONS.md` has the deploy-by-hand steps.
- Moving to bun or Vite would need a new ADR that supersedes this one.
