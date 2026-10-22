import { defineConfig, devices } from '@playwright/test';

// Browser verification for the shipped build. The app is served on 127.0.0.1 (not localhost), so
// generated runs never land in a real localhost profile, and Supabase is always faked (e2e/fake-supabase.js).
// CHROMIUM points at a system browser, as in scripts/measure-latency.mjs; otherwise run
// `npx playwright install chromium` once.
// Chromium runs by default. E2E_BROWSERS picks engines (comma-separated, or `all`), so a plain
// `npx playwright test` stays Chromium-only; Firefox and WebKit need `npx playwright install firefox webkit`.
const port = Number(process.env.E2E_PORT || 4173);
const engines = {
  chromium: {
    ...devices['Desktop Chrome'],
    launchOptions: process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
  },
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
};
const wanted = (process.env.E2E_BROWSERS || 'chromium').split(',').map((name) => name.trim());
const names = wanted.includes('all') ? Object.keys(engines) : wanted;
const unknown = names.filter((name) => !engines[name]);
if (unknown.length) throw new Error(`E2E_BROWSERS: unknown engine ${unknown.join(', ')} (chromium, firefox, webkit or all)`);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    // The offline shell (sw.js) stays out of the way of the page.route fakes; e2e/pwa-offline.spec.js allows it.
    serviceWorkers: 'block',
  },
  projects: names.map((name) => ({
    name,
    use: { ...engines[name], viewport: { width: 1280, height: 800 } },
  })),
  webServer: {
    command: 'node server.mjs',
    env: { PORT: String(port) },
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !process.env.CI,
  },
});
