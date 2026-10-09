// Race your best: a ghost caret replays the best run's recorded keystrokes on its exact text. The race
// repeats seen text, so it is never a best, a fresh comparison or pattern evidence.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CORPUS_VERSION, METRIC_VERSION, completeAttempt, conditionKey, createAttempt } from '../src/typing.js';
import { runRecord } from '../src/insights.js';
import { test, expect, openApp, openView, chooseWords, completePassage, passageText, typeInto, signInWithEmail } from './fixtures.js';

const words10 = { mode: 'words', count: 10, duration: null, punctuation: false, quoteLength: null, difficulty: null,
  wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };
const TEXT = 'the cat sat on the mat and the dog ran';

// A best typed at one key every `step` ms, so the ghost's position at any moment is known exactly.
function bestTrace(id, { text = TEXT, step = 200, conditions = words10, endedAt } = {}) {
  const attempt = createAttempt({ id, text, textId: `generated-${id}`, conditions });
  attempt.startedAt = 0;
  attempt.events = [...text].map((char, position) => ({ type: 'insert', text: char, position, accepted: true, offsetMs: position * step }));
  return { ...completeAttempt(attempt, { endedAt: endedAt ?? (text.length - 1) * step }), at: '2026-10-01T12:00:00Z', fresh: true };
}

function seedBest(supabase, email, best, { traceKept = true } = {}) {
  const user = supabase.addUser(email);
  supabase.profiles.set(user.id, { data: { version: 2, preferences: {}, attempts: traceKept ? [best] : [],
    runs: [runRecord(best)], loops: [], seenTextIds: [best.textId],
    bests: { [conditionKey(best.conditions)]: { wpm: best.summary.score.wpm, attemptId: best.id, at: best.at } },
    updatedAt: '2026-10-01T12:00:00Z' } });
  return user;
}

const cachedProfile = (page, id) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `stilltype-profile-v2:${id}`);
const left = (locator) => locator.evaluate((node) => node.getBoundingClientRect().left);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// Stop the fake clock a moment from now, so the race's first key and the ghost's frames share one timeline.
async function pauseClock(page) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 1000));
}

test('the run card offers a race of your best; the race is labelled, never counted, and offers Race again', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  const original = await completePassage(page);
  const bestCopy = await page.locator('#best').textContent();
  await expect(page.locator('#race-best')).toBeVisible();

  await page.locator('#race-best').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'ghost-race');
  await expect(page.locator('#session-title')).toHaveText('Race your best');
  await expect(page.locator('#session-description')).toContainText('The ghost caret replays your');
  await expect(page.locator('#session-description')).toContainText('Not counted');
  await expect(page.locator('#condition-line')).toContainText('race your best · repeated text · not counted · english 200 · 10 words');
  await expect(page.locator('.practice-controls')).toBeHidden();
  expect(await passageText(page)).toBe(original);
  await expect(page.locator('#text-display .ghost-caret')).not.toHaveClass(/is-hidden/);

  await completePassage(page);
  await expect(page.locator('#result-delta')).toHaveText(/^Finished (\d+\.\d s (ahead of|behind)|level with) your best$/);
  await expect(page.locator('#result-comparison-note')).toContainText(/\d+ vs \d+ wpm · \d+% vs \d+% accuracy, same passage and conditions\. Not counted/);
  await expect(page.locator('#run-card-stamp')).toContainText('race your best · not counted');
  await expect(page.locator('#result-conditions')).toContainText('not counted');
  await expect(page.locator('#race-best')).toBeHidden();
  await expect(page.locator('#run-again')).toHaveText('Race again');
  await expect(page.locator('#run-again')).toBeFocused();
  await expect(page.locator('#best')).toHaveText(bestCopy);

  // Progress shows only the practice run; the race isn't a trend point.
  await openView(page, 'Progress');
  await expect(page.locator('#run-history .run-row')).toHaveCount(1);
  await expect(page.locator('#progress-race-start')).toBeVisible();

  // The palette races the best for the conditions on screen; Escape restarts the same race.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('race your best');
  await expect(page.locator('#palette-list [role="option"]').first()).toContainText('race your best');
  await page.keyboard.press('Enter');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'ghost-race');
  await typeInto(page, original.slice(0, 3));
  await page.keyboard.press('Escape');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'ghost-race');
  await expect(page.locator('#typing-input')).toHaveValue('');
  expect(await passageText(page)).toBe(original);

  // Back in practice the race's ghost is gone (a disarmed ghost must not reappear at the start).
  await openView(page, 'Practice');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'practice');
  await expect(page.locator('#text-display .ghost-caret')).toHaveClass(/is-hidden/);
});

test('the ghost replays the recorded best keystroke by keystroke and only a summary is kept', async ({ page, supabase }) => {
  await page.clock.install({ time: new Date('2026-10-02T12:00:00Z') });
  const best = bestTrace('best');
  const user = seedBest(supabase, 'ghost@stilltype.test', best);
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Progress');
  await expect(page.locator('#progress-race-copy')).toContainText(`Your best here is ${best.summary.score.wpm} wpm`);
  await page.locator('#progress-race-start').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'ghost-race');
  await expect(page.locator('#accessible-passage')).toHaveText(TEXT);
  await expect(page.locator('#condition-line')).toContainText('10 words');

  const ghost = page.locator('#text-display .ghost-caret');
  const char = (index) => page.locator('#text-display .char').nth(index);
  await pauseClock(page);
  await typeInto(page, 't');
  // The best pressed a key every 200 ms: 1.1 s after the first key it stood after six characters.
  await page.clock.runFor(1100);
  expect(Math.abs(await left(ghost) - await left(char(6)))).toBeLessThan(1);
  await page.clock.runFor(1000);
  expect(Math.abs(await left(ghost) - await left(char(11)))).toBeLessThan(1);

  await typeInto(page, TEXT.slice(1));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  // Best: 7.4 s. Race: every remaining key at 2.1 s.
  await expect(page.locator('#result-delta')).toHaveText('Finished 5.3 s ahead of your best');
  await expect(page.locator('#result-comparison-note')).toContainText(`vs ${best.summary.score.wpm} wpm · 100% vs 100% accuracy`);
  await expect(page.locator('#best')).toHaveText(`Best · ${best.summary.score.wpm} wpm`);

  const saved = await cachedProfile(page, user.id);
  expect(saved.attempts.map((a) => a.id)).toEqual(['best']);
  expect(saved.runs.at(-1)).toMatchObject({ kind: 'ghost-race', status: 'complete', fresh: false, textId: best.textId, patterns: [] });
  expect(saved.bests[conditionKey(words10)]).toMatchObject({ attemptId: 'best', wpm: best.summary.score.wpm });

  await page.locator('#run-again').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'ghost-race');
  await expect(ghost).not.toHaveClass(/is-hidden/);
});

test('a timed race ends on the same clock and compares how far each caret got', async ({ page, supabase }) => {
  await page.clock.install({ time: new Date('2026-10-02T12:00:00Z') });
  const timed = { ...words10, mode: 'time', duration: 15, count: null };
  const text = Array(16).fill('the cat sat on').join(' ');
  // 60 keys in 15 s, one every 250 ms.
  const best = bestTrace('timed', { text, step: 250, conditions: timed, endedAt: 15000 });
  best.events = best.events.filter((event) => event.offsetMs < 15000);
  Object.assign(best, completeAttempt(best, { endedAt: 15000 }));
  const user = seedBest(supabase, 'timed@stilltype.test', best);
  await openApp(page);
  await signInWithEmail(page, user.email);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('race your best');
  // The palette uses the current practice settings (30 s), where there is no best yet.
  await expect(page.locator('#palette-list [role="option"]').first()).toContainText('unavailable');
  await page.keyboard.press('Escape');
  await openView(page, 'Progress');
  await page.locator('#progress-race-start').click();
  await expect(page.locator('#condition-line')).toContainText('15 s');

  await pauseClock(page);
  await typeInto(page, text.slice(0, 20));
  await page.clock.runFor(15100);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('40 characters behind your best at 15 s');
});

test('without the best’s keystrokes the race says plainly why it is unavailable', async ({ page, supabase }) => {
  const best = bestTrace('old-best');
  const user = seedBest(supabase, 'evicted@stilltype.test', best, { traceKept: false });
  await openApp(page);
  // A guest with no best: the palette says so instead of starting anything.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('race your best');
  await expect(page.locator('#palette-list [role="option"]').first()).toContainText('unavailable');
  await page.keyboard.press('Enter');
  await expect(page.locator('#race-toast')).toBeVisible();
  await expect(page.locator('#race-feedback')).toHaveText('No best at these conditions yet. Finish a practice run to set one, then race it.');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'practice');

  await signInWithEmail(page, user.email);
  await openView(page, 'Progress');
  await expect(page.locator('#progress-race-copy')).toHaveText(`Your best here is ${best.summary.score.wpm} wpm. It can’t be raced: its keystrokes are no longer kept (only your newest 24 runs keep them).`);
  await expect(page.locator('#progress-race-start')).toBeHidden();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('race your best');
  await page.keyboard.press('Enter');
  await expect(page.locator('#race-feedback')).toHaveText(`Your ${best.summary.score.wpm} wpm best can’t be raced: its keystrokes are no longer kept (only your newest 24 runs keep them). Set a new best to race it.`);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'progress');
});

test('under reduced motion the ghost stays hidden and the finish is still compared', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await page.locator('#race-best').click();
  await expect(page.locator('#session-description')).toContainText('Reduced motion is on, so its ghost stays hidden; the finish is still compared.');
  await expect(page.locator('#text-display .ghost-caret')).toHaveClass(/is-hidden/);
  await typeInto(page, (await passageText(page)).slice(0, 2));
  await expect(page.locator('#text-display .ghost-caret')).toHaveClass(/is-hidden/);
});

test('an interrupted race is not compared with the best', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await page.locator('#race-best').click();
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 4));
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await typeInto(page, text.slice(4));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Interrupted · not counted');
  await expect(page.locator('#result-comparison-note')).not.toContainText(' vs ');
});

test.describe('narrow phone', () => {
  test.use({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });

  test('the card offer, the race and Progress fit at 320px', async ({ page }) => {
    await openApp(page);
    await chooseWords(page, 10);
    // A human pace keeps the score to two digits (see layout.spec.js).
    await typeInto(page, await passageText(page), '#typing-input', { delay: 200 });
    await expect(page.locator('#race-best')).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.locator('#race-best').click();
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'ghost-race');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await openView(page, 'Progress');
    await expect(page.locator('#progress-race-start')).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});

// Screenshots: a best and a race typed at a human pace (about 80–100 wpm), mid-race and at the end.
const shots = fileURLToPath(new URL('../docs/screenshots/race-your-best/', import.meta.url));
const shot = (testInfo, name) => {
  if (!process.env.SCREENSHOTS) return testInfo.outputPath(name);
  mkdirSync(shots, { recursive: true });
  return `${shots}${name}`;
};

// Dark: the race outpaces the best, so its ghost trails behind. Light: the best was quicker and its ghost leads.
for (const [label, scheme, viewport, bestDelay, raceDelay] of [
  ['dark', 'dark', { width: 1280, height: 800 }, 150, 115],
  ['light', 'light', { width: 1280, height: 800 }, 115, 145],
  ['mobile', 'dark', { width: 390, height: 844 }, 150, 115],
]) {
  test.describe(`screenshots · ${label}`, () => {
    test.use({ colorScheme: scheme, viewport });

    test(`race and result at a human pace (${label})`, async ({ page }, testInfo) => {
      test.slow();
      await openApp(page);
      await chooseWords(page, 10);
      await typeInto(page, await passageText(page), '#typing-input', { delay: bestDelay });
      await expect(page.locator('#race-best')).toBeVisible();
      if (label === 'mobile') {
        await page.waitForTimeout(600);
        await page.screenshot({ path: shot(testInfo, `card-${label}.png`) });
      }
      await page.locator('#race-best').click();
      const text = await passageText(page);
      const half = text.lastIndexOf(' ', Math.floor(text.length * 0.55)) + 3;
      await typeInto(page, text.slice(0, half), '#typing-input', { delay: raceDelay });
      await expect(page.locator('#text-display .ghost-caret')).not.toHaveClass(/is-hidden/);
      await page.screenshot({ path: shot(testInfo, `race-${label}.png`) });
      await typeInto(page, text.slice(half), '#typing-input', { delay: raceDelay });
      await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
      await page.waitForTimeout(600);
      if (label === 'mobile') await page.locator('#results-heading').evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.screenshot({ path: shot(testInfo, `result-${label}.png`) });
      if (label === 'mobile') return;
      await openView(page, 'Progress');
      await page.mouse.move(0, 0);
      await page.screenshot({ path: shot(testInfo, `progress-${label}.png`) });
    });
  });
}
