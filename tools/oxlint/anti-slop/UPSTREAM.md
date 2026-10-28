# Upstream

- Source: the `install-anti-slop` skill in `tobygodat/TGstack`, `skills/install-anti-slop/assets/anti-slop/`, at commit `9050c5466961bfaba6831166f3cedafb13a5689f`.
- Installed with that skill's `scripts/install.mjs` on 2026-10-27, unchanged.
- Registered: `index.ts` (generic rules). `effect/` is copied but not registered, since the app has no `effect` dependency.
- Local deviations: none in these files. Rules turned off, and why, are in `.oxlintrc.json`.
- Built against `oxlint` and `@oxlint/plugins` 1.90.0, pinned together in `package.json`.
