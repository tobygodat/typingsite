// Practice end to end: words 10, the passage typed, the results card (wpm, accuracy, time, the speed trace), then Run
// again starts a fresh passage.
export default async ({ page, h, shot, note, check }) => {
  await h.openApp();
  await h.chooseWords(10);
  const first = await h.passage();
  await h.type(first);
  await h.attr('body', 'data-view', 'results');
  await h.settle();
  note('results', { wpm: await h.text('#result-wpm'), accuracy: await h.text('#result-accuracy'), time: await h.text('#result-time') });
  check(await page.locator('#speed-graph svg').isVisible(), 'the speed trace shows');
  await shot('results');
  await page.locator('#run-again').click();
  await h.attr('body', 'data-view', 'practice');
  const next = await h.passage();
  check(next !== first, 'Run again starts a fresh passage');
  await shot('run-again');
};
