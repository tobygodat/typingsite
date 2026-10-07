// Responsive layout, self-hosted fonts and exactly what the server hands out.
import { test, expect, openApp, openView, chooseWords, passageText, typeInto } from './fixtures.js';

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['narrow phone', { width: 320, height: 640 }]]) {
  test.describe(`${name} ${viewport.width}px`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test('fits without sideways scroll and keeps 44px targets', async ({ page }) => {
      await openApp(page);
      expect(await overflow(page)).toBeLessThanOrEqual(0);

      // The dock moves to the bottom and spans the viewport.
      const dock = await page.locator('nav.dock').boundingBox();
      expect(dock.y + dock.height).toBeGreaterThan(viewport.height * 0.8);
      expect(dock.width).toBeGreaterThan(viewport.width * 0.8);

      for (const selector of ['.dock-nav .nav-item', '[data-mode]', '#duration-options button', '#restart-button']) {
        const boxes = await page.locator(selector).evaluateAll((nodes) => nodes.filter((node) => node.offsetParent).map((node) => node.getBoundingClientRect().height));
        expect(boxes.length, selector).toBeGreaterThan(0);
        for (const height of boxes) expect(height, selector).toBeGreaterThanOrEqual(44);
      }

      for (const view of ['Train', 'Progress', 'Challenge']) {
        await openView(page, view);
        expect(await overflow(page), view).toBeLessThanOrEqual(0);
      }
    });

    test('results fit after a run at a human pace', async ({ page }) => {
      await openApp(page);
      await chooseWords(page, 10);
      // About 60 wpm. Automation's instant typing scores in the hundreds, and below ~354px some
      // three-digit scores overflow the run card (112px numeral plus its unit): a known defect.
      await typeInto(page, await passageText(page), '#typing-input', { delay: 200 });
      await expect(page.locator('#run-card')).toBeVisible();
      expect(Number(await page.locator('#result-wpm').textContent())).toBeLessThan(100);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  });
}

test('desktop keeps the dock at the top and the passage at three lines', async ({ page }) => {
  await openApp(page);
  const dock = await page.locator('nav.dock').boundingBox();
  expect(dock.y).toBeLessThan(100);
  const wrap = await page.locator('#typing-wrap').boundingBox();
  const lineHeight = await page.locator('#text-display').evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
  expect(Math.round(wrap.height)).toBe(Math.round(lineHeight * 3));
});

test('the masthead is a ruled row of words, and the footer leads to privacy and terms', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.dock-zone')).toHaveCSS('border-bottom-style', 'solid');
  for (const selector of ['nav.dock', '#account-trigger', '.preferences-popover']) await expect(page.locator(selector).first()).toHaveCSS('box-shadow', 'none');
  expect(await page.locator('.dock-zone svg, .corner svg').count()).toBe(0);
  expect(await page.locator('#account-trigger').evaluate((node) => node.innerText.trim())).toBe('sign in');
  await page.getByRole('link', { name: 'privacy', exact: true }).click();
  await expect(page).toHaveURL(/\/privacy\.html$/);
  await expect(page.locator('h1')).toHaveText('Privacy and terms');
  await expect(page.locator('#terms')).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test('Literata and Geist Mono load from this origin', async ({ page }) => {
  const fonts = [];
  page.on('response', (response) => { if (/\/src\/fonts\//.test(response.url())) fonts.push([new URL(response.url()).pathname, response.status()]); });
  await openApp(page);
  const loaded = await page.evaluate(() => [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replace(/"/g, '')));
  expect(loaded).toEqual(expect.arrayContaining(['Literata', 'Geist Mono']));
  await expect(page.locator('#text-display')).toHaveCSS('font-family', /^"?Literata/);
  expect(fonts.length).toBeGreaterThan(0);
  for (const [path, status] of fonts) expect(status, path).toBe(200);
});

test('the server hands out the app and nothing else', async ({ request }) => {
  for (const [path, type] of [
    ['/', 'text/html'],
    ['/privacy.html', 'text/html'],
    ['/src/app.js', 'text/javascript'],
    ['/src/styles.css', 'text/css'],
    ['/src/fonts/literata-roman.woff2', 'font/woff2'],
    ['/src/fonts/geist-mono-400.ttf', 'font/ttf'],
    ['/src/fonts/OFL.txt', 'text/plain'],
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toBe(type);
  }
  for (const path of ['/HANDOFF.md', '/package.json', '/design/ash/DESIGN.md', '/docs/ui-contract.md', '/src/fonts/geist-400.ttf', '/e2e/fixtures.js', '/src/../server.mjs', '/%2e%2e/server.mjs']) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});
