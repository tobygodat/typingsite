// Monkeytype settings import: a pasted settings export sets the matching settings and syncs them.
import { test, expect, openApp, openSettings, signInWithEmail } from './fixtures.js';

const exported = JSON.stringify({
  mode: 'words', words: 50, time: 60, punctuation: true, numbers: false, language: 'english_1k', stopOnError: 'off',
  paceCaret: 'custom', paceCaretCustomSpeed: 95, liveSpeedStyle: 'text', keymapMode: 'off', fontSize: 2,
  theme: 'serika_dark', funbox: ['mirror'], layout: 'default',
});

async function importExport(page, text) {
  await openSettings(page);
  await page.locator('#open-monkeytype').click();
  const dialog = page.locator('#monkeytype-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#monkeytype-text')).toBeFocused();
  await expect(page.locator('#import-monkeytype')).toBeDisabled();
  await page.locator('#monkeytype-text').fill(text);
  await page.locator('#import-monkeytype').click();
  return dialog;
}

test('a pasted export sets the matching settings and names what has no match', async ({ page }) => {
  await openApp(page);
  const dialog = await importExport(page, 'not an export');
  await expect(page.locator('#monkeytype-error')).toContainText('import/export settings');

  await page.locator('#monkeytype-text').fill(exported);
  await page.locator('#import-monkeytype').click();
  await expect(page.locator('#monkeytype-applied li')).toContainText(['mode: words', 'words: 50', 'word list: top 1k', 'pace caret: custom', 'custom pace: 95 wpm']);
  await expect(page.locator('#monkeytype-skipped li')).toContainText(['theme “serika_dark” (Stilltype keeps its own dark and light themes)', 'funbox']);
  await expect(page.locator('#monkeytype-lede')).toContainText('Sign in to keep them');
  await page.locator('#done-monkeytype').click();
  await expect(dialog).toBeHidden();

  await expect(page.locator('#condition-line')).toContainText('50 words');
  await expect(page.locator('#pace-label')).toHaveText('pace 95 wpm');
  await expect(page.locator('body')).toHaveAttribute('data-live-metrics', 'true');
  await openSettings(page);
  await expect(page.locator('#word-list')).toHaveValue('1k');
  await expect(page.locator('#pace-select')).toHaveValue('custom');
  await expect(page.locator('#punctuation-toggle')).toBeChecked();
});

test('the palette opens the import, and an imported setting syncs to the account', async ({ page, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('import monkeytype');
  await page.keyboard.press('Enter');
  await expect(page.locator('#monkeytype-dialog')).toBeVisible();
  await page.locator('#monkeytype-text').fill(exported);
  await page.locator('#import-monkeytype').click();
  await expect(page.locator('#monkeytype-lede')).toHaveText('These settings are saved and will sync to your account.');
  await expect.poll(() => supabase.profileFor('ada@stilltype.test')?.preferences).toMatchObject({ mode: 'words', count: 50, wordList: '1k', paceCaret: 'custom', paceWpm: 95 });
});
