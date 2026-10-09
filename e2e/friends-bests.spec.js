// The friends board's Bests: each sharing friend's best on one test shape at a time.
import { randomUUID } from 'node:crypto';
import { CORPUS_VERSION, METRIC_VERSION, conditionKey } from '../src/typing.js';
import { test, expect, openApp, openView, signInWithEmail, chooseWords, passageText, typeInto } from './fixtures.js';
import { mondayOf, utcDay } from './fake-board.js';

test.setTimeout(120000);

const DAY_MS = 86400000;
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// Test conditions as the practice screen writes them, with the default word list and correction policy.
const shape = (overrides) => ({ mode: 'time', duration: 60, count: null, punctuation: false, quoteLength: null, difficulty: null, wordList: '200',
  inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, ...overrides });
const TIME60 = shape({});
const TIME30 = shape({ duration: 30 });
const WORDS25 = shape({ mode: 'words', duration: null, count: 25 });
const WORDS10 = shape({ mode: 'words', duration: null, count: 10 });
const K60 = conditionKey(TIME60);
const K30 = conditionKey(TIME30);
const K25 = conditionKey(WORDS25);
const K10 = conditionKey(WORDS10);
// The same 60-second shape scored by another build of the metric.
const K60_OLD = conditionKey({ ...TIME60, metricVersion: 'stilltype-metrics-v0' });
// A 60-second test with stop on error, and a medium quote.
const K60_STOP = conditionKey({ ...TIME60, correctionPolicy: 'mandatory' });
const KQUOTE = conditionKey(shape({ mode: 'quote', duration: null, wordList: null, quoteLength: 'medium', difficulty: 'any' }));

const dayAgo = (days, hour = 18) => {
  const date = new Date(Date.now() - days * DAY_MS);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
};
const day = (days) => utcDay(dayAgo(days));

// Ada's saved practice over the last ten days: mostly one-minute tests, some 30-second ones and a few
// 25-word ones, at human speeds. `extra` adds runs that must never count.
function practice(extra = []) {
  const plan = [[TIME60, 60000, 12], [TIME30, 30000, 6], [WORDS25, 19400, 3]];
  const runs = [];
  for (const [conditions, elapsedMs, count] of plan) {
    for (let i = 0; i < count; i += 1) {
      const at = new Date(Math.min(dayAgo(9 - (i % 9), 9 + (i % 10)).getTime(), Date.now() - 60000)).toISOString();
      runs.push({ id: `seed-${runs.length}`, at, kind: i % 4 === 3 ? 'retest' : 'test', status: 'complete', interrupted: false, fresh: true,
        textId: `seed-text-${runs.length}`, conditions, score: { wpm: 61 + ((i * 7 + Math.round(elapsedMs / 1000)) % 23), accuracy: 93 + (i % 6) },
        elapsedMs, errors: i % 3, target: null, challengeDate: null, patterns: [] });
    }
  }
  return [...runs, ...extra];
}
// Ada's fastest run on each shape in practice(): what her row should show.
const fastest = (runs, conditions) => runs.filter((run) => conditionKey(run.conditions) === conditionKey(conditions) && ['test', 'retest'].includes(run.kind))
  .sort((a, b) => b.score.wpm - a.score.wpm || b.score.accuracy - a.score.accuracy || Date.parse(a.at) - Date.parse(b.at))[0];

function seedProfile(supabase, user, runs) {
  const updatedAt = new Date(Date.now() - 3600000).toISOString();
  supabase.profiles.set(user.id, { data: { version: 2, profileId: randomUUID(), preferences: {}, attempts: [], runs, loops: [], seenTextIds: [], bests: {}, updatedAt }, updated_at: updatedAt });
}
// A device that remembers the account shares, as it would after turning sharing on there.
const remembers = (page, user) => page.addInitScript((key) => {
  try { if (localStorage.getItem(key) === null) localStorage.setItem(key, '1'); } catch {}
}, `stilltype-board-sharing:${user.id}`);
// An account that turned sharing on already, on this device: its row on the board, without bests yet.
async function sharing(page, supabase, user, runs) {
  seedProfile(supabase, user, runs);
  supabase.board.summaries.set(user.id, { daily: null, week: { start: mondayOf(), seconds: 0, runs: 0 }, bests: {} });
  await remembers(page, user);
}
function befriend(supabase, owner, friend, name) {
  const list = supabase.races.friends.get(owner.id) || [];
  list.push({ id: randomUUID(), email: friend.email, name });
  supabase.races.friends.set(owner.id, list);
}
const best = (wpm, accuracy, days) => ({ wpm, accuracy, date: day(days) });
const shares = (supabase, user, bests) => supabase.board.summaries.set(user.id, { daily: null, week: { start: mondayOf(), seconds: 900, runs: 12 }, bests });

// Ada has chosen Lin, Mara and Sam, and they chose her. Ada also has Ola, who never added her back,
// and Kai has added Ada without Ada adding Kai. Neither of those two may ever appear.
function circle(supabase) {
  const [ada, lin, mara, sam, ola, kai] = ['ada', 'lin', 'mara', 'sam', 'ola', 'kai'].map((name) => supabase.addUser(`${name}@stilltype.test`));
  for (const [friend, name] of [[lin, 'Lin'], [mara, 'Mara'], [sam, 'Sam Okafor'], [ola, 'Ola']]) befriend(supabase, ada, friend, name);
  for (const friend of [lin, mara, sam, kai]) befriend(supabase, friend, ada, 'Ada');
  shares(supabase, lin, { [K60]: best(78, 96, 3), [K30]: best(84, 97, 1) });
  shares(supabase, mara, { [K60]: best(91, 98, 5), [K25]: best(88, 95, 2) });
  // Sam's only one-minute best was scored by another build: never compared.
  shares(supabase, sam, { [K60_OLD]: best(102, 99, 30), [K30]: best(69, 94, 4) });
  shares(supabase, ola, { [K60]: best(105, 99, 1) });
  shares(supabase, kai, { [K60]: best(99, 97, 1) });
  return { ada, lin };
}

// Each row as it reads aloud: name, value and unit, then the detail.
const rowTexts = (page) => page.locator('#board-bests .board-row').evaluateAll((rows) => rows.map((row) => row.textContent.replace(/\s+/g, ' ').trim()));
const scrollBelow = (page, selector, offset) => page.evaluate(([css, gap]) => {
  window.scrollTo(0, document.querySelector(css).getBoundingClientRect().top + window.scrollY - gap);
}, [selector, offset]);
async function shot(page, testInfo, name) {
  const path = process.env.SCREENSHOTS ? `docs/screenshots/friends-bests/${name}.png` : testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
}
async function openBoard(page) {
  await openView(page, 'Challenge');
  await page.locator('#challenge-friends').click();
  await expect(page.locator('#friends-board-lists')).toBeVisible();
}
async function clearHistory(page) {
  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
  await expect(page.locator('#history-feedback')).toHaveText('History cleared.');
}
// A ten-word test typed at a human pace (about 90 wpm), as a person would.
async function typeTenWords(page) {
  await chooseWords(page, 10);
  await typeInto(page, await passageText(page), '#typing-input', { delay: 130 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  return { wpm: Number(await page.locator('#result-wpm').textContent()), accuracy: Number(await page.locator('#result-accuracy').textContent()) };
}

test('each mutual friend’s best on the picked shape, ranked, with a keyboard picker', async ({ page, supabase }, testInfo) => {
  const { ada } = circle(supabase);
  const runs = practice();
  await sharing(page, supabase, ada, runs);
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openBoard(page);
  // Opening the board sends Ada's bests: her fastest run on each shape she has practised.
  await expect.poll(() => supabase.board.published.length).toBe(1);
  const own60 = fastest(runs, TIME60);
  expect(Object.keys(supabase.board.published[0].bests).sort()).toEqual([K60, K30, K25].sort());
  expect(supabase.board.published[0].bests[K60]).toEqual({ wpm: own60.score.wpm, accuracy: own60.score.accuracy, date: own60.at.slice(0, 10) });

  // The picker is labelled, lists the shapes the board can compare, and opens on the one Ada has run most.
  const picker = page.locator('#friends-board').getByLabel('Test conditions');
  await expect(picker).toHaveValue(K60);
  await expect(picker.locator('option')).toHaveText(['30 s · plain', '60 s · plain', '25 words · plain']);
  await expect(page.locator('#board-bests-meta')).toHaveText('english 200 · 60 s · plain · physical keyboard · continue on error · corpus v5 · metric v1 · best completed test or retest · dates in utc');
  const rows = await rowTexts(page);
  expect(rows).toEqual([
    `Mara 91 wpm 98% accuracy · ${day(5)}`,
    `You ${own60.score.wpm} wpm ${own60.score.accuracy}% accuracy · ${own60.at.slice(0, 10)}`,
    `Lin 78 wpm 96% accuracy · ${day(3)}`,
    'Sam Okafor — another version of this shape · not compared',
  ]);
  await expect(page.locator('#board-bests [data-self] .board-name')).toHaveText('You');
  // Someone who never chose Ada back, and someone Ada never chose, stay off her board.
  await expect(page.locator('#board-bests')).not.toContainText('Ola');
  await expect(page.locator('#board-bests')).not.toContainText('Kai');
  await expect(page.locator('#board-bests')).not.toContainText('105');

  await scrollBelow(page, '#board-bests-heading', 220);
  await shot(page, testInfo, 'bests-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(15, 15, 14)');
  await page.waitForTimeout(400);
  await shot(page, testInfo, 'bests-dark');

  // From the keyboard: one step up is the 30-second shape, where Sam's best counts.
  await picker.focus();
  await page.keyboard.press('ArrowUp');
  await expect(picker).toHaveValue(K30);
  await expect(picker).toBeFocused();
  const own30 = fastest(runs, TIME30);
  expect(own30.score.wpm).toBeGreaterThan(69);
  expect(own30.score.wpm).toBeLessThan(84);
  expect(await rowTexts(page)).toEqual([
    `Lin 84 wpm 97% accuracy · ${day(1)}`,
    `You ${own30.score.wpm} wpm ${own30.score.accuracy}% accuracy · ${own30.at.slice(0, 10)}`,
    `Sam Okafor 69 wpm 94% accuracy · ${day(4)}`,
    'Mara — no best on this shape yet',
  ]);
  // The pick holds across a Refresh.
  await page.locator('#refresh-friends-board').click();
  await expect(page.locator('#friends-board-status')).toHaveText('Updated.');
  await expect(picker).toHaveValue(K30);

  // Lin, who shares, sees Ada's bests under her own name for her.
  const context = await page.context().browser().newContext();
  const lin = await context.newPage();
  try {
    await supabase.attach(lin);
    await openApp(lin);
    await signInWithEmail(lin, 'lin@stilltype.test');
    await openBoard(lin);
    await lin.locator('#board-shape').selectOption(K60);
    expect(await rowTexts(lin)).toContain(`Ada ${own60.score.wpm} wpm ${own60.score.accuracy}% accuracy · ${own60.at.slice(0, 10)}`);
  } finally { await context.close(); }
});

test('only completed practice tests and retests are shared, never drills, dailies, races or interrupted runs', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const at = new Date(Date.now() - 3600000).toISOString();
  const fast = (id, overrides) => ({ id, at, kind: 'test', status: 'complete', interrupted: false, fresh: true, textId: `text-${id}`,
    conditions: TIME60, score: { wpm: 108, accuracy: 99 }, elapsedMs: 60000, errors: 0, target: null, challengeDate: null, patterns: [], ...overrides });
  const runs = [
    fast('test', { score: { wpm: 64, accuracy: 95 } }),
    fast('drill', { kind: 'drill', target: 'th' }),
    fast('daily', { kind: 'daily', conditions: shape({ mode: 'quote', duration: null, quoteLength: 'medium', difficulty: 'any', wordList: null, punctuation: true }), challengeDate: utcDay() }),
    fast('race', { kind: 'race' }),
    fast('custom', { kind: 'custom' }),
    fast('interrupted', { kind: 'test', interrupted: true }),
    fast('abandoned', { kind: 'retest', status: 'interrupted' }),
    fast('drill-shape', { kind: 'drill', conditions: TIME30 }),
  ];
  await sharing(page, supabase, ada, runs);
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openBoard(page);
  await expect.poll(() => supabase.board.published.length).toBe(1);
  expect(supabase.board.published[0].bests).toEqual({ [K60]: { wpm: 64, accuracy: 95, date: at.slice(0, 10) } });
  expect(await rowTexts(page)).toEqual([`You 64 wpm 95% accuracy · ${at.slice(0, 10)}`]);

  // A daily run finished here changes the daily row and the week, but not the bests.
  await page.locator('#challenge-daily').click();
  await page.locator('#start-daily').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'daily');
  await typeInto(page, await passageText(page), '#typing-input', { delay: 120 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect.poll(() => supabase.board.published.length).toBe(2);
  expect(supabase.board.published[1].daily).not.toBeNull();
  expect(supabase.board.published[1].bests).toEqual({ [K60]: { wpm: 64, accuracy: 95, date: at.slice(0, 10) } });
});

test('a run stored while a clock was far off never stops sharing from turning on', async ({ page, supabase }) => {
  const { ada } = circle(supabase);
  const runs = practice();
  const own60 = fastest(runs, TIME60);
  const own30 = fastest(runs, TIME30);
  // The fastest on their shapes: one stored while a clock read four days ahead, one while a clock read
  // a year before Stilltype. The service refuses either date, so neither travels.
  const ahead = { ...own60, id: 'ahead', textId: 'text-ahead', at: new Date(Date.now() + 4 * DAY_MS).toISOString(), score: { wpm: 109, accuracy: 99 } };
  const behind = { ...own30, id: 'behind', textId: 'text-behind', at: '2025-06-01T12:00:00.000Z', score: { wpm: 107, accuracy: 99 } };
  seedProfile(supabase, ada, [...runs, ahead, behind]);
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#challenge-friends').click();
  await expect(page.locator('#share-board')).not.toBeChecked();
  await page.locator('#share-board').check();
  await expect(page.locator('#friends-board-lists')).toBeVisible();
  await expect(page.locator('#share-board')).toBeChecked();
  await expect(page.locator('#friends-board-status')).toHaveText('');
  expect(supabase.board.published).toHaveLength(1);
  expect(supabase.board.published[0]).toMatchObject({ action: 'share', week: { start: mondayOf() } });
  expect(supabase.board.published[0].bests[K60]).toEqual({ wpm: own60.score.wpm, accuracy: own60.score.accuracy, date: own60.at.slice(0, 10) });
  expect(supabase.board.published[0].bests[K30]).toEqual({ wpm: own30.score.wpm, accuracy: own30.score.accuracy, date: own30.at.slice(0, 10) });
  expect(supabase.board.summaries.get(ada.id).sharing).not.toBe(false);
});

test('a clear takes your bests off the board, and undo brings them back', async ({ page, browser, supabase }) => {
  const { ada } = circle(supabase);
  const runs = practice();
  await sharing(page, supabase, ada, runs);
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  // A run typed here sets a best on a new shape, and goes to the board after the run.
  const typed = await typeTenWords(page);
  expect(typed.wpm).toBeGreaterThanOrEqual(40);
  expect(typed.wpm).toBeLessThanOrEqual(110);
  await expect.poll(() => supabase.board.summaries.get(ada.id).bests[K10]?.wpm).toBe(typed.wpm);
  const before = supabase.board.summaries.get(ada.id).bests;
  expect(Object.keys(before).sort()).toEqual([K60, K30, K25, K10].sort());

  // Lin sees them.
  const context = await browser.newContext();
  const lin = await context.newPage();
  try {
    await supabase.attach(lin);
    await openApp(lin);
    await signInWithEmail(lin, 'lin@stilltype.test');
    await openBoard(lin);
    await lin.locator('#board-shape').selectOption(K60);
    await expect(lin.locator('#board-bests')).toContainText(`Ada ${before[K60].wpm} wpm`);

    // Ada clears her history: the clear replaces her row, bests and all.
    await clearHistory(page);
    await expect.poll(() => supabase.board.published.at(-1)?.action).toBe('replace');
    await expect.poll(() => supabase.board.summaries.get(ada.id).bests).toEqual({});
    await lin.locator('#refresh-friends-board').click();
    await expect(lin.locator('#friends-board-status')).toHaveText('Updated.');
    expect(await rowTexts(lin)).toContain('Ada — no best on this shape yet');

    // Undo puts them back the way it puts back the week: the restored history's bests replace the row.
    await page.locator('#undo-clear').click();
    await expect(page.locator('#history-feedback')).toHaveText('History restored.');
    await expect.poll(() => supabase.board.summaries.get(ada.id).bests).toEqual(before);
    expect(supabase.board.published.at(-1)).toMatchObject({ action: 'replace', bests: before });
    await lin.locator('#refresh-friends-board').click();
    await expect(lin.locator('#board-bests')).toContainText(`Ada ${before[K60].wpm} wpm`);
    await openBoard(page);
    await page.locator('#board-shape').selectOption(K10);
    expect(await rowTexts(page)).toContain(`You ${typed.wpm} wpm ${typed.accuracy}% accuracy · ${utcDay()}`);
  } finally { await context.close(); }
});

test('a tab that missed a clear can’t put the cleared bests back', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const runs = practice();
  await sharing(page, supabase, ada, runs);
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  // A second tab, loaded before the clear, keeps the runs and their bests in its copy.
  const second = await page.context().newPage();
  await supabase.attach(second);
  await openApp(second);
  await expect(second.locator('#account')).toHaveAttribute('data-sync', 'synced');

  await clearHistory(page);
  await expect.poll(() => supabase.board.published.at(-1)?.action).toBe('replace');
  const { clear } = supabase.board.summaries.get(ada.id);
  expect(supabase.board.summaries.get(ada.id).bests).toEqual({});

  // The stale tab finishes a run. Sent with every best it holds, it is refused; it learns the clear and
  // sends only the bests set since, so the cleared ones stay off the board.
  const typed = await typeTenWords(second);
  await expect.poll(() => supabase.board.published.at(-1)?.action).toBe('publish');
  expect(supabase.board.refused).toHaveLength(1);
  expect(Object.keys(supabase.board.refused[0].bests).sort()).toEqual([K60, K30, K25, K10].sort());
  expect(supabase.board.published.at(-1)).toMatchObject({ clear: clear.id, bests: { [K10]: { wpm: typed.wpm, accuracy: typed.accuracy } } });
  expect(supabase.board.summaries.get(ada.id).bests).toEqual({ [K10]: { wpm: typed.wpm, accuracy: typed.accuracy, date: utcDay() } });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the bests fit a phone and 320px', async ({ page, supabase }, testInfo) => {
    const { ada, lin } = circle(supabase);
    await sharing(page, supabase, ada, practice());
    await openApp(page);
    await signInWithEmail(page, 'ada@stilltype.test');
    await openBoard(page);
    await expect(page.locator('#board-bests .board-row')).toHaveCount(4);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await scrollBelow(page, '#board-bests-heading', 24);
    await shot(page, testInfo, 'bests-phone-light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(15, 15, 14)');
    await page.waitForTimeout(400);
    await shot(page, testInfo, 'bests-phone-dark');
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // Nothing in the section is cut off: every line fits its column.
    const clipped = await page.locator('#friends-board-lists .board-bests').evaluate((section) => [...section.querySelectorAll('*')]
      .filter((node) => node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflow !== 'visible' && node.tagName !== 'SELECT').map((node) => node.id || node.className));
    expect(clipped).toEqual([]);
    const select = await page.locator('#board-shape').boundingBox();
    const column = await page.locator('#friends-board-lists .board-bests').boundingBox();
    expect(select.x + select.width).toBeLessThanOrEqual(column.x + column.width + 0.5);

    // With shapes that differ in more than length and text (a correction policy, a quote), the closed
    // select at 320px still tells every shape apart: what differs comes right after the length and text,
    // so the part a long name loses to the ellipsis is never the part that tells it apart. The shape it
    // opens on fits whole.
    shares(supabase, lin, { [K60]: best(78, 96, 3), [K60_STOP]: best(74, 98, 2), [KQUOTE]: best(66, 97, 6) });
    await page.locator('#refresh-friends-board').click();
    await expect(page.locator('#friends-board-status')).toHaveText('Updated.');
    const picker = page.locator('#board-shape');
    await expect(picker.locator('option')).toHaveText(['30 s · plain · continue on error', '60 s · plain · stop on error', '60 s · plain · continue on error',
      '25 words · plain · continue on error', 'medium quote · any · continue on error']);
    await expect(picker).toHaveValue(K60);
    const shown = await picker.evaluate((node) => {
      const style = getComputedStyle(node);
      const context = document.createElement('canvas').getContext('2d');
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      // The text's room: the box inside its padding, less the native arrow.
      const room = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 20;
      // What the closed select shows of a name: all of it, or as much as fits before an ellipsis.
      const visible = (text) => {
        if (context.measureText(text).width <= room) return text;
        let end = text.length;
        while (end > 0 && context.measureText(`${text.slice(0, end)}…`).width > room) end -= 1;
        return `${text.slice(0, end)}…`;
      };
      return { selected: visible(node.selectedOptions[0].textContent), options: [...node.options].map((option) => visible(option.textContent)) };
    });
    expect(shown.selected).toBe('60 s · plain · continue on error');
    expect(new Set(shown.options).size).toBe(5);
  });
});
