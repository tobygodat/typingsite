// A pair typed slowly but never missed (TOB-419, ADR 0013): signed in at words 100, two passages typed at a
// human pace with a 150 ms pause before the "h" of every "th". Train names "th" on its observed timing; the
// drill, a real 30 seconds, and the fresh retest at an even pace; the comparison and Progress read its pace
// back. Run with --signed-in --delay 40 at 1440×900.
export default async ({ page, h, shot, note, check, fake }) => {
  const typeSlowTh = async () => {
    const text = await h.passage();
    await page.locator('#typing-input').focus();
    let from = 0;

    for (let at = text.indexOf('th') + 1; at > 0; at = text.indexOf('th', at) + 1) {
      await page.keyboard.type(text.slice(from, at), { delay: 40 });
      await page.waitForTimeout(150);
      from = at;
    }

    await page.keyboard.type(text.slice(from), { delay: 40 });
    await h.attr('body', 'data-view', 'results');
  };

  await h.openApp();
  await h.chooseWords(100);

  for (let run = 0; run < 2; run += 1) {
    if (run) {
      await page.locator('#run-again').click();
      await h.attr('body', 'data-view', 'practice');
    }

    await typeSlowTh();
  }

  note('accuracy of the second run', await h.text('#result-accuracy'));
  check((await h.text('#result-accuracy')) === '100', 'never missed');
  await h.openView('Train');
  await h.settle();
  note('train', await page.locator('#train-next').innerText());
  check((await h.text('#train-heading')) === 'Practice “th”', 'Train names "th"');
  check(/^\d+ ms slower than your pace, in 2 of 2 runs that timed it \(\d+ clean intervals\)$/.test(await h.text('#train-evidence')), 'its evidence is observed timing');
  await shot('train-slow-th');

  await page.locator('#start-drill').click();
  await h.attr('#typing-screen', 'data-session', 'drill');
  check((await h.passage()).split(' ').every((word) => word.includes('th')), 'the drill is "th" words');
  await shot('drill-th');
  await page.locator('#typing-input').focus();
  await page.keyboard.type((await h.passage()).slice(0, 12), { delay: 40 });
  await page.waitForTimeout(30_000);
  await h.attr('#typing-screen', 'data-session', 'retest');
  await h.type(await h.passage());
  await h.attr('body', 'data-view', 'train');
  await h.settle();
  note('comparison', await page.locator('#comparison-panel').innerText());
  check((await h.text('#comparison-target-label')) === 'th pace', 'the comparison reads back the pace of "th"');
  await shot('comparison-pace');

  // The synced loop, once the fake backend holds it.
  const loops = () => fake.profileFor('verify@stilltype.test')?.loops || [];

  for (let wait = 0; wait < 40 && !loops().length; wait += 1) await page.waitForTimeout(250);
  const loop = loops().at(-1);
  note('saved loop', JSON.stringify({ policy: loop.policy, target: loop.target, targetPace: loop.targetPace }));
  check(loop.targetPace?.target === 'th', 'the loop saves the pace before and after');
  await h.openView('Progress');
  await h.settle();
  await page.locator('.history-conditions').first().scrollIntoViewIfNeeded();
  note('progress row', await page.locator('.history-conditions').first().innerText());
  check((await page.locator('.history-conditions').first().innerText()).includes('th '), 'Progress reads the pace back');
  await shot('progress-pace');
};
