// Tape mode: the passage on one line instead of three. The tape advances in
// word-aligned steps with the ~150 ms line scroll, never letter by letter, and instantly under
// reduced motion. Screenshots go to docs/screenshots/tape-mode only when SCREENSHOTS is set.
import { test, expect, openApp, openSettings, passageText, typeInto, chooseWords, chooseMore, signInWithEmail, chooseSetting, phone } from './fixtures.js';
import { wordList } from '../src/words.js';
import { TAPE_LEAD } from '../src/tape.js';

const shotPath = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/tape-mode/${name}.png` : testInfo.outputPath(`${name}.png`));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const lineHeight = (page) => page.locator('#text-display').evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
const wrapHeight = async (page) => Math.round((await page.locator('#typing-wrap').boundingBox()).height);

async function setTape(page, on) {
  await openSettings(page);
  await chooseSetting(page, 'tape-toggle', on);
  await expect(page.locator('body')).toHaveAttribute('data-tape', String(on));
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeHidden();
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
    caretState: document.getElementById('typing-wrap').dataset.caret,
    caretAnimation: getComputedStyle(display.querySelector('.caret-bar')).animationName,
    offset,
    width: display.clientWidth,
    caret: current ? leftOf(current) - offset : null,
    word: word ? { left: leftOf(word) - offset, right: leftOf(word) + word.offsetWidth - offset, start: current === word.firstElementChild } : null,
  });
}))));

// The x along the line (untransformed) of every mounted word in view or a line-width behind it, the
// scroll, and where the trim spacer ends. Words past the right edge are left out: WebKit rounds each
// letter's width to its layout unit, so a word ahead of the view can shift by a pixel or two as
// letters before it change, while nothing in view moves.
const lineState = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
  const display = document.getElementById('text-display');
  const origin = display.getBoundingClientRect().left;
  const match = /translateX\((-?[\d.]+)px\)/.exec(display.style.transform);
  const offset = match ? -Number(match[1]) : 0;
  const view = display.parentElement.clientWidth;
  const words = {};

  for (const word of display.querySelectorAll('.word')) {
    const x = word.getBoundingClientRect().left - origin;

    if (x >= offset - view && x <= offset + view) words[word.dataset.wordIndex] = x;
  }

  const spacer = display.querySelector('.passage-spacer');
  resolve({ typed: document.getElementById('typing-input').value.length, offset, spacerEnd: spacer ? spacer.getBoundingClientRect().right - origin : null, words });
}))));

// The largest move of any word mounted in both states.
const drift = (a, b) => Math.max(0, ...Object.keys(b.words).filter((key) => key in a.words).map((key) => Math.abs(b.words[key] - a.words[key])));

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
  await expect(page.locator('#tape-toggle input[value="true"]')).not.toBeChecked();
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
  test.setTimeout(60_000);
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

  // A solid caret and instant letter states while typing.
  expect(states.at(-1)).toMatchObject({ caretState: 'typing', caretAnimation: 'none' });
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
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

test('trimming and remounting passed words moves nothing on the line', async ({ page, browserName }) => {
  test.fixme(browserName === 'webkit', 'TOB-22: words shift for one keystroke in about 1 in 3 WebKit runs');
  test.setTimeout(90_000);
  await openApp(page);
  await setTape(page, true);
  await chooseWords(page, 100);
  const text = await passageText(page);
  // Across each trim (every 160 characters), every word that stays keeps its exact x.
  let previous;

  for (const [from, to] of [[150, 170], [310, 330]]) {
    await typeInto(page, text.slice(previous?.typed ?? 0, from));
    previous = await lineState(page);

    for (const char of text.slice(from, to)) {
      await page.keyboard.type(char);
      const state = await lineState(page);
      expect(drift(previous, state), `typed ${state.typed}`).toBeLessThan(0.05);
      previous = state;
    }
  }

  expect(previous.spacerEnd).toBeGreaterThan(0);

  // Backspacing a long way: no blank stretch where the spacer would show, and the words come
  // back exactly where they were.
  while (previous.spacerEnd !== null && previous.typed > 0) {
    await page.keyboard.press('Backspace');
    const state = await lineState(page);
    expect(drift(previous, state), `typed ${state.typed}`).toBeLessThan(0.05);

    if (state.spacerEnd !== null) expect(state.spacerEnd - state.offset, `typed ${state.typed}`).toBeLessThanOrEqual(12);
    previous = state;
  }

  expect(previous.typed).toBeGreaterThan(0);
});

test('word highlight tints the word under the caret, in view, after each step', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await chooseSetting(page, 'word-highlight', 'current');
  await page.keyboard.press('Escape');
  await setTape(page, true);
  await chooseWords(page, 50);
  // One letter into a word, so the caret is on a letter of the tinted word (a space belongs to the word before it).
  const passage = await passageText(page);
  const text = passage.slice(0, passage.lastIndexOf(' ', 140) + 2);
  const states = await trace(page, text);
  expect(states.some((state) => state.stepped)).toBe(true);
  await page.waitForFunction(() => document.getElementById('text-display').getAnimations().length === 0);

  const highlight = await page.evaluate(() => {
    const display = document.getElementById('text-display');
    const area = document.getElementById('typing-wrap').getBoundingClientRect();
    const tinted = [...display.querySelectorAll('.word')].filter((word) => getComputedStyle(word.firstElementChild).backgroundColor !== 'rgba(0, 0, 0, 0)');
    const box = tinted[0]?.getBoundingClientRect();

    return { count: tinted.length, holdsCaret: Boolean(tinted[0]?.querySelector('.char.current')), left: box && box.left - area.left, right: box && box.right - area.left, width: area.width };
  });

  expect(highlight.count).toBe(1);
  expect(highlight.holdsCaret).toBe(true);
  expect(highlight.left).toBeGreaterThanOrEqual(0);
  expect(highlight.right).toBeLessThanOrEqual(highlight.width);
});

test('a code snippet runs on the tape as one line, caret in view', async ({ page }) => {
  await openApp(page);
  await setTape(page, true);
  await chooseMore(page, 'mode-code');
  await expect(page.locator('#condition-line')).toContainText('code');
  expect(await wrapHeight(page)).toBe(Math.round(await lineHeight(page)));
  // Up to the last letter, so the run is still going and the caret still shows.
  const snippet = await passageText(page);
  const text = snippet.slice(0, Math.min(120, snippet.length - 1));
  const states = await trace(page, text);
  expect(states.at(-1).typed).toBe(text.length);

  for (const state of states) {
    expect(state.caret).toBeGreaterThanOrEqual(0);
    expect(state.caret).toBeLessThanOrEqual(state.width);
  }

  expect(await overflow(page)).toBe(0);
});

test('a ghost race keeps three lines with the tape on, so the friend’s caret stays in view', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  const passage = Array.from({ length: 16 }, (_, i) => ['time', 'over', 'water', 'still', 'light'][i % 5]).join(' ');
  supabase.challenges.seed(ada.id, lin.id, { name: 'Ada', passage,
    conditions: { mode: 'words', count: 16, punctuation: false, wordList: '200', correctionPolicy: 'relaxed' },
    trace: { v: 1, k: passage, t: [...passage].map((_, i) => (i ? 40 : 0)), e: (passage.length - 1) * 40 } });
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await setTape(page, true);
  const line = await lineHeight(page);
  expect(await wrapHeight(page)).toBe(Math.round(line));

  await page.locator('#challenge-toast').getByRole('button', { name: 'Race' }).click({ timeout: 12000 });
  await expect(page.locator('#session-title')).toHaveText('Race Ada’s run');
  await expect(page.locator('body')).toHaveAttribute('data-tape', 'false');
  await expect(page.locator('#tape-toggle input[value="true"]')).toBeChecked();
  expect(await wrapHeight(page)).toBe(Math.round(line * 3));
  await expect(page.locator('#text-display')).not.toHaveCSS('white-space', 'pre');
  const ghost = page.locator('#text-display .ghost-caret');
  await typeInto(page, passage.slice(0, 6), '#typing-input', { delay: 60 });
  // Ada's ghost runs well ahead, onto the second line, and is still inside the passage window.
  await expect.poll(() => ghost.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).m42), { timeout: 8000 }).toBeGreaterThan(line / 2);
  await expect(ghost).not.toHaveClass(/is-hidden/);
  const wrap = await page.locator('#typing-wrap').boundingBox();
  const box = await ghost.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(wrap.y - 1);
  expect(box.y + box.height).toBeLessThanOrEqual(wrap.y + wrap.height + 1);

  // Back in solo practice, the tape returns.
  await page.keyboard.type(passage.slice(6), { delay: 20 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results', { timeout: 15000 });
  await page.locator('.nav-item[data-nav="practice"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-tape', 'true');
  expect(await wrapHeight(page)).toBe(Math.round(line));
  await chooseWords(page, 50);
  await expect(page.locator('body')).toHaveAttribute('data-tape', 'true');
  expect(await wrapHeight(page)).toBe(Math.round(line));
});

for (const easing of [false, true]) test(`leaving a scrolled ghost race for the tape never slides the passage vertically${easing ? ', mid-scroll back to the top' : ''}`, async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  const passage = Array.from({ length: 60 }, (_, i) => ['time', 'over', 'water', 'still', 'light'][i % 5]).join(' ');
  supabase.challenges.seed(ada.id, lin.id, { name: 'Ada', passage,
    conditions: { mode: 'words', count: 60, punctuation: false, wordList: '200', correctionPolicy: 'relaxed' },
    trace: { v: 1, k: passage, t: [...passage].map((_, i) => (i ? 40 : 0)), e: (passage.length - 1) * 40 } });
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await setTape(page, true);
  await page.locator('#challenge-toast').getByRole('button', { name: 'Race' }).click({ timeout: 12000 });
  await expect(page.locator('body')).toHaveAttribute('data-tape', 'false');
  const display = page.locator('#text-display');
  const scrollY = () => display.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).m42);
  await page.locator('#typing-input').focus();

  for (const word of passage.split(' ')) {
    await page.keyboard.type(`${word} `);

    if ((await scrollY()) < 0) break;
  }

  await expect.poll(scrollY).toBeLessThan(0);

  if (easing) {
    // A slow scroll, so the switch below lands while it is still easing back to the first line.
    await display.evaluate((node) => node.style.setProperty('--dur-quick', '4s'));

    while (await display.evaluate((node) => node.style.transform !== '')) await page.keyboard.press('Backspace');
  }

  // Every frame from the first one on the tape: the vertical offset the passage shows.
  await page.evaluate(() => {
    window.tapeFrames = [];
    const node = document.getElementById('text-display');

    const sample = () => {
      if (document.body.dataset.tape === 'true') window.tapeFrames.push(new DOMMatrix(getComputedStyle(node).transform).m42);

      if (window.tapeFrames.length < 30) requestAnimationFrame(sample);
    };

    requestAnimationFrame(sample);
  });
  await page.keyboard.press('Control+k');
  await page.keyboard.type('standard');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('standard test · 60 seconds');

  if (easing) expect(await display.evaluate((node) => node.getAnimations().length)).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-tape', 'true');
  await page.waitForFunction(() => window.tapeFrames.length >= 30);
  const frames = await page.evaluate(() => window.tapeFrames);
  expect(frames.filter((y) => Math.abs(y) > 0.5)).toEqual([]);
  expect(await display.evaluate((node) => node.getAnimations().length)).toBe(0);
});

test('the pace caret rides the tape and keeps gliding through a step', async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  await chooseSetting(page, 'pace-select', 'custom');
  await openSettings(page);
  await page.locator('#pace-wpm').fill('40');
  await page.locator('#pace-wpm').press('Tab');
  await page.keyboard.press('Escape');
  await setTape(page, true);
  await chooseWords(page, 50);
  const ghost = page.locator('#text-display .ghost-caret');
  await expect(ghost).not.toHaveClass(/is-hidden/);
  const text = await passageText(page);
  const states = await trace(page, text.slice(0, 120));
  expect(states.some((state) => state.stepped)).toBe(true);

  // On screen, the pace caret sits at its place on the line less the tape's scroll: it moves with the line.
  const ride = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
    const display = document.getElementById('text-display');
    const node = display.querySelector('.ghost-caret');
    const scroll = new DOMMatrix(getComputedStyle(display).transform).m41;
    const along = Number(/translate3d\((-?[\d.]+)px/.exec(node.style.transform)?.[1]);
    const screen = node.getBoundingClientRect().left - document.getElementById('typing-wrap').getBoundingClientRect().left;
    resolve({ along, expected: along + scroll, screen });
  })));

  const first = await ride();
  expect(Math.abs(first.screen - first.expected)).toBeLessThanOrEqual(1);
  // Still gliding: the pace caret keeps moving along the line between keys.
  await expect.poll(async () => (await ride()).along, { timeout: 3000 }).toBeGreaterThan(first.along);
});

test.describe('narrow phone with large text', () => {
  test.use({ viewport: { width: 320, height: 640 }, ...phone });

  test('a word longer than the line steps inside the word and the caret stays in view', async ({ page }, testInfo) => {
    // Every generated word becomes the longest word in the 10k list.
    const bank = wordList('10k');
    const longest = bank.reduce((a, b) => (b.length > a.length ? b : a));
    await page.addInitScript(([index, size]) => { Math.random = () => (index + 0.5) / size; }, [bank.indexOf(longest), bank.length]);
    await openApp(page);
    await openSettings(page);
    await chooseSetting(page, 'font-size', '36');
    await chooseSetting(page, 'word-list', '10k');
    await chooseSetting(page, 'tape-toggle', true);
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

  test('backspacing keeps the letter before the caret clear of the left fade', async ({ page }) => {
    await openApp(page);
    await openSettings(page);
    await chooseSetting(page, 'font-size', '36');
    await chooseSetting(page, 'tape-toggle', true);
    await page.keyboard.press('Escape');
    await chooseWords(page, 50);
    const text = await passageText(page);
    await typeInto(page, text.slice(0, 120));

    for (let index = 0; index < 100; index += 1) {
      await page.keyboard.press('Backspace');

      // The letter Backspace would delete next, in px from the visible left edge.
      const left = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
        const display = document.getElementById('text-display');
        const match = /translateX\((-?[\d.]+)px\)/.exec(display.style.transform);
        const offset = match ? -Number(match[1]) : 0;
        const letters = [...display.querySelectorAll('.char')];
        const before = letters[letters.indexOf(display.querySelector('.char.current')) - 1];
        resolve(before ? before.getBoundingClientRect().left - display.getBoundingClientRect().left - offset : null);
      }))));

      if (left !== null) expect(left, `after ${index + 1} backspaces`).toBeGreaterThanOrEqual(11.5);
    }
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

  // A new text size, or a resize across the 760px breakpoint, reshapes the line, so the trimmed
  // words come back instead of leaving a spacer of the old width.
  await expect(page.locator('#text-display > .passage-spacer')).toHaveCount(1);
  await page.mouse.move(5, 5);
  await page.mouse.move(60, 60);
  await openSettings(page);
  await chooseSetting(page, 'font-size', '22');
  await page.keyboard.press('Escape');
  await expect(page.locator('#text-display > .passage-spacer')).toHaveCount(0);
  await page.locator('#typing-input').focus();
  await page.keyboard.type(text[440]);
  await expect(page.locator('#text-display > .passage-spacer')).toHaveCount(1);
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.locator('#text-display > .passage-spacer')).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#typing-status')).toHaveText('In progress');

  await page.mouse.move(5, 5);
  await page.mouse.move(60, 60);
  await setTape(page, false);
  await page.locator('#typing-input').focus();
  await page.keyboard.type(text.slice(441, 450));
  const wrap = await page.locator('#typing-wrap').boundingBox();
  await expect.poll(async () => {
    const caret = await page.locator('#text-display .caret').boundingBox();

    return caret.y >= wrap.y && caret.y + caret.height <= wrap.y + wrap.height;
  }).toBe(true);
  await expect(page.locator('#typing-input')).toHaveValue(text.slice(0, 450));
  await expect(page.locator('#typing-status')).toHaveText('In progress');
});

test('turning the tape off mid-run lands the three lines on the caret’s line at once', async ({ page }) => {
  await openApp(page);
  await setTape(page, true);
  await chooseWords(page, 100);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 200));

  // Every frame from the first one on three lines: the offset shown, the one set, and any transition.
  await page.evaluate(() => {
    window.lineFrames = [];
    const node = document.getElementById('text-display');

    const sample = () => {
      if (document.body.dataset.tape === 'false') {
        window.lineFrames.push({ shown: new DOMMatrix(getComputedStyle(node).transform).m42, set: node.style.transform, moving: node.getAnimations().length });
      }

      if (window.lineFrames.length < 30) requestAnimationFrame(sample);
    };

    requestAnimationFrame(sample);
  });
  await page.mouse.move(5, 5);
  await page.mouse.move(60, 60);
  await setTape(page, false);
  await page.waitForFunction(() => window.lineFrames.length >= 30);
  const frames = await page.evaluate(() => window.lineFrames);
  const landed = frames.filter((frame) => frame.set.startsWith('translateY'));
  expect(landed.length).toBeGreaterThan(0);
  // On line 2 or later, so the three lines scroll up to it.
  expect(-landed[0].shown).toBeGreaterThan(0);

  for (const frame of landed) expect(frame.shown).toBeCloseTo(-Number(/translateY\(-([\d.]+)px\)/.exec(frame.set)[1]), 1);
  expect(frames.filter((frame) => frame.moving)).toEqual([]);
  await expect(page.locator('#typing-status')).toHaveText('In progress');
});

// A run with one slip (typed at about 80 wpm when taking screenshots), then a pointer nudge so the chrome is back.
async function midRun(page) {
  const delay = process.env.SCREENSHOTS ? 150 : 0;
  await chooseWords(page, 50);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 48), '#typing-input', { delay });
  await page.keyboard.type(text[48] === 'x' ? 'z' : 'x', { delay });
  await page.keyboard.type(text.slice(49, 76), { delay });
  await expect(page.locator('#text-display .char.wrong')).toHaveCount(1);
  await page.mouse.move(5, 5);
  await page.mouse.move(400, 300, { steps: 4 });
  await expect(page.locator('.dock-zone')).toHaveCSS('opacity', '1');
  await expect(page.locator('#typing-wrap')).toHaveAttribute('data-tape-scrolled', 'true');
}

for (const scheme of ['dark', 'light']) {
  test(`screenshot · ${scheme} desktop mid-run`, async ({ page }, testInfo) => {
    test.skip(!process.env.SCREENSHOTS, 'docs screenshots only; run with SCREENSHOTS=1');
    await page.emulateMedia({ colorScheme: scheme });
    await openApp(page);
    await setTape(page, true);
    await midRun(page);
    await page.screenshot({ path: shotPath(testInfo, `tape-${scheme}`) });
  });
}

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, ...phone });

  test('390px mid-run has no sideways overflow', async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await setTape(page, true);
    await midRun(page);
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    if (process.env.SCREENSHOTS) await page.screenshot({ path: shotPath(testInfo, 'tape-mobile') });
  });
});

test('screenshot · the settings row', async ({ page }, testInfo) => {
  test.skip(!process.env.SCREENSHOTS, 'docs screenshots only; run with SCREENSHOTS=1');
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await openSettings(page);
  await chooseSetting(page, 'tape-toggle', true);
  await page.locator('#tape-toggle').focus();
  await page.screenshot({ path: shotPath(testInfo, 'tape-settings') });
});
