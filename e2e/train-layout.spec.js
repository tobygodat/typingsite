// A run's result on Practice is one card: the score with its facts beside it (under it on a phone), the
// speed trace, the words typed, then Run again and the drill under a hairline. Before any run there is no
// print, and Train is the one general drill, centred.
import { test, expect, openApp, openView, chooseWords, completePassage, phone } from './fixtures.js';

const box = (page, selector) => page.locator(selector).boundingBox();

// Instant typing scores five-digit speeds that no run reaches, and those widen the run card; a fast
// person's pace keeps the score to three digits.
const atPace = { delay: 25 };
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

async function tabIntoTrace(page) {
  await expect(page.locator('#run-again')).toBeFocused();
  // Run again's focus brought it into view below the score, so the page has scrolled and the trace lies above it.
  expect(await page.evaluate(() => scrollY), 'focus scrolled the page').toBeGreaterThan(0);
  const inWords = () => page.evaluate(() => !!document.activeElement.closest('#result-words'));

  for (let presses = 0; presses < 6 && !(await inWords()); presses++) await page.keyboard.press('Shift+Tab');
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
  await expect(page.locator('#speed-graph')).toBeHidden();
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
  test(`at ${width}px a run fits the width as one card, the facts beside the score and the actions last`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openApp(page);
    await chooseWords(page, 10);
    await completePassage(page, atPace);
    await expect(page.locator('#speed-graph svg')).toBeVisible();

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const card = await box(page, '#run-card');
    const wpm = await box(page, '#result-wpm');
    const facts = await box(page, '.run-card-facts');
    const trace = await box(page, '#speed-graph');
    const words = await box(page, '#result-words');
    const actions = await box(page, '.result-actions');
    expect(facts.x).toBeGreaterThanOrEqual(wpm.x + wpm.width);
    expect(facts.y).toBeLessThan(wpm.y + wpm.height);
    expect(wpm.y + wpm.height).toBeLessThanOrEqual(trace.y);
    expect(trace.y + trace.height).toBeLessThanOrEqual(words.y);
    expect(words.y + words.height).toBeLessThanOrEqual(actions.y);
    expect(actions.y + actions.height).toBeLessThanOrEqual(card.y + card.height);
  });
}

test('at 1440px the facts share the score\'s row, the trace spans the card and the drill sits in its last row', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page, atPace);
  await expect(page.locator('#speed-graph svg')).toBeVisible();

  const card = await box(page, '#run-card');
  const wpm = await box(page, '#result-wpm');
  const facts = await box(page, '.run-card-facts');
  expect(facts.x).toBeGreaterThan(wpm.x + wpm.width);
  expect(facts.y + facts.height).toBeLessThanOrEqual(wpm.y + wpm.height + 4);
  const trace = await box(page, '#speed-graph');
  expect(trace.width).toBeGreaterThan(card.width * 0.85);
  const words = await box(page, '#result-words');
  const drill = await box(page, '#result-drill');
  expect(drill.y).toBeGreaterThan(Math.max(trace.y + trace.height, words.y + words.height));
  expect(drill.y + drill.height).toBeLessThanOrEqual(card.y + card.height);
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
  await page.setViewportSize({ width: 1280, height: 480 });
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await expect(page.locator('#results-heading')).toBeFocused();
  // A counted run's heading is visually hidden (a clipped 1px box), so check where it sits rather than what shows.
  const heading = await box(page, '#results-heading');
  expect(heading.y).toBeGreaterThanOrEqual(0);
  expect(heading.y + heading.height).toBeLessThanOrEqual(480);
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

  test('at 390px the card stacks: score, facts, speed graph, words, then the drill', async ({ page }, testInfo) => {
    await openApp(page);
    await chooseWords(page, 10);
    await completePassage(page, atPace);
    await expect(page.locator('#speed-graph svg')).toBeVisible();

    const wpm = await box(page, '#result-wpm');
    const facts = await box(page, '.run-card-facts');
    const graph = await box(page, '#speed-graph');
    const words = await box(page, '#result-words');
    const drill = await box(page, '#result-drill');
    expect(wpm.y + wpm.height).toBeLessThan(facts.y);
    expect(facts.y + facts.height).toBeLessThan(graph.y);
    expect(graph.y + graph.height).toBeLessThan(words.y);
    expect(words.y + words.height).toBeLessThan(drill.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath('train-390.png'), fullPage: true });
  });

  // Chromium centres a focused element it scrolls to; Safari scrolls only as far as it must, which
  // would park a word under the bottom dock. A nearest scroll stands in for Safari's focus scroll.
  test('at 390px a word scrolled up from below the fold stops above the dock', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 560 });
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

test('the conditions show at once; no metric notes, and the counts behind accuracy and consistency sit in their tooltips', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);

  await expect(page.locator('#result-conditions')).toBeVisible();
  await expect(page.locator('#run-card .metric-note')).toHaveCount(0);
  await expect(page.locator('#run-card details')).toHaveCount(0);
  await expect(page.locator('#result-accuracy-fact')).toHaveAttribute('title', /^0 first-try errors · final c\/i\/e\/m \d+\/0\/0\/0$/);
  await expect(page.locator('.run-card-facts > div', { has: page.locator('#result-consistency') })).toHaveAttribute('title', /^100 minus the variation/);
});
