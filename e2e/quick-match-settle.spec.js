// How a quick match settles, seen from both racers: a slow link, a run that can't be checked, a racer who closes
// the page or leaves, and a pair racing too often. Each racer's winner mark, tally and rating line must agree.
import { test, expect, openApp, openView, signInWithEmail } from './fixtures.js';

test.setTimeout(120000);

const quick = (page) => page.locator('#quick-match [data-quick="toggle"]');
const status = (page) => page.locator('#quick-match [data-quick-part="status"]');
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function racer(browser, supabase, email, name) {
  supabase.addUser(email);
  const context = await browser.newContext();
  const page = await context.newPage();
  await supabase.attach(page);
  await openApp(page);
  await signInWithEmail(page, email);
  await openView(page, 'Challenge');
  await page.locator('#online-name').fill(name);

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
    // Ada's keys all arrive at once, further than Lin types honestly.
    await ada.page.locator('#online-input').focus();
    await Promise.all([ada.page.keyboard.type(passage.slice(0, 150)), typeUntilClosed(lin.page, passage.slice(0, 40), 100)]);
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
    await expect(status(ada.page)).toHaveText('Not rated: neither racer finished with a run that could be checked. Your finish didn’t arrive before the race closed.');
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
