// Caps Lock warning: a quiet label near the passage that never moves it and survives the running fade.
import { test, expect, openApp, typeInto } from './fixtures.js';

const capsKey = (page, type, on, key = on ? 'T' : 't') => page.locator('#typing-input').evaluate(
  (input, init) => input.dispatchEvent(new KeyboardEvent(init.type, { key: init.key, modifierCapsLock: init.on, bubbles: true })),
  { type, on, key },
);

test('shows while Caps Lock is on, stays during a run, hides once it is off', async ({ page }) => {
  await openApp(page);
  const warning = page.locator('#caps-warning');
  const wrap = page.locator('#typing-wrap');
  await page.locator('#typing-input').focus();
  await expect(warning).toBeHidden();
  const before = await wrap.boundingBox();

  await capsKey(page, 'keydown', true);
  await expect(warning).toBeVisible();
  await expect(warning).toHaveText('Caps Lock is on');
  await expect(page.locator('#announcement')).toHaveText('Caps Lock is on');
  expect(await wrap.boundingBox()).toEqual(before);

  await typeInto(page, 'a');
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  await capsKey(page, 'keyup', true);
  await expect(warning).toBeVisible();
  await expect(warning).toHaveCSS('opacity', '1');

  await capsKey(page, 'keyup', false);
  await expect(warning).toBeHidden();
  expect(await wrap.boundingBox()).toEqual(before);
});

test('blurring the typing field hides the warning', async ({ page }) => {
  await openApp(page);
  await page.locator('#typing-input').focus();
  await capsKey(page, 'keydown', true);
  await expect(page.locator('#caps-warning')).toBeVisible();
  await page.locator('#typing-input').blur();
  await expect(page.locator('#caps-warning')).toBeHidden();
});

test('screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page);
    await page.locator('#typing-input').focus();
    await capsKey(page, 'keydown', true);
    await expect(page.locator('#caps-warning')).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `docs/screenshots/caps-lock-warning/warning-${scheme}.png` });
  }
});
