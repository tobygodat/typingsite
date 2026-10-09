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

function seedProfile(supabase, user, runs, { updatedAt = new Date(Date.now() - 3600000).toISOString(), share = false } = {}) {
  const data = { version: 2, profileId: randomUUID(), preferences: share ? { shareBoard: true } : {}, attempts: [], runs, loops: [], seenTextIds: [], bests: {}, updatedAt };
  supabase.profiles.set(user.id, { data, updated_at: updatedAt });
}

// An account that turned sharing on already: its preference, and its row on the board (an empty week).
function sharing(supabase, user, { runs = [], start = mondayOf() } = {}) {
  seedProfile(supabase, user, runs, { share: true });
  supabase.board.summaries.set(user.id, { daily: null, week: { start, seconds: 0, runs: 0 } });
}

// The board's friends_board requests so far.
const boardRequests = (supabase) => supabase.requests.filter((request) => request === 'POST /rest/v1/rpc/friends_board').length;

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
  await expect(page.locator('#friends-board-share')).toBeHidden();
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
  // Sharing is off by default: the board shows nobody, says why, and nothing is sent.
  await openView(page, 'Challenge');
  await page.locator('#challenge-friends').click();
  await expect(page.locator('#friends-board-off')).toBeVisible();
  await expect(page.locator('#share-board')).not.toBeChecked();
  await expect(page.locator('#friends-board-lists')).toBeHidden();
  expect(supabase.board.published).toEqual([]);
  await scrollBelow(page, '#friends-board-heading', 120);
  await shot(page, testInfo, 'board-off-light');
  // Turning it on sends this tab's week, and the friends who share appear.
  await page.locator('#share-board').check();
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  await expect(page.locator('#friends-board-off')).toBeHidden();
  await expect(page.locator('#share-board')).toBeFocused();
  expect(supabase.board.published).toHaveLength(1);
  expect(supabase.board.published[0]).toMatchObject({ action: 'share', daily: null, week: { start: mondayOf(), runs: 24 } });

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
  await expect.poll(() => supabase.board.published.length).toBe(2);
  const sent = supabase.board.published[1];
  expect(sent.caller).toBe(ada.id);
  expect(sent.action).toBe('publish');
  expect(sent.daily).toEqual({ date: dailyPassage().day, version: VERSION, wpm, accuracy, attempts: 1 });
  expect(sent.week.start).toBe(mondayOf());
  expect(sent.week.runs).toBe(25);
  expect(sent.week.seconds).toBeGreaterThan(880);

  await openView(page, 'Challenge');
  await page.locator('#challenge-friends').click();
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  // The summary has not changed since the run, so opening the board only reads it.
  expect(supabase.board.published.length).toBe(2);
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

  // Lin, who turned sharing on before, sees Ada under her own name for her, with the result Ada just published.
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
  // Not sharing, so the run sends nothing.
  await page.waitForTimeout(2000);
  expect(boardRequests(supabase)).toBe(0);
  await openView(page, 'Challenge');
  await page.locator('#challenge-friends').click();
  await expect(page.locator('#friends-board-status')).toHaveText('The friends board is being set up. Please try again shortly.');
  await expect(page.locator('#friends-board-lists')).toBeHidden();

  supabase.board.missing = false;
  await page.locator('#refresh-friends-board').click();
  await expect(page.locator('#friends-board-status')).toHaveText('Updated.');
  await expect(page.locator('#friends-board-off')).toBeVisible();
  await expect(page.locator('#friends-board-lists')).toBeHidden();
  expect(supabase.board.published).toEqual([]);
  // Turned on with the keyboard: the run goes out with it.
  await page.locator('#share-board').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  const sent = supabase.board.published.at(-1);
  expect(sent.action).toBe('share');
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
  sharing(supabase, ada);
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
  // Opening sent the older tab's empty summary too, and the service folded it in: the newer result stays.
  expect(supabase.board.published.at(-1)).toMatchObject({ action: 'publish', daily: null, week: { runs: 0 } });
  expect(supabase.board.summaries.get(ada.id).daily.wpm).toBe(wpm);
  expect(supabase.board.summaries.get(ada.id).week.runs).toBe(1);
});

test('opening the board publishes history loaded from the account over a lower week row', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  // Sharing was turned on elsewhere, and a stale tab or device already put an empty week on the board.
  sharing(supabase, ada, { runs: practiceThisWeek(6) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  // This tab loaded the fuller history from the account and has changed nothing itself.
  expect(supabase.board.published).toEqual([]);
  await openView(page, 'Challenge');
  await page.locator('#challenge-friends').click();
  await expect(page.locator('#board-week')).toContainText('6 runs');
  expect(supabase.board.published).toHaveLength(1);
  expect(supabase.board.published[0]).toMatchObject({ action: 'publish', week: { start: mondayOf(), runs: 6 } });
  expect(supabase.board.summaries.get(ada.id).week.runs).toBe(6);
  // Opened again with nothing new, the board is only read.
  await page.locator('#refresh-friends-board').click();
  await expect(page.locator('#friends-board-status')).toHaveText('Updated.');
  expect(supabase.board.published).toHaveLength(1);
});

test('a board opened during the account check publishes the history the check brings', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  supabase.board.summaries.set(ada.id, { daily: null, week: { start: mondayOf(), seconds: 0, runs: 0 } });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  // Another device then turns sharing on and saves six runs from this week; this tab's copy has neither.
  seedProfile(supabase, ada, practiceThisWeek(6), { updatedAt: new Date(Date.now() + 60000).toISOString(), share: true });
  let release;
  supabase.holdProfiles = new Promise((resolve) => { release = resolve; });
  await page.reload();
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await openView(page, 'Challenge');
  await page.locator('#challenge-friends').click();
  // Opened before the check, the board is only read.
  await expect(page.locator('#board-week')).toContainText('You 0 min 0 runs');
  expect(supabase.board.published).toEqual([]);
  supabase.holdProfiles = null;
  release();
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  // Once the check has brought the six runs, they go to the board without a new run or a reopen.
  await expect.poll(() => supabase.board.published.length).toBe(1);
  expect(supabase.board.published[0]).toMatchObject({ action: 'publish', week: { start: mondayOf(), runs: 6 } });
  expect(supabase.board.summaries.get(ada.id).week.runs).toBe(6);
});

test('a midnight re-read that fails is tried again at the next check', async ({ page, supabase }) => {
  sharing(supabase, supabase.addUser('ada@stilltype.test'), { start: '2026-09-28' });
  let now = '2026-10-03T23:50:00Z';
  supabase.board.now = () => new Date(now);
  await page.clock.install({ time: new Date(now) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#challenge-friends').click();
  await expect(page.locator('#board-daily-meta')).toHaveText('2026-10-03 · best completed attempt · physical keyboard');
  // The first read after midnight fails; the next 30-second check reads Sunday's board.
  now = '2026-10-04T00:00:30Z';
  supabase.board.missing = true;
  await page.clock.fastForward('10:30');
  await expect(page.locator('#friends-board-status')).toHaveText('The friends board is being set up. Please try again shortly.');
  await expect(page.locator('#board-daily-meta')).toHaveText('2026-10-03 · best completed attempt · physical keyboard');
  supabase.board.missing = false;
  await page.clock.fastForward(30_000);
  await expect(page.locator('#board-daily-meta')).toHaveText('2026-10-04 · best completed attempt · physical keyboard');
  await expect(page.locator('#friends-board-status')).toHaveText('');
});

test('a tab that never saw another tab’s runs adds its own without erasing them', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  sharing(supabase, ada);
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  // A second tab of the same account finishes a practice run and today's daily; the first never loads them.
  const second = await page.context().newPage();
  await supabase.attach(second);
  await openApp(second);
  await expect(second.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await chooseWords(second, 10);
  await completePassage(second);
  await openView(second, 'Challenge');
  await second.locator('#challenge-daily').click();
  await second.locator('#start-daily').click();
  await expect(second.locator('#typing-screen')).toHaveAttribute('data-session', 'daily');
  await typeInto(second, await passageText(second), '#typing-input', { delay: 60 });
  await expect(second.locator('body')).toHaveAttribute('data-view', 'results');
  await expect.poll(() => supabase.board.summaries.get(ada.id)?.daily?.wpm).toBeGreaterThan(0);
  const before = supabase.board.summaries.get(ada.id);
  expect(before.week.runs).toBe(2);

  // The first tab, on its older copy, finishes one practice run. It sends only what it knows...
  const sent = supabase.board.published.length;
  await chooseWords(page, 10);
  await completePassage(page);
  await expect.poll(() => supabase.board.published.length).toBe(sent + 1);
  const mine = supabase.board.published.at(-1);
  expect(mine).toMatchObject({ action: 'publish', daily: null, week: { start: mondayOf(), runs: 1 } });
  // ...and the board keeps the other tab's daily result and the larger week.
  expect(supabase.board.summaries.get(ada.id)).toMatchObject({ daily: before.daily,
    week: { start: mondayOf(), seconds: Math.max(before.week.seconds, mine.week.seconds), runs: 2 } });
  await openView(page, 'Challenge');
  await page.locator('#challenge-friends').click();
  await expect(page.locator('#board-daily')).toContainText(`You ${before.daily.wpm} wpm`);
  await expect(page.locator('#board-week')).toContainText('2 runs');
});

test('a board left open reads the new day after 00:00 UTC, and the new week on Monday', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  const mara = supabase.addUser('mara@stilltype.test');
  for (const [friend, name] of [[lin, 'Lin'], [mara, 'Mara']]) {
    befriend(supabase, ada, friend, name);
    befriend(supabase, friend, ada, 'Ada');
  }
  const result = (day, wpm) => ({ date: day, version: dailyVersion(conditionKey(DAILY), new Date(`${day}T00:00:00Z`)), wpm, accuracy: 97, attempts: 1 });
  const lastWeek = (seconds, runs) => ({ start: '2026-09-28', seconds, runs });
  supabase.board.summaries.set(lin.id, { daily: result('2026-10-03', 78), week: lastWeek(2460, 37) });
  supabase.board.summaries.set(mara.id, { daily: null, week: lastWeek(1210, 20) });
  sharing(supabase, ada, { start: '2026-09-28' });
  // Saturday, ten minutes before midnight UTC, on the page and the service alike.
  let now = '2026-10-03T23:50:00Z';
  supabase.board.now = () => new Date(now);
  await page.clock.install({ time: new Date(now) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#challenge-friends').click();
  await expect(page.locator('#board-daily-meta')).toHaveText('2026-10-03 · best completed attempt · physical keyboard');
  expect(await rowTexts(page, 'board-daily')).toEqual(['Lin 78 wpm 97% accuracy · 1 attempt', 'You — no completed attempt yet', 'Mara — no completed attempt yet']);
  const reads = () => supabase.requests.filter((request) => request === 'POST /rest/v1/rpc/friends_board').length;
  const sent = supabase.board.published.length;

  // Past midnight, Mara plays Sunday's daily. The open board reads again without a Refresh, quietly.
  now = '2026-10-04T00:00:30Z';
  supabase.board.summaries.set(mara.id, { daily: result('2026-10-04', 91), week: lastWeek(1250, 21) });
  await page.clock.fastForward('10:30');
  await expect(page.locator('#board-daily-meta')).toHaveText('2026-10-04 · best completed attempt · physical keyboard');
  expect(await rowTexts(page, 'board-daily')).toEqual(['Mara 91 wpm 97% accuracy · 1 attempt', 'You — no completed attempt yet', 'Lin — no completed attempt yet']);
  await expect(page.locator('#board-week-meta')).toHaveText('since monday 2026-09-28, 00:00 utc · completed runs');
  expect((await rowTexts(page, 'board-week')).slice(0, 2)).toEqual(['Lin 41 min 37 runs', 'Mara 20 min 21 runs']);
  await expect(page.locator('#friends-board-status')).toHaveText('');
  // Same week, nothing new in this tab: the rollover only read.
  expect(supabase.board.published.length).toBe(sent);

  // A tab hidden across Sunday night waits, then reads Monday's new week when it comes back.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  now = '2026-10-05T00:00:30Z';
  const before = reads();
  await page.clock.fastForward('24:00:00');
  await page.waitForTimeout(500);
  expect(reads()).toBe(before);
  await expect(page.locator('#board-week-meta')).toHaveText('since monday 2026-09-28, 00:00 utc · completed runs');
  await page.evaluate(() => {
    delete document.hidden;
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#board-week-meta')).toHaveText('since monday 2026-10-05, 00:00 utc · completed runs');
  await expect(page.locator('#board-daily-meta')).toHaveText('2026-10-05 · best completed attempt · physical keyboard');
  expect(await rowTexts(page, 'board-daily')).toEqual(['You — no completed attempt yet', 'Lin — no completed attempt yet', 'Mara — no completed attempt yet']);
  const week = await rowTexts(page, 'board-week');
  expect(week.slice(1)).toEqual(['Lin — nothing yet this week', 'Mara — nothing yet this week']);
  // Nobody had published this week, so Ada's new week comes from this tab, as opening the board would.
  expect(week[0]).toBe('You 0 min 0 runs');
  expect(supabase.board.published.at(-1).week).toEqual({ start: '2026-10-05', seconds: 0, runs: 0 });
  await expect(page.locator('#friends-board-status')).toHaveText('');
});

test('a run finished offline reaches the board once the browser is back online', async ({ page, context, supabase }) => {
  sharing(supabase, supabase.addUser('ada@stilltype.test'));
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
  sharing(supabase, ada);
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

  // A clear that stays cleared reaches the board too: it replaces the summary, so the numbers go down.
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect.poll(() => supabase.board.summaries.get(ada.id).week.runs).toBe(0);
  expect(supabase.board.published.at(-1).action).toBe('replace');
});

test('a clear made while a publish is still on its way is not undone when that publish lands', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  sharing(supabase, ada);
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await chooseWords(page, 10);
  await completePassage(page);
  await expect.poll(() => supabase.board.summaries.get(ada.id)?.week.runs).toBe(1);
  // The next run's publish is slow to reach the service, and the history is cleared meanwhile.
  let land;
  supabase.board.holdNext = new Promise((resolve) => { land = resolve; });
  await page.locator('#run-again').click();
  await completePassage(page);
  // Polled as a boolean: a returned promise would be awaited.
  await expect.poll(() => supabase.board.holdNext === null).toBe(true);
  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(page.locator('#history-feedback')).toHaveText('History cleared.');
  // The clear waits for the publish ahead of it rather than overtaking it.
  await page.waitForTimeout(2500);
  expect(supabase.board.published.map((entry) => entry.action)).toEqual(['publish']);
  land();
  await expect.poll(() => supabase.board.published.map((entry) => entry.action)).toEqual(['publish', 'publish', 'replace']);
  expect(supabase.board.summaries.get(ada.id)).toMatchObject({ daily: null, week: { start: mondayOf(), seconds: 0, runs: 0 } });
});

test('a clear reaches the board even when this tab’s own summary does not change', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  // Only practice from before this week: something to clear, and nothing in this week's summary.
  const lastWeek = new Date(Date.parse(`${mondayOf()}T00:00:00Z`) - 3 * 86400000).toISOString();
  sharing(supabase, ada, { runs: [{ ...practiceThisWeek(1)[0], id: 'last-week', at: lastWeek }] });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#challenge-friends').click();
  // Opening the board sends this tab's empty week for the first time.
  await expect.poll(() => supabase.board.published.length).toBe(1);
  expect(supabase.board.published[0]).toMatchObject({ action: 'publish', daily: null, week: { runs: 0 } });
  // Another device then records today's daily and some practice.
  supabase.board.summaries.set(ada.id, { daily: { date: utcDay(), version: VERSION, wpm: 88, accuracy: 97, attempts: 1 },
    week: { start: mondayOf(), seconds: 1500, runs: 9 } });

  // Clearing here leaves this tab's summary as it was, yet the clear still replaces the board's.
  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(page.locator('#history-feedback')).toHaveText('History cleared.');
  await expect.poll(() => supabase.board.published.length).toBe(2);
  expect(supabase.board.published[1]).toMatchObject({ action: 'replace', daily: null, week: { start: mondayOf(), seconds: 0, runs: 0 } });
  expect(supabase.board.summaries.get(ada.id)).toMatchObject({ daily: null, week: { start: mondayOf(), seconds: 0, runs: 0 } });
});

test('a clear on one device stays cleared when a tab that missed it publishes', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  sharing(supabase, ada, { runs: practiceThisWeek(5) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  // A second tab, loaded before the clear, keeps the five runs in its copy.
  const second = await page.context().newPage();
  await supabase.attach(second);
  await openApp(second);
  await expect(second.locator('#account')).toHaveAttribute('data-sync', 'synced');

  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect.poll(() => supabase.board.published.at(-1)?.action).toBe('replace');
  const { clear } = supabase.board.summaries.get(ada.id);
  expect(supabase.board.published.at(-1)).toMatchObject({ clear, week: { runs: 0 } });

  // The stale tab finishes a run. Sent with all six runs it is refused; it learns the clear and sends
  // only the run since, so the board doesn't get the cleared five back.
  await chooseWords(second, 10);
  await completePassage(second);
  await expect.poll(() => supabase.board.published.at(-1)?.action).toBe('publish');
  expect(supabase.board.refused).toHaveLength(1);
  expect(supabase.board.refused[0]).toMatchObject({ action: 'publish', clear: null, week: { runs: 6 } });
  expect(supabase.board.published.at(-1)).toMatchObject({ clear: clear.id, week: { runs: 1 } });
  expect(supabase.board.summaries.get(ada.id)).toMatchObject({ sharing: true, clear, week: { start: mondayOf(), runs: 1 } });
  // It keeps the clear for its next run, which goes through at once.
  await second.locator('#run-again').click();
  await completePassage(second);
  await expect.poll(() => supabase.board.summaries.get(ada.id).week.runs).toBe(2);
  expect(supabase.board.refused).toHaveLength(1);
});

test('a clear made offline keeps its own time, so the runs after it count once it gets through', async ({ page, context, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  sharing(supabase, ada, { runs: practiceThisWeek(3) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  supabase.offline = true;
  await context.setOffline(true);
  // Cleared and one run made offline, then a second run once back online.
  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(page.locator('#history-feedback')).toHaveText('History cleared.');
  const clearedHere = Date.now();
  await openView(page, 'Practice');
  await chooseWords(page, 10);
  await completePassage(page);
  await page.waitForTimeout(2000);
  expect(supabase.board.published).toEqual([]);
  supabase.offline = false;
  await context.setOffline(false);
  // The clear arrives late, carrying the run made after it and the time it happened here.
  await expect.poll(() => supabase.board.published.at(-1)?.action).toBe('replace');
  expect(supabase.board.published.at(-1)).toMatchObject({ week: { runs: 1 } });
  const { clear } = supabase.board.summaries.get(ada.id);
  expect(Date.parse(clear.from)).toBeLessThan(clearedHere + 1000);
  await page.locator('#run-again').click();
  await completePassage(page);
  // Both runs since the clear count.
  await expect.poll(() => supabase.board.summaries.get(ada.id).week.runs).toBe(2);
  expect(supabase.board.published.at(-1)).toMatchObject({ action: 'publish', clear: clear.id, week: { runs: 2 } });
});

test('an undo is refused when another device cleared after it, and the board stays cleared', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  sharing(supabase, ada, { runs: practiceThisWeek(3) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect.poll(() => supabase.board.published.at(-1)?.action).toBe('replace');
  const mine = supabase.board.summaries.get(ada.id).clear;
  // Another device clears too, after this one; then this tab undoes its own clear.
  const newer = supabase.board.clearElsewhere(ada.id);
  await page.locator('#undo-clear').click();
  await expect(page.locator('#history-feedback')).toHaveText('History restored here. The friends board keeps a newer clear from another device.');
  await expect(page.locator('#undo-clear')).toBeHidden();
  expect(supabase.board.refused.at(-1)).toMatchObject({ action: 'replace', undo: mine.id, week: { runs: 3 } });
  // The tab then sends its runs since the newer clear (none), and the board stays cleared.
  await expect.poll(() => supabase.board.published.at(-1)?.clear).toBe(newer.id);
  expect(supabase.board.summaries.get(ada.id)).toMatchObject({ clear: newer, week: { runs: 0 }, daily: null });
  // This tab keeps its restored history.
  await expect(page.locator('#clear-history')).toBeVisible();
});

test('a clear from a device whose clock runs behind still takes effect after an earlier one', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  sharing(supabase, ada, { runs: practiceThisWeek(3) });
  // This device's clock reads five minutes behind the service's.
  await page.clock.install({ time: new Date(Date.now() - 5 * 60000) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  // Another device clears first; then this one clears, later in fact but earlier by its clock.
  const other = supabase.board.clearElsewhere(ada.id);
  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  const replaced = () => [...supabase.board.published, ...supabase.board.refused].find((entry) => entry.action === 'replace');
  await expect.poll(() => replaced()?.clear?.id).toBeTruthy();
  const ours = replaced().clear;
  expect(Date.parse(ours.from)).toBeLessThan(Date.parse(other.from));
  // It is taken, in the order it arrived, and runs still count from the other device's later time.
  expect(supabase.board.refused).toEqual([]);
  expect(supabase.board.summaries.get(ada.id).clear).toEqual({ id: ours.id, from: other.from });
});

test('a clear queued behind a publish that is refused still goes out', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  sharing(supabase, ada, { runs: practiceThisWeek(3) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  // A run's publish is slow to arrive...
  let land;
  supabase.board.holdNext = new Promise((resolve) => { land = resolve; });
  await chooseWords(page, 10);
  await completePassage(page);
  // Polled as a boolean: a returned promise would be awaited.
  await expect.poll(() => supabase.board.holdNext === null).toBe(true);
  // ...meanwhile another device clears, and then this tab clears too; its clear waits behind the publish.
  const other = supabase.board.clearElsewhere(ada.id);
  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(page.locator('#history-feedback')).toHaveText('History cleared.');
  await page.waitForTimeout(2500);
  expect(supabase.board.published).toEqual([]);
  // The publish lands and is refused, having missed the other clear; this tab's own clear still goes out.
  land();
  await expect.poll(() => supabase.board.published.find((entry) => entry.action === 'replace')?.clear?.id).toBeTruthy();
  const ours = supabase.board.published.find((entry) => entry.action === 'replace').clear;
  expect(ours.id).not.toBe(other.id);
  expect(supabase.board.refused).toHaveLength(1);
  expect(supabase.board.refused[0]).toMatchObject({ action: 'publish', clear: null, week: { runs: 4 } });
  expect(supabase.board.summaries.get(ada.id)).toMatchObject({ clear: { id: ours.id }, week: { runs: 0 }, daily: null });
});

test('turning sharing off removes your row, and a tab that missed it can’t share again', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  befriend(supabase, ada, lin, 'Lin');
  befriend(supabase, lin, ada, 'Ada');
  sharing(supabase, ada, { runs: practiceThisWeek(3) });
  publish(supabase, lin, { wpm: 78, accuracy: 96, attempts: 2 }, 2460, 37);
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  // A second tab of Ada's, open since before she stops sharing.
  const second = await page.context().newPage();
  await supabase.attach(second);
  await openApp(second);
  await expect(second.locator('#account')).toHaveAttribute('data-sync', 'synced');
  const context = await page.context().browser().newContext();
  const linPage = await context.newPage();
  try {
    await supabase.attach(linPage);
    await openApp(linPage);
    await signInWithEmail(linPage, 'lin@stilltype.test');
    await openView(linPage, 'Challenge');
    await linPage.locator('#challenge-friends').click();
    await expect(linPage.locator('#board-week')).toContainText('Ada');

    // Ada turns sharing off from the command palette.
    await openView(page, 'Practice');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('share on friends');
    await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('share on friends board');
    await page.keyboard.press('Enter');
    await expect(page.locator('#friends-board')).toBeVisible();
    await expect(page.locator('#friends-board-status')).toHaveText('Your row is off the board.');
    await expect(page.locator('#share-board')).not.toBeChecked();
    await expect(page.locator('#friends-board-off')).toBeVisible();
    await expect(page.locator('#friends-board-lists')).toBeHidden();
    expect(supabase.board.published.at(-1)).toMatchObject({ action: 'unshare' });
    // Only a marker with no numbers is left.
    expect(supabase.board.summaries.get(ada.id)).toMatchObject({ sharing: false, daily: null, week: null });

    // Lin no longer sees her.
    await linPage.locator('#refresh-friends-board').click();
    await expect(linPage.locator('#friends-board-status')).toHaveText('Updated.');
    await expect(linPage.locator('#friends-board-lists')).not.toContainText('Ada');

    // The other tab still thinks she shares. Its next run is refused, the row stays a marker, and the
    // tab turns its own sharing off, saying so quietly on its board.
    await chooseWords(second, 10);
    await completePassage(second);
    await expect.poll(() => supabase.board.refused.length).toBe(1);
    expect(supabase.board.refused[0]).toMatchObject({ action: 'publish', week: { runs: 4 } });
    expect(supabase.board.summaries.get(ada.id)).toMatchObject({ sharing: false, week: null });
    await openView(second, 'Challenge');
    await second.locator('#challenge-friends').click();
    await expect(second.locator('#friends-board-status')).toHaveText('Sharing was turned off on another device.');
    await expect(second.locator('#share-board')).not.toBeChecked();
    await expect(second.locator('#friends-board-lists')).toBeHidden();
    expect(supabase.board.refused).toHaveLength(1);
    // And this tab, now off, sends nothing after a run.
    const requests = boardRequests(supabase);
    await openView(page, 'Practice');
    await chooseWords(page, 10);
    await completePassage(page);
    await page.waitForTimeout(2000);
    expect(boardRequests(supabase)).toBe(requests);
  } finally { await context.close(); }
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the board stacks on a phone and fits at 320px', async ({ page, supabase }, testInfo) => {
    const { ada } = circle(supabase);
    const day = dailyPassage();
    const dailyRun = { id: 'seed-daily', at: new Date().toISOString(), kind: 'daily', status: 'complete', interrupted: false, fresh: true,
      textId: day.sourceTextId, conditions: DAILY, score: { wpm: 84, accuracy: 97 }, elapsedMs: 41200, errors: 2, target: null,
      challengeDate: day.day, firstDailyAttempt: true, patterns: [] };
    sharing(supabase, ada, { runs: practiceThisWeek(18, [dailyRun]) });
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await signInWithEmail(page, 'ada@stilltype.test');
    await openView(page, 'Challenge');
    await page.locator('#challenge-friends').click();
    await expect(page.locator('#board-daily')).toContainText('You 84 wpm');
    // Opening the board sends this tab's summary, which the board had only as an empty week.
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
