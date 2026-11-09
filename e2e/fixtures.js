import { test as base, expect } from '@playwright/test';
import { FakeSupabase } from './fake-supabase.js';

// Every test gets a fake Supabase (so nothing reaches the real project) and fails on any page error
// or console error. Expected 4xx replies and dropped requests from the fake are the only console noise
// allowed; Firefox logs a dropped one as a blocked cross-origin request from the page, naming the fake's URL.
export const test = base.extend({
  supabase: [async ({ page }, use) => {
    const fake = new FakeSupabase();
    await fake.attach(page);
    await use(fake);
    expect(fake.errors, 'fake Supabase errors').toEqual([]);
  }, { auto: true }],
  browserErrors: [async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      const fromFake = /supabase\.co/.test(message.location().url) || /^\[JavaScript Error: "Cross-Origin Request Blocked: .* https:\/\/\w+\.supabase\.co\//.test(message.text());

      if (message.type() === 'error' && !fromFake) errors.push(message.text());
    });
    await use(errors);
    expect(errors, 'browser errors').toEqual([]);
  }, { auto: true }],
});

export { expect };

// A phone: touch, in the engine's mobile mode. Playwright has no mobile mode for Firefox (isMobile is
// unsupported there), and asking for one stops its mouse sending pointer events, so Firefox gets touch alone.
export const phone = { hasTouch: true, isMobile: async ({ browserName }, use) => use(browserName !== 'firefox') };

export async function openApp(page, path = '/') {
  // Reloading the app aborts any font still downloading, which Firefox logs as a console error.
  if (page.url() !== 'about:blank') await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.goto(path);
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

export const passageText = (page) => page.locator('#accessible-passage').textContent();

// The run card keeps first-try errors and the final c/i/e/m in accuracy's tooltip (#result-accuracy-fact).
export const firstTryErrors = (count) => new RegExp(`^${count} first-try errors? · `);
export const finalChars = (chars) => new RegExp(` · final c/i/e/m ${chars}$`);

export async function typeInto(page, text, selector = '#typing-input', options = {}) {
  await closeSettings(page);
  await page.locator(selector).focus();
  await page.keyboard.type(text, options);
}

// Text that arrives with no key press, as a soft keyboard or an emoji panel commits it. Playwright sends
// it as one plain insert in Chromium and WebKit, but as a composition (IME text) in Firefox, so there
// the plain insert's events are dispatched instead.
export async function insertPlainText(page, text) {
  if (page.context().browser().browserType().name() !== 'firefox') return page.keyboard.insertText(text);
  await page.evaluate((data) => {
    const field = document.activeElement;

    if (!field.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data }))) return;
    field.setRangeText(data, field.selectionStart, field.selectionEnd, 'end');
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data }));
  }, text);
}

// Picks a test shape from the practice controls, as a person would.
export async function chooseWords(page, count = 10) {
  await closeSettings(page);
  await page.locator('#mode-words').click();
  await page.locator(`#duration-options [data-length="${count}"]`).click();
  await expect(page.locator('#condition-line')).toContainText(`${count} words`);
}

// Types whatever passage is showing and waits for its result: on Practice, or on Train for a retest.
export async function completePassage(page, options) {
  const text = await passageText(page);
  await typeInto(page, text, undefined, options);
  await expect(page.locator('body')).toHaveAttribute('data-view', /^(results|train)$/);

  return text;
}

// A drill lasts 30 seconds and then starts its retest. The clock is faked from here on, a few letters start
// the drill and its 30 seconds are skipped. A spec that faked it already keeps its own: a second install
// doesn't fail, it moves the page back to the real date, and runs the spec dated near its own date then
// fall out of Progress's 30 days. Installed this late, WebKit's faked performance.now() jumps back and a
// touch drill never ends, so a phone-viewport spec installs the clock before openApp.
export async function finishDrill(page) {
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  const pageNow = await page.evaluate(() => Date.now());

  if (Math.abs(pageNow - Date.now()) < 60_000) await page.clock.install();
  await typeInto(page, (await passageText(page)).slice(0, 4));
  await page.clock.fastForward(30_000);
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
}

// A baseline, its drill and a fresh retest: the shortest way to a saved comparison.
export async function freshTextCheck(page) {
  await chooseWords(page, 10);
  const baseline = await completePassage(page);
  await page.locator('#result-drill').click();
  await finishDrill(page);
  const retest = await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();

  return { baseline, retest };
}

// Code, standard, compose, custom text and lessons sit behind "more" in the practice controls.
export async function chooseMore(page, id) {
  await closeSettings(page);

  if ((await page.locator('#mode-more').getAttribute('open')) === null) await page.locator('#mode-more-label').click();
  await page.locator(`#${id}`).click();
}

export async function openView(page, label) {
  await closeSettings(page);
  // A run fades the dock and disables its pointer events; a real mouse nudge brings it back.
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: label }).click();
}

// One of Progress's views (Speed, Accuracy, Consistency, Practice, Keys), chosen from its tabs.
export async function openProgressView(page, name) {
  const tab = page.getByRole('tablist', { name: 'View' }).getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

export async function openSettings(page, category) {
  const dialog = page.locator('#settings-dialog');

  if (!(await dialog.isVisible())) {
    await page.mouse.move(5, 5);
    await page.mouse.move(40, 40);
    await page.locator('#settings-trigger').click();
  }

  await expect(dialog).toBeVisible();

  if (category) await dialog.locator(`[data-settings-category="${category}"]`).click();
}

export async function closeSettings(page) {
  if (await page.locator('#settings-dialog').isVisible()) await page.locator('#settings-done').click();
}

export async function chooseSetting(page, id, value) {
  const control = page.locator(`#${id}`);
  const category = await control.evaluate((group) => group.closest('.settings-category').id.replace('settings-', ''));
  await openSettings(page, category);

  const option = typeof value === 'object'
    ? control.getByRole('radio', { name: value.label, exact: true })
    : control.locator(`input[value="${value}"]`);

  await expect(option).toBeEnabled();
  await option.locator('..').click();
}

export async function signInWithEmail(page, email, password = 'correct horse battery') {
  await closeSettings(page);
  await page.locator('#account-trigger').click();
  await page.locator('#account-signin').click();
  await page.locator('#account-email-input').fill(email);
  await page.locator('#account-password').fill(password);
  await Promise.all([page.waitForEvent('load'), page.locator('#account-submit').click()]);
  await expect(page.locator('#account')).toHaveAttribute('data-state', 'member');
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
}

// Keystroke recordings stay on the device that made them, never in the account row: a profile whose runs
// were recorded on this device is seeded into its cache, as that device's own copy, before signing in.
export async function recordedHere(page, userId, data) {
  await page.evaluate(([key, text]) => localStorage.setItem(key, text), [`stilltype-profile-v2:${userId}`, JSON.stringify(data)]);
}

export const storageKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('stilltype')));

export async function chooseQuoteFilter(page, filter, value) {
  const trigger = page.getByRole('combobox', { name: filter, exact: true });
  await trigger.click();
  await page.getByRole('listbox', { name: filter, exact: true }).getByRole('option', { name: value, exact: true }).click();
  await expect(trigger).toContainText(value);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
}
