// Dismiss pressed with a quick double tap of Enter (TOB-448): focus lands on a row, shown, never on an action, so the
// second press joins nothing. First, before the friend list has answered, Ola's invitation is the only row: dismissed,
// it leaves no row, and focus goes to Quick match's heading, not Find a race. Then the friend list answers (Ada is on
// it) and three invitations arrive: Kim's row goes and focus lands on Lin's row; Ada's row stays as Race and focus
// lands on it, and Tab goes on to her Race.
export default async ({ page, h, shot, check, fake }) => {
  const toby = fake.addUser('toby@stilltype.test');
  const [ada, kim, lin, ola] = ['ada', 'kim', 'lin', 'ola'].map((name) => fake.addUser(`${name}@stilltype.test`));
  fake.races.addFriend(toby.id, { name: 'Ada', friendId: ada.id });
  fake.races.invite(ola.id, toby.id, { name: 'Ola' });
  const release = fake.races.hold('friends', toby.id);
  const row = (name) => page.locator('#people-list .people-row').filter({ has: page.locator('.people-name', { hasText: name }) });
  const shows = (locator) => locator.evaluate((node) => node === document.activeElement && node.matches(':focus-visible'));
  const twice = async () => { await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); };

  await h.openApp();
  await h.signIn('toby@stilltype.test');
  await h.openView('Challenge');
  await page.getByRole('button', { name: 'Dismiss Ola’s invitation' }).focus();
  await twice();
  await page.locator('#people-list').waitFor({ state: 'hidden' });
  check(await shows(page.locator('#quick-match-heading')), 'with no row left, focus shows on Quick match’s heading');
  check((await page.locator('#quick-match [data-quick="toggle"]').textContent()) === 'Find a race', 'the second press started no search');
  await h.settle();
  await shot('no-row-left');
  release();

  fake.races.invite(ada.id, toby.id, { name: 'Ada', ageMs: 60000 });
  fake.races.invite(kim.id, toby.id, { name: 'Kim', ageMs: 30000 });
  fake.races.invite(lin.id, toby.id, { name: 'Lin' });
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await page.locator('#people-list .people-row[data-state="invited"][data-key^="friend:"]').waitFor({ timeout: 15000 });
  await page.locator('#people-list [data-state="invited"]').nth(2).waitFor();
  await page.getByRole('button', { name: 'Dismiss Kim’s invitation' }).focus();
  await h.settle();
  await shot('before');

  await twice();
  await row('Kim').waitFor({ state: 'detached' });
  check(await shows(row('Lin')), 'after Kim’s Dismiss, focus shows on Lin’s row');
  check(await page.locator('#online-room').isHidden(), 'the second press joined nothing');
  await h.settle();
  await shot('kim-dismissed');

  await page.getByRole('button', { name: 'Dismiss Ada’s invitation' }).focus();
  await twice();
  await row('Ada').locator('[data-race-friend]').waitFor();
  check(await shows(row('Ada')), 'after Ada’s Dismiss, focus shows on Ada’s row');
  check(await page.locator('#online-room').isHidden(), 'the second press sent no invitation');
  await h.settle();
  await shot('ada-dismissed');

  await page.keyboard.press('Tab');
  check(await page.getByRole('button', { name: 'Race Ada', exact: true }).evaluate((node) => node === document.activeElement), 'Tab goes on to the row’s action');
};
