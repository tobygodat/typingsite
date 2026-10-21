// The Train view after a run: on a wide screen the score and the trace print side by side with the
// drill below; on a phone the drill comes straight after the score, before the trace.
import { test, expect, openApp, openView, chooseWords, completePassage } from './fixtures.js';

const box = (page, selector) => page.locator(selector).boundingBox();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

async function tabIntoTrace(page) {
  await expect(page.locator('#run-again')).toBeFocused();
  const before = await page.evaluate(() => scrollY);
  const inWords = () => page.evaluate(() => !!document.activeElement.closest('#result-words'));
  for (let presses = 0; presses < 6 && !(await inWords()); presses++) await page.keyboard.press('Tab');
  expect(await inWords(), 'a trace word has focus').toBe(true);
  // Run again's focus brought it into view below the score, so the trace word lies above it.
  expect(await page.evaluate(() => scrollY), 'focus scrolled the page').not.toBe(before);
  return page.evaluate(() => document.activeElement.getBoundingClientRect().top);
}

// Before any run there is no print: no trace, no shared frame, and the drill copy takes the whole width.
// The frame only exists from 901px, so narrower screens check the rest.
async function expectNoPrint(page) {
  await expect(page.locator('#run-card')).toBeHidden();
  await expect(page.locator('.run-trace')).toBeHidden();
  const view = await page.locator('.results-layout').evaluate((grid) => {
    const frame = getComputedStyle(grid, '::before');
    const style = getComputedStyle(grid);
    return { frame: frame.display === 'none' || parseFloat(frame.borderTopWidth) === 0,
      content: grid.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      drill: document.querySelector('.results-drill').getBoundingClientRect().width };
  });
  if (page.viewportSize().width >= 901) expect(view.frame, 'no card frame').toBe(true);
  expect(Math.abs(view.drill - view.content), 'drill spans the content width').toBeLessThanOrEqual(1);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
}

test('before any run at 1440px there is no print and the drill takes the whole width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await openView(page, 'Train');
  await expectNoPrint(page);
});

for (const width of [901, 800]) {
  test(`at ${width}px a run fits the width with the score and the trace ${width > 900 ? 'side by side' : 'stacked around the drill'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openApp(page);
    await chooseWords(page, 10);
    await completePassage(page);
    await expect(page.locator('#speed-graph svg')).toBeVisible();

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const score = await box(page, '#run-card');
    const trace = await box(page, '.run-trace');
    const drill = await box(page, '.results-drill');
    if (width > 900) {
      expect(trace.x).toBeGreaterThanOrEqual(score.x + score.width);
      expect(Math.abs(trace.y - score.y)).toBeLessThanOrEqual(4);
    } else {
      expect(score.y + score.height).toBeLessThanOrEqual(drill.y);
      expect(drill.y + drill.height).toBeLessThanOrEqual(trace.y);
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
  const drill = await box(page, '#start-drill');
  expect(drill.y).toBeGreaterThan(Math.max(score.y + score.height, traceTop.y + traceTop.height));
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath('train-1440.png'), fullPage: true });
});

test('at 1440px tabbing from Run again into the trace stops below the dock', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  const top = await tabIntoTrace(page);
  const dock = await box(page, 'nav.dock');
  expect(top).toBeGreaterThanOrEqual(dock.y + dock.height);
});

// Focus goes to the next step only when it fits on screen with the score; otherwise to the result heading,
// so the score never scrolls away. The restart key works from either.
test('after a run Run again takes focus when it fits under the score, and the heading does when it can’t', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await expect(page.locator('#results-heading')).toBeFocused();
  await expect(page.locator('#results-heading')).toBeInViewport({ ratio: 1 });
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
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('at 390px the result heading takes focus and the score stays in view', async ({ page }) => {
    await openApp(page);
    await chooseWords(page, 10);
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
    const drill = await box(page, '#start-drill');
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

  test('before any run at 390px there is no print and the drill takes the whole width', async ({ page }) => {
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
