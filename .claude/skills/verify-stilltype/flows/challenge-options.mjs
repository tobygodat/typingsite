// The Challenge page's Challenge and Customize: the default, then Customize open on the practice setup.
// On a build without Customize it stops after the first shot, which makes it the "before".
export default async ({ page, h, shot, check, fake }) => {
  fake.addUser('toby@stilltype.test');
  await h.openApp();
  await h.signIn('toby@stilltype.test');
  await h.openView('Challenge');
  await page.locator('#online-name').fill('toby');
  await h.settle();
  await shot('challenge');
  if (!(await page.locator('#online-customize').count())) return;
  await page.locator('#online-customize').click();
  await page.locator('#online-options:not([hidden])').waitFor();
  check(await page.locator('#online-options [aria-pressed="true"]').count() === 2, 'a mode and a length are picked');
  await h.settle();
  await shot('customize-open');
};
