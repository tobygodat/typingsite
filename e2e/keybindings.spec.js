import { test, expect, openApp, openSettings, chooseWords, passageText, typeInto, signInWithEmail, storageKeys, openView } from './fixtures.js';

async function editBindings(page, values) {
  await openSettings(page);
  const category = page.locator('.keybindings-category');
  if (await category.getAttribute('open') === null) await category.locator(':scope > summary').click();
  for (const [action, value] of Object.entries(values)) await page.locator(`#keybinding-${action}`).fill(value);
}
async function saveBindings(page) {
  await page.getByRole('button', { name: 'Save keybindings', exact: true }).click();
  await expect(page.locator('#keybindings-status')).toHaveText('Keybindings saved.');
  await page.keyboard.press('Escape');
}

test('modified restart requires exact modifiers, preserves typing, and ignores repeat / composition / AltGr', async ({ page }) => {
  await openApp(page);
  await chooseWords(page);
  await editBindings(page, { restart: 'Ctrl+Shift+E' });
  await saveBindings(page);
  await expect(page.locator('#restart-button')).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+E');
  let text = await passageText(page);
  await typeInto(page, text.slice(0, 3));
  await page.keyboard.press('Shift+A');
  await page.keyboard.press('Backspace');
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, 3));
  await page.keyboard.press('Control+e');
  await page.keyboard.press('Control+Shift+Alt+e');
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, 3));
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { altGraph: true }]) {
    await page.locator('#typing-input').evaluate((input, extra) => {
      const event = new KeyboardEvent('keydown', { key: 'E', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true, ...extra });
      if (extra.altGraph) Object.defineProperty(event, 'getModifierState', { value: () => true });
      input.dispatchEvent(event);
    }, extra);
    await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, 3));
  }
  await page.keyboard.press('Control+Shift+e');
  await expect(page.locator('#typing-input')).toHaveValue('');
  text = await passageText(page);
  await typeInto(page, text.slice(0, 2));
  await page.locator('#typing-input').evaluate((input) => input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'E', ctrlKey: true, shiftKey: true, repeat: true, bubbles: true, cancelable: true,
  })));
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, 2));
});

test('conflicts and invalid combinations leave saved bindings untouched, and can be swapped atomically', async ({ page }) => {
  await openApp(page);
  for (const [value, message] of [['Ctrl+K', 'Already used'], ['Shift+Tab', 'reserved'], ['a', 'Printable keys'], ['Ctrl+R', 'reserved'], ['Ctrl+Alt+E', 'AltGr']]) {
    await editBindings(page, { restart: value });
    await page.getByRole('button', { name: 'Save keybindings', exact: true }).click();
    await expect(page.locator('#keybinding-restart')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#keybinding-restart-error')).toContainText(message);
    await expect(page.locator('#restart-key-hint')).toHaveText('esc');
  }
  await editBindings(page, { restart: 'Mod+K', commands: 'F2' });
  await saveBindings(page);
  await typeInto(page, (await passageText(page)).slice(0, 2));
  await page.keyboard.press('Control+k');
  await expect(page.locator('#typing-input')).toHaveValue('');
  await expect(page.locator('#palette')).toBeHidden();
  await page.keyboard.press('F2');
  await expect(page.locator('#palette')).toBeVisible();
  await page.keyboard.press('F2');
  await expect(page.locator('#palette')).toBeHidden();
});

test('recording cannot launch commands, Escape cancels it, and Tab still navigates', async ({ page }) => {
  await openApp(page);
  await editBindings(page, {});
  const record = page.locator('[data-record=restart]');
  await record.click();
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('#keybinding-restart')).toHaveValue('Ctrl+K');
  await expect(page.locator('#restart-key-hint')).toHaveText('esc');
  await record.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.preferences-popover')).toBeVisible();
  await expect(record).toHaveAttribute('aria-pressed', 'false');
  await record.click();
  await page.keyboard.press('Tab');
  await expect(page.locator('#keybinding-commands')).toBeFocused();
  await expect(record).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Shift+Tab');
  await expect(record).toBeFocused();
});

test('custom commands / exit focus and menu dismissal have distinct priority', async ({ page }) => {
  await openApp(page);
  await editBindings(page, { restart: 'F2', commands: 'Ctrl+Shift+K', exitFocus: 'F8' });
  await saveBindings(page);
  await page.locator('#typing-input').focus();
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette')).toBeHidden();
  await page.keyboard.press('Control+Shift+k');
  await expect(page.locator('#palette')).toBeVisible();
  await page.keyboard.type('focus mode');
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-focus-mode', 'true');
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 2));
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-focus-mode', 'true');
  await page.keyboard.press('F8');
  await expect(page.locator('body')).toHaveAttribute('data-focus-mode', 'false');
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, 2));
  await page.mouse.move(5, 5); await page.mouse.move(40, 40);
  await page.locator('#account-trigger').click();
  await page.locator('#account-signin').focus();
  await page.keyboard.press('F2');
  await expect(page.locator('#account')).toHaveAttribute('open', '');
  await expect(page.locator('#palette')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#account')).not.toHaveAttribute('open', '');
  await expect(page.locator('#account-trigger')).toBeFocused();
  await page.locator('#account-trigger').click();
  await page.locator('#account-signin').click();
  await page.locator('#account-email-input').fill('normal@example.test');
  await page.keyboard.press('F2');
  await page.keyboard.press('Control+Shift+k');
  await expect(page.locator('#account-dialog')).toBeVisible();
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('#account-email-input')).toHaveValue('normal@example.test');
  await page.keyboard.press('Escape');
  await expect(page.locator('#account-dialog')).toBeHidden();
});

test('members retain bindings across reload and cloud sync; reset and disabling work', async ({ page, supabase }) => {
  const user = supabase.addUser('keybindings@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, user.email);
  await editBindings(page, { restart: 'F2', commands: 'Alt+Shift+K', exitFocus: '' });
  await saveBindings(page);
  await expect.poll(() => supabase.profiles.get(user.id)?.data?.preferences?.keybindings).toEqual({ restart: 'F2', commands: 'Alt+Shift+K', exitFocus: '' });
  await page.reload();
  await expect(page.locator('#restart-key-hint')).toHaveText('f2');
  await expect(page.locator('#palette-trigger')).toHaveAttribute('aria-keyshortcuts', 'Alt+Shift+K');
  await expect(page.locator('#exit-focus')).not.toHaveAttribute('aria-keyshortcuts', /.+/);
  await editBindings(page, { restart: '', commands: '' });
  await saveBindings(page);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 2));
  await page.keyboard.press('F2');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+Shift+k');
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, 2));
  await expect(page.locator('#palette')).toBeHidden();
  await page.locator('#palette-trigger').click({ force: true });
  await expect(page.locator('#palette')).toBeVisible();
  await page.keyboard.type('keybindings');
  await page.keyboard.press('Enter');
  await expect(page.locator('#keybinding-restart')).toBeFocused();
  await page.getByRole('button', { name: 'Reset defaults', exact: true }).click();
  await expect(page.locator('#restart-key-hint')).toHaveText('esc');
  await expect(page.locator('#palette-trigger')).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
  // Master defers network work until the interrupted run ends; the device cache saves immediately.
  expect(await page.evaluate((id) => JSON.parse(localStorage.getItem(`stilltype-profile-v2:${id}`)).preferences.keybindings.restart, user.id)).toBe('Escape');
  await page.keyboard.press('Escape');
  await page.locator('#typing-input').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#typing-status')).toHaveText('Ready');
  await expect.poll(() => supabase.profiles.get(user.id)?.data?.preferences?.keybindings?.restart).toBe('Escape');
});

test('guests keep bindings in the tab and legacy cloud preferences migrate safely', async ({ page, supabase }) => {
  await openApp(page);
  await editBindings(page, { restart: 'F2' });
  await saveBindings(page);
  expect(await storageKeys(page)).toEqual([]);
  await page.reload();
  await expect(page.locator('#restart-key-hint')).toHaveText('esc');
  const user = supabase.addUser('legacy-keybindings@stilltype.test');
  supabase.profiles.set(user.id, { data: { version: 2, preferences: { restartKey: 'Tab' }, updatedAt: new Date(Date.now() + 60000).toISOString() } });
  await signInWithEmail(page, user.email);
  await expect(page.locator('#restart-key-hint')).toHaveText('tab');
});

test('local challenge uses restart while setup fields preserve normal keyboard input', async ({ page }) => {
  await openApp(page);
  await editBindings(page, { restart: 'F2' });
  await saveBindings(page);
  await openView(page, 'Challenge');
  await page.locator('#challenge-local').click();
  await page.locator('#player-one-name').fill('Toby');
  await page.keyboard.press('F2');
  await expect(page.locator('#player-one-name')).toHaveValue('Toby');
  await page.locator('#player-two-name').fill('Sam');
  await page.locator('#compete-setup button[type=submit]').click();
  await page.locator('#race-input').focus();
  await page.keyboard.type('abc');
  await expect(page.locator('#race-input')).toHaveValue('abc');
  await page.keyboard.press('F2');
  await expect(page.locator('#race-input')).toHaveValue('');
  await expect(page.locator('#race-input')).toBeFocused();
});

for (const width of [1280, 320]) {
  test(`keybindings controls remain reachable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await openApp(page);
    await editBindings(page, {});
    await page.locator('#keybinding-commands').scrollIntoViewIfNeeded();
    await expect(page.locator('#keybinding-commands')).toBeVisible();
    for (const height of await page.locator('.keybindings-category .btn').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height))) {
      expect(height).toBeGreaterThanOrEqual(44);
    }
    const bounds = await page.locator('.preferences-popover').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`keybindings-${width}.png`) });
  });
}

for (const keybindings of [{ restart: 'Ctrl+K' }, { restart: 'a', commands: '__proto__', exitFocus: 12 }]) {
  test(`malformed synced bindings fall back safely: ${JSON.stringify(keybindings)}`, async ({ page, supabase }) => {
    const user = supabase.addUser('malformed-bindings@stilltype.test');
    supabase.profiles.set(user.id, { data: { version: 2, preferences: { keybindings }, updatedAt: new Date(Date.now() + 60000).toISOString() } });
    await openApp(page);
    await signInWithEmail(page, user.email);
    await expect(page.locator('#restart-key-hint')).toHaveText('esc');
    await page.locator('#typing-input').focus();
    await page.keyboard.press('Control+k');
    await expect(page.locator('#palette')).toBeVisible();
  });
}

test('held printable input is ignored and a held Escape exits focus without restarting the run', async ({ page }) => {
  await openApp(page);
  await chooseWords(page);
  const text = await passageText(page);
  await page.locator('#typing-input').focus();
  await page.keyboard.down(text[0]);
  await page.keyboard.down(text[0]);
  await page.keyboard.up(text[0]);
  await expect(page.locator('#typing-input')).toHaveValue(text[0]);
  await expect(page.locator('#input-help')).toHaveText('Key repeat ignored.');
  await page.mouse.move(5, 5); await page.mouse.move(40, 40);
  await openSettings(page);
  await page.locator('#focus-toggle').check();
  await page.locator('#typing-input').click();
  await page.keyboard.down('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-focus-mode', 'false');
  await page.keyboard.down('Escape');
  await page.keyboard.up('Escape');
  await expect(page.locator('#typing-input')).toHaveValue(text[0]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#typing-input')).toHaveValue('');
});


test('test content and keybindings coexist, and resetting bindings preserves numbers', async ({ page }) => {
  await openApp(page);
  await chooseWords(page);
  await editBindings(page, { restart: 'F2', commands: 'F8' });
  await saveBindings(page);
  await openSettings(page);
  await page.locator('#test-content-settings > summary').click();
  await page.locator('#numbers-toggle').check();
  await page.locator('#typing-input').click();
  await typeInto(page, (await passageText(page)).slice(0, 3));
  await page.keyboard.press('F2');
  await expect(page.locator('#typing-input')).toHaveValue('');
  await expect(page.locator('#condition-line')).toContainText('numbers');
  expect(await passageText(page)).toMatch(/\d/);
  await editBindings(page, {});
  await page.getByRole('button', { name: 'Reset defaults', exact: true }).click();
  await expect(page.locator('#numbers-toggle')).toBeChecked();
  await expect(page.locator('#condition-line')).toContainText('numbers');
  // Commands remain accessible from a settings category, without taking over its text fields.
  await page.locator('.keybindings-category > summary').focus();
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette')).toBeVisible();
  await expect(page.locator('.preferences-popover')).toBeHidden();
  await page.locator('#palette-input').fill('numbers');
  await page.keyboard.press('Enter');
  await expect(page.locator('#condition-line')).not.toContainText('numbers');
  await expect(page.locator('#restart-key-hint')).toHaveText('esc');
});

test('unsaved binding edits survive unrelated settings updates', async ({ page }) => {
  await openApp(page);
  await editBindings(page, { restart: 'Ctrl+Shift+E' });
  await page.locator('#font-size').selectOption('36');
  await expect(page.locator('#keybinding-restart')).toHaveValue('Ctrl+Shift+E');
  await page.locator('#live-toggle').check();
  await expect(page.locator('#keybinding-restart')).toHaveValue('Ctrl+Shift+E');
  await saveBindings(page);
  await expect(page.locator('#restart-button')).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+E');
});

test('Mod+Alt cannot bypass the AltGr safety rule', async ({ page }) => {
  await openApp(page);
  await editBindings(page, { commands: 'Mod+Alt+K' });
  await page.getByRole('button', { name: 'Save keybindings', exact: true }).click();
  await expect(page.locator('#keybinding-commands')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#keybinding-commands-error')).toContainText('AltGr');
});


test('composing keeps its finish command and configured restart hint', async ({ page }) => {
  await openApp(page);
  await editBindings(page, { restart: 'F2' });
  await saveBindings(page);
  await page.locator('#mode-compose').click();
  await expect(page.locator('.compose-shortcut .restart-key-hint')).toHaveText('f2');
  await typeInto(page, 'my words', '#compose-input');
  await page.keyboard.press('Escape');
  await expect(page.locator('#compose-input')).toHaveValue('my words');
  await page.keyboard.press('F2');
  await expect(page.locator('#compose-input')).toHaveValue('');
  await typeInto(page, 'more words', '#compose-input');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#compose-result')).toBeVisible();
});


test('explicit keybindings reselect is recorded as a fresh preference choice', async ({ page, supabase }) => {
  const user = supabase.addUser('choice-19@stilltype.test');
  const stamp = '2000-01-01T00:00:00.000Z';
  supabase.profiles.set(user.id, { data: { version: 2, preferences: { keybindings: {"restart": "Escape", "commands": "Mod+K", "exitFocus": "Escape"} }, preferencesAt: { keybindings: stamp },
    attempts: [], runs: [], loops: [], seenTextIds: [], bests: {}, updatedAt: stamp } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await editBindings(page, {});
  await saveBindings(page);
  await expect.poll(() => supabase.profileFor(user.email)?.preferencesAt?.keybindings).not.toBe(stamp);
  expect(supabase.profileFor(user.email).preferences.keybindings).toEqual({"restart": "Escape", "commands": "Mod+K", "exitFocus": "Escape"});
});
