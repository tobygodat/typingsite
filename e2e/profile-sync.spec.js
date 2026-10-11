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
    preferencesAt: { ...before.preferencesAt, fontSize: now }, updatedAt: now };
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
  await page.locator('#pace-select').selectOption('last');
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
  const stamps = [...row.data.runs, ...row.data.attempts].map((record) => Date.parse(record.at)).filter(Number.isFinite);
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
    attempts: row.data.attempts.filter((record) => !named(record)),
    bests: Object.fromEntries(Object.entries(row.data.bests).filter(([, best]) => best.attemptId !== run.id)),
    historyClearedIds: [[older, run.id]],
  });
  await expect.poll(async () => (await cachedProfile(page))?.historyClearedIds).toEqual([[older, run.id]]);
  expect((await cachedProfile(page)).historyClearedAt).toBe(newer);
  await expect(page.locator('#skip-to-retest')).toBeDisabled();
  await expect(page.locator('#start-drill')).toBeDisabled();
  await expect(page.locator('#result-delta')).toHaveText('No run yet.');
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
    const started = Date.now();
    await Promise.all([page.waitForEvent('load', { timeout: 45000 }), page.locator('#account-signout').click()]);
    expect(Date.now() - started).toBeLessThan(40000);
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

test('a tab open when another signs out having sent everything starts again as a guest', async ({ page, context, supabase }) => {
  supabase.addUser(EMAIL);
  const errors = [];
  await openApp(page);
  await signInWithEmail(page, EMAIL);
  const other = await extraPage(context, supabase, errors);
  const calls = memberCalls(other);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  expect(calls.length).toBeGreaterThan(0);

  await page.locator('#account-trigger').click();
  await Promise.all([page.waitForEvent('load'), page.locator('#account-signout').click()]);
  await expect(page.locator('#account')).toHaveAttribute('data-state', 'guest');
  // Everything had reached the account, so the sign-out left no marker, only a removed cache.
  expect(await storageKeys(page)).toEqual([]);
  await expect(other.locator('#account')).toHaveAttribute('data-state', 'guest');
  await expectNoMemberCalls(other, calls);
  expect(runIds(cloud(supabase))).toEqual([]);
  expect(errors).toEqual([]);
});

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
