import { test, expect, openApp, openView, signInWithEmail, typeInto, openSettings, chooseSetting } from './fixtures.js';

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
  await expect(page.locator('#challenge-daily')).toBeDisabled();
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

test('an account hosts a guest across separate contexts, shares progress, resumes with the word highlight in step, and finishes', async ({ page, browser, supabase }) => {
  test.setTimeout(120_000);
  // The online passage marks words through its own input handler and its resume path.
  const tinted = () => page.locator('#online-text-display .word').evaluateAll((nodes) => nodes
    .filter((node) => [...node.children].some((char) => !char.classList.contains('wrong') && getComputedStyle(char).backgroundColor !== 'rgba(0, 0, 0, 0)'))
    .map((node) => Number(node.dataset.wordIndex)));
  const room = await hostRace(page, supabase);
  await openSettings(page);
  await chooseSetting(page, 'word-highlight', 'current');
  await openSettings(page, 'shortcuts');
  await page.locator('#keybinding-restart').fill('F2');
  await page.locator('#keybinding-restart').press('Enter');
  await page.keyboard.press('Escape');
  await expect.poll(() => supabase.profileFor('host@stilltype.test')?.preferences.wordHighlight, { timeout: 8000 }).toBe('current');
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
    expect(await tinted()).toEqual([0]);
    // The word the caret is in: as many words in as there are spaces before it.
    const word = passage.slice(0, 20).split(' ').length - 1;
    expect(word).toBeGreaterThan(0);
    await typeInto(page, passage.slice(0, 20), '#online-input', { delay: 15 });
    expect(await tinted()).toEqual([word]);
    await expect.poll(() => room.players[0].progress).toBeGreaterThan(0);
    await expect.poll(() => room.players[0].typed).toBe(passage.slice(0, 20));
    // Solo/local restart bindings must never reset a live online room or move its focus.
    await page.keyboard.press('F2');
    await page.keyboard.press('Escape');
    await expect(page.locator('#online-input')).toHaveValue(passage.slice(0, 20));
    await expect(page.locator('#online-input')).toBeFocused();
    // Reload must restore the acknowledged prefix and advance the server sequence.
    await page.reload();
    await expect(page.locator('#online-input')).toBeEnabled();
    await expect(page.locator('#online-input')).toHaveValue(passage.slice(0, 20));
    // The acknowledged prefix is redrawn, and the highlight resumes where it was, then moves on.
    expect(await tinted()).toEqual([word]);
    const next = passage.indexOf(' ', 20) + 1;
    await typeInto(page, passage.slice(20, next), '#online-input', { delay: 15 });
    expect(await tinted()).toEqual([word + 1]);
    // A complete passage finishes early; both clients observe the same final scores.
    await typeInto(page, passage.slice(next), '#online-input', { delay: 15 });
    await typeInto(guest, passage, '#online-input', { delay: 15 });
    await expect(page.locator('#online-results')).toBeVisible({ timeout: 10000 });
    await expect(guest.locator('#online-results')).toBeVisible();
    await expect(page.locator('#online-results .duel-side')).toHaveCount(2);
    // Each sees the same two results, their own on the left.
    for (const [mine, theirs] of [['mine', 'theirs'], ['theirs', 'mine']]) {
      expect(await guest.locator(`#online-duel-${theirs} :is(.duel-speed, .duel-accuracy)`).allTextContents())
        .toEqual(await page.locator(`#online-duel-${mine} :is(.duel-speed, .duel-accuracy)`).allTextContents());
    }
    await expect(page.locator('#best')).toHaveText('No best yet');
    expect(supabase.profileFor('host@stilltype.test')).not.toHaveProperty('attempts');
    expect((await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith('stilltype-profile-v2:')))).attempts))).toHaveLength(0);
    expect(await guest.evaluate(() => Object.keys(localStorage))).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('typing opens when the shared countdown ends, without waiting for a poll to say so', async ({ page, browser, supabase }) => {
  const room = await hostRace(page, supabase);
  const link = await page.locator('#online-guest-link').inputValue();
  const { context, guest } = await guestPage(browser, supabase, link);
  try {
    await guest.locator('#online-guest-name').fill('Lin');
    await guest.locator('#join-online-race').click();
    await expect(page.locator('#online-players')).toContainText('Lin');
    await page.evaluate(() => {
      const input = document.getElementById('online-input');
      new MutationObserver(() => { if (!input.disabled) window.enabledAt ??= Date.now(); }).observe(input, { attributes: true, attributeFilter: ['disabled'] });
    });
    await page.locator('#online-ready').click();
    await guest.locator('#online-ready').click();
    await expect(page.locator('#online-countdown')).toContainText('Starting in');
    // The service answers nothing from here until the race is under way.
    supabase.races.held = [];
    supabase.races.holding = new Set(['get']);
    await expect(page.locator('#online-input')).toBeEnabled({ timeout: 8000 });
    expect(await page.evaluate(() => window.enabledAt) - Date.parse(room.startAt)).toBeLessThan(150);
    const passage = await page.locator('#online-accessible-passage').textContent();
    await typeInto(page, passage.slice(0, 5), '#online-input', { delay: 15 });
    await expect(page.locator('#online-input')).toHaveValue(passage.slice(0, 5));
    supabase.races.holding = new Set();
    for (const release of supabase.races.held) release();
    await expect.poll(() => room.players[0].typed).toBe(passage.slice(0, 5));
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
    await expect(page.locator('#challenge-daily')).toBeEnabled();
    await page.locator('#challenge-daily').click();
    await expect(page.locator('#daily-challenge')).toBeVisible();
    await expect(page.locator('#online-challenge')).toBeHidden();
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
