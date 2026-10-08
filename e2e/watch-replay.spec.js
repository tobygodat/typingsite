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

for (const theme of ['dark', 'light']) {
  test(`screenshot: replay mid-playback (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: theme });
    await finishWithCorrectedMiss(page);
    await page.locator('#watch-replay').click();
    const dialog = page.locator('#replay-dialog');
    // Catch the frame where the miss is on screen, then hold it there.
    await expect(page.locator('#replay-text .char.wrong')).toHaveCount(1);
    await page.locator('#replay-toggle').click();
    await expect(dialog).toHaveAttribute('data-state', 'paused');
    await page.screenshot({ path: `docs/screenshots/watch-replay/replay-${theme}.png` });
  });
}
