// Responsive layout, self-hosted fonts and exactly what the server hands out.
import { test, expect, openApp, openView, chooseWords, passageText, typeInto } from './fixtures.js';

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['narrow phone', { width: 320, height: 640 }]]) {
  test.describe(`${name} ${viewport.width}px`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test('fits without sideways scroll and keeps 44px targets', async ({ page }) => {
      await openApp(page);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      // The practice column itself never widens past its gutters (the document can't show that).
      for (const mode of ['time', 'standard']) {
        await page.locator(`#mode-${mode}`).click();
        expect(await page.locator('#typing-screen').evaluate((node) => node.scrollWidth - node.clientWidth), mode).toBeLessThanOrEqual(0);
      }
      await page.locator('#mode-time').click();

      // The dock moves to the bottom and spans the viewport.
      const dock = await page.locator('nav.dock').boundingBox();
      expect(dock.y + dock.height).toBeGreaterThan(viewport.height * 0.8);
      expect(dock.width).toBeGreaterThan(viewport.width * 0.8);

      for (const selector of ['.dock-nav .nav-item', '[data-mode]', '#duration-options button', '#restart-button']) {
        const boxes = await page.locator(selector).evaluateAll((nodes) => nodes.filter((node) => node.offsetParent).map((node) => node.getBoundingClientRect().height));
        expect(boxes.length, selector).toBeGreaterThan(0);
        for (const height of boxes) expect(height, selector).toBeGreaterThanOrEqual(44);
      }

      // The first-run "Learn to type" links sit inside a sentence and still give a finger 44px.
      const learnLinks = { Train: '#train-learn [data-action="open-lessons"]', Progress: '#progress-empty [data-action="open-lessons"]' };
      for (const view of ['Train', 'Progress', 'Challenge']) {
        await openView(page, view);
        expect(await overflow(page), view).toBeLessThanOrEqual(0);
        if (learnLinks[view]) expect((await page.locator(learnLinks[view]).boundingBox()).height, view).toBeGreaterThanOrEqual(44);
      }
    });

    test('results fit after a run at a human pace', async ({ page }) => {
      await openApp(page);
      await chooseWords(page, 10);
      // About 60 wpm, a human pace; automation's instant typing scores hundreds or thousands.
      // Three-digit scores at the narrowest width have their own check below.
      await typeInto(page, await passageText(page), '#typing-input', { delay: 200 });
      await expect(page.locator('#run-card')).toBeVisible();
      expect(Number(await page.locator('#result-wpm').textContent())).toBeLessThan(100);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  });
}

test.describe('narrow run card', () => {
  test.use({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });

  test('a three-digit score and its unit fit inside the run card at 320px', async ({ page }) => {
    await openApp(page);
    await chooseWords(page, 10);
    await typeInto(page, await passageText(page), '#typing-input', { delay: 120 });
    await expect(page.locator('#run-card')).toBeVisible();
    // Figures are tabular, so any three digits are as wide as 188. Under 360px the numeral steps
    // down to --text-numeral-narrow; 361 and 360 sit either side of that step. Narrowing from 390
    // also checks that the speed graph, drawn at its old width, gives the card back.
    await page.locator('#result-wpm').evaluate((node) => { node.textContent = '188'; });
    for (const width of [390, 361, 360, 320]) {
      await page.setViewportSize({ width, height: 640 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px page`).toBe(0);
      const fit = await page.evaluate(() => {
        const card = document.querySelector('#run-card');
        const style = getComputedStyle(card);
        const box = card.getBoundingClientRect();
        const inner = { left: box.left + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.paddingRight) };
        const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right }; };
        const score = document.querySelector('.run-card-score');
        return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          overflow: card.scrollWidth - card.clientWidth, score: score.scrollWidth - score.clientWidth,
          inner, numeral: rect('#result-wpm'), unit: rect('.run-card-unit'), card: { left: box.left, right: box.right },
          shell: rect('.app-shell') };
      });
      expect(fit.page, `${width}px page`).toBe(0);
      expect(fit.overflow, `${width}px card`).toBe(0);
      expect(fit.score, `${width}px score row`).toBe(0);
      // The card keeps inside the page gutters, give or take a sub-pixel.
      expect(fit.card.left, `${width}px card left`).toBeGreaterThanOrEqual(fit.shell.left - 0.5);
      expect(fit.card.right, `${width}px card right`).toBeLessThanOrEqual(fit.shell.right + 0.5);
      for (const part of ['numeral', 'unit']) {
        expect(fit[part].left, `${width}px ${part} left`).toBeGreaterThanOrEqual(fit.inner.left);
        expect(fit[part].right, `${width}px ${part} right`).toBeLessThanOrEqual(fit.inner.right);
      }
    }
  });
});

test('desktop keeps the dock at the top and the passage at three lines', async ({ page }) => {
  await openApp(page);
  const dock = await page.locator('nav.dock').boundingBox();
  expect(dock.y).toBeLessThan(100);
  const wrap = await page.locator('#typing-wrap').boundingBox();
  const lineHeight = await page.locator('#text-display').evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
  expect(Math.round(wrap.height)).toBe(Math.round(lineHeight * 3));
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
