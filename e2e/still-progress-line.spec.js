// Still run: the progress lines beside the passage step with each update; they never glide.
// The on-screen keys press and release at once; they never ease.
import { test, expect, openApp, openView, openSettings, passageText, typeInto, chooseWords } from './fixtures.js';

// Counts every transition the line starts from here on, however briefly it runs.
const watch = (locator) => locator.evaluate((node) => {
  node.moves = 0;
  node.addEventListener('transitionrun', () => { node.moves += 1; });
});

// The line's transition, the most animations it held across a few 100 ms live ticks, and the count above.
async function lineMotion(locator) {
  return locator.evaluate(async (node) => {
    let animations = node.getAnimations().length;
    for (let i = 0; i < 12; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      animations = Math.max(animations, node.getAnimations().length);
    }
    return { duration: getComputedStyle(node).transitionDuration, animations, started: node.moves };
  });
}

const still = { duration: '0s', animations: 0, started: 0 };
const progressOf = (page) => page.locator('#progress-bar').evaluate((node) => Number(node.style.getPropertyValue('--progress')));

// Reads an on-screen key inside the next keydown and keyup themselves, after the app has pressed or
// released it and before any frame is drawn, so a transition shows as the key still wearing its old look.
const armKey = (key) => key.evaluate((node) => {
  node.look = () => {
    const style = getComputedStyle(node);
    return { transform: style.transform, background: style.backgroundColor, color: style.color, border: style.borderTopColor, animations: node.getAnimations().length };
  };
  node.seen = {};
  // Window listeners run after the app's document listener.
  window.addEventListener('keydown', () => { node.seen.down = node.look(); }, { once: true });
  window.addEventListener('keyup', () => { node.seen.up = node.look(); }, { once: true });
});

// The key's look in that event, and once any transition would long have finished.
const keyLook = (key, phase) => key.evaluate(async (node, name) => {
  await new Promise((resolve) => setTimeout(resolve, 250));
  return { inEvent: node.seen[name], settled: node.look() };
}, phase);

test('a timed run’s line steps every tick, even after a pointer nudge, and restarts instantly', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-time').click();
  await page.locator('#duration-options [aria-label="60 seconds"]').click();
  await expect(page.locator('#condition-line')).toContainText('60 s');
  const bar = page.locator('#progress-bar');
  await watch(bar);
  await page.mouse.move(10, 10);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 3));
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  await expect.poll(() => progressOf(page)).toBeGreaterThan(0);
  expect(await lineMotion(bar)).toEqual(still);

  // A nudge brings the chrome back while the clock keeps moving the line.
  await page.mouse.move(80, 80);
  await expect(page.locator('body')).toHaveAttribute('data-running', 'false');
  const before = await progressOf(page);
  expect(await lineMotion(bar)).toEqual(still);
  expect(await progressOf(page)).toBeGreaterThan(before);

  // Restart drops the line to zero at once.
  await page.locator('#typing-input').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#typing-status')).toHaveText('Ready');
  expect(await bar.evaluate((node) => getComputedStyle(node).transform)).toBe('matrix(0, 0, 0, 1, 0, 0)');
  expect(await lineMotion(bar)).toEqual(still);
});

test('a words run’s line steps with each keystroke', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  const bar = page.locator('#progress-bar');
  await watch(bar);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 3));
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  await page.keyboard.type(text.slice(3, 4));
  expect(await lineMotion(bar)).toEqual(still);
  expect(await progressOf(page)).toBeCloseTo(4 / text.length, 5);
});

test('the one-keyboard challenge line steps with each keystroke', async ({ page }) => {
  await openApp(page);
  await openView(page, 'Challenge');
  await page.locator('#challenge-local').click();
  await page.locator('#player-one-name').fill('Ada');
  await page.locator('#player-two-name').fill('Lin');
  await page.locator('#start-local-race').click();
  await expect(page.locator('#race-input')).toBeFocused();
  const line = page.locator('#race-progress > span');
  await watch(line);
  const text = await page.locator('#race-accessible-passage').textContent();
  // Enough letters to cross a whole percent, which is the race line's step.
  await typeInto(page, text.slice(0, 12), '#race-input');
  await expect(page.locator('#race-progress')).not.toHaveAttribute('aria-valuenow', '0');
  expect(await lineMotion(line)).toEqual(still);
});

test('on-screen keys press and release instantly mid-run, even after a pointer nudge', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await page.locator('#keyboard-toggle').check();
  await page.keyboard.press('Escape');
  await expect(page.locator('.preferences-popover')).toBeHidden();
  await chooseWords(page, 10);
  await expect(page.locator('#keyboard')).toBeVisible();
  await page.mouse.move(10, 10);
  const text = await passageText(page);
  const at = [...text].findIndex((char, index) => index >= 3 && /[a-z]/.test(char));
  await typeInto(page, text.slice(0, at));
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');

  // A nudge brings the chrome back while the run goes on; the keys still never ease.
  await page.mouse.move(80, 80);
  await expect(page.locator('body')).toHaveAttribute('data-running', 'false');
  const durations = await page.locator('#keyboard .key').evaluateAll((keys) => [...new Set(keys.map((key) => getComputedStyle(key).transitionDuration))]);
  expect(durations).toEqual(['0s']);

  const letter = text[at];
  const key = page.locator(`#keyboard .key[data-key="${letter}"]`);
  await armKey(key);
  await page.keyboard.down(letter);
  const pressed = await keyLook(key, 'down');
  expect(pressed.settled.transform).toBe('matrix(1, 0, 0, 1, 0, 2)');
  expect(pressed.settled.animations).toBe(0);
  expect(pressed.inEvent).toEqual(pressed.settled);
  await page.keyboard.up(letter);
  const released = await keyLook(key, 'up');
  expect(released.settled.transform).toBe('none');
  expect(released.inEvent).toEqual(released.settled);

  // The press was typed into the same run.
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, at + 1));
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
});
