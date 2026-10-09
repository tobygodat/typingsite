import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect, openApp, signInWithEmail, chooseWords, passageText, typeInto } from './fixtures.js';

test.setTimeout(120000);

const SHOTS = path.join('docs', 'screenshots', 'async-ghost-challenge');

// Committed screenshots only when SCREENSHOTS is set; otherwise they stay with the test output.
async function shot(page, testInfo, name) {
  if (process.env.SCREENSHOTS) await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: process.env.SCREENSHOTS ? path.join(SHOTS, `${name}.png`) : testInfo.outputPath(`${name}.png`) });
}

// The theme follows the system; let its colour transition settle before a screenshot.
async function scheme(page, colorScheme) {
  await page.emulateMedia({ colorScheme });
  await page.waitForTimeout(600);
}

async function member(browser, supabase, email, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport, colorScheme: 'dark' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/supabase\.co/.test(message.location().url)) errors.push(message.text());
  });
  await supabase.attach(page);
  await openApp(page);
  await signInWithEmail(page, email);
  return { context, page, errors };
}

function befriend(supabase, owner, friend, name) {
  const list = supabase.races.friends.get(owner.id) || [];
  const row = { id: randomUUID(), friendId: friend.id, name };
  list.push(row);
  supabase.races.friends.set(owner.id, list);
  return row;
}

// A recorded run at an even pace, in the compact trace the service stores.
function steadyTrace(text, stepMs, end = null) {
  return { v: 1, k: text, t: [...text].map((_, i) => (i ? stepMs : 0)), e: end ?? (text.length - 1) * stepMs };
}

const ghostX = (page) => page.locator('#text-display .ghost-caret').evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).m41);

test('a finished run goes to a friend, who races its ghost later, and both see who finished first', async ({ page, browser, supabase }, testInfo) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  befriend(supabase, ada, lin, 'Lin');
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await chooseWords(page, 10);
  const text = await passageText(page);
  await typeInto(page, text, '#typing-input', { delay: 130 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#run-again')).toBeFocused();

  // After the run: pick a friend and send it.
  const offer = page.locator('#ghost-offer');
  await expect(offer).toBeVisible();
  await offer.locator('summary').click();
  await expect(page.locator('#ghost-friend option')).toHaveText(['Lin']);
  await expect(page.locator('#ghost-name')).toHaveValue('ada');
  await page.locator('#ghost-name').fill('Ada');
  await page.locator('#send-ghost').click();
  await expect(page.locator('#ghost-offer-status')).toHaveText('Sent to Lin. They have 7 days to race it, and the result arrives in your inbox.');
  await page.locator('#ghost-offer-status').scrollIntoViewIfNeeded();
  await shot(page, testInfo, 'offer-dark');
  await scheme(page, 'light');
  await shot(page, testInfo, 'offer-light');
  await scheme(page, 'dark');
  await page.locator('#send-ghost').click();
  await expect(page.locator('#ghost-offer-status')).toHaveText('Already sent to Lin.');
  expect(supabase.challenges.rows.size).toBe(1);
  const row = [...supabase.challenges.rows.values()][0];
  expect(row.recipientId).toBe(lin.id);
  expect(row.passage).toBe(text);
  expect(row.trace.k).toBe(text);
  const senderWpm = Number(await page.locator('#result-wpm').textContent());
  expect(Math.abs(row.sender.wpm - senderWpm)).toBeLessThanOrEqual(1);
  expect(row.sender.wpm).toBeGreaterThan(30);
  expect(row.sender.wpm).toBeLessThan(140);

  // Lin, in another browser, whenever they like: a toast and an inbox entry.
  const { context, page: linPage, errors } = await member(browser, supabase, 'lin@stilltype.test');
  try {
    const toast = linPage.locator('#challenge-toast');
    await expect(toast).toContainText('Ada challenged you to beat their 10-word run.', { timeout: 12000 });
    await toast.getByRole('button', { name: 'Race' }).click();
    await expect(linPage.locator('body')).toHaveAttribute('data-session', 'challenge');
    await expect(linPage.locator('#session-title')).toHaveText('Race Ada’s run');
    await expect(linPage.locator('#accessible-passage')).toHaveText(text);
    await expect(linPage.locator('#condition-line')).toContainText('ghost race · english 200 · 10 words');
    const ghost = linPage.locator('#text-display .ghost-caret');
    await expect(ghost).not.toHaveClass(/is-hidden/);
    expect(await ghostX(linPage)).toBeLessThan(2);

    // The ghost replays Ada's keys from Lin's first one; it is never scored.
    const half = Math.floor(text.length / 2);
    await typeInto(linPage, text.slice(0, half), '#typing-input', { delay: 170 });
    await expect.poll(() => ghostX(linPage)).toBeGreaterThan(40);
    await shot(linPage, testInfo, 'racing-dark');
    await scheme(linPage, 'light');
    await shot(linPage, testInfo, 'racing-light');
    await scheme(linPage, 'dark');
    await linPage.keyboard.type(text.slice(half), { delay: 110 });
    await expect(linPage.locator('body')).toHaveAttribute('data-view', 'results');
    await expect(linPage.locator('#run-again')).toBeFocused();

    const result = linPage.locator('#ghost-result');
    await expect(result).toBeVisible();
    await expect(linPage.locator('#ghost-result-heading')).toHaveText(/^(You finished first\.|Ada finished first\.|A tie\.)$/);
    await expect(linPage.locator('#ghost-result-rows .race-result-row')).toHaveCount(2);
    await expect(linPage.locator('#ghost-result-status')).toHaveText('Sent. Ada sees this result in their inbox too.');
    await expect(linPage.locator('#result-delta')).toHaveText('Ghost race complete · not counted toward your best');
    await expect(linPage.locator('#run-card-stamp')).toContainText('ghost race');
    await expect(linPage.locator('#ghost-offer')).toBeHidden();
    await expect(linPage.locator('#best')).toHaveText('No best yet');
    expect(row.result).toBeTruthy();
    // Saved as its own kind: never a best, so no comparison or progress point either.
    await expect.poll(() => supabase.profileFor('lin@stilltype.test')?.runs?.map((run) => run.kind)).toEqual(['challenge']);
    expect(supabase.profileFor('lin@stilltype.test').bests).toEqual({});
    await shot(linPage, testInfo, 'result-dark');
    await scheme(linPage, 'light');
    await shot(linPage, testInfo, 'result-light');
    await scheme(linPage, 'dark');

    // Lin's inbox has the result and nothing left to race.
    await linPage.locator('#inbox-trigger').click();
    const linEntry = linPage.locator('#inbox-list [data-kind="challenge-result"]');
    await expect(linEntry).toContainText(/^Ada’s 10-word run: (you finished first|Ada finished first|a tie) · you \d+ wpm, Ada \d+ wpm\./);
    await expect(linPage.locator('#inbox-list [data-inbox-action="challenge"]')).toHaveCount(0);

    // Ada hears about it on the next poll, from any screen.
    await expect(page.locator('#challenge-toast-text')).toHaveText(/^Lin raced your 10-word run: (you finished first|Lin finished first|a tie) · you \d+ wpm, Lin \d+ wpm\.$/, { timeout: 15000 });
    await expect(page.locator('#challenge-toast-action')).toBeHidden();
    await page.locator('#challenge-toast-close').click();
    await page.locator('#inbox-trigger').click();
    await expect(page.locator('#inbox-list [data-kind="challenge-result"]')).toHaveCount(1);
    await shot(page, testInfo, 'inbox-dark');
    // A cleared result does not come back on the next poll.
    await page.locator('#inbox-clear').click();
    await page.reload();
    await expect(page.locator('#text-display .char').first()).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.locator('#challenge-toast')).toBeHidden();
    await expect(page.locator('#inbox-count')).toBeHidden();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('an interrupted or touch ghost race is not sent and can be raced again; the sent finish is final', async ({ page, supabase }, testInfo) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  const passage = 'river light patient words carry the quiet home';
  const challenge = supabase.challenges.seed(ada.id, lin.id, { name: 'Ada', label: 'Lin', passage,
    conditions: { mode: 'words', count: 8, punctuation: false, wordList: '200', correctionPolicy: 'relaxed', textId: 'generated-test' },
    trace: steadyTrace(passage, 140) });
  await page.setViewportSize({ width: 320, height: 760 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await expect(page.locator('#challenge-toast')).toBeVisible({ timeout: 12000 });
  await page.locator('#challenge-toast-close').click();
  await page.locator('#inbox-trigger').click();
  await page.locator('#inbox-list [data-inbox-action="challenge"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-session', 'challenge');

  await typeInto(page, passage.slice(0, 6), '#typing-input', { delay: 110 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.type(passage.slice(6), { delay: 60 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#ghost-result-heading')).toHaveText('Interrupted, so not sent.');
  await expect(page.locator('#ghost-result-rows .race-result-row')).toHaveCount(1);
  expect(challenge.result).toBeNull();
  const again = page.locator('#ghost-result-action');
  await expect(again).toHaveText('Race again');
  await again.click();
  await expect(page.locator('#typing-input')).toBeFocused();
  await expect(page.locator('#accessible-passage')).toHaveText(passage);
  // A touch run is never compared with Ada's keyboard run, so it is not sent either.
  await page.locator('#typing-input').dispatchEvent('pointerdown', { pointerType: 'touch' });
  await expect(page.locator('#condition-line')).toContainText('touch input');
  await page.keyboard.type(passage, { delay: 60 });
  await expect(page.locator('#ghost-result-heading')).toHaveText('A different kind of input, so not sent.');
  await expect(page.locator('#ghost-result-status')).toHaveText('Ada typed on a physical keyboard and this run used touch input; the two are never compared. Race again on a physical keyboard to send a run.');
  expect(challenge.result).toBeNull();
  await again.click();
  await expect(page.locator('#typing-input')).toBeFocused();
  await page.keyboard.type(passage, { delay: 110 });
  await expect(page.locator('#ghost-result-status')).toHaveText('Sent. Ada sees this result in their inbox too.');
  expect(challenge.result.wpm).toBeGreaterThan(30);
  expect(challenge.result.wpm).toBeLessThan(140);
  // Nothing on the page is wider than the narrowest phone, and the rows stay inside it as it widens.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  for (const width of [390, 1000]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 760 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), { message: `no overflow at ${width}` }).toBeLessThanOrEqual(0);
    const box = await page.locator('#ghost-result-rows').boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    if (width === 390) {
      await page.locator('#ghost-result-heading').evaluate((node) => node.scrollIntoView({ block: 'start' }));
      await shot(page, testInfo, 'result-mobile');
    }
  }
  // The service holds one reply; the inbox no longer offers the race.
  await page.locator('#inbox-trigger').click();
  await expect(page.locator('#inbox-list [data-inbox-action="challenge"]')).toHaveCount(0);
  await expect(page.locator('#inbox-list [data-kind="challenge-result"]')).toContainText(/^Ada’s 8-word run: /);
});

test('at 320 px a long sender name wraps, a corrected slip onto ö is still sent, inbox polls keep focus and the race ends a retest cycle', async ({ page, supabase }) => {
  const name = 'christopher.montgomery12';
  const sender = supabase.addUser(`${name}@stilltype.test`);
  const lin = supabase.addUser('lin@stilltype.test');
  const passage = 'river light patient words carry the quiet home';
  const challenge = supabase.challenges.seed(sender.id, lin.id, { name, label: 'Lin', passage,
    conditions: { mode: 'words', count: 8, punctuation: false, wordList: '200', correctionPolicy: 'relaxed' },
    trace: steadyTrace(passage, 140) });
  await page.setViewportSize({ width: 320, height: 720 });
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await expect(page.locator('#challenge-toast')).toBeVisible({ timeout: 12000 });
  await page.locator('#challenge-toast-close').click();
  // A practice run first: the ghost race ends its drill-and-retest cycle, as the daily does.
  await chooseWords(page, 10);
  await typeInto(page, await passageText(page), '#typing-input', { delay: 20 });
  await expect(page.locator('#skip-to-retest')).toBeEnabled();
  // The inbox is polled every 10 s; a poll with nothing new leaves keyboard focus where it was.
  await page.locator('#inbox-trigger').click();
  const raceButton = page.locator('#inbox-list [data-inbox-action="challenge"]');
  await raceButton.focus();
  await page.waitForTimeout(11000);
  await expect(raceButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-session', 'challenge');
  await expect(page.locator('#session-title')).toHaveText(`Race ${name}’s run`);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const fits = (id) => page.locator(id).evaluate((node) => node.scrollWidth <= node.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  expect(await fits('#session-title')).toBe(true);
  // The ghost is the opponent here, so it is drawn at full strength.
  await expect(page.locator('#text-display .ghost-caret')).toHaveCSS('opacity', '1');

  await typeInto(page, passage.slice(0, 3), '#typing-input', { delay: 160 });
  await page.keyboard.insertText('ö');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(passage.slice(3), { delay: 160 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#ghost-result-heading')).toHaveText(`${name} finished first.`);
  await expect(page.locator('#ghost-result-status')).toHaveText(`Sent. ${name} sees this result in their inbox too.`);
  expect(challenge.result.correct).toBe(passage.length);
  expect(challenge.result.accuracy).toBeLessThan(100);
  await expect(page.locator('#skip-to-retest')).toBeDisabled();
  await expect(page.locator('#recommendation-meta')).toHaveText(/^A standalone drill\./);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 760 });
    await expect.poll(overflow, { message: `no overflow at ${width}` }).toBeLessThanOrEqual(0);
    expect(await fits('#ghost-result-heading'), `heading fits at ${width}`).toBe(true);
  }
});

test('a timed ghost race runs on the sender’s clock and is led by the text kept', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  const passage = Array.from({ length: 120 }, (_, i) => ['time', 'over', 'water', 'still', 'light'][i % 5]).join(' ');
  supabase.challenges.seed(ada.id, lin.id, { name: 'Ada', passage, duration: 15,
    conditions: { mode: 'time', duration: 15, punctuation: false, wordList: '200', correctionPolicy: 'relaxed' },
    trace: steadyTrace(passage.slice(0, 90), 160, 15000) });
  // The recorded run is the race itself, so it still steps from key to key under reduced motion.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await page.locator('#challenge-toast').getByRole('button', { name: 'Race' }).click({ timeout: 12000 });
  await expect(page.locator('#session-title')).toHaveText('Race Ada’s run');
  await expect(page.locator('#timer')).toHaveText('15');
  await typeInto(page, passage.slice(0, 20), '#typing-input', { delay: 90 });
  await expect.poll(() => ghostX(page)).toBeGreaterThan(40);
  await page.keyboard.type(passage.slice(20, 100), { delay: 90 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results', { timeout: 15000 });
  await expect(page.locator('#ghost-result-heading')).toHaveText(/^(You typed further\.|Ada typed further\.|A tie\.)$/);
  await expect(page.locator('#ghost-result-rule')).toHaveText('Same 15 s clock: more correct text kept leads. wpm counts correct characters kept.');
  await expect(page.locator('#ghost-result-rows')).toContainText('15.0 s');
  await expect(page.locator('#ghost-result-status')).toHaveText('Sent. Ada sees this result in their inbox too.');
});

test('an older open ghost race still reaches a new device behind more than fifty newer answered ones', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  const passage = 'river light patient words carry the quiet home';
  const conditions = { mode: 'words', count: 8, punctuation: false, wordList: '200', correctionPolicy: 'relaxed' };
  const trace = steadyTrace(passage, 140);
  const day = 86400000;
  const now = Date.now();
  supabase.challenges.seed(ada.id, lin.id, { name: 'Ada', label: 'Lin', passage, conditions, trace, createdAt: now - 3 * day });
  for (let i = 0; i < 55; i += 1) {
    supabase.challenges.seed(ada.id, lin.id, { name: 'Ada', label: 'Lin', passage, conditions, trace, createdAt: now - 2 * day + i * 60000, answered: true });
  }
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await expect(page.locator('#challenge-toast')).toContainText('Ada challenged you to beat their 8-word run.', { timeout: 12000 });
  await page.locator('#challenge-toast-close').click();
  // The open race tops the inbox, every result from the week stays, and a later poll repeats nothing.
  await page.locator('#inbox-trigger').click();
  const rows = page.locator('#inbox-list .inbox-entry');
  await expect(rows).toHaveCount(56);
  await expect(rows.first()).toHaveAttribute('data-kind', 'challenge');
  await expect(page.locator('#inbox-list [data-inbox-action="challenge"]')).toHaveCount(1);
  await page.waitForTimeout(11000);
  await expect(rows).toHaveCount(56);
  await expect(page.locator('#inbox-count')).toBeHidden();
  await page.locator('#inbox-list [data-inbox-action="challenge"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-session', 'challenge');
  await expect(page.locator('#accessible-passage')).toHaveText(passage);
});

test('a slow send for an earlier run never re-enables Send while a newer run is being sent', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  befriend(supabase, ada, supabase.addUser('lin@stilltype.test'), 'Lin');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await chooseWords(page, 10);
  await typeInto(page, await passageText(page), '#typing-input', { delay: 90 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  const send = page.locator('#send-ghost');
  const status = page.locator('#ghost-offer-status');
  supabase.challenges.held = [];
  await page.locator('#ghost-offer summary').click();
  await page.locator('#ghost-name').fill('Ada');
  await send.click();
  await expect(status).toHaveText('Sending to Lin…');
  await expect(send).toBeDisabled();

  // While the first send is in flight, a second run is finished and sent too.
  await page.locator('#run-again').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await typeInto(page, await passageText(page), '#typing-input', { delay: 90 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await page.locator('#ghost-offer summary').click();
  await expect(send).toBeEnabled();
  await send.click();
  await expect(status).toHaveText('Sending to Lin…');
  await expect.poll(() => supabase.challenges.held.length).toBe(2);

  // The first reply lands: the second send still owns the button.
  const firstReply = page.waitForResponse((response) => /\/rpc\/challenge_action$/.test(response.url())
    && response.request().postDataJSON().p_action === 'send');
  supabase.challenges.held.shift()();
  await firstReply;
  await page.waitForTimeout(500);
  await expect(send).toBeDisabled();
  await expect(status).toHaveText('Sending to Lin…');
  // Closing and reopening the offer doesn't release it either.
  await page.locator('#ghost-offer summary').click();
  await page.locator('#ghost-offer summary').click();
  await expect(page.locator('#ghost-friend')).toBeEnabled();
  await expect(send).toBeDisabled();

  supabase.challenges.held.shift()();
  await expect(status).toHaveText('Sent to Lin. They have 7 days to race it, and the result arrives in your inbox.');
  await expect(send).toBeEnabled();
  supabase.challenges.held = null;
  expect(supabase.challenges.rows.size).toBe(2);
});

test('every open ghost race and every result from the last week stays in a crowded inbox, which scrolls at 320 px', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  const passage = 'river light patient words carry the quiet home';
  const conditions = { mode: 'words', count: 8, punctuation: false, wordList: '200', correctionPolicy: 'relaxed' };
  const trace = steadyTrace(passage, 140);
  const day = 86400000;
  const now = Date.now();
  // 35 races for Lin to run, oldest first, and 35 of Lin's own challenges answered two to three days ago.
  for (let i = 0; i < 35; i += 1) {
    supabase.challenges.seed(ada.id, lin.id, { name: `Ada ${i}`, label: 'Lin', passage, conditions, trace, createdAt: now - 5 * day + i * 60000 });
    supabase.challenges.seed(lin.id, ada.id, { name: 'Lin', label: `Friend ${i}`, passage, conditions, trace, createdAt: now - 3 * day + i * 60000, answered: true });
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await expect(page.locator('#challenge-toast')).toBeVisible({ timeout: 12000 });
  await page.locator('#challenge-toast-close').click();
  await page.locator('#inbox-trigger').click();
  const list = page.locator('#inbox-list');
  await expect(list.locator('[data-inbox-action="challenge"]')).toHaveCount(35);
  await expect(list.locator('[data-kind="challenge-result"]')).toHaveCount(35);

  // The long list scrolls inside the inbox, which stays on screen and inside 320 px.
  const box = await list.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(640);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

  // Cleared results stay cleared; the races come back, and the oldest is still there to run.
  await page.locator('#inbox-clear').click();
  await expect(list.locator('.inbox-entry')).toHaveCount(0);
  await expect(list.locator('[data-inbox-action="challenge"]')).toHaveCount(35, { timeout: 15000 });
  await expect(list.locator('[data-kind="challenge-result"]')).toHaveCount(0);
  const oldest = list.locator('.inbox-entry', { hasText: 'Ada 0 challenged you' });
  await oldest.scrollIntoViewIfNeeded();
  await oldest.getByRole('button', { name: 'Race' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-session', 'challenge');
  await expect(page.locator('#session-title')).toHaveText('Race Ada 0’s run');
});

test('guests are never offered a challenge; the offer fits a narrow phone and an empty friend list points to online races', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  await page.setViewportSize({ width: 320, height: 720 });
  await openApp(page);
  await chooseWords(page, 10);
  await typeInto(page, await passageText(page), '#typing-input', { delay: 20 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#ghost-offer')).toBeHidden();

  await signInWithEmail(page, 'ada@stilltype.test');
  await chooseWords(page, 10);
  await typeInto(page, await passageText(page), '#typing-input', { delay: 20 });
  await expect(page.locator('#ghost-offer')).toBeVisible();
  await page.locator('#ghost-offer summary').click();
  await expect(page.locator('#ghost-offer-empty')).toBeVisible();
  await expect(page.locator('#ghost-offer-form')).toBeHidden();

  // With a friend saved, the picker and the send button stay inside 320 px.
  befriend(supabase, ada, supabase.addUser('lin@stilltype.test'), 'Lin from the long walk to work');
  await page.locator('#ghost-offer summary').click();
  await page.locator('#ghost-offer summary').click();
  await expect(page.locator('#ghost-friend option')).toHaveText(['Lin from the long walk to work']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  for (const id of ['#ghost-friend', '#ghost-name', '#send-ghost']) {
    const box = await page.locator(id).boundingBox();
    expect(box.x + box.width, id).toBeLessThanOrEqual(320);
  }
  supabase.races.friends.set(ada.id, []);
  await page.locator('#ghost-offer summary').click();
  await page.locator('#ghost-offer summary').click();
  await page.locator('#ghost-offer-friends').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'compete');
  await expect(page.locator('#online-friends')).toBeVisible();
});
