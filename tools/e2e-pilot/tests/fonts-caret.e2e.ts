import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { setUp, tearDown, openApp, openSettings, chooseSetting, passageText, typeInto, fontsReady } from './helpers.ts';

// Port of e2e/fonts.spec.js "inter: the caret stays on the letter and the baseline past the line scroll", the case
// tagged @compat that CI runs on WebKit (TOB-423).

// From the rendered glyphs: the caret bar's x against the current letter's left edge, and its top and bottom against
// the baseline of the font in use (the caret's place: 0.985em above, 0.165em below).
const caretOnLetter = (browser: Parameters<typeof fontsReady>[0]) => browser.evaluate(() => {
  const wrap = document.getElementById('typing-wrap')!;
  const bar = wrap.querySelector('.caret-bar')!.getBoundingClientRect();
  const current = document.querySelector('#text-display .char.current')!;
  const range = document.createRange();
  range.selectNodeContents(current);
  const glyph = range.getBoundingClientRect();
  const style = getComputedStyle(current);
  const size = parseFloat(style.fontSize);
  const context = document.createElement('canvas').getContext('2d')!;
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

test('inter: the caret stays on the letter and the baseline past the line scroll', async ({ browser, screen }) => {
  const supabase = await setUp(browser);
  await openApp(browser);
  await openSettings(browser, 'appearance');
  await screen.getByRole('combobox', { name: 'typing font', exact: true }).selectOption('inter');
  await chooseSetting(browser, 'tape-toggle', 'false');
  await fontsReady(browser);
  const text = await passageText(browser);
  let stop = Math.min(140, text.length - 2);

  while (!/[a-z]/i.test(text[stop])) stop -= 1;
  await typeInto(browser, text.slice(0, stop), '#typing-input', { delay: 15 });
  await new Promise((resolve) => { setTimeout(resolve, 500); });
  const caret = await caretOnLetter(browser);
  expect(caret.inView).toBe(true);
  expect(Math.abs(caret.x)).toBeLessThanOrEqual(1);
  // Layout rounds a font's ascent and descent to whole pixels.
  expect(Math.abs(caret.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(caret.bottom)).toBeLessThanOrEqual(1);
  await tearDown(browser, supabase);
});
