// Import from Monkeytype: its exported settings JSON, pasted or from a file, becomes Stilltype's settings,
// with a report of what was brought over and what was left; signed in, the settings sync to the account.
import { test, expect, openApp, openSettings, signInWithEmail } from './fixtures.js';

const EXPORT = {
  theme: 'serika', autoSwitchTheme: false, customTheme: false, punctuation: true, numbers: false, words: 50, time: 45,
  mode: 'words', quoteLength: [1], language: 'english_1k', fontSize: 3, stopOnError: 'off', paceCaret: 'pb',
  paceCaretCustomSpeed: 100, liveSpeedStyle: 'text', liveAccStyle: 'off', keymapMode: 'off', caretStyle: 'line',
  difficulty: 'expert', confidenceMode: 'off', minAcc: 'custom', minAccCustom: 96, layout: 'dvorak',
};

async function openImport(page) {
  await openSettings(page);
  await page.getByRole('button', { name: /Import Monkeytype settings/ }).click();
  await expect(page.locator('#import-dialog')).toBeVisible();
  await expect(page.locator('#import-text')).toBeFocused();
}

test('a pasted Monkeytype export sets the matching settings and reports what it left', async ({ page }) => {
  await openApp(page);
  await openImport(page);
  await expect(page.locator('#confirm-import')).toBeDisabled();
  await page.locator('#import-text').fill('{ "mode": "time"');
  await page.locator('#confirm-import').click();
  await expect(page.locator('#import-error')).toContainText('valid JSON');

  await page.locator('#import-text').fill(JSON.stringify(EXPORT));
  await page.locator('#confirm-import').click();
  await expect(page.locator('#import-report')).toBeVisible();
  await expect(page.locator('#import-summary')).toContainText('Guest mode keeps them for this visit only');
  await expect(page.locator('#import-mapped li', { hasText: 'word list' })).toContainText('top 1k');
  await expect(page.locator('#import-mapped li', { hasText: 'word list' })).toContainText('language: english_1k');
  await expect(page.locator('#import-mapped li', { hasText: 'time length' })).toContainText('45 s (custom)');
  await expect(page.locator('#import-mapped li', { hasText: 'minimum accuracy' })).toContainText('95% (rounded down from 96%)');
  await expect(page.locator('#import-skipped li')).toHaveCount(1);
  await expect(page.locator('#import-skipped li')).toContainText('keyboard layout');
  await expect(page.locator('#import-skipped li')).toContainText('doesn’t remap keys');
  await expect(page.locator('#import-dialog')).not.toContainText('caretStyle');
  await page.locator('#import-done').click();
  await expect(page.locator('#import-dialog')).toBeHidden();

  await expect(page.locator('#mode-words')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#duration-options button[aria-pressed="true"]')).toHaveText('50');
  await expect(page.locator('#condition-line')).toContainText('english 1k');
  await expect(page.locator('body')).toHaveAttribute('data-font-size', '36');
  await expect(page.locator('body')).toHaveAttribute('data-live-metrics', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await openSettings(page);
  await expect(page.locator('#pace-select input:checked')).toHaveValue('best');
  await expect(page.locator('#punctuation-toggle')).toBeChecked();
  await expect(page.locator('#correction-select input:checked')).toHaveValue('fail-word');
  await expect(page.locator('#min-accuracy input:checked')).toHaveValue('95');
  await expect(page.locator('#layout-select input:checked')).toHaveValue('qwerty');
});

test('signed in, imported settings from a chosen file sync to the account', async ({ page, supabase }) => {
  const email = 'import@stilltype.test';
  supabase.addUser(email);
  await openApp(page);
  await signInWithEmail(page, email);
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('monkeytype');
  await page.keyboard.press('Enter');
  await expect(page.locator('#import-dialog')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#import-choose').click();
  await (await chooser).setFiles({ name: 'monkeytype.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...EXPORT, time: 60, mode: 'time', layout: 'default' })) });
  await expect(page.locator('#import-text')).toHaveValue(/"language":"english_1k"/);
  await page.locator('#confirm-import').click();
  await expect(page.locator('#import-summary')).toContainText('saved to your account');
  await expect(page.locator('#import-skipped-group')).toBeHidden();
  await page.locator('#import-done').click();

  await expect.poll(() => supabase.profileFor(email)?.preferences.wordList).toBe('1k');
  const { preferences, preferencesAt } = supabase.profileFor(email);
  expect(preferences).toMatchObject({
    mode: 'time', duration: 60, count: 50, punctuation: true, theme: 'light', fontSize: '36', paceCaret: 'best', liveMetrics: true,
    correction: 'fail-word', minAccuracy: 95,
  });
  expect(Object.keys(preferencesAt)).toEqual(expect.arrayContaining(['mode', 'duration', 'wordList', 'theme', 'paceCaret', 'correction', 'minAccuracy']));
});
