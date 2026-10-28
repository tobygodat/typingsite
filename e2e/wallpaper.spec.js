// Background image (settings → appearance): picked, kept on this device across reloads, removed; a file that
// isn't an image changes nothing. Its style, blur, opacity and height show once there is an image, apply as they
// move and stay on this device with it; the height ends it at the countdown until it is raised, on the practice
// screen only. The layer never takes the pointer or moves the page, dims while a run is in progress and comes back
// with the chrome. Raised to full height, the picture runs on behind the reading band, the hints and the footer
// with no hole in it, and over the brightest image in every style, at full strength and the most blur, the
// passage and the coral mistakes keep their contrast in every theme, idle and mid-run: outlined in the ground
// colour where the picture would take them below the floor, and not over a quiet image. The caret is never ringed.
import { test, expect, openApp, chooseWords, passageText, openSettings, closeSettings, chooseSetting, openView } from './fixtures.js';

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
const before = (page, property) => layer(page).evaluate((node, name) => getComputedStyle(node, '::before')[name], property);
const lookRows = (page) => ['#wallpaper-style', '#wallpaper-blur', '#wallpaper-opacity', '#wallpaper-reach'].map((id) => page.locator(id));
// Where the layer's fade ends, and where the practice screen's reading band (countdown, passage, controls) starts.
const fadeEnd = (page) => layer(page).evaluate((node) => node.getBoundingClientRect().height * 0.92);
const readingTop = (page) => page.locator('#typing-form').evaluate((node) => node.getBoundingClientRect().top);

test('a picked image stays on this device until it is removed', async ({ page }) => {
  await openApp(page);
  await expect(layer(page)).toBeHidden();
  await openSettings(page, 'appearance');
  await expect(page.locator('#wallpaper-remove')).toBeHidden();

  await pickImage(page, 'icons/icon-512.png');
  await expect(page.locator('#wallpaper-remove')).toBeVisible();
  expect(await before(page, 'maskImage')).toContain('blob:');
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

test('style, blur, opacity and height wait for an image, apply as they move and stay on this device', async ({ page }) => {
  await openApp(page);
  await openSettings(page, 'appearance');
  for (const row of lookRows(page)) await expect(row).toBeHidden();

  await pickImage(page, 'icons/icon-512.png');
  for (const row of lookRows(page)) await expect(row).toBeVisible();
  await expect(page.locator('#wallpaper-style input[value="dither"]')).toBeChecked();
  await expect(layer(page)).toHaveAttribute('data-style', 'dither');
  await expect(page.locator('#wallpaper-blur')).toBeDisabled();
  await expect(page.locator('#wallpaper-opacity')).toHaveValue('100');
  await expect(page.locator('#wallpaper-reach')).toHaveValue('0');
  expect(Math.abs(await fadeEnd(page) - await readingTop(page))).toBeLessThan(1);

  await chooseSetting(page, 'wallpaper-style', 'regular');
  await expect(layer(page)).toHaveAttribute('data-style', 'regular');
  expect(await before(page, 'backgroundImage')).toContain('blob:');
  expect(await before(page, 'maskImage')).toBe('none');
  await expect(page.locator('#wallpaper-blur')).toBeEnabled();
  await page.locator('#wallpaper-blur').fill('16');
  expect(await before(page, 'filter')).toBe('blur(16px)');
  await page.locator('#wallpaper-opacity').fill('40');
  expect(Number(await before(page, 'opacity'))).toBeCloseTo(0.4);
  await expect.poll(() => opacity(page)).toBe(1);
  // The picture covers the screen whatever the height, so raising it only moves where the fade ends.
  const screen = await page.evaluate(() => innerHeight);
  const picture = await before(page, 'height');
  await page.locator('#wallpaper-reach').fill('100');
  expect(Math.abs(await fadeEnd(page) - screen)).toBeLessThan(1);
  expect(await before(page, 'height')).toBe(picture);
  await page.locator('#wallpaper-reach').fill('50');
  const top = await readingTop(page);
  expect(Math.abs(await fadeEnd(page) - (top + screen) / 2)).toBeLessThan(1);

  await chooseSetting(page, 'wallpaper-style', 'gradient');
  await expect(layer(page)).toHaveAttribute('data-style', 'gradient');
  expect(await before(page, 'backgroundImage')).toContain('blob:');
  expect(await before(page, 'filter')).toBe('blur(16px)');
  expect(await page.evaluate(() => Object.keys(localStorage).some((key) => localStorage.getItem(key).includes('wallpaper')))).toBe(false);

  await page.reload();
  await expect(layer(page)).toHaveAttribute('data-style', 'gradient');
  expect(await before(page, 'filter')).toBe('blur(16px)');
  expect(Number(await before(page, 'opacity'))).toBeCloseTo(0.4);
  await openSettings(page, 'appearance');
  await expect(page.locator('#wallpaper-style input[value="gradient"]')).toBeChecked();
  await expect(page.locator('#wallpaper-blur')).toHaveValue('16');
  await expect(page.locator('#wallpaper-opacity')).toHaveValue('40');
  await expect(page.locator('#wallpaper-reach')).toHaveValue('50');
  // The height is the practice screen's: elsewhere the picture still ends where the reading band starts.
  await closeSettings(page);
  await expect.poll(async () => Math.abs(await fadeEnd(page) - (top + screen) / 2)).toBeLessThan(1);
  await openView(page, 'Progress');
  await expect.poll(async () => Math.abs(await fadeEnd(page) - top)).toBeLessThan(1);
  await openView(page, 'Practice');
  await openSettings(page, 'appearance');

  await chooseSetting(page, 'wallpaper-style', 'dither');
  await expect(layer(page)).toHaveAttribute('data-style', 'dither');
  expect(await before(page, 'filter')).toBe('none');
  await expect(page.locator('#wallpaper-blur')).toBeDisabled();

  await page.locator('#wallpaper-remove').click();
  for (const row of lookRows(page)) await expect(row).toBeHidden();
});

test('an image picked before styles still shows, grey, in every style', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('stilltype-device', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('files');
    open.onsuccess = () => {
      const transaction = open.result.transaction('files', 'readwrite');
      transaction.objectStore('files').put({ width: 4, height: 2, luma: new Uint8ClampedArray([0, 80, 160, 255, 255, 160, 80, 0]) }, 'wallpaper');
      transaction.oncomplete = () => { open.result.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }));
  await page.reload();
  await expect(layer(page)).toHaveAttribute('data-shown', '');
  await expect(layer(page)).toHaveAttribute('data-style', 'dither');
  for (const style of ['regular', 'gradient']) {
    await chooseSetting(page, 'wallpaper-style', style);
    await expect(layer(page)).toHaveAttribute('data-style', style);
    expect(await before(page, 'backgroundImage')).toContain('blob:');
  }
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

const VIEWPORTS = [['desktop', { width: 1280, height: 800 }], ['tablet', { width: 760, height: 1000 }], ['phone', { width: 390, height: 844 }]];
// Every dot, or the whole picture, at full strength: a white image, or a black one where light themes invert it.
const brightestImage = async (page) => solidImage(page, await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme === 'light') ? 0 : 255);

for (const [label, viewport] of VIEWPORTS) {
  for (const mode of ['dark', 'light']) {
    test(`${mode}, ${label}: at full height the picture runs on behind the passage, the hints and the footer with no hole`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: mode });
      await openApp(page);
      await pickImage(page, await brightestImage(page));
      await chooseSetting(page, 'wallpaper-style', 'regular');
      await expect(layer(page)).toHaveAttribute('data-style', 'regular');
      await page.locator('#wallpaper-reach').fill('100');
      await closeSettings(page);
      await chooseWords(page, 25);
      await expect.poll(() => opacity(page)).toBe(1);

      // A strip down the left edge, where nothing is drawn over the layer, from the top of the reading band to the
      // bottom of the footer: how far each row is from the bare ground.
      const span = await page.evaluate(() => {
        const rects = [...document.querySelectorAll('#typing-form, .shortcut-row, .site-footer > *')].map((node) => node.getBoundingClientRect()).filter((rect) => rect.height);
        return { top: Math.min(...rects.map((rect) => rect.top)), bottom: Math.max(...rects.map((rect) => rect.bottom)) };
      });
      const clip = { x: 2, y: Math.round(span.top), width: 4, height: Math.round(span.bottom - span.top) };
      const shown = await page.screenshot({ clip });
      await layer(page).evaluate((node) => { node.style.visibility = 'hidden'; });
      const bare = await page.screenshot({ clip });
      const rows = await page.evaluate(async ([a, b, width]) => {
        const pixels = async (png) => {
          const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
          const context = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height }).getContext('2d');
          context.drawImage(bitmap, 0, 0);
          return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        };
        const [left, right] = await Promise.all([pixels(a), pixels(b)]);
        const out = [];
        for (let i = 0; i < left.length; i++) {
          if (i % 4 === 3) continue;
          const row = Math.floor(i / 4 / width);
          out[row] = Math.max(out[row] ?? 0, Math.abs(left[i] - right[i]));
        }
        return out;
      }, [shown.toString('base64'), bare.toString('base64'), clip.width]);

      expect(rows[0], 'the picture reaches the top of the reading band').toBeGreaterThan(40);
      // The fade only ever lightens the picture downwards: a hole would drop towards the ground and come back.
      let faintest = rows[0];
      rows.forEach((row, y) => {
        expect(row, `row ${clip.y + y} comes back after fading to ${faintest}`).toBeLessThanOrEqual(faintest + 3);
        faintest = Math.min(faintest, row);
      });
    });
  }
}

const DARK_THEMES = ['dark', 'terminal', 'midnight', 'nord'];
const THEMES = ['dark', 'light', 'paper', 'shadcn', 'terminal', 'soft', 'midnight', 'swiss', 'e-ink', 'nord'];
const channel = (v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = ([r, g, b, a], under) => [r, g, b].map((value, i) => value * a + under[i] * (1 - a));

// Raised to full height over the brightest image the picture is behind the passage, so wherever it would take the
// letters below the floor they get an outline in the ground colour, idle and mid-run (where the dim may make it
// unnecessary): either way the letters and the mistyped letters on their tint keep their contrast. The caret stays
// bare.
const STYLES = ['dither', 'regular', 'gradient'];
const CASES = VIEWPORTS.flatMap(([label, viewport]) => STYLES.map((style) => [label, viewport, style]));
const largestDifference = (page, pairs) => page.evaluate(async (list) => {
  const pixels = async (png) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const context = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height }).getContext('2d');
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  };
  return Promise.all(list.map(async ([a, b]) => {
    const [left, right] = await Promise.all([pixels(a), pixels(b)]);
    return left.reduce((most, value, i) => Math.max(most, Math.abs(value - right[i])), 0);
  }));
}, pairs.map(([a, b]) => [a.toString('base64'), b.toString('base64')]));

async function passageContrast(page) {
  // The lines of letters on screen: the display's box also holds the rule and controls below them.
  const box = await page.evaluate(() => {
    const frame = document.querySelector('#text-display').getBoundingClientRect();
    const rects = [...document.querySelectorAll('#text-display .char')].map((char) => char.getBoundingClientRect()).filter((rect) => rect.height);
    const lines = [...new Set(rects.map((rect) => rect.top))].sort((a, b) => a - b).slice(0, 3);
    const bottom = Math.max(...rects.filter((rect) => lines.includes(rect.top)).map((rect) => rect.bottom));
    return { x: frame.left, y: lines[0], width: frame.width, height: bottom - lines[0] };
  });
  const hide = await page.addStyleTag({ content: '#text-display, #text-display * { color: transparent !important; -webkit-text-fill-color: transparent !important; } .caret-bar { visibility: hidden !important; }' });
  const outlined = await page.screenshot({ clip: box });
  const bare = await page.addStyleTag({ content: '#text-display, #text-display * { -webkit-text-stroke: 0 !important; }' });
  const shot = await page.screenshot({ clip: box });
  await Promise.all([hide, bare].map((tag) => tag.evaluate((node) => node.remove())));
  const { grounds, inks, outline, caret } = await page.evaluate(async (png) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const context = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height }).getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const seen = new Map();
    for (let i = 0; i < data.length; i += 4) seen.set(`${data[i]},${data[i + 1]},${data[i + 2]}`, [data[i], data[i + 1], data[i + 2]]);
    const probe = document.body.appendChild(document.createElement('i'));
    const color = (value) => {
      probe.style.color = value;
      const parts = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number);
      return [parts[0], parts[1], parts[2], parts[3] ?? 1];
    };
    const inks = Object.fromEntries(['--text', '--muted', '--danger', '--danger-soft', '--accent', '--ground'].map((token) => [token, color(`var(${token})`)]));
    const char = getComputedStyle(document.querySelector('#text-display .char'));
    const caret = getComputedStyle(document.querySelector('.caret-bar'));
    const outline = document.querySelector('#typing-wrap').hasAttribute('data-halo') && {
      width: parseFloat(char.webkitTextStrokeWidth),
      color: color(char.webkitTextStrokeColor),
      under: char.paintOrder.startsWith('stroke'),
    };
    probe.remove();
    return { grounds: [...seen.values()], inks, outline, caret: { shadow: caret.boxShadow, outline: caret.outlineStyle } };
  }, shot.toString('base64'));
  expect(caret, 'the caret has no ring').toEqual({ shadow: 'none', outline: 'none' });
  if (outline) {
    // The outline is drawn, under each letter, in the ground colour: that is what the letters sit on.
    expect(outline.width, 'outline width').toBeGreaterThanOrEqual(1);
    expect(outline.color, 'outline colour').toEqual(inks['--ground']);
    expect(outline.under, 'outline under the letter').toBe(true);
    // Where the picture strays furthest from the ground behind the letters, the outline paints it back to the ground.
    // How far that is depends on the theme, the style and the dim, so compare with the picture rather than a number.
    const [painted] = await largestDifference(page, [[outlined, shot]]);
    const strays = Math.max(...grounds.map((pixel) => Math.max(...pixel.map((value, i) => Math.abs(value - inks['--ground'][i])))));
    expect(painted, 'the outline paints the ground over the picture').toBeGreaterThanOrEqual(strays * 0.85);
  }
  const behind = outline ? [inks['--ground'].slice(0, 3)] : grounds;
  const worst = (ink, tint) => Math.min(...behind.map((ground) => ratio(ink, tint ? over(tint, ground) : ground)));
  expect(worst(inks['--text']), 'typed letters').toBeGreaterThanOrEqual(4.5);
  expect(worst(inks['--muted']), 'untyped letters').toBeGreaterThanOrEqual(4.5);
  expect(worst(inks['--danger'], inks['--danger-soft']), 'mistyped letters on their tint').toBeGreaterThanOrEqual(4.5);
  if (!outline) expect(worst(inks['--accent']), 'caret').toBeGreaterThanOrEqual(3);
  return Boolean(outline);
}

for (const theme of THEMES) {
  const mode = DARK_THEMES.includes(theme) ? 'dark' : 'light';
  for (const [label, viewport, style] of CASES) {
    test(`${theme} theme, ${label}, ${style}: at full height the passage and mistakes keep their contrast over the brightest image, outlined where they need it, the caret bare`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: mode });
      await openApp(page);
      await chooseSetting(page, `${mode}-theme`, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await pickImage(page, await brightestImage(page));
      if (style !== 'dither') {
        await chooseSetting(page, 'wallpaper-style', style);
        await page.locator('#wallpaper-blur').fill(await page.locator('#wallpaper-blur').getAttribute('max'));
        await expect(layer(page)).toHaveAttribute('data-style', style);
      }
      await page.locator('#wallpaper-reach').fill('100');
      await closeSettings(page);
      await chooseWords(page, 25);
      await expect.poll(() => opacity(page)).toBe(1);
      expect(await passageContrast(page), 'outlined over the brightest image').toBe(true);

      await page.locator('#typing-input').focus();
      await page.keyboard.type((await passageText(page)).slice(0, 3));
      await expect.poll(() => opacity(page)).toBe(0.25);
      await passageContrast(page);
    });
  }
}

for (const mode of ['dark', 'light']) {
  for (const style of STYLES) {
    test(`${mode}, ${style}: over a quiet image at full height nothing is outlined`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: mode });
      await openApp(page);
      // The opposite of the brightest: black behind light letters, white behind dark ones (or no dither dots).
      await pickImage(page, await solidImage(page, mode === 'dark' ? 0 : 255));
      if (style !== 'dither') {
        await chooseSetting(page, 'wallpaper-style', style);
        await expect(layer(page)).toHaveAttribute('data-style', style);
      }
      await page.locator('#wallpaper-reach').fill('100');
      await closeSettings(page);
      await chooseWords(page, 25);
      await expect.poll(() => opacity(page)).toBe(1);
      await expect(page.locator('[data-halo]')).toHaveCount(0);
      expect(await passageContrast(page)).toBe(false);
    });
  }
}
