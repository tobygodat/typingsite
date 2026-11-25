import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { appOrigin } from '../e2e.config.ts';

test('a guest finishes a ten-word Practice run', async ({ app, browser }) => {
  await browser.route(/.*/, async (route) => {
    if (new URL(route.request.url).origin === appOrigin) await route.continue();
    else await route.abort();
  });

  await app.open('/');
  await expect(browser.locator('#text-display .char').first()).toBeVisible();

  if (await browser.locator('#settings-dialog').isVisible()) {
    await browser.locator('#settings-done').click();
  }

  await browser.locator('#mode-words').click();
  await browser.locator('#duration-options [data-length="10"]').click();
  await expect(browser.locator('#condition-line')).toContainText('10 words');

  const passage = await browser.locator('#accessible-passage').textContent();
  expect(passage?.trim().split(/\s+/)).toHaveLength(10);
  await browser.locator('#typing-input').focus();
  await browser.keyboard.type(passage ?? '');

  await expect(browser.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(browser.locator('#result-accuracy')).toHaveText('100');
  await expect(browser.locator('#run-again')).toBeVisible();
});
