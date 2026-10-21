import { test, expect, chooseWords, openApp, openSettings, passageText, typeInto, chooseMore, chooseSetting, closeSettings } from './fixtures.js';

test('a space refused by strict space still fails fail-on-any-error', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await chooseSetting(page, 'correction-select', 'fail-any');
  await chooseSetting(page, 'strict-space-toggle', true);
  await closeSettings(page);
  const text = await passageText(page);
  await typeInto(page, text[0] + ' ');
  await expect(page.locator('#result-delta')).toHaveText('failed · wrong key');
  await expect(page.locator('#best')).toHaveText('No best yet');
});

test('standard keeps its recipe while a strict-space choice waits for ordinary practice', async ({ page }) => {
  await openApp(page);
  await chooseMore(page, 'mode-standard');
  const standard = await passageText(page);
  await openSettings(page);
  await chooseSetting(page, 'strict-space-toggle', true);
  await expect(page.locator('#rules-note')).toHaveText('the standard test keeps its own rules');
  await closeSettings(page);
  expect(await passageText(page)).toBe(standard);
  await expect(page.locator('#condition-line')).not.toContainText('strict space');
  await page.locator('#mode-words').click();
  await expect(page.locator('#condition-line')).toContainText('strict space');
});
