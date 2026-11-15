// Challenge in the Instrument look (TOB-470), every state its panels and tiles take: a guest; signed in with nobody
// on the list and no rated race; a provisional rating part-way to a rank; a ranked rating; looking for a race; the
// friends panel's invited, ghost and friend rows; the four views a control opens; and a race room before the start.
// NAV=top runs it in the top bar (the setting is ignored under 960px, where the bars are the phone's).
const PASSAGE = 'The quick brown fox jumps over the lazy dog.';
const DAY = 24 * 3600000;

function trace(wpm) {
  const step = Math.round(12000 / wpm);

  return { v: 1, k: PASSAGE, t: [...PASSAGE].map((_, index) => (index ? step : 0)), e: step * (PASSAGE.length - 1) };
}

export default async ({ page, h, shot, check, note, fake }) => {
  const fresh = fake.addUser('new@stilltype.test');
  const toby = fake.addUser('toby@stilltype.test');
  const ranked = fake.addUser('rank@stilltype.test');
  const people = Object.fromEntries(['maya', 'priya', 'sam'].map((name) => [name, fake.addUser(`${name}@stilltype.test`)]));
  fake.races.quick.ratings.set(toby.id, { rating: 1540, races: 3 });
  fake.races.quick.ratings.set(ranked.id, { rating: 1835, races: 24 });
  fake.races.addFriend(toby.id, { name: 'Maya Okafor', friendId: people.maya.id });
  fake.races.addFriend(toby.id, { name: 'Priya Raman', friendId: people.priya.id });
  fake.races.addFriend(toby.id, { name: 'Sam Achebe', friendId: people.sam.id });
  const key = [toby.id, people.sam.id].sort().join(':');
  fake.races.tallies.set(key, key.startsWith(toby.id) ? [2, 1] : [1, 2]);
  fake.challenges.seed(people.maya.id, toby.id, { name: 'Maya', label: 'Toby', passage: PASSAGE, trace: trace(84), createdAt: Date.now() - DAY });
  fake.races.invite(people.priya.id, toby.id, { name: 'Priya', ageMs: 2 * 60000 });

  const top = process.env.NAV === 'top';
  const wide = page.viewportSize().width >= 960;
  const placement = async () => {
    if (!top) return;
    await page.keyboard.press('Control+k');
    await page.locator('#palette-input').waitFor();
    await page.keyboard.type('navigation · top bar');
    await page.keyboard.press('Enter');
    await page.locator('html[data-navigation="top"]').waitFor({ state: 'attached' });
  };
  const challenge = async () => {
    await h.openView('Challenge');
    await page.mouse.move(1, 1);
    await h.settle();
  };
  const switchTo = async (email) => {
    await page.locator('#account-trigger').click();
    await Promise.all([page.waitForEvent('load'), page.locator('#account-signout').click()]);
    await page.locator('#account[data-state="guest"]').waitFor({ state: 'attached' });
    await h.signIn(email);
  };
  const noSideScroll = async (label) => check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: nothing scrolls sideways`);

  await h.openApp();
  await placement();
  await challenge();
  check(await page.locator('#online-signin').isVisible(), 'a guest is offered sign-in in the friends panel');
  check(await page.locator('#people-race-link').isHidden(), 'a guest has no Race by link tile');
  await noSideScroll('guest');
  await shot('guest');

  await h.signIn('new@stilltype.test');
  await placement();
  await challenge();
  await page.locator('[data-people-action="link"]').waitFor();
  await page.locator('#quick-match [data-quick-part="gauge"]').waitFor();
  await h.settle();
  note('new rating', await h.text('#quick-match [data-quick-part="rating"]'));
  check(await page.locator('#people-race-link').isHidden(), 'the "A friend" row stands in for Race by link');
  await noSideScroll('empty');
  await shot('empty');

  for (const view of ['add', 'setup']) {
    await page.locator(`#people-${view}`).click();
    await page.locator(`#people-${view}-heading:focus`).waitFor();
    await h.settle();
    await noSideScroll(view);
    await shot(`view-${view}`);
    await page.locator(`#people-${view}-view [data-challenge-back]`).click();
    check(await page.locator(`#people-${view}`).evaluate((node) => node === document.activeElement), `Back from ${view} returns focus to its control`);
  }

  for (const [opener, view] of [['open-daily', 'daily'], ['open-local', 'local']]) {
    await page.locator(`#${opener}`).click();
    await page.locator(`#challenge-${view}-view`).waitFor();
    await h.settle();
    await noSideScroll(view);
    await shot(`view-${view}`);
    await page.locator(`#challenge-${view}-view [data-challenge-back]`).click();
    check(await page.locator(`#${opener}`).evaluate((node) => node === document.activeElement), `Back from ${view} returns focus to its tile`);
  }

  await page.locator('[data-people-action="link"]').click();
  await page.locator('#online-guest-link').waitFor();
  await h.settle();
  await noSideScroll('room');
  await shot('room-waiting');
  await page.locator('#online-leave').click();
  await page.locator('#challenge-people').waitFor();

  await switchTo('toby@stilltype.test');
  await placement();
  await challenge();
  await page.locator('.people-row[data-state="ghost"]').waitFor();
  await page.locator('.people-row[data-state="invited"]').waitFor();
  await page.locator('.people-tally').first().waitFor();
  await page.locator('#quick-match [data-quick-part="gauge"][data-lit="3"]').waitFor();
  await h.settle();
  note('provisional rating', await h.text('#quick-match [data-quick-part="rating"]'));
  check(await page.locator('#people-race-link').isVisible(), 'with friends, Race by link is a tile');
  await noSideScroll('provisional');
  await shot('provisional-friends');

  await page.locator('#quick-match [data-quick="toggle"]').click();
  await page.locator('#quick-match [data-quick="toggle"]', { hasText: 'Stop looking' }).waitFor();
  await h.settle();
  await shot('searching');
  await page.locator('#quick-match [data-quick="toggle"]').click();

  await switchTo('rank@stilltype.test');
  await placement();
  await challenge();
  await page.locator('#quick-match [data-quick-part="gauge"]').waitFor();
  await h.settle();
  note('ranked rating', await h.text('#quick-match [data-quick-part="rating"]'));
  await noSideScroll('ranked');
  await shot('ranked');
  if (wide && top) check(await page.locator('html').getAttribute('data-navigation') === 'top', 'the top bar held');
};
