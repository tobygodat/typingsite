// The beginner path: lessons that add a few keys at a time with a finger map, unlock on one run at 95%
// accuracy and a gentle speed, stay out of bests and progress, and hand off to the training loop.
import { LESSONS } from '../src/lessons.js';
import { test, expect, openApp, openView, chooseWords, completePassage, passageText, typeInto, signInWithEmail, storageKeys } from './fixtures.js';

const body = (page) => page.locator('body');
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// Screenshots go to docs/ only when asked for; otherwise they stay with the test output.
const shot = (page, testInfo, name, options = {}) => page.screenshot({
  path: process.env.SCREENSHOTS ? `docs/screenshots/beginner-path/${name}.png` : testInfo.outputPath(`${name}.png`), ...options,
});

async function openLessons(page) {
  await page.locator('#open-lessons').click();
  await expect(body(page)).toHaveAttribute('data-view', 'learn');
}

async function startLesson(page, number) {
  await expect(page.locator('#lesson-primary')).toHaveText(`Start lesson ${number}`);
  await page.locator('#lesson-primary').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'lesson');
  await expect(page.locator('#session-title')).toHaveText(new RegExp(`^Lesson ${number} · `));
}

// Types the lesson passage (instantly unless a delay is given) and waits for the lesson result.
async function typeLesson(page, options = {}) {
  const text = await passageText(page);
  await typeInto(page, text, '#typing-input', options);
  await expect(body(page)).toHaveAttribute('data-view', 'learn');
  return text;
}

// A signed-in learner who passed the first `count` lessons at plausible beginner numbers.
function learner(supabase, email, count) {
  const user = supabase.addUser(email);
  const lessons = Object.fromEntries(LESSONS.slice(0, count).map((lesson, i) => {
    const record = { wpm: 13 + i * 2, accuracy: 96 + (i % 4), at: `2026-10-0${1 + (i % 7)}T18:${10 + i}:00Z` };
    return [lesson.id, { tries: 1 + (i % 3), last: record, passed: record }];
  }));
  supabase.profiles.set(user.id, { data: { version: 2, preferences: {}, attempts: [], runs: [], loops: [], seenTextIds: [], bests: {}, lessons,
    updatedAt: '2026-10-08T12:00:00Z' } });
  return user;
}

test('learn to type opens from the mode area, the palette and first-run states', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.practice-controls #open-lessons')).toHaveText('learn to type');
  await openLessons(page);
  await expect(page.locator('#learn-heading')).toHaveText('Learn to type');
  await expect(page.locator('#lesson-current-heading')).toHaveText('Lesson 1 · f and j');
  await expect(page.locator('#lesson-current-copy')).toContainText('Key pairs only (repetitions, not words)');
  await expect(page.locator('#lesson-current-meta')).toHaveText('f left index · j right index · pass at 95% accuracy and 10 wpm in one run');
  await expect(page.locator('#lesson-list .lesson-row')).toHaveCount(LESSONS.length);
  await expect(page.locator('#lesson-list .lesson-row').first()).toHaveAttribute('data-state', 'next');
  await expect(page.locator('#lesson-list .lesson-row[data-state="locked"]')).toHaveCount(LESSONS.length - 1);
  // No dock item claims the learn screen.
  await expect(page.locator('.dock-nav [aria-current="page"]')).toHaveCount(0);

  const map = page.locator('#lesson-keyboard');
  await expect(map).toHaveAttribute('role', 'img');
  await expect(map).toHaveAttribute('aria-label', /left index: r f v t g b\. right index: y h n u j m\./);
  await expect(map.locator('.key')).toHaveCount(28);
  await expect(map.locator('.key.target')).toHaveText(['f', 'j']);
  await expect(map.locator('.finger-label-full')).toHaveText(['pinky', 'ring', 'middle', 'index', 'index', 'middle', 'ring', 'pinky']);

  // First-run states link here quietly. The links hide with their screen, so focus moves to the lesson's action.
  await openView(page, 'Train');
  await expect(page.locator('#train-learn')).toBeVisible();
  await page.locator('#train-learn button').focus();
  await page.keyboard.press('Enter');
  await expect(body(page)).toHaveAttribute('data-view', 'learn');
  await expect(page.locator('#lesson-primary')).toBeFocused();
  await openView(page, 'Progress');
  await page.locator('#progress-empty .quiet-link').click();
  await expect(body(page)).toHaveAttribute('data-view', 'learn');
  await expect(page.locator('#lesson-primary')).toBeFocused();

  await page.keyboard.press('Control+k');
  await page.keyboard.type('learn to type');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('learn to type');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-hint')).toHaveText('here');
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('#lesson-primary')).toBeFocused();
  await openView(page, 'Practice');
  await page.locator('#open-lessons').focus();
  await page.keyboard.press('Enter');
  await expect(body(page)).toHaveAttribute('data-view', 'learn');
  await expect(page.locator('#lesson-primary')).toBeFocused();
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('next lesson');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('next lesson · f j');
  await page.keyboard.press('Enter');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'lesson');
});

test('a lesson shows the finger map, passes at 95% and unlocks the next keys without counting as practice', async ({ page }) => {
  await openApp(page);
  await openLessons(page);
  await startLesson(page, 1);
  await expect(page.locator('.practice-controls')).toBeHidden();
  await expect(page.locator('#session-description')).toContainText('Key pairs only (repetitions, not words)');
  await expect(page.locator('#condition-line')).toHaveText(/^lesson 1 of 14 · keys f j · key pairs · pass at 95% accuracy and 10 wpm · physical keyboard · continue on error$/);
  // The keyboard setting is off, but a lesson always shows the finger map.
  await expect(page.locator('#keyboard-toggle')).not.toBeChecked();
  await expect(page.locator('#keyboard')).toBeVisible();
  await expect(page.locator('#keyboard')).toHaveClass(/finger-map/);
  await expect(page.locator('#keyboard .key.target')).toHaveText(['f', 'j']);
  const text = await passageText(page);
  expect(text).toMatch(/^[fj]{2}( [fj]{2})+$/);

  await typeLesson(page);
  await expect(page.locator('#lesson-status')).toHaveText('passed');
  await expect(page.locator('#lesson-current-heading')).toHaveText('Lesson 1 passed. d and k are next.');
  await expect(page.locator('#lesson-facts')).toContainText('100%');
  await expect(page.locator('#lesson-facts > div').nth(0)).toHaveText(/^accuracy\s*100%\s*95% needed\s*met$/);
  await expect(page.locator('#lesson-facts > div').nth(1)).toHaveText(/^wpm\s*\d+\s*10 needed\s*met$/);
  await expect(page.locator('#lesson-primary')).toBeFocused();
  await expect(page.locator('#lesson-primary')).toHaveText('Start lesson 2');
  await expect(page.locator('#lesson-secondary')).toHaveText('Repeat lesson 1');
  const rows = page.locator('#lesson-list .lesson-row');
  await expect(rows.nth(0)).toHaveAttribute('data-state', 'passed');
  await expect(rows.nth(0)).toContainText(/\d+ wpm · 100%/);
  await expect(rows.nth(1)).toHaveAttribute('data-state', 'next');
  await expect(page.locator('#lesson-keyboard .key.target')).toHaveText(['d', 'k']);
  await expect(page.locator('#lesson-keyboard .key.is-known')).toHaveText(['f', 'j', 'space']);

  // Lessons never become bests, trends, run history or a Train result.
  await expect(page.locator('#best')).toHaveText('No best yet');
  await openView(page, 'Progress');
  await expect(page.locator('#progress-empty')).toBeVisible();
  await openView(page, 'Train');
  await expect(page.locator('#run-card')).toBeHidden();
  await expect(page.locator('#result-delta')).toHaveText('No run yet.');

  // The next lesson moves on to the next keys, and the normal keyboard comes back afterwards.
  await page.locator('#train-learn button').click();
  await page.locator('#lesson-primary').click();
  await expect(page.locator('#session-title')).toHaveText('Lesson 2 · d and k');
  expect(await passageText(page)).toMatch(/^[fjdk]{2}( [fjdk]{2})+$/);
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Practice' }).click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'practice');
  await expect(page.locator('#keyboard')).toBeHidden();
  await expect(page.locator('#keyboard')).not.toHaveClass(/finger-map/);
});

test('a run under 95% accuracy keeps the next keys locked and shows the numbers', async ({ page }) => {
  await openApp(page);
  await openLessons(page);
  await startLesson(page, 1);
  const text = await passageText(page);
  // Every fourth key is wrong and left in place: about 75% accuracy.
  const typed = [...text].map((char, i) => (i % 4 === 1 && char !== ' ' ? (char === 'f' ? 'j' : 'f') : char)).join('');
  await typeInto(page, typed);
  await expect(body(page)).toHaveAttribute('data-view', 'learn');
  await expect(page.locator('#lesson-status')).toHaveText('not yet');
  await expect(page.locator('#lesson-current-heading')).toHaveText('Not yet. Lesson 1 needs 95% accuracy in one run.');
  await expect(page.locator('#lesson-current-copy')).toHaveText('d and k stay locked until one run meets both numbers.');
  await expect(page.locator('#lesson-facts > div').nth(0)).toHaveText(/^accuracy\s*\d+%\s*95% needed\s*not met$/);
  await expect(page.locator('#lesson-facts > div').nth(1)).toHaveText(/^wpm\s*\d+\s*10 needed\s*met$/);
  await expect(page.locator('#lesson-primary')).toBeFocused();
  await expect(page.locator('#lesson-primary')).toHaveText('Try lesson 1 again');
  await expect(page.locator('#lesson-secondary')).toBeHidden();
  const rows = page.locator('#lesson-list .lesson-row');
  await expect(rows.nth(0)).toHaveAttribute('data-state', 'next');
  await expect(rows.nth(0)).toContainText(/1 try · last \d+ wpm · \d+%/);
  await expect(rows.nth(1)).toHaveAttribute('data-state', 'locked');
  await page.keyboard.press('Enter');
  await expect(page.locator('#session-title')).toHaveText('Lesson 1 · f and j');
});

test('Escape restarts a lesson, and an interrupted lesson is not counted', async ({ page }) => {
  await openApp(page);
  await openLessons(page);
  await startLesson(page, 1);
  await typeInto(page, (await passageText(page)).slice(0, 5));
  await page.keyboard.press('Escape');
  await expect(page.locator('#typing-input')).toHaveValue('');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'lesson');
  await expect(page.locator('#session-title')).toHaveText('Lesson 1 · f and j');
  // The palette's restart does what Esc does: a lesson stays a lesson.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('restart test');
  await page.keyboard.press('Enter');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'lesson');
  await expect(page.locator('#session-title')).toHaveText('Lesson 1 · f and j');
  await expect(page.locator('#typing-input')).toBeFocused();

  const text = await passageText(page);
  await typeInto(page, text.slice(0, 5));
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await expect(page.locator('#typing-status')).toHaveText('Interrupted');
  // The palette hands focus back once its close animation ends.
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('#typing-input')).toBeFocused();
  await page.keyboard.type(text.slice(5));
  await expect(body(page)).toHaveAttribute('data-view', 'learn');
  await expect(page.locator('#lesson-status')).toHaveText('interrupted');
  await expect(page.locator('#lesson-current-heading')).toHaveText('Lesson 1 interrupted · not counted');
  await expect(page.locator('#lesson-facts')).toBeHidden();
  await expect(page.locator('#lesson-list .lesson-row').first()).not.toContainText('try');
  await expect(page.locator('#lesson-primary')).toHaveText('Try lesson 1 again');
});

test('guests keep lesson progress for the tab only, and clearing history clears it with an undo', async ({ page, supabase }) => {
  await openApp(page);
  await openLessons(page);
  await startLesson(page, 1);
  await typeLesson(page);
  await expect(page.locator('#lesson-save-note')).toContainText('Lesson progress lasts for this tab; sign in to save future lessons.');

  await openView(page, 'Progress');
  await expect(page.locator('#clear-history')).toBeVisible();
  await page.locator('#clear-history').click();
  await expect(page.locator('#clear-dialog')).toContainText('lesson progress will be removed');
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await page.locator('#progress-empty .quiet-link').click();
  await expect(page.locator('#lesson-list .lesson-row').first()).toHaveAttribute('data-state', 'next');
  await page.locator('#undo-clear').click();
  await expect(page.locator('#lesson-list .lesson-row').first()).toHaveAttribute('data-state', 'passed');

  expect(await storageKeys(page)).toEqual([]);
  expect(supabase.requests).toEqual([]);
  await page.reload();
  await openLessons(page);
  await expect(page.locator('#lesson-current-heading')).toHaveText('Lesson 1 · f and j');
  await expect(page.locator('#lesson-list .lesson-row').first()).toHaveAttribute('data-state', 'next');
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

  test('a touch run is a labelled try that doesn’t unlock the next lesson; a physical run does', async ({ page }) => {
    await openApp(page);
    await openLessons(page);
    await startLesson(page, 1);
    await page.locator('#typing-input').tap();
    await expect(page.locator('#condition-line')).toContainText('touch input');
    await typeLesson(page);
    await expect(page.locator('#lesson-status')).toHaveText('touch input');
    await expect(page.locator('#lesson-current-heading')).toHaveText('Lesson 1 on touch input · doesn’t unlock');
    const rows = page.locator('#lesson-list .lesson-row');
    await expect(rows.first()).toHaveAttribute('data-state', 'next');
    await expect(rows.first().locator('.lesson-row-numbers')).toHaveText(/^1 try · last \d+ wpm · 100% · touch input$/);
    await expect(rows.nth(1)).toHaveAttribute('data-state', 'locked');

    // The same lesson on a physical keyboard passes and unlocks d and k.
    await page.locator('#lesson-primary').click();
    await expect(page.locator('#condition-line')).toContainText('physical keyboard');
    await typeLesson(page);
    await expect(page.locator('#lesson-status')).toHaveText('passed');
    await expect(rows.nth(1)).toHaveAttribute('data-state', 'next');
  });

  // A tap that starts a lesson focuses the input and opens the soft keyboard, so no tap reaches the passage.
  test('a tap on a lesson’s start button marks it as touch input; a mouse click stays a physical keyboard', async ({ page }) => {
    await openApp(page);
    await openLessons(page);
    await page.locator('#lesson-primary').tap();
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'lesson');
    await expect(page.locator('#condition-line')).toContainText('touch input');
    await typeLesson(page);
    await expect(page.locator('#lesson-status')).toHaveText('touch input');
    const rows = page.locator('#lesson-list .lesson-row');
    await expect(rows.nth(1)).toHaveAttribute('data-state', 'locked');

    await page.locator('#lesson-primary').click();
    await expect(page.locator('#condition-line')).toContainText('physical keyboard');
    await page.keyboard.press('Control+k');
    await page.locator('#palette-input').fill('learn to type');
    await page.keyboard.press('Enter');
    await expect(body(page)).toHaveAttribute('data-view', 'learn');
    await rows.first().getByRole('button').tap();
    await expect(page.locator('#condition-line')).toContainText('touch input');
  });

  test('a tap on restart turns a keyboard-started lesson into touch input', async ({ page }) => {
    await openApp(page);
    await openLessons(page);
    await page.keyboard.press('Enter');
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'lesson');
    await expect(page.locator('#condition-line')).toContainText('physical keyboard');
    await page.locator('#restart-button').tap();
    await expect(page.locator('#condition-line')).toContainText('touch input');
    await typeLesson(page);
    await expect(page.locator('#lesson-status')).toHaveText('touch input');
    const rows = page.locator('#lesson-list .lesson-row');
    await expect(rows.first().locator('.lesson-row-numbers')).toContainText('touch input');
    await expect(rows.nth(1)).toHaveAttribute('data-state', 'locked');
  });
});

test('clearing history replaces a lesson it locks, and a restart never starts a locked lesson', async ({ page }) => {
  await openApp(page);
  await openLessons(page);
  await startLesson(page, 1);
  await typeLesson(page);
  await startLesson(page, 2);
  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(body(page)).toHaveAttribute('data-view', 'progress');
  await expect(page.locator('#session-title')).toHaveText('Lesson 1 · f and j');

  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('restart test');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('restart test');
  await page.keyboard.press('Enter');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'lesson');
  await expect(page.locator('#session-title')).toHaveText('Lesson 1 · f and j');
  await typeLesson(page);
  await expect(page.locator('#lesson-current-heading')).toHaveText('Lesson 1 passed. d and k are next.');
});

test('opening learn to type mid-drill ends the drill without drawing a retest passage', async ({ page, supabase }) => {
  const user = supabase.addUser('drill@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, user.email);
  await chooseWords(page, 10);
  await completePassage(page);
  await page.locator('#start-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect.poll(() => supabase.profileFor(user.email)?.runs?.length).toBe(1);
  const seen = supabase.profileFor(user.email).seenTextIds;
  await typeInto(page, (await passageText(page)).slice(0, 4));
  await expect(body(page)).toHaveAttribute('data-running', 'true');

  await page.keyboard.press('Control+k');
  await page.keyboard.type('learn to type');
  await page.keyboard.press('Enter');
  await expect(body(page)).toHaveAttribute('data-view', 'learn');
  // The interrupted drill and anything drawn with it reach the account in the same save.
  await expect.poll(() => supabase.profileFor(user.email)?.runs?.map((run) => `${run.kind} ${run.status}`)).toEqual(['test complete', 'drill interrupted']);
  expect(supabase.profileFor(user.email).seenTextIds).toEqual(seen);
});

test('a suggestion sent from the learn screen records the learn view', async ({ page, supabase }) => {
  await openApp(page);
  await openLessons(page);
  await page.locator('#suggest-trigger').click();
  await page.locator('#suggest-text').fill('A lesson for the number row');
  await page.locator('#send-suggest').click();
  await expect(page.locator('#suggest-toast')).toBeVisible();
  expect(supabase.suggestions).toEqual([{ body: 'A lesson for the number row', view: 'learn' }]);
});

test('a signed-in learner’s lesson progress syncs to the account, outside runs and bests', async ({ page, supabase }) => {
  const user = supabase.addUser('learner@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openLessons(page);
  await expect(page.locator('#lesson-save-note')).toContainText('Lesson progress saves to your account.');
  await startLesson(page, 1);
  await typeLesson(page);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await expect.poll(() => supabase.profileFor(user.email)?.lessons?.fj?.passed?.accuracy).toBe(100);
  const saved = supabase.profileFor(user.email);
  expect(saved.runs).toEqual([]);
  expect(saved.attempts).toEqual([]);
  expect(saved.bests).toEqual({});
  expect(saved.seenTextIds).toEqual(expect.not.arrayContaining([expect.stringMatching(/^lesson-/)]));

  await page.reload();
  await openLessons(page);
  await expect(page.locator('#lesson-current-heading')).toHaveText('Lesson 2 · d and k');
  await expect(page.locator('#lesson-list .lesson-row').first()).toHaveAttribute('data-state', 'passed');
});

test('passing every lesson hands off to the training loop', async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page);
  await openLessons(page);
  for (let number = 1; number <= LESSONS.length; number += 1) {
    await startLesson(page, number);
    const text = await typeLesson(page);
    const allowed = new Set([...LESSONS.slice(0, number).flatMap((lesson) => lesson.keys), ' ']);
    expect([...text].every((char) => allowed.has(char)), text).toBe(true);
    await expect(page.locator('#lesson-status')).toHaveText('passed');
  }
  await expect(page.locator('#lesson-current-heading')).toHaveText('Lesson 14 passed. Every letter is in.');
  await expect(page.locator('#lesson-current-copy')).toContainText('the training loop takes over');
  await expect(page.locator('#lesson-list .lesson-row[data-state="passed"]')).toHaveCount(LESSONS.length);
  await expect(page.locator('#lesson-primary')).toHaveText('Take a practice run');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('next lesson');
  await expect(page.locator('#palette-list')).not.toContainText('next lesson ·');
  await page.keyboard.press('Escape');

  await page.locator('#lesson-primary').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'practice');
  await expect(page.locator('#typing-input')).toBeFocused();
  await chooseWords(page, 10);
  await completePassage(page);
  await expect(page.locator('#run-card')).toBeVisible();
  await expect(page.locator('#start-drill')).toBeEnabled();
  await page.locator('#start-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');

  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await page.locator('[data-nav="practice"].nav-item').click();
  await openLessons(page);
  await expect(page.locator('#lesson-current-heading')).toHaveText('Every letter is in.');
});

test('a key-pair lesson is labelled, and its finger map stays in view on a laptop screen', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await openLessons(page);
  await startLesson(page, 1);
  await expect(page.locator('#session-description')).toContainText('Key pairs only (repetitions, not words).');
  await page.mouse.move(0, 0);
  await shot(page, testInfo, 'lesson-pairs-dark');

  // At 1280×721 the finger names and the thumbs row stay above the fold, before and during the run.
  const inView = () => page.evaluate(() => ({
    scrollY,
    fits: document.querySelector('#keyboard .finger-thumbs').getBoundingClientRect().bottom <= innerHeight
      && document.querySelector('#keyboard .finger-label').getBoundingClientRect().bottom <= innerHeight,
  }));
  await page.setViewportSize({ width: 1280, height: 721 });
  expect(await inView()).toEqual({ scrollY: 0, fits: true });
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 8));
  await expect(body(page)).toHaveAttribute('data-running', 'true');
  expect(await inView()).toEqual({ scrollY: 0, fits: true });
  await page.keyboard.type(text.slice(8));
  await expect(body(page)).toHaveAttribute('data-view', 'learn');
  // The next lesson starts from the top even when the result scrolled the learn screen.
  await page.locator('#lesson-primary').click();
  await expect(page.locator('#session-title')).toHaveText('Lesson 2 · d and k');
  expect(await inView()).toEqual({ scrollY: 0, fits: true });
});

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['narrow phone', { width: 320, height: 640 }]]) {
  test(`lessons fit a ${name} at ${viewport.width}px with the finger map`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await expect(page.locator('#open-lessons')).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await openLessons(page);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expect(page.locator('#lesson-keyboard')).toBeVisible();
    await expect(page.locator('#lesson-keyboard .finger-label-short').first()).toBeVisible();
    await expect(page.locator('#lesson-keyboard .finger-legend')).toBeVisible();
    if (viewport.width === 390) {
      // The mobile dock covers the foot of the viewport; centre the finger map above it.
      await page.locator('#lesson-keyboard').evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await shot(page, testInfo, 'mobile-learn-dark');
    }
    await startLesson(page, 1);
    await expect(page.locator('#keyboard')).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const keyboard = await page.locator('#keyboard').boundingBox();
    expect(keyboard.x).toBeGreaterThanOrEqual(0);
    expect(keyboard.x + keyboard.width).toBeLessThanOrEqual(viewport.width);
    if (viewport.width === 390) {
      await page.locator('#typing-input').blur();
      await shot(page, testInfo, 'mobile-lesson-dark');
    }
  });
}

for (const scheme of ['dark', 'light']) {
  test(`a learner types a lesson at a human pace and passes (${scheme})`, async ({ page, supabase }, testInfo) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    const user = learner(supabase, `pace-${scheme}@stilltype.test`, 4);
    await openApp(page);
    await signInWithEmail(page, user.email);
    await openLessons(page);
    await expect(page.locator('#lesson-current-heading')).toHaveText('Lesson 5 · e and i');
    await expect(page.locator('#lesson-list .lesson-row[data-state="passed"]')).toHaveCount(4);
    await page.mouse.move(0, 0);
    await shot(page, testInfo, `learn-${scheme}`);

    await startLesson(page, 5);
    await expect(page.locator('#session-description')).toContainText('real words from the common-word lists');
    const text = await passageText(page);
    expect(text.split(' ').every((word) => /^[fjdksla;ei]+$/.test(word))).toBe(true);
    // About 55 wpm, with one slip corrected along the way.
    const at = text.indexOf(' ', 24) + 1;
    await typeInto(page, text.slice(0, at), '#typing-input', { delay: 210 });
    await page.keyboard.type(text[at] === 'e' ? 'd' : 'e');
    await expect(page.locator('#text-display .char.wrong')).toHaveCount(1);
    await shot(page, testInfo, `lesson-${scheme}`);
    await page.keyboard.press('Backspace');
    await page.keyboard.type(text.slice(at), { delay: 210 });
    await expect(body(page)).toHaveAttribute('data-view', 'learn');
    await expect(page.locator('#lesson-status')).toHaveText('passed');
    await expect(page.locator('#lesson-current-heading')).toHaveText('Lesson 5 passed. r and u are next.');
    const wpm = Number(await page.locator('#lesson-facts dd.num').nth(2).textContent());
    expect(wpm).toBeGreaterThan(30);
    expect(wpm).toBeLessThan(110);
    await expect(page.locator('#lesson-facts')).toContainText('first-try errors');
    await page.mouse.move(0, 0);
    await shot(page, testInfo, `result-${scheme}`);
  });
}

test('the last lesson hands off clearly (screenshot)', async ({ page, supabase }, testInfo) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ colorScheme: 'dark' });
  const user = learner(supabase, 'last@stilltype.test', LESSONS.length - 1);
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openLessons(page);
  await startLesson(page, LESSONS.length);
  await typeLesson(page, { delay: 190 });
  await expect(page.locator('#lesson-current-heading')).toHaveText('Lesson 14 passed. Every letter is in.');
  await expect(page.locator('#lesson-primary')).toHaveText('Take a practice run');
  await expect(page.locator('#lesson-keyboard .key.target')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await shot(page, testInfo, 'handoff-dark');
});
