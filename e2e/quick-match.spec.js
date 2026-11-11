import { test, expect, openApp, openView, signInWithEmail, typeInto, setRaceName, openRaceLink } from './fixtures.js';

test.setTimeout(120000);

const quick = (page) => page.locator('#quick-match [data-quick="toggle"]');
const status = (page) => page.locator('#quick-match [data-quick-part="status"]');

async function signedIn(browser, supabase, email, name) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await supabase.attach(page);
  await openApp(page);
  await signInWithEmail(page, email);
  await openView(page, 'Challenge');

  if (name) await setRaceName(page, name);

  return { context, page };
}

test('two strangers press quick match, race the standard setup, see the rating move and can add each other', async ({ page, browser, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  supabase.addUser('lin@stilltype.test');
  // A short clock and countdown keep the race quick; everything else is the standard setup.
  supabase.races.quick.duration = 5;
  supabase.races.quick.countdownMs = 2000;
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openView(page, 'Challenge');
  await setRaceName(page, 'Ada');
  await expect(page.locator('#quick-match [data-quick-part="rating"]')).toHaveText('Race rating 1500 · 0 rated races · provisional');
  await quick(page).click();
  // The first press says, once, what the other racer sees.
  await expect(status(page)).toHaveText('The other racer sees your race name, Ada, and your keystroke timing in this race.');
  await expect(quick(page)).toHaveText('Stop looking');
  const { context, page: lin } = await signedIn(browser, supabase, 'lin@stilltype.test', 'Lin');

  try {
    await quick(lin).click();

    for (const racer of [page, lin]) await expect(racer.locator('#online-room-status')).toHaveText(/^Matched with (Ada|Lin)\.$/, { timeout: 5000 });
    await expect(page.locator('#online-room-status')).toHaveText('Matched with Lin.');
    // No email reaches the other racer's page.
    expect(await lin.locator('#online-room').textContent()).not.toContain('ada@');
    await expect(page.locator('#online-input')).toBeEnabled({ timeout: 6000 });
    await expect(page.locator('#online-room-status')).toHaveText('Leaving now counts as a loss.');
    const passage = await page.locator('#online-accessible-passage').textContent();
    expect(passage.length).toBeGreaterThan(100);
    await expect(lin.locator('#online-input')).toBeEnabled();
    await Promise.all([typeInto(page, passage.slice(0, 60), '#online-input', { delay: 35 }), typeInto(lin, passage.slice(0, 30), '#online-input', { delay: 70 })]);
    await expect(page.locator('#online-results')).toBeVisible({ timeout: 15000 });
    await expect(lin.locator('#online-results')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#online-rating-change')).toHaveText('Rated win. Race rating 1520 · 1 rated race · provisional (+20)');
    await expect(lin.locator('#online-rating-change')).toHaveText('Rated loss. Race rating 1480 · 1 rated race · provisional (−20)');
    // The head-to-head tally counts it, and both may add the other, the waiting player (seat 1) included.
    await expect(page.locator('#online-tally')).toHaveAttribute('aria-label', 'You 1, Lin 0');
    await expect(page.locator('#online-befriend')).toHaveText('Add Lin to friends');
    await expect(lin.locator('#online-befriend')).toHaveText('Add Ada to friends');
    await page.locator('#online-befriend').click();
    await expect(page.locator('#online-befriend')).toBeHidden();
    await page.locator('#online-leave').click();
    await expect(page.getByRole('button', { name: 'Race Lin', exact: true })).toBeVisible();
    await expect(page.locator('.people-row', { hasText: 'Lin' }).locator('.people-tally .sr-only')).toHaveText('1 win, 0 losses');
    await expect(page.locator('#quick-match [data-quick-part="rating"]')).toHaveText('Race rating 1520 · 1 rated race · provisional');
    expect(supabase.errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('a racer who closes the page mid-race loses, rated; the other racer wins once the clock and its grace run out', async ({ page, browser, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  supabase.addUser('lin@stilltype.test');
  supabase.races.quick.duration = 5;
  supabase.races.quick.countdownMs = 2000;
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openView(page, 'Challenge');
  await setRaceName(page, 'Ada');
  await quick(page).click();
  const { context, page: lin } = await signedIn(browser, supabase, 'lin@stilltype.test', 'Lin');

  try {
    await quick(lin).click();
    await expect(lin.locator('#online-input')).toBeEnabled({ timeout: 8000 });
    await expect(page.locator('#online-input')).toBeEnabled();
    const passage = await page.locator('#online-accessible-passage').textContent();
    await typeInto(lin, passage.slice(0, 10), '#online-input', { delay: 70 });
    // Lin closes the page mid-race, so no finish and no trace ever comes from that seat.
    await lin.close();
    await typeInto(page, passage.slice(0, 60), '#online-input', { delay: 35 });
    await expect(page.locator('#online-room-status')).toHaveText('Waiting for the other player.', { timeout: 8000 });
    // Ten seconds after the race clock, Ada's own poll settles it: a rated win.
    await expect(page.locator('#online-rating-change')).toHaveText('Rated win: Lin didn’t finish. Race rating 1520 · 1 rated race · provisional (+20)', { timeout: 20000 });
    await expect(page.locator('#online-results')).toBeVisible();

    // Lin comes back on a new page: the Online tab says the race was a rated loss, and why.
    const back = await context.newPage();
    await supabase.attach(back);
    await openApp(back);
    await openView(back, 'Challenge');
    await expect(status(back)).toHaveText('Rated loss: your finish didn’t arrive before the race closed. Race rating 1480 · 1 rated race · provisional (−20)');
    await expect(back.locator('#quick-match [data-quick-part="rating"]')).toHaveText('Race rating 1480 · 1 rated race · provisional');
    expect(supabase.races.quick.results.size).toBe(1);
    expect(supabase.errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('with nobody waiting, quick match offers to keep waiting or race your own best recorded run', async ({ page, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  await page.clock.install();
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  // A 30-second run on the default setup, recorded on this device.
  const passage = await page.locator('#accessible-passage').textContent();
  await typeInto(page, passage.slice(0, 120), '#typing-input', { delay: 60 });
  await page.clock.fastForward(31000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await openView(page, 'Challenge');
  await quick(page).click();
  await expect(quick(page)).toHaveText('Stop looking');
  // The first reply has landed once a poll follows it.
  await expect.poll(() => supabase.requests.filter((entry) => entry.includes('quick_match')).length).toBeGreaterThan(3);
  await page.clock.fastForward(21000);
  await expect(status(page)).toHaveText('Nobody else is looking right now.');
  await expect(page.locator('#quick-match [data-quick="keep"]')).toBeVisible();
  await page.locator('#quick-match [data-quick="keep"]').click();
  await expect(page.locator('#quick-match [data-quick-part="lonely"]')).toBeHidden();
  await page.clock.fastForward(21000);
  await page.locator('#quick-match [data-quick="best"]').click();
  // The ghost race is labelled as your own recording, and you have left the queue.
  await expect(page.locator('#session-title')).toHaveText('Race your best run');
  await expect(page.locator('#session-description')).toHaveText('The ghost is your own recording. Not counted toward your best.');
  await expect.poll(() => supabase.races.quick.queue.size).toBe(0);
  await expect(page.locator('body')).toHaveAttribute('data-session', 'challenge');
  await expect(page.locator('#text-display .ghost-caret')).not.toHaveClass(/is-hidden/);
  const ghostText = await page.locator('#accessible-passage').textContent();
  expect(passage.startsWith(ghostText.slice(0, 100))).toBe(true);
  await typeInto(page, ghostText.slice(0, 40), '#typing-input', { delay: 60 });
  await page.clock.fastForward(31000);
  await expect(page.locator('#ghost-result-status')).toHaveText('The ghost was your own recording.');
  await expect(page.locator('#ghost-result-action')).toHaveText('Race again');
});

test('a guest sees quick match and is asked to sign in', async ({ page }) => {
  await openApp(page);
  await openView(page, 'Challenge');
  await expect(quick(page)).toBeVisible();
  await quick(page).click();
  await expect(page.locator('#account-dialog')).toBeVisible();
});

test('before the migration is applied, quick match says it is being set up and hosting still works', async ({ page, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  supabase.races.quick.missing = true;
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openView(page, 'Challenge');
  await expect(page.locator('#quick-match [data-quick-part="rating"]')).toBeHidden();
  await quick(page).click();
  await expect(status(page)).toHaveText('Quick match is being set up. Please try again shortly.');
  await expect(quick(page)).toHaveText('Find a race');
  await openRaceLink(page);
  await expect(page.locator('#online-room')).toBeVisible();
});

test('a pairing that lands after Stop never opens the race, and the other racer sees it called off', async ({ page, browser, supabase }) => {
  supabase.addUser('ada@stilltype.test');
  supabase.addUser('lin@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openView(page, 'Challenge');
  await quick(page).click();
  await expect(quick(page)).toHaveText('Stop looking');
  const { context, page: lin } = await signedIn(browser, supabase, 'lin@stilltype.test', 'Lin');

  try {
    // Lin's request pairs on the service, but its reply is held until after Lin presses Stop.
    const release = supabase.races.quick.holdNextQueue();
    await quick(lin).click();
    await expect(quick(lin)).toHaveText('Stop looking');
    await expect(page.locator('#online-room-status')).toHaveText('Matched with Lin.', { timeout: 5000 });
    await quick(lin).click();
    await expect(quick(lin)).toHaveText('Find a race');
    release();
    await expect(page.locator('#online-room-status')).toHaveText('The race was called off before the start.', { timeout: 8000 });
    await expect(lin.locator('#online-room')).toBeHidden();
    await expect(lin.locator('#challenge-people')).toBeVisible();
  } finally {
    await context.close();
  }
});
