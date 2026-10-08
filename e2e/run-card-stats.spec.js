// Run card: raw wpm, consistency, the character breakdown and the static words list.
import { test, expect, openApp, passageText, typeInto, chooseWords } from './fixtures.js';

const shots = 'docs/screenshots/run-card-stats';

// A 10-word run typed slowly enough (>3 s) for consistency, with one letter missed and fixed.
async function finishRun(page) {
  await chooseWords(page, 10);
  const text = await passageText(page);
  const at = [...text].findIndex((char, index) => index > 1 && /[a-z]/.test(char));
  const miss = text[at] === 'x' ? 'z' : 'x';
  await typeInto(page, text.slice(0, at) + miss, '#typing-input', { delay: 70 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text.slice(at), { delay: 70 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  return { text, at };
}

test('the run card shows raw wpm, consistency, c/i/e/m and the words typed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  const { text, at } = await finishRun(page);

  await expect(page.locator('#result-raw')).toHaveText(/^\d+$/);
  const raw = Number(await page.locator('#result-raw').textContent());
  expect(raw).toBeGreaterThanOrEqual(Number(await page.locator('#result-wpm').textContent()));
  await expect(page.locator('#result-consistency')).toHaveText(/^\d+$/);
  await expect(page.locator('#result-chars')).toHaveText(new RegExp(`^${text.length}/0/0/0$`));
  await expect(page.locator('.run-card-more dt')).toHaveText(['raw wpm', 'consistency', 'c/i/e/m']);
  await expect(page.locator('.run-card .metric-note').nth(1)).toContainText('consistency is 100 minus');

  const words = page.locator('#result-words span');
  await expect(words).toHaveText(text.split(' '));
  // The word holding the fixed miss is marked with the coral token and its tint.
  const missIndex = text.slice(0, at).split(' ').length - 1;
  await expect(page.locator('#result-words .word-miss')).toHaveCount(1);
  const cue = await words.nth(missIndex).evaluate((node) => ({
    color: getComputedStyle(node).color,
    background: getComputedStyle(node).backgroundColor,
    danger: getComputedStyle(document.documentElement).getPropertyValue('--danger-soft').trim(),
  }));
  expect(cue.background).toBe(cue.danger);
  await expect(words.last()).toHaveAttribute('title', /^\d+ wpm$/);
  // Static: nothing in the list animates.
  expect(await page.locator('#result-words').evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);

  // Clip the whole card from a full-page shot so the fixed dock never overlaps it.
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  const clip = await page.locator('#run-card').boundingBox();
  await page.screenshot({ path: `${shots}/run-card-dark.png`, fullPage: true, clip });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: `${shots}/run-card-light.png`, fullPage: true, clip });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the secondary row and words list fit at 390 px', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await finishRun(page);
    await expect(page.locator('#result-consistency')).toHaveText(/^\d+$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.waitForTimeout(600);
    await page.locator('#run-card').screenshot({ path: `${shots}/run-card-mobile.png` });
  });
});
