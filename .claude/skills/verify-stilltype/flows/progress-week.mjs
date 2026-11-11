// Progress, "What changed" (TOB-420). A new guest's page, then accounts whose history another device synced, dated
// from today: a week with a gain (a pair fixed, a pair fixed by pace since its drill, a pair slipping, practice
// down), a week with a drop, a week with no change, and one week of history only. Shots: each lead and list, the
// conditions control open, every detail view and the way back, a slipping pair's drill, and Clear history then Undo.
// PROGRESS_ONLY=gain (or drop, flat, week, guest) runs one account.
import { englishFrequency } from '../../../../src/learner.js';
import { CORPUS_VERSION, METRIC_VERSION } from '../../../../src/typing.js';

const conditions = { mode: 'words', count: 25, punctuation: false, numbers: false, wordList: '1k', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };

const BACKGROUND = [...englishFrequency().pairs].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([pair]) => pair);
const NAMED = ['qu', 'ol', 'ex', 'th'];

const local = (daysAgo, hour) => {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, 10 + (daysAgo * 7) % 40);
};

const dayOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// Common pairs at the run's pace, one in three missed once in ten tries (a pooled miss rate near 3%), then the rows given.
const run = (id, daysAgo, hour, wpm, rows) => {
  const when = local(daysAgo, hour);

  return { id, at: when.toISOString(), day: dayOf(when), kind: 'test', status: 'complete', interrupted: false, fresh: true, conditions, textId: id,
    score: { wpm, accuracy: 95 + ((wpm * 7) % 40) / 10 }, elapsedMs: 21_000 + (wpm % 9) * 1000, errors: 3, target: null, keys: [], keysVersion: 0, missedWords: [],
    patterns: [...BACKGROUND.filter((pair) => !NAMED.includes(pair) && !rows.some((row) => row[0] === pair)).map((pair, i) => [pair, 10, i % 3 ? 0 : 1, 10, 200, 0]), ...rows] };
};

const loop = (id, target, after, extra) => ({ id, at: after.at, beforeAttemptId: null, afterAttemptId: after.id, target, recommendationKind: 'targeted',
  policy: 'learner-decay-timing@1', focus: 'balanced', drillCompleted: true, conditions, comparison: { comparable: true, state: 'improved', wpmDelta: 3, accuracyDelta: 1.5 },
  targetTiming: null, targetMisses: null, targetPace: null, drill: { target, duration: 30, wordList: '1k' }, ...extra });

// Last week: "qu" missed now and then, "ol" slow, "ex" clean. This week: "qu" clean, "ol" at pace since its drill,
// "ex" missed. Speeds by `shape`: gain, drop or flat.
export function history(shape = 'gain') {
  const speeds = { gain: [[70, 72, 74, 73, 75, 71, 74], [76, 78, 77, 79, 78, 80, 77, 79]], drop: [[78, 80, 79, 81, 80, 79, 82], [74, 75, 73, 76, 75, 74, 76, 75]],
    flat: [[74, 76, 75, 77, 75, 74, 76], [75, 76, 74, 75, 77, 75, 74, 76]] }[shape];
  const before = speeds[0].map((wpm, i) => run(`b${i}`, 13 - i, 18, wpm, [['qu', 8, 1, 8, 200, 0], ['ol', 12, 0, 12, 300, 100], ['ex', 8, 0, 8, 200, 0]]));
  const retest = run('retest-ol', 6, 9, 75, [['ol', 12, 0, 12, 200, 0], ['qu', 15, 0, 15, 200, 0]]);
  const after = speeds[1].map((wpm, i) => run(`a${i}`, Math.max(0, 5 - i), 12 + (i % 3) * 3, wpm, [['qu', 15, 0, 15, 200, 0], ['ol', 12, 0, 12, 195, -5], ['ex', 8, 2, 8, 200, 0]]));
  const loops = [loop('loop-ol', 'ol', retest, { targetBasis: 'slow', targetPace: { target: 'ol', was: { slowMs: 100, timed: 60, timedRuns: 5, slowRuns: 5 }, now: { slowMs: 0, timed: 12 } } })];
  // Practice: more minutes the week before than this week.
  const practiceDays = Object.fromEntries([8, 9, 10, 11].map((back) => [dayOf(local(back, 12)), 20 * 60_000]));

  return { version: 2, preferences: { mode: 'words', count: 25, wordList: '1k' }, attempts: [], runs: [...before, retest, ...after], loops, practiceDays, seenTextIds: [], bests: {},
    updatedAt: new Date().toISOString() };
}

// One week of history only: five runs this week.
export function firstWeek() {
  const runs = [72, 75, 74, 77, 76].map((wpm, i) => run(`w${i}`, 4 - i, 19, wpm, []));

  return { version: 2, preferences: { mode: 'words', count: 25, wordList: '1k' }, attempts: [], runs, loops: [], seenTextIds: [], bests: {}, updatedAt: new Date().toISOString() };
}

export default async ({ page, h, shot, note, check, fake }) => {
  const only = process.env.PROGRESS_ONLY || '';
  const want = (name) => !only || only === name;
  const width = page.viewportSize().width;
  const sideways = async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const rows = async () => page.locator('#week-movers > li:not([hidden])').evaluateAll((items) => items.map((item) => `${item.dataset.unit || 'practice'}:${item.dataset.status || item.querySelector('.status')?.textContent}`));

  await h.openApp();

  if (want('guest')) {
    await h.openView('Progress');
    await h.settle();
    check(await page.locator('#progress-empty').isVisible(), 'a new guest sees the empty lead');
    check((await h.text('#progress-empty-title')) === 'Nothing to compare yet', 'it says so');
    await shot('guest');
  }

  for (const shape of ['gain', 'drop', 'flat', 'week'].filter(want)) {
    const user = fake.addUser(`${shape}@stilltype.test`);
    fake.profiles.set(user.id, { data: shape === 'week' ? firstWeek() : history(shape) });

    if (await page.locator('#account[data-state="member"]').count()) {
      await page.keyboard.press('Control+k');
      await page.locator('#palette-input').fill('sign out');
      await page.locator('#palette-list [role="option"]', { hasText: 'sign out' }).first().click();
      await page.waitForLoadState('load');
      await h.attr('#account', 'data-state', 'guest');
    }

    await h.signIn(`${shape}@stilltype.test`);
    await h.attr('#account', 'data-sync', 'synced');
    await h.openView('Progress');
    await h.settle();
    note(`${shape} lead`, `${await h.text('#lead-figure')} | ${await h.text('#lead-sentence')} | ${await h.text('#lead-meta')} | ${await h.text('#lead-note')}`);
    note(`${shape} movers`, JSON.stringify(await rows()));
    check(await sideways() <= 0, `${shape}: nothing scrolls sideways at ${width}`);
    await shot(shape);

    if (shape !== 'gain') continue;
    check((await page.locator('#week-lead').getAttribute('data-tone')) === 'gain', 'the gain reads as a gain');
    const statuses = await rows();
    check(statuses.includes('qu:fixed') && statuses.includes('ol:fixed') && statuses.includes('ex:slipping'), 'a pair fixed, one fixed by pace, one slipping');

    // The conditions control, open.
    await page.locator('.conditions-disclosure > summary').click();
    await shot('conditions-open');
    await page.locator('.conditions-disclosure > summary').click();

    // Each detail view, and the way back.
    for (const [open, name] of [['[data-progress-open="runs"]', 'runs'], ['[data-progress-open="keys"]', 'keys'], ['[data-progress-open="calendar"]', 'calendar'],
      ['[data-progress-open="standard"]', 'standard'], ['#week-speed button', 'trends']]) {
      await page.locator(open).first().click();
      await h.attr('#progress-screen', 'data-detail', name);
      await h.settle();
      check(await page.locator('#progress-detail-heading').isVisible(), `${name}: the view names itself`);
      check(await sideways() <= 0, `${name}: nothing scrolls sideways`);
      await shot(`detail-${name}`);
      await page.locator('#progress-back').click();
      await h.attr('#progress-screen', 'data-detail', '');
      check(await page.evaluate((selector) => document.activeElement === document.querySelector(selector), open), `${name}: back returns focus to its link`);
    }

    // Clear history, then Undo: the overview follows both at once.
    await page.locator('#clear-history').click();
    await page.locator('#confirm-clear-input').fill('clear');
    await page.locator('#confirm-clear').click();
    await h.settle();
    check(await page.locator('#progress-empty').isVisible(), 'cleared: the empty lead');
    await shot('cleared');
    await page.locator('#undo-clear').click();
    await h.settle();
    check((await h.text('#lead-figure')).length > 0 && await page.locator('#week-lead').isVisible(), 'undone: the lead is back');
    await shot('undone');

    // A slipping pair's drill starts the drill Train would.
    await page.locator('#week-movers li[data-status="slipping"] button').first().click();
    await h.attr('#typing-screen', 'data-session', 'drill');
    note('drill title', await h.text('#session-title'));
    check((await h.text('#session-title')) === 'Practice “ex”', 'Drill “ex” starts a drill on ex');
    await shot('drill');
  }
};
