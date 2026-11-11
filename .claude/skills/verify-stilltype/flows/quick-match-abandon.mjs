// Quick match where Mara closes her page mid-race on the standard 30-second setup: Toby finishes, waits out the
// ten-second grace and gets the rated win; then Mara opens Stilltype again and the Online tab says it was a
// rated loss and why. QUICK_MATCH_OTHER names a folder for Mara's shots.
import path from 'node:path';

export default async ({ page, h, shot, note, check, fake, url }) => {
  fake.addUser('toby@stilltype.test');
  fake.addUser('mara@stilltype.test');
  const light = await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches);
  const context = await page.context().browser().newContext({ baseURL: url, viewport: page.viewportSize(), colorScheme: light ? 'light' : 'dark', serviceWorkers: 'block' });
  let mara = await context.newPage();
  const other = async (name) => { if (process.env.QUICK_MATCH_OTHER) await mara.screenshot({ path: path.join(process.env.QUICK_MATCH_OTHER, `mara.${name}.png`) }); };
  await fake.attach(mara);

  try {
    await h.openApp();
    await h.signIn('toby@stilltype.test');
    await h.openView('Challenge');
    await page.locator('#online-name').fill('Toby');
    await page.locator('#quick-match [data-quick="toggle"]').click();
    await page.locator('#quick-match [data-quick="toggle"]', { hasText: 'Stop looking' }).waitFor();

    await mara.goto('/');
    await mara.locator('#text-display .char').first().waitFor();
    await mara.locator('#account-trigger').click();
    await mara.locator('#account-signin').click();
    await mara.locator('#account-email-input').fill('mara@stilltype.test');
    await mara.locator('#account-password').fill('correct horse battery');
    await Promise.all([mara.waitForEvent('load'), mara.locator('#account-submit').click()]);
    await mara.locator('#account[data-state="member"]').waitFor();
    await mara.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Challenge' }).click();
    await mara.locator('#online-name').fill('Mara');
    await mara.locator('#quick-match [data-quick="toggle"]').click();
    await page.locator('#online-input:enabled').waitFor({ timeout: 15000 });
    await mara.locator('#online-input:enabled').waitFor();
    const passage = await page.locator('#online-accessible-passage').textContent();
    await mara.keyboard.type(passage.slice(0, 30), { delay: 150 });
    await other('racing');
    await mara.close();
    note('Mara', 'closed her page mid-race');

    await page.keyboard.type(passage.slice(0, 220), { delay: 110 });
    await page.locator('#online-room-status', { hasText: 'Waiting for the other player.' }).waitFor({ timeout: 30000 });
    note('waiting', await h.text('#online-room-status'));
    await shot('waiting-out-the-grace');
    await page.locator('#online-rating-change:not([hidden])').waitFor({ timeout: 20000 });
    await h.settle();
    note('Toby rating change', await h.text('#online-rating-change'));
    check((await h.text('#online-rating-change')).startsWith('Rated win: Mara didn’t finish.'), 'the racer who stayed gets a rated win');
    check((await h.text('#online-rating-change')).endsWith('(+20)'), 'the win moves the rating by 20');
    await shot('rated-win');

    mara = await context.newPage();
    await fake.attach(mara);
    await mara.goto('/');
    await mara.locator('#text-display .char').first().waitFor();
    await mara.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Challenge' }).click();
    const status = mara.locator('#quick-match [data-quick-part="status"]');
    await status.filter({ hasText: 'Rated loss' }).waitFor({ timeout: 10000 });
    note('Mara on return', await status.textContent());
    check((await status.textContent()).startsWith('Rated loss: your finish didn’t arrive before the race closed.'), 'the racer who left sees the rated loss and why');
    await other('return');
  } finally {
    await context.close();
  }
};
