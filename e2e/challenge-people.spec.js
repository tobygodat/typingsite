// Challenge's people list (TOB-420): one row per person, built only from what the service holds, following the
// records as they change here and in another tab, and reaching everything Challenge can do.
import { peopleRows } from '../src/challenge-people.js';
import { usePeopleFixture } from './people-fixture.js';
import { test, expect, openApp, openView, signInWithEmail, phone, chooseWords } from './fixtures.js';

test.setTimeout(90000);

const PASSAGE = 'The quick brown fox jumps over the lazy dog.';
const DAY = 86400000;
const trace = (step) => ({ v: 1, k: PASSAGE, t: [...PASSAGE].map((_, index) => (index ? step : 0)), e: step * (PASSAGE.length - 1) });

async function signedIn(page, supabase, email = 'toby@stilltype.test') {
  await openApp(page);
  await signInWithEmail(page, email);
  await openView(page, 'Challenge');
}

const rows = (page) => page.locator('#people-list .people-row');

test('rows state only what the service holds: an invitation, a ghost, a finished ghost race, a tally, an email', async ({ page, supabase }) => {
  const toby = supabase.addUser('toby@stilltype.test');
  const maya = supabase.addUser('maya@stilltype.test');
  const sam = supabase.addUser('sam@stilltype.test');
  const ola = supabase.addUser('ola@stilltype.test');
  supabase.races.addFriend(toby.id, { name: 'Maya', friendId: maya.id });
  supabase.races.addFriend(toby.id, { name: 'Sam', friendId: sam.id });
  supabase.races.addFriend(toby.id, { name: 'Theo', email: 'theo@example.com' });
  supabase.races.tallies.set([toby.id, sam.id].sort().join(':'), toby.id < sam.id ? [3, 4] : [4, 3]);
  supabase.challenges.seed(maya.id, toby.id, { name: 'Maya', label: 'Toby', passage: PASSAGE, trace: trace(150), createdAt: Date.now() - DAY });
  supabase.races.invite(ola.id, toby.id, { name: 'Ola', ageMs: 120000 });
  await signedIn(page, supabase);

  await expect(rows(page)).toHaveCount(4);
  // The invitation first, then the ghost, then the rest; Ola is not on the list, so Ola's row is the invitation's own.
  await expect(rows(page).nth(0)).toHaveAttribute('data-state', 'invited');
  await expect(rows(page).nth(0)).toContainText(/Ola\s*invited you · 2 min ago/);
  await expect(rows(page).nth(1)).toHaveAttribute('data-state', 'ghost');
  await expect(rows(page).nth(1)).toContainText(/Maya\s*sent a ghost at \d+ wpm · 6 days left/);
  await expect(page.getByRole('button', { name: 'Race Maya’s ghost' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join Ola’s race' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dismiss Ola’s invitation' })).toBeVisible();
  // A tally only where the service keeps one, with its spoken reading; no presence dot anywhere.
  const samRow = rows(page).filter({ hasText: 'Sam' });
  await expect(samRow.locator('.people-tally [aria-hidden="true"]')).toHaveText('3–4');
  await expect(samRow.locator('.people-tally .sr-only')).toHaveText('3 wins, 4 losses');
  await expect(page.locator('.people-tally')).toHaveCount(1);
  await expect(rows(page).filter({ hasText: 'Theo' }).locator('.people-line')).toHaveText('theo@example.com');
  expect(supabase.errors).toEqual([]);
});

test('before race_people is applied, rows show no tally and records stay apart, and everything still works', async ({ page, supabase }) => {
  const toby = supabase.addUser('toby@stilltype.test');
  const sam = supabase.addUser('sam@stilltype.test');
  supabase.peopleMissing = true;
  supabase.races.addFriend(toby.id, { name: 'Sam', friendId: sam.id });
  supabase.races.tallies.set([toby.id, sam.id].sort().join(':'), [1, 1]);
  supabase.races.invite(sam.id, toby.id, { name: 'Sam' });
  await signedIn(page, supabase);
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator('.people-tally')).toHaveCount(0);
  await page.getByRole('button', { name: 'Join Sam’s race' }).click();
  await expect(page.locator('#online-room')).toBeVisible();
});

test('the list follows an invitation arriving, being dismissed, accepted elsewhere and lapsing, and a friend added in another tab, keeping focus', async ({ page, supabase }) => {
  const toby = supabase.addUser('toby@stilltype.test');
  const ada = supabase.addUser('ada@stilltype.test');
  const kim = supabase.addUser('kim@stilltype.test');
  supabase.races.addFriend(toby.id, { name: 'Ada', friendId: ada.id });
  await signedIn(page, supabase);
  const race = page.getByRole('button', { name: 'Race Ada', exact: true });
  await race.focus();

  // An invitation arrives with the inbox's next poll: its row comes first, and focus stays on Race.
  const room = supabase.races.invite(kim.id, toby.id, { name: 'Kim' });
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(rows(page).first()).toHaveAttribute('data-state', 'invited', { timeout: 15000 });
  await expect(race).toBeFocused();

  // Dismissed here, it leaves this tab and another tab of the same browser.
  const other = await page.context().newPage();
  await supabase.attach(other);
  await other.goto('/');
  await openView(other, 'Challenge');
  await expect(other.locator('#people-list [data-state="invited"]')).toHaveCount(1);
  // The click focused Dismiss; with Kim's row gone, focus goes to the row now in its place, not to its Race.
  await page.getByRole('button', { name: 'Dismiss Kim’s invitation' }).click();
  await expect(page.locator('#people-list [data-state="invited"]')).toHaveCount(0);
  await expect(rows(page).filter({ hasText: 'Ada' })).toBeFocused();
  await race.focus();
  await expect(other.locator('#people-list [data-state="invited"]')).toHaveCount(0);

  // A friend added in the other tab appears here without a reload.
  await other.locator('#people-add').click();
  await other.locator('#online-invite-email').fill('kim@stilltype.test');
  await other.locator('#add-friend').click();
  await expect(page.getByRole('button', { name: 'Race kim', exact: true })).toBeVisible();
  await expect(race).toBeFocused();

  // A second invitation lapses: its row goes on the next poll.
  const lapsing = supabase.races.invite(ada.id, toby.id, { name: 'Ada' });
  await page.evaluate(() => dispatchEvent(new Event('online')));
  // Until the service's links come back the invitation is a row of its own; then it is Ada's row.
  await expect(page.locator('#people-list .people-row[data-state="invited"][data-key^="friend:"]', { hasText: 'Ada' })).toHaveCount(1, { timeout: 15000 });
  await expect(rows(page).filter({ hasText: 'Ada' })).toHaveCount(1);
  lapsing.expiresAt = new Date(Date.now() - 1000).toISOString();
  room.expiresAt = new Date(Date.now() - 1000).toISOString();
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(rows(page).filter({ hasText: 'Ada' })).toHaveAttribute('data-state', 'friend', { timeout: 15000 });
  await other.close();
});

test('Race the ghost starts the ghost race, and a ghost raced elsewhere leaves the row', async ({ page, supabase }) => {
  const toby = supabase.addUser('toby@stilltype.test');
  const maya = supabase.addUser('maya@stilltype.test');
  supabase.races.addFriend(toby.id, { name: 'Maya', friendId: maya.id });
  const ghost = supabase.challenges.seed(maya.id, toby.id, { name: 'Maya', label: 'Toby', passage: PASSAGE, trace: trace(150) });
  await signedIn(page, supabase);
  await page.getByRole('button', { name: 'Race Maya’s ghost' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-session', 'challenge');
  await expect(page.locator('#session-title')).toHaveText('Race Maya’s run');
  // Answered on another device: the row says how it went instead.
  Object.assign(ghost, { result: { wpm: 60, accuracy: 100, elapsedMs: 9000, correct: PASSAGE.length }, completedAt: new Date().toISOString() });
  await openView(page, 'Challenge');
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(rows(page).first()).toHaveAttribute('data-state', 'friend', { timeout: 15000 });
  await expect(rows(page).first().locator('.people-line')).toHaveText(/^(won|lost|tied) \d+–\d+ · just now$/);
});

test('a guest sees quick match, sign-in, the daily passage and One keyboard, and nothing invented', async ({ page }) => {
  await openApp(page);
  await openView(page, 'Challenge');
  // The dock names the page; its heading is for assistive technology only.
  expect(await page.locator('#compete-heading').evaluate((node) => node.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('heading', { name: 'Quick match' })).toBeVisible();
  await expect(page.locator('[data-guest]').first()).toHaveText('Sign in to be matched.');
  await expect(page.locator('#people-list')).toBeHidden();
  // The friends panel offers only sign-in; the tiles are the daily passage and One keyboard (Race by link needs an account).
  await expect(page.locator('.people-panel button:visible')).toHaveText(['Sign in to keep friends']);
  await expect(page.locator('.challenge-tiles .tile:visible .tile-name')).toHaveText(['Daily passage', 'One keyboard']);
  await expect(page.getByRole('button', { name: 'Find a race' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in to keep friends' }).click();
  await expect(page.locator('#account-dialog')).toBeVisible();
});

test('opening Challenge with 50 friends, 10 invitations and 10 ghosts draws in a time nobody notices', async ({ page, supabase }, testInfo) => {
  const toby = supabase.addUser('toby@stilltype.test');

  for (let index = 0; index < 50; index += 1) {
    const friend = supabase.addUser(`friend${index}@stilltype.test`);
    supabase.races.addFriend(toby.id, { name: `Friend ${index}`, friendId: friend.id });
    supabase.races.tallies.set([toby.id, friend.id].sort().join(':'), [index % 5, index % 3]);

    if (index < 10) supabase.races.invite(friend.id, toby.id, { name: `Friend ${index}`, ageMs: index * 60000 });
    else if (index < 20) supabase.challenges.seed(friend.id, toby.id, { name: `Friend ${index}`, label: 'Toby', passage: PASSAGE, trace: trace(150), createdAt: Date.now() - index * 3600000 });
  }

  await openApp(page);
  await signInWithEmail(page, 'toby@stilltype.test');
  await openView(page, 'Challenge');
  await expect(rows(page)).toHaveCount(50);
  await expect(page.locator('#people-list [data-state="invited"]')).toHaveCount(10);
  await expect(page.locator('#people-list [data-state="ghost"]')).toHaveCount(10);

  // Keep the real app's service/list proof above. Measure fresh React mounts in a compiled harness,
  // using the same service records and production projection, without mutating React-owned DOM.
  const friends = supabase.races.friendList(toby.id);
  const invites = [...supabase.races.rooms.values()].map((room) => ({ id: room.id, hostName: room.players[0].name, createdAt: room.createdAt, expiresAt: room.expiresAt }));
  const challenges = [...supabase.challenges.rows.values()].map((row) => supabase.challenges.view(row, toby.id));
  const modeled = peopleRows({ friends, invites, challenges, links: supabase.races.people(toby.id, supabase.challenges), dismissed: new Set(), now: Date.now() });
  await usePeopleFixture(page, modeled);
  await page.reload();
  await page.locator('#fixture-draw').click();
  await expect(rows(page)).toHaveCount(50);

  const timings = await page.evaluate(async () => {
    const measure = async (fresh) => {
      if (fresh) document.getElementById('fixture-clear').click();
      const start = performance.now();
      document.getElementById('fixture-draw').click();
      const drawn = performance.now() - start;
      await new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)); });

      return { drawn, painted: performance.now() - start };
    };

    return { again: await measure(false), fresh: await measure(true) };
  });

  testInfo.annotations.push({ type: 'render', description: JSON.stringify(timings) });
  console.log(`people list redraw: ${JSON.stringify(timings)}`);
  await expect(rows(page)).toHaveCount(50);
  expect(timings.fresh.drawn).toBeLessThan(100);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, ...phone });

  for (const width of [390, 320]) {
    test(`with a rank showing nothing scrolls sideways, every control is a 44px target and the first action clears the dock at ${width}px`, async ({ page, supabase }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 568 });
      const toby = supabase.addUser('toby@stilltype.test');
      const maya = supabase.addUser('maya@stilltype.test');
      const kim = supabase.addUser('kim@stilltype.test');
      supabase.races.quick.ratings.set(toby.id, { rating: 2110, races: 230 });
      supabase.races.addFriend(toby.id, { name: 'Maya Okafor-Lindqvist', friendId: maya.id });
      supabase.races.addFriend(toby.id, { name: 'Kim', friendId: kim.id });
      supabase.races.tallies.set([toby.id, maya.id].sort().join(':'), [12, 10]);
      supabase.races.invite(maya.id, toby.id, { name: 'Maya' });
      supabase.challenges.seed(kim.id, toby.id, { name: 'Kim', label: 'Toby', passage: PASSAGE, trace: trace(150) });
      await signedIn(page, supabase);
      await expect(page.locator('#quick-match [data-quick-part="rating"]')).toHaveText(/^Tempest\sIII\s·\s2110\s·\s230\srated\sraces$/);
      await expect(page.locator('#people-list [data-state="invited"]')).toHaveCount(1);
      await expect(page.locator('#people-list [data-state="ghost"]')).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

      // Every row action, Dismiss, the friends panel's head controls and the tiles are at least 44px each way on a coarse pointer.
      const small = await page.locator('#challenge-people button:visible').evaluateAll((buttons) => buttons
        .map((button) => ({ name: button.textContent.trim(), ...button.getBoundingClientRect().toJSON() }))
        .filter((box) => box.width < 44 || box.height < 44).map((box) => `${box.name} ${Math.round(box.width)}×${Math.round(box.height)}`));

      expect(small).toEqual([]);

      if (width === 390) {
        const dock = await page.locator('nav.dock').boundingBox();

        for (const control of [page.locator('#quick-match [data-quick="toggle"]'), page.getByRole('button', { name: /^Join Maya/ })]) {
          const box = await control.boundingBox();
          expect(box.y + box.height).toBeLessThanOrEqual(dock.y);
        }
      }
    });
  }

  test('under reduced motion a person arriving takes no time to ease in', async ({ page, supabase }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const toby = supabase.addUser('toby@stilltype.test');
    const kim = supabase.addUser('kim@stilltype.test');
    await signedIn(page, supabase);
    supabase.races.invite(kim.id, toby.id, { name: 'Kim' });
    await page.evaluate(() => dispatchEvent(new Event('online')));
    await expect(rows(page).first()).toHaveAttribute('data-state', 'invited', { timeout: 15000 });
    // The app's reduced-motion rule holds every transition to 1 ms, so the row is there at once.
    expect(await rows(page).first().evaluate((row) => getComputedStyle(row).transitionDuration.split(',').every((value) => parseFloat(value) <= 0.001))).toBe(true);
  });
});

test('each block says what it does at a glance: the rating and its gauge, the friends panel, and a tile per way to race', async ({ page, supabase }) => {
  const toby = supabase.addUser('toby@stilltype.test');
  const maya = supabase.addUser('maya@stilltype.test');
  supabase.races.quick.ratings.set(toby.id, { rating: 1540, races: 3 });
  await signedIn(page, supabase);

  // Nobody on the list: the "A friend" row offers the race link, so the tile steps aside.
  await expect(page.locator('[data-people-action="link"]')).toBeVisible();
  await expect(page.locator('#people-race-link')).toBeHidden();
  await expect(page.locator('#quick-match .quick-figure')).toHaveText('1540');
  await expect(page.locator('#quick-match .quick-figure-label')).toHaveText('rating · provisional');
  await expect(page.locator('#quick-match [data-quick-part="gauge"]')).toHaveAttribute('data-lit', '3');
  await expect(page.locator('#quick-match .gauge > i.is-lit')).toHaveCount(3);
  await expect(page.locator('#quick-match .quick-gauge-note')).toHaveText('3/10 races to a rank');
  // The figure and gauge are drawn; a screen reader hears the rating line, which says the same.
  await expect(page.locator('#quick-match .quick-gauge')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#quick-match [data-quick-part="setup"]')).toHaveText('english 200 · 30 s · plain');
  // It reads "setup" on screen; "Race" before it is for a screen reader, so its name still says what it sets up.
  await expect(page.getByRole('button', { name: /^Race setup english 200/ })).toBeVisible();
  await expect(page.locator('#people-setup .panel-select-label .sr-only')).toHaveText('Race');
  await expect(page.locator('#open-daily .tile-line')).toHaveText(/^[A-Z][a-z]{2} \d{1,2} · not typed$/);
  await expect(page.locator('#open-local')).toHaveAccessibleName('One keyboard take turns');

  // With a friend and a ranked rating, Race by link is a tile, and the gauge fills through the step toward the next line.
  supabase.races.addFriend(toby.id, { name: 'Maya', friendId: maya.id });
  supabase.races.quick.ratings.set(toby.id, { rating: 1835, races: 24 });
  await page.reload();
  await openView(page, 'Challenge');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute('data-state', 'friend');
  await expect(page.locator('#people-race-link')).toBeVisible();
  await expect(page.locator('#people-race-link')).toHaveAccessibleName('Race by link no account needed');
  await expect(page.locator('.challenge-tiles .tile:visible .tile-name')).toHaveText(['Race by link', 'Daily passage', 'One keyboard']);
  await expect(page.locator('#quick-match .quick-figure-label')).toHaveText('rating · Gale III');
  await expect(page.locator('#quick-match [data-quick-part="gauge"]')).toHaveAttribute('data-lit', '3');
  await expect(page.locator('#quick-match .quick-gauge-note')).toHaveText('65 to Gale II · 24 rated races');
});

// The independent check of PR 134: what a one-press Race uses, the people links after another tab's friend change,
// where focus lands after Dismiss (a row, so a double tap presses nothing), friends who share a name, a tally nobody
// has won yet, and a missing race_people.
const pair = (a, b) => [a, b].sort().join(':');

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

// Three invitations: Ada's (Ada is a friend, so her row stays as Race after Dismiss), then Kim's, then Lin's.
async function threeInvitations(page, supabase) {
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
}

const row = (page, name) => rows(page).filter({ has: page.locator('.people-name', { hasText: name }) });
const focusShows = (locator) => locator.evaluate((node) => node.matches(':focus-visible') && getComputedStyle(node).outlineStyle !== 'none');

test('after Dismiss focus lands on a row, shown, and Tab goes on to its action', async ({ page, supabase }) => {
  await threeInvitations(page, supabase);

  // Ada's row stays (Ada is a friend): focus goes to her row, not her Race.
  await page.getByRole('button', { name: 'Dismiss Ada’s invitation' }).focus();
  await page.keyboard.press('Enter');
  await expect(row(page, 'Ada')).toBeFocused();
  expect(await focusShows(row(page, 'Ada'))).toBe(true);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Race Ada', exact: true })).toBeFocused();

  // Kim's row goes: focus goes to the row now in its place, Lin's, not Lin's Join or Dismiss.
  await page.getByRole('button', { name: 'Dismiss Kim’s invitation' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#people-list [data-key^="invite:"]')).toHaveCount(1);
  await expect(row(page, 'Lin')).toBeFocused();
  expect(await focusShows(row(page, 'Lin'))).toBe(true);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Join Lin’s race' })).toBeFocused();

  // Clicked with the mouse, Dismiss still hands focus to a row, but no ring shows for a pointer.
  await page.getByRole('button', { name: 'Dismiss Lin’s invitation' }).click();
  await expect(page.locator('#people-list [data-key^="invite:"]')).toHaveCount(0);
  await expect(row(page, 'Ada')).toBeFocused();
  expect(await focusShows(row(page, 'Ada'))).toBe(false);
});

// A quick double tap is two real presses, so the key-repeat guard doesn't see the second one.
test('a double tap of Enter on Dismiss dismisses once and presses nothing else', async ({ page, supabase }) => {
  await threeInvitations(page, supabase);

  const twice = async (key) => {
    await page.keyboard.press(key);
    await page.keyboard.press(key);
  };

  // Kim's row goes. The second press must not join Lin's race.
  await page.getByRole('button', { name: 'Dismiss Kim’s invitation' }).focus();
  await twice('Enter');
  await expect(row(page, 'Lin')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Join Lin’s race' })).toBeVisible();
  await expect(page.locator('#online-room')).toBeHidden();

  // Ada's row stays as Race. The second press must not send her an invitation; nor must a double Space.
  await page.getByRole('button', { name: 'Dismiss Ada’s invitation' }).focus();
  await twice(' ');
  await expect(row(page, 'Ada')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#online-room')).toBeHidden();
  await expect(page.locator('#people-list [data-key^="invite:"]')).toHaveCount(1);

  // From the row, the action is one Tab away, and a fresh press of it still works.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('#online-room')).toBeVisible();
});

// Focus lands on a row after Dismiss, so a key that is still down presses nothing there.
test('a held Enter on Dismiss dismisses once and presses nothing else', async ({ page, supabase }) => {
  await threeInvitations(page, supabase);

  const hold = async () => {
    await page.keyboard.down('Enter');

    // Each further down without an up is the key repeating.
    for (let i = 0; i < 6; i += 1) {
      await page.waitForTimeout(40);
      await page.keyboard.down('Enter');
    }

    await page.keyboard.up('Enter');
  };

  // Kim's row goes and focus lands on Lin's row. The held key must not join Lin's race.
  await page.getByRole('button', { name: 'Dismiss Kim’s invitation' }).focus();
  await hold();
  await expect(row(page, 'Lin')).toBeFocused();
  await expect(page.locator('#online-room')).toBeHidden();
  await expect(page.locator('#people-list [data-key^="invite:"]')).toHaveCount(1);

  // Ada's row stays and focus lands on it. The held key must not send her an invitation.
  await page.getByRole('button', { name: 'Dismiss Ada’s invitation' }).focus();
  await hold();
  await expect(row(page, 'Ada')).toBeFocused();
  await expect(page.locator('#online-room')).toBeHidden();
});

// The key-repeat guard is for buttons and links: a field takes a held key as any field does.
test('a held Space in Race setup’s name field types every space', async ({ page, supabase }) => {
  supabase.addUser('toby@stilltype.test');
  await signedIn(page);
  await page.getByRole('button', { name: /^Race setup/ }).click();
  const name = page.locator('#online-name');
  await name.fill('');
  await name.focus();
  await page.keyboard.down(' ');

  // Each further down without an up is the key repeating.
  for (let i = 0; i < 6; i += 1) {
    await page.waitForTimeout(40);
    await page.keyboard.down(' ');
  }

  await page.keyboard.up(' ');
  await expect(name).toHaveValue(' '.repeat(7));
});

test('a held Enter on Race setup’s Done returns to the list and does not reopen the view', async ({ page, supabase }) => {
  supabase.addUser('toby@stilltype.test');
  await signedIn(page);
  await page.getByRole('button', { name: /^Race setup/ }).click();
  await expect(page.locator('#online-setup-done')).toBeVisible();
  await page.locator('#online-setup-done').focus();
  await page.keyboard.down('Enter');

  for (let i = 0; i < 6; i += 1) {
    await page.waitForTimeout(40);
    await page.keyboard.down('Enter');
  }

  await page.keyboard.up('Enter');
  await expect(page.locator('#online-setup-done')).toBeHidden();
  await expect(page.getByRole('button', { name: /^Race setup/ })).toBeFocused();
});

// Back hands focus to the link that opened the view, so a repeat of the held key would press that link and open the
// view again. The guard is what stops it, now that Dismiss lands on a row that presses nothing anyway.
test('a held Enter on Add a friend’s Back returns to the list and does not reopen the view', async ({ page, supabase }) => {
  supabase.addUser('toby@stilltype.test');
  await signedIn(page);
  await page.locator('#people-add').click();
  const back = page.locator('#people-add-view [data-challenge-back]');
  await expect(back).toBeVisible();
  await back.focus();
  await page.keyboard.down('Enter');

  for (let i = 0; i < 6; i += 1) {
    await page.waitForTimeout(40);
    await page.keyboard.down('Enter');
  }

  await page.keyboard.up('Enter');
  await expect(page.locator('#people-add-view')).toBeHidden();
  await expect(page.locator('#people-add')).toBeFocused();
});

// A row takes focus in place of its action and presses nothing. Space there would scroll the page away from it, the
// browser's default for a key on something that isn't a control; it doesn't, and Space still scrolls from elsewhere.
test('Space on a row that took focus after Dismiss leaves the page where it is', async ({ page, supabase }) => {
  await page.setViewportSize({ width: 1280, height: 420 });
  await threeInvitations(page, supabase);
  const scrolled = () => page.evaluate(() => scrollY);
  await page.getByRole('button', { name: 'Dismiss Kim’s invitation' }).focus();
  await page.keyboard.press('Enter');
  await expect(row(page, 'Lin')).toBeFocused();
  // Whether the page's own handling left the browser's default (the scroll) to happen, read after every listener.
  await page.evaluate(() => addEventListener('keydown', (event) => { if (event.key === ' ') window.spaceScrolls = !event.defaultPrevented; }));
  const before = await scrolled();
  await page.keyboard.press(' ');
  expect(await page.evaluate(() => window.spaceScrolls)).toBe(false);
  await page.keyboard.press(' ');
  expect(await page.evaluate(() => window.spaceScrolls)).toBe(false);
  await expect(row(page, 'Lin')).toBeFocused();
  expect(await scrolled()).toBe(before);
  await expect(page.locator('#online-room')).toBeHidden();

  // Nothing else changed: from the page itself, Space scrolls. A press on the page's empty top makes it the page's own
  // Space, not the side bar's, whose list scrolls in a window this short.
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator('#main-content').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press(' ');
  expect(await page.evaluate(() => window.spaceScrolls)).toBe(true);
  await expect.poll(scrolled).toBeGreaterThan(0);
});

test('the last invitation dismissed hands focus to the row now last, never an action in it', async ({ page, supabase }) => {
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
  await expect(rows(page).first()).toBeFocused();
});

// Signed in, an emptied list shows the "A friend" row only once the friend list has been read. Before that, the
// last Dismiss leaves no row, and focus goes to Quick match's heading: a second press starts no search.
test('before the friend list is read, the last Dismiss hands focus to Quick match’s heading, not Find a race', async ({ page, supabase }) => {
  const toby = supabase.addUser('toby@stilltype.test');
  const kim = supabase.addUser('kim@stilltype.test');
  supabase.races.invite(kim.id, toby.id, { name: 'Kim' });
  const release = supabase.races.hold('friends');

  try {
    await signedIn(page);
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Dismiss Kim’s invitation' }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.locator('#people-list')).toBeHidden();
    const heading = page.locator('#quick-match-heading');
    await expect(heading).toBeFocused();
    expect(await focusShows(heading)).toBe(true);
    await expect(page.locator('#quick-match [data-quick="toggle"]')).toHaveText('Find a race');
    await page.keyboard.press('Tab');
    await expect(page.locator('#quick-match [data-quick="toggle"]')).toBeFocused();
  } finally {
    release();
  }
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
