// One account in two tabs or on two devices, against the fake Supabase in e2e/fake-supabase.js: a save
// from a copy that is out of date merges with the other copy instead of replacing it.
import { test, expect, openApp, openView, openSettings, chooseWords, passageText, typeInto, signInWithEmail, storageKeys } from './fixtures.js';

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
  await other.locator('#font-size').selectOption('36');
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

test('two devices: a stale device’s push keeps the other device’s run, higher best and settings', async ({ page, browser, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  const { context, page: phone } = await device(browser, supabase, errors);
  try {
    const fast = await finishRun(phone);
    await openSettings(phone);
    await phone.locator('#font-size').selectOption('22');
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
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('a settings change from a stale device keeps the history saved elsewhere and wins as the newest change', async ({ page, browser, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  const { context, page: phone } = await device(browser, supabase, errors);
  try {
    await phone.emulateMedia({ colorScheme: 'dark' });
    const wpm = await finishRun(phone);
    await expect.poll(() => runIds(cloud(supabase)).length).toBe(1);
    const before = cloud(supabase);

    await openSettings(page);
    await page.locator('#theme-select').selectOption('light');
    await expect.poll(() => cloud(supabase).preferences.theme).toBe('light');
    const data = cloud(supabase);
    expect(runIds(data)).toEqual(runIds(before));
    expect(data.attempts.map((attempt) => attempt.id)).toEqual(before.attempts.map((attempt) => attempt.id));
    expect(data.bests).toEqual(before.bests);
    expect(data.seenTextIds).toEqual(expect.arrayContaining(before.seenTextIds));

    await expectBothRuns(phone, { runs: 1, best: wpm });
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
    expect(data.attempts.map((attempt) => attempt.id)).not.toContain(cleared);
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
    await phone.locator('#theme-select').selectOption('light');
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
  await other.locator('#font-size').selectOption('36');
  await finishRun(other);
  // Every write the other tab makes lands while this tab's race is still running.
  await expect.poll(() => runIds(cloud(supabase)).length).toBe(1);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await expect(page.locator('body')).toHaveAttribute('data-font-size', '28');

  await page.keyboard.type(text.slice(5));
  await expect(page.locator('#race-handoff')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-font-size', '36');
  await page.locator('#start-next-player').click();
  await expect(page.locator('#race-status')).toHaveText('Player 2 of 2');
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
