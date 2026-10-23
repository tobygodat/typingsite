// Custom time and word count: the "custom" pill in the length row, its bounds and messages, its own
// bests and retests, the palette commands, and what is remembered (guests: the tab only).
import { test, expect, openApp, passageText, typeInto, completePassage, signInWithEmail, chooseMore, openSettings, chooseQuoteFilter, finishDrill } from './fixtures.js';

// Committed docs images are refreshed only with SCREENSHOTS=1; normal runs write to the test output.
const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/custom-length/${name}` : testInfo.outputPath(name));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const pill = (page) => page.locator('#custom-length');
const field = (page) => page.locator('#custom-length-input');
const message = (page) => page.locator('#custom-length-error');
const rowWidth = async (page) => (await page.locator('#duration-options').boundingBox()).width;

async function setCustom(page, value) {
  await pill(page).click();
  await expect(field(page)).toBeFocused();
  await field(page).fill(String(value));
  await field(page).press('Enter');
}

test('a custom time is validated in place, becomes the test length, and lasts for a guest’s tab only', async ({ page }) => {
  await openApp(page);
  await expect(pill(page)).toHaveText('custom');
  await expect(pill(page)).toHaveAttribute('aria-pressed', 'false');
  // "custom" is a word, so Literata like the mode options; the field takes its exact width.
  await expect(pill(page)).toHaveCSS('font-family', /^"?Literata/);
  const closed = await rowWidth(page);

  await pill(page).click();
  await expect(pill(page)).toBeHidden();
  expect(await rowWidth(page)).toBeCloseTo(closed, 1);
  await expect(field(page)).toBeFocused();
  await expect(field(page)).toHaveAttribute('placeholder', '5–600');
  await expect(field(page)).toHaveAttribute('aria-label', 'custom time in seconds, 5 to 600');

  for (const [raw, text] of [
    ['4', 'Too short: use at least 5 seconds.'],
    ['601', 'Too long: use at most 600 seconds.'],
    ['4.5', 'Enter whole seconds, 5 to 600.'],
    ['', 'Enter whole seconds, 5 to 600.'],
  ]) {
    await field(page).fill(raw);
    await field(page).press('Enter');
    await expect(message(page)).toHaveText(text);
    await expect(field(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(field(page)).toBeFocused();
    await expect(page.locator('#condition-line')).toContainText('· 30 s ·');
  }

  await field(page).fill('45');
  await field(page).press('Enter');
  await expect(field(page)).toBeHidden();
  await expect(message(page)).toHaveText('');
  await expect(pill(page)).toHaveText('45');
  await expect(pill(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(pill(page)).toHaveAttribute('aria-label', 'custom time, 45 seconds');
  await expect(page.locator('#duration-options [aria-pressed="true"]')).toHaveCount(1);
  await expect(page.locator('#condition-line')).toContainText('· 45 s ·');
  await expect(page.locator('#timer')).toHaveText('45');
  await expect(page.locator('#best')).toHaveText('No best yet');
  await expect(page.locator('#typing-input')).toBeFocused();

  // A custom value equal to a preset is just that preset.
  await setCustom(page, 60);
  await expect(page.locator('#duration-options [data-length="60"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(pill(page)).toHaveText('custom');
  await pill(page).click();
  await expect(field(page)).toHaveValue('45');

  // Back on 45, a guest's custom length lasts for the tab only.
  await field(page).press('Enter');
  await expect(pill(page)).toHaveText('45');
  await expect(page.locator('#condition-line')).toContainText('· 45 s ·');
  await page.reload();
  await expect(pill(page)).toHaveText('custom');
  await expect(page.locator('#condition-line')).toContainText('· 30 s ·');
  await pill(page).click();
  await expect(field(page)).toHaveValue('');
});

test('a custom time has its own best and its retest keeps the custom length', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await setCustom(page, 45);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 60));
  await page.clock.fastForward(45_000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-time')).toHaveText('45.0 s');
  await expect(page.locator('#result-conditions')).toContainText('· 45 s ·');
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');

  await page.locator('#result-drill').click();
  await finishDrill(page);
  await expect(page.locator('#condition-line')).toContainText('· 45 s ·');
  await expect(page.locator('#timer')).toHaveText('45');
  expect(await passageText(page)).not.toBe(text);

  // Back in practice the best belongs to 45 s only.
  await page.locator('.dock-nav [data-nav="practice"]').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'practice');
  await expect(pill(page)).toHaveText('45');
  await expect(page.locator('#best')).toHaveText(/^Best · \d+ wpm$/);
  await page.locator('#duration-options [data-length="30"]').click();
  await expect(page.locator('#best')).toHaveText('No best yet');
});

test('a custom word count sets the passage length and has its own bounds', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-words').click();
  await expect(pill(page)).toHaveAttribute('aria-label', 'custom word count');
  await pill(page).click();
  await expect(field(page)).toHaveAttribute('placeholder', '5–500');
  await expect(field(page)).toHaveAttribute('aria-label', 'custom number of words, 5 to 500');
  await field(page).fill('501');
  await field(page).press('Enter');
  await expect(message(page)).toHaveText('Too many: use at most 500 words.');
  await field(page).fill('3');
  await field(page).press('Enter');
  await expect(message(page)).toHaveText('Too few: use at least 5 words.');
  await field(page).fill('12');
  await field(page).press('Enter');
  await expect(pill(page)).toHaveText('12');
  await expect(page.locator('#condition-line')).toContainText('· 12 words ·');
  expect((await passageText(page)).split(' ')).toHaveLength(12);
  await completePassage(page);
  await expect(page.locator('#result-conditions')).toContainText('· 12 words ·');

  // Time and words remember their own custom values.
  await page.locator('[data-action="run-again"]').click();
  await page.locator('#mode-time').click();
  await expect(pill(page)).toHaveText('custom');
  await page.locator('#mode-words').click();
  await expect(pill(page)).toHaveText('12');
});

test('Escape cancels, leaving the field applies a valid value, and another pill wins over the edit', async ({ page }) => {
  await openApp(page);
  const before = await passageText(page);
  await pill(page).click();
  await field(page).fill('99');
  await field(page).press('Escape');
  await expect(field(page)).toBeHidden();
  await expect(pill(page)).toBeFocused();
  await expect(pill(page)).toHaveText('custom');
  // Escape belonged to the field: no restart, no focus-mode toggle.
  expect(await passageText(page)).toBe(before);
  await expect(page.locator('#condition-line')).toContainText('· 30 s ·');

  // Tabbing away with a valid number applies it and leaves focus where it went.
  await pill(page).click();
  await field(page).fill('50');
  await page.keyboard.press('Tab');
  await expect(page.locator('#condition-line')).toContainText('· 50 s ·');
  await expect(pill(page)).toHaveText('50');
  await expect(page.locator('#punctuation-toggle')).toBeFocused();

  // Clicking away with a bad number keeps the old length and says why.
  await pill(page).click();
  await field(page).fill('700');
  await page.locator('#typing-wrap').click();
  await expect(field(page)).toBeHidden();
  await expect(message(page)).toHaveText('Too long: use at most 600 seconds.');
  await expect(page.locator('#condition-line')).toContainText('· 50 s ·');

  // Pressing a preset while editing picks the preset and drops the edit.
  await pill(page).click();
  await expect(message(page)).toHaveText('');
  await field(page).fill('77');
  await page.locator('#duration-options [data-length="15"]').click();
  await expect(page.locator('#condition-line')).toContainText('· 15 s ·');
  await pill(page).click();
  await expect(field(page)).toHaveValue('50');

  // The remembered value is only offered: leaving the field untouched changes nothing.
  await page.keyboard.press('Tab');
  await expect(field(page)).toBeHidden();
  await expect(page.locator('#condition-line')).toContainText('· 15 s ·');
  await expect(pill(page)).toHaveText('custom');
});

test('custom text hides the custom length, and the palette leaves custom text for it', async ({ page }) => {
  await openApp(page);
  await setCustom(page, 45);
  await expect(page.locator('#condition-line')).toContainText('· 45 s ·');

  // Opening the custom text editor closes a custom length field left open in the row it hides.
  await pill(page).click();
  await expect(field(page)).toBeFocused();
  await chooseMore(page, 'mode-custom');
  await expect(page.locator('#custom-options')).toBeVisible();
  await expect(page.locator('#duration-options')).toBeHidden();
  await expect(page.locator('#custom-length-form')).toBeHidden();

  const text = 'the quick brown fox jumps over the lazy dog';
  await page.locator('#custom-text').fill(text);
  await page.locator('#custom-use').click();
  await expect(page.locator('#condition-line')).toContainText('custom text');
  await expect(page.locator('#best')).toHaveText('Not counted');

  // No length is current under custom text, though the remembered one is still offered.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('custom time');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('custom time…');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-hint')).toHaveText('45 s');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-hint')).not.toHaveClass(/is-on/);
  await page.keyboard.press('Enter');
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#mode-time')).toHaveAttribute('aria-pressed', 'true');
  await expect(field(page)).toBeFocused();
  await field(page).fill('50');
  await field(page).press('Enter');
  await expect(page.locator('#condition-line')).toContainText('· 50 s ·');
  await expect(page.locator('#best')).toHaveText('No best yet');
});

test('the palette opens the custom field, switching mode when needed', async ({ page }) => {
  await openApp(page);
  await page.locator('#mode-words').click();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('custom time');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('custom time…');
  await page.keyboard.press('Enter');
  await expect(page.locator('#mode-time')).toHaveAttribute('aria-pressed', 'true');
  await expect(field(page)).toBeFocused();
  await field(page).fill('90');
  await field(page).press('Enter');
  await expect(page.locator('#condition-line')).toContainText('· 90 s ·');

  await page.keyboard.press('Control+k');
  await page.keyboard.type('custom time');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-hint')).toHaveText('90 s');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-hint')).toHaveClass(/is-on/);
  await page.locator('#palette-input').fill('custom words');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('custom words…');
  await page.keyboard.press('Enter');
  await expect(page.locator('#mode-words')).toHaveAttribute('aria-pressed', 'true');
  await expect(field(page)).toBeFocused();
  await expect(field(page)).toHaveAttribute('placeholder', '5–500');

  // Mid-run, the command restarts the run so a timer can't end under the open field.
  await field(page).press('Escape');
  await page.locator('#mode-time').click();
  await typeInto(page, (await passageText(page)).slice(0, 4));
  await page.keyboard.press('Control+k');
  await page.keyboard.type('custom time');
  await page.keyboard.press('Enter');
  await expect(field(page)).toBeFocused();
  await expect(page.locator('#typing-status')).toHaveText('Ready');

  // In focus mode the row comes back only while the field is open.
  await field(page).press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('focus mode');
  await page.keyboard.press('Enter');
  await expect(page.locator('.practice-controls')).toHaveCSS('visibility', 'hidden');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('custom time');
  await page.keyboard.press('Enter');
  await expect(field(page)).toBeFocused();
  await expect(page.locator('.practice-controls')).toHaveCSS('visibility', 'visible');
  await field(page).fill('40');
  await field(page).press('Enter');
  await expect(page.locator('.practice-controls')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('body')).toHaveAttribute('data-focus-mode', 'true');
  await expect(page.locator('#condition-line')).toContainText('· 40 s ·');

  // Leaving the field returns to the passage, since the row (pill included) hides again.
  const openFromPalette = async () => {
    await page.keyboard.press('Control+k');
    await page.keyboard.type('custom time');
    await page.keyboard.press('Enter');
    await expect(field(page)).toBeFocused();
  };
  for (const [key, length] of [['Escape', '40'], ['Tab', '50']]) {
    await openFromPalette();
    await field(page).fill('50');
    await field(page).press(key);
    await expect(page.locator('.practice-controls')).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('#typing-input')).toBeFocused();
    await expect(page.locator('#condition-line')).toContainText(`· ${length} s ·`);
    await expect(page.locator('body')).toHaveAttribute('data-focus-mode', 'true');
  }

  // A bad entry left behind stays readable under the hidden row, and clears when the run starts.
  await openFromPalette();
  await field(page).fill('700');
  await page.locator('#typing-wrap').click();
  await expect(page.locator('.practice-controls')).toHaveCSS('visibility', 'hidden');
  await expect(message(page)).toHaveText('Too long: use at most 600 seconds.');
  await expect(message(page)).toHaveCSS('visibility', 'visible');
  await expect(page.locator('#typing-input')).toBeFocused();
  await page.keyboard.type((await passageText(page)).slice(0, 3));
  await expect(page.locator('#typing-status')).toHaveText('In progress');
  await expect(message(page)).toHaveText('');
});

test('the palette’s custom length after a finished quote draws no quote just to replace it', async ({ page, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await page.locator('#mode-quote').click();
  await chooseQuoteFilter(page, 'length', 'short');
  await completePassage(page);
  const seenQuotes = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.startsWith('stilltype-profile-v2:'));
    return JSON.parse(localStorage.getItem(key)).seenTextIds.filter((id) => !id.startsWith('generated-'));
  });
  const before = await seenQuotes();
  expect(before.length).toBeGreaterThan(0);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('custom time');
  await page.keyboard.press('Enter');
  await expect(page.locator('#mode-time')).toHaveAttribute('aria-pressed', 'true');
  await expect(field(page)).toBeFocused();
  expect(await seenQuotes()).toEqual(before);
});

test('a signed-in custom length is saved with the account', async ({ page, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await setCustom(page, 45);
  await page.locator('#mode-words').click();
  await setCustom(page, 75);
  await page.locator('#duration-options [data-length="25"]').click();
  await expect.poll(() => supabase.profileFor('ada@stilltype.test')?.preferences, { timeout: 10_000 })
    .toMatchObject({ mode: 'words', duration: 45, count: 25, customDuration: 45, customCount: 75 });

  await page.reload();
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await expect(page.locator('#mode-words')).toHaveAttribute('aria-pressed', 'true');
  await expect(pill(page)).toHaveText('custom');
  await pill(page).click();
  await expect(field(page)).toHaveValue('75');
  await field(page).press('Escape');
  await page.locator('#mode-time').click();
  await expect(pill(page)).toHaveText('45');
  await expect(page.locator('#condition-line')).toContainText('· 45 s ·');
});

test('the field and its message fit a 390px and a 320px phone', async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 740 });
    await openApp(page);
    const closed = await rowWidth(page);
    await pill(page).click();
    expect(await rowWidth(page)).toBeCloseTo(closed, 1);
    await field(page).fill('1000');
    await field(page).press('Enter');
    await expect(message(page)).toHaveText('Too long: use at most 600 seconds.');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // The message sits in the gap under the row: one line, clear of the numbers below.
    const note = await message(page).boundingBox();
    const row = await page.locator('.practice-controls').boundingBox();
    const measure = await page.locator('#typing-form .measure-row').boundingBox();
    expect(note.y).toBeGreaterThanOrEqual(row.y + row.height - 1);
    expect(note.y + note.height).toBeLessThanOrEqual(measure.y + 1);
    expect(note.height).toBeLessThan(26);
    await page.locator('#mode-words').click();
    await pill(page).click();
    await field(page).fill('75');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  }
});

test('screenshots', async ({ page }, testInfo) => {
  test.skip(!process.env.SCREENSHOTS, 'docs screenshots only; run with SCREENSHOTS=1');
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    await openApp(page);
    await setCustom(page, 45);
    await expect(pill(page)).toHaveText('45');
    await page.locator('#typing-input').blur();
    await page.mouse.move(640, 600);
    await page.screenshot({ path: shot(testInfo, `custom-time-${theme}.png`) });

    await pill(page).click();
    await field(page).fill('700');
    await field(page).press('Enter');
    await expect(message(page)).toHaveText('Too long: use at most 600 seconds.');
    await page.screenshot({ path: shot(testInfo, `custom-time-invalid-${theme}.png`) });
  }

  // A real-paced custom word run, so the run card shows a plausible score.
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await page.locator('#mode-words').click();
  await setCustom(page, 35);
  await typeInto(page, await passageText(page), '#typing-input', { delay: 130 });
  await expect(page.locator('#run-card')).toBeVisible();
  await expect(page.locator('#result-conditions')).toContainText('· 35 words ·');
  const wpm = Number(await page.locator('#result-wpm').textContent());
  expect(wpm).toBeGreaterThan(40);
  expect(wpm).toBeLessThan(115);
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot(testInfo, 'custom-words-run-card-dark.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await pill(page).click();
  await field(page).fill('3');
  await field(page).press('Enter');
  await expect(message(page)).toHaveText('Too short: use at least 5 seconds.');
  await page.screenshot({ path: shot(testInfo, 'custom-time-invalid-mobile-dark.png') });
});


test('explicit duration, layout and keybindings reselects are each recorded as a fresh preference choice', async ({ page, supabase }) => {
  const user = supabase.addUser('choice-39@stilltype.test');
  const stamp = '2000-01-01T00:00:00.000Z';
  const keybindings = { restart: 'Escape', commands: 'Mod+K', exitFocus: 'Escape' };
  supabase.profiles.set(user.id, { data: { version: 2, preferences: { duration: 30, layout: 'qwerty', keybindings },
    preferencesAt: { duration: stamp, layout: stamp, keybindings: stamp },
    attempts: [], runs: [], loops: [], seenTextIds: [], bests: {}, updatedAt: stamp } });
  const stamps = () => supabase.profileFor(user.email)?.preferencesAt;
  await openApp(page);
  await signInWithEmail(page, user.email);

  await pill(page).click();
  await field(page).fill('30');
  await field(page).press('Enter');
  await expect.poll(() => stamps()?.duration).not.toBe(stamp);
  expect(stamps()).toMatchObject({ layout: stamp, keybindings: stamp });

  await page.keyboard.press('Control+k');
  await page.keyboard.type('layout · qwerty');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('layout · qwerty');
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
  await expect.poll(() => stamps()?.layout).not.toBe(stamp);
  expect(stamps().keybindings).toBe(stamp);

  await openSettings(page);
  await openSettings(page, 'shortcuts');
  await page.locator('#keybinding-restart').press('Enter');
  await expect(page.locator('#keybindings-form [aria-invalid=\"true\"]')).toHaveCount(0);
  await expect.poll(() => stamps()?.keybindings).not.toBe(stamp);

  expect(supabase.profileFor(user.email).preferences).toMatchObject({ duration: 30, layout: 'qwerty', keybindings });
});
