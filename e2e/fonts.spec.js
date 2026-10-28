// Typing font and app font: settings → appearance and the palette. Display only. Literata for both by
// default, with no other font file fetched; a picked font loads then, the carets stay on its letters and
// baseline, and an account's pick is in place before first paint.
import { test, expect, openApp, openSettings, closeSettings, chooseSetting, passageText, typeInto, signInWithEmail } from './fixtures.js';

const family = (page, selector) => page.locator(selector).first().evaluate((node) => getComputedStyle(node).fontFamily.split(',')[0].replaceAll('"', ''));
const fontFiles = (requests) => [...new Set(requests.filter((url) => url.includes('/src/fonts/')).map((url) => url.split('/src/fonts/')[1]))].sort();

async function runPalette(page, label) {
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await page.locator('#palette-trigger').click();
  await page.keyboard.type(label);
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText(label);
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
}

// From the rendered glyphs: the caret bar's x against the current letter's left edge, and its top and
// bottom against the baseline of the font in use (Literata's place: 0.985em above, 0.165em below).
const caretOnLetter = (page) => page.evaluate(() => {
  const wrap = document.getElementById('typing-wrap');
  const bar = wrap.querySelector('.caret-bar').getBoundingClientRect();
  const current = document.querySelector('#text-display .char.current');
  const range = document.createRange();
  range.selectNodeContents(current);
  const glyph = range.getBoundingClientRect();
  const style = getComputedStyle(current);
  const size = parseFloat(style.fontSize);
  const context = document.createElement('canvas').getContext('2d');
  context.font = `${style.fontWeight} 1000px ${style.fontFamily}`;
  const baseline = glyph.top + (context.measureText('H').fontBoundingBoxAscent / 1000) * size;
  const box = wrap.getBoundingClientRect();

  return {
    x: (bar.left + bar.right) / 2 - glyph.left,
    top: baseline - bar.top - 0.985 * size,
    bottom: bar.bottom - baseline - 0.165 * size,
    inView: glyph.top >= box.top && glyph.bottom <= box.bottom && glyph.left >= box.left && glyph.right <= box.right,
  };
});

test('Literata by default with no other font fetched; each pick changes only its own text and loads its file', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await openApp(page);
  await openSettings(page, 'appearance');
  await expect(page.locator('#typing-font input:checked')).toHaveValue('literata');
  await expect(page.locator('#app-font input:checked')).toHaveValue('literata');
  expect(fontFiles(requests).every((file) => /^(literata|geist-mono)-/.test(file))).toBe(true);

  await chooseSetting(page, 'typing-font', 'jetbrains-mono');
  await expect(page.locator('html')).toHaveAttribute('data-typing-font', 'jetbrains-mono');
  await expect.poll(() => fontFiles(requests)).toContain('jetbrains-mono-400.woff2');
  expect(await family(page, '#text-display')).toBe('JetBrains Mono');
  expect(await family(page, '#settings-preview-passage')).toBe('JetBrains Mono');
  expect(await family(page, '#settings-title')).toBe('Literata');

  await chooseSetting(page, 'app-font', 'inter');
  await expect(page.locator('html')).toHaveAttribute('data-app-font', 'inter');
  await expect.poll(() => fontFiles(requests)).toContain('inter-roman.woff2');
  expect(await family(page, '#settings-title')).toBe('Inter');
  expect(await family(page, '#text-display')).toBe('JetBrains Mono');
  await closeSettings(page);
  expect(await family(page, '#condition-line')).toBe('Geist Mono');
  expect(fontFiles(requests).some((file) => /^(source-serif|ibm-plex|roboto|fira)/.test(file))).toBe(false);
});

test('the palette lists both fonts like theme and marks the current one', async ({ page }) => {
  await openApp(page);
  await runPalette(page, 'typing font · fira code');
  await expect(page.locator('html')).toHaveAttribute('data-typing-font', 'fira-code');
  await runPalette(page, 'app font · source serif');
  await expect(page.locator('html')).toHaveAttribute('data-app-font', 'source-serif');
  await page.locator('#palette-trigger').click();
  await page.keyboard.type('typing font');
  await expect(page.locator('#palette-list [role="option"]', { hasText: 'typing font · ' })).toHaveCount(7);
  await expect(page.locator('#palette-list [role="option"]', { hasText: 'typing font · fira code' })).toContainText('current');
  await page.keyboard.press('Escape');
  await openSettings(page, 'appearance');
  await expect(page.locator('#typing-font input:checked')).toHaveValue('fira-code');
  await expect(page.locator('#app-font input:checked')).toHaveValue('source-serif');
});

for (const font of ['literata', 'fira-code']) {
  for (const tape of [false, true]) {
    test(`${font}${tape ? ' on the tape' : ''}: the caret stays on the letter and the baseline past the line scroll`, async ({ page, browserName }) => {
      test.fail(font === 'fira-code' && browserName === 'webkit', 'TOB-22: WebKit on Linux sets the Fira Code caret 1.32 px off the baseline');
      await openApp(page);
      await chooseSetting(page, 'typing-font', font);
      await chooseSetting(page, 'tape-toggle', String(tape));
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const text = await passageText(page);
      let stop = Math.min(140, text.length - 2);

      while (!/[a-z]/i.test(text[stop])) stop -= 1;
      await typeInto(page, text.slice(0, stop), '#typing-input', { delay: 15 });
      await page.waitForTimeout(500);
      const caret = await caretOnLetter(page);
      expect(caret.inView).toBe(true);
      expect(Math.abs(caret.x)).toBeLessThanOrEqual(1);
      // Layout rounds a font's ascent and descent to whole pixels.
      expect(Math.abs(caret.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(caret.bottom)).toBeLessThanOrEqual(1);
    });
  }
}

test('an account keeps both picks and applies them before first paint', async ({ page, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await chooseSetting(page, 'typing-font', 'roboto-mono');
  await chooseSetting(page, 'app-font', 'inter');
  await expect.poll(() => supabase.profileFor('ada@stilltype.test')?.preferences.typingFont, { timeout: 8000 }).toBe('roboto-mono');
  await expect.poll(() => supabase.profileFor('ada@stilltype.test')?.preferences.appFont, { timeout: 8000 }).toBe('inter');
  // Records the fonts as they stood when <body> was first parsed, before any paint or module ran.
  await page.addInitScript(() => {
    new MutationObserver((records, observer) => {
      if (!document.body) return;
      window.fontsAtBody = { ...document.documentElement.dataset };
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  const atBody = await page.evaluate(() => window.fontsAtBody);
  expect(atBody.typingFont).toBe('roboto-mono');
  expect(atBody.appFont).toBe('inter');
  expect(await family(page, '#text-display')).toBe('Roboto Mono');
});
