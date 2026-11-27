# Stilltype e2e.com pilot (TOB-519)

This opt-in suite uses the official [e2e.com runner and web engine](https://github.com/e2e-inc/e2e). The Playwright specs and CI checks are unchanged, and nothing here runs in CI.

From the repository root, with Bun 1.4.2 and Node.js 24.8+:

```sh
bun install --frozen-lockfile
bun run build:dist
cd tools/e2e-pilot
npm ci --ignore-scripts
npx e2e-web install chromium firefox webkit
npm test
```

The runner starts the local build on port 4273 and writes a report under `.e2e/`. Set `E2E_PILOT_PORT` if 4273 is taken, and `E2E_PILOT_BROWSERS` to `chromium` (the default), `firefox`, `webkit` or a comma-separated list. Pass `--repeat-each`, `--retries` or a file name after `npm test --`.

The tests use the Playwright suite's fake Supabase (`e2e/fake-supabase.js`), which imports app sources by their `.js` names, so `npm test` loads tsx (from the root `node_modules`) to resolve them. Every test refuses requests to other origins. The ported tests also fail on a page error or `console.error` the page itself raises; unlike the Playwright fixture, they miss errors the browser logs on its own.

| Test | Ports |
| --- | --- |
| `practice.e2e.ts` | A guest finishes a ten-word Practice run |
| `word-highlight-slide.e2e.ts` | `e2e/word-highlight.spec.js` slide glide (TOB-188) |
| `social-slow-read.e2e.ts` | `e2e/social.spec.js` friend change behind a slow read (TOB-195) |
| `fonts-caret.e2e.ts` | `e2e/fonts.spec.js` Inter caret past the line scroll (TOB-423) |
| `studio-theme-abort.e2e.ts` | `e2e/studio-chrome.spec.js` theme generation abort (TOB-533), watched from the page's fetch, since e2e.com has no `requestfailed` event |

`e2e/dead-keys.spec.js`'s online race at its limit (TOB-193) is not ported: its guest needs a browser context of her own, and e2e.com's only second page is a tab that shares the host's session.

No keys, model provider, paid calls, live backend or runner telemetry are needed. Keep any future model-driven test separate from this deterministic baseline.
