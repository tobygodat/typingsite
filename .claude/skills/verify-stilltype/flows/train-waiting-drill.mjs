// A drill left waiting on Practice while another screen opens: Train, Progress and Challenge each, then the dock's
// Practice. The drill should still be the session waiting when Practice shows again (TOB-448).
export default async ({ page, h, shot, note, check }) => {
  await h.openApp();
  await h.chooseWords(10);
  await h.type(await h.passage());
  await h.attr('body', 'data-view', 'results');

  const state = async (label) => {
    const seen = { view: await page.locator('body').getAttribute('data-view'), session: await page.locator('body').getAttribute('data-session'),
      kicker: await h.text('#session-kicker'), passage: (await h.passage()).slice(0, 40) };
    note(label, seen);

    return seen;
  };

  for (const away of ['Train', 'Progress', 'Challenge']) {
    await h.openView('Train');
    await page.locator('#start-drill').click();
    await h.attr('body', 'data-session', 'drill');
    const waiting = await state(`drill waiting before ${away}`);
    await shot(`waiting-${away.toLowerCase()}`);
    await h.openView(away);
    await h.openView('Practice');
    const back = await state(`back on Practice after ${away}`);
    await shot(`back-${away.toLowerCase()}`);
    check(back.session === 'drill' && back.passage === waiting.passage, `the drill still waits after ${away}`);
  }
};
