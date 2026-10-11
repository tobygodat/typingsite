import { CORPUS_VERSION, METRIC_VERSION } from '../src/typing.js';
import { test, expect, openApp, chooseWords, completePassage, openView, openSettings, signInWithEmail } from './fixtures.js';

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
  await expect(today).toHaveAttribute('title', /^[A-Z][a-z]{2} \d{1,2}: (<1|\d+) min$/);
  // One tab stop; arrows move a day (up/down) or a week (left/right), and each day says what it holds.
  await expect(page.locator('#goal-calendar [tabindex="0"]')).toHaveCount(1);
  await expect(today).toHaveAttribute('tabindex', '0');
  await today.focus();
  await page.keyboard.press('ArrowLeft');
  const weekAgo = days.nth((await days.count()) - 8);
  await expect(weekAgo).toBeFocused();
  await expect(weekAgo).toHaveAttribute('aria-label', /^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}: 0 min$/);
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

  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.mouse.move(640, 300);
    await page.waitForTimeout(600);
    // Committed docs are rewritten only on request (SCREENSHOTS=1); a normal run keeps its captures in test output.
    const name = `progress-${theme}.png`;
    await page.screenshot({ path: process.env.SCREENSHOTS ? `docs/screenshots/daily-goal-streak/${name}` : testInfo.outputPath(name) });
  }
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
  await expect(page.locator('#progress-empty-copy')).toContainText('Drills and daily runs count toward your daily practice.');
});
