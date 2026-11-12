// Challenge's people list with the race rating as quick match states it: a guest first, then an account below 10
// rated races (provisional, no rank), then the same account with a rank (ADR 0016). The list holds an invitation, a
// ghost waiting and two friends with tallies, so the rank sits over a real page.
const PASSAGE = 'The quick brown fox jumps over the lazy dog.';
const trace = (step) => ({ v: 1, k: PASSAGE, t: [...PASSAGE].map((_, index) => (index ? step : 0)), e: step * (PASSAGE.length - 1) });

export default async ({ page, h, shot, note, check, fake }) => {
  const toby = fake.addUser('toby@stilltype.test');
  const [maya, sam, lena] = ['maya', 'sam', 'lena'].map((name) => fake.addUser(`${name}@stilltype.test`));
  fake.races.addFriend(toby.id, { name: 'Maya Okafor', friendId: maya.id });
  fake.races.addFriend(toby.id, { name: 'Sam Achebe', friendId: sam.id });
  fake.races.addFriend(toby.id, { name: 'Lena Ortiz', friendId: lena.id });
  fake.races.tallies.set([toby.id, sam.id].sort().join(':'), toby.id < sam.id ? [2, 1] : [1, 2]);
  fake.races.tallies.set([toby.id, maya.id].sort().join(':'), toby.id < maya.id ? [3, 4] : [4, 3]);
  fake.challenges.seed(maya.id, toby.id, { name: 'Maya', label: 'Toby', passage: PASSAGE, trace: trace(150) });
  fake.races.invite(lena.id, toby.id, { name: 'Lena', ageMs: 120000 });
  const rating = '#quick-match [data-quick-part="rating"]';
  const flat = async () => (await h.text(rating)).replace(/\s+/g, ' ');

  await h.openApp();
  await h.openView('Challenge');
  await h.settle();
  note('guest line', await h.text('[data-guest]'));
  await shot('guest');

  fake.races.quick.ratings.set(toby.id, { rating: 1540, races: 6 });
  await h.signIn('toby@stilltype.test');
  await h.openView('Challenge');
  await page.locator(`${rating}:not([hidden])`).waitFor();
  await page.locator('.people-tally').first().waitFor();
  await page.locator('#challenge-toast-close').click().catch(() => {});
  await h.settle();
  note('provisional', await flat());
  check(await flat() === 'Race rating 1540 · 6 rated races · provisional', 'below 10 rated races the line names no rank');
  await shot('provisional');

  fake.races.quick.ratings.set(toby.id, { rating: 1840, races: 23 });
  await page.reload();
  await h.openView('Challenge');
  await page.locator(rating, { hasText: 'Gale' }).waitFor();
  await page.locator('.people-tally').first().waitFor();
  await page.locator('#challenge-toast-close').click().catch(() => {});
  await h.settle();
  note('ranked', await flat());
  check(await flat() === 'Gale III · 1840 · 23 rated races', 'from 10 rated races the line leads with the rank');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'nothing scrolls sideways');
  await shot('ranked');
};
