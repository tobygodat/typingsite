import { test, expect, openApp, openView, signInWithEmail, typeInto, chooseWords, chooseMore, setRaceName, openRaceLink } from './fixtures.js';

test.setTimeout(90000);

async function host(page, supabase) {
  supabase.addUser('ada@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
}

// Creates a guest-link race from the Challenge page and seats a guest in a second browser context.
async function challengeWithGuest(page, browser, supabase) {
  await openView(page, 'Challenge');
  await setRaceName(page, 'Ada');
  await openRaceLink(page);
  const field = page.locator('#online-guest-link');
  await expect(field).toHaveValue(/#race=/);
  const room = [...supabase.races.rooms.values()].at(-1);
  const context = await browser.newContext();
  const guest = await context.newPage();
  await supabase.attach(guest);
  await guest.goto(await field.inputValue());
  await guest.locator('#online-guest-name').fill('Lin');
  await guest.locator('#join-online-race').click();
  await expect(page.locator('#online-players')).toContainText('Lin');
  await page.locator('#online-ready').click();
  await guest.locator('#online-ready').click();
  await expect(page.locator('#online-countdown')).toContainText('Starting in');

  return { room, context, guest };
}

test('plain Challenge races the practice setup, both players get the same text, and a rematch keeps it', async ({ page, browser, supabase }) => {
  await host(page, supabase);
  await chooseWords(page, 10);
  await page.locator('#punctuation-switch').click();
  const { room, context, guest } = await challengeWithGuest(page, browser, supabase);

  try {
    expect(room.conditions).toMatchObject({ mode: 'words', count: 10, punctuation: true, duration: 120, correctionPolicy: 'mandatory' });
    expect(room.passage.split(' ')).toHaveLength(10);
    await expect(page.locator('#online-accessible-passage')).toHaveText(room.passage);
    await expect(guest.locator('#online-accessible-passage')).toHaveText(room.passage);
    await expect(page.locator('#online-timer')).toHaveText('120 s race');
    await expect(page.locator('#online-input')).toBeEnabled({ timeout: 12000 });
    await expect(guest.locator('#online-input')).toBeEnabled();
    await typeInto(page, room.passage, '#online-input', { delay: 5 });
    await typeInto(guest, room.passage, '#online-input', { delay: 5 });
    await expect(page.locator('#online-results')).toBeVisible({ timeout: 10000 });
    await page.locator('#online-rematch').click();
    await expect(guest.locator('#online-their-rematch')).toHaveAttribute('data-state', 'chosen', { timeout: 5000 });
    await guest.locator('#online-rematch').click();
    await expect(page.locator('#online-countdown')).toContainText('Starting in', { timeout: 5000 });
    const rematch = supabase.races.rooms.get(room.rematchId);
    const { textId, ...kept } = room.conditions;
    expect(rematch.conditions).toMatchObject(kept);
    expect(rematch.duration).toBe(120);
    expect(rematch.passage.split(' ')).toHaveLength(10);
    await expect(guest.locator('#online-accessible-passage')).toHaveText(rematch.passage);
  } finally { await context.close(); }
});

test('Race setup shows the practice setup in the practice controls, and what it sets holds for races until Match practice', async ({ page, browser, supabase }) => {
  await host(page, supabase);
  await chooseWords(page, 25);
  await openView(page, 'Challenge');
  const options = page.locator('#online-options');
  await expect(options).toBeHidden();
  await page.locator('#people-setup').click();
  await expect(page.locator('#people-setup-heading')).toBeFocused();
  await expect(options).toBeVisible();
  await expect(page.locator('#online-customize-reset')).toBeHidden();
  // It opens on the practice setup, in the practice row's own controls.
  const mode = (name) => options.getByRole('button', { name, exact: true });
  await expect(mode('words')).toHaveAttribute('aria-pressed', 'true');
  await expect(options.getByRole('button', { name: '25 words' })).toHaveAttribute('aria-pressed', 'true');
  expect(await options.locator('.segmented').evaluateAll((groups) => groups.map((group) => group.className)))
    .toEqual(await page.locator('.practice-rail .mode-options, #duration-options').evaluateAll((groups) => groups.map((group) => group.className)));
  await expect(options.locator('[id]')).toHaveCount(0);
  await mode('time').click();
  await options.getByRole('button', { name: '15 seconds' }).click();
  await options.locator('.compact-switch').click();
  await expect(options.getByRole('button', { name: '15 seconds' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#online-setup-done').click();
  await expect(page.locator('#people-setup')).toBeFocused();
  const { room, context, guest } = await challengeWithGuest(page, browser, supabase);

  try {
    expect(room.conditions).toMatchObject({ mode: 'time', duration: 15, punctuation: true });
    expect(room.duration).toBe(15);
    await expect(guest.locator('#online-accessible-passage')).toHaveText(room.passage);
    await expect(page.locator('#online-timer')).toHaveText('15 s race');
    // Practice keeps its own setup.
    await expect(page.locator('#mode-words')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#duration-options [data-length="25"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#punctuation-toggle')).not.toBeChecked();
    // The setup holds for the next race too, until Match practice puts the practice setup back.
    await page.locator('#online-leave').click();
    await page.locator('#people-setup').click();
    await expect(mode('time')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#online-customize-reset').click();
    await expect(mode('words')).toHaveAttribute('aria-pressed', 'true');
    await expect(options.getByRole('button', { name: '25 words' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#online-customize-reset')).toBeHidden();
    await expect(page.locator('#online-setup-done')).toBeFocused();
    // Quote has no length to pick, and no punctuation switch.
    await mode('quote').click();
    await expect(options.locator('[data-race-lengths]')).toBeHidden();
    await expect(options.locator('[data-race-punctuation]')).toBeHidden();
  } finally { await context.close(); }
});

test('with a practice-only mode set, plain Challenge races today\'s medium quote on a 60-second clock', async ({ page, browser, supabase }) => {
  await host(page, supabase);
  await chooseMore(page, 'mode-code');
  const { room, context } = await challengeWithGuest(page, browser, supabase);

  try {
    expect(room.conditions).toMatchObject({ mode: 'quote', quoteLength: 'medium', difficulty: 'any', duration: 60 });
    expect(room.duration).toBe(60);
    await expect(page.locator('#online-timer')).toHaveText('60 s race');
  } finally { await context.close(); }
});
