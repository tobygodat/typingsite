// Afterimage chrome: theme, settings, command palette, ghost pacer, the still-run fade and reduced motion.
import { test, expect, openApp, passageText, typeInto, chooseWords, completePassage, openSettings } from './fixtures.js';

const html = (page) => page.locator('html');
const themeColor = (page) => page.locator('meta[name="theme-color"]');

test.describe('theme', () => {
  test('follows the system until the user picks one', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openApp(page);
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect(themeColor(page)).toHaveAttribute('content', '#f4f1eb');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 241, 235)');

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(themeColor(page)).toHaveAttribute('content', '#0f0f0e');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(15, 15, 14)');

    await openSettings(page);
    await page.locator('#theme-select').selectOption('light');
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html(page)).toHaveAttribute('data-theme', 'light');

    await page.locator('#theme-select').selectOption('system');
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  });

  test('a guest’s pick is not kept after reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await openSettings(page);
    await page.locator('#theme-select').selectOption('light');
    await page.locator('#font-size').selectOption('36');
    await expect(page.locator('body')).toHaveAttribute('data-font-size', '36');
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveAttribute('data-font-size', '28');
    await expect(page.locator('#theme-select')).toHaveValue('system');
  });
});

test('settings apply their display preferences', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  for (const [size, px] of [['22', '29px'], ['36', '44px'], ['28', '36px']]) {
    await page.locator('#font-size').selectOption(size);
    await expect(page.locator('#text-display')).toHaveCSS('font-size', px);
  }
  await page.locator('#live-toggle').check();
  await expect(page.locator('body')).toHaveAttribute('data-live-metrics', 'true');
  await page.locator('#keyboard-toggle').check();
  await expect(page.locator('#keyboard')).toBeVisible();
  await expect(page.locator('#keyboard .key')).toHaveCount(27);

  // Escape closes the popover and returns focus to its toggle.
  await page.keyboard.press('Escape');
  await expect(page.locator('.preferences-popover')).toBeHidden();
  await expect(page.locator('details.preferences summary')).toBeFocused();
});

test('focus mode has an explicit exit and answers Escape', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await page.locator('#focus-toggle').check();
  await expect(page.locator('body')).toHaveAttribute('data-focus-mode', 'true');
  await expect(page.locator('#exit-focus')).toBeVisible();
  await page.locator('#exit-focus').click();
  await expect(page.locator('body')).toHaveAttribute('data-focus-mode', 'false');
  await expect(page.locator('#typing-input')).toBeFocused();

  await openSettings(page);
  await page.locator('#focus-toggle').check();
  // Clicking the passage closes the settings popover, which would otherwise take the first Escape.
  await page.locator('#typing-input').click();
  await expect(page.locator('.preferences-popover')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-focus-mode', 'false');
});

test.describe('command palette', () => {
  test('opens with Ctrl-K, filters, runs a command and returns focus', async ({ page }) => {
    await openApp(page);
    await page.locator('#typing-input').focus();
    await page.keyboard.press('Control+k');
    await expect(page.locator('#palette')).toBeVisible();
    await expect(page.locator('#palette-input')).toBeFocused();
    await expect(page.locator('#palette-list [role="option"]').first()).toBeVisible();

    await page.keyboard.type('zzqqxx');
    await expect(page.locator('#palette-empty')).toBeVisible();
    await page.locator('#palette-input').fill('');
    await page.keyboard.press('Escape');
    await expect(page.locator('#palette')).toBeHidden();
    await expect(page.locator('#typing-input')).toBeFocused();

    await page.locator('#palette-trigger').click();
    await page.keyboard.type('words · 10');
    await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('words · 10 words');
    await page.keyboard.press('Enter');
    await expect(page.locator('#palette')).toBeHidden();
    await expect(page.locator('#mode-words')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#condition-line')).toContainText('10 words');
    await expect(page.locator('#typing-input')).toBeFocused();
  });

  test('switches theme and shows current state in its hints', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await page.keyboard.press('Control+k');
    await page.keyboard.type('theme · light');
    await page.keyboard.press('Enter');
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('theme · light');
    await expect(page.locator('#palette-list [aria-selected="true"] .opt-hint')).toHaveText('current');
  });

  test('opening it mid-run marks the run interrupted', async ({ page }) => {
    await openApp(page);
    await typeInto(page, (await passageText(page)).slice(0, 4));
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Escape');
    await expect(page.locator('#typing-status')).toHaveText('Interrupted');
    await expect(page.locator('#input-help')).toHaveText('Commands opened mid-run, so it won’t count.');
  });
});

test.describe('ghost pacer', () => {
  test('the key sequence toggles a moving pace caret that is never scored', async ({ page }) => {
    await openApp(page);
    await page.locator('#typing-input').blur();
    for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) {
      await page.keyboard.press(key);
    }
    await expect(page.locator('body')).toHaveAttribute('data-ghost', 'on');
    await expect(page.locator('#egg-toast')).toBeVisible();
    await expect(page.locator('#egg-feedback')).toHaveText('Ghost pacer · 60 wpm');
    await expect(page.locator('#typing-input')).toHaveValue('');

    const ghost = page.locator('#text-display .ghost-caret');
    await expect(ghost).not.toHaveClass(/is-hidden/);
    const text = await passageText(page);
    await typeInto(page, text[0]);
    const start = await ghost.evaluate((node) => node.style.transform);
    await expect.poll(() => ghost.evaluate((node) => node.style.transform), { timeout: 3000 }).not.toBe(start);
    await expect(page.locator('#typing-input')).toHaveValue(text[0]);
  });

  test('typing "ghost" in the palette offers the same toggle', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+k');
    await page.keyboard.type('ghost');
    await expect(page.locator('#palette-list [role="option"]').first()).toContainText('ghost pacer');
    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toHaveAttribute('data-ghost', 'on');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('ghost');
    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toHaveAttribute('data-ghost', 'off');
    await expect(page.locator('#egg-feedback')).toHaveText('Ghost off');
  });
});

test('chrome fades while typing and returns on pointer movement and finish', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await page.mouse.move(10, 10);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 3));

  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  for (const selector of ['.dock-zone', '.account', '.practice-controls', '.site-footer', '.shortcut-row']) {
    await expect(page.locator(selector)).toHaveCSS('opacity', '0');
  }
  await expect(page.locator('#text-display')).toHaveCSS('opacity', '1');

  // Layout jitter under 4px is ignored; a real nudge brings the chrome back.
  await page.mouse.move(12, 11);
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  await page.mouse.move(80, 80);
  await expect(page.locator('body')).toHaveAttribute('data-running', 'false');
  await expect(page.locator('.dock-zone')).toHaveCSS('opacity', '1');

  await page.keyboard.type(text.slice(3, 4));
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  await page.keyboard.type(text.slice(4));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('body')).toHaveAttribute('data-running', 'false');
  await expect(page.locator('.dock-zone')).toHaveCSS('opacity', '1');
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('every duration collapses to (effectively) zero', async ({ page }) => {
    await openApp(page);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--motion-scale').trim())).toBe('0');
    for (const selector of ['.dock-zone', '#text-display']) {
      const durations = await page.locator(selector).evaluate((node) => getComputedStyle(node).transitionDuration.split(', '));
      // styles.css pins transitions to 1ms so transitionend still fires.
      expect(durations.every((value) => parseFloat(value) <= 0.001), `${selector} ${durations}`).toBe(true);
    }
    // The run card is still drawn, just without the develop animation.
    await chooseWords(page, 10);
    await completePassage(page);
    await expect(page.locator('#run-card')).toBeVisible();
    const painted = await page.locator('#card-canvas').evaluate((canvas) => {
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      return data.some((value, index) => index % 4 === 3 && value > 0);
    });
    expect(painted).toBe(true);
  });
});
