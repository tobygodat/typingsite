// The second TOB-419 check's finding A, at its own numbers: signed in at words 100, two passages at 60 ms a key
// with "th" 40 ms late, then one at 400 ms a key with "th" 250 ms early. "th" ranks on its slowness, but the
// figure the page prints says it is faster, so Train never names it "slower". Run with --signed-in --seed 4242
// at 1440×900.
import { fitLearner, learnerEvidence } from '../../../../src/learner.js';

export default async ({ page, h, shot, note, check, fake }) => {
  // Each key `pace` ms after the last, and the "h" of every "th" `thMs` after its "t". Playwright waits its delay
  // after every key, the last included, so the "t" goes on its own.
  const typePaced = async (pace, thMs) => {
    const text = await h.passage();
    await page.locator('#typing-input').focus();
    let from = 0;

    for (let at = text.indexOf('th') + 1; at > 0; at = text.indexOf('th', at) + 1) {
      await page.keyboard.type(text.slice(from, at - 1), { delay: pace });
      await page.keyboard.type(text[at - 1]);
      await page.waitForTimeout(thMs);
      from = at;
    }

    await page.keyboard.type(text.slice(from), { delay: pace });
    await h.attr('body', 'data-view', 'results', 60_000);
  };

  await h.openApp();
  await h.chooseWords(100);

  for (const [run, [pace, thMs]] of [[60, 100], [60, 100], [400, 150]].entries()) {
    if (run) {
      await page.locator('#run-again').click();
      await h.attr('body', 'data-view', 'practice');
    }

    await typePaced(pace, thMs);
  }

  const runs = () => fake.profileFor('verify@stilltype.test')?.runs || [];

  for (let wait = 0; wait < 40 && runs().length < 3; wait += 1) await page.waitForTimeout(250);
  note('th per run [pair, tries, errors, intervals, median ms, ms over the run]', JSON.stringify(runs().map((run) => run.patterns.find((row) => row[0] === 'th'))));
  const th = fitLearner(learnerEvidence(runs(), 'physical-keyboard:qwerty'), Date.now()).units.find((e) => e.unit === 'th');
  note('th as the learner sees it', JSON.stringify({ basis: th.basis, logRatio: th.slowdown, printedMs: Math.round(th.observed.slowMs), slowRuns: th.observed.slowRuns, timedRuns: th.observed.timedRuns, timed: th.observed.timed }));
  check(th.basis === 'slow' && th.slowdown > 0, '"th" ranks on its slowness (mean log ratio above none)');
  check(Math.round(th.observed.slowMs) <= 20, 'its printed figure is not past the 20 ms floor');

  await h.openView('Train');
  await h.settle();
  const train = await page.locator('#train-next').innerText();
  note('train', train);
  check(!/-\d+ ms|\b0 ms slower/.test(train), 'no negative or zero figure is printed as slower');
  check((await h.text('#train-heading')) !== 'Practice “th”', 'Train does not name "th" for slowness');
  await shot('train-faster-th');
};
