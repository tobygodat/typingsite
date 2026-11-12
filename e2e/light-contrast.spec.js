// Rendered contrast in both themes: a mistyped letter on its tint, the caret and ghost caret on ground
// and on that tint, the selected palette row's green hint, and input placeholders.
// tests/contrast.test.js checks the token pairs; this checks that the page really paints them that way.
import { test, expect, openApp, chooseWords, passageText } from './fixtures.js';

const shotPath = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/light-contrast/${name}.png` : testInfo.outputPath(`${name}.png`));

// Computed colours come back as rgb()/rgba(); composite and compare them as WCAG 2 does.
const rgba = (value) => {
  const parts = value.match(/rgba?\(([^)]+)\)/)[1].split(/[\s,/]+/).filter(Boolean).map(Number);

  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
};

const over = (top, under, alpha = top[3]) => [0, 1, 2].map((i) => top[i] * alpha + under[i] * (1 - alpha)).concat(1);

const channel = (v) => {
  const s = v / 255;

  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = (c) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);

const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
};

// Paints `layers` bottom-up (each a computed colour, optionally with an element opacity) and returns the result.
const stack = (layers) => layers.reduce((under, [value, opacity = 1]) => {
  const top = rgba(value);

  return over(top, under, top[3] * opacity);
}, [255, 255, 255, 1]);

// The same passage on every run, so the before and after screenshots line up.
const seedRandom = () => {
  let seed = 20261009;
  Math.random = () => {
    seed = (seed * 16807) % 2147483647;

    return (seed - 1) / 2147483646;
  };
};

const open = async (page, theme) => {
  await openApp(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  // The grounds themselves are unchanged by the contrast pass.
  await expect(page.locator('body')).toHaveCSS('background-color', theme === 'light' ? 'rgb(244, 241, 235)' : 'rgb(15, 15, 14)');
};

const toggleGhost = async (page) => {
  await page.keyboard.press('Control+k');
  await page.keyboard.type('ghost');
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-ghost', 'on');
  await expect(page.locator('#egg-toast')).toBeHidden({ timeout: 5000 });
};

for (const theme of ['light', 'dark']) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(seedRandom);
      await page.emulateMedia({ colorScheme: theme });
    });

    test('a mistyped letter, the caret and the ghost caret keep their contrast mid-run', async ({ page }, testInfo) => {
      await page.clock.install();
      await open(page, theme);
      await chooseWords(page, 25);
      await toggleGhost(page);
      const text = await passageText(page);
      // One slip left in on a letter, so it sits on its own tint. Keys land 140 ms apart on a paused
      // clock (about 85 wpm), so the caret and the 60 wpm ghost stop in the same place every run.
      let slipAt = 14;

      while (!/[a-z]/i.test(text[slipAt])) slipAt += 1;
      const slip = text[slipAt] === 'x' ? 'z' : 'x';
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
      await page.locator('#typing-input').focus();

      for (const key of `${text.slice(0, slipAt)}${slip}${text.slice(slipAt + 1, slipAt + 18)}`) {
        await page.keyboard.type(key);
        await page.clock.runFor(140);
      }

      await page.clock.runFor(300);
      await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
      await expect(page.locator('#text-display .ghost-caret')).not.toHaveClass(/is-hidden/);

      if (theme === 'light') await page.screenshot({ path: shotPath(testInfo, 'light-practice-mistake') });

      const paint = await page.evaluate(() => {
        const css = (el, pseudo) => getComputedStyle(el, pseudo);
        const wrong = document.querySelector('#text-display .word > .char.wrong');
        const ghost = document.querySelector('#text-display .ghost-caret');

        return {
          ground: css(document.body).backgroundColor,
          wrongColor: css(wrong).color,
          wrongTint: css(wrong).backgroundColor,
          caret: css(document.querySelector('#text-display .caret-bar')).backgroundColor,
          ghost: css(ghost, '::after').backgroundColor,
          ghostOpacity: Number(css(ghost).opacity),
        };
      });

      const ground = stack([[paint.ground]]);
      expect(ratio(rgba(paint.wrongColor), stack([[paint.ground], [paint.wrongTint]]))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(rgba(paint.caret), ground)).toBeGreaterThanOrEqual(3);
      expect(paint.ghostOpacity).toBeGreaterThan(0);
      expect(ratio(stack([[paint.ground], [paint.ghost, paint.ghostOpacity]]), ground)).toBeGreaterThanOrEqual(3);
      // Both carets cross mistyped letters, so they also hold 3:1 on the coral tint.
      const tinted = stack([[paint.ground], [paint.wrongTint]]);
      expect(ratio(rgba(paint.caret), tinted)).toBeGreaterThanOrEqual(3);
      expect(ratio(stack([[paint.ground], [paint.wrongTint], [paint.ghost, paint.ghostOpacity]]), tinted)).toBeGreaterThanOrEqual(3);
    });

    test('the selected palette row keeps its green hint readable', async ({ page }, testInfo) => {
      await open(page, theme);
      await page.keyboard.press('Control+k');
      await expect(page.locator('#palette')).toBeVisible();
      const selected = page.locator('#palette-list [aria-selected="true"]');
      await expect(selected.locator('.opt-hint.is-on')).toBeVisible();
      await expect(page.locator('.palette-highlight')).toHaveCSS('opacity', '1');
      // Let the box finish fading in, so the passage behind it doesn't show through the shot.
      await page.locator('#palette .palette-box').evaluate((box) => Promise.all(box.getAnimations().map((a) => a.finished)));

      if (theme === 'light') await page.screenshot({ path: shotPath(testInfo, 'light-palette-selected') });

      const paint = await page.evaluate(() => {
        const css = (el) => getComputedStyle(el);

        return {
          panel: css(document.querySelector('#palette .palette-box')).backgroundColor,
          highlight: css(document.querySelector('.palette-highlight')).backgroundColor,
          hint: css(document.querySelector('#palette-list [aria-selected="true"] .opt-hint.is-on')).color,
          label: css(document.querySelector('#palette-list [aria-selected="true"]')).color,
        };
      });

      const row = stack([[paint.panel], [paint.highlight]]);
      expect(ratio(rgba(paint.hint), row)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(rgba(paint.label), row)).toBeGreaterThanOrEqual(4.5);
    });

    test('input placeholders read at 4.5:1 with no extra fade', async ({ page }, testInfo) => {
      await open(page, theme);
      await page.locator('.nav-item[data-nav="compete"]').click();
      await page.locator('#open-local').click();
      const name = page.locator('#player-one-name');
      await expect(name).toBeVisible();
      await expect(name).toHaveValue('');
      await page.mouse.move(640, 700);

      if (theme === 'light') await page.screenshot({ path: shotPath(testInfo, 'light-placeholders') });

      const paint = await name.evaluate((input) => {
        const placeholder = getComputedStyle(input, '::placeholder');

        return { field: getComputedStyle(input).backgroundColor, color: placeholder.color, opacity: Number(placeholder.opacity) };
      });

      expect(paint.opacity).toBe(1);
      const field = stack([[paint.field]]);
      expect(ratio(stack([[paint.field], [paint.color]]), field)).toBeGreaterThanOrEqual(4.5);
    });
  });
}
