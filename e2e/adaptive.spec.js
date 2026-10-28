import { test, expect, openApp, chooseWords, completePassage, passageText, chooseMore } from './fixtures.js';

// Types the passage with one slip, on the second letter of its most frequent letter pair, so that pair has
// the ten tries and a first-try error a target needs. Returns the pair.
async function typeWithPairSlip(page, text) {
  const counts = new Map();

  for (let index = 1; index < text.length; index += 1) {
    const pair = text.slice(index - 1, index + 1);

    if (/^[a-z]{2}$/.test(pair)) counts.set(pair, (counts.get(pair) || 0) + 1);
  }

  const [pair, tries] = [...counts].sort((a, b) => b[1] - a[1])[0];
  expect(tries).toBeGreaterThanOrEqual(10);
  const at = text.indexOf(pair) + 1;
  await page.locator('#typing-input').focus();
  await page.keyboard.type(text.slice(0, at));
  await page.keyboard.type(text[at] === 'x' ? 'z' : 'x');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text.slice(at));

  return pair;
}

// A fixed passage: a random hundred words now and then has no pair typed ten times.
const seedRandom = () => {
  let seed = 20261023;
  Math.random = () => {
    seed = (seed * 16807) % 2147483647;

    return (seed - 1) / 2147483646;
  };
};

test('adaptive practice draws on the run’s target, never counts, and retests on fresh text', async ({ page }) => {
  await page.addInitScript(seedRandom);
  await openApp(page);
  await chooseWords(page, 100);
  const target = await typeWithPairSlip(page, await passageText(page));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-drill')).toHaveText(`Drill “${target}”`);
  const best = await page.locator('#best').textContent();

  await page.locator('#adaptive-switch').click();
  await expect(page.locator('#adaptive-toggle')).toBeChecked();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  const adaptive = await passageText(page);
  expect(adaptive).toContain(target);
  await completePassage(page);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Adaptive run · not counted toward your best');
  await expect(page.locator('#best')).toHaveText(best);

  // Its second action is a fresh-text retest against the normal run at the same conditions.
  await expect(page.locator('#result-drill')).toHaveText('Retest on fresh text');
  await page.locator('#result-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  expect(await passageText(page)).not.toBe(adaptive);
  await completePassage(page);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'train');
  await expect(page.locator('#comparison-panel')).toHaveAttribute('data-outcome', /^(improved|mixed|regressed|steady)$/);
});

test('the adaptive switch shows only for time and words', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await expect(page.locator('#adaptive-switch')).toBeVisible();
  await page.locator('#mode-quote').click();
  await expect(page.locator('#adaptive-switch')).toBeHidden();
  await chooseMore(page, 'mode-code');
  await expect(page.locator('#adaptive-switch')).toBeHidden();
  await page.locator('#mode-time').click();
  await expect(page.locator('#adaptive-switch')).toBeVisible();
});
