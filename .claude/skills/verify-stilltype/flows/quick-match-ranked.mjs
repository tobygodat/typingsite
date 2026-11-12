// Quick matches for Toby, each against a new racer at his rating, so no pair races more than once: a win that
// crosses from Gust I into Gale III (with Mara's loss that stays in Gust I on her page), a win and a loss inside
// Gust I, and a provisional win. Each result is shot once its rank card has settled, and the promotion also
// mid-way, while the old step's bar fills. The race clock is 5 seconds, as in e2e/quick-match.spec.js; everything
// else is the standard setup.
const SCENARIOS = [
  { name: 'promotion', rival: 'mara', start: { rating: 1795, races: 20 }, wins: true,
    sentence: 'Rated win. Gale III · 1805 · 21 rated races (+10), up from Gust I.', theirs: 'Rated loss. Gust I · 1785 · 21 rated races (−10)',
    card: { label: 'Rank up', rank: 'Gale III', from: 'promoted from Gust I', rating: '1805', delta: '+10', ends: ['Gale III', '95 to Gale II'] } },
  { name: 'win-in-step', rival: 'iris', start: { rating: 1720, races: 30 }, wins: true, sentence: 'Rated win. Gust I · 1730 · 31 rated races (+10)',
    card: { label: 'Rated win', rank: 'Gust I', from: '', rating: '1730', delta: '+10', ends: ['Gust I', '70 to Gale III'] } },
  { name: 'loss-in-step', rival: 'noor', start: { rating: 1760, races: 30 }, wins: false, sentence: 'Rated loss. Gust I · 1750 · 31 rated races (−10)',
    card: { label: 'Rated loss', rank: 'Gust I', from: '', rating: '1750', delta: '−10', ends: ['Gust I', '50 to Gale III'] } },
  { name: 'provisional', rival: 'sol', start: { rating: 1500, races: 3 }, wins: true, sentence: 'Rated win. Race rating 1520 · 4 rated races · provisional (+20)',
    card: { label: 'Rated win', rank: '', from: '', rating: '1520', delta: '+20', ends: ['', ''], count: '4 rated races · provisional' } },
];

// Long enough for the promotion's two bar stages and the count to finish.
const CARD_SETTLES_MS = 4000;
const PROMOTION_STAGE_ONE_MS = 1300;

export default async ({ page, h, shot, note, check, fake, url }) => {
  const toby = fake.addUser('toby@stilltype.test');
  fake.races.quick.duration = 5;
  fake.races.quick.countdownMs = 2000;
  const light = await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches);
  const contexts = [];
  const rating = '#quick-match [data-quick-part="rating"]';
  const plain = (text) => text.replaceAll(' ', ' ');
  const fits = (selector) => page.locator(selector).evaluate((el) => el.scrollWidth <= el.clientWidth && document.documentElement.scrollWidth <= innerWidth);
  const cardText = (part) => page.locator(`#online-rank-card [data-rc="${part}"]`).evaluate((el) => (el.hidden ? '' : el.textContent));

  // Every line of the card fits inside it, and nothing on the page scrolls sideways.
  const unclipped = () => page.locator('#online-rank-card').evaluate((slot) => document.documentElement.scrollWidth <= innerWidth
    && [...slot.querySelectorAll('[data-rc-text]')].every((el) => el.hidden || el.scrollWidth <= el.clientWidth + 1));

  async function rival(name) {
    fake.races.quick.ratings.set(fake.addUser(`${name}@stilltype.test`).id, { ...SCENARIOS.find((s) => s.rival === name).start });
    const context = await page.context().browser().newContext({ baseURL: url, viewport: page.viewportSize(), colorScheme: light ? 'light' : 'dark', serviceWorkers: 'block' });
    contexts.push(context);
    const other = await context.newPage();
    await fake.attach(other);
    await other.goto('/');
    await other.locator('#text-display .char').first().waitFor();
    await other.locator('#account-trigger').click();
    await other.locator('#account-signin').click();
    await other.locator('#account-email-input').fill(`${name}@stilltype.test`);
    await other.locator('#account-password').fill('correct horse battery');
    await Promise.all([other.waitForEvent('load'), other.locator('#account-submit').click()]);
    await other.locator('#account[data-state="member"]').waitFor();
    await other.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Challenge' }).click();
    await other.locator('#people-setup').click();
    await other.locator('#online-name').fill(name[0].toUpperCase() + name.slice(1));
    await other.locator('#online-setup-done').click();

    return other;
  }

  try {
    fake.races.quick.ratings.set(toby.id, { ...SCENARIOS[0].start });
    await h.openApp();
    await h.signIn('toby@stilltype.test');
    await h.openView('Challenge');
    await page.locator('#people-setup').click();
    await page.locator('#online-name').fill('Toby');
    await page.locator('#online-setup-done').click();
    await page.locator(`${rating}:not([hidden])`).waitFor();
    note('rating before', await h.text(rating));
    check(plain(await h.text(rating)) === 'Gust I · 1795 · 20 rated races', 'the rating line leads with the rank');
    check(await fits(rating), 'the rating line fits without scrolling sideways');
    await shot('rating-before');

    for (const scenario of SCENARIOS) {
      fake.races.quick.ratings.set(toby.id, { ...scenario.start });
      await page.locator('#quick-match [data-quick="toggle"]').click();
      const other = await rival(scenario.rival);
      await other.locator('#quick-match [data-quick="toggle"]').click();
      await page.locator('#online-input:enabled').waitFor({ timeout: 10000 });
      await other.locator('#online-input:enabled').waitFor();
      const passage = await page.locator('#online-accessible-passage').textContent();
      const [fast, slow] = scenario.wins ? [page, other] : [other, page];
      await Promise.all([fast.keyboard.type(passage.slice(0, 60), { delay: 35 }), slow.keyboard.type(passage.slice(0, 30), { delay: 70 })]);
      await page.locator('#online-rank-card:not([hidden])').waitFor({ timeout: 20000 });
      await page.locator('#online-rank-card').scrollIntoViewIfNeeded();
      const mine = plain(await h.text('#online-rating-change'));
      note(`${scenario.name}: sentence`, mine);
      check(mine === scenario.sentence, `${scenario.name}: the status sentence says it all`);

      if (scenario.name === 'promotion') {
        await page.waitForTimeout(PROMOTION_STAGE_ONE_MS);
        note('promotion stage one ends', [await cardText('ends')]);
        await shot(`${scenario.name}-stage-one`);
      }

      await page.waitForTimeout(CARD_SETTLES_MS);
      const seen = { label: await cardText('label'), rank: await cardText('rank'), from: await cardText('from'), rating: await cardText('rating'),
        delta: await cardText('delta'), ends: await page.locator('#online-rank-card [data-rc="ends"] span').allTextContents() };

      if (scenario.card.count) seen.count = await cardText('count');
      note(`${scenario.name}: card`, seen);
      check(JSON.stringify(seen) === JSON.stringify(scenario.card), `${scenario.name}: the card reads ${JSON.stringify(scenario.card)}`);
      check(await page.locator('#online-rank-card').getAttribute('aria-hidden') === 'true', `${scenario.name}: the card is hidden from the accessibility tree`);
      check(await unclipped(), `${scenario.name}: the card fits without clipping or scrolling sideways`);
      await shot(scenario.name);

      if (scenario.theirs) {
        const theirs = plain(await other.locator('#online-rating-change').textContent());
        note(`${scenario.name}: their sentence`, theirs);
        check(theirs === scenario.theirs, 'a loss that stays in Gust I says nothing more');
        check(!(await page.locator('#online-room').textContent()).includes('1785'), 'Toby never sees Mara’s rating');
      }

      await page.locator('#online-leave').click();
      await page.locator('#online-rank-card').waitFor({ state: 'hidden' });
      check(await page.locator('#online-rank-card canvas').count() === 0, `${scenario.name}: closing the race removes the card and its wind`);
      await other.context().close();
    }

    await page.locator(rating, { hasText: '1520' }).waitFor();
    note('rating after', await h.text(rating));
    await h.settle();
    await shot('rating-after');
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
};
