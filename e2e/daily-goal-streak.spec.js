import { CORPUS_VERSION, METRIC_VERSION } from '../src/typing.js';
import { dayKey, goalMinutes } from '../src/insights.js';
import { test, expect, openApp, chooseWords, completePassage, openView, openProgressView, openSettings, signInWithEmail, typeInto, chooseMore, chooseSetting, phone } from './fixtures.js';

// The current streak and today's minutes, in the practice figures under the calendar.
const streakFigure = (page) => page.locator('#practice-stats .progress-figure').filter({ has: page.locator('dt', { hasText: /^Current streak$/ }) });
async function expectStreak(page, days, today) {
  await expect(streakFigure(page).locator('.figure-value')).toHaveText(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (today) await expect(streakFigure(page).locator('.figure-note')).toHaveText(today);
}

test('daily goal line and practice calendar render on Progress', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await openSettings(page);
  await chooseSetting(page, 'daily-goal', '5');
  await page.keyboard.press('Escape');
  await chooseWords(page, 10);
  await completePassage(page);
  await openView(page, 'Progress');
  await openProgressView(page, 'Practice');
  await expect(page.locator('#practice-goal')).toBeVisible();
  await expect(streakFigure(page).locator('.figure-note')).toHaveText(/^today (<1|\d+) of 5 min$/);
  const days = page.locator('#goal-calendar .goal-day');
  expect(await days.count()).toBeGreaterThanOrEqual(17 * 7 + 1);
  const today = days.last();
  await expect(today).toHaveAttribute('data-level', '1');
  // Under the 5-minute goal: no goal-met mark.
  await expect(today).not.toHaveAttribute('data-goal', 'met');
  // The caption is visual only and stays empty until a day is focused or hovered (today's minutes sit in the figures under it).
  const caption = page.locator('#goal-caption');
  await expect(caption).toHaveAttribute('aria-hidden', 'true');
  await expect(caption).toHaveText('');
  // One tab stop; arrows move a day (up/down) or a week (left/right), and each day says what it holds.
  await expect(page.locator('#goal-calendar [tabindex="0"]')).toHaveCount(1);
  await expect(today).toHaveAttribute('tabindex', '0');
  await today.focus();
  await expect(caption).toHaveText(/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} · (<1|\d+) min$/);
  await page.keyboard.press('ArrowLeft');
  const weekAgo = days.nth((await days.count()) - 8);
  await expect(weekAgo).toBeFocused();
  await expect(weekAgo).toHaveAttribute('aria-label', /^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}: 0 min$/);
  // The caption follows focus and uses the label's words, shortened.
  const [weekday, month, date] = (await weekAgo.getAttribute('aria-label')).match(/^([A-Z][a-z]{2})[a-z]*, ([A-Z][a-z]{2})[a-z]* (\d{1,2}):/).slice(1);
  await expect(caption).toHaveText(`${weekday}, ${month} ${date} · 0 min`);
  // Hover shows the hovered day; leaving the calendar returns to the focused one, and blurring clears it.
  await days.nth(3).hover();
  await expect(caption).toHaveText(/^Wed, [A-Z][a-z]{2} \d{1,2} · 0 min$/);
  await page.mouse.move(1200, 700);
  await expect(caption).toHaveText(`${weekday}, ${month} ${date} · 0 min`);
  await weekAgo.evaluate((cell) => cell.blur());
  await expect(caption).toHaveText('');
  await weekAgo.focus();
  // Up and down stay inside the drawn week column, Sunday at the top and Saturday at the bottom.
  await page.keyboard.press('Home');
  await expect(days.first()).toBeFocused();
  await expect(days.first()).toHaveAttribute('aria-label', /^Sunday, /);
  await page.keyboard.press('ArrowUp');
  await expect(days.first()).toBeFocused();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowDown');
  await expect(days.nth(6)).toBeFocused();
  await expect(days.nth(6)).toHaveAttribute('aria-label', /^Saturday, /);
  await page.keyboard.press('ArrowDown');
  await expect(days.nth(6)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(days.nth(13)).toBeFocused();
  await expect(days.nth(13)).toHaveAttribute('aria-label', /^Saturday, /);
  await page.keyboard.press('ArrowDown');
  await expect(days.nth(13)).toBeFocused();
  await expect(page.locator('#goal-calendar [tabindex="0"]')).toHaveCount(1);
});

// Ten weeks of plausible practice for a signed-in profile: 60s timed tests drifting from the low 60s
// toward the low 90s, a few long days past the 10-minute goal, and the last five days all meeting it.
function seededHistory(now = new Date()) {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const conditions = { mode: 'time', count: null, duration: 60, punctuation: false, quoteLength: null,
    difficulty: null, wordList: '1k', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
    language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };
  const plan = new Map([[0, 11], [1, 12], [2, 10.5], [3, 14], [4, 11], [9, 6], [12, 11], [16, 3]]);
  for (let back = 5; back < 70; back += 1) if (!plan.has(back) && random() < 0.42) plan.set(back, 1 + random() * (random() < 0.15 ? 14 : 7));
  const runs = [];
  for (const [back, minutes] of [...plan].sort((a, b) => b[0] - a[0])) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 19, 5);
    let left = minutes * 60;
    while (left > 15) {
      const seconds = Math.min(left, [30, 45, 60, 60, 90, 120][Math.floor(random() * 6)]);
      const wpm = Math.round(Math.min(95, Math.max(60, 64 + (70 - back) * 0.36 + (random() - 0.5) * 10)));
      day.setSeconds(day.getSeconds() + seconds + 20 + Math.floor(random() * 90));
      const id = `seed-${runs.length}`;
      runs.push({ id, at: day.toISOString(), kind: 'test', status: 'complete', conditions, textId: id, fresh: true,
        interrupted: false, score: { wpm, accuracy: 93 + Math.floor(random() * 7) }, elapsedMs: seconds * 1000,
        errors: Math.floor(random() * 6), target: null, challengeDate: null, patterns: [] });
      left -= seconds;
    }
  }
  return runs;
}

test('Progress screenshots with ten weeks of seeded history', async ({ page, supabase }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const user = supabase.addUser('streak@stilltype.test');
  const runs = seededHistory();
  supabase.profiles.set(user.id, { data: { version: 2, preferences: { dailyGoal: 10 }, attempts: [], runs, loops: [],
    seenTextIds: runs.map((r) => r.textId), bests: {}, updatedAt: runs.at(-1).at } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openSettings(page);
  await chooseSetting(page, 'daily-goal', '10');
  await page.keyboard.press('Escape');
  await openView(page, 'Progress');
  await openProgressView(page, 'Practice');
  await expectStreak(page, 5, /^today \d+ of 10 min$/);

  // Goal-met days carry a mark beyond colour: the attribute, the label's words and an accent-ink centre dot.
  const days = page.locator('#goal-calendar .goal-day');
  const today = days.last();
  await expect(today).toHaveAttribute('data-goal', 'met');
  await expect(today).toHaveAttribute('aria-label', /, goal met$/);
  await expect(page.locator('#goal-calendar .goal-day[data-goal="met"]:not([data-level="3"]):not([data-level="4"])')).toHaveCount(0);
  await expect(page.locator('#goal-calendar .goal-day[data-level="3"]:not([data-goal="met"]), #goal-calendar .goal-day[data-level="4"]:not([data-goal="met"])')).toHaveCount(0);
  const dot = (cell) => cell.evaluate((node) => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = 'var(--accent-ink)';
    const ink = getComputedStyle(probe).color;
    probe.remove();
    const after = getComputedStyle(node, '::after');
    return { content: after.content, width: after.width, background: after.backgroundColor, ink };
  });
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    const met = await dot(today);
    expect(met.content, theme).toBe('""');
    expect(met.width, theme).toBe('4px');
    expect(met.background, theme).toBe(met.ink);
  }
  expect((await dot(days.first())).content).toBe('none');

  // Focus today from the keyboard (End) so the screenshots show the caption and the focus ring.
  await today.focus();
  await page.keyboard.press('End');
  await expect(today).toBeFocused();
  await expect(page.locator('#goal-caption')).toHaveText(/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} · \d+ min · goal met$/);

  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.mouse.move(640, 300);
    await page.waitForTimeout(600);
    // Committed docs are rewritten only on request (SCREENSHOTS=1); a normal run keeps its captures in test output.
    const name = `progress-${theme}.png`;
    await page.screenshot({ path: process.env.SCREENSHOTS ? `docs/screenshots/daily-goal-streak/${name}` : testInfo.outputPath(name) });
  }
});

test('the calendar and its longest caption fit a 320px screen', async ({ page, supabase }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const user = supabase.addUser('narrow@stilltype.test');
  const runs = seededHistory();
  supabase.profiles.set(user.id, { data: { version: 2, preferences: { dailyGoal: 10 }, attempts: [], runs, loops: [],
    seenTextIds: runs.map((r) => r.textId), bests: {}, updatedAt: runs.at(-1).at } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openSettings(page);
  await chooseSetting(page, 'daily-goal', '10');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 320, height: 640 });
  await openView(page, 'Progress');
  await openProgressView(page, 'Practice');
  const days = page.locator('#goal-calendar .goal-day');
  const longest = await days.evaluateAll((cells) => cells.reduce((best, cell, i) => (cell.dataset.caption.length > cells[best].dataset.caption.length ? i : best), 0));
  await days.nth(longest).focus();
  await expect(page.locator('#goal-caption')).toHaveText(/ · goal met$/);
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  for (const selector of ['#goal-calendar', '#goal-caption', '#practice-stats']) {
    const box = await page.locator(selector).boundingBox();
    expect(box.x, selector).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, selector).toBeLessThanOrEqual(width);
  }
  // The caption stays on its one reserved line.
  const { height, line } = await page.locator('#goal-caption').evaluate((node) => ({ height: node.getBoundingClientRect().height, line: parseFloat(getComputedStyle(node).lineHeight) }));
  expect(height).toBeLessThanOrEqual(line + 1);
  await page.locator('#practice-goal').screenshot({ path: testInfo.outputPath('progress-goal-320.png') });
});

// Custom text is never compared, and drills aren't trend runs, but both are real practice: their minutes
// count toward the goal and streak, while they add no trend point.
test('drills and a custom text run count toward daily practice but not the trend', async ({ page, supabase }) => {
  const user = supabase.addUser('drills@stilltype.test');
  const yesterday = (at) => new Date(Date.parse(at) - 86400000).toISOString();
  const runs = seededHistory().slice(-3).map((run) => ({ ...run, kind: 'drill', at: yesterday(run.at) }));
  supabase.profiles.set(user.id, { data: { version: 2, preferences: {}, attempts: [], runs, loops: [],
    seenTextIds: [], bests: {}, updatedAt: runs.at(-1).at } });
  const text = 'the quick brown fox jumps over the lazy dog';
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Progress');
  await expectStreak(page, 1);
  await expect(page.locator(`#goal-calendar .goal-day[data-day="${dayKey(runs.at(-1).at)}"]`)).not.toHaveAttribute('data-level', '0');
  await expect(page.locator('#goal-calendar .goal-day').last()).toHaveAttribute('data-level', '0');
  await expect(page.locator('#progress-empty')).toBeVisible();
  await expect(page.locator('#progress-empty-title')).toHaveText('No speed trend yet.');
  await expect(page.locator('#progress-empty-copy')).toHaveText('Finish a practice run to chart speed and accuracy.');
  await openView(page, 'Practice');
  await chooseMore(page, 'mode-custom');
  await page.locator('#custom-text').fill(text);
  await page.locator('#custom-use').click();
  await typeInto(page, text);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await openView(page, 'Progress');
  await expect(page.locator('#practice-goal')).toBeVisible();
  await expectStreak(page, 2, /^today (<1|\d+) min$/);
  await expect(page.locator('#goal-calendar .goal-day').last()).toHaveAttribute('data-level', '1');
  await expect(page.locator('#progress-content')).toBeHidden();
  await expect(page.locator('#progress-empty-title')).toHaveText('No speed trend yet.');
});

// A client from before the calendar keeps practiceDays as an unknown field when it clears history, so a synced
// profile can hold archived practice days and no runs. That is still history: both clear entry points offer it,
// clearing removes the calendar, and Undo brings it back.
test('archived practice days alone can be cleared from Progress or the palette, and Undo restores them', async ({ page, supabase }) => {
  const user = supabase.addUser('archive@stilltype.test');
  const now = new Date();
  const back = (days) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
  const practiceDays = { [back(2)]: 12 * 60000, [back(3)]: 4 * 60000, [back(9)]: 7 * 60000 };
  supabase.profiles.set(user.id, { data: { version: 2, preferences: {}, attempts: [], runs: [], practiceDays, loops: [],
    seenTextIds: [], bests: {}, updatedAt: now.toISOString() } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Progress');
  const practised = page.locator('#goal-calendar .goal-day:not([data-level="0"])');
  await expect(page.locator('#practice-goal')).toBeVisible();
  await expect(practised).toHaveCount(3);
  await expect(page.locator('#clear-history')).toBeVisible();
  await expect(page.locator('#clear-history')).toBeEnabled();
  // The palette lists only enabled commands, so finding this one means it is offered.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('clear local history');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('clear local history');
  await page.keyboard.press('Enter');
  await expect(page.locator('#clear-dialog')).toBeVisible();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(page.locator('#practice-goal')).toBeHidden();
  await expect(page.locator('#clear-history')).toBeHidden();
  await page.locator('#undo-clear').click();
  await expect(page.locator('#practice-goal')).toBeVisible();
  await expect(practised).toHaveCount(3);
  await expect(page.locator('#clear-history')).toBeEnabled();
});

// A pre-accounts profile can hold more runs than the summary window. Normalizing it archives the oldest runs'
// time per day, and that archive must reach the first account with the runs, or the calendar loses those days.
test('a pre-accounts profile past the summary limit brings its archived practice days into the account', async ({ page, supabase }) => {
  const user = supabase.addUser('legacy-days@stilltype.test');
  const now = new Date();
  const back = (days) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, 19, 5);
  const conditions = { mode: 'time', count: null, duration: 60, punctuation: false, quoteLength: null,
    difficulty: null, wordList: '1k', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
    language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };
  const record = (id, at, seconds) => ({ id, at: at.toISOString(), kind: 'test', status: 'complete', conditions, textId: id,
    fresh: true, interrupted: false, score: { wpm: 72, accuracy: 96 }, elapsedMs: seconds * 1000, errors: 2, target: null,
    challengeDate: null, patterns: [] });
  // Twelve one-minute runs twenty days ago, then the newest 1,000 (fifteen seconds each) over the last ten days.
  const runs = [
    ...Array.from({ length: 12 }, (_, i) => record(`old-${i}`, new Date(back(20).getTime() + i * 90000), 60)),
    ...Array.from({ length: 1000 }, (_, i) => record(`new-${i}`, new Date(back(10 - Math.floor(i / 100)).getTime() + (i % 100) * 30000), 15)),
  ];
  await page.addInitScript((profile) => {
    if (sessionStorage.getItem('e2e-seeded')) return;
    sessionStorage.setItem('e2e-seeded', '1');
    localStorage.setItem('stilltype-profile-v2', JSON.stringify(profile));
  }, { version: 2, profileId: 'legacy', preferences: {}, attempts: [], runs, loops: [], seenTextIds: [], bests: {} });

  await openApp(page);
  await signInWithEmail(page, user.email);
  await expect.poll(() => supabase.profileFor(user.email)?.runs?.length).toBe(1000);
  expect(supabase.profileFor(user.email).practiceDays).toEqual({ [dayKey(back(20))]: 12 * 60000 });
  await openView(page, 'Progress');
  const days = page.locator('#goal-calendar .goal-day');
  const archived = days.nth((await days.count()) - 1 - 20);
  await expect(archived).toHaveAttribute('aria-label', /: 12 min$/);
  await expect(archived).not.toHaveAttribute('data-level', '0');
});


test('recorded lessons and composing active time increase the daily practice goal without entering measured runs', async ({ page, supabase }) => {
  test.setTimeout(90000);
  const user = supabase.addUser('learning-goal@stilltype.test');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openSettings(page);
  await chooseSetting(page, 'daily-goal', '5');
  await page.keyboard.press('Escape');
  await page.clock.install({ time: new Date('2026-10-15T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-15T12:00:01Z'));
  const totals = () => Object.values(supabase.profiles.get(user.id)?.data.practiceDays || {}).reduce((sum, ms) => sum + ms, 0);
  const typePaced = async (selector, text, gap) => {
    await page.locator(selector).focus();
    for (const letter of text) {
      await page.keyboard.type(letter);
      await page.clock.runFor(gap);
    }
  };
  await chooseMore(page, 'open-lessons');
  await page.locator('#lesson-primary').click();
  const lessonText = await page.locator('#accessible-passage').textContent();
  await typePaced('#typing-input', lessonText, 250);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'learn');
  await page.clock.runFor(1800);
  await expect.poll(totals).toBeGreaterThan(0);
  const lessonMs = totals();
  await openView(page, 'Progress');
  await expectStreak(page, 0, `today ${goalMinutes(lessonMs / 60000)} of 5 min`);
  await openView(page, 'Practice');
  await chooseMore(page, 'mode-compose');
  await typePaced('#compose-input', 'A few sentences of my own are still typing practice, and their active time belongs in the goal.', 400);
  await page.locator('#compose-done').click();
  await expect(page.locator('#compose-result')).toBeVisible();
  await page.clock.runFor(1800);
  await expect.poll(totals).toBeGreaterThan(lessonMs);
  const saved = supabase.profiles.get(user.id).data;
  expect(totals()).toBe(lessonMs + saved.compositions[0].activeMs);
  expect(saved.runs).toEqual([]);
  expect(saved).not.toHaveProperty('attempts');
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith('stilltype-profile-v2:')))).attempts))).toEqual([]);
  expect(saved.bests).toEqual({});
  await openView(page, 'Progress');
  await expectStreak(page, 0, `today ${goalMinutes(totals() / 60000)} of 5 min`);
});


test.describe('calendar on a touch device', () => {
  test.use({ viewport: { width: 320, height: 640 }, ...phone });
  test('the native day picker owns selection and keeps the dense picture out of the tab order', async ({ page }) => {
    await openApp(page);
    await openView(page, 'Progress');
    await expect(page.locator('#practice-goal')).toBeHidden();
    await openView(page, 'Practice');
    await chooseWords(page, 10);
    await completePassage(page);
    await openView(page, 'Progress');
    await openProgressView(page, 'Practice');
    const picker = page.getByLabel('Practice day', { exact: true });
    await expect(picker).toBeVisible();
    expect((await picker.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('#goal-calendar')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#goal-calendar [tabindex]')).toHaveCount(0);
    const first = await picker.locator('option').first().getAttribute('value');
    await picker.focus();
    await picker.selectOption(first);
    await expect(page.locator('#goal-caption')).toHaveText(/^Sun, [A-Z][a-z]{2} \d{1,2} · 0 min$/);
    // Keyboard selection remains available on a hybrid; no tiny calendar cell becomes a target.
    await picker.press('ArrowDown');
    await expect(page.locator('#goal-caption')).toHaveText(/^Mon, [A-Z][a-z]{2} \d{1,2} · 0 min$/);
    await expect(picker).toBeFocused();
    await expect(page.locator('#goal-calendar [tabindex]')).toHaveCount(0);
  });
});
