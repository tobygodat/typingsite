// The passage itself stays readable: untyped, typed and mistyped letters are drawn, uncovered, and keep
// 4.5:1 against what is painted behind them, and the caret 3:1, in every theme, on desktop and phone.
// tests/contrast.test.js checks the token pairs; e2e/light-contrast.spec.js the ghost caret; this one the
// passage as painted.
import { test, expect, openApp, chooseWords, passageText, chooseSetting, closeSettings } from './fixtures.js';

const rgba = (value) => {
  const parts = value.match(/rgba?\(([^)]+)\)/)[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
};
const over = (top, under, alpha) => [0, 1, 2].map((i) => top[i] * alpha + under[i] * (1 - alpha));
const channel = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = (c) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

// One letter of each state: what it paints with, every background behind it (outermost first) and the
// opacity it inherits, whether it is visible and on screen, and anything opaque painted over it.
const sample = (page) => page.evaluate(() => {
  const display = document.querySelector('#text-display');
  const read = (char) => {
    if (!char) return null;
    const style = getComputedStyle(char);
    const layers = [];
    let opacity = 1;
    for (let el = char; el; el = el.parentElement) {
      const own = getComputedStyle(el);
      layers.unshift(own.backgroundColor);
      opacity *= Number(own.opacity);
    }
    const box = char.getBoundingClientRect();
    // Whatever sits above the letter (the transparent typing input, the caret) must paint no background.
    const above = document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    const covers = above.slice(0, Math.max(0, above.indexOf(char)))
      .filter((el) => !/^rgba\([^)]*,\s*0\)$|transparent/.test(getComputedStyle(el).backgroundColor) && !el.closest('#text-display'));
    return {
      text: char.textContent,
      fill: style.webkitTextFillColor || style.color,
      layers,
      opacity,
      visible: style.visibility === 'visible' && style.display !== 'none',
      size: box.width * box.height,
      hit: above.includes(char),
      covers: covers.map((el) => el.id || el.className || el.tagName),
    };
  };
  const letters = [...display.querySelectorAll('.word > .char')].filter((char) => /\S/.test(char.textContent));
  return {
    count: letters.length,
    typed: read(letters.find((char) => char.classList.contains('correct'))),
    wrong: read(letters.find((char) => char.classList.contains('wrong'))),
    untyped: read(letters.filter((char) => !char.matches('.correct, .wrong, .current'))[2]),
    caret: getComputedStyle(display.querySelector('.caret-bar')).backgroundColor,
  };
});

const contrast = ({ fill, layers, opacity }) => {
  const ground = layers.reduce((under, value) => { const top = rgba(value); return over(top, under, top[3]); }, [255, 255, 255]);
  const ink = rgba(fill);
  return ratio(over(ink, ground, ink[3] * opacity), ground);
};

const seedRandom = () => {
  let seed = 20261009;
  Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
};

const DARK_THEMES = ['dark', 'terminal', 'midnight', 'nord'];
const THEMES = ['dark', 'light', 'paper', 'shadcn', 'terminal', 'soft', 'midnight', 'swiss', 'e-ink', 'nord'];

for (const theme of THEMES) {
  const mode = DARK_THEMES.includes(theme) ? 'dark' : 'light';
  for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
    test(`${theme} theme, ${label}: untyped, typed and mistyped letters and the caret stay readable`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(seedRandom);
      await page.emulateMedia({ colorScheme: mode });
      await openApp(page);
      if (theme !== mode) {
        await chooseSetting(page, `${mode}-theme`, theme);
        await closeSettings(page);
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await chooseWords(page, 25);
      const text = await passageText(page);
      expect(text.trim().length).toBeGreaterThan(20);

      const idle = await sample(page);
      expect(idle.count).toBeGreaterThan(20);
      expect(idle.untyped).not.toBeNull();

      let slipAt = 6;
      while (!/[a-z]/i.test(text[slipAt])) slipAt += 1;
      await page.locator('#typing-input').focus();
      await page.keyboard.type(`${text.slice(0, slipAt)}${text[slipAt] === 'x' ? 'z' : 'x'}${text.slice(slipAt + 1, slipAt + 4)}`);
      await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
      const running = await sample(page);

      for (const [state, letter] of Object.entries({ untyped: running.untyped, typed: running.typed, mistyped: running.wrong })) {
        expect(letter, `a ${state} letter is drawn`).not.toBeNull();
        expect(letter.visible, `${state} letter is visible`).toBe(true);
        expect(letter.size, `${state} letter has a box`).toBeGreaterThan(0);
        expect(letter.hit, `${state} letter is on screen`).toBe(true);
        expect(letter.covers, `nothing covers the ${state} letter`).toEqual([]);
        expect(contrast(letter), `${state} letter "${letter.text}" contrast`).toBeGreaterThanOrEqual(4.5);
      }
      // The caret crosses the bare passage and mistyped letters' tint.
      for (const letter of [running.untyped, running.wrong]) {
        expect(contrast({ ...letter, fill: running.caret }), `caret over the ${letter === running.wrong ? 'mistyped' : 'untyped'} letter`).toBeGreaterThanOrEqual(3);
      }
    });
  }
}
