// Pace caret: a settings control for the presentational pacer (never scored).
import { test, expect, openApp, passageText, typeInto, openSettings } from './fixtures.js';

// Committed docs captures are refreshed only with SCREENSHOTS=1; normal runs write to test output.
const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/pace-caret/${name}.png` : testInfo.outputPath(`${name}.png`));

test.describe('pace caret', () => {
  test('custom pace shows a moving caret and a label; off hides both', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    const ghost = page.locator('#text-display .ghost-caret');
    const label = page.locator('#pace-label');
    await expect(label).toBeHidden();

    await openSettings(page);
    await expect(page.locator('#pace-select')).toHaveValue('off');
    await page.locator('#pace-select').selectOption('best');
    await expect(page.locator('#pace-note')).toHaveText('no runs yet — 60 wpm');
    await page.locator('#pace-select').selectOption('custom');
    await openSettings(page);
    await expect(page.locator('#pace-custom')).toBeVisible();
    await page.locator('#pace-wpm').fill('80');
    await page.locator('#pace-wpm').press('Tab');
    await openSettings(page);
    await page.screenshot({ path: shot(testInfo, 'settings-dark') });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.screenshot({ path: shot(testInfo, 'settings-light') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.keyboard.press('Escape');
    await page.locator('#typing-input').focus();

    await expect(label).toBeVisible();
    await expect(label).toHaveText('pace 80 wpm');
    await expect(ghost).not.toHaveClass(/is-hidden/);
    const passageBox = await page.locator('#typing-wrap').boundingBox();

    const text = await passageText(page);
    await typeInto(page, text.slice(0, 1));
    const start = await ghost.evaluate((node) => node.style.transform);
    await expect.poll(() => ghost.evaluate((node) => node.style.transform), { timeout: 3000 }).not.toBe(start);
    await typeInto(page, text.slice(1, 12));
    await expect(ghost).not.toHaveClass(/is-hidden/);
    await expect(label).toHaveText('pace 80 wpm');
    expect(await page.locator('#typing-wrap').boundingBox()).toEqual(passageBox);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: shot(testInfo, 'mid-run-dark') });

    await page.keyboard.press('Escape');
    await openSettings(page);
    await page.locator('#pace-select').selectOption('off');
    await expect(label).toBeHidden();
    await expect(ghost).toHaveClass(/is-hidden/);
    await expect(page.locator('body')).toHaveAttribute('data-ghost', 'off');
  });

  test('turning the pace on mid-run starts the caret on the run clock', async ({ page }) => {
    await openApp(page);
    const ghost = page.locator('#text-display .ghost-caret');
    const text = await passageText(page);
    await typeInto(page, text.slice(0, 2));
    await expect(page.locator('body')).toHaveAttribute('data-running', /.*/);
    await page.mouse.move(5, 5);
    await page.mouse.move(40, 40);
    await openSettings(page);
    await page.locator('#pace-select').selectOption('custom');
    await expect(ghost).not.toHaveClass(/is-hidden/);
    const start = await ghost.evaluate((node) => node.style.transform);
    await expect.poll(() => ghost.evaluate((node) => node.style.transform), { timeout: 3000 }).not.toBe(start);
  });

  test('the palette sets a pace mode and the ghost toggle maps to personal best', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+k');
    await page.keyboard.type('pace caret: custom');
    await page.keyboard.press('Enter');
    await expect(page.locator('#pace-label')).toHaveText('pace 80 wpm');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('ghost');
    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toHaveAttribute('data-ghost', 'off');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('ghost');
    await page.keyboard.press('Enter');
    await expect(page.locator('#pace-label')).toHaveText('pace 60 wpm');
    await openSettings(page);
    await expect(page.locator('#pace-select')).toHaveValue('best');
  });
});
