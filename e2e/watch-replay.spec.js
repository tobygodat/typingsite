import { quoteCorpus } from '../src/typing.js';
import { test, expect, openApp, passageText, typeInto, chooseWords, completePassage, openSettings, openView, chooseMore } from './fixtures.js';

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

// The run card's numbers and the replay's stats, as shown.
const runCard = async (page) => ({
  wpm: await page.locator('#result-wpm').textContent(),
  accuracy: await page.locator('#result-accuracy').textContent(),
  errors: await page.locator('#result-errors').textContent(),
});
const replayStats = async (page) => ({
  wpm: await page.locator('#replay-wpm').textContent(),
  accuracy: await page.locator('#replay-accuracy').textContent(),
  errors: await page.locator('#replay-errors').textContent(),
});

test('watch replay plays the run back and ends on the scored letters', async ({ page }) => {
  const { text, at } = await finishWithCorrectedMiss(page);
  const card = await runCard(page);
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
  expect(await replayStats(page)).toEqual(card);

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
  const card = await runCard(page);
  await page.locator('#watch-replay').click();
  const dialog = page.locator('#replay-dialog');
  await expect(dialog).toHaveAttribute('data-state', 'done');
  await expect(page.locator('#replay-toggle')).toHaveText('Play');
  await expect(page.locator('#replay-text .char.correct')).toHaveCount(text.length);
  expect(await replayStats(page)).toEqual(card);
  await expect(page.locator('#replay-stats-label')).toHaveText(`${card.wpm} wpm, ${card.accuracy}% accuracy, 1 error`);
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

test('Watch replay plays the run the results show, not a drill whose retest was unavailable', async ({ page }) => {
  // Exhaust the gentle medium quotes (as in learning-loop.spec.js), so the drill's retest is refused.
  const pool = quoteCorpus.filter((quote) => quote.difficulty === 'gentle' && quote.text.split(/\s+/).length > 30 && quote.text.split(/\s+/).length <= 60);
  const texts = new Set(pool.map((quote) => quote.text));
  const seen = new Set();
  const note = async () => { const text = await passageText(page); if (texts.has(text)) seen.add(text); };
  await page.clock.install();
  await openApp(page);
  // Before any run there is nothing to replay.
  await openView(page, 'train');
  await expect(page.locator('#watch-replay')).toBeHidden();
  await openView(page, 'practice');
  await page.locator('#mode-quote').click();
  await note();
  await page.locator('#quote-length').selectOption('medium');
  await note();
  await page.locator('#quote-difficulty').selectOption('gentle');
  for (let tries = 0; seen.size < pool.length && tries < pool.length + 3; tries += 1) {
    await note();
    if (seen.size < pool.length) await page.locator('#restart-button').click();
  }
  expect(seen.size).toBe(pool.length);
  const baseline = await completePassage(page);

  await page.locator('#start-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  const drill = await passageText(page);
  await typeInto(page, drill.slice(0, 12));
  await page.clock.fastForward(60_000);
  await expect(page.locator('#comparison-panel')).toHaveAttribute('data-outcome', 'unavailable');

  // The results still describe the baseline, so that is what plays.
  await page.locator('#watch-replay').click();
  await expect(page.locator('#replay-dialog')).toBeVisible();
  await expect(page.locator('#replay-text')).toHaveText(baseline);
  await page.keyboard.press('Escape');
  await expect(page.locator('#replay-dialog')).toBeHidden();
});

test('a custom run keeps no trace, so it offers no replay; the next counted run does again', async ({ page }) => {
  const custom = 'the quick brown fox jumps over the lazy dog';
  await openApp(page);
  await chooseMore(page, 'mode-custom');
  await page.locator('#custom-text').fill(custom);
  await page.locator('#custom-use').click();
  await typeInto(page, custom);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toContainText('not counted toward your best');
  await expect(page.locator('#watch-replay')).toBeHidden();

  await page.locator('.nav-item[data-nav="practice"]').click();
  await chooseWords(page, 10);
  await completePassage(page);
  await expect(page.locator('#watch-replay')).toBeVisible();
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
// Returns when the miss was typed, in ms from the first key: half a second into a second.
async function finishLongRunWithMiss(page) {
  await page.clock.install();
  await openApp(page);
  await chooseWords(page, 50);
  const text = await passageText(page);
  const at = [...text].findIndex((char, index) => index > 160 && /[a-z]/.test(char));
  const miss = text[at] === 'x' ? 'z' : 'x';
  await page.clock.pauseAt(Date.now() + 1000);
  await page.locator('#typing-input').focus();
  let elapsed = 0;
  const typeAtPace = async (keys) => {
    for (const key of keys) {
      await page.keyboard.type(key);
      const gap = key === ' ' ? 190 : 100 + (key.charCodeAt(0) % 4) * 12;
      await page.clock.fastForward(gap);
      elapsed += gap;
    }
  };
  await typeAtPace(text.slice(0, at));
  // A hesitation of over a second puts the miss mid-second, away from the stats' once-a-second
  // refresh, with no letters typed in that second before it: the rate on the miss's frame is lower.
  const hesitation = 1000 + ((1500 - (elapsed % 1000)) % 1000);
  await page.clock.fastForward(hesitation);
  const missAt = elapsed + hesitation;
  await typeAtPace(miss);
  await page.clock.fastForward(700);
  await page.keyboard.press('Backspace');
  await page.clock.fastForward(150);
  await typeAtPace(text.slice(at));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-errors')).toHaveText('1');
  return missAt;
}

test('the replay stats tick once a second from "—" and end on the run card', async ({ page }) => {
  test.setTimeout(60_000);
  const missAt = await finishLongRunWithMiss(page);
  const card = await runCard(page);
  await page.locator('#watch-replay').click();
  const dialog = page.locator('#replay-dialog');
  await expect(dialog).toHaveAttribute('data-state', 'playing');
  // No rate over the first second, as in practice; the errors count from 0.
  expect(await replayStats(page)).toEqual({ wpm: '—', accuracy: '—', errors: '0' });
  await page.clock.fastForward(900);
  expect(await replayStats(page)).toEqual({ wpm: '—', accuracy: '—', errors: '0' });
  await page.clock.fastForward(200);
  await expect(page.locator('#replay-wpm')).toHaveText(/^\d+$/);
  await expect(page.locator('#replay-accuracy')).toHaveText('100');
  // The numbers hold within a second: it is the replay clock, not the letters, that moves them.
  const second = await replayStats(page);
  await page.clock.fastForward(500);
  expect(await replayStats(page)).toEqual(second);

  // The frame the miss turns coral, half a second before the next tick, also counts the error and
  // drops accuracy; wpm waits for the tick.
  const wrong = page.locator('#replay-text .char.wrong');
  await page.clock.fastForward(missAt - 100 - (900 + 200 + 500));
  await expect(wrong).toHaveCount(0);
  const clean = await replayStats(page);
  expect(clean).toMatchObject({ accuracy: '100', errors: '0' });
  await page.clock.fastForward(150);
  await expect(wrong).toHaveCount(1);
  const missed = await replayStats(page);
  expect(missed).toMatchObject({ wpm: clean.wpm, errors: '1' });
  expect(missed.accuracy).not.toBe('100');
  await expect(page.locator('#replay-errors-unit')).toHaveText('error');

  await page.clock.fastForward(60_000);
  await expect(dialog).toHaveAttribute('data-state', 'done');
  expect(await replayStats(page)).toEqual(card);
  // Restart goes back to the start's numbers.
  await page.locator('#replay-restart').click();
  expect(await replayStats(page)).toEqual({ wpm: '—', accuracy: '—', errors: '0' });
});

test('the replay ends on the run card even when its last frame falls mid-second', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  await page.clock.pauseAt(Date.now() + 1000);
  await page.locator('#typing-input').focus();
  for (const key of text.slice(0, -1)) {
    await page.keyboard.type(key);
    await page.clock.fastForward(100);
  }
  // A long pause before the last letter, timed so the run ends half a second into a second: the
  // rate at the start of that second is well above the final one.
  const pause = 1000 + ((500 - ((text.length - 1) * 100) % 1000) + 1000) % 1000;
  const end = (text.length - 1) * 100 + pause;
  await page.clock.fastForward(pause - 100);
  await page.keyboard.type(text.at(-1));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  const card = await runCard(page);

  await page.locator('#watch-replay').click();
  const dialog = page.locator('#replay-dialog');
  await page.clock.fastForward(end - 400);
  await expect(dialog).toHaveAttribute('data-state', 'playing');
  const late = await replayStats(page);
  expect(late.wpm).not.toBe(card.wpm);
  await page.clock.fastForward(400);
  await expect(dialog).toHaveAttribute('data-state', 'done');
  expect(await replayStats(page)).toEqual(card);
});

for (const theme of ['dark', 'light']) {
  test(`screenshot: replay mid-playback (${theme})`, async ({ page }, testInfo) => {
    test.skip(theme === 'light' && !process.env.SCREENSHOTS, 'docs screenshots only; run with SCREENSHOTS=1');
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
    // At phone width the stats wrap below the title and the controls wrap inside the dialog.
    await page.setViewportSize({ width: 320, height: 640 });
    await expect(page.locator('#replay-wpm')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const box = await dialog.boundingBox();
    for (const id of ['replay-toggle', 'replay-speed', 'replay-restart', 'replay-close', 'replay-wpm', 'replay-errors-unit', 'replay-clock']) {
      const control = await page.locator(`#${id}`).boundingBox();
      expect(control.x).toBeGreaterThanOrEqual(box.x);
      expect(control.x + control.width).toBeLessThanOrEqual(box.x + box.width);
    }
    await page.screenshot({ path: shotPath(testInfo, `replay-phone-${theme}.png`) });
  });
}
