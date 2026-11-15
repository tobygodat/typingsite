// Train in the Instrument layout (TOB-470): the queue, the drilled fold and the chosen step. A new guest, one short run
// (the general drill), then an account whose history another device synced: the slow pair open, a missed unit chosen,
// the fold open with a drilled and a fixed step, a drilled step chosen, a drill under way and the comparison after its
// retest. TRAIN_NAV=top runs it under the top bar. Run with --delay 40.
import { history } from './train-path.mjs';

export default async ({ page, h, shot, note, check, fake }) => {
  const palette = async (label) => {
    await page.keyboard.press('Control+k');
    await page.locator('#palette-input').fill(label);
    await page.locator('#palette-list [role="option"]', { hasText: label }).first().click();
  };

  const rows = () => page.locator('.queue-step:not([hidden])').evaluateAll((items) => items.map((item) => item.querySelector('.q-row')?.innerText.replace(/\s+/g, ' ').trim()));

  await h.openApp();

  if (process.env.TRAIN_NAV === 'top') await palette('navigation · top bar');
  await h.openView('Train');
  await h.settle();
  check((await h.text('#train-heading')) === 'General drill', 'a new guest is offered the general drill');
  check(await page.locator('#start-drill').isVisible(), 'the general drill can be started');
  await shot('guest');

  await h.openView('Practice');
  await h.chooseWords(10);
  await h.type(await h.passage());
  await h.attr('body', 'data-view', 'results');
  await h.openView('Train');
  await h.settle();
  check((await h.text('#start-drill')) === 'Drill and retest', 'one short run: a general drill with a retest');
  await shot('general');

  const user = fake.addUser('instrument@stilltype.test');
  fake.profiles.set(user.id, { data: history() });
  await h.signIn('instrument@stilltype.test');
  await h.attr('#account', 'data-sync', 'synced');

  // Signing in takes the account's preferences, the side bar among them.
  if (process.env.TRAIN_NAV === 'top') await palette('navigation · top bar');
  await h.openView('Practice');
  await h.chooseWords(10);
  await h.type(await h.passage());
  await h.attr('body', 'data-view', 'results');
  await h.openView('Train');
  await h.settle();
  note('queue', JSON.stringify(await rows()));
  check((await h.text('#train-unit')) === 'th', 'the slow pair is open');
  check(await page.locator('.timing-plot').isVisible(), 'the slow pair has its timings');
  await shot('queue-slow');

  await page.locator('.queue-step[data-unit="an"] .q-row').click();
  check((await h.text('.train-step-unit')) === 'an', 'a missed unit chosen');
  await shot('missed');

  await page.locator('#train-drilled-toggle').click();
  note('fold', JSON.stringify(await rows()));
  check((await page.locator('#train-drilled .is-fixed').count()) >= 1 && (await page.locator('#train-drilled .is-drilled').count()) >= 1, 'a fixed and a drilled step');
  await shot('drilled-open');

  await page.locator('#train-drilled .is-fixed .q-row').first().click();
  await shot('drilled-chosen');

  await palette('drill length · 15 seconds');
  await h.openView('Practice');
  await h.openView('Train');
  await page.locator('#start-drill').click();
  await h.attr('#typing-screen', 'data-session', 'drill');
  await page.locator('#typing-input').focus();
  await page.keyboard.type((await h.passage()).slice(0, 12), { delay: 60 });
  await shot('mid-drill');
  await page.waitForTimeout(15_500);
  await h.attr('#typing-screen', 'data-session', 'retest');
  await h.type(await h.passage());
  await h.attr('body', 'data-view', 'train');
  await h.settle();
  check(await page.locator('#comparison-panel').isVisible(), 'the comparison shows');
  check((await h.text('#comparison-unit')) === 'th', 'the step just drilled is the comparison');
  note('focus after retest', await page.evaluate(() => document.activeElement.id));
  await shot('comparison');
};
