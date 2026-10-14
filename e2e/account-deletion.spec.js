// Self-serve account deletion against the fake Supabase (e2e/fake-supabase.js): the typed
// confirmation, the one server step and the rows that go with the account, and failures that leave
// this device exactly as it was.
import { randomUUID } from 'node:crypto';
import { test, expect, openApp, chooseWords, passageText, typeInto, openView, signInWithEmail, storageKeys } from './fixtures.js';

const ADA = 'ada@stilltype.test';
const BOB = 'bob@stilltype.test';
const FUNCTION_CALL = 'POST /functions/v1/delete-account';
const DELETED_TOAST = 'Account deleted. You’re in guest mode.';

async function shot(page, testInfo, name) {
  const path = process.env.SCREENSHOTS ? `docs/screenshots/account-deletion/${name}.png` : testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
}

// A practice run typed at a person's pace (about 75 wpm), so the account has history to lose.
async function finishRun(page, supabase) {
  await chooseWords(page, 10);
  await typeInto(page, await passageText(page), '#typing-input', { delay: 150 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect.poll(() => supabase.profileFor(ADA)?.runs?.length).toBe(1);
}

async function openDeleteDialog(page) {
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await page.locator('#account-trigger').click();
  await page.locator('#account-delete').click();
  await expect(page.locator('#delete-account-dialog')).toBeVisible();
  await expect(page.locator('#confirm-delete-input')).toBeFocused();
}

const localState = (page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)])));

// Race rows keyed to Ada and Bob, shaped like e2e/fake-races.js keeps them.
function seedRaces(supabase, ada, bob) {
  const room = (host, other, extra = {}) => ({
    id: randomUUID(), passage: 'The quick brown fox jumps over the lazy dog.', conditions: {}, duration: 60,
    status: 'finished', startAt: null, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() - 60000).toISOString(),
    invitedUser: null, inviteKind: 'guest', inviteToken: null,
    players: [supabase.races.player(1, host.name, host.id), ...(other ? [supabase.races.player(2, other.name, other.id)] : [])],
    ...extra,
  });
  const adaRoom = room({ name: 'Ada', id: ada.id }, { name: 'Bob', id: bob.id }, { invitedUser: bob.id, inviteKind: 'account' });
  const bobRoom = room({ name: 'Bob', id: bob.id }, { name: 'Ada', id: ada.id });
  supabase.races.rooms.set(adaRoom.id, adaRoom);
  supabase.races.rooms.set(bobRoom.id, bobRoom);
  supabase.races.friends.set(ada.id, [{ id: randomUUID(), friendId: bob.id, name: 'Bob' }]);
  supabase.races.friends.set(bob.id, [{ id: randomUUID(), friendId: ada.id, name: 'Ada' }, { id: randomUUID(), email: ADA, name: 'Ada' }]);
  return { adaRoom, bobRoom };
}

test('deleting an account takes it and everything keyed to it, then this device is a guest', async ({ page, supabase }, testInfo) => {
  const ada = supabase.addUser(ADA);
  const bob = supabase.addUser(BOB);
  const { adaRoom, bobRoom } = seedRaces(supabase, ada, bob);
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await signInWithEmail(page, ADA);
  await finishRun(page, supabase);

  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await page.locator('#account-trigger').click();
  await expect(page.locator('#account-delete')).toBeVisible();
  await shot(page, testInfo, 'account-menu-dark');
  await page.locator('#account-delete').click();
  await expect(page.locator('#delete-account-dialog')).toBeVisible();

  // Escape and Cancel close it without asking the server for anything, and focus goes back to the
  // account button, since the menu item that opened it is hidden.
  await page.keyboard.press('Escape');
  await expect(page.locator('#delete-account-dialog')).toBeHidden();
  await expect(page.locator('#account-trigger')).toBeFocused();
  await openDeleteDialog(page);
  await page.locator('#cancel-delete-account').click();
  await expect(page.locator('#delete-account-dialog')).toBeHidden();
  await expect(page.locator('#account-trigger')).toBeFocused();
  expect(supabase.requests).not.toContain(FUNCTION_CALL);

  // Only the exact word arms the button, and the input starts empty each time.
  await openDeleteDialog(page);
  await expect(page.locator('#confirm-delete-input')).toHaveValue('');
  const confirm = page.locator('#confirm-delete-account');
  await expect(confirm).toBeDisabled();
  await page.keyboard.type('Delete', { delay: 60 });
  await expect(confirm).toBeDisabled();
  await page.locator('#confirm-delete-input').fill('');
  await page.keyboard.type('delete', { delay: 60 });
  await expect(confirm).toBeEnabled();
  await shot(page, testInfo, 'confirm-dark');

  const before = supabase.requests.length;
  await Promise.all([page.waitForEvent('load'), confirm.click()]);
  await expect(page.locator('#account')).toHaveAttribute('data-state', 'guest');
  await expect(page.locator('#account-toast')).toBeVisible();
  await expect(page.locator('#account-feedback')).toHaveText(DELETED_TOAST);
  await expect(page.locator('#account-toast')).toHaveAttribute('data-tone', 'done');
  await shot(page, testInfo, 'deleted-dark');

  // One call, and nothing saved, sent or signed out for the account after it.
  const after = supabase.requests.slice(before);
  expect(after.filter((request) => request === FUNCTION_CALL)).toHaveLength(1);
  expect(after.slice(after.indexOf(FUNCTION_CALL) + 1).filter((request) => /profiles|logout|race_action/.test(request) && !request.startsWith('GET'))).toEqual([]);
  expect(await storageKeys(page)).toEqual([]);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('stilltype')))).toEqual([]);

  // The server side: the account, its profile row, its races and friend rows. Bob keeps his own race
  // (without Ada's seat) and the email he typed, which now matches no account.
  expect(supabase.deletedUsers).toEqual([ADA]);
  expect(supabase.users.has(ADA)).toBe(false);
  expect(supabase.profiles.has(ada.id)).toBe(false);
  expect(supabase.races.rooms.has(adaRoom.id)).toBe(false);
  expect(supabase.races.rooms.get(bobRoom.id).players.map((player) => player.userId)).toEqual([bob.id]);
  expect(supabase.races.friends.has(ada.id)).toBe(false);
  expect(supabase.races.friends.get(bob.id)).toEqual([expect.objectContaining({ email: ADA })]);

  await openView(page, 'Progress');
  await expect(page.locator('#progress-empty')).toBeVisible();
  // The notice is shown once.
  await page.reload();
  await expect(page.locator('#account-toast')).toBeHidden();
  await page.locator('#account-trigger').click();
  await page.locator('#account-signin').click();
  await page.locator('#account-email-input').fill(ADA);
  await page.locator('#account-password').fill('correct horse battery');
  await page.locator('#account-submit').click();
  await expect(page.locator('#account-error')).toHaveText('Invalid login credentials');
});

test('a failed deletion says why and changes nothing on this device', async ({ page, supabase }, testInfo) => {
  supabase.addUser(ADA);
  await page.emulateMedia({ colorScheme: 'light' });
  await openApp(page);
  await signInWithEmail(page, ADA);
  await finishRun(page, supabase);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  const saved = await localState(page);
  expect(Object.keys(saved)).toHaveLength(2);

  await openDeleteDialog(page);
  await page.keyboard.type('delete', { delay: 60 });
  await shot(page, testInfo, 'confirm-light');
  const confirm = page.locator('#confirm-delete-account');
  const error = page.locator('#delete-account-error');

  // While the request is out, focus stays in the dialog, the form is busy, screen readers hear it,
  // and Escape can't close it.
  let held = null;
  await page.route('**/functions/v1/delete-account', (route) => (route.request().method() === 'POST' ? (held = route) : route.fallback()));
  supabase.deleteAccount = 'missing';
  await confirm.click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await expect(confirm).toHaveText('Deleting…');
  await expect(page.locator('#delete-account-form')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#delete-account-status')).toHaveText('Deleting your account…');
  await expect(page.locator('#confirm-delete-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#delete-account-dialog')).toBeVisible();
  await page.unroute('**/functions/v1/delete-account');
  await held.fallback();
  await expect(error).toHaveText('Account deletion isn’t switched on yet, so nothing was deleted. Try again later.');
  await expect(page.locator('#delete-account-form')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#delete-account-status')).toHaveText('');

  const attempts = [
    ['missing', 'Account deletion isn’t switched on yet, so nothing was deleted. Try again later.'],
    ['fail', 'Your account couldn’t be deleted just now, so nothing changed. Try again in a moment.'],
    ['blocked', 'Account deletion isn’t available right now, so nothing was deleted. Try again later.'],
  ];
  for (const [mode, message] of attempts) {
    supabase.deleteAccount = mode;
    await confirm.click();
    await expect(error).toHaveText(message);
    await expect(confirm).toBeEnabled();
    await expect(confirm).toHaveText('Delete account');
    await expect(page.locator('#confirm-delete-input')).toBeFocused();
    if (mode === 'missing') {
      await page.mouse.move(5, 5);
      await shot(page, testInfo, 'not-deployed-light');
    }
  }
  supabase.offline = true;
  await confirm.click();
  await expect(error).toHaveText('Can’t reach the account service. Check your connection and try again.');
  supabase.offline = false;

  // Nothing local moved: same session and cache, still signed in, history intact, account intact.
  expect(await localState(page)).toEqual(saved);
  await expect(page.locator('#account')).toHaveAttribute('data-state', 'member');
  expect(supabase.users.has(ADA)).toBe(true);
  expect(supabase.profileFor(ADA).runs).toHaveLength(1);
  await page.locator('#cancel-delete-account').click();
  await openView(page, 'Progress');
  await expect(page.locator('#run-history .run-row')).toHaveCount(1);

  // Once the function works, the same dialog finishes the job.
  supabase.deleteAccount = 'ok';
  await openDeleteDialog(page);
  await page.keyboard.type('delete', { delay: 60 });
  await Promise.all([page.waitForEvent('load'), page.keyboard.press('Enter')]);
  await expect(page.locator('#account')).toHaveAttribute('data-state', 'guest');
  await expect(page.locator('#account-feedback')).toHaveText(DELETED_TOAST);
  await shot(page, testInfo, 'deleted-light');
  expect(await storageKeys(page)).toEqual([]);
  expect(supabase.users.has(ADA)).toBe(false);
});

test('the palette offers deletion to members only, and the dialog fits a phone', async ({ page, supabase }, testInfo) => {
  supabase.addUser(ADA);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  const palette = async (query) => {
    await page.locator('#palette-trigger').click();
    await page.locator('#palette-input').fill(query);
  };
  await palette('delete account');
  await expect(page.locator('#palette-list')).not.toContainText('delete account');
  await page.keyboard.press('Escape');

  await signInWithEmail(page, ADA);
  await palette('delete account');
  await expect(page.locator('#palette-list')).toContainText('delete account…');
  await page.keyboard.press('Enter');
  await expect(page.locator('#delete-account-dialog')).toBeVisible();
  await expect(page.locator('#confirm-delete-input')).toBeFocused();
  await page.keyboard.type('delete', { delay: 60 });
  await shot(page, testInfo, 'confirm-mobile');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const box = await page.locator('#delete-account-dialog').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  for (const id of ['#cancel-delete-account', '#confirm-delete-account']) {
    const button = await page.locator(id).boundingBox();
    expect(button.x + button.width).toBeLessThanOrEqual(box.x + box.width);
  }

  // At 320px the actions wrap inside the dialog's padding instead of scrolling it sideways.
  await page.setViewportSize({ width: 320, height: 640 });
  const fit = await page.evaluate(() => {
    const dialog = document.querySelector('#delete-account-dialog');
    const form = document.querySelector('#delete-account-form');
    const edge = (side) => form.getBoundingClientRect()[side] + (side === 'left' ? 1 : -1) * parseFloat(getComputedStyle(form)[side === 'left' ? 'paddingLeft' : 'paddingRight']);
    return {
      scroll: dialog.scrollWidth, client: dialog.clientWidth, left: edge('left'), right: edge('right'),
      boxes: [...form.querySelectorAll('h2, p, input, .btn')].map((node) => node.getBoundingClientRect()).map(({ left, right }) => ({ left, right })),
    };
  });
  expect(fit.scroll).toBeLessThanOrEqual(fit.client);
  for (const { left, right } of fit.boxes) {
    expect(left).toBeGreaterThanOrEqual(fit.left - 0.5);
    expect(right).toBeLessThanOrEqual(fit.right + 0.5);
  }
  await shot(page, testInfo, 'confirm-320');
  await page.setViewportSize({ width: 390, height: 844 });

  await page.locator('#cancel-delete-account').click();
  await page.locator('#account-trigger').click();
  await expect(page.locator('#account-delete')).toBeVisible();
  await shot(page, testInfo, 'account-menu-mobile');
  expect(supabase.requests).not.toContain(FUNCTION_CALL);
});

test('a lost reply still finishes the deletion, and another open tab follows it', async ({ page, supabase }, testInfo) => {
  supabase.addUser(ADA);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await signInWithEmail(page, ADA);
  const other = await page.context().newPage();
  await supabase.attach(other);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-state', 'member');

  // The function deletes the account but the reply never arrives; the Auth server no longer knows
  // the account, so this is a finished deletion, not a network error.
  supabase.deleteAccount = 'lost';
  await openDeleteDialog(page);
  await page.keyboard.type('delete', { delay: 60 });
  await Promise.all([page.waitForEvent('load'), other.waitForEvent('load'), page.keyboard.press('Enter')]);
  await expect(page.locator('#account')).toHaveAttribute('data-state', 'guest');
  await expect(page.locator('#account-feedback')).toHaveText(DELETED_TOAST);
  await shot(page, testInfo, 'deleted-mobile');
  expect(supabase.users.has(ADA)).toBe(false);

  // The other tab is a guest now, so a run there saves nothing for the deleted account.
  await expect(other.locator('#account')).toHaveAttribute('data-state', 'guest');
  await chooseWords(other, 10);
  await typeInto(other, await passageText(other), '#typing-input', { delay: 150 });
  await expect(other.locator('body')).toHaveAttribute('data-view', 'results');
  expect(await storageKeys(other)).toEqual([]);
  await other.close();
});

test('a server error after the account was deleted still finishes the deletion', async ({ page, supabase }) => {
  supabase.addUser(ADA);
  await openApp(page);
  await signInWithEmail(page, ADA);
  await finishRun(page, supabase);

  // deleteUser committed but the function answered 500; the Auth server no longer knows the account.
  supabase.deleteAccount = 'deleted-then-500';
  await openDeleteDialog(page);
  await page.keyboard.type('delete', { delay: 60 });
  await page.keyboard.press('Enter');
  await expect(page.locator('#account')).toHaveAttribute('data-state', 'guest');
  await expect(page.locator('#account-feedback')).toHaveText(DELETED_TOAST);
  expect(await storageKeys(page)).toEqual([]);
  expect(supabase.deletedUsers).toEqual([ADA]);
  expect(supabase.requests.slice(supabase.requests.indexOf(FUNCTION_CALL))).toContain('GET /auth/v1/user');
  await openView(page, 'Progress');
  await expect(page.locator('#progress-empty')).toBeVisible();
});

test('opening deletion mid-run interrupts the run, and nothing typed in the dialog reaches it', async ({ page, supabase }) => {
  supabase.addUser(ADA);
  await openApp(page);
  await signInWithEmail(page, ADA);
  await chooseWords(page, 10);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 6), '#typing-input', { delay: 150 });
  await openDeleteDialog(page);
  await expect(page.locator('#typing-status')).toHaveText('Interrupted');
  await expect(page.locator('#input-help')).toHaveText('Account deletion opened mid-run, so it won’t count.');
  await page.keyboard.type('delete', { delay: 60 });
  await page.locator('#cancel-delete-account').click();
  await expect(page.locator('#typing-input')).not.toHaveValue(/delete/);

  await typeInto(page, text.slice(6), '#typing-input', { delay: 150 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Interrupted · not counted');
  await expect(page.locator('#best')).toHaveText('No best yet');
  expect(supabase.requests).not.toContain(FUNCTION_CALL);
});

test('a deletion that gets no answer gives up within 30 seconds in all and changes nothing', async ({ page, supabase }) => {
  supabase.addUser(ADA);
  await page.clock.install();
  await openApp(page);
  await signInWithEmail(page, ADA);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  const form = page.locator('#delete-account-form');
  const dialog = page.locator('#delete-account-dialog');
  const confirm = page.locator('#confirm-delete-account');

  // The page clock keeps flowing while the test acts, so "still busy" is checked with room to spare
  // and "done" just past the point it gives up: 30 s for the whole deletion, or sooner when one request
  // reaches the account service's own timeout (account.REQUEST_TIMEOUT_MS, 15 s) first.
  const givesUpWithin30s = async (call, { busyAt = 25_000, doneAt = 30_500 } = {}) => {
    const saved = await localState(page);
    await openDeleteDialog(page);
    await page.keyboard.type('delete', { delay: 60 });
    const before = supabase.requests.length;
    await confirm.click();
    await expect.poll(() => supabase.requests.slice(before)).toContain(call);
    await expect(form).toHaveAttribute('aria-busy', 'true');
    await page.clock.fastForward(busyAt);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(form).toHaveAttribute('aria-busy', 'true');
    await page.clock.fastForward(doneAt - busyAt);
    await expect(page.locator('#delete-account-error')).toHaveText('Can’t reach the account service. Check your connection and try again.');
    await expect(form).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#delete-account-status')).toHaveText('');
    await expect(confirm).toHaveText('Delete account');
    await expect(confirm).toBeEnabled();
    await expect(page.locator('#cancel-delete-account')).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Unconfirmed is not deleted: same session and cache, still signed in, account intact.
    expect(await localState(page)).toEqual(saved);
    await expect(page.locator('#account')).toHaveAttribute('data-state', 'member');
    expect(supabase.users.has(ADA)).toBe(true);
  };

  // The function call and the check after it both hang.
  supabase.blackholed.add(FUNCTION_CALL).add('GET /auth/v1/user');
  await givesUpWithin30s(FUNCTION_CALL);

  // An hour on, the token needs refreshing first, and the refresh hangs as well. The refresh gives up at
  // the account service's request timeout, before the deletion's own deadline.
  supabase.blackholed.add('POST /auth/v1/token');
  await page.clock.setSystemTime(Date.now() + 3_600_000);
  await givesUpWithin30s('POST /auth/v1/token?grant_type=refresh_token', { busyAt: 12_000, doneAt: 15_500 });
  expect(supabase.deletedUsers).toEqual([]);
});
