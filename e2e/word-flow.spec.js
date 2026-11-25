import { test, expect, firstTryErrors, openApp, passageText, typeInto, chooseWords, chooseMore, chooseSetting, closeSettings, openSettings, signInWithEmail } from './fixtures.js';

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

// Animation frames paced at 30 Hz, as a busy or power-saving machine gives them, each callback's time logged.
const thirtyHertz = () => {
  window.__frameTimes = [];
  window.requestAnimationFrame = (callback) => setTimeout(() => {
    const now = performance.now();
    window.__frameTimes.push(now);
    callback(now);
  }, 1000 / 30);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
};

const caretGap = (page) => page.evaluate(() => {
  const x = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#text-display .caret')).transform).m41;
  const current = document.querySelector('#text-display .char.current');
  const display = document.getElementById('text-display');
  let left = 0;

  for (let node = current; node && node !== display; node = node.offsetParent) left += node.offsetLeft;

  return Math.abs(x - left);
});

// Frames that ran in [from, to] ms after `since` (the page's performance.now()).
const framesBetween = (page, since, from, to) => page.evaluate(([at, a, b]) => window.__frameTimes.filter((t) => t >= at + a && t <= at + b).length, [since, from, to]);

test('at 30 Hz the spring caret settles on its letter and then asks for no frames', { tag: '@compat' }, async ({ page }) => {
  await page.addInitScript(thirtyHertz);
  await openApp(page);
  await expect(page.locator('body')).toHaveAttribute('data-typing-motion', 'spring');
  await useCustom(page, `${TEXT} ${TEXT} ${TEXT}`);

  await typeInto(page, 'the');
  let stopped = await page.evaluate(() => performance.now());
  await page.waitForTimeout(400);
  expect(await caretGap(page), 'settled on its letter within 400 ms').toBeLessThan(0.5);
  await page.waitForTimeout(600);
  expect(await framesBetween(page, stopped, 450, 950), 'no frames while it rests').toBe(0);

  // A 64-key burst, then the same rest.
  await page.keyboard.type(` ${TEXT} ${TEXT}`.slice(0, 64), { delay: 20 });
  stopped = await page.evaluate(() => performance.now());
  await page.waitForTimeout(400);
  expect(await caretGap(page)).toBeLessThan(0.5);
  await page.waitForTimeout(600);
  expect(await framesBetween(page, stopped, 450, 950), 'no frames while it rests after a burst').toBe(0);
});

test('under reduced motion the spring caret runs no frames of its own', { tag: '@compat' }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(thirtyHertz);
  await openApp(page);
  await useCustom(page);
  await page.locator('#typing-input').focus();
  // Focusing lays the passage out on frames of its own; counting starts after them.
  await page.waitForTimeout(300);
  const start = await page.evaluate(() => performance.now());
  // Slower than the 30 Hz frames, so each key's one measuring frame runs before the next key.
  await page.keyboard.type('the quick', { delay: 60 });
  const stopped = await page.evaluate(() => performance.now());
  await expect.poll(() => caretGap(page)).toBeLessThan(0.5);
  await page.waitForTimeout(950);
  expect(await framesBetween(page, start, 0, 5000), 'at most the one frame each key measures in').toBeLessThanOrEqual('the quick'.length);
  expect(await framesBetween(page, stopped, 0, 950), 'none once the keys stop').toBeLessThanOrEqual(1);
  expect(await framesBetween(page, stopped, 100, 950)).toBe(0);
});

test('at 320 px and the largest text, the caret follows letters past a long word, inside the passage', { tag: '@compat' }, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page);
  await chooseSetting(page, 'font-size', '36');
  await closeSettings(page);
  await expect(page.locator('body')).toHaveAttribute('data-font-size', '36');
  await useCustom(page, 'immediately quick');

  await typeInto(page, 'immediatelywwwwwwww');
  await expect(page.locator('#text-display .char.extra')).toHaveCount(8);

  const box = async () => page.evaluate(() => {
    const caret = document.querySelector('#text-display .caret-bar').getBoundingClientRect();
    const extra = [...document.querySelectorAll('#text-display .char.extra')].at(-1).getBoundingClientRect();
    const area = document.getElementById('typing-wrap').getBoundingClientRect();

    return {
      gap: Math.abs(caret.left + caret.width / 2 - extra.right),
      row: Math.abs(caret.top + caret.height / 2 - (extra.top + extra.height / 2)),
      inside: caret.right <= area.right && caret.left >= area.left,
      wrap: document.getElementById('typing-wrap').scrollWidth - document.getElementById('typing-wrap').clientWidth,
      page: document.documentElement.scrollWidth - innerWidth,
    };
  });

  await expect.poll(async () => (await box()).gap, 'the caret sits against the last extra letter').toBeLessThan(3);
  const placed = await box();
  expect(placed.row, 'on the extra letter’s line').toBeLessThan(4);
  expect(placed.inside, 'inside the typing area').toBe(true);
  expect(placed.wrap).toBeLessThanOrEqual(0);
  expect(placed.page).toBeLessThanOrEqual(0);
});

test('Watch replay shows letters typed past a word, as they were typed', { tag: '@compat' }, async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  const first = text.split(' ')[0];

  await typeInto(page, `${first}xx`, '#typing-input', { delay: 40 });
  await expect(page.locator('#text-display .char.extra')).toHaveText(['x', 'x']);
  await page.keyboard.type(text.slice(first.length), { delay: 30 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');

  // Sampled on every frame of the replay: none before they were typed, then both, never more.
  const sampled = page.evaluate(() => new Promise((resolve) => {
    const counts = [];

    const sample = () => {
      const dialog = document.getElementById('replay-dialog');

      if (dialog.open) counts.push(document.querySelectorAll('#replay-text .char.extra').length);

      if (dialog.open && dialog.dataset.state === 'done') resolve(counts);
      else requestAnimationFrame(sample);
    };

    requestAnimationFrame(sample);
  }));

  await page.locator('#watch-replay').click();
  const counts = await sampled;
  expect(counts[0], 'none at the start').toBe(0);
  expect(counts.find((count) => count > 0), 'the first appears on its own').toBe(1);
  expect(counts.every((count, index) => count >= (counts[index - 1] ?? 0) && count <= 2)).toBe(true);
  await expect(page.locator('#replay-text .char.extra')).toHaveText(['x', 'x']);
  // In place: straight after the first word's letters, before its space.
  expect(await page.locator('#replay-text').evaluate((node) => node.textContent.slice(0, node.textContent.indexOf(' ')))).toBe(`${first}xx`);
});

test('a timed fluid run full of skipped words goes out as a ghost with every word its caret reached, at its own speed', { tag: '@compat' }, async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  supabase.races.friends.set(ada.id, [{ id: 'f-ada-lin', friendId: lin.id, name: 'Lin' }]);
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await page.locator('#mode-time').click();
  await page.locator('#duration-options [data-length="15"]').click();
  await expect(page.locator('#condition-line')).toContainText('15 s');
  const words = (await passageText(page)).split(' ');

  // Every third word: its first letter, then Space skips the rest, to about 700 characters, well inside
  // 15 s. Then the clock ends the run (a key after it would press the focused Run again).
  await page.locator('#typing-input').focus();
  const began = Date.now();
  let reached = 0;

  for (let index = 0; reached < 700 && Date.now() - began < 12_000; index += 1) {
    const word = words[index];
    await page.keyboard.type(index % 3 === 2 ? `${word[0]} ` : `${word} `, { delay: 15 });
    reached += word.length + 1;
  }

  await expect(page.locator('body')).toHaveAttribute('data-view', 'results', { timeout: 20000 });
  await expect(page.locator('#result-time')).toHaveText('15.0 s');
  expect(reached, 'the caret passed the 500-character allowance').toBeGreaterThan(560);
  const cardWpm = Number(await page.locator('#result-wpm').textContent());

  await page.locator('#ghost-offer summary').click();
  await page.locator('#send-ghost').click();
  await expect(page.locator('#ghost-offer-status')).toHaveText(/^Sent to Lin\./);
  const row = [...supabase.challenges.rows.values()][0];
  const trace = [...row.trace.k];
  const reach = trace.filter((key) => key !== '\b').length - trace.filter((key) => key === '\b').length;
  expect(row.passage.length, 'the passage runs at least as far as the caret').toBeGreaterThanOrEqual(reach - 1);
  expect(Math.abs(row.sender.wpm - cardWpm), `sent ${row.sender.wpm}, the card says ${cardWpm}`).toBeLessThanOrEqual(1);
});
