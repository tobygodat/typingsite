// The practice controls' "more" menu: the rarer modes and the way into lessons, behind one disclosure.
import { test, expect, openApp, passageText } from './fixtures.js';

const MORE = ['code', 'standard', 'book', 'compose', 'custom', 'drill', 'learn to type'];

test('modes, lengths and punctuation float in separate groups; "more" names the mode chosen inside it', async ({ page }) => {
  await openApp(page);
  const rail = page.locator('.practice-rail');
  await expect(rail).toHaveCSS('border-top-style', 'none');
  let previous;

  for (const group of ['.mode-options', '#duration-options', '#punctuation-switch']) {
    await expect(rail.locator(group)).toBeVisible();
    await expect(rail.locator(group)).toHaveCSS('border-top-style', 'solid');
    const box = await rail.locator(group).boundingBox();

    if (previous) {
      expect(box.x).toBeGreaterThan(previous.x + previous.width);
      expect(box.y).toBe(previous.y);
    }

    previous = box;
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

const PANELS = [['standard', '#standard-options'], ['custom', '#custom-options'], ['drill', '#manual-target']];

for (const width of [1280, 390]) {
  test(`at ${width}px quote filters share the setup bar and expanded panels clear it`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openApp(page);
    await page.locator('#mode-quote').click();
    await expect(page.locator('.practice-rail #quote-options')).toBeVisible();
    await expect(page.locator('#duration-options')).toBeHidden();
    const setup = await page.locator('.practice-controls').boundingBox();
    const filters = await page.locator('#quote-options').boundingBox();
    expect(filters.y).toBeGreaterThanOrEqual(setup.y);
    expect(filters.y + filters.height).toBeLessThanOrEqual(setup.y + setup.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);

    if (width > 900) {
      const modes = await page.locator('.mode-options').boundingBox();
      const punctuation = await page.locator('#punctuation-switch').boundingBox();
      expect(filters.y + filters.height / 2).toBe(modes.y + modes.height / 2);
      expect(filters.y + filters.height / 2).toBe(punctuation.y + punctuation.height / 2);
      expect(filters.x).toBeGreaterThanOrEqual(modes.x + modes.width);
      expect(filters.x + filters.width).toBeLessThanOrEqual(punctuation.x);
    }

    for (const [mode, panel] of PANELS) {
      await page.locator('#mode-more-label').click();
      await page.locator(`#mode-${mode}`).click();
      await expect(page.locator(panel)).toBeVisible();

      // The standard recipe may sit inside the controls' box (on a phone it takes the lengths' row);
      // it still clears every visible control.
      const overlaps = await page.locator(panel).evaluate((node) => {
        const a = node.getBoundingClientRect();

        return [...document.querySelectorAll('.practice-controls :is(.segmented, .compact-switch)')]
          .filter((control) => control !== node && control.checkVisibility({ visibilityProperty: true }))
          .filter((control) => {
            const b = control.getBoundingClientRect();

            return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          })
          .map((control) => control.id || control.className);
      });

      expect(overlaps, `${mode} options clear the controls`).toEqual([]);
    }
  });
}
