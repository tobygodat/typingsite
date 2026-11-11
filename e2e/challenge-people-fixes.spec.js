// The independent check of PR 134: what a one-press Race uses, the people links after another tab's friend change,
// where focus lands after Dismiss, friends who share a name, a tally nobody has won yet, and a missing race_people.
import { test, expect, openApp, openView, signInWithEmail, chooseWords } from './fixtures.js';

test.setTimeout(90000);

const rows = (page) => page.locator('#people-list .people-row');
const pair = (a, b) => [a, b].sort().join(':');

async function signedIn(page, email = 'toby@stilltype.test') {
  await openApp(page);
  await signInWithEmail(page, email);
  await openView(page, 'Challenge');
}

test('the Race setup link says what a one-press Race uses, the room says it too, and the setup holds for the tab across a reload', async ({ page, supabase }) => {
  const toby = supabase.addUser('toby@stilltype.test');
  const sam = supabase.addUser('sam@stilltype.test');
  supabase.races.addFriend(toby.id, { name: 'Sam', friendId: sam.id });
  await openApp(page);
  await signInWithEmail(page, 'toby@stilltype.test');
  await chooseWords(page, 10);
  await openView(page, 'Challenge');
  const setup = page.locator('#people-setup');
  // With nothing changed, a Race uses the practice setup, and the link says so.
  await expect(setup).toContainText('10 words');
  await setup.click();
  await page.locator('#online-options [data-mode="quote"]').click();
  await expect(page.locator('#online-customize-reset')).toBeVisible();
  await page.locator('#online-setup-done').click();
  await expect(setup).toContainText('quote');

  // Practice moves on; the race setup doesn't, and Match practice still shows.
  await openView(page, 'Practice');
  await page.locator('#mode-time').click();
  await page.locator('#duration-options [data-length="30"]').click();
  await openView(page, 'Challenge');
  await expect(setup).toContainText('quote');

  // A reload keeps the tab's setup.
  await page.reload();
  await openView(page, 'Challenge');
  await expect(setup).toContainText('quote');
  await setup.click();
  await expect(page.locator('#online-options [data-mode="quote"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#online-customize-reset')).toBeVisible();
  await page.locator('#online-setup-done').click();

  await page.getByRole('button', { name: 'Race Sam', exact: true }).click();
  await expect(page.locator('#online-room')).toBeVisible();
  const room = [...supabase.races.rooms.values()].at(-1);
  expect(room.conditions.mode).toBe('quote');
  await expect(page.locator('#online-room-conditions')).toContainText('quote');

  // A new tab starts from practice.
  const other = await page.context().newPage();
  await supabase.attach(other);
  await other.goto('/');
  await openView(other, 'Challenge');
  await expect(other.locator('#people-setup')).toContainText('30 s');
  await other.close();
});

test('Match practice shows whenever the setup differs from practice, and not when it matches', async ({ page, supabase }) => {
  supabase.addUser('toby@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'toby@stilltype.test');
  await chooseWords(page, 25);
  await openView(page, 'Challenge');
  await page.locator('#people-setup').click();
  const reset = page.locator('#online-customize-reset');
  await expect(reset).toBeHidden();
  await page.locator('#online-options [data-mode="time"]').click();
  await expect(reset).toBeVisible();
  // Back to the practice setup by hand: nothing differs, so nothing to match.
  await page.locator('#online-options [data-mode="words"]').click();
  await page.locator('#online-options [data-length="25"]').click();
  await expect(reset).toBeHidden();
});

test('a friend change in another tab reads the links again: an invitation joins its friend’s row with the tally at once', async ({ page, supabase }) => {
  const toby = supabase.addUser('toby@stilltype.test');
  const kim = supabase.addUser('kim@stilltype.test');
  supabase.races.invite(kim.id, toby.id, { name: 'Kim' });
  await signedIn(page);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute('data-key', /^invite:/);
  // Every read the page makes on its own (the inbox's first poll and the links read it sets off) is done.
  await expect.poll(() => supabase.requests.filter((entry) => entry.includes('/rpc/race_people')).length).toBeGreaterThan(0);
  await page.waitForTimeout(2000);

  // Kim becomes an account friend on the service, and the pair has raced; another tab makes a friend change.
  supabase.races.addFriend(toby.id, { name: 'Kim', friendId: kim.id });
  supabase.races.tallies.set(pair(toby.id, kim.id), toby.id < kim.id ? [2, 1] : [1, 2]);
  const other = await page.context().newPage();
  await supabase.attach(other);
  await other.goto('/');
  await openView(other, 'Challenge');
  await other.locator('#people-add').click();
  await other.locator('#online-invite-email').fill('mo@stilltype.test');
  await other.locator('#add-friend').click();

  // Kim's friend row takes the invitation, and Kim is listed once.
  await expect(page.locator('#people-list .people-row[data-key^="friend:"][data-state="invited"]', { hasText: 'Kim' })).toHaveCount(1, { timeout: 5000 });
  const kimRow = page.locator('#people-list .people-row', { hasText: 'Kim' });
  await expect(kimRow).toHaveCount(1);
  await expect(kimRow.locator('.people-tally .sr-only')).toHaveText('2 wins, 1 loss');
  await other.close();
});

test('after Dismiss focus lands where a second press destroys nothing', async ({ page, supabase }) => {
  const toby = supabase.addUser('toby@stilltype.test');
  const kim = supabase.addUser('kim@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  const ada = supabase.addUser('ada@stilltype.test');
  supabase.races.addFriend(toby.id, { name: 'Ada', friendId: ada.id });
  supabase.races.invite(ada.id, toby.id, { name: 'Ada', ageMs: 60000 });
  supabase.races.invite(kim.id, toby.id, { name: 'Kim', ageMs: 30000 });
  supabase.races.invite(lin.id, toby.id, { name: 'Lin' });
  await signedIn(page);
  await expect(page.locator('#people-list [data-state="invited"]')).toHaveCount(3);
  await expect(rows(page).first()).toHaveAttribute('data-key', /^friend:/);

  // Ada's row stays (Ada is a friend): focus goes to Ada's Race, and a second press only starts nothing destructive.
  await page.getByRole('button', { name: 'Dismiss Ada’s invitation' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Race Ada', exact: true })).toBeFocused();

  // Kim's row goes: focus goes to the next row's main action, Lin's Join, never Lin's Dismiss.
  await page.getByRole('button', { name: 'Dismiss Kim’s invitation' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#people-list [data-key^="invite:"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Join Lin’s race' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Dismiss Lin’s invitation' })).toBeVisible();
});

test('the last invitation dismissed hands focus to the list’s first control, never a Dismiss', async ({ page, supabase }) => {
  const toby = supabase.addUser('toby@stilltype.test');
  const kim = supabase.addUser('kim@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  supabase.races.invite(kim.id, toby.id, { name: 'Kim', ageMs: 30000 });
  supabase.races.invite(lin.id, toby.id, { name: 'Lin' });
  await signedIn(page);
  await expect(page.locator('#people-list [data-state="invited"]')).toHaveCount(2);
  const last = rows(page).last();
  const name = await last.locator('.people-name').textContent();
  await last.getByRole('button', { name: `Dismiss ${name}’s invitation` }).focus();
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().locator('.people-action')).toBeFocused();
});

test('friends who share a name are told apart by the email typed for them, seen and heard', async ({ page, supabase }) => {
  const toby = supabase.addUser('toby@stilltype.test');
  supabase.races.addFriend(toby.id, { name: 'Sam', email: 'sam.achebe@example.com' });
  supabase.races.addFriend(toby.id, { name: 'Sam', email: 'sam.ortiz@example.com' });
  await signedIn(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Race Sam (sam.achebe@example.com)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Race Sam (sam.ortiz@example.com)' })).toBeVisible();
  await expect(rows(page).filter({ hasText: 'sam.achebe@example.com' }).locator('.people-name')).toContainText('sam.achebe@example.com');
});

test('a tally nobody has won yet is not printed', async ({ page, supabase }) => {
  const toby = supabase.addUser('toby@stilltype.test');
  const sam = supabase.addUser('sam@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  supabase.races.addFriend(toby.id, { name: 'Sam', friendId: sam.id });
  supabase.races.addFriend(toby.id, { name: 'Lin', friendId: lin.id });
  supabase.races.tallies.set(pair(toby.id, sam.id), [0, 0]);
  supabase.races.tallies.set(pair(toby.id, lin.id), toby.id < lin.id ? [1, 0] : [0, 1]);
  await signedIn(page);
  // Lin's tally shows once the links have come back; Sam's, all ties, doesn't.
  await expect(rows(page).filter({ hasText: 'Lin' }).locator('.people-tally .sr-only')).toHaveText('1 win, 0 losses');
  await expect(rows(page).filter({ hasText: 'Sam' }).locator('.people-tally')).toHaveCount(0);
});

test('without race_people the page asks for it once per load, however often the list is opened', async ({ page, supabase }) => {
  const toby = supabase.addUser('toby@stilltype.test');
  const kim = supabase.addUser('kim@stilltype.test');
  supabase.peopleMissing = true;
  await signedIn(page);
  const asked = () => supabase.requests.filter((entry) => entry.includes('/rpc/race_people')).length;
  await expect.poll(asked).toBe(1);

  for (let index = 0; index < 3; index += 1) {
    await openView(page, 'Practice');
    await openView(page, 'Challenge');
  }

  // New invitations and polls don't ask again either.
  supabase.races.invite(kim.id, toby.id, { name: 'Kim' });
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(rows(page)).toHaveCount(1, { timeout: 15000 });
  await page.waitForTimeout(1500);
  expect(asked()).toBe(1);
});
