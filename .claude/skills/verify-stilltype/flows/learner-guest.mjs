// A brand-new guest and the learner (TOB-419): Train with no runs is a general drill leaning toward the prior's
// top units; Practice at 10 words gives the run card and Run again a fresh passage; then Train's general drill,
// its fresh retest and the comparison. Run at 1440×900.
export default async ({ page, h, shot, note, check }) => {
  await h.openApp();
  await h.openView('Train');
  await h.settle();
  check((await h.text('#train-heading')) === 'General drill', 'a new guest is offered a general drill');
  check(await page.locator('#train-evidence').isHidden(), 'no evidence line without evidence');
  await shot('train-new-guest');

  await page.locator('#start-drill').click();
  await h.attr('#typing-screen', 'data-session', 'drill');
  note('leaning drill words', (await h.passage()).split(' ').slice(0, 24).join(' '));
  await shot('drill-new-guest');

  await h.openView('Practice');
  await h.chooseWords(10);
  const first = await h.passage();
  await shot('practice-ready');
  await h.type(first);
  await h.attr('body', 'data-view', 'results');
  await h.settle();
  note('wpm', await h.text('#result-wpm'));
  note('accuracy', await h.text('#result-accuracy'));
  note('time', await h.text('#result-time'));
  check(await page.locator('#speed-graph svg, #speed-graph canvas').first().isVisible(), 'the speed trace shows');
  check((await h.text('#result-drill')) === 'Drill and retest', 'one clean run names no target');
  await shot('results-card');

  await page.locator('#run-again').click();
  await h.attr('body', 'data-view', 'practice');
  check((await h.passage()) !== first, 'Run again starts a fresh passage');
  await shot('run-again');

  await h.openView('Train');
  await h.settle();
  check((await h.text('#train-heading')) === 'General drill', 'still a general drill after one clean run');
  await shot('train-after-one-run');
  await page.locator('#start-drill').click();
  await h.attr('#typing-screen', 'data-session', 'drill');
  await page.clock.install();
  await page.locator('#typing-input').focus();
  await page.keyboard.type((await h.passage()).slice(0, 12), { delay: 120 });
  await page.clock.fastForward(31_000);
  await h.attr('#typing-screen', 'data-session', 'retest');
  const retest = await h.passage();
  check(retest !== first, 'the retest is fresh text');
  await h.type(retest);
  await h.attr('body', 'data-view', 'train');
  await h.settle();
  note('comparison', await page.locator('#comparison-panel').innerText());
  check(await page.locator('#comparison-panel').isVisible(), 'the comparison shows');
  await shot('comparison');
};
