import { test, expect, openApp, openView, signInWithEmail, typeInto } from './fixtures.js';

test.setTimeout(60000);

async function hostRace(page, supabase, email = '') {
  supabase.addUser('host@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#online-name').fill('Ada');
  await page.locator('#online-invite-email').fill(email);
  await page.locator('#create-online-race').click();
  await expect(page.locator('#online-room')).toBeVisible();
  return [...supabase.races.rooms.values()][0];
}

async function guestPage(browser, supabase, link) {
  const context = await browser.newContext();
  const guest = await context.newPage();
  const errors = [];
  guest.on('pageerror', (error) => errors.push(error.message));
  await supabase.attach(guest);
  await guest.goto(link);
  await expect(guest.locator('#online-guest-join')).toBeVisible();
  return { context, guest, errors };
}

test('an account hosts a guest across separate contexts, shares progress and finishes', async ({ page, browser, supabase }) => {
  const room = await hostRace(page, supabase);
  const link = await page.locator('#online-guest-link').inputValue();
  expect(link).toContain(room.id);
  const { context, guest, errors } = await guestPage(browser, supabase, link);
  try {
    await guest.locator('#online-guest-name').fill('Lin');
    await guest.locator('#join-online-race').click();
    await expect(guest.locator('#online-room')).toBeVisible();
    await expect(page.locator('#online-players')).toContainText('Lin');
    await page.locator('#online-ready').click();
    await guest.locator('#online-ready').click();
    await expect(guest.locator('#online-input')).toBeDisabled();
    await expect(page.locator('#online-input')).toBeEnabled({ timeout: 12000 });
    await expect(guest.locator('#online-input')).toBeEnabled();
    const passage = await page.locator('#online-accessible-passage').textContent();
    await expect(guest.locator('#online-accessible-passage')).toHaveText(passage);
    await typeInto(page, passage.slice(0, 20), '#online-input', { delay: 15 });
    await expect.poll(() => room.players[0].progress).toBeGreaterThan(0);
    await expect.poll(() => room.players[0].typed).toBe(passage.slice(0, 20));
    // Reload must restore the acknowledged prefix and advance the server sequence.
    await page.reload();
    await expect(page.locator('#online-input')).toBeEnabled();
    await expect(page.locator('#online-input')).toHaveValue(passage.slice(0, 20));
    // A complete passage finishes early; both clients observe the same final scores.
    await typeInto(page, passage.slice(20), '#online-input', { delay: 15 });
    await typeInto(guest, passage, '#online-input', { delay: 15 });
    await expect(page.locator('#online-results')).toBeVisible({ timeout: 10000 });
    await expect(guest.locator('#online-results')).toBeVisible();
    await expect(page.locator('#online-result-rows .race-result-row')).toHaveCount(2);
    expect(await guest.locator('#online-result-rows').textContent()).toBe(await page.locator('#online-result-rows').textContent());
    await expect(page.locator('#best')).toHaveText('No best yet');
    expect(supabase.profileFor('host@stilltype.test').attempts).toHaveLength(0);
    expect(await guest.evaluate(() => Object.keys(localStorage))).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('account invitations appear only in the invited account inbox', async ({ page, browser, supabase }) => {
  supabase.addUser('friend@stilltype.test');
  const room = await hostRace(page, supabase, 'friend@stilltype.test');
  await expect(page.locator('#online-guest-link')).toBeHidden();
  const context = await browser.newContext();
  const friend = await context.newPage();
  await supabase.attach(friend);
  try {
    await openApp(friend);
    await signInWithEmail(friend, 'friend@stilltype.test');
    await openView(friend, 'Challenge');
    await expect(friend.locator('#online-invites')).toContainText('Ada');
    await friend.locator('[data-accept-invite]').click();
    await expect(friend.locator('#online-room')).toBeVisible();
    await expect.poll(() => room.players.length).toBe(2);
    await expect(page.locator('#online-players')).toContainText(room.players[1].name);
    const outsider = supabase.addUser('outsider@stilltype.test');
    expect(await new Promise((resolve) => supabase.races.handle(outsider.id, { p_action: 'invites' }, (_, body) => resolve(body)))).toEqual([]);
  } finally { await context.close(); }
});

test('a guest resumes the same seat after reload and sees host cancellation', async ({ page, browser, supabase }) => {
  const room = await hostRace(page, supabase);
  const link = await page.locator('#online-guest-link').inputValue();
  await page.reload();
  await expect(page.locator('#online-guest-link')).toHaveValue(link);
  const { context, guest } = await guestPage(browser, supabase, link);
  try {
    await guest.locator('#online-guest-name').fill('Lin');
    await guest.locator('#join-online-race').click();
    await expect(guest.locator('#online-room')).toBeVisible();
    await guest.reload();
    await expect(guest.locator('#online-room')).toBeVisible();
    expect(room.players).toHaveLength(2);
    await page.locator('#online-leave').click();
    await expect(guest.locator('#online-room-status')).toContainText(/cancel|left/i);
    await expect(guest.locator('#online-input')).toBeDisabled();
  } finally { await context.close(); }
});

test('a used guest link cannot replace an occupied seat', async ({ page, browser, supabase }) => {
  const room = await hostRace(page, supabase);
  const link = await page.locator('#online-guest-link').inputValue();
  const first = await guestPage(browser, supabase, link);
  const second = await guestPage(browser, supabase, link);
  try {
    await first.guest.locator('#online-guest-name').fill('Lin');
    await first.guest.locator('#join-online-race').click();
    await expect(first.guest.locator('#online-room')).toBeVisible();
    await second.guest.locator('#online-guest-name').fill('Third player');
    await second.guest.locator('#join-online-race').click();
    await expect(second.guest.locator('#online-error')).toContainText(/full|unavailable/i);
    expect(room.players.map((p) => p.name)).toEqual(['Ada', 'Lin']);
  } finally { await first.context.close(); await second.context.close(); }
});

test('race lobby fits a narrow phone in both themes', async ({ page, supabase }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await hostRace(page, supabase);
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await expect(page.locator('#copy-race-link')).toBeVisible();
  }
});

test('an expired guest link explains why it cannot join', async ({ page, browser, supabase }) => {
  const room = await hostRace(page, supabase);
  const link = await page.locator('#online-guest-link').inputValue();
  room.expiresAt = new Date(Date.now() - 1000).toISOString();
  const { context, guest } = await guestPage(browser, supabase, link);
  try {
    await guest.locator('#online-guest-name').fill('Lin');
    await guest.locator('#join-online-race').click();
    await expect(guest.locator('#online-error')).toContainText(/no longer|expired/i);
    expect(room.players).toHaveLength(1);
  } finally { await context.close(); }
});

test('a temporary disconnect holds the room and recovers', async ({ page, supabase }) => {
  await hostRace(page, supabase);
  supabase.offline = true;
  await expect(page.locator('#online-connection')).toContainText(/interrupted|retrying/i);
  supabase.offline = false;
  await expect(page.locator('#online-connection')).toBeEmpty();
  await expect(page.locator('#online-room')).toBeVisible();
});
