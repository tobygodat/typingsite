// Composing practice: a prompt, a free-typing field, free-typing speed and backspace rate,
// kept apart from copy tests and stored as numbers only.
import { test, expect, openApp, openSettings, openView, openProgressDetail, passageText, signInWithEmail, storageKeys, chooseMore, chooseSetting, closeSettings, insertPlainText, phone } from './fixtures.js';

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// Whether the engine has `caret-animation` at all (caretSupport further down fakes only the app's check).
const caretAnimationParses = (page) => page.evaluate(() => 'caretAnimation' in document.body.style);

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
  // Gaps over 2 s count as the average of the shorter gaps.
  let typing = 0;
  let gaps = 0;
  let long = 0;

  for (let index = 1; index < keys.length; index += 1) {
    const between = gap + (pauses[index - 1] || 0);

    if (between <= 2000) {
      typing += between;
      gaps += 1;
    } else long += 1;
  }

  const activeMs = Math.round(gaps ? typing + long * (typing / gaps) : 0);
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
  await chooseMore(page, 'mode-compose');
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
  await expect(page.locator('#compose-conditions')).toHaveText('composing · up to 60 s · physical keyboard');
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
  await expect(page.locator('#compose-definition')).toContainText('characters in your text ÷ 5, per minute of active typing (a pause over 2 s counts as your average gap)');
  await expect(page.locator('#compose-definition')).toContainText(`${want.backspaces} of ${want.keys} keystrokes were backspace or delete, held repeats included`);
  await expect(page.locator('#compose-definition')).toContainText('Never compared with copy tests, and never a best.');
  await expect(page.locator('#compose-saved')).toHaveText('Kept for this tab: these numbers, not your words.');
  await expect(page.locator('#compose-next')).toBeFocused();
  await expect(page.locator('#compose-input')).toHaveJSProperty('readOnly', true);

  // Progress lists it apart from copy-test charts; there is still no copy-test run or best.
  await openView(page, 'Progress');
  await expect(page.locator('#progress-empty')).toBeVisible();
  await expect(page.locator('#clear-history')).toBeVisible();
  await openProgressDetail(page, 'compose');
  await expect(page.locator('#compose-history')).toBeVisible();
  await expect(page.locator('#compose-history .compose-row')).toHaveCount(1);
  await expect(page.locator('#compose-history .compose-row-main')).toContainText(`${want.wpm} wpm`);
  await expect(page.locator('#compose-history .compose-row-main')).toContainText(`${want.backspaceRate}% backspace rate`);
  await expect(page.locator('#compose-history .compose-row')).toContainText(`“${prompt}”`);
  await expect(page.locator('#compose-history .compose-row')).toContainText(`${want.text.length} characters · ${want.backspaces} backspaces in ${want.keys} keystrokes`);
  await expect(page.locator('#compose-history .compose-row')).toHaveCount(1);
  await expect(page.locator('#compose-history')).not.toContainText('quiet, so I read');

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
  await expect(page.locator('#compose-progress')).toHaveAttribute('aria-valuetext', 'Ended after 60 seconds');
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
  await chooseMore(page, 'mode-compose');
  await expect(page.locator('#compose-input')).toBeFocused();

  await page.locator('#compose-input').evaluate((input) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'a whole pasted paragraph');
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#compose-input')).toHaveValue('');
  await expect(page.locator('#compose-help')).toHaveText('Paste is off. Type your answer.');
  await expect(page.locator('#compose-done')).toBeDisabled();

  // A drop is refused and said so, like paste; dragging over the field, with or without data, throws nothing.
  await page.locator('#compose-input').evaluate((input) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'a whole dropped paragraph');

    for (const type of ['dragenter', 'dragover', 'drop']) {
      input.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
    }

    input.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#compose-input')).toHaveValue('');
  await expect(page.locator('#compose-help')).toHaveText('Only typed keys count, so cut, drop and undo are off.');
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

test('cut, line deletes and keys over a selection change nothing and count nothing', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit' && process.platform !== 'darwin', 'WebKit has no word or line delete keys in Playwright outside macOS');
  await startPausedClock(page);
  await openCompose(page);
  const input = page.locator('#compose-input');
  const text = 'The kettle clicked off and I poured the tea';
  await typePaced(page, [...text], 220);
  const selection = () => input.evaluate((node) => [node.selectionStart, node.selectionEnd]);

  // A cut, from either cut key, would remove the whole selection as one counted delete.
  await input.evaluate((node) => node.setSelectionRange(4, 34));
  await page.keyboard.press('ControlOrMeta+x');
  await expect(input).toHaveValue(text);
  await expect(page.locator('#compose-help')).toHaveText('Only typed keys count, so cut, drop and undo are off.');
  await page.keyboard.press('Shift+Delete');
  await expect(input).toHaveValue(text);
  const cut = await input.evaluate((node) => node.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteByCut', bubbles: true, cancelable: true })));
  expect(cut, 'a dispatched cut is cancelled').toBe(false);

  // Typing or deleting over the selection would silently replace it.
  await page.keyboard.type('x');
  await expect(input).toHaveValue(text);
  await expect(page.locator('#compose-help')).toHaveText('Edit at the caret. Typing or deleting over a selection is off.');
  await page.keyboard.press('Backspace');
  await expect(input).toHaveValue(text);
  expect(await selection()).toEqual([4, 34]);

  // At the caret, a line delete is refused, and a word delete is one deleting key.
  await page.keyboard.press('End');
  expect(await selection()).toEqual([text.length, text.length]);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Backspace' : 'Control+Shift+Backspace');
  await expect(input).toHaveValue(text);
  await expect(page.locator('#compose-help')).toHaveText('Delete a letter or a word at a time.');
  await page.keyboard.press(process.platform === 'darwin' ? 'Alt+Backspace' : 'Control+Backspace');
  await page.clock.runFor(220);
  const kept = 'The kettle clicked off and I poured the ';
  await expect(input).toHaveValue(kept);

  // Only the typed letters and the one word delete count.
  await page.keyboard.press('Control+Enter');
  const keystrokes = text.length + 1;
  const activeMs = text.length * 220;
  await expect(page.locator('#compose-definition')).toContainText(`1 of ${keystrokes} keystrokes were backspace or delete`);
  await expect(page.locator('#compose-backspace')).toHaveText(String(Math.round((1 / keystrokes) * 100)));
  await expect(page.locator('#compose-characters')).toHaveText(String(kept.length));
  await expect(page.locator('#compose-active')).toHaveText((activeMs / 1000).toFixed(1));
  await expect(page.locator('#compose-wpm')).toHaveText(String(Math.round(kept.length / 5 / (activeMs / 60_000))));
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

test('Tab reaches Done first, the finished field leaves the tab order and the clock agrees', async ({ page }) => {
  await startPausedClock(page);
  await openCompose(page);
  // No scrollbar beside the writing, and the caret holds still.
  await expect(page.locator('#compose-input')).toHaveCSS('scrollbar-width', 'none');

  if (await caretAnimationParses(page)) await expect(page.locator('#compose-input')).toHaveCSS('caret-animation', 'manual');

  // 49 keys and one 2.6 s pause: 13.87 s from the first key to Done.
  await typePaced(page, [...'First line of my answer, and then a little more.'], 230, { 20: 2600 });
  // The progress line steps with the clock, also when a pointer nudge brings the chrome back mid-way.
  const bar = page.locator('#compose-progress-bar');
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  await expect(bar).toHaveCSS('transition-duration', '0s');
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await expect(page.locator('body')).toHaveAttribute('data-running', 'false');
  await expect(bar).toHaveCSS('transition-duration', '0s');
  expect(await bar.evaluate((node) => node.getAnimations().length)).toBe(0);
  await page.keyboard.press('Tab');
  await expect(page.locator('#compose-done')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('#compose-result-heading')).toHaveText('Finished after 14 s');
  await expect(page.locator('#compose-input')).toHaveValue('First line of my answer, and then a little more.');
  await expect(page.locator('#compose-timer')).toHaveText('46');
  await expect(page.locator('#compose-progress')).toHaveAttribute('aria-valuetext', 'Ended after 14 seconds');

  // The read-only field has no caret to show focus, so Shift+Tab passes over it.
  await expect(page.locator('#compose-next')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#compose-retry')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#compose-another')).toBeFocused();
  await page.locator('#compose-retry').click();
  await expect(page.locator('#compose-input')).toBeFocused();
  await expect(page.locator('#compose-input')).toHaveJSProperty('tabIndex', 0);
});

test('keyless input, focus loss and an emptied field are never saved, and settings wait', async ({ page, browserName }) => {
  await startPausedClock(page);
  // A copy test in progress is dropped on the way in, and its hidden passage is left alone.
  await page.locator('#typing-input').focus();
  await page.keyboard.type('th');
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  const hidden = await passageText(page);
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await openCompose(page);
  await expect(page.locator('body')).toHaveAttribute('data-running', 'false');

  // A setting that would draw a new passage waits until composing ends.
  await openSettings(page);
  await openSettings(page, 'practice');
  await chooseSetting(page, 'word-list', '1k');
  await closeSettings(page);
  await expect(page.locator('#compose-form')).toBeVisible();
  expect(await passageText(page)).toBe(hidden);

  // Several characters in one go and undo are refused.
  await page.locator('#compose-input').focus();
  await insertPlainText(page, 'a whole sentence');
  await expect(page.locator('#compose-input')).toHaveValue('');
  await expect(page.locator('#compose-help')).toHaveText('One key at a time.');
  await typePaced(page, [...'abc'], 200);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#compose-input')).toHaveValue('abc');
  await expect(page.locator('#compose-help')).toHaveText('Only typed keys count, so cut, drop and undo are off.');
  await page.keyboard.press('Escape');

  // IME text is never keyed, so no rate is shown for it. Chromium composes through CDP and Firefox
  // through Playwright's own text insert (see insertPlainText); WebKit can't compose in Playwright.
  if (browserName !== 'webkit') {
    await typePaced(page, [...'Tea first, then the news. '], 200);

    if (browserName === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 });
      await cdp.send('Input.insertText', { text: '日本' });
    } else {
      await page.keyboard.insertText('日本');
    }

    await expect(page.locator('#compose-help')).toHaveText('IME input isn’t measured. Esc to start over.');
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('#compose-result-heading')).toHaveText('IME input · not measured or saved');
    await expect(page.locator('#compose-wpm')).toHaveText('—');
    await expect(page.locator('#compose-backspace')).toHaveText('—');
    await page.locator('#compose-retry').click();
  }

  // Focus leaving the window mid-way means it won't be saved.
  await typePaced(page, [...'The kettle clicked off. '], 200);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#compose-help')).toHaveText('Focus lost, so this one won’t be saved. Esc to start over.');
  await page.locator('#compose-input').focus();
  await typePaced(page, [...'Then toast. '], 200);
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#compose-result-heading')).toHaveText('Interrupted · not saved');

  // Plenty of typing, all deleted again: nothing to measure, and it says why.
  await page.locator('#compose-retry').click();
  const keys = [...'Nothing to keep here at all.'];
  await typePaced(page, [...keys, ...keys.map(() => '\b')], 200);
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#compose-result-heading')).toHaveText('No text left to measure · not saved');
  await expect(page.locator('#compose-active')).toHaveText(((keys.length * 2 - 1) * 0.2).toFixed(1));
  await expect(page.locator('#compose-saved')).toHaveText('The field was empty at the end, so there is no speed.');

  await openView(page, 'Progress');
  await expect(page.locator('#compose-history')).toBeHidden();

  // Leaving composing starts a fresh copy test from the new word list.
  await openView(page, 'Practice');
  await page.locator('#mode-time').click();
  await page.clock.runFor(50);
  await expect(page.locator('#typing-form')).toBeVisible();
  await expect(page.locator('#typing-input')).toHaveValue('');
  await expect(page.locator('body')).toHaveAttribute('data-running', 'false');
  expect(await passageText(page)).not.toBe(hidden);
});

// An edit the browser makes on its own, as autocorrect or assistive text can: `before` and
// `after` are the beforeinput and input it reports, if any, around the change to `value`.
async function browserEdit(input, value, { before = null, after = null } = {}) {
  await input.evaluate((node, edit) => {
    if (edit.before) node.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: false, ...edit.before }));
    node.value = edit.value;
    node.setSelectionRange(edit.value.length, edit.value.length);

    if (edit.after) node.dispatchEvent(new InputEvent('input', { bubbles: true, ...edit.after }));
  }, { value, before, after });
}

// Ends the session and checks it is reported as unsupported input: no rates and nothing saved.
async function finishUnsupported(page) {
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#compose-result-heading')).toHaveText('IME input · not measured or saved');
  await expect(page.locator('#compose-wpm')).toHaveText('—');
  await expect(page.locator('#compose-backspace')).toHaveText('—');
  await expect(page.locator('#compose-saved')).toHaveText('IME input isn’t measured. Esc to start over.');
}

test('text no counted key typed, an edit a refusal could not cancel or unlike its key, or a delete of more than one character marks it unsupported and is never saved', async ({ page }) => {
  // Nine sessions of about forty keys each.
  test.setTimeout(90_000);
  await startPausedClock(page);
  await openCompose(page);
  const input = page.locator('#compose-input');
  const autocorrected = 'I made teh tea and sat by the window. ';
  const bus = 'The bus came early, so I walked the last bit';
  const sentence = `${bus}. `;
  const phrase = 'and then a little more';

  const edits = [
    // Input with no cancellable beforeinput first: a replacement, and a type nothing here knows.
    [autocorrected, autocorrected.replace('teh', 'the'), { after: { inputType: 'insertReplacementText', data: 'the' } }],
    [autocorrected, autocorrected.replace('teh', 'the'), { after: { inputType: 'insertFromAssistiveText', data: 'the' } }],
    // A refused replacement whose beforeinput can't be cancelled, which the browser then applies.
    [sentence, sentence.replace('bit', 'part'), { before: { inputType: 'insertReplacementText', data: 'part' }, after: { inputType: 'insertReplacementText', data: 'part' } }],
    // Several characters at once, refused but not cancellable: a counted type, but not one key.
    [sentence, sentence + phrase, { before: { inputType: 'insertText', data: phrase }, after: { inputType: 'insertText', data: phrase } }],
    // A counted key whose change isn't that key: the field no longer matches the recorded text.
    [sentence, `${sentence.replace('bus', 'tram')}x`, { after: { inputType: 'insertText', data: 'x' } }],
    // One character reported as typed but with no character to check it against.
    [sentence, `${sentence}x`, { before: { inputType: 'insertText', data: null }, after: { inputType: 'insertText', data: null } }],
    // An ordinary Backspace at the caret, as the browser reports it, that took a whole word.
    [bus, bus.slice(0, -'bit'.length), { before: { inputType: 'deleteContentBackward' }, after: { inputType: 'deleteContentBackward' } }],
    // A Delete with no beforeinput at all that took a selection's worth of letters.
    [bus, bus.replace('early', 'e'), { after: { inputType: 'deleteContentForward' } }],
  ];

  for (const [typed, value, events] of edits) {
    await typePaced(page, [...typed], 230);
    await browserEdit(input, value, events);
    await finishUnsupported(page);
    await page.locator('#compose-retry').click();
  }

  // A change with no event at all is caught at the end: the field no longer matches the keys.
  await typePaced(page, [...autocorrected], 230);
  await input.evaluate((node) => { node.value += 'and a line no key typed'; });
  await finishUnsupported(page);

  await openView(page, 'Progress');
  await expect(page.locator('#compose-history')).toBeHidden();
});

test('letters, Enter, Backspace, Delete and word deletes at any caret, emoji included, are all scored', async ({ page }) => {
  await startPausedClock(page);
  await openCompose(page);
  const input = page.locator('#compose-input');
  const word = process.platform === 'darwin' ? 'Alt' : 'Control';

  // Each counted key lands 200 ms after the last; caret moves change nothing and take no time.
  // An emoji is one character of two code units, and one Backspace takes it away again.
  const steps = [...'Toast with jam', 'Enter', ...'then a long walk.', 'move:ArrowLeft*5', `${word}+Backspace`,
    'Delete', 'W', `${word}+Delete`, 'move:End', 'x', 'Backspace', 'insert:😀', 'Backspace', ...' home.'];

  let keystrokes = 0;

  for (const step of steps) {
    if (step.startsWith('move:')) {
      const [key, times = 1] = step.slice(5).split('*');

      for (let index = 0; index < Number(times); index += 1) await page.keyboard.press(key);
      continue;
    }

    if (step.startsWith('insert:')) await insertPlainText(page, step.slice(7));
    else if (step.length === 1) await page.keyboard.type(step);
    else await page.keyboard.press(step);
    keystrokes += 1;
    await page.clock.runFor(200);
  }

  const text = await input.inputValue();
  expect(text.startsWith('Toast with jam\nthen a W')).toBe(true);
  await page.keyboard.press('Control+Enter');
  const activeMs = (keystrokes - 1) * 200;
  await expect(page.locator('#compose-result-heading')).toHaveText(/^Finished after \d+ s$/);
  await expect(page.locator('#compose-definition')).toContainText(`5 of ${keystrokes} keystrokes were backspace or delete`);
  await expect(page.locator('#compose-backspace')).toHaveText(String(Math.round((5 / keystrokes) * 100)));
  await expect(page.locator('#compose-characters')).toHaveText(String(text.length));
  await expect(page.locator('#compose-active')).toHaveText((activeMs / 1000).toFixed(1));
  await expect(page.locator('#compose-wpm')).toHaveText(String(Math.round(text.length / 5 / (activeMs / 60_000))));
  await expect(page.locator('#compose-saved')).toHaveText('Kept for this tab: these numbers, not your words.');
});

test('composing and custom text replace each other in the mode row', async ({ page }) => {
  const text = 'the quick brown fox jumps over the lazy dog';
  await startPausedClock(page);
  // A custom passage, then composing: Custom is no longer marked and its editor stays shut.
  await chooseMore(page, 'mode-custom');
  await page.locator('#custom-text').fill(text);
  await page.locator('#custom-use').click();
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-pressed', 'true');
  await openCompose(page);
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#mode-compose')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#custom-options')).toBeHidden();

  // Custom from composing leaves it: the passage is back, under the open editor.
  await chooseMore(page, 'mode-custom');
  await expect(page.locator('body')).toHaveAttribute('data-compose', 'false');
  await expect(page.locator('#compose-form')).toBeHidden();
  await expect(page.locator('#typing-form')).toBeVisible();
  await expect(page.locator('#custom-options')).toBeVisible();
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mode-compose')).toHaveAttribute('aria-pressed', 'false');

  // The open editor closes when composing starts, and the palette calls no test shape current.
  await openCompose(page);
  await expect(page.locator('#custom-options')).toBeHidden();
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Control+k');
  const option = (label) => page.locator('#palette-list [role="option"]').filter({ hasText: label }).first();
  await expect(option('composing practice')).toContainText('current');
  await expect(option('custom text')).not.toContainText('current');
  await page.keyboard.press('Escape');
  await page.clock.runFor(200);
  await expect(page.locator('#palette')).toBeHidden();

  // Using the text from composing starts the custom passage and ends composing.
  await chooseMore(page, 'mode-custom');
  await page.locator('#custom-use').click();
  await expect(page.locator('body')).toHaveAttribute('data-compose', 'false');
  await expect(page.locator('#condition-line')).toContainText('custom text');
  expect(await passageText(page)).toBe(text);
});

test('signed in, only the numbers reach the account', async ({ page, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await chooseMore(page, 'mode-compose');
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
  test.skip(!process.env.SCREENSHOTS, 'docs screenshots only; run with SCREENSHOTS=1');
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
  await openProgressDetail(page, 'compose');
  await page.clock.runFor(400);
  await page.screenshot({ path: shot(testInfo, 'progress-light') });
});

// Browsers without `caret-animation: manual` (Firefox and Safari today) would blink the native
// caret, so the field draws its own solid one there. Chromium has it, so these tests take it away.
const caretSupport = (page, supported) => page.addInitScript((value) => {
  const supports = CSS.supports.bind(CSS);
  CSS.supports = (...args) => (/caret-animation/.test(String(args[0])) ? value : supports(...args));
}, supported);

// Where one character of the field sits, measured apart from the app: a hidden copy of the field with
// every computed text property, laid over it, and a Range around the character (a textarea has no
// Ranges of its own). Shifted by the field's own scroll, like the text inside it.
function charRect(page, index) {
  return page.locator('#compose-input').evaluate((input, at) => {
    const style = getComputedStyle(input);
    const copy = document.createElement('div');
    const skip = /^(position|inset.*|top|right|bottom|left|(min-|max-)?(width|height|inline-size|block-size)|margin.*|overflow.*|visibility|display|float|clear|contain.*|content-visibility|transform.*|translate|scale|rotate)$/;

    for (const name of style) if (!skip.test(name)) copy.style.setProperty(name, style.getPropertyValue(name));
    const box = input.getBoundingClientRect();
    const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    Object.assign(copy.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${input.clientWidth + borders}px`, margin: '0', visibility: 'hidden' });
    copy.textContent = input.value;
    document.body.append(copy);
    const range = document.createRange();
    range.setStart(copy.firstChild, at);
    range.setEnd(copy.firstChild, at + 1);
    const rect = range.getBoundingClientRect();
    copy.remove();

    return { left: rect.left - input.scrollLeft, right: rect.right - input.scrollLeft, top: rect.top - input.scrollTop, bottom: rect.bottom - input.scrollTop };
  }, index);
}

const caretBox = (page) => page.locator('.compose-caret').evaluate((node) => {
  const rect = node.getBoundingClientRect();

  return { x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom };
});

// The drawn caret stands at one edge of a character, as tall as its letters, within a few pixels,
// and never past the field's edges (a space hung past the end of a line is wider than the field).
async function expectCaretAt(page, index, edge) {
  await expect.poll(async () => {
    const want = await charRect(page, index);
    const got = await caretBox(page);

    const [left, right] = await page.locator('#compose-input').evaluate((node) => {
      const box = node.getBoundingClientRect();

      return [box.left + node.clientLeft, box.left + node.clientLeft + node.clientWidth];
    });

    const x = Math.min(Math.max(want[edge], left + 1), right - 1);

    return Math.max(Math.abs(got.x - x), Math.abs(got.top - want.top), Math.abs(got.bottom - want.bottom));
  }, { message: `caret at the ${edge} of character ${index}` }).toBeLessThanOrEqual(3);
}

// How much of the drawn caret the field's clip leaves on screen: all 2px of it, at its full height.
async function expectWholeCaret(page) {
  await expect.poll(() => page.locator('.compose-caret').evaluate((node) => {
    const bar = node.getBoundingClientRect();
    const clip = node.parentElement.getBoundingClientRect();
    const width = Math.min(bar.right, clip.right) - Math.max(bar.left, clip.left);
    const height = Math.min(bar.bottom, clip.bottom) - Math.max(bar.top, clip.top);

    return { width: Math.round(Math.max(0, width) * 10) / 10, height: Math.round(Math.max(0, height) - bar.height) };
  }), { message: 'the whole caret is in view' }).toEqual({ width: 2, height: 0 });
}

// Where the field wraps a line: a character on a lower line than the one before it.
const wrapsBefore = async (page, index) => (await charRect(page, index)).top > (await charRect(page, index - 1)).top + 1;

const caretMotion = (page) => page.locator('.compose-caret').evaluate((node) => ({
  animations: node.getAnimations().length,
  animation: getComputedStyle(node).animationName,
  transition: getComputedStyle(node).transitionProperty,
}));

test.describe('without caret-animation', () => {
  test.beforeEach(async ({ page }) => { await caretSupport(page, false); });

  test('the field draws a solid caret at the selection instead of a blinking one', async ({ page, browserName }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await startPausedClock(page);
    expect(await page.evaluate(() => CSS.supports('caret-animation', 'manual'))).toBe(false);
    await openCompose(page);
    const input = page.locator('#compose-input');
    const caret = page.locator('.compose-caret');

    // The native caret is only made clear, never removed; the drawn one is the accent, unseen by
    // assistive tech and never in the way of a click.
    await expect(input).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
    await expect(caret).toHaveCount(1);
    await expect(caret).toHaveCSS('background-color', 'rgb(143, 209, 138)');
    await expect(caret).toHaveCSS('pointer-events', 'none');
    await expect(page.locator('.compose-caret-layer')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('.compose-caret-layer')).toHaveCSS('pointer-events', 'none');

    // Focused and empty, it waits at the start of the first line; it shows only while focused.
    await expect(caret).toBeVisible();

    const field = await input.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);

      return { left: rect.left + node.clientLeft + parseFloat(style.paddingLeft), top: rect.top + node.clientTop + parseFloat(style.paddingTop), line: parseFloat(style.lineHeight) };
    });

    const start = await caretBox(page);
    expect(Math.abs(start.x - field.left)).toBeLessThanOrEqual(3);
    expect(start.top).toBeGreaterThanOrEqual(field.top);
    expect(start.bottom).toBeLessThanOrEqual(field.top + field.line);
    await expectWholeCaret(page);
    expect(await caretMotion(page)).toEqual({ animations: 0, animation: 'none', transition: 'none' });
    await input.evaluate((node) => node.blur());
    await expect(caret).toBeHidden();
    await input.focus();
    await expect(caret).toBeVisible();

    // Writing, it stands after the last letter, and nothing about it moves on its own.
    const first = 'The kettle ticked while the light came up';
    await typePaced(page, [...first], 210);
    await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
    await expectCaretAt(page, first.length - 1, 'right');
    expect(await caretMotion(page)).toEqual({ animations: 0, animation: 'none', transition: 'none' });

    // A selection shows its highlight instead; collapsing it brings the caret back.
    for (let index = 0; index < 3; index += 1) await page.keyboard.press('Shift+ArrowLeft');
    await expect(caret).toBeHidden();
    await page.keyboard.press('ArrowRight');
    await expect(caret).toBeVisible();
    await expectCaretAt(page, first.length - 1, 'right');

    // A click into the middle of the text moves it there.
    const middle = await charRect(page, 11);
    await page.mouse.click(middle.left + 1, (middle.top + middle.bottom) / 2);
    const at = await input.evaluate((node) => node.selectionStart);
    expect(at).toBeGreaterThan(5);
    expect(at).toBeLessThan(first.length - 5);
    await expectCaretAt(page, at, 'left');

    // Past three lines the field scrolls inside; the caret keeps to its letter, and scrolling the
    // field by hand carries it along.
    await page.keyboard.press('Control+End');
    const rest = '\nthen toast\nthe bus\ncame late';
    await typePaced(page, [...rest], 210);
    const text = first + rest;
    await expect(input).toHaveValue(text);
    await expect.poll(() => input.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await expectCaretAt(page, text.length - 1, 'right');
    const before = { caret: await caretBox(page), scroll: await input.evaluate((node) => node.scrollTop) };
    await input.evaluate((node, by) => { node.scrollTop -= by; }, Math.round(field.line / 2));
    const scrolled = before.scroll - await input.evaluate((node) => node.scrollTop);
    expect(scrolled).toBeGreaterThan(0);
    await expect.poll(async () => Math.abs((await caretBox(page)).top - before.caret.top - scrolled)).toBeLessThanOrEqual(1);
    await expectCaretAt(page, text.length - 1, 'right');

    // A narrower window or a larger text size wraps the writing again; the caret follows.
    await page.setViewportSize({ width: 860, height: 800 });
    await expectCaretAt(page, text.length - 1, 'right');
    await page.evaluate(() => { document.body.dataset.fontSize = '36'; });
    await expectCaretAt(page, text.length - 1, 'right');
    await page.evaluate(() => { document.body.dataset.fontSize = '28'; });
    await page.setViewportSize({ width: 1280, height: 800 });
    await expectCaretAt(page, text.length - 1, 'right');

    // IME still composes in the real field (it just isn't measured); the caret follows the composition.
    // A real composition needs CDP, which only Chromium has.
    if (browserName === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 });
      await expect(input).toHaveValue(`${text}にほ`);
      await expect(caret).toBeVisible();
      await expectCaretAt(page, text.length + 1, 'right');
      await cdp.send('Input.insertText', { text: '日本' });
      await expect(input).toHaveValue(`${text}日本`);
      await expect(page.locator('#compose-help')).toHaveText('IME input isn’t measured. Esc to start over.');
    }

    // Finished, the field is read-only and shows no caret, even with focus put back on it.
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('#compose-result')).toBeVisible();
    await expect(caret).toBeHidden();
    await input.focus();
    await expect(input).toBeFocused();
    await expect(caret).toBeHidden();

    // Write another starts it again at the beginning of an empty field.
    await page.locator('#compose-next').click();
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(caret).toBeVisible();
    // The next prompt may take another line, so this is measured from the field, not the page.
    const again = await caretBox(page);

    const moved = await input.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);

      return { left: rect.left + node.clientLeft + parseFloat(style.paddingLeft), top: rect.top + node.clientTop + parseFloat(style.paddingTop) };
    });

    expect(Math.abs((again.x - moved.left) - (start.x - field.left))).toBeLessThanOrEqual(1);
    expect(Math.abs((again.top - moved.top) - (start.top - field.top))).toBeLessThanOrEqual(1);
    await expectWholeCaret(page);
  });

  test('a space typed at the end of a full last line keeps the caret on that line, in view', async ({ page }) => {
    await startPausedClock(page);
    await openCompose(page);
    const input = page.locator('#compose-input');
    // Two lines and a little, then a word that fills the third line to within one narrow letter.
    await typePaced(page, [...'The kitchen was quiet, so I read by the window until the light came up over the roofs and the street began to fill. Later '], 60);
    const overflows = () => input.evaluate((node) => node.scrollHeight > node.clientHeight);

    for (const letter of 'mi') {
      while (!(await overflows())) await typePaced(page, [letter], 60);
      await typePaced(page, ['\b'], 60);
    }

    expect(await overflows()).toBe(false);
    const last = (await input.inputValue()).length - 1;
    const line = await charRect(page, last);
    const right = await input.evaluate((node) => node.getBoundingClientRect().left + node.clientLeft + node.clientWidth);
    await expectCaretAt(page, last, 'right');

    // Spaces after it hang past the edge: the field neither wraps nor scrolls, and the caret stays
    // on that line, whole, as far right as the field goes.
    for (let index = 0; index < 3; index += 1) {
      await typePaced(page, [' '], 60);
      expect(await input.evaluate((node) => node.scrollTop)).toBe(0);
      await expect(page.locator('.compose-caret')).toBeVisible();
      await expect.poll(async () => Math.abs((await caretBox(page)).top - line.top)).toBeLessThanOrEqual(3);
      expect((await caretBox(page)).x).toBeGreaterThanOrEqual(Math.min(line.right, right - 1) - 1);
      await expectWholeCaret(page);
    }

    expect(Math.abs((await caretBox(page)).x - (right - 1))).toBeLessThanOrEqual(1);
  });

  test('at a wrapped line the caret shows on the line the key or click left it on', async ({ page, browserName }) => {
    await startPausedClock(page);
    await openCompose(page);
    const input = page.locator('#compose-input');
    const at = () => input.evaluate((node) => node.selectionStart);
    // Thirteen words run onto a second line; a long word after them goes whole to the third.
    const words = 'word '.repeat(13);
    await typePaced(page, [...words, 'm'], 60);

    while (!(await wrapsBefore(page, words.length))) await typePaced(page, ['m'], 60);
    const third = words.length;

    // End on the first line stops at its last space, which is also where the second line starts:
    // the caret shows at the end of the first.
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('End');
    const second = await at();
    expect(await wrapsBefore(page, second)).toBe(true);
    expect(second).toBeLessThan(third - 5);
    await expectCaretAt(page, second - 1, 'right');
    await page.keyboard.press('Home');
    await expect.poll(at).toBe(0);
    await expectCaretAt(page, 0, 'left');
    await page.keyboard.press('End');
    await expectCaretAt(page, second - 1, 'right');

    // Right and back again, or Home, keep it at the start of the next line. Firefox's Right first
    // takes it there at the same offset, and its Left back to the end of the first line.
    await page.keyboard.press('ArrowRight');

    if (browserName === 'firefox') {
      await expectCaretAt(page, second, 'left');
      await page.keyboard.press('ArrowLeft');
      await expect.poll(at).toBe(second);
      await expectCaretAt(page, second - 1, 'right');
      await page.keyboard.press('ArrowRight');
    } else {
      await expectCaretAt(page, second, 'right');
      await page.keyboard.press('ArrowLeft');
    }

    await expect.poll(at).toBe(second);
    await expectCaretAt(page, second, 'left');

    // A click past the end of the first line puts it there; a click at the start of the second, there.
    const first = await charRect(page, second - 1);
    const next = await charRect(page, second);
    const field = await input.boundingBox();
    await page.mouse.click(field.x + field.width - 2, (first.top + first.bottom) / 2);
    await expect.poll(at).toBe(second);
    await expectCaretAt(page, second - 1, 'right');
    await page.mouse.click(next.left + 1, (next.top + next.bottom) / 2);
    await expect.poll(at).toBe(second);
    await expectCaretAt(page, second, 'left');

    // Down from the end of the first line lands past the end of the short second one, and stays on
    // it; Up from the start of the third keeps to the start of the second.
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowDown');
    await expect.poll(at).toBe(third);
    await expectCaretAt(page, third - 1, 'right');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Home');
    await expect.poll(at).toBe(third);
    await expectCaretAt(page, third, 'left');
    await page.keyboard.press('ArrowUp');
    await expect.poll(at).toBe(second);
    await expectCaretAt(page, second, 'left');

    // Typing there writes at the start of the second line, where the caret is shown, and deleting
    // brings it back there. A space typed there joins the spaces ending the first line, and the
    // caret follows it there, as the browser shows it.
    await typePaced(page, ['a'], 60);
    await expectCaretAt(page, second, 'right');
    await typePaced(page, ['\b'], 60);
    await expect.poll(at).toBe(second);
    await expectCaretAt(page, second, 'left');
    await typePaced(page, [' '], 60);
    expect(await wrapsBefore(page, second + 1)).toBe(true);
    await expectCaretAt(page, second, 'right');
  });

  test('drawn caret screenshots, dark and light', async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await startPausedClock(page);
    await openCompose(page);

    while ((await page.locator('#compose-prompt').textContent()) !== 'Describe your morning in three sentences.') {
      await page.locator('#compose-another').click();
    }

    const keys = [...'I woke before the alarm and made tea whiel', '\b', '\b', ...'le the kettle ticked. The street was still dark'];
    await typePaced(page, keys, 210, { 64: 2600 });
    const text = await page.locator('#compose-input').inputValue();
    await expectCaretAt(page, text.length - 1, 'right');
    await expect(page.locator('.practice-controls')).toHaveCSS('opacity', '0');
    await page.screenshot({ path: shot(testInfo, 'writing-drawn-caret-dark') });

    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 241, 235)');
    await expect(page.locator('.compose-caret')).toHaveCSS('background-color', 'rgb(33, 114, 69)');
    await typePaced(page, [...', so I read by the window'], 210);
    await expectCaretAt(page, text.length + 24, 'right');
    await expect(page.locator('#compose-input')).toBeFocused();
    await page.screenshot({ path: shot(testInfo, 'writing-drawn-caret-light') });
  });
});

test('where the caret can be held solid, the field keeps its own and draws none', async ({ page }) => {
  await caretSupport(page, true);
  await page.emulateMedia({ colorScheme: 'dark' });
  await startPausedClock(page);
  await openCompose(page);
  const input = page.locator('#compose-input');
  await expect(input).toHaveCSS('caret-color', 'rgb(143, 209, 138)');

  if (await caretAnimationParses(page)) await expect(input).toHaveCSS('caret-animation', 'manual');
  await typePaced(page, [...'Toast and the radio'], 210);
  await expect(page.locator('.compose-caret, .compose-caret-layer')).toHaveCount(0);
  await expect(page.locator('.compose-wrap')).not.toHaveAttribute('data-caret', /./);
});

test.describe('touchscreen laptop', () => {
  test.use({ hasTouch: true });

  test('a tap on a button keeps physical keyboard; only a tap on the field means touch input', async ({ page }) => {
    await startPausedClock(page);
    await openCompose(page);
    const conditions = page.locator('#compose-conditions');

    // Another prompt by touch, then typed on the keyboard: a physical-keyboard session.
    await page.locator('#compose-another').tap();
    await expect(page.locator('#compose-input')).toBeFocused();
    await expect(conditions).toContainText('physical keyboard');
    await typePaced(page, [...'Toast, coffee and the radio on low. Then the bus.'], 230);
    await expect(conditions).toContainText('physical keyboard');
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('#compose-saved')).toHaveText('Kept for this tab: these numbers, not your words.');

    // Write another by touch keeps the next session on the keyboard too, until the field is tapped.
    await page.locator('#compose-next').tap();
    await expect(conditions).toContainText('physical keyboard');
    await page.locator('#compose-input').tap();
    await expect(conditions).toContainText('touch input');
    await typePaced(page, [...'The bus was late again, so I walked to work.'], 230);
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('#compose-saved')).toHaveText('Kept for this tab: these numbers, not your words.');

    await openView(page, 'Progress');
    const rows = page.locator('#compose-history .compose-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'physical keyboard' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'touch input' })).toHaveCount(1);
  });
});

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['narrow phone', { width: 320, height: 640 }]]) {
  test.describe(`${name} ${viewport.width}px`, () => {
    test.use({ viewport, ...phone });

    test('composing fits without sideways scroll and keeps 44px targets', async ({ page }, testInfo) => {
      // The narrow phone checks the layout; the phone only takes the docs screenshot.
      test.skip(viewport.width === 390 && !process.env.SCREENSHOTS, 'docs screenshots only; run with SCREENSHOTS=1');
      await page.emulateMedia({ colorScheme: 'dark' });
      await startPausedClock(page);
      await chooseMore(page, 'mode-compose');
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
