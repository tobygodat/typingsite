// Challenge's people list in its other states: a guest, a signed-in account with nobody on its list, Add a friend
// and the friend it adds, quick match searching, the daily passage and One keyboard from the foot links and Back,
// and a guest joining a race by its link in a second browser.
export default async ({ page, h, shot, note, check, fake, url }) => {
  fake.addUser('toby@stilltype.test');
  fake.addUser('mara@stilltype.test');
  await h.openApp();
  await h.openView('Challenge');
  await h.settle();
  check(await page.locator('#people-list').isHidden(), 'a guest has no rows');
  check(await page.getByRole('button', { name: 'Sign in to keep friends' }).isVisible(), 'a guest is offered sign-in');
  note('guest line', await h.text('[data-guest]'));
  await shot('guest');

  await h.signIn('toby@stilltype.test');
  await h.openView('Challenge');
  await page.locator('[data-people-action="link"]').waitFor();
  await h.settle();
  check(await page.locator('#people-race-link').isHidden(), 'the empty list offers the race link once, in its row');
  await shot('empty');

  await page.locator('#quick-match [data-quick="toggle"]').click();
  await page.locator('#quick-match [data-quick="toggle"]', { hasText: 'Stop looking' }).waitFor();
  await h.settle();
  await shot('quick-searching');
  await page.locator('#quick-match [data-quick="toggle"]').click();

  await page.locator('#people-add').click();
  await page.locator('#online-invite-email').fill('mara@stilltype.test');
  await h.settle();
  await shot('add-friend');
  await page.locator('#add-friend').click();
  await page.locator('.online-friend-row', { hasText: 'mara@stilltype.test' }).waitFor();
  await page.locator('#people-add-view [data-challenge-back]').click();
  await page.getByRole('button', { name: 'Race mara', exact: true }).waitFor();
  await h.settle();
  await shot('one-friend');

  for (const [link, view] of [['open-daily', 'challenge-daily-view'], ['open-local', 'challenge-local-view']]) {
    await page.locator(`#${link}`).click();
    await page.locator(`#${view}`).waitFor();
    await h.settle();
    await shot(view);
    await page.locator(`#${view} [data-challenge-back]`).click();
    check(await page.locator(`#${link}`).evaluate((node) => node === document.activeElement), `Back from ${view} returns focus to its link`);
  }

  await page.locator('#people-race-link').click();
  const field = page.locator('#online-guest-link');
  await field.waitFor();
  const link = await field.inputValue();
  note('race link', link);
  await h.settle();
  await shot('race-link-room');

  const context = await page.context().browser().newContext({ baseURL: url, viewport: page.viewportSize(), colorScheme: (await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches)) ? 'light' : 'dark', serviceWorkers: 'block' });
  const guest = await context.newPage();
  await fake.attach(guest);

  try {
    await guest.goto(link);
    await guest.locator('#online-guest-join').waitFor();
    await guest.locator('#online-guest-name').fill('Lin');
    note('guest join', await guest.locator('#online-guest-join').innerText());
    check(await guest.locator('#challenge-people').isHidden(), 'the invitation takes the list\'s place');
    await guest.locator('#join-online-race').click();
    await guest.locator('#online-room').waitFor();
    await page.locator('#online-players', { hasText: 'Lin' }).waitFor();
    await h.settle();
    await shot('guest-joined');
  } finally { await context.close(); }
};
