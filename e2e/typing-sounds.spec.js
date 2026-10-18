// Typing sounds: off by default, a lazily created AudioContext, a click per key, a tick only for a
// mistyped letter, volume (0 is silent), palette commands and the guest/member preference rules.
// AudioContext is stubbed so each test can count what would have played. Choosing an audible sound
// builds the context just after the change, so the next key clicks; a sound that arrives any other way
// (a reload, an import) waits for the first key, which is silent. Never built inside an event.
import { test, expect, openApp, openView, passageText, typeInto, chooseWords, chooseMore, completePassage, openSettings, signInWithEmail, chooseSetting } from './fixtures.js';

async function stubAudio(page) {
  await page.addInitScript(() => {
    const log = { created: 0, closed: 0, state: null, states: [], plays: [], clickGains: [], builtDuring: [] };
    window.__sound = log;
    const node = (extra) => ({ connect(target) { return target; }, disconnect() {}, ...extra });
    const param = (record) => ({ value: 0, setValueAtTime(value) { record?.(value); return this; }, exponentialRampToValueAtTime() { return this; } });
    class FakeAudioContext {
      constructor() {
        log.created += 1;
        // window.event is set only while an event is being dispatched, as an input handler is.
        if (window.event) log.builtDuring.push(window.event.type);
        this.state = 'running';
        log.state = 'running';
        this.currentTime = 0;
        this.sampleRate = 48000;
        this.destination = node({});
      }
      // As in a browser, suspend and resume take effect once the audio thread has acted.
      resume() { return this.settle('running'); }
      suspend() { return this.settle('suspended'); }
      settle(state) {
        return new Promise((resolve) => setTimeout(() => {
          if (this.state !== 'closed') { this.state = state; log.state = state; log.states.push(state); }
          resolve();
        }));
      }
      close() { log.closed += 1; this.state = 'closed'; log.state = 'closed'; return Promise.resolve(); }
      createBuffer(channels, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
      createBufferSource() { return node({ buffer: null, start() { log.plays.push('click'); }, stop() {} }); }
      createOscillator() { return node({ type: 'sine', frequency: param(), start() { log.plays.push('tick'); }, stop() {} }); }
      createBiquadFilter() { return node({ type: 'lowpass', frequency: { value: 0 }, Q: { value: 0 } }); }
      // The click sets its starting level once; the tick ramps, so only clicks are recorded here.
      createGain() { return node({ gain: param((value) => { if (value > 0.001) log.clickGains.push(value); }) }); }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });
}

const sound = (page) => page.evaluate(() => ({ ...window.__sound, states: [...window.__sound.states], plays: [...window.__sound.plays], clickGains: [...window.__sound.clickGains], builtDuring: [...window.__sound.builtDuring] }));
const plays = async (page) => (await sound(page)).plays;
const wrongFor = (char) => (char === 'x' ? 'z' : 'x');

// Waits for the one open context that choosing a sound builds, so the next key plays.
async function soundReady(page) {
  await expect.poll(async () => { const { created, closed } = await sound(page); return created - closed; }).toBe(1);
}

// Types the first audible key, which makes no sound itself, and waits for the context it asked for.
async function firstKey(page, char) {
  await typeInto(page, char);
  await soundReady(page);
}

async function chooseSound(page, mode) {
  await openSettings(page, 'sound');
  await chooseSetting(page, 'sound-select', mode);
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeHidden();
}

async function restart(page) {
  await page.locator('#typing-input').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveAttribute('data-running', 'true');
}

const settingsFit = (page) => page.locator('#settings-dialog .settings-category:visible .setting-option span').evaluateAll((options) => options.every((option) => option.scrollWidth <= option.clientWidth));

async function shot(page, testInfo, name) {
  const path = process.env.SCREENSHOTS ? `docs/screenshots/typing-sounds/${name}.png` : testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
}

test.beforeEach(async ({ page }) => { await stubAudio(page); });
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== 'passed') return;
  expect((await sound(page)).builtDuring, 'no AudioContext is built inside an event handler').toEqual([]);
});

test('sound is off by default and no audio context is made', async ({ page }) => {
  await openApp(page);
  await openSettings(page, 'sound');
  await expect(page.locator('#sound-select input:checked')).toHaveValue('off');
  await expect(page.locator('#sound-volume-row')).toBeVisible();
  await expect(page.locator('#sound-volume')).toBeDisabled();
  await page.keyboard.press('Escape');
  const text = await passageText(page);
  await typeInto(page, `${text.slice(0, 4)}${wrongFor(text[4])}`);
  await page.keyboard.press('Backspace');
  expect(await sound(page)).toMatchObject({ created: 0, plays: [] });
});

test('choosing a sound readies it for the first key; the tick marks only mistyped letters', async ({ page }) => {
  await openApp(page);
  await chooseSound(page, 'clicks');
  await soundReady(page);

  let text = await passageText(page);
  await typeInto(page, text[0]);
  expect(await plays(page), 'the first key after choosing a sound clicks').toEqual(['click']);
  // Clicks only: a correct letter, a mistyped letter and a backspace each click.
  await page.keyboard.type(`${text[1]}${wrongFor(text[2])}`);
  await page.keyboard.press('Backspace');
  expect(await plays(page)).toEqual(['click', 'click', 'click', 'click']);

  await restart(page);
  await chooseSound(page, 'clicks-errors');
  text = await passageText(page);
  await typeInto(page, `${text[0]}${wrongFor(text[1])}`);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text[1]);
  expect(await plays(page)).toEqual(['click', 'click', 'click', 'click', 'click', 'tick', 'click', 'click']);
  expect((await sound(page)).created, 'one context for the whole session').toBe(1);
});

test('a sound chosen before any run leaves its context suspended until the first key', async ({ page }) => {
  await openApp(page);
  await openView(page, 'Train');
  await chooseSound(page, 'clicks');
  await soundReady(page);
  await expect.poll(async () => (await sound(page)).state, 'nothing is being typed, so the context rests').toBe('suspended');

  await openView(page, 'Practice');
  const text = await passageText(page);
  await typeInto(page, text[0]);
  expect(await plays(page), 'the first key still clicks').toEqual(['click']);
  await expect.poll(async () => (await sound(page)).state).toBe('running');
});

test('a backspace before the first letter clicks, then the context rests again', async ({ page }) => {
  await openApp(page);
  await chooseSound(page, 'clicks');
  await soundReady(page);
  await expect.poll(async () => (await sound(page)).state).toBe('suspended');
  await page.locator('#typing-input').focus();
  await page.keyboard.press('Backspace');
  expect(await plays(page)).toEqual(['click']);
  await expect(page.locator('body')).not.toHaveAttribute('data-running', 'true');
  await expect.poll(async () => (await sound(page)).states.slice(-2), 'woken for the click, then suspended').toEqual(['running', 'suspended']);
});

test('stop on error: a refused key clicks, only the mistyped letter ticks', async ({ page }) => {
  await openApp(page);
  await openSettings(page, 'sound');
  await chooseSetting(page, 'correction-select', 'mandatory');
  await chooseSetting(page, 'sound-select', 'clicks-errors');
  await page.keyboard.press('Escape');
  const text = await passageText(page);
  await soundReady(page);
  await typeInto(page, text[0]);
  await page.keyboard.type(`${wrongFor(text[1])}${text[2]}`);
  await expect(page.locator('#input-help')).toHaveText('Fix the underlined letter.');
  expect(await plays(page)).toEqual(['click', 'tick', 'click']);
});

// The first position from `from` inside a word of at least three letters, so a space there is early.
function midWord(text, from = 1) {
  return [...text].findIndex((char, i) => i >= from && /[a-z]/i.test(char) && /[a-z]/i.test(text[i - 1]) && /[a-z]/i.test(text[i + 1] || ''));
}

test('strict space: a refused space ticks, as the wrong key it scores', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page, 'sound');
  await chooseSetting(page, 'strict-space-toggle', true);
  await chooseSetting(page, 'sound-select', 'clicks-errors');
  await page.keyboard.press('Escape');
  const text = await passageText(page);
  const at = midWord(text);
  await soundReady(page);
  await typeInto(page, text.slice(0, at) + ' ');
  await expect(page.locator('#input-help')).toHaveText('Strict space is on. Type the next letter.');
  await page.keyboard.type(text[at]);
  expect(await plays(page)).toEqual([...Array(at).fill('click'), 'tick', 'click']);
});

test('quick end off: the space that submits a wrong last word clicks', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page, 'sound');
  await chooseSetting(page, 'quick-end-toggle', false);
  await chooseSetting(page, 'sound-select', 'clicks-errors');
  await page.keyboard.press('Escape');
  await soundReady(page);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, -1) + wrongFor(text.at(-1)));
  await expect(page.locator('#input-help')).toHaveText('The last word has a mistake. Fix it, or press space to finish.');
  await page.keyboard.press('Space');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  expect(await plays(page)).toEqual([...Array(text.length - 1).fill('click'), 'tick', 'click']);
});

test('no backspace: a refused backspace is silent; fail on any error ticks the key that ends the run', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await openSettings(page, 'sound');
  await chooseSetting(page, 'correction-select', 'no-backspace');
  await chooseSetting(page, 'sound-select', 'clicks-errors');
  await page.keyboard.press('Escape');
  let text = await passageText(page);
  await soundReady(page);
  await typeInto(page, text[0]);
  await page.keyboard.type(wrongFor(text[1]));
  await page.keyboard.press('Backspace');
  await expect(page.locator('#typing-input')).toHaveValue(`${text[0]}${wrongFor(text[1])}`);
  expect(await plays(page)).toEqual(['click', 'tick']);

  await restart(page);
  await openSettings(page, 'sound');
  await chooseSetting(page, 'correction-select', 'fail-any');
  await page.keyboard.press('Escape');
  text = await passageText(page);
  await typeInto(page, `${text[0]}${wrongFor(text[1])}`);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  expect(await plays(page)).toEqual(['click', 'tick', 'click', 'tick']);
});

test('code mode clicks and ticks through the same path as practice', async ({ page }) => {
  await openApp(page);
  await chooseSound(page, 'clicks-errors');
  await chooseMore(page, 'mode-code');
  await expect(page.locator('#condition-line')).toContainText('code ·');
  const text = await passageText(page);
  await soundReady(page);
  await typeInto(page, text[0]);
  await page.keyboard.type(`${text[1]}${wrongFor(text[2])}`);
  await page.keyboard.press('Backspace');
  expect(await plays(page)).toEqual(['click', 'click', 'tick', 'click']);
});

// An accent key opens a composition that the next key commits (src/app.js scores it after
// compositionend), as US-International sends a quotation mark.
async function accentKey(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Dead', code: 'Quote', windowsVirtualKeyCode: 222 });
  await cdp.send('Input.imeSetComposition', { text: '"', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Dead', code: 'Quote', windowsVirtualKeyCode: 222 });
  return { commit: (text) => cdp.send('Input.insertText', { text }) };
}

// The accent key itself is silent; the commit sounds once, as one key.
test('a dead-key commit sounds once, never for the accent key too', async ({ page }) => {
  await openApp(page);
  await chooseSound(page, 'clicks-errors');
  const text = await passageText(page);
  await soundReady(page);
  await typeInto(page, text[0]);
  const accent = await accentKey(page);
  expect(await plays(page), 'the open accent mark plays nothing').toEqual(['click']);
  await accent.commit('"');
  await expect.poll(() => plays(page)).toEqual(['click', 'tick']);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text[1]);
  expect(await plays(page)).toEqual(['click', 'tick', 'click', 'click']);
});

// "h onto "ah more words": the mark is a mistake at the a, so the commit ticks once. Continue on error
// scores the h as right after it; stop on error refuses the h.
test('a dead-key commit with a mistyped mark ticks once, whatever its next letter scores', async ({ page }) => {
  await openApp(page);
  await chooseMore(page, 'mode-custom');
  await page.locator('#custom-text').fill('ah more words');
  await page.locator('#custom-use').click();
  await chooseSound(page, 'clicks-errors');
  await soundReady(page);
  await typeInto(page, 'a');
  await page.keyboard.press('Backspace');
  let accent = await accentKey(page);
  await accent.commit('"h');
  await expect(page.locator('#typing-input')).toHaveValue('"h');
  await expect.poll(() => plays(page)).toEqual(['click', 'click', 'tick']);

  await restart(page);
  await openSettings(page, 'sound');
  await chooseSetting(page, 'correction-select', 'mandatory');
  await page.keyboard.press('Escape');
  expect(await passageText(page)).toBe('ah more words');
  await page.locator('#typing-input').focus();
  accent = await accentKey(page);
  await accent.commit('"h');
  await expect(page.locator('#typing-input')).toHaveValue('"');
  await expect(page.locator('#input-help')).toHaveText('Fix the underlined letter.');
  await expect.poll(() => plays(page)).toEqual(['click', 'click', 'tick', 'tick']);
});

test('watch replay plays no sound', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await chooseSound(page, 'clicks-errors');
  await soundReady(page);
  const text = await completePassage(page);
  expect(await plays(page)).toHaveLength(text.length);
  await page.locator('#watch-replay').click();
  await expect(page.locator('#replay-dialog')).toHaveAttribute('data-state', 'done', { timeout: 20000 });
  expect(await plays(page)).toHaveLength(text.length);
});

test('volume 0 is silent and a lower volume plays more quietly', async ({ page }) => {
  await openApp(page);
  await openSettings(page, 'sound');
  await chooseSetting(page, 'sound-select', 'clicks');
  await expect(page.locator('#sound-volume')).toBeEnabled();
  await expect(page.locator('#sound-volume')).toHaveValue('50');
  await page.locator('#sound-volume').fill('0');
  await expect(page.locator('#sound-volume-value')).toHaveText('0%');
  await expect(page.locator('#sound-volume')).toHaveAttribute('aria-valuetext', '0%');
  await page.keyboard.press('Escape');
  let text = await passageText(page);
  await typeInto(page, text.slice(0, 3));
  const quiet = await sound(page);
  expect(quiet.plays, 'volume 0 is silent').toEqual([]);
  expect(quiet.closed, 'and leaves no context open').toBe(quiet.created);

  await restart(page);
  await openSettings(page, 'sound');
  await page.locator('#sound-volume').fill('100');
  await page.keyboard.press('Escape');
  await soundReady(page);
  text = await passageText(page);
  await typeInto(page, text.slice(0, 2));
  await restart(page);
  await openSettings(page, 'sound');
  await page.locator('#sound-volume').fill('25');
  await page.keyboard.press('Escape');
  text = await passageText(page);
  await typeInto(page, text[0]);
  const { plays: played, clickGains } = await sound(page);
  expect(played).toEqual(['click', 'click', 'click']);
  expect(clickGains[2]).toBeLessThan(clickGains[0]);
});

test('turning sound off closes the context; turning it on builds a fresh one for the next key', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await chooseSound(page, 'clicks');
  let text = await passageText(page);
  // Sound isn't motion: reduced motion leaves it on.
  await soundReady(page);
  await typeInto(page, text.slice(0, 2));
  expect(await sound(page)).toMatchObject({ created: 1, closed: 0, plays: ['click', 'click'] });

  await restart(page);
  await chooseSound(page, 'off');
  expect((await sound(page)).closed).toBe(1);
  await expect(page.locator('#sound-volume')).toBeDisabled();
  text = await passageText(page);
  await typeInto(page, text.slice(0, 2));
  expect(await plays(page)).toEqual(['click', 'click']);

  await restart(page);
  await chooseSound(page, 'clicks');
  await soundReady(page);
  text = await passageText(page);
  await typeInto(page, text.slice(0, 2));
  expect(await sound(page)).toMatchObject({ created: 2, plays: ['click', 'click', 'click', 'click'] });
});

// An import, like another tab or a sign-in, changes the settings without the sound controls.
test('an import that turns sound off closes the context', async ({ page }) => {
  await openApp(page);
  await chooseSound(page, 'clicks');
  await soundReady(page);
  await openSettings(page, 'sound');
  await page.getByRole('button', { name: /Import Monkeytype settings/ }).click();
  await page.locator('#import-text').fill(JSON.stringify({ caretStyle: 'line', playSoundOnClick: 'off' }));
  await page.locator('#confirm-import').click();
  await expect(page.locator('#import-report')).toBeVisible();
  await expect(page.locator('#sound-select input:checked')).toHaveValue('off');
  expect(await sound(page)).toMatchObject({ created: 1, closed: 1, state: 'closed' });
});

test('a whole run clicks once per key and still finishes normally', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await chooseSound(page, 'clicks-errors');
  await soundReady(page);
  const text = await completePassage(page);
  await expect(page.locator('#result-accuracy')).toHaveText('100');
  const played = await plays(page);
  expect(played).toHaveLength(text.length);
  expect(new Set(played)).toEqual(new Set(['click']));
  // The finished run suspends the context once its last click has played; the next key resumes it.
  await expect.poll(async () => (await sound(page)).state).toBe('suspended');
  await page.locator('#run-again').click();
  await typeInto(page, (await passageText(page))[0]);
  await expect.poll(async () => (await sound(page)).state).toBe('running');
  expect(await sound(page)).toMatchObject({ created: 1 });
  expect(await plays(page)).toHaveLength(text.length + 1);
});

test('palette commands set the sound and its volume', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await page.keyboard.press('Control+K');
  await expect(page.locator('#palette')).toBeVisible();
  await page.locator('#palette-input').fill('sound');
  const options = page.locator('#palette-list [role="option"]');
  await expect(options.filter({ hasText: 'sound · off' })).toHaveCount(1);
  await expect(options.filter({ hasText: 'sound · clicks + error tick' })).toHaveCount(1);
  // Volume commands wait until a sound is chosen, as the settings row does.
  await expect(options.filter({ hasText: 'sound volume' })).toHaveCount(0);
  await page.locator('#palette-input').fill('error tick');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('sound · clicks + error tick');
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('#sound-select input:checked')).toHaveValue('clicks-errors');

  await page.keyboard.press('Control+K');
  await page.locator('#palette-input').fill('sound');
  await expect(options.filter({ hasText: 'sound volume · 50%' }).locator('.opt-hint')).toHaveText('current');
  await expect(options.filter({ hasText: 'sound · clicks + error tick' }).locator('.opt-hint')).toHaveText('current');
  await shot(page, testInfo, 'palette-dark');
  await page.locator('#palette-input').fill('volume 25');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('sound volume · 25%');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sound-volume')).toHaveValue('25');
  await expect(page.locator('#sound-volume-value')).toHaveText('25%');
  await soundReady(page);
  expect((await sound(page)).created, 'a palette choice readies the sound as the settings do').toBe(1);
});

test('a guest’s sound choice lasts only for the tab', async ({ page }) => {
  await openApp(page);
  await chooseSound(page, 'clicks');
  await page.reload();
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await expect(page.locator('#sound-select input:checked')).toHaveValue('off');
  await expect(page.locator('#sound-volume')).toBeDisabled();
});

test('a member’s sound and volume follow the account', async ({ page, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openSettings(page, 'sound');
  await chooseSetting(page, 'sound-select', 'clicks-errors');
  await page.locator('#sound-volume').fill('75');
  await page.keyboard.press('Escape');
  await expect.poll(() => supabase.profileFor('ada@stilltype.test')?.preferences?.sound).toBe('clicks-errors');
  expect(supabase.profileFor('ada@stilltype.test').preferences.soundVolume).toBe(75);

  await page.reload();
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await expect(page.locator('#sound-select input:checked')).toHaveValue('clicks-errors');
  await expect(page.locator('#sound-volume')).toHaveValue('75');
  expect((await sound(page)).created, 'still no context until a key').toBe(0);
  const text = await passageText(page);
  await firstKey(page, text[0]);
  await page.keyboard.type(text[1]);
  expect(await sound(page)).toMatchObject({ created: 1, plays: ['click'] });
});

for (const theme of ['dark', 'light']) {
  test(`settings show sound and volume (${theme})`, async ({ page }, testInfo) => {
    test.skip(theme === 'light' && !process.env.SCREENSHOTS, 'docs screenshots only; run with SCREENSHOTS=1');
    await page.emulateMedia({ colorScheme: theme });
    await openApp(page);
    await openSettings(page, 'sound');
    await chooseSetting(page, 'sound-select', 'clicks-errors');
    await expect(page.locator('#sound-volume')).toBeEnabled();
    expect(await settingsFit(page)).toBe(true);
    await page.locator('#sound-volume').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#sound-volume')).toHaveValue('55');
    await expect(page.locator('#sound-volume-value')).toHaveText('55%');
    await page.evaluate(() => document.activeElement.blur());
    if (!process.env.SCREENSHOTS) return;
    await page.mouse.move(0, 400);
    await shot(page, testInfo, `settings-${theme}`);
  });
}

const phoneLayout = (page) => page.locator('#settings-dialog').evaluate((dialog) => {
  const box = dialog.getBoundingClientRect();
  const content = dialog.querySelector('.settings-content');
  const layout = { top: box.top, bottom: box.bottom, insideViewport: box.top >= 0 && box.bottom <= innerHeight, soundTop: document.getElementById('sound-select').getBoundingClientRect().top, covered: [] };
  for (const control of dialog.querySelectorAll('input')) {
    if (!control.getClientRects().length) continue;
    (control.closest('.setting-option') || control).scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = control.getBoundingClientRect();
    const area = content.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (rect.top < area.top || rect.bottom > area.bottom || hit !== control) layout.covered.push(control.name || control.id);
  }
  content.scrollTop = 0;
  return layout;
});

for (const [width, height] of [[390, 844], [320, 844], [320, 568]]) {
  test(`settings fit a ${width}×${height} phone with sound on`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await openSettings(page, 'sound');
    const before = await phoneLayout(page);
    expect(before).toMatchObject({ insideViewport: true, covered: [] });
    await chooseSetting(page, 'sound-select', 'clicks-errors');
    const after = await phoneLayout(page);
    expect(after, 'the dialog keeps its height and sound row position').toEqual(before);
    await page.locator('#sound-volume-row').scrollIntoViewIfNeeded();
    await expect(page.locator('#sound-volume-row')).toBeInViewport({ ratio: 1 });
    expect(await settingsFit(page)).toBe(true);
    await openSettings(page, 'practice');
    await expect(page.locator('#numbers-toggle')).toBeVisible();
    expect(await phoneLayout(page)).toMatchObject({ insideViewport: true, covered: [] });
    await openSettings(page, 'practice');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width === 390) {
      await page.evaluate(() => document.activeElement.blur());
      await shot(page, testInfo, 'settings-mobile');
    }
  });
}

// Races have their own input path; each key there plays through the same module.
async function hostOnlineRace(page, browser, supabase) {
  supabase.addUser('host@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'host@stilltype.test');
  await chooseSound(page, 'clicks-errors');
  await openView(page, 'Challenge');
  await page.locator('#online-name').fill('Ada');
  await page.locator('#create-online-race').click();
  await expect(page.locator('#online-room')).toBeVisible();
  const context = await browser.newContext();
  const guest = await context.newPage();
  await supabase.attach(guest);
  await guest.goto(await page.locator('#online-guest-link').inputValue());
  await guest.locator('#online-guest-name').fill('Lin');
  await guest.locator('#join-online-race').click();
  await expect(page.locator('#online-players')).toContainText('Lin');
  await page.locator('#online-ready').click();
  await guest.locator('#online-ready').click();
  await expect(page.locator('#online-input')).toBeEnabled({ timeout: 12000 });
  return context;
}

test('an online race ticks a mistyped letter and clicks refused keys and backspaces', async ({ page, browser, supabase }) => {
  test.setTimeout(60000);
  const context = await hostOnlineRace(page, browser, supabase);
  try {
    const passage = await page.locator('#online-accessible-passage').textContent();
    await soundReady(page);
    // A backspace before the first letter clicks, and with no race run begun the context rests again.
    await page.locator('#online-input').focus();
    await page.keyboard.press('Backspace');
    await expect.poll(async () => (await sound(page)).states.slice(-2)).toEqual(['running', 'suspended']);
    await typeInto(page, passage[0], '#online-input');
    // Races always stop on error: the mistyped letter ticks; the refused key, each backspace and a
    // backspace with nothing left to delete click.
    await page.keyboard.type(`${wrongFor(passage[1])}${passage[2]}`);
    await expect(page.locator('#online-help')).toHaveText('Correct the mistyped letter before continuing.');
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Backspace');
    await expect(page.locator('#online-input')).toHaveValue('');
    await page.keyboard.type(passage[0]);
    await expect(page.locator('#online-input')).toHaveValue(passage[0]);
    expect(await plays(page)).toEqual(['click', 'click', 'tick', 'click', 'click', 'click', 'click', 'click']);
  } finally { await context.close(); }
});

test('a one-keyboard challenge plays once per key', async ({ page }) => {
  await openApp(page);
  await chooseSound(page, 'clicks-errors');
  await openView(page, 'Challenge');
  await page.locator('#challenge-local').click();
  await page.locator('#player-one-name').fill('Ada');
  await page.locator('#player-two-name').fill('Lin');
  await page.locator('#start-local-race').click();
  await expect(page.locator('#race-input')).toBeFocused();
  const text = await page.locator('#race-accessible-passage').textContent();
  await soundReady(page);
  await typeInto(page, text[0], '#race-input');
  await page.keyboard.type(`${text[1]}${wrongFor(text[2])}`);
  await page.keyboard.press('Backspace');
  expect(await plays(page)).toEqual(['click', 'click', 'tick', 'click']);

  // A one-keyboard turn never sets the page running, but its end still rests the sound.
  await page.keyboard.type(text.slice(2));
  await expect(page.locator('#race-handoff')).toBeVisible();
  await expect.poll(async () => (await sound(page)).state).toBe('suspended');
  await page.locator('#start-next-player').click();
  await expect(page.locator('#race-stage')).toBeVisible();
  await expect(page.locator('#race-input')).toBeFocused();
  await typeInto(page, text[0], '#race-input');
  await expect.poll(async () => (await sound(page)).state).toBe('running');
  expect(await plays(page)).toHaveLength(text.length + 3);
});

test('composing uses clicks for accepted keys and deletion without an error tick', async ({ page }) => {
  await stubAudio(page);
  await openApp(page);
  await chooseSound(page, 'clicks-errors');
  await chooseMore(page, 'mode-compose');
  await soundReady(page);
  await typeInto(page, 'ab', '#compose-input');
  await page.keyboard.press('Backspace');
  await expect.poll(() => plays(page)).toEqual(['click', 'click', 'click']);
  expect((await sound(page)).builtDuring).toEqual([]);
});


test('explicit sound reselect is recorded as a fresh preference choice', async ({ page, supabase }) => {
  const user = supabase.addUser('choice-41@stilltype.test');
  const stamp = '2000-01-01T00:00:00.000Z';
  supabase.profiles.set(user.id, { data: { version: 2, preferences: { sound: "off" }, preferencesAt: { sound: stamp },
    attempts: [], runs: [], loops: [], seenTextIds: [], bests: {}, updatedAt: stamp } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openSettings(page, 'sound');
  await chooseSetting(page, 'sound-select', 'off');
  await expect.poll(() => supabase.profileFor(user.email)?.preferencesAt?.sound).not.toBe(stamp);
  expect(supabase.profileFor(user.email).preferences.sound).toEqual("off");
});
