// Still run: the progress lines beside the passage step with each update; they never glide.
import { test, expect, openApp, openView, passageText, typeInto, chooseWords } from './fixtures.js';

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
