// What waits on Practice when someone leaves it for another screen and comes back through the dock (TOB-448), for
// every kind of session nobody has started yet. Kept: the person's own practice (a words, time or quote test, the
// standard test, adaptive practice, each still redrawn when it has gone stale, which their own specs cover), custom
// text, and Train's drill and retest (learning-loop.spec.js), whose loop can't be picked up again without them. Left
// for a plain practice test: a daily passage, a lesson and missed-word practice, which each open again in one step from
// where they were offered (Challenge's daily view, Learn to type, the results card) and hold nothing Practice keeps.
import { test, expect, openApp, openView, passageText, chooseWords, chooseMore, completePassage } from './fixtures.js';

const session = (page) => page.locator('#typing-screen').getAttribute('data-session');

// Away to Progress and back through the dock, as someone checking their week would.
async function awayAndBack(page) {
  await openView(page, 'Progress');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'progress');
  await openView(page, 'Practice');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
}

const KEPT = {
  'a words test': async (page) => chooseWords(page, 25),
  'a quote test': async (page) => page.locator('#mode-quote').click(),
  'the standard test': async (page) => chooseMore(page, 'mode-standard'),
  'adaptive practice': async (page) => {
    await chooseWords(page, 10);
    await completePassage(page);
    await page.locator('#adaptive-switch').click();
    await expect(page.locator('#adaptive-toggle')).toBeChecked();
    await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  },
  'custom text': async (page) => {
    await chooseMore(page, 'mode-custom');
    await page.locator('#custom-text').fill('a passage of my own to type later today');
    await page.locator('#custom-use').click();
  },
};

for (const [name, start] of Object.entries(KEPT)) {
  test(`${name} nobody has started waits on Practice through a visit to another screen`, async ({ page }) => {
    await openApp(page);
    await start(page);
    const [kind, text] = [await session(page), await passageText(page)];
    await awayAndBack(page);
    expect(await session(page)).toBe(kind);
    expect(await passageText(page)).toBe(text);
  });
}

const LEFT = {
  'a daily passage': {
    kind: 'daily',
    start: async (page) => {
      await openView(page, 'Challenge');
      await page.locator('#open-daily').click();
      await page.locator('#start-daily').click();
    },
  },
  'a lesson': {
    kind: 'lesson',
    start: async (page) => {
      await chooseMore(page, 'open-lessons');
      await page.locator('#lesson-primary').click();
    },
  },
  'missed-word practice': {
    kind: 'missed',
    start: async (page) => {
      await chooseWords(page, 10);
      const words = (await passageText(page)).split(' ');
      await page.locator('#typing-input').focus();

      // The second word missed on its first try, then put right.
      for (const [index, word] of words.entries()) {
        if (index === 1) {
          await page.keyboard.type(word[0] === 'x' ? 'z' : 'x');
          await page.keyboard.press('Backspace');
        }

        await page.keyboard.type(index < words.length - 1 ? `${word} ` : word);
      }

      await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
      await page.locator('#practice-words').click();
    },
  },
};

for (const [name, { kind, start }] of Object.entries(LEFT)) {
  test(`${name} nobody has started gives way to a practice test when Practice is opened from another screen`, async ({ page }) => {
    await openApp(page);
    await start(page);
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', kind);
    const text = await passageText(page);
    await awayAndBack(page);
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'practice');
    expect(await passageText(page)).not.toBe(text);
  });
}
