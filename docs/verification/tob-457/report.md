# TOB-457 independent final proof — PASS+NOTES

Checkout: /home/tobygodat/.t3/worktrees/typingsite/t3-eb036340-cf85ac1c87aada8e; detached HEAD a1b47e5e8611a28656d3b904dc7b4c68a9cf371f. PR head confirmed identical. Source remained clean. PR open; GitHub reports CLEAN and no review decision.

## Existing checks

`gh run list --workflow=ci.yml --commit a1b47e5e8611a28656d3b904dc7b4c68a9cf371f --limit 20`; `gh run view 43357477949 --json headSha,conclusion,jobs,url`; `gh run view 43357568653 --json headSha,conclusion,jobs,url`. Both head SHAs match and conclude success. First has successful unit/build (including lint and typecheck) and Chromium 1–6/6; second has successful Firefox and WebKit selected compatibility. No full suites were repeated. The three supplied targeted logs show 2, 4, and 3 passing cases respectively, covering refusal of unsupported ghost conditions, scoped geometry, visible Progress focus, and font baseline in Chromium/Firefox/WebKit.

## Artifact and browser

Commands: `npm ci --no-audit --no-fund`; `npm run build`; `PORT=4595 npm run dev`. The latter builds and serves dist via server.mjs. `agent-browser skills get core` initially failed under Node 26.13.1; `mise exec node@26.12.0 -- agent-browser skills get core` succeeded. Preview status was unavailable. All browser commands used `mise exec node@26.12.0 -- agent-browser --session tob457final`. Before opening localhost, `network route '**/supabase.co/**' --abort` blocked real Supabase. Browser closed and server stopped.

- `open http://localhost:4595/`, choose words then 10 words, focus `#typing-input`, read `#accessible-passage`, `keyboard type` its actual text. Run summary displayed WPM, 100% accuracy, time, and speed graph; Run again yielded a different passage. Screenshot practice.png. Automated typing was extremely fast, so its WPM and elapsed time are not human performance measurements.
- Train > Drill and retest; typed actual prefix and waited 31 seconds with the real clock. Fresh retest was 10 words, english 200, plain, physical keyboard, continue on error, matching original practice. Navigated Progress > Train > Practice; the exact prepared retest passage remained. Typed the passage; comparison showed retest, accuracy, WPM and change. Screenshot train-comparison.png.
- Settings: chose dark, midnight, JetBrains Mono; checked selected values and computed preview font. `set viewport 320 700`; document scrollWidth and innerWidth both 320, dialog scrollWidth and clientWidth both 302. Screenshot settings-320.png. Escape closed dialog and restored focus to #settings-trigger.
- Challenge > One keyboard, filled Ada and Lin, started, and typed “The broken chair” into native challenge field. Ada's turn appeared, field held the typed text; 320px document width remained 320.
- `console`, `errors`, and `network requests` saved alongside report. Only console info was the app's easter-egg message; errors output was empty. Observed requests were localhost assets with HTTP 200; no Supabase requests occurred. Network route would abort any matching request.

## Lifecycle and migration seam

`CHROMIUM=/usr/bin/chromium E2E_PORT=4596 npx playwright test e2e/application-lifetime.spec.js --project=chromium --workers=1`: one passed. The test dispatches simulated dead-key/composition events to a detached field after disposal, verifies no storage write, and verifies one run/attempt on remount. It is not a physical OS IME/device proof. Inspected React root and lifecycle, typed learning and practice stores, Effect scoped async runtime, native input leases and disposal (aborts listeners, clears timers and composition); document.fonts.ready remeasures baseline and relayouts only while lifetime active. Browser TypeScript is included under strict tsconfig; service worker is separately included in strict worker config. No broad any, ts-nocheck/ignore, or legacy initializer found in the bounded inspection. Historical legacy data handling remains present. Ghost decoder validates supported conditions at launch while stored historical records retain condition objects; Progress targeted focus results and scoped geometry selectors inspected. No demonstrated in-scope blocker found.

Limitations: simulated keyboard input and composition are not a physical keyboard/OS IME check; no real Supabase connection or authenticated flow was attempted. The previous-head account-deletion retry described in the task was not repeated; no deletion failure was demonstrated here. Browser screenshots and observation files are in this directory.
