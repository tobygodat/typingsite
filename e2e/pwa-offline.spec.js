import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { test, expect, openApp, passageText, typeInto } from './fixtures.js';

// The offline shell: once sw.js has installed, the app reloads and types with no connection.
test.use({ serviceWorkers: 'allow' });

// Offline here means the site is unreachable: each test serves the app itself and stops that server.
// context.setOffline can't stand in for it beyond Chromium: Firefox then fails the worker's cache
// fallback too, and WebKit fails every navigation.
async function ownServer() {
  const port = await new Promise((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  await expect.poll(() => fetch(url).then((response) => response.status, () => 0)).toBe(200);
  return { url, stop: () => new Promise((resolve) => (server.exitCode === null ? server.once('exit', resolve).kill() : resolve())) };
}

async function goOffline(page) {
  const server = await ownServer();
  try {
    await openApp(page, server.url);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['stilltype-shell-v1']);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  } finally {
    await server.stop();
  }
  expect(await fetch(server.url).then(() => 'reachable', () => 'unreachable')).toBe('unreachable');
  const response = await page.reload();
  expect(response.fromServiceWorker()).toBe(true);
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

test('the app installs, reloads offline and still types', async ({ page }) => {
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'Stilltype', start_url: '/', display: 'standalone', background_color: '#0f0f0e' });
  await goOffline(page);
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 5));
  await expect(page.locator('#text-display .char.correct')).toHaveCount(5);
  await page.keyboard.press('Escape');
  await expect(page.locator('#typing-input')).toHaveValue('');
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#palette')).toBeHidden();
});

// A deploy changes the scripts and stylesheet under the same paths. The worker that already controls the
// page must hand over the deployed files, not its cached copies: cached app.js under a newer index.html
// crashed before drawing the passage, so the text vanished on the first visit after a deploy.
test('a deploy reaches a page the worker already controls', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright routes a service worker’s own fetches only in Chromium, so nothing here can stand in for a deploy');
  await openApp(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  // context.route also sees the worker's own fetches, so this stands in for the next deploy.
  const deploy = (path, extra) => context.route(path, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n${extra}\n` });
  });
  await deploy('**/src/styles.css', ':root { --deployed: next; }');
  await deploy('**/src/app.js', "document.documentElement.dataset.deployed = 'next';");
  const response = await page.reload();
  expect(response.fromServiceWorker()).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-deployed', 'next');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--deployed').trim())).toBe('next');
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  // Offline, the copies this visit fetched answer instead.
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-deployed', 'next');
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await context.setOffline(false);
});

// Committed docs are only rewritten on purpose (SCREENSHOTS=1); a normal run writes to the test output dir.
const shot = (testInfo, name) =>
  process.env.SCREENSHOTS ? `docs/screenshots/pwa-offline/${name}.png` : testInfo.outputPath(`${name}.png`);

test('screenshots', async ({ page }, testInfo) => {
  test.skip(!process.env.SCREENSHOTS, 'docs screenshots only; run with SCREENSHOTS=1');
  await page.emulateMedia({ colorScheme: 'dark' });
  await goOffline(page);
  await page.screenshot({ path: shot(testInfo, 'offline-dark') });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: shot(testInfo, 'offline-light') });
});
