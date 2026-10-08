import { test, expect, openApp, passageText, typeInto, chooseWords } from './fixtures.js';

async function finishWithCorrectedMiss(page) {
  await openApp(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  const at = [...text].findIndex((char, index) => index > 1 && /[a-z]/.test(char));
  const miss = text[at] === 'x' ? 'z' : 'x';
  await typeInto(page, text.slice(0, at) + miss, '#typing-input', { delay: 30 });
  // Hold the miss on screen long enough to see it in the replay.
  await page.waitForTimeout(1500);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text.slice(at), { delay: 30 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-errors')).toHaveText('1');
  return { text, at };
}

test('watch replay plays the run back and ends on the scored letters', async ({ page }) => {
  const { text, at } = await finishWithCorrectedMiss(page);
  await page.locator('#watch-replay').click();
  const dialog = page.locator('#replay-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-state', 'playing');
  await page.locator('#replay-speed').click();
  await expect(page.locator('#replay-speed')).toHaveText('2×');

  // The miss shows while it was on screen, then the backspace removes it.
  await expect(page.locator('#replay-text .char.wrong')).toHaveCount(1);
  await expect(page.locator('#replay-text .char').nth(at)).toHaveClass(/wrong/);

  await expect(dialog).toHaveAttribute('data-state', 'done', { timeout: 20000 });
  await expect(page.locator('#replay-text .char.wrong')).toHaveCount(0);
  await expect(page.locator('#replay-text .char.correct')).toHaveCount(text.length);
  await expect(page.locator('#replay-text .char.is-caret')).toHaveCount(1);
  await expect(page.locator('#replay-toggle')).toHaveText('Play');

  // Pause and restart work, and Esc closes.
  await page.locator('#replay-restart').click();
  await expect(dialog).toHaveAttribute('data-state', 'playing');
  await page.locator('#replay-toggle').click();
  await expect(dialog).toHaveAttribute('data-state', 'paused');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
});

test('under reduced motion the replay opens still, on the finished frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { text } = await finishWithCorrectedMiss(page);
  await page.locator('#watch-replay').click();
  const dialog = page.locator('#replay-dialog');
  await expect(dialog).toHaveAttribute('data-state', 'done');
  await expect(page.locator('#replay-toggle')).toHaveText('Play');
  await expect(page.locator('#replay-text .char.correct')).toHaveCount(text.length);
  // Playback is still there when asked for.
  await page.locator('#replay-toggle').click();
  await expect(dialog).toHaveAttribute('data-state', 'playing');
});

test('replay controls wrap inside the dialog at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await finishWithCorrectedMiss(page);
  await page.locator('#watch-replay').click();
  const dialog = page.locator('#replay-dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  for (const id of ['replay-toggle', 'replay-speed', 'replay-restart', 'replay-close']) {
    const button = await page.locator(`#${id}`).boundingBox();
    expect(button.x).toBeGreaterThanOrEqual(box.x);
    expect(button.x + button.width).toBeLessThanOrEqual(box.x + box.width);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

// Committed docs images are rewritten only on request (SCREENSHOTS=1); a normal run keeps its
// capture in the test output folder.
const shotPath = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/watch-replay/${name}` : testInfo.outputPath(name));

for (const theme of ['dark', 'light']) {
  test(`screenshot: replay mid-playback (${theme})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: theme });
    await finishWithCorrectedMiss(page);
    await page.locator('#watch-replay').click();
    const dialog = page.locator('#replay-dialog');
    // Catch the frame where the miss is on screen, then hold it there.
    await expect(page.locator('#replay-text .char.wrong')).toHaveCount(1);
    await page.locator('#replay-toggle').click();
    await expect(dialog).toHaveAttribute('data-state', 'paused');
    await page.screenshot({ path: shotPath(testInfo, `replay-${theme}.png`) });
  });
}
