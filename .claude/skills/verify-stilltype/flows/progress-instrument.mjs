// Progress in the Instrument look (TOB-470) on a year of history: the lead cells, both charts, the calendar with its
// tip by hover and by keyboard, the runs with their crowns, a non-default condition key, each period, the clear dialog
// and every detail view one step away. PROGRESS_STATES picks states (comma separated); PROGRESS_NAV=top puts
// navigation in the top bar; PROGRESS_SIDE=hidden hides the side bar.
import { CORPUS_VERSION, METRIC_VERSION } from '../../../../src/typing.js';

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

export default async ({ page, h, shot, note, check, fake }) => {
  const states = (process.env.PROGRESS_STATES || 'guest,thin,full').split(',');
  const navigation = process.env.PROGRESS_NAV === 'top' ? 'top' : 'side';
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const signInWith = async (email, data) => {
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

  if (states.includes('full')) {
    if (states.includes('thin')) {
      await page.keyboard.press('Control+k');
      await page.keyboard.type('sign out');
      await Promise.all([page.waitForEvent('load'), page.keyboard.press('Enter')]);
    }

    await signInWith('year@stilltype.test', yearHistory({ navigation }));
    check(await overflow() <= 0, 'no sideways scroll (full)');
    note('lead', await page.locator('#week-cells').innerText());
    await shot('full-30');

    for (const period of ['7', 'all']) {
      await page.locator(`#progress-period [data-period="${period}"]`).click();
      await h.settle();
      await shot(`full-${period}`);
    }

    await page.locator('#progress-period [data-period="30"]').click();
    await page.locator('#runs-table').scrollIntoViewIfNeeded();
    note('crowns', await page.locator('#runs-table .pb').count());
    await shot('runs');

    // The calendar's tip by hover, then by keyboard focus.
    const days = page.locator('#goal-calendar .goal-day');
    await page.locator('#practice-goal').scrollIntoViewIfNeeded();
    await days.nth((await days.count()) - 3).hover();
    check(await page.locator('.calendar-tip').isVisible(), 'the tip shows on hover');
    note('tip on hover', await page.locator('.calendar-tip').innerText());
    await shot('tip-hover');
    await page.mouse.move(0, 0);
    await days.last().focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    note('tip on focus', await page.locator('.calendar-tip').innerText());
    await shot('tip-focus');

    // A condition key other than the one the page opened on.
    await page.locator('.conditions-disclosure > summary').click();
    await shot('conditions-open');
    await page.getByRole('group', { name: 'Test' }).getByRole('button', { name: '15 seconds' }).click();
    await page.locator('.conditions-disclosure > summary').click();
    await page.mouse.move(0, 0);
    await h.settle();
    note('15 s lead', await page.locator('#week-cells').innerText());
    await shot('conditions-15s');

    for (const [name, open] of [['runs', '#open-runs'], ['calendar', '[data-progress-open="calendar"]'], ['trends', '#week-speed button']]) {
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
