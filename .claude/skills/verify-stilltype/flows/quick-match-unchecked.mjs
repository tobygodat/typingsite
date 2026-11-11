// Quick match where neither run can be checked: both racers' keys arrive all at once, as a paste or a script
// gives them, so the race is unrated and each says why. QUICK_MATCH_OTHER names a folder for Mara's shots.
import path from 'node:path';

export default async ({ page, h, shot, note, check, fake, url }) => {
  fake.addUser('toby@stilltype.test');
  fake.addUser('mara@stilltype.test');
  const light = await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches);
  const context = await page.context().browser().newContext({ baseURL: url, viewport: page.viewportSize(), colorScheme: light ? 'light' : 'dark', serviceWorkers: 'block' });
  const mara = await context.newPage();
  const other = async (name) => { if (process.env.QUICK_MATCH_OTHER) await mara.screenshot({ path: path.join(process.env.QUICK_MATCH_OTHER, `mara.${name}.png`) }); };
  await fake.attach(mara);

  try {
    await h.openApp();
    await h.signIn('toby@stilltype.test');
    await h.openView('Challenge');
    await page.locator('#online-name').fill('Toby');
    await page.locator('#quick-match [data-quick="toggle"]').click();

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
    await Promise.all([page.keyboard.type(passage.slice(0, 90)), mara.keyboard.type(passage.slice(0, 70))]);
    await page.locator('#online-rating-change:not([hidden])').waitFor({ timeout: 45000 });
    await mara.locator('#online-rating-change:not([hidden])').waitFor({ timeout: 10000 });
    await h.settle();
    note('Toby', await h.text('#online-rating-change'));
    note('Mara', await mara.locator('#online-rating-change').textContent());
    check((await h.text('#online-rating-change')).startsWith('Not rated: neither racer finished with a run that could be checked.'), 'neither run counts, so the race is unrated');
    check(!/cheat|script|bot/i.test(await h.text('#online-rating-change')), 'the reason accuses nobody');
    await shot('both-unchecked');
    await other('both-unchecked');
  } finally {
    await context.close();
  }
};
