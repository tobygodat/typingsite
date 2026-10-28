// Run card: consistency, the counts behind accuracy (its tooltip) and the static words list.
import { test, expect, firstTryErrors, finalChars, openApp, passageText, typeInto, chooseWords, phone } from './fixtures.js';

// Committed screenshots are rewritten only with SCREENSHOTS=1; normal runs keep them in the test output.
const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/run-card-stats/${name}` : testInfo.outputPath(name));

// A 10-word run typed at a realistic pace (>3 s, enough for consistency), one letter missed and fixed.
async function finishRun(page) {
  await chooseWords(page, 10);
  const text = await passageText(page);
  const at = [...text].findIndex((char, index) => index > 1 && /[a-z]/.test(char));
  const miss = text[at] === 'x' ? 'z' : 'x';
  await typeInto(page, text.slice(0, at) + miss, '#typing-input', { delay: 75 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text.slice(at), { delay: 75 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');

  return { text, at };
}

test('the run card shows consistency, the counts behind accuracy and the words typed', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  const { text, at } = await finishRun(page);

  await expect(page.locator('#result-consistency')).toHaveText(/^\d+$/);
  // The breakdown describes the finished text: the fixed slip is a first-try error, not "incorrect".
  await expect(page.locator('#result-accuracy-fact')).toHaveAttribute('title', firstTryErrors('1'));
  await expect(page.locator('#result-accuracy-fact')).toHaveAttribute('title', finalChars(`${text.length}/0/0/0`));
  await expect(page.locator('.run-card-facts dt')).toHaveText(['accuracy', 'time', 'consistency']);
  // The print scrolls with the page.
  expect(await page.locator('#run-card').evaluate((node) => getComputedStyle(node).position)).toBe('static');

  const words = page.locator('#result-words span');
  await expect(words).toHaveText(text.split(' '));
  // The word holding the fixed miss is marked with the coral token and its tint.
  const missIndex = text.slice(0, at).split(' ').length - 1;
  await expect(page.locator('#result-words .word-miss')).toHaveCount(1);

  const cue = await words.nth(missIndex).evaluate((node) => ({
    color: getComputedStyle(node).color,
    background: getComputedStyle(node).backgroundColor,
    danger: getComputedStyle(document.documentElement).getPropertyValue('--danger-soft').trim(),
  }));

  expect(cue.background).toBe(cue.danger);
  await expect(words.last()).toHaveAttribute('title', /^\d+ wpm$/);
  // Static: nothing in the list animates.
  expect(await page.locator('#result-words').evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);

  // Clip the whole card from a full-page shot so the fixed dock never overlaps it.
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  const clip = await page.locator('#run-card').boundingBox();
  await page.screenshot({ path: shot(testInfo, 'run-card-dark.png'), fullPage: true, clip });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: shot(testInfo, 'run-card-light.png'), fullPage: true, clip });
});

test('the words list is one tab stop whose words show their pace by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  // Enough words to run past the list's four lines in the wide trace.
  await chooseWords(page, 100);
  await typeInto(page, await passageText(page));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  const list = page.locator('#result-words');
  const words = list.locator('[role="option"]');
  const detail = page.locator('#result-word-detail');
  await expect(list).toHaveAttribute('role', 'listbox');
  await expect(list).toHaveAttribute('aria-label', /words typed/i);
  expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  // Before a choice the line below is empty and takes no room; only one word is a tab stop.
  await expect(detail).toBeEmpty();
  await expect(detail).toBeHidden();
  await expect(list.locator('[tabindex="0"]')).toHaveCount(1);

  // Finish focuses "run again" at the card's foot; Shift+Tab walks back to the list's one stop.
  for (let i = 0; i < 12 && !(await words.first().evaluate((node) => node === document.activeElement)); i += 1) {
    await page.keyboard.press('Shift+Tab');
  }

  await expect(words.first()).toBeFocused();
  const firstWord = await words.first().textContent();
  await expect(detail).toHaveText(new RegExp(`^“${firstWord}” · (\\d+ wpm|no pace)$`));
  await expect(words.first()).toHaveAttribute('aria-label', new RegExp(`^${firstWord}, (\\d+ wpm|no pace)$`));

  const ring = await words.first().evaluate((node) => ({
    visible: node.matches(':focus-visible'),
    style: getComputedStyle(node).outlineStyle,
    width: getComputedStyle(node).outlineWidth,
  }));

  expect(ring).toEqual({ visible: true, style: 'solid', width: '2px' });
  await page.keyboard.press('ArrowRight');
  await expect(words.nth(1)).toBeFocused();
  await expect(words.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(detail).toHaveText(new RegExp(`^“${await words.nth(1).textContent()}” · (\\d+ wpm|no pace)$`));
  // End moves to the last word, and the list scrolls to keep it in view.
  await page.keyboard.press('End');
  await expect(words.last()).toBeFocused();
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(list.locator('[tabindex="0"]')).toHaveCount(1);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, ...phone });

  test('the facts and words list fit at 390 px', async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await finishRun(page);
    await expect(page.locator('#result-consistency')).toHaveText(/^\d+$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    // The fixed bottom dock is hidden for the capture only, so it never covers the card's foot.
    await page.waitForTimeout(600);
    await page.locator('#run-card').screenshot({ path: shot(testInfo, 'run-card-mobile.png'), style: '.dock-zone { visibility: hidden; }' });
    // A tap shows a word's pace in the line below, as focus does for the keyboard.
    const second = page.locator('#result-words [role="option"]').nth(1);
    await second.tap();
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#result-word-detail')).toHaveText(new RegExp(`^“${await second.textContent()}” · \\d+ wpm( · mistyped)?$`));
  });
});

// Stat values whose text runs past their cell or the card's padding, at the current width.
function statSpill(page) {
  return page.evaluate(() => {
    const card = document.getElementById('run-card');
    const box = card.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(card).paddingLeft);

    return [...card.querySelectorAll('.run-card-facts dd')].flatMap((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const cell = node.getBoundingClientRect();
      const text = range.getBoundingClientRect();
      const out = text.right > cell.right + 0.5 || text.left < box.left + pad - 0.5 || text.right > box.right - pad + 0.5;

      return out ? [`${node.parentElement.querySelector('dt').textContent}: ${node.textContent}`] : [];
    });
  });
}

test.describe('narrow phone', () => {
  test.use({ viewport: { width: 320, height: 700 }, ...phone });

  test('long, error-heavy stats stay inside the card at 320 px', async ({ page }) => {
    await openApp(page);
    await chooseWords(page, 100);
    // Every letter wrong under continue on error: the breakdown reads 0/<all>/0/0.
    const text = await passageText(page);
    await typeInto(page, [...text].map((char) => (char === 'x' ? 'z' : 'x')).join(''));
    await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
    await expect(page.locator('#result-accuracy-fact')).toHaveAttribute('title', finalChars(`0/${text.length}/0/0`));
    await expect(page.locator('#result-accuracy-fact')).toHaveAttribute('title', firstTryErrors(String(text.length)));
    expect(await statSpill(page)).toEqual([]);
    // Larger than any run here reaches: a 120 s timed run, typed fast with many slips.
    await page.evaluate(() => {
      const set = (id, html) => { document.getElementById(id).innerHTML = html; };

      set('result-time', '120.0<b> s</b>');
      set('result-accuracy', '100');
      set('result-consistency', '100');
    });
    expect(await statSpill(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
