// Audit TYP-97 P1-1 to P1-3: one challenge tab looks selected, the dock's visible words are in its
// accessible names at every width, and key hints stay off touch-only devices.
import { test, expect, openApp, openView, openSettings, phone } from './fixtures.js';

const MODES = ['challenge-online', 'challenge-daily', 'challenge-friends', 'challenge-local'];

// A tab "looks selected" when it draws a border: the pressed tab gets the accent outline, the rest
// are ghost buttons with a transparent one.
const borderedTabs = (page) => page.locator('.challenge-modes button').evaluateAll((buttons) => buttons
  .filter((button) => getComputedStyle(button).borderTopColor !== 'rgba(0, 0, 0, 0)')
  .map((button) => button.id));

async function startLocalRace(page) {
  await page.locator('#challenge-local').click();
  await page.locator('#player-one-name').fill('Ada');
  await page.locator('#player-two-name').fill('Bo');
  await page.locator('#start-local-race').click();
  await expect(page.locator('#race-stage')).toBeVisible();
}

test.describe('challenge tabs', () => {
  for (const scheme of ['dark', 'light']) {
    test(`only the pressed tab looks selected, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openApp(page);
      await openView(page, 'Challenge');
      for (const id of MODES) {
        await page.locator(`#${id}`).click();
        await expect(page.locator('.challenge-modes [aria-pressed="true"]')).toHaveCount(1);
        await expect(page.locator(`#${id}`)).toHaveAttribute('aria-pressed', 'true');
        // The outline fades over --dur-quick, so poll until the last tab's has gone.
        await expect.poll(() => borderedTabs(page), { message: `${id} pressed` }).toEqual([id]);
      }

      // The one-keyboard results screen keeps a single selected tab.
      await startLocalRace(page);
      const text = await page.locator('#race-accessible-passage').textContent();
      await page.locator('#race-input').focus();
      await page.keyboard.type(text);
      await page.locator('#start-next-player').click();
      await expect(page.locator('#race-player')).toHaveText('Bo');
      await page.locator('#race-input').focus();
      await page.keyboard.type(text);
      await expect(page.locator('#race-leaderboard')).toBeVisible();
      await expect.poll(() => borderedTabs(page)).toEqual(['challenge-local']);
    });
  }
});

test.describe('dock labels at 320px', () => {
  test.use({ viewport: { width: 320, height: 568 }, ...phone });

  test('each visible word is in its accessible name, and none clips', async ({ page }) => {
    await openApp(page);
    const items = page.getByRole('navigation', { name: 'Main navigation' }).locator('.nav-item');
    const visible = await items.evaluateAll((buttons) => buttons.map((button) => [...button.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE || node.getBoundingClientRect().width > 1)
      .map((node) => node.textContent).join('').trim()));
    expect(visible).toEqual(['type', 'train', 'track', 'race']);
    const names = ['type practice', 'train', 'track progress', 'race challenge'];
    for (const [index, name] of names.entries()) {
      await expect(items.nth(index)).toHaveAccessibleName(name);
      expect(name.startsWith(visible[index])).toBe(true);
    }
    for (const overflow of await items.evaluateAll((buttons) => buttons.map((button) => button.scrollWidth - button.clientWidth))) {
      expect(overflow).toBeLessThanOrEqual(0);
    }
    // The full word stays in the name, so the specs' openView(page, 'Progress') still finds it.
    await openView(page, 'Progress');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'progress');
  });
});

test('dock names are the visible words at 1280px', async ({ page }) => {
  await openApp(page);
  const items = page.getByRole('navigation', { name: 'Main navigation' }).locator('.nav-item');
  for (const [index, name] of ['practice', 'train', 'progress', 'challenge'].entries()) {
    await expect(items.nth(index)).toHaveAccessibleName(name);
    await expect(items.nth(index)).toHaveText(name, { useInnerText: true });
  }
});

test.describe('key hints on a touch-only phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, ...phone });

  test('no esc hints in the one-keyboard race or on settings close', async ({ page }) => {
    await openApp(page);
    expect(await page.evaluate(() => [matchMedia('(any-pointer: coarse)').matches, matchMedia('(any-pointer: fine)').matches])).toEqual([true, false]);
    await openView(page, 'Challenge');
    await startLocalRace(page);
    await expect(page.locator('#race-help')).toHaveText('', { useInnerText: true });
    await expect(page.locator('#race-input')).not.toHaveAccessibleDescription(/restart/i);

    await openSettings(page);
    const close = page.locator('#settings-close');
    await expect(close).toHaveText('×', { useInnerText: true });
    await expect(close).toHaveAccessibleName('Close settings');
    const box = await close.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');
    await page.locator('#palette-trigger').click();
    await expect(page.locator('#palette .palette-search kbd')).toBeHidden();
  });
});

test('a fine pointer keeps the esc hints', async ({ page }) => {
  await openApp(page);
  await openView(page, 'Challenge');
  await startLocalRace(page);
  await expect(page.locator('#race-help')).toHaveText('esc restarts.', { useInnerText: true });
  await expect(page.locator('#race-input')).toHaveAccessibleDescription(/esc restarts\./);
  await page.keyboard.press('Escape');
  await openSettings(page);
  await expect(page.locator('#settings-close')).toHaveText(/esc\s*×/, { useInnerText: true });
});
