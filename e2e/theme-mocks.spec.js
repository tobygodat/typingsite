import { test, expect, openApp, chooseWords, passageText, typeInto } from './fixtures.js';

// Mock themes are opt-in proposals (token swaps in styles.css). Each must apply, persist like
// dark/light, and paint a ground that differs from both shipped themes.
const MOCKS = ['paper', 'shadcn', 'terminal', 'soft', 'midnight', 'swiss', 'eink', 'nord'];
// Committed docs screenshots are refreshed only with SCREENSHOTS=1; normal runs write to the test output.
const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/theme-mocks/${name}.png` : testInfo.outputPath(`${name}.png`));

async function pickTheme(page, theme) {
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await page.locator('.preferences summary').click();
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
