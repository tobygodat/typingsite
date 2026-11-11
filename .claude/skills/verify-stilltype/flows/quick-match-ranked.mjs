// Quick match between two ranked accounts, both at 1795 (Gust I) with 20 rated races: Toby's rating line before,
// his win that crosses into Gale III, Mara's loss that stays in Gust I, and his rating line after. The race clock
// is 5 seconds, as in e2e/quick-match.spec.js; everything else is the standard setup.
export default async ({ page, h, shot, note, check, fake, url }) => {
  for (const email of ['toby@stilltype.test', 'mara@stilltype.test']) fake.races.quick.ratings.set(fake.addUser(email).id, { rating: 1795, races: 20 });
  fake.races.quick.duration = 5;
  fake.races.quick.countdownMs = 2000;
  const light = await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches);
  const context = await page.context().browser().newContext({ baseURL: url, viewport: page.viewportSize(), colorScheme: light ? 'light' : 'dark', serviceWorkers: 'block' });
  const mara = await context.newPage();
  await fake.attach(mara);
  const rating = '#quick-match [data-quick-part="rating"]';
  const fits = (selector) => page.locator(selector).evaluate((el) => el.scrollWidth <= el.clientWidth && document.documentElement.scrollWidth <= innerWidth);

  try {
    await h.openApp();
    await h.signIn('toby@stilltype.test');
    await h.openView('Challenge');
    await page.locator('#online-name').fill('Toby');
    await page.locator(`${rating}:not([hidden])`).waitFor();
    note('rating before', await h.text(rating));
    check((await h.text(rating)).replaceAll(' ', ' ') === 'Gust I · 1795 · 20 rated races', 'the rating line leads with the rank');
    check(await fits(rating), 'the rating line fits without scrolling sideways');
    await shot('rating-before');
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

    await page.locator('#online-input:enabled').waitFor({ timeout: 10000 });
    await mara.locator('#online-input:enabled').waitFor();
    const passage = await page.locator('#online-accessible-passage').textContent();
    await Promise.all([page.keyboard.type(passage.slice(0, 60), { delay: 35 }), mara.keyboard.type(passage.slice(0, 30), { delay: 70 })]);
    await page.locator('#online-rating-change:not([hidden])').waitFor({ timeout: 20000 });
    await mara.locator('#online-rating-change:not([hidden])').waitFor({ timeout: 20000 });
    await h.settle();
    const mine = (await h.text('#online-rating-change')).replaceAll(' ', ' ');
    const theirs = (await mara.locator('#online-rating-change').textContent()).replaceAll(' ', ' ');
    note('Toby rating change', mine);
    note('Mara rating change', theirs);
    check(mine === 'Rated win. Gale III · 1805 · 21 rated races (+10), up from Gust I.', 'the win says it moved up from Gust I');
    check(theirs === 'Rated loss. Gust I · 1785 · 21 rated races (−10)', 'a loss that stays in Gust I says nothing more');
    check(!(await page.locator('#online-room').textContent()).includes('1785'), 'Toby never sees Mara’s rating');
    check(await fits('#online-rating-change'), 'the result line fits without scrolling sideways');
    await page.locator('#online-rating-change').scrollIntoViewIfNeeded();
    await shot('result');

    await page.locator('#online-leave').click();
    await page.locator(rating, { hasText: '1805' }).waitFor();
    note('rating after', await h.text(rating));
    await h.settle();
    await shot('rating-after');
  } finally {
    await context.close();
  }
};
