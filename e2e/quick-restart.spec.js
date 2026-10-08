import { test, expect, openApp, passageText, typeInto, chooseWords, completePassage, openSettings, openView, signInWithEmail } from './fixtures.js';

test('tab as the restart key resets the passage, and esc still works', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await page.locator('#restart-key').selectOption('Tab');
  await expect(page.locator('#restart-key-hint')).toHaveText('tab');
  await page.keyboard.press('Escape');
  await expect(page.locator('.preferences-popover')).toBeHidden();

  const before = await passageText(page);
  await typeInto(page, before.slice(0, 3));
  await expect(page.locator('#text-display .char.correct')).toHaveCount(3);
  await page.keyboard.press('Tab');
  await expect(page.locator('#typing-input')).toBeFocused();
  await expect(page.locator('#text-display .char.correct')).toHaveCount(0);
  await expect(page.locator('#typing-input')).toHaveValue('');
  await expect(page.locator('body')).not.toHaveAttribute('data-running', 'true');

  // Esc keeps working alongside the chosen key.
  await typeInto(page, (await passageText(page)).slice(0, 2));
  await page.keyboard.press('Escape');
  await expect(page.locator('#text-display .char.correct')).toHaveCount(0);

  // From the result card, where finishing focuses run again, Tab starts a fresh run.
  await completePassage(page);
  await expect(page.locator('#run-again')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#typing-input')).toBeFocused();
});

test('esc, the default key, restarts from the focused run-again button', async ({ page }) => {
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

test('holding the restart key restarts once, not on every repeat', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await page.locator('#restart-key').selectOption('Tab');
  await page.keyboard.press('Escape');

  await typeInto(page, (await passageText(page)).slice(0, 3));
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

test('tab still moves focus inside the settings popover', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await page.locator('#restart-key').selectOption('Tab');
  await page.locator('#restart-key').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#live-toggle')).toBeFocused();
  await expect(page.locator('.preferences-popover')).toBeVisible();
});

test('enter restarts from the result card but not mid-run', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await page.locator('#restart-key').selectOption('Enter');
  await expect(page.locator('#restart-key-hint')).toHaveText('enter');
  await page.keyboard.press('Escape');

  const text = await passageText(page);
  await typeInto(page, text.slice(0, 3));
  await page.keyboard.press('Enter');
  await expect(page.locator('#text-display .char.correct')).toHaveCount(3);

  await page.keyboard.press('Escape');
  await completePassage(page);
  await expect(page.locator('#run-again')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#text-display .char.correct')).toHaveCount(0);
});

// Committed docs are only rewritten on purpose (SCREENSHOTS=1); a normal run keeps its captures in test output.
test('enter stays inert mid-run after the chrome returns via the practice nav', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await page.locator('#restart-key').selectOption('Enter');
  await page.keyboard.press('Escape');

  await typeInto(page, (await passageText(page)).slice(0, 3));
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  // Clicking the already-active practice nav shows the chrome but leaves the run going.
  await openView(page, 'Practice');
  await expect(page.locator('body')).not.toHaveAttribute('data-running', 'true');
  await page.locator('#typing-input').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#text-display .char.correct')).toHaveCount(3);
  await expect(page.locator('#typing-status')).toContainText('In progress');
});

for (const stored of ['toString', '__proto__']) {
  test(`a synced restart key of "${stored}" falls back to esc`, async ({ page, supabase }) => {
    const user = supabase.addUser(`restart-${stored.replace(/_/g, '')}@stilltype.test`);
    supabase.profiles.set(user.id, { data: { version: 2, preferences: { restartKey: stored }, attempts: [], runs: [], loops: [],
      seenTextIds: [], bests: {}, updatedAt: new Date(Date.now() + 60000).toISOString() } });
    await openApp(page);
    await signInWithEmail(page, user.email);
    await expect(page.locator('#restart-key')).toHaveValue('Escape');
    await expect(page.locator('#restart-key-hint')).toHaveText('esc');
  });
}

test('screenshots', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page);
    await openSettings(page);
    await page.locator('#restart-key').selectOption('Tab');
    const name = `settings-${scheme}.png`;
    await page.screenshot({ path: process.env.SCREENSHOTS ? `docs/screenshots/quick-restart/${name}` : testInfo.outputPath(name) });
  }
});
