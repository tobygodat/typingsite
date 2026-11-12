// Challenge's people list, signed in with a full list: a ghost waiting, an invitation, friends with tallies and
// finished ghost races, one saved by email. Then an invitation arriving while the page is open, Race setup, and
// pressing Race on a friend through to the room. Every record is seeded in the fake service as the real one
// would hold it (supabase/migrations/20261111120000_race_people.sql links them).
const PASSAGE = 'The quick brown fox jumps over the lazy dog.';
const HOUR = 3600000;
const DAY = 24 * HOUR;

// A finished run of the passage at about `wpm`, one key every step.
function trace(wpm) {
  const step = Math.round(12000 / wpm);

  return { v: 1, k: PASSAGE, t: [...PASSAGE].map((_, index) => (index ? step : 0)), e: step * (PASSAGE.length - 1) };
}

const score = (wpm) => {
  const elapsedMs = Math.round(12000 / wpm) * (PASSAGE.length - 1);

  return { wpm, accuracy: 100, elapsedMs, correct: PASSAGE.length };
};

export default async ({ page, h, shot, note, check, fake }) => {
  const toby = fake.addUser('toby@stilltype.test');
  const people = Object.fromEntries(['maya', 'priya', 'sam', 'lena', 'jonas', 'ola'].map((name) => [name, fake.addUser(`${name}@stilltype.test`)]));
  const friend = (name, label) => fake.races.addFriend(toby.id, { name: label, friendId: people[name].id });
  const tally = (name, mine, theirs) => {
    const key = [toby.id, people[name].id].sort().join(':');
    fake.races.tallies.set(key, key.startsWith(toby.id) ? [mine, theirs] : [theirs, mine]);
  };

  friend('maya', 'Maya Okafor');
  friend('priya', 'Priya Raman');
  friend('sam', 'Sam Achebe');
  friend('lena', 'Lena Ortiz');
  friend('jonas', 'Jonas Weber');
  fake.races.addFriend(toby.id, { name: 'Theo Lindqvist', email: 'theo@example.com' });
  // Two friends saved by email under one name: told apart by the email typed for each.
  fake.races.addFriend(toby.id, { name: 'Alex', email: 'alex.kim@example.com' });
  fake.races.addFriend(toby.id, { name: 'Alex', email: 'alex.ruiz@example.com' });
  tally('maya', 3, 4);
  tally('priya', 1, 6);
  tally('sam', 2, 2);
  tally('lena', 0, 2);
  tally('jonas', 3, 0);
  fake.challenges.seed(people.maya.id, toby.id, { name: 'Maya', label: 'Toby', passage: PASSAGE, trace: trace(84), createdAt: Date.now() - DAY });
  fake.races.invite(people.priya.id, toby.id, { name: 'Priya', ageMs: 2 * 60000 });

  // Finished ghost races: Sam raced Toby's run (Toby led), Toby raced Lena's (Lena led).
  const won = fake.challenges.seed(toby.id, people.sam.id, { name: 'Toby', label: 'Sam', passage: PASSAGE, trace: trace(81), createdAt: Date.now() - 6 * DAY });
  Object.assign(won, { result: score(77), completedAt: new Date(Date.now() - 5 * DAY).toISOString() });
  const lost = fake.challenges.seed(people.lena.id, toby.id, { name: 'Lena', label: 'Toby', passage: PASSAGE, trace: trace(87), createdAt: Date.now() - 12 * DAY });
  Object.assign(lost, { result: score(79), completedAt: new Date(Date.now() - 11 * DAY).toISOString() });

  await h.openApp();
  await h.signIn('toby@stilltype.test');
  await h.openView('Challenge');
  await page.locator('.people-row[data-key="friend:' + fake.races.friends.get(toby.id)[0].id + '"][data-state="ghost"]').waitFor();
  await page.locator('.people-tally').first().waitFor();
  await h.settle();
  const rows = await page.locator('.people-row').evaluateAll((items) => items.map((item) => item.innerText.replace(/\s+/g, ' ').trim()));
  note('rows', rows);
  check(rows.length === 8, 'one row per person');
  check(await page.getByRole('button', { name: 'Race Alex (alex.kim@example.com)' }).count() === 1, 'same-named friends are told apart by email');
  note('race setup link', await h.text('#people-setup'));
  check(/words|quote|\d+ s/.test(await h.text('#people-setup-conditions')), 'the Race setup link names what a Race uses');
  check(/^Priya Raman invited you/.test(rows[0]) && /^Maya Okafor sent a ghost at \d+ wpm · 6 days left/.test(rows[1]), 'the invitation, then the ghost');
  check(rows.some((row) => /Sam Achebe won \d+–77/.test(row)) && rows.some((row) => /Lena Ortiz lost 79–\d+/.test(row)), 'finished ghost races read as won and lost');
  check(await page.getByRole('button', { name: 'Race Sam Achebe' }).count() === 1, 'Race names the person');
  check((await page.locator('.people-row', { hasText: 'Maya' }).locator('.sr-only').textContent()) === '3 wins, 4 losses', 'the tally reads as wins and losses');
  await shot('list');
  await page.emulateMedia({ forcedColors: 'active' });
  await h.settle();
  await shot('forced-colors');
  await page.emulateMedia({ forcedColors: 'none' });

  // An invitation arrives while the page is open.
  fake.races.invite(people.ola.id, toby.id, { name: 'Ola' });
  await page.locator('.people-row', { hasText: 'Ola' }).waitFor({ timeout: 15000 });
  await h.settle();
  await shot('invitation-arrived');

  await page.locator('#people-setup').click();
  await page.locator('#people-setup-view:not([hidden])').waitFor();
  await page.locator('#online-options [data-mode="words"]').click();
  await h.settle();
  await shot('race-setup');
  await page.locator('#online-setup-done').click();

  await page.getByRole('button', { name: 'Race Sam Achebe' }).click();
  await page.locator('#online-room:not([hidden])').waitFor();
  await h.settle();
  note('room', await h.text('#online-account-invite-status'));
  note('room conditions', await h.text('#online-room-conditions'));
  check(/words/.test(await h.text('#online-room-conditions')), 'the room names the setup Race setup chose');
  await shot('raced-sam');
};
