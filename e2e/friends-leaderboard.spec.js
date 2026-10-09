// The friends board: today's daily result and this week's practice time among mutual friends.
import { randomUUID } from 'node:crypto';
import { CORPUS_VERSION, METRIC_VERSION, conditionKey } from '../src/typing.js';
import { dailyPassage } from '../src/insights.js';
import { dailyVersion } from '../src/friends-board.js';
import { test, expect, openApp, openView, signInWithEmail, chooseWords, completePassage, passageText, typeInto } from './fixtures.js';
import { mondayOf, utcDay } from './fake-board.js';

test.setTimeout(120000);

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const DAILY = { mode: 'quote', duration: null, count: null, punctuation: true, quoteLength: 'medium', difficulty: 'any', wordList: null,
  inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };
const VERSION = dailyVersion(conditionKey(DAILY));
const SHAPES = [
  [{ mode: 'time', duration: 60, count: null, wordList: '200' }, 60000],
  [{ mode: 'time', duration: 30, count: null, wordList: '200' }, 30000],
  [{ mode: 'words', duration: null, count: 25, wordList: '200' }, 19400],
];

// Puts an element `offset` pixels below the top of the viewport, clear of the sticky dock.
const scrollBelow = (page, selector, offset) => page.evaluate(([css, gap]) => {
  window.scrollTo(0, document.querySelector(css).getBoundingClientRect().top + window.scrollY - gap);
}, [selector, offset]);

// Writes screenshots into the repository only when asked to.
async function shot(page, testInfo, name, options = {}) {
  const path = process.env.SCREENSHOTS ? `docs/screenshots/friends-leaderboard/${name}.png` : testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, ...options });
}

// Ada's saved practice this week, spread back from now but never before Monday 00:00 UTC.
function practiceThisWeek(count, extra = []) {
  const now = Date.now();
  const monday = Date.parse(`${mondayOf()}T00:00:00Z`);
  const runs = Array.from({ length: count }, (_, i) => {
    const [shape, elapsedMs] = SHAPES[i % SHAPES.length];
    return { id: `seed-${i}`, at: new Date(Math.max(monday + 60000, now - (count - i) * 41 * 60000)).toISOString(),
      kind: 'test', status: 'complete', interrupted: false, fresh: true, textId: `seed-text-${i}`,
      conditions: { ...DAILY, ...shape, punctuation: false, quoteLength: null, difficulty: null },
      score: { wpm: 66 + ((i * 7) % 19), accuracy: 94 + (i % 5) }, elapsedMs, errors: i % 3, target: null, challengeDate: null, patterns: [] };
  });
  return [...runs, ...extra];
}

function seedProfile(supabase, user, runs) {
  const updatedAt = new Date(Date.now() - 3600000).toISOString();
  const data = { version: 2, profileId: randomUUID(), preferences: {}, attempts: [], runs, loops: [], seenTextIds: [], bests: {}, updatedAt };
  supabase.profiles.set(user.id, { data, updated_at: updatedAt });
}

function befriend(supabase, owner, friend, name, { fromRace = false } = {}) {
  const list = supabase.races.friends.get(owner.id) || [];
  list.push(fromRace ? { id: randomUUID(), friendId: friend.id, name } : { id: randomUUID(), email: friend.email, name });
  supabase.races.friends.set(owner.id, list);
}

const publish = (supabase, user, daily, seconds, runs) => supabase.board.summaries.set(user.id, {
  daily: daily && { date: utcDay(), version: VERSION, ...daily }, week: { start: mondayOf(), seconds, runs } });

// Ada has chosen Lin, Mara and Sam, and they chose her. Ada also has Ola, who never added her back,
// and Kai has added Ada without Ada adding Kai. Neither of those two may ever appear.
function circle(supabase) {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  const mara = supabase.addUser('mara@stilltype.test');
  const sam = supabase.addUser('sam@stilltype.test');
  const ola = supabase.addUser('ola@stilltype.test');
  const kai = supabase.addUser('kai@stilltype.test');
  befriend(supabase, ada, lin, 'Lin');
  befriend(supabase, ada, mara, 'Mara');
  befriend(supabase, ada, sam, 'Sam Okafor', { fromRace: true });
  befriend(supabase, ada, ola, 'Ola');
  befriend(supabase, lin, ada, 'Ada');
  befriend(supabase, mara, ada, 'Ada L.');
  befriend(supabase, sam, ada, 'Ada', { fromRace: true });
  befriend(supabase, kai, ada, 'Ada');
  publish(supabase, lin, { wpm: 78, accuracy: 96, attempts: 2 }, 2460, 37);
  publish(supabase, mara, { wpm: 91, accuracy: 98, attempts: 1 }, 1210, 20);
  publish(supabase, sam, null, 754, 12);
  publish(supabase, ola, { wpm: 105, accuracy: 99, attempts: 1 }, 3000, 40);
  publish(supabase, kai, { wpm: 99, accuracy: 97, attempts: 1 }, 2900, 31);
  return { ada };
}

// Each row as it reads aloud: name, value and unit, then the detail.
const rowTexts = (page, list) => page.locator(`#${list} .board-row`).evaluateAll((rows) => rows.map((row) => row.textContent.replace(/\s+/g, ' ').trim()));

test('guests see a sign-in prompt, and the board is in the palette', async ({ page, supabase }) => {
  await openApp(page);
  await openView(page, 'Challenge');
  await page.locator('#challenge-friends').click();
  await expect(page.locator('#challenge-friends')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#compete-heading')).toHaveText('Among friends, today and this week.');
  await expect(page.locator('#friends-board-guest')).toBeVisible();
  await expect(page.locator('#friends-board-lists')).toBeHidden();
  await expect(page.locator('#refresh-friends-board')).toBeHidden();
  await page.locator('#friends-board-signin').click();
  await expect(page.locator('#account-dialog')).toBeVisible();
  await expect(page.locator('#account-dialog-title')).toHaveText('Sign in');
  await page.locator('#account-cancel').click();

  await openView(page, 'Practice');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('friends board');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('friends board');
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'compete');
  await expect(page.locator('#friends-board')).toBeVisible();
  // Guests keep nothing beyond the tab, so nothing is published or asked for.
  expect(supabase.requests).toEqual([]);
});

test('a daily run is published, and only mutual friends share the board', async ({ page, supabase }, testInfo) => {
  const { ada } = circle(supabase);
  seedProfile(supabase, ada, practiceThisWeek(24));
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#challenge-daily').click();
  await page.locator('#start-daily').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'daily');
  // A human pace with two corrected slips, so the published result reads like a real one.
  const passage = await passageText(page);
  await page.locator('#typing-input').focus();
  let typed = 0;
  for (const slip of [60, 150]) {
    await page.keyboard.type(passage.slice(typed, slip), { delay: 120 });
    await page.keyboard.type(passage[slip] === 'q' ? 'w' : 'q');
    await page.keyboard.press('Backspace');
    typed = slip;
  }
  await page.keyboard.type(passage.slice(typed), { delay: 120 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  const wpm = Number(await page.locator('#result-wpm').textContent());
  const accuracy = Number(await page.locator('#result-accuracy').textContent());
  await expect.poll(() => supabase.board.published.length).toBe(1);
  const sent = supabase.board.published[0];
  expect(sent.caller).toBe(ada.id);
  expect(sent.daily).toEqual({ date: dailyPassage().day, version: VERSION, wpm, accuracy, attempts: 1 });
  expect(sent.week.start).toBe(mondayOf());
  expect(sent.week.runs).toBe(25);
  expect(sent.week.seconds).toBeGreaterThan(880);

  await openView(page, 'Challenge');
  await page.locator('#challenge-friends').click();
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  // The summary has not changed since the run, so opening the board only reads it.
  expect(supabase.board.published.length).toBe(1);
  await expect(page.locator('#board-daily-meta')).toHaveText(`${utcDay()} · best completed attempt · physical keyboard`);

  const daily = await rowTexts(page, 'board-daily');
  expect(daily).toHaveLength(4);
  expect(daily).toContain(`You ${wpm} wpm ${accuracy}% accuracy · 1 attempt`);
  expect(daily).toContain('Lin 78 wpm 96% accuracy · best of 2');
  expect(daily).toContain('Mara 91 wpm 98% accuracy · 1 attempt');
  expect(daily.at(-1)).toBe('Sam Okafor — no completed attempt yet');
  const speeds = daily.slice(0, 3).map((text) => Number(text.match(/(\d+) wpm/)[1]));
  expect(speeds).toEqual([...speeds].sort((a, b) => b - a));
  await expect(page.locator('#board-daily [data-self] .board-name')).toHaveText('You');

  const week = await rowTexts(page, 'board-week');
  expect(week.slice(0, 2)).toEqual(['Lin 41 min 37 runs', 'Mara 20 min 20 runs']);
  expect(week[2]).toMatch(/^You 1[45] min 25 runs$/);
  expect(week[3]).toBe('Sam Okafor 12 min 12 runs');
  // Someone who never chose Ada back, and someone Ada never chose, stay off her board.
  await expect(page.locator('#friends-board')).not.toContainText('Ola');
  await expect(page.locator('#friends-board')).not.toContainText('Kai');
  await expect(page.locator('#friends-board-empty')).toBeHidden();

  await shot(page, testInfo, 'board-light', { fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // Let the theme's colour fade settle before the picture.
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(15, 15, 14)');
  await page.waitForTimeout(400);
  await shot(page, testInfo, 'board-dark', { fullPage: true });

  // Lin sees Ada under her own name for her, with the result Ada just published.
  const context = await page.context().browser().newContext();
  const lin = await context.newPage();
  try {
    await supabase.attach(lin);
    await openApp(lin);
    await signInWithEmail(lin, 'lin@stilltype.test');
    await openView(lin, 'Challenge');
    await lin.locator('#challenge-friends').click();
    await expect(lin.locator('#board-daily')).toContainText(`Ada ${wpm} wpm`);
    expect(await rowTexts(lin, 'board-daily')).toHaveLength(2);
    // A result scored by another build of the daily is not compared, and Refresh keeps keyboard focus.
    supabase.board.summaries.get(ada.id).daily.version = VERSION.replace(METRIC_VERSION, 'stilltype-metrics-v0');
    await lin.locator('#refresh-friends-board').focus();
    await lin.keyboard.press('Enter');
    await expect(lin.locator('#friends-board-status')).toHaveText('Updated.');
    await expect(lin.locator('#refresh-friends-board')).toBeFocused();
    expect(await rowTexts(lin, 'board-daily')).toContain('Ada — another version of the daily · not compared');
  } finally { await context.close(); }
});

test('practice time is published after a practice run, and a board not yet set up says so', async ({ page, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  supabase.board.missing = true;
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await chooseWords(page, 10);
  await completePassage(page);
  await openView(page, 'Challenge');
  await page.locator('#challenge-friends').click();
  await expect(page.locator('#friends-board-status')).toHaveText('The friends board is being set up. Please try again shortly.');
  await expect(page.locator('#friends-board-lists')).toBeHidden();

  supabase.board.missing = false;
  await page.locator('#refresh-friends-board').click();
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  await expect(page.locator('#friends-board-status')).toHaveText('Updated.');
  const sent = supabase.board.published.at(-1);
  expect(sent.daily).toBeNull();
  expect(sent.week.runs).toBe(1);
  await expect(page.locator('#board-week .board-row')).toContainText(['1 run']);
  expect(await rowTexts(page, 'board-daily')).toEqual(['You — no completed attempt yet']);
  // Alone on the board: how friends get here, and a way to them.
  await expect(page.locator('#friends-board-empty')).toBeVisible();
  await page.locator('#friends-board-online').click();
  await expect(page.locator('#online-challenge')).toBeVisible();
  await expect(page.locator('#friends-board')).toBeHidden();
  await expect(page.locator('#challenge-online')).toBeFocused();
});

test('opening the board in an older tab leaves another tab’s newer result alone', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  // A second tab of the same account finishes today's daily; the first tab's copy never gets that run.
  const second = await page.context().newPage();
  await supabase.attach(second);
  await openApp(second);
  await expect(second.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await openView(second, 'Challenge');
  await second.locator('#challenge-daily').click();
  await second.locator('#start-daily').click();
  await expect(second.locator('#typing-screen')).toHaveAttribute('data-session', 'daily');
  await typeInto(second, await passageText(second), '#typing-input', { delay: 60 });
  await expect(second.locator('body')).toHaveAttribute('data-view', 'results');
  await expect.poll(() => supabase.board.published.length).toBe(1);
  const { wpm } = supabase.board.published[0].daily;

  await openView(page, 'Challenge');
  await page.locator('#challenge-friends').click();
  await expect(page.locator('#board-daily')).toContainText(`You ${wpm} wpm`);
  // Opening only read the board: the older tab sent nothing over the newer result.
  expect(supabase.board.published.length).toBe(1);
  expect(supabase.board.summaries.get(ada.id).daily.wpm).toBe(wpm);
});

test('a run finished offline reaches the board once the browser is back online', async ({ page, context, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  supabase.offline = true;
  await context.setOffline(true);
  await chooseWords(page, 10);
  await completePassage(page);
  await page.waitForTimeout(2500);
  expect(supabase.board.published).toEqual([]);
  supabase.offline = false;
  await context.setOffline(false);
  await expect.poll(() => supabase.board.published.length).toBe(1);
  expect(supabase.board.published[0].week.runs).toBe(1);
});

test('nothing is sent mid-run, and an undone clear ends on the restored summary', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await chooseWords(page, 10);
  await completePassage(page);
  // Straight into another run, usually before the first summary goes out; it waits for the run.
  await page.locator('#run-again').click();
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 3));
  const before = supabase.board.published.length;
  await page.waitForTimeout(2500);
  expect(supabase.board.published.length).toBe(before);
  await page.keyboard.type(text.slice(3));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect.poll(() => supabase.board.summaries.get(ada.id)?.week.runs).toBe(2);
  expect(supabase.board.published.length).toBe(before + 1);

  // Clear, then undo at once: whatever went out in between, the board ends on the restored history.
  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await page.locator('#undo-clear').click();
  await expect(page.locator('#history-feedback')).toHaveText('History restored.');
  await page.waitForTimeout(2500);
  expect(supabase.board.summaries.get(ada.id).week.runs).toBe(2);
  expect(supabase.board.published.at(-1).week.runs).toBe(2);

  // A clear that stays cleared reaches the board too.
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect.poll(() => supabase.board.summaries.get(ada.id).week.runs).toBe(0);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the board stacks on a phone and fits at 320px', async ({ page, supabase }, testInfo) => {
    const { ada } = circle(supabase);
    const day = dailyPassage();
    const dailyRun = { id: 'seed-daily', at: new Date().toISOString(), kind: 'daily', status: 'complete', interrupted: false, fresh: true,
      textId: day.sourceTextId, conditions: DAILY, score: { wpm: 84, accuracy: 97 }, elapsedMs: 41200, errors: 2, target: null,
      challengeDate: day.day, firstDailyAttempt: true, patterns: [] };
    seedProfile(supabase, ada, practiceThisWeek(18, [dailyRun]));
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await signInWithEmail(page, 'ada@stilltype.test');
    await openView(page, 'Challenge');
    await page.locator('#challenge-friends').click();
    await expect(page.locator('#board-daily')).toContainText('You 84 wpm');
    // Nothing from any device this week yet, so opening the board fills Ada's row in from this one.
    expect(supabase.board.published.at(-1).daily).toEqual({ date: day.day, version: VERSION, wpm: 84, accuracy: 97, attempts: 1 });
    const daily = await page.locator('#board-daily').boundingBox();
    const week = await page.locator('#board-week').boundingBox();
    expect(week.y).toBeGreaterThan(daily.y + daily.height);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await scrollBelow(page, '#friends-board-heading', 24);
    await shot(page, testInfo, 'board-phone-dark');
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});
