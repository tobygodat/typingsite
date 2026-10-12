import { defineConfig, devices } from '@playwright/test';

// Browser verification for the shipped build. The app is served on 127.0.0.1 (not localhost), so
// generated runs never land in a real localhost profile, and Supabase is always faked (e2e/fake-supabase.js).
// CHROMIUM points at a system browser, as in scripts/measure-latency.mjs; otherwise run
// `npx playwright install chromium` once.
const port = Number(process.env.E2E_PORT || 4173);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    // The offline shell (sw.js) stays out of the way of the page.route fakes; e2e/pwa-offline.spec.js allows it.
    serviceWorkers: 'block',
    launchOptions: process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
  },
  webServer: {
    command: 'node server.mjs',
    env: { PORT: String(port) },
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !process.env.CI,
  },
});
