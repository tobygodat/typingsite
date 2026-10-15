// Keyboard layouts: the on-screen legend, the optional finger map, and the layout as a test condition.
import { conditionKey } from '../src/typing.js';
import { test, expect, openApp, openView, openSettings, chooseWords, completePassage, passageText, typeInto, signInWithEmail } from './fixtures.js';

const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/keyboard-layouts/${name}.png` : testInfo.outputPath(`${name}.png`));
const row = (page, index) => page.locator(`#keyboard .key-row:nth-child(${index}) .key`);
// The label printed on each cap: its first text node (with the finger map on, visually hidden words follow it).
const legend = async (page, index) => (await row(page, index).evaluateAll((keys) => keys.map((key) => key.firstChild.textContent))).join('');

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

test('the finger map names each key’s finger, bands alternate fingers, splits the hands and follows the layout', async ({ page }) => {
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
  // Each key carries its finger's initial as text, so the map reads without telling shades apart.
  const mark = (letter) => key(letter).evaluate((node) => getComputedStyle(node, '::after').content);
  expect(await Promise.all(['f', 'd', 's', 'a', 'j', 'l'].map(mark))).toEqual(['"i" / ""', '"m" / ""', '"r" / ""', '"p" / ""', '"i" / ""', '"r" / ""']);
  expect(await mark(' ')).toBe('none');
  // A band sits behind alternate fingers, so neighbouring fingers always differ.
  const background = (letter) => key(letter).evaluate((node) => getComputedStyle(node).backgroundColor);
  const [f, d, s, a] = await Promise.all(['f', 'd', 's', 'a'].map(background));
  expect([f !== d, d !== s, s !== a, f === s, d === a]).toEqual([true, true, true, true, true]);
  expect(await background('f')).toBe(await background('j'));
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
  // Choosing the current layout again changes nothing, so the prepared passage isn't thrown away.
  const before = await passageText(page);
  await runCommand(page, 'layout · colemak-dh');
  expect(await passageText(page)).toBe(before);

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

// The initial and band are hidden from assistive technology, so each key says its finger in words.
test('the finger map names each key’s hand and finger to assistive technology, and only while it is on', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await page.locator('#keyboard-toggle').check();
  const keyboard = page.locator('#keyboard');
  const key = (letter) => page.locator(`#keyboard .key[data-key="${letter}"]`);
  const size = (letter) => key(letter).evaluate((node) => { const { width, height } = node.getBoundingClientRect(); return { width, height }; });
  // What assistive technology reads in the keyboard: one line of text, plus the legend when the map is on.
  const spoken = async () => (await keyboard.ariaSnapshot()).replace(/^- text: /, '').split('\n')[0];
  // Off: each key is just its letter, as before.
  expect(await spoken()).toBe('q w e r t y u i o p a s d f g h j k l ; z x c v b n m , . / space');
  await expect(key('f')).toHaveText('f');
  const plain = await size('f');

  // On: each key is one phrase naming its letter, hand and finger.
  await page.locator('#finger-toggle').check();
  await expect(keyboard).toHaveAttribute('data-fingers', 'true');
  const home = 'a, left pinky s, left ring d, left middle f, left index g, left index h, right index j, right index k, right middle l, right ring ;, right pinky';
  expect(await spoken()).toContain(home);
  expect(await spoken()).toMatch(/\/, right pinky space, thumbs$/);
  // The cap is unchanged: the words are visually hidden and it still prints only its letter.
  expect(await size('f')).toEqual(plain);
  expect(await legend(page, 2)).toBe('asdfghjkl;');

  // The words follow the layout: Dvorak's home row puts u under the left index finger.
  await page.locator('#layout-select').selectOption('dvorak');
  expect(await spoken()).toContain('a, left pinky o, left ring e, left middle u, left index i, left index d, right index');

  await page.locator('#finger-toggle').uncheck();
  expect(await spoken()).not.toMatch(/index|middle|ring|pinky|thumb/);
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
  const targets = page.locator('#keyboard .key.target');
  await expect(targets).toHaveCount(2);
  expect(await targets.evaluateAll((keys) => keys.map((key) => key.dataset.key))).toEqual(['h', 't']);
  // With the finger map on, a target still looks different from an untargeted key on the same finger.
  const look = (letter) => page.locator(`#keyboard .key[data-key="${letter}"]`).evaluate((node) => {
    const style = getComputedStyle(node);
    return { finger: node.dataset.finger, color: style.color, background: style.backgroundColor };
  });
  for (const [target, other] of [['t', 'g'], ['h', 'r']]) {
    const [a, b] = await Promise.all([look(target), look(other)]);
    expect(a.finger).toBe(b.finger);
    expect(a.background).toBe(b.background);
    expect(a.color).not.toBe(b.color);
  }
});

test('a retest keeps the chosen layout and refuses a baseline typed on another', async ({ page }) => {
  await openApp(page);
  await runCommand(page, 'layout · dvorak');
  await chooseWords(page, 10);
  await completePassage(page);
  await runCommand(page, 'layout · qwerty');
  await expect(page.locator('#condition-line')).not.toContainText('dvorak');
  await openView(page, 'Train');
  await page.locator('#skip-to-retest').click();
  await expect(page.locator('#comparison-status')).toHaveText('No fair retest available.');
  await expect(page.locator('#comparison-sample')).toHaveText('different keyboard layout');
  await expect(page.locator('#comparison-caveat')).toHaveText('The baseline was typed on dvorak. Switch the keyboard layout back to dvorak to retest it.');
  await openSettings(page);
  await expect(page.locator('#layout-select')).toHaveValue('qwerty');
  await page.keyboard.press('Escape');

  // A drill from that baseline stands alone, on the layout in use.
  await openView(page, 'Train');
  await page.locator('#start-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#condition-line')).not.toContainText('dvorak');
  await expect(page.locator('#session-description')).toHaveText('Standalone drill. The baseline was typed on dvorak. Switch the keyboard layout back to dvorak to retest it.');

  // Back on Dvorak, a new baseline retests on Dvorak.
  await runCommand(page, 'layout · dvorak');
  await chooseWords(page, 10);
  await completePassage(page);
  await openView(page, 'Train');
  await page.locator('#skip-to-retest').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await expect(page.locator('#condition-line')).toContainText('10 words · plain · physical keyboard · dvorak');
});

test('touch input keeps the default key: the layout setting describes a physical keyboard', async ({ page }) => {
  await openApp(page);
  await runCommand(page, 'layout · dvorak');
  await expect(page.locator('#condition-line')).toContainText('physical keyboard · dvorak');
  await page.locator('#typing-input').dispatchEvent('pointerdown', { pointerType: 'touch' });
  await expect(page.locator('#condition-line')).toContainText('touch input · continue on error');
  await expect(page.locator('#condition-line')).not.toContainText('dvorak');
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

  // A touch run's baseline is recorded as QWERTY whatever the setting says, so the setting never blocks it.
  test('a touch baseline drills and retests while another physical layout is chosen', async ({ page }) => {
    await openApp(page);
    await runCommand(page, 'layout · dvorak');
    await chooseWords(page, 10);
    await page.locator('#typing-input').tap();
    await expect(page.locator('#condition-line')).toContainText('touch input · continue on error');
    await completePassage(page);
    await expect(page.locator('#result-conditions')).not.toContainText('dvorak');

    // The drill keeps the touch baseline, so a retest follows it.
    await openView(page, 'Train');
    await page.locator('#manual-heading').click();
    await page.locator('#manual-target-input').fill('th');
    await page.locator('#apply-manual-target').click();
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
    await expect(page.locator('#session-description')).toHaveText('Doesn’t count toward your best.');

    // The retest starts, and on touch it compares with the touch baseline.
    await openView(page, 'Train');
    await page.locator('#skip-to-retest').click();
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
    await page.locator('#typing-input').tap();
    await expect(page.locator('#condition-line')).toContainText('10 words · plain · touch input · continue on error');
    await completePassage(page);
    await expect(page.locator('#comparison-panel')).toBeVisible();
    await expect(page.locator('#comparison-panel')).not.toHaveAttribute('data-outcome', 'unavailable');

    // Practising that target again from Progress finds the touch baseline too.
    await openView(page, 'Progress');
    await expect(page.locator('#progress-conditions')).toContainText('touch input');
    await page.locator('#history-list details summary').first().click();
    await page.getByRole('button', { name: 'Practice “th” again' }).click();
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
    await expect(page.locator('#session-description')).toHaveText('Doesn’t count toward your best.');
  });
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

test('custom text keeps master’s custom key on any layout, and a layout change keeps the custom passage', async ({ page, supabase }) => {
  const user = supabase.addUser('custom-layout@stilltype.test');
  const text = 'the quick brown fox jumps over the lazy dog';
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openSettings(page);
  await page.locator('#layout-select').selectOption('dvorak');
  await page.keyboard.press('Escape');

  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill(text);
  await page.locator('#custom-use').click();
  await expect(page.locator('#condition-line')).toContainText('custom text');
  await expect(page.locator('#condition-line')).not.toContainText('dvorak');
  await expect(page.locator('#best')).toHaveText('Not counted');

  // Like the word list, the layout keeps a custom passage rather than dropping back to a generated one.
  await openSettings(page);
  await page.locator('#layout-select').selectOption('colemak');
  await page.keyboard.press('Escape');
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#condition-line')).toContainText('custom text');
  expect(await passageText(page)).toBe(text);

  await typeInto(page, text);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toContainText('not counted toward your best');
  await expect.poll(() => supabase.profileFor(user.email)?.runs?.length).toBe(1);
  const saved = supabase.profileFor(user.email);
  const [run] = saved.runs;
  expect(run.kind).toBe('custom');
  // The custom key names no layout, so it is the same key master writes, and nothing became a best.
  expect(run.conditions.layout).toBe('qwerty');
  expect(conditionKey(run.conditions)).not.toContain('layout-');
  expect(conditionKey(run.conditions)).toBe(conditionKey({ ...run.conditions, layout: undefined }));
  expect(run.patterns).toBeUndefined();
  expect(saved.bests).toEqual({});
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
  // The on-screen keyboard is hidden on phones, so its rows are too.
  await expect(page.locator('label[for="keyboard-toggle"]')).toBeHidden();
  await expect(page.locator('#finger-row')).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.mouse.move(380, 250);
  await page.screenshot({ path: shot(testInfo, 'settings-mobile') });

  // At 320px the layout row still fits inside the popover without clipping or page overflow,
  // and the select is wide enough for its longest option beside the native arrow.
  await page.setViewportSize({ width: 320, height: 700 });
  await page.locator('#layout-select').selectOption('colemak-dh');
  await openSettings(page);
  const fit = await page.evaluate(() => {
    const popover = document.querySelector('.preferences-popover').getBoundingClientRect();
    const select = document.getElementById('layout-select');
    const rect = select.getBoundingClientRect();
    const label = [...document.querySelectorAll('.preference-row strong')].find((node) => node.textContent === 'keyboard layout');
    const style = getComputedStyle(select);
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const arrow = 20;
    const needed = Math.max(...[...select.options].map((option) => context.measureText(option.text).width))
      + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) + arrow;
    return { inside: rect.left >= popover.left && rect.right <= popover.right,
      clipped: label.scrollWidth > label.clientWidth,
      optionFits: needed <= select.offsetWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(fit).toEqual({ inside: true, clipped: false, optionFits: true, overflow: 0 });
});
