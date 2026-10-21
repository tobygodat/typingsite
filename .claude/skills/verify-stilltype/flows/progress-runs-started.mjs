// Runs started: one finished run, one restarted mid-run (Escape) and one abandoned for Progress, then the
// Practice tab's figures. Runs started reads 3, with 1 finished.
export default async ({ page, h, shot, note, check }) => {
  await h.openApp();
  await h.chooseWords(10);
  await h.type(await h.passage());
  await h.attr('body', 'data-view', 'results');
  await page.keyboard.press('Enter');
  await h.attr('body', 'data-view', 'practice');
  await h.type((await h.passage()).slice(0, 8));
  await h.attr('body', 'data-running', 'true');
  await page.keyboard.press('Escape');
  await h.attr('body', 'data-running', 'false');
  await h.type((await h.passage()).slice(0, 8));
  await h.attr('body', 'data-running', 'true');
  await h.openView('Progress');
  await page.getByRole('tab', { name: 'Practice' }).click();
  await h.settle();
  const figures = await page.locator('#practice-stats').innerText();
  note('practice figures', figures);
  await page.locator('#practice-stats').scrollIntoViewIfNeeded();
  await shot('progress-practice');
};
