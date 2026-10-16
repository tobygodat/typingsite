// The practice controls' "more" menu: the rarer modes and the way into lessons, behind one disclosure.
import { test, expect, openApp, passageText } from './fixtures.js';

const MORE = ['code', 'standard', 'compose', 'custom', 'learn to type'];

test('one rail holds the modes, lengths and punctuation; "more" names the mode chosen inside it', async ({ page }) => {
  await openApp(page);
  const rail = page.locator('.practice-rail');
  await expect(rail).toHaveCSS('border-top-style', 'solid');
  for (const group of ['.mode-options', '#duration-options', '#punctuation-switch']) {
    await expect(rail.locator(group)).toBeVisible();
  }
  // Only time, words and quote show until "more" opens.
  await expect(page.locator('.mode-more-menu')).toBeHidden();
  await expect(page.locator('#mode-more-label')).toHaveText('more');

  await page.locator('#mode-more-label').click();
  await expect(page.locator('.mode-more-menu button')).toHaveText(MORE);
  await page.locator('#mode-standard').click();
  await expect(page.locator('.mode-more-menu')).toBeHidden();
  await expect(page.locator('#mode-more-label')).toHaveText('standard');
  await expect(page.locator('#mode-more')).toHaveAttribute('data-active', '');

  // The gliding pill rests under the renamed summary, as it would under any chosen mode.
  const summary = await page.locator('#mode-more-label').boundingBox();
  await expect.poll(async () => {
    const pill = await page.locator('.mode-options > .glide-pill').boundingBox();
    return Math.abs(pill.x - summary.x) + Math.abs(pill.width - summary.width);
  }).toBeLessThan(2);

  await page.locator('#mode-time').click();
  await expect(page.locator('#mode-more-label')).toHaveText('more');
  await expect(page.locator('#mode-more')).not.toHaveAttribute('data-active');
});

test('Escape closes "more" without restarting, and a click elsewhere closes it too', async ({ page }) => {
  await openApp(page);
  const text = await passageText(page);
  await page.locator('#mode-more-label').click();
  await page.locator('#mode-code').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mode-more')).not.toHaveAttribute('open');
  await expect(page.locator('#mode-more-label')).toBeFocused();
  expect(await passageText(page)).toBe(text);

  await page.locator('#mode-more-label').click();
  await expect(page.locator('.mode-more-menu')).toBeVisible();
  await page.locator('#text-display').click();
  await expect(page.locator('#mode-more')).not.toHaveAttribute('open');
});

test('at 320px the open menu stays on screen and above the lengths', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await openApp(page);
  await page.locator('#mode-more-label').click();
  const menu = await page.locator('.mode-more-menu').boundingBox();
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  // Every item is the topmost thing under its own centre, so nothing after the row covers it.
  for (const item of await page.locator('.mode-more-menu button').all()) {
    expect(await item.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    })).toBe(true);
  }
});

const PANELS = [['quote', '#quote-options'], ['standard', '#standard-options'], ['custom', '#custom-options']];

for (const width of [1280, 390]) {
  test(`at ${width}px each mode's options sit below the practice controls, not on them`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openApp(page);
    for (const [mode, panel] of PANELS) {
      if (mode !== 'quote') await page.locator('#mode-more-label').click();
      await page.locator(`#mode-${mode}`).click();
      await expect(page.locator(panel)).toBeVisible();
      const controls = await page.locator('.practice-controls').boundingBox();
      const options = await page.locator(panel).boundingBox();
      expect(options.y, `${mode} options clear the controls`).toBeGreaterThanOrEqual(controls.y + controls.height);
    }
  });
}
