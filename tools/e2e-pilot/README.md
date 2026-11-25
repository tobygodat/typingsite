# Stilltype e2e.com pilot (TOB-519)

This opt-in smoke test uses the official [e2e.com runner and web engine](https://github.com/e2e-inc/e2e). The existing Playwright specs and CI checks are unchanged.

From the repository root, with Bun 1.4.2 and Node.js 24.8+:

```sh
bun install --frozen-lockfile
bun run build:dist
cd tools/e2e-pilot
npm ci --ignore-scripts
npm test
```

The runner starts the local build on port 4273, installs its own Chromium on first use if needed, and writes a report under `.e2e/`. Set `E2E_PILOT_PORT` if 4273 is occupied. The test uses a fresh guest session, refuses requests to other origins, and finishes a ten-word Practice run by typing the passage and checking the results.

No keys, model provider, paid calls, live backend or runner telemetry are needed. Keep any future model-driven test separate from this deterministic baseline.
