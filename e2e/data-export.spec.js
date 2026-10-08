import fs from 'node:fs/promises';
import { test, expect, openApp, chooseWords, completePassage, openSettings } from './fixtures.js';

const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function finishShortRun(page) {
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
}

test('exports run history as CSV from settings', async ({ page }) => {
  await finishShortRun(page);
  await openSettings(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-csv').click()]);
  expect(download.suggestedFilename()).toBe(`stilltype-runs-${today()}.csv`);
  const csv = await fs.readFile(await download.path(), 'utf8');
  const lines = csv.trim().split('\r\n');
  expect(lines[0]).toBe('date,mode,length,word list,punctuation,difficulty,input,correction policy,corpus,metric version,wpm,accuracy,errors,duration,kind,interrupted');
  expect(lines).toHaveLength(2);
  expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2}T.*,words,10 words,.*,physical keyboard,.*,original-en-v\d+,stilltype-metrics-v\d+,/);
});

test('exports all data as pretty JSON, also from the palette', async ({ page }) => {
  await finishShortRun(page);
  await openSettings(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-json').click()]);
  expect(download.suggestedFilename()).toBe(`stilltype-data-${today()}.json`);
  const text = await fs.readFile(await download.path(), 'utf8');
  expect(text).toContain('\n  "');
  const data = JSON.parse(text);
  expect(data.runs).toHaveLength(1);
  expect(data.runs[0].conditions.mode).toBe('words');
  expect(data).toHaveProperty('preferences');

  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('export runs');
  const [paletteDownload] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  expect(paletteDownload.suggestedFilename()).toBe(`stilltype-runs-${today()}.csv`);
});

for (const scheme of ['dark', 'light']) {
  test(`screenshot: settings popover with export buttons (${scheme})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page);
    await openSettings(page);
    await expect(page.locator('#export-csv')).toBeVisible();
    await page.locator('.preferences-popover').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    // Committed docs are only rewritten on purpose (SCREENSHOTS=1); normal runs keep the capture as test output.
    const name = `settings-export-${scheme}.png`;
    await page.screenshot({ path: process.env.SCREENSHOTS ? `docs/screenshots/data-export/${name}` : testInfo.outputPath(name) });
  });
}
