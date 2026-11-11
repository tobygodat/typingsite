// A quick match started while Train's work waits, from Toby's side: a drill offered on the results card, then a
// rated match with Mara and what Train and Practice show after it; the same drill when nobody is waiting and Toby
// races his own best run; and a 15-second drill's retest waiting through another rated match. A control first
// visits Challenge and comes back with no match, so a change the match causes is told apart from leaving Practice.
import path from 'node:path';

export default async ({ page, h, shot, note, check, fake, url }) => {
  fake.addUser('toby@stilltype.test');
  fake.addUser('mara@stilltype.test');
  const light = await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches);
  const context = await page.context().browser().newContext({ baseURL: url, viewport: page.viewportSize(), colorScheme: light ? 'light' : 'dark', serviceWorkers: 'block' });
  const mara = await context.newPage();
  const other = async (name) => { if (process.env.QUICK_MATCH_OTHER) await mara.screenshot({ path: path.join(process.env.QUICK_MATCH_OTHER, `mara.${name}.png`) }); };
  await fake.attach(mara);

  const state = async (label) => {
    const seen = {
      view: await page.locator('body').getAttribute('data-view'),
      session: await page.locator('body').getAttribute('data-session'),
      kicker: await h.text('#session-kicker'),
      title: await h.text('#session-title'),
    };
    note(label, seen);

    return seen;
  };

  const train = async (label) => {
    await h.openView('Train');
    await h.settle();
    const seen = { heading: await h.text('#train-heading'), button: await h.text('#start-drill') };
    note(label, seen);

    return seen;
  };

  const quickMatch = async (name) => {
    await h.openView('Challenge');
    await page.locator('#people-setup').click();
    await page.locator('#online-name').fill('Toby');
    await page.locator('#online-setup-done').click();
    await page.locator('#quick-match [data-quick="toggle"]').click();
    await mara.locator('#quick-match [data-quick="toggle"]').click();
    await page.locator('#online-room-status', { hasText: 'Matched with Mara.' }).waitFor({ timeout: 10000 });
    await page.locator('#online-input:enabled').waitFor({ timeout: 10000 });
    await mara.locator('#online-input:enabled').waitFor();
    const passage = await page.locator('#online-accessible-passage').textContent();
    await Promise.all([page.keyboard.type(passage.slice(0, 200), { delay: 110 }), mara.keyboard.type(passage.slice(0, 150), { delay: 150 })]);
    await page.locator('#online-rating-change:not([hidden])').waitFor({ timeout: 40000 });
    await h.settle();
    note(`${name} rating change`, await h.text('#online-rating-change'));
    check(await page.locator('#result-drill').isHidden(), `${name}: the race offers no drill`);
    await shot(`${name}-result`);
    await other(`${name}-result`);
    await page.locator('#online-leave').click();
    await mara.locator('#online-leave').click();
  };

  try {
    await h.openApp();
    await h.signIn('toby@stilltype.test');
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

    await h.openView('Practice');
    await h.type((await h.passage()).slice(0, 260));
    await h.attr('body', 'data-view', 'results', 40000);
    note('recorded run', await h.text('#result-wpm'));
    note('results card offers', await h.text('#result-drill'));

    // Control: the drill waits, Toby visits Challenge, and comes back with no match.
    await page.locator('#result-drill').click();
    await h.attr('body', 'data-session', 'drill');
    const waiting = await state('drill waiting');
    await shot('drill-waiting');
    await h.openView('Challenge');
    await h.openView('Practice');
    const control = await state('control: back on Practice with no match');
    const controlTrain = await train('control: Train with no match');
    await shot('control-train');

    // A rated quick match while the drill waits.
    await train('before the live match');
    await page.locator('#start-drill').click();
    await h.attr('body', 'data-session', 'drill');
    await state('drill waiting again');
    await quickMatch('live');
    const afterLiveTrain = await train('after the live match: Train');
    await shot('after-live-train');
    await h.openView('Practice');
    const afterLive = await state('after the live match: Practice');
    await shot('after-live-practice');
    check(afterLive.session === control.session && afterLive.title === control.title, 'Practice after a live match is as after the control');
    check(afterLiveTrain.heading === controlTrain.heading, 'Train still names the same target after a live match');

    // Nobody waiting: the drill waits and Toby races his own best run.
    await train('before the own-best race');
    await page.locator('#start-drill').click();
    await h.attr('body', 'data-session', 'drill');
    await state('drill waiting before the own-best race');
    await h.openView('Challenge');
    await page.locator('#quick-match [data-quick="toggle"]').click();
    await page.locator('#quick-match [data-quick-part="lonely"]:not([hidden])').waitFor({ timeout: 30000 });
    await page.locator('#quick-match [data-quick="best"]').click();
    await h.attr('body', 'data-session', 'challenge');
    await state('own-best race ready');
    await shot('own-best-ready');
    await h.type((await h.passage()).slice(0, 120));
    await h.attr('body', 'data-view', 'results', 40000);
    await h.settle();
    check(await page.locator('#result-drill').isHidden(), 'the own-best result offers no drill');
    note('own-best result', await h.text('#ghost-result-heading'));
    await shot('own-best-result');
    const afterOwnTrain = await train('after the own-best race: Train');
    await shot('after-own-train');
    await h.openView('Practice');
    await state('after the own-best race: Practice');

    // A 15-second drill done, its retest waiting, then a rated match.
    await h.openSettings('practice');
    await page.locator('#drill-length input[value="15"]').locator('..').click();
    await page.locator('#settings-done').click();
    await train('15-second drill');
    await page.locator('#start-drill').click();
    await h.attr('body', 'data-session', 'drill');
    check((await h.text('#session-kicker')) === 'drill · 15 s', 'the drill is 15 seconds');
    await page.locator('#typing-input').focus();
    await page.keyboard.type((await h.passage()).slice(0, 8), { delay: 40 });
    await page.waitForTimeout(15500);
    await h.attr('body', 'data-session', 'retest');
    const retest = await state('retest waiting');
    await shot('retest-waiting');
    await quickMatch('retest-live');
    await h.openView('Practice');
    const afterRetest = await state('after a live match with a retest waiting: Practice');
    await shot('after-retest-practice');
    await train('after a live match with a retest waiting: Train');
    await shot('after-retest-train');
    note('summary', { waiting, control, afterLive, afterOwnTrain, retest, afterRetest });
  } finally {
    await context.close();
  }
};
