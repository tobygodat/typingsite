// Challenge's people list (TOB-420): one row per person, built only from what the service holds, following the
// records as they change here and in another tab, and reaching everything Challenge can do.
import { test, expect, openApp, openView, signInWithEmail, phone } from './fixtures.js';

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
  await expect(page.locator('.people-foot button:visible')).toHaveText(['Sign in to keep friends', 'Daily passage', 'One keyboard']);
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

  // Drawing the whole list again from the same records, as every poll does, and once from nothing.
  // A dismissal in another tab redraws the list from its records at once, so a storage event times the draw itself.
  const timings = await page.evaluate(async (userId) => {
    const list = document.getElementById('people-list');

    const measure = async (prepare) => {
      prepare();
      const start = performance.now();
      dispatchEvent(new StorageEvent('storage', { key: `stilltype-dismissed-invites-v1:${userId}` }));
      const drawn = performance.now() - start;
      await new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)); });

      return { drawn, painted: performance.now() - start };
    };

    return { again: await measure(() => {}), fresh: await measure(() => list.replaceChildren()) };
  }, toby.id);

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

      // Every row action, Dismiss and the foot links are at least 44px each way on a coarse pointer.
      const small = await page.locator('#challenge-people button:visible').evaluateAll((buttons) => buttons
        .map((button) => ({ name: button.textContent.trim(), ...button.getBoundingClientRect().toJSON() }))
        .filter((box) => box.width < 44 || box.height < 44).map((box) => `${box.name} ${Math.round(box.width)}×${Math.round(box.height)}`));

      expect(small).toEqual([]);

      if (width === 390) {
        const dock = await page.locator('.dock-zone').boundingBox();

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
