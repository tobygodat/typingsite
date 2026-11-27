import type { Browser, WebRoute } from '@e2e-dev/web';
import { expect } from 'e2e';
import { FakeSupabase } from '../../../e2e/fake-supabase.js';
import { appOrigin } from '../e2e.config.ts';

declare global {
  interface Window { pageErrors: string[]; themeFailure?: string }
}

// The pieces of e2e/fixtures.js these tests use, over e2e.com's `browser` fixture. Locators have no
// evaluate here, so DOM reads go through browser.evaluate with a selector.

// Playwright's route, as e2e/fake-supabase.js calls it.
const asPlaywrightRoute = (route: WebRoute) => ({
  request: () => ({
    url: () => route.request.url,
    method: () => route.request.method,
    headers: () => route.request.headers,
    postData: () => route.request.postData ?? null,
    postDataJSON: () => JSON.parse(route.request.postData ?? 'null'),
  }),
  fulfill: (response: { status?: number; headers?: Record<string, string>; body?: string }) => route.fulfill({ ...response, body: response.body ?? '' }),
  abort: () => route.abort(),
});

// The app's own origin and the fake Supabase only, and every page error and console.error recorded in the page.
// Playwright's fixture also sees console errors the browser itself logs; an init script sees only the page's.
export async function setUp(browser: Browser) {
  await browser.route(/.*/, async (route) => {
    if (new URL(route.request.url).origin === appOrigin) await route.continue();
    else await route.abort();
  });
  const supabase = new FakeSupabase();
  await supabase.attach({ route: (pattern: RegExp, handler: (route: ReturnType<typeof asPlaywrightRoute>) => Promise<void>) => browser.route(pattern, (route) => handler(asPlaywrightRoute(route))) });
  await browser.addInitScript(() => {
    const errors: string[] = [];
    Object.assign(window, { pageErrors: errors });
    addEventListener('error', (event) => errors.push(event.message));
    addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
    const log = console.error.bind(console);
    console.error = (...args) => { errors.push(args.map(String).join(' ')); log(...args); };
  });

  return supabase;
}

export async function tearDown(browser: Browser, supabase: FakeSupabase) {
  expect(supabase.errors).toEqual([]);
  expect(await browser.evaluate(() => window.pageErrors.filter((text) => !/supabase\.co/.test(text)))).toEqual([]);
}

export const fontsReady = (browser: Browser) => browser.evaluate(() => document.fonts.ready.then(() => null));

export async function openApp(browser: Browser, path = '/') {
  await browser.goto(path);
  await expect(browser.locator('#text-display .char').first()).toBeVisible();
  await fontsReady(browser);
}

export const passageText = async (browser: Browser) => (await browser.locator('#accessible-passage').textContent()) ?? '';

export async function closeSettings(browser: Browser) {
  if (await browser.locator('#settings-dialog').isVisible()) await browser.locator('#settings-done').click();
}

export async function typeInto(browser: Browser, text: string, selector = '#typing-input', options: { delay?: number } = {}) {
  await closeSettings(browser);
  await browser.locator(selector).focus();

  if (options.delay) await browser.locator(selector).pressSequentially(text, options);
  else await browser.keyboard.type(text);
}

export async function chooseWords(browser: Browser, count = 10) {
  await closeSettings(browser);
  await browser.locator('#mode-words').click();
  await browser.locator(`#duration-options [data-length="${count}"]`).click();
  await expect(browser.locator('#condition-line')).toContainText(`${count} words`);
}

export async function nudgeMouse(browser: Browser) {
  await browser.mouse.move(5, 5);
  await browser.mouse.move(40, 40);
}

export async function openView(browser: Browser, label: string) {
  await closeSettings(browser);
  await nudgeMouse(browser);
  await browser.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: new RegExp(label, 'i') }).click();
}

export async function openSettings(browser: Browser, category?: string) {
  const dialog = browser.locator('#settings-dialog');

  if (!(await dialog.isVisible())) {
    await nudgeMouse(browser);
    await browser.locator('#settings-trigger').click();
  }

  await expect(dialog).toBeVisible();

  if (category) await browser.locator(`#settings-dialog [data-settings-category="${category}"]`).click();
}

export async function chooseSetting(browser: Browser, id: string, value: string) {
  const category = await browser.evaluate((selector) => document.querySelector(selector)!.closest('.settings-category')!.id.replace('settings-', ''), `#${id}`);
  await openSettings(browser, category);
  const option = browser.locator(`#${id} input[value="${value}"]`);
  await expect(option).toBeEnabled();
  await browser.locator(`xpath=//*[@id="${id}"]//input[@value="${value}"]/..`).click();
}

// Playwright waits for the reload a sign-in makes with waitForEvent('load'); here the old document's marker going away is that load.
export async function signInWithEmail(browser: Browser, email: string, password = 'correct horse battery') {
  await closeSettings(browser);
  await browser.locator('#account-trigger').click();
  await browser.locator('#account-signin').click();
  await browser.locator('#account-email-input').fill(email);
  await browser.locator('#account-password').fill(password);
  await browser.evaluate(() => {
    Object.assign(window, { beforeSignIn: true });

    return null;
  });
  await browser.locator('#account-submit').click();
  await expect.poll(() => browser.evaluate(() => !('beforeSignIn' in window) && document.readyState === 'complete').catch(() => false)).toBe(true);
  await expect(browser.locator('#account')).toHaveAttribute('data-state', 'member');
  await expect(browser.locator('#account')).toHaveAttribute('data-sync', 'synced');
}

export async function setRaceName(browser: Browser, name: string) {
  await browser.locator('#people-setup').click();
  await browser.locator('#online-name').fill(name);
  await browser.locator('#online-setup-done').click();
}

export async function openRaceLink(browser: Browser) {
  await browser.locator('#people-race-link:visible, [data-people-action="link"]').first().click();
}
