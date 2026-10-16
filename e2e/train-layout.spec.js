// The Train view after a run: on a wide screen the score and the trace print side by side with the
// drill below; on a phone the drill comes straight after the score, before the trace.
import { test, expect, openApp, chooseWords, completePassage } from './fixtures.js';

const box = (page, selector) => page.locator(selector).boundingBox();

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

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

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
