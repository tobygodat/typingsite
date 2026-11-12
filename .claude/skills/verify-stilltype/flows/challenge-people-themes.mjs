// Challenge's people list in every built-in theme: an invitation, a ghost waiting, a finished ghost race and a
// tally, with keyboard focus on a row's action. Shots: <theme>-people.
const MODES = { dark: ['dark', 'terminal', 'midnight', 'nord'], light: ['light', 'paper', 'shadcn', 'soft', 'swiss', 'e-ink'] };
const PASSAGE = 'The quick brown fox jumps over the lazy dog.';
const trace = (step) => ({ v: 1, k: PASSAGE, t: [...PASSAGE].map((_, index) => (index ? step : 0)), e: step * (PASSAGE.length - 1) });

export default async ({ page, h, shot, check, fake }) => {
  const toby = fake.addUser('toby@stilltype.test');
  const [maya, sam, lena] = ['maya', 'sam', 'lena'].map((name) => fake.addUser(`${name}@stilltype.test`));
  fake.races.addFriend(toby.id, { name: 'Maya Okafor', friendId: maya.id });
  fake.races.addFriend(toby.id, { name: 'Sam Achebe', friendId: sam.id });
  fake.races.addFriend(toby.id, { name: 'Lena Ortiz', friendId: lena.id });
  fake.races.tallies.set([toby.id, sam.id].sort().join(':'), toby.id < sam.id ? [2, 1] : [1, 2]);
  fake.challenges.seed(maya.id, toby.id, { name: 'Maya', label: 'Toby', passage: PASSAGE, trace: trace(150) });
  const done = fake.challenges.seed(toby.id, sam.id, { name: 'Toby', label: 'Sam', passage: PASSAGE, trace: trace(140), createdAt: Date.now() - 3 * 86400000 });
  Object.assign(done, { result: { wpm: 70, accuracy: 98, elapsedMs: 9000, correct: PASSAGE.length }, completedAt: new Date(Date.now() - 2 * 86400000).toISOString() });
  fake.races.invite(lena.id, toby.id, { name: 'Lena', ageMs: 180000 });
  await h.openApp();
  await h.signIn('toby@stilltype.test');

  for (const [mode, theme] of Object.entries(MODES).flatMap(([name, themes]) => themes.map((one) => [name, one]))) {
    await h.openSettings('appearance');
    await page.locator(`#theme-select input[value="${mode}"]`).locator('..').click();
    await page.locator(`#${mode}-theme input[value="${theme}"]`).locator('..').click();
    await h.attr('html', 'data-theme', theme);
    await page.keyboard.press('Escape');
    await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
    await h.openView('Challenge');
    await page.locator('.people-tally').first().waitFor();
    await page.getByRole('button', { name: 'Race Sam Achebe' }).focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    check(await page.locator('#people-list .people-row').count() === 3, `${theme}: three rows`);
    await h.settle();
    await shot(`${theme}-people`);
  }
};
