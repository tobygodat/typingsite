import { web, type BrowserName } from '@e2e-dev/web';
import type { E2EConfig } from 'e2e';

const port = process.env.E2E_PILOT_PORT ?? '4273';
const engines = ['chromium', 'firefox', 'webkit'] satisfies BrowserName[];

const browsers = (process.env.E2E_PILOT_BROWSERS ?? 'chromium').split(',').map((name) => {
  const engine = engines.find((known) => known === name);

  if (!engine) throw new Error(`E2E_PILOT_BROWSERS: unknown engine ${name} (chromium, firefox or webkit)`);

  return engine;
});

export const appOrigin = `http://127.0.0.1:${port}`;

export default {
  targets: browsers.map((browser) => ({
    name: browser,
    // The web engine blocks service workers when request headers are configured, as the Playwright suite does.
    engine: web({ browser, headers: {}, viewport: { width: 1280, height: 800 } }),
    app: {
      url: appOrigin,
      command: {
        executable: process.execPath,
        args: ['server.mjs'],
        cwd: '../..',
        env: { PORT: port },
      },
    },
  })),
  workers: 1,
} satisfies E2EConfig;
