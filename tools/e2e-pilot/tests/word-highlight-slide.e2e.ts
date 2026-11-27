import { test } from '@e2e-dev/web';
import type { Browser } from '@e2e-dev/web';
import { expect } from 'e2e';
import { setUp, tearDown, openApp, chooseWords, openSettings, chooseSetting, passageText, typeInto } from './helpers.ts';

// Port of e2e/word-highlight.spec.js "slide glides one tint behind the letters, and snaps to a word on the next line" (TOB-188).

const tinted = (browser: Browser) => browser.evaluate(() => [...document.querySelectorAll<HTMLElement>('#text-display .word')]
  .flatMap((node) => ([...node.children].some((char) => !char.classList.contains('wrong') && getComputedStyle(char).backgroundColor !== 'rgba(0, 0, 0, 0)') ? [Number(node.dataset.wordIndex)] : [])));

// The highlighted word, how far the glide's edges are from it, and whether the glide is moving, two frames on.
const glide = (browser: Browser) => browser.evaluate(async () => {
  await new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)); });
  const node = document.querySelector('#text-display')!;
  const shape = node.querySelector('.word-glide')!;
  const word = node.querySelector<HTMLElement>(document.body.dataset.wordHighlight === 'next' ? '.word-next' : '.word-current')!;
  const start = shape.getBoundingClientRect();
  const end = shape.lastElementChild!.getBoundingClientRect();
  const box = word.getBoundingClientRect();

  return {
    index: Number(word.dataset.wordIndex),
    off: Math.max(Math.abs(start.left - box.left), Math.abs(end.right - box.right), Math.abs(start.top - box.top), Math.abs(start.height - box.height)),
    moving: shape.getAnimations({ subtree: true }).length > 0,
  };
});

const slideRow = (browser: Browser) => browser.locator('.preference-row:has(#word-highlight-slide)');

test('slide glides one tint behind the letters, and snaps to a word on the next line', async ({ browser }) => {
  const supabase = await setUp(browser);
  await openApp(browser);
  await chooseWords(browser, 50);
  await openSettings(browser);
  await expect(slideRow(browser)).toBeHidden();
  await chooseSetting(browser, 'word-highlight', 'current');
  await expect(slideRow(browser)).toBeVisible();
  await expect(browser.locator('#word-highlight-slide input:checked')).toHaveValue('false');
  expect(await tinted(browser)).toEqual([0]);

  const letters = () => browser.evaluate(() => [...document.querySelectorAll('#text-display .char')].slice(0, 60).map((char) => {
    const box = char.getBoundingClientRect();

    return [box.left, box.top, getComputedStyle(char).color];
  }));

  const before = await letters();

  await chooseSetting(browser, 'word-highlight', 'current');
  await chooseSetting(browser, 'word-highlight-slide', 'true');
  await expect(browser.locator('body')).toHaveAttribute('data-word-highlight-slide', 'true');
  await browser.keyboard.press('Escape');
  expect(await letters()).toEqual(before);
  expect(await tinted(browser)).toEqual([]);
  expect(await browser.evaluate(() => getComputedStyle(document.querySelector('#text-display .word-glide')!).zIndex)).toBe('-1');
  const atRest = await glide(browser);
  expect(atRest).toMatchObject({ index: 0, moving: false });
  expect(atRest.off).toBeLessThan(1);

  const words = (await passageText(browser)).split(' ');
  await typeInto(browser, words[0], '#typing-input', { delay: 60 });
  await browser.keyboard.press(' ');
  expect(await glide(browser)).toMatchObject({ index: 1, moving: true });
  await expect.poll(async () => (await glide(browser)).moving).toBe(false);
  expect((await glide(browser)).off).toBeLessThan(1);

  // A miss keeps its coral letter and tint, painted over the glide.
  await browser.keyboard.type(words[1][0] === 'x' ? 'z' : 'x');

  const miss = await browser.evaluate(() => {
    const node = document.querySelector('#text-display .char.wrong')!;
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
  await browser.keyboard.press('Backspace');

  // Up to the last word of the first line, then its space: the glide lands on the next line at once.
  const wrap = await browser.evaluate(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>('#text-display .word')];

    return nodes.findIndex((node) => node.offsetTop > nodes[0].offsetTop);
  });

  expect(wrap).toBeGreaterThan(2);
  await browser.locator('#typing-input').pressSequentially(words.slice(1, wrap).join(' '), { delay: 20 });
  await expect.poll(async () => (await glide(browser)).moving).toBe(false);
  expect(await glide(browser)).toMatchObject({ index: wrap - 1 });
  await browser.keyboard.press(' ');
  const wrapped = await glide(browser);
  expect(wrapped).toMatchObject({ index: wrap, moving: false });
  expect(wrapped.off).toBeLessThan(1);
  await tearDown(browser, supabase);
});
