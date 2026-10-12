import { CORPUS_VERSION, METRIC_VERSION } from '../src/typing.js';
import { dayKey } from '../src/insights.js';
import { test, expect, openApp, chooseWords, completePassage, openView, openSettings, signInWithEmail, typeInto } from './fixtures.js';

test('daily goal line and practice calendar render on Progress', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await openSettings(page);
  await page.locator('#daily-goal').selectOption('5');
  await page.keyboard.press('Escape');
  await chooseWords(page, 10);
  await completePassage(page);
  await openView(page, 'Progress');
  await expect(page.locator('#practice-goal')).toBeVisible();
  await expect(page.locator('#goal-line')).toHaveText(/^Today (<1|\d+) \/ 5 min · \d+-day streak$/);
  const days = page.locator('#goal-calendar .goal-day');
  expect(await days.count()).toBeGreaterThanOrEqual(17 * 7 + 1);
  const today = days.last();
  await expect(today).toHaveAttribute('data-level', '1');
  // Under the 5-minute goal: no goal-met mark.
  await expect(today).not.toHaveAttribute('data-goal', 'met');
  // The caption is visual only and stays empty until a day is focused or hovered (the goal line covers today).
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
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
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
  await page.locator('#daily-goal').selectOption('10');
  await page.keyboard.press('Escape');
  await openView(page, 'Progress');
  await expect(page.locator('#goal-line')).toHaveText(/^Today \d+ \/ 10 min · 5-day streak$/);

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
  await page.locator('#daily-goal').selectOption('10');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 320, height: 640 });
  await openView(page, 'Progress');
  const days = page.locator('#goal-calendar .goal-day');
  const longest = await days.evaluateAll((cells) => cells.reduce((best, cell, i) => (cell.dataset.caption.length > cells[best].dataset.caption.length ? i : best), 0));
  await days.nth(longest).focus();
  await expect(page.locator('#goal-caption')).toHaveText(/ · goal met$/);
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  for (const selector of ['#goal-calendar', '#goal-caption', '#goal-line']) {
    const box = await page.locator(selector).boundingBox();
    expect(box.x, selector).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, selector).toBeLessThanOrEqual(width);
  }
  // The caption stays on its one reserved line.
  const { height, line } = await page.locator('#goal-caption').evaluate((node) => ({ height: node.getBoundingClientRect().height, line: parseFloat(getComputedStyle(node).lineHeight) }));
  expect(height).toBeLessThanOrEqual(line + 1);
  await page.locator('#practice-goal').screenshot({ path: testInfo.outputPath('progress-goal-320.png') });
});

test('drills alone count toward daily practice and the empty trend copy agrees', async ({ page, supabase }) => {
  const user = supabase.addUser('drills@stilltype.test');
  const runs = seededHistory().slice(-3).map((run) => ({ ...run, kind: 'drill' }));
  supabase.profiles.set(user.id, { data: { version: 2, preferences: {}, attempts: [], runs, loops: [],
    seenTextIds: [], bests: {}, updatedAt: runs.at(-1).at } });
  await openApp(page);
  await signInWithEmail(page, user.email);
  await openView(page, 'Progress');
  await expect(page.locator('#goal-line')).toHaveText(/^Today (<1|\d+) min · 1-day streak$/);
  await expect(page.locator('#progress-empty')).toBeVisible();
  await expect(page.locator('#progress-empty-title')).toHaveText('No speed trend yet.');
  await expect(page.locator('#progress-empty-copy')).toContainText('Drills, daily and custom runs count toward your daily practice.');
});

// Custom text is never compared, but it is real practice: its minutes count toward the goal and streak,
// while it still adds no trend point.
test('a custom text run counts toward daily practice but not the trend', async ({ page }) => {
  const text = 'the quick brown fox jumps over the lazy dog';
  await openApp(page);
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill(text);
  await page.locator('#custom-use').click();
  await typeInto(page, text);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await openView(page, 'Progress');
  await expect(page.locator('#practice-goal')).toBeVisible();
  await expect(page.locator('#goal-line')).toHaveText(/^Today (<1|\d+) min · 1-day streak$/);
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
