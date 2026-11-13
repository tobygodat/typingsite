import { test, expect, openApp, passageText, chooseWords, completePassage } from './fixtures.js';
import { useApplicationLifetimeFixture } from './application-lifetime-fixture.js';

test('disposing the application releases a pending native composition and remount records one run', async ({ page }) => {
  await useApplicationLifetimeFixture(page);
  await openApp(page);
  await expect(page.locator('#fixture-lifetime-status')).toHaveText('mounted');
  const retired = await page.locator('#typing-input').elementHandle();
  await retired.evaluate((input) => {
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Dead', code: 'Quote', bubbles: true, cancelable: true }));
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '"' }));
  });
  await page.locator('#fixture-dispose').click();
  await expect(page.locator('#fixture-lifetime-status')).toHaveText('disposed');
  const saved = await page.evaluate(() => JSON.stringify(localStorage));
  await retired.evaluate((input) => {
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '"a' }));
    input.value = '"a';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '"a' }));
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(saved);
  await expect(page.locator('#app')).toBeEmpty();
  await page.locator('#fixture-mount').click();
  await expect(page.locator('#fixture-lifetime-status')).toHaveText('mounted');
  await chooseWords(page, 10);
  const text = await passageText(page);
  await completePassage(page);
  await expect(page.locator('#run-card')).toBeVisible();
  await page.locator('#fixture-read').click();
  const recorded = JSON.parse(await page.locator('#fixture-profile').textContent());
  expect(recorded.attempts).toHaveLength(1);
  expect(recorded.runs).toHaveLength(1);
  expect(recorded.attempts[0].text).toBe(text);
});
