// Background image: settings → appearance with no image, pick one (WALLPAPER_IMAGE, default the app icon),
// then the practice page idle in each style (regular, dither, gradient), and mid-run with one slip, where the
// layer dims. THEME picks a theme in settings first (default: the system's). BLUR and OPACITY move those
// sliders with the keyboard before the idle shots (default: left as they are). Shots: settings-none,
// settings-image, settings-<style>, idle-<style>, mid-run.
import path from 'node:path';

export default async ({ page, h, shot, note, check }) => {
  const image = path.resolve(process.env.WALLPAPER_IMAGE || 'icons/icon-512.png');
  const layer = page.locator('#wallpaper');
  const before = (property) => layer.evaluate((node, name) => getComputedStyle(node, '::before')[name], property);
  await h.openApp();
  await h.openSettings('appearance');
  if (process.env.THEME) {
    const mode = ['dark', 'terminal', 'midnight', 'nord'].includes(process.env.THEME) ? 'dark' : 'light';
    await page.locator(`#theme-select input[value="${mode}"]`).locator('..').click();
    await page.locator(`#${mode}-theme input[value="${process.env.THEME}"]`).locator('..').click();
    await h.attr('html', 'data-theme', process.env.THEME);
  }
  check(await layer.isHidden(), 'no image by default');
  check(await page.locator('#wallpaper-remove').isHidden(), 'remove waits for an image');
  check(await page.locator('#wallpaper-style').isHidden(), 'style waits for an image');
  await h.settle();
  await shot('settings-none');
  await page.locator('#wallpaper-file').setInputFiles(image);
  await page.locator('#wallpaper[data-shown]').waitFor({ state: 'attached' });
  check(await page.locator('#wallpaper-remove').isVisible(), 'remove offered');
  check(await page.locator('#wallpaper-style input[value="dither"]').isChecked(), 'dither by default');
  check(await page.locator('#wallpaper-blur').isDisabled(), 'blur is off for dither');
  await page.locator('#wallpaper-opacity').scrollIntoViewIfNeeded();
  await h.settle();
  await shot('settings-image');

  for (const [slider, steps] of [['#wallpaper-blur', process.env.BLUR], ['#wallpaper-opacity', process.env.OPACITY]]) {
    if (!steps) continue;
    await page.locator('#wallpaper-style input[value="regular"]').locator('..').click();
    await page.locator(slider).focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < Number(steps); i++) await page.keyboard.press('ArrowRight');
    note(slider, await page.locator(slider).inputValue());
  }

  for (const style of ['regular', 'dither', 'gradient']) {
    await page.locator(`#wallpaper-style input[value="${style}"]`).locator('..').click();
    await page.locator(`#wallpaper[data-style="${style}"]`).waitFor({ state: 'attached' });
    check(await page.locator('#wallpaper-blur').isDisabled() === (style === 'dither'), `blur ${style === 'dither' ? 'off' : 'on'} for ${style}`);
    await h.settle();
    await shot(`settings-${style}`);
    note(`${style} filter`, await before('filter'));
    note(`${style} opacity`, await before('opacity'));
    await page.keyboard.press('Escape');
    await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
    await h.settle();
    await shot(`idle-${style}`);
    if (style !== 'gradient') await h.openSettings('appearance');
  }

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
