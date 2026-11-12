import { test, expect, openApp, openView, signInWithEmail, typeInto, chooseWords, passageText, setRaceName, inviteByEmail, openRaceLink } from './fixtures.js';

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
  await openRaceLink(page);
  const field = page.locator('#online-guest-link');
  await expect(field).toHaveValue(/#race=[0-9a-f-]+&invite=[0-9a-f]+$/);

  return field.inputValue();
}

async function race(host, guest) {
  await host.locator('#online-ready').click();
  await guest.locator('#online-ready').click();
  await typeRace(host, guest);
}

// A quote race already counting down: both type the whole passage, the host first, so the host wins.
async function typeRace(host, guest) {
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
  // With nobody on the list yet, the list offers the race anyone with its link joins.
  await expect(page.locator('#people-list')).toContainText('anyone with the link joins');
  await setRaceName(page, 'Ada');
  await page.locator('#people-add').click();
  await page.locator('#online-invite-email').fill('lin@stilltype.test');
  await page.locator('#add-friend').click();
  await expect(page.locator('.online-friend-row')).toContainText('lin@stilltype.test');
  await expect.poll(() => supabase.races.friendList(supabase.users.get('host@stilltype.test').id).map((f) => f.email)).toEqual(['lin@stilltype.test']);
  await page.locator('#people-add-view [data-challenge-back]').click();
  await expect(page.locator('#people-add')).toBeFocused();
  await openRaceLink(page);
  await expect(page.locator('#online-room')).toBeVisible();
  // Leaving is a request too: until its reply lands, the people list shows as busy instead of dropping a click.
  const releaseLeave = supabase.races.hold('leave');
  await page.locator('#online-leave').click();

  // One press on the friend's row sends the next challenge.
  const row = page.locator('.people-row', { hasText: 'lin@stilltype.test' });
  await expect(row).toContainText('lin');
  const challenge = row.getByRole('button', { name: 'Race lin', exact: true });
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
  await page.locator('#open-local').click();
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

test('after a race both pick Rematch and the next race starts on its own, the pair keeps a tally, and either can add the other as a friend', async ({ page, browser, supabase }) => {
  supabase.addUser('host@stilltype.test');
  supabase.addUser('lin@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await page.locator('#mode-quote').click();
  await openView(page, 'Challenge');
  await setRaceName(page, 'Ada');
  await inviteByEmail(page, 'lin@stilltype.test');
  // The room opens only once the service has created it.
  await expect(page.locator('#online-room')).toBeVisible();
  const first = [...supabase.races.rooms.values()][0];
  const { context, page: lin } = await member(browser, supabase, 'lin@stilltype.test');

  try {
    await openView(lin, 'Challenge');
    await setRaceName(lin, 'Lin');
    await lin.locator('[data-accept-invite]').click();
    await expect(lin.locator('#online-room')).toBeVisible();
    await race(page, lin);

    // You on the left, them on the right; the winner reads larger, and the tally counts the pair's wins,
    // this race's figure in the accent.
    await expect(page.locator('#online-duel-mine')).toHaveAttribute('data-outcome', 'won');
    await expect(page.locator('#online-duel-theirs .duel-name')).toHaveText('Lin');
    await expect(lin.locator('#online-duel-mine')).toHaveAttribute('data-outcome', 'lost');
    await expect(lin.locator('#online-duel-theirs .duel-name')).toHaveText('Ada');
    await expect(page.locator('#online-tally')).toHaveText('1–0');
    await expect(lin.locator('#online-tally')).toHaveText('0–1');
    await expect(page.locator('#online-tally .is-raised')).toHaveText('1');
    await expect(lin.locator('#online-tally .is-raised')).toHaveText('1');
    expect(await page.locator('#online-duel-mine .duel-wpm').evaluate((node) => parseFloat(getComputedStyle(node).fontSize)))
      .toBeGreaterThan(await page.locator('#online-duel-theirs .duel-wpm').evaluate((node) => parseFloat(getComputedStyle(node).fontSize)));
    await expect(page.locator('#online-players')).toBeHidden();

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

    // Lin picks Rematch, and Ada sees it beside Lin's result. Pressed again, the pick is taken back.
    await expect(page.locator('#online-their-rematch')).toHaveAttribute('data-state', 'open');
    await lin.locator('#online-rematch').click();
    await expect(lin.locator('#online-rematch')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#online-their-rematch')).toHaveAttribute('data-state', 'chosen', { timeout: 5000 });
    await lin.locator('#online-rematch').click();
    await expect(lin.locator('#online-rematch')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#online-their-rematch')).toHaveAttribute('data-state', 'open', { timeout: 5000 });
    await lin.locator('#online-rematch').click();
    await expect(page.locator('#online-their-rematch')).toHaveAttribute('data-state', 'chosen', { timeout: 5000 });
    // Nothing to accept: no toast, no invitation, and no Ready. When Ada picks too, both count down.
    await expect(page.locator('#challenge-toast')).toBeHidden();
    await page.locator('#online-rematch').click();
    await expect(page.locator('#online-countdown')).toContainText('Starting in', { timeout: 5000 });
    await expect(lin.locator('#online-countdown')).toContainText('Starting in', { timeout: 5000 });
    await expect(page.locator('#online-ready')).toBeHidden();
    await expect(lin.locator('#online-ready')).toBeHidden();
    const rematch = supabase.races.rooms.get(first.rematchId);
    expect(rematch.rematchOf).toBe(first.id);
    expect(rematch.players.map((p) => p.name)).toEqual(['Ada', 'Lin']);
    expect(supabase.races.rooms.size).toBe(2);
    await expect(page.locator('#online-accessible-passage')).toHaveText(rematch.passage);
    await typeRace(page, lin);
    await expect(page.locator('#online-tally')).toHaveText('2–0');
    await expect(lin.locator('#online-tally')).toHaveText('0–2');

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
  } finally { await context.close(); }
});

test('a guest races again with the same seat and no new link and keeps no tally, and a host who closes the race ends the choice', async ({ page, browser, supabase }) => {
  test.setTimeout(180_000);
  supabase.addUser('host@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await page.locator('#mode-quote').click();
  await openView(page, 'Challenge');
  await setRaceName(page, 'Ada');
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
    await expect(page.locator('#online-tally')).toBeHidden();
    await expect(guest.locator('#online-tally')).toBeHidden();
    const first = [...supabase.races.rooms.values()][0];
    const seat = first.players[1].guestToken;
    await page.locator('#online-rematch').click();
    await expect(guest.locator('#online-their-rematch')).toHaveAttribute('data-state', 'chosen', { timeout: 5000 });
    await guest.locator('#online-rematch').click();
    await expect(guest.locator('#online-countdown')).toContainText('Starting in', { timeout: 5000 });
    await expect(page.locator('#online-countdown')).toContainText('Starting in', { timeout: 5000 });
    expect(supabase.races.rooms.get(first.rematchId).players[1].guestToken).toBe(seat);
    await typeRace(page, guest);
    await guest.locator('#online-rematch').click();
    await expect(page.locator('#online-their-rematch')).toHaveAttribute('data-state', 'chosen', { timeout: 5000 });
    // Ada closes the race: Lin's side reads left for Ada, and Lin's pick is over.
    await page.locator('#online-leave').click();
    await expect(guest.locator('#online-their-rematch')).toHaveAttribute('data-state', 'left', { timeout: 5000 });
    await expect(guest.locator('#online-their-rematch')).toHaveText('left');
    await expect(guest.locator('#online-rematch')).toHaveAttribute('aria-disabled', 'true');
    await expect(guest.locator('#online-rematch')).toHaveAttribute('aria-pressed', 'false');
    await guest.locator('#online-rematch').click({ force: true });
    await expect(guest.locator('#online-error')).toBeEmpty();
    await expect(guest.locator('#online-rematch')).toHaveAttribute('aria-pressed', 'false');
    expect(supabase.races.rooms.size).toBe(2);
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

test('Add friend and Remove each wait their turn, and a removed friend’s Remove hands focus to the email field', async ({ page, supabase }) => {
  const host = supabase.addUser('host@stilltype.test');
  supabase.addUser('lin@stilltype.test');
  await saveFriend(supabase, host, 'kim@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#people-add').click();
  const rows = page.locator('.online-friend-row');
  await expect(rows).toHaveText([/kim@stilltype\.test/]);
  // Lin's save reaches the service, and its answer is slow to come back.
  const releaseSave = supabase.races.hold('befriend');
  await page.locator('#online-invite-email').fill('lin@stilltype.test');
  await page.locator('#add-friend').click();
  await expect.poll(() => supabase.races.friendList(host.id).map((friend) => friend.name)).toEqual(['kim', 'lin']);
  const remove = page.getByRole('button', { name: 'Remove kim from friends' });
  // Every friend control waits for the change that is out; a press does nothing.
  await expect(page.locator('#add-friend')).toHaveAttribute('aria-disabled', 'true');
  await expect(remove).toHaveAttribute('aria-disabled', 'true');
  await remove.click({ force: true });
  releaseSave();
  await expect(rows).toHaveText([/kim@stilltype\.test/, /lin@stilltype\.test/]);
  await expect(page.locator('#online-invite-email')).toHaveValue('');
  await expect(remove).not.toHaveAttribute('aria-disabled');
  // Kim is removed from the keyboard; as Kim's row goes, focus moves to the email field.
  await remove.focus();
  await page.keyboard.press('Enter');
  await expect(rows).toHaveText([/lin@stilltype\.test/]);
  await expect(page.locator('#online-invite-email')).toBeFocused();
  expect(supabase.races.friendList(host.id).map((friend) => friend.name)).toEqual(['lin']);
});

test('a friend change waiting behind a slow friend-list read holds up only the friend controls', async ({ page, supabase }) => {
  const host = supabase.addUser('host@stilltype.test');
  await saveFriend(supabase, host, 'kim@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await openView(page, 'Challenge');
  await expect(page.locator('.people-row', { hasText: 'kim@stilltype.test' })).toBeVisible();
  // Coming back to Challenge reads the list again, and that read doesn't answer.
  const releaseRead = supabase.races.hold('friends');
  await openView(page, 'Practice');
  await openView(page, 'Challenge');
  await arrived(supabase, 'friends');
  await page.locator('#people-add').click();
  const remove = page.getByRole('button', { name: 'Remove kim from friends' });
  await remove.click();
  await expect(remove).toHaveAttribute('aria-disabled', 'true');
  // The removal waits its turn, and races don't wait for it.
  await expect(page.locator('#create-online-race')).not.toHaveAttribute('aria-disabled');
  await page.locator('#people-add-view [data-challenge-back]').click();
  await expect(page.getByRole('button', { name: 'Race kim', exact: true })).not.toHaveAttribute('aria-disabled');
  await setRaceName(page, 'Ada');
  await openRaceLink(page);
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
  await page.locator('#people-add').click();
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
  // The late answer changes nothing, here or in the people list.
  releaseRemove();
  await expect(rows).toHaveText([/lin@stilltype\.test/]);
  await page.locator('#people-add-view [data-challenge-back]').click();
  await expect(page.locator('.people-row')).toHaveText([/lin@stilltype\.test/]);
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
  await setRaceName(page, 'Ada');
  await expect(page.locator('[data-accept-invite]')).toBeVisible();
  await expect(page.locator('[data-race-friend]')).toHaveCount(2);
  // Kim's invitation is a row of its own (Kim is saved by email), so the friend "kim" shows the email typed for them.
  // Coming back to Challenge reads the friend list again, and its answer is slow and brings someone new.
  await saveFriend(supabase, host, 'mo@stilltype.test');
  const releaseRead = supabase.races.hold('friends');
  await openView(page, 'Practice');
  await openView(page, 'Challenge');
  await arrived(supabase, 'friends');
  const challenge = page.getByRole('button', { name: 'Race lin', exact: true });
  const releaseCreate = supabase.races.hold('create');
  // Reached by keyboard, as a keyboard user does: after a click, Firefox shows no ring for a focus()
  // even once a key is pressed.
  await challenge.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(challenge).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(challenge).toHaveAttribute('aria-disabled', 'true');
  // The list's answer draws the people list again while the race is being created; the pressed Race keeps focus.
  const redraws = await countRedraws(page, '#people-list');
  releaseRead();
  await expect.poll(redraws).toBeGreaterThan(0);
  await expect(page.locator('[data-race-friend]')).toHaveCount(3);
  await expect(challenge).toBeFocused();

  for (const control of ['#people-race-link', '[data-accept-invite]', '[data-race-friend]']) {
    for (const button of await page.locator(control).all()) await expect(button).toHaveAttribute('aria-disabled', 'true');
  }

  // Removing a friend is not a race request, so it doesn't wait for one.
  for (const button of await page.locator('[data-remove-friend]').all()) await expect(button).not.toHaveAttribute('aria-disabled');

  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    await settleTransitions(page);
    // The others are dimmed as disabled. The pressed one dims its colours instead of the whole box,
    // so its focus ring stays at full strength in the text colour.
    expect(await page.getByRole('button', { name: 'Race kim (kim@stilltype.test)', exact: true }).evaluate((node) => getComputedStyle(node).opacity)).toBe('0.38');

    // The theme follows the emulated scheme through the app's change listener, so wait for it to land.
    const look = () => challenge.evaluate((node) => ({ opacity: getComputedStyle(node).opacity, ring: getComputedStyle(node).outlineColor,
      text: getComputedStyle(document.body).color, theme: document.documentElement.dataset.theme, focusVisible: node.matches(':focus-visible') }));

    await expect.poll(async () => {
      const { ring, text, ...rest } = await look();

      return { ...rest, ringIsText: ring === text };
    })
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
  const kimRace = page.getByRole('button', { name: 'Race kim (kim@stilltype.test)', exact: true });

  for (const button of [kimRace, page.locator('[data-accept-invite]')]) {
    const atRest = await background(button);
    await button.hover();
    expect(await background(button)).toBe(atRest);
  }

  await kimRace.hover();
  await page.mouse.down();
  expect(await kimRace.evaluate((node) => getComputedStyle(node).transform)).toBe('none');
  await page.mouse.up();
  releaseCreate();
  await expect(page.locator('#online-room')).toBeVisible();
  expect([...supabase.races.rooms.values()].filter((room) => room.players[0].userId === host.id)).toHaveLength(1);
});

test('an invitation’s Join keeps keyboard focus while its join is out, and a press while it waits does nothing', async ({ page, supabase }) => {
  const host = supabase.addUser('host@stilltype.test');
  const kim = supabase.addUser('kim@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  await challengeFrom(supabase, kim, 'host@stilltype.test');
  await page.clock.install();
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await openView(page, 'Challenge');
  await setRaceName(page, 'Ada');
  const join = page.locator('[data-accept-invite]');
  await expect(join).toBeVisible();
  const room = [...supabase.races.rooms.values()][0];
  // The inbox's own polls stop, so the only invitations read from here is the one Join sends before its join.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  // That read is held and brings another invitation, so its answer draws the list again while the join is out.
  const releaseInvites = supabase.races.hold('invites');
  const releaseJoin = supabase.races.hold('join');
  await challengeFrom(supabase, lin, 'host@stilltype.test');
  await join.focus();
  await page.keyboard.press('Enter');
  await expect(join).toHaveAttribute('aria-disabled', 'true');
  await arrived(supabase, 'invites');
  const redraws = await countRedraws(page, '#people-list');
  releaseInvites();
  await expect.poll(redraws).toBeGreaterThan(0);
  await expect(page.locator('[data-accept-invite]')).toHaveCount(2);
  await expect(join.first()).toBeFocused();
  await expect(join.first()).toHaveAttribute('aria-disabled', 'true');
  // A press while it waits does nothing at all.
  await join.first().click({ force: true });
  await expect(join.first()).toBeFocused();
  expect(room.players.filter((player) => player.userId === host.id)).toHaveLength(1);
  releaseJoin();
  await expect(page.locator('#online-room')).toBeVisible();
});

test('while a race request is out, the toast’s and the inbox’s Join wait visibly instead of dropping the click', async ({ page, supabase }) => {
  const kim = supabase.addUser('kim@stilltype.test');
  supabase.addUser('lin@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await openView(page, 'Challenge');
  await setRaceName(page, 'Lin');
  await createGuestRace(page);
  // Lin leaves her race, and the service is slow to answer; meanwhile Kim's challenge arrives.
  const releaseLeave = supabase.races.hold('leave');
  await page.locator('#online-leave').click();
  await challengeFrom(supabase, kim, 'lin@stilltype.test');
  const room = [...supabase.races.rooms.values()].at(-1);
  await page.evaluate(() => dispatchEvent(new Event('online')));
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
  await expect.poll(async () => {
    await page.evaluate(() => dispatchEvent(new Event('online')));

    return polls();
  }).toBeGreaterThan(before);
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

test('a friend list that failed to load, then loads empty, says so and then offers a race link', async ({ page, supabase }) => {
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
  const status = page.locator('#people-status');
  await expect(status).toContainText('Can’t reach');
  await arrived(supabase, 'friends');
  // It answers: no friends yet, and the list offers the race anyone with its link joins.
  releaseRead();
  await expect(status).toBeEmpty();
  await expect(page.locator('#people-list')).toContainText('anyone with the link joins');
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
