// Race setup on Challenge: the race name and the practice controls a race starts from, on the practice setup,
// then changed to a timed race with Match practice offered.
export default async ({ page, h, shot, check, fake }) => {
  fake.addUser('toby@stilltype.test');
  await h.openApp();
  await h.signIn('toby@stilltype.test');
  await h.openView('Challenge');
  await page.locator('#people-setup').click();
  await page.locator('#online-options [data-race-modes]').waitFor();
  await page.locator('#online-name').fill('toby');
  check(await page.locator('#online-options [aria-pressed="true"]').count() === 2, 'a mode and a length are picked');
  await h.settle();
  await shot('setup-practice');
  await page.locator('#online-options [data-mode="time"]').click();
  check(await page.locator('#online-customize-reset').isVisible(), 'Match practice is offered once the setup differs');
  await h.settle();
  await shot('setup-changed');
};
