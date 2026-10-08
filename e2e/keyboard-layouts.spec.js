// Keyboard layouts: the on-screen legend, the optional finger map, and the layout as a test condition.
import { conditionKey } from '../src/typing.js';
import { test, expect, openApp, openView, openSettings, chooseWords, completePassage, passageText, typeInto, signInWithEmail } from './fixtures.js';

const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/keyboard-layouts/${name}.png` : testInfo.outputPath(`${name}.png`));
const row = (page, index) => page.locator(`#keyboard .key-row:nth-child(${index}) .key`);
const legend = async (page, index) => (await row(page, index).allTextContents()).join('');

async function runCommand(page, query, label = query) {
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await page.locator('#palette-trigger').click();
  await page.keyboard.type(query);
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText(label);
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
}

// Types the passage at a person's pace (well under 110 wpm), so screenshots show realistic numbers.
async function typeLikeAPerson(page) {
  const text = await passageText(page);
  await typeInto(page, text, '#typing-input', { delay: 120 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
}

test('the layout relabels the keyboard and joins the test conditions; bests stay per layout', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await expect(page.locator('#condition-line')).not.toContainText('qwerty');
  await openSettings(page);
  await expect(page.locator('#layout-select')).toHaveValue('qwerty');
  await expect(page.locator('#finger-row')).toBeHidden();
  await page.locator('#keyboard-toggle').check();
  await expect(page.locator('#finger-row')).toBeVisible();
  expect(await legend(page, 1)).toBe('qwertyuiop');
  expect(await legend(page, 2)).toBe('asdfghjkl;');
  expect(await legend(page, 3)).toBe('zxcvbnm,./');

  await page.locator('#layout-select').selectOption('dvorak');
  await expect(page.locator('#keyboard')).toHaveAttribute('data-layout', 'dvorak');
  expect(await legend(page, 1)).toBe('\',.pyfgcrl');
  expect(await legend(page, 2)).toBe('aoeuidhtns');
  expect(await legend(page, 3)).toBe(';qjkxbmwvz');
  await expect(page.locator('#condition-line')).toContainText('10 words · plain · physical keyboard · dvorak · continue on error');
  await expect(page.locator('#best')).toHaveText('No best yet');

  // Typed characters are taken as they arrive: no remapping for the chosen layout.
  const text = await completePassage(page);
  expect(text.length).toBeGreaterThan(0);
  await expect(page.locator('#result-conditions')).toContainText('physical keyboard · dvorak');
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');
  const wpm = await page.locator('#result-wpm').textContent();

  await openView(page, 'Practice');
  await expect(page.locator('#best')).toHaveText(`Best · ${wpm} wpm`);
  await openSettings(page);
  await page.locator('#layout-select').selectOption('qwerty');
  await expect(page.locator('#best')).toHaveText('No best yet');
  await expect(page.locator('#condition-line')).not.toContainText('qwerty');
  await expect(page.locator('#condition-line')).toContainText('10 words · plain · physical keyboard · continue on error');
  expect(await legend(page, 1)).toBe('qwertyuiop');

  // Progress names the layout only where it isn't QWERTY.
  await openView(page, 'Progress');
  await expect(page.locator('#progress-conditions option')).toHaveText(['english 200 · 10 words · plain · physical keyboard · dvorak · continue on error · corpus v5 · metric v1']);
});

test('the finger map shades each key by finger, splits the hands and follows the layout', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#keyboard')).toBeHidden();
  await runCommand(page, 'finger map');
  await expect(page.locator('#keyboard')).toBeVisible();
  await expect(page.locator('#keyboard')).toHaveAttribute('data-fingers', 'true');
  await expect(page.locator('.finger-legend span')).toHaveText(['index', 'middle', 'ring', 'pinky', 'space · thumbs']);

  const key = (letter) => page.locator(`#keyboard .key[data-key="${letter}"]`);
  await expect(key('f')).toHaveAttribute('data-finger', 'index');
  await expect(key('f')).toHaveAttribute('data-hand', 'left');
  await expect(key('j')).toHaveAttribute('data-hand', 'right');
  await expect(key('a')).toHaveAttribute('data-finger', 'pinky');
  await expect(key(' ')).toHaveAttribute('data-finger', 'thumb');
  const background = (letter) => key(letter).evaluate((node) => getComputedStyle(node).backgroundColor);
  const shades = new Set(await Promise.all(['f', 'd', 's', 'a'].map(background)));
  expect(shades.size).toBe(4);
  expect(await background('f')).toBe(await background('j'));
  // Key letters move up to full text contrast on the shaded keys.
  const colors = await key('a').evaluate((node) => [getComputedStyle(node).color, getComputedStyle(document.body).color]);
  expect(colors[0]).toBe(colors[1]);
  // The right hand starts a little apart from the left.
  const gap = await page.evaluate(() => {
    const [g, h] = ['g', 'h'].map((k) => document.querySelector(`#keyboard .key[data-key="${k}"]`).getBoundingClientRect());
    const [f, gg] = ['f', 'g'].map((k) => document.querySelector(`#keyboard .key[data-key="${k}"]`).getBoundingClientRect());
    return { hands: h.left - g.right, keys: gg.left - f.right };
  });
  expect(gap.hands).toBeGreaterThan(gap.keys);

  // Colemak-DH keeps the angle mod: x sits under the ring finger, z stretches to the index.
  await runCommand(page, 'layout · colemak-dh');
  await expect(page.locator('#condition-line')).toContainText('physical keyboard · colemak-dh');
  expect(await legend(page, 3)).toBe('xcdvzkh,./');
  await expect(key('x')).toHaveAttribute('data-finger', 'ring');
  await expect(key('z')).toHaveAttribute('data-finger', 'index');

  // The palette shows current state; the settings row mirrors it.
  await page.locator('#palette-trigger').click();
  await page.keyboard.type('layout · colemak-dh');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-hint')).toHaveText('current');
  await page.keyboard.press('Escape');
  await openSettings(page);
  await expect(page.locator('#layout-select')).toHaveValue('colemak-dh');
  await expect(page.locator('#finger-toggle')).toBeChecked();
  await page.locator('#finger-toggle').uncheck();
  await expect(page.locator('#keyboard')).toHaveAttribute('data-fingers', 'false');
  await expect(page.locator('.finger-legend')).toHaveCount(0);
  expect(await legend(page, 3)).toBe('xcdvzkh,./');
});

test('a drill keeps its target keys marked on the new legend', async ({ page }) => {
  await openApp(page);
  await runCommand(page, 'layout · workman');
  await runCommand(page, 'finger map');
  await openView(page, 'Train');
  await page.locator('#manual-heading').click();
  await page.locator('#manual-target-input').fill('th');
  await page.locator('#apply-manual-target').click();
  await expect(page.locator('#session-title')).toHaveText('Practice “th”');
  await expect(page.locator('#condition-line')).toContainText('drill · 60 s · english · physical keyboard · workman');
  await expect(page.locator('#keyboard .key.target')).toHaveText(['h', 't']);
});

test('a retest restores the baseline’s layout', async ({ page }) => {
  await openApp(page);
  await runCommand(page, 'layout · dvorak');
  await chooseWords(page, 10);
  await completePassage(page);
  await runCommand(page, 'layout · qwerty');
  await expect(page.locator('#condition-line')).not.toContainText('dvorak');
  await openView(page, 'Train');
  await page.locator('#skip-to-retest').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await expect(page.locator('#condition-line')).toContainText('10 words · plain · physical keyboard · dvorak');
  await openSettings(page);
  await expect(page.locator('#layout-select')).toHaveValue('dvorak');
});

test('a saved profile from before layouts reads as QWERTY and keeps its best', async ({ page, supabase }) => {
  const user = supabase.addUser('legacy@stilltype.test');
  // Preferences and bests exactly as master saved them: no layout anywhere.
  const legacyKey = conditionKey({ mode: 'time', duration: 30, count: null, punctuation: false, quoteLength: null, difficulty: null,
    wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en' });
  expect(legacyKey).toBe('time:30::plain:::200:physical-keyboard:relaxed:original-en-v5:stilltype-metrics-v1');
  supabase.profiles.set(user.id, { data: { version: 2, preferences: { mode: 'time', duration: 30, wordList: '200', keyboard: true, stopOnError: false },
    attempts: [], runs: [], loops: [], seenTextIds: [], bests: { [legacyKey]: { wpm: 72, attemptId: 'old', at: '2026-09-20T12:00:00Z' } }, updatedAt: '2026-09-20T12:00:00Z' } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await expect(page.locator('#best')).toHaveText('Best · 72 wpm');
  expect(await legend(page, 1)).toBe('qwertyuiop');
  await openSettings(page);
  await expect(page.locator('#layout-select')).toHaveValue('qwerty');
  await page.locator('#layout-select').selectOption('workman');
  await expect(page.locator('#best')).toHaveText('No best yet');
  await expect.poll(() => supabase.profileFor(user.email)?.preferences?.layout).toBe('workman');
  await page.locator('#layout-select').selectOption('qwerty');
  await expect(page.locator('#best')).toHaveText('Best · 72 wpm');
});

test('screenshots: Dvorak with the finger map, settings, and a result', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    await openApp(page);
    await runCommand(page, 'layout · dvorak');
    await runCommand(page, 'finger map');
    await chooseWords(page, 10);
    await page.mouse.move(640, 790);
    await page.screenshot({ path: shot(testInfo, `practice-dvorak-fingers-${theme}`) });
    await openSettings(page);
    await page.screenshot({ path: shot(testInfo, `settings-${theme}`) });
    await page.keyboard.press('Escape');
    await typeLikeAPerson(page);
    await page.waitForTimeout(600);
    const wpm = Number(await page.locator('#result-wpm').textContent());
    expect(wpm).toBeGreaterThan(30);
    expect(wpm).toBeLessThan(120);
    await page.screenshot({ path: shot(testInfo, `results-dvorak-${theme}`) });
  }
});

test('screenshot: settings on a phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await openSettings(page);
  await page.locator('#layout-select').selectOption('colemak');
  await expect(page.locator('#condition-line')).toContainText('physical keyboard · colemak');
  await openSettings(page);
  await page.locator('#keyboard-toggle').check();
  await expect(page.locator('#finger-row')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.mouse.move(380, 250);
  await page.screenshot({ path: shot(testInfo, 'settings-mobile') });

  // At 320px the new rows still fit inside the popover without clipping or page overflow.
  await page.setViewportSize({ width: 320, height: 700 });
  const fit = await page.evaluate(() => {
    const popover = document.querySelector('.preferences-popover').getBoundingClientRect();
    const rows = ['layout-select', 'finger-toggle'].map((id) => document.getElementById(id).getBoundingClientRect());
    const label = [...document.querySelectorAll('.preference-row strong')].find((node) => node.textContent === 'keyboard layout');
    return { inside: rows.every((rect) => rect.left >= popover.left && rect.right <= popover.right),
      clipped: label.scrollWidth > label.clientWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(fit).toEqual({ inside: true, clipped: false, overflow: 0 });
});
