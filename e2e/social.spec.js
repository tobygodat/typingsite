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

// Create is a request: the click returns before the reply, and the share field is empty until it lands.
async function createGuestRace(page) {
  await page.locator('#create-online-race').click();
  const field = page.locator('#online-guest-link');
  await expect(field).toHaveValue(/#race=[0-9a-f-]+&invite=[0-9a-f]+$/);
  return field.inputValue();
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
  await expect(page.locator('#online-friends')).toContainText('Save a friend');
  await page.locator('#online-name').fill('Ada');
  await page.locator('#online-invite-email').fill('lin@stilltype.test');
  await expect(page.locator('#online-save-friend')).toBeChecked();
  await page.locator('#create-online-race').click();
  await expect(page.locator('#online-room')).toBeVisible();
  await expect.poll(() => supabase.races.friendList(supabase.users.get('host@stilltype.test').id).map((f) => f.email)).toEqual(['lin@stilltype.test']);
  // Leaving is a request too: until its reply lands, the friend list shows as busy instead of dropping a click.
  const releaseLeave = supabase.races.hold('leave');
  await page.locator('#online-leave').click();

  // One click from the friend list sends the next challenge.
  const row = page.locator('.online-friend-row', { hasText: 'lin@stilltype.test' });
  await expect(row).toContainText('lin');
  const challenge = row.getByRole('button', { name: 'Challenge lin' });
  await expect(challenge).toHaveAttribute('aria-disabled', 'true');
  releaseLeave();
  await expect(challenge).not.toHaveAttribute('aria-disabled');
  await challenge.click();
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

test('a challenge that arrives mid-run waits for the run to end, even with the chrome revealed, and one waits while a one-keyboard race is typed', async ({ page, supabase }) => {
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
  await page.locator('#challenge-toast-close').click();
  await expect(page.locator('#challenge-toast')).toBeHidden();

  await openView(page, 'Challenge');
  await page.locator('#challenge-local').click();
  await page.locator('#player-one-name').fill('Ada');
  await page.locator('#player-two-name').fill('Lin');
  await page.locator('#start-local-race').click();
  const racePassage = await page.locator('#race-accessible-passage').textContent();
  await typeInto(page, racePassage.slice(0, 3), '#race-input');
  await new Promise((resolve) => supabase.races.handle(host.id, { p_action: 'create', p_data: {
    passage: 'The quick brown fox jumps over the lazy dog, twice over.', conditions: {}, displayName: 'Kai', inviteEmail: 'lin@stilltype.test',
  } }, resolve));
  await page.clock.fastForward(11000);
  await page.waitForTimeout(1500);
  await expect(page.locator('#challenge-toast')).toBeHidden();
  await page.keyboard.type(racePassage.slice(3));
  await expect(page.locator('#race-handoff')).toBeVisible();
  await page.clock.fastForward(11000);
  await expect(page.locator('#challenge-toast')).toContainText('Kai challenged you to a race.');
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
  // The room opens only once the service has created it.
  await expect(page.locator('#online-room')).toBeVisible();
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

    // A result outlives its room only so long: past the service's retention it has no Race again,
    // even when it lapses while the inbox is already open.
    await page.locator('#online-leave').click();
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((name) => name.startsWith('stilltype-inbox-v1:'));
      const entries = JSON.parse(localStorage.getItem(key));
      for (const entry of entries) if (entry.kind === 'result') entry.until = new Date(Date.now() + 4000).toISOString();
      localStorage.setItem(key, JSON.stringify(entries));
    });
    await page.reload();
    await page.locator('#inbox-trigger').click();
    const stale = page.locator('#inbox-list [data-inbox-action="result"]').first();
    await expect(stale).toBeVisible();
    await page.waitForTimeout(4500);
    await stale.click();
    await expect(page.locator('#online-room')).toBeHidden();
    expect(supabase.races.rooms.size).toBe(2);
    await page.locator('#inbox-trigger').click();
    await expect(page.locator('#inbox-list [data-kind="result"]').first()).toContainText('closed');
    await expect(page.locator('#inbox-list [data-inbox-action="result"]')).toHaveCount(0);
    // The rematch request Ada answered from the race is used up too.
    await expect(page.locator('#inbox-list [data-kind="invite"]').first()).toContainText('closed');
    await expect(page.locator('#inbox-list [data-inbox-action="invite"]')).toHaveCount(0);
  } finally { await context.close(); }
});

test('a guest races again with the same seat and no new link, and a rematch the host cancels takes its toast away', async ({ page, browser, supabase }) => {
  test.setTimeout(180_000);
  supabase.addUser('host@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#online-name').fill('Ada');
  const link = await createGuestRace(page);
  const context = await browser.newContext();
  const guest = await context.newPage();
  await supabase.attach(guest);
  try {
    await guest.goto(link);
    await expect(guest.locator('#online-guest-join')).toBeVisible();
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
    await page.locator('#online-rematch').click();
    await expect(guest.locator('#challenge-toast')).toContainText('Ada wants a rematch.', { timeout: 8000 });
    await expect(guest.locator('#online-rematch')).toHaveText('Join rematch');
    await page.locator('#online-leave').click();
    await expect(guest.locator('#challenge-toast')).toBeHidden({ timeout: 8000 });
    await expect(guest.locator('#online-rematch-note')).toBeHidden();
    await expect(guest.locator('#online-rematch')).toHaveText('Race again');
    expect(await guest.evaluate(() => Object.keys(localStorage))).toEqual([]);
  } finally { await context.close(); }
});

// Seeds a friend list entry as the service would keep it after a save.
const saveFriend = (supabase, owner, email) => new Promise((resolve) => {
  supabase.races.handle(owner.id, { p_action: 'befriend', p_data: { email } }, resolve);
});
const challengeFrom = (supabase, host, email) => new Promise((resolve) => {
  supabase.races.handle(host.id, { p_action: 'create', p_data: {
    passage: 'The quick brown fox jumps over the lazy dog, twice over.', conditions: {}, displayName: 'Kim', inviteEmail: email,
  } }, resolve);
});
// The request held for this action has reached the service (its answer is still held).
const arrived = (supabase, action) => expect.poll(() => supabase.races.holds.has(action)).toBe(false);
// Counts how often a list's rows are drawn again from now on.
async function countRedraws(page, selector) {
  const key = `redraws:${selector}`;
  await page.locator(selector).evaluate((list, name) => {
    window[name] = 0;
    new MutationObserver(() => { window[name] += 1; }).observe(list, { childList: true });
  }, key);
  return () => page.evaluate((name) => window[name], key);
}
// Visible CSS transitions (a theme's cross-fade) finish before a measurement or a picture.
const settleTransitions = (page) => page.evaluate(() => Promise.all(document.getAnimations()
  .filter((animation) => animation instanceof CSSTransition && animation.effect?.target?.checkVisibility())
  .map((animation) => animation.finished.catch(() => {}))));

test('a friend removed while a new race’s save to friends is still out stays removed, and its Remove keeps focus', async ({ page, supabase }) => {
  const host = supabase.addUser('host@stilltype.test');
  supabase.addUser('lin@stilltype.test');
  await saveFriend(supabase, host, 'kim@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await openView(page, 'Challenge');
  const rows = page.locator('.online-friend-row');
  await expect(rows).toHaveText([/kim@stilltype\.test/]);
  // Creating the race saves Lin: the service takes it, and its answer is slow to come back.
  const releaseSave = supabase.races.hold('befriend');
  await page.locator('#online-name').fill('Ada');
  await page.locator('#online-invite-email').fill('lin@stilltype.test');
  await page.locator('#create-online-race').click();
  await expect(page.locator('#online-room')).toBeVisible();
  await expect.poll(() => supabase.races.friendList(host.id).map((friend) => friend.name)).toEqual(['kim', 'lin']);
  await page.locator('#online-leave').click();
  const remove = page.getByRole('button', { name: 'Remove kim from friends' });
  await expect(remove).not.toHaveAttribute('aria-disabled');
  // Every list the page draws from here on, in order.
  await page.locator('#online-friend-list').evaluate((list) => {
    window.drawnFriends = [];
    new MutationObserver(() => window.drawnFriends.push([...list.querySelectorAll('strong')].map((name) => name.textContent)))
      .observe(list, { childList: true });
  });
  // Kim is removed from the keyboard, and the removal's answer is slow too.
  const releaseRemove = supabase.races.hold('unfriend');
  await remove.focus();
  await page.keyboard.press('Enter');
  await expect(remove).toHaveAttribute('aria-disabled', 'true');
  releaseSave();
  // The save's answer (Kim and Lin) is drawn first, and the pressed Remove, drawn again, keeps focus.
  await expect.poll(() => page.evaluate(() => window.drawnFriends.some((names) => names.includes('kim') && names.includes('lin')))).toBe(true);
  await arrived(supabase, 'unfriend');
  await expect(remove).toBeFocused();
  await expect(remove).toHaveAttribute('aria-disabled', 'true');
  // The removal still has the last word; as Kim's row goes, focus moves to the name field.
  releaseRemove();
  await expect(rows).toHaveText([/lin@stilltype\.test/]);
  await expect(page.locator('#online-name')).toBeFocused();
  expect(supabase.races.friendList(host.id).map((friend) => friend.name)).toEqual(['lin']);
});

test('a friend change waiting behind a slow friend-list read holds up only the friend controls', async ({ page, supabase }) => {
  const host = supabase.addUser('host@stilltype.test');
  await saveFriend(supabase, host, 'kim@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await openView(page, 'Challenge');
  await expect(page.locator('.online-friend-row')).toHaveText([/kim@stilltype\.test/]);
  // Coming back to Challenge reads the list again, and that read doesn't answer.
  const releaseRead = supabase.races.hold('friends');
  await openView(page, 'Practice');
  await openView(page, 'Challenge');
  await arrived(supabase, 'friends');
  const remove = page.getByRole('button', { name: 'Remove kim from friends' });
  await remove.click();
  await expect(remove).toHaveAttribute('aria-disabled', 'true');
  // The removal waits its turn, and races don't wait for it.
  await expect(page.locator('#create-online-race')).not.toHaveAttribute('aria-disabled');
  await expect(page.getByRole('button', { name: 'Challenge kim' })).not.toHaveAttribute('aria-disabled');
  await page.locator('#online-name').fill('Ada');
  await page.locator('#create-online-race').click();
  await expect(page.locator('#online-room')).toBeVisible();
  expect(supabase.races.friendList(host.id)).toHaveLength(1);
  releaseRead();
  await expect.poll(() => supabase.races.friendList(host.id)).toEqual([]);
});

test('a removal the service made but whose answer never came back still leaves the friend list as the service holds it', async ({ page, supabase }) => {
  const host = supabase.addUser('host@stilltype.test');
  await saveFriend(supabase, host, 'kim@stilltype.test');
  await saveFriend(supabase, host, 'lin@stilltype.test');
  await page.clock.install();
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await openView(page, 'Challenge');
  const rows = page.locator('.online-friend-row');
  await expect(rows).toHaveText([/kim@stilltype\.test/, /lin@stilltype\.test/]);
  // Kim's removal reaches the service, which makes it, but its answer doesn't come back.
  const releaseRemove = supabase.races.hold('unfriend');
  await page.getByRole('button', { name: 'Remove kim from friends' }).click();
  await arrived(supabase, 'unfriend');
  expect(supabase.races.friendList(host.id).map((friend) => friend.name)).toEqual(['lin']);
  await expect(rows).toHaveCount(2);
  // After fifteen seconds the page gives up on that answer and reads the list again, still on Challenge.
  await page.clock.fastForward(15000);
  await expect(page.locator('#online-error')).toContainText('taking too long');
  await expect(rows).toHaveText([/lin@stilltype\.test/]);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'compete');
  // The late answer changes nothing.
  releaseRemove();
  await expect(rows).toHaveText([/lin@stilltype\.test/]);
});

test('a pressed race control keeps keyboard focus while its request is out, and the other race controls wait', async ({ page, supabase }, testInfo) => {
  const host = supabase.addUser('host@stilltype.test');
  const kim = supabase.addUser('kim@stilltype.test');
  supabase.addUser('lin@stilltype.test');
  await saveFriend(supabase, host, 'lin@stilltype.test');
  await saveFriend(supabase, host, 'kim@stilltype.test');
  await challengeFrom(supabase, kim, 'host@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#online-name').fill('Ada');
  await expect(page.locator('[data-accept-invite]')).toBeVisible();
  await expect(page.locator('.online-friend-row')).toHaveCount(2);
  // Coming back to Challenge reads the friend list again, and its answer is slow.
  const releaseRead = supabase.races.hold('friends');
  await openView(page, 'Practice');
  await openView(page, 'Challenge');
  await arrived(supabase, 'friends');
  const challenge = page.getByRole('button', { name: 'Challenge lin' });
  const releaseCreate = supabase.races.hold('create');
  await challenge.focus();
  await page.keyboard.press('Enter');
  await expect(challenge).toHaveAttribute('aria-disabled', 'true');
  // The list's answer draws the rows again while the race is being created; the pressed Challenge keeps focus.
  const redraws = await countRedraws(page, '#online-friend-list');
  releaseRead();
  await expect.poll(redraws).toBeGreaterThan(0);
  await expect(challenge).toBeFocused();
  for (const control of ['#create-online-race', '[data-accept-invite]', '[data-race-friend]']) {
    for (const button of await page.locator(control).all()) await expect(button).toHaveAttribute('aria-disabled', 'true');
  }
  // Removing a friend is not a race request, so it doesn't wait for one.
  for (const button of await page.locator('[data-remove-friend]').all()) await expect(button).not.toHaveAttribute('aria-disabled');
  await page.evaluate(() => scrollTo(0, document.getElementById('online-invite-email').getBoundingClientRect().top + scrollY - 100));
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    await settleTransitions(page);
    // The others are dimmed as disabled. The pressed one dims its colours instead of the whole box,
    // so its focus ring stays at full strength in the text colour.
    expect(await page.getByRole('button', { name: 'Challenge kim' }).evaluate((node) => getComputedStyle(node).opacity)).toBe('0.38');
    // The theme follows the emulated scheme through the app's change listener, so wait for it to land.
    const look = () => challenge.evaluate((node) => ({ opacity: getComputedStyle(node).opacity, ring: getComputedStyle(node).outlineColor,
      text: getComputedStyle(document.body).color, theme: document.documentElement.dataset.theme, focusVisible: node.matches(':focus-visible') }));
    await expect.poll(async () => { const { ring, text, ...rest } = await look(); return { ...rest, ringIsText: ring === text }; })
      .toEqual({ opacity: '1', ringIsText: true, theme, focusVisible: true });
    const path = process.env.SCREENSHOTS ? `docs/screenshots/social-rematch-flake/challenge-busy-${theme}.png` : testInfo.outputPath(`challenge-busy-${theme}.png`);
    await page.screenshot({ path });
  }
  // Pressing it again sends nothing more; focus is still there.
  await page.keyboard.press('Enter');
  await expect(challenge).toBeFocused();
  // Under the pointer a waiting control stays as it is: no hover fill, and no press.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const background = (button) => button.evaluate((node) => getComputedStyle(node).backgroundColor);
  for (const button of [page.getByRole('button', { name: 'Challenge kim' }), page.locator('#create-online-race')]) {
    const atRest = await background(button);
    await button.hover();
    expect(await background(button)).toBe(atRest);
  }
  await page.mouse.down();
  expect(await page.locator('#create-online-race').evaluate((node) => getComputedStyle(node).transform)).toBe('none');
  await page.mouse.up();
  releaseCreate();
  await expect(page.locator('#online-room')).toBeVisible();
  expect([...supabase.races.rooms.values()].filter((room) => room.players[0].userId === host.id)).toHaveLength(1);
});

test('an invitation’s Join race keeps keyboard focus while its join is out, and a press while it waits does nothing', async ({ page, supabase }) => {
  supabase.addUser('host@stilltype.test');
  const kim = supabase.addUser('kim@stilltype.test');
  await challengeFrom(supabase, kim, 'host@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#online-name').fill('Ada');
  const join = page.locator('[data-accept-invite]');
  await expect(join).toBeVisible();
  await expect(page.locator('#refresh-race-invites')).toBeEnabled();
  // Joining also refreshes the invitations; that answer draws the list again while the join is out.
  const releaseInvites = supabase.races.hold('invites');
  const releaseJoin = supabase.races.hold('join');
  await join.focus();
  await page.keyboard.press('Enter');
  await expect(join).toHaveAttribute('aria-disabled', 'true');
  await arrived(supabase, 'invites');
  const redraws = await countRedraws(page, '#online-invites');
  releaseInvites();
  await expect.poll(redraws).toBeGreaterThan(0);
  await expect(join).toBeFocused();
  await expect(join).toHaveAttribute('aria-disabled', 'true');
  // A press while it waits does nothing at all: not even a refresh of the invitations.
  await expect(page.locator('#refresh-race-invites')).toBeEnabled();
  expect(await join.evaluate((node) => { node.click(); return document.getElementById('refresh-race-invites').disabled; })).toBe(false);
  await expect(join).toBeFocused();
  releaseJoin();
  await expect(page.locator('#online-room')).toBeVisible();
});

test('while a race request is out, the toast’s and the inbox’s Join wait visibly instead of dropping the click', async ({ page, supabase }) => {
  const kim = supabase.addUser('kim@stilltype.test');
  supabase.addUser('lin@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#online-name').fill('Lin');
  await createGuestRace(page);
  // Lin leaves her race, and the service is slow to answer; meanwhile Kim's challenge arrives.
  const releaseLeave = supabase.races.hold('leave');
  await page.locator('#online-leave').click();
  await challengeFrom(supabase, kim, 'lin@stilltype.test');
  const room = [...supabase.races.rooms.values()].at(-1);
  await page.locator('#refresh-race-invites').click();
  const toast = page.locator('#challenge-toast');
  await expect(toast).toContainText('Kim challenged you to a race.');
  const toastJoin = page.locator('#challenge-toast-action');
  await expect(toastJoin).toHaveAttribute('aria-disabled', 'true');
  await toastJoin.focus();
  await page.keyboard.press('Enter');
  await expect(toastJoin).toBeFocused();
  await expect(toast).toBeVisible();
  await page.locator('#inbox-trigger').click();
  const inboxJoin = page.locator('#inbox-list [data-inbox-action="invite"]');
  await expect(inboxJoin).toHaveAttribute('aria-disabled', 'true');
  // The inbox keeps polling while it waits, and focus stays on the Join. (A poll that repeats what is
  // shown leaves the list alone; one that changes it redraws it around the focused control.)
  await inboxJoin.focus();
  const polls = () => supabase.requests.filter((request) => request.startsWith('POST /rest/v1/rpc/race_action')).length;
  const before = polls();
  await expect.poll(async () => { await page.evaluate(() => dispatchEvent(new Event('online'))); return polls(); }).toBeGreaterThan(before);
  await expect(inboxJoin).toBeFocused();
  // A click past the dimmed look does nothing, and the inbox stays open on it.
  await inboxJoin.click({ force: true });
  await expect(page.locator('#inbox')).toHaveAttribute('open', '');
  expect(room.players).toHaveLength(1);
  // Once the leave lands, the same Join works.
  releaseLeave();
  await expect(inboxJoin).not.toHaveAttribute('aria-disabled');
  await inboxJoin.click();
  await expect(page.locator('#online-room')).toBeVisible();
  await expect.poll(() => room.players.length).toBe(2);
});

test('a friend list that failed to load, then loads empty, shows its usual copy again', async ({ page, supabase }) => {
  supabase.addUser('host@stilltype.test');
  await openApp(page);
  // The first read of the friend list, as the signed-in page loads, never reaches the service.
  let failed = false;
  await page.route(/\/rest\/v1\/rpc\/race_action$/, (route) => {
    if (failed || route.request().postDataJSON()?.p_action !== 'friends') return route.fallback();
    failed = true;
    return route.abort('internetdisconnected');
  });
  await signInWithEmail(page, 'host@stilltype.test');
  // Opening Challenge reads it again; until that answers, the failure is what the list says.
  const releaseRead = supabase.races.hold('friends');
  await openView(page, 'Challenge');
  const empty = page.locator('#online-friends-empty');
  await expect(empty).toContainText('Can’t reach');
  await arrived(supabase, 'friends');
  // It answers: no friends yet.
  releaseRead();
  await expect(empty).toHaveText(/^Save a friend when you invite them/);
});

test('the inbox sits beside the account button without touching the dock', async ({ page, supabase }) => {
  supabase.addUser('host@stilltype.test');
  await openApp(page);
  await expect(page.locator('#inbox')).toBeHidden();
  await signInWithEmail(page, 'host@stilltype.test');
  // The unread badge counts in the same tabular Literata figures as every other numeral.
  const badge = await page.locator('#inbox-count').evaluate((node) => getComputedStyle(node).fontVariantNumeric);
  expect(badge).toContain('tabular-nums');
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
