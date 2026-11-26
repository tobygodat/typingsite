import { test, expect, openApp, openView, signInWithEmail, typeInto, insertPlainText, setRaceName, openRaceLink } from './fixtures.js';

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
  await setRaceName(page, 'Ada');
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
  await setRaceName(page, 'Ada');
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
  const linUser = supabase.addUser('lin@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openView(page, 'Challenge');
  await quick(page).click();
  await expect(quick(page)).toHaveText('Stop looking');
  const { context, page: lin } = await signedIn(browser, supabase, 'lin@stilltype.test', 'Lin');

  try {
    // Lin's request pairs on the service, but its reply is held until after Lin presses Stop. Only Lin's: Ada is still
    // searching and polls the queue too, and a hold her poll took would keep her from ever seeing the match.
    const release = supabase.races.quick.holdNextQueue(linUser.id);
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

// How a quick match settles, seen from both racers: a slow link, a run that can't be checked, a racer who closes
// the page or leaves, and a pair racing too often. Each racer's winner mark, tally and rating line must agree.
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function racer(browser, supabase, email, name) {
  supabase.addUser(email);
  const context = await browser.newContext();
  const page = await context.newPage();
  await supabase.attach(page);
  await openApp(page);
  await signInWithEmail(page, email);
  await openView(page, 'Challenge');
  await setRaceName(page, name);

  return { context, page };
}

// Two racers matched and in the race, the passage read off the first's page.
async function matched(browser, supabase, { seconds = 5 } = {}) {
  supabase.races.quick.duration = seconds;
  supabase.races.quick.countdownMs = 2000;
  const ada = await racer(browser, supabase, 'ada@stilltype.test', 'Ada');
  const lin = await racer(browser, supabase, 'lin@stilltype.test', 'Lin');
  await quick(ada.page).click();
  await quick(lin.page).click();
  await expect(ada.page.locator('#online-input')).toBeEnabled({ timeout: 10000 });
  await expect(lin.page.locator('#online-input')).toBeEnabled({ timeout: 10000 });

  return { ada, lin, passage: await ada.page.locator('#online-accessible-passage').textContent() };
}

// Types a key at a time until the race clock closes the input, as a person keeps typing to the end.
async function typeUntilClosed(page, text, delay) {
  const input = page.locator('#online-input');
  await input.focus();

  for (const char of text) {
    if (await input.isDisabled()) return;
    await page.keyboard.type(char);
    await pause(delay);
  }
}

// Every key of `text` in one task, as a script pasting key by key would: each is a plain one-letter insert the race
// scores as a key, and none is a moment after the one before.
const pasteKeys = (page, text) => page.locator('#online-input').evaluate((field, keys) => {
  for (const data of keys) field.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data }));
}, text);

// What one racer's results say: both cards' winner marks, the tally and the rating line.
async function results(page) {
  await expect(page.locator('#online-results')).toBeVisible({ timeout: 25000 });
  await expect(page.locator('#online-rating-change')).toBeVisible();

  return {
    mine: await page.locator('#online-duel-mine').getAttribute('data-outcome'),
    theirs: await page.locator('#online-duel-theirs').getAttribute('data-outcome'),
    tally: await page.locator('#online-tally').getAttribute('aria-label'),
    line: (await page.locator('#online-rating-change').textContent()).replaceAll(' ', ' '),
  };
}

for (const latency of [0, 300]) {
  test(`on a ${latency} ms link both honest runs are checked, and the faster racer wins, rated`, async ({ browser, supabase }) => {
    const { ada, lin, passage } = await matched(browser, supabase);

    try {
      // Only Ada's race requests arrive late, so her progress lands after the clock and her finish after that.
      await ada.page.route('**/rest/v1/rpc/race_action', async (route) => { await pause(latency); await route.fallback(); });
      await Promise.all([typeUntilClosed(ada.page, passage, 110), typeUntilClosed(lin.page, passage, 170)]);
      expect(await results(ada.page)).toEqual({ mine: 'won', theirs: 'lost', tally: 'You 1, Lin 0', line: 'Rated win. Race rating 1520 · 1 rated race · provisional (+20)' });
      expect(await results(lin.page)).toEqual({ mine: 'lost', theirs: 'won', tally: 'You 0, Ada 1', line: 'Rated loss. Race rating 1480 · 1 rated race · provisional (−20)' });
      expect([...supabase.races.rooms.values()].at(-1).players.map((p) => p.verdict)).toEqual(['ok', 'ok']);
    } finally {
      await ada.context.close();
      await lin.context.close();
    }
  });
}

test('a pasted run is never the winner: both racers see the checked run win, in the cards, the tally and the rating', async ({ browser, supabase }) => {
  const { ada, lin, passage } = await matched(browser, supabase);

  try {
    // Ada's keys all arrive at once, further than Lin types honestly. They go in one task, so no time passes between
    // them on any engine: typed by Playwright, a loaded WebKit spaced them out enough to pass the interval check and
    // fail only the speed cap, or to pass both.
    await ada.page.locator('#online-input').focus();
    await Promise.all([pasteKeys(ada.page, passage.slice(0, 150)), typeUntilClosed(lin.page, passage.slice(0, 40), 100)]);
    expect(await results(ada.page)).toEqual({ mine: 'unchecked', theirs: 'won', tally: 'You 0, Lin 1',
      line: 'Rated loss: your run couldn’t be checked. It had keys closer together than the check allows. Race rating 1480 · 1 rated race · provisional (−20)' });
    await expect(ada.page.locator('#online-duel-mine .duel-accuracy')).toHaveText('not checked');
    expect(await results(lin.page)).toEqual({ mine: 'won', theirs: 'unchecked', tally: 'You 1, Ada 0',
      line: 'Rated win: Ada’s run couldn’t be checked. Race rating 1520 · 1 rated race · provisional (+20)' });
  } finally {
    await ada.context.close();
    await lin.context.close();
  }
});

test('a racer who closes the page is never the winner; the one who stayed sees it in the cards, the tally and the rating', async ({ browser, supabase }) => {
  const { ada, lin, passage } = await matched(browser, supabase);

  try {
    await lin.page.locator('#online-input').focus();
    await lin.page.keyboard.type(passage.slice(0, 10), { delay: 70 });
    await lin.page.close();
    await typeUntilClosed(ada.page, passage, 120);
    expect(await results(ada.page)).toEqual({ mine: 'won', theirs: 'unchecked', tally: 'You 1, Lin 0',
      line: 'Rated win: Lin didn’t finish. Race rating 1520 · 1 rated race · provisional (+20)' });
    const back = await lin.context.newPage();
    await supabase.attach(back);
    await openApp(back);
    await openView(back, 'Challenge');
    await expect(status(back)).toHaveText('Rated loss: your finish didn’t arrive before the race closed. Race rating 1480 · 1 rated race · provisional (−20)');
  } finally {
    await ada.context.close();
    await lin.context.close();
  }
});

test('a forfeit right after the start: the racer who stays finishes alone and wins rated; if they leave too, only the leaver loses', async ({ browser, supabase }) => {
  const { ada, lin, passage } = await matched(browser, supabase);

  try {
    await lin.page.locator('#online-leave').click();
    await expect(status(lin.page)).toHaveText('Rated loss: you left the race. Race rating 1480 · 1 rated race · provisional (−20)');
    await expect(ada.page.locator('#online-room-status')).toHaveText('Lin left the race. Finish your run to win.');
    await typeUntilClosed(ada.page, passage, 120);
    expect(await results(ada.page)).toEqual({ mine: 'won', theirs: 'unchecked', tally: 'You 1, Lin 0',
      line: 'Rated win: Lin left the race. Race rating 1520 · 1 rated race · provisional (+20)' });
    await expect(ada.page.locator('#online-duel-theirs .duel-accuracy')).toHaveText('left');
    await ada.page.locator('#online-leave').click();

    // Again, and this time Ada leaves too: Lin's loss stands, and Ada's race isn't rated.
    await quick(ada.page).click();
    await quick(lin.page).click();
    await expect(ada.page.locator('#online-input')).toBeEnabled({ timeout: 10000 });
    await expect(lin.page.locator('#online-input')).toBeEnabled();
    await lin.page.locator('#online-leave').click();
    await expect(status(lin.page)).toHaveText('Rated loss: you left the race. Race rating 1462 · 2 rated races · provisional (−18)');
    await expect(ada.page.locator('#online-room-status')).toHaveText('Lin left the race. Finish your run to win.');
    await ada.page.locator('#online-leave').click();
    await expect(status(ada.page)).toHaveText('Not rated: neither racer finished with a run that could be checked. You left the race.');
    await expect(ada.page.locator('#quick-match [data-quick-part="rating"]')).toHaveText('Race rating 1520 · 1 rated race · provisional');
  } finally {
    await ada.context.close();
    await lin.context.close();
  }
});

test('past a pair’s rated races for the day the race still runs and shows its result, and both are told it didn’t count', async ({ browser, supabase }) => {
  const { ada, lin, passage } = await matched(browser, supabase, { seconds: 3 });
  // Their first race is the pair's last rated one today (the fake's limit lowered from three to one).
  supabase.races.quick.repeatLimit = 1;

  try {
    await Promise.all([typeUntilClosed(ada.page, passage, 110), typeUntilClosed(lin.page, passage, 170)]);
    expect((await results(ada.page)).line).toBe('Rated win. Race rating 1520 · 1 rated race · provisional (+20)');
    await expect(lin.page.locator('#online-results')).toBeVisible({ timeout: 10000 });

    for (const page of [ada.page, lin.page]) await page.locator('#online-leave').click();
    await quick(ada.page).click();
    await quick(lin.page).click();
    await expect(ada.page.locator('#online-input')).toBeEnabled({ timeout: 10000 });
    await expect(lin.page.locator('#online-input')).toBeEnabled({ timeout: 10000 });
    const next = await ada.page.locator('#online-accessible-passage').textContent();
    await Promise.all([typeUntilClosed(ada.page, next, 110), typeUntilClosed(lin.page, next, 170)]);
    expect(await results(ada.page)).toEqual({ mine: 'won', theirs: 'lost', tally: 'You 2, Lin 0', line: 'Not rated: you and Lin have raced each other too often today.' });
    expect(await results(lin.page)).toEqual({ mine: 'lost', theirs: 'won', tally: 'You 0, Ada 2', line: 'Not rated: you and Ada have raced each other too often today.' });
    await ada.page.locator('#online-leave').click();
    await expect(ada.page.locator('#quick-match [data-quick-part="rating"]')).toHaveText('Race rating 1520 · 1 rated race · provisional');
  } finally {
    await ada.context.close();
    await lin.context.close();
  }
});

// Racing your own best run (quick match with nobody waiting): it goes to nobody, so a run that can't be scored
// against it says it isn't compared, never that it wasn't sent.

// A 30-second run on the default setup, recorded on this device, then quick match with nobody waiting and
// Race your best run.
async function raceOwnBest(page, supabase) {
  supabase.addUser('ada@stilltype.test');
  await page.clock.install();
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  const passage = await page.locator('#accessible-passage').textContent();
  await typeInto(page, passage.slice(0, 120), '#typing-input', { delay: 60 });
  await page.clock.fastForward(31000);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await openView(page, 'Challenge');
  await page.locator('#quick-match [data-quick="toggle"]').click();
  await expect.poll(() => supabase.requests.filter((entry) => entry.includes('quick_match')).length).toBeGreaterThan(3);
  await page.clock.fastForward(21000);
  await page.locator('#quick-match [data-quick="best"]').click();
  await expect(page.locator('#session-title')).toHaveText('Race your best run');

  return page.locator('#accessible-passage').textContent();
}

test('a touch run against your own best says it is not compared, and how to compare', async ({ page, supabase }) => {
  const text = await raceOwnBest(page, supabase);
  await page.locator('#typing-input').dispatchEvent('pointerdown', { pointerType: 'touch' });
  await expect(page.locator('#condition-line')).toContainText('touch input');
  await page.keyboard.type(text.slice(0, 40), { delay: 60 });
  await page.clock.fastForward(31000);
  await expect(page.locator('#ghost-result-heading')).toHaveText('A different kind of input, so not compared.');
  await expect(page.locator('#ghost-result-status')).toHaveText('Race again on a physical keyboard to compare.');
  await expect(page.locator('#ghost-result-action')).toHaveText('Race again');
});

test('a character a ghost race can’t replay, against your own best, is not compared', async ({ page, supabase }) => {
  const text = await raceOwnBest(page, supabase);
  await typeInto(page, text.slice(0, 10), '#typing-input', { delay: 60 });
  await insertPlainText(page, '😀');
  await page.keyboard.type(text.slice(10, 30), { delay: 60 });
  await page.clock.fastForward(31000);
  await expect(page.locator('#ghost-result-heading')).toHaveText('A character a ghost race can’t replay, so not compared.');
  await expect(page.locator('#ghost-result-status')).toHaveText('Race again without emoji.');
});

test('a run with more keys than a ghost race replays, against your own best, is too long to replay', async ({ page, supabase }) => {
  test.setTimeout(240000);
  await raceOwnBest(page, supabase);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.locator('#typing-input').focus();

  // 6002 keys, past the 6000 a trace holds, all within the 30-second clock.
  for (let index = 0; index < 3001; index += 1) {
    await page.keyboard.press('x');
    await page.keyboard.press('Backspace');
  }

  await page.clock.runFor(31000);
  await expect(page.locator('#ghost-result-heading')).toHaveText('Too long to replay.');
  await expect(page.locator('#ghost-result-status')).toHaveText('Race again with fewer corrections.');
});
