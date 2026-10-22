// Word highlight → slide: turn it on in settings, then type and watch one tint glide from word to word
// behind the letters, snap at a line change, and keep a miss coral. Pass --reduced-motion to see it jump.
export default async ({ page, h, shot, note, check }) => {
  await h.openApp();
  await h.chooseWords(25);
  await h.openSettings('appearance');
  const slideRow = page.locator('.preference-row', { has: page.locator('#word-highlight-slide') });
  check(await slideRow.isHidden(), 'slide row is hidden while the highlight is off');
  await page.locator('#word-highlight input[value="current"]').locator('..').click();
  check(await slideRow.isVisible(), 'slide row shows once a highlight is on');
  await page.locator('#word-highlight-slide input[value="true"]').locator('..').click();
  await h.attr('body', 'data-word-highlight-slide', 'true');
  await h.settle();
  await shot('settings');
  await page.keyboard.press('Escape');
  await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
  await page.locator('#typing-input').focus();

  // The glide's box against the highlighted word's box, both in screen pixels.
  const fit = () => page.evaluate(() => {
    const glide = document.querySelector('#text-display .word-glide');
    const word = document.querySelector('#text-display .word-current');
    // The glide's own box starts at its left end; its right end is the last piece.
    const a = { left: glide.getBoundingClientRect().left, top: glide.getBoundingClientRect().top, height: glide.getBoundingClientRect().height };
    a.width = glide.lastElementChild.getBoundingClientRect().right - a.left;
    const b = word.getBoundingClientRect();
    const round = (value) => Math.round(value * 100) / 100;
    return { dx: round(Math.abs(a.left - b.left)), dw: round(Math.abs(a.width - b.width)), dy: round(Math.abs(a.top - b.top)), dh: round(Math.abs(a.height - b.height)), running: glide.getAnimations({ subtree: true }).length };
  });
  await h.settle();
  const atRest = await fit();
  note('at rest', atRest);
  check(atRest.dx < 1 && atRest.dw < 1.5 && atRest.dy < 1 && atRest.dh < 1, 'glide covers the first word');
  await shot('ready');

  const text = await h.passage();
  const words = text.split(' ');
  await page.keyboard.type(`${words[0]} `, { delay: 60 });
  const moving = await fit();
  note('just after a space', moving);
  await shot('mid-glide');
  await h.settle();
  const settled = await fit();
  note('settled', settled);
  check(settled.dx < 1 && settled.dw < 1.5, 'glide lands on the next word');

  await page.keyboard.type(words[1][0] === 'x' ? 'z' : 'x');
  await h.settle();
  await shot('miss');
  await page.keyboard.press('Backspace');

  // Type through the first line so a word wraps to the next one.
  for (const word of words.slice(1, 12)) await page.keyboard.type(`${word} `, { delay: 30 });
  await h.settle();
  const wrapped = await fit();
  note('later line', wrapped);
  check(wrapped.dx < 1 && wrapped.dw < 1.5 && wrapped.dy < 1, 'glide follows onto later lines');
  await shot('later-line');
};
