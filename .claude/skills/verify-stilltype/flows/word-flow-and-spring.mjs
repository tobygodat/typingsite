// Fluid word flow and the spring caret (ADR 0027): a space mid-word, letters past a word's end,
// Backspace and word delete at word boundaries, the caret's frames while typing and at rest, the
// three typing motions, a fluid run's replay, and code mode's operators.
export default async ({ page, h, shot, note, check }) => {
  const wordDelete = process.platform === 'darwin' ? 'Alt+Backspace' : 'Control+Backspace';
  const text = 'the quick brown fox jumps over the lazy dog and keeps running past the quiet river bank';
  const caretAt = () => page.locator('#text-display .char:not(.extra)').evaluateAll((chars) => chars.findIndex((char) => char.classList.contains('current')));
  const custom = async (passage) => {
    await h.chooseMore('mode-custom');
    await page.locator('#custom-text').fill(passage);
    await page.locator('#custom-use').click();
    await page.waitForFunction(() => document.querySelector('#condition-line')?.textContent.includes('custom text'));
    await page.locator('#typing-input').focus();
  };
  const restart = () => page.locator('#typing-input').press('Escape');

  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    window.__caretFrames = { count: 0, slowest: 0 };
    window.requestAnimationFrame = (callback) => request((time) => {
      const start = performance.now();
      callback(time);
      window.__caretFrames.count += 1;
      window.__caretFrames.slowest = Math.max(window.__caretFrames.slowest, performance.now() - start);
    });
  });
  await h.openApp();
  check(await page.locator('body').getAttribute('data-typing-motion') === 'spring', 'spring is the default typing motion');
  await custom(text);

  await page.keyboard.type('the qu', { delay: 60 });
  await page.keyboard.type(' ');
  await page.keyboard.type('brown', { delay: 60 });
  const jump = { missed: await page.locator('#text-display .char.missed').allTextContents(), wrong: await page.locator('#text-display .char.wrong').count(), caret: await caretAt() };
  note('space jump', jump);
  check(jump.missed.join('') === 'ick' && jump.wrong === 0 && jump.caret === text.indexOf('brown') + 5, 'a space mid-word skips to the next word, marks i-c-k missed, and nothing after it turns red');
  await shot('lane-2-space-jump');

  await page.keyboard.type('abcdefghij', { delay: 40 });
  const overflow = await page.evaluate(() => ({
    extras: document.querySelectorAll('#text-display .word[data-word-index="2"] .char.extra').length,
    wrong: document.querySelectorAll('#text-display .char.wrong').length,
    wrapOverflow: document.getElementById('typing-wrap').scrollWidth - document.getElementById('typing-wrap').clientWidth,
  }));
  note('overflow', overflow);
  check(overflow.extras === 8 && overflow.wrong === 0 && overflow.wrapOverflow <= 0, 'ten letters past "brown" keep eight inside it, with no red after it and no sideways scroll');
  await shot('lane-3-overflow-cap');

  await page.keyboard.press(wordDelete);
  const cleared = { extras: await page.locator('#text-display .char.extra').count(), caret: await caretAt() };
  note('word delete', cleared);
  check(cleared.extras === 0 && cleared.caret === text.indexOf('brown'), `${wordDelete} clears "brown" and its extras back to the word start`);
  await page.keyboard.type('brown fox ', { delay: 50 });
  await page.keyboard.press('Backspace');
  const locked = await caretAt();
  await page.keyboard.type('jumpz ', { delay: 50 });
  await page.keyboard.press('Backspace');
  const reopened = await caretAt();
  note('smart backspace', { locked, reopened });
  check(locked === text.indexOf('jumps'), 'Backspace after a clean "fox " stays locked at the next word');
  check(reopened === text.indexOf('jumps') + 5, 'Backspace after a wrong "jumpz " reopens it at its end');
  await shot('lane-4-smart-backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('s over the lazy dog ', { delay: 50 });
  await shot('lane-5-word-delete');

  await restart();
  await custom(`${text} ${text}`);
  await page.evaluate(() => { window.__caretFrames.count = 0; window.__caretFrames.slowest = 0; });
  const rows = [];

  for (const char of `${text} ${text}`.slice(0, 120)) {
    await page.keyboard.type(char);
    await page.waitForTimeout(100);
    rows.push(await page.evaluate(() => {
      const caret = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#text-display .caret')).transform);
      const current = document.querySelector('#text-display .char.current');

      return { x: caret.m41, y: caret.m42, left: current?.offsetLeft ?? 0 };
    }));
  }

  const wraps = rows.filter((row, index) => index && row.y !== rows[index - 1].y);
  const burst = await page.evaluate(() => ({ ...window.__caretFrames }));
  await page.waitForTimeout(600);
  const restFrom = await page.evaluate(() => window.__caretFrames.count);
  await page.waitForTimeout(500);
  const idle = await page.evaluate(() => window.__caretFrames.count) - restFrom;
  note('spring caret', { wraps: wraps.length, frames: burst.count, slowestFrameMs: Math.round(burst.slowest * 100) / 100, idleFramesIn500ms: idle });
  check(wraps.length > 0 && wraps.every((row) => Math.abs(row.x - row.left) < 1), 'each line wrap lands the caret on the new line\'s first letter at once');
  check(burst.slowest < 2, `the slowest frame callback took ${burst.slowest.toFixed(2)} ms (under 2 ms)`);
  check(idle === 0, 'no frames run while the caret rests');
  await shot('lane-6-spring-caret');

  await h.openSettings('appearance');
  await shot('lane-7-motion-modes');
  await page.keyboard.press('Escape');

  await restart();
  await h.chooseWords(10);
  const words = (await h.passage()).split(' ');
  const skip = words.findIndex((word, index) => index < words.length - 2 && word.length >= 2);
  const lead = words.slice(0, skip).join(' ');
  await page.locator('#typing-input').focus();
  await page.keyboard.type(`${lead ? `${lead} ` : ''}${words[skip][0]} ${words[skip + 1]}x`, { delay: 40 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type(words.slice(skip + 1).join(' ').slice(words[skip + 1].length), { delay: 40 });
  await h.attr('body', 'data-view', 'results');
  const card = { wpm: await h.text('#result-wpm'), accuracy: await h.text('#result-accuracy'), facts: await page.locator('#result-accuracy-fact').getAttribute('title') };
  await page.locator('#watch-replay').click();
  await page.locator('#replay-speed').click();
  await page.locator('#replay-speed').click();
  await h.attr('#replay-dialog', 'data-state', 'done', 30000);
  const replay = { wpm: await h.text('#replay-wpm'), accuracy: await h.text('#replay-accuracy'), errors: await h.text('#replay-errors'), missed: await page.locator('#replay-text .char.missed').count() };
  note('fluid replay', { card, replay });
  check(replay.wpm === card.wpm && replay.accuracy === card.accuracy && replay.errors === '2' && replay.missed === words[skip].length - 1, 'the replay ends on the run card\'s score with the skipped letters marked');
  await shot('lane-8-fluid-replay');
  await page.keyboard.press('Escape');

  await h.openView('Practice');
  await h.chooseMore('mode-code');
  const code = await page.locator('#text-display').evaluate((node) => ({ passage: node.dataset.passage, ligatures: getComputedStyle(node).fontVariantLigatures, features: getComputedStyle(node).fontFeatureSettings }));
  note('code', code);
  check(code.passage === 'code' && code.ligatures === 'none' && /"liga" 0/.test(code.features) && /"calt" 0/.test(code.features), 'code mode turns ligatures and contextual alternates off');
  await shot('lane-9-code-zero-ligatures');
};
