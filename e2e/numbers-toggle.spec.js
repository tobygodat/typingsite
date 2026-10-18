import { test, expect, openApp, chooseWords, completePassage, passageText, openSettings, openView, signInWithEmail } from './fixtures.js';
import { dailyPassage } from '../src/insights.js';
import { quoteCorpus } from '../src/typing.js';

// Committed docs images are refreshed only with SCREENSHOTS=1; normal runs write to the test output.
const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/numbers-toggle/${name}` : testInfo.outputPath(name));

async function openTestContent(page) {
  await openSettings(page);
  const category = page.locator('#test-content-settings');
  if (!(await category.evaluate((node) => node.open))) await category.locator('summary').click();
  await expect(page.locator('#numbers-toggle')).toBeVisible();
}

async function numbersCommand(page, hint) {
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('numbers');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-hint')).toHaveText(hint);
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
}

test('numbers live in test content settings, default off, and keep practice bests separate', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await expect(page.locator('.practice-controls #numbers-toggle')).toHaveCount(0);
  await expect(page.locator('#numbers-toggle')).toBeHidden();
  await expect(page.locator('#numbers-toggle')).not.toBeChecked();
  expect(await passageText(page)).not.toMatch(/\d/);
  await completePassage(page);
  await expect(page.locator('#result-conditions')).not.toContainText('numbers');

  await page.locator('#run-again').click();
  await openSettings(page);
  await expect(page.locator('#test-content-settings')).not.toHaveAttribute('open');
  await expect(page.locator('#numbers-toggle')).toBeHidden();
  await openTestContent(page);
  await page.locator('#word-list').selectOption('1k');
  await expect(page.locator('#condition-line')).toContainText('english 1k');
  await page.locator('#word-list').selectOption('200');
  // By role: the label also holds the hidden "fixed for standard" note, which isn't part of its name.
  await page.getByRole('checkbox', { name: 'numbers', exact: true }).check();
  await expect(page.locator('#condition-line')).toContainText('numbers');
  await expect.poll(() => passageText(page)).toMatch(/\d/);
  await expect(page.locator('#best')).toHaveText('No best yet');
  await completePassage(page);
  await expect(page.locator('#result-conditions')).toContainText('numbers');
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');

  await openView(page, 'Progress');
  await page.getByRole('group', { name: 'Test' }).getByRole('button', { name: '10 words' }).click();
  await page.locator('.conditions-disclosure > summary').click();
  const variants = page.getByRole('combobox', { name: 'Conditions' });
  await expect(variants.locator('option')).toHaveCount(2);
  for (const label of await variants.locator('option').allTextContents()) {
    await variants.selectOption({ label });
    await expect(page.locator('#run-history .run-row')).toHaveCount(1);
  }
});

test('numbers command stays available and toggles timed passages both ways', async ({ page }) => {
  await openApp(page);
  await numbersCommand(page, 'off');
  await expect(page.locator('#numbers-toggle')).toBeChecked();
  await expect(page.locator('#condition-line')).toContainText('30 s');
  await expect(page.locator('#condition-line')).toContainText('numbers');
  expect(await passageText(page)).toMatch(/\d/);
  await numbersCommand(page, 'on');
  await expect(page.locator('#numbers-toggle')).not.toBeChecked();
  await expect(page.locator('#condition-line')).not.toContainText('numbers');
  expect(await passageText(page)).not.toMatch(/\d/);
});

test('fresh retests restore numbers from the baseline after the preference changes', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await numbersCommand(page, 'off');
  const baseline = await completePassage(page);
  await numbersCommand(page, 'on');
  await expect(page.locator('#numbers-toggle')).not.toBeChecked();
  await openView(page, 'Train');
  await page.locator('#skip-to-retest').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await expect(page.locator('#numbers-toggle')).toBeChecked();
  await expect(page.locator('#condition-line')).toContainText('numbers');
  expect(await passageText(page)).not.toBe(baseline);
  expect(await passageText(page)).toMatch(/\d/);
  await completePassage(page);
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect(page.locator('#comparison-panel')).toHaveAttribute('data-outcome', /^(improved|mixed|regressed|steady)$/);
});

test('quotes ignore numbers and preserve the practice preference', async ({ page }) => {
  await openApp(page);
  await numbersCommand(page, 'off');
  await page.locator('#mode-quote').click();
  const quote = await passageText(page);
  expect(quoteCorpus.some((item) => item.text === quote)).toBe(true);
  await expect(page.locator('#condition-line')).not.toContainText('numbers');
  await openTestContent(page);
  await expect(page.locator('#numbers-toggle')).toBeDisabled();
  await expect(page.locator('#numbers-toggle')).toBeChecked();
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('numbers');
  await expect(page.locator('#palette-list [role="option"] .opt-label').filter({ hasText: /^numbers$/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('#mode-time').click();
  await expect(page.locator('#numbers-toggle')).toBeEnabled();
  await expect(page.locator('#numbers-toggle')).toBeChecked();
  await expect(page.locator('#condition-line')).toContainText('numbers');
});

test('account reload retains numbers while daily text and scores stay unchanged', async ({ page, supabase }) => {
  const day = new Date('2026-10-11T12:00:00Z');
  await page.clock.install({ time: day });
  supabase.addUser('numbers@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'numbers@stilltype.test');
  await chooseWords(page, 10);
  await numbersCommand(page, 'off');
  await expect.poll(() => supabase.profileFor('numbers@stilltype.test')?.preferences.numbers).toBe(true);
  await page.reload();
  await expect(page.locator('#numbers-toggle')).toBeChecked();
  expect(await passageText(page)).toMatch(/\d/);
  await expect(page.locator('#test-content-settings')).not.toHaveAttribute('open');
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await page.locator('#start-daily').click();
  expect(await passageText(page)).toBe(dailyPassage(day).text);
  await expect(page.locator('#condition-line')).not.toContainText('numbers');
  await completePassage(page);
  await expect(page.locator('#result-delta')).toHaveText('Daily challenge complete');
  await expect.poll(() => supabase.profileFor('numbers@stilltype.test')?.runs.length).toBe(1);
  const profile = supabase.profileFor('numbers@stilltype.test');
  expect(profile.runs[0]).toMatchObject({ kind: 'daily', conditions: { numbers: false } });
  expect(profile.bests).toEqual({});
  expect(profile.preferences.numbers).toBe(true);
  await openView(page, 'Practice');
  await expect(page.locator('#condition-line')).toContainText('numbers');
  expect(await passageText(page)).toMatch(/\d/);
});

test('test content and its numbers switch work by keyboard at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await openApp(page);
  const settings = page.locator('details.preferences > summary');
  await settings.focus();
  await page.keyboard.press('Enter');
  const category = page.locator('#test-content-settings > summary');
  await category.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.locator('#word-list')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#numbers-toggle')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('#numbers-toggle')).toBeChecked();
  await expect(page.locator('#condition-line')).toContainText('numbers');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const bounds = await page.locator('#numbers-toggle').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  await page.keyboard.press('Escape');
  await expect(page.locator('.preferences-popover')).toBeHidden();
  await expect(settings).toBeFocused();
});

test('screenshots', async ({ page }, testInfo) => {
  test.skip(!process.env.SCREENSHOTS, 'docs screenshots only; run with SCREENSHOTS=1');
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    await openApp(page);
    await openTestContent(page);
    await page.locator('#numbers-toggle').check();
    await expect.poll(async () => /\d/.test(await passageText(page))).toBe(true);
    await page.screenshot({ path: shot(testInfo, `settings-${theme}.png`) });
    await page.keyboard.press('Escape');
    await page.screenshot({ path: shot(testInfo, `mode-bar-${theme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await chooseWords(page, 10);
  await completePassage(page);
  await expect(page.locator('#result-conditions')).toContainText('numbers');
  await page.screenshot({ path: shot(testInfo, 'run-card-dark.png') });
  await page.setViewportSize({ width: 320, height: 760 });
  await openView(page, 'Practice');
  await openTestContent(page);
  await page.screenshot({ path: shot(testInfo, 'settings-mobile.png') });
});
