import { test, expect, chooseWords, completePassage, openApp, openView, passageText, signInWithEmail, typeInto } from './fixtures.js';

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

// A drill that a failure policy ends shows its failed result, like any other failed run, instead of moving
// straight on to the retest: Try drill again repeats it and Skip to retest goes on to the fresh retest.
const FAILURE_LABELS = { 'fail-any': 'fail on any error', 'fail-word': 'fail on word error' };

// Starts the drill from the results view and fails it on a wrong letter, judged at the space for fail on word error.
async function failDrill(page, policy, reason, options = {}) {
  await page.locator('#start-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#condition-line')).toContainText(`drill · 60 s · english · physical keyboard · ${FAILURE_LABELS[policy]}`);
  const text = await passageText(page);
  const at = text.indexOf(' ', 12) - 1;
  await typeInto(page, text.slice(0, at) + (text[at] === 'x' ? 'z' : 'x') + (policy === 'fail-word' ? ' ' : ''), '#typing-input', options);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText(`failed · ${reason}`);
  await expect(page.locator('#run-card-stamp')).toContainText(`· drill · failed · ${reason}`);
}

for (const [policy, reason] of [['fail-any', 'wrong key'], ['fail-word', 'word error']]) {
  test(`a drill failed by ${policy} shows its result, then retries or goes on to the retest`, async ({ page }) => {
    await openApp(page);
    await chooseWords(page, 10);
    await chooseCorrection(page, policy);
    const baseline = await completePassage(page);
    await expect(page.locator('#start-drill')).toHaveText('Start drill');

    await failDrill(page, policy, reason);
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
    await expect(page.locator('#announcement')).toHaveText(new RegExp(`^Drill failed, ${reason}\\. \\d+ wpm, \\d+% accuracy\\.$`));
    await expect(page.locator('#recommendation-meta')).toHaveText('About 1 min, then a fresh 10-word retest.');
    await expect(page.locator('#start-drill')).toHaveText('Try drill again');
    await expect(page.locator('#start-drill')).toBeFocused();
    await expect(page.locator('#skip-to-retest')).toBeEnabled();

    // Trying again starts the drill afresh under the same policy.
    await failDrill(page, policy, reason);
    await expect(page.locator('#start-drill')).toBeFocused();

    await page.locator('#skip-to-retest').click();
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
    await expect(page.locator('#condition-line')).toContainText(`10 words · plain · physical keyboard · ${FAILURE_LABELS[policy]}`);
    expect(await passageText(page)).not.toBe(baseline);
    await completePassage(page);
    await expect(page.locator('#comparison-panel')).toHaveAttribute('data-outcome', /^(improved|mixed|regressed|steady)$/);
    // No drill was finished, so the loop is recorded as a fresh-text check.
    await openView(page, 'Progress');
    await expect(page.locator('.history-target')).toHaveText('Fresh-text check');
  });
}

test('a drill that runs its minute under fail on any error still goes straight to the retest', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await chooseWords(page, 10);
  await chooseCorrection(page, 'fail-any');
  await completePassage(page);
  await page.locator('#start-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await typeInto(page, (await passageText(page)).slice(0, 20));
  await page.clock.fastForward(60_000);
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#announcement')).toHaveText('Drill complete. Retest ready.');
});

// A baseline and a failed drill typed at a person's pace, so the run card shows believable numbers.
async function showFailedDrill(page, viewport) {
  // Typing at a person's pace takes a while on a shared machine.
  test.setTimeout(90_000);
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await chooseWords(page, 10);
  await chooseCorrection(page, 'fail-any');
  await typeInto(page, await passageText(page), '#typing-input', { delay: 120 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await failDrill(page, 'fail-any', 'wrong key', { delay: 110 });
  await expect(page.locator('#start-drill')).toBeFocused();
  // The run card's graph draws in about 450 ms.
  await page.waitForTimeout(600);
}

test('failed drill result screenshots', async ({ page }, testInfo) => {
  await showFailedDrill(page, { width: 1280, height: 800 });
  await page.screenshot({ path: shot(testInfo, 'failed-drill-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: shot(testInfo, 'failed-drill-light.png') });
});

test('failed drill result fits at 320px', async ({ page }, testInfo) => {
  await showFailedDrill(page, { width: 320, height: 568 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  // The run card comes first on a phone; the shot shows the failed headline and its actions below it.
  await page.locator('#results-heading').evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await expect(page.locator('#start-drill')).toBeInViewport();
  await page.screenshot({ path: shot(testInfo, 'failed-drill-320.png') });
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

// Correction is a practice setting like stop on error: changing it keeps a custom passage, and a failed custom
// run reads as failed, stays uncounted, and Run again keeps the same text.
test('a failure policy applies to custom text and keeps its passage', async ({ page }) => {
  const custom = 'the quick brown fox jumps over the lazy dog';
  await openApp(page);
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill(custom);
  await page.locator('#custom-use').click();
  await chooseCorrection(page, 'fail-any');
  await expect(page.locator('#condition-line')).toContainText('custom text');
  await expect(page.locator('#condition-line')).toContainText('fail on any error');
  expect(await passageText(page)).toBe(custom);
  await typeInto(page, 'thx');
  await expect(page.locator('#result-delta')).toHaveText('failed · wrong key');
  await expect(page.locator('#result-conditions')).toContainText('custom text');
  await expect(page.locator('#result-conditions')).toContainText('fail on any error');
  await page.locator('#run-again').click();
  await expect(page.locator('#condition-line')).toContainText('custom text');
  expect(await passageText(page)).toBe(custom);
  await expect(page.locator('#best')).toHaveText('Not counted');
});

test('correction choices survive account save, reload and a fixed standard run', async ({ page, supabase }) => {
  supabase.addUser('correction@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'correction@stilltype.test');
  await chooseCorrection(page, 'no-backspace');
  await expect.poll(() => supabase.profileFor('correction@stilltype.test')?.preferences?.correction).toBe('no-backspace');
  await page.reload();
  await expect(page.locator('#condition-line')).toContainText('no backspace');
  await page.locator('#mode-standard').click();
  await expect(page.locator('#condition-line')).toContainText('stop on error');
  await page.locator('details.preferences > summary').click();
  await expect(page.locator('#correction-select')).toBeDisabled();
  await expect(page.locator('#correction-select')).toHaveValue('mandatory');
  await page.locator('details.preferences > summary').click();
  await page.locator('#mode-time').click();
  await expect(page.locator('#condition-line')).toContainText('no backspace');
});

test('a lesson ended by fail-on-any-error names the failed key rule', async ({ page }) => {
  await openApp(page);
  await chooseCorrection(page, 'fail-any');
  await page.locator('#open-lessons').click();
  await page.locator('#lesson-primary').click();
  const text = await passageText(page);
  await typeInto(page, text[0] === 'x' ? 'z' : 'x');
  await expect(page.locator('#lesson-current-heading')).toHaveText('Lesson 1 failed · wrong key · not counted');
});

test('a completed run under a new policy is not offered to the older ghost service', async ({ page, supabase }) => {
  supabase.addUser('policy-ghost@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'policy-ghost@stilltype.test');
  await chooseWords(page, 10);
  await chooseCorrection(page, 'fail-any');
  await completePassage(page);
  await expect(page.locator('#ghost-offer')).toBeHidden();
});
