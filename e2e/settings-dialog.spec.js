import { test, expect, openApp, openSettings, closeSettings, chooseSetting, chooseWords, passageText, typeInto, signInWithEmail } from './fixtures.js';

const dialog = (page) => page.getByRole('dialog', { name: 'Settings', exact: true });

test('native modal traps focus, keeps the page inert, and restores the opener on every close action', async ({ page }) => {
  await openApp(page);
  const trigger = page.getByRole('button', { name: 'Settings', exact: true });

  for (const close of ['Escape', 'Close settings', 'Done']) {
    await trigger.click();
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('[data-settings-category="appearance"]')).toBeFocused();
    await page.locator('#typing-input').focus();
    await expect(page.locator('#typing-input')).not.toBeFocused();
    await page.locator('#settings-done').focus();

    for (let step = 0; step < 16; step += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog(page).evaluate((node) => node.contains(document.activeElement) || document.activeElement === document.body)).toBe(true);
    }

    if (close === 'Escape') await page.keyboard.press(close);
    else await dialog(page).getByRole('button', { name: close, exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(trigger).toBeFocused();
  }
});

test('categories preserve shortcut edits and Escape cancels recording before closing without restarting', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  const text = await passageText(page);
  await chooseSetting(page, 'focus-toggle', true);
  await openSettings(page, 'shortcuts');
  await page.locator('#keybinding-restart').fill('F2');

  for (const category of ['appearance', 'practice', 'keyboard', 'sound', 'shortcuts']) {
    await openSettings(page, category);
    await expect(page.locator(`#settings-${category}`)).toBeVisible();
    await expect(page.locator(`[data-settings-category="${category}"]`)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator(`[data-settings-category="${category}"]`)).toHaveCSS('color', 'rgb(143, 209, 138)');
    await expect(page.locator('#settings-dialog .settings-category:visible')).toHaveCount(1);
  }

  await chooseSetting(page, 'theme-select', 'light');
  await openSettings(page, 'shortcuts');
  await expect(page.locator('#keybinding-restart')).toHaveValue('F2');
  await page.getByRole('button', { name: 'Record commands binding', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('#keybindings-status')).toHaveText('Recording cancelled.');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-focus-mode', 'true');
  await expect(page.locator('#exit-focus')).toBeFocused();
  expect(await passageText(page)).toBe(text);
  await expect(page.locator('#typing-status')).toHaveText('Ready');
});

test('Escape dismisses Settings before its commands binding and cancels recording first', async ({ page }) => {
  await openApp(page);
  await openSettings(page, 'shortcuts');

  for (const [action, value] of Object.entries({ restart: 'F2', commands: 'Escape', exitFocus: 'F8' })) {
    await page.locator(`#keybinding-${action}`).fill(value);
  }

  await page.locator('#keybinding-restart').press('Enter');
  await expect(page.locator('#keybindings-form [aria-invalid="true"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Record commands binding', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#keybindings-status')).toHaveText('Recording cancelled.');
  await expect(dialog(page)).toBeVisible();
  await page.locator('[data-settings-category="appearance"]').click();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('#settings-trigger')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#palette')).toBeHidden();
});

test('native radio arrows apply preferences, retain focus, and update the live sample without changing the passage', async ({ page }) => {
  await openApp(page);
  const text = await passageText(page);
  await openSettings(page, 'appearance');
  await page.locator('#font-size input:checked').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#font-size input[value="36"]')).toBeFocused();
  await expect(page.locator('body')).toHaveAttribute('data-font-size', '36');
  await expect(page.locator('#settings-preview-passage')).toHaveCSS('font-size', '36px');
  await chooseSetting(page, 'word-highlight', 'next');
  const previewWord = page.locator('#settings-preview-passage span').nth(3);
  await expect(previewWord).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await chooseSetting(page, 'tape-toggle', true);
  await expect(page.locator('#settings-preview-passage')).toHaveCSS('white-space', 'nowrap');
  await chooseSetting(page, 'theme-select', 'light');
  await expect(dialog(page)).toHaveCSS('background-color', 'rgb(251, 249, 245)');
  expect(await passageText(page)).toBe(text);
  await expect(page.locator('#typing-input')).toHaveValue('');
});

test('dependent controls explain their disabled states', async ({ page }) => {
  await openApp(page);
  await openSettings(page, 'practice');
  await expect(page.getByRole('group', { name: 'word list', exact: true })).toHaveAccessibleDescription('');
  await expect(page.locator('#quick-end-toggle input').first()).toBeDisabled();
  await expect(page.locator('#quick-end-note')).toHaveText('timed runs end on the clock');
  await openSettings(page, 'keyboard');
  await expect(page.locator('#finger-toggle input').first()).toBeDisabled();
  await chooseSetting(page, 'keyboard-toggle', true);
  await expect(page.locator('#finger-toggle input').first()).toBeEnabled();
  await openSettings(page, 'sound');
  await expect(page.getByRole('slider', { name: 'volume' })).toBeDisabled();
  await chooseSetting(page, 'sound-select', 'clicks');
  await expect(page.getByRole('slider', { name: 'volume' })).toBeEnabled();
});

for (const [key, id, remote, current, query] of [
  ['minAccuracy', 'min-accuracy', 95, 0, 'minimum accuracy · off'],
  ['minWpm', 'min-wpm', 60, 0, 'minimum speed · off'],
  ['repeatQuotes', 'repeat-quotes-toggle', true, false, null],
  ['numbers', 'numbers-toggle', true, false, null],
  ['wordList', 'word-list', '1k', '200', 'word list · top 200'],
  ['correction', 'correction-select', 'no-backspace', 'relaxed', 'correction · free'],
]) {
  for (const source of query ? ['radio', 'palette'] : ['radio']) {
    test(`same-value ${key} ${source} pick stamps over a queued remote preference without restarting`, async ({ page, context, supabase }) => {
      const user = supabase.addUser(`${key}-${source}@stilltype.test`);
      await openApp(page);
      await signInWithEmail(page, user.email);

      if (key === 'repeatQuotes') await page.locator('#mode-quote').click();
      else await chooseWords(page);
      const text = await passageText(page);
      const typed = text.slice(0, 3);
      await typeInto(page, typed);
      const other = await context.newPage();
      await supabase.attach(other);
      await openApp(other);
      await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
      await chooseSetting(other, id, remote);
      await expect.poll(() => supabase.profileFor(user.email)?.preferences?.[key]).toBe(remote);
      const remoteStamp = supabase.profileFor(user.email).preferencesAt[key];
      // The second tab came to the front; until the first is brought back it draws no frames.
      await page.bringToFront();
      await openSettings(page, 'practice');
      await expect(page.locator(`#${id} input:checked`)).toHaveValue(String(current));
      await expect(page.locator('#typing-input')).toHaveValue(typed);

      if (source === 'radio') await chooseSetting(page, id, current);
      else {
        await closeSettings(page);
        await page.keyboard.press('Control+k');
        await page.locator('#palette-input').fill(query);
        await page.locator('#palette-list [role="option"]', { hasText: query }).click();
      }

      await expect.poll(() => supabase.profileFor(user.email)?.preferences?.[key]).toBe(current);
      expect(supabase.profileFor(user.email).preferencesAt[key] > remoteStamp).toBe(true);
      await expect(page.locator('#typing-input')).toHaveValue(typed);
      expect(await passageText(page)).toBe(text);
      await closeSettings(page);
      await page.locator('#restart-button').click();
      await openSettings(page, 'practice');
      await expect(page.locator(`#${id} input:checked`)).toHaveValue(String(current));
      await other.close();
    });
  }
}

for (const [id, value] of [['numbers-toggle', false], ['word-list', '200'], ['correction-select', 'relaxed']]) {
  test(`picking the ${id} value already in use keeps a ready passage, a run under way and its results`, async ({ page }) => {
    await openApp(page);
    await chooseWords(page);
    const text = await passageText(page);
    await chooseSetting(page, id, value);
    await expect(dialog(page)).toBeVisible();
    expect(await passageText(page)).toBe(text);
    await closeSettings(page);
    await typeInto(page, text.slice(0, 3));
    await chooseSetting(page, id, value);
    await closeSettings(page);
    await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, 3));
    expect(await passageText(page)).toBe(text);
    await typeInto(page, text.slice(3));
    await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
    await chooseSetting(page, id, value);
    await closeSettings(page);
    await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  });
}

test('a binding another device saves shows in an open shortcut draft and survives saving the draft', async ({ page, context, supabase }) => {
  const user = supabase.addUser('bindings@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openSettings(page, 'shortcuts');
  await page.locator('#keybinding-exitFocus').fill('F8');
  await page.getByRole('button', { name: 'Record restart test / local challenge binding', exact: true }).click();
  const other = await context.newPage();
  await supabase.attach(other);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await openSettings(other, 'shortcuts');
  await other.locator('#keybinding-commands').fill('F9');
  await other.locator('#keybinding-restart').press('Enter');
  await expect.poll(() => supabase.profileFor(user.email)?.preferences?.keybindings?.commands).toBe('F9');
  await expect(page.locator('#keybinding-commands')).toHaveValue('F9');
  await expect(page.locator('#keybinding-exitFocus')).toHaveValue('F8');
  await page.keyboard.press('F2');
  await expect(page.locator('#keybinding-restart')).toHaveValue('F2');
  await closeSettings(page);
  await openSettings(page, 'shortcuts');
  await expect(page.locator('#keybinding-restart')).toHaveValue('F2');
  await expect(page.locator('#keybinding-exitFocus')).toHaveValue('F8');
  await page.locator('#keybinding-restart').press('Enter');
  await expect(page.locator('#keybindings-form [aria-invalid="true"]')).toHaveCount(0);
  await expect.poll(() => supabase.profileFor(user.email)?.preferences?.keybindings).toEqual({ restart: 'F2', commands: 'F9', exitFocus: 'F8' });
  await other.close();
});

test('palette opens shortcuts and import returns focus to a visible settings opener', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('keybindings');
  await page.keyboard.press('Enter');
  await expect(page.locator('#settings-shortcuts')).toBeVisible();
  await expect(page.locator('#keybinding-restart')).toBeFocused();
  await page.getByRole('button', { name: 'Import Monkeytype settings', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('#import-text')).toBeFocused();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#palette-trigger')).toBeFocused();
});

for (const [width, height, theme] of [[1440, 912, 'dark'], [1440, 912, 'light'], [320, 568, 'dark'], [375, 420, 'light']]) {
  test(`dialog fits ${width}×${height} ${theme} with a fixed footer`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: theme });
    await openApp(page);
    await openSettings(page, 'appearance');

    if (width === 1440) {
      const bounds = await dialog(page).boundingBox();
      expect(bounds.width).toBe(1080);
      expect(bounds.height).toBe(704);
      expect(await page.locator('.settings-nav').evaluate((node) => node.getBoundingClientRect().width)).toBe(216);
    }

    await page.screenshot({ path: testInfo.outputPath(`settings-${width}-${height}-${theme}.png`) });

    for (const category of ['appearance', 'practice', 'keyboard', 'sound', 'shortcuts']) {
      await openSettings(page, category);

      if (width === 1440 && category === 'practice') {
        const options = await page.locator('#correction-select .setting-option').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().y));
        expect(options).toHaveLength(5);
        expect(new Set(options).size).toBe(1);
        const label = await page.locator('#correction-select-label').boundingBox();
        const group = await page.locator('#correction-select').boundingBox();
        expect(label.y + label.height).toBeLessThanOrEqual(group.y);
      }

      const footer = await page.locator('.settings-footer').boundingBox();
      const controls = page.locator(`#settings-${category} input, #settings-${category} button`);

      for (const control of await controls.all()) {
        if (!(await control.isVisible())) continue;
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeInViewport();
        const bounds = await control.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }

      expect(await page.locator('.settings-footer').boundingBox()).toEqual(footer);
      await expect(page.locator('#settings-done')).toBeInViewport();
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await closeSettings(page);
  });
}
