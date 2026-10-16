// Command palette: open it with Ctrl+K, find "theme · light", run it, and see the page repaint.
export default async ({ page, h, shot, note, check }) => {
  await h.openApp();
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').waitFor();
  await page.locator('#palette-input').fill('theme light');
  await h.settle();
  const options = await page.locator('#palette-list [role="option"]').allTextContents();
  note('options', options);
  check(options.some((text) => text.includes('theme · light')), 'palette lists "theme · light"');
  await shot('palette-filtered');
  await page.keyboard.press('Enter');
  await h.attr('html', 'data-theme', 'light');
  check(!(await page.locator('#palette').evaluate((dialog) => dialog.open)), 'palette closed after running the command');
  await h.settle();
  await shot('light');
};
