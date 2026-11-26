// Afterimage chrome: theme, settings, command palette, ghost pacer, the still-run fade and reduced motion.
import { test, expect, openApp, openView, passageText, typeInto, chooseWords, completePassage, openSettings, storageKeys, chooseSetting, closeSettings, phone } from './fixtures.js';

const html = (page) => page.locator('html');

// index.html carries a light and a dark theme-color meta; the app sets both to the resolved theme.
const themeColor = (page) => page.locator('meta[name="theme-color"]').first();

async function pressSequence(page) {
  for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) {
    await page.keyboard.press(key);
  }
}

test.describe('theme', () => {
  test('follows the system until the user picks one', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openApp(page);
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect(themeColor(page)).toHaveAttribute('content', '#f6f6f4');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(246, 246, 244)');

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(themeColor(page)).toHaveAttribute('content', '#0b0b0d');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 11, 13)');

    await openSettings(page);
    await chooseSetting(page, 'theme-select', 'light');
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html(page)).toHaveAttribute('data-theme', 'light');

    await chooseSetting(page, 'theme-select', 'system');
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  });

  test('system mode switches between the dark and light picks; elsewhere a pick shows in its own mode', async ({ page }) => {
    const checked = (id) => page.locator(`#${id} input:checked`);
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await chooseSetting(page, 'dark-theme', 'nord');
    await expect(html(page)).toHaveAttribute('data-theme', 'nord');
    await chooseSetting(page, 'light-theme', 'paper');
    await expect(html(page)).toHaveAttribute('data-theme', 'nord');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(html(page)).toHaveAttribute('data-theme', 'paper');
    await expect(themeColor(page)).toHaveAttribute('content', '#fbf8f1');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html(page)).toHaveAttribute('data-theme', 'nord');
    await expect(checked('theme-select')).toHaveValue('system');

    await chooseSetting(page, 'theme-select', 'light');
    await expect(html(page)).toHaveAttribute('data-theme', 'paper');
    await chooseSetting(page, 'dark-theme', 'midnight');
    await expect(html(page)).toHaveAttribute('data-theme', 'midnight');
    await expect(checked('theme-select')).toHaveValue('dark');
    await expect(checked('light-theme')).toHaveValue('paper');
    await closeSettings(page);

    await page.keyboard.press('Control+k');
    await page.keyboard.type('light theme · swiss');
    await page.keyboard.press('Enter');
    await expect(html(page)).toHaveAttribute('data-theme', 'swiss');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('theme · system');
    await page.keyboard.press('Enter');
    await expect(html(page)).toHaveAttribute('data-theme', 'midnight');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(html(page)).toHaveAttribute('data-theme', 'swiss');
  });

  test('a guest’s pick is not kept after reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await openSettings(page);
    await chooseSetting(page, 'theme-select', 'light');
    await chooseSetting(page, 'font-size', '36');
    await expect(page.locator('body')).toHaveAttribute('data-font-size', '36');
    await chooseSetting(page, 'word-highlight', 'next');
    await expect(page.locator('body')).toHaveAttribute('data-word-highlight', 'next');
    expect(await storageKeys(page)).toEqual([]);
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveAttribute('data-font-size', '28');
    await expect(page.locator('#theme-select input:checked')).toHaveValue('system');
    await expect(page.locator('body')).toHaveAttribute('data-word-highlight', 'off');
    await expect(page.locator('#word-highlight input:checked')).toHaveValue('off');
  });
});

test('settings apply their display preferences', async ({ page }) => {
  await openApp(page);
  await openSettings(page);

  for (const [size, px] of [['22', '22px'], ['36', '34px'], ['28', '26px']]) {
    await chooseSetting(page, 'font-size', size);
    await expect(page.locator('#text-display')).toHaveCSS('font-size', px);
  }

  await chooseSetting(page, 'live-toggle', true);
  await expect(page.locator('body')).toHaveAttribute('data-live-metrics', 'true');
  await chooseSetting(page, 'keyboard-toggle', true);
  await expect(page.locator('#keyboard')).toBeVisible();
  await expect(page.locator('#keyboard .key')).toHaveCount(31);

  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await expect(page.locator('#settings-trigger')).toBeFocused();
});

test('focus mode has an explicit exit and answers Escape', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await chooseSetting(page, 'focus-toggle', true);
  await expect(page.locator('body')).toHaveAttribute('data-focus-mode', 'true');
  await expect(page.locator('#exit-focus')).toBeVisible();
  await closeSettings(page);
  await page.locator('#exit-focus').click();
  await expect(page.locator('body')).toHaveAttribute('data-focus-mode', 'false');
  await expect(page.locator('#typing-input')).toBeFocused();

  await openSettings(page);
  await chooseSetting(page, 'focus-toggle', true);
  await closeSettings(page);
  await page.locator('#typing-input').click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-focus-mode', 'false');
});

test.describe('command palette', () => {
  test('opens with Ctrl-K, filters, runs commands, returns focus and shows current state in its hints', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
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
  test('the key sequence and the palette toggle a moving pace caret that is never scored', async ({ page }) => {
    await openApp(page);
    await page.locator('#typing-input').blur();
    await pressSequence(page);
    await expect(page.locator('body')).toHaveAttribute('data-ghost', 'on');
    await expect(page.locator('#egg-toast')).toBeVisible();
    await expect(page.locator('#egg-feedback')).toHaveText('Ghost pacer · 60 wpm');
    await expect(page.locator('#typing-input')).toHaveValue('');

    // With the input focused, the sequence restarts the same passage without the stray "b".
    const passage = await passageText(page);
    await page.locator('#typing-input').focus();
    await pressSequence(page);
    await expect(page.locator('body')).toHaveAttribute('data-ghost', 'off');
    await expect(page.locator('#typing-input')).toHaveValue('');
    await expect(page.locator('#typing-status')).toHaveText('Ready');
    expect(await passageText(page)).toBe(passage);

    await page.keyboard.press('Control+k');
    await page.keyboard.type('ghost');
    await expect(page.locator('#palette-list [role="option"]').first()).toContainText('ghost pacer');
    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toHaveAttribute('data-ghost', 'on');

    const ghost = page.locator('#text-display .ghost-caret');
    await expect(ghost).not.toHaveClass(/is-hidden/);
    const text = await passageText(page);
    await typeInto(page, text[0]);
    const start = await ghost.evaluate((node) => node.style.transform);
    await expect.poll(() => ghost.evaluate((node) => node.style.transform), { timeout: 3000 }).not.toBe(start);
    await expect(page.locator('#typing-input')).toHaveValue(text[0]);

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

  for (const selector of ['.dock-zone', '.corner', '.practice-controls', '.site-footer', '.shortcut-row']) {
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

  test('every duration collapses to (effectively) zero', { tag: '@compat' }, async ({ page }) => {
    await openApp(page);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--motion-scale').trim())).toBe('0');

    for (const selector of ['.dock-zone', '#text-display']) {
      const durations = await page.locator(selector).evaluate((node) => getComputedStyle(node).transitionDuration.split(', '));
      // styles.css pins transitions to 1ms so transitionend still fires.
      expect(durations.every((value) => parseFloat(value) <= 0.001), `${selector} ${durations}`).toBe(true);
    }

    // The speed graph stays visible with no drawing animation.
    await chooseWords(page, 10);
    await completePassage(page);
    await expect(page.locator('#run-card')).toBeVisible();
    const line = page.locator('#speed-graph .graph-line');
    // A flat SVG path has a zero-height geometry box even when its stroke is painted.
    await expect(page.locator('#speed-graph svg')).toBeVisible();
    await expect(line).toBeAttached();
    await expect(line).not.toHaveCSS('stroke', 'none');
    await expect(line).toHaveAttribute('d', /^M.+ C/);
    const durations = await line.evaluate((node) => getComputedStyle(node).animationDuration.split(', '));
    expect(durations.every((value) => parseFloat(value) <= 0.001)).toBe(true);
    await expect(page.locator('#speed-graph')).toHaveAttribute('aria-label', /Speed over time/);
  });
});

// The palette closes on Escape's own frame, with no fade, so ⌘K pressed straight after opens it again (TOB-448: a
// fade once counted as open, and that press closed it a second time). The page's clock stands still, so nothing
// here waits on a timer.
test('Escape closes the palette at once, and the commands binding reopens it straight after', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette-input')).toBeFocused();
  await page.keyboard.press('Escape');
  expect(await page.locator('#palette').evaluate((dialog) => dialog.open)).toBe(false);
  await expect(page.locator('#typing-input')).toBeFocused();
  await page.keyboard.press('Control+k');
  expect(await page.locator('#palette').evaluate((dialog) => dialog.open)).toBe(true);
  await expect(page.locator('#palette-input')).toBeFocused();
  await page.locator('#palette-input').fill('practice c');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-text')).toHaveText('practice calendar');

  // Escape still closes it, and focus goes back where it was before the first press.
  await page.keyboard.press('Escape');
  expect(await page.locator('#palette').evaluate((dialog) => dialog.open)).toBe(false);
  await expect(page.locator('#typing-input')).toBeFocused();
});

// An exact prefix ranks first (TOB-448). A long fuzzy match gains on every letter it keeps in a row, so "practice c"
// once ranked "practice" (its letters, then the c of its own keywords) above "practice calendar".
test('the palette ranks a label that starts with the query above a fuzzy match', async ({ page }) => {
  await openApp(page);

  for (const [query, label] of [['practice c', 'practice calendar'], ['words · 10 w', 'words · 10 words'], ['words · 100', 'words · 100 words'],
    ['sound · clic', 'sound · clicks'], ['layout · dv', 'layout · dvorak'], ['app font · i', 'app font · inter']]) {
    await page.keyboard.press('Control+k');
    await page.locator('#palette-input').fill(query);
    await expect(page.locator('#palette-list [aria-selected="true"] .opt-text'), query).toHaveText(label);
    await page.keyboard.press('Escape');
  }

  // A label that holds the query ranks above one that only holds its letters in order.
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('calendar');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-text')).toHaveText('practice calendar');
});

test('a palette jump puts focus on the new screen’s heading, or in the passage on Practice', async ({ page }) => {
  await openApp(page);
  await page.locator('#account-trigger').focus();

  for (const [query, label, target] of [['challenge', 'challenge', '#compete-heading'], ['progress', 'progress', '#progress-heading'],
    ['train', 'train', '#train-heading'], ['practice', 'practice', '#typing-input']]) {
    await page.keyboard.press('Control+k');
    await page.locator('#palette-input').fill(query);
    await expect(page.locator('#palette-list [aria-selected="true"] .opt-label')).toHaveText(label);
    await page.keyboard.press('Enter');
    await expect(page.locator(target)).toBeFocused();
  }
});

async function holdJustInside(page, locator, edge) {
  const box = await locator.boundingBox();
  const x = { left: box.x + 0.5, right: box.x + box.width - 0.5 }[edge] ?? box.x + box.width / 2;
  const y = { top: box.y + 0.5, bottom: box.y + box.height - 0.5 }[edge] ?? box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
}

// A press scales its control to 97%. Held just inside an edge, the release must still land on the control the press
// began on, not on the neighbour or the group around both. Engines hit-test a little past a box's edge, so the check
// compares the two targets instead of naming one.
test('a press held just inside a control’s edge clicks the control it began on', { tag: '@compat' }, async ({ page }) => {
  await openApp(page);

  for (const edge of ['left', 'right', 'top', 'bottom']) {
    await page.locator('#mode-time').click();
    await expect(page.locator('#mode-time')).toHaveCSS('transform', 'none');
    await expect(page.locator('#mode-words')).toHaveCSS('transform', 'none');

    const targets = page.evaluate(() => new Promise((resolve) => {
      let down;

      document.addEventListener('pointerdown', (event) => { down = event.target.id; }, { once: true, capture: true });
      document.addEventListener('click', (event) => resolve({ down, click: event.target.id }), { once: true, capture: true });
    }));

    await holdJustInside(page, page.locator('#mode-words'), edge);
    const { down, click } = await targets;
    expect(down, edge).toMatch(/^mode-/);
    expect(click, edge).toBe(down);
    await expect(page.locator(`#${down}`), edge).toHaveAttribute('aria-pressed', 'true');
  }
});

// Audit TYP-97 P1-1 to P1-3: one challenge tab looks selected, the dock's visible words are in its
// accessible names at every width, and key hints stay off touch-only devices.

// The foot links of Challenge's people list each open one view, with Back to the list and focus back on the link.
const VIEWS = [['open-daily', 'challenge-daily-view', 'daily-heading'], ['open-local', 'challenge-local-view', 'local-heading']];

async function startLocalRace(page) {
  await page.locator('#open-local').click();
  await page.locator('#player-one-name').fill('Ada');
  await page.locator('#player-two-name').fill('Bo');
  await page.locator('#start-local-race').click();
  await expect(page.locator('#race-stage')).toBeVisible();
}

test.describe('challenge views', () => {
  for (const scheme of ['dark', 'light']) {
    test(`each foot link opens its view, and Back returns to the list, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openApp(page);
      await openView(page, 'Challenge');

      for (const [link, view, heading] of VIEWS) {
        await page.locator(`#${link}`).click();
        await expect(page.locator(`#${view}`)).toBeVisible();
        await expect(page.locator(`#${heading}`)).toBeFocused();
        await expect(page.locator('#challenge-people')).toBeHidden();
        await page.locator(`#${view} [data-challenge-back]`).click();
        await expect(page.locator('#challenge-people')).toBeVisible();
        await expect(page.locator(`#${link}`)).toBeFocused();
      }

      // Leaving Challenge and coming back opens the list again, wherever it was left.
      await startLocalRace(page);
      await openView(page, 'Progress');
      await openView(page, 'Challenge');
      await expect(page.locator('#challenge-people')).toBeVisible();
      await expect(page.locator('#challenge-local-view')).toBeHidden();
    });
  }
});

test.describe('dock labels at 320px', () => {
  test.use({ viewport: { width: 320, height: 568 }, ...phone });

  test('each visible word is in its accessible name, and none clips', async ({ page }) => {
    await openApp(page);
    const items = page.getByRole('navigation', { name: 'Main navigation' }).locator('.nav-item');

    const visible = await items.evaluateAll((buttons) => buttons.map((button) => [...button.childNodes]
      .flatMap((node) => (node.nodeType === Node.TEXT_NODE || node.getBoundingClientRect().width > 1 ? [node.textContent] : []))
      .join('').trim()));

    expect(visible).toEqual(['type', 'train', 'track', 'race']);
    const names = ['type practice', 'train', 'track progress', 'race challenge'];

    for (const [index, name] of names.entries()) {
      await expect(items.nth(index)).toHaveAccessibleName(name);
      expect(name.startsWith(visible[index])).toBe(true);
    }

    for (const overflow of await items.evaluateAll((buttons) => buttons.map((button) => button.scrollWidth - button.clientWidth))) {
      expect(overflow).toBeLessThanOrEqual(0);
    }

    // The full word stays in the name, so the specs' openView(page, 'Progress') still finds it.
    await openView(page, 'Progress');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'progress');
  });
});

test('dock names are the visible words at 1280px', async ({ page }) => {
  await openApp(page);
  const items = page.getByRole('navigation', { name: 'Main navigation' }).locator('.nav-item');

  for (const [index, name] of ['practice', 'train', 'progress', 'challenge'].entries()) {
    await expect(items.nth(index)).toHaveAccessibleName(name);
    await expect(items.nth(index)).toHaveText(name, { useInnerText: true });
  }
});

test.describe('key hints on a touch-only phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, ...phone });

  test('no esc hints in the one-keyboard race or on settings close', async ({ page }) => {
    await openApp(page);
    expect(await page.evaluate(() => [matchMedia('(any-pointer: coarse)').matches, matchMedia('(any-pointer: fine)').matches])).toEqual([true, false]);
    await openView(page, 'Challenge');
    await startLocalRace(page);
    await expect(page.locator('#race-help')).toHaveText('', { useInnerText: true });
    await expect(page.locator('#race-input')).not.toHaveAccessibleDescription(/restart/i);

    await openSettings(page);
    const close = page.locator('#settings-close');
    await expect(close).toHaveText('×', { useInnerText: true });
    await expect(close).toHaveAccessibleName('Close settings');
    const box = await close.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');
    await page.locator('#palette-trigger').click();
    await expect(page.locator('#palette .palette-search kbd')).toBeHidden();
  });
});

test('a fine pointer keeps the esc hints', async ({ page }) => {
  await openApp(page);
  await openView(page, 'Challenge');
  await startLocalRace(page);
  await expect(page.locator('#race-help')).toHaveText('esc restarts.', { useInnerText: true });
  await expect(page.locator('#race-input')).toHaveAccessibleDescription(/esc restarts\./);
  await page.keyboard.press('Escape');
  await openSettings(page);
  await expect(page.locator('#settings-close')).toHaveText(/esc\s*×/, { useInnerText: true });
});
