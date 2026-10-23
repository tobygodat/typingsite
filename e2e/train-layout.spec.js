// A run's result on Practice: on a wide screen the score and the trace print side by side with Run again
// and the drill below; on a phone the actions come straight after the score, before the trace. Before any
// run there is no print, and Train is the one general drill, centred.
import { test, expect, openApp, openView, chooseWords, completePassage, phone } from './fixtures.js';

const box = (page, selector) => page.locator(selector).boundingBox();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

async function tabIntoTrace(page) {
  await expect(page.locator('#run-again')).toBeFocused();
  // Run again's focus brought it into view below the score, so the page has scrolled and the trace lies above it.
  expect(await page.evaluate(() => scrollY), 'focus scrolled the page').toBeGreaterThan(0);
  const inWords = () => page.evaluate(() => !!document.activeElement.closest('#result-words'));
  for (let presses = 0; presses < 6 && !(await inWords()); presses++) await page.keyboard.press('Tab');
  expect(await inWords(), 'a trace word has focus').toBe(true);
  return page.evaluate(() => {
    const word = document.activeElement.getBoundingClientRect();
    return { top: word.top, bottom: word.bottom };
  });
}

// Before any run there is no print: no score, no trace, and Train holds only the general drill, its block
// spanning the screen's content width with the heading and the one button centred in it.
async function expectNoPrint(page) {
  await expect(page.locator('#run-card')).toBeHidden();
  await expect(page.locator('.run-trace')).toBeHidden();
  await expect(page.locator('#train-heading')).toHaveText('General drill');
  await expect(page.locator('#start-drill')).toBeVisible();
  await expect(page.locator('#train-last')).toBeHidden();
  await expect(page.locator('#comparison-panel')).toBeHidden();
  const view = await page.locator('#train-screen').evaluate((screen) => {
    const style = getComputedStyle(screen);
    const box = (selector) => document.querySelector(selector).getBoundingClientRect();
    const centre = (rect) => rect.left + rect.width / 2;
    return { content: screen.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      block: box('#train-next').width, middle: centre(box('#train-next')),
      heading: centre(box('#train-heading')), drill: centre(box('#start-drill')) };
  });
  expect(Math.abs(view.block - view.content), 'the drill block spans the content width').toBeLessThanOrEqual(1);
  expect(Math.abs(view.heading - view.middle), 'heading centred').toBeLessThanOrEqual(1);
  expect(Math.abs(view.drill - view.middle), 'button centred').toBeLessThanOrEqual(1);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
}

test('before any run at 1440px there is no print and Train is the general drill, centred', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await openView(page, 'Train');
  await expectNoPrint(page);
});

for (const width of [901, 800]) {
  test(`at ${width}px a run fits the width with the score and the trace ${width > 900 ? 'side by side' : 'stacked around Run again and the drill'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openApp(page);
    await chooseWords(page, 10);
    await completePassage(page);
    await expect(page.locator('#speed-graph svg')).toBeVisible();

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const score = await box(page, '#run-card');
    const trace = await box(page, '.run-trace');
    const actions = await box(page, '.result-actions');
    if (width > 900) {
      expect(trace.x).toBeGreaterThanOrEqual(score.x + score.width);
      expect(Math.abs(trace.y - score.y)).toBeLessThanOrEqual(4);
    } else {
      expect(score.y + score.height).toBeLessThanOrEqual(actions.y);
      expect(actions.y + actions.height).toBeLessThanOrEqual(trace.y);
    }
  });
}

test('at 1440px the score and the trace share a row and the drill sits below them', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await expect(page.locator('#speed-graph svg')).toBeVisible();

  const score = await box(page, '#run-card');
  const trace = await box(page, '#speed-graph');
  expect(trace.x).toBeGreaterThan(score.x + score.width);
  const traceTop = await box(page, '.run-trace');
  expect(Math.abs(traceTop.y - score.y)).toBeLessThanOrEqual(4);
  const drill = await box(page, '#result-drill');
  expect(drill.y).toBeGreaterThan(Math.max(score.y + score.height, traceTop.y + traceTop.height));
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath('train-1440.png'), fullPage: true });
});

// 700px tall, so Run again's focus scrolls the page and the trace lies above it.
test('at 1440px tabbing from Run again back into the trace stops below the dock', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  const word = await tabIntoTrace(page);
  const dock = await box(page, 'nav.dock');
  expect(word.top).toBeGreaterThanOrEqual(dock.y + dock.height);
  expect(word.bottom).toBeLessThanOrEqual(700);
});

// Focus goes to the next step only when it fits on screen with the score; otherwise to the result heading,
// so the score never scrolls away. The restart key works from either.
test('after a run Run again takes focus when it fits under the score, and the heading does when it can’t', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await expect(page.locator('#results-heading')).toBeFocused();
  // A counted run's heading is visually hidden (a clipped 1px box), so check where it sits rather than what shows.
  const heading = await box(page, '#results-heading');
  expect(heading.y).toBeGreaterThanOrEqual(0);
  expect(heading.y + heading.height).toBeLessThanOrEqual(600);
  await expect(page.locator('#result-wpm')).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await completePassage(page);
  await expect(page.locator('#results-heading')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');

  await page.setViewportSize({ width: 1280, height: 1100 });
  await completePassage(page);
  await expect(page.locator('#run-again')).toBeFocused();
  await expect(page.locator('#run-again')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#result-wpm')).toBeInViewport({ ratio: 1 });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, ...phone });

  test('at 390px Run again takes focus under the score, and on a short phone the heading does; the score stays in view', async ({ page }) => {
    await openApp(page);
    await chooseWords(page, 10);
    await completePassage(page);
    await expect(page.locator('#run-again')).toBeFocused();
    await expect(page.locator('#run-again')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#result-wpm')).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');

    await page.setViewportSize({ width: 390, height: 560 });
    await completePassage(page);
    await expect(page.locator('#results-heading')).toBeFocused();
    await expect(page.locator('#result-wpm')).toBeInViewport({ ratio: 1 });
  });

  test('at 390px the drill comes after the score and before the speed graph', async ({ page }, testInfo) => {
    await openApp(page);
    await chooseWords(page, 10);
    await completePassage(page);
    await expect(page.locator('#speed-graph svg')).toBeVisible();

    const wpm = await box(page, '#result-wpm');
    const drill = await box(page, '#result-drill');
    const graph = await box(page, '#speed-graph');
    expect(wpm.y + wpm.height).toBeLessThan(drill.y);
    expect(drill.y + drill.height).toBeLessThan(graph.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath('train-390.png'), fullPage: true });
  });

  // Chromium centres a focused element it scrolls to; Safari scrolls only as far as it must, which
  // would park a word under the bottom dock. A nearest scroll stands in for Safari's focus scroll.
  test('at 390px a word scrolled up from below the fold stops above the dock', async ({ page }) => {
    await openApp(page);
    await chooseWords(page, 10);
    await completePassage(page);
    const word = await page.locator('#result-words [role="option"]').first().evaluate((node) => {
      window.scrollTo(0, 0);
      node.scrollIntoView({ block: 'nearest' });
      return { bottom: node.getBoundingClientRect().bottom, scrolled: scrollY };
    });
    const dock = await box(page, 'nav.dock');
    expect(word.scrolled, 'the word started below the fold').toBeGreaterThan(0);
    expect(word.bottom).toBeLessThanOrEqual(dock.y);
  });

  test('before any run at 390px there is no print and Train is the general drill, centred', async ({ page }) => {
    await openApp(page);
    await openView(page, 'Train');
    await expectNoPrint(page);
  });
});

test('the wpm note and the conditions show at once; the other counts open on request', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);

  const notes = page.locator('#run-card .metric-note');
  await expect(notes.first()).toBeVisible();
  await expect(notes.first()).toContainText('wpm counts correct characters kept');
  await expect(page.locator('#result-conditions')).toBeVisible();

  const more = page.locator('#run-card details:has(.metric-note)');
  await expect(more).not.toHaveAttribute('open');
  await expect(notes.nth(1)).toBeHidden();
  await more.locator('summary').click();
  await expect(notes.nth(1)).toBeVisible();
  await expect(notes.nth(1)).toContainText('consistency is 100 minus');
});
