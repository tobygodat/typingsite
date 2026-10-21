// Book mode: four public-domain books typed a page at a time, chosen under "more", the book picked
// from a compact dropdown, the place in each book kept. Screenshots go to docs/screenshots/book-mode
// only when SCREENSHOTS is set.
import { test, expect, openApp, openView, openProgressView, passageText, typeInto, chooseMore, chooseQuoteFilter, chooseSetting, completePassage, signInWithEmail } from './fixtures.js';

const shot = (testInfo, name) => (process.env.SCREENSHOTS ? `docs/screenshots/book-mode/${name}.png` : testInfo.outputPath(`${name}.png`));

async function openBookMode(page) {
  await chooseMore(page, 'mode-book');
  await expect(page.locator('#mode-more-label')).toHaveText('book');
  await expect(page.locator('#book-options')).toBeVisible();
}

test('book mode is one more mode: a book, a page number, fixed text', async ({ page }) => {
  await openApp(page);
  await openBookMode(page);
  await expect(page.locator('#mode-book')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'book', exact: true })).toContainText('alice in wonderland');
  await expect(page.locator('#book-page')).toHaveText('page 1');
  await expect(page.locator('#duration-options')).toBeHidden();
  await expect(page.locator('#punctuation-toggle')).toBeDisabled();
  expect(await passageText(page)).toMatch(/^Alice was beginning to get very tired of sitting by her sister on the bank/);

  await chooseQuoteFilter(page, 'book', 'frankenstein');
  expect(await passageText(page)).toMatch(/^To Mrs\. Saville, England\. St\. Petersburgh/);
  await expect(page.locator('#book-page')).toHaveText('page 1');

  // Another mode puts "more" back; the palette brings the book back.
  await page.locator('#mode-time').click();
  await expect(page.locator('#mode-more-label')).toHaveText('more');
  await expect(page.locator('#book-options')).toBeHidden();
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('book');
  await page.locator('#palette-list [role="option"]', { hasText: /^book/ }).first().click();
  await expect(page.locator('#mode-more-label')).toHaveText('book');
  expect(await passageText(page)).toMatch(/^To Mrs\. Saville/);
});

test('a finished page counts like any practice run and the next page follows', async ({ page }) => {
  await openApp(page);
  await chooseSetting(page, 'daily-goal', '5');
  await openBookMode(page);
  await chooseQuoteFilter(page, 'book', 'pride and prejudice');
  const first = await completePassage(page);
  expect(first).toMatch(/^It is a truth universally acknowledged/);
  await expect(page.locator('#result-conditions')).toHaveText(/^page 1 · pride and prejudice · physical keyboard · (continue|stop) on error$/);
  await expect(page.locator('#result-delta')).toHaveText('First run at these settings');
  await expect(page.locator('#run-again')).toHaveText('Next page');
  await expect(page.locator('#best')).toHaveText(/^Best · \d+ wpm$/);

  await page.locator('#run-again').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#book-page')).toHaveText('page 2');
  const second = await passageText(page);
  expect(second).not.toBe(first);

  // Restarting an unfinished page keeps it; so does an interrupted one.
  await typeInto(page, second.slice(0, 5));
  await page.keyboard.press('Escape');
  await expect(page.locator('#book-page')).toHaveText('page 2');
  expect(await passageText(page)).toBe(second);

  // The page is a practice run: it is listed in Progress under its book, with its practice time.
  await openView(page, 'Progress');
  await expect(page.locator('#progress-tests')).toContainText('pride and prejudice');
  await openProgressView(page, 'Practice');
  const streak = page.locator('#practice-stats .progress-figure').filter({ has: page.locator('dt', { hasText: /^Current streak$/ }) });
  await expect(streak.locator('.figure-note')).toHaveText(/^today (<1|[1-9]\d*) of 5 min$/);
});

test('each book keeps its own place, and a signed-in place survives a reload', async ({ page, supabase }) => {
  const user = supabase.addUser('books@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openBookMode(page);
  await completePassage(page);
  await page.locator('#run-again').click();
  await expect(page.locator('#book-page')).toHaveText('page 2');

  await chooseQuoteFilter(page, 'book', 'sherlock holmes');
  await expect(page.locator('#book-page')).toHaveText('page 1');
  await chooseQuoteFilter(page, 'book', 'alice in wonderland');
  await expect(page.locator('#book-page')).toHaveText('page 2');
  const second = await passageText(page);

  await page.reload();
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await expect(page.locator('#mode-more-label')).toHaveText('book');
  await expect(page.locator('#book-page')).toHaveText('page 2');
  expect(await passageText(page)).toBe(second);
});

test('a book page runs with tape mode, the word highlight, the pace caret and sounds', async ({ page }) => {
  // Counts the clicks a stubbed AudioContext would play.
  await page.addInitScript(() => {
    window.__clicks = 0;
    const node = (extra) => ({ connect: (target) => target, disconnect() {}, ...extra });
    const param = () => ({ value: 0, setValueAtTime() { return this; }, exponentialRampToValueAtTime() { return this; } });
    window.AudioContext = class {
      constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 48000; this.destination = node({}); }
      resume() { return Promise.resolve(); }
      suspend() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createBuffer(channels, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
      createBufferSource() { return node({ start() { window.__clicks += 1; }, stop() {} }); }
      createOscillator() { return node({ frequency: param(), start() {}, stop() {} }); }
      createBiquadFilter() { return node({ frequency: { value: 0 }, Q: { value: 0 } }); }
      createGain() { return node({ gain: param() }); }
    };
  });
  await openApp(page);
  await chooseSetting(page, 'tape-toggle', true);
  await chooseSetting(page, 'word-highlight', 'current');
  await chooseSetting(page, 'pace-select', 'custom');
  await chooseSetting(page, 'sound-select', 'clicks');
  await openBookMode(page);
  await expect(page.locator('body')).toHaveAttribute('data-tape', 'true');
  await expect(page.locator('#pace-label')).toBeVisible();
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 12));
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
  await expect(page.locator('#text-display .word.word-current')).toHaveCount(1);
  await expect(page.locator('#text-display .ghost-caret')).not.toHaveClass(/is-hidden/);
  await expect.poll(() => page.evaluate(() => window.__clicks)).toBeGreaterThan(5);
  await typeInto(page, text.slice(12));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#run-again')).toHaveText('Next page');
});

test('the rail and passage sit where quote mode puts them, at desktop and phone widths', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  for (const [width, height] of [[1280, 800], [390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height });
    await openApp(page);
    await page.locator('#mode-quote').click();
    // From 760px down the rail is display: contents, so its mode bar stands for it.
    const rail = await page.locator('.mode-options').boundingBox();
    const quote = await page.locator('#typing-wrap').boundingBox();
    await openBookMode(page);
    const bookRail = await page.locator('.mode-options').boundingBox();
    expect(bookRail.y, `${width} rail`).toBe(rail.y);
    expect((await page.locator('#typing-wrap').boundingBox()).y, `${width} passage`).toBe(quote.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} no sideways scroll`).toBe(true);
  }
  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [width, height, name] of [[1280, 800, 'desktop'], [390, 844, 'phone']]) {
      await page.setViewportSize({ width, height });
      await openApp(page);
      await openBookMode(page);
      await page.screenshot({ path: shot(testInfo, `practice-${name}-${scheme}`) });
      await page.getByRole('combobox', { name: 'book', exact: true }).click();
      await expect(page.locator('#book-select-list')).toBeVisible();
      await page.locator('#book-select-list').evaluate((menu) => Promise.all(menu.getAnimations().map((animation) => animation.finished)));
      await page.screenshot({ path: shot(testInfo, `picker-${name}-${scheme}`) });
      await page.keyboard.press('Escape');
      // Committed captures type at a person's pace, so the run card shows a believable speed.
      await typeInto(page, await passageText(page), '#typing-input', { delay: process.env.SCREENSHOTS ? 80 : 0 });
      await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
      await page.screenshot({ path: shot(testInfo, `results-${name}-${scheme}`) });
    }
  }
});
