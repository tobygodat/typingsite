import { test, expect, openApp, chooseWords, passageText, typeInto } from './fixtures.js';

// Mock themes are opt-in proposals (token swaps in styles.css). Each must apply, persist like
// dark/light, and paint a ground that differs from both shipped themes.
const MOCKS = ['paper', 'shadcn', 'terminal', 'soft', 'midnight', 'swiss', 'eink', 'nord'];
// Committed docs screenshots are refreshed only with SCREENSHOTS=1; normal runs write to the test output.
const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/theme-mocks/${name}.png` : testInfo.outputPath(`${name}.png`));

async function pickTheme(page, theme) {
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await page.locator('.preferences > summary').click();
  await page.locator('#theme-select').selectOption(theme);
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

const bodyBackground = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('mock themes apply, differ from dark and light, and are listed as proposals', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#theme-select optgroup')).toHaveAttribute('label', 'Mock themes (proposals)');
  await pickTheme(page, 'dark');
  const dark = await bodyBackground(page);
  await pickTheme(page, 'light');
  const light = await bodyBackground(page);
  for (const theme of MOCKS) {
    await pickTheme(page, theme);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    const background = await bodyBackground(page);
    expect(background, theme).not.toBe(dark);
    expect(background, theme).not.toBe(light);
  }
});

test('light mock themes dim the palette with the light backdrop tint, dark mocks with the dark one', async ({ page }) => {
  await openApp(page);
  const backdrop = async (theme) => {
    await pickTheme(page, theme);
    await page.locator('#typing-input').focus();
    await page.keyboard.press('Control+k');
    await expect(page.locator('#palette')).toBeVisible();
    const color = await page.evaluate(() => getComputedStyle(document.querySelector('#palette'), '::backdrop').backgroundColor);
    await page.keyboard.press('Escape');
    await expect(page.locator('#palette')).toBeHidden();
    return color;
  };
  const light = await backdrop('light');
  const dark = await backdrop('dark');
  expect(light).not.toBe(dark);
  for (const theme of ['paper', 'shadcn', 'soft', 'swiss', 'eink']) expect(await backdrop(theme), theme).toBe(light);
  for (const theme of ['terminal', 'midnight', 'nord']) expect(await backdrop(theme), theme).toBe(dark);
});

// Every gliding pill should sit exactly under its active control; returns the worst left/width gap in px.
const pillGap = (page) => page.evaluate(() => Math.max(...[...document.querySelectorAll('.glide')].map((group) => {
  const target = group.querySelector(group.dataset.glide === 'current' ? ':scope > [aria-current="page"]' : ':scope > [aria-pressed="true"]');
  if (!target?.offsetWidth) return 0;
  const pill = group.querySelector(':scope > .glide-pill').getBoundingClientRect();
  const box = target.getBoundingClientRect();
  return Math.max(Math.abs(pill.left - box.left), Math.abs(pill.width - box.width));
})));

// How far the caret is from the left edge of the current letter, and whether it is on that letter's line.
const caretGap = (page) => page.evaluate(() => {
  const caret = document.querySelector('#text-display .caret').getBoundingClientRect();
  const letter = document.querySelector('#text-display .char.current').getBoundingClientRect();
  const middle = letter.top + letter.height / 2;
  return { x: Math.abs(caret.left - letter.left), onLine: middle > caret.top && middle < caret.bottom };
});

test('switching to a theme with other fonts remeasures the pills and the caret mid-run', async ({ page }) => {
  await openApp(page);
  await pickTheme(page, 'dark');
  await chooseWords(page, 10);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 9));
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  expect(await pillGap(page)).toBeLessThanOrEqual(1);
  for (const theme of ['terminal', 'swiss']) {
    // The settings select's own change handler, without the Escape that would restart the run.
    await page.locator('#theme-select').evaluate((select, value) => { select.value = value; select.dispatchEvent(new Event('change')); }, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect.poll(() => pillGap(page), { message: `${theme} pills` }).toBeLessThanOrEqual(1);
    await expect.poll(async () => { const gap = await caretGap(page); return gap.onLine && gap.x <= 1; }, { message: `${theme} caret` }).toBe(true);
  }
});

// The quote filters and the custom text editor tuck up under the mode bar; in every theme they stay below it.
test('the quote and custom rows sit clear of the mode bar in every theme', async ({ page }) => {
  await openApp(page);
  const gap = (row) => page.evaluate((id) => Math.round(document.getElementById(id).getBoundingClientRect().top
    - document.querySelector('.practice-controls').getBoundingClientRect().bottom), row);
  for (const theme of ['dark', 'light', ...MOCKS]) {
    await page.locator('#theme-select').evaluate((select, value) => { select.value = value; select.dispatchEvent(new Event('change')); }, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.locator('#mode-quote').click();
    await expect(page.locator('#quote-options')).toBeVisible();
    expect(await gap('quote-options'), `${theme} quote`).toBeGreaterThanOrEqual(8);
    await page.locator('#mode-custom').click();
    await expect(page.locator('#custom-options')).toBeVisible();
    expect(await gap('custom-options'), `${theme} custom`).toBeGreaterThanOrEqual(8);
    await page.locator('#mode-time').click();
    await expect(page.locator('#custom-options')).toBeHidden();
  }
});

test('an unknown stored theme falls back to the system theme', async ({ page }) => {
  await openApp(page);
  await page.locator('#theme-select').evaluate((select) => { select.value = 'neon'; select.dispatchEvent(new Event('change')); });
  await expect(page.locator('html')).toHaveAttribute('data-theme', /^(dark|light)$/);
});

for (const theme of MOCKS) {
  test(`screenshots · ${theme}`, async ({ page }, testInfo) => {
    await openApp(page);
    await pickTheme(page, theme);
    await chooseWords(page, 10);
    await page.mouse.move(640, 790);
    await page.screenshot({ path: shot(testInfo, `${theme}-practice`) });
    // Type at a human pace (~100 wpm) with one slip, so the card shows a believable run and the mistake mark.
    const text = await passageText(page);
    await typeInto(page, `${text.slice(0, 6)}${text[6] === 'x' ? 'z' : 'x'}${text.slice(7)}`, '#typing-input', { delay: 115 });
    await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
    await expect(page.locator('#run-card')).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: shot(testInfo, `${theme}-run-card`) });
  });
}

// Mid-run frames for the themes whose mistake cue differs: Paper (coral tint), Swiss and E-ink (tint plus underline).
for (const theme of ['paper', 'swiss', 'eink']) {
  test(`screenshots · ${theme} mid-run`, async ({ page }, testInfo) => {
    await openApp(page);
    await pickTheme(page, theme);
    await chooseWords(page, 10);
    const text = await passageText(page);
    // One deliberate slip so the mistake cue shows mid-run.
    await typeInto(page, `${text.slice(0, 6)}${text[6] === 'x' ? 'z' : 'x'}${text.slice(7, 18)}`);
    await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
    await page.waitForTimeout(300);
    await page.screenshot({ path: shot(testInfo, `${theme}-midrun`) });
  });
}
