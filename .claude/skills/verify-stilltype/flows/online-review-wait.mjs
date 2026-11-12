// A finished online race whose other racer's keystrokes haven't reached the service (TOB-448): the results hold Graph
// and Replay's place at their height and say whose keystrokes they wait for; once the reads run out (a minute, moved
// on with Playwright's clock) they say the keystrokes never came. Mara's trace is never kept by the fake service.
export default async ({ page, h, shot, note, check, fake, url }) => {
  const host = fake.addUser('toby@stilltype.test');
  const guest = fake.addUser('mara@stilltype.test');
  // Mara's trace never reaches the service, as when her tab is closed before it can send it.
  const keep = fake.races.keepTrace.bind(fake.races);
  fake.races.keepTrace = (room, player, trace) => (player.name === 'Mara' ? undefined : keep(room, player, trace));
  const light = await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches);
  const context = await page.context().browser().newContext({ baseURL: url, viewport: page.viewportSize(), colorScheme: light ? 'light' : 'dark', serviceWorkers: 'block' });
  const mara = await context.newPage();
  await fake.attach(mara);
  try {
    await page.clock.install();
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

    await page.locator('#online-ready').click();
    await mara.locator('#online-ready').click();
    // The results show once both have typed the passage; the shot waits for them, not for the typing to stop.
    await page.locator('#online-input:enabled').waitFor({ timeout: 20000 });
    await mara.locator('#online-input:enabled').waitFor();
    const passage = await page.locator('#online-accessible-passage').textContent();
    // Each types a key at a time until the race closes its input, so no key lands on the page after it.
    const typeUntilClosed = async (racer, delay) => {
      for (const char of passage) {
        if (await racer.locator('#online-input').isDisabled()) return;
        await racer.keyboard.type(char, { delay });
      }
    };
    const typing = Promise.all([typeUntilClosed(page, 30), typeUntilClosed(mara, 40)]);
    await page.locator('#online-results').waitFor({ timeout: 60000 });
    await typing;
    const wait = page.locator('#online-review-wait');
    await wait.waitFor();
    note('waiting text', await wait.textContent());
    check((await wait.textContent()) === 'Graph and Replay appear when Mara’s keystrokes arrive.', 'the results say whose keystrokes they wait for');
    await h.settle();
    await shot('waiting');
    await page.clock.runFor(62000);
    await page.locator('#online-review-wait[data-state="none"]').waitFor();
    check((await wait.textContent()) === 'No Graph or Replay for this race: Mara’s keystrokes didn’t arrive.', 'and, once the reads run out, that they never came');
    await h.settle();
    await shot('none');
  } finally {
    await context.close();
  }
};
