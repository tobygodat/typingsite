// The learner lets go (TOB-419, ADR 0013): signed in at words 50, twenty runs missing every "th", then sixty
// clean runs, the last fifteen missing every "he". Train names "th" after the first twenty and "he" at the end,
// where learner@1, which weighs every run alike, would still name "th". Typed at machine speed, so the runs are
// untimed and only misses count. Run with --signed-in --delay 0 at 1440×900.
import { LEARNER_POLICY, LEARNER_VARIANTS, fitLearner, learnerEvidence, learnerRecommendation } from '../../../../src/learner.js';

export default async ({ page, h, shot, note, check, fake }) => {
  const missing = async (pair) => {
    const text = await h.passage();
    await page.locator('#typing-input').focus();
    let from = 0;

    for (let at = pair ? text.indexOf(pair) + 1 : 0; pair && at > 0; at = text.indexOf(pair, at) + 1) {
      await page.keyboard.type(text.slice(from, at));
      await page.keyboard.type('x');
      await page.keyboard.press('Backspace');
      from = at;
    }

    await page.keyboard.type(text.slice(from));
    await h.attr('body', 'data-view', 'results');
    await page.locator('#run-again').click();
    await h.attr('body', 'data-view', 'practice');
  };

  await h.openApp();
  await h.chooseWords(50);

  for (let run = 0; run < 20; run += 1) await missing('th');
  await h.openView('Train');
  await h.settle();
  note('train after 20 runs missing th', await page.locator('#train-next').innerText());
  check((await h.text('#train-heading')) === 'Practice “th”', 'Train names "th" while it is being missed');
  await shot('train-th-missed');

  await h.openView('Practice');

  for (let run = 0; run < 60; run += 1) await missing(run >= 45 ? 'he' : null);
  await h.openView('Train');
  await h.settle();
  note('train after 60 more runs, th clean, he missed in the last 15', await page.locator('#train-next').innerText());
  check((await h.text('#train-heading')) === 'Practice “he”', 'Train lets go of "th" and names "he"');
  await shot('train-th-let-go');

  // The synced profile, once the fake backend holds all eighty runs.
  const stored = () => fake.profileFor('verify@stilltype.test')?.runs || [];

  for (let wait = 0; wait < 40 && stored().length < 80; wait += 1) await page.waitForTimeout(250);
  const runs = stored();
  const plain = learnerRecommendation(fitLearner(learnerEvidence(runs, 'physical-keyboard:qwerty'), Date.now(), LEARNER_VARIANTS[LEARNER_POLICY]));
  note('stored runs', runs.length);
  note('learner@1 on the same stored runs', `${plain.title}: ${plain.reason}`);
  check(plain.target === 'th', 'without decay the same runs still name "th"');
};
