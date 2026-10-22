// One account in two tabs or on two devices, against the fake Supabase in e2e/fake-supabase.js: a save
// from a copy that is out of date merges with the other copy instead of replacing it.
import { test, expect, openApp, openView, openSettings, chooseWords, passageText, typeInto, signInWithEmail, storageKeys, chooseMore, chooseSetting } from './fixtures.js';
import { CONDITION_SETS_FROM, textStamp } from '../src/account.js';

test.setTimeout(90000);

const EMAIL = 'sync@stilltype.test';
const cloud = (supabase) => supabase.profileFor(EMAIL);
const runIds = (data) => (data?.runs || []).map((run) => run.id);
const bestWpms = (data) => Object.values(data?.bests || {}).map((best) => best.wpm);

// Pages beyond the fixture's own use the same fake and fail the test on any page or console error.
async function extraPage(owner, supabase, errors) {
  const page = await owner.newPage();
  await supabase.attach(page);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/supabase\.co/.test(message.location().url)) errors.push(message.text());
  });
  return page;
}

async function device(browser, supabase, errors) {
  const context = await browser.newContext();
  const page = await extraPage(context, supabase, errors);
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  return { context, page };
}

// A ten-word run. A delay makes it slower, so the two copies hold different bests.
async function finishRun(page, delay = 0) {
  await openView(page, 'Practice');
  await chooseWords(page, 10);
  await typeInto(page, await passageText(page), '#typing-input', { delay });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  return Number(await page.locator('#result-wpm').textContent());
}

const cachedProfile = (page) => page.evaluate(() => {
  const key = Object.keys(localStorage).find((name) => name.startsWith('stilltype-profile-v2:'));
  return JSON.parse(localStorage.getItem(key));
});

async function expectBothRuns(page, { runs, best }) {
  await page.reload();
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await expect(page.locator('#best')).toHaveText(`Best · ${best} wpm`);
  await openView(page, 'Progress');
  await expect(page.locator('#run-history .run-row')).toHaveCount(runs);
}

test('two tabs: a tab that missed the other’s saves keeps its run and settings when it saves', async ({ page, context, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  // From here the first tab hears nothing from the other, as a frozen or restored tab doesn't.
  await page.evaluate(() => addEventListener('storage', (event) => event.stopImmediatePropagation(), true));

  const fast = await finishRun(other);
  await openSettings(other);
  await chooseSetting(other, 'font-size', '36');
  await expect.poll(() => runIds(cloud(supabase)).length).toBe(1);
  await expect.poll(() => cloud(supabase).preferences.fontSize).toBe('36');
  const seenByOther = cloud(supabase).seenTextIds;
  await openView(other, 'Progress');
  await expect(other.locator('#run-history .run-row')).toHaveCount(1);

  const slow = await finishRun(page, 40);
  expect(slow).toBeLessThan(fast);
  // The other tab still listens, so its open Progress view picks up the run without a reload.
  await expect(other.locator('#run-history .run-row')).toHaveCount(2);
  await expect.poll(() => runIds(cloud(supabase)).length, { timeout: 15000 }).toBe(2);
  const data = cloud(supabase);
  expect(data.runs.map((run) => run.score.wpm).sort((a, b) => a - b)).toEqual([slow, fast]);
  expect(bestWpms(data)).toEqual([fast]);
  expect(data.seenTextIds).toEqual(expect.arrayContaining([...seenByOther, ...data.runs.map((run) => run.textId)]));
  expect(data.preferences.fontSize).toBe('36');
  expect((await cachedProfile(page)).runs).toHaveLength(2);

  await expectBothRuns(other, { runs: 2, best: fast });
  await expect(other.locator('body')).toHaveAttribute('data-font-size', '36');
  await expectBothRuns(page, { runs: 2, best: fast });
  await expect(page.locator('body')).toHaveAttribute('data-font-size', '36');
  expect(errors).toEqual([]);
});

test('from CONDITION_SETS_FROM the row and the device cache keep each conditions set once, and read back the same', async ({ page, supabase }) => {
  const user = supabase.addUser(EMAIL);
  await page.clock.install({ time: new Date(Date.parse(CONDITION_SETS_FROM) + 3600000) });
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  const fast = await finishRun(page);
  const slow = await finishRun(page, 60);
  await expect.poll(() => supabase.profiles.get(user.id)?.data?.runs?.length).toBe(2);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  for (const stored of [supabase.profiles.get(user.id).data, await cachedProfile(page)]) {
    expect(Object.keys(stored.conditionSets)).toHaveLength(1);
    expect(stored.runs.map((run) => [run.conditions, run.conditionSet in stored.conditionSets])).toEqual([[undefined, true], [undefined, true]]);
  }
  expect(cloud(supabase).runs.map((run) => run.conditions.count)).toEqual([10, 10]);
  await expectBothRuns(page, { runs: 2, best: Math.max(fast, slow) });
  await expect(page.locator('#run-history .run-row').first()).toContainText('10 words');
  const writes = supabase.profileWrites.length;
  for (let round = 0; round < 3; round += 1) await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  expect(supabase.profileWrites.length).toBe(writes);
});

test('two devices: a stale device’s push keeps the other device’s run, higher best and settings, and its settings change wins as the newest', async ({ page, browser, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  const { context, page: phone } = await device(browser, supabase, errors);
  try {
    await phone.emulateMedia({ colorScheme: 'dark' });
    const fast = await finishRun(phone);
    await openSettings(phone);
    await chooseSetting(phone, 'font-size', '22');
    await expect.poll(() => cloud(supabase)?.preferences.fontSize).toBe('22');
    await expect.poll(() => runIds(cloud(supabase)).length).toBe(1);
    const seenOnPhone = cloud(supabase).seenTextIds;

    // The laptop still holds the profile from before the phone's run.
    const slow = await finishRun(page, 40);
    expect(slow).toBeLessThan(fast);
    await expect.poll(() => runIds(cloud(supabase)).length, { timeout: 15000 }).toBe(2);
    const data = cloud(supabase);
    expect(bestWpms(data)).toEqual([fast]);
    expect(data.seenTextIds).toEqual(expect.arrayContaining([...seenOnPhone, ...data.runs.map((run) => run.textId)]));
    expect(data.preferences.fontSize).toBe('22');

    await expectBothRuns(phone, { runs: 2, best: fast });
    await expect(phone.locator('body')).toHaveAttribute('data-font-size', '22');
    await expectBothRuns(page, { runs: 2, best: fast });
    await expect(page.locator('body')).toHaveAttribute('data-font-size', '22');

    // A settings change from the laptop, stale again after another phone run, keeps the history and wins.
    const third = await finishRun(phone);
    await expect.poll(() => runIds(cloud(supabase)).length).toBe(3);
    const before = cloud(supabase);
    await openSettings(page);
    await chooseSetting(page, 'theme-select', 'light');
    await expect.poll(() => cloud(supabase).preferences.theme).toBe('light');
    const after = cloud(supabase);
    expect(runIds(after)).toEqual(runIds(before));
    // Recordings stay on the device that made them: the row holds none.
    expect(after).not.toHaveProperty('attempts');
    expect(after.bests).toEqual(before.bests);
    expect(after.seenTextIds).toEqual(expect.arrayContaining(before.seenTextIds));
    await expectBothRuns(phone, { runs: 3, best: Math.max(fast, third) });
    await expect(phone.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('a clear on one device is not undone by a stale device’s next push', async ({ page, browser, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await finishRun(page);
  await expect.poll(() => runIds(cloud(supabase)).length).toBe(1);
  const [cleared] = runIds(cloud(supabase));
  const { context, page: phone } = await device(browser, supabase, errors);
  try {
    await openView(phone, 'Progress');
    await expect(phone.locator('#run-history .run-row')).toHaveCount(1);

    await openView(page, 'Progress');
    await page.locator('#clear-history').click();
    await page.locator('#confirm-clear-input').fill('clear');
    await page.locator('#confirm-clear').click();
    await expect.poll(() => cloud(supabase)?.historyClearedAt).toBeTruthy();
    expect(runIds(cloud(supabase))).toEqual([]);

    // The phone never heard of the clear and still holds the old run when it saves a new one.
    const wpm = await finishRun(phone);
    await expect.poll(() => runIds(cloud(supabase)).length, { timeout: 15000 }).toBe(1);
    const data = cloud(supabase);
    expect(runIds(data)).not.toContain(cleared);
    // Recordings stay on the device that made them: the row holds none.
    expect(data).not.toHaveProperty('attempts');
    expect(bestWpms(data)).toEqual([wpm]);

    await expectBothRuns(phone, { runs: 1, best: wpm });
    await expectBothRuns(page, { runs: 1, best: wpm });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('undo brings history back after the clear has synced, even on a device that applied the clear', async ({ page, browser, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await finishRun(page);
  await expect.poll(() => runIds(cloud(supabase)).length).toBe(1);
  const [kept] = runIds(cloud(supabase));
  const { context, page: phone } = await device(browser, supabase, errors);
  try {
    await openView(phone, 'Progress');
    await expect(phone.locator('#run-history .run-row')).toHaveCount(1);

    await openView(page, 'Progress');
    await page.locator('#clear-history').click();
    await page.locator('#confirm-clear-input').fill('clear');
    await page.locator('#confirm-clear').click();
    await expect.poll(() => cloud(supabase)?.historyClearedAt, { intervals: [100] }).toBeTruthy();
    // The phone hears of the clear (a returning connection reads the account again).
    await phone.evaluate(() => dispatchEvent(new Event('online')));
    await expect(phone.locator('#progress-empty')).toBeVisible();

    await page.locator('#undo-clear').click();
    await expect(page.locator('#history-feedback')).toHaveText('History restored.');
    await expect.poll(() => runIds(cloud(supabase))).toEqual([kept]);
    expect(cloud(supabase).historyClearedAt).toBeUndefined();

    // The phone still holds the clear; its next save must not apply it again.
    await openSettings(phone);
    await chooseSetting(phone, 'theme-select', 'light');
    await expect.poll(() => cloud(supabase).preferences.theme).toBe('light');
    expect(runIds(cloud(supabase))).toEqual([kept]);
    await phone.reload();
    await openView(phone, 'Progress');
    await expect(phone.locator('#run-history .run-row')).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('signing out in one tab first sends a run another tab saved but could not send', async ({ page, context, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  // Already at the other tab's shape, so its pick prepares no new passage here, and no save of this
  // tab's own can carry the run up before the sign-out does.
  await chooseWords(page, 10);
  await expect.poll(() => cloud(supabase)?.preferences.count).toBe(10);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  // The other tab's pushes fail, as offline or still waiting on their timer when the sign-out comes.
  await other.route(/\/rest\/v1\/profiles/, (route) => route.abort());
  await finishRun(other);
  await expect.poll(async () => (await cachedProfile(page))?.runs?.length).toBe(1);
  expect(runIds(cloud(supabase))).toEqual([]);

  await page.locator('#account-trigger').click();
  await Promise.all([page.waitForEvent('load'), page.locator('#account-signout').click()]);
  await expect(page.locator('#account')).toHaveAttribute('data-state', 'guest');
  expect(runIds(cloud(supabase))).toHaveLength(1);
  // Everything reached the account, so the device keeps nothing, and the other tab writes nothing back.
  await finishRun(other);
  expect(await storageKeys(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('a run another tab finishes after a sign-out that kept unsent edits never reaches the account', async ({ page, context, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await openView(other, 'Practice');
  await chooseWords(other, 10);
  const text = await passageText(other);
  await typeInto(other, text.slice(0, 3));

  // This tab's run can't be sent, so the sign-out keeps it on the device for the next sign-in.
  await page.route(/\/rest\/v1\/profiles/, (route) => route.abort());
  await finishRun(page);
  const kept = (await cachedProfile(page)).runs.map((run) => run.id);
  expect(kept).toHaveLength(1);
  await page.locator('#account-trigger').click();
  await Promise.all([page.waitForEvent('load'), page.locator('#account-signout').click()]);
  await expect(page.locator('#account')).toHaveAttribute('data-state', 'guest');

  // The other tab's run, finished after the sign-out, is a guest's: the next sign-in sends only what
  // was kept, and the other tab then starts again as a guest.
  await other.keyboard.type(text.slice(3));
  await page.unroute(/\/rest\/v1\/profiles/);
  await signInWithEmail(page, EMAIL);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await expect.poll(() => runIds(cloud(supabase)).length).toBeGreaterThan(0);
  expect(runIds(cloud(supabase))).toEqual(kept);
  expect((await storageKeys(page)).filter((key) => key.startsWith('stilltype-signed-out:'))).toEqual([]);
  await expect(other.locator('#account')).toHaveAttribute('data-state', 'guest');
  expect(errors).toEqual([]);
});

test('runs made after the session ends stay on the device and reach the account at the next sign-in', async ({ page, supabase }) => {
  supabase.addUser(EMAIL);
  // Short-lived tokens, so every push refreshes the session first.
  supabase.sessionSeconds = 30;
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await finishRun(page);
  await expect.poll(() => runIds(cloud(supabase)).length).toBe(1);

  // The session is revoked elsewhere (a sign-out on another device ends every session).
  supabase.refreshTokens.clear();
  await finishRun(page);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'expired');
  await finishRun(page);
  await expect(page.locator('#result-comparison-note')).not.toContainText('Couldn’t save');
  expect((await cachedProfile(page)).runs).toHaveLength(3);

  await page.reload();
  await expect(page.locator('#account')).toHaveAttribute('data-state', 'guest');
  await signInWithEmail(page, EMAIL);
  await expect.poll(() => runIds(cloud(supabase)).length).toBe(3);
  await openView(page, 'Progress');
  await expect(page.locator('#run-history .run-row')).toHaveCount(3);
});

test('on load, newer test conditions from the account replace an untouched passage', async ({ page, browser, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await chooseWords(page, 10);
  await expect.poll(() => cloud(supabase)?.preferences.count).toBe(10);
  const { context, page: phone } = await device(browser, supabase, errors);
  try {
    await chooseWords(phone, 25);
    await expect.poll(() => cloud(supabase).preferences.count).toBe(25);

    await page.reload();
    await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
    await expect(page.locator('#condition-line')).toContainText('25 words');
    await expect(page.locator('#duration-options [data-length="25"]')).toHaveAttribute('aria-pressed', 'true');
    expect((await passageText(page)).split(' ')).toHaveLength(25);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('changes another tab saved during a one-keyboard race apply once the race is over', async ({ page, context, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  // This tab's own pushes fail, so only the shared cache can bring the other tab's changes in.
  await page.route(/\/rest\/v1\/profiles/, (route) => route.abort());

  await openView(page, 'Challenge');
  await page.locator('#challenge-local').click();
  await page.locator('#start-local-race').click();
  const text = await page.locator('#race-accessible-passage').textContent();
  await typeInto(page, text.slice(0, 5), '#race-input');

  await openSettings(other);
  await chooseSetting(other, 'font-size', '36');
  await finishRun(other);
  // Every write the other tab makes lands while this tab's race is still running.
  await expect.poll(() => runIds(cloud(supabase)).length).toBe(1);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await expect(page.locator('body')).toHaveAttribute('data-font-size', '28');

  await page.keyboard.type(text.slice(5));
  await expect(page.locator('#race-handoff')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-font-size', '36');
  await page.locator('#start-next-player').click();
  await expect(page.locator('#race-player')).toHaveText('Player two');
  await expect(page.locator('#race-input')).toBeFocused();
  await typeInto(page, text, '#race-input');
  await expect(page.locator('#race-leaderboard')).toBeVisible();
  await expect(page.locator('.race-result-row').first()).toContainText(/\d+ wpm/);
  await expect(page.locator('.race-result-row').last()).toContainText(/\d+ wpm/);
  await openView(page, 'Progress');
  await expect(page.locator('#run-history .run-row')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('a best another tab set mid-run labels the result of this tab’s run', async ({ page, context, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');

  await chooseWords(page, 10);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 15));
  const fast = await finishRun(other);
  await expect(other.locator('#best')).toHaveText(`Best · ${fast} wpm`);

  await page.keyboard.type(text.slice(15), { delay: 20 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#best')).toHaveText(`Best · ${fast} wpm`);
  await expect(page.locator('#result-delta')).toContainText(`vs your best of ${fast}`);
  expect(errors).toEqual([]);
});

test('choosing the shape already shown keeps it over a different one waiting from another tab', async ({ page, context, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');

  await chooseWords(page, 10);
  await typeInto(page, (await passageText(page)).slice(0, 3));
  // Mid-run here, the other tab picks 25 words; it waits, as this run is at 10.
  await chooseWords(other, 25);
  await expect(page.locator('#condition-line')).toContainText('10 words');

  await page.keyboard.press('Control+k');
  await page.keyboard.type('words · 10');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('words · 10 words');
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
  await expect(page.locator('#condition-line')).toContainText('10 words');
  await expect(page.locator('#duration-options [data-length="10"]')).toHaveAttribute('aria-pressed', 'true');
  expect((await passageText(page)).split(' ')).toHaveLength(10);
  await expect.poll(() => cloud(supabase).preferences.count, { timeout: 15000 }).toBe(10);
  expect(errors).toEqual([]);
});

// A custom pace being typed in one tab stays as typed when another tab saves meanwhile: taking in that
// save redraws the settings, which must not put back the stored speed under the cursor.
test('a custom pace being typed is kept when another tab saves before it is left', async ({ page, context, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await openSettings(other);
  await chooseSetting(other, 'pace-select', 'custom');
  await expect.poll(() => cloud(supabase)?.preferences.paceCaret, { timeout: 15000 }).toBe('custom');
  await other.locator('#pace-wpm').fill('120');

  // The first tab finishes a run; the other takes in that save while its field still holds 120.
  await chooseWords(page, 10);
  await typeInto(page, await passageText(page));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(other.locator('#best')).not.toHaveText('No best yet');
  await expect(other.locator('#pace-wpm')).toHaveValue('120');

  await other.locator('#pace-wpm').press('Tab');
  await expect(other.locator('#pace-label')).toHaveText('pace 120 wpm');
  await expect.poll(() => cloud(supabase)?.preferences.paceWpm, { timeout: 15000 }).toBe(120);
  expect(errors).toEqual([]);
});

// A retest runs at the settings shown, so a pace another tab picks meanwhile waits here. Picking the pace
// already shown, from the palette, is a choice like any other: it stays once the retest is over. A custom
// pace keeps the speed shown with it.
for (const [mine, theirs] of [['off', 'personal best'], ['custom', 'custom at 120 wpm']]) {
  test(`choosing the pace caret already shown (${mine}) during a retest keeps it over ${theirs} from another tab`, async ({ page, context, supabase }) => {
    supabase.addUser(EMAIL);
    const errors = [];
    await openApp(page);
    await signInWithEmail(page, EMAIL);
    const other = await extraPage(context, supabase, errors);
    await openApp(other);
    await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
    if (mine === 'custom') {
      await openSettings(page);
      await chooseSetting(page, 'pace-select', 'custom');
      await expect(page.locator('#pace-label')).toHaveText('pace 80 wpm');
      await page.keyboard.press('Escape');
      await expect.poll(() => cloud(supabase)?.preferences.paceCaret, { timeout: 15000 }).toBe('custom');
    }

    await chooseWords(page, 10);
    await typeInto(page, await passageText(page));
    await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
    await page.locator('#skip-to-retest').click();
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');

    await openSettings(other, 'practice');
    if (mine === 'custom') {
      await expect(other.locator('#pace-select input:checked')).toHaveValue('custom');
      await other.locator('#pace-wpm').fill('120');
      await other.locator('#pace-wpm').press('Tab');
      await expect.poll(() => cloud(supabase)?.preferences.paceWpm, { timeout: 15000 }).toBe(120);
    } else {
      await chooseSetting(other, 'pace-select', 'best');
      await expect.poll(() => cloud(supabase)?.preferences.paceCaret, { timeout: 15000 }).toBe('best');
    }
    await expect(page.locator('#pace-select input:checked')).toHaveValue(mine);

    await page.keyboard.press('Control+k');
    await page.keyboard.type(`pace caret: ${mine}`);
    await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText(`pace caret: ${mine}`);
    await page.keyboard.press('Enter');
    await expect(page.locator('#palette')).toBeHidden();
    await typeInto(page, await passageText(page));
    await expect(page.locator('#comparison-panel')).toBeVisible();

    await expect(page.locator('#pace-select input:checked')).toHaveValue(mine);
    if (mine === 'custom') await expect(page.locator('#pace-label')).toHaveText('pace 80 wpm');
    const expected = mine === 'custom' ? { paceCaret: 'custom', paceWpm: 80 } : { paceCaret: 'off' };
    await expect.poll(() => cloud(supabase)?.preferences, { timeout: 15000 }).toMatchObject(expected);
    await expect(other.locator('#pace-select input:checked')).toHaveValue(mine);
    expect(errors).toEqual([]);
  });
}

// Picking a custom pace when another pace is shown picks the pace alone: no speed was on show, so the
// speed another tab chose for its custom pace stays.
test('picking pace caret custom (from off) during a retest keeps the custom speed another tab chose', async ({ page, context, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');

  await chooseWords(page, 10);
  await typeInto(page, await passageText(page));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await page.locator('#skip-to-retest').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');

  await openSettings(other);
  await chooseSetting(other, 'pace-select', 'custom');
  await other.locator('#pace-wpm').fill('120');
  await other.locator('#pace-wpm').press('Tab');
  await expect.poll(() => cloud(supabase)?.preferences, { timeout: 15000 }).toMatchObject({ paceCaret: 'custom', paceWpm: 120 });
  await expect(page.locator('#pace-select input:checked')).toHaveValue('off');

  await page.keyboard.press('Control+k');
  await page.keyboard.type('pace caret: custom');
  await expect(page.locator('#palette-list [aria-selected="true"]')).toContainText('pace caret: custom');
  await page.keyboard.press('Enter');
  await expect(page.locator('#palette')).toBeHidden();
  await typeInto(page, await passageText(page));
  await expect(page.locator('#comparison-panel')).toBeVisible();

  await expect(page.locator('#pace-select input:checked')).toHaveValue('custom');
  await expect(page.locator('#pace-label')).toHaveText('pace 120 wpm');
  await expect.poll(() => cloud(supabase)?.preferences, { timeout: 15000 }).toMatchObject({ paceCaret: 'custom', paceWpm: 120 });
  await expect(other.locator('#pace-wpm')).toHaveValue('120');
  expect(errors).toEqual([]);
});

test('using the custom text already shown keeps it over different text waiting from another tab', async ({ page, context, supabase }) => {
  const MINE = 'the quick brown fox jumps over the lazy dog';
  const THEIRS = 'pack my box with five dozen liquor jugs today';
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');

  await chooseMore(page, 'mode-custom');
  await page.locator('#custom-text').fill(MINE);
  await page.locator('#custom-use').click();
  expect(await passageText(page)).toBe(MINE);
  await expect.poll(() => cloud(supabase)?.preferences.customText, { timeout: 15000 }).toBe(MINE);

  // The other tab uses its own text. This tab's custom passage is ready, so that text waits here.
  await chooseMore(other, 'mode-custom');
  await other.locator('#custom-text').fill(THEIRS);
  await other.locator('#custom-use').click();
  await expect.poll(() => cloud(supabase)?.preferences.customText, { timeout: 15000 }).toBe(THEIRS);
  expect(await passageText(page)).toBe(MINE);

  // Using the text shown here again is a choice: it stays, and reaches the account.
  await chooseMore(page, 'mode-custom');
  await expect(page.locator('#custom-text')).toHaveValue(MINE);
  await page.locator('#custom-use').click();
  await expect(page.locator('#condition-line')).toContainText('custom text');
  expect(await passageText(page)).toBe(MINE);
  await expect.poll(() => cloud(supabase)?.preferences.customText, { timeout: 15000 }).toBe(MINE);
  expect(errors).toEqual([]);
});

// This device chose numbers and a custom pace on a build from before settings were stamped; since then a
// build from before those settings existed saved the account row. Its later save decides the settings
// both copies hold, but a setting it lacks comes from the copy that has it, not from a default filled in.
test('a row an older build saved later keeps the settings it lacks from the copy that has them', async ({ page, supabase }) => {
  const user = supabase.addUser(EMAIL);
  const empty = { version: 2, profileId: 'p', attempts: [], runs: [], loops: [], seenTextIds: [], bests: {} };
  const kept = { ...empty, preferences: { theme: 'system', fontSize: '28', numbers: true, paceCaret: 'custom', paceWpm: 120 },
    updatedAt: new Date(Date.now() - 3600000).toISOString() };
  supabase.profiles.set(user.id, { data: { ...empty, preferences: { theme: 'system', fontSize: '36' }, updatedAt: new Date(Date.now() - 60000).toISOString() } });
  // Kept on this device from an earlier session, and merged with the row at sign-in and on load.
  await page.addInitScript(([key, text]) => {
    if (sessionStorage.getItem('e2e-seeded')) return;
    sessionStorage.setItem('e2e-seeded', '1');
    localStorage.setItem(key, text);
  }, [`stilltype-profile-v2:${user.id}`, JSON.stringify(kept)]);
  await openApp(page);
  await signInWithEmail(page, EMAIL);

  await expect(page.locator('body')).toHaveAttribute('data-font-size', '36');
  await expect(page.locator('#condition-line')).toContainText('numbers');
  await expect(page.locator('#pace-select input:checked')).toHaveValue('custom');
  await expect(page.locator('#pace-label')).toHaveText('pace 120 wpm');
  await expect.poll(() => cloud(supabase)?.preferences, { timeout: 15000 })
    .toMatchObject({ fontSize: '36', numbers: true, paceCaret: 'custom', paceWpm: 120 });
  expect((await cachedProfile(page)).preferences).toMatchObject({ fontSize: '36', numbers: true, paceCaret: 'custom', paceWpm: 120 });
});

// Builds from before merging synced whole copies (the copy saved later replaced the other) and cleared
// history by saving an empty copy, with no marker. A copy as one of them saved it: none of the fields
// only merging writes, and its own updatedAt.
const MERGE_ONLY = ['preferencesAt', 'mergeStamp', 'legacyClearedAt', 'historyClearedAt', 'appliedClears', 'heardClears',
  'historyClearedIds', 'undoneClears'];
const savedByOlderBuild = (data, updatedAt, over = {}) => ({
  ...Object.fromEntries(Object.entries(data).filter(([key]) => !MERGE_ONLY.includes(key))), ...over, updatedAt,
});
const CLEARED = { attempts: [], runs: [], loops: [], seenTextIds: [], bests: {} };
const seedCache = (page, userId, data) => page.addInitScript(([key, text]) => {
  if (sessionStorage.getItem('older-copy')) return;
  sessionStorage.setItem('older-copy', '1');
  localStorage.setItem(key, text);
}, [`stilltype-profile-v2:${userId}`, JSON.stringify(data)]);

// A device still on an older build clears history; this build then opens a copy from before the clear.
for (const where of ['account row', 'device cache']) {
  test(`a clear an older build saved to the ${where} stays cleared when this build merges a copy from before it`, async ({ page, browser, supabase }) => {
    const user = supabase.addUser(EMAIL);
    const errors = [];
    await openApp(page);
    await signInWithEmail(page, EMAIL);
    await finishRun(page);
    await expect.poll(() => runIds(cloud(supabase)).length).toBe(1);
    await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
    const populated = savedByOlderBuild(cloud(supabase), cloud(supabase).updatedAt);
    const cleared = savedByOlderBuild(populated, new Date().toISOString(), CLEARED);
    // The clear reached the account, or only the clearing device's cache (its push failed).
    const [row, cache] = where === 'account row' ? [cleared, populated] : [populated, cleared];
    supabase.profiles.set(user.id, { data: row });
    await seedCache(page, user.id, cache);
    const writes = supabase.writes.length;
    await page.reload();
    await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
    await expect(page.locator('#best')).toHaveText('No best yet');
    await openView(page, 'Progress');
    await expect(page.locator('#progress-empty')).toBeVisible();
    await expect.poll(() => supabase.writes.length).toBeGreaterThan(writes);
    expect(runIds(cloud(supabase))).toEqual([]);
    expect(cloud(supabase).bests).toEqual({});

    // A third device, its copy from before the run and holding an older one: nothing comes back from it.
    const [run] = populated.runs;
    const older = { ...run, id: 'older-run', at: new Date(Date.parse(run.at) - 60000).toISOString() };
    const oldest = savedByOlderBuild(populated, new Date(Date.parse(older.at) + 1000).toISOString(), { attempts: [], runs: [older], bests: {} });
    const context = await browser.newContext();
    try {
      const phone = await extraPage(context, supabase, errors);
      await seedCache(phone, user.id, oldest);
      await openApp(phone);
      await signInWithEmail(phone, EMAIL);
      await openView(phone, 'Progress');
      await expect(phone.locator('#progress-empty')).toBeVisible();
      await phone.evaluate(() => dispatchEvent(new Event('online')));
      await expect(phone.locator('#account')).toHaveAttribute('data-sync', 'synced');
      expect(runIds(cloud(supabase))).toEqual([]);
      expect(runIds(await cachedProfile(phone))).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test('a clear an older build saved elsewhere withdraws, on return, the drill and retest offered for a cleared run', async ({ page, supabase }) => {
  const user = supabase.addUser(EMAIL);
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await finishRun(page);
  await expect(page.locator('#skip-to-retest')).toBeEnabled();
  await expect.poll(() => runIds(cloud(supabase)).length).toBe(1);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');

  supabase.profiles.set(user.id, { data: savedByOlderBuild(cloud(supabase), new Date().toISOString(), CLEARED) });
  const writes = supabase.writes.length;
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect(page.locator('#best')).toHaveText('No best yet');
  await expect(page.locator('#skip-to-retest')).toBeDisabled();
  await expect(page.locator('#start-drill')).toBeDisabled();
  await expect(page.locator('#result-delta')).toHaveText('No run yet.');
  await expect.poll(() => supabase.writes.length).toBeGreaterThan(writes);
  expect(runIds(cloud(supabase))).toEqual([]);
  expect(runIds(await cachedProfile(page))).toEqual([]);
});

test('undo brings back a run the clearing device never saw, after another device applied the clear', async ({ page, browser, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await finishRun(page);
  await expect.poll(() => runIds(cloud(supabase)).length).toBe(1);
  const { context, page: phone } = await device(browser, supabase, errors);
  try {
    // The phone's run reaches the account; the laptop, never hidden or reloaded, doesn't pull it.
    await finishRun(phone);
    await expect.poll(() => runIds(cloud(supabase)).length).toBe(2);
    const both = runIds(cloud(supabase));
    await openView(page, 'Progress');
    await expect(page.locator('#run-history .run-row')).toHaveCount(1);

    await page.locator('#clear-history').click();
    await page.locator('#confirm-clear-input').fill('clear');
    await page.locator('#confirm-clear').click();
    await expect.poll(() => cloud(supabase)?.historyClearedAt, { intervals: [100] }).toBeTruthy();
    expect(runIds(cloud(supabase))).toEqual([]);
    // The phone hears of the clear before the undo and drops its copy of its own run.
    await openView(phone, 'Progress');
    await phone.evaluate(() => dispatchEvent(new Event('online')));
    await expect(phone.locator('#progress-empty')).toBeVisible();

    await page.locator('#undo-clear').click();
    await expect.poll(() => runIds(cloud(supabase)).sort()).toEqual([...both].sort());
    await expect(page.locator('#run-history .run-row')).toHaveCount(2);
    await phone.evaluate(() => dispatchEvent(new Event('online')));
    await expect(phone.locator('#run-history .run-row')).toHaveCount(2);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('a retest keeps its baseline’s conditions when another tab picks others, through a restart', async ({ page, context, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');

  await chooseWords(page, 10);
  await typeInto(page, await passageText(page));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await page.locator('#skip-to-retest').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await expect(page.locator('#condition-line')).toContainText('10 words');

  await chooseWords(other, 25);
  await typeInto(page, (await passageText(page)).slice(0, 3));
  await page.keyboard.press('Escape');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await expect(page.locator('#condition-line')).toContainText('10 words');
  expect((await passageText(page)).split(' ')).toHaveLength(10);
  await typeInto(page, await passageText(page));
  await expect(page.locator('#comparison-panel')).toBeVisible();
  await expect(page.locator('#comparison-panel')).not.toHaveAttribute('data-outcome', 'unavailable');
  await expect(page.locator('#result-conditions')).toContainText('10 words');
  // Once the retest is over, the newer pick from the other tab applies.
  await expect(page.locator('#duration-options [data-length="25"]')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

// A drill and its retest run at the baseline's conditions without changing the saved ones, so a pick
// another tab makes during the drill outlasts the retest, whether the drill had started or was only
// prepared when the pick came.
for (const when of ['prepared', 'running']) {
  test(`a pick another tab makes while a drill is ${when} survives the retest and applies after it`, async ({ page, context, supabase }) => {
    await page.clock.install();
    supabase.addUser(EMAIL);
    const errors = [];
    await openApp(page);
    await signInWithEmail(page, EMAIL);
    const other = await extraPage(context, supabase, errors);
    await openApp(other);
    await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');

    await chooseWords(page, 10);
    await typeInto(page, await passageText(page));
    await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
    await page.locator('#start-drill').click();
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
    const drill = await passageText(page);
    if (when === 'running') await typeInto(page, drill.slice(0, 5));

    await chooseWords(other, 25);
    await expect.poll(() => cloud(supabase)?.preferences.count).toBe(25);
    if (when === 'prepared') await typeInto(page, drill.slice(0, 5));
    await page.clock.fastForward(60_000);
    await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
    await expect(page.locator('#condition-line')).toContainText('10 words');
    await typeInto(page, await passageText(page));
    await expect(page.locator('#comparison-panel')).toBeVisible();
    await expect(page.locator('#result-conditions')).toContainText('10 words');

    // The retest's comparison reached the account, and the other tab's pick is still the saved one.
    await expect.poll(() => cloud(supabase)?.loops?.length, { timeout: 15000 }).toBe(1);
    expect(cloud(supabase).preferences).toMatchObject({ mode: 'words', count: 25 });
    expect((await cachedProfile(page)).preferences).toMatchObject({ mode: 'words', count: 25 });
    await expect(other.locator('#condition-line')).toContainText('25 words');
    await expect(page.locator('#duration-options [data-length="25"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#run-again').click();
    await expect(page.locator('#condition-line')).toContainText('25 words');
    expect((await passageText(page)).split(' ')).toHaveLength(25);
    expect(errors).toEqual([]);
  });
}

test('a run another tab saved but could not send goes up with this tab’s next pull', async ({ page, context, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  // The shape the other tab's run uses is already this tab's, so nothing it saves prepares a new passage here.
  await chooseWords(page, 10);
  await expect.poll(() => cloud(supabase)?.preferences.count).toBe(10);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  // The other tab's pushes fail, and it closes before the connection returns.
  await other.route(/\/rest\/v1\/profiles/, (route) => route.abort());
  await finishRun(other);
  await openView(page, 'Progress');
  await expect(page.locator('#run-history .run-row')).toHaveCount(1);
  await other.close();
  expect(runIds(cloud(supabase))).toEqual([]);

  // This tab saved nothing itself, but holds a run the account lacks: its next pull sends it.
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect.poll(() => runIds(cloud(supabase)).length).toBe(1);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  expect(errors).toEqual([]);
});

test('hiding a tab sends nothing; a run it could not send waits in the device cache for the next load', async ({ page, supabase }) => {
  supabase.addUser(EMAIL);
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  const writes = [];
  await page.route(/\/rest\/v1\/profiles/, (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    writes.push(route.request().method());
    return route.abort();
  });
  // Hidden straight after the run, while its push is still waiting: hiding itself writes nothing.
  await finishRun(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
  expect(writes).toEqual([]);
  // The waiting push still goes, and fails here: the run stays in the device cache only.
  await expect.poll(() => writes.length).toBeGreaterThan(0);
  const [run] = runIds(await cachedProfile(page));
  expect(run).toBeTruthy();
  expect(runIds(cloud(supabase))).toEqual([]);

  await page.unroute(/\/rest\/v1\/profiles/);
  await page.reload();
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  expect(runIds(cloud(supabase))).toEqual([run]);
});

test('a tab puts back a run that another tab’s write from an older read left out of the device cache', async ({ page, context, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  // Offline: the device cache is the only copy of a run until the connection returns.
  for (const tab of [page, other]) await tab.route(/\/rest\/v1\/profiles/, (route) => route.abort());
  const key = (await storageKeys(page)).find((name) => name.startsWith('stilltype-profile-v2:'));
  const before = await cachedProfile(page);
  await finishRun(page);
  await expect.poll(async () => (await cachedProfile(other)).runs.length).toBe(1);

  // Two saves at the same moment: the other tab picked a text size from the copy it read before this
  // tab's run landed, so its write leaves the run out.
  const now = new Date().toISOString();
  const stale = { ...before, preferences: { ...before.preferences, fontSize: '36' },
    preferencesAt: { ...before.preferencesAt, fontSize: now }, updatedAt: now, mergeStamp: now };
  await other.evaluate(([name, text]) => localStorage.setItem(name, text), [key, JSON.stringify(stale)]);
  await expect(page.locator('body')).toHaveAttribute('data-font-size', '36');
  await expect.poll(async () => (await cachedProfile(other)).runs.length).toBe(1);
  expect((await cachedProfile(other)).preferences.fontSize).toBe('36');

  // Closed before the connection returns, the first tab has left the run on the device.
  await page.close();
  await other.unroute(/\/rest\/v1\/profiles/);
  await other.reload();
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await expect.poll(() => runIds(cloud(supabase)).length).toBe(1);
  await expect(other.locator('body')).toHaveAttribute('data-font-size', '36');
  expect(errors).toEqual([]);
});

async function clearHistoryIn(page) {
  await openView(page, 'Progress');
  await page.locator('#clear-history').click();
  await page.locator('#confirm-clear-input').fill('clear');
  await page.locator('#confirm-clear').click();
}

// A device that hasn't heard of a clear shows a passage, then merges the clear (which drops seen marks it
// can't date) before the passage is typed. Typing it still marks it seen.
for (const kind of ['daily', 'interrupted']) {
  test(`a ${kind} run of a passage shown before a clear arrived keeps the passage marked seen`, async ({ page, browser, supabase }) => {
    supabase.addUser(EMAIL);
    const errors = [];
    await openApp(page);
    await signInWithEmail(page, EMAIL);
    await finishRun(page);
    await expect.poll(() => runIds(cloud(supabase)).length).toBe(1);
    const { context, page: phone } = await device(browser, supabase, errors);
    try {
      await clearHistoryIn(page);
      await expect.poll(() => cloud(supabase)?.historyClearedAt).toBeTruthy();

      if (kind === 'daily') {
        await openView(phone, 'Challenge');
        await phone.locator('#challenge-daily').click();
        await phone.locator('#start-daily').click();
        await expect(phone.locator('#session-description')).toContainText('first attempt');
      } else {
        await phone.locator('#restart-button').click();
      }
      // The save of the passage shown goes up and merges the clear before anything is typed.
      await expect.poll(async () => (await cachedProfile(phone))?.historyClearedAt).toBeTruthy();
      const text = await passageText(phone);
      if (kind === 'daily') {
        await typeInto(phone, text);
        await expect(phone.locator('body')).toHaveAttribute('data-view', 'results');
        await phone.locator('#run-again').click();
        await expect(phone.locator('#typing-screen')).toHaveAttribute('data-session', 'daily');
        await expect(phone.locator('#session-description')).toContainText('repeat attempt');
      } else {
        await typeInto(phone, text.slice(0, 3));
        await openView(phone, 'Progress');
      }
      const data = await cachedProfile(phone);
      const run = data.runs.at(-1);
      expect(run.kind).toBe(kind === 'daily' ? 'daily' : 'test');
      expect(data.seenTextIds).toContain(run.textId);
      if (kind === 'daily') expect(data.seenTextIds).toContain(`daily-${run.challengeDate}-v1`);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test('a test shape picked in another tab leaves keyboard focus on the length pill it was on', async ({ page, context, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await chooseWords(page, 10);
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');

  await page.locator('#duration-options [data-length="25"]').focus();
  await chooseWords(other, 50);
  await expect(page.locator('#condition-line')).toContainText('50 words');
  await expect(page.locator('#duration-options [data-length="25"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#condition-line')).toContainText('25 words');
  expect(errors).toEqual([]);
});

test('a clear in another tab withdraws the drill and retest offered for a cleared run', async ({ page, context, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await finishRun(page);
  await expect(page.locator('#skip-to-retest')).toBeEnabled();
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');

  await clearHistoryIn(other);
  await expect(page.locator('#best')).toHaveText('No best yet');
  await expect(page.locator('#skip-to-retest')).toBeDisabled();
  await expect(page.locator('#start-drill')).toBeDisabled();
  await expect(page.locator('#result-delta')).toHaveText('No run yet.');
  expect(errors).toEqual([]);
});

test('a run another tab finishes moves a last-run pace caret here', async ({ page, context, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await chooseWords(page, 10);
  await openSettings(page);
  await chooseSetting(page, 'pace-select', 'last');
  await page.keyboard.press('Escape');
  await expect(page.locator('#pace-label')).toHaveText('pace 60 wpm');
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');

  const wpm = await finishRun(other);
  await expect(page.locator('#pace-label')).toHaveText(`pace ${wpm} wpm`);
  expect(errors).toEqual([]);
});

test('an older clear that names the run on show withdraws its drill and retest under an unchanged newer clear', async ({ page, supabase }) => {
  const user = supabase.addUser(EMAIL);
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await finishRun(page);
  await expect(page.locator('#skip-to-retest')).toBeEnabled();
  await expect.poll(() => runIds(cloud(supabase)).length).toBe(1);
  const row = supabase.profiles.get(user.id);
  const [run] = row.data.runs;
  const stamps = row.data.runs.map((record) => Date.parse(record.at)).filter(Number.isFinite);
  const newer = new Date(Math.min(...stamps) - 5000).toISOString();
  const older = new Date(Math.min(...stamps) - 60000).toISOString();
  const pull = async (data) => {
    row.data = data;
    row.updated_at = new Date().toISOString().replace('Z', '+00:00');
    await page.evaluate(() => dispatchEvent(new Event('online')));
  };

  // A device that never held the run cleared just before it was stamped: the run is after that clear.
  await pull({ ...row.data, historyClearedAt: newer });
  await expect.poll(async () => (await cachedProfile(page))?.historyClearedAt).toBe(newer);
  await expect(page.locator('#skip-to-retest')).toBeEnabled();

  // A device whose clock runs behind held the run and cleared earlier, naming it. Its merge with the
  // row keeps the newer marker and drops the run.
  const named = (record) => record.id === run.id;
  await pull({
    ...row.data,
    runs: row.data.runs.filter((record) => !named(record)),
    bests: Object.fromEntries(Object.entries(row.data.bests).filter(([, best]) => best.attemptId !== run.id)),
    historyClearedIds: [[older, run.id]],
  });
  await expect.poll(async () => (await cachedProfile(page))?.historyClearedIds).toEqual([[older, run.id]]);
  expect((await cachedProfile(page)).historyClearedAt).toBe(newer);
  await expect(page.locator('#skip-to-retest')).toBeDisabled();
  await expect(page.locator('#start-drill')).toBeDisabled();
  await expect(page.locator('#result-delta')).toHaveText('No run yet.');
});

// A tab answers to every clear it has applied, not only its newest. Once a newer clear is undone, a run
// it made after an older clear (stamped before that clear by a clock running behind the clearing one)
// stays, and so do its drill and retest.
test('a newer clear undone elsewhere leaves the run on show made after an older clear this tab applied', async ({ page, supabase }) => {
  const user = supabase.addUser(EMAIL);
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  const row = () => supabase.profiles.get(user.id);
  const pull = async (data) => {
    row().data = data;
    row().updated_at = new Date().toISOString().replace('Z', '+00:00');
    await page.evaluate(() => dispatchEvent(new Event('online')));
  };

  // A laptop whose clock runs an hour ahead clears; this tab applies it. A desktop that had applied it
  // clears too, stamped just past it; this tab applies that as well.
  const ahead = Date.now() + 3600000;
  const older = `${new Date(ahead).toISOString()}~laptop01`;
  await pull({ ...row().data, historyClearedAt: older });
  await expect.poll(async () => (await cachedProfile(page))?.historyClearedAt).toBe(older);
  const newer = `${new Date(ahead + 1).toISOString()}~desktop1`;
  await pull({ ...row().data, historyClearedAt: newer, appliedClears: [older] });
  await expect.poll(async () => (await cachedProfile(page))?.historyClearedAt).toBe(newer);

  // This tab finishes a run, stamped before the laptop's marker by its own clock, and sends it.
  await finishRun(page);
  await expect(page.locator('#skip-to-retest')).toBeEnabled();
  await expect.poll(() => runIds(cloud(supabase)).length).toBe(1);
  const [run] = runIds(cloud(supabase));

  // The desktop undoes its clear, and its copy reaches the row: the laptop's clear is the one in force.
  const { appliedClears, ...rest } = row().data;
  expect(appliedClears).toEqual([older]);
  await pull({ ...rest, historyClearedAt: older, undoneClears: [newer], runs: [], attempts: [], bests: {}, seenTextIds: [] });
  await expect.poll(async () => (await cachedProfile(page))?.historyClearedAt).toBe(older);
  expect(runIds(await cachedProfile(page))).toEqual([run]);
  await expect.poll(() => runIds(cloud(supabase))).toEqual([run]);
  await expect(page.locator('#skip-to-retest')).toBeEnabled();
  await expect(page.locator('#result-delta')).not.toHaveText('No run yet.');
});

test('a clear in another tab during a retest applies when it ends, with no comparison to the cleared run', async ({ page, context, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await finishRun(page);
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await page.locator('#skip-to-retest').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 3));

  await clearHistoryIn(other);
  await expect.poll(() => cloud(supabase)?.historyClearedAt).toBeTruthy();
  // Nothing changes mid-run.
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await page.keyboard.type(text.slice(3));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#comparison-panel')).toHaveAttribute('data-outcome', 'unavailable');
  await expect(page.locator('#comparison-caveat')).toContainText('history was cleared');
  await expect(page.locator('#skip-to-retest')).toBeDisabled();
  // The retest itself is kept; no comparison with the cleared run is.
  await expect.poll(() => runIds(cloud(supabase)).length, { timeout: 15000 }).toBe(1);
  expect(cloud(supabase).loops || []).toEqual([]);
  expect(errors).toEqual([]);
});

const isProfileWrite = (request) => request.method() === 'PATCH' && /\/rest\/v1\/profiles/.test(request.url());

test('undo right after a clear keeps a run saved while an earlier write was still out', async ({ page, supabase }) => {
  supabase.addUser(EMAIL);
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await finishRun(page);
  await expect.poll(() => runIds(cloud(supabase)).length).toBe(1);

  // The next write is held until a later run is saved and history is cleared.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let heldWrite;
  const writeOut = new Promise((resolve) => { heldWrite = resolve; });
  let holding = true;
  await page.route(/\/rest\/v1\/profiles/, async (route) => {
    if (holding && isProfileWrite(route.request())) {
      holding = false;
      heldWrite();
      await gate;
    }
    await route.fallback();
  });
  let writes = 0;
  page.on('response', (response) => { if (isProfileWrite(response.request())) writes += 1; });
  await finishRun(page);
  await writeOut;
  await finishRun(page);
  await clearHistoryIn(page);
  await expect(page.locator('#progress-empty')).toBeVisible();

  // The held write lands, and the push queued behind it goes up, before the undo.
  release();
  await expect.poll(() => writes).toBeGreaterThanOrEqual(2);
  await page.locator('#undo-clear').click();
  await expect(page.locator('#history-feedback')).toHaveText('History restored.');
  await expect(page.locator('#run-history .run-row')).toHaveCount(3);
  await expect.poll(() => runIds(cloud(supabase)).length, { timeout: 15000 }).toBe(3);
});

test('signing out while the account service never answers still finishes and keeps this device’s runs', async ({ page, supabase }) => {
  supabase.addUser(EMAIL);
  await page.clock.install();
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  let release;
  const stalled = new Promise((resolve) => { release = resolve; });
  await page.route(/\/rest\/v1\/profiles/, async (route) => {
    await stalled;
    await route.fallback().catch(() => {});
  });
  try {
    await finishRun(page);
    const userId = (await storageKeys(page)).find((key) => key.startsWith('stilltype-profile-v2:'));
    await page.locator('#account-trigger').click();
    // The page's own clock when it gives up on the account and ends the sign-in.
    let abandoned;
    await page.route(/\/auth\/v1\/logout/, async (route) => {
      abandoned = await page.evaluate(() => Date.now());
      await route.fallback();
    });
    const started = await page.evaluate(() => Date.now());
    const signedOut = page.waitForEvent('load');
    await page.locator('#account-signout').click();
    // Its requests time out on the page's clock, moved on a second at a time until it gives up on them.
    await expect.poll(async () => {
      if (abandoned === undefined) await page.clock.runFor(1000);
      return abandoned !== undefined;
    }, { intervals: [100], timeout: 20000 }).toBe(true);
    await signedOut;
    expect(abandoned - started).toBeLessThan(40000);
    await expect(page.locator('#account')).toHaveAttribute('data-state', 'guest');
    // Nothing reached the account, so the run stays on the device for the next sign-in.
    expect(await storageKeys(page)).toContain(userId);
    const kept = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), userId);
    expect(kept.runs).toHaveLength(1);
  } finally {
    release();
  }
});

test('an old tab of a signed-out account leaves the account signed in since alone', async ({ page, context, supabase }) => {
  supabase.addUser(EMAIL);
  supabase.addUser('second@stilltype.test');
  // Short-lived tokens, so every request refreshes first.
  supabase.sessionSeconds = 30;
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await other.locator('#account-trigger').click();
  await Promise.all([other.waitForEvent('load'), other.locator('#account-signout').click()]);
  await expect(other.locator('#account')).toHaveAttribute('data-state', 'guest');
  await signInWithEmail(other, 'second@stilltype.test');

  // The first tab held the old account, whose refresh token the sign-out ended (it starts again as a
  // guest once it hears of the sign-out). Coming back to it must not end the other account's session.
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  // Whatever the first tab does in the background happens within a few round trips.
  await page.waitForTimeout(2000);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('stilltype-session-v1'))?.user?.email);
  expect(stored).toBe('second@stilltype.test');
  await other.reload();
  await expect(other.locator('#account')).toHaveAttribute('data-state', 'member');
  await expect(other.locator('#account-email')).toHaveText('second@stilltype.test');
  expect(errors).toEqual([]);
});

// Requests a page sends to the account service with a signed-in user's token.
function memberCalls(page) {
  const calls = [];
  page.on('request', (request) => {
    if (/supabase\.co/.test(request.url()) && request.headers().authorization) calls.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  return calls;
}

// A guest tab sends nothing for an account, whatever brings it back into use.
async function expectNoMemberCalls(page, calls) {
  calls.length = 0;
  await page.evaluate(() => {
    dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await finishRun(page);
  // Whatever the tab does in the background happens within a few round trips.
  await page.waitForTimeout(2000);
  expect(calls).toEqual([]);
  expect(await storageKeys(page)).toEqual([]);
}

for (const next of [null, EMAIL, 'second@stilltype.test']) {
  const then = !next ? 'as a guest' : next === EMAIL ? 'as the same account, signed in again' : 'as the account signed in since';
  test(`a tab mid-run when another signs out having sent everything finishes the run, then starts again ${then}`, async ({ page, context, supabase }) => {
    supabase.addUser(EMAIL);
    if (next && next !== EMAIL) supabase.addUser(next);
    const errors = [];
    await openApp(page);
    await signInWithEmail(page, EMAIL);
    const other = await extraPage(context, supabase, errors);
    const calls = memberCalls(other);
    await openApp(other);
    await openView(other, 'Practice');
    await chooseWords(other, 10);
    await expect.poll(() => cloud(supabase)?.preferences.count).toBe(10);
    await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
    expect(calls.length).toBeGreaterThan(0);
    const text = await passageText(other);
    await typeInto(other, text.slice(0, 3));

    await page.locator('#account-trigger').click();
    await Promise.all([page.waitForEvent('load'), page.locator('#account-signout').click()]);
    await expect(page.locator('#account')).toHaveAttribute('data-state', 'guest');
    expect(await storageKeys(page)).toEqual([]);
    if (next) await signInWithEmail(page, next);

    // The run goes on undisturbed and ends as usual; the tab then follows the device's session.
    await expect(other.locator('body')).toHaveAttribute('data-running', 'true');
    await other.keyboard.type(text.slice(3));
    if (next) {
      await expect(other.locator('#account')).toHaveAttribute('data-state', 'member');
      await expect(other.locator('#account-email')).toHaveText(next);
      await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
      // The tab started again from the account: the run, kept in memory only, went with the old page.
      await openView(other, 'Progress');
      await expect(other.locator('#run-history .run-row')).toHaveCount(0);
      expect((await cachedProfile(other)).runs).toEqual([]);
    } else {
      await expect(other.locator('#account')).toHaveAttribute('data-state', 'guest');
      await expectNoMemberCalls(other, calls);
    }
    // A run finished after the sign-out reaches no account.
    expect(runIds(supabase.profileFor(EMAIL))).toEqual([]);
    if (next) expect(runIds(supabase.profileFor(next))).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const next of ['second@stilltype.test', EMAIL]) {
  const who = next === EMAIL ? 'the same account' : 'another account';
  test(`a sign-out overtaken mid-run by a sign-out and sign-in to ${who} in another tab leaves the new session alone`, async ({ page, context, supabase }) => {
    supabase.addUser(EMAIL);
    if (next !== EMAIL) supabase.addUser(next);
    const errors = [];
    await openApp(page);
    await signInWithEmail(page, EMAIL);
    const other = await extraPage(context, supabase, errors);
    await openApp(other);
    await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
    await openView(page, 'Practice');
    await chooseWords(page, 10);
    await expect.poll(() => cloud(supabase)?.preferences.count).toBe(10);
    await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
    const text = await passageText(page);
    await typeInto(page, text.slice(0, 3));

    // This tab signs out mid-run, and its push waits on the network while typing goes on. (Requests give
    // up after 15 s, so the other tab's sign-out and sign-in fit within that.)
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let held = 0;
    await page.route(/\/rest\/v1\/profiles/, async (route) => {
      held += 1;
      await gate;
      await route.fallback().catch(() => {});
    });
    await page.mouse.move(5, 5);
    await page.mouse.move(40, 40);
    await page.locator('#account-trigger').click();
    await page.locator('#account-signout').click();
    await expect.poll(() => held).toBeGreaterThan(0);
    await typeInto(page, text.slice(3, 5));
    await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
    await expect(page.locator('#typing-status')).toHaveText('In progress');

    // Meanwhile the other tab signs out, having sent everything, and signs in.
    await other.locator('#account-trigger').click();
    await Promise.all([other.waitForEvent('load'), other.locator('#account-signout').click()]);
    await expect(other.locator('#account')).toHaveAttribute('data-state', 'guest');
    await signInWithEmail(other, next);
    const stored = await other.evaluate(() => localStorage.getItem('stilltype-session-v1'));

    // The waiting sign-out finds itself overtaken and starts again as the device now is. The new session
    // and the other tab stay as they were, and nothing is marked signed out.
    const reloaded = page.waitForEvent('load');
    release();
    await reloaded;
    await expect(page.locator('#account')).toHaveAttribute('data-state', 'member');
    await expect(page.locator('#account-email')).toHaveText(next);
    expect(await page.evaluate(() => localStorage.getItem('stilltype-session-v1'))).toBe(stored);
    expect((await storageKeys(page)).filter((key) => key.startsWith('stilltype-signed-out:'))).toEqual([]);
    await other.reload();
    await expect(other.locator('#account')).toHaveAttribute('data-state', 'member');
    await expect(other.locator('#account-email')).toHaveText(next);
    await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
    expect(errors).toEqual([]);
  });
}

// A tab signed in to the account and a guest tab beside it. The guest tab's sign-in to the same account
// leaves no sign-out marker: it only stores a newer sign-in over this tab's.
async function besideGuestTab(page, context, supabase, errors) {
  supabase.addUser(EMAIL);
  await openApp(page);
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await signInWithEmail(page, EMAIL);
  await expect(other.locator('#account')).toHaveAttribute('data-state', 'guest');
  const logouts = [];
  page.on('request', (request) => {
    if (/\/auth\/v1\/logout/.test(request.url())) logouts.push(request.headers().authorization);
  });
  return { other, logouts };
}

const storedSession = (page) => page.evaluate(() => localStorage.getItem('stilltype-session-v1'));

test('signing out after a guest tab signed in to the same account ends that newer sign-in, in both tabs', async ({ page, context, supabase }) => {
  const errors = [];
  const { other, logouts } = await besideGuestTab(page, context, supabase, errors);
  const first = JSON.parse(await storedSession(page));
  await signInWithEmail(other, EMAIL);
  const newer = JSON.parse(await storedSession(other));
  expect(newer.refresh_token).not.toBe(first.refresh_token);

  // This tab still shows the account, so its sign-out ends the sign-in the device holds for it when asked,
  // with that sign-in's token: every tab of the account signs out, as when they share one sign-in.
  await page.locator('#account-trigger').click();
  await Promise.all([page.waitForEvent('load'), page.locator('#account-signout').click()]);
  await expect(page.locator('#account')).toHaveAttribute('data-state', 'guest');
  await expect(other.locator('#account')).toHaveAttribute('data-state', 'guest');
  expect(logouts).toEqual([`Bearer ${newer.access_token}`]);
  expect(await storedSession(page)).toBeNull();
  expect(errors).toEqual([]);
});

test('a sign-out overtaken by a guest tab signing in to the same account leaves that sign-in alone', async ({ page, context, supabase }) => {
  const errors = [];
  const { other, logouts } = await besideGuestTab(page, context, supabase, errors);

  // This tab signs out, and its push waits on the network.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let held = 0;
  await page.route(/\/rest\/v1\/profiles/, async (route) => {
    held += 1;
    await gate;
    await route.fallback().catch(() => {});
  });
  await page.locator('#account-trigger').click();
  await page.locator('#account-signout').click();
  await expect.poll(() => held).toBeGreaterThan(0);

  // Meanwhile the guest tab signs in to the same account.
  await signInWithEmail(other, EMAIL);
  const stored = await storedSession(other);

  // The waiting sign-out finds itself overtaken and starts again as the device now is: signed in, with the
  // other tab's sign-in still stored and still valid, and nothing marked signed out.
  const reloaded = page.waitForEvent('load');
  release();
  await reloaded;
  await expect(page.locator('#account')).toHaveAttribute('data-state', 'member');
  await expect(page.locator('#account-email')).toHaveText(EMAIL);
  expect(await storedSession(page)).toBe(stored);
  expect(logouts).toEqual([]);
  expect(supabase.refreshTokens.has(JSON.parse(stored).refresh_token)).toBe(true);
  expect((await storageKeys(page)).filter((key) => key.startsWith('stilltype-signed-out:'))).toEqual([]);
  await other.reload();
  await expect(other.locator('#account')).toHaveAttribute('data-state', 'member');
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  expect(errors).toEqual([]);
});

// Reads of localStorage across tabs can be milliseconds stale, so a sign-out that sent everything can
// remove a cache another tab has just saved a run to. This replays one in `page`: it read the cache as
// `sentText`, and names that copy before removing the session, the cache and its marker, as
// account.signOut does. Returns the cache's key.
const staleSignOut = (page, sentText) => page.evaluate((sent) => {
  const userId = JSON.parse(localStorage.getItem('stilltype-session-v1')).user.id;
  localStorage.setItem(`stilltype-signed-out:${userId}`, JSON.stringify({ sent }));
  localStorage.removeItem('stilltype-session-v1');
  localStorage.removeItem(`stilltype-profile-v2:${userId}`);
  localStorage.removeItem(`stilltype-signed-out:${userId}`);
  return `stilltype-profile-v2:${userId}`;
}, textStamp(sentText));

const cachedText = (page) => page.evaluate(() => {
  const key = Object.keys(localStorage).find((name) => name.startsWith('stilltype-profile-v2:'));
  return localStorage.getItem(key);
});

// Two tabs signed in, everything sent; the other tab's pushes then fail (offline, or still waiting on
// their timer when the sign-out comes). Returns the other tab and the cache as the account has it.
async function twoTabsSynced(page, context, supabase, errors) {
  supabase.addUser(EMAIL);
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await chooseWords(page, 10);
  await expect.poll(() => cloud(supabase)?.preferences.count).toBe(10);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'synced');
  const other = await extraPage(context, supabase, errors);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await other.route(/\/rest\/v1\/profiles/, (route) => route.abort());
  return { other, sentText: await cachedText(page) };
}

test('a run another tab saved just before a sign-out that sent everything reaches the account at the next sign-in', async ({ page, context, supabase }) => {
  const errors = [];
  const { other, sentText } = await twoTabsSynced(page, context, supabase, errors);
  await finishRun(other);
  await expect.poll(async () => (await cachedProfile(page))?.runs?.length).toBe(1);
  const saved = runIds(await cachedProfile(page));
  expect(runIds(cloud(supabase))).toEqual([]);

  // A sign-out here that read the cache just before that save reached it.
  const key = await staleSignOut(page, sentText);
  await page.reload();
  await expect(page.locator('#account')).toHaveAttribute('data-state', 'guest');

  // The other tab heard a copy removed that wasn't the one sent: it puts it back for the next sign-in, with
  // no session, and starts again as a guest.
  await expect(other.locator('#account')).toHaveAttribute('data-state', 'guest');
  await expect.poll(() => storageKeys(page)).toEqual([key]);
  expect(runIds(await cachedProfile(page))).toEqual(saved);
  await signInWithEmail(page, EMAIL);
  await expect.poll(() => runIds(cloud(supabase))).toEqual(saved);
  expect(errors).toEqual([]);
});

test('a tab mid-run puts back the run it saved before a sign-out that sent everything, and keeps the run in progress out', async ({ page, context, supabase }) => {
  const errors = [];
  const { other, sentText } = await twoTabsSynced(page, context, supabase, errors);
  await finishRun(other);
  await expect.poll(async () => (await cachedProfile(page))?.runs?.length).toBe(1);
  const saved = runIds(await cachedProfile(page));
  expect(runIds(cloud(supabase))).toEqual([]);
  await openView(other, 'Practice');
  const text = await passageText(other);
  await typeInto(other, text.slice(0, 3));
  await expect(other.locator('body')).toHaveAttribute('data-running', 'true');

  const key = await staleSignOut(page, sentText);
  await page.reload();
  await expect(page.locator('#account')).toHaveAttribute('data-state', 'guest');

  // The saved run goes back mid-run (only storage changes), and the run goes on undisturbed.
  await expect.poll(() => storageKeys(page)).toEqual([key]);
  expect(runIds(await cachedProfile(page))).toEqual(saved);
  await expect(other.locator('body')).toHaveAttribute('data-running', 'true');
  await expect(other.locator('#account')).toHaveAttribute('data-state', 'member');

  // Once it ends, the tab starts again as a guest; the run finished after the sign-out stays out.
  await other.keyboard.type(text.slice(3));
  await expect(other.locator('#account')).toHaveAttribute('data-state', 'guest');
  expect(await storageKeys(page)).toEqual([key]);
  expect(runIds(await cachedProfile(page))).toEqual(saved);
  await signInWithEmail(page, EMAIL);
  await expect.poll(() => runIds(cloud(supabase))).toEqual(saved);
  expect(errors).toEqual([]);
});

// The same sign-out, but its last push wrote `sentText` over the run `page` had just saved, and `page`'s
// view of storage runs a step ahead of its events: it already shows the sign-out's marker, though not yet
// the session's removal, when it hears of that write. Each write is made in `page` and its event then
// dispatched there in order, as the signing-out tab's would arrive. Returns the cache's key.
const overwrittenSignOut = (page, sentText) => page.evaluate(({ text, sent }) => {
  const sessionKey = 'stilltype-session-v1';
  const sessionText = localStorage.getItem(sessionKey);
  const userId = JSON.parse(sessionText).user.id;
  const cacheKey = `stilltype-profile-v2:${userId}`;
  const markerKey = `stilltype-signed-out:${userId}`;
  const marker = JSON.stringify({ sent });
  const saved = localStorage.getItem(cacheKey);
  const hear = (key, oldValue, newValue) => dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, storageArea: localStorage }));
  localStorage.setItem(cacheKey, text);
  localStorage.setItem(markerKey, marker);
  hear(cacheKey, saved, text);
  hear(markerKey, null, marker);
  localStorage.removeItem(sessionKey);
  hear(sessionKey, sessionText, null);
  localStorage.removeItem(cacheKey);
  hear(cacheKey, text, null);
  localStorage.removeItem(markerKey);
  hear(markerKey, marker, null);
  return cacheKey;
}, { text: sentText, sent: textStamp(sentText) });

test('a run a sign-out’s last write overwrote, heard with the sign-out under way, reaches the account at the next sign-in', async ({ page, context, supabase }) => {
  const errors = [];
  const { other, sentText } = await twoTabsSynced(page, context, supabase, errors);
  await finishRun(other);
  await expect.poll(async () => (await cachedProfile(page))?.runs?.length).toBe(1);
  const saved = runIds(await cachedProfile(other));
  expect(runIds(cloud(supabase))).toEqual([]);
  // Only `other` hears the sign-out, so only its repair counts.
  await page.goto('about:blank');

  const key = await overwrittenSignOut(other, sentText);
  // It took in the copy that lacked its run but couldn't write the union back (the sign-out had begun):
  // what it saved still goes back for the next sign-in, and it starts again as a guest.
  await expect(other.locator('#account')).toHaveAttribute('data-state', 'guest');
  expect(await storageKeys(other)).toEqual([key]);
  expect(runIds(await cachedProfile(other))).toEqual(saved);
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  await expect.poll(() => runIds(cloud(supabase))).toEqual(saved);
  expect(errors).toEqual([]);
});
