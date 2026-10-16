import { test as base, expect } from '@playwright/test';
import { FakeSupabase } from './fake-supabase.js';

// Every test gets a fake Supabase (so nothing reaches the real project) and fails on any page error
// or console error. Expected 4xx replies from the fake are the only console noise allowed.
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
      if (message.type() === 'error' && !/supabase\.co/.test(message.location().url)) errors.push(message.text());
    });
    await use(errors);
    expect(errors, 'browser errors').toEqual([]);
  }, { auto: true }],
});

export { expect };

export async function openApp(page, path = '/') {
  await page.goto(path);
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

export const passageText = (page) => page.locator('#accessible-passage').textContent();

export async function typeInto(page, text, selector = '#typing-input', options = {}) {
  await page.locator(selector).focus();
  await page.keyboard.type(text, options);
}

// Picks a test shape from the practice controls, as a person would.
export async function chooseWords(page, count = 10) {
  await page.locator('#mode-words').click();
  await page.locator(`#duration-options [data-length="${count}"]`).click();
  await expect(page.locator('#condition-line')).toContainText(`${count} words`);
}

// Types whatever passage is showing and waits for the results view.
export async function completePassage(page) {
  const text = await passageText(page);
  await typeInto(page, text);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  return text;
}

// A baseline, then straight to a fresh retest: the shortest way to a saved comparison.
export async function freshTextCheck(page) {
  await chooseWords(page, 10);
  const baseline = await completePassage(page);
  await page.locator('#skip-to-retest').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  const retest = await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  return { baseline, retest };
}

// Code, standard, compose, custom text and lessons sit behind "more" in the practice controls.
export async function chooseMore(page, id) {
  if ((await page.locator('#mode-more').getAttribute('open')) === null) await page.locator('#mode-more-label').click();
  await page.locator(`#${id}`).click();
}

export async function openView(page, label) {
  // A run fades the dock and disables its pointer events; a real mouse nudge brings it back.
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: label }).click();
}

export async function openSettings(page) {
  const settings = page.locator('details.preferences');
  if ((await settings.getAttribute('open')) === null) await settings.locator(':scope > summary').click();
  await expect(page.locator('.preferences-popover')).toBeVisible();
}

export async function signInWithEmail(page, email, password = 'correct horse battery') {
  await page.locator('#account-trigger').click();
  await page.locator('#account-signin').click();
  await page.locator('#account-email-input').fill(email);
  await page.locator('#account-password').fill(password);
  await Promise.all([page.waitForEvent('load'), page.locator('#account-submit').click()]);
  await expect(page.locator('#account')).toHaveAttribute('data-state', 'member');
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
}

export const storageKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('stilltype')));
