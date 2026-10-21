import { test, expect, chooseWords, completePassage, openApp, openProgressView, openView, passageText, signInWithEmail, storageKeys, typeInto } from './fixtures.js';

const figure = (page, label) => page.locator('#practice-stats .progress-figure').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) });
const totals = (counts) => Object.values(counts || {}).flatMap(Object.values)
  .reduce((sum, [started, finished]) => ({ started: sum.started + started, finished: sum.finished + finished }), { started: 0, finished: 0 });

// The first key starts a run; Escape restarts it before it ends.
async function startRun(page) {
  await typeInto(page, (await passageText(page)).slice(0, 6));
  await expect(page.locator('body')).toHaveAttribute('data-running', 'true');
}
async function restartRun(page) {
  await startRun(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-running', 'false');
}

test('a restarted and an abandoned run count as started, and only the finished one as finished', async ({ page }) => {
  await openApp(page);
  await chooseWords(page, 10);
  await completePassage(page);
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await restartRun(page);
  await startRun(page);
  await openView(page, 'Progress');
  await openProgressView(page, 'Practice');

  await expect(figure(page, 'Runs started').locator('.figure-value')).toHaveText('3 1 finished');
  expect(await storageKeys(page), 'a guest writes nothing').toEqual([]);
});

test('two tabs of an account count their own starts, and a restart is saved without a finish', async ({ page, supabase }) => {
  const user = supabase.addUser('starts@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, user.email);
  const other = await page.context().newPage();
  await supabase.attach(other);
  await openApp(other);
  await expect(other.locator('#account')).toHaveAttribute('data-state', 'member');

  await chooseWords(page, 10);
  await completePassage(page);
  await chooseWords(other, 10);
  await restartRun(other);
  await expect.poll(() => totals(supabase.profileFor(user.email)?.runCounts)).toEqual({ started: 2, finished: 1 });
  expect(Object.keys(supabase.profileFor(user.email).runCounts), 'one counter per tab').toHaveLength(2);

  await page.keyboard.press('Enter');
  await restartRun(page);
  await expect.poll(() => totals(supabase.profileFor(user.email)?.runCounts)).toEqual({ started: 3, finished: 1 });

  await other.reload();
  await expect(other.locator('#account')).toHaveAttribute('data-sync', 'synced');
  await openView(other, 'Progress');
  await openProgressView(other, 'Practice');
  await expect(figure(other, 'Runs started').locator('.figure-value')).toHaveText('3 1 finished');
});
