// Progress in the Instrument look (TOB-470) on a year of history: the lead cells, both charts, the calendar with its
// tip by hover and by keyboard, the runs with their crowns, a non-default condition key, each period, the clear dialog
// and every detail view one step away. PROGRESS_STATES picks states (comma separated); PROGRESS_NAV=top puts
// navigation in the top bar; PROGRESS_SIDE=hidden hides the side bar.
import { CORPUS_VERSION, METRIC_VERSION } from '../../../../src/typing.js';
import { englishFrequency } from '../../../../src/learner.js';

const words = { mode: 'words', count: 25, punctuation: false, numbers: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION, layout: 'qwerty' };
const timed = { ...words, mode: 'time', count: null, duration: 15 };
const day = (at) => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;

// A seeded year: practice on about half the days, one to six runs a day, getting faster.
export function yearHistory({ navigation = 'side', count = Infinity } = {}) {
  let seed = 11;

  const random = () => {
    seed = (seed * 16807) % 2147483647;

    return (seed - 1) / 2147483646;
  };

  const now = new Date();
  const runs = [];

  for (let back = 364; back >= 0; back -= 1) {
    if (back > 6 && random() > 0.5) continue;
    const runsToday = 1 + Math.floor(random() * 6);

    for (let i = 0; i < runsToday; i += 1) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 8 + i, Math.floor(random() * 60));

      if (at > now) continue;
      const short = random() < 0.2;
      const wpm = Math.round(62 + (364 - back) * 0.06 + (random() - 0.5) * 14);
      runs.push({ id: `year-${runs.length}`, at: at.toISOString(), day: day(at), kind: random() < 0.08 ? 'retest' : 'test', status: 'complete', interrupted: false, fresh: true,
        conditions: short ? timed : words, textId: `year-${runs.length}`, score: { wpm, accuracy: Math.round((92 + random() * 7.5) * 10) / 10 },
        elapsedMs: short ? 15_000 : 18_000 + Math.floor(random() * 12_000), errors: Math.floor(random() * 4), target: null, patterns: [], keys: [], keysVersion: 1 });
    }
  }

  // The newest 25-word run is the fastest yet, so the runs table has a crown to show.
  const newest = runs.findLast((run) => run.conditions === words && run.kind === 'test');
  newest.score.wpm = Math.max(...runs.filter((run) => run.conditions === words).map((run) => run.score.wpm)) + 2;
  const kept = runs.slice(-count);

  return { version: 2, preferences: { dailyGoal: 2, navigation }, attempts: [], runs: kept, loops: [], seenTextIds: kept.map((run) => run.textId), bests: {}, updatedAt: now.toISOString() };
}

// Two weeks at 25 words, faster this week, with five pairs missed before and clean since: all five are fixed.
export function fixedWeeks({ navigation = 'side' } = {}) {
  const background = [...englishFrequency().pairs].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([pair]) => pair);
  const fixed = ['qu', 'ex', 'ox', 'ux', 'ix'];
  const rows = (tries, misses) => [...background.filter((pair) => !fixed.includes(pair)).map((pair, i) => [pair, 10, i % 3 ? 0 : 1, 10, 200, 0]), ...fixed.map((pair) => [pair, tries, misses, tries, 200, 0])];
  const now = new Date();
  const at = (back, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 9 + i);
  const runs = [[70, 72, 74, 73, 75, 71, 74].map((wpm, i) => [13 - i, wpm, rows(8, 1)]), [76, 78, 77, 79, 78, 80].map((wpm, i) => [5 - i, wpm, rows(15, 0)])].flat()
    .map(([back, wpm, patterns], i) => ({ id: `fixed-${i}`, at: at(back, i % 8).toISOString(), day: day(at(back, i % 8)), kind: 'test', status: 'complete', interrupted: false, fresh: true,
      conditions: words, textId: `fixed-${i}`, score: { wpm, accuracy: 95 + (i % 2) }, elapsedMs: 20_000, errors: 1, target: null, patterns, keys: [], keysVersion: 0 }));

  return { version: 2, preferences: { navigation }, attempts: [], runs, loops: [], seenTextIds: runs.map((run) => run.textId), bests: {}, updatedAt: now.toISOString() };
}

export default async ({ page, h, shot, note, check, fake }) => {
  const states = (process.env.PROGRESS_STATES || 'guest,thin,fixed,full').split(',');
  const navigation = process.env.PROGRESS_NAV === 'top' ? 'top' : 'side';
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const signInWith = async (email, data) => {
    if (await page.locator('#account').getAttribute('data-state') === 'member') {
      await page.keyboard.press('Control+k');
      await page.keyboard.type('sign out');
      await Promise.all([page.waitForEvent('load'), page.keyboard.press('Enter')]);
    }

    const user = fake.addUser(email);
    fake.profiles.set(user.id, { data });
    await h.signIn(email);
    await h.attr('#account', 'data-sync', 'synced');
    await h.openView('Progress');
    await page.mouse.move(0, 0);
    await h.settle();
  };

  await h.openApp();

  if (states.includes('guest')) {
    if (navigation === 'top') {
      await h.openSettings('appearance');
      await page.locator('#navigation-select input[value="top"]').check({ force: true });
      await page.keyboard.press('Escape');
    }

    await h.openView('Progress');
    await page.mouse.move(0, 0);
    await h.settle();
    check(await page.locator('#progress-empty').isVisible(), 'a guest with no runs sees the empty panel');
    check(await overflow() <= 0, 'no sideways scroll (guest)');
    await shot('guest');
  }

  if (states.includes('thin')) {
    const data = yearHistory({ navigation, count: 2 });
    await signInWith('thin@stilltype.test', data);
    note('thin lead', await page.locator('#week-lead').innerText());
    check(await overflow() <= 0, 'no sideways scroll (thin)');
    await shot('thin');
  }

  if (states.includes('fixed')) {
    await signInWith('fixed@stilltype.test', fixedWeeks({ navigation }));
    note('fixed lead', await page.locator('#week-cells').innerText());
    await shot('fixed');
    await page.locator('#lead-fixed').click();
    await h.settle();
    await shot('detail-fixed');
    await page.locator('#progress-back').click();
  }

  if (states.includes('full')) {
    await signInWith('year@stilltype.test', yearHistory({ navigation }));
    check(await overflow() <= 0, 'no sideways scroll (full)');
    note('lead', await page.locator('#week-cells').innerText());
    await shot('full-30');
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);

    if (navigation === 'side' && await page.locator('#side-bar-toggle').isVisible()) {
      await page.locator('#side-bar-toggle').click();
      await h.settle();
      check(await overflow() <= 0, 'no sideways scroll (side bar hidden)');
      await shot('full-30-side-hidden');
      await page.locator('#side-bar-toggle').click();
    }

    for (const period of ['7', 'all']) {
      await page.locator(`#progress-period [data-period="${period}"]`).click();
      await h.settle();
      await shot(`full-${period}`);
    }

    await page.locator('#progress-period [data-period="30"]').click();
    await page.locator('#runs-table').scrollIntoViewIfNeeded();
    note('crowns', await page.locator('#runs-table .pb').count());
    await shot('runs');

    // The calendar's tip by hover (a tap on a touch screen), then by keyboard focus (the day picker on a touch screen).
    const days = page.locator('#goal-calendar .goal-day');
    await page.locator('#practice-goal').scrollIntoViewIfNeeded();

    if (coarse) await days.nth((await days.count()) - 3).tap();
    else await days.nth((await days.count()) - 3).hover();
    check(await page.locator('.calendar-tip').isVisible(), 'the tip shows on hover or tap');
    note('tip on hover', await page.locator('.calendar-tip').innerText());
    await shot(coarse ? 'tip-tap' : 'tip-hover');
    await page.mouse.move(0, 0);

    if (coarse) {
      const picker = page.locator('#goal-day-select');
      await picker.focus();
      await picker.selectOption({ index: (await picker.locator('option').count()) - 9 });
    } else {
      await days.last().focus();
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowUp');
    }

    check(await page.locator('.calendar-tip').isVisible(), 'the tip shows for the focused or picked day');
    note('tip on focus', await page.locator('.calendar-tip').innerText());
    await shot(coarse ? 'tip-picker' : 'tip-focus');

    // A condition key other than the one the page opened on.
    await page.locator('.conditions-disclosure > summary').click();
    await shot('conditions-open');
    await page.getByRole('group', { name: 'Test' }).getByRole('button', { name: '15 seconds' }).click();
    await page.locator('.conditions-disclosure > summary').click();
    await page.mouse.move(0, 0);
    await h.settle();
    note('15 s lead', await page.locator('#week-cells').innerText());
    await shot('conditions-15s');

    for (const [name, open] of [['runs', '#open-runs'], ['calendar', '#open-practice'], ['fixed', '#lead-fixed'], ['trends', '#week-speed button']]) {
      if (!await page.locator(open).getAttribute('data-progress-open') && name === 'fixed') continue;
      await page.locator(open).click();
      await h.settle();
      await shot(`detail-${name}`);
      await page.locator('#progress-back').click();
    }

    await page.locator('#clear-history').click();
    await shot('clear-dialog');
    await page.keyboard.press('Escape');
  }
};
