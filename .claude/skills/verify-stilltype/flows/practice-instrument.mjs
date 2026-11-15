// Practice and the run card in the Instrument layout (TOB-470): idle as a guest with no runs, the "more" menu, a run
// mid-way with live metrics off and on, the first run's card, a card with history and a miss, idle with an average
// and a best, a manual drill session and the one-line tape. NAV=top puts the navigation in the top bar first.
export default async ({ page, h, shot, note, check }) => {
  const setting = async (id, value) => {
    await h.openSettings();
    await page.evaluate(([field, choice]) => document.querySelector(`#${field} input[value="${choice}"]`).click(), [id, value]);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#settings-dialog').open);
  };
  const finish = async (text) => {
    await h.type(text);
    await h.attr('body', 'data-view', 'results');
    await h.settle();
  };

  await h.openApp();

  if (process.env.NAV === 'top') await setting('navigation-select', 'top');
  await shot('idle-guest');
  check((await h.text('#live-standing')).includes('—'), 'a guest with no runs has no average or best');

  await page.locator('#mode-more-label').click();
  await h.settle();
  await shot('more-open');
  await page.locator('#mode-more-label').click();

  await h.chooseWords(10);
  let text = await h.passage();
  await h.type(text.slice(0, Math.floor(text.length / 2)));
  await shot('mid-run-live-off');
  check(!(await page.locator('#live-wpm').isVisible()), 'live metrics off hides the live wpm');
  await finish(text.slice(Math.floor(text.length / 2)));
  await shot('card-first');
  check(!(await page.locator('#result-versus').count()), 'a first run has no average to beat');

  await page.locator('#run-again').click();
  await h.attr('body', 'data-view', 'practice');
  await setting('live-toggle', 'true');
  text = await h.passage();
  const at = text.indexOf(' ') + 1;
  await h.type(text.slice(0, at) + (text[at] === 'x' ? 'z' : 'x'));
  await page.keyboard.press('Backspace');
  await h.type(text.slice(at, Math.floor(text.length / 2)));
  await shot('mid-run-live-on');
  await finish(text.slice(Math.floor(text.length / 2)));
  await shot('card-history');
  note('card', { wpm: await h.text('#result-wpm'), versus: await h.text('#result-versus'), accuracy: await h.text('#result-accuracy-fact'), range: await h.text('#result-consistency') });
  check((await h.text('#result-versus')).includes('vs avg'), 'a second run shows its change against the first');

  await page.locator('#run-again').click();
  await h.attr('body', 'data-view', 'practice');
  await shot('idle-history');
  note('standing', await h.text('#live-standing'));

  await page.locator('#mode-more-label').click();
  await page.locator('#mode-drill').click();
  await page.locator('#manual-target-input').fill('th');
  await page.locator('#apply-manual-target').click();
  await h.attr('#typing-screen', 'data-session', 'drill');
  await shot('drill');

  await page.locator('#restart-button').click();
  await h.openView('Practice');
  await page.locator('#mode-time').click();
  await setting('tape-toggle', 'true');
  text = await h.passage();
  await h.type(text.slice(0, 40));
  await shot('tape');
};
