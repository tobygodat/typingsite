import { test, expect, openApp, openView, signInWithEmail, typeInto, setRaceName, inviteByEmail } from './fixtures.js';

test.setTimeout(90000);

// Ada hosts a race (a quote race, which ends with its passage rather than on the clock, unless `setup` picks another
// practice setup first) and invites Lin's account; both ready, and the race is on.
async function pairInRace(page, browser, supabase, setup = () => page.locator('#mode-quote').click()) {
  supabase.addUser('ada@stilltype.test');
  supabase.addUser('lin@stilltype.test');
  await openApp(page);
  await signInWithEmail(page, 'ada@stilltype.test');
  await setup();
  await openView(page, 'Challenge');
  await setRaceName(page, 'Ada');
  await inviteByEmail(page, 'lin@stilltype.test');
  await expect(page.locator('#online-room')).toBeVisible();
  const context = await browser.newContext();
  const lin = await context.newPage();
  await supabase.attach(lin);
  await openApp(lin);
  await signInWithEmail(lin, 'lin@stilltype.test');
  await openView(lin, 'Challenge');
  await setRaceName(lin, 'Lin');
  await lin.locator('[data-accept-invite]').click();
  await expect(lin.locator('#online-room')).toBeVisible();
  await page.locator('#online-ready').click();
  await lin.locator('#online-ready').click();
  await expect(page.locator('#online-input')).toBeEnabled({ timeout: 12000 });
  await expect(lin.locator('#online-input')).toBeEnabled();

  return { context, lin, passage: await page.locator('#online-accessible-passage').textContent() };
}

// Both type the whole passage, Ada first, so Ada wins.
async function typeBoth(page, lin, passage) {
  await typeInto(page, passage, '#online-input', { delay: 20 });
  await typeInto(lin, passage, '#online-input', { delay: 5 });
  await expect(page.locator('#online-results')).toBeVisible({ timeout: 10000 });
  await expect(lin.locator('#online-results')).toBeVisible({ timeout: 10000 });
}

// A quote race between Ada and Lin, raced to its end.
async function racePair(page, browser, supabase) {
  const { context, lin, passage } = await pairInRace(page, browser, supabase);
  await typeBoth(page, lin, passage);

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

// On a slow link a racer's last progress can reach the service after its clock. The service finishes the racer on the
// keys that progress carried, and it carries no trace, so neither racer had Graph or Replay. The racer's tab now sends
// the trace of exactly those keys, which the service keeps.
test('progress that reaches the service after a timed race’s clock still leaves both traces, so Graph and Replay show', async ({ page, browser, supabase }) => {
  const { context, lin, passage } = await pairInRace(page, browser, supabase, async () => {
    await page.locator('#mode-time').click();
    await page.locator('#duration-options [data-length="15"]').click();
  });

  try {
    await typeInto(page, passage.slice(0, 20), '#online-input', { delay: 20 });
    await typeInto(lin, passage.slice(0, 20), '#online-input', { delay: 20 });
    const room = [...supabase.races.rooms.values()].at(-1);
    const clockOut = Date.parse(room.startAt) + room.duration * 1000;

    // Ada's next progress waits on its way to the service until the service's clock has run out.
    let open;
    const gate = new Promise((resolve) => { open = resolve; });
    const progress = (request) => request.url().includes('/rpc/race_action') && request.postDataJSON()?.p_action === 'progress';
    await page.route('**/rest/v1/rpc/race_action', async (route) => {
      if (progress(route.request())) await gate;
      await route.fallback();
    });
    const held = page.waitForRequest(progress);
    await page.keyboard.type(passage[20]);
    await held;
    await expect.poll(() => Date.now() > clockOut + 500, { timeout: 20000 }).toBe(true);
    open();

    await expect(page.locator('#online-results')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#online-review')).toBeVisible({ timeout: 10000 });
    await expect(lin.locator('#online-review')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#online-duel-graph path.graph-line')).toHaveCount(2);
    expect(room.players.map((player) => player.trace?.k.length)).toEqual([21, 20]);
  } finally { await context.close(); }
});

// A rematch's join reply that lands late carries the service's time from when it answered, so a tab that took that
// time as now ran its race clock seconds behind the service's: it counted down while the other racer typed, and the
// service finished it before its own clock ran out. Each later reply bounds the start again, and the earliest counts.
test('a rematch joined late races on the service’s clock, and both results still show Graph and Replay', async ({ page, browser, supabase }) => {
  const { context, lin } = await racePair(page, browser, supabase);

  try {
    await expect(page.locator('#online-review')).toBeVisible();
    await lin.locator('#online-rematch').click();
    await expect(page.locator('#online-their-rematch')).toHaveAttribute('data-state', 'chosen');

    // Ada picks second, so her tab joins the rematch at once; the service answers that join only after the
    // rematch's countdown, which Lin's tab, joining on time, sees end.
    const release = supabase.races.hold('join', supabase.users.get('ada@stilltype.test').id);
    await page.locator('#online-rematch').click();
    await expect(lin.locator('#online-input')).toBeEnabled({ timeout: 12000 });
    release();

    await expect(page.locator('#online-input')).toBeEnabled({ timeout: 10000 });
    const left = async (racer) => Number((await racer.locator('#online-timer').textContent()).match(/\d+/)[0]);
    const [ada, theirs] = await Promise.all([left(page), left(lin)]);
    expect(Math.abs(ada - theirs)).toBeLessThanOrEqual(1);

    const passage = await page.locator('#online-accessible-passage').textContent();
    await typeBoth(page, lin, passage);
    await expect(page.locator('#online-review')).toBeVisible({ timeout: 10000 });
    await expect(lin.locator('#online-review')).toBeVisible({ timeout: 10000 });
  } finally { await context.close(); }
});
