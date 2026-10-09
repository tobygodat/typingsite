// Tape mode: the passage on one line instead of three. Still run: the tape advances in
// word-aligned steps with the ~150 ms line scroll, never letter by letter, and instantly under
// reduced motion. Screenshots go to docs/screenshots/tape-mode only when SCREENSHOTS is set.
import { test, expect, openApp, openSettings, passageText, typeInto, chooseWords, signInWithEmail } from './fixtures.js';
import { wordList } from '../src/words.js';
import { TAPE_LEAD } from '../src/tape.js';

const shotPath = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/tape-mode/${name}.png` : testInfo.outputPath(`${name}.png`));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const lineHeight = (page) => page.locator('#text-display').evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
const wrapHeight = async (page) => Math.round((await page.locator('#typing-wrap').boundingBox()).height);

async function setTape(page, on) {
  await openSettings(page);
  await page.locator('#tape-toggle').setChecked(on);
  await expect(page.locator('body')).toHaveAttribute('data-tape', String(on));
  await page.keyboard.press('Escape');
  await expect(page.locator('.preferences-popover')).toBeHidden();
}

// The tape and caret after the next frames have measured, in px from the visible left edge.
const tapeState = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
  const display = document.getElementById('text-display');
  const leftOf = (node) => {
    let left = 0;
    for (let at = node; at && at !== display; at = at.offsetParent) left += at.offsetLeft;
    return left;
  };
  const match = /translateX\((-?[\d.]+)px\)/.exec(display.style.transform);
  const offset = match ? -Number(match[1]) : 0;
  const current = display.querySelector('.char.current');
  const word = current?.closest('.word');
  resolve({
    typed: document.getElementById('typing-input').value.length,
    offset,
    width: display.clientWidth,
    caret: current ? leftOf(current) - offset : null,
    word: word ? { left: leftOf(word) - offset, right: leftOf(word) + word.offsetWidth - offset, start: current === word.firstElementChild } : null,
  });
}))));

// Types one key at a time and records every position of the tape.
async function trace(page, text) {
  await page.locator('#typing-input').focus();
  let previous = await tapeState(page);
  const states = [];
  for (const char of text) {
    await page.keyboard.type(char);
    const state = await tapeState(page);
    states.push({ ...state, stepped: state.offset !== previous.offset });
    previous = state;
  }
  return states;
}

test('the settings row and the palette switch between three lines and the tape', async ({ page }) => {
  await openApp(page);
  const line = await lineHeight(page);
  expect(await wrapHeight(page)).toBe(Math.round(line * 3));

  await setTape(page, true);
  expect(await wrapHeight(page)).toBe(Math.round(line));
  await expect(page.locator('#text-display')).toHaveCSS('white-space', 'pre');

  await page.locator('#typing-input').focus();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('one-line tape');
  const option = page.locator('#palette-list [aria-selected="true"]');
  await expect(option).toContainText('one-line tape');
  await expect(option.locator('.opt-hint')).toHaveText('on');
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-tape', 'false');
  expect(await wrapHeight(page)).toBe(Math.round(line * 3));
  await expect(page.locator('#typing-input')).toBeFocused();

  // Guests keep nothing beyond the tab.
  await setTape(page, true);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-tape', 'false');
  await expect(page.locator('#tape-toggle')).not.toBeChecked();
});

test('an account with no valid tape value starts on three lines and keeps the tape once chosen', async ({ page, supabase }) => {
  const user = supabase.addUser('ada@stilltype.test');
  supabase.profiles.set(user.id, {
    data: { version: 2, profileId: 'before-tape', preferences: { fontSize: '22', tape: 'yes' }, attempts: [], runs: [], loops: [], seenTextIds: [], bests: {} },
    updated_at: new Date(Date.now() - 60_000).toISOString(),
  });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await expect(page.locator('body')).toHaveAttribute('data-font-size', '22');
  await expect(page.locator('body')).toHaveAttribute('data-tape', 'false');

  await setTape(page, true);
  await expect.poll(() => supabase.profileFor('ada@stilltype.test')?.preferences?.tape).toBe(true);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-tape', 'true');
  expect(await wrapHeight(page)).toBe(Math.round(await lineHeight(page)));
});

test('the tape steps by whole words near the right edge, never per letter', async ({ page }) => {
  await openApp(page);
  await setTape(page, true);
  await chooseWords(page, 50);
  // The same transition token as the three-line scroll.
  await expect(page.locator('#text-display')).toHaveCSS('transition-property', 'transform');
  await expect(page.locator('#text-display')).toHaveCSS('transition-duration', '0.15s');

  const text = (await passageText(page)).slice(0, 170);
  const states = await trace(page, text);
  const steps = states.filter((state) => state.stepped);
  expect(steps.length).toBeGreaterThan(1);
  // Far fewer steps than words, so the line holds still for several words at a time.
  expect(steps.length).toBeLessThan(text.split(' ').length / 3);
  for (const state of states) {
    expect(state.caret).toBeGreaterThanOrEqual(0);
    expect(state.caret).toBeLessThanOrEqual(state.width);
  }
  for (const step of steps) {
    // Only on reaching a new word, which lands a tenth of the way in.
    expect(step.word?.start).toBe(true);
    expect(Math.abs(step.word.left - step.width * TAPE_LEAD)).toBeLessThanOrEqual(1);
    // Before stepping, the caret had passed most of the line.
    const before = states[states.indexOf(step) - 1];
    expect(before.caret).toBeGreaterThan(before.width * 0.6);
  }
  await expect(page.locator('#typing-wrap')).toHaveAttribute('data-tape-scrolled', 'true');

  // Still run: a solid caret and instant letter states while typing.
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  await expect(page.locator('#typing-wrap')).toHaveAttribute('data-caret', 'typing');
  await expect(page.locator('#text-display .caret-bar')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('#text-display .char.correct').first()).toHaveCSS('transition-duration', '0s');

  // Backspacing past the last step into the left edge steps back, and the caret stays in view.
  const back = [];
  for (let index = 0; index < states.at(-1).typed - steps.at(-1).typed + 6; index += 1) {
    await page.keyboard.press('Backspace');
    back.push(await tapeState(page));
  }
  expect(back.some((state, index) => state.offset < (index ? back[index - 1].offset : states.at(-1).offset))).toBe(true);
  for (const state of back) {
    expect(state.caret).toBeGreaterThanOrEqual(0);
    expect(state.caret).toBeLessThanOrEqual(state.width);
  }
});

test.describe('narrow phone with large text', () => {
  test.use({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });

  test('a word longer than the line steps inside the word and the caret stays in view', async ({ page }, testInfo) => {
    // Every generated word becomes the longest word in the 10k list.
    const bank = wordList('10k');
    const longest = bank.reduce((a, b) => (b.length > a.length ? b : a));
    await page.addInitScript(([index, size]) => { Math.random = () => (index + 0.5) / size; }, [bank.indexOf(longest), bank.length]);
    await openApp(page);
    await openSettings(page);
    await page.locator('#font-size').selectOption('36');
    await page.locator('#word-list').selectOption('10k');
    await page.locator('#tape-toggle').check();
    await page.keyboard.press('Escape');
    await chooseWords(page, 10);
    const text = await passageText(page);
    expect(text.split(' ')[0]).toBe(longest);
    await expect(page.locator('#text-display')).toHaveCSS('font-size', '32px');
    const { wordWidth, width } = await page.locator('#text-display').evaluate((node) => ({ wordWidth: node.querySelector('.word').offsetWidth, width: node.clientWidth }));
    expect(wordWidth).toBeGreaterThan(width * 0.8);

    const states = await trace(page, text.slice(0, longest.length * 2 + 6));
    for (const state of states) {
      expect(state.caret).toBeGreaterThanOrEqual(0);
      expect(state.caret).toBeLessThanOrEqual(state.width);
    }
    const steps = states.filter((state) => state.stepped);
    expect(steps.some((step) => !step.word?.start)).toBe(true);
    expect(steps.length).toBeLessThan(states.length / 4);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: shotPath(testInfo, 'tape-320-large') });
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the tape steps instantly', async ({ page }) => {
    await openApp(page);
    await setTape(page, true);
    await chooseWords(page, 50);
    const durations = await page.locator('#text-display').evaluate((node) => getComputedStyle(node).transitionDuration.split(', '));
    expect(durations.every((value) => parseFloat(value) <= 0.001)).toBe(true);
    const text = await passageText(page);
    await page.locator('#typing-input').focus();
    let state = await tapeState(page);
    for (const char of text) {
      await page.keyboard.type(char);
      state = await tapeState(page);
      if (state.offset > 0) break;
    }
    expect(state.offset).toBeGreaterThan(0);
    const shown = await page.locator('#text-display').evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).m41);
    expect(shown).toBe(-state.offset);
  });
});

test('switching layouts mid-run keeps the run going and the caret in view', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 100);
  const text = await passageText(page);
  // By now the three-line passage has trimmed the lines far above it into a spacer.
  await typeInto(page, text.slice(0, 340));
  await expect(page.locator('#text-display > .passage-spacer')).toHaveCount(1);

  await page.mouse.move(5, 5);
  await page.mouse.move(60, 60);
  await setTape(page, true);
  // The spacer only fits three lines, so the trimmed words come back for the tape.
  await expect(page.locator('#text-display > .passage-spacer')).toHaveCount(0);
  await page.locator('#typing-input').focus();
  await page.keyboard.type(text.slice(340, 360));
  let state = await tapeState(page);
  expect(state.typed).toBe(360);
  expect(state.caret).toBeGreaterThanOrEqual(0);
  expect(state.caret).toBeLessThanOrEqual(state.width);
  await expect(page.locator('#typing-status')).toHaveText('In progress');
  // The tape trims too, into a spacer as wide as the words it replaces.
  await expect(page.locator('#text-display > .passage-spacer')).toHaveCount(1);
  expect(await page.locator('#text-display > .passage-spacer').evaluate((node) => [node.offsetHeight, node.offsetWidth > 0])).toEqual([0, true]);

  await page.keyboard.type(text.slice(360, 440));
  state = await tapeState(page);
  expect(state.caret).toBeGreaterThanOrEqual(0);
  expect(state.caret).toBeLessThanOrEqual(state.width);

  await page.mouse.move(5, 5);
  await page.mouse.move(60, 60);
  await setTape(page, false);
  await page.locator('#typing-input').focus();
  await page.keyboard.type(text.slice(440, 450));
  const wrap = await page.locator('#typing-wrap').boundingBox();
  await expect.poll(async () => {
    const caret = await page.locator('#text-display .caret').boundingBox();
    return caret.y >= wrap.y && caret.y + caret.height <= wrap.y + wrap.height;
  }).toBe(true);
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, 450));
  await expect(page.locator('#typing-status')).toHaveText('In progress');
});

// A realistic run, roughly 80 wpm with one slip, then a pointer nudge so the chrome is back.
async function midRun(page) {
  await chooseWords(page, 50);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 48), '#typing-input', { delay: 150 });
  await page.keyboard.type(text[48] === 'x' ? 'z' : 'x', { delay: 150 });
  await page.keyboard.type(text.slice(49, 76), { delay: 150 });
  await expect(page.locator('#text-display .char.wrong')).toHaveCount(1);
  await page.mouse.move(5, 5);
  await page.mouse.move(400, 300, { steps: 4 });
  await expect(page.locator('.dock-zone')).toHaveCSS('opacity', '1');
  await expect(page.locator('#typing-wrap')).toHaveAttribute('data-tape-scrolled', 'true');
}

for (const scheme of ['dark', 'light']) {
  test(`screenshot · ${scheme} desktop mid-run`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page);
    await setTape(page, true);
    await midRun(page);
    await page.screenshot({ path: shotPath(testInfo, `tape-${scheme}`) });
  });
}

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('screenshot · 390px mid-run', async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await setTape(page, true);
    await midRun(page);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: shotPath(testInfo, 'tape-mobile') });
  });
});

test('screenshot · the settings row', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await openSettings(page);
  await page.locator('#tape-toggle').check();
  await page.locator('#tape-toggle').focus();
  await page.screenshot({ path: shotPath(testInfo, 'tape-settings') });
});
