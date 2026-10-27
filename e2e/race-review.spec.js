import { test, expect, openApp, openView, signInWithEmail, typeInto } from './fixtures.js';

test.setTimeout(90000);

// Ada hosts and invites Lin's account; both ready and type the whole passage, Ada first, so Ada wins.
async function racePair(page, browser, supabase) {
  supabase.addUser('ada@stilltype.test');
  supabase.addUser('lin@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await openView(page, 'Challenge');
  await page.locator('#online-name').fill('Ada');
  await page.locator('#online-invite-email').fill('lin@stilltype.test');
  await page.locator('#create-online-race').click();
  await expect(page.locator('#online-room')).toBeVisible();
  const context = await browser.newContext();
  const lin = await context.newPage();
  await supabase.attach(lin);
  await openApp(lin);
  await signInWithEmail(lin, 'lin@stilltype.test');
  await openView(lin, 'Challenge');
  await lin.locator('#online-name').fill('Lin');
  await lin.locator('[data-accept-invite]').click();
  await expect(lin.locator('#online-room')).toBeVisible();
  await page.locator('#online-ready').click();
  await lin.locator('#online-ready').click();
  await expect(page.locator('#online-input')).toBeEnabled({ timeout: 12000 });
  await expect(lin.locator('#online-input')).toBeEnabled();
  const passage = await page.locator('#online-accessible-passage').textContent();
  await typeInto(page, passage, '#online-input', { delay: 20 });
  await typeInto(lin, passage, '#online-input', { delay: 5 });
  await expect(page.locator('#online-results')).toBeVisible({ timeout: 10000 });
  await expect(lin.locator('#online-results')).toBeVisible({ timeout: 10000 });
  return { context, lin, passage };
}

test('under the results, Graph shows both racers\' speed and Replay plays the passage with both carets', async ({ page, browser, supabase }) => {
  const { context, lin, passage } = await racePair(page, browser, supabase);
  try {
    // Graph is the default: one chart, your line in the accent and theirs in the text colour.
    await expect(page.locator('#online-review')).toBeVisible();
    await expect(page.locator('#online-show-graph')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#online-duel-graph')).toBeVisible();
    await expect(page.locator('#online-duel-replay')).toBeHidden();
    const lines = page.locator('#online-duel-graph path.graph-line');
    await expect(lines).toHaveCount(2);
    const colours = await lines.evaluateAll((paths) => paths.map((path) => getComputedStyle(path).stroke));
    const [accent, text] = await page.evaluate(() => ['--accent', '--text'].map((name) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${name})`;
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    }));
    expect(colours.sort()).toEqual([accent, text].sort());
    await expect(page.locator('#online-duel-graph path.graph-line-theirs')).toHaveCSS('stroke', text);

    // Replay: the passage, your spring caret and their ghost caret, each named, with Play, 1× and Restart.
    await page.locator('#online-show-replay').click();
    await expect(page.locator('#online-show-replay')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#online-duel-graph')).toBeHidden();
    await expect(page.locator('#online-duel-replay')).toBeVisible();
    await expect(page.locator('#online-replay-display .word').first()).toHaveText(passage.split(' ')[0]);
    await expect(page.locator('#online-replay-display .caret .caret-tag')).toHaveText('You');
    await expect(page.locator('#online-replay-display .ghost-caret .caret-tag')).toHaveText('Lin');
    await expect(page.locator('#online-replay-display .ghost-caret')).not.toHaveClass(/is-hidden/);
    await expect(page.locator('#online-replay-toggle')).toHaveText('Pause');
    // It plays in real time: the letters either racer reached turn to the text colour as it goes.
    await expect.poll(() => page.locator('#online-replay-display .char.correct').count()).toBeGreaterThan(0);
    await page.locator('#online-replay-toggle').click();
    await expect(page.locator('#online-replay-toggle')).toHaveText('Play');
    const paused = await page.locator('#online-replay-display .char.correct').count();
    await page.waitForTimeout(500);
    expect(await page.locator('#online-replay-display .char.correct').count()).toBe(paused);
    await page.locator('#online-replay-speed').click();
    await expect(page.locator('#online-replay-speed')).toHaveText('2×');
    await page.locator('#online-replay-restart').click();
    await expect(page.locator('#online-replay-toggle')).toHaveText('Pause');
    // The replay ends on the whole passage, reached by Ada first.
    await expect.poll(() => page.locator('#online-replay-display .char.correct').count(), { timeout: 15000 }).toBe(passage.length);
    await expect(page.locator('#online-replay-toggle')).toHaveText('Play');

    // Lin sees the same race from the other side: Lin's caret is the named "You".
    await expect(lin.locator('#online-review')).toBeVisible();
    await lin.locator('#online-show-replay').click();
    await expect(lin.locator('#online-replay-display .ghost-caret .caret-tag')).toHaveText('Ada');
    await page.locator('#online-show-graph').click();
    await expect(page.locator('#online-duel-graph path.graph-line')).toHaveCount(2);
  } finally { await context.close(); }
});

test('reduced motion opens the replay on its last frame, still, with Play left to the person', async ({ page, browser, supabase }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { context, passage } = await racePair(page, browser, supabase);
  try {
    await page.locator('#online-show-replay').click();
    await expect(page.locator('#online-replay-toggle')).toHaveText('Play');
    await expect(page.locator('#online-replay-display .char.correct')).toHaveCount(passage.length);
  } finally { await context.close(); }
});

test('a race without both traces, such as one from before them, shows no Graph or Replay', async ({ page, browser, supabase }) => {
  supabase.races.dropTraces = true;
  const { context, lin } = await racePair(page, browser, supabase);
  try {
    await expect(page.locator('#online-duel-mine')).toHaveAttribute('data-outcome', 'won');
    await page.waitForTimeout(1500);
    await expect(page.locator('#online-review')).toBeHidden();
    await expect(lin.locator('#online-review')).toBeHidden();
  } finally { await context.close(); }
});
