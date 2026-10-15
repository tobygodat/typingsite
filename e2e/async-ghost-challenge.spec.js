import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect, openApp, openView, signInWithEmail, chooseWords, passageText, typeInto, openSettings } from './fixtures.js';

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

// Lets one held reply go (a release from the fake's `held`) and gives the page a moment to act on it.
async function letGo(page, release, action, id = null) {
  const landed = page.waitForResponse((response) => /\/rpc\/challenge_action$/.test(response.url())
    && response.request().postDataJSON().p_action === action && (!id || response.request().postDataJSON().p_id === id));
  release();
  await landed;
  await page.waitForTimeout(500);
}

// Holds every reply to these actions; returns the releases as they queue.
function hold(supabase, ...actions) {
  supabase.challenges.held = [];
  supabase.challenges.holding = new Set(actions);
  return supabase.challenges.held;
}

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
    await expect(linPage.locator('#best')).toHaveText('Not counted');
    // Never a baseline or pattern evidence, so no drill or retest is offered from it.
    await expect(linPage.locator('#start-drill')).toBeHidden();
    await expect(linPage.locator('#skip-to-retest')).toBeHidden();
    expect(row.result).toBeTruthy();
    // Saved as its own kind: never a best, so no comparison or progress point either. Only its summary is
    // kept, so ghost races never take the place of practice traces.
    await expect.poll(() => supabase.profileFor('lin@stilltype.test')?.runs?.map((run) => run.kind)).toEqual(['challenge']);
    expect(supabase.profileFor('lin@stilltype.test').bests).toEqual({});
    expect(supabase.profileFor('lin@stilltype.test').attempts).toEqual([]);
    expect('patterns' in supabase.profileFor('lin@stilltype.test').runs[0]).toBe(false);
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

// Custom text is never compared (metric contract): a custom run is never offered as a ghost, and a ghost race
// taken from the inbox closes the custom editor and leaves Custom unmarked, as master's other sessions do.
test('a custom run is never offered as a ghost, and racing a ghost closes the custom editor', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  const passage = 'river light patient words carry the quiet home';
  supabase.challenges.seed(ada.id, lin.id, { name: 'Ada', label: 'Lin', passage,
    conditions: { mode: 'words', count: 8, punctuation: false, wordList: '200', correctionPolicy: 'relaxed', textId: 'generated-test' },
    trace: steadyTrace(passage, 140) });
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await expect(page.locator('#challenge-toast')).toBeVisible({ timeout: 12000 });
  await page.locator('#challenge-toast-close').click();

  // A practice run can be sent; a custom run, signed in all the same, cannot.
  await chooseWords(page, 10);
  await typeInto(page, await passageText(page), '#typing-input', { delay: 20 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#ghost-offer')).toBeVisible();
  await page.locator('.nav-item[data-nav="practice"]').click();
  const text = 'the quick brown fox jumps over the lazy dog';
  await page.locator('#mode-custom').click();
  await page.locator('#custom-text').fill(text);
  await page.locator('#custom-use').click();
  await expect(page.locator('#condition-line')).toContainText('custom text');
  await typeInto(page, text, '#typing-input', { delay: 20 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#result-delta')).toHaveText('Custom text complete · not counted toward your best');
  await expect(page.locator('#ghost-offer')).toBeHidden();
  await expect(page.locator('#ghost-result')).toBeHidden();

  // The custom editor open on Practice, then the ghost race from the inbox: the editor closes and Custom is unmarked.
  await page.locator('.nav-item[data-nav="practice"]').click();
  await page.locator('#mode-custom').click();
  await expect(page.locator('#custom-options')).toBeVisible();
  await page.locator('#inbox-trigger').click();
  await page.locator('#inbox-list [data-inbox-action="challenge"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-session', 'challenge');
  await expect(page.locator('#custom-options')).toBeHidden();
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#mode-custom')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#condition-line')).toContainText('ghost race');
  await expect(page.locator('#accessible-passage')).toHaveText(passage);
});

test.describe('on a touch screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  // Tapping Race again focuses the input, which can reopen the software keyboard with no tap on the
  // input itself; the retry is still a touch run.
  test('a tap on Race again or Run again starts a touch attempt, so a touch retry is sent', async ({ page, supabase }) => {
    const ada = supabase.addUser('ada@stilltype.test');
    const lin = supabase.addUser('lin@stilltype.test');
    const passage = 'river light patient words carry the quiet home';
    const challenge = supabase.challenges.seed(ada.id, lin.id, { name: 'Ada', label: 'Lin', passage,
      conditions: { mode: 'words', count: 8, punctuation: false, wordList: '200', correctionPolicy: 'relaxed', inputClass: 'touch' },
      trace: steadyTrace(passage, 140) });
    await openApp(page);
    await signInWithEmail(page, 'lin@stilltype.test');
    await expect(page.locator('#challenge-toast')).toBeVisible({ timeout: 12000 });
    await page.locator('#challenge-toast-close').tap();
    await page.locator('#inbox-trigger').tap();
    await page.locator('#inbox-list [data-inbox-action="challenge"]').tap();
    await expect(page.locator('body')).toHaveAttribute('data-session', 'challenge');
    await page.locator('#typing-input').tap();
    await expect(page.locator('#condition-line')).toContainText('touch input');
    await page.keyboard.type(passage.slice(0, 6), { delay: 110 });
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.keyboard.type(passage.slice(6), { delay: 60 });
    await expect(page.locator('#ghost-result-heading')).toHaveText('Interrupted, so not sent.');

    await page.locator('#ghost-result-action').tap();
    await expect(page.locator('#typing-input')).toBeFocused();
    await expect(page.locator('#condition-line')).toContainText('touch input');
    await page.keyboard.type(passage, { delay: 110 });
    await expect(page.locator('#ghost-result-status')).toHaveText('Sent. Ada sees this result in their inbox too.');
    await expect(page.locator('#result-conditions')).toContainText('touch input');
    expect(challenge.result.wpm).toBeGreaterThan(30);

    // The plain Run again shares the reset: a tap starts touch. Esc in the passage keeps it touch, since soft
    // keyboards have an Esc key too (a run's input class comes from the press that started it, src/app.js).
    await page.locator('#run-again').tap();
    await expect(page.locator('#typing-input')).toBeFocused();
    await expect(page.locator('#condition-line')).toContainText('touch input');
    await page.keyboard.press('Escape');
    await expect(page.locator('#condition-line')).toContainText('touch input');
  });
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

test('with the pace caret on, a ghost race keeps the friend’s run as its ghost and their numbers in its conditions', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  const passage = 'still water 42 over light 7 time still water over';
  supabase.challenges.seed(ada.id, lin.id, { name: 'Ada', passage,
    conditions: { mode: 'words', count: 10, punctuation: false, numbers: true, wordList: '200', correctionPolicy: 'relaxed' },
    trace: steadyTrace(passage, 120) });
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await openSettings(page);
  await page.locator('#pace-select').selectOption('custom');
  await page.keyboard.press('Escape');
  await expect(page.locator('#pace-label')).toHaveText('pace 80 wpm');

  await page.locator('#challenge-toast').getByRole('button', { name: 'Race' }).click({ timeout: 12000 });
  await expect(page.locator('#session-title')).toHaveText('Race Ada’s run');
  const ghost = page.locator('#text-display .ghost-caret');
  // The ghost is Ada's recorded run, not the pacer, and the pace isn't labelled over it.
  await expect(ghost).toHaveAttribute('data-replay', '');
  await expect(ghost).not.toHaveClass(/is-hidden/);
  await expect(page.locator('#pace-label')).toBeHidden();
  await expect(page.locator('#condition-line')).toContainText('10 words · plain · numbers');
  // Changing the pace mid-race leaves the replay in place.
  await openSettings(page);
  await page.locator('#pace-select').selectOption('best');
  await page.keyboard.press('Escape');
  await expect(ghost).toHaveAttribute('data-replay', '');
  await expect(page.locator('#pace-label')).toBeHidden();
  await typeInto(page, passage.slice(0, 14), '#typing-input', { delay: 120 });
  await expect.poll(() => ghostX(page)).toBeGreaterThan(40);
  await expect(ghost).toHaveAttribute('data-replay', '');
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

test('a send whose reply was lost after it was stored is stored once when sent again', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  befriend(supabase, ada, supabase.addUser('lin@stilltype.test'), 'Lin');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await chooseWords(page, 10);
  await typeInto(page, await passageText(page), '#typing-input', { delay: 90 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await page.locator('#ghost-offer summary').click();
  await page.locator('#ghost-name').fill('Ada');
  supabase.challenges.lost.add('send');
  await page.locator('#send-ghost').click();
  await expect(page.locator('#ghost-offer-error')).toHaveText('Can’t reach the account service. Check your connection.');
  expect(supabase.challenges.rows.size).toBe(1);
  await expect(page.locator('#send-ghost')).toBeEnabled();
  await page.locator('#send-ghost').click();
  await expect(page.locator('#ghost-offer-status')).toHaveText('Sent to Lin. They have 7 days to race it, and the result arrives in your inbox.');
  await expect(page.locator('#ghost-offer-error')).toHaveText('');
  expect(supabase.challenges.rows.size).toBe(1);
});

test('a finish whose reply was lost after it was stored gets the stored result back on Send again', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  const passage = 'river light patient words carry the quiet home';
  const challenge = supabase.challenges.seed(ada.id, lin.id, { name: 'Ada', label: 'Lin', passage,
    conditions: { mode: 'words', count: 8, punctuation: false, wordList: '200', correctionPolicy: 'relaxed' },
    trace: steadyTrace(passage, 140) });
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await page.locator('#challenge-toast').getByRole('button', { name: 'Race' }).click({ timeout: 12000 });
  await expect(page.locator('body')).toHaveAttribute('data-session', 'challenge');
  supabase.challenges.lost.add('finish');
  await typeInto(page, passage, '#typing-input', { delay: 110 });
  await expect(page.locator('#ghost-result-status')).toHaveText('Not sent. Can’t reach the account service. Check your connection.');
  const stored = { ...challenge.result };
  expect(stored.correct).toBe(passage.length);
  const action = page.locator('#ghost-result-action');
  await expect(action).toHaveText('Send again');
  await action.click();
  await expect(page.locator('#ghost-result-status')).toHaveText('Sent. Ada sees this result in their inbox too.');
  await expect(action).toBeHidden();
  await expect(page.locator('#ghost-result-rows')).toContainText(`${stored.wpm} wpm`);
  expect(challenge.result).toEqual(stored);
  await page.locator('#inbox-trigger').click();
  await expect(page.locator('#inbox-list [data-kind="challenge-result"]')).toContainText(`you ${stored.wpm} wpm`);
});

test('a second try at an answered race shows the first stored finish, which stands', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  const passage = 'river light patient words carry the quiet home';
  const challenge = supabase.challenges.seed(ada.id, lin.id, { name: 'Ada', label: 'Lin', passage,
    conditions: { mode: 'words', count: 8, punctuation: false, wordList: '200', correctionPolicy: 'relaxed' },
    trace: steadyTrace(passage, 140) });
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await page.locator('#challenge-toast').getByRole('button', { name: 'Race' }).click({ timeout: 12000 });
  await expect(page.locator('body')).toHaveAttribute('data-session', 'challenge');
  // Lin's other device finished first, at a pace this run doesn't match.
  const first = { wpm: 41, accuracy: 100, elapsedMs: 13000, correct: passage.length };
  Object.assign(challenge, { result: first, completedAt: new Date().toISOString() });
  await typeInto(page, passage, '#typing-input', { delay: 110 });
  await expect(page.locator('#ghost-result-status')).toHaveText('Your first finish was already sent and stands, so this run wasn’t. Ada sees the result shown here.');
  await expect(page.locator('#ghost-result-rows')).toContainText('41 wpm');
  await expect(page.locator('#ghost-result-action')).toBeHidden();
  expect(challenge.result).toEqual(first);
});

test('a ghost race reply that lands after Run again and a finished practice run stays out of the practice result', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  const passage = 'river light patient words carry the quiet home';
  const challenge = supabase.challenges.seed(ada.id, lin.id, { name: 'Ada', label: 'Lin', passage,
    conditions: { mode: 'words', count: 8, punctuation: false, wordList: '200', correctionPolicy: 'relaxed' },
    trace: steadyTrace(passage, 140) });
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await chooseWords(page, 10);
  await page.locator('#challenge-toast').getByRole('button', { name: 'Race' }).click({ timeout: 12000 });
  await expect(page.locator('body')).toHaveAttribute('data-session', 'challenge');
  // The service stores the finish at once; only its reply waits.
  supabase.challenges.held = [];
  supabase.challenges.holding = new Set(['finish']);
  await typeInto(page, passage, '#typing-input', { delay: 110 });
  await expect(page.locator('#ghost-result-status')).toHaveText('Sending your run to Ada…');
  await expect.poll(() => supabase.challenges.held.length).toBe(1);
  const stored = { ...challenge.result };
  expect(stored.correct).toBe(passage.length);

  // Run again leaves the race for practice, and that run finishes before the reply arrives.
  await page.locator('#run-again').click();
  await expect(page.locator('body')).toHaveAttribute('data-session', 'practice');
  await expect(page.locator('#ghost-result')).toBeHidden();
  await typeInto(page, await passageText(page), '#typing-input', { delay: 90 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#ghost-result')).toBeHidden();
  await expect(page.locator('#ghost-offer')).toBeVisible();

  const reply = page.waitForResponse((response) => /\/rpc\/challenge_action$/.test(response.url())
    && response.request().postDataJSON().p_action === 'finish');
  supabase.challenges.held.shift()();
  await reply;
  await page.waitForTimeout(500);
  // The practice result keeps no ghost panel; the recorded finish still reaches the inbox.
  await expect(page.locator('#ghost-result')).toBeHidden();
  await expect(page.locator('#ghost-offer')).toBeVisible();
  await expect(page.locator('#inbox-list [data-kind="challenge-result"]')).toContainText(`you ${stored.wpm} wpm`);
  expect(challenge.result).toEqual(stored);
  supabase.challenges.held = null;
});

// An open eight-word challenge from `name` to Lin.
function challengeLin(supabase, lin, name, passage = 'river light patient words carry the quiet home') {
  const sender = supabase.addUser(`${name.toLowerCase()}@stilltype.test`);
  return supabase.challenges.seed(sender.id, lin.id, { name, label: 'Lin', passage,
    conditions: { mode: 'words', count: 8, punctuation: false, wordList: '200', correctionPolicy: 'relaxed' },
    trace: steadyTrace(passage, 140) });
}

test('a Race reply that lands after a later Race click leaves the later race in place', async ({ page, supabase }) => {
  const lin = supabase.addUser('lin@stilltype.test');
  const ada = challengeLin(supabase, lin, 'Ada');
  const bo = challengeLin(supabase, lin, 'Bo', 'still water over light time still water over');
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await expect(page.locator('#challenge-toast')).toBeVisible({ timeout: 12000 });
  await page.locator('#challenge-toast-close').click();
  const held = hold(supabase, 'get');
  for (const [index, name] of ['Ada', 'Bo'].entries()) {
    await page.locator('#inbox-trigger').click();
    await page.locator('#inbox-list .inbox-entry', { hasText: `${name} challenged you` }).getByRole('button', { name: 'Race' }).click();
    await expect.poll(() => held.length).toBe(index + 1);
  }
  const [adaReply, boReply] = held;
  supabase.challenges.held = null;
  await letGo(page, boReply, 'get', bo.id);
  await expect(page.locator('#session-title')).toHaveText('Race Bo’s run');
  // Ada's reply, asked for first, lands last: the race chosen later stays.
  await letGo(page, adaReply, 'get', ada.id);
  await expect(page.locator('#session-title')).toHaveText('Race Bo’s run');
  await expect(page.locator('#accessible-passage')).toHaveText(bo.passage);
  await typeInto(page, bo.passage, '#typing-input', { delay: 110 });
  await expect(page.locator('#ghost-result-status')).toHaveText('Sent. Bo sees this result in their inbox too.');
  expect(bo.result).toBeTruthy();
  expect(ada.result).toBeNull();
});

// A reply that lands somewhere other than where Race was clicked comes back as this offer: a toast saying
// the race is ready, with Race. Nothing else on screen changes.
async function expectOffer(page, name) {
  await expect(page.locator('#challenge-toast')).toBeVisible();
  await expect(page.locator('#challenge-toast-text')).toHaveText(`${name}’s race is ready.`);
  await expect(page.locator('#challenge-toast').getByRole('button', { name: 'Race' })).toBeVisible();
}

// Clicks Race on an inbox row and holds the challenge's reply; returns its release.
async function holdInboxRace(page, supabase) {
  const held = hold(supabase, 'get');
  await page.locator('#inbox-trigger').click();
  await page.locator('#inbox-list [data-inbox-action="challenge"]').click();
  await expect.poll(() => held.length).toBe(1);
  supabase.challenges.held = null;
  return held[0];
}

// Signs Lin in and closes the toast for the challenge waiting there.
async function linArrives(page) {
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await expect(page.locator('#challenge-toast')).toBeVisible({ timeout: 12000 });
  await page.locator('#challenge-toast-close').click();
}

// Asks the inbox to poll now and waits for the listing it reads.
async function pollInbox(page) {
  const listed = page.waitForResponse((response) => /\/rpc\/challenge_action$/.test(response.url())
    && response.request().postDataJSON().p_action === 'list');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await listed;
  await page.waitForTimeout(300);
}

test('a Race reply that lands where Lin clicked Race starts the ghost race at once', async ({ page, supabase }) => {
  const lin = supabase.addUser('lin@stilltype.test');
  const ada = challengeLin(supabase, lin, 'Ada');
  await linArrives(page);
  // From the inbox on Progress, with nothing else done while it loads, the race opens on Practice.
  await openView(page, 'Progress');
  const reply = await holdInboxRace(page, supabase);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'progress');
  await letGo(page, reply, 'get', ada.id);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('body')).toHaveAttribute('data-session', 'challenge');
  await expect(page.locator('#session-title')).toHaveText('Race Ada’s run');
  await expect(page.locator('#typing-input')).toBeFocused();
  await expect(page.locator('#challenge-toast')).toBeHidden();
  await expect(page.locator('#account-toast')).toBeHidden();
});

test('a Race reply that lands after an online room opened starts no ghost race; the room stays and the race is offered', async ({ page, supabase }) => {
  const lin = supabase.addUser('lin@stilltype.test');
  const ada = challengeLin(supabase, lin, 'Ada');
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  const held = hold(supabase, 'get');
  await page.locator('#challenge-toast').getByRole('button', { name: 'Race' }).click({ timeout: 12000 });
  await expect.poll(() => held.length).toBe(1);
  const [reply] = held;
  supabase.challenges.held = null;
  // While the reply is on its way, Lin opens an online race.
  await openView(page, 'Challenge');
  await page.locator('#online-name').fill('Lin');
  await page.locator('#create-online-race').click();
  await expect(page.locator('#online-room')).toBeVisible();
  const room = [...supabase.races.rooms.values()][0];
  await letGo(page, reply, 'get', ada.id);
  // Lin moved on, so the reply only offers the race.
  await expect(page.locator('#account-toast')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'compete');
  await expect(page.locator('body')).toHaveAttribute('data-session', 'practice');
  await expect(page.locator('#online-room')).toBeVisible();
  await expect(page.locator('#online-guest-link')).toHaveValue(new RegExp(room.id));
  expect(room.status).toBe('waiting');
  await expectOffer(page, 'Ada');
  // Taken inside the room, the offer asks Lin to leave the room first and changes nothing.
  await page.locator('#challenge-toast').getByRole('button', { name: 'Race' }).click();
  await expect(page.locator('#account-feedback')).toHaveText('Leave your online race before starting a ghost race.');
  await expect(page.locator('body')).toHaveAttribute('data-session', 'practice');
  await expect(page.locator('#online-room')).toBeVisible();
  // The ghost race is still Lin's to run once the room is left.
  await page.locator('#inbox-trigger').click();
  await expect(page.locator('#inbox-list [data-inbox-action="challenge"]')).toHaveCount(1);
  expect(ada.result).toBeNull();
});

test('a Race reply that lands while an online room is being created offers the race, and the room still opens', async ({ page, supabase }) => {
  const lin = supabase.addUser('lin@stilltype.test');
  const ada = challengeLin(supabase, lin, 'Ada');
  await linArrives(page);
  await openView(page, 'Challenge');
  await page.locator('#online-name').fill('Lin');
  // On Challenge, Lin races Ada from the inbox, then creates a room before either reply lands.
  const reply = await holdInboxRace(page, supabase);
  supabase.races.held = [];
  supabase.races.holding = new Set(['create']);
  await page.locator('#create-online-race').click();
  await expect.poll(() => supabase.races.held.length).toBe(1);
  const [roomReply] = supabase.races.held;
  supabase.races.held = null;
  await letGo(page, reply, 'get', ada.id);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'compete');
  await expect(page.locator('body')).toHaveAttribute('data-session', 'practice');
  await expectOffer(page, 'Ada');
  // The room's reply opens it as usual, with no ghost race left behind it.
  const opened = page.waitForResponse((response) => /\/rpc\/race_action$/.test(response.url())
    && response.request().postDataJSON().p_action === 'create');
  roomReply();
  await opened;
  await expect(page.locator('#online-room')).toBeVisible();
  const room = [...supabase.races.rooms.values()][0];
  await expect(page.locator('#online-guest-link')).toHaveValue(new RegExp(room.id));
  await expect(page.locator('body')).toHaveAttribute('data-view', 'compete');
  await expect(page.locator('body')).toHaveAttribute('data-session', 'practice');
  expect(room.status).toBe('waiting');
  expect(ada.result).toBeNull();
});

test('a Race reply that lands after a practice run began neither interrupts that run nor starts the race, and offers it after the run', async ({ page, supabase }) => {
  const lin = supabase.addUser('lin@stilltype.test');
  const ada = challengeLin(supabase, lin, 'Ada');
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  const held = hold(supabase, 'get');
  await page.locator('#challenge-toast').getByRole('button', { name: 'Race' }).click({ timeout: 12000 });
  await expect.poll(() => held.length).toBe(1);
  const [reply] = held;
  supabase.challenges.held = null;
  // While the reply is on its way, Lin starts a practice run.
  await chooseWords(page, 10);
  const text = await passageText(page);
  await typeInto(page, text.slice(0, 12), '#typing-input', { delay: 90 });
  await letGo(page, reply, 'get', ada.id);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('body')).toHaveAttribute('data-session', 'practice');
  await expect(page.locator('#typing-status')).toHaveText('In progress');
  // Nothing new appears beside the run; the offer waits for its end.
  await expect(page.locator('#challenge-toast')).toBeHidden();
  await page.keyboard.type(text.slice(12), { delay: 90 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#run-card-stamp')).toContainText('practice');
  await expect(page.locator('#ghost-result')).toBeHidden();
  await expect(page.locator('#ghost-offer')).toBeVisible();
  await expectOffer(page, 'Ada');
  await expect(page.locator('#run-again')).toBeFocused();
  // The run's end announces both the offer that waited for it and the run's own result.
  await expect(page.locator('#announcement')).toHaveText(/^Ada’s race is ready\. \d+ wpm, \d+% accuracy\.$/);
  expect(ada.result).toBeNull();
});

// Clicks Race on the toast and holds the challenge's reply; returns its release.
async function holdRace(page, supabase) {
  const held = hold(supabase, 'get');
  await page.locator('#challenge-toast').getByRole('button', { name: 'Race' }).click({ timeout: 12000 });
  await expect.poll(() => held.length).toBe(1);
  supabase.challenges.held = null;
  return held[0];
}

test('a Race reply that lands after Lin went to Progress leaves Lin there and offers the race', async ({ page, supabase }) => {
  const lin = supabase.addUser('lin@stilltype.test');
  const ada = challengeLin(supabase, lin, 'Ada');
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  const reply = await holdRace(page, supabase);
  await openView(page, 'Progress');
  await letGo(page, reply, 'get', ada.id);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'progress');
  await expect(page.locator('body')).toHaveAttribute('data-session', 'practice');
  await expect(page.locator('#account-toast')).toBeHidden();
  await expectOffer(page, 'Ada');
  // The race is still Lin's to start from the inbox.
  await page.locator('#inbox-trigger').click();
  await expect(page.locator('#inbox-list [data-inbox-action="challenge"]')).toHaveCount(1);
  expect(ada.result).toBeNull();
});

test('a Race reply that lands after Skip to typing leaves the practice test in place and offers the race', async ({ page, supabase }) => {
  const lin = supabase.addUser('lin@stilltype.test');
  const ada = challengeLin(supabase, lin, 'Ada');
  await linArrives(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  await openView(page, 'Progress');
  const reply = await holdInboxRace(page, supabase);
  // Skip to typing goes straight back to the ready practice test.
  await page.locator('.skip-link').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#typing-input')).toBeFocused();
  await letGo(page, reply, 'get', ada.id);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('body')).toHaveAttribute('data-session', 'practice');
  await expect(page.locator('#accessible-passage')).toHaveText(text);
  await expect(page.locator('#typing-input')).toBeFocused();
  await expectOffer(page, 'Ada');
  // Taken from where Lin now is, the offer starts the race.
  await page.locator('#challenge-toast').getByRole('button', { name: 'Race' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-session', 'challenge');
  await expect(page.locator('#session-title')).toHaveText('Race Ada’s run');
  await expect(page.locator('#challenge-toast')).toBeHidden();
});

test('a Race reply that lands after a drill ran out and its retest began keeps the retest and offers the race', async ({ page, supabase }) => {
  await page.clock.install();
  const lin = supabase.addUser('lin@stilltype.test');
  const ada = challengeLin(supabase, lin, 'Ada');
  await linArrives(page);
  await chooseWords(page, 10);
  await typeInto(page, await passageText(page), '#typing-input', { delay: 90 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await page.locator('#start-drill').click();
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  await typeInto(page, (await passageText(page)).slice(0, 20), '#typing-input', { delay: 90 });
  // In the drill's last seconds Lin races Ada from the inbox.
  await page.clock.fastForward(55_000);
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  const reply = await holdInboxRace(page, supabase);
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'drill');
  // The drill ends on its clock and the retest starts itself before the reply lands.
  await page.clock.fastForward(10_000);
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  const retest = await passageText(page);
  await letGo(page, reply, 'get', ada.id);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('#typing-screen')).toHaveAttribute('data-session', 'retest');
  await expect(page.locator('#accessible-passage')).toHaveText(retest);
  await expectOffer(page, 'Ada');
  expect(ada.result).toBeNull();
});

test('a Race reply that lands after Lin restarted the practice test leaves that practice session and offers the race', async ({ page, supabase }) => {
  const lin = supabase.addUser('lin@stilltype.test');
  const ada = challengeLin(supabase, lin, 'Ada');
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await chooseWords(page, 10);
  const reply = await holdRace(page, supabase);
  await page.locator('#restart-button').click();
  const text = await passageText(page);
  await letGo(page, reply, 'get', ada.id);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'practice');
  await expect(page.locator('body')).toHaveAttribute('data-session', 'practice');
  await expect(page.locator('#accessible-passage')).toHaveText(text);
  await expectOffer(page, 'Ada');
  await typeInto(page, text, '#typing-input', { delay: 90 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#run-card-stamp')).toContainText('practice');
  await expect(page.locator('#ghost-result')).toBeHidden();
  expect(ada.result).toBeNull();
});

test('a Race reply that lands after Lin opened the custom editor or set up a local race leaves either in place and offers the race', async ({ page, supabase }) => {
  const lin = supabase.addUser('lin@stilltype.test');
  const ada = challengeLin(supabase, lin, 'Ada');
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  let reply = await holdRace(page, supabase);
  await page.locator('#mode-custom').click();
  await expect(page.locator('#custom-options')).toBeVisible();
  await letGo(page, reply, 'get', ada.id);
  await expect(page.locator('#custom-options')).toBeVisible();
  await expect(page.locator('#custom-text')).toBeFocused();
  await expect(page.locator('body')).toHaveAttribute('data-session', 'practice');
  await expectOffer(page, 'Ada');
  // On Challenge: a Race from the inbox, then a local race set up while it loads.
  await openView(page, 'Challenge');
  await page.locator('#challenge-local').click();
  reply = await holdInboxRace(page, supabase);
  await page.locator('#start-local-race').click();
  await expect(page.locator('#race-stage')).toBeVisible();
  await letGo(page, reply, 'get', ada.id);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'compete');
  await expect(page.locator('#race-stage')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-session', 'practice');
  await expectOffer(page, 'Ada');
  expect(ada.result).toBeNull();
});

test('a Race reply that lands while Lin types into a field on the same screen leaves the field and the keyboard with Lin', async ({ page, supabase }) => {
  const lin = supabase.addUser('lin@stilltype.test');
  const ada = challengeLin(supabase, lin, 'Ada');
  await linArrives(page);
  // In the custom editor, Lin races Ada from the inbox, then writes a passage while the reply loads.
  await page.locator('#mode-custom').click();
  await expect(page.locator('#custom-options')).toBeVisible();
  let reply = await holdInboxRace(page, supabase);
  await page.locator('#custom-text').click();
  await page.keyboard.type('a passage of my own', { delay: 60 });
  await letGo(page, reply, 'get', ada.id);
  await expect(page.locator('#custom-options')).toBeVisible();
  await expect(page.locator('#custom-text')).toBeFocused();
  await expect(page.locator('body')).toHaveAttribute('data-session', 'practice');
  await expectOffer(page, 'Ada');
  await page.keyboard.type(' more', { delay: 60 });
  await expect(page.locator('#custom-text')).toHaveValue(/a passage of my own more$/);
  // On Challenge, the same with the name for an online race.
  await openView(page, 'Challenge');
  reply = await holdInboxRace(page, supabase);
  await page.locator('#online-name').click();
  await page.keyboard.type('Lin', { delay: 60 });
  await letGo(page, reply, 'get', ada.id);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'compete');
  await expect(page.locator('#online-name')).toBeFocused();
  await expect(page.locator('body')).toHaveAttribute('data-session', 'practice');
  await expectOffer(page, 'Ada');
  expect(ada.result).toBeNull();
});

test('a Race clicked mid-run waits for the run’s end once Lin goes back to typing it, and starts at once if Lin doesn’t', async ({ page, supabase }) => {
  const lin = supabase.addUser('lin@stilltype.test');
  const ada = challengeLin(supabase, lin, 'Ada');
  await linArrives(page);
  await chooseWords(page, 25);
  let text = await passageText(page);
  await typeInto(page, text.slice(0, 10), '#typing-input', { delay: 90 });
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  let reply = await holdInboxRace(page, supabase);
  // Lin goes back to the run before the reply lands.
  await typeInto(page, text.slice(10, 40), '#typing-input', { delay: 90 });
  await letGo(page, reply, 'get', ada.id);
  await expect(page.locator('body')).toHaveAttribute('data-session', 'practice');
  await expect(page.locator('#typing-status')).toHaveText('In progress');
  await expect(page.locator('#typing-input')).toBeFocused();
  await expect(page.locator('#challenge-toast')).toBeHidden();
  await page.keyboard.type(text.slice(40), { delay: 90 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#run-card-stamp')).toContainText('practice');
  await expect(page.locator('#result-delta')).not.toHaveText(/Interrupted/);
  await expectOffer(page, 'Ada');
  // A Race clicked mid-run and left to load is the person's choice: it ends the run and starts.
  await page.locator('#run-again').click();
  text = await passageText(page);
  await typeInto(page, text.slice(0, 10), '#typing-input', { delay: 90 });
  await page.mouse.move(5, 5);
  await page.mouse.move(40, 40);
  reply = await holdInboxRace(page, supabase);
  await letGo(page, reply, 'get', ada.id);
  await expect(page.locator('body')).toHaveAttribute('data-session', 'challenge');
  await expect(page.locator('#session-title')).toHaveText('Race Ada’s run');
  expect(ada.result).toBeNull();
});

test('a Race that fails while Lin types a run says so once the run ends', async ({ page, supabase }) => {
  const lin = supabase.addUser('lin@stilltype.test');
  challengeLin(supabase, lin, 'Ada');
  await linArrives(page);
  await chooseWords(page, 10);
  const text = await passageText(page);
  // The challenge read is slow, then the service is unavailable.
  let answer;
  const answered = new Promise((resolve) => { answer = resolve; });
  let gets = 0;
  await page.route(/\/rest\/v1\/rpc\/challenge_action$/, async (route) => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().p_action !== 'get') return route.fallback();
    gets += 1;
    await answered;
    await route.fulfill({ status: 503, body: '' });
  });
  await page.locator('#inbox-trigger').click();
  await page.locator('#inbox-list [data-inbox-action="challenge"]').click();
  await expect.poll(() => gets).toBe(1);
  await typeInto(page, text.slice(0, 12), '#typing-input', { delay: 90 });
  const failed = page.waitForResponse((response) => /\/rpc\/challenge_action$/.test(response.url()) && response.status() === 503);
  answer();
  await failed;
  await page.waitForTimeout(500);
  // Nothing appears beside the run.
  await expect(page.locator('#account-toast')).toBeHidden();
  await expect(page.locator('#challenge-toast')).toBeHidden();
  await expect(page.locator('#typing-status')).toHaveText('In progress');
  await page.keyboard.type(text.slice(12), { delay: 90 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  await expect(page.locator('#account-toast')).toBeVisible();
  await expect(page.locator('#account-feedback')).toHaveText('The ghost race didn’t start. Request failed (503).');
  await expect(page.locator('#run-again')).toBeFocused();
});

test('a toast that goes while its Race button has focus hands focus to the inbox and says why', async ({ page, supabase }) => {
  const lin = supabase.addUser('lin@stilltype.test');
  const ada = challengeLin(supabase, lin, 'Ada');
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  const toast = page.locator('#challenge-toast');
  await expect(toast).toContainText('Ada challenged you', { timeout: 12000 });
  await toast.getByRole('button', { name: 'Race' }).focus();
  // Lin races it on another device.
  ada.result = { ...ada.sender };
  ada.completedAt = new Date().toISOString();
  await pollInbox(page);
  await expect(toast).toBeHidden();
  await expect(page.locator('#inbox-trigger')).toBeFocused();
  await expect(page.locator('#announcement')).toHaveText('That race is no longer open.');
});

test('an offer toast goes once its race is answered on another device or expires, leaving no stale Race button', async ({ page, supabase }) => {
  const lin = supabase.addUser('lin@stilltype.test');
  const ada = challengeLin(supabase, lin, 'Ada');
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  const toast = page.locator('#challenge-toast');
  await expect(toast).toContainText('Ada challenged you', { timeout: 12000 });
  // Lin races it on another device; this one's next poll lists the result in its place.
  ada.result = { ...ada.sender };
  ada.completedAt = new Date().toISOString();
  await pollInbox(page);
  await expect(toast).toBeHidden();
  await page.locator('#inbox-trigger').click();
  await expect(page.locator('#inbox-list [data-kind="challenge-result"]')).toContainText(/^Ada’s 8-word run: /);
  await expect(page.locator('#inbox-list [data-inbox-action="challenge"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // A race offered as ready goes the same way once the service says it has expired.
  const bo = challengeLin(supabase, lin, 'Bo', 'still water over light time still water over');
  await pollInbox(page);
  await expect(toast).toContainText('Bo challenged you');
  const reply = await holdRace(page, supabase);
  await openView(page, 'Progress');
  await letGo(page, reply, 'get', bo.id);
  await expectOffer(page, 'Bo');
  bo.expiresAt = new Date(Date.now() - 1000).toISOString();
  await pollInbox(page);
  await expect(toast).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'progress');
  await page.locator('#inbox-trigger').click();
  await expect(page.locator('#inbox-list .inbox-entry', { hasText: 'Bo challenged you' })).toContainText('closed');
  await expect(page.locator('#inbox-list [data-inbox-action="challenge"]')).toHaveCount(0);
});

test('an inbox listing read before a ghost race was sent never offers that race again', async ({ page, supabase }) => {
  const lin = supabase.addUser('lin@stilltype.test');
  const ada = challengeLin(supabase, lin, 'Ada');
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await page.locator('#challenge-toast').getByRole('button', { name: 'Race' }).click({ timeout: 12000 });
  await expect(page.locator('body')).toHaveAttribute('data-session', 'challenge');
  // A poll reads the list while the race is still open; its reply lands only after the finish is stored.
  const held = hold(supabase, 'list');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => held.length, { timeout: 12000 }).toBe(1);
  const [reply] = held;
  // Later polls stay held, so only that late listing can reach the inbox.
  supabase.challenges.held = [];
  await typeInto(page, ada.passage, '#typing-input', { delay: 110 });
  await expect(page.locator('#ghost-result-status')).toHaveText('Sent. Ada sees this result in their inbox too.');
  await letGo(page, reply, 'list');
  await page.locator('#inbox-trigger').click();
  await expect(page.locator('#inbox-list [data-kind="challenge-result"]')).toContainText(/^Ada’s 8-word run: /);
  await expect(page.locator('#inbox-list [data-inbox-action="challenge"]')).toHaveCount(0);
  for (const release of supabase.challenges.held.splice(0)) release();
});

test('ghost races and their results still reach the inbox while invitations can’t be read', async ({ page, supabase }) => {
  const lin = supabase.addUser('lin@stilltype.test');
  challengeLin(supabase, lin, 'Ada');
  // The online race invitations are unavailable throughout; the ghost race list is not.
  let invites = 0;
  await page.route(/\/rest\/v1\/rpc\/race_action$/, (route) => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().p_action !== 'invites') return route.fallback();
    invites += 1;
    return route.fulfill({ status: 503, body: '' });
  });
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await expect(page.locator('#challenge-toast-text')).toContainText('Ada challenged you', { timeout: 12000 });
  expect(invites).toBeGreaterThan(0);
  // The invitation list still says why it is empty.
  await expect(page.locator('#online-invites-empty')).toHaveText('Request failed (503).');
  // A race Lin sent is answered; the next poll brings its result the same way.
  const passage = 'still water over light time still water over';
  supabase.challenges.seed(lin.id, supabase.addUser('bo@stilltype.test').id, { name: 'Lin', label: 'Bo', passage,
    conditions: { mode: 'words', count: 8, punctuation: false, wordList: '200', correctionPolicy: 'relaxed' },
    trace: steadyTrace(passage, 140), createdAt: Date.now() - 3600000, answered: true });
  await pollInbox(page);
  await page.locator('#inbox-trigger').click();
  await expect(page.locator('#inbox-list [data-kind="challenge-result"]')).toContainText(/^Bo raced your 8-word run: /);
  await expect(page.locator('#inbox-list [data-inbox-action="challenge"]')).toHaveCount(1);
});

test('a friend list that fails after a newer one arrived leaves the newer list and no error', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  befriend(supabase, ada, supabase.addUser('lin@stilltype.test'), 'Lin');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await chooseWords(page, 10);
  await typeInto(page, await passageText(page), '#typing-input', { delay: 90 });
  await expect(page.locator('body')).toHaveAttribute('data-view', 'results');
  // The offer's first friend list is slow and then fails; the one asked for after it arrives at once.
  let fail;
  const failing = new Promise((resolve) => { fail = resolve; });
  let lists = 0;
  await page.route(/\/rest\/v1\/rpc\/race_action$/, async (route) => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().p_action !== 'friends' || lists++) return route.fallback();
    await failing;
    await route.abort('connectionreset');
  });
  const summary = page.locator('#ghost-offer summary');
  await summary.click();
  await expect.poll(() => lists).toBe(1);
  await summary.click();
  await summary.click();
  await expect(page.locator('#ghost-friend option')).toHaveText(['Lin']);
  await expect(page.locator('#send-ghost')).toBeEnabled();
  const failed = page.waitForEvent('requestfailed', (request) => /\/rpc\/race_action$/.test(request.url()));
  fail();
  await failed;
  await page.waitForTimeout(500);
  await expect(page.locator('#ghost-offer-error')).toHaveText('');
  await expect(page.locator('#ghost-friend option')).toHaveText(['Lin']);
  await expect(page.locator('#send-ghost')).toBeEnabled();
});

// A challenge's conditions come from the sender's browser. The service now refuses any it can't
// reproduce, and the recipient's app refuses such a row too rather than trusting it.
test('a ghost race with conditions this app can’t reproduce is refused without an error', async ({ page, supabase }) => {
  const ada = supabase.addUser('ada@stilltype.test');
  const lin = supabase.addUser('lin@stilltype.test');
  const passage = 'river light patient words carry the quiet home';
  const trace = steadyTrace(passage, 140);
  const now = Date.now();
  // An object where a string belongs, a number where a string belongs, and a key this app doesn't know.
  [{ corpus: {} }, { mode: 'words', count: 8, wordList: 200 }, { mode: 'words', count: 8, colour: 'red' }].forEach((conditions, i) => {
    supabase.challenges.seed(ada.id, lin.id, { name: `Ada ${i + 1}`, label: 'Lin', passage, conditions, trace, createdAt: now - i * 60000 });
  });
  await openApp(page);
  await signInWithEmail(page, 'lin@stilltype.test');
  await expect(page.locator('#challenge-toast')).toBeVisible({ timeout: 12000 });
  await page.locator('#challenge-toast-close').click();
  const names = ['Ada 1', 'Ada 2', 'Ada 3'];
  const entry = (name) => page.locator('#inbox-list .inbox-entry', { hasText: `${name} challenged you` });
  for (const name of names) {
    await page.locator('#inbox-trigger').click();
    await entry(name).locator('[data-inbox-action="challenge"]').click();
    await expect(page.locator('#account-feedback')).toHaveText('This ghost race was recorded with settings this app can’t reproduce, so it can’t be raced fairly.');
    await expect(page.locator('body')).toHaveAttribute('data-session', 'practice');
    await expect(page.locator('#condition-line')).not.toContainText('ghost race');
  }
  // No shape is claimed for a run whose conditions can't be read.
  await page.locator('#inbox-trigger').click();
  for (const name of names) await expect(entry(name).locator('p')).toHaveText(`${name} challenged you to beat their run.`);
  expect([...supabase.challenges.rows.values()].every((row) => row.result === null)).toBe(true);
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
