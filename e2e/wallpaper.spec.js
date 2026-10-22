// Background image (settings → appearance): picked, kept on this device across reloads, removed; a file that
// isn't an image changes nothing. The layer never takes the pointer or moves the page, dims while a run is in
// progress and comes back with the chrome. Over the brightest image, the passage, the coral mistakes and the
// caret keep their contrast in every theme.
import { test, expect, openApp, chooseWords, passageText, openSettings, closeSettings, chooseSetting } from './fixtures.js';

const layer = (page) => page.locator('#wallpaper');

// A solid PNG of one grey, drawn by the page itself.
const solidImage = async (page, grey) => ({
  name: `grey-${grey}.png`,
  mimeType: 'image/png',
  buffer: Buffer.from(await page.evaluate((value) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 64, height: 48 });
    const context = canvas.getContext('2d');
    context.fillStyle = `rgb(${value} ${value} ${value})`;
    context.fillRect(0, 0, 64, 48);
    return canvas.toDataURL('image/png').split(',')[1];
  }, grey), 'base64'),
});

async function pickImage(page, file) {
  await openSettings(page, 'appearance');
  await page.locator('#wallpaper-file').setInputFiles(file);
  await expect(layer(page)).toHaveAttribute('data-shown', '');
}

const opacity = (page) => layer(page).evaluate((node) => Number(getComputedStyle(node).opacity));

test('a picked image stays on this device until it is removed', async ({ page }) => {
  await openApp(page);
  await expect(layer(page)).toBeHidden();
  await openSettings(page, 'appearance');
  await expect(page.locator('#wallpaper-remove')).toBeHidden();

  await pickImage(page, 'icons/icon-512.png');
  await expect(page.locator('#wallpaper-remove')).toBeVisible();
  expect(await layer(page).evaluate((node) => getComputedStyle(node).maskImage)).toContain('blob:');
  await expect.poll(() => opacity(page)).toBe(1);
  expect(await page.evaluate(() => Object.keys(localStorage).some((key) => localStorage.getItem(key).includes('wallpaper')))).toBe(false);

  await page.reload();
  await expect(layer(page)).toHaveAttribute('data-shown', '');
  await openSettings(page, 'appearance');
  await page.locator('#wallpaper-remove').click();
  await expect(layer(page)).toBeHidden();
  await expect(page.locator('#wallpaper-remove')).toBeHidden();
  await expect(page.locator('#wallpaper-file')).toBeFocused();
  await expect(layer(page)).not.toHaveAttribute('data-shown');

  await page.reload();
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await page.waitForTimeout(300);
  await expect(layer(page)).toBeHidden();
});

test('a file that is not an image changes nothing', async ({ page }) => {
  await openApp(page);
  await openSettings(page, 'appearance');
  await page.locator('#wallpaper-file').setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.locator('#wallpaper-error')).toBeVisible();
  await expect(layer(page)).toBeHidden();
  await pickImage(page, 'icons/icon-512.png');
  await expect(page.locator('#wallpaper-error')).toBeHidden();
});

test('the layer dims mid-run, comes back with the chrome, and never moves or blocks the page', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  const before = await page.locator('#text-display').boundingBox();
  await pickImage(page, 'icons/icon-512.png');
  await closeSettings(page);
  expect(await page.locator('#text-display').boundingBox()).toEqual(before);
  expect(await layer(page).evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none');
  const { x, y } = await page.locator('.dock').boundingBox();
  expect(await page.evaluate(([left, top]) => document.elementFromPoint(left + 2, top + 2).closest('#wallpaper'), [x, y])).toBeNull();

  const text = await passageText(page);
  await page.locator('#typing-input').focus();
  await page.keyboard.type(text.slice(0, 8));
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  await expect.poll(() => opacity(page)).toBe(0.25);
  await page.mouse.move(5, 5);
  await page.mouse.move(60, 60);
  await expect.poll(() => opacity(page)).toBe(1);

  await page.keyboard.type(text.slice(8, 16));
  await expect.poll(() => opacity(page)).toBe(0.25);
  await page.keyboard.type(text.slice(16));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect.poll(() => opacity(page)).toBe(1);
});

test('reduced motion keeps the dimming and drops its transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await pickImage(page, 'icons/icon-512.png');
  await closeSettings(page);
  expect(await layer(page).evaluate((node) => parseFloat(getComputedStyle(node).transitionDuration))).toBeLessThanOrEqual(0.001);
  await page.locator('#typing-input').focus();
  await page.keyboard.type((await passageText(page)).slice(0, 6));
  await expect.poll(() => opacity(page)).toBe(0.25);
});

const DARK_THEMES = ['dark', 'terminal', 'midnight', 'nord'];
const THEMES = ['dark', 'light', 'paper', 'shadcn', 'terminal', 'soft', 'midnight', 'swiss', 'e-ink', 'nord'];
const channel = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const over = ([r, g, b, a], under) => [r, g, b].map((value, i) => value * a + under[i] * (1 - a));

for (const theme of THEMES) {
  const mode = DARK_THEMES.includes(theme) ? 'dark' : 'light';
  for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
    test(`${theme} theme, ${label}: the passage, mistakes and caret keep their contrast over the brightest image`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: mode });
      await openApp(page);
      await chooseSetting(page, `${mode}-theme`, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      // Every dot at full strength: a white image, or a black one where light themes invert it.
      const light = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme === 'light');
      await pickImage(page, await solidImage(page, light ? 0 : 255));
      await closeSettings(page);
      await chooseWords(page, 25);
      await expect.poll(() => opacity(page)).toBe(1);

      // Every colour painted behind the passage, with the letters and caret hidden.
      await page.addStyleTag({ content: '#text-display, #text-display * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; } .caret-bar { visibility: hidden !important; }' });
      // The lines of letters on screen: the display's box also holds the rule and controls below them.
      const box = await page.evaluate(() => {
        const frame = document.querySelector('#text-display').getBoundingClientRect();
        const rects = [...document.querySelectorAll('#text-display .char')].map((char) => char.getBoundingClientRect()).filter((rect) => rect.height);
        const lines = [...new Set(rects.map((rect) => rect.top))].sort((a, b) => a - b).slice(0, 3);
        const bottom = Math.max(...rects.filter((rect) => lines.includes(rect.top)).map((rect) => rect.bottom));
        return { x: frame.left, y: lines[0], width: frame.width, height: bottom - lines[0] };
      });
      const shot = await page.screenshot({ clip: box });
      const { grounds, inks } = await page.evaluate(async (png) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
        const context = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height }).getContext('2d');
        context.drawImage(bitmap, 0, 0);
        const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
        const seen = new Map();
        for (let i = 0; i < data.length; i += 4) seen.set(`${data[i]},${data[i + 1]},${data[i + 2]}`, [data[i], data[i + 1], data[i + 2]]);
        const probe = document.body.appendChild(document.createElement('i'));
        const color = (token) => {
          probe.style.color = `var(${token})`;
          const parts = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number);
          return [parts[0], parts[1], parts[2], parts[3] ?? 1];
        };
        const inks = Object.fromEntries(['--text', '--muted', '--danger', '--danger-soft', '--accent'].map((token) => [token, color(token)]));
        probe.remove();
        return { grounds: [...seen.values()], inks };
      }, shot.toString('base64'));

      const worst = (ink, tint) => Math.min(...grounds.map((ground) => ratio(ink, tint ? over(tint, ground) : ground)));
      expect(worst(inks['--text']), 'typed letters').toBeGreaterThanOrEqual(4.5);
      expect(worst(inks['--muted']), 'untyped letters').toBeGreaterThanOrEqual(4.5);
      expect(worst(inks['--danger'], inks['--danger-soft']), 'mistyped letters on their tint').toBeGreaterThanOrEqual(4.5);
      expect(worst(inks['--accent']), 'caret').toBeGreaterThanOrEqual(3);
    });
  }
}
