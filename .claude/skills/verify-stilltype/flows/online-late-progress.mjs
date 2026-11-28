// A 15-second race whose last progress from Toby reaches the service after its clock (TOB-448): the service finishes
// him on the keys that progress carried, so the key he typed while it was on its way isn't counted. Mara's finish waits
// too, so the race is still on when Toby's tab hears the answer; the shots are that moment and the results after it.
const UNCOUNTED = 'The race clock ran out before your last keys reached the race, so they weren’t counted.';

export default async ({ page, h, shot, note, check, fake, url }) => {
  fake.addUser('toby@stilltype.test');
  fake.addUser('mara@stilltype.test');
  const light = await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches);
  const context = await page.context().browser().newContext({ baseURL: url, viewport: page.viewportSize(), colorScheme: light ? 'light' : 'dark', serviceWorkers: 'block' });
  const mara = await context.newPage();
  await fake.attach(mara);
  const isProgress = (request) => request.url().includes('/rpc/race_action') && request.postDataJSON()?.p_action === 'progress';
  // From shut() on, the racer's progress waits on its way to the service until open().
  const gate = async (racer) => {
    let open;
    const until = new Promise((resolve) => { open = resolve; });
    let shut = false;
    await racer.route('**/rest/v1/rpc/race_action', async (route) => {
      if (shut && isProgress(route.request())) await until;
      await route.fallback();
    });

    return { shut: () => { shut = true; }, open };
  };

  try {
    await h.openApp();
    await h.signIn('toby@stilltype.test');
    await page.locator('#mode-time').click();
    await page.locator('#duration-options [data-length="15"]').click();
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

    const toby = await gate(page);
    const maras = await gate(mara);
    await page.locator('#online-ready').click();
    await mara.locator('#online-ready').click();
    await page.locator('#online-input:enabled').waitFor({ timeout: 20000 });
    await mara.locator('#online-input:enabled').waitFor();
    const room = [...fake.races.rooms.values()].at(-1);
    const clockOut = Date.parse(room.startAt) + room.duration * 1000;
    const passage = await page.locator('#online-accessible-passage').textContent();
    await page.keyboard.type(passage.slice(0, 20), { delay: 40 });
    await mara.keyboard.type(passage.slice(0, 20), { delay: 40 });
    while (room.players.some((player) => player.typed.length < 20)) await page.waitForTimeout(100);

    toby.shut();
    maras.shut();
    while (Date.now() < clockOut - 2500) await page.waitForTimeout(100);
    // Toby's 21st key goes out and waits on its way; his 22nd goes in while it waits, before his tab's clock runs out.
    const held = page.waitForRequest(isProgress);
    await page.keyboard.type(passage[20]);
    await held;
    await page.keyboard.type(passage[21]);
    while (Date.now() < clockOut + 500) await page.waitForTimeout(100);
    toby.open();
    while (!room.players[0].finished) await page.waitForTimeout(50);
    await page.waitForTimeout(500);
    const help = await h.text('#online-help');
    note('service typed', room.players[0].typed.length);
    note('help', help);
    note('status', await h.text('#online-room-status'));
    await h.settle();
    await shot('service-finished-racing');

    maras.open();
    await page.locator('#online-results').waitFor({ timeout: 15000 });
    const status = await h.text('#online-room-status');
    note('results status', status);
    await h.settle();
    await shot('results');

    check(room.players[0].typed.length === 21, 'the service settled on the 21 keys of the late progress');
    check(help === UNCOUNTED, 'the help line says the last keys weren’t counted');
    check(status === UNCOUNTED, 'the results say the last keys weren’t counted');
  } finally {
    await context.close();
  }
};
