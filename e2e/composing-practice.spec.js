// Composing practice: a prompt, a free-typing field, free-typing speed and backspace rate,
// kept apart from copy tests and stored as numbers only.
import { test, expect, openApp, openView, signInWithEmail, storageKeys } from './fixtures.js';

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = (testInfo, name) => (process.env.SCREENSHOTS
  ? `docs/screenshots/composing-practice/${name}.png`
  : testInfo.outputPath(`${name}.png`));

// The page clock is paused, so each key lands exactly `gap` ms after the last; `pauses` adds
// thinking time after the key at that index. '\b' is a backspace.
async function typePaced(page, keys, gap = 230, pauses = {}) {
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === '\b') await page.keyboard.press('Backspace');
    else await page.keyboard.type(key);
    await page.clock.runFor(gap + (pauses[index] || 0));
  }
}

// What the app should report for keys typed by typePaced.
function expected(keys, gap, pauses = {}) {
  let text = '';
  for (const key of keys) text = key === '\b' ? text.slice(0, -1) : text + key;
  let activeMs = 0;
  for (let index = 1; index < keys.length; index += 1) {
    const between = gap + (pauses[index - 1] || 0);
    if (between <= 2000) activeMs += between;
  }
  const backspaces = [...keys].filter((key) => key === '\b').length;
  return {
    text,
    activeMs,
    wpm: Math.round(text.length / 5 / (activeMs / 60000)),
    backspaceRate: Math.round((backspaces / keys.length) * 100),
    backspaces,
    keys: keys.length,
  };
}

async function startPausedClock(page) {
  await page.clock.install({ time: new Date('2026-10-09T08:00:00Z') });
  await openApp(page);
  await page.clock.pauseAt(new Date('2026-10-09T08:10:00Z'));
}

async function openCompose(page) {
  await page.locator('#mode-compose').click();
  await page.clock.runFor(50);
  await expect(page.locator('#compose-form')).toBeVisible();
  await expect(page.locator('#compose-input')).toBeFocused();
}

// About 52 wpm with two corrections and one long pause: a plausible minute of writing.
const MORNING = [...'I woke early and made tae'].concat(['\b', '\b'], [...'ea. The kitchen was quiet, so I read by the window.']);
const MORNING_PAUSES = { 25: 3200 };

test('composing reports free-typing speed and backspace rate, never a best', async ({ page }) => {
  await startPausedClock(page);
  await expect(page.locator('#best')).toHaveText('No best yet');
  await openCompose(page);

  // Composing replaces the passage and the test shape controls; its own button is the pressed one.
  await expect(page.locator('body')).toHaveAttribute('data-compose', 'true');
  await expect(page.locator('#typing-form')).toBeHidden();
  await expect(page.locator('#mode-compose')).toHaveAttribute('aria-pressed', 'true');
  for (const id of ['#mode-time', '#mode-words', '#mode-quote']) await expect(page.locator(id)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#duration-options')).toBeHidden();
  await expect(page.locator('#punctuation-switch')).toBeHidden();
  await expect(page.locator('#best')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('#compose-conditions')).toHaveText('composing · up to 60 s · physical keyboard · not compared with copy tests');
  await expect(page.locator('#compose-privacy')).toHaveText('Your words are never saved. Only the numbers are kept, for this tab.');
  await expect(page.locator('#compose-timer')).toHaveText('60');
  await expect(page.locator('#compose-done')).toBeDisabled();

  // Another prompt swaps the prompt and keeps you in the field.
  const first = await page.locator('#compose-prompt').textContent();
  await page.locator('#compose-another').click();
  await expect(page.locator('#compose-prompt')).not.toHaveText(first);
  await expect(page.locator('#compose-input')).toBeFocused();
  const prompt = await page.locator('#compose-prompt').textContent();

  await typePaced(page, MORNING, 230, MORNING_PAUSES);
  const want = expected(MORNING, 230, MORNING_PAUSES);
  await expect(page.locator('#compose-input')).toHaveValue(want.text);
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  await expect(page.locator('.practice-controls')).toHaveCSS('opacity', '0');
  await expect(page.locator('#compose-timer')).not.toHaveText('60');

  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#compose-result')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-running', 'false');
  await expect(page.locator('#compose-result-heading')).toHaveText(/^Finished after \d+ s$/);
  await expect(page.locator('#compose-wpm')).toHaveText(String(want.wpm));
  expect(want.wpm).toBeGreaterThan(40);
  expect(want.wpm).toBeLessThan(70);
  await expect(page.locator('#compose-backspace')).toHaveText(String(want.backspaceRate));
  await expect(page.locator('#compose-active')).toHaveText((want.activeMs / 1000).toFixed(1));
  await expect(page.locator('#compose-characters')).toHaveText(String(want.text.length));
  await expect(page.locator('#compose-definition')).toContainText('characters in your text ÷ 5, per minute of active typing (gaps over 2 s left out)');
  await expect(page.locator('#compose-definition')).toContainText(`${want.backspaces} of ${want.keys} keys were backspace or delete`);
  await expect(page.locator('#compose-definition')).toContainText('Never compared with copy tests, and never a best.');
  await expect(page.locator('#compose-saved')).toHaveText('Kept for this tab: these numbers, not your words.');
  await expect(page.locator('#compose-next')).toBeFocused();
  await expect(page.locator('#compose-input')).toHaveJSProperty('readOnly', true);

  // Progress lists it apart from copy-test charts; there is still no copy-test run or best.
  await openView(page, 'Progress');
  await expect(page.locator('#progress-empty')).toBeVisible();
  await expect(page.locator('#compose-history')).toBeVisible();
  await expect(page.locator('#compose-history .compose-row')).toHaveCount(1);
  await expect(page.locator('#compose-history .compose-row-main')).toContainText(`${want.wpm} wpm`);
  await expect(page.locator('#compose-history .compose-row-main')).toContainText(`${want.backspaceRate}% backspace rate`);
  await expect(page.locator('#compose-history .compose-row')).toContainText(`“${prompt}”`);
  await expect(page.locator('#compose-history .compose-row')).toContainText(`${want.text.length} characters · ${want.backspaces} backspaces in ${want.keys} keys`);
  await expect(page.locator('#compose-history-note')).toContainText('1 session saved');
  await expect(page.locator('#compose-history-note')).toContainText('never a best');
  await expect(page.locator('#compose-history')).not.toContainText('quiet, so I read');
  await expect(page.locator('#clear-history')).toBeVisible();

  // The practice tab returns to composing; choosing a test shape returns to the passage.
  await openView(page, 'Practice');
  await expect(page.locator('#compose-result')).toBeVisible();
  await page.locator('#mode-time').click();
  await page.clock.runFor(50);
  await expect(page.locator('body')).toHaveAttribute('data-compose', 'false');
  await expect(page.locator('#typing-form')).toBeVisible();
  await expect(page.locator('#compose-form')).toBeHidden();
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await expect(page.locator('#typing-input')).toBeFocused();
  await expect(page.locator('#best')).toHaveText('No best yet');
  await expect(page.locator('#best')).toHaveCSS('visibility', 'visible');

  // Clear history takes composing numbers too, and Undo brings them back.
  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(page.locator('#compose-history')).toBeHidden();
  await page.locator('#undo-clear').click();
  await expect(page.locator('#compose-history .compose-row')).toHaveCount(1);
});

test('the minute ends it on its own and the field stops taking keys', async ({ page }) => {
  await startPausedClock(page);
  await openCompose(page);
  const keys = [...'The rain started before lunch and the street went quiet. '];
  await typePaced(page, keys, 240);
  await expect(page.locator('#compose-timer')).toHaveText(String(60 - Math.floor((keys.length * 240) / 1000)));

  await page.clock.runFor(60_000);
  await expect(page.locator('#compose-result-heading')).toHaveText('Time’s up at 60 s');
  await expect(page.locator('#compose-timer')).toHaveText('0');
  await expect(page.locator('#compose-progress')).toHaveAttribute('aria-valuenow', '100');
  const value = await page.locator('#compose-input').inputValue();
  await page.locator('#compose-input').focus();
  await page.keyboard.type('more');
  await expect(page.locator('#compose-input')).toHaveValue(value);

  // Write another clears the field and offers a different prompt.
  const prompt = await page.locator('#compose-prompt').textContent();
  await page.locator('#compose-next').click();
  await expect(page.locator('#compose-input')).toHaveValue('');
  await expect(page.locator('#compose-input')).toBeFocused();
  await expect(page.locator('#compose-prompt')).not.toHaveText(prompt);
  await expect(page.locator('#compose-timer')).toHaveText('60');
  await expect(page.locator('#compose-result')).toBeHidden();
});

test('paste, key repeat and too-short writing are handled honestly', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-compose').click();
  await expect(page.locator('#compose-input')).toBeFocused();

  await page.locator('#compose-input').evaluate((input) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'a whole pasted paragraph');
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#compose-input')).toHaveValue('');
  await expect(page.locator('#compose-help')).toHaveText('Paste is off. Type your answer.');
  await expect(page.locator('#compose-done')).toBeDisabled();

  // Escape starts over with the same prompt.
  const prompt = await page.locator('#compose-prompt').textContent();
  await page.keyboard.type('abc');
  await expect(page.locator('#compose-done')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('#compose-input')).toHaveValue('');
  await expect(page.locator('#compose-done')).toBeDisabled();
  await expect(page.locator('#compose-prompt')).toHaveText(prompt);

  // A held key types once; the repeats are refused and said so.
  await page.keyboard.down('x');
  await page.keyboard.down('x');
  await page.keyboard.down('x');
  await page.keyboard.up('x');
  await expect(page.locator('#compose-input')).toHaveValue('x');
  await expect(page.locator('#compose-help')).toHaveText('Key repeat ignored.');
  await page.keyboard.press('Escape');
  await expect(page.locator('#compose-input')).toHaveValue('');

  // A few instant keys are too little active typing for a speed, and nothing is kept.
  await page.keyboard.type('Hi there');
  await page.locator('#compose-done').click();
  await expect(page.locator('#compose-result-heading')).toHaveText('Too short to measure · not saved');
  await expect(page.locator('#compose-wpm')).toHaveText('—');
  await expect(page.locator('#compose-saved')).toHaveText('A speed needs at least 5 s of active typing.');
  await openView(page, 'Progress');
  await expect(page.locator('#compose-history')).toBeHidden();
  await expect(page.locator('#clear-history')).toBeHidden();
});

test('opening commands or leaving mid-way means it is not saved', async ({ page }) => {
  await startPausedClock(page);
  // The palette opens composing too.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('composing');
  await page.keyboard.press('Enter');
  await expect(page.locator('#compose-form')).toBeVisible();
  await expect(page.locator('#compose-input')).toBeFocused();

  await typePaced(page, [...'A short walk to the shop and back again today.'], 220);
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.clock.runFor(200);
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('#compose-help')).toHaveText('Commands opened mid-way, so this one won’t be saved.');
  await page.locator('#compose-input').focus();
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#compose-result-heading')).toHaveText('Interrupted · not saved');
  await expect(page.locator('#compose-saved')).toHaveText('Commands opened mid-way, so this one won’t be saved.');

  await page.locator('#compose-retry').click();
  await typePaced(page, [...'The bus was late again. '], 220);
  await openView(page, 'Progress');
  await expect(page.locator('#compose-history')).toBeHidden();
  await openView(page, 'Practice');
  await expect(page.locator('#compose-result-heading')).toHaveText('Interrupted · not saved');
  await expect(page.locator('#compose-saved')).toHaveText('You left mid-way, so this one wasn’t saved.');
});

test('signed in, only the numbers reach the account', async ({ page, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await page.locator('#mode-compose').click();
  await expect(page.locator('#compose-privacy')).toHaveText('Your words are never saved. Only the numbers go to your history.');
  const phrase = 'Zebra marmalade on toast, then a walk along the canal path.';
  await page.locator('#compose-input').focus();
  await page.keyboard.type(phrase, { delay: 120 });
  await page.locator('#compose-done').click();
  await expect(page.locator('#compose-saved')).toHaveText('Saved to your history: these numbers, not your words.');

  await expect.poll(() => supabase.profileFor('ada@stilltype.test')?.compositions?.length || 0, { timeout: 15_000 }).toBe(1);
  const cloud = supabase.profileFor('ada@stilltype.test');
  expect(JSON.stringify(cloud)).not.toContain('marmalade');
  expect(cloud.compositions[0].characters).toBe(phrase.length);
  expect(cloud.runs).toEqual([]);
  expect(cloud.bests).toEqual({});
  const stored = await page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)).join('\n'), await storageKeys(page));
  expect(stored).toContain('"compositions"');
  expect(stored).not.toContain('marmalade');
});

test('composing screenshots, dark and light', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await startPausedClock(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openCompose(page);
  while ((await page.locator('#compose-prompt').textContent()) !== 'Describe your morning in three sentences.') {
    await page.locator('#compose-another').click();
  }
  const keys = [...'I woke before the alarm and made tea whiel', '\b', '\b', ...'le the kettle ticked. The street was still dark'];
  await typePaced(page, keys, 210, { 64: 2600 });
  await expect(page.locator('.practice-controls')).toHaveCSS('opacity', '0');
  await page.screenshot({ path: shot(testInfo, 'writing-dark') });

  await typePaced(page, [...', so I read for a while by the window.'], 210);
  await page.locator('#compose-done').click();
  await expect(page.locator('#compose-result')).toBeVisible();
  await page.clock.runFor(400);
  await expect(page.locator('.dock-zone')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: shot(testInfo, 'result-dark') });

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // The theme cross-fades; wait for the paper ground before taking the picture.
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 241, 235)');
  await page.clock.runFor(400);
  await page.screenshot({ path: shot(testInfo, 'result-light') });

  await openView(page, 'Progress');
  await page.clock.runFor(400);
  await page.locator('#compose-history').scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot(testInfo, 'progress-light') });
});

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['narrow phone', { width: 320, height: 640 }]]) {
  test.describe(`${name} ${viewport.width}px`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test('composing fits without sideways scroll and keeps 44px targets', async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await startPausedClock(page);
      await page.locator('#mode-compose').click();
      await page.clock.runFor(50);
      await expect(page.locator('#compose-form')).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      for (const selector of ['#mode-compose', '[data-mode]', '#compose-done', '#compose-restart', '#compose-another']) {
        const heights = await page.locator(selector).evaluateAll((nodes) => nodes.filter((node) => node.offsetParent).map((node) => node.getBoundingClientRect().height));
        expect(heights.length, selector).toBeGreaterThan(0);
        for (const height of heights) expect(height, selector).toBeGreaterThanOrEqual(44);
      }
      // A tap on the field marks the session as touch input.
      await page.locator('#compose-input').tap();
      await expect(page.locator('#compose-conditions')).toContainText('touch input');
      await typePaced(page, [...'Toast, coffee and the radio on low. Then the bus.'], 260);
      await page.locator('#compose-done').tap();
      await expect(page.locator('#compose-result')).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      const text = await page.locator('#compose-definition').evaluate((node) => node.scrollWidth <= node.clientWidth);
      expect(text).toBe(true);
      if (viewport.width === 390) {
        await page.clock.runFor(400);
        await page.locator('.compose-wrap').evaluate((node) => node.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: shot(testInfo, 'result-mobile-dark') });
      }
    });
  });
}
