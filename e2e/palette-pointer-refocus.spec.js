// A palette command chosen with a pointer must hand back a typing input that types, as Enter does.
// The bug: the press focused the dialog and left the selection on the option's text, so after close
// #typing-input was focused but had no caret, and keys reached it without typing anything.
import { test, expect, openApp, passageText } from './fixtures.js';

async function openPaletteFromInput(page) {
  await openApp(page);
  await page.locator('#typing-input').focus();
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette-input')).toBeFocused();
}

async function expectTyping(page) {
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('#typing-input')).toBeFocused();
  const text = (await passageText(page)).slice(0, 3);
  await page.keyboard.type(text, { delay: 80 });
  await expect(page.locator('#typing-input')).toHaveValue(text);
  await expect(page.locator('#text-display .char.correct')).toHaveCount(3);
}

const liveMetrics = (page) => page.locator('#palette-list [role="option"]', { hasText: 'live metrics' });

test('a command clicked with the mouse leaves a caret in the typing input', async ({ page }) => {
  await openPaletteFromInput(page);
  await liveMetrics(page).click();
  await expect(page.locator('#live-toggle')).toBeChecked();
  await expectTyping(page);
});

test('closing the palette from its backdrop leaves a caret in the typing input', async ({ page }) => {
  await openPaletteFromInput(page);
  await page.mouse.click(8, 790);
  await expectTyping(page);
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('a command tapped leaves a caret in the typing input', async ({ page }) => {
    await openPaletteFromInput(page);
    await liveMetrics(page).tap();
    await expect(page.locator('#live-toggle')).toBeChecked();
    await expectTyping(page);
  });
});
