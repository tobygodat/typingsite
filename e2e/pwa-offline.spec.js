import { test, expect, openApp, passageText, typeInto } from './fixtures.js';

// The offline shell: once sw.js has installed, the app reloads and types with no connection.
test.use({ serviceWorkers: 'allow' });

async function goOffline(page, context) {
  await openApp(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['stilltype-shell-v1']);
  await context.setOffline(true);
  // Chromium can report onLine=true in the new document after a service-worker reload,
  // despite network requests still failing. Verify the transition and cached response instead.
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  const response = await page.reload();
  expect(response.fromServiceWorker()).toBe(true);
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

test('the app installs, reloads offline and still types', async ({ page, context }) => {
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'Stilltype', start_url: '/', display: 'standalone', background_color: '#0f0f0e' });
  await goOffline(page, context);
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
  await context.setOffline(false);
});

// Committed docs are only rewritten on purpose (SCREENSHOTS=1); a normal run writes to the test output dir.
const shot = (testInfo, name) =>
  process.env.SCREENSHOTS ? `docs/screenshots/pwa-offline/${name}.png` : testInfo.outputPath(`${name}.png`);

test('screenshots', async ({ page, context }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await goOffline(page, context);
  await page.screenshot({ path: shot(testInfo, 'offline-dark') });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: shot(testInfo, 'offline-light') });
  await context.setOffline(false);
});
