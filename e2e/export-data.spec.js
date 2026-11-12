// Export my data: the account menu and the palette save this device's copy of the profile as a file. Guards
// that the file is a stored copy the readers accept (normalizeProfile, the learner evaluation), that it holds
// the keystroke recordings typed here, and that the sign-in is never in it.
import { readFileSync } from 'node:fs';
import { test, expect, openApp, chooseWords, completePassage, signInWithEmail } from './fixtures.js';
import { normalizeProfile } from '../src/profile.js';

const FILE_NAME = /^stilltype-export-\d{4}-\d{2}-\d{2}\.json$/;

async function readDownload(download) {
  const text = readFileSync(await download.path(), 'utf8');

  return { text, data: JSON.parse(text) };
}

// A member types one 10-word run, then saves the file from the account menu.
async function exportFromMenu(page, supabase) {
  supabase.addUser('export@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'export@stilltype.test');
  await chooseWords(page, 10);
  await completePassage(page);
  await page.locator('#account-trigger').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#account-export').click()]);

  return download;
}

test('Export my data saves this device’s runs and recordings as a file a stored copy reader accepts', async ({ page, supabase }) => {
  const download = await exportFromMenu(page, supabase);
  expect(download.suggestedFilename()).toMatch(FILE_NAME);
  const { text, data } = await readDownload(download);
  expect(data.version).toBe(2);
  const read = normalizeProfile(data);
  expect(read.runs).toHaveLength(1);
  expect(read.attempts).toHaveLength(1);
  expect(read.attempts[0].events.length).toBeGreaterThan(0);
  expect(text).not.toContain('refresh_token');
  expect(text).not.toContain('access_token');
});

test('a guest exports the tab’s runs from the palette', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('export my data');
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  expect(download.suggestedFilename()).toMatch(FILE_NAME);
  const { data } = await readDownload(download);
  expect(data.version).toBe(2);
  expect(normalizeProfile(data).runs).toHaveLength(1);
});

test('the exported file is what the learner evaluation reads', async ({ page, supabase }) => {
  const { data } = await readDownload(await exportFromMenu(page, supabase));
  const { evaluateProfile } = await import('../scripts/evaluate-learner.mjs');
  const result = evaluateProfile(data, {});
  expect(typeof result.runs).toBe('number');
  expect(result.keyboard === undefined || typeof result.keyboard === 'string').toBe(true);
});
