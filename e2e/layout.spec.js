// Responsive layout, self-hosted fonts and exactly what the server hands out.
import { test, expect, openApp, openView, chooseWords, chooseMore, passageText, typeInto, freshTextCheck, phone } from './fixtures.js';

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['narrow phone', { width: 320, height: 640 }]]) {
  test.describe(`${name} ${viewport.width}px`, () => {
    test.use({ viewport, ...phone });

    test('fits without sideways scroll and keeps 44px targets', async ({ page }) => {
      await page.clock.install();
      await openApp(page);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      // The practice column itself never widens past its gutters (the document can't show that).
      const columnOverflow = () => page.locator('#typing-screen').evaluate((node) => node.scrollWidth - node.clientWidth);
      expect(await columnOverflow(), 'time').toBeLessThanOrEqual(0);
      await chooseMore(page, 'mode-standard');
      expect(await columnOverflow(), 'standard').toBeLessThanOrEqual(0);
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

      // The first-run "Learn to type" link sits inside a sentence and still gives a finger 44px.
      const learnLinks = { Progress: '#progress-empty [data-action="open-lessons"]' };

      for (const view of ['Train', 'Progress', 'Challenge']) {
        await openView(page, view);
        expect(await overflow(page), view).toBeLessThanOrEqual(0);

        // To 1/100 px: Firefox lays out in 1/60 px units, so a 44px box can measure 43.99999.
        if (learnLinks[view]) expect(Math.round((await page.locator(learnLinks[view]).boundingBox()).height * 100) / 100, view).toBeGreaterThanOrEqual(44);
      }

      // At the narrowest width, the same views with a run, a comparison and the daily in them.
      if (viewport.width === 320) {
        await openView(page, 'Practice');
        await freshTextCheck(page);

        for (const view of ['Progress', 'Train', 'Challenge']) {
          await openView(page, view);

          if (view === 'Challenge') await page.locator('#challenge-daily').click();
          expect(await overflow(page), `${view} with a run`).toBeLessThanOrEqual(0);
        }
      }
    });
  });
}

for (const width of [320, 360]) test.describe(`live stats at ${width}px`, () => {
  test.use({ viewport: { width, height: 640 }, ...phone });

  test('the widest built-in figures fit mid-run without widening the column', async ({ page }) => {
    await openApp(page);
    await chooseWords(page, 25);
    await typeInto(page, (await passageText(page)).slice(0, 20));
    await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
    // Written and measured in one task, so the run's own tick can't rewrite them in between: a
    // three-digit speed with every built-in length, and a four-digit cpm against the clock.
    const cases = [['25', '/25', '188', 'wpm'], ['100', '/100', '999', 'wpm'], ['100', '/100', '999', 'cpm'], ['120', 's', '1999', 'cpm']];

    for (const shown of cases) {
      const fit = await page.evaluate(([timer, count, speed, unit]) => {
        document.getElementById('timer').textContent = timer;
        document.getElementById('timer-unit').textContent = count;
        document.getElementById('live-wpm').textContent = speed;
        document.querySelector('#live-stats [data-speed-unit]').textContent = unit;
        document.getElementById('live-accuracy').textContent = '100';
        const column = document.getElementById('typing-screen');

        return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, column: column.scrollWidth - column.clientWidth };
      }, shown);

      expect(fit, shown.join(' ')).toEqual({ page: 0, column: 0 });
    }
  });
});

test.describe('narrow run card', () => {
  test.use({ viewport: { width: 320, height: 640 }, ...phone });

  test('a three-digit score and its unit fit inside the run card at 320px', async ({ page }) => {
    await openApp(page);
    await chooseWords(page, 10);
    await typeInto(page, await passageText(page));
    await expect(page.locator('#run-card')).toBeVisible();
    // Figures are tabular, so any three digits are as wide as 188. Under 360px the numeral steps
    // down to --text-numeral-narrow; 361 and 360 sit either side of that step. Narrowing from 390
    // also checks that the speed graph, drawn at its old width, gives the trace back.
    await page.locator('#result-wpm').evaluate((node) => { node.textContent = '188'; });

    for (const width of [390, 361, 360, 320]) {
      await page.setViewportSize({ width, height: 640 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px page`).toBe(0);

      const fit = await page.evaluate(() => {
        const card = document.querySelector('#run-card');
        const style = getComputedStyle(card);
        const box = card.getBoundingClientRect();
        const inner = { left: box.left + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.paddingRight) };

        const rect = (selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();

          return { left: r.left, right: r.right };
        };

        const score = document.querySelector('.run-card-score');

        return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          overflow: card.scrollWidth - card.clientWidth, score: score.scrollWidth - score.clientWidth,
          inner, numeral: rect('#result-wpm'), unit: rect('.run-card-unit'), card: { left: box.left, right: box.right },
          trace: rect('.run-card-graph'), traceOverflow: document.querySelector('.run-card-graph').scrollWidth - document.querySelector('.run-card-graph').clientWidth,
          shell: rect('.app-shell') };
      });

      expect(fit.page, `${width}px page`).toBe(0);
      expect(fit.overflow, `${width}px card`).toBe(0);
      expect(fit.score, `${width}px score row`).toBe(0);
      // The card and the trace keep inside the page gutters, give or take a sub-pixel.
      expect(fit.card.left, `${width}px card left`).toBeGreaterThanOrEqual(fit.shell.left - 0.5);
      expect(fit.card.right, `${width}px card right`).toBeLessThanOrEqual(fit.shell.right + 0.5);
      expect(fit.traceOverflow, `${width}px trace`).toBe(0);
      expect(fit.trace.left, `${width}px trace left`).toBeGreaterThanOrEqual(fit.shell.left - 0.5);
      expect(fit.trace.right, `${width}px trace right`).toBeLessThanOrEqual(fit.shell.right + 0.5);

      for (const part of ['numeral', 'unit']) {
        expect(fit[part].left, `${width}px ${part} left`).toBeGreaterThanOrEqual(fit.inner.left);
        expect(fit[part].right, `${width}px ${part} right`).toBeLessThanOrEqual(fit.inner.right);
      }
    }
  });
});

// The typing surface does not shift: switching modes never moves the rail, and the copy-test modes
// keep the passage's first line where it was.
for (const [width, height] of [[1280, 800], [390, 844], [320, 568]]) {
  test.describe(`modes at ${width}x${height}`, () => {
    test.use({ viewport: { width, height }, ...(width < 760 ? phone : {}) });

    test('switching modes moves neither the rail nor the passage', async ({ page }) => {
      await openApp(page);

      const place = () => page.evaluate(() => ({
        rail: document.querySelector('.mode-options').getBoundingClientRect().top,
        line: document.querySelector('#compose-form').hidden ? document.querySelector('#text-display .char').getBoundingClientRect().top : null,
      }));

      const start = await place();

      const modes = [
        ['words', () => page.locator('#mode-words').click()],
        ['quote', () => page.locator('#mode-quote').click()],
        ['code', () => chooseMore(page, 'mode-code')],
        ['standard', () => chooseMore(page, 'mode-standard')],
        ['compose', () => chooseMore(page, 'mode-compose')],
        ['custom text', () => chooseMore(page, 'mode-custom')],
        ['time', () => page.locator('#mode-time').click()],
      ];

      for (const [mode, choose] of modes) {
        await choose();
        await page.evaluate(() => window.scrollTo(0, 0));
        const now = await place();
        expect(Math.abs(now.rail - start.rail), `${mode} rail`).toBeLessThanOrEqual(1);

        if (['words', 'quote', 'code', 'standard', 'time'].includes(mode)) expect(Math.abs(now.line - start.line), `${mode} passage`).toBeLessThanOrEqual(1);
      }
    });
  });
}

test.describe('lesson on a 320x568 phone', () => {
  test.use({ viewport: { width: 320, height: 568 }, ...phone });

  test('the passage starts above the bottom dock without scrolling', async ({ page }) => {
    await openApp(page);
    await chooseMore(page, 'open-lessons');
    await page.locator('#lesson-primary').click();
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'lesson');

    const { line, dock, scrolled } = await page.evaluate(() => ({
      line: document.querySelector('#text-display .char').getBoundingClientRect().toJSON(),
      dock: document.querySelector('nav.dock').getBoundingClientRect().top,
      scrolled: window.scrollY,
    }));

    expect(scrolled).toBe(0);
    expect(line.top).toBeGreaterThanOrEqual(0);
    expect(line.bottom).toBeLessThanOrEqual(dock);
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

  for (const path of ['/AGENTS.md', '/package.json', '/design/ash/DESIGN.md', '/docs/ui-contract.md', '/src/fonts/geist-400.ttf', '/e2e/fixtures.js', '/src/../server.mjs', '/%2e%2e/server.mjs']) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});
