// Quick match between two strangers on the standard 30-second setup, from Toby's side, with Mara's page
// saved beside it (QUICK_MATCH_OTHER names the folder for her shots): searching, matched, both results with
// the rating change, Add to friends, and the friend list after closing the race.
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
    await page.locator('#people-setup').click();
    await page.locator('#online-name').fill('Toby');
    await page.locator('#online-setup-done').click();
    await page.locator('#quick-match [data-quick-part="rating"]:not([hidden])').waitFor();
    note('rating', await h.text('#quick-match [data-quick-part="rating"]'));
    await shot('idle');
    await page.locator('#quick-match [data-quick="toggle"]').click();
    await page.locator('#quick-match [data-quick="toggle"]', { hasText: 'Stop looking' }).waitFor();
    note('first press', await h.text('#quick-match [data-quick-part="status"]'));
    await shot('searching');

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
    await mara.locator('#quick-match [data-quick="toggle"]').click();
    await page.locator('#online-room-status', { hasText: 'Matched with Mara.' }).waitFor({ timeout: 5000 });
    await mara.locator('#online-room-status', { hasText: 'Matched with Toby.' }).waitFor();
    check(!(await mara.locator('body').textContent()).includes('toby@'), 'Mara never sees Toby’s email');
    await shot('matched');
    await other('matched');

    await page.locator('#online-input:enabled').waitFor({ timeout: 10000 });
    await mara.locator('#online-input:enabled').waitFor();
    const passage = await page.locator('#online-accessible-passage').textContent();
    await Promise.all([page.keyboard.type(passage.slice(0, 200), { delay: 110 }), mara.keyboard.type(passage.slice(0, 150), { delay: 150 })]);
    await shot('racing');
    await page.locator('#online-results').waitFor({ timeout: 30000 });
    await mara.locator('#online-results').waitFor({ timeout: 10000 });
    await page.locator('#online-rating-change:not([hidden])').waitFor();
    await h.settle();
    note('Toby rating change', await h.text('#online-rating-change'));
    note('Mara rating change', await mara.locator('#online-rating-change').textContent());
    check((await h.text('#online-rating-change')).endsWith('(+20)'), 'the winner gains 20');
    await shot('results');
    await other('results');

    await page.locator('#online-befriend').click();
    await page.locator('#online-befriend').waitFor({ state: 'hidden' });
    await page.locator('#online-leave').click();
    await page.locator('#people-list', { hasText: 'Mara' }).waitFor();
    await page.locator('#quick-match [data-quick-part="rating"]', { hasText: '1520' }).waitFor();
    await h.settle();
    await shot('after');
  } finally {
    await context.close();
  }
};
