// Word highlight → slide: one tint glides from word to word on transforms, behind the letters, instead of
// jumping. Off by default, offered only while a highlight is on, and an instant jump under reduced motion.
import { test, expect, openApp, openSettings, passageText, typeInto, chooseSetting, chooseWords, signInWithEmail } from './fixtures.js';

const slideRow = (page) => page.locator('.preference-row', { has: page.locator('#word-highlight-slide') });

// Indexes of the words whose letters paint a tint of their own (as in word-highlight.spec.js).
const tinted = (page) => page.locator('#text-display .word').evaluateAll((nodes) => nodes
  .filter((node) => [...node.children].some((char) => !char.classList.contains('wrong') && getComputedStyle(char).backgroundColor !== 'rgba(0, 0, 0, 0)'))
  .map((node) => Number(node.dataset.wordIndex)));

// The highlighted word, how far the glide's edges are from it, and whether the glide is moving, two frames
// on: the caret measure (and with it the glide) runs on the next animation frame after a key.
const glide = (page, display = '#text-display') => page.locator(display).evaluate(async (node) => {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const shape = node.querySelector('.word-glide');
  const word = node.querySelector(document.body.dataset.wordHighlight === 'next' ? '.word-next' : '.word-current');
  const start = shape.getBoundingClientRect();
  const end = shape.lastElementChild.getBoundingClientRect();
  const box = word.getBoundingClientRect();
  return {
    index: Number(word.dataset.wordIndex),
    off: Math.max(Math.abs(start.left - box.left), Math.abs(end.right - box.right), Math.abs(start.top - box.top), Math.abs(start.height - box.height)),
    moving: shape.getAnimations({ subtree: true }).length > 0,
  };
});

async function turnOnSlide(page, mode = 'current') {
  await chooseSetting(page, 'word-highlight', mode);
  await chooseSetting(page, 'word-highlight-slide', 'true');
  await expect(page.locator('body')).toHaveAttribute('data-word-highlight-slide', 'true');
}

async function runPalette(page, label) {
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await page.locator('#palette-trigger').click();
  await page.keyboard.type(label);
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText(label);
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
}

test('slide glides one tint behind the letters, and snaps to a word on the next line', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 50);
  await openSettings(page);
  await expect(slideRow(page)).toBeHidden();
  await chooseSetting(page, 'word-highlight', 'current');
  await expect(slideRow(page)).toBeVisible();
  await expect(page.locator('#word-highlight-slide input:checked')).toHaveValue('false');
  expect(await tinted(page)).toEqual([0]);
  const letters = () => page.locator('#text-display .char').evaluateAll((chars) => chars.slice(0, 60)
    .map((char) => {
      const box = char.getBoundingClientRect();
      return [box.left, box.top, getComputedStyle(char).color];
    }));
  const before = await letters();

  await turnOnSlide(page);
  await page.keyboard.press('Escape');
  // The letters keep their place and colour and paint no tint of their own; the glide sits behind them.
  expect(await letters()).toEqual(before);
  expect(await tinted(page)).toEqual([]);
  expect(await page.locator('#text-display .word-glide').evaluate((node) => getComputedStyle(node).zIndex)).toBe('-1');
  const atRest = await glide(page);
  expect(atRest).toMatchObject({ index: 0, moving: false });
  expect(atRest.off).toBeLessThan(1);

  const words = (await passageText(page)).split(' ');
  await typeInto(page, words[0], '#typing-input', { delay: 60 });
  await page.keyboard.press(' ');
  expect(await glide(page)).toMatchObject({ index: 1, moving: true });
  await expect.poll(async () => (await glide(page)).moving).toBe(false);
  expect((await glide(page)).off).toBeLessThan(1);

  // A miss keeps its coral letter and tint, painted over the glide.
  const wrongKey = words[1][0] === 'x' ? 'z' : 'x';
  await page.keyboard.type(wrongKey);
  const miss = await page.locator('#text-display .char.wrong').evaluate((node) => {
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement('span');
    document.body.append(probe);
    probe.style.color = root.getPropertyValue('--danger');
    const danger = getComputedStyle(probe).color;
    probe.style.color = root.getPropertyValue('--danger-soft');
    const soft = getComputedStyle(probe).color;
    probe.remove();
    return { color: getComputedStyle(node).color === danger, fill: getComputedStyle(node).backgroundColor === soft };
  });
  expect(miss).toEqual({ color: true, fill: true });
  await page.keyboard.press('Backspace');

  // Up to the last word of the first line, then its space: the glide lands on the next line at once.
  const wrap = await page.locator('#text-display .word').evaluateAll((nodes) => nodes.findIndex((node) => node.offsetTop > nodes[0].offsetTop));
  expect(wrap).toBeGreaterThan(2);
  await page.keyboard.type(words.slice(1, wrap).join(' '), { delay: 20 });
  await expect.poll(async () => (await glide(page)).moving).toBe(false);
  expect(await glide(page)).toMatchObject({ index: wrap - 1 });
  await page.keyboard.press(' ');
  const wrapped = await glide(page);
  expect(wrapped).toMatchObject({ index: wrap, moving: false });
  expect(wrapped.off).toBeLessThan(1);
});

test('on the one-line tape the glide rides the tape as it steps', async ({ page }) => {
  await openApp(page);
  await chooseSetting(page, 'tape-toggle', 'true');
  await turnOnSlide(page, 'next');
  const words = (await passageText(page)).split(' ');
  await typeInto(page, `${words.slice(0, 24).join(' ')} `, '#typing-input', { delay: 20 });
  await expect(page.locator('#typing-wrap')).toHaveAttribute('data-tape-scrolled', 'true');
  await expect.poll(async () => {
    const { index, off, moving } = await glide(page);
    return index === 25 && off < 1 && !moving;
  }).toBe(true);
});

test('the palette turns slide on and off, only while a highlight is on, and an account keeps it', async ({ page, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await page.locator('#palette-trigger').click();
  await page.keyboard.type('word highlight · slide');
  await expect(page.locator('#palette-list [role="option"]', { hasText: 'word highlight · slide' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await runPalette(page, 'word highlight · this word');
  await runPalette(page, 'word highlight · slide');
  await expect(page.locator('body')).toHaveAttribute('data-word-highlight-slide', 'true');
  await expect.poll(() => supabase.profileFor('ada@stilltype.test')?.preferences.wordHighlightSlide, { timeout: 8000 }).toBe(true);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-word-highlight-slide', 'true');
  await openSettings(page);
  await expect(page.locator('#word-highlight-slide input:checked')).toHaveValue('true');
  await page.keyboard.press('Escape');

  await runPalette(page, 'word highlight · slide');
  await expect(page.locator('body')).toHaveAttribute('data-word-highlight-slide', 'false');
  expect(await tinted(page)).toEqual([0]);
});

test('in forced colours the word keeps its system outline and the glide steps aside', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openApp(page);
  await turnOnSlide(page);
  await page.keyboard.press('Escape');
  const word = page.locator('#text-display .word.word-current');
  expect(await word.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('solid');
  await expect(page.locator('#text-display .word-glide')).toBeHidden();
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('slide jumps straight to the next word', async ({ page }) => {
    await openApp(page);
    await turnOnSlide(page);
    const words = (await passageText(page)).split(' ');
    await typeInto(page, words[0], '#typing-input', { delay: 60 });
    await page.keyboard.press(' ');
    const jumped = await glide(page);
    expect(jumped).toMatchObject({ index: 1, moving: false });
    expect(jumped.off).toBeLessThan(1);
  });
});
