// An online race between two accounts, seen from the host's side: the results with the graph and the
// replay, then each Rematch state (you picked, they picked, both picked: "Starting", they left). Mara is a
// second browser context on the same fake Supabase. The pair's earlier wins (2 to 1) are seeded in the fake
// service, so the first result reads 3 – 1 without racing four times. Toby's join of the rematch lands after its
// countdown has ended (TOB-448): his clock still matches Mara's, and both results of the rematch have Graph and Replay.
// On a build without the rematch results it stops after the results shot, which makes it the "before".
export default async ({ page, h, shot, note, check, fake, url }) => {
  const host = fake.addUser('toby@stilltype.test');
  const guest = fake.addUser('mara@stilltype.test');
  fake.races.tallies?.set([host.id, guest.id].sort().join(':'), host.id < guest.id ? [2, 1] : [1, 2]);
  const light = await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches);
  const context = await page.context().browser().newContext({ baseURL: url, viewport: page.viewportSize(), colorScheme: light ? 'light' : 'dark', serviceWorkers: 'block' });
  const mara = await context.newPage();
  await fake.attach(mara);
  try {
    await h.openApp();
    await h.signIn('toby@stilltype.test');
    await h.openView('Challenge');
    await page.locator('#people-setup').click();
    await page.locator('#online-name').fill('Toby');
    await page.locator('#online-setup-done').click();
    await page.locator('#people-add').click();
    await page.locator('#online-invite-email').fill('mara@stilltype.test');
    await page.locator('#create-online-race').click();
    await page.locator('#online-room').waitFor();

    await mara.goto('/');
    await mara.locator('#text-display .char').first().waitFor();
    await mara.locator('#account-trigger').click();
    await mara.locator('#account-signin').click();
    await mara.locator('#account-email-input').fill('mara@stilltype.test');
    await mara.locator('#account-password').fill('correct horse battery');
    await Promise.all([mara.waitForEvent('load'), mara.locator('#account-submit').click()]);
    await mara.locator('#account[data-state="member"]').waitFor();
    await mara.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Challenge' }).click();
    await mara.locator('#people-setup').click();
    await mara.locator('#online-name').fill('Mara');
    await mara.locator('#online-setup-done').click();
    await mara.locator('[data-accept-invite]').click();
    await mara.locator('#online-room').waitFor();

    // Both type the whole passage at once, Toby a little faster.
    const race = async () => {
      await page.locator('#online-input:enabled').waitFor({ timeout: 20000 });
      await mara.locator('#online-input:enabled').waitFor();
      const passage = await page.locator('#online-accessible-passage').textContent();
      await Promise.all([page.keyboard.type(passage, { delay: 90 }), mara.keyboard.type(passage, { delay: 120 })]);
      await page.locator('#online-results').waitFor({ timeout: 20000 });
    };
    await page.locator('#online-ready').click();
    await mara.locator('#online-ready').click();
    await race();
    if (!(await page.locator('#online-duel-mine').count())) {
      await h.settle();
      await shot('results');
      return;
    }
    await page.locator('#online-review').waitFor({ timeout: 10000 });
    await h.settle();
    note('tally', await h.text('#online-tally'));
    check(await page.locator('#online-duel-graph path.graph-line').count() === 2, 'the graph draws both racers');
    await shot('results');

    await page.locator('#online-show-replay').click();
    await page.waitForTimeout(9000);
    await page.locator('#online-replay-toggle').click();
    check(await page.locator('#online-replay-display .caret-tag').count() === 2, 'both carets carry a name');
    await shot('replay');
    await page.locator('#online-show-graph').click();

    await page.locator('#online-rematch').click();
    await page.locator('#online-rematch[aria-pressed="true"]').waitFor();
    await h.settle();
    await shot('you-chose');
    await page.locator('#online-rematch').click();
    await page.locator('#online-rematch[aria-pressed="false"]:not([aria-disabled])').waitFor();

    await mara.locator('#online-rematch').click();
    await page.locator('#online-their-rematch[data-state="chosen"]').waitFor();
    await h.settle();
    await shot('they-chose');

    // Holding the reply that moves Toby into the rematch keeps "Starting" on screen for the shot, and lets it land
    // only once Mara is racing.
    const release = fake.races.hold('join', host.id);
    await page.locator('#online-rematch').click();
    await page.locator('#online-starting:not([hidden])').waitFor();
    await h.settle();
    await shot('both-chose');
    await mara.locator('#online-input:enabled').waitFor({ timeout: 20000 });
    release();
    await page.locator('#online-input:enabled').waitFor({ timeout: 20000 });
    const left = async (racer) => Number((await racer.locator('#online-timer').textContent()).match(/\d+/)?.[0]);
    const clocks = await Promise.all([left(page), left(mara)]);
    note('rematch clocks (Toby, Mara)', clocks.join(', '));
    check(Math.abs(clocks[0] - clocks[1]) <= 1, 'a late join races on the same clock as the other racer');
    await shot('rematch-joined-late');

    await race();
    await page.locator('#online-review').waitFor({ timeout: 10000 });
    await mara.locator('#online-review').waitFor({ timeout: 10000 });
    check(await page.locator('#online-duel-graph path.graph-line').count() === 2, 'the rematch graph draws both racers');
    check(await mara.locator('#online-duel-graph path.graph-line').count() === 2, 'Mara’s rematch graph draws both racers');
    await h.settle();
    await shot('rematch-graph');
    await page.locator('#online-show-replay').click();
    await page.waitForTimeout(9000);
    await page.locator('#online-replay-toggle').click();
    check(await page.locator('#online-replay-display .caret-tag').count() === 2, 'both rematch carets carry a name');
    await shot('rematch-replay');
    await page.locator('#online-show-graph').click();
    await mara.locator('#online-leave').click();
    await page.locator('#online-their-rematch[data-state="left"]').waitFor();
    await h.settle();
    note('tally after the rematch', await h.text('#online-tally'));
    await shot('they-left');
  } finally {
    await context.close();
  }
};
