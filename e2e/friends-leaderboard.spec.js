// The friends board: today's daily result and this week's practice time among mutual friends, read
// from each member's own profile row, where every profile save writes the summary of the copy it saves.
import { randomUUID } from 'node:crypto';
import { CORPUS_VERSION, METRIC_VERSION, conditionKey, quoteCorpus } from '../src/typing.js';
import { dailyPassage } from '../src/insights.js';
import { BOARD_V, dailyVersion } from '../src/friends-board.js';
import { test, expect, openApp, openView, openSettings, signInWithEmail, chooseWords, completePassage, passageText, typeInto } from './fixtures.js';
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
const MINUTE = 60000;

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
function practiceThisWeek(count, extra = [], shapes = SHAPES) {
  const now = Date.now();
  const monday = Date.parse(`${mondayOf()}T00:00:00Z`);
  const runs = Array.from({ length: count }, (_, i) => {
    const [shape, elapsedMs] = shapes[i % shapes.length];
    return { id: `seed-${i}`, at: new Date(Math.max(monday + 60000, now - (count - i) * 41 * 60000)).toISOString(),
      kind: 'test', status: 'complete', interrupted: false, fresh: true, textId: `seed-text-${i}`,
      conditions: { ...DAILY, ...shape, punctuation: false, quoteLength: null, difficulty: null },
      score: { wpm: 66 + ((i * 7) % 19), accuracy: 94 + (i % 5) }, elapsedMs, errors: i % 3, target: null, challengeDate: null, patterns: [] };
  });
  return [...runs, ...extra];
}

const profileData = (runs, updatedAt, { preferences = {}, seen = [] } = {}) => ({ version: 2, profileId: randomUUID(), preferences,
  attempts: [], runs, loops: [], seenTextIds: seen, bests: {}, updatedAt });

// The account's profile row as another device saved it, without a board summary (as before the column
// existed, or by an older build).
function seedProfile(supabase, user, runs, { updatedAt = new Date(Date.now() - 3600000).toISOString(), ...options } = {}) {
  supabase.profiles.set(user.id, { data: profileData(runs, updatedAt, options), updated_at: updatedAt, board: null });
}

// An account that shares, whose profile row holds this summary, stamped with that row's own save: this
// daily under its own date and this practice under its own week, as a summary keys them.
function shares(supabase, user, { daily = null, week = null } = {}) {
  const at = new Date(Date.now() - 3600000).toISOString();
  const keyed = (part, key) => {
    if (!part) return {};
    const { [key]: period, ...numbers } = part;
    return { [period]: numbers };
  };
  supabase.profiles.set(user.id, { data: profileData([], at), updated_at: at,
    board: { v: BOARD_V, at, days: keyed(daily, 'date'), weeks: keyed(week, 'start') } });
  supabase.board.joined(user.id);
}
const publish = (supabase, user, daily, seconds, runs) => shares(supabase, user, {
  daily: daily && { date: utcDay(), version: VERSION, ...daily }, week: { start: mondayOf(), seconds, runs } });

// What a device remembers of whether the account shares, as the board keeps it.
const sharingKey = (user) => `stilltype-board-sharing:${user.id}`;
const knownHere = (page, user) => page.evaluate((key) => localStorage.getItem(key), sharingKey(user));
const optOutsKept = (page) => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('stilltype-board-optout')));

// A device that remembers the account shares (or not), as it would after turning sharing on (or off) there.
const remembers = (page, user, value = '1') => page.addInitScript(([key, known]) => {
  try { if (localStorage.getItem(key) === null) localStorage.setItem(key, known); } catch {}
}, [sharingKey(user), value]);

// An account that turned sharing on already, on this device, whose profile row holds these runs and no
// summary yet: the first load writes one.
async function sharing(page, supabase, user, { runs = [], ...options } = {}) {
  seedProfile(supabase, user, runs, options);
  supabase.board.joined(user.id);
  await remembers(page, user);
}

// The board's friends_board requests so far.
const boardRequests = (supabase) => supabase.requests.filter((request) => request === 'POST /rest/v1/rpc/friends_board').length;
// The board actions one page sends from now on.
function boardActions(page) {
  const actions = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/rest/v1/rpc/friends_board')) actions.push(request.postDataJSON()?.p_action);
  });
  return actions;
}
// The summary in the account's own profile row.
const column = (supabase, user) => supabase.profiles.get(user.id)?.board ?? null;
// This week's run count in that summary (none yet reads as 0), or null when there is no summary.
const weekRuns = (supabase, user) => { const board = column(supabase, user); return board ? board.weeks?.[mondayOf()]?.runs ?? 0 : null; };

function befriend(supabase, owner, friend, name, { fromRace = false } = {}) {
  const list = supabase.races.friends.get(owner.id) || [];
  list.push(fromRace ? { id: randomUUID(), friendId: friend.id, name } : { id: randomUUID(), email: friend.email, name });
  supabase.races.friends.set(owner.id, list);
}

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

async function openBoard(page) {
  await openView(page, 'Challenge');
  await page.locator('#challenge-friends').click();
}
// Refresh does nothing while a read is on its way (a quiet one after a save, say), so it waits for that.
async function refreshBoard(page) {
  await expect(page.locator('#refresh-friends-board')).not.toHaveAttribute('aria-disabled', 'true');
  await page.locator('#refresh-friends-board').click();
}

// Clears history on the Progress screen.
async function clearHistory(page) {
  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(page.locator('#history-feedback')).toHaveText('History cleared.');
}

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

test('a daily run reaches the board with the profile save, and only mutual friends share the board', async ({ page, supabase }, testInfo) => {
  const { ada } = circle(supabase);
  // Saved by an earlier build that synced the sharing setting: membership alone says whether an account
  // shares, and Ada has none.
  seedProfile(supabase, ada, practiceThisWeek(24), { preferences: { shareBoard: true } });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  // Sharing is off by default: the board shows nobody and says why.
  await openBoard(page);
  await expect(page.locator('#friends-board-off')).toBeVisible();
  await expect(page.locator('#share-board')).not.toBeChecked();
  await expect(page.locator('#friends-board-lists')).toBeHidden();
  // Nothing was turned off anywhere, so the board says nothing about it.
  await expect(page.locator('#friends-board-status')).toHaveText('');
  // Her own profile row carries her summary whether or not she shares; only she can read it.
  await expect.poll(() => weekRuns(supabase, ada)).toBe(24);
  expect(supabase.board.members.has(ada.id)).toBe(false);
  await scrollBelow(page, '#friends-board-heading', 120);
  await shot(page, testInfo, 'board-off-light');
  // Turning it on makes her a member, sending no numbers, and the friends who share appear.
  const actions = boardActions(page);
  await page.locator('#share-board').check();
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  await expect(page.locator('#friends-board-off')).toBeHidden();
  await expect(page.locator('#share-board')).toBeFocused();
  expect(actions).toEqual(['share']);
  expect(supabase.board.members.has(ada.id)).toBe(true);
  await expect(page.locator('#board-week')).toContainText('24 runs');

  await page.locator('#challenge-daily').click();
  await page.locator('#start-daily').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'daily');
  // A human pace with two corrected slips, so the result reads like a real one.
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
  // The run reaches her row with the profile save, as the summary of exactly the copy saved.
  await expect.poll(() => column(supabase, ada)?.days?.[dailyPassage().day] ?? null).toEqual({ version: VERSION, wpm, accuracy, attempts: 1 });
  const row = supabase.profiles.get(ada.id);
  expect(row.board.at).toBe(row.updated_at);
  expect(row.board.weeks[mondayOf()].runs).toBe(25);
  expect(row.board.weeks[mondayOf()].seconds).toBeGreaterThan(880);

  await openBoard(page);
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  await expect(page.locator('#board-daily-meta')).toHaveText(`${utcDay()} · best completed attempt · physical keyboard`);
  await expect(page.locator('#board-daily')).toContainText(`You ${wpm} wpm`);
  // The board itself only ever reads.
  expect(actions.filter((action) => action !== 'board')).toEqual(['share']);

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

  // Lin, who shares, sees Ada under her own name for her, with the result Ada's row now holds.
  const context = await page.context().browser().newContext();
  const lin = await context.newPage();
  try {
    await supabase.attach(lin);
    await openApp(lin);
    await signInWithEmail(lin, 'lin@stilltype.test');
    await openBoard(lin);
    await expect(lin.locator('#board-daily')).toContainText(`Ada ${wpm} wpm`);
    expect(await rowTexts(lin, 'board-daily')).toHaveLength(2);
    // A result scored by another build of the daily is not compared, and Refresh keeps keyboard focus.
    column(supabase, ada).days[utcDay()].version = VERSION.replace(METRIC_VERSION, 'stilltype-metrics-v0');
    await lin.locator('#refresh-friends-board').focus();
    await lin.keyboard.press('Enter');
    await expect(lin.locator('#friends-board-status')).toHaveText('Updated.');
    await expect(lin.locator('#refresh-friends-board')).toBeFocused();
    expect(await rowTexts(lin, 'board-daily')).toContain('Ada — another version of the daily · not compared');
  } finally { await context.close(); }
});

test('practice time reaches the board with the profile save, and a board not yet set up says so', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  supabase.board.missing = true;
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  // New to this account, the device asks the board once whether it shares; the board isn't there yet.
  await expect.poll(() => boardRequests(supabase)).toBe(1);
  await chooseWords(page, 10);
  await completePassage(page);
  // The run rides the profile save into her own row; the board itself is asked nothing more.
  await expect.poll(() => weekRuns(supabase, ada)).toBe(1);
  expect(boardRequests(supabase)).toBe(1);
  await openBoard(page);
  await expect(page.locator('#friends-board-status')).toHaveText('The friends board is being set up. Please try again shortly.');
  await expect(page.locator('#friends-board-lists')).toBeHidden();

  supabase.board.missing = false;
  await refreshBoard(page);
  await expect(page.locator('#friends-board-status')).toHaveText('Updated.');
  await expect(page.locator('#friends-board-off')).toBeVisible();
  await expect(page.locator('#friends-board-lists')).toBeHidden();
  // Turned on with the keyboard: her row shows what her profile holds.
  await page.locator('#share-board').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  expect(supabase.board.calls.at(-1)).toBe('share');
  await expect(page.locator('#board-week .board-row')).toContainText(['1 run']);
  expect(await rowTexts(page, 'board-daily')).toEqual(['You — no completed attempt yet']);
  // Alone on the board: how friends get here, and a way to them.
  await expect(page.locator('#friends-board-empty')).toBeVisible();
  await page.locator('#friends-board-online').click();
  await expect(page.locator('#online-challenge')).toBeVisible();
  await expect(page.locator('#friends-board')).toBeHidden();
  await expect(page.locator('#challenge-online')).toBeFocused();
});

test('a save without the summary (an older build) hides it until a load repairs it, and a repair for a row that moved changes nothing', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  // Quotes, every one already seen: loading picks no new passage, so a load here saves nothing itself.
  const options = { preferences: { mode: 'quote' }, seen: quoteCorpus.map((quote) => quote.id) };
  // Her row was saved before the board column existed.
  await sharing(page, supabase, ada, { runs: practiceThisWeek(6), ...options });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  // The load repairs the summary from the row's own data, conditional on the row's version.
  await expect.poll(() => weekRuns(supabase, ada)).toBe(6);
  expect(supabase.profileWrites.map((write) => write.method)).toEqual(['PATCH']);
  expect(column(supabase, ada).at).toBe(supabase.profiles.get(ada.id).updated_at);
  await openBoard(page);
  await expect(page.locator('#board-week')).toContainText('6 runs');

  // An older cached build on another device saves a seventh run, leaving the summary as it was. It no
  // longer describes the row, so the board shows nothing yet rather than numbers from another copy.
  const saveElsewhere = (runs) => {
    const at = new Date(Date.parse(supabase.profiles.get(ada.id).updated_at) + 1000).toISOString();
    Object.assign(supabase.profiles.get(ada.id), { data: profileData(runs, at, options), updated_at: at });
  };
  saveElsewhere(practiceThisWeek(7));
  await refreshBoard(page);
  await expect(page.locator('#friends-board-status')).toHaveText('Updated.');
  await expect(page.locator('#board-week')).toContainText('You — nothing yet this week');

  // The next load repairs it, but its repair is slow to arrive, and that device saves an eighth run
  // first. The repair, counted from the seven-run row, then changes nothing.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let held = false;
  await page.route(/\/rest\/v1\/profiles\?/, async (route) => {
    if (route.request().method() === 'PATCH') { held = true; await gate; }
    await route.fallback();
  });
  await page.reload();
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await expect.poll(() => held).toBe(true);
  saveElsewhere(practiceThisWeek(8));
  const stale = column(supabase, ada);
  release();
  await expect.poll(() => supabase.requests.filter((request) => request.startsWith('PATCH ')).length).toBe(2);
  await page.unroute(/\/rest\/v1\/profiles\?/);
  expect(column(supabase, ada)).toEqual(stale);
  await openBoard(page);
  await expect(page.locator('#board-week')).toContainText('You — nothing yet this week');
  // A load that reads the eight-run row repairs it.
  await page.reload();
  await expect.poll(() => weekRuns(supabase, ada)).toBe(8);
  expect(supabase.profileWrites.map((write) => write.method)).toEqual(['PATCH', 'PATCH']);
  await openBoard(page);
  await expect(page.locator('#board-week')).toContainText('8 runs');
});

test('a project without the board column keeps profile sync working, leaving the summary out', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  supabase.boardColumnMissing = true;
  seedProfile(supabase, ada, practiceThisWeek(2));
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await chooseWords(page, 10);
  await completePassage(page);
  await expect.poll(() => supabase.profiles.get(ada.id).data.runs.length).toBe(3);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await expect(page.locator('#account-sync')).toHaveText('Saved to your account');
  // The first save that named the column was refused and went again without it; later saves leave it out.
  const posts = supabase.requests.filter((request) => request === 'POST /rest/v1/profiles').length;
  expect(supabase.profileWrites.length).toBeGreaterThanOrEqual(2);
  expect(posts).toBe(supabase.profileWrites.length + 1);
  expect(supabase.profileWrites.every((write) => write.board === undefined)).toBe(true);
  expect(supabase.requests.some((request) => request.startsWith('PATCH '))).toBe(false);
});

test('a midnight re-read that fails is tried again at the next check', async ({ page, supabase }) => {
  await sharing(page, supabase, supabase.addUser('ada@stilltype.test'));
  let now = '2026-10-03T23:50:00Z';
  supabase.board.now = () => new Date(now);
  await page.clock.install({ time: new Date(now) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openBoard(page);
  await expect(page.locator('#board-daily-meta')).toHaveText('2026-10-03 · best completed attempt · physical keyboard');
  // The first read after midnight fails, quietly; the next 30-second check reads Sunday's board.
  now = '2026-10-04T00:00:30Z';
  supabase.board.missing = true;
  const reads = boardRequests(supabase);
  await page.clock.fastForward('10:30');
  await expect.poll(() => boardRequests(supabase)).toBeGreaterThan(reads);
  await expect(page.locator('#friends-board-status')).toHaveText('');
  await expect(page.locator('#board-daily-meta')).toHaveText('2026-10-03 · best completed attempt · physical keyboard');
  supabase.board.missing = false;
  await page.clock.fastForward(30_000);
  await expect(page.locator('#board-daily-meta')).toHaveText('2026-10-04 · best completed attempt · physical keyboard');
  await expect(page.locator('#friends-board-status')).toHaveText('');
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
  shares(supabase, lin, { daily: result('2026-10-03', 78), week: lastWeek(2460, 37) });
  shares(supabase, mara, { week: lastWeek(1210, 20) });
  await sharing(page, supabase, ada);
  // Saturday, ten minutes before midnight UTC, on the page and the service alike.
  let now = '2026-10-03T23:50:00Z';
  supabase.board.now = () => new Date(now);
  await page.clock.install({ time: new Date(now) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openBoard(page);
  await expect(page.locator('#board-daily-meta')).toHaveText('2026-10-03 · best completed attempt · physical keyboard');
  expect(await rowTexts(page, 'board-daily')).toEqual(['Lin 78 wpm 97% accuracy · 1 attempt', 'You — no completed attempt yet', 'Mara — no completed attempt yet']);
  const actions = boardActions(page);

  // Past midnight, Mara plays Sunday's daily. The open board reads again without a Refresh, quietly.
  now = '2026-10-04T00:00:30Z';
  shares(supabase, mara, { daily: result('2026-10-04', 91), week: lastWeek(1250, 21) });
  await page.clock.fastForward('10:30');
  await expect(page.locator('#board-daily-meta')).toHaveText('2026-10-04 · best completed attempt · physical keyboard');
  expect(await rowTexts(page, 'board-daily')).toEqual(['Mara 91 wpm 97% accuracy · 1 attempt', 'You — no completed attempt yet', 'Lin — no completed attempt yet']);
  await expect(page.locator('#board-week-meta')).toHaveText('since monday 2026-09-28, 00:00 utc · completed runs');
  expect((await rowTexts(page, 'board-week')).slice(0, 2)).toEqual(['Lin 41 min 37 runs', 'Mara 20 min 21 runs']);
  await expect(page.locator('#friends-board-status')).toHaveText('');
  // The rollover only read.
  expect(actions.length).toBeGreaterThan(0);
  expect(actions.filter((action) => action !== 'board')).toEqual([]);

  // A tab hidden across Sunday night waits, then reads Monday's new week when it comes back.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  now = '2026-10-05T00:00:30Z';
  const before = boardRequests(supabase);
  await page.clock.fastForward('24:00:00');
  await page.waitForTimeout(500);
  expect(boardRequests(supabase)).toBe(before);
  await expect(page.locator('#board-week-meta')).toHaveText('since monday 2026-09-28, 00:00 utc · completed runs');
  await page.evaluate(() => {
    delete document.hidden;
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#board-week-meta')).toHaveText('since monday 2026-10-05, 00:00 utc · completed runs');
  await expect(page.locator('#board-daily-meta')).toHaveText('2026-10-05 · best completed attempt · physical keyboard');
  expect(await rowTexts(page, 'board-daily')).toEqual(['You — no completed attempt yet', 'Lin — no completed attempt yet', 'Mara — no completed attempt yet']);
  // Nobody has practised this week yet, Ada included: her row's summary is last week's.
  expect(await rowTexts(page, 'board-week')).toEqual(['You — nothing yet this week', 'Lin — nothing yet this week', 'Mara — nothing yet this week']);
  await expect(page.locator('#friends-board-status')).toHaveText('');
});

test('a run finished offline reaches the board once the browser is back online', async ({ page, context, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  await sharing(page, supabase, ada);
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await expect.poll(() => weekRuns(supabase, ada)).toBe(0);
  supabase.offline = true;
  await context.setOffline(true);
  await chooseWords(page, 10);
  await completePassage(page);
  await page.waitForTimeout(2500);
  expect(weekRuns(supabase, ada)).toBe(0);
  supabase.offline = false;
  await context.setOffline(false);
  await expect.poll(() => weekRuns(supabase, ada)).toBe(1);
});

test('F1: a stale device saving back a clock-fast run from before a clear puts it on the board exactly as Progress shows it', async ({ page, browser, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  // Three runs at one test shape this week, synced before the clear; one was made on a device whose
  // clock runs forty minutes fast, so it carries a time still in the future.
  const runs = practiceThisWeek(3, [], [SHAPES[0]]);
  const nextMonday = Date.parse(`${mondayOf()}T00:00:00Z`) + 7 * 86400000;
  runs[2] = { ...runs[2], id: 'fast-clock', at: new Date(Math.min(Date.now() + 40 * MINUTE, nextMonday - MINUTE)).toISOString() };
  await sharing(page, supabase, ada, { runs });
  // A correctly timed device of Ada's loads that history, and stays open with it.
  const context = await browser.newContext();
  const stale = await context.newPage();
  try {
    await supabase.attach(stale);
    await openApp(stale);
    await signInWithEmail(stale, 'ada@stilltype.test');
    // This device loads it too, and clears it: the row, and so the board, drop to nothing.
    await openApp(page);
    await signInWithEmail(page, 'ada@stilltype.test');
    await clearHistory(page);
    await expect.poll(() => weekRuns(supabase, ada)).toBe(0);
    await openBoard(page);
    await expect(page.locator('#board-week')).toContainText('You — nothing yet this week');
    // The stale device then saves a setting with the old history still in its copy. Sync is last
    // writer wins, so the row takes that copy back, and the board shows what the row holds: the same
    // three runs, the fast clock's included, no more and no fewer.
    await openSettings(stale);
    await stale.locator('#keyboard-toggle').check();
    await expect.poll(() => supabase.profiles.get(ada.id).data.runs.length).toBe(3);
    await expect.poll(() => weekRuns(supabase, ada)).toBe(3);
    const row = supabase.profiles.get(ada.id);
    expect(row.board.at).toBe(row.updated_at);
    await refreshBoard(page);
    await expect(page.locator('#board-week')).toContainText('3 runs');
    // This device, reloaded, reads that row: Progress lists the same three runs the board counts.
    await page.reload();
    await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
    await openView(page, 'Progress');
    await page.locator('#progress-period').selectOption('all');
    await expect(page.locator('#run-history .run-row')).toHaveCount(3);
    await openBoard(page);
    await expect(page.locator('#board-week')).toContainText('3 runs');
  } finally { await context.close(); }
});

test('F2: clear and undo twice while the first save is held on its way, and the board ends on the restored totals', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  await sharing(page, supabase, ada, { runs: practiceThisWeek(3) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await expect.poll(() => weekRuns(supabase, ada)).toBe(3);
  // The clear's save reaches the account, but its reply is held on the way back.
  let land;
  supabase.holdProfileWrite = new Promise((resolve) => { land = resolve; });
  await clearHistory(page);
  // Polled as a boolean: a returned promise would be awaited.
  await expect.poll(() => supabase.holdProfileWrite === null).toBe(true);
  expect(weekRuns(supabase, ada)).toBe(0);
  // Undo, clear again and undo again while that reply is still on its way; each saves its own copy.
  await page.locator('#undo-clear').click();
  await expect(page.locator('#history-feedback')).toHaveText('History restored.');
  await expect.poll(() => weekRuns(supabase, ada)).toBe(3);
  await clearHistory(page);
  await expect.poll(() => weekRuns(supabase, ada)).toBe(0);
  await page.locator('#undo-clear').click();
  await expect(page.locator('#history-feedback')).toHaveText('History restored.');
  await expect.poll(() => weekRuns(supabase, ada)).toBe(3);
  // The held reply lands last. Nothing waits on it, so the row and the board stay on the restored history.
  const writes = supabase.profileWrites.length;
  land();
  await page.waitForTimeout(500);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  expect(supabase.profileWrites.length).toBe(writes);
  expect(supabase.profiles.get(ada.id).data.runs).toHaveLength(3);
  expect(column(supabase, ada)).toMatchObject({ at: supabase.profiles.get(ada.id).updated_at, weeks: { [mondayOf()]: { runs: 3 } } });
  await openBoard(page);
  await expect(page.locator('#board-week')).toContainText('3 runs');
});

test('F3: a board reply ten seconds late, around another device’s clear, still leads to the run made after it', async ({ page, browser, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  await sharing(page, supabase, ada, { runs: practiceThisWeek(3) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openBoard(page);
  await expect(page.locator('#board-week')).toContainText('3 runs');
  // This device's next board read is answered ten seconds late.
  supabase.board.delayNextReply = 10000;
  await refreshBoard(page);
  // Meanwhile Ada's other device clears its history and makes one run.
  const context = await browser.newContext();
  const other = await context.newPage();
  try {
    await supabase.attach(other);
    await openApp(other);
    await signInWithEmail(other, 'ada@stilltype.test');
    await clearHistory(other);
    await openView(other, 'Practice');
    await chooseWords(other, 10);
    await completePassage(other);
    await expect.poll(() => supabase.profiles.get(ada.id).data.runs.length).toBe(1);
    await expect.poll(() => weekRuns(supabase, ada)).toBe(1);
    // The late reply arrives; whatever it held, the next read counts the run made after the clear.
    await expect(page.locator('#friends-board-status')).toHaveText('Updated.', { timeout: 20000 });
    await refreshBoard(page);
    await expect(page.locator('#board-week')).toContainText('1 run');
    await openBoard(other);
    await expect(other.locator('#board-week')).toContainText('1 run');
  } finally { await context.close(); }
});

test('sharing turned on during the account check takes effect at once, and the board shows the runs the check brings', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  // Another device then saves four runs from this week to the account, with sharing still off there.
  seedProfile(supabase, ada, practiceThisWeek(4), { updatedAt: new Date(Date.now() + 60000).toISOString() });
  let release;
  supabase.holdProfiles = new Promise((resolve) => { release = resolve; });
  await page.reload();
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await openBoard(page);
  await expect(page.locator('#friends-board-off')).toBeVisible();
  // Turned on while the check is still fetching: no numbers travel, so it goes at once.
  await page.locator('#share-board').check();
  await expect(page.locator('#share-board')).toBeChecked();
  await expect.poll(() => supabase.board.members.has(ada.id)).toBe(true);
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  supabase.holdProfiles = null;
  release();
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  // The check takes the newer profile (and, on master, moves this tab to Practice); its save puts the
  // four runs in the row, and the board reads them.
  await expect.poll(() => weekRuns(supabase, ada)).toBe(4);
  await openBoard(page);
  await expect(page.locator('#board-week')).toContainText('4 runs');
  await expect.poll(() => knownHere(page, ada)).toBe('1:1');
  expect(supabase.profiles.get(ada.id)?.data?.preferences).not.toHaveProperty('shareBoard');
});

test('an opt-out that fails is kept across a reload and sent before anything else, and until then this device’s saves carry no summary', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  await sharing(page, supabase, ada, { runs: practiceThisWeek(2) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openBoard(page);
  await expect(page.locator('#board-week')).toContainText('2 runs');
  // The board can't be reached when sharing is turned off.
  supabase.board.missing = true;
  await page.locator('#share-board').uncheck();
  await expect(page.locator('#friends-board-status')).toContainText('Your row comes off once the board can be reached.');
  expect(supabase.board.members.has(ada.id)).toBe(true);
  // Until it lands, this device shows nothing new: a run saves its history, and the row's summary goes.
  await openView(page, 'Practice');
  await chooseWords(page, 10);
  await completePassage(page);
  await expect.poll(() => supabase.profiles.get(ada.id).data.runs.length).toBe(3);
  expect(supabase.profileWrites.at(-1)).toMatchObject({ method: 'POST', board: null });
  expect(column(supabase, ada)).toBeNull();
  supabase.board.missing = false;

  // After a reload, the first thing sent to the board is the opt-out.
  const before = supabase.board.calls.length;
  await page.reload();
  await expect(page.locator('#text-display .char').first()).toBeVisible();
  await openBoard(page);
  await expect.poll(() => supabase.board.members.has(ada.id)).toBe(false);
  expect(supabase.board.calls[before]).toBe('unshare');
  await expect(page.locator('#share-board')).not.toBeChecked();
  await expect(page.locator('#friends-board-off')).toBeVisible();
  await expect(page.locator('#friends-board-lists')).toBeHidden();
  // Settled, the opt-out is no longer kept on the device, and nothing turned sharing back on.
  await expect.poll(() => optOutsKept(page)).toEqual([]);
  expect(supabase.board.calls.slice(before)).not.toContain('share');
  // Her saves carry her summary again, into her own row only.
  await openView(page, 'Practice');
  await chooseWords(page, 10);
  await completePassage(page);
  await expect.poll(() => weekRuns(supabase, ada)).toBe(4);
  expect(supabase.board.members.has(ada.id)).toBe(false);
});

test('turning sharing back on while an opt-out is still kept sends that opt-out first, then the share', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  await sharing(page, supabase, ada, { runs: practiceThisWeek(2) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openBoard(page);
  await expect(page.locator('#board-week')).toContainText('2 runs');
  supabase.board.missing = true;
  await page.locator('#share-board').uncheck();
  await expect(page.locator('#friends-board-status')).toContainText('Your row comes off once the board can be reached.');
  // While the board is still out of reach, turning it back on fails, and the opt-out stays kept. (A click:
  // the switch turns itself back off as soon as that fails, which check() would read as no change.)
  await page.locator('#share-board').click();
  await expect(page.locator('#friends-board-status')).toHaveText('The friends board is being set up. Please try again shortly.');
  await expect(page.locator('#share-board')).not.toBeChecked();
  expect(await optOutsKept(page)).toHaveLength(1);
  supabase.board.missing = false;
  const actions = boardActions(page);
  await page.locator('#share-board').check();
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  expect(actions).toEqual(['unshare', 'share']);
  expect(supabase.board.members.has(ada.id)).toBe(true);
  expect(await optOutsKept(page)).toEqual([]);
  await expect(page.locator('#share-board')).toBeChecked();
  await expect(page.locator('#board-week')).toContainText('2 runs');
});

test('a save made while an opt-out was unconfirmed leaves no summary, and turning sharing back on writes one from the row', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  await sharing(page, supabase, ada, { runs: practiceThisWeek(2) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openBoard(page);
  await expect(page.locator('#board-week')).toContainText('2 runs');
  // Sharing is turned off while the board can't be reached, and a run is saved meanwhile: no summary.
  supabase.board.missing = true;
  await page.locator('#share-board').uncheck();
  await expect(page.locator('#friends-board-status')).toContainText('Your row comes off once the board can be reached.');
  await openView(page, 'Practice');
  await chooseWords(page, 10);
  await completePassage(page);
  await expect.poll(() => supabase.profiles.get(ada.id).data.runs.length).toBe(3);
  expect(column(supabase, ada)).toBeNull();
  // The opt-out lands with the next board read.
  supabase.board.missing = false;
  await openBoard(page);
  await expect.poll(() => supabase.board.members.has(ada.id)).toBe(false);
  await expect.poll(() => optOutsKept(page)).toEqual([]);
  expect(column(supabase, ada)).toBeNull();
  // Turning sharing back on writes the summary of the row as it stands, so her row shows its three runs.
  await page.locator('#share-board').click();
  await expect(page.locator('#share-board')).toBeChecked();
  await expect(page.locator('#board-week')).toContainText('3 runs');
  expect(weekRuns(supabase, ada)).toBe(3);
  expect(supabase.profileWrites.at(-1).method).toBe('PATCH');
  expect(column(supabase, ada).at).toBe(supabase.profiles.get(ada.id).updated_at);
});

test('an opt-out still on its way is not undone by another device, and lands when it is retried', async ({ page, browser, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  seedProfile(supabase, ada, practiceThisWeek(2));
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openBoard(page);
  await page.locator('#share-board').check();
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  // She turns sharing off here while the board can't be reached. The rest of her account still syncs.
  supabase.board.missing = true;
  await page.locator('#share-board').uncheck();
  await expect(page.locator('#friends-board-status')).toContainText('Your row comes off once the board can be reached.');
  supabase.board.missing = false;
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  expect(supabase.board.members.has(ada.id)).toBe(true);
  const mark = supabase.board.calls.length;

  // Another device of hers loads meanwhile. She is still a member, so that device shows sharing on, as
  // the board says; but it shares nothing itself, and turns nothing back on for the account.
  const context = await browser.newContext();
  const other = await context.newPage();
  try {
    await supabase.attach(other);
    await openApp(other);
    await signInWithEmail(other, 'ada@stilltype.test');
    await openBoard(other);
    await expect(other.locator('#friends-board-lists')).toBeVisible();
    await expect(other.locator('#share-board')).toBeChecked();
    await other.waitForTimeout(2000);
    await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
    expect(supabase.board.calls.slice(mark)).not.toContain('share');
    expect(supabase.profiles.get(ada.id)?.data?.preferences?.shareBoard).not.toBe(true);

    // The first device tries again (here, from Refresh): she is off the board.
    await refreshBoard(page);
    await expect(page.locator('#friends-board-status')).toHaveText('Updated.');
    expect(supabase.board.members.has(ada.id)).toBe(false);
    await expect(page.locator('#share-board')).not.toBeChecked();
    // The other device learns it with its next read of the board, and says so quietly.
    await openView(other, 'Practice');
    await openBoard(other);
    await expect(other.locator('#friends-board-status')).toHaveText('Sharing was turned off on another device.');
    await expect(other.locator('#share-board')).not.toBeChecked();
    await expect(other.locator('#friends-board-lists')).toBeHidden();
    expect(supabase.board.calls.slice(mark)).not.toContain('share');
    expect(supabase.board.members.has(ada.id)).toBe(false);
  } finally { await context.close(); }
});

test('a share held on its way can’t undo an opt-out another device made meanwhile', async ({ page, browser, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  befriend(supabase, ada, lin, 'Lin');
  befriend(supabase, lin, ada, 'Ada');
  await sharing(page, supabase, ada, { runs: practiceThisWeek(3) });
  publish(supabase, lin, { wpm: 78, accuracy: 96, attempts: 2 }, 2460, 37);
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openBoard(page);
  await expect(page.locator('#board-week')).toContainText('Lin');
  // Her laptop has the board open too, sharing on.
  const laptopContext = await browser.newContext();
  const laptop = await laptopContext.newPage();
  const linContext = await browser.newContext();
  const linPage = await linContext.newPage();
  try {
    await supabase.attach(laptop);
    await openApp(laptop);
    await signInWithEmail(laptop, 'ada@stilltype.test');
    await openBoard(laptop);
    await expect(laptop.locator('#share-board')).toBeChecked();

    // On this device she turns sharing off, then on again; that share is held on its way.
    await page.locator('#share-board').uncheck();
    await expect(page.locator('#friends-board-status')).toHaveText('Your row is off the board.');
    let land;
    supabase.board.holdNext = new Promise((resolve) => { land = resolve; });
    await page.locator('#share-board').check();
    await expect.poll(() => supabase.board.holdNext === null).toBe(true);
    // Meanwhile she turns sharing off on the laptop, and the service confirms it.
    await laptop.locator('#share-board').uncheck();
    await expect(laptop.locator('#friends-board-status')).toHaveText('Your row is off the board.');
    expect(supabase.board.members.has(ada.id)).toBe(false);

    // The held share arrives after that newer opt-out: it is refused, and this device's switch says why.
    land();
    await expect(page.locator('#friends-board-status')).toHaveText('Sharing was turned off on another device.');
    await expect(page.locator('#share-board')).not.toBeChecked();
    await expect(page.locator('#friends-board-off')).toBeVisible();
    await expect(page.locator('#friends-board-lists')).toBeHidden();
    expect(supabase.board.members.has(ada.id)).toBe(false);
    // Nobody sees her: not Lin, and not her own laptop.
    await supabase.attach(linPage);
    await openApp(linPage);
    await signInWithEmail(linPage, 'lin@stilltype.test');
    await openBoard(linPage);
    await expect(linPage.locator('#friends-board-lists')).toBeVisible();
    await expect(linPage.locator('#friends-board-lists')).not.toContainText('Ada');
    await refreshBoard(laptop);
    await expect(laptop.locator('#friends-board-status')).toHaveText('Updated.');
    await expect(laptop.locator('#share-board')).not.toBeChecked();
    await expect(laptop.locator('#friends-board-lists')).toBeHidden();

    // Turned on again here, now that this device has read the opt-out, it shares.
    await page.locator('#share-board').check();
    await expect(page.locator('#friends-board-lists')).toBeVisible();
    await expect(page.locator('#friends-board-status')).toHaveText('');
    expect(supabase.board.members.has(ada.id)).toBe(true);
    await refreshBoard(linPage);
    await expect(linPage.locator('#friends-board-lists')).toContainText('Ada');
  } finally { await laptopContext.close(); await linContext.close(); }
});

test('a share waiting behind this device’s own opt-out counts only that opt-out, not another device’s', async ({ page, browser, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  await sharing(page, supabase, ada, { runs: practiceThisWeek(2) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openBoard(page);
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  const laptopContext = await browser.newContext();
  const laptop = await laptopContext.newPage();
  try {
    await supabase.attach(laptop);
    await openApp(laptop);
    await signInWithEmail(laptop, 'ada@stilltype.test');
    await openBoard(laptop);
    await expect(laptop.locator('#share-board')).toBeChecked();
    // Here she turns sharing off, held on its way, and straight back on: that share waits its turn.
    const actions = boardActions(page);
    let land;
    supabase.board.holdNext = new Promise((resolve) => { land = resolve; });
    await page.locator('#share-board').uncheck();
    await expect.poll(() => supabase.board.holdNext === null).toBe(true);
    await page.locator('#share-board').check();
    // Then she turns it off on the laptop, which lands first.
    await laptop.locator('#share-board').uncheck();
    await expect(laptop.locator('#friends-board-status')).toHaveText('Your row is off the board.');
    // This device's opt-out lands after it, and then the share, which was made before the laptop's
    // opt-out: it doesn't count.
    land();
    await expect(page.locator('#friends-board-status')).toHaveText('Sharing was turned off on another device.');
    await expect(page.locator('#share-board')).not.toBeChecked();
    expect(actions).toEqual(['unshare', 'share']);
    expect(supabase.board.members.has(ada.id)).toBe(false);
    await expect.poll(() => optOutsKept(page)).toEqual([]);
  } finally { await laptopContext.close(); }
});

test('sharing turned off in one tab and back on in another shares at the first click, with no word of another device', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  await sharing(page, supabase, ada, { runs: practiceThisWeek(2) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openBoard(page);
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  const second = await page.context().newPage();
  await supabase.attach(second);
  await openApp(second);
  await expect(second.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await openBoard(second);
  await expect(second.locator('#share-board')).toBeChecked();
  const actions = boardActions(page);
  for (let round = 0; round < 2; round += 1) {
    // Off in the second tab, confirmed; the first tab's switch follows at once.
    await second.locator('#share-board').uncheck();
    await expect(second.locator('#friends-board-status')).toHaveText('Your row is off the board.');
    await expect(page.locator('#share-board')).not.toBeChecked();
    expect(supabase.board.members.has(ada.id)).toBe(false);
    // On again in the first tab, having seen it off there: it shares with the version the second tab
    // read, so the first click counts.
    const mark = actions.length;
    await page.locator('#share-board').check();
    await expect(page.locator('#friends-board-lists')).toBeVisible();
    await expect(page.locator('#share-board')).toBeChecked();
    await expect(page.locator('#friends-board-status')).toHaveText('');
    expect(actions.slice(mark)).toEqual(['share']);
    expect(supabase.board.members.has(ada.id)).toBe(true);
    await expect(second.locator('#share-board')).toBeChecked();
  }
});

test('the palette turns sharing on at the first try in a tab whose board is hidden, after another tab turned it off', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  await sharing(page, supabase, ada, { runs: practiceThisWeek(2) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openBoard(page);
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  await openView(page, 'Practice');
  const second = await page.context().newPage();
  await supabase.attach(second);
  await openApp(second);
  await expect(second.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await openBoard(second);
  await second.locator('#share-board').uncheck();
  await expect(second.locator('#friends-board-status')).toHaveText('Your row is off the board.');
  // Back in the first tab, from the palette: the board opens (its read is overtaken by the switch) and
  // the share counts.
  const actions = boardActions(page);
  await page.bringToFront();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('share on friends');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('share on friends board');
  await page.keyboard.press('Enter');
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  await expect(page.locator('#share-board')).toBeChecked();
  await expect(page.locator('#friends-board-status')).toHaveText('');
  expect(actions.filter((action) => action !== 'board')).toEqual(['share']);
  expect(supabase.board.members.has(ada.id)).toBe(true);
});

test('a share waiting its turn in one tab can’t undo an opt-out made after it in another tab', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  await sharing(page, supabase, ada, { runs: practiceThisWeek(2) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openBoard(page);
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  const second = await page.context().newPage();
  await supabase.attach(second);
  await openApp(second);
  await expect(second.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await openBoard(second);
  await expect(second.locator('#share-board')).toBeChecked();
  // In the first tab she turns sharing off, held on its way, and straight back on: that share waits.
  let land;
  supabase.board.holdNext = new Promise((resolve) => { land = resolve; });
  await page.locator('#share-board').uncheck();
  await expect.poll(() => supabase.board.holdNext === null).toBe(true);
  await page.locator('#share-board').check();
  await expect(second.locator('#share-board')).not.toBeChecked();
  // Then, in the second tab, she turns it on and off again, and the service confirms both.
  await second.locator('#share-board').check();
  await expect(second.locator('#friends-board-lists')).toBeVisible();
  await second.locator('#share-board').uncheck();
  await expect(second.locator('#friends-board-status')).toHaveText('Your row is off the board.');
  expect(supabase.board.members.has(ada.id)).toBe(false);
  // The first tab reads the board meanwhile, and then its opt-out lands. The share waiting behind it was
  // made before the second tab's opt-out, so it doesn't count.
  await refreshBoard(page);
  await expect(page.locator('#friends-board-status')).toHaveText('Updated.');
  land();
  await expect(page.locator('#friends-board-status')).toHaveText('Sharing was turned off on another device.');
  await expect(page.locator('#share-board')).not.toBeChecked();
  expect(supabase.board.members.has(ada.id)).toBe(false);
  await expect(second.locator('#share-board')).not.toBeChecked();
  await expect.poll(() => optOutsKept(page)).toEqual([]);
});

test('turning sharing off takes your row off the board at once, and a device that missed it can’t share again', async ({ page, browser, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  befriend(supabase, ada, lin, 'Lin');
  befriend(supabase, lin, ada, 'Ada');
  await sharing(page, supabase, ada, { runs: practiceThisWeek(3) });
  publish(supabase, lin, { wpm: 78, accuracy: 96, attempts: 2 }, 2460, 37);
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  // A second tab of Ada's in this browser, and her laptop, both open since before she stops sharing.
  const second = await page.context().newPage();
  await supabase.attach(second);
  await openApp(second);
  await expect(second.locator('#account')).toHaveAttribute('data-sync', 'synced');
  const context = await browser.newContext();
  const linPage = await context.newPage();
  const laptopContext = await browser.newContext();
  const laptop = await laptopContext.newPage();
  try {
    await supabase.attach(laptop);
    await remembers(laptop, ada);
    await openApp(laptop);
    await signInWithEmail(laptop, 'ada@stilltype.test');
    await supabase.attach(linPage);
    await openApp(linPage);
    await signInWithEmail(linPage, 'lin@stilltype.test');
    await openBoard(linPage);
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
    expect(supabase.board.calls.at(-1)).toBe('unshare');
    expect(supabase.board.members.has(ada.id)).toBe(false);

    // Lin no longer sees her.
    await refreshBoard(linPage);
    await expect(linPage.locator('#friends-board-status')).toHaveText('Updated.');
    await expect(linPage.locator('#friends-board-lists')).not.toContainText('Ada');

    // The other tab in this browser knows at once: its switch is off.
    await openBoard(second);
    await expect(second.locator('#share-board')).not.toBeChecked();
    await expect(second.locator('#friends-board-lists')).toBeHidden();
    await expect(second.locator('#friends-board-status')).toHaveText('');

    // The laptop still thinks she shares. Its runs send nothing to the board, and its next read of the
    // board turns its own switch off, saying so quietly; it never shares again by itself.
    const fromLaptop = boardActions(laptop);
    await chooseWords(laptop, 10);
    await completePassage(laptop);
    await laptop.waitForTimeout(2000);
    expect(fromLaptop).toEqual([]);
    await openBoard(laptop);
    await expect(laptop.locator('#friends-board-status')).toHaveText('Sharing was turned off on another device.');
    await expect(laptop.locator('#share-board')).not.toBeChecked();
    await expect(laptop.locator('#friends-board-lists')).toBeHidden();
    expect(fromLaptop).toEqual(['board']);
    expect(supabase.board.members.has(ada.id)).toBe(false);
    // Her summary stays only in her own row, beside the history it is counted from.
    await expect.poll(() => weekRuns(supabase, ada)).toBe(4);
    await refreshBoard(linPage);
    await expect(linPage.locator('#friends-board-lists')).not.toContainText('Ada');
  } finally { await context.close(); await laptopContext.close(); }
});

test('an opt-out made in one tab stops the others at once, and another tab can send it', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  await sharing(page, supabase, ada, { runs: practiceThisWeek(2) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  const second = await page.context().newPage();
  await supabase.attach(second);
  await openApp(second);
  await expect(second.locator('#account')).toHaveAttribute('data-sync', 'synced');
  // In the first tab, sharing is turned off while the board can't be reached.
  await openBoard(page);
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  supabase.board.missing = true;
  await page.locator('#share-board').uncheck();
  await expect(page.locator('#friends-board-status')).toContainText('Your row comes off once the board can be reached.');
  supabase.board.missing = false;
  // The second tab stops at once: its run saves no summary...
  const fromSecond = boardActions(second);
  await chooseWords(second, 10);
  await completePassage(second);
  await expect.poll(() => supabase.profiles.get(ada.id).data.runs.length).toBe(3);
  expect(column(supabase, ada)).toBeNull();
  // ...and its next board request is the opt-out.
  await openBoard(second);
  await expect.poll(() => supabase.board.members.has(ada.id)).toBe(false);
  expect(fromSecond[0]).toBe('unshare');
  await expect.poll(() => optOutsKept(second)).toEqual([]);
  await expect(second.locator('#share-board')).not.toBeChecked();
  await expect(second.locator('#friends-board-off')).toBeVisible();
  expect(supabase.board.calls).not.toContain('share');
});

test('a board open in one tab follows sharing turned on in another at once, and only reads', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  befriend(supabase, ada, lin, 'Lin');
  befriend(supabase, lin, ada, 'Ada');
  publish(supabase, lin, { wpm: 78, accuracy: 96, attempts: 2 }, 2460, 37);
  seedProfile(supabase, ada, practiceThisWeek(3));
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  const second = await page.context().newPage();
  await supabase.attach(second);
  await openApp(second);
  await openBoard(second);
  await expect(second.locator('#friends-board-off')).toBeVisible();
  // The second tab's next read of the board is held on its way.
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  await second.route(/\/rest\/v1\/rpc\/friends_board$/, async (route) => { await gate; await route.fallback(); });
  const fromSecond = boardActions(second);
  // Sharing is turned on in the first tab.
  await openBoard(page);
  await page.locator('#share-board').check();
  await expect(page.locator('#board-week')).toContainText('Lin');
  // The second tab's switch follows at once, before its read of the board gets through.
  await expect(second.locator('#share-board')).toBeChecked();
  await expect(second.locator('#friends-board-off')).toBeHidden();
  open();
  await expect(second.locator('#board-week')).toContainText('Lin');
  await expect(second.locator('#friends-board-lists')).toBeVisible();
  // It only read.
  expect(fromSecond).toContain('board');
  expect(fromSecond.filter((action) => action !== 'board')).toEqual([]);
});

test('a board left open reads the new day by the service’s clock, not this device’s', async ({ page, supabase }) => {
  await sharing(page, supabase, supabase.addUser('ada@stilltype.test'));
  // This device's clock runs two minutes ahead of the service's.
  let now = '2026-10-03T23:48:00Z';
  supabase.board.now = () => new Date(now);
  await page.clock.install({ time: new Date('2026-10-03T23:50:00Z') });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openBoard(page);
  await expect(page.locator('#board-daily-meta')).toHaveText('2026-10-03 · best completed attempt · physical keyboard');
  // Past midnight here, not yet on the service: still Saturday's board.
  now = '2026-10-03T23:58:30Z';
  await page.clock.fastForward('10:30');
  await page.clock.fastForward(30_000);
  await expect(page.locator('#board-daily-meta')).toHaveText('2026-10-03 · best completed attempt · physical keyboard');
  // Past midnight on the service too: the next check reads Sunday's.
  now = '2026-10-04T00:00:30Z';
  await page.clock.fastForward('02:00');
  await expect(page.locator('#board-daily-meta')).toHaveText('2026-10-04 · best completed attempt · physical keyboard');
});

test('a device whose clock is behind, saving just after 00:00 UTC, still shows the new day’s daily and week', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  // Monday 00:05 UTC: Ada's phone, whose clock is right, played Monday's daily and saved it.
  const monday = '2026-10-05';
  const day = dailyPassage(new Date(`${monday}T00:05:00Z`));
  const played = { id: 'phone-daily', at: `${monday}T00:04:00.000Z`, kind: 'daily', status: 'complete', interrupted: false, fresh: true,
    textId: day.sourceTextId, conditions: DAILY, score: { wpm: 82, accuracy: 97 }, elapsedMs: 41200, errors: 1, target: null,
    challengeDate: monday, firstDailyAttempt: true, patterns: [] };
  await sharing(page, supabase, ada, { runs: [played], updatedAt: `${monday}T00:05:00.000Z` });
  // At 00:08 on the service she opens her laptop, whose clock is ten minutes slow: still Sunday there.
  supabase.board.now = () => new Date(`${monday}T00:08:00Z`);
  await page.clock.install({ time: new Date('2026-10-04T23:58:00Z') });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  // The laptop takes the newer row and saves it. Its summary files the run under the day it was played
  // for and the week it was run in, whatever the laptop's clock says.
  await expect.poll(() => supabase.profileWrites.filter((write) => write.method === 'POST').length).toBeGreaterThan(0);
  const row = supabase.profiles.get(ada.id);
  expect(row.updated_at < `${monday}T00:00:00Z`).toBe(true);
  expect(row.board.at).toBe(row.updated_at);
  expect(row.board.days[monday]).toEqual({ version: dailyVersion(conditionKey(DAILY), new Date(`${monday}T00:00:00Z`)), wpm: 82, accuracy: 97, attempts: 1 });
  expect(row.board.weeks[monday]).toEqual({ seconds: 41, runs: 1 });
  // The service, on Monday, shows both: to her, and to any friend reading her row.
  await openBoard(page);
  await expect(page.locator('#board-daily-meta')).toHaveText(`${monday} · best completed attempt · physical keyboard`);
  expect(await rowTexts(page, 'board-daily')).toEqual(['You 82 wpm 97% accuracy · 1 attempt']);
  expect(await rowTexts(page, 'board-week')).toEqual(['You 41 s 1 run']);
});

test('a board that can’t be read says so once, and the checks after it retry without a word', async ({ page, supabase }) => {
  await sharing(page, supabase, supabase.addUser('ada@stilltype.test'));
  supabase.board.missing = true;
  await page.clock.install();
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openBoard(page);
  const message = 'The friends board is being set up. Please try again shortly.';
  await expect(page.locator('#friends-board-status')).toHaveText(message);
  await expect(page.locator('#refresh-friends-board')).not.toHaveAttribute('aria-disabled', 'true');
  // Every change to the status line (a live region) from here on is counted.
  await page.evaluate(() => {
    window.statusChanges = 0;
    new MutationObserver((records) => { window.statusChanges += records.length; })
      .observe(document.getElementById('friends-board-status'), { childList: true, characterData: true, subtree: true });
  });
  for (let check = 0; check < 3; check += 1) {
    const reads = boardRequests(supabase);
    await page.clock.fastForward(30_000);
    await expect.poll(() => boardRequests(supabase)).toBeGreaterThan(reads);
    await expect(page.locator('#refresh-friends-board')).not.toHaveAttribute('aria-disabled', 'true');
  }
  expect(await page.evaluate(() => window.statusChanges)).toBe(0);
  await expect(page.locator('#friends-board-status')).toHaveText(message);
  // Refresh is the reader's own request, so it answers: here, that the board is back.
  supabase.board.missing = false;
  await refreshBoard(page);
  await expect(page.locator('#friends-board-status')).toHaveText('Updated.');
});

test('an opt-out another tab settled while this tab’s own try failed leaves sharing free to turn on again', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  await sharing(page, supabase, ada, { runs: practiceThisWeek(2) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  const second = await page.context().newPage();
  await supabase.attach(second);
  await openApp(second);
  await expect(second.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await openBoard(page);
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  // The first tab turns sharing off, and its opt-out is held on its way.
  let land;
  supabase.board.holdNext = new Promise((resolve) => { land = resolve; });
  await page.locator('#share-board').uncheck();
  await expect.poll(() => supabase.board.holdNext === null).toBe(true);
  // The second tab sends the opt-out too, with its next board request, and it lands; then the first
  // tab's own try fails.
  await openBoard(second);
  await expect.poll(() => supabase.board.members.has(ada.id)).toBe(false);
  supabase.board.missing = true;
  land();
  await expect(page.locator('#friends-board-status')).toHaveText('Your row is off the board.');
  supabase.board.missing = false;
  // Sharing is turned on again in the second tab. The first tab's next board request sends no opt-out
  // that would undo that choice.
  await second.locator('#share-board').check();
  await expect.poll(() => supabase.board.members.has(ada.id)).toBe(true);
  // The first tab hears of it at once (and reads the board for the rows).
  await expect(page.locator('#share-board')).toBeChecked();
  await expect(page.locator('#refresh-friends-board')).not.toHaveAttribute('aria-disabled', 'true');
  const fromPage = boardActions(page);
  await refreshBoard(page);
  await expect(page.locator('#friends-board-status')).toHaveText('Updated.');
  expect(fromPage).toEqual(['board']);
  expect(supabase.board.members.has(ada.id)).toBe(true);
  await expect(page.locator('#share-board')).toBeChecked();
});

test('a late reply to an older opt-out leaves a newer one kept, so it still goes out', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  await sharing(page, supabase, ada, { runs: practiceThisWeek(2) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  const second = await page.context().newPage();
  await supabase.attach(second);
  await openApp(second);
  await expect(second.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await openBoard(page);
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  // The first tab turns sharing off. The service takes it; its reply is slow to come back.
  let land;
  supabase.board.holdNextReply = new Promise((resolve) => { land = resolve; });
  await page.locator('#share-board').uncheck();
  await expect.poll(() => supabase.board.holdNextReply === null).toBe(true);
  expect(supabase.board.members.has(ada.id)).toBe(false);
  // The second tab sends that opt-out too and settles it, then turns sharing back on, then off again
  // while the board can't be reached: that newer opt-out is kept.
  await openBoard(second);
  await expect.poll(() => optOutsKept(second)).toEqual([]);
  await second.locator('#share-board').click();
  await expect(second.locator('#share-board')).toBeChecked();
  await expect.poll(() => supabase.board.members.has(ada.id)).toBe(true);
  supabase.board.missing = true;
  await second.locator('#share-board').click();
  await expect(second.locator('#friends-board-status')).toContainText('Your row comes off once the board can be reached.');
  expect(await optOutsKept(second)).toHaveLength(1);
  // The first tab's reply arrives now. It confirms only the opt-out it was sent for.
  land();
  await expect(page.locator('#friends-board-status')).toHaveText('Your row comes off once the board can be reached.');
  expect(await optOutsKept(page)).toHaveLength(1);
  expect(supabase.board.members.has(ada.id)).toBe(true);
  // So the next load sends it, and she is off the board.
  supabase.board.missing = false;
  await page.reload();
  await expect.poll(() => supabase.board.members.has(ada.id)).toBe(false);
  await expect.poll(() => optOutsKept(page)).toEqual([]);
});

test('sharing switched off, on and off again while the first is on its way keeps the last opt-out until it lands', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  await sharing(page, supabase, ada, { runs: practiceThisWeek(2) });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openBoard(page);
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  // Every opt-out sent after a share fails here.
  let shared = false;
  await page.route(/\/rest\/v1\/rpc\/friends_board$/, async (route) => {
    const action = route.request().postDataJSON()?.p_action;
    if (action === 'unshare' && shared) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'The board is unavailable.' }) });
    if (action === 'share') shared = true;
    return route.fallback();
  });
  const actions = boardActions(page);
  // Off, with that request held on its way; then on, and off again, before it lands.
  let land;
  supabase.board.holdNext = new Promise((resolve) => { land = resolve; });
  await page.locator('#share-board').click();
  await expect.poll(() => supabase.board.holdNext === null).toBe(true);
  await page.locator('#share-board').click();
  await expect(page.locator('#share-board')).toBeChecked();
  await page.locator('#share-board').click();
  await expect(page.locator('#share-board')).not.toBeChecked();
  land();
  // The requests go in the order made: the first opt-out, the share, then the last opt-out, which fails
  // and so stays kept.
  await expect(page.locator('#friends-board-status')).toHaveText('The board is unavailable. Your row comes off once the board can be reached.');
  expect(actions).toEqual(['unshare', 'share', 'unshare']);
  expect(await optOutsKept(page)).toHaveLength(1);
  expect(supabase.board.members.has(ada.id)).toBe(true);
  await page.unroute(/\/rest\/v1\/rpc\/friends_board$/);
  await page.reload();
  await expect.poll(() => supabase.board.members.has(ada.id)).toBe(false);
  await expect.poll(() => optOutsKept(page)).toEqual([]);
});

test('a slow board read answered before another tab turned sharing on changes nothing when it lands', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  seedProfile(supabase, ada, practiceThisWeek(2));
  // This browser has never read the board for her, so the first tab reads it once the account check is
  // done. The service answers at once (not sharing, version 0), but the answer is slow to come back.
  let land;
  supabase.board.holdNextRead = new Promise((resolve) => { land = resolve; });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await expect.poll(() => supabase.board.holdNextRead === null).toBe(true);
  // Meanwhile a second tab reads the board and turns sharing on.
  const second = await page.context().newPage();
  await supabase.attach(second);
  await openApp(second);
  await expect(second.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await openBoard(second);
  await second.locator('#share-board').click();
  await expect(second.locator('#friends-board-lists')).toBeVisible();
  expect(supabase.board.members.has(ada.id)).toBe(true);
  await expect.poll(() => knownHere(page, ada)).toBe('1:1');
  // The first tab's old answer lands now. It is older than what this browser holds: nothing changes.
  const landed = page.waitForResponse((response) => response.url().endsWith('/rest/v1/rpc/friends_board'));
  land();
  await landed;
  await page.waitForTimeout(1000);
  expect(await knownHere(page, ada)).toBe('1:1');
  await expect(second.locator('#share-board')).toBeChecked();
  await expect(second.locator('#friends-board-lists')).toBeVisible();
  await expect(second.locator('#friends-board-status')).toHaveText('');
  expect(supabase.board.members.has(ada.id)).toBe(true);
  // The first tab still shows sharing on: its palette says so without reading the board, and so does
  // the board, with no word of another device.
  await page.bringToFront();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('share on friends');
  await expect(page.locator('#palette-list [aria-selected="true"] .opt-hint')).toHaveText('on');
  await page.keyboard.press('Escape');
  await openBoard(page);
  await expect(page.locator('#share-board')).toBeChecked();
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  await expect(page.locator('#friends-board-status')).toHaveText('');
});

test('an opt-out whose reply was lost goes again before sharing is turned back on, and the share counts at the first click', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  seedProfile(supabase, ada, practiceThisWeek(2));
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openBoard(page);
  await expect(page.locator('#friends-board-off')).toBeVisible();
  await page.locator('#share-board').click();
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  expect(supabase.board.version(ada.id)).toBe(1);
  // She turns sharing off. The service applies it, but the reply is lost on its way back, so the opt-out
  // stays kept here.
  supabase.board.loseNextReply = true;
  await page.locator('#share-board').click();
  await expect(page.locator('#friends-board-status')).toContainText('Your row comes off once the board can be reached.');
  expect(supabase.board.members.has(ada.id)).toBe(false);
  expect(supabase.board.version(ada.id)).toBe(2);
  expect(await optOutsKept(page)).toHaveLength(1);
  // Turned back on, that same opt-out goes first. The service has applied it already, so it moves
  // nothing, and the share counts at the first click, with no word of another device.
  const actions = boardActions(page);
  await page.locator('#share-board').click();
  await expect(page.locator('#friends-board-status')).not.toHaveText('Turning sharing on…');
  expect(await page.locator('#friends-board-status').textContent()).toBe('');
  await expect(page.locator('#share-board')).toBeChecked();
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  expect(actions).toEqual(['unshare', 'share']);
  expect(supabase.board.members.has(ada.id)).toBe(true);
  expect(supabase.board.version(ada.id)).toBe(3);
  expect(await optOutsKept(page)).toEqual([]);
  await expect.poll(() => knownHere(page, ada)).toBe('1:3');
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the board stacks on a phone and fits at 320px', async ({ page, supabase }, testInfo) => {
    const { ada } = circle(supabase);
    const day = dailyPassage();
    const dailyRun = { id: 'seed-daily', at: new Date().toISOString(), kind: 'daily', status: 'complete', interrupted: false, fresh: true,
      textId: day.sourceTextId, conditions: DAILY, score: { wpm: 84, accuracy: 97 }, elapsedMs: 41200, errors: 2, target: null,
      challengeDate: day.day, firstDailyAttempt: true, patterns: [] };
    await sharing(page, supabase, ada, { runs: practiceThisWeek(18, [dailyRun]) });
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await signInWithEmail(page, 'ada@stilltype.test');
    await openBoard(page);
    await expect(page.locator('#board-daily')).toContainText('You 84 wpm');
    // Her row had no summary; this load wrote one from her history.
    expect(column(supabase, ada).days[day.day]).toEqual({ version: VERSION, wpm: 84, accuracy: 97, attempts: 1 });
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
