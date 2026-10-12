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

// Another device wrote the account row after this one cached it: a different best, or no history at all.
// traceKept false: the same best, whose keystrokes slower runs there have pushed out of the kept traces.
async function newerAccountRow(page, supabase, user, best = null, { traceKept = true } = {}) {
  const cachedAt = (await cachedProfile(page, user.id)).updatedAt;
  supabase.profiles.set(user.id, { data: { version: 2, preferences: {}, attempts: best && traceKept ? [best] : [],
    runs: best ? [runRecord(best)] : [], loops: [], seenTextIds: best ? [best.textId] : [],
    bests: best ? { [conditionKey(best.conditions)]: { wpm: best.summary.score.wpm, attemptId: best.id, at: best.at } } : {},
    updatedAt: new Date(Date.parse(cachedAt) + 60000).toISOString() } });
}

// Reloads with the account row's fetch held, so a race can start on this device's cached copy before
// the sync on load finishes. Returns the function that lets the fetch through.
async function reloadHoldingAccountRow(page) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route(/\.supabase\.co\/rest\/v1\/profiles/, async (route) => {
    if (route.request().method() === 'GET') await gate;
    await route.fallback();
  });
  await page.reload();
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'syncing');
  return release;
}

const OTHER_TEXT = 'a red fox ran up the hill to see me';
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
  // The best's passage is often not the one just typed, so the name never says "the same passage".
  await expect(page.locator('#race-best')).toHaveAttribute('aria-label', /^Race your best, \d+ wpm, on its own passage$/);

  await page.locator('#race-best').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'ghost-race');
  await expect(page.locator('#session-title')).toHaveText('Race your best');
  // The caveat is said once on this screen, in the description; the condition line names the text.
  await expect(page.locator('#session-description')).toHaveText(/^A ghost caret replays your \d+ wpm best from \w+ \d+, keystroke by keystroke\. Not counted\.$/);
  await expect(page.locator('#condition-line')).toContainText('race your best · repeated text · english 200 · 10 words');
  await expect(page.locator('#condition-line')).not.toContainText('not counted');
  await expect(page.locator('.practice-controls')).toBeHidden();
  expect(await passageText(page)).toBe(original);
  const ghost = page.locator('#text-display .ghost-caret');
  await expect(ghost).not.toHaveClass(/is-hidden/);
  // Solid, not the pacer's 70%: the light periwinkle at 70% is under 3:1 on paper.
  await expect(ghost).toHaveCSS('opacity', '1');

  await completePassage(page);
  await expect(page.locator('#result-delta')).toHaveText(/^Finished (\d+\.\d s (ahead of|behind)|level with) your best$/);
  await expect(page.locator('#result-comparison-note')).toContainText(/\d+ vs \d+ wpm · \d+% vs \d+% accuracy, same passage and conditions\. Not counted/);
  // Said once on results too, in the note beside the headline.
  await expect(page.locator('#run-card-stamp')).toHaveText(/ · race your best$/);
  await expect(page.locator('#result-conditions')).toContainText('race your best · repeated text · english 200 · 10 words');
  await expect(page.locator('#result-conditions')).not.toContainText('not counted');
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
  await expect(page.locator('#condition-line')).toContainText('physical keyboard');
  await typeInto(page, original.slice(0, 3));
  await page.keyboard.press('Escape');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'ghost-race');
  await expect(page.locator('#typing-input')).toHaveValue('');
  expect(await passageText(page)).toBe(original);
  // The palette's restart (hint esc) restarts the same race too, rather than dropping to practice.
  await typeInto(page, original.slice(0, 3));
  await page.keyboard.press('Control+k');
  await page.keyboard.type('restart test');
  await page.keyboard.press('Enter');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'ghost-race');
  await expect(page.locator('#typing-input')).toHaveValue('');
  await expect(page.locator('#typing-input')).toBeFocused();
  expect(await passageText(page)).toBe(original);

  // Back in practice the race's ghost is gone (a disarmed ghost must not reappear at the start).
  await openView(page, 'Practice');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'practice');
  await expect(page.locator('#text-display .ghost-caret')).toHaveClass(/is-hidden/);
});

test('the palette restart elsewhere goes to practice once, without marking a second passage seen', async ({ page, supabase }) => {
  const user = supabase.addUser('restart@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, user.email);
  await chooseWords(page, 10);
  await completePassage(page);
  const seen = (await cachedProfile(page, user.id)).seenTextIds.length;
  await page.keyboard.press('Control+k');
  await page.keyboard.type('restart test');
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'practice');
  await expect(page.locator('#typing-input')).toBeFocused();
  await expect.poll(async () => (await cachedProfile(page, user.id)).seenTextIds.length).toBe(seen + 1);
});

test('a race at other conditions leaves the drill and retest on the baseline’s conditions', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  // The 25-word run becomes the baseline for the drill and retest.
  await page.locator('#run-again').click();
  await chooseWords(page, 25);
  await completePassage(page);
  await expect(page.locator('#recommendation-meta')).toHaveText('About 1 min, then a fresh 25-word retest.');

  await openView(page, 'Progress');
  const key = await page.locator('#progress-conditions option').evaluateAll((options) => options.find((o) => o.textContent.includes('10 words')).value);
  await page.locator('#progress-conditions').selectOption(key);
  await page.locator('#progress-race-start').click();
  await expect(page.locator('#condition-line')).toContainText('10 words');
  await completePassage(page);
  await expect(page.locator('#result-delta')).toHaveText(/your best$/);
  await expect(page.locator('#recommendation-meta')).toHaveText('About 1 min, then a fresh 25-word retest.');
  await page.locator('#skip-to-retest').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await expect(page.locator('#condition-line')).toContainText('25 words');
});

// Custom text is never a best, so it has no ghost to race: no offer on its run card or in the palette. A race
// is a session of its own, so starting one closes the custom editor, and the custom text waits behind Custom.
test('custom text is never raced, and a race closes the custom editor', async ({ page }) => {
  const custom = 'the quick brown fox jumps over the lazy dog';
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await expect(page.locator('#race-best')).toBeVisible();

  await openView(page, 'Practice');
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill(custom);
  await page.locator('#custom-use').click();
  await typeInto(page, custom);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#race-best')).toBeHidden();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('race');
  await expect(page.locator('#palette-list')).not.toContainText('race your best');
  await page.keyboard.press('Escape');
  await expect(page.locator('#palette')).toBeHidden();

  // Run again keeps the custom text; the editor opened over it closes when a race of the words best starts.
  await page.locator('#run-again').click();
  await expect(page.locator('#condition-line')).toContainText('custom text');
  await page.locator('#mode-custom').click();
  await expect(page.locator('#custom-options')).toBeVisible();
  await openView(page, 'Progress');
  await page.locator('#progress-race-start').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'ghost-race');
  await expect(page.locator('#custom-options')).toBeHidden();
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#condition-line')).toContainText('10 words');
  expect(await passageText(page)).not.toBe(custom);
});

test('an unavailable notice stacks above the history Undo instead of covering it', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(page.locator('#undo-clear')).toBeFocused();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('race your best');
  await page.keyboard.press('Enter');
  await expect(page.locator('#race-toast')).toBeVisible();
  await expect(page.locator('#history-toast')).toBeVisible();
  const covered = await page.locator('#undo-clear').evaluate((button) => {
    const box = button.getBoundingClientRect();
    return !button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
  });
  expect(covered).toBe(false);
  const [race, history] = await Promise.all([page.locator('#race-toast').boundingBox(), page.locator('#history-toast').boundingBox()]);
  expect(race.y + race.height).toBeLessThanOrEqual(history.y);
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

test('a newer account row arriving before the first key prepares the race again against the best it holds', async ({ page, supabase }) => {
  const cached = bestTrace('best-a');
  const user = seedBest(supabase, 'stale@stilltype.test', cached);
  await openApp(page);
  await signInWithEmail(page, user.email);
  const newer = bestTrace('best-b', { text: OTHER_TEXT, step: 150 });
  await newerAccountRow(page, supabase, user, newer);
  const release = await reloadHoldingAccountRow(page);

  // The race starts on this device's cached best while the account row is still on its way.
  await openView(page, 'Progress');
  await page.locator('#progress-race-start').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'ghost-race');
  await expect(page.locator('#accessible-passage')).toHaveText(TEXT);
  release();
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');

  // Nobody has typed yet, so it is prepared again on the adopted best's own passage, and a note says so.
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'ghost-race');
  await expect(page.locator('#accessible-passage')).toHaveText(OTHER_TEXT);
  await expect(page.locator('#session-description')).toContainText(`your ${newer.summary.score.wpm} wpm best`);
  await expect(page.locator('#race-feedback')).toHaveText(`Your account’s newer history has a different best here, so this race is now against your ${newer.summary.score.wpm} wpm best.`);
  await expect(page.locator('#text-display .ghost-caret')).not.toHaveClass(/is-hidden/);

  await typeInto(page, OTHER_TEXT);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText(/^Finished .*your best$/);
  await expect(page.locator('#result-comparison-note')).toContainText(`vs ${newer.summary.score.wpm} wpm`);
  // Only a race of the adopted best lands in the adopted profile, here and in the account row.
  const races = (profile) => profile.runs.filter((run) => run.kind === 'ghost-race').map((run) => run.textId);
  expect(races(await cachedProfile(page, user.id))).toEqual([newer.textId]);
  await expect.poll(() => races(supabase.profileFor(user.email))).toEqual([newer.textId]);
  expect(supabase.profileFor(user.email).bests[conditionKey(words10)].attemptId).toBe('best-b');
});

test('a newer account row with no best cancels a race nobody has started, with a note', async ({ page, supabase }) => {
  const user = seedBest(supabase, 'cleared@stilltype.test', bestTrace('best-a'));
  await openApp(page);
  await signInWithEmail(page, user.email);
  // History cleared on another device.
  await newerAccountRow(page, supabase, user);
  const release = await reloadHoldingAccountRow(page);

  await openView(page, 'Progress');
  await page.locator('#progress-race-start').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'ghost-race');
  await expect(page.locator('#accessible-passage')).toHaveText(TEXT);
  release();
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');

  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'practice');
  await expect(page.locator('#race-toast')).toBeVisible();
  await expect(page.locator('#race-feedback')).toHaveText('Race cancelled: your account’s newer history has no best at these conditions.');
  await expect(page.locator('#text-display .ghost-caret')).toHaveClass(/is-hidden/);
  await expect(page.locator('#accessible-passage')).not.toHaveText(TEXT);
  const saved = await cachedProfile(page, user.id);
  expect(saved.bests).toEqual({});
  expect(saved.runs.filter((run) => run.kind === 'ghost-race')).toEqual([]);
});

test('a newer account row that keeps the same best but not its keystrokes cancels a race nobody has started', async ({ page, supabase }) => {
  const best = bestTrace('best-a');
  const user = seedBest(supabase, 'evicted-later@stilltype.test', best);
  await openApp(page);
  await signInWithEmail(page, user.email);
  await newerAccountRow(page, supabase, user, best, { traceKept: false });
  const release = await reloadHoldingAccountRow(page);

  await openView(page, 'Progress');
  await page.locator('#progress-race-start').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'ghost-race');
  await expect(page.locator('#accessible-passage')).toHaveText(TEXT);
  release();
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');

  // The best is unchanged, but the race would replay keystrokes the account no longer keeps.
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'practice');
  await expect(page.locator('#race-toast')).toBeVisible();
  await expect(page.locator('#race-feedback')).toHaveText(`Race cancelled: your account’s newer history has a ${best.summary.score.wpm} wpm best here whose keystrokes are no longer kept.`);
  await expect(page.locator('#text-display .ghost-caret')).toHaveClass(/is-hidden/);
  await expect(page.locator('#accessible-passage')).not.toHaveText(TEXT);
  const saved = await cachedProfile(page, user.id);
  expect(saved.bests[conditionKey(words10)].attemptId).toBe('best-a');
  expect(saved.attempts).toEqual([]);
});

test('a race under way when a newer account row arrives runs on unchanged and is not compared with a replaced best', async ({ page, supabase }) => {
  const user = seedBest(supabase, 'midrace@stilltype.test', bestTrace('best-a'));
  await openApp(page);
  await signInWithEmail(page, user.email);
  const newer = bestTrace('best-b', { text: OTHER_TEXT, step: 150 });
  await newerAccountRow(page, supabase, user, newer);
  const release = await reloadHoldingAccountRow(page);

  await openView(page, 'Progress');
  await page.locator('#progress-race-start').click();
  await typeInto(page, TEXT.slice(0, 4));
  release();
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  // Still run: nothing about the race in progress changes.
  await expect(page.locator('#accessible-passage')).toHaveText(TEXT);
  await expect(page.locator('#typing-input')).toHaveValue(TEXT.slice(0, 4));
  await expect(page.locator('#race-toast')).toBeHidden();

  await typeInto(page, TEXT.slice(4));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Race complete · not compared');
  await expect(page.locator('#result-comparison-note')).toHaveText('Your account’s newer history arrived during the race, and the run its ghost replayed is no longer your best here, so the two aren’t compared. Not counted: you’ve typed this passage before, so it can’t set a best or count as fresh evidence.');
  // Race again races the best the account holds now.
  await page.locator('#run-again').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'ghost-race');
  await expect(page.locator('#accessible-passage')).toHaveText(OTHER_TEXT);
  // Kept as a race summary, as any race that can't be compared is: real typing on repeated text that
  // sets no best. It stores no comparison, so it claims nothing about the replaced best.
  const saved = await cachedProfile(page, user.id);
  expect(saved.runs.filter((run) => run.kind === 'ghost-race')).toHaveLength(1);
  expect(saved.bests[conditionKey(words10)].attemptId).toBe('best-b');
  expect(saved.attempts.map((attempt) => attempt.id)).toEqual(['best-b']);
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

test('reduced motion turned on hides the ghost at once, and turned off brings it back where the best has reached', async ({ page, supabase }) => {
  await page.clock.install({ time: new Date('2026-10-02T12:00:00Z') });
  const user = seedBest(supabase, 'motion@stilltype.test', bestTrace('motion'));
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Progress');
  await page.locator('#progress-race-start').click();
  const ghost = page.locator('#text-display .ghost-caret');
  const char = (index) => page.locator('#text-display .char').nth(index);
  await expect(ghost).not.toHaveClass(/is-hidden/);
  // Before the first key it hides rather than standing at the start, and the description follows.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(ghost).toHaveClass(/is-hidden/);
  await expect(page.locator('#session-description')).toContainText('Reduced motion is on, so its ghost stays hidden');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(ghost).not.toHaveClass(/is-hidden/);
  await expect(page.locator('#session-description')).toContainText('A ghost caret replays');

  await pauseClock(page);
  await typeInto(page, 't');
  await page.clock.runFor(1100);
  expect(Math.abs(await left(ghost) - await left(char(6)))).toBeLessThan(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(ghost).toHaveClass(/is-hidden/);
  await page.clock.runFor(1000);
  await expect(ghost).toHaveClass(/is-hidden/);
  // 2.25 s after the first key the best stood after twelve characters. The description changes on
  // the same media change, so the clock only moves on once the ghost has been told.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('#session-description')).toContainText('A ghost caret replays');
  await page.clock.runFor(150);
  await expect(ghost).not.toHaveClass(/is-hidden/);
  expect(Math.abs(await left(ghost) - await left(char(12)))).toBeLessThan(1);
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

test.describe('touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a race started by a tap is touch input, so a touch best is compared', async ({ page }) => {
    await openApp(page);
    await chooseWords(page, 10);
    await page.locator('#typing-input').tap();
    await expect(page.locator('#condition-line')).toContainText('touch input');
    await typeInto(page, await passageText(page));
    await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
    await expect(page.locator('#result-conditions')).toContainText('touch input');
    await page.locator('#race-best').tap();
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'ghost-race');
    await expect(page.locator('#condition-line')).toContainText('touch input');
    await typeInto(page, await passageText(page));
    await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
    await expect(page.locator('#result-delta')).toHaveText(/^Finished .*your best$/);
  });

  test('a race started by a tap on the palette row is touch input too', async ({ page }) => {
    await openApp(page);
    await chooseWords(page, 10);
    await page.locator('#typing-input').tap();
    await typeInto(page, await passageText(page));
    await expect(page.locator('#result-conditions')).toContainText('touch input');
    await page.locator('#palette-trigger').tap();
    await page.keyboard.type('race your best');
    await page.locator('#palette-list [role="option"]').first().tap();
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'ghost-race');
    await expect(page.locator('#condition-line')).toContainText('touch input');
    await typeInto(page, await passageText(page));
    await expect(page.locator('#result-delta')).toHaveText(/^Finished .*your best$/);
  });
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
