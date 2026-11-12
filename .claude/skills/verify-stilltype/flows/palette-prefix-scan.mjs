// Every palette label's prefixes, typed into the palette: where the top row doesn't start with the prefix while
// another label does, a fuzzy match outranked an exact prefix (TOB-448).
export default async ({ page, h, note, check }) => {
  await h.openApp();
  await page.keyboard.press('Control+k');
  const labels = await page.locator('#palette-list [role=option] .opt-text').allTextContents();
  const losses = [];

  for (const label of labels) {
    for (let n = 3; n <= Math.min(label.length, 12); n += 1) {
      const query = label.slice(0, n).toLowerCase();

      if (query.endsWith(' ')) continue;
      await page.locator('#palette-input').fill(query);
      const top = (await page.locator('#palette-list [aria-selected="true"] .opt-text').textContent()) || '';

      if (!top.toLowerCase().startsWith(query)) losses.push({ query, top, wanted: label });
    }
  }

  note('labels', labels.length);
  note('losses', losses);
  check(losses.length === 0, `an exact prefix always ranks first (${losses.length} losses)`);
};
