import { web } from '@e2e-dev/web';
import type { E2EConfig } from 'e2e';

const port = process.env.E2E_PILOT_PORT ?? '4273';

export const appOrigin = `http://127.0.0.1:${port}`;

export default {
  targets: [
    {
      // The web engine blocks service workers when request headers are configured.
      engine: web({ headers: {} }),
      app: {
        url: appOrigin,
        command: {
          executable: process.execPath,
          args: ['server.mjs'],
          cwd: '../..',
          env: { PORT: port },
        },
      },
    },
  ],
  workers: 1,
} satisfies E2EConfig;
