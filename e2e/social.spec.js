import { test, expect, openApp, openView, signInWithEmail, typeInto, chooseWords, passageText } from './fixtures.js';

test.setTimeout(90000);

async function member(browser, supabase, email) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await supabase.attach(page);
  await openApp(page);
  await signInWithEmail(page, email);
  return { context, page };
}

async function race(host, guest) {
  await host.locator('#online-ready').click();
  await guest.locator('#online-ready').click();
  await expect(host.locator('#online-input')).toBeEnabled({ timeout: 12000 });
  await expect(guest.locator('#online-input')).toBeEnabled();
  const passage = await host.locator('#online-accessible-passage').textContent();
  await typeInto(host, passage, '#online-input', { delay: 5 });
  await typeInto(guest, passage, '#online-input', { delay: 5 });
  await expect(host.locator('#online-results')).toBeVisible({ timeout: 10000 });
  await expect(guest.locator('#online-results')).toBeVisible({ timeout: 10000 });
}

test('a saved friend is challenged without retyping their email, and the challenge arrives as a toast and in the inbox', async ({ page, browser, supabase }) => {
  supabase.addUser('host@stilltype.test');
  supabase.addUser('lin@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await openView(page, 'Challenge');
  await expect(page.locator('#online-friends')).toContainText('Save someone');
  await page.locator('#online-name').fill('Ada');
  await page.locator('#online-invite-email').fill('lin@stilltype.test');
  await expect(page.locator('#online-save-friend')).toBeChecked();
  await page.locator('#create-online-race').click();
  await expect(page.locator('#online-room')).toBeVisible();
  await expect.poll(() => supabase.races.friendList(supabase.users.get('host@stilltype.test').id).map((f) => f.email)).toEqual(['lin@stilltype.test']);
  await page.locator('#online-leave').click();

  // One click from the friend list sends the next challenge.
  const row = page.locator('.online-friend-row', { hasText: 'lin@stilltype.test' });
  await expect(row).toContainText('lin');
  await row.getByRole('button', { name: 'Challenge lin' }).click();
  await expect(page.locator('#online-room')).toBeVisible();
  await expect(page.locator('#online-account-invite-status')).toContainText('lin@stilltype.test');
  const room = [...supabase.races.rooms.values()].at(-1);
  expect(room.invitedUser).toBe(supabase.users.get('lin@stilltype.test').id);

  // The invited account sees a toast top right and an unread envelope, from any screen.
  const { context, page: lin } = await member(browser, supabase, 'lin@stilltype.test');
  try {
    const toast = lin.locator('#challenge-toast');
    await expect(toast).toBeVisible({ timeout: 12000 });
    await expect(toast).toContainText('Ada challenged you to a race.');
    const box = await toast.boundingBox();
    const viewport = lin.viewportSize();
    expect(box.y).toBeLessThan(200);
    expect(box.x + box.width).toBeGreaterThan(viewport.width - 40);
    await expect(lin.locator('#inbox-count')).toHaveText(/^[1-9]/);
    await toast.getByRole('button', { name: 'Join' }).click();
    await expect(toast).toBeHidden();
    await expect(lin.locator('body')).toHaveAttribute('data-view', 'compete');
    await expect(lin.locator('#online-room')).toBeVisible();
    await expect.poll(() => room.players.length).toBe(2);
    // The inbox keeps it, already read.
    await expect(lin.locator('#inbox-count')).toBeHidden();
    await lin.locator('#inbox-trigger').click();
    await expect(lin.locator('#inbox-list')).toContainText('Ada challenged you to a race.');
  } finally { await context.close(); }
});

test('the challenge toast leaves on its own after about eighteen seconds', async ({ page, supabase }) => {
  const host = supabase.addUser('host@stilltype.test');
  supabase.addUser('lin@stilltype.test');
  await page.clock.install();
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await new Promise((resolve) => supabase.races.handle(host.id, { p_action: 'create', p_data: {
    passage: 'The quick brown fox jumps over the lazy dog, twice over.', conditions: {}, displayName: 'Ada', inviteEmail: 'lin@stilltype.test',
  } }, resolve));
  await page.clock.fastForward(11000);
  await expect(page.locator('#challenge-toast')).toBeVisible();
  await page.mouse.move(5, 400);
  await page.clock.fastForward(15000);
  await expect(page.locator('#challenge-toast')).toBeVisible();
  await page.clock.fastForward(4000);
  await expect(page.locator('#challenge-toast')).toBeHidden();
  // Still in the inbox afterwards, and not toasted again on the next poll.
  await page.clock.fastForward(11000);
  await expect(page.locator('#challenge-toast')).toBeHidden();
  await page.locator('#inbox-trigger').click();
  await expect(page.locator('#inbox-list [data-inbox-action="invite"]')).toHaveText('Join');
});

test('a challenge that arrives mid-run waits for the run to end, even with the chrome revealed', async ({ page, supabase }) => {
  const host = supabase.addUser('host@stilltype.test');
  supabase.addUser('lin@stilltype.test');
  await page.clock.install();
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await chooseWords(page, 10);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 3));
  await page.mouse.move(10, 10);
  await page.mouse.move(80, 80);
  await expect(page.locator('body')).toHaveAttribute('data-running', 'false');
  await new Promise((resolve) => supabase.races.handle(host.id, { p_action: 'create', p_data: {
    passage: 'The quick brown fox jumps over the lazy dog, twice over.', conditions: {}, displayName: 'Ada', inviteEmail: 'lin@stilltype.test',
  } }, resolve));
  await page.clock.fastForward(11000);
  // Give a poll, had one started, time to come back.
  await page.waitForTimeout(1500);
  await expect(page.locator('#challenge-toast')).toBeHidden();
  await expect(page.locator('#inbox-count')).toBeHidden();
  await page.keyboard.type(text.slice(3));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await page.clock.fastForward(11000);
  await expect(page.locator('#challenge-toast')).toContainText('Ada challenged you to a race.');
});

test('a challenge waits while a one-keyboard race is being typed', async ({ page, supabase }) => {
  const host = supabase.addUser('host@stilltype.test');
  supabase.addUser('lin@stilltype.test');
  await page.clock.install();
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#challenge-local').click();
  await page.locator('#player-one-name').fill('Ada');
  await page.locator('#player-two-name').fill('Lin');
  await page.locator('#start-local-race').click();
  const text = await page.locator('#race-accessible-passage').textContent();
  await typeInto(page, text.slice(0, 3), '#race-input');
  await new Promise((resolve) => supabase.races.handle(host.id, { p_action: 'create', p_data: {
    passage: 'The quick brown fox jumps over the lazy dog, twice over.', conditions: {}, displayName: 'Ada', inviteEmail: 'lin@stilltype.test',
  } }, resolve));
  await page.clock.fastForward(11000);
  await page.waitForTimeout(1500);
  await expect(page.locator('#challenge-toast')).toBeHidden();
  await page.keyboard.type(text.slice(3));
  await expect(page.locator('#race-handoff')).toBeVisible();
  await page.clock.fastForward(11000);
  await expect(page.locator('#challenge-toast')).toContainText('Ada challenged you to a race.');
});

test('after a race either player can race again against the same opponent, and add them as a friend', async ({ page, browser, supabase }) => {
  supabase.addUser('host@stilltype.test');
  supabase.addUser('lin@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#online-name').fill('Ada');
  await page.locator('#online-invite-email').fill('lin@stilltype.test');
  await page.locator('#online-save-friend').uncheck();
  await page.locator('#create-online-race').click();
  const first = [...supabase.races.rooms.values()][0];
  const { context, page: lin } = await member(browser, supabase, 'lin@stilltype.test');
  try {
    await openView(lin, 'Challenge');
    await lin.locator('#online-name').fill('Lin');
    await lin.locator('[data-accept-invite]').click();
    await expect(lin.locator('#online-room')).toBeVisible();
    await race(page, lin);

    // The invited racer can keep the host; the host already knows them by email.
    await expect(lin.locator('#online-befriend')).toHaveText('Add Ada to friends');
    await expect(page.locator('#online-befriend')).toBeHidden();
    await lin.locator('#online-befriend').click();
    await expect(lin.locator('#online-befriend')).toBeHidden();
    expect(supabase.races.friendList(supabase.users.get('lin@stilltype.test').id)).toEqual([expect.objectContaining({ name: 'Ada', account: true })]);

    // The result is in the inbox with its own Race again.
    await page.locator('#inbox-trigger').click();
    await expect(page.locator('#inbox-list')).toContainText(/Lin: \d+ wpm to \d+/);
    await expect(page.locator('#inbox-list [data-inbox-action="result"]')).toHaveText('Race again');
    // The race Lin joined is over, so that entry no longer opens it.
    await expect(page.locator('#inbox-list [data-kind="joined"]')).toContainText('closed');
    await expect(page.locator('#inbox-list [data-inbox-action="joined"]')).toHaveCount(0);
    await page.locator('#inbox-trigger').click();

    // Lin asks first; Ada sees the request and joins the same new room with one click.
    await lin.locator('#online-rematch').click();
    await expect(lin.locator('#online-room-status')).toContainText('Rematch sent. Waiting for Ada to join.');
    await expect(page.locator('#online-rematch-note')).toHaveText('Lin wants a rematch.', { timeout: 8000 });
    await expect(page.locator('#challenge-toast')).toContainText('Lin wants a rematch.', { timeout: 12000 });
    await expect(page.locator('#online-rematch')).toHaveText('Join rematch');
    await page.locator('#online-rematch').click();
    const rematch = supabase.races.rooms.get(first.rematchId);
    expect(rematch.rematchOf).toBe(first.id);
    expect(rematch.players.map((p) => p.name)).toEqual(['Ada', 'Lin']);
    await expect(page.locator('#online-players')).toContainText('Lin');
    await expect(lin.locator('#online-room-status')).toContainText('Both players are here.', { timeout: 5000 });
    await race(page, lin);
    expect(supabase.races.rooms.size).toBe(2);

    // A result outlives its room only so long: past the service's retention it has no Race again.
    await page.locator('#online-leave').click();
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((name) => name.startsWith('stilltype-inbox-v1:'));
      const entries = JSON.parse(localStorage.getItem(key));
      for (const entry of entries) if (entry.kind === 'result') entry.until = new Date(Date.now() - 1000).toISOString();
      localStorage.setItem(key, JSON.stringify(entries));
    });
    await page.reload();
    await page.locator('#inbox-trigger').click();
    await expect(page.locator('#inbox-list [data-kind="result"]').first()).toContainText('closed');
    await expect(page.locator('#inbox-list [data-inbox-action="result"]')).toHaveCount(0);
    // The rematch request Ada answered from the race is used up too.
    await expect(page.locator('#inbox-list [data-kind="invite"]').first()).toContainText('closed');
    await expect(page.locator('#inbox-list [data-inbox-action="invite"]')).toHaveCount(0);
  } finally { await context.close(); }
});

test('a guest races again with the same seat and no new link', async ({ page, browser, supabase }) => {
  supabase.addUser('host@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#online-name').fill('Ada');
  await page.locator('#create-online-race').click();
  const link = await page.locator('#online-guest-link').inputValue();
  const context = await browser.newContext();
  const guest = await context.newPage();
  await supabase.attach(guest);
  try {
    await guest.goto(link);
    await guest.locator('#online-guest-name').fill('Lin');
    await guest.locator('#join-online-race').click();
    await race(page, guest);
    await expect(guest.locator('#inbox')).toBeHidden();
    await expect(guest.locator('#online-befriend')).toBeHidden();
    await page.locator('#online-rematch').click();
    await expect(page.locator('#online-players')).toContainText('invited');
    await expect(guest.locator('#challenge-toast')).toContainText('Ada wants a rematch.', { timeout: 8000 });
    await guest.locator('#challenge-toast').getByRole('button', { name: 'Join' }).click();
    await expect(guest.locator('#online-rematch-note')).toBeHidden();
    await expect(page.locator('#online-room-status')).toContainText('Both players are here.', { timeout: 5000 });
    await race(page, guest);
    expect(await guest.evaluate(() => Object.keys(localStorage))).toEqual([]);
  } finally { await context.close(); }
});

test('a guest’s rematch toast goes away when the host cancels the rematch', async ({ page, browser, supabase }) => {
  supabase.addUser('host@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#online-name').fill('Ada');
  await page.locator('#create-online-race').click();
  const link = await page.locator('#online-guest-link').inputValue();
  const context = await browser.newContext();
  const guest = await context.newPage();
  await supabase.attach(guest);
  try {
    await guest.goto(link);
    await guest.locator('#online-guest-name').fill('Lin');
    await guest.locator('#join-online-race').click();
    await race(page, guest);
    await page.locator('#online-rematch').click();
    await expect(guest.locator('#challenge-toast')).toContainText('Ada wants a rematch.', { timeout: 8000 });
    await expect(guest.locator('#online-rematch')).toHaveText('Join rematch');
    await page.locator('#online-leave').click();
    await expect(guest.locator('#challenge-toast')).toBeHidden({ timeout: 8000 });
    await expect(guest.locator('#online-rematch-note')).toBeHidden();
    await expect(guest.locator('#online-rematch')).toHaveText('Race again');
  } finally { await context.close(); }
});

test('the inbox sits beside the account button without touching the dock', async ({ page, supabase }) => {
  supabase.addUser('host@stilltype.test');
  await openApp(page);
  await expect(page.locator('#inbox')).toBeHidden();
  await signInWithEmail(page, 'host@stilltype.test');
  for (const width of [320, 390, 761, 800, 900, 901, 1000, 1280]) {
    await page.setViewportSize({ width, height: 760 });
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
      const inbox = await page.locator('#inbox-trigger').boundingBox();
      const account = await page.locator('#account-trigger').boundingBox();
      const dock = await page.locator('.dock').boundingBox();
      // Beside the person where there is room, under it where the dock would be in the way.
      const beside = inbox.x + inbox.width <= account.x + 1 && Math.abs(inbox.y - account.y) < 1;
      const under = inbox.y >= account.y + account.height && Math.abs(inbox.x + inbox.width - account.x - account.width) < 1;
      expect(beside || under, `inbox placed by the account at ${width}`).toBe(true);
      if (width > 760) expect(inbox.x, `inbox clears the dock at ${width}`).toBeGreaterThanOrEqual(dock.x + dock.width);
    }
    await page.locator('#inbox-trigger').click();
    const popover = await page.locator('.inbox-popover').boundingBox();
    expect(popover.x, `inbox popover inside the viewport at ${width}`).toBeGreaterThanOrEqual(0);
    expect(popover.x + popover.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(page.locator('.inbox-popover')).toBeHidden();
  }
  // From the keyboard too, opening one corner panel closes the other.
  await page.locator('#account-trigger').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#account')).toHaveAttribute('open', '');
  await page.locator('#inbox-trigger').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#inbox')).toHaveAttribute('open', '');
  await expect(page.locator('#account')).not.toHaveAttribute('open', '');
  await page.locator('#account-trigger').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#account')).toHaveAttribute('open', '');
  await expect(page.locator('#inbox')).not.toHaveAttribute('open', '');
});
