import { test, expect, firstTryErrors, openApp, passageText, typeInto, chooseWords, chooseMore, chooseSetting, closeSettings, openSettings } from './fixtures.js';

const TEXT = 'the quick brown fox jumps over the lazy dog';
const WORD_DELETE = process.platform === 'darwin' ? 'Alt+Backspace' : 'Control+Backspace';

async function useCustom(page, text = TEXT) {
  await chooseMore(page, 'mode-custom');
  await page.locator('#custom-text').fill(text);
  await page.locator('#custom-use').click();
  await expect(page.locator('#condition-line')).toContainText('custom text');
}

const caretAt = (page) => page.locator('#text-display .char:not(.extra)').evaluateAll((chars) => chars.findIndex((char) => char.classList.contains('current')));

const frames = (page, count = 2) => page.evaluate((n) => new Promise((resolve) => {
  const step = (left) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
  step(n);
}), count);

test('fluid word flow is the default: a space mid-word jumps to the next word without cascading', async ({ page }) => {
  await openApp(page);
  await openSettings(page, 'practice');
  await expect(page.locator('#word-flow-toggle input:checked')).toHaveValue('fluid');
  await closeSettings(page);
  await useCustom(page);

  await typeInto(page, 'the qu ');
  await expect(page.locator('#text-display .char.missed')).toHaveText(['i', 'c', 'k']);
  expect(await caretAt(page)).toBe(TEXT.indexOf('brown'));
  await page.keyboard.type('brown fox');
  await expect(page.locator('#text-display .char.wrong')).toHaveCount(0);
  await expect(page.locator('#text-display .char.correct')).toHaveCount('the qu brown fox'.length);
});

test('letters past a word end stay inside it, at most eight, and the passage after it stays in place', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await useCustom(page);

  await typeInto(page, 'theabcdefghij');
  const word = page.locator('#text-display .word[data-word-index="0"]');
  await expect(word.locator('.char.extra')).toHaveText([...'abcdefgh']);
  await expect(page.locator('#text-display .char.extra')).toHaveCount(8);
  await expect(page.locator('#text-display .char.wrong')).toHaveCount(0);
  expect(await caretAt(page)).toBe(3);
  await expect(page.locator('#typing-wrap')).toHaveAttribute('data-blocked', 'true');

  const overflow = await page.evaluate(() => ({
    wrap: document.getElementById('typing-wrap').scrollWidth - document.getElementById('typing-wrap').clientWidth,
    page: document.documentElement.scrollWidth - innerWidth,
  }));

  expect(overflow.wrap).toBeLessThanOrEqual(0);
  expect(overflow.page).toBeLessThanOrEqual(0);

  await page.keyboard.type(' quick');
  await expect(page.locator('#text-display .char.wrong')).toHaveCount(0);
  await expect(page.locator('#text-display .word[data-word-index="1"] .char.correct')).toHaveCount(5);
  await expect(word.locator('.char.extra')).toHaveCount(8);
});

test('a space at a word start is ignored, and Backspace reopens only a word left wrong', async ({ page }) => {
  await openApp(page);
  await useCustom(page);

  await typeInto(page, ' ');
  await expect(page.locator('#typing-status')).toHaveText('Ready');
  expect(await caretAt(page)).toBe(0);

  await page.keyboard.type('the  ');
  expect(await caretAt(page)).toBe(4);
  await page.keyboard.press('Backspace');
  expect(await caretAt(page), 'a clean word stays locked').toBe(4);
  await expect(page.locator('#text-display .char.correct')).toHaveCount(4);

  await page.keyboard.type('quixk ');
  await page.keyboard.press('Backspace');
  expect(await caretAt(page), 'a wrong word reopens at its end').toBe(9);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('ck brown');
  await expect(page.locator('#text-display .char.wrong')).toHaveCount(0);

  await page.keyboard.type(' f ');
  await page.keyboard.press('Backspace');
  expect(await caretAt(page), 'a skipped word reopens after its last typed letter').toBe(TEXT.indexOf('fox') + 1);
  await expect(page.locator('#text-display .char.missed')).toHaveCount(0);
});

test('word delete clears the word and its extras, and reaches back only into a wrong word', async ({ page }) => {
  await openApp(page);
  await useCustom(page);

  await typeInto(page, 'the quickzz');
  await expect(page.locator('#text-display .char.extra')).toHaveCount(2);
  await page.keyboard.press(WORD_DELETE);
  await expect(page.locator('#text-display .char.extra')).toHaveCount(0);
  expect(await caretAt(page)).toBe(4);
  await expect(page.locator('#text-display .char.correct')).toHaveCount(4);

  await page.keyboard.press(WORD_DELETE);
  expect(await caretAt(page), 'the clean word before stays').toBe(4);

  await page.keyboard.type('qu');
  await page.keyboard.press(WORD_DELETE);
  expect(await caretAt(page)).toBe(4);

  await page.keyboard.type('quack ');
  await page.keyboard.press(WORD_DELETE);
  expect(await caretAt(page), 'a wrong word before is taken whole').toBe(4);
  await expect(page.locator('#text-display .char.wrong')).toHaveCount(0);
});

test('a fluid run with a skipped word and a corrected overflow scores both and replays to its scored state', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  const words = text.split(' ');
  const skipped = words.findIndex((word, index) => index < words.length - 2 && word.length >= 2);
  const before = words.slice(0, skipped).join(' ');
  const lead = before ? `${before} ` : '';
  const next = words[skipped + 1];

  await typeInto(page, `${lead}${words[skipped][0]} ${next}x`, '#typing-input', { delay: 40 });
  await expect(page.locator('#text-display .char.missed')).toHaveCount(words[skipped].length - 1);
  await expect(page.locator('#text-display .char.extra')).toHaveText(['x']);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text.slice(`${lead}${words[skipped]} ${next}`.length), { delay: 30 });

  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-accuracy-fact')).toHaveAttribute('title', firstTryErrors('2'));
  await expect(page.locator('#result-accuracy-fact')).toHaveAttribute('title', new RegExp(` · final c/i/e/m ${text.length - words[skipped].length + 1}/0/0/${words[skipped].length - 1}$`));
  const card = { wpm: await page.locator('#result-wpm').textContent(), accuracy: await page.locator('#result-accuracy').textContent() };

  await page.locator('#watch-replay').click();
  await page.locator('#replay-speed').click();
  await page.locator('#replay-speed').click();
  await expect(page.locator('#replay-dialog')).toHaveAttribute('data-state', 'done', { timeout: 20000 });
  await expect(page.locator('#replay-text .char.missed')).toHaveCount(words[skipped].length - 1);
  await expect(page.locator('#replay-text .char.wrong')).toHaveCount(0);
  await expect(page.locator('#replay-wpm')).toHaveText(card.wpm);
  await expect(page.locator('#replay-accuracy')).toHaveText(card.accuracy);
  await expect(page.locator('#replay-errors')).toHaveText('2');
});

test('the rules that keep linear scoring still take a space typed mid-word in place of the letter', async ({ page }) => {
  await openApp(page);
  await chooseSetting(page, 'correction-select', 'no-backspace');
  await closeSettings(page);
  await useCustom(page);
  await typeInto(page, 'th ');
  await expect(page.locator('#text-display .char.missed')).toHaveCount(0);
  await expect(page.locator('#text-display .char.wrong')).toHaveCount(1);
  expect(await caretAt(page)).toBe(3);
});

test('the spring caret is the default, snaps across a line wrap and stops its frames once it settles', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    window.__frames = 0;
    window.requestAnimationFrame = (callback) => request((time) => { window.__frames += 1; callback(time); });
  });
  await openApp(page);
  await expect(page.locator('body')).toHaveAttribute('data-typing-motion', 'spring');
  await useCustom(page, `${TEXT} ${TEXT} ${TEXT}`);
  const text = await passageText(page);

  const caret = () => page.evaluate(() => {
    const transform = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#text-display .caret')).transform);
    const current = document.querySelector('#text-display .char.current');
    const display = document.getElementById('text-display');
    let left = 0;
    let top = 0;

    for (let node = current; node && node !== display; node = node.offsetParent) {
      left += node.offsetLeft;
      top += node.offsetTop;
    }

    return { x: transform.m41, y: transform.m42, left, top };
  });

  await page.locator('#typing-input').focus();
  let previous = await caret();
  let wrapped = 0;

  for (const char of text.slice(0, 90)) {
    await page.keyboard.type(char);
    await frames(page, 2);
    const state = await caret();

    if (state.y !== previous.y) {
      wrapped += 1;
      expect(Math.abs(state.x - state.left), 'a new line starts at its first letter, with no sweep from the line before').toBeLessThan(1);
    }

    previous = state;
  }

  expect(wrapped).toBeGreaterThan(0);
  await expect.poll(async () => {
    const state = await caret();

    return Math.abs(state.x - state.left);
  }).toBeLessThan(0.5);
  await page.waitForTimeout(300);
  const idle = await page.evaluate(() => window.__frames);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__frames), 'no frames while the caret rests').toBe(idle);
});

test('under reduced motion the spring caret lands on each letter at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await useCustom(page);
  await typeInto(page, 'the q');
  await frames(page, 2);

  const gap = await page.evaluate(() => {
    const x = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#text-display .caret')).transform).m41;
    const current = document.querySelector('#text-display .char.current');

    return Math.abs(x - current.offsetLeft);
  });

  expect(gap).toBeLessThan(1);

  await chooseSetting(page, 'typing-motion', 'smooth');
  await expect(page.locator('body')).toHaveAttribute('data-typing-motion', 'smooth');
  await expect(page.locator('#caret-glide')).toBeEnabled();
  await chooseSetting(page, 'typing-motion', 'spring');
  await expect(page.locator('#caret-glide')).toBeDisabled();
});
