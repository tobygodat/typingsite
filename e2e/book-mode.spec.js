// Book mode: public-domain chapters typed a page at a time, the place kept per book, and per-chapter
// speed after each page. Book pages never become bests, retests, trends or training evidence.
import { mkdirSync } from 'node:fs';
import { test, expect, openApp, passageText, typeInto, completePassage, openView, signInWithEmail, storageKeys } from './fixtures.js';

const description = (page) => page.locator('#session-description');
// Page labels hold non-breaking spaces (a phone line breaks only after a "·"), and a regex sees
// them as \s, not as ' '.
const label = (source) => new RegExp(source.replaceAll(' ', '\\s'));

async function openBookMode(page) {
  await page.locator('#mode-book').click();
  await expect(page.locator('#session-title')).toHaveText('Alice’s Adventures in Wonderland');
  await expect(page.locator('#text-display .char').first()).toBeVisible();
}

// Screenshots go to docs/ only when asked for (SCREENSHOTS=1); otherwise into the test's output.
async function shot(page, testInfo, name) {
  const dir = 'docs/screenshots/book-mode';
  if (process.env.SCREENSHOTS) mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: process.env.SCREENSHOTS ? `${dir}/${name}.png` : testInfo.outputPath(`${name}.png`) });
}

test('book mode loads its text on demand and types page by page, keeping the place for the tab', async ({ page }) => {
  const textRequests = [];
  page.on('request', (request) => { if (request.url().endsWith('/src/book-texts.js')) textRequests.push(request.url()); });
  await openApp(page);
  expect(textRequests).toEqual([]);

  await openBookMode(page);
  expect(textRequests).toHaveLength(1);
  await expect(description(page)).toHaveText(label('^Chapter I · Down the Rabbit-Hole · page 1 of \\d+$'));
  await expect(page.locator('#book-credit')).toHaveText('Text from Project Gutenberg; public domain in the US');
  await expect(page.locator('#condition-line')).toHaveText('english · book · physical keyboard · continue on error · gutenberg v1 · metric v1');
  await expect(page.locator('#duration-options')).toBeHidden();
  await expect(page.locator('#punctuation-toggle')).toBeDisabled();
  await expect(page.locator('#best')).toHaveText('Book pages keep no best');
  const first = await passageText(page);
  expect(first).toMatch(/^Alice was beginning to get very tired of sitting by her sister/);
  expect(first).toMatch(/^[\x20-\x7e]+$/);

  await completePassage(page);
  await expect(page.locator('#result-delta')).toHaveText(label('^Page 1 of \\d+ · Chapter I$'));
  await expect(page.locator('#result-comparison-note')).toHaveText('Book pages don’t count toward your best, retests or training patterns.');
  await expect(page.locator('#run-card-stamp')).toContainText('· book');
  await expect(page.locator('#result-conditions')).toContainText('alice in wonderland · chapter i · page 1 of');
  await expect(page.locator('#run-again')).toBeFocused();
  await expect(page.locator('#run-again')).toHaveText('Next page');
  await expect(page.locator('#start-drill')).toBeHidden();
  await expect(page.locator('#skip-to-retest')).toBeHidden();
  // A drill from here would carry the book's conditions; Next page is the one action.
  await expect(page.locator('.manual-panel')).toBeHidden();
  await expect(page.locator('#results-screen .btn-primary:visible')).toHaveCount(1);
  await expect(page.locator('#book-panel-title')).toHaveText('Alice’s Adventures in Wonderland');
  await expect(page.locator('#book-panel-byline')).toHaveText('Lewis Carroll · Text from Project Gutenberg; public domain in the US');
  const rows = page.locator('#book-chapter-rows tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('th')).toHaveText('Chapter I · Down the Rabbit-Hole · next page');
  await expect(rows.nth(0).locator('td').nth(0)).toHaveText(/^1 \/ \d+$/);
  await expect(rows.nth(0).locator('td').nth(1)).toHaveText(/^\d+$/);
  await expect(rows.nth(1).locator('td').nth(0)).toHaveText(/^0 \/ \d+$/);
  await expect(rows.nth(1).locator('td').nth(1)).toHaveText('—');

  await page.keyboard.press('Enter');
  await expect(description(page)).toHaveText(label('page 2 of'));
  const second = await passageText(page);
  expect(second).not.toBe(first);
  expect(first.endsWith('conversations?"') && second.startsWith('So she was considering')).toBe(true);

  // Esc restarts the same page; nothing moves on until a page is finished.
  await typeInto(page, second.slice(0, 5));
  await page.keyboard.press('Escape');
  await expect(description(page)).toHaveText(label('page 2 of'));
  await expect(page.locator('#typing-input')).toHaveValue('');

  // Each book has its own place.
  await page.locator('#book-select').selectOption('pride');
  await expect(page.locator('#session-title')).toHaveText('Pride and Prejudice');
  await expect(description(page)).toHaveText(label('^Chapter I · page 1 of \\d+$'));
  await page.locator('#book-select').selectOption('alice');
  await expect(description(page)).toHaveText(label('page 2 of'));

  // Book pages are not practice runs.
  await openView(page, 'Progress');
  await expect(page.locator('#progress-empty')).toBeVisible();
  await openView(page, 'Train');
  await expect(page.locator('#training-targets')).toBeEmpty();

  // A guest keeps the place for the tab only.
  expect(await storageKeys(page)).toEqual([]);
  await page.reload();
  await expect(page.locator('#mode-time')).toHaveAttribute('aria-pressed', 'true');
});

test('an interrupted page is not counted and is offered again', async ({ page }) => {
  await openApp(page);
  await openBookMode(page);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 6));
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('#typing-status')).toHaveText('Interrupted');
  await typeInto(page, text.slice(6));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Interrupted · not counted');
  await expect(page.locator('#run-again')).toHaveText('Try this page again');
  await expect(page.locator('#book-chapter-rows tr').nth(0).locator('td').nth(0)).toHaveText(/^0 \//);
  await page.locator('#run-again').click();
  await expect(description(page)).toHaveText(label('page 1 of'));
  expect(await passageText(page)).toBe(text);
});

test('the palette opens a book, and a signed-in place survives reloads to the end of the book', async ({ page, supabase }) => {
  const user = supabase.addUser('reader@stilltype.test');
  // Two pages from the end of Pride and Prejudice's two included chapters.
  supabase.profiles.set(user.id, { data: { version: 2, preferences: { mode: 'time' }, books: { pride: { page: 28, version: 'gutenberg-en-v1' } }, updatedAt: '2026-10-01T00:00:00.000Z' }, updated_at: '2026-10-01T00:00:00.000Z' });
  await openApp(page);
  await signInWithEmail(page, 'reader@stilltype.test');

  await page.locator('#typing-input').focus();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('book · pride');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('book · pride and prejudice');
  await page.keyboard.press('Enter');
  await expect(page.locator('#session-title')).toHaveText('Pride and Prejudice');
  await expect(description(page)).toHaveText('Chapter II · page 14 of 15');

  await completePassage(page);
  await expect(page.locator('#result-delta')).toHaveText('Page 14 of 15 · Chapter II');
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await expect.poll(() => supabase.profileFor('reader@stilltype.test')?.books?.pride?.page).toBe(29);

  await page.reload();
  await expect(page.locator('#mode-book')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#session-title')).toHaveText('Pride and Prejudice');
  await expect(description(page)).toHaveText('Chapter II · page 15 of 15');

  await completePassage(page);
  await expect(page.locator('#run-again')).toHaveText('Start again from page 1');
  await openView(page, 'Practice');
  await expect(page.locator('#text-display')).toHaveText('You’ve typed every included page of Pride and Prejudice.');
  await expect(page.locator('#typing-input')).toBeDisabled();
  await page.locator('#book-restart').click();
  await expect(description(page)).toHaveText(label('^Chapter I · page 1 of 15$'));
  await expect(page.locator('#typing-input')).toBeFocused();
});

test('Next page stays with its book after the mode or the book changes', async ({ page }) => {
  await openApp(page);
  await openBookMode(page);
  await completePassage(page);
  await expect(page.locator('#run-again')).toHaveText('Next page');
  await openView(page, 'Practice');
  await page.locator('#mode-time').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'practice');
  await openView(page, 'Train');
  await expect(page.locator('#run-again')).toHaveText('Next page');
  await page.locator('#run-again').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'book');
  await expect(page.locator('#mode-book')).toHaveAttribute('aria-pressed', 'true');
  await expect(description(page)).toHaveText(label('^Chapter I · Down the Rabbit-Hole · page 2 of \\d+$'));

  // Choosing another book in between doesn't move Next page under Alice's table to that book.
  await completePassage(page);
  await openView(page, 'Practice');
  await page.locator('#book-select').selectOption('pride');
  await expect(page.locator('#session-title')).toHaveText('Pride and Prejudice');
  await openView(page, 'Train');
  await expect(page.locator('#book-panel-title')).toHaveText('Alice’s Adventures in Wonderland');
  await page.locator('#run-again').click();
  await expect(page.locator('#session-title')).toHaveText('Alice’s Adventures in Wonderland');
  await expect(description(page)).toHaveText(label('page 3 of'));
  await expect(page.locator('#book-select')).toHaveValue('alice');
});

test('a book that fails to load opens on restart once the connection is back', async ({ page, browserErrors }) => {
  const requests = [];
  let offline = true;
  await page.route((url) => url.pathname === '/src/book-texts.js', (route) => {
    requests.push(route.request().url());
    return offline ? route.abort() : route.continue();
  });
  await openApp(page);
  await page.locator('#mode-book').click();
  await expect(page.locator('#text-display')).toHaveText('The book couldn’t load.');
  await expect(page.locator('#typing-status')).toHaveText('Not loaded');
  await expect(page.locator('#typing-status')).toHaveClass(/badge-neutral/);
  await expect(page.locator('#input-help')).toHaveText('Check your connection, then restart.');
  await expect(page.locator('#timer')).toHaveText('—');
  await expect(page.locator('#timer-unit')).toHaveText('');

  offline = false;
  await page.locator('#restart-button').click();
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await expect(description(page)).toHaveText(label('^Chapter I · Down the Rabbit-Hole · page 1 of \\d+$'));
  await expect(page.locator('#typing-input')).toBeFocused();
  // The browser keeps a failed module fetch for its URL, so the retry asks under a new one.
  expect(requests).toHaveLength(2);
  expect(new URL(requests[1]).search).toBe('?retry=1');
  // The aborted request is the only console error.
  const unexpected = browserErrors.filter((message) => !/ERR_FAILED|book-texts\.js/.test(message));
  browserErrors.splice(0, browserErrors.length, ...unexpected);
});

test('screenshots: a book page and its chapter speeds, dark and light', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await openBookMode(page);
  await page.locator('#book-select').selectOption('pride');
  await expect(page.locator('#session-title')).toHaveText('Pride and Prejudice');
  await page.mouse.move(640, 700);
  await shot(page, testInfo, 'practice-dark');

  // A human pace: roughly 70-90 wpm.
  await typeInto(page, await passageText(page), '#typing-input', { delay: 130 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  const wpm = Number(await page.locator('#result-wpm').textContent());
  expect(wpm).toBeGreaterThan(40);
  expect(wpm).toBeLessThan(110);
  await page.waitForTimeout(700);
  await shot(page, testInfo, 'results-dark');

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // Let the 350 ms ground colour transition settle.
  await page.waitForTimeout(700);
  await shot(page, testInfo, 'results-light');
  await page.locator('#run-again').click();
  await expect(description(page)).toHaveText(label('page 2 of'));
  await page.mouse.move(640, 700);
  await shot(page, testInfo, 'practice-light');
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('screenshots: a book page on a phone fits without sideways scroll', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await openBookMode(page);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    for (const selector of ['#mode-book', '#book-select']) {
      expect((await page.locator(selector).boundingBox()).height, selector).toBeGreaterThanOrEqual(38);
    }
    await shot(page, testInfo, 'practice-mobile');
    await typeInto(page, await passageText(page), '#typing-input', { delay: 130 });
    await expect(page.locator('#book-panel')).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.waitForTimeout(700);
    // Below the run card: the page heading, Next page and the chapter table.
    await page.locator('#results-heading').evaluate((node) => node.scrollIntoView({ block: 'start' }));
    await shot(page, testInfo, 'results-mobile');
  });
});

test('on short phones a page starts above the dock', async ({ page }) => {
  for (const [width, height] of [[320, 568], [375, 667]]) {
    await page.setViewportSize({ width, height });
    await openApp(page);
    await page.locator('#mode-book').click();
    for (const book of ['alice', 'pride', 'sherlock', 'frankenstein']) {
      await page.locator('#book-select').selectOption(book);
      await expect(page.locator('#text-display .char').first()).toBeVisible();
      const fit = await page.evaluate(() => ({
        line: document.querySelector('#text-display .char').getBoundingClientRect().bottom,
        dock: document.querySelector('.dock').getBoundingClientRect().top,
      }));
      expect(fit.line, `${book} at ${width}×${height}`).toBeLessThanOrEqual(fit.dock);
    }
    // The title and conditions step aside visually but still name the screen.
    await expect(page.getByRole('heading', { level: 1, name: 'Frankenstein' })).toBeAttached();
  }
});

test('a 320px screen keeps the book controls and chapter table inside the page', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openApp(page);
  await openBookMode(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  // A human pace: instant typing scores in the thousands, which no run card fits at 320px.
  test.setTimeout(150_000);
  await typeInto(page, await passageText(page), '#typing-input', { delay: 150 });
  await expect(page.locator('#book-panel')).toBeVisible();
  expect(Number(await page.locator('#result-wpm').textContent())).toBeLessThan(100);
  expect(await overflow()).toBeLessThanOrEqual(0);
  const fit = await page.locator('#book-panel').evaluate((panel) => ({
    right: panel.getBoundingClientRect().right,
    table: panel.querySelector('table').scrollWidth - panel.clientWidth,
  }));
  expect(fit.right).toBeLessThanOrEqual(320);
  expect(fit.table).toBeLessThanOrEqual(0);
});
