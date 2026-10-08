import { test, expect, openApp, passageText, typeInto } from './fixtures.js';

const shots = 'docs/screenshots/error-modes';

async function chooseCorrection(page, policy) {
  await page.locator('details.preferences summary').click();
  await page.locator('#correction-select').selectOption(policy);
  await page.locator('details.preferences summary').click();
}

test('fail on any error ends the run as failed on the first wrong key', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await chooseCorrection(page, 'fail-any');
  await expect(page.locator('#condition-line')).toContainText('fail on any error');
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 12) + (text[12] === 'x' ? 'z' : 'x'), '#typing-input', { delay: 150 });
  await expect(page.locator('#result-delta')).toHaveText('failed · wrong key');
  await expect(page.locator('#run-card-stamp')).toContainText('failed · wrong key');
  await page.screenshot({ path: `${shots}/failed-run-card.png` });
});

test('no backspace ignores Backspace', async ({ page }) => {
  await openApp(page);
  await chooseCorrection(page, 'no-backspace');
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 2));
  await page.keyboard.press('Backspace');
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, 2));
  await page.keyboard.type(text[2]);
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, 3));
});

for (const scheme of ['dark', 'light']) {
  test(`settings select screenshot (${scheme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page);
    await page.locator('details.preferences summary').click();
    await page.locator('#correction-select').selectOption('fail-word');
    await expect(page.locator('#correction-select')).toHaveValue('fail-word');
    await page.screenshot({ path: `${shots}/settings-${scheme}.png` });
  });
}
