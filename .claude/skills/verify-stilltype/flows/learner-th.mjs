// The TOB-419 check's reproduction, as a guest at words 100: three passages typed missing the second letter of
// every "th", then Train, its drill, the fresh retest and the comparison. Every miss on "h" is inside "th", so
// nothing may offer "h". Run at 1440×900.
export default async ({ page, h, shot, note, check }) => {
  // Types the passage with a wrong first try, then the right letter, on the second letter of every "th".
  const typeMissingTh = async () => {
    const text = await h.passage();
    await page.locator('#typing-input').focus();
    let from = 0;

    for (let at = text.indexOf('th') + 1; at > 0; at = text.indexOf('th', at) + 1) {
      await page.keyboard.type(text.slice(from, at));
      await page.keyboard.type('x');
      await page.keyboard.press('Backspace');
      from = at;
    }

    await page.keyboard.type(text.slice(from));
    await h.attr('body', 'data-view', 'results');
  };

  await h.openApp();
  await h.chooseWords(100);

  for (let run = 0; run < 3; run += 1) {
    if (run) {
      await page.locator('#run-again').click();
      await h.attr('body', 'data-view', 'practice');
    }

    await typeMissingTh();
  }

  await h.settle();
  note('result actions', await page.locator('.result-actions').innerText());
  await shot('results-third-run');

  await h.openView('Train');
  await h.settle();
  note('train', await page.locator('#train-next').innerText());
  check((await h.text('#train-heading')) === 'Practice “th”', 'Train names "th"');
  await shot('train-with-history');

  await page.locator('#start-drill').click();
  await h.attr('#typing-screen', 'data-session', 'drill');
  check((await h.passage()).split(' ').every((word) => word.includes('th')), 'the drill is "th" words');
  await shot('drill-th');
  await page.clock.install();
  await page.locator('#typing-input').focus();
  await page.keyboard.type((await h.passage()).slice(0, 12));
  await page.clock.fastForward(31_000);
  await h.attr('#typing-screen', 'data-session', 'retest');
  await page.locator('#typing-input').focus();
  await page.keyboard.type(await h.passage());
  await h.attr('body', 'data-view', 'train');
  await h.settle();
  const comparison = await page.locator('#comparison-panel').innerText();
  note('comparison', comparison);
  check((await h.text('#comparison-target-label')) === 'th missed', 'the comparison reads back "th"');
  check(await page.locator('#comparison-next').isHidden(), 'no Next: the queue holds only "th", just drilled');
  check(!comparison.includes('“h”'), 'nothing offers "h"');
  await shot('comparison');
};
