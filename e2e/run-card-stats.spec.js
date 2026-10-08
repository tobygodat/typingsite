// Run card: raw wpm, consistency, the character breakdown and the static words list.
import { test, expect, openApp, passageText, typeInto, chooseWords } from './fixtures.js';

// Committed screenshots are rewritten only with SCREENSHOTS=1; normal runs keep them in the test output.
const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/run-card-stats/${name}` : testInfo.outputPath(name));

// A 10-word run typed at a realistic pace (>3 s, enough for consistency), one letter missed and fixed.
async function finishRun(page) {
  await chooseWords(page, 10);
  const text = await passageText(page);
  const at = [...text].findIndex((char, index) => index > 1 && /[a-z]/.test(char));
  const miss = text[at] === 'x' ? 'z' : 'x';
  await typeInto(page, text.slice(0, at) + miss, '#typing-input', { delay: 75 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text.slice(at), { delay: 75 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  return { text, at };
}

test('the run card shows raw wpm, consistency, c/i/e/m and the words typed', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  const { text, at } = await finishRun(page);

  await expect(page.locator('#result-raw')).toHaveText(/^\d+$/);
  const raw = Number(await page.locator('#result-raw').textContent());
  expect(raw).toBeGreaterThanOrEqual(Number(await page.locator('#result-wpm').textContent()));
  await expect(page.locator('#result-consistency')).toHaveText(/^\d+$/);
  // The breakdown describes the finished text: the fixed slip is a first-try error, not "incorrect".
  await expect(page.locator('#result-errors')).toHaveText('1');
  await expect(page.locator('#result-chars')).toHaveText(new RegExp(`^${text.length}/0/0/0$`));
  await expect(page.locator('.run-card-more dt')).toHaveText(['raw wpm', 'consistency', 'final c/i/e/m']);
  await expect(page.locator('.run-card .metric-note').nth(1)).toContainText('consistency is 100 minus');
  await expect(page.locator('.run-card .metric-note').nth(1)).toContainText('still wrong');
  await expect(page.locator('.run-card .metric-note').nth(1)).toContainText('fixed slips are first-try errors');
  // At 800 px tall the card is taller than the space below the dock, so it scrolls with the page.
  expect(await page.locator('#run-card').evaluate((node) => getComputedStyle(node).position)).toBe('static');

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
  await page.screenshot({ path: shot(testInfo, 'run-card-dark.png'), fullPage: true, clip });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: shot(testInfo, 'run-card-light.png'), fullPage: true, clip });

  // On a tall screen the whole card fits below the dock, so it sticks again.
  await page.setViewportSize({ width: 1280, height: 1200 });
  expect(await page.locator('#run-card').evaluate((node) => getComputedStyle(node).position)).toBe('sticky');
});

test('a words list past four lines is reached and scrolled from the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await chooseWords(page, 50);
  await typeInto(page, await passageText(page));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  const list = page.locator('#result-words');
  // Chromium and Firefox focus a scroller on their own; Safari needs the tabindex.
  await expect(list).toHaveAttribute('tabindex', '0');
  await expect(list).toHaveAttribute('role', 'region');
  await expect(list).toHaveAttribute('aria-label', /words typed/i);
  expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  // Finish focuses "run again", after the card; Shift+Tab walks back into the list.
  for (let i = 0; i < 12 && !(await list.evaluate((node) => node === document.activeElement)); i += 1) {
    await page.keyboard.press('Shift+Tab');
  }
  await expect(list).toBeFocused();
  const ring = await list.evaluate((node) => ({
    visible: node.matches(':focus-visible'),
    style: getComputedStyle(node).outlineStyle,
    width: getComputedStyle(node).outlineWidth,
  }));
  expect(ring).toEqual({ visible: true, style: 'solid', width: '2px' });
  await page.keyboard.press('End');
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the secondary row and words list fit at 390 px', async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await finishRun(page);
    await expect(page.locator('#result-consistency')).toHaveText(/^\d+$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    // The fixed bottom dock is hidden for the capture only, so it never covers the card's foot.
    await page.waitForTimeout(600);
    await page.locator('#run-card').screenshot({ path: shot(testInfo, 'run-card-mobile.png'), style: '.dock-zone { visibility: hidden; }' });
  });
});
