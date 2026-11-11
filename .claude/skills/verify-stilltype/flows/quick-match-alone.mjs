// Quick match with nobody else waiting: a guest pressing it is asked to sign in; signed in, after a recorded
// 30-second run, the search says nobody is looking after 20 seconds and races that run as a ghost.
export default async ({ page, h, shot, note, check, fake }) => {
  fake.addUser('toby@stilltype.test');
  await h.openApp();
  await h.openView('Challenge');
  await page.locator('#quick-match [data-quick="toggle"]').click();
  await page.locator('#account-dialog[open]').waitFor();
  await shot('guest');
  await page.keyboard.press('Escape');
  await h.signIn('toby@stilltype.test');
  await h.openView('Practice');
  const passage = await h.passage();
  await h.type(passage.slice(0, 260));
  await h.attr('body', 'data-view', 'results', 40000);
  note('recorded run', await h.text('#result-wpm'));
  await h.openView('Challenge');
  await page.locator('#quick-match [data-quick="toggle"]').click();
  await page.locator('#quick-match [data-quick-part="lonely"]:not([hidden])').waitFor({ timeout: 30000 });
  note('nobody waiting', await h.text('#quick-match [data-quick-part="status"]'));
  await h.settle();
  await shot('nobody-waiting');
  await page.locator('#quick-match [data-quick="best"]').click();
  await h.attr('body', 'data-session', 'challenge');
  check((await h.text('#session-title')) === 'Race your best run', 'labelled as your own run');
  await shot('own-best-ready');
  const ghost = await h.passage();
  await h.type(ghost.slice(0, 120));
  await shot('own-best-racing');
  await h.attr('body', 'data-view', 'results', 40000);
  await h.settle();
  note('ghost result', await h.text('#ghost-result-heading'));
  check((await h.text('#ghost-result-status')) === 'The ghost was your own recording.', 'the result names the recording as yours');
  await shot('own-best-result');
};
