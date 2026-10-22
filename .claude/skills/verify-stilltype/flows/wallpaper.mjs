// Background image: settings → appearance with no image, pick one (WALLPAPER_IMAGE, default the app icon),
// then the practice page idle and mid-run with one slip, where the layer dims. THEME picks a theme in
// settings first (default: the system's). Shots: settings-none, settings-image, idle, mid-run.
import path from 'node:path';

export default async ({ page, h, shot, note, check }) => {
  const image = path.resolve(process.env.WALLPAPER_IMAGE || 'icons/icon-512.png');
  const layer = page.locator('#wallpaper');
  await h.openApp();
  await h.openSettings('appearance');
  if (process.env.THEME) {
    await page.locator(`#theme-select input[value="${process.env.THEME}"]`).locator('..').click();
    await h.attr('html', 'data-theme', process.env.THEME);
  }
  check(await layer.isHidden(), 'no image by default');
  check(await page.locator('#wallpaper-remove').isHidden(), 'remove waits for an image');
  await h.settle();
  await shot('settings-none');
  await page.locator('#wallpaper-file').setInputFiles(image);
  await page.locator('#wallpaper[data-shown]').waitFor({ state: 'attached' });
  check(await page.locator('#wallpaper-remove').isVisible(), 'remove offered');
  await h.settle();
  await shot('settings-image');
  await page.keyboard.press('Escape');
  await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
  await h.settle();
  await shot('idle');

  await h.chooseWords(25);
  const text = await h.passage();
  const half = Math.ceil(text.length / 2);
  let slip = 6;
  while (!/[a-z]/i.test(text[slip])) slip += 1;
  await h.type(`${text.slice(0, slip)}${text[slip] === 'x' ? 'z' : 'x'}${text.slice(slip + 1, half)}`);
  check(await page.locator('body').getAttribute('data-running') === 'true', 'run is under way');
  await h.settle();
  const opacity = await layer.evaluate((node) => getComputedStyle(node).opacity);
  note('running opacity', opacity);
  check(Number(opacity) < 0.5, 'layer dims mid-run');
  await shot('mid-run');
};
