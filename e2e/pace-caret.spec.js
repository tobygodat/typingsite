// Pace caret: a settings control for the presentational pacer (never scored).
import { test, expect, openApp, passageText, typeInto, openSettings, chooseWords, completePassage, openView, chooseSetting } from './fixtures.js';

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

    await openSettings(page, 'practice');
    await expect(page.locator('#pace-select input:checked')).toHaveValue('off');
    await chooseSetting(page, 'pace-select', 'best');
    await expect(page.locator('#pace-note')).toHaveText('no runs yet — 60 wpm');
    await chooseSetting(page, 'pace-select', 'custom');
    await openSettings(page, 'practice');
    await expect(page.locator('#pace-custom')).toBeVisible();
    await page.locator('#pace-wpm').fill('80');
    await page.locator('#pace-wpm').press('Tab');
    await openSettings(page, 'practice');
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
    await openSettings(page, 'practice');
    await chooseSetting(page, 'pace-select', 'off');
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
    await openSettings(page, 'practice');
    await chooseSetting(page, 'pace-select', 'custom');
    await expect(ghost).not.toHaveClass(/is-hidden/);
    const start = await ghost.evaluate((node) => node.style.transform);
    await expect.poll(() => ghost.evaluate((node) => node.style.transform), { timeout: 3000 }).not.toBe(start);
  });

  test('changing the pace arms the caret on the ready passage instead of replacing it', async ({ page }) => {
    await openApp(page);
    const ghost = page.locator('#text-display .ghost-caret');
    const text = await passageText(page);
    await openSettings(page, 'practice');
    await chooseSetting(page, 'pace-select', 'custom');
    await page.locator('#pace-wpm').fill('120');
    await page.locator('#pace-wpm').press('Tab');
    await expect(page.locator('#pace-label')).toHaveText('pace 120 wpm');
    await chooseSetting(page, 'pace-select', 'average');
    await expect(page.locator('#pace-label')).toHaveText('pace 60 wpm');
    await expect(ghost).not.toHaveClass(/is-hidden/);
    expect(await passageText(page)).toBe(text);
    await chooseSetting(page, 'pace-select', 'off');
    await expect(ghost).toHaveClass(/is-hidden/);
    expect(await passageText(page)).toBe(text);
  });

  test('clearing history drops a history-derived pace to the fallback, and undo restores it', async ({ page }) => {
    await openApp(page);
    await chooseWords(page, 10);
    await openSettings(page, 'practice');
    await chooseSetting(page, 'pace-select', 'last');
    await page.keyboard.press('Escape');
    await completePassage(page);
    await openView(page, 'Practice');
    const label = page.locator('#pace-label');
    await expect(label).toHaveText(/^pace \d+ wpm$/);
    const last = await label.textContent();
    expect(last).not.toBe('pace 60 wpm');
    const text = await passageText(page);

    await openView(page, 'Progress');
    await page.locator('#clear-history').click();
    await page.locator('#confirm-clear-input').fill('clear');
    await page.locator('#confirm-clear').click();
    await openView(page, 'Practice');
    expect(await passageText(page)).toBe(text);
    await expect(label).toHaveText('pace 60 wpm');
    await expect(page.locator('#pace-note')).toHaveText('no runs yet — 60 wpm');
    await page.locator('#undo-clear').click();
    await expect(label).toHaveText(last);
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
    await openSettings(page, 'practice');
    await expect(page.locator('#pace-select input:checked')).toHaveValue('best');
  });
});

test('the pace caret glides through each letter instead of hopping between them', async ({ page }) => {
  await openApp(page);
  await openSettings(page, 'practice');
  await chooseSetting(page, 'pace-select', 'custom');
  await page.locator('#pace-wpm').fill('30');
  await page.locator('#pace-wpm').press('Tab');
  await page.keyboard.press('Escape');
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 1));
  // At 30 wpm a letter takes 400 ms: a hopping caret would hold one place for the whole of it.
  const xs = await page.locator('#text-display .ghost-caret').evaluate((node) => new Promise((resolve) => {
    const seen = [];
    const sample = () => {
      seen.push(new DOMMatrix(getComputedStyle(node).transform).m41);
      if (seen.length < 24) requestAnimationFrame(sample);
      else resolve(seen);
    };
    requestAnimationFrame(sample);
  }));
  expect(new Set(xs.map((x) => x.toFixed(1))).size).toBeGreaterThan(8);
  for (let i = 1; i < xs.length; i += 1) expect(xs[i] - xs[i - 1]).toBeLessThan(6);
});

test('under reduced motion the pace caret stays put', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await openSettings(page, 'practice');
  await chooseSetting(page, 'pace-select', 'custom');
  await page.keyboard.press('Escape');
  const ghost = page.locator('#text-display .ghost-caret');
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 1));
  const start = await ghost.evaluate((node) => node.style.transform);
  await page.waitForTimeout(600);
  expect(await ghost.evaluate((node) => node.style.transform)).toBe(start);
});
