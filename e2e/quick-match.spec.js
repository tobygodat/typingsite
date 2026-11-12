import { test, expect, openApp, openView, signInWithEmail, typeInto, setRaceName, openRaceLink } from './fixtures.js';

test.setTimeout(120000);

const quick = (page) => page.locator('#quick-match [data-quick="toggle"]');
const status = (page) => page.locator('#quick-match [data-quick-part="status"]');
const card = (page, part) => page.locator(`#online-rank-card [data-rc="${part}"]`);
const ends = (page) => card(page, 'ends').locator('span');

async function signedIn(browser, supabase, email, name, options = {}) {
  const context = await browser.newContext(options);
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
    // A provisional result's card leads with the rating and the change, with no emblem or bar before a rank.
    await expect(card(page, 'label')).toHaveText('Rated win');
    await expect(card(page, 'rating')).toHaveText('1520');
    await expect(card(page, 'delta')).toHaveText('+20');
    await expect(card(page, 'count')).toHaveText('1 rated race · provisional');
    await expect(card(page, 'emblem')).toBeHidden();
    await expect(card(page, 'bar')).toBeHidden();
    await expect(card(lin, 'label')).toHaveText('Rated loss');
    await expect(card(lin, 'delta')).toHaveText('−20');
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

test('a ranked account reads its rank on the rating line, and a win that crosses into the next rank plays as a rank up', async ({ page, browser, supabase }) => {
  // Both settled at 1795 (Gust I) with 20 rated races, so K is 20 and a win at equal ratings moves 10 each way.
  for (const email of ['ada@stilltype.test', 'lin@stilltype.test']) supabase.races.quick.ratings.set(supabase.addUser(email).id, { rating: 1795, races: 20 });
  supabase.races.quick.duration = 5;
  supabase.races.quick.countdownMs = 2000;
  // Ada races on a dark theme.
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#online-name').fill('Ada');
  await expect(page.locator('#quick-match [data-quick-part="rating"]')).toHaveText('Gust I · 1795 · 20 rated races');
  await quick(page).click();
  // Lin races on a light theme.
  const { context, page: lin } = await signedIn(browser, supabase, 'lin@stilltype.test', 'Lin', { colorScheme: 'light' });

  try {
    await quick(lin).click();
    await expect(page.locator('#online-input')).toBeEnabled({ timeout: 8000 });
    await expect(lin.locator('#online-input')).toBeEnabled();
    const passage = await page.locator('#online-accessible-passage').textContent();
    await Promise.all([typeInto(page, passage.slice(0, 60), '#online-input', { delay: 35 }), typeInto(lin, passage.slice(0, 30), '#online-input', { delay: 70 })]);
    await expect(page.locator('#online-rating-change')).toHaveText('Rated win. Gale III · 1805 · 21 rated races (+10), up from Gust I.', { timeout: 15000 });
    // Ada's card plays the promotion in two stages: Gust I's bar fills to its end, then Gale III opens.
    await expect(card(page, 'label')).toHaveText('Rank up');
    await expect(ends(page)).toHaveText(['Gust I', '5 to Gale III']);
    await expect(ends(page)).toHaveText(['Gale III', '95 to Gale II']);
    await expect(card(page, 'rank')).toHaveText('Gale III');
    await expect(card(page, 'from')).toHaveText('promoted from Gust I');
    await expect(card(page, 'rating')).toHaveText('1805');
    await expect(card(page, 'delta')).toHaveText('+10');
    // The dark card on a dark theme, its gain in green; the screen reader hears the sentence, not the card.
    await expect(card(page, 'rating')).toHaveCSS('color', 'rgb(238, 246, 247)');
    await expect(card(page, 'delta')).toHaveCSS('color', 'rgb(134, 240, 168)');
    await expect(page.locator('#online-rank-card')).toHaveAttribute('aria-hidden', 'true');

    // The rank name is painted by a gradient clipped to its text, which stops at the box: the box has to reach
    // below a descender, or the "p" of Tempest and Whisper is cut flat.
    const room = await card(page, 'rank').evaluate((el) => {
      const mark = el.appendChild(Object.assign(document.createElement('span'), { style: 'display:inline-block;width:0;height:0' }));
      const below = el.getBoundingClientRect().bottom - mark.getBoundingClientRect().bottom;
      const style = getComputedStyle(el);
      const ink = Object.assign(document.createElement('canvas').getContext('2d'), { font: `${style.fontWeight} ${style.fontSize} ${style.fontFamily}` });

      mark.remove();

      return below - ink.measureText('p').actualBoundingBoxDescent;
    });

    expect(room).toBeGreaterThanOrEqual(0);
    await expect(page.getByRole('status').filter({ hasText: 'Rated win.' })).toHaveCount(1);
    // The wind moves while motion is allowed.
    await page.locator('#online-rank-card').scrollIntoViewIfNeeded();
    const frame = () => page.locator('#online-rank-card canvas').evaluate((canvas) => canvas.toDataURL());
    const first = await frame();
    await expect.poll(frame).not.toBe(first);
    // Lin stays in Gust I, so her line says nothing more, and neither page shows the other racer's rating.
    await expect(lin.locator('#online-rating-change')).toHaveText('Rated loss. Gust I · 1785 · 21 rated races (−10)', { timeout: 15000 });
    // On her light theme the card is paper, its loss in coral and laid back from where the bar stood.
    await expect(card(lin, 'label')).toHaveText('Rated loss');
    await expect(card(lin, 'rank')).toHaveText('Gust I');
    await expect(card(lin, 'from')).toBeHidden();
    await expect(card(lin, 'rating')).toHaveText('1785');
    await expect(card(lin, 'delta')).toHaveText('−10');
    await expect(ends(lin)).toHaveText(['Gust I', '15 to Gale III']);
    await expect(card(lin, 'rating')).toHaveCSS('color', 'rgb(27, 26, 25)');
    await expect(card(lin, 'delta')).toHaveCSS('color', 'rgb(154, 52, 32)');
    expect(await page.locator('#online-room').textContent()).not.toContain('1785');
    expect(await lin.locator('#online-room').textContent()).not.toContain('1805');
    await page.locator('#online-leave').click();
    await expect(page.locator('#quick-match [data-quick-part="rating"]')).toHaveText('Gale III · 1805 · 21 rated races');
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
    await expect(card(page, 'why')).toHaveText('Lin didn’t finish.');
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

test('under reduced motion the rank card appears settled, and a loss across a line reads as down from the rank above', async ({ page, browser, supabase }) => {
  // Both at 1800, the first point of Gale III, so Lin's loss drops her into Gust I.
  for (const email of ['ada@stilltype.test', 'lin@stilltype.test']) supabase.races.quick.ratings.set(supabase.addUser(email).id, { rating: 1800, races: 20 });
  supabase.races.quick.duration = 5;
  supabase.races.quick.countdownMs = 2000;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#online-name').fill('Ada');
  await quick(page).click();
  const { context, page: lin } = await signedIn(browser, supabase, 'lin@stilltype.test', 'Lin', { reducedMotion: 'reduce' });

  try {
    await quick(lin).click();
    await expect(page.locator('#online-input')).toBeEnabled({ timeout: 8000 });
    await expect(lin.locator('#online-input')).toBeEnabled();
    const passage = await page.locator('#online-accessible-passage').textContent();
    await Promise.all([typeInto(page, passage.slice(0, 60), '#online-input', { delay: 35 }), typeInto(lin, passage.slice(0, 30), '#online-input', { delay: 70 })]);
    await expect(page.locator('#online-rating-change')).toHaveText('Rated win. Gale III · 1810 · 21 rated races (+10)', { timeout: 15000 });

    // The card is in its final state from the start: the rating doesn't count, the gain is already on the bar,
    // nothing animates, and the wind is drawn once and holds still.
    const shown = await page.locator('#online-rank-card').evaluate(async (slot) => {
      const canvas = slot.querySelector('canvas');
      const rating = slot.querySelector('[data-rc="rating"]').textContent;
      const change = getComputedStyle(slot.querySelector('.rc-change')).transform;
      const before = canvas.toDataURL();
      await new Promise((resolve) => { setTimeout(resolve, 600); });

      return { rating, change, running: slot.getAnimations({ subtree: true }).length, still: canvas.toDataURL() === before };
    });

    expect(shown).toEqual({ rating: '1810', change: 'matrix(1, 0, 0, 1, 0, 0)', running: 0, still: true });
    await expect(ends(page)).toHaveText(['Gale III', '90 to Gale II']);
    await expect(lin.locator('#online-rating-change')).toHaveText('Rated loss. Gust I · 1790 · 21 rated races (−10), down from Gale III.', { timeout: 15000 });
    await expect(card(lin, 'label')).toHaveText('Rated loss');
    await expect(card(lin, 'rank')).toHaveText('Gust I');
    await expect(card(lin, 'from')).toHaveText('down from Gale III');
    await expect(card(lin, 'rating')).toHaveText('1790');
    await expect(ends(lin)).toHaveText(['Gust I', '10 to Gale III']);
    // Closing the race takes the card and its wind away.
    await page.locator('#online-leave').click();
    await expect(page.locator('#online-rank-card')).toBeHidden();
    await expect(page.locator('#online-rank-card canvas')).toHaveCount(0);
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
