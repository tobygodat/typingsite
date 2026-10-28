// Accounts against the fake Supabase in e2e/fake-supabase.js: guest mode, sign-up, sign-in, Google (PKCE),
// sync, sign-out and the one-off import of the pre-accounts profile.
import { test, expect, openApp, freshTextCheck, openView, openSettings, signInWithEmail, storageKeys, chooseSetting, closeSettings } from './fixtures.js';

const account = (page) => page.locator('#account');

test('guests start with defaults and nothing is stored or sent', async ({ page, supabase }) => {
  await openApp(page);
  await expect(account(page)).toHaveAttribute('data-state', 'guest');
  await expect(page.locator('#guest-note')).toBeVisible();
  await expect(page.locator('#account-trigger')).toHaveAttribute('aria-label', 'Account, guest mode');

  await freshTextCheck(page);
  expect(await storageKeys(page)).toEqual([]);
  expect(supabase.requests).toEqual([]);

  await page.reload();
  await openView(page, 'Progress');
  await expect(page.locator('#progress-empty')).toBeVisible();
  await expect(page.locator('#best')).toHaveText('No best yet');
});

test('sign-up that needs confirmation shows the check-your-email step', async ({ page, supabase }) => {
  supabase.confirmSignups = true;
  await openApp(page);
  await page.locator('#account-trigger').click();
  await page.locator('#account-create').click();
  await expect(page.locator('#account-dialog-title')).toHaveText('Create an account');
  await page.locator('#account-submit').click();
  await expect(page.locator('#account-error')).toHaveText('Enter an email and a password.');

  await page.locator('#account-email-input').fill('new@stilltype.test');
  await page.locator('#account-password').fill('a long passphrase');
  await page.locator('#account-submit').click();
  await expect(page.locator('#account-confirm')).toBeVisible();
  await expect(page.locator('#account-confirm-email')).toHaveText('new@stilltype.test');
  await page.locator('#account-confirm-done').click();
  await expect(page.locator('#account-dialog')).toBeHidden();
  await expect(account(page)).toHaveAttribute('data-state', 'guest');
});

test('creating an account signs in and syncs a first profile row', async ({ page, supabase }) => {
  await openApp(page);
  await page.locator('#account-trigger').click();
  await page.locator('#account-create').click();
  await page.locator('#account-email-input').fill('ada@stilltype.test');
  await page.locator('#account-password').fill('a long passphrase');
  await Promise.all([page.waitForEvent('load'), page.locator('#account-submit').click()]);

  await expect(account(page)).toHaveAttribute('data-state', 'member');
  await expect(account(page)).toHaveAttribute('data-sync', 'synced');
  await expect(page.locator('#guest-note')).toBeHidden();
  await page.locator('#account-trigger').click();
  await expect(page.locator('#account-email')).toHaveText('ada@stilltype.test');
  await expect(page.locator('#account-sync')).toHaveText('Saved to your account');
  expect(supabase.profileFor('ada@stilltype.test')).toMatchObject({ version: 2 });
});

test('a wrong password is explained in the dialog', async ({ page, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await page.locator('#account-trigger').click();
  await page.locator('#account-signin').click();
  await expect(page.locator('#account-dialog-title')).toHaveText('Sign in');
  await page.locator('#account-email-input').fill('ada@stilltype.test');
  await page.locator('#account-password').fill('not it');
  await page.locator('#account-submit').click();
  await expect(page.locator('#account-error')).toHaveText('Invalid login credentials');
  await expect(page.locator('#account-dialog')).toBeVisible();
  await expect(page.locator('#account-submit')).toBeEnabled();
});

test('Google sign-in says so when the provider is off', async ({ page }) => {
  await openApp(page);
  await page.locator('#account-trigger').click();
  await page.locator('#account-google').click();
  await expect(page.locator('#account-toast')).toBeVisible();
  await expect(page.locator('#account-feedback')).toHaveText('Google sign-in isn’t switched on yet. Use an email and password for now.');
  await expect(page.locator('#account-google')).toBeEnabled();
});

test('Google sign-in completes a PKCE round trip and cleans the address', async ({ page, supabase }) => {
  supabase.googleEnabled = true;
  await openApp(page);
  await page.locator('#account-trigger').click();
  await page.locator('#account-google').click();
  await expect(account(page)).toHaveAttribute('data-state', 'member');
  await expect(account(page)).toHaveAttribute('data-sync', 'synced');

  expect(supabase.lastAuthorize).toMatchObject({ provider: 'google', code_challenge_method: 's256', redirect_to: `${new URL(page.url()).origin}/` });
  expect(new URL(page.url()).search).toBe('');
  await page.locator('#account-trigger').click();
  await expect(page.locator('#account-email')).toHaveText('google.user@stilltype.test');
  expect(await storageKeys(page)).not.toContain('stilltype-pkce-verifier');
});

test('a member’s progress and settings survive reload and follow the account', async ({ page, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');

  await openSettings(page);
  await chooseSetting(page, 'theme-select', 'light');
  await chooseSetting(page, 'font-size', '36');
  await closeSettings(page);
  await page.locator('#typing-input').click();
  await freshTextCheck(page);
  await expect.poll(() => supabase.profileFor('ada@stilltype.test')?.loops?.length).toBe(1);
  await expect(account(page)).toHaveAttribute('data-sync', 'synced');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveAttribute('data-font-size', '36');
  await expect(page.locator('#best')).toHaveText(/^Best · \d+ wpm$/);
  await openView(page, 'Progress');
  await expect(page.locator('.history-target')).toHaveText('General drill and retest');

  // Signing out clears this device; signing back in restores everything from the account row.
  await page.locator('#account-trigger').click();
  await Promise.all([page.waitForEvent('load'), page.locator('#account-signout').click()]);
  await expect(account(page)).toHaveAttribute('data-state', 'guest');
  expect(await storageKeys(page)).toEqual([]);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openView(page, 'Progress');
  await expect(page.locator('#progress-empty')).toBeVisible();

  await signInWithEmail(page, 'ada@stilltype.test');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await openView(page, 'Progress');
  await expect(page.locator('.history-row')).toHaveCount(1);
});

test('a member’s saved theme becomes its mode’s pick, and the picks paint before the app runs', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  // Saved by a build from before the dark and light picks.
  supabase.profiles.set(ada.id, { data: { version: 2, profileId: 'ada', preferences: { theme: 'nord' } } });
  await page.emulateMedia({ colorScheme: 'light' });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'nord');
  await openSettings(page);

  for (const [id, value] of [['theme-select', 'dark'], ['dark-theme', 'nord'], ['light-theme', 'light']]) {
    await expect(page.locator(`#${id} input:checked`)).toHaveValue(value);
  }

  await chooseSetting(page, 'theme-select', 'system');
  await chooseSetting(page, 'light-theme', 'soft');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'soft');
  await expect.poll(() => supabase.profileFor('ada@stilltype.test')?.preferences).toMatchObject({ theme: 'system', darkTheme: 'nord', lightTheme: 'soft' });

  // Every theme the page shows from its first paint, the inline script's included.
  await page.addInitScript(() => {
    window.themesShown = [];
    new MutationObserver(() => window.themesShown.push(document.documentElement.dataset.theme))
      .observe(document, { subtree: true, attributes: true, attributeFilter: ['data-theme'] });
  });

  for (const [scheme, theme] of [['light', 'soft'], ['dark', 'nord']]) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.reload();
    await expect(account(page)).toHaveAttribute('data-sync', 'synced');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(new Set(await page.evaluate(() => window.themesShown))).toEqual(new Set([theme]));
  }
});

test('the pre-accounts profile moves into the first empty account', async ({ page, supabase }) => {
  supabase.addUser('ada@stilltype.test');

  const legacy = {
    version: 2,
    profileId: 'legacy',
    preferences: { theme: 'light', fontSize: '22' },
    attempts: [],
    loops: [{
      id: 'legacy-loop',
      // Recent, so it stays inside Progress's default 30-day period whenever the suite runs.
      at: new Date(Date.now() - 86400000).toISOString(),
      target: null,
      drillCompleted: false,
      conditions: { mode: 'words', count: 10, punctuation: false, inputClass: 'physical-keyboard', correctionPolicy: 'relaxed' },
      comparison: { comparable: true, state: 'improved', wpmDelta: 4, accuracyDelta: 1 },
      targetTiming: null,
    }],
    seenTextIds: [],
    bests: {},
  };

  await page.addInitScript((profile) => {
    if (sessionStorage.getItem('e2e-seeded')) return;
    sessionStorage.setItem('e2e-seeded', '1');
    localStorage.setItem('stilltype-profile-v2', JSON.stringify(profile));
  }, legacy);

  await openApp(page);
  // Guests never read it.
  await expect(page.locator('body')).toHaveAttribute('data-font-size', '28');
  await signInWithEmail(page, 'ada@stilltype.test');

  await expect(page.locator('body')).toHaveAttribute('data-font-size', '22');
  await openView(page, 'Progress');
  await expect(page.locator('.history-row')).toHaveCount(1);
  await expect(page.locator('.history-timing')).toHaveText('+4 wpm');
  expect(await storageKeys(page)).not.toContain('stilltype-profile-v2');
  expect(supabase.profileFor('ada@stilltype.test').loops.map((loop) => loop.id)).toEqual(['legacy-loop']);
});

test('an offline account keeps edits on the device and syncs when back online', async ({ page, context, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');

  supabase.offline = true;
  await context.setOffline(true);
  await openSettings(page);
  await chooseSetting(page, 'font-size', '22');
  await expect(account(page)).toHaveAttribute('data-sync', 'offline');
  // The account stores only settings chosen, and this one hasn't reached it.
  expect(supabase.profileFor('ada@stilltype.test').preferences.fontSize).toBeUndefined();

  supabase.offline = false;
  await context.setOffline(false);
  await expect(account(page)).toHaveAttribute('data-sync', 'synced');
  expect(supabase.profileFor('ada@stilltype.test').preferences.fontSize).toBe('22');
});
