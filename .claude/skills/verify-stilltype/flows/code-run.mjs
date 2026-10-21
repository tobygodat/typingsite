// Code mode: pick it from "more", choose python, type the snippet, and read the run card's conditions.
export default async ({ page, h, shot, note, check }) => {
  await h.openApp();
  await h.chooseMore('mode-code');
  await page.locator('#code-options [data-language="python"]').click();
  await page.waitForFunction(() => document.querySelector('#condition-line')?.textContent.includes('code · python'));
  check(await page.locator('#mode-more-label').textContent() === 'code', '"more" is renamed to the chosen mode');
  await shot('code-ready');
  const text = await h.passage();
  await h.type(text);
  await h.attr('body', 'data-view', 'results');
  await h.settle();
  const conditions = await h.text('#result-conditions');
  note('result', { wpm: await h.text('#result-wpm'), accuracy: await h.text('#result-accuracy'), conditions });
  check(conditions.includes('python'), `run card conditions name python (${conditions})`);
  await shot('code-results');
};
