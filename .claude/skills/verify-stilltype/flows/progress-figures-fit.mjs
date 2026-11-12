// Practice figures at their widest likely values (999 runs started, 412 finished, 999 min typing), from a
// signed-in account row: every figure's numeral and unit stay inside its own column. Run at several widths.
export default async ({ page, h, shot, note, check, fake }) => {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const user = fake.addUser('figures@stilltype.test');
  fake.profiles.set(user.id, { data: { version: 2, preferences: {}, attempts: [], runs: [], loops: [], seenTextIds: [], bests: {},
    practiceDays: { [today]: 999 * 60000 }, runCounts: { verify: { [today]: [999, 412] } }, updatedAt: d.toISOString() } });
  await h.openApp();
  await h.signIn(user.email);
  await h.openView('Progress');
  await page.locator('[data-progress-open="calendar"]').click();
  await page.locator('#practice-stats .progress-figure').first().waitFor();
  await h.settle();
  const layout = await page.locator('#practice-stats').evaluate((list) => ({
    columns: getComputedStyle(list).gridTemplateColumns.split(' ').length,
    rows: new Set([...list.children].map((figure) => Math.round(figure.getBoundingClientRect().top))).size,
    overflow: [...list.children].flatMap((figure) => {
      const box = figure.getBoundingClientRect();
      return [...figure.querySelectorAll('dd, dd *')].filter((part) => part.getBoundingClientRect().right > box.right + 0.5)
        .map((part) => `${figure.querySelector('dt').textContent}: "${part.textContent}" ends ${Math.round(part.getBoundingClientRect().right - box.right)}px past its column`);
    }),
    pageScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    wrapped: [...list.querySelectorAll('.figure-value')].filter((value) => value.children.length > 1
      && value.lastElementChild.getBoundingClientRect().top > value.firstElementChild.getBoundingClientRect().bottom - 1)
      .map((value) => value.closest('.progress-figure').querySelector('dt').textContent),
  }));
  note('layout', layout);
  note('practice figures', await page.locator('#practice-stats').innerText());
  check(layout.overflow.length === 0, `no figure overflows its column (${layout.overflow.join('; ') || 'none'})`);
  check(!layout.pageScrolls, 'the page does not scroll sideways');
  await page.locator('#practice-stats').scrollIntoViewIfNeeded();
  await shot('practice-figures');
};
