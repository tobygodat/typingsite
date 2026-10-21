// Narrowing the window after a run: results and Progress fit the new width, and the charts redraw at
// their new pixel size instead of holding the page at the desktop width.
import { test, expect, openApp, openView, passageText, typeInto, chooseWords } from './fixtures.js';

// Committed screenshots are rewritten only with SCREENSHOTS=1; normal runs keep them in the test output.
const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/results-resize/${name}` : testInfo.outputPath(name));

// About 60 wpm, so the card shows a run a person could type.
async function finishRun(page) {
  await chooseWords(page, 10);
  await typeInto(page, await passageText(page), '#typing-input', { delay: 130 });
  await expect(page.locator('#run-card')).toBeVisible();
  await expect(page.locator('#speed-graph svg')).toBeVisible();
}

async function resize(page, viewport) {
  await page.setViewportSize(viewport);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

// The speed graph is drawn at its container's pixel width, so after a resize the two must agree.
const speedGraph = (page) => page.locator('#speed-graph').evaluate((graph) => {
  const svg = graph.querySelector('svg');
  return {
    container: graph.clientWidth,
    drawn: Number(svg.getAttribute('width')),
    shown: svg.getBoundingClientRect().width,
    height: Number(svg.getAttribute('height')),
    containerHeight: graph.clientHeight,
    traceRight: graph.closest('.run-trace').getBoundingClientRect().right,
  };
});

for (const [from, to] of [[{ width: 1280, height: 800 }, { width: 320, height: 568 }], [{ width: 768, height: 1024 }, { width: 375, height: 667 }]]) {
  test(`results fit after narrowing from ${from.width}px to ${to.width}px`, async ({ page }) => {
    await page.setViewportSize(from);
    await openApp(page);
    await finishRun(page);
    const wide = await speedGraph(page);

    await resize(page, to);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expect.poll(async () => (await speedGraph(page)).drawn).toBeLessThan(wide.drawn);
    const graph = await speedGraph(page);
    expect(Math.abs(graph.drawn - graph.container)).toBeLessThanOrEqual(1);
    expect(Math.abs(graph.shown - graph.container)).toBeLessThanOrEqual(1);
    // Redrawn at the new size, not squeezed: the drawing keeps the container's 16:9 height.
    expect(Math.abs(graph.height - graph.containerHeight)).toBeLessThanOrEqual(1);
    expect(graph.traceRight).toBeLessThanOrEqual(to.width);

    // And back out: the graph grows with the window again.
    await resize(page, from);
    await expect.poll(async () => (await speedGraph(page)).drawn).toBeGreaterThan(graph.drawn);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    if (to.width !== 320) return;

    // Progress opened at the desktop width, then narrowed: its trend charts follow the window down.
    await openView(page, 'Progress');
    await expect(page.locator('#progress-trend svg')).toHaveCount(1);
    await resize(page, to);
    expect(await overflow(page), 'Progress').toBeLessThanOrEqual(0);
    const trends = await page.locator('#progress-trend .trend-figure').evaluateAll((figures) => figures.map((figure) => ({
      figure: figure.clientWidth,
      shown: figure.querySelector('svg').getBoundingClientRect().width,
      drawn: Number(figure.querySelector('svg').getAttribute('viewBox').split(' ')[2]),
    })));
    for (const trend of trends) {
      expect(Math.abs(trend.shown - trend.figure)).toBeLessThanOrEqual(1);
      expect(trend.drawn).toBe(Math.max(280, trend.figure));
    }
  });
}

test('screenshots', async ({ page }, testInfo) => {
  test.skip(!process.env.SCREENSHOTS, 'docs screenshots only; run with SCREENSHOTS=1');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await finishRun(page);
  await page.waitForTimeout(600);
  await resize(page, { width: 320, height: 568 });
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.locator('#run-card').evaluate((node) => window.scrollTo(0, node.getBoundingClientRect().top + scrollY - 16));
  await page.screenshot({ path: shot(testInfo, 'results-320-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot(testInfo, 'results-320-light.png') });

  // Progress opened at the desktop width, then narrowed: its trend charts follow the window down.
  await resize(page, { width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openView(page, 'Progress');
  await expect(page.locator('#progress-trend svg')).toHaveCount(1);
  await resize(page, { width: 320, height: 568 });
  expect(await overflow(page), 'Progress').toBeLessThanOrEqual(0);
  const trends = await page.locator('#progress-trend .trend-figure').evaluateAll((figures) => figures.map((figure) => ({
    figure: figure.clientWidth,
    shown: figure.querySelector('svg').getBoundingClientRect().width,
    drawn: Number(figure.querySelector('svg').getAttribute('viewBox').split(' ')[2]),
  })));
  for (const trend of trends) {
    expect(Math.abs(trend.shown - trend.figure)).toBeLessThanOrEqual(1);
    expect(trend.drawn).toBe(Math.max(280, trend.figure));
  }
  await page.locator('#progress-trend').evaluate((node) => window.scrollTo(0, node.getBoundingClientRect().top + scrollY - 16));
  await page.screenshot({ path: shot(testInfo, 'progress-320-dark.png') });
});
