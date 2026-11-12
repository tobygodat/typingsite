// What waits on Practice when someone leaves it for another screen and comes back through the dock (TOB-448), for
// every kind of session nobody has started yet. Kept: the person's own practice (a words, time or quote test, the
// standard test, adaptive practice, each still redrawn when it has gone stale, which their own specs cover), custom
// text, and Train's drill and retest (learning-loop.spec.js), whose loop can't be picked up again without them. Left
// for a plain practice test: a daily passage, a lesson and missed-word practice, which each open again in one step from
// where they were offered (Challenge's daily view, Learn to type, the results card) and hold nothing Practice keeps.
import { test, expect, openApp, openView, passageText, chooseWords, chooseMore, completePassage, finishDrill, chooseSetting, closeSettings } from './fixtures.js';
import { withHistory } from './train-fixtures.js';

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

// With Train's work waiting, the ways to Practice split in two (TOB-448). Showing Practice as it stands (the dock, the
// palette's "practice", focus mode) keeps a drill or retest nobody has started. Everything that asks for something
// (a length, a mode, a word list, custom text, a condition, the daily passage, a lesson, missed words) starts it and
// leaves the waiting drill or retest, as on master. Each is asked for from Train, as someone who left the drill would.
async function runPalette(page, label) {
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill(label);
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-label')).toContainText(label);
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).not.toHaveAttribute('open', '');
}

// One clock for the whole test, ahead of the real date so finishDrill keeps it (a second install would move the page
// back and leave a later drill unfinished).
const ownClock = (page) => page.clock.install({ time: Date.now() + 120_000 });

// A retest needs a baseline at the settings Train drills at, and a command before may have changed them (25 words,
// punctuation): a run at the settings as they stand comes first.
async function waiting(page, kind) {
  if (kind === 'retest') {
    await openView(page, 'Practice');
    await chooseWords(page, 10);
    await completePassage(page);
  }

  await openView(page, 'Train');
  await page.locator('#start-drill').click();

  if (kind === 'retest') await finishDrill(page);
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', kind);
  await openView(page, 'Train');
}

const practiceShown = async (page) => {
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'practice');
};

// What each asks for, and what Practice shows once it has. A layout changes the test's conditions from Train without
// leaving it, and comes last: after it the baseline can't be retested on this layout.
const STARTS = [
  // First, while the test is still words: the command then goes to Practice without changing the mode.
  ['custom words…', async (page) => { await practiceShown(page); await expect(page.locator('#custom-length-input')).toBeFocused(); }],
  ['words · 25 words', async (page) => { await practiceShown(page); await expect(page.locator('#condition-line')).toContainText('25 words'); }],
  ['time · 30 seconds', practiceShown],
  ['quote', practiceShown],
  ['standard test · 60 seconds', practiceShown],
  ['custom time…', async (page) => { await practiceShown(page); await expect(page.locator('#custom-length-input')).toBeFocused(); }],
  ['custom text', async (page) => { await expect(page.locator('body')).toHaveAttribute('data-view', 'practice'); await expect(page.locator('#custom-text')).toBeVisible(); }],
  ['word list · top 200', practiceShown],
  ['word list · top 1k', practiceShown],
  ['punctuation', practiceShown],
  ['numbers', practiceShown],
  ['daily challenge', async (page) => expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'daily')],
  ['next lesson', async (page) => expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'lesson')],
  ['practice words you keep missing', async (page) => expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'missed')],
  ['layout · dvorak', async (page) => expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'practice')],
];

for (const kind of ['drill', 'retest']) {
  test(`with a ${kind} waiting, every command that asks for a test starts it`, async ({ page, supabase }) => {
    test.setTimeout(120_000);
    await ownClock(page);
    await withHistory(page, supabase, `start-${kind}@stilltype.test`);

    for (const [label, shows] of STARTS) {
      await test.step(label, async () => {
        await waiting(page, kind);
        await runPalette(page, label);
        await shows(page);
      });
    }
  });

  test(`with a ${kind} waiting, a test setting changed in Settings starts a test with it`, async ({ page, supabase }) => {
    await ownClock(page);
    await withHistory(page, supabase, `settings-${kind}@stilltype.test`);
    await waiting(page, kind);
    await chooseSetting(page, 'word-list', '1k');
    await closeSettings(page);
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'practice');
  });

  test(`with a ${kind} waiting, the dock, the palette’s practice and focus mode show it as it stands`, async ({ page, supabase }) => {
    await ownClock(page);
    await withHistory(page, supabase, `show-${kind}@stilltype.test`);
    await waiting(page, kind);
    const text = await passageText(page);
    await openView(page, 'Practice');
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', kind);
    await openView(page, 'Train');
    await runPalette(page, 'practice');
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', kind);
    await openView(page, 'Train');
    await runPalette(page, 'focus mode');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', kind);
    expect(await passageText(page)).toBe(text);
  });

  test(`with a ${kind} waiting, signing out and signing in start from a practice test`, async ({ page, supabase }) => {
    await ownClock(page);
    await withHistory(page, supabase, `account-${kind}@stilltype.test`);
    await waiting(page, kind);
    await page.locator('#account-trigger').click();
    await Promise.all([page.waitForEvent('load'), page.locator('#account-signout').click()]);
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'practice');
  });
}

// A waiting retest or drill never outlives what it depends on (TOB-448). A clear takes the baseline: a retest nobody
// has started can then compare with nothing, so a practice test takes its place, whether the clear is made here or in
// another tab. A drill nobody has started still drills, and stands alone: nothing follows it. Signing in or out
// reloads the page (above), and no import replaces the history: Monkeytype import brings settings only.
async function clearFrom(page) {
  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(page.locator('#undo-clear')).toBeVisible();
}

test('a clear here replaces a waiting retest with a practice test', async ({ page, supabase }) => {
  await ownClock(page);
  await withHistory(page, supabase, 'clear-retest@stilltype.test');
  await waiting(page, 'retest');
  await clearFrom(page);
  await openView(page, 'Practice');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'practice');
  await expect(page.locator('#session-title')).not.toHaveText('Measure the change');
});

test('a clear in another tab replaces a retest waiting here with a practice test', async ({ page, context, supabase }) => {
  await ownClock(page);
  await withHistory(page, supabase, 'clear-elsewhere@stilltype.test');
  await waiting(page, 'retest');
  await openView(page, 'Practice');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  const other = await context.newPage();
  await supabase.attach(other);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await clearFrom(other);
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'practice');
  await expect(page.locator('#session-title')).not.toHaveText('Measure the change');
});

test('a clear here leaves a waiting drill to stand alone, with no retest after it', async ({ page, supabase }) => {
  await ownClock(page);
  await withHistory(page, supabase, 'clear-drill@stilltype.test');
  await waiting(page, 'drill');
  await clearFrom(page);
  await openView(page, 'Practice');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await expect(page.locator('#session-description')).toHaveText('Standalone drill.');
  await typeIntoDrill(page);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
});

async function typeIntoDrill(page) {
  await page.locator('#typing-input').focus();
  await page.keyboard.type((await passageText(page)).slice(0, 4));
  await page.clock.fastForward(31_000);
}
