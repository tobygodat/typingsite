import { test, expect, openApp, passageText, typeInto, chooseWords, completePassage, openSettings, openView, signInWithEmail } from './fixtures.js';

async function setRestart(page, binding) {
  await openSettings(page, 'shortcuts');
  await page.locator('#keybinding-restart').fill(binding);
  await page.locator('#keybinding-restart').press('Enter');
  await expect(page.locator('#keybindings-form [aria-invalid=\"true\"]')).toHaveCount(0);
}

test('tab as the restart key resets the passage once while held, and escape no longer restarts', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await setRestart(page, 'Tab');
  await expect(page.locator('#restart-key-hint')).toHaveText('tab');
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeHidden();

  const before = await passageText(page);
  await typeInto(page, before.slice(0, 3));
  await expect(page.locator('#text-display .char.correct')).toHaveCount(3);
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  // With a modifier held it is not the shortcut: Shift+Tab moves focus back and leaves the run alone.
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#typing-input')).not.toBeFocused();
  await expect(page.locator('#text-display .char.correct')).toHaveCount(3);
  await page.locator('#typing-input').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#typing-input')).toBeFocused();
  await expect(page.locator('#text-display .char.correct')).toHaveCount(0);
  await expect(page.locator('#typing-input')).toHaveValue('');
  await expect(page.locator('body')).not.toHaveAttribute('data-running', 'true');

  // Escape remains a dismissal key but does not override a custom restart binding.
  await typeInto(page, (await passageText(page)).slice(0, 2));
  await page.keyboard.press('Escape');
  await expect(page.locator('#text-display .char.correct')).toHaveCount(2);

  await page.locator('#typing-input').focus();
  await page.keyboard.down('Tab');
  await expect(page.locator('#text-display .char.correct')).toHaveCount(0);
  await typeInto(page, (await passageText(page)).slice(0, 2));
  // Further keydowns while Tab is still held arrive as repeats and must leave the run alone.
  await page.keyboard.down('Tab');
  await page.keyboard.down('Tab');
  await page.keyboard.up('Tab');
  await expect(page.locator('#typing-input')).toBeFocused();
  await expect(page.locator('#text-display .char.correct')).toHaveCount(2);
});

test('with tab as the key, tab from run again moves focus on and enter runs again', async ({ page }) => {
  // Tall enough for Run again to take focus below the score.
  await page.setViewportSize({ width: 1280, height: 1100 });
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await setRestart(page, 'Tab');
  await page.keyboard.press('Escape');

  await completePassage(page);
  await expect(page.locator('#run-again')).toBeFocused();
  // On the result card the palette names the key that works from run again, and hands focus back to it.
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette-list [role="option"]').filter({ hasText: 'restart test' }).locator('.opt-hint')).toHaveText('enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('#run-again')).toBeFocused();

  // Tab is ordinary navigation here: focus moves to the next result control and the result stays.
  const wpm = await page.locator('#result-wpm').textContent();
  await page.keyboard.press('Tab');
  await expect(page.locator('#run-again')).not.toBeFocused();
  await expect(page.locator('#results-screen :focus')).toHaveCount(1);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-wpm')).toHaveText(wpm);
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#run-again')).toBeFocused();

  // Enter activates run again. Held, it starts one run; its repeats leave that run alone.
  await page.keyboard.down('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#typing-input')).toBeFocused();
  await expect(page.locator('#text-display .char.correct')).toHaveCount(0);
  await typeInto(page, (await passageText(page)).slice(0, 2));
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(page.locator('#text-display .char.correct')).toHaveCount(2);

  // Back in the typing field, Tab still restarts mid-run.
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  await page.keyboard.press('Tab');
  await expect(page.locator('#typing-input')).toBeFocused();
  await expect(page.locator('#text-display .char.correct')).toHaveCount(0);
});

test('esc, the default key, restarts from the focused run-again button', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await openApp(page);
  await chooseWords(page, 10);
  await expect(page.locator('#restart-key-hint')).toHaveText('esc');
  await completePassage(page);
  await expect(page.locator('#run-again')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#typing-input')).toBeFocused();
  await expect(page.locator('#typing-status')).toContainText('Ready');
  await expect(page.locator('#text-display .char.correct')).toHaveCount(0);
});

test('tab still moves focus inside the settings dialog', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await setRestart(page, 'Tab');
  await page.locator('#keybinding-restart').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-record=restart]')).toBeFocused();
  await expect(page.locator('#settings-dialog')).toBeVisible();
});

test('enter restarts from the result card but not mid-run, even after the chrome returns', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await setRestart(page, 'Enter');
  await expect(page.locator('#restart-key-hint')).toHaveText('enter');
  await page.keyboard.press('Escape');

  const text = await passageText(page);
  await typeInto(page, text.slice(0, 3));
  await page.keyboard.press('Enter');
  await expect(page.locator('#text-display .char.correct')).toHaveCount(3);

  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  // Clicking the already-active practice nav shows the chrome but leaves the run going.
  await openView(page, 'Practice');
  await expect(page.locator('body')).not.toHaveAttribute('data-running', 'true');
  await page.locator('#typing-input').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#text-display .char.correct')).toHaveCount(3);
  await expect(page.locator('#typing-status')).toContainText('In progress');

  await page.locator('#restart-button').click({ force: true });
  await completePassage(page);
  // Run again is below the fold at 1280×800, so the result heading has focus, and the restart key works there too.
  await expect(page.locator('#results-heading')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#text-display .char.correct')).toHaveCount(0);
});

test('enter restarts from the bare page while the run is ready, but not mid-run', async ({ page }) => {
  const bodyFocused = () => page.evaluate(() => document.activeElement === document.body);
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await setRestart(page, 'Enter');
  await page.keyboard.press('Escape');

  // Enter on a control activates that control and never restarts: here it opens settings.
  const first = await passageText(page);
  await expect(page.locator('#settings-trigger')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeHidden();
  expect(await passageText(page)).toBe(first);

  // As at touch startup, nothing has focus and the run is ready: enter brings a fresh passage.
  await page.evaluate(() => document.activeElement?.blur());
  expect(await bodyFocused()).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(() => passageText(page)).not.toBe(first);
  await expect(page.locator('#typing-status')).toContainText('Ready');
  await expect(page.locator('body')).not.toHaveAttribute('data-running', 'true');
  await expect(page.locator('#text-display .char.correct')).toHaveCount(0);

  // Mid-run, enter from the bare page does nothing.
  const second = await passageText(page);
  await typeInto(page, second.slice(0, 3));
  await page.evaluate(() => document.activeElement?.blur());
  expect(await bodyFocused()).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator('#typing-status')).toContainText('In progress');
  await expect(page.locator('#text-display .char.correct')).toHaveCount(3);
  expect(await passageText(page)).toBe(second);
});

test('a synced restart key of "toString" falls back to esc', async ({ page, supabase }) => {
  const user = supabase.addUser('restart-toString@stilltype.test');
  supabase.profiles.set(user.id, { data: { version: 2, preferences: { restartKey: 'toString' }, attempts: [], runs: [], loops: [],
    seenTextIds: [], bests: {}, updatedAt: new Date(Date.now() + 60000).toISOString() } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await expect(page.locator('#keybinding-restart')).toHaveValue('Escape');
  await expect(page.locator('#restart-key-hint')).toHaveText('esc');
});

// Committed docs are only rewritten on purpose (SCREENSHOTS=1); a normal run keeps its captures in test output.
test('screenshots', async ({ page }, testInfo) => {
  test.skip(!process.env.SCREENSHOTS, 'docs screenshots only; run with SCREENSHOTS=1');
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page);
    await openSettings(page);
    await setRestart(page, 'Tab');
    const name = `settings-${scheme}.png`;
    await page.screenshot({ path: process.env.SCREENSHOTS ? `docs/screenshots/quick-restart/${name}` : testInfo.outputPath(name) });
  }
});
