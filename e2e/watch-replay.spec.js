import { test, expect, openApp, passageText, typeInto, chooseWords, completePassage, openSettings } from './fixtures.js';

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

  // The miss shows while it was on screen (1.5 s), then the backspace removes it. Catch it at 1×:
  // at 2× it is up for well under a second, too short to poll for reliably.
  await expect(page.locator('#replay-text .char.wrong')).toHaveCount(1);
  await expect(page.locator('#replay-text .char').nth(at)).toHaveClass(/wrong/);
  await page.locator('#replay-speed').click();
  await expect(page.locator('#replay-speed')).toHaveText('2×');

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

test('in focus mode, one Escape closes the replay and focus mode stays on', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await page.locator('#focus-toggle').check();
  // Clicking the passage closes the settings popover, which would otherwise take the first Escape.
  await page.locator('#typing-input').click();
  await expect(page.locator('.preferences-popover')).toBeHidden();
  await completePassage(page);
  await expect(page.locator('body')).toHaveAttribute('data-focus-mode', 'true');

  await page.locator('#watch-replay').click();
  await expect(page.locator('#replay-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#replay-dialog')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-focus-mode', 'true');
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

// The mounted letters, the caret's place among them, and whether the caret sits on one of the
// first two of the three visible lines.
const replayWindow = (page) => page.locator('#replay-text').evaluate((node) => {
  const chars = [...node.querySelectorAll('.char')];
  const caret = chars.find((char) => char.classList.contains('is-caret'));
  const box = node.getBoundingClientRect();
  const line = parseFloat(getComputedStyle(node).lineHeight);
  const at = caret.getBoundingClientRect();
  return {
    text: chars.map((char) => char.textContent).join(''),
    caret: chars.indexOf(caret),
    lines: Math.round(box.height / line),
    caretShown: at.top >= box.top && at.bottom <= box.top + line * 2 && box.bottom <= innerHeight,
  };
});

test('a long timed run replays in a three-line window that follows the caret', async ({ page }) => {
  test.setTimeout(60_000); // 640 typed letters take a while
  await page.clock.install();
  await openApp(page);
  await page.locator('#duration-options [data-length="120"]').click();
  await expect(page.locator('#condition-line')).toContainText('120 s');
  const text = await passageText(page);
  expect(text.split(' ')).toHaveLength(1600);
  // Where the caret is in the passage: the mounted letters occur once in it.
  const caretAt = (view) => text.indexOf(view.text) + view.caret;

  // Time stands still while typing: 80 letters at each whole second, 640 in all, then the idle
  // tail to 120 s.
  await page.clock.pauseAt(Date.now() + 1000);
  await page.locator('#typing-input').focus();
  for (let at = 0; at < 640; at += 80) {
    await page.keyboard.type(text.slice(at, at + 80));
    await page.clock.fastForward(1000);
  }
  await page.clock.fastForward(120_000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');

  await page.locator('#watch-replay').click();
  const dialog = page.locator('#replay-dialog');
  await expect(dialog).toHaveAttribute('data-state', 'playing');
  // A short stretch is mounted, not the whole passage, and three lines show.
  expect(await page.locator('#replay-text .char').count()).toBeLessThan(600);
  let view = await replayWindow(page);
  expect(view.lines).toBe(3);
  expect(view.caretShown).toBe(true);
  expect(caretAt(view)).toBe(80);

  // Several lines in, the window has moved with the caret and still lines up with the passage.
  await page.clock.fastForward(5500);
  view = await replayWindow(page);
  expect(view.caretShown).toBe(true);
  expect(text.indexOf(view.text)).toBeGreaterThan(0);
  expect(caretAt(view)).toBe(480);
  await expect(page.locator('#replay-text .char.correct')).toHaveCount(view.caret);

  await page.clock.fastForward(120_000);
  await expect(dialog).toHaveAttribute('data-state', 'done');
  view = await replayWindow(page);
  expect(view.caretShown).toBe(true);
  expect(caretAt(view)).toBe(640);
  await expect(page.locator('#replay-text .char.correct')).toHaveCount(view.caret);

  // Restart goes back to the top of the passage.
  await page.locator('#replay-restart').click();
  view = await replayWindow(page);
  expect(text.startsWith(view.text)).toBe(true);
  expect(view.caretShown).toBe(true);
});

// Committed docs images are rewritten only on request (SCREENSHOTS=1); a normal run keeps its
// capture in the test output folder.
const shotPath = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/watch-replay/${name}` : testInfo.outputPath(name));

// For the screenshots: a 50-word run typed at a steady human pace (about 75 wpm) on a paused
// clock, with one miss a few lines in that stays on screen for a beat before the backspace.
async function finishLongRunWithMiss(page) {
  await page.clock.install();
  await openApp(page);
  await chooseWords(page, 50);
  const text = await passageText(page);
  const at = [...text].findIndex((char, index) => index > 160 && /[a-z]/.test(char));
  const miss = text[at] === 'x' ? 'z' : 'x';
  await page.clock.pauseAt(Date.now() + 1000);
  await page.locator('#typing-input').focus();
  const typeAtPace = async (keys) => {
    for (const key of keys) {
      await page.keyboard.type(key);
      await page.clock.fastForward(key === ' ' ? 190 : 100 + (key.charCodeAt(0) % 4) * 12);
    }
  };
  await typeAtPace(text.slice(0, at) + miss);
  await page.clock.fastForward(700);
  await page.keyboard.press('Backspace');
  await page.clock.fastForward(150);
  await typeAtPace(text.slice(at));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-errors')).toHaveText('1');
}

for (const theme of ['dark', 'light']) {
  test(`screenshot: replay mid-playback (${theme})`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: theme });
    await finishLongRunWithMiss(page);
    await page.locator('#watch-replay').click();
    const dialog = page.locator('#replay-dialog');
    await expect(dialog).toHaveAttribute('data-state', 'playing');
    // Play up to the miss, a little into it, then hold that frame.
    const wrong = page.locator('#replay-text .char.wrong');
    for (let step = 0; step < 600 && !(await wrong.count()); step += 1) await page.clock.fastForward(100);
    await page.clock.fastForward(300);
    await expect(wrong).toHaveCount(1);
    await page.locator('#replay-toggle').click();
    await expect(dialog).toHaveAttribute('data-state', 'paused');
    const view = await replayWindow(page);
    expect(view.lines).toBe(3);
    expect(view.caretShown).toBe(true);
    await page.screenshot({ path: shotPath(testInfo, `replay-${theme}.png`) });
  });
}
