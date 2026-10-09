import { test, expect, chooseWords, openApp, openSettings, openView, passageText, typeInto } from './fixtures.js';

// Committed docs screenshots are only rewritten when SCREENSHOTS is set; normal runs write to test output.
const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/strict-space/${name}` : testInfo.outputPath(name));
const STRICT_NOTICE = 'Strict space is on. Type the next letter.';
const SUBMIT_NOTICE = 'The last word has a mistake. Fix it, or press space to finish.';
// A realistic typing pace for the runs that end up in screenshots.
const PACE = { delay: 140 };

async function setSwitch(page, id, on) {
  await openSettings(page);
  const toggle = page.locator(`#${id}`);
  if (on) await toggle.check();
  else await toggle.uncheck();
  await page.locator('details.preferences summary').click();
  await expect(page.locator('.preferences-popover')).toBeHidden();
}

// The first position from `from` inside a word of at least three letters, so a space there is early.
function midWord(text, from = 1) {
  return [...text].findIndex((char, i) => i >= from && /[a-z]/i.test(char) && /[a-z]/i.test(text[i - 1]) && /[a-z]/i.test(text[i + 1] || ''));
}

// Let switch slides and hover fades settle so a screenshot shows the resting state.
async function settle(page) {
  await page.mouse.move(1, 799);
  // The idle caret breathes forever, so only finite animations are awaited.
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => {}))));
}

const wrongFor = (char) => (char === 'x' ? 'z' : 'x');

test('by default a space typed mid-word takes that letter’s place, as before', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  const at = midWord(text);
  await typeInto(page, `${text.slice(0, at)} `);
  await expect(page.locator('#typing-input')).toHaveValue(`${text.slice(0, at)} `);
  await expect(page.locator('#text-display .char.wrong')).toHaveCount(1);
  await expect(page.locator('#input-help')).toHaveText('');
});

test('strict space refuses an early space, scores it once and keeps the word in place', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await chooseWords(page, 10);
  await setSwitch(page, 'strict-space-toggle', true);
  await expect(page.locator('#condition-line')).toContainText('continue on error · strict space');
  const text = await passageText(page);
  const at = midWord(text, 20);

  await typeInto(page, `${text.slice(0, at)} `, '#typing-input', PACE);
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, at));
  await expect(page.locator('#typing-wrap')).toHaveAttribute('data-blocked', 'true');
  await expect(page.locator('#text-display .char.wrong')).toHaveCount(0);
  await expect(page.locator('#input-help')).toHaveText(STRICT_NOTICE);
  await expect(page.locator('#announcement')).toHaveText(STRICT_NOTICE);
  await page.screenshot({ path: shot(testInfo, 'strict-space-dark.png') });

  // The next letter is still the one the space skipped; typing it clears the notice.
  await page.keyboard.type(text[at]);
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, at + 1));
  await expect(page.locator('#typing-wrap')).toHaveAttribute('data-blocked', 'false');
  await expect(page.locator('#input-help')).toHaveText('');
  // A space where the passage has one is typed as usual.
  await page.keyboard.type(text.slice(at + 1), PACE);

  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-errors')).toHaveText('1');
  expect(Number(await page.locator('#result-accuracy').textContent())).toBeLessThan(100);
  await expect(page.locator('#result-conditions')).toContainText('continue on error · strict space · corpus');
  await page.screenshot({ path: shot(testInfo, 'results-dark.png') });
});

test('with stop on error, strict space refuses the space without needing a backspace', async ({ page }) => {
  await openApp(page);
  await setSwitch(page, 'stop-on-error-toggle', true);
  await setSwitch(page, 'strict-space-toggle', true);
  const text = await passageText(page);
  const at = midWord(text);
  await typeInto(page, `${text.slice(0, at)} ${text.slice(at, at + 2)}`);
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, at + 2));
  await expect(page.locator('#typing-wrap')).toHaveAttribute('data-blocked', 'false');
});

test('quick end is on by default: a wrong last letter still ends a words run', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page);
  await expect(page.locator('#quick-end-toggle')).toBeEnabled();
  await expect(page.locator('#quick-end-toggle')).toBeChecked();
  await page.locator('details.preferences summary').click();
  const text = await passageText(page);
  await typeInto(page, text.slice(0, -1) + wrongFor(text.at(-1)));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-errors')).toHaveText('1');
  await expect(page.locator('#result-conditions')).not.toContainText('quick end');
});

test('quick end off waits on a wrong last word until space submits it', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openApp(page);
  await chooseWords(page, 10);
  await setSwitch(page, 'quick-end-toggle', false);
  await expect(page.locator('#condition-line')).toContainText('continue on error · quick end off');
  const text = await passageText(page);
  const typed = text.slice(0, -1) + wrongFor(text.at(-1));

  await typeInto(page, typed, '#typing-input', PACE);
  await expect(page.locator('#typing-status')).toHaveText('In progress');
  await expect(page.locator('#input-help')).toHaveText(SUBMIT_NOTICE);
  await expect(page.locator('#announcement')).toHaveText(SUBMIT_NOTICE);
  await expect(page.locator('#progress-track')).toHaveAttribute('aria-valuenow', '100');
  await page.screenshot({ path: shot(testInfo, 'quick-end-light.png') });

  // Letters have nowhere left to go; space finishes the run with the mistake standing.
  await page.keyboard.type('a');
  await expect(page.locator('#typing-input')).toHaveValue(typed);
  await expect(page.locator('#typing-status')).toHaveText('In progress');
  await page.keyboard.press('Space');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-errors')).toHaveText('1');
  await expect(page.locator('#result-conditions')).toContainText('continue on error · quick end off · corpus');
  await expect(page.locator('#run-again')).toBeFocused();
});

test('quick end off finishes as soon as the last word is fixed', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await setSwitch(page, 'quick-end-toggle', false);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, -1) + wrongFor(text.at(-1)));
  await expect(page.locator('#input-help')).toHaveText(SUBMIT_NOTICE);
  await page.keyboard.press('Backspace');
  await expect(page.locator('#input-help')).toHaveText('');
  await page.keyboard.type(text.at(-1));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-errors')).toHaveText('1');
});

test('quick end is disabled where it changes nothing, and the palette follows', async ({ page }) => {
  await openApp(page);
  // Timed runs end on the clock.
  await openSettings(page);
  await expect(page.locator('#quick-end-toggle')).toBeDisabled();
  await expect(page.locator('#quick-end-toggle')).not.toBeChecked();
  await page.locator('details.preferences summary').click();
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('quick end');
  await expect(page.locator('#palette-list [role="option"]', { hasText: 'quick end' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await chooseWords(page, 10);
  await openSettings(page);
  await expect(page.locator('#quick-end-toggle')).toBeEnabled();
  await expect(page.locator('#quick-end-toggle')).toBeChecked();
  // Stop on error already waits for every letter.
  await page.locator('#stop-on-error-toggle').check();
  await expect(page.locator('#quick-end-toggle')).toBeDisabled();
  await expect(page.locator('#quick-end-toggle')).not.toBeChecked();
  await page.locator('#stop-on-error-toggle').uncheck();
  await expect(page.locator('#quick-end-toggle')).toBeChecked();
  await page.locator('details.preferences summary').click();

  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('quick end');
  const option = page.locator('#palette-list [aria-selected="true"]');
  await expect(option).toContainText('quick end');
  await expect(option.locator('.opt-hint')).toHaveText('on');
  await page.keyboard.press('Enter');
  await expect(page.locator('#condition-line')).toContainText('quick end off');

  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('strict space');
  await expect(option).toContainText('strict space');
  await expect(option.locator('.opt-hint')).toHaveText('off');
  await page.keyboard.press('Enter');
  await expect(page.locator('#condition-line')).toContainText('strict space · quick end off');
});

test('the daily challenge keeps its fixed rules whatever these settings say', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await setSwitch(page, 'strict-space-toggle', true);
  await setSwitch(page, 'quick-end-toggle', false);
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await page.locator('#start-daily').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'daily');
  await expect(page.locator('#condition-line')).toContainText('continue on error · corpus');
  const text = await passageText(page);
  const at = midWord(text);
  await typeInto(page, `${text.slice(0, at)} `);
  await expect(page.locator('#typing-input')).toHaveValue(`${text.slice(0, at)} `);
});

test('a retest restores the baseline’s strict space and quick end', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await setSwitch(page, 'strict-space-toggle', true);
  await setSwitch(page, 'quick-end-toggle', false);
  const text = await passageText(page);
  await typeInto(page, text);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  // Changing them after the baseline doesn't change what the retest measures.
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('strict space');
  await page.keyboard.press('Enter');
  await page.locator('#skip-to-retest').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await expect(page.locator('#condition-line')).toContainText('strict space · quick end off');
});

test('strict space applies to a local challenge turn', async ({ page }) => {
  await openApp(page);
  await setSwitch(page, 'strict-space-toggle', true);
  await openView(page, 'Challenge');
  await page.locator('#challenge-local').click();
  await page.locator('#start-local-race').click();
  const text = await page.locator('#race-accessible-passage').textContent();
  const at = midWord(text);
  await typeInto(page, `${text.slice(0, at)} `, '#race-input');
  await expect(page.locator('#race-input')).toHaveValue(text.slice(0, at));
  await expect(page.locator('#race-help')).toHaveText(STRICT_NOTICE);
  await page.keyboard.type(text[at]);
  await expect(page.locator('#race-help')).toHaveText('Esc restarts.');
});

for (const scheme of ['dark', 'light']) {
  test(`settings rows screenshot (${scheme})`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page);
    await chooseWords(page, 25);
    await openSettings(page);
    await page.locator('#strict-space-toggle').check();
    await expect(page.locator('#condition-line')).toContainText('strict space');
    await settle(page);
    await page.screenshot({ path: shot(testInfo, `settings-${scheme}.png`) });
  });
}

test('settings rows fit a 390 px phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await chooseWords(page, 25);
  await openSettings(page);
  await page.locator('#strict-space-toggle').check();
  await page.locator('#quick-end-toggle').scrollIntoViewIfNeeded();
  await expect(page.locator('#quick-end-toggle')).toBeInViewport();
  await settle(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  await page.screenshot({ path: shot(testInfo, 'settings-mobile.png') });
});
