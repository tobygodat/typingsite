// Typing and app fonts: picks each typing font in settings → appearance (with a non-default app font),
// on three lines and on the one-line tape, with the custom pace caret on. Types past the second line,
// then measures from the rendered glyphs (a Range over the current letter, and canvas metrics for the
// font in use): the caret bar's x against the letter's left edge, the bar against the baseline (Literata's
// place, 0.985em above to 0.165em below), the current letter inside the visible lines, and the pace caret on a letter boundary of a line.
// Shots: <font>-lines, <font>-tape. run.json notes every measurement under `fonts`.
const TYPING = ['literata', 'source-serif', 'inter', 'jetbrains-mono', 'ibm-plex-mono', 'roboto-mono', 'fira-code'];
const APP = { literata: 'inter', 'source-serif': 'inter', inter: 'source-serif' };

export default async ({ page, h, shot, note, check }) => {
  const pick = async (group, value) => {
    const option = page.locator(`#${group} input[value="${value}"]`);
    await option.locator('..').click();
    check(await option.isChecked(), `${group} ${value} is checked`);
  };
  const measured = [];
  for (const font of TYPING) {
    for (const tape of [false, true]) {
      await h.openApp();
      await h.openSettings('appearance');
      await pick('typing-font', font);
      await pick('app-font', APP[font] || 'literata');
      await pick('tape-toggle', String(tape));
      await h.openSettings('practice');
      await pick('pace-select', 'custom');
      await page.keyboard.press('Escape');
      await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
      await h.chooseWords(50);
      const text = await h.passage();
      let stop = 150;
      while (!/[a-z]/i.test(text[stop])) stop += 1;
      await h.type(text.slice(0, stop));
      await page.waitForTimeout(500);
      const m = await page.evaluate(() => {
        const wrap = document.getElementById('typing-wrap');
        const box = wrap.getBoundingClientRect();
        const bar = wrap.querySelector('.caret-bar').getBoundingClientRect();
        const current = document.querySelector('#text-display .char.current');
        const range = document.createRange();
        range.selectNodeContents(current);
        const glyph = range.getBoundingClientRect();
        const style = getComputedStyle(current);
        const size = parseFloat(style.fontSize);
        // Metrics at 1000px for precision, in em of the passage.
        const context = document.createElement('canvas').getContext('2d');
        context.font = `${style.fontWeight} 1000px ${style.fontFamily}`;
        const metrics = context.measureText('Hg');
        const em = (value) => value / 1000;
        const baseline = glyph.top + em(metrics.fontBoundingBoxAscent) * size;
        const ghost = wrap.querySelector('.ghost-caret');
        const ghostBox = ghost.getBoundingClientRect();
        const letters = [...document.querySelectorAll('#text-display .char')].map((node) => node.getBoundingClientRect())
          .filter((rect) => rect.width && Math.abs(rect.top - ghostBox.top) < 1);
        const edges = letters.flatMap((rect) => [rect.left, rect.right]);
        return {
          family: style.fontFamily.split(',')[0].replaceAll('"', ''),
          loaded: document.fonts.check(`${style.fontWeight} ${size}px ${style.fontFamily}`),
          caretToLetter: +((bar.left + bar.right) / 2 - glyph.left).toFixed(2),
          // The bar against the baseline, in em: Literata's place is 0.985 above and 0.165 below.
          barTop: +((baseline - bar.top) / size).toFixed(3),
          barBottom: +((bar.bottom - baseline) / size).toFixed(3),
          fontSize: size,
          capHeight: +em(metrics.actualBoundingBoxAscent).toFixed(3),
          descender: +em(metrics.actualBoundingBoxDescent).toFixed(3),
          letterInView: glyph.left >= box.left && glyph.right <= box.right && glyph.top >= box.top && glyph.bottom <= box.bottom,
          line: Math.round((glyph.top - box.top) / parseFloat(getComputedStyle(document.getElementById('text-display')).lineHeight)),
          ghostShown: !ghost.classList.contains('is-hidden'),
          ghostOnLine: letters.length > 0,
          ghostInLetters: letters.length > 0 && ghostBox.left >= Math.min(...edges) - 1 && ghostBox.left <= Math.max(...edges) + 1,
        };
      });
      measured.push({ font, tape, ...m });
      const label = `${font} ${tape ? 'tape' : 'lines'}`;
      check(m.loaded, `${label}: the font file loaded`);
      check(Math.abs(m.caretToLetter) <= 1, `${label}: caret sits on the letter's left edge (${m.caretToLetter}px)`);
      // Layout rounds a font's ascent and descent to whole pixels, so allow a pixel.
      check(Math.abs(m.barTop - 0.985) * m.fontSize <= 1 && Math.abs(m.barBottom - 0.165) * m.fontSize <= 1, `${label}: caret stands on the baseline as on Literata (${m.barTop}em above, ${m.barBottom}em below)`);
      check(m.letterInView, `${label}: the current letter is in view`);
      check(m.ghostShown && m.ghostOnLine && m.ghostInLetters, `${label}: pace caret sits on a line of letters`);
      await h.settle();
      await shot(`${font}-${tape ? 'tape' : 'lines'}`);
    }
  }
  note('fonts', measured);
};
