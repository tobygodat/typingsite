// Challenge tabs, the one-keyboard race and its results, the settings dialog and the dock labels.
// Run at 1280 and 320 (--width 320 --height 568 --mobile), both schemes, with --delay 5 so both
// turns finish quickly. Notes which tabs look selected, the dock's visible words against their
// accessible names, and whether the key hints ("esc restarts.", "esc" on settings close) show.
export default async ({ page, h, shot, note, check }) => {
  await h.openApp();
  const dock = page.getByRole('navigation', { name: 'Main navigation' });
  // The visible word is the label part that has a box; the name is what assistive technology reads.
  const navs = [];
  for (const item of await dock.locator('.nav-item').all()) {
    const visible = await item.evaluate((button) => [...button.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE || node.getBoundingClientRect().width > 1)
      .map((node) => node.textContent).join('').trim());
    const name = (await item.ariaSnapshot()).match(/button "([^"]*)"/)[1];
    navs.push({ visible, name });
  }
  note('dock', navs);

  const looksSelected = () => page.locator('.challenge-modes button').evaluateAll((buttons) => buttons
    .filter((button) => getComputedStyle(button).borderTopColor !== 'rgba(0, 0, 0, 0)')
    .map((button) => button.textContent.trim()));

  await h.openView('Challenge');
  await page.locator('#challenge-friends').click();
  await h.settle();
  note('bordered tabs (friends)', await looksSelected());
  await shot('tabs-friends');

  await page.locator('#challenge-local').click();
  await page.locator('#player-one-name').fill('Ada');
  await page.locator('#player-two-name').fill('Bo');
  await page.locator('#start-local-race').click();
  await page.locator('#race-stage').waitFor();
  await h.settle();
  note('race help', { shown: await page.locator('#race-help').innerText(), pointer: await page.evaluate(() => ({ coarse: matchMedia('(any-pointer: coarse)').matches, fine: matchMedia('(any-pointer: fine)').matches })) });
  await shot('race');

  const text = await page.locator('#race-accessible-passage').textContent();
  await page.locator('#race-input').focus();
  await page.keyboard.type(text, { delay: 5 });
  await page.locator('#start-next-player').click();
  await page.waitForFunction(() => document.querySelector('#race-player')?.textContent === 'Bo' && !document.querySelector('#race-stage').hidden);
  await page.locator('#race-input').focus();
  await page.keyboard.type(text, { delay: 5 });
  await page.locator('#race-leaderboard').waitFor();
  await h.settle();
  const bordered = await looksSelected();
  note('bordered tabs (one keyboard results)', bordered);
  await shot('race-results');

  await page.mouse.move(5, 5); await page.mouse.move(40, 40);
  await page.locator('#settings-trigger').click();
  await page.locator('#settings-dialog[open]').waitFor();
  await h.settle();
  note('settings close', { text: await page.locator('#settings-close').innerText(), name: await page.locator('#settings-close').getAttribute('aria-label') });
  await shot('settings');

  // Checked last, so a failing run still leaves every screenshot.
  check(navs.every(({ visible, name }) => name.toLowerCase().includes(visible.toLowerCase())), 'each dock label is in its accessible name');
  check(bordered.join() === 'One keyboard', `only the pressed tab is bordered on the one-keyboard results (${bordered.join(', ')})`);
};
