// The footer version opens What's new: the version it names and its bullets.
export default async ({ page, h, shot, note, check }) => {
  await h.openApp();
  const trigger = page.locator('#release-trigger');
  const version = (await trigger.textContent()).trim();
  note('version', version);
  await trigger.click();
  const dialog = page.locator('#release-dialog');
  await dialog.waitFor({ state: 'visible' });
  const bullets = await dialog.locator('.release-notes li').allTextContents();
  note('bullets', bullets);
  check((await page.locator('#release-title').textContent()).trim() === version, 'the panel names the footer version');
  check(bullets.length >= 1 && bullets.length <= 6, 'six bullets at most');
  await shot('whats-new');
};
