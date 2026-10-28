import { test, expect, openApp, passageText, chooseQuoteFilter, openView, openSettings, chooseSetting, phone } from './fixtures.js';

const combo = (page, name = 'length') => page.getByRole('combobox', { name, exact: true });
const list = (page, name = 'length') => page.getByRole('listbox', { name, exact: true });
const active = async (page, name = 'length') => page.locator(`#${await combo(page, name).getAttribute('aria-activedescendant')}`).textContent();

async function quotes(page) {
  await openApp(page);
  await page.locator('#mode-quote').click();
}

test('pointer picks both filters, current checks follow preferences, same choice does not reset', async ({ page }) => {
  await quotes(page);
  await chooseQuoteFilter(page, 'length', 'short');
  await chooseQuoteFilter(page, 'difficulty', 'precise');
  await expect(page.locator('#typing-input')).toBeFocused();
  await expect(page.locator('#condition-line')).toContainText('short');
  await expect(page.locator('#condition-line')).toContainText('precise');
  const text = await passageText(page);
  await combo(page, 'difficulty').click();
  await expect(list(page, 'difficulty').locator('[data-current]')).toHaveText('precise✓');
  await list(page, 'difficulty').getByRole('option', { name: 'precise', exact: true }).click();
  expect(await passageText(page)).toBe(text);
  await expect(combo(page, 'difficulty')).toBeFocused();
});

test('arrows explore drafts, Home End and typeahead navigate, Escape never restarts', async ({ page }) => {
  await quotes(page);
  const text = await passageText(page);
  await combo(page).focus();
  await page.keyboard.press('ArrowDown');
  expect(await active(page)).toBe('medium✓');
  await page.keyboard.press('ArrowDown');
  expect(await active(page)).toBe('long✓');
  expect(await passageText(page)).toBe(text);
  await expect(combo(page).locator('.quote-filter-current')).toHaveText('medium');
  await page.keyboard.press('Home');
  expect(await active(page)).toBe('any✓');
  await page.keyboard.press('End');
  expect(await active(page)).toBe('long✓');
  await page.keyboard.type('sh');
  expect(await active(page)).toBe('short✓');
  await page.keyboard.press('Escape');
  await expect(combo(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(combo(page)).toBeFocused();
  expect(await passageText(page)).toBe(text);
  await page.keyboard.press('ArrowUp');
  expect(await active(page)).toBe('any✓');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(combo(page)).toContainText('long');
  await expect(page.locator('#typing-input')).toBeFocused();
});

test('Space and Alt arrows activate, repeated letters cycle and arrows stop at endpoints', async ({ page }) => {
  await quotes(page);
  await combo(page, 'difficulty').focus();
  await page.keyboard.press('Space');
  await page.keyboard.type('s');
  expect(await active(page, 'difficulty')).toBe('steady✓');
  await page.keyboard.type('s');
  expect(await active(page, 'difficulty')).toBe('steady✓');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowDown');
  expect(await active(page, 'difficulty')).toBe('precise✓');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  expect(await active(page, 'difficulty')).toBe('any✓');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Alt+ArrowUp');
  await expect(combo(page, 'difficulty')).toContainText('gentle');
  await combo(page).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(list(page)).toBeVisible();
  await page.keyboard.press('Escape');
});

test('Tab and Shift Tab commit exactly once without stealing traversal focus', async ({ page }) => {
  await quotes(page);
  await combo(page).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Tab');
  await expect(combo(page, 'difficulty')).toBeFocused();
  await expect(combo(page)).toContainText('long');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Tab');
  await expect(combo(page)).toBeFocused();
  await expect(combo(page, 'difficulty')).toContainText('precise');
  await expect(page.locator('#condition-line')).toContainText('long');
  await expect(page.locator('#condition-line')).toContainText('precise');
});

test('outside commits retain clicked destination, triggers toggle and menus exclude each other', async ({ page }) => {
  await quotes(page);
  await combo(page).click();
  await page.keyboard.press('Home');
  await combo(page, 'difficulty').click();
  await expect(combo(page)).toContainText('any');
  await expect(list(page)).toBeHidden();
  await expect(list(page, 'difficulty')).toBeVisible();
  await page.keyboard.press('End');
  await page.locator('#mode-more-label').click();
  await expect(combo(page, 'difficulty')).toContainText('precise');
  await expect(page.locator('#mode-more-label')).toBeFocused();
  await expect(list(page, 'difficulty')).toBeHidden();
  await expect(page.locator('.mode-more-menu')).toBeVisible();
  await combo(page).click();
  await expect(page.locator('.mode-more-menu')).toBeHidden();
  await expect(list(page)).toBeVisible();
  await combo(page).click();
  await expect(list(page)).toBeHidden();
});

test('commands cancel drafts, mode and view changes dismiss, imports refresh values', async ({ page }) => {
  await quotes(page);
  await combo(page).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette')).toBeVisible();
  await expect(combo(page)).toContainText('medium');
  await expect(list(page)).toBeHidden();
  await page.keyboard.press('Escape');
  await combo(page).click();
  await page.locator('#mode-time').click();
  await expect(list(page)).toBeHidden();
  await page.locator('#mode-quote').click();
  await combo(page).click();
  await openView(page, 'Progress');
  await expect(list(page)).toBeHidden();
  await openView(page, 'Practice');
  await combo(page).click();
  await openSettings(page);
  await page.getByRole('button', { name: /Import Monkeytype settings/ }).click();
  await expect(list(page)).toBeHidden();
  await page.locator('#import-text').fill(JSON.stringify({ mode: 'quote', quoteLength: [0] }));
  await page.locator('#confirm-import').click();
  await page.locator('#import-done').click();
  await expect(combo(page)).toContainText('short');
  await combo(page).click();
  await expect(list(page).locator('[data-current]')).toHaveText('short✓');
});

for (const width of [1280, 1000, 901, 900, 390, 320]) {
  test(`popups overlay without moving natural width islands at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await quotes(page);
    const middle = await page.locator('#quote-options').boundingBox();

    if (width >= 1000) {
      const modes = await page.locator('.mode-options').boundingBox();
      const punctuation = await page.locator('#punctuation-switch').boundingBox();
      expect(Math.abs(middle.x - modes.x - modes.width - 24)).toBeLessThan(1);
      expect(Math.abs(punctuation.x - middle.x - middle.width - 24)).toBeLessThan(1);
    }

    const passage = await page.locator('#text-display').boundingBox();

    for (const name of ['length', 'difficulty']) {
      const trigger = combo(page, name);
      const target = await trigger.boundingBox();
      expect(target.height).toBeGreaterThanOrEqual(36);
      await trigger.click();
      const popup = await list(page, name).boundingBox();
      expect(popup.x).toBeGreaterThanOrEqual(0);
      expect(popup.x + popup.width).toBeLessThanOrEqual(width);
      expect(await page.locator('#quote-options').boundingBox()).toEqual(middle);
      expect(await page.locator('#text-display').boundingBox()).toEqual(passage);

      for (const option of await list(page, name).getByRole('option').all()) {
        expect((await option.boundingBox()).height).toBeGreaterThanOrEqual(44);
        expect(await option.evaluate((node) => {
          const rect = node.getBoundingClientRect();

          return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        })).toBe(true);
      }

      await page.keyboard.press('Escape');
    }

    const before = await combo(page).boundingBox();
    await chooseQuoteFilter(page, 'length', 'any');
    const after = await combo(page).boundingBox();
    expect(after.width).toBeLessThan(before.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test.describe('touch quote filters', () => {
  test.use({ viewport: { width: 320, height: 640 }, ...phone });

  test('both triggers and menu options keep 44px targets', async ({ page }) => {
    await quotes(page);

    for (const name of ['length', 'difficulty']) {
      expect((await combo(page, name).boundingBox()).height).toBeGreaterThanOrEqual(44);
      await combo(page, name).tap();

      for (const option of await list(page, name).getByRole('option').all()) {
        expect((await option.boundingBox()).height).toBeGreaterThanOrEqual(44);
      }

      await page.keyboard.press('Escape');
    }
  });
});

for (const viewport of [{ width: 390, height: 400 }, { width: 667, height: 375 }]) {
  test(`option navigation stays open on a ${viewport.width} by ${viewport.height} screen`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await quotes(page);
    await combo(page).click();
    await page.keyboard.press('End');
    await expect(list(page)).toBeVisible();
    expect(await active(page)).toBe('long✓');
    await page.keyboard.press('Enter');
    await expect(combo(page)).toContainText('long');
    await expect(page.locator('#condition-line')).toContainText('long quote');
    await expect(page.locator('#typing-input')).toBeFocused();
  });
}

test('focus mode, window blur and resize discard drafts', async ({ page }) => {
  await quotes(page);
  await combo(page).click();
  await page.keyboard.press('End');
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(list(page)).toBeHidden();
  await expect(combo(page)).toContainText('medium');
  await combo(page).click();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(list(page)).toBeHidden();
  await chooseSetting(page, 'focus-toggle', true);
  await expect(list(page)).toBeHidden();
});

test('light, forced colors and reduced motion retain active and current cues', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce', forcedColors: 'active' });
  await quotes(page);
  await combo(page).click();
  await page.keyboard.press('End');
  await expect(list(page).getByRole('option', { name: 'long', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(list(page).locator('[data-current] .quote-filter-check')).toBeVisible();
  expect(parseFloat(await list(page).evaluate((node) => getComputedStyle(node).animationDuration))).toBeLessThanOrEqual(0.001);
  await expect(list(page).getByRole('option', { name: 'long', exact: true })).toHaveCSS('outline-style', 'solid');
});

test('a pointer commit rebuilds once and held activation never commits twice', async ({ page }) => {
  await quotes(page);
  await page.evaluate(() => {
    window.passageChanges = 0;
    new MutationObserver((records) => { window.passageChanges += records.length; })
      .observe(document.querySelector('#accessible-passage'), { childList: true });
  });
  await chooseQuoteFilter(page, 'length', 'short');
  expect(await page.evaluate(() => window.passageChanges)).toBe(1);
  await chooseQuoteFilter(page, 'length', 'short');
  expect(await page.evaluate(() => window.passageChanges)).toBe(1);
  await combo(page, 'difficulty').focus();
  await page.keyboard.down('Space');
  await page.keyboard.down('Space');
  await expect(list(page, 'difficulty')).toBeVisible();
  await page.keyboard.up('Space');
  await page.keyboard.press('End');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => window.passageChanges)).toBe(2);
});
