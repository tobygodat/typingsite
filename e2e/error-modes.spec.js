import { test, expect, chooseWords, openApp, openView, passageText, typeInto } from './fixtures.js';

// Committed docs screenshots are only rewritten when SCREENSHOTS is set; normal runs write to test output.
const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/error-modes/${name}` : testInfo.outputPath(name));

async function chooseCorrection(page, policy) {
  await page.locator('details.preferences > summary').click();
  await page.locator('#correction-select').selectOption(policy);
  await page.locator('details.preferences > summary').click();
}

test('fail on any error ends the run as failed on the first wrong key', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await chooseCorrection(page, 'fail-any');
  await expect(page.locator('#condition-line')).toContainText('fail on any error');
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 12) + (text[12] === 'x' ? 'z' : 'x'), '#typing-input', { delay: 150 });
  await expect(page.locator('#result-delta')).toHaveText('failed · wrong key');
  await expect(page.locator('#run-card-stamp')).toContainText('failed · wrong key');
  await page.screenshot({ path: shot(testInfo, 'failed-run-card.png') });
});

// The passage has no trailing space, so the last letter must be judged before the run completes.
for (const [policy, reason] of [['fail-any', 'wrong key'], ['fail-word', 'word error']]) {
  test(`${policy} fails a run whose last letter is wrong`, async ({ page }) => {
    await openApp(page);
    await chooseWords(page, 10);
    await chooseCorrection(page, policy);
    const text = await passageText(page);
    await typeInto(page, text.slice(0, -1) + (text.at(-1) === 'x' ? 'z' : 'x'));
    await expect(page.locator('#result-delta')).toHaveText(`failed · ${reason}`);
    await expect(page.locator('#best')).toHaveText('No best yet');
  });
}

// The timer is a word boundary too: a wrong letter left mid-word when time runs out fails the run.
test('fail on word error fails a timed run that ends on an unfinished wrong word', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await chooseCorrection(page, 'fail-word');
  await page.locator('#duration-options [data-length="15"]').click();
  await expect(page.locator('#timer')).toHaveText('15');
  const text = await passageText(page);
  const at = [...text].findIndex((char, index) => index >= 10 && char !== ' ' && text[index + 1] !== ' ');
  await typeInto(page, text.slice(0, at) + (text[at] === 'x' ? 'z' : 'x'));
  await expect(page.locator('#typing-status')).toHaveText('In progress');
  await page.clock.fastForward(15_000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('failed · word error');
  await expect(page.locator('#best')).toHaveText('No best yet');
});

test('fail on any error ends a local challenge turn as failed', async ({ page }) => {
  await openApp(page);
  await chooseCorrection(page, 'fail-any');
  await openView(page, 'Challenge');
  await page.locator('#challenge-local').click();
  await page.locator('#start-local-race').click();
  const text = await page.locator('#race-accessible-passage').textContent();
  await typeInto(page, text.slice(0, 5) + (text[5] === 'x' ? 'z' : 'x'), '#race-input');
  await expect(page.locator('#race-handoff')).toBeVisible();
  await page.locator('#start-next-player').click();
  await typeInto(page, text, '#race-input');
  await expect(page.locator('#race-leaderboard')).toBeVisible();
  await expect(page.locator('#race-winner')).toHaveText('A fair result needs two uninterrupted runs.');
  await expect(page.locator('.race-result-row').nth(1)).toContainText('failed · wrong key');
});

test('no backspace ignores Backspace', async ({ page }) => {
  await openApp(page);
  await chooseCorrection(page, 'no-backspace');
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 2));
  await page.keyboard.press('Backspace');
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, 2));
  await page.keyboard.type(text[2]);
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, 3));
});

for (const scheme of ['dark', 'light']) {
  test(`settings select screenshot (${scheme})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page);
    await page.locator('details.preferences > summary').click();
    await page.locator('#correction-select').selectOption('fail-word');
    await expect(page.locator('#correction-select')).toHaveValue('fail-word');
    await page.screenshot({ path: shot(testInfo, `settings-${scheme}.png`) });
  });
}
