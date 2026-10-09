// One account in two tabs or on two devices, against the fake Supabase in e2e/fake-supabase.js: a save
// from a copy that is out of date merges with the other copy instead of replacing it.
import { test, expect, openApp, openView, openSettings, chooseWords, passageText, typeInto, signInWithEmail } from './fixtures.js';

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
