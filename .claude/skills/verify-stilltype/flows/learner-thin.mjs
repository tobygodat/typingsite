// The second TOB-419 check's common case: a guest at words 100 types one passage missing the second letter of
// every "th", with a 400 ms pause before the "e" of every "he" outside "the". "he" ranks first on too few clean
// intervals to name, and "th" below it is missed on most first tries. Train, the results card's Drill action and
// the drill name "th" with its real counts. Run with --signed-in --seed 11 at 1440×900.
import { fitLearner, learnerEvidence } from '../../../../src/learner.js';

export default async ({ page, h, shot, note, check, fake }) => {
  await h.openApp();
  await h.chooseWords(100);
  const text = await h.passage();
  await page.locator('#typing-input').focus();
  let from = 0;

  for (let at = 1; at < text.length; at += 1) {
    const th = text.slice(at - 1, at + 1) === 'th';
    const he = text.slice(at - 1, at + 1) === 'he' && text[at - 2] !== 't';

    if (!th && !he) continue;
    await page.keyboard.type(text.slice(from, at), { delay: 60 });

    if (th) {
      await page.keyboard.type('x');
      await page.keyboard.press('Backspace');
    } else await page.waitForTimeout(400);
    from = at;
  }

  await page.keyboard.type(text.slice(from), { delay: 60 });
  await h.attr('body', 'data-view', 'results');
  await h.settle();
  const runs = () => fake.profileFor('verify@stilltype.test')?.runs || [];

  for (let wait = 0; wait < 40 && !runs().length; wait += 1) await page.waitForTimeout(250);
  const model = fitLearner(learnerEvidence(runs(), 'physical-keyboard:qwerty'), Date.now());
  const top = model.units[0];
  const th = model.units.find((e) => e.unit === 'th').observed;
  note('top of the ranking', JSON.stringify(model.units.slice(0, 3).map((e) => ({ unit: e.unit, basis: e.basis, tries: e.observed.seen, errors: e.observed.errors, intervals: e.observed.timed }))));
  check(top.unit === 'he' && top.basis === 'slow' && top.observed.timed < 10, '"he" ranks first on too few intervals to name');
  note('result actions', await page.locator('.result-actions').innerText());
  check((await h.text('#result-drill')) === 'Drill “th”', 'the results card drills "th"');
  await shot('results-thin-he');

  await h.openView('Train');
  await h.settle();
  note('train', await page.locator('#train-next').innerText());
  check((await h.text('#train-heading')) === 'Practice “th”', 'Train names "th"');
  check((await h.text('#train-evidence')) === `${th.errors} of ${th.seen} missed in 1 run`, 'with its real counts');
  await shot('train-names-th');
};
